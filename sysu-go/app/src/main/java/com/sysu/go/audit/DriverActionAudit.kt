package com.sysu.go.audit

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.sysu.go.network.SocketManager
import com.sysu.go.utils.SessionManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

data class DriverActionUploadStatus(val sessionId: String, val state: String)

object DriverActionAudit {
    private const val TAG = "DriverActionAudit"
    private const val CONSENT_PREFS = "driver_action_notice"
    private const val NOTICE_VERSION = 3
    private const val UPLOAD_STATUS_PREFS = "driver_action_upload_status"
    private val flushInFlight = AtomicBoolean(false)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val uploadStatusListeners = CopyOnWriteArraySet<(DriverActionUploadStatus) -> Unit>()
    @Volatile private var appContext: Context? = null
    @Volatile private var listenerRegistered = false
    private val onConnected: () -> Unit = { flush() }

    fun initialize(context: Context) {
        appContext = context.applicationContext
        try {
            SessionManager(context).getDriverId()?.let { uid ->
                DriverActionOutbox(context).use { it.finalizeUnresolvedReservations(uid) }
            }
            if (!listenerRegistered) synchronized(this) {
                if (!listenerRegistered) {
                    SocketManager.addOnConnectListener(onConnected)
                    listenerRegistered = true
                }
            }
            if (SocketManager.isConnected()) flush()
        } catch (error: Exception) {
            //  A local audit store failure must never block the driver's home screen.
            Log.w(TAG, "Activity audit initialization deferred: " + error.javaClass.simpleName)
        }
    }

    fun noticeAcknowledged(context: Context, uid: String): Boolean =
        context.getSharedPreferences(CONSENT_PREFS, Context.MODE_PRIVATE)
            .getInt("notice_version:$uid", 0) >= NOTICE_VERSION

    fun noticeAcknowledgedAt(context: Context, uid: String): Long =
        context.getSharedPreferences(CONSENT_PREFS, Context.MODE_PRIVATE)
            .getLong("notice_acknowledged_at:$uid", Long.MAX_VALUE)

    fun showNoticeIfNeeded(activity: Activity, onDecision: (Boolean) -> Unit = {}) {
        val uid = SessionManager(activity).getDriverId()
        if (uid.isNullOrBlank()) { onDecision(false); return }
        if (noticeAcknowledged(activity, uid)) {
            recordFreshLocation(activity, "app_open")
            onDecision(true)
            return
        }
        if (activity.isFinishing || activity.isDestroyed) return
        AlertDialog.Builder(activity)
            .setTitle("Driver trip activity notice")
            .setMessage(
                "SYSU records operational steps and location samples for your trip, including when the phone is offline. " +
                "Dispatch staff can review this history. Activity stays on this phone until the server confirms it was saved. After confirmation, the uploaded session is removed from this phone. " +
                    "Server history remains available until an administrator approves its removal in SYSU App. " +
                    "Location may be unavailable if permission or GPS is off."
            )
            .setCancelable(false)
            .setNegativeButton("Not now") { _, _ -> onDecision(false) }
            .setPositiveButton("Acknowledge") { _, _ ->
                activity.getSharedPreferences(CONSENT_PREFS, Context.MODE_PRIVATE).edit()
                    .putInt("notice_version:$uid", NOTICE_VERSION)
                    .putLong("notice_acknowledged_at:$uid", System.currentTimeMillis())
                    .apply()
                recordFreshLocation(activity, "app_open", outcome = "success")
                onDecision(true)
            }
            .show()
    }

    fun record(
        context: Context,
        eventType: String,
        subjectId: String? = null,
        outcome: String = "success",
        durationMs: Long? = null,
        metadata: JSONObject = JSONObject(),
        location: Location? = null,
        idempotencyKey: String? = null,
        occurredAtMs: Long = System.currentTimeMillis(),
    ) {
        val uid = SessionManager(context).getDriverId() ?: return
        if (!noticeAcknowledged(context, uid)) return
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val fix = location
        val state = when {
            fix != null -> "available"
            !granted -> "permission_denied"
            else -> "unavailable"
        }
        try {
            DriverActionOutbox(context).use { outbox ->
                outbox.enqueue(
                    ownerUid = uid,
                    eventType = eventType,
                    occurredAtMs = occurredAtMs,
                    lat = fix?.latitude,
                    lng = fix?.longitude,
                    accuracy = fix?.takeIf { it.hasAccuracy() && it.accuracy.isFinite() }?.accuracy,
                    locationState = state,
                    subjectId = subjectId?.takeIf { it.length <= 128 },
                    outcome = outcome.take(40),
                    durationMs = durationMs,
                    metadata = metadata,
                    idempotencyKey = idempotencyKey
                )
            }
            flush()
        } catch (error: Exception) {
            //  Audit capture must never change queue, shipment, or return-action outcomes.
            Log.w(TAG, "Could not queue activity event: " + error.javaClass.simpleName)
        }
    }

