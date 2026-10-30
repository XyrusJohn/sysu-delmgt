package com.sysu.go.services

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.SystemClock
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.sysu.go.model.LocationSendPolicy
import com.sysu.go.R
import com.sysu.go.activities.MainActivity
import com.sysu.go.network.SocketManager
import com.sysu.go.utils.SessionManager
import com.sysu.go.utils.TrackingStateMonitor
import kotlinx.coroutines.*

private const val TAG = "LOCATION_TRACKING_DEFINITIVE"
private const val CHANNEL_ID = "sysu_tracking_channel"
private const val CHANNEL_NAME = "Live Trip Tracking"
private const val NOTIFICATION_ID = 1

//  Static shared state — updated on every valid GPS fix.
//  MyTripActivity reads these to stamp POD photos with location.
private var lastKnownLat: Double? = null
private var lastKnownLng: Double? = null

/**
 * Returns the most recently cached GPS location, or null if LocationServices
 * has not yet received a fix (e.g., app freshly opened without transit).
 */
fun getLastKnownLocationPair(): Pair<Double, Double>? {
    val lat = lastKnownLat ?: return null
    val lng = lastKnownLng ?: return null
    return lat to lng
}

class LocationServices : Service() {

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private val serviceScope = CoroutineScope(Dispatchers.IO)
    private lateinit var sessionManager: SessionManager

    //  SharedPreferences — same "driver_session" file that SessionManager (TransitActivity) writes to
    private val prefs by lazy {
        getSharedPreferences("driver_session", Context.MODE_PRIVATE)
    }

    private val sendPolicy = LocationSendPolicy()
    private var lastEmitLocation: android.location.Location? = null
    private var latestFix: android.location.Location? = null
    private var locationUpdatesStarted = false
    private var destroyed = false
    private var activeTrackingKey: String? = null
    private var pendingLocationToken: Long? = null
    private var nextLocationToken = 0L
    private var lastGpsDiagnosticAtMs = 0L
    private var fixRequest: com.google.android.gms.tasks.CancellationTokenSource? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val onConnected: () -> Unit = {
        mainHandler.post {
            if (!destroyed && sessionManager.isTrackingActive()) {
                sendPolicy.reset()
                latestFix?.let { handleLocation(it) }
                requestImmediateFix()
            }
        }
    }

