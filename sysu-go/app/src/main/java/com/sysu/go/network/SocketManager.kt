package com.sysu.go.network

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.sysu.go.BuildConfig
import com.sysu.go.utils.ConnectivityMonitor
import com.sysu.go.utils.SessionManager
import io.socket.client.IO
import io.socket.client.Ack
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

internal fun isSupportedRealtimeTopic(topic: String): Boolean =
    topic in setOf("profile", "driver", "queue", "queuePosition", "assignments", "location", "securityGuards", "truckCompanies")

object SocketManager : ConnectivityMonitor.ConnectivityChangeListener {
    private const val TAG = "SOCKET_EVENTS_DEFINITIVE"
    private const val SOCKET_URL_GO = BuildConfig.SOCKET_URL
    private const val PREFS_NAME = "driver_session"
    private const val KEY_DRIVER_NAME = "driver_name"
    private const val KEY_LAST_EMIT_LAT = "last_emit_lat"
    private const val KEY_LAST_EMIT_LNG = "last_emit_lng"
    private const val KEY_TRACKING_ACTIVE = "tracking_active"

    private var mSocketGo: Socket? = null
    private var prefs: SharedPreferences? = null
    private var appContext: Context? = null

    private val connectListeners = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()
    @Volatile
    private var listenersNotified = false
    /** Guards against multiple simultaneous socket creation attempts.
     *  getIdToken() is async — without this flag, rapid calls to connect()
     *  each see mSocketGo == null (not yet assigned) and create duplicate sockets. */
    @Volatile
    private var isConnecting = false
    private val sessionGate = SocketSessionGate()
    private data class RealtimeSubscription(
        val id: String,
        val topic: String,
        val params: Map<String, Any>,
        val onData: (Any?) -> Unit,
        val onError: (String) -> Unit,
    )
    private val realtimeSubscriptions = java.util.concurrent.ConcurrentHashMap<String, RealtimeSubscription>()

    private val eventListeners = java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.CopyOnWriteArrayList<(data: Any?) -> Unit>>()
    private val registeredEvents = java.util.concurrent.ConcurrentHashMap<Socket, MutableSet<String>>()

    fun addEventListener(event: String, listener: (data: Any?) -> Unit) {
        val listeners = eventListeners.getOrPut(event) {
            java.util.concurrent.CopyOnWriteArrayList()
        }
        listeners.add(listener)
        mSocketGo?.let { socket ->
            registerEventListenerOnSocket(event, listener, socket)
        }
    }

    fun removeEventListener(event: String) {
        eventListeners.remove(event)
        mSocketGo?.let { socket ->
            unregisterEventListenerOnSocket(event, null, socket)
        }
    }

    fun removeEventListener(event: String, listener: (data: Any?) -> Unit) {
        eventListeners[event]?.remove(listener)
        if (eventListeners[event]?.isEmpty() == true) {
            eventListeners.remove(event)
            mSocketGo?.let { socket ->
                unregisterEventListenerOnSocket(event, listener, socket)
            }
        }
    }

    private fun registerEventListenerOnSocket(event: String, listener: (data: Any?) -> Unit, socket: Socket?) {
        socket ?: return
        val registered = registeredEvents.getOrPut(socket) { mutableSetOf() }
        val wrappedListener: (Array<Any>) -> Unit = { args ->
            try { listener(args.firstOrNull()) } catch (e: Exception) {
                Log.e(TAG, "Event listener for '$event' threw: ${e.message}")
            }
        }
        socket.on(event, wrappedListener)
        registered.add(event)
        Log.d(TAG, "Registered socket listener for event='$event' on ${socket.id()}")
    }

    private fun unregisterEventListenerOnSocket(event: String, listener: ((data: Any?) -> Unit)?, socket: Socket?) {
        socket ?: return
        socket.off(event)
        registeredEvents[socket]?.remove(event)
    }

    private fun registerAllListenersOnSocket(socket: Socket) {
        val registered = registeredEvents.getOrPut(socket) { mutableSetOf() }
        eventListeners.forEach { (event, listeners) ->
            if (event !in registered) {
                listeners.forEach { listener ->
                    registerEventListenerOnSocket(event, listener, socket)
                }
            }
        }
    }

    fun init(context: Context) {
        appContext = context.applicationContext
        prefs = appContext!!.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        ConnectivityMonitor.start(context)
        ConnectivityMonitor.addListener(this)
        Log.d(TAG, "SocketManager initialized and registered as ConnectivityMonitor listener.")
    }