    fun recordPodCapture(
        context: Context,
        shipmentId: String,
        obdNumbers: Collection<String>,
        latitude: Double?,
        longitude: Double?,
        capturedAtMillis: Long,
    ) {
        val capturedLocation = latitude
            ?.takeIf { it.isFinite() && it in -90.0..90.0 }
            ?.let { lat ->
                longitude?.takeIf { it.isFinite() && it in -180.0..180.0 }?.let { lng ->
                    Location("pod_capture").apply {
                        this.latitude = lat
                        this.longitude = lng
                        time = capturedAtMillis
                    }
                }
            }
        obdNumbers.map { it.trim() }.filter(String::isNotEmpty).distinct().forEach { obdNumber ->
            record(
                context = context,
                eventType = "pod_captured",
                subjectId = shipmentId,
                location = capturedLocation,
                metadata = JSONObject().put("obdRef", obdNumber.take(128)),
                idempotencyKey = "pod:$shipmentId:$obdNumber:$capturedAtMillis",
                occurredAtMs = capturedAtMillis,
            )
        }
    }

    fun recordFreshLocation(
        context: Context,
        eventType: String,
        subjectId: String? = null,
        outcome: String = "success",
        durationMs: Long? = null,
        metadata: JSONObject = JSONObject(),
        idempotencyKey: String? = null,
        occurredAtMs: Long = System.currentTimeMillis(),
        onReserved: (DriverActionReservation) -> Unit = {},
    ): DriverActionReservation? {
        val uid = SessionManager(context).getDriverId() ?: return null
        if (!noticeAcknowledged(context, uid)) return null
        try {
            val reservation = DriverActionOutbox(context).use { outbox ->
                outbox.reserveEvent(
                    ownerUid = uid, eventType = eventType, occurredAtMs = occurredAtMs,
                    subjectId = subjectId?.takeIf { it.length <= 128 && !it.contains('/') && !it.contains('\\') },
                    outcome = outcome.take(40), durationMs = durationMs, metadata = metadata,
                    idempotencyKey = idempotencyKey,
                    closeSession = eventType == "session_completed"
                )
            } ?: return null
            onReserved(reservation)
            val locationResolved = AtomicBoolean(false)
            val resolve: (Location?, String) -> Unit = { fix, state ->
                if (locationResolved.compareAndSet(false, true)) {
                    mainHandler.removeCallbacksAndMessages(reservation.eventId)
                    try {
                        DriverActionOutbox(context).use { outbox ->
                            outbox.resolveReservation(
                                uid, reservation, fix?.latitude, fix?.longitude,
                                fix?.takeIf { it.hasAccuracy() && it.accuracy.isFinite() }?.accuracy,
                                state
                            )
                        }
                    } catch (error: Exception) {
                        Log.w(TAG, "Could not resolve activity location: " + error.javaClass.simpleName)
                        runCatching {
                            DriverActionOutbox(context).use { outbox ->
                                outbox.resolveReservation(uid, reservation, locationState = "unavailable")
                            }
                        }
                    }
                    flush()
                }
            }
            val unresolvedTimeout = Runnable { resolve(null, "unavailable") }
            mainHandler.postAtTime(unresolvedTimeout, reservation.eventId, android.os.SystemClock.uptimeMillis() + LOCATION_TIMEOUT_MS)
            if (!hasLocationPermission(context)) {
                resolve(null, "permission_denied")
                return reservation
            }
            try {
                LocationServices.getFusedLocationProviderClient(context).getCurrentLocation(
                    Priority.PRIORITY_BALANCED_POWER_ACCURACY, null
                ).addOnSuccessListener { fix ->
                    resolve(fix, if (fix == null) "unavailable" else "available")
                }.addOnFailureListener {
                    resolve(null, "unavailable")
                }
            } catch (_: SecurityException) {
                resolve(null, "permission_denied")
            } catch (_: Exception) {
                resolve(null, "unavailable")
            }
            return reservation
        } catch (error: Exception) {
            Log.w(TAG, "Could not reserve activity event: " + error.javaClass.simpleName)
            return null
        }
    }

