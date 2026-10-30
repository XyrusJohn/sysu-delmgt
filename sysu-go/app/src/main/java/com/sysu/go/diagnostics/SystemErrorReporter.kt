package com.sysu.go.diagnostics

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.sysu.go.BuildConfig
import com.sysu.go.utils.SessionManager
import com.sysu.go.network.SocketManager
import com.sysu.go.network.IdempotencyKeyStore
import com.sysu.go.utils.ConnectivityMonitor
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Sends minimal, authenticated operational diagnostics without exception messages or payloads. */
object SystemErrorReporter {
    private const val TAG = "SystemErrorReporter"
    private const val PREFS = "system_diagnostics"
    private const val PENDING_CRASH = "pending_crash_name"
    private const val PENDING_CRASH_UID = "pending_crash_uid"
    private const val PENDING_CRASH_FRAME = "pending_crash_frame"
    private const val PENDING_CRASH_AT = "pending_crash_at"
    private val executor = Executors.newSingleThreadExecutor()
    private val recentReports = ConcurrentHashMap<String, Long>()
    private val recentRecoveries = ConcurrentHashMap<String, Long>()
    private val reportsInFlight = ConcurrentHashMap.newKeySet<String>()
    private val retryHandler = Handler(Looper.getMainLooper())
    private val retryAfterElapsedMs = ConcurrentHashMap<String, Long>()
    private val retryCallbacks = ConcurrentHashMap<String, Runnable>()
    @Volatile private var appContext: Context? = null
    @Volatile private var installed = false