    fun addOnConnectListener(listener: () -> Unit) {
        connectListeners.add(listener)
        if (mSocketGo?.connected() == true) {
            try { listener() } catch (e: Exception) { Log.e(TAG, "Connect listener threw: ${e.message}") }
        }
    }

    fun removeOnConnectListener(listener: () -> Unit) {
        connectListeners.remove(listener)
    }

    fun subscribeRealtime(
        topic: String,
        params: Map<String, Any> = emptyMap(),
        onData: (Any?) -> Unit,
        onError: (String) -> Unit = {},
    ): () -> Unit {
        require(isSupportedRealtimeTopic(topic))
        val id = "android-${UUID.randomUUID()}"
        val subscription = RealtimeSubscription(id, topic, params.toMap(), onData, onError)
        realtimeSubscriptions[id] = subscription
        mSocketGo?.takeIf { it.connected() }?.let { socket -> emitRealtimeSubscribe(socket, subscription) }
        val closed = AtomicBoolean(false)
        return {
            if (closed.compareAndSet(false, true)) {
                realtimeSubscriptions.remove(id)
                mSocketGo?.takeIf { it.connected() }?.emit("realtime:unsubscribe", JSONObject().put("id", id))
            }
        }
    }

    private fun emitRealtimeSubscribe(socket: Socket, subscription: RealtimeSubscription) {
        socket.emit("realtime:subscribe", JSONObject()
            .put("id", subscription.id)
            .put("topic", subscription.topic)
            .put("params", JSONObject(subscription.params)))
    }

    private fun restoreRealtimeSubscriptions(socket: Socket) {
        realtimeSubscriptions.values.forEach { emitRealtimeSubscribe(socket, it) }
    }

    private fun dispatchRealtimeState(value: Any?) {
        val payload = when (value) {
            is JSONObject -> value
            is Map<*, *> -> JSONObject(value)
            else -> return
        }
        val id = payload.optString("id")
        val subscription = realtimeSubscriptions[id] ?: return
        if (subscription.topic != payload.optString("topic")) return
        val data = normalizeRealtimeValue(payload.opt("data"))
        Handler(Looper.getMainLooper()).post {
            if (realtimeSubscriptions[id] === subscription) subscription.onData(data)
        }
    }

    private fun dispatchRealtimeError(value: Any?) {
        val payload = when (value) {
            is JSONObject -> value
            is Map<*, *> -> JSONObject(value)
            else -> return
        }
        val id = payload.optString("id")
        val subscription = realtimeSubscriptions[id] ?: return
        val message = payload.optString("message", "Realtime data unavailable")
        Handler(Looper.getMainLooper()).post {
            if (realtimeSubscriptions[id] === subscription) subscription.onError(message)
        }
    }

    private fun normalizeRealtimeValue(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { key -> normalizeRealtimeValue(value.opt(key)) }
        is org.json.JSONArray -> (0 until value.length()).map { normalizeRealtimeValue(value.opt(it)) }
        else -> value
    }

    private fun notifyConnectListeners() {
        listenersNotified = true
        connectListeners.forEach { listener ->
            try { listener() } catch (e: Exception) { Log.e(TAG, "Connect listener threw: ${e.message}") }
        }
    }

    fun connect() {
        Log.i(TAG, "[CONNECT] >>> connect() called — resetting listenersNotified=false")
        listenersNotified = false
        if (mSocketGo?.connected() == true) {
            Log.i(TAG, "[CONNECT] >>> connect(): Already connected, skipping")
            return
        }
        if (isConnecting) {
            Log.i(TAG, "[CONNECT] >>> connect(): Already connecting (getIdToken in progress), skipping duplicate")
            return
        }
        isConnecting = true
        connectTo(SOCKET_URL_GO) { socket -> mSocketGo = socket }
    }

    fun connect(context: Context) {
        init(context)
        connect()
    }