    suspend fun completeSessionAndAwaitUpload(context: Context, timeoutMs: Long = 45_000L): Boolean {
        val uid = SessionManager(context).getDriverId() ?: return false
        return withTimeoutOrNull(timeoutMs.coerceAtLeast(1_000L)) {
            suspendCancellableCoroutine { continuation ->
                var targetSessionId: String? = null
                lateinit var listener: (DriverActionUploadStatus) -> Unit
                listener = { status ->
                    if (status.sessionId == targetSessionId && status.state == "uploaded" && continuation.isActive) {
                        removeUploadStatusListener(listener)
                        continuation.resume(true)
                    }
                }
                addUploadStatusListener(listener)
                continuation.invokeOnCancellation { removeUploadStatusListener(listener) }

                val reservation = recordFreshLocation(
                    context, "session_completed", outcome = "success", idempotencyKey = "session-completed",
                    onReserved = { reserved ->
                        uploadPreferences(context).edit()
                            .putString(latestSessionKey(uid), reserved.sessionId)
                            .putString(latestStateKey(uid), "pending")
                            .apply()
                        publishUploadStatus(context, uid, reserved.sessionId, "pending")
                    }
                )
                if (reservation == null) {
                    removeUploadStatusListener(listener)
                    continuation.resume(false)
                } else {
                    targetSessionId = reservation.sessionId
                    if (isSessionUploaded(context, uid, reservation.sessionId) && continuation.isActive) {
                        removeUploadStatusListener(listener)
                        continuation.resume(true)
                    }
                }
            }
        } ?: false
    }

    fun addUploadStatusListener(listener: (DriverActionUploadStatus) -> Unit) {
        uploadStatusListeners.add(listener)
    }

    fun removeUploadStatusListener(listener: (DriverActionUploadStatus) -> Unit) {
        uploadStatusListeners.remove(listener)
    }

    fun pendingUploadNotice(context: Context): DriverActionUploadStatus? {
        val uid = SessionManager(context).getDriverId() ?: return null
        val preferences = uploadPreferences(context)
        val sessionId = preferences.getString(latestSessionKey(uid), null) ?: return null
        val state = preferences.getString(latestStateKey(uid), null) ?: return null
        val status = DriverActionUploadStatus(sessionId, state)
        val noticeKey = "${status.sessionId}:${status.state}"
        return status.takeIf { preferences.getString("shown:$uid", null) != noticeKey }
    }

    fun claimUploadNotice(context: Context, status: DriverActionUploadStatus): Boolean {
        val uid = SessionManager(context).getDriverId() ?: return false
        val preferences = uploadPreferences(context)
        val noticeKey = "${status.sessionId}:${status.state}"
        if (preferences.getString("shown:$uid", null) == noticeKey) return false
        val editor = preferences.edit().putString("shown:$uid", noticeKey)
        if (status.state == "uploaded") {
            editor.remove(latestSessionKey(uid)).remove(latestStateKey(uid))
        }
        editor.apply()
        return true
    }

    fun latestUploadState(context: Context): String? {
        val uid = SessionManager(context).getDriverId() ?: return null
        val preferences = uploadPreferences(context)
        val sessionId = preferences.getString(latestSessionKey(uid), null) ?: return null
        return preferences.getString(latestStateKey(uid), null)
    }

    private fun isSessionUploaded(context: Context, uid: String, sessionId: String): Boolean {
        val preferences = uploadPreferences(context)
        return preferences.getString(latestSessionKey(uid), null) == sessionId &&
            preferences.getString(latestStateKey(uid), null) == "uploaded"
    }

    fun hasLocationPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun pendingCount(context: Context): Int {
        val uid = SessionManager(context).getDriverId() ?: return 0
        return try { DriverActionOutbox(context).use { it.pendingCount(uid) } } catch (_: Exception) { 0 }
    }