    @Synchronized
    fun install(context: Context) {
        if (installed) return
        installed = true
        val appContext = context.applicationContext
        this.appContext = appContext
        ConnectivityMonitor.addListener(object : ConnectivityMonitor.ConnectivityChangeListener {
            override fun onConnectivityChanged(status: ConnectivityMonitor.Status) {
                if (status != ConnectivityMonitor.Status.OFFLINE) flushPendingReports(appContext)
            }
        })
        val pendingStore = PendingDiagnosticStore(appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE))
        if (pendingStore.read().isNotEmpty()) PendingDiagnosticJobScheduler.schedule(appContext)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val name = safeErrorName(error.javaClass.simpleName)
                val uid = SessionManager(appContext).getDriverId()
                val frame = safeFrame(error.stackTrace.firstOrNull { it.className.startsWith("com.sysu.go.") })
                if (uid != null) appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(PENDING_CRASH, name).putString(PENDING_CRASH_UID, uid)
                    .putString(PENDING_CRASH_FRAME, frame).putLong(PENDING_CRASH_AT, System.currentTimeMillis()).commit()
            } catch (_: Exception) {
                Log.w(TAG, "Could not save crash diagnostic")
            } finally {
                if (previous != null) previous.uncaughtException(thread, error)
                else {
                    android.os.Process.killProcess(android.os.Process.myPid())
                    kotlin.system.exitProcess(10)
                }
            }
        }
    }

    fun flushPendingCrash(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val name = prefs.getString(PENDING_CRASH, null) ?: return false
        val currentUid = SessionManager(context).getDriverId() ?: return false
        if (prefs.getString(PENDING_CRASH_UID, null) != currentUid) {
            prefs.edit().remove(PENDING_CRASH).remove(PENDING_CRASH_UID).remove(PENDING_CRASH_FRAME).remove(PENDING_CRASH_AT).apply()
            return false
        }
        val details = diagnosticDetails("crash-recovery", prefs.getString(PENDING_CRASH_FRAME, null))
            .put("clientTimestampMs", prefs.getLong(PENDING_CRASH_AT, System.currentTimeMillis()))
        sendAuthenticated("mobile_uncaught_exception", "app-runtime", name, details) {
            prefs.edit().remove(PENDING_CRASH).remove(PENDING_CRASH_UID).remove(PENDING_CRASH_FRAME).remove(PENDING_CRASH_AT).apply()
        }
        return true
    }

    fun reportOperationFailure(operation: String, error: Throwable) {
        if (!operation.matches(Regex("^[a-z][a-z0-9_-]{0,47}$"))) return
        val frame = safeFrame(error.stackTrace.firstOrNull { it.className.startsWith("com.sysu.go.") })
        queueOperationFailure(operation, safeErrorName(error.javaClass.simpleName), diagnosticDetails(operation, frame))
    }

    fun reportOperationFailure(operation: String, errorName: String) {
        if (!operation.matches(Regex("^[a-z][a-z0-9_-]{0,47}$"))) return
        queueOperationFailure(operation, safeErrorName(errorName), diagnosticDetails(operation, null))
    }

    fun reportOperationSuccess(operation: String) {
        if (!operation.matches(Regex("^[a-z][a-z0-9_-]{0,47}$"))) return
        val now = System.currentTimeMillis()
        val context = appContext ?: return
        val accountId = SessionManager(context).getDriverId() ?: return
        val recoveryKey = "$accountId:$operation"
        val prior = recentRecoveries[recoveryKey]
        if (prior != null && now - prior < 10_000) return
        recentRecoveries[recoveryKey] = now
        val store = PendingDiagnosticStore(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE))
        val eventId = java.util.UUID.randomUUID().toString()
        val recoveryDetails = diagnosticDetails(operation, null).put("clientEventId", eventId).toString()
        val recoveryMarker = PendingDiagnosticReport(accountId, operation, "Recovered", eventId,
            recoveryDetails, recovered = true, submitted = true, recoveryOnly = true)
        val stored = synchronized(this) {
            val pending = store.read()
            val hasFailure = pending.any { it.accountId == accountId && it.operation == operation && !it.recoveryOnly }
            val updated = if (hasFailure) PendingDiagnosticPolicy.markRecovered(pending, accountId, operation)
                else PendingDiagnosticPolicy.add(pending, recoveryMarker)
            pending == updated || store.write(updated)
        }
        if (!stored) {
            recentRecoveries.remove(recoveryKey, now)
            Log.w(TAG, "Could not save pending recovery diagnostic")
            return
        }
        PendingDiagnosticJobScheduler.schedule(context)
        flushPendingReports(context)
    }

    fun runDiagnostics(context: Context, onComplete: (JSONObject) -> Unit) {
        val app = context.applicationContext
        val session = SessionManager(app)
        val token = session.getAuthToken()?.takeIf(String::isNotBlank)
        val runId = java.util.UUID.randomUUID().toString()
        val version = BuildConfig.VERSION_NAME.take(32)
        executor.execute {
            val checks = org.json.JSONArray()
            val networkState = when (ConnectivityMonitor.getCurrentStatus()) {
                ConnectivityMonitor.Status.OFFLINE -> "offline"
                ConnectivityMonitor.Status.ONLINE_WIFI -> "wifi"
                ConnectivityMonitor.Status.ONLINE_CELLULAR -> "cellular"
                ConnectivityMonitor.Status.ONLINE_ETHERNET -> "ethernet"
                ConnectivityMonitor.Status.ONLINE_UNKNOWN -> "unknown"
            }
            checks.put(check("network", if (networkState == "offline") "fail" else "pass", 0, state = networkState,
                failureCode = if (networkState == "offline") "NETWORK_OFFLINE" else null))
            val socketConnected = SocketManager.isConnected()
            checks.put(check("sysu-go-socket", if (socketConnected) "pass" else "warning", 0,
                state = if (socketConnected) "connected" else "disconnected"))
            checks.put(check("session-token", if (token != null) "pass" else "fail", 0,
                state = if (token != null) "present" else "missing",
                failureCode = if (token == null) "SESSION_TOKEN_MISSING" else null))

            var apiStatus: Int? = null
            var apiDuration = 0L
            var apiFailure: String? = null
            if (token != null) {
                val startedAt = System.currentTimeMillis()
                var connection: HttpURLConnection? = null
                try {
                    val url = URL(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/health")
                    if (!isSafeDiagnosticsUrl(url, BuildConfig.DEBUG)) throw java.io.IOException("Unsafe diagnostics API URL")
                    connection = url.openConnection() as HttpURLConnection
                    connection.requestMethod = "GET"
                    connection.connectTimeout = 5000
                    connection.readTimeout = 5000
                    connection.setRequestProperty("Cache-Control", "no-cache")
                    apiStatus = connection.responseCode
                    if (apiStatus !in 200..299) apiFailure = "HEALTH_CHECK_FAILED"
                } catch (error: Exception) {
                    apiFailure = diagnosticsNetworkFailureCode(error, "HEALTH_CHECK_TIMEOUT")
                } finally {
                    connection?.disconnect()
                    apiDuration = (System.currentTimeMillis() - startedAt).coerceIn(0, 60000)
                }
            } else {
                apiFailure = "SESSION_UNAVAILABLE"
            }
            checks.put(check("sysu-go-api", if (apiFailure == null) "pass" else "fail", apiDuration,
                httpStatus = apiStatus, failureCode = apiFailure))

            var databaseStatus: Int? = null
            var databaseDuration = 0L
            var databaseFailure: String? = null
            if (token != null) {
                val startedAt = System.currentTimeMillis()
                var connection: HttpURLConnection? = null
                try {
                    val url = URL(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/health/ready")
                    if (!isSafeDiagnosticsUrl(url, BuildConfig.DEBUG)) throw java.io.IOException("Unsafe diagnostics API URL")
                    connection = url.openConnection() as HttpURLConnection
                    connection.requestMethod = "GET"
                    connection.connectTimeout = 5000
                    connection.readTimeout = 5000
                    connection.setRequestProperty("Cache-Control", "no-cache")
                    databaseStatus = connection.responseCode
                    if (databaseStatus !in 200..299) databaseFailure =
                        if (databaseStatus == 503) "DATABASE_UNAVAILABLE" else "HEALTH_CHECK_FAILED"
                } catch (error: Exception) {
                    databaseFailure = diagnosticsNetworkFailureCode(error, "HEALTH_CHECK_TIMEOUT")
                } finally {
                    connection?.disconnect()
                    databaseDuration = (System.currentTimeMillis() - startedAt).coerceIn(0, 60000)
                }
            } else {
                databaseFailure = "SESSION_UNAVAILABLE"
            }
            checks.put(check("sysu-go-database", if (databaseFailure == null) "pass" else "fail", databaseDuration,
                httpStatus = databaseStatus, failureCode = databaseFailure))

            val report = JSONObject().put("runId", runId).put("startedAt", System.currentTimeMillis())
                .put("appVersion", version).put("checks", checks)
            var persisted = false
            var requestId: String? = null
            if (token != null) {
                var connection: HttpURLConnection? = null
                try {
                    val path = "/api/system-errors/diagnostic-runs"
                    val body = JSONObject().put("runId", runId).put("appVersion", version).put("checks", checks).toString()
                    val accountId = session.getDriverId()?.takeIf(String::isNotBlank)
                    val requestKey = accountId?.let { IdempotencyKeyStore.begin(app, it, "POST", path, body.toByteArray(Charsets.UTF_8)) }
                    val url = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path)
                    if (!isSafeDiagnosticsUrl(url, BuildConfig.DEBUG)) throw java.io.IOException("Unsafe diagnostics API URL")
                    connection = url.openConnection() as HttpURLConnection
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 8000
                    connection.readTimeout = 8000
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("Authorization", "Bearer $token")
                    requestKey?.let { connection.setRequestProperty("Idempotency-Key", it.value) }
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    val responseCode = connection.responseCode
                    val responseBody = (if (responseCode in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                    if (requestKey != null) IdempotencyKeyStore.finish(app, requestKey, responseCode, responseBody,
                        connection.getHeaderField("Idempotency-Completed") == "true")
                    persisted = responseCode in 200..299
                    if (persisted) requestId = runId
                    else {
                        report.put("persistenceFailureCode", diagnosticsPersistenceFailureCode(responseCode))
                        connection.getHeaderField("X-Request-ID")
                            ?.takeIf { it.matches(Regex("^[A-Za-z0-9-]{8,80}$")) }
                            ?.let { report.put("persistenceRequestId", it) }
                    }
                } catch (error: Exception) {
                    val failureCode = diagnosticsNetworkFailureCode(error, "NETWORK_TIMEOUT")
                    Log.w(TAG, "Could not submit diagnostics run ($failureCode)")
                    report.put("persistenceFailureCode", failureCode)
                } finally {
                    connection?.disconnect()
                }
            }
            report.put("persisted", persisted).put("requestId", requestId ?: JSONObject.NULL)
            android.os.Handler(android.os.Looper.getMainLooper()).post { onComplete(report) }
        }
    }

    private fun check(name: String, status: String, durationMs: Long, httpStatus: Int? = null,
        failureCode: String? = null, state: String? = null): JSONObject = JSONObject()
        .put("name", name).put("status", status).put("durationMs", durationMs)
        .apply {
            if (httpStatus != null) put("httpStatus", httpStatus)
            if (failureCode != null) put("failureCode", failureCode)
            if (state != null) put("state", state)
        }

    fun flushPendingReports(context: Context, onComplete: (() -> Unit)? = null) {
        val app = context.applicationContext
        executor.execute {
            try { drainPendingReports(app) }
            finally { onComplete?.let { Handler(Looper.getMainLooper()).post(it) } }
        }
    }

    private fun queueOperationFailure(operation: String, errorName: String, details: JSONObject) {
        val context = appContext ?: return
        val accountId = SessionManager(context).getDriverId() ?: return
        val key = "$accountId:$operation:$errorName"
        val lastSent = recentReports[key]
        if (lastSent != null && System.currentTimeMillis() - lastSent < 60_000) return
        val report = PendingDiagnosticReport(accountId, operation, errorName,
            details.optString("clientEventId"), details.toString())
        val stored = synchronized(this) {
            val store = PendingDiagnosticStore(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE))
            val pending = store.read()
            val updated = PendingDiagnosticPolicy.add(pending, report)
            updated == pending || store.write(updated)
        }
        if (stored) {
            PendingDiagnosticJobScheduler.schedule(context)
            flushPendingReports(context)
        }
        else Log.w(TAG, "Could not save pending diagnostic report")
    }

    private fun drainPendingReports(context: Context) {
        val session = SessionManager(context)
        val accountId = session.getDriverId() ?: return
        val token = session.getAuthToken()?.takeIf(String::isNotBlank) ?: return
        val store = PendingDiagnosticStore(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE))
        val remainingDelay = (retryAfterElapsedMs[accountId] ?: 0L) - SystemClock.elapsedRealtime()
        if (remainingDelay > 0) {
            scheduleRetry(context, accountId, remainingDelay)
            return
        }
        while (true) {
            var report = synchronized(this) { PendingDiagnosticPolicy.forAccount(store.read(), accountId).firstOrNull() }
                ?: run { PendingDiagnosticJobScheduler.cancel(context); return }
            if (session.getDriverId() != accountId || session.getAuthToken() != token) return
            if (!report.submitted) {
                val status = submitFailureReport(context, token, report)
                if (status != null && status in 200..299) {
                    val submitted = synchronized(this) {
                        val pending = store.read()
                        val updated = PendingDiagnosticPolicy.markSubmitted(pending, report.eventId)
                        pending == updated || store.write(updated)
                    }
                    if (!submitted) {
                        Log.w(TAG, "Could not persist diagnostic submission state")
                        return
                    }
                    recentReports["$accountId:${report.operation}:${report.errorName}"] = System.currentTimeMillis()
                    report = synchronized(this) { store.read().firstOrNull { it.eventId == report.eventId } }
                        ?: continue
                } else if (PendingDiagnosticPolicy.retryDelayMs(status) == 0L) {
                    removePendingReport(store, report.eventId)
                    continue
                } else {
                    PendingDiagnosticPolicy.retryDelayMs(status)?.let {
                        scheduleRetry(context, accountId, it)
                        PendingDiagnosticJobScheduler.schedule(context, it)
                    }
                    return
                }
            }

            if (report.recovered) {
                val status = submitRecoverySignal(context, token, report.operation)
                if (status == null || status !in 200..299) {
                    val retryDelay = PendingDiagnosticPolicy.retryDelayMs(status)
                    if (retryDelay == 0L) {
                        if (!removePendingReport(store, report.eventId)) return
                        continue
                    }
                    retryDelay?.let {
                        scheduleRetry(context, accountId, it)
                        PendingDiagnosticJobScheduler.schedule(context, it)
                    }
                    return
                }
            }
            if (!removePendingReport(store, report.eventId)) return
        }
    }

    private fun submitFailureReport(context: Context, token: String, report: PendingDiagnosticReport): Int? {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/system-errors/report")
            if (!isSafeDiagnosticsUrl(url, BuildConfig.DEBUG)) throw java.io.IOException("Unsafe diagnostics API URL")
            connection = url.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            val body = JSONObject().put("eventCode", "mobile_operation_failure")
                .put("operation", report.operation).put("errorName", report.errorName)
                .put("details", JSONObject(report.detailsJson)).toString()
            val requestKey = IdempotencyKeyStore.begin(context, report.accountId, "POST",
                "/api/system-errors/report", body.toByteArray(Charsets.UTF_8))
            connection.setRequestProperty("Idempotency-Key", requestKey.value)
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val responseBody = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            IdempotencyKeyStore.finish(context, requestKey, status, responseBody,
                connection.getHeaderField("Idempotency-Completed") == "true")
            status
        } catch (error: Exception) {
            Log.w(TAG, "Could not submit pending diagnostic (${error.javaClass.simpleName})")
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun submitRecoverySignal(context: Context, token: String, operation: String): Int? {
        var connection: HttpURLConnection? = null
        return try {
            val path = "/api/system-errors/recover-operation"
            val url = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path)
            if (!isSafeDiagnosticsUrl(url, BuildConfig.DEBUG)) throw java.io.IOException("Unsafe diagnostics API URL")
            connection = url.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            val body = JSONObject().put("eventCode", "mobile_operation_failure").put("operation", operation).toString()
            val accountId = SessionManager(context).getDriverId() ?: return null
            val requestKey = IdempotencyKeyStore.begin(context, accountId, "POST",
                path, body.toByteArray(Charsets.UTF_8))
            connection.setRequestProperty("Idempotency-Key", requestKey.value)
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val responseBody = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            IdempotencyKeyStore.finish(context, requestKey, status, responseBody,
                connection.getHeaderField("Idempotency-Completed") == "true")
            status
        } catch (error: Exception) {
            Log.w(TAG, "Could not submit recovery signal (${error.javaClass.simpleName})")
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun removePendingReport(store: PendingDiagnosticStore, eventId: String): Boolean = synchronized(this) {
        val pending = store.read()
        store.write(pending.filterNot { it.eventId == eventId })
    }

    private fun scheduleRetry(context: Context, accountId: String, delayMs: Long) {
        synchronized(this) {
            val previousDueAt = retryAfterElapsedMs[accountId] ?: 0L
            val dueAt = maxOf(previousDueAt, SystemClock.elapsedRealtime() + delayMs)
            retryAfterElapsedMs[accountId] = dueAt
            if (retryCallbacks[accountId] != null && dueAt == previousDueAt) return
            retryCallbacks.remove(accountId)?.let(retryHandler::removeCallbacks)
            val retry = Runnable {
                synchronized(this) {
                    retryCallbacks.remove(accountId)
                    retryAfterElapsedMs.remove(accountId)
                }
                flushPendingReports(context)
            }
            retryCallbacks[accountId] = retry
            retryHandler.postDelayed(retry, (dueAt - SystemClock.elapsedRealtime()).coerceAtLeast(0L))
        }
    }


    private fun sendAuthenticated(eventCode: String, operation: String, errorName: String, details: JSONObject, onSuccess: () -> Unit) {
        val key = "$eventCode:$operation:$errorName"
        val now = System.currentTimeMillis()
        val prior = recentReports[key]
        if (prior != null && now - prior < 60_000) return
        val context = appContext ?: return
        val session = SessionManager(context)
        val token = session.getAuthToken()?.takeIf(String::isNotBlank) ?: return
        if (!reportsInFlight.add(key)) return
        executor.execute {
            var connection: HttpURLConnection? = null
            var succeeded = false
            try {
                val url = URL(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/system-errors/report")
                if (!isSafeDiagnosticsUrl(url, BuildConfig.DEBUG)) {
                    throw java.io.IOException("Unsafe diagnostics API URL")
                }
                connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.connectTimeout = 8000
                connection.readTimeout = 8000
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Authorization", "Bearer $token")
                val body = JSONObject().put("eventCode", eventCode).put("operation", operation)
                    .put("errorName", errorName).put("details", details).toString()
                val accountId = session.getDriverId()?.takeIf(String::isNotBlank)
                    ?: throw java.io.IOException("Please sign in again")
                val requestKey = IdempotencyKeyStore.begin(context, accountId, "POST",
                    "/api/system-errors/report", body.toByteArray(Charsets.UTF_8))
                connection.setRequestProperty("Idempotency-Key", requestKey.value)
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val status = connection.responseCode
                val responseBody = (if (status in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                IdempotencyKeyStore.finish(context, requestKey, status, responseBody,
                    connection.getHeaderField("Idempotency-Completed") == "true")
                succeeded = status in 200..299
                if (succeeded) {
                    recentReports[key] = System.currentTimeMillis()
                    onSuccess()
                }
            } catch (error: Exception) {
                Log.w(TAG, "Could not submit diagnostic report (${error.javaClass.simpleName})")
            } finally {
                connection?.disconnect()
                reportsInFlight.remove(key)
            }
        }
    }

    private fun safeErrorName(value: String): String =
        value.takeIf { it.matches(Regex("^[A-Za-z][A-Za-z0-9_.]{0,79}$")) } ?: "Error"

    private fun diagnosticDetails(operation: String, frame: String?): JSONObject = JSONObject()
        .put("clientEventId", java.util.UUID.randomUUID().toString())
        .put("clientTimestampMs", System.currentTimeMillis())
        .put("stage", operation.take(48))
        .put("appVersion", BuildConfig.VERSION_NAME.take(32))
        .put("platform", "android")
        .apply { if (!frame.isNullOrBlank()) put("sourceFrame", frame) }

    private fun safeFrame(frame: StackTraceElement?): String? {
        if (frame == null) return null
        val className = frame.className.substringAfterLast('.').take(64)
        val methodName = frame.methodName.take(48)
        if (!className.matches(Regex("[A-Za-z0-9_$]+")) || !methodName.matches(Regex("[A-Za-z0-9_$<>]+"))) return null
        val line = frame.lineNumber.takeIf { it > 0 }?.toString() ?: "unknown"
        return "$className.$methodName:$line"
    }
}