    private fun connectTo(url: String, onSocket: (Socket) -> Unit) {
        val context = appContext
        if (context == null) {
            Log.w(TAG, ">>> connectTo($url): no valid backend session - cannot connect")
            isConnecting = false
            return
        }
        val session = SessionManager(context)
        val uid = session.getDriverId()
        val token = session.getAuthToken()
        if (!session.hasActiveSession() || uid.isNullOrBlank() || token.isNullOrBlank()) {
            Log.w(TAG, ">>> connectTo($url): no valid backend session - cannot connect")
            isConnecting = false
            return
        }
        val sessionToken = sessionGate.begin(uid)
        if (!sessionGate.isCurrent(sessionToken, SessionManager(context).getDriverId())) {
            isConnecting = false
            return
        }
        Log.i(TAG, ">>> connectTo($url): connecting backend user=$uid")
        try {
                val opts = IO.Options().apply {
                    reconnection = true
                    reconnectionAttempts = Int.MAX_VALUE  // Unlimited built-in retries (no permanent give-up)
                    reconnectionDelay = 2000
                    reconnectionDelayMax = 5000
                    auth = mapOf("token" to token)
                }
                val socket = IO.socket(url, opts)
                Log.i(TAG, ">>> connectTo($url): Socket.IO created. opts.reconnection=true, attempts=unlimited, delay=2000ms")

                socket.on(Socket.EVENT_CONNECT) {
                    Log.i(TAG, ">>> EVENT_CONNECT! $url → socket.id=${socket.id()}")
                    com.sysu.go.diagnostics.SystemErrorReporter.reportOperationSuccess("realtime-connection")
                    isConnecting = false  // Socket fully connected — allow future reconnects
                    registerAllListenersOnSocket(socket)
                    val registered = registeredEvents.getOrPut(socket) { mutableSetOf() }
                    if ("realtime:state" !in registered) {
                        socket.on("realtime:state") { args -> dispatchRealtimeState(args.firstOrNull()) }
                        registered.add("realtime:state")
                    }
                    if ("realtime:error" !in registered) {
                        socket.on("realtime:error") { args -> dispatchRealtimeError(args.firstOrNull()) }
                        registered.add("realtime:error")
                    }
                    restoreRealtimeSubscriptions(socket)
                    val isTracking = isTrackingActive()
                    emitStatusUpdateOnSocket(socket, "online", getDriverName(), includeLocationFromPrefs = isTracking)
                    emitStatusChangeOnSocket(socket, getDriverName())
                    if (isTracking) {
                        startHeartbeat()
                    }
                    notifyConnectListeners()
                    Log.i(TAG, ">>> update_status ONLINE emitted for $url (trackingActive=$isTracking)")
                }

                socket.on(Socket.EVENT_DISCONNECT) {
                    Log.w(TAG, ">>> EVENT_DISCONNECT! $url → socket.id=${socket.id()}")
                    isConnecting = false  // Allow reconnect attempts after disconnect
                    stopHeartbeat()
                    //  The server applies a heartbeat grace period; a transient background
                    //  network pause must not be reported as an intentional offline action.
                }

                socket.on(Socket.EVENT_CONNECT_ERROR) { args ->
                    Log.e(TAG, ">>> EVENT_CONNECT_ERROR! $url → ${args.joinToString()}")
                    com.sysu.go.diagnostics.SystemErrorReporter.reportOperationFailure(
                        "realtime-connection", java.io.IOException("Socket.IO connection failed")
                    )
                    com.sysu.go.diagnostics.UserErrorNotifier.showCurrent(
                        "realtime-connection",
                        "Live connection lost. SYSU Go will reconnect automatically; check your internet connection.",
                    )
                    isConnecting = false  // Allow retry on connection error
                }

                //  Safety net: fired when Socket.IO server actively disconnects us (e.g. expired token).
                //  In that case, the built-in reconnect retries with the SAME stale token and keeps failing.
                //  We catch "reconnect_failed" OR "disconnect" reason="io server disconnect" to force a full
                //  fresh connect() cycle (which calls refresh the authenticated MySQL session).
                socket.on("reconnect_failed") { _ ->
                    Log.w(TAG, ">>> RECONNECT_FAILED on $url — all built-in retries exhausted. Scheduling manual reconnect in 10s.")
                    mSocketGo = null
                    isConnecting = false
                    Handler(Looper.getMainLooper()).postDelayed({
                        Log.i(TAG, ">>> Manual reconnect triggered after reconnect_failed on $url")
                        connect()
                    }, 10_000L)
                }

                socket.on("update_admin_map") { args ->
                    if (args.isNotEmpty()) {
                        Log.d(TAG, "[$url] update_admin_map: ${args[0]}")
                    }
                }

                Log.i(TAG, ">>> Calling socket.connect() for $url")
                onSocket(socket)
                socket.connect()
                Log.i(TAG, ">>> socket.connect() initiated for $url")
            } catch (e: URISyntaxException) {
                Log.e(TAG, ">>> connectTo($url): URISyntaxException: ${e.message}")
                isConnecting = false
            } catch (e: Exception) {
                Log.e(TAG, ">>> connectTo($url): Exception: ${e.message}")
                isConnecting = false
            }
    }