    //  Battery critical receiver — emit offline when battery is critically low (<5%)
    //  This is a "truly unreachable" signal for dispatch safety
    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_BATTERY_LOW) {
                Log.w(TAG, "[BATTERY] Battery LOW — emitting offline, disabling tracking")
                sessionManager.setTrackingActive(false)
                TrackingStateMonitor.setState(TrackingStateMonitor.State.OFFLINE)
                SocketManager.emitOfflineStatus(
                    sessionManager.getDriverId(),
                    SocketManager.getDriverName()
                )
                Log.w(TAG, "[EMIT] Battery LOW - emitted offline status")
            }
        }
    }

    //  For dynamic notification updates
    private var lastUpdateTime: Long = 0
    private var lastAccuracy: Float? = null
    private var lastAuditPoint: android.location.Location? = null
    private var lastAuditPointElapsedMs: Long = 0L
    private val notificationManager by lazy { getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager }

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(this)
        sessionManager = SessionManager(this)
        Log.d(TAG, "LocationServices created - tracking_active=${sessionManager.isTrackingActive()}")

        //  Register battery critical listener — fires when battery drops to low threshold
        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_LOW))
        Log.d(TAG, "Battery critical listener registered")

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                locationResult.lastLocation?.let { handleLocation(it) }
            }
        }
        SocketManager.addOnConnectListener(onConnected)
    }

    private fun handleLocation(location: android.location.Location) {
        if (destroyed || !sessionManager.isTrackingActive()) return
        val uid = sessionManager.getDriverId() ?: run {
            logGpsDiagnostic("location upload paused: driver session is missing")
            return
        }
        if (sessionManager.getDriverId() != null && sessionManager.getDriverId() != uid) return
        val sapDocId = sessionManager.getActiveSapDocId() ?: sessionManager.getCurrentSapDocId() ?: run {
            logGpsDiagnostic("location upload paused: active shipment is missing")
            return
        }
        val nowMs = SystemClock.elapsedRealtime()
        val fix = LocationSendPolicy.Fix(location.latitude, location.longitude,
            if (location.hasAccuracy()) location.accuracy else Float.POSITIVE_INFINITY,
            location.elapsedRealtimeNanos / 1_000_000)
        if (!sendPolicy.eligible(fix, nowMs)) {
            lastAccuracy = location.accuracy
            logGpsDiagnostic("GPS fix not uploadable: accuracy=${fix.accuracy.toInt()}m age=${nowMs - fix.elapsedMs}ms")
            updateNotification()
            return
        }
        //  Persist a sparse route sample independently of Socket.IO availability.
        recordSparseAuditPoint(location, nowMs)
        val key = "$uid:$sapDocId"
        if (activeTrackingKey != key) {
            activeTrackingKey = key
            pendingLocationToken = null
            lastEmitLocation = null
        }
        latestFix = android.location.Location(location)
        lastKnownLat = fix.lat
        lastKnownLng = fix.lng
        lastUpdateTime = nowMs
        lastAccuracy = fix.accuracy
        val distance = lastEmitLocation?.distanceTo(location) ?: 0f
        if (pendingLocationToken != null) {
            updateNotification()
            return
        }
        if (!sendPolicy.shouldSend(fix, nowMs, distance, key, SocketManager.isConnected())) {
            updateNotification()
            return
        }
        val status = if (distance < 10f && sendPolicy.isStopped(nowMs)) "stopped" else "online"
        val ageMs = nowMs - fix.elapsedMs
        val token = ++nextLocationToken
        pendingLocationToken = token
        val queued = SocketManager.emitDriverMoving(fix.lat, fix.lng, sapDocId, status,
            System.currentTimeMillis() - ageMs, fix.accuracy, ageMs) { response ->
            mainHandler.post {
                if (pendingLocationToken != token) return@post
                pendingLocationToken = null
                if (response.optBoolean("ok")) {
                    val acknowledgedAt = SystemClock.elapsedRealtime()
                    sendPolicy.sent(fix, acknowledgedAt, distance)
                    lastEmitLocation = android.location.Location(location)
                    prefs.edit().putFloat("last_emit_lat", fix.lat.toFloat()).putFloat("last_emit_lng", fix.lng.toFloat()).apply()
                    TrackingStateMonitor.setState(if (status == "stopped") TrackingStateMonitor.State.STOPPED else TrackingStateMonitor.State.ONLINE)
                    val trackingRecipients = response.optInt("trackingRecipients", -1)
                    if (trackingRecipients == 0) {
                        Log.w(TAG, "GPS update persisted, but no SYSU App tracking socket is connected")
                    } else {
                        Log.i(TAG, "GPS update persisted and broadcast to SYSU Go tracking room (recipients=$trackingRecipients)")
                    }
                } else {
                    val code = response.optString("code", "SERVER_REJECTED")
                    Log.w(TAG, "GPS update not accepted by SYSU Go: $code; will retry on a later fix")
                }
                updateNotification()
            }
        }
        if (!queued) {
            pendingLocationToken = null
            logGpsDiagnostic("location upload skipped: SYSU Go socket is disconnected")
            updateNotification()
            return
        }
        Log.d(TAG, "GPS update queued for SYSU Go acknowledgment")
        mainHandler.postDelayed({
            if (pendingLocationToken == token) {
                pendingLocationToken = null
                Log.w(TAG, "SYSU Go did not acknowledge the GPS update; will retry on a later fix")
            }
        }, 10_000L)
    }

    private fun logGpsDiagnostic(message: String) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastGpsDiagnosticAtMs < 15_000L) return
        lastGpsDiagnosticAtMs = now
        Log.w(TAG, message)
    }

    private fun recordSparseAuditPoint(location: android.location.Location, elapsedMs: Long) {
        if (!com.sysu.go.audit.DriverActionAudit.hasLocationPermission(this)) return
        val previous = lastAuditPoint
        val movedMeters = previous?.distanceTo(location) ?: Float.POSITIVE_INFINITY
        if (previous != null && elapsedMs - lastAuditPointElapsedMs < 5_000L) return
        if (previous != null && elapsedMs - lastAuditPointElapsedMs < 30_000L && movedMeters < 100f) return
        try {
            com.sysu.go.audit.DriverActionAudit.record(
                context = this,
                eventType = "route_point",
                location = location,
                occurredAtMs = location.time.takeIf { it > 0L } ?: System.currentTimeMillis()
            )
            lastAuditPoint = android.location.Location(location)
            lastAuditPointElapsedMs = elapsedMs
        } catch (_: Exception) {
            //  Audit sampling stays best-effort and cannot interrupt location delivery.
        }
    }

    @SuppressLint("MissingPermission")
    private fun requestImmediateFix() {
        if (destroyed || !sessionManager.isTrackingActive()) return
        fixRequest?.cancel()
        val request = com.google.android.gms.tasks.CancellationTokenSource()
        fixRequest = request
        try {
            fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, request.token)
                .addOnSuccessListener { location -> if (!destroyed && fixRequest === request && location != null) handleLocation(location) }
                .addOnFailureListener { Log.w(TAG, "Fresh GPS request unavailable") }
        } catch (_: SecurityException) {
            Log.w(TAG, "Location permission unavailable")
        }
    }

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand called - tracking_active=${sessionManager.isTrackingActive()}")
        createNotificationChannel()
        //  Initialize notification update timers
        lastUpdateTime = SystemClock.elapsedRealtime()
        lastAccuracy = null
        startForeground(NOTIFICATION_ID, buildNotification("Initializing GPS..."))

        //  Prevent double-connect: if SocketManager already initialized and
        //  connected from this service's context, skip reconnecting.
        if (SocketManager.isConnected()) {
            Log.i(TAG, "LocationServices: SocketManager already connected, skipping redundant connect")
        } else {
            Log.i(TAG, "LocationServices: Connecting Socket.IO for background keep-alive")
            SocketManager.connect(this)
        }

        //  STRICT GEOFENCE: only start location updates when TransitActivity has
        //  explicitly set tracking_active=true (i.e. driver clicked "Start Trip").
        //  The double-guard in handleLocation() guarantees no emit can leak past
        //  a transition that flipped tracking_active=false (returning_to_base,
        //  completed) before the system de-registers the callback.
        //  When the app starts from MainActivity (no trip active), tracking is OFF
        //  the service runs as a foreground service (notification stays alive,
        //  socket stays online) but does NOT emit driver_moving.
        val isTracking = sessionManager.isTrackingActive()
        if (isTracking) {
            Log.i(TAG, "LocationServices: tracking_active=TRUE — starting GPS location updates")
            try {
                startLocationUpdates()
            } catch (e: SecurityException) {
                Log.e(TAG, "Location permission not granted — cannot start GPS tracking", e)
            }
        } else {
            Log.i(TAG, "LocationServices: tracking_active=FALSE — foreground service only, no GPS tracking")
        }

        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        if (locationUpdatesStarted) return
        locationUpdatesStarted = true
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
            .setMinUpdateIntervalMillis(5000).build()
        fusedLocationClient.requestLocationUpdates(request, locationCallback, mainLooper)
            .addOnSuccessListener { locationUpdatesStarted = true }
            .addOnFailureListener { locationUpdatesStarted = false; Log.w(TAG, "GPS subscription unavailable") }
        requestImmediateFix()
    }

    private fun buildNotification(contentText: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SYSU-GO Tracking Active")
            .setContentText(contentText)
            .setSmallIcon(R.mipmap.ic_launcher) // TODO: replace with @drawable/ic_notification if available
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification() {
        val secondsAgo = ((SystemClock.elapsedRealtime() - lastUpdateTime) / 1000).toInt()
        val accuracy = lastAccuracy
        val accuracyLabel = when {
            accuracy == null -> "GPS: Waiting..."
            accuracy < 10 -> "GPS: Excellent (${accuracy.toInt()}m)"
            accuracy < 30 -> "GPS: Good (${accuracy.toInt()}m)"
            accuracy < 50 -> "GPS: Weak (${accuracy.toInt()}m)"
            else -> "GPS: Poor (${accuracy.toInt()}m)"
        }
        val contentText = "🟢 $accuracyLabel | Last update: ${secondsAgo}s ago"
        val notification = buildNotification(contentText)
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Live trip tracking notification"
                enableLights(false)
                enableVibration(false)
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        Log.d(TAG, "LocationServices destroyed")
        //  Remove the foreground notification
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
        destroyed = true
        sendPolicy.reset()
        latestFix = null
        fixRequest?.cancel()
        SocketManager.removeOnConnectListener(onConnected)
        mainHandler.removeCallbacksAndMessages(null)
        lastKnownLat = null
        lastKnownLng = null
        try { unregisterReceiver(batteryReceiver) } catch (_: Exception) {}
        fusedLocationClient.removeLocationUpdates(locationCallback)
        serviceScope.cancel()
        SocketManager.disconnect()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
