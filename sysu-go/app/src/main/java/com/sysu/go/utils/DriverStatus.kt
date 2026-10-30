package com.sysu.go.utils

import android.content.Context
import android.util.Log
import com.sysu.go.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Persists driver lifecycle status through the authenticated MySQL API. */
object DriverStatus {
    private const val TAG = "DriverStatus"
    private val proxyScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var appContext: Context? = null

    object State {
        const val ONLINE = "online"
        const val OFFLINE = "offline"
        const val IN_TRANSIT = "in_transit"
        const val RETURNING_TO_BASE = "returning_to_base"
    }

    @Volatile
    private var lastOnlineState: String = State.ONLINE

    fun initialize(context: Context) {
        appContext = context.applicationContext
    }

    fun getLastOnlineState(): String = lastOnlineState

    /** Fire-and-forget; the backend persists to MySQL and broadcasts over Socket.IO. */
    fun write(uid: String?, status: String) {
        if (uid.isNullOrBlank()) {
            Log.w(TAG, "write skipped — driver id is null")
            return
        }
        if (status !in setOf(State.ONLINE, State.OFFLINE, State.IN_TRANSIT, State.RETURNING_TO_BASE)) {
            Log.w(TAG, "write skipped — invalid status")
            return
        }
        if (status != State.OFFLINE) lastOnlineState = status

        val context = appContext
        if (context == null) {
            Log.w(TAG, "write skipped — status client is not initialized")
            return
        }
        proxyScope.launch {
            try {
                val session = SessionManager(context)
                if (session.getDriverId() != uid) {
                    Log.w(TAG, "write skipped — driver session changed")
                    return@launch
                }
                val token = session.getAuthToken()?.takeIf(String::isNotBlank)
                if (token == null) {
                    Log.w(TAG, "status API skipped — no authenticated session")
                    return@launch
                }

                val path = "/api/driver/status"
                val payload = JSONObject().put("status", status).toString().toByteArray(Charsets.UTF_8)
                val requestKey = com.sysu.go.network.IdempotencyKeyStore.begin(context, uid, "POST", path, payload)

                val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path)
                    .openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 5_000
                    connection.readTimeout = 5_000
                    connection.doOutput = true
                    connection.setRequestProperty("Accept", "application/json")
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    connection.setRequestProperty("Authorization", "Bearer $token")
                    connection.setRequestProperty("Idempotency-Key", requestKey.value)
                    connection.outputStream.use { it.write(payload) }
                    val responseCode = connection.responseCode
                    val responseBody = (if (responseCode in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                    com.sysu.go.network.IdempotencyKeyStore.finish(context, requestKey, responseCode, responseBody,
                        connection.getHeaderField("Idempotency-Completed") == "true")
                    if (responseCode !in 200..299) {
                        Log.w(TAG, "status API rejected update (HTTP $responseCode)")
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (error: Exception) {
                Log.w(TAG, "status API unavailable: ${error.javaClass.simpleName}")
            }
        }
    }

    fun markOffline(uid: String?) = write(uid, State.OFFLINE)

    fun restoreOnline(uid: String?) = write(uid, lastOnlineState)

    fun seedLastOnlineState(state: String) {
        if (state != State.OFFLINE) lastOnlineState = state
    }
}