    fun getDriverName(): String {
        return prefs?.getString(KEY_DRIVER_NAME, null)
            ?: appContext?.let(::SessionManager)?.getDriverName()
            ?: "Driver"
    }

    fun isTrackingActive(): Boolean {
        return prefs?.getBoolean(KEY_TRACKING_ACTIVE, false) ?: false
    }

    fun emitStatusUpdate(status: String, name: String, lat: Double? = null, lng: Double? = null, includeLocationFromPrefs: Boolean = true) {
        Log.d(TAG, "[EMIT] emitStatusUpdate called: status=$status, name=$name, lat=$lat, lng=$lng")
        emitStatusUpdateOnSocket(mSocketGo, status, name, lat, lng, includeLocationFromPrefs)
    }

    private fun emitStatusUpdateOnSocket(socket: Socket?, status: String, name: String, explicitLat: Double? = null, explicitLng: Double? = null, includeLocationFromPrefs: Boolean = true) {
        val uid = appContext?.let(::SessionManager)?.getDriverId() ?: return
        if (socket?.connected() != true) {
            Log.w(TAG, "[SOCKET] emitStatusUpdateOnSocket skipped - socket not connected")
            return
        }
        try {
            val json = JSONObject().apply {
                put("driverId", uid)
                put("status", status)
                put("name", name)
                if (status == "online" && includeLocationFromPrefs && isTrackingActive()) {
                    val srcLat = explicitLat ?: prefs?.getFloat(KEY_LAST_EMIT_LAT, 0f)?.toDouble()?.takeIf { it != 0.0 }
                    val srcLng = explicitLng ?: prefs?.getFloat(KEY_LAST_EMIT_LNG, 0f)?.toDouble()?.takeIf { it != 0.0 }
                    if (srcLat != null && srcLng != null) {
                        put("lat", srcLat)
                        put("lng", srcLng)
                    }
                }
            }
            socket.emit("update_status", json)
            Log.d(TAG, "[EMIT] update_status emitted: status=$status, name=$name, lat=${
                json.optDouble("lat", 0.0)}, lng=${json.optDouble("lng", 0.0)}")
        } catch (e: Exception) {
            Log.e(TAG, "[ERROR] Failed to emit update_status: ${e.message}")
        }
    }

    fun emitDriverMoving(lat: Double, lng: Double, sapDocId: String?, status: String = "online",
                         timestamp: Long? = null, accuracyMeters: Float? = null,
                         fixAgeMs: Long? = null,
                         onAcknowledged: (JSONObject) -> Unit): Boolean {
        val uid = appContext?.let(::SessionManager)?.getDriverId() ?: return false

        val json = JSONObject().apply {
            put("driverId", uid)
            put("sapDocId", sapDocId)
            put("lat", lat)
            put("lng", lng)
            put("status", status)
            put("name", getDriverName())
            timestamp?.let { put("timestamp", it) }
            accuracyMeters?.let { put("accuracyMeters", it) }
            fixAgeMs?.let { put("fixAgeMs", it) }
        }

        return emitDriverMovingOnSocket(mSocketGo, json, onAcknowledged)
    }

    private fun emitDriverMovingOnSocket(
        socket: Socket?,
        json: JSONObject,
        onAcknowledged: (JSONObject) -> Unit,
    ): Boolean {
        if (socket?.connected() != true) {
            Log.w(TAG, "[SOCKET] emitDriverMovingOnSocket skipped - socket not connected")
            return false
        }
        try {
            socket.emit("driver_moving", json, Ack { args ->
                val value = args.firstOrNull()
                val response = when (value) {
                    is JSONObject -> value
                    is Map<*, *> -> JSONObject(value)
                    else -> JSONObject()
                }
                onAcknowledged(response)
            })
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Location socket send failed")
            return false
        }
    }

    fun emitDriverStopped(lat: Double, lng: Double, sapDocId: String?) {
        val uid = appContext?.let(::SessionManager)?.getDriverId() ?: return
        val name = getDriverName()
        Log.d(TAG, "[EMIT] emitDriverStopped called: lat=$lat, lng=$lng, sapDocId=$sapDocId")

        val json = JSONObject().apply {
            put("driverId", uid)
            put("sapDocId", sapDocId)
            put("lat", lat)
            put("lng", lng)
            put("status", "stopped")
            put("name", name)
            put("stoppedAt", System.currentTimeMillis())
        }

        emitDriverStoppedOnSocket(mSocketGo, json)
        emitStatusUpdateOnSocket(mSocketGo, "stopped", name, lat, lng, includeLocationFromPrefs = true)
    }