    private fun flush() {
        val context = appContext ?: return
        val uid = SessionManager(context).getDriverId() ?: return
        if (!noticeAcknowledged(context, uid) || !SocketManager.isConnected() || !flushInFlight.compareAndSet(false, true)) return
        try {
            val pending = DriverActionOutbox(context).use { it.pending(uid) }
            if (pending.isEmpty()) {
                flushInFlight.set(false)
                return
            }
            val sessionId = pending.first().sessionId
            val batch = pending.takeWhile { it.sessionId == sessionId }
            val ackHandled = AtomicBoolean(false)
            val timeout = Runnable {
                if (ackHandled.compareAndSet(false, true)) {
                    flushInFlight.set(false)
                    if (SocketManager.isConnected() && pendingCount(context) > 0) {
                        mainHandler.postDelayed({ flush() }, RETRY_DELAY_MS)
                    }
                }
            }
            mainHandler.postDelayed(timeout, ACK_TIMEOUT_MS)
            val payload = JSONObject().apply {
                put("sessionId", sessionId)
                put("events", JSONArray().apply { batch.forEach { put(it.toPayload()) } })
            }
            val emitted = SocketManager.emitDriverActionSync(payload) { ack ->
                if (!ackHandled.compareAndSet(false, true)) return@emitDriverActionSync
                mainHandler.removeCallbacks(timeout)
                var allAccepted = false
                try {
                    val accepted = ack.optJSONArray("acceptedEventIds") ?: JSONArray()
                    val terminal = ack.optJSONArray("terminalEventIds") ?: JSONArray()
                    val expected = batch.mapTo(HashSet()) { it.eventId }
                    val ids = (0 until accepted.length()).mapNotNull { accepted.optString(it).takeIf(expected::contains) }
                    val success = ack.optBoolean("success")
                    if (terminal.length() > 0) Log.w(TAG, "Server did not confirm some activity events; keeping them on this phone")
                    if (success && ids.isNotEmpty()) {
                        val completedSessions = DriverActionOutbox(context).use { it.acknowledge(uid, ids) }
                        completedSessions.forEach { sessionId ->
                            val preferences = uploadPreferences(context)
                            if (preferences.getString(latestSessionKey(uid), null) == sessionId) {
                                preferences.edit().putString(latestStateKey(uid), "uploaded").apply()
                                publishUploadStatus(context, uid, sessionId, "uploaded")
                            }
                        }
                        if (completedSessions.isNotEmpty()) {
                            Thread({
                                try {
                                    DriverActionOutbox(context).use { it.compactIfNeeded() }
                                } catch (_: Exception) {
                                    Log.w(TAG, "Local activity database compaction deferred")
                                }
                            }, "driver-action-db-compact").start()
                        }
                    }
                    allAccepted = success && ids.distinct().size == batch.size
                } catch (_: Exception) {
                    Log.w(TAG, "Activity sync acknowledgement could not be applied")
                } finally {
                    flushInFlight.set(false)
                    if (SocketManager.isConnected() && pendingCount(context) > 0) {
                        mainHandler.postDelayed({ flush() }, if (allAccepted) 250L else RETRY_DELAY_MS)
                    }
                }
            }
            if (!emitted) {
                mainHandler.removeCallbacks(timeout)
                ackHandled.set(true)
                flushInFlight.set(false)
            }
        } catch (_: Exception) {
            flushInFlight.set(false)
            Log.w(TAG, "Activity sync deferred")
        }
    }

    private const val ACK_TIMEOUT_MS = 15_000L
    private const val RETRY_DELAY_MS = 5_000L
    private const val LOCATION_TIMEOUT_MS = 10_000L

    private fun uploadPreferences(context: Context) =
        context.applicationContext.getSharedPreferences(UPLOAD_STATUS_PREFS, Context.MODE_PRIVATE)

    private fun latestSessionKey(uid: String) = "latest:$uid"
    private fun latestStateKey(uid: String) = "state:$uid"

    private fun publishUploadStatus(context: Context, uid: String, sessionId: String, state: String) {
        val preferences = uploadPreferences(context)
        if (preferences.getString(latestSessionKey(uid), null) != sessionId) return
        val status = DriverActionUploadStatus(sessionId, state)
        mainHandler.post { uploadStatusListeners.forEach { listener -> runCatching { listener(status) } } }
    }
}