    private fun emitDriverStoppedOnSocket(socket: Socket?, json: JSONObject) {
        if (socket?.connected() != true) {
            Log.w(TAG, "[SOCKET] emitDriverStoppedOnSocket skipped - socket not connected")
            return
        }
        try {
            socket.emit("driver_stopped", json)
            val name = json.optString("name", "?")
            Log.d(TAG, "[EMIT] driver_stopped emitted: lat=${json.optDouble("lat")}, lng=${json.optDouble("lng")}, name=$name")
        } catch (e: Exception) {
            Log.e(TAG, "[ERROR] Failed to emit driver_stopped: ${e.message}")
        }
    }

    fun emitCompletedStatus(driverId: String?, driverName: String) {
        if (driverId == null) return
        prefs?.edit()
            ?.remove(KEY_LAST_EMIT_LAT)
            ?.remove(KEY_LAST_EMIT_LNG)
            ?.putBoolean(KEY_TRACKING_ACTIVE, false)
            ?.apply()
        val json = JSONObject().apply {
            put("driverId", driverId)
            put("status", "completed")
            put("name", driverName)
        }
        mSocketGo?.let { socket ->
            if (socket.connected()) {
                try {
                    socket.emit("update_status", json)
                    Log.d(TAG, "Emitted completed_status for $driverName")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to emit completed_status: ${e.message}")
                }
            }
        }
    }

    fun emitOfflineStatus(driverId: String?, driverName: String) {
        if (driverId == null) {
            Log.w(TAG, "[EMIT] emitOfflineStatus called with null driverId - skipping")
            return
        }
        val uid = driverId
        val json = JSONObject().apply {
            put("driverId", uid)
            put("status", "offline")
            put("name", driverName)
        }
        Log.d(TAG, "[EMIT] emitOfflineStatus called: driverId=$driverId, driverName=$driverName")
        mSocketGo?.let { socket ->
            if (socket.connected()) {
                try {
                    socket.emit("update_status", json)
                    Log.d(TAG, "[EMIT] offline_status emitted: $driverName")
                } catch (e: Exception) {
                    Log.e(TAG, "[ERROR] Failed to emit offline_status: ${e.message}")
                }
            } else {
                Log.w(TAG, "[SOCKET] emitOfflineStatus skipped - socket not connected")
            }
        }
    }

    fun emitPodUpdated(shipmentDocId: String) {
        if (mSocketGo?.connected() != true) {
            Log.w(TAG, "emitPodUpdated: sysu-go socket not connected, skipping emit")
            return
        }
        try {
            val json = JSONObject().apply {
                put("shipmentDocId", shipmentDocId)
                put("source", "driver_app")
            }
            mSocketGo?.emit("pod_updated", json)
            Log.d(TAG, "Emitted pod_updated for shipment=$shipmentDocId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to emit pod_updated: ${e.message}")
        }
    }

    fun emitDriverActionSync(payload: JSONObject, callback: (JSONObject) -> Unit): Boolean {
        val socket = mSocketGo
        if (socket?.connected() != true) return false
        return try {
            socket.emit("driver_actions:sync", payload, Ack { args ->
                val value = args.firstOrNull()
                val response = when (value) {
                    is JSONObject -> value
                    is Map<*, *> -> JSONObject(value)
                    else -> JSONObject()
                }
                callback(response)
            })
            true
        } catch (e: Exception) {
            Log.w(TAG, "Driver action sync deferred")
            false
        }
    }

    fun emit(event: String, data: Any) {
        if (mSocketGo?.connected() != true) {
            Log.w(TAG, "emit($event): socket not connected, skipping emit")
            return
        }
        try {
            mSocketGo?.emit(event, data)
            Log.d(TAG, "Emitted $event: $data")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to emit $event: ${e.message}")
        }
    }

    fun emitGo(event: String, json: JSONObject) {
        emit(event, json)
    }

    fun emitStatusChange(uid: String, status: String): Boolean {
        if (mSocketGo?.connected() != true) {
            Log.w(TAG, "emitStatusChange($status): go-socket not connected, skipping emit")
            return false
        }
        return try {
            val json = JSONObject().apply {
                put("driverId", uid)
                put("status", status)
                put("name", getDriverName())
                put("timestamp", System.currentTimeMillis())
            }
            mSocketGo?.emit("driver_status_change", json)
            Log.d(TAG, "Emitted driver_status_change: $status for $uid")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to emit driver_status_change: ${e.message}")
            false
        }
    }

    private fun emitStatusChangeOnSocket(socket: Socket?, name: String) {
        val uid = appContext?.let(::SessionManager)?.getDriverId() ?: return
        if (socket?.connected() != true) {
            Log.w(TAG, "[SOCKET] emitStatusChangeOnSocket skipped - socket not connected")
            return
        }
        try {
            val currentStatus = com.sysu.go.utils.DriverStatus.getLastOnlineState()
            val json = JSONObject().apply {
                put("driverId", uid)
                put("status", currentStatus)
                put("name", name)
                put("timestamp", System.currentTimeMillis())
            }
            socket.emit("driver_status_change", json)
            Log.d(TAG, "[EMIT] driver_status_change emitted on reconnect: status=$currentStatus for $uid")
        } catch (e: Exception) {
            Log.e(TAG, "[ERROR] Failed to emit driver_status_change on reconnect: ${e.message}")
        }
    }

    fun emitDriverFull(isFull: Boolean) {
        val uid = appContext?.let(::SessionManager)?.getDriverId() ?: return
        val json = JSONObject().apply {
            put("driverId", uid)
            put("isFull", isFull)
        }
        mSocketGo?.let { socket ->
            if (socket.connected()) {
                try {
                    socket.emit("driver_is_full", json)
                    Log.d(TAG, "Emitted driver_is_full: isFull=$isFull for driver=$uid")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to emit driver_is_full: ${e.message}")
                }
            }
        }
    }

    fun disconnect() {
        Log.i(TAG, "[SOCKET] Disconnecting from server...")
        ConnectivityMonitor.removeListener(this)
        realtimeSubscriptions.clear()

        //  Stop heartbeat
        stopHeartbeat()

        sessionGate.invalidate()
        mSocketGo?.let { socket ->
            socket.disconnect()
            Log.d(TAG, "[SOCKET] Disconnected from socket")
        }
        mSocketGo = null
        isConnecting = false
        listenersNotified = false
        registeredEvents.clear()

        Log.i(TAG, "[SOCKET] Disconnected successfully")
    }

    private fun forceDisconnectSockets() {
        Log.w(TAG, "[DISCONNECT] Forcing Socket.IO disconnect due to network loss.")
        mSocketGo?.let { socket ->
            socket.disconnect()
            Log.d(TAG, "[DISCONNECT] Forced disconnect for socket: ${socket.id()}")
        }
        sessionGate.invalidate()
        mSocketGo = null
        listenersNotified = false
        registeredEvents.clear()
    }

    override fun onConnectivityChanged(status: ConnectivityMonitor.Status) {
        when (status) {
            ConnectivityMonitor.Status.OFFLINE -> {
                Log.w(TAG, "[CONNECTIVITY] >>> NETWORK OFFLINE event received")
                stopHeartbeat()
                forceDisconnectSockets()
            }
            else -> {
                Log.i(TAG, "[CONNECTIVITY] >>> NETWORK ONLINE (${status.name}) event received — initiating reconnect")
                connect()
            }
        }
    }

    fun isConnected(): Boolean = mSocketGo?.connected() == true

    private const val HEARTBEAT_INTERVAL_MS = 15_000L
    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private var heartbeatRunning = false

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            val sock = mSocketGo
            if (sock?.connected() != true || !isTrackingActive()) {
                Log.d(TAG, "[HEARTBEAT] skipping — socket not connected or tracking inactive")
            } else {
                try {
                    sock.emit("heartbeat")
                    Log.d(TAG, "[HEARTBEAT] ping sent")
                } catch (e: Exception) {
                    Log.w(TAG, "[HEARTBEAT] emit failed: ${e.message}")
                }
            }
            heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    private fun startHeartbeat() {
        if (heartbeatRunning) return
        heartbeatRunning = true
        heartbeatHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS)
        Log.d(TAG, "[HEARTBEAT] ✓ started (every ${HEARTBEAT_INTERVAL_MS / 1000}s)")
    }

    private fun stopHeartbeat() {
        if (!heartbeatRunning) return
        heartbeatRunning = false
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
        Log.d(TAG, "[HEARTBEAT] stopped")
    }
}
