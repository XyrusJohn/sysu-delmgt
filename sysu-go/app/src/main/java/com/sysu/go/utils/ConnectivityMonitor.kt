package com.sysu.go.utils

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.sysu.go.BuildConfig
import com.sysu.go.utils.TrackingStateMonitor
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object ConnectivityMonitor {
    private const val TAG = "ConnectivityMonitor"

    /** Probe the configured API host used to persist driver status. */
    private const val PROBE_TIMEOUT_MS = 3000
    private const val PROBE_INTERVAL_MS = 10_000L

    enum class Status {
        ONLINE_WIFI,
        ONLINE_CELLULAR,
        ONLINE_ETHERNET,
        ONLINE_UNKNOWN,
        OFFLINE
    }

    interface ConnectivityChangeListener {
        fun onConnectivityChanged(status: Status)
    }

    private val listeners = CopyOnWriteArrayList<ConnectivityChangeListener>()
    private var currentStatus: Status = Status.OFFLINE
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var appContext: Context? = null

    //  Periodic reachability probe
    //  Why: Android's NetworkCallback only fires on link-level transitions. When the
    //  link is up but DNS is broken (captive portal, bad DNS server, no actual internet),
    //  the OS still reports the network as AVAILABLE and ConnectivityManager reports
    //  it as ONLINE. This probe detects that case against the configured API host.
    private val probeHandler = Handler(Looper.getMainLooper())
    private val probeExecutor = Executors.newSingleThreadExecutor()
    private val probeRunning = AtomicBoolean(false)
    @Volatile
    private var lastProbeOk: Boolean = false
    @Volatile
    private var lastProbeAt: Long = 0L

    private val probeRunnable = object : Runnable {
        override fun run() {
            if (!probeRunning.get()) return
            probeExecutor.execute {
                val ok = doProbe()
                lastProbeOk = ok
                lastProbeAt = System.currentTimeMillis()
                Log.d(TAG, ">>> API reachability probe: ${if (ok) "OK" else "FAILED"}")
                //  Push updated status on main thread (NetworkCallback and listeners
                //  expect main-thread delivery).
                probeHandler.post {
                    updateConnectivityStatus()
                }
            }
            probeHandler.postDelayed(this, PROBE_INTERVAL_MS)
        }
    }

    /**
     * Opens a TCP socket to the configured API host with a 3s timeout.
     * Returns true if DNS resolution and the TCP handshake complete.
     */
    private fun doProbe(): Boolean {
        return try {
            val api = java.net.URL(BuildConfig.API_BASE_URL)
            val host = api.host.takeIf(String::isNotBlank) ?: return false
            val port = if (api.port > 0) api.port else if (api.protocol.equals("https", true)) 443 else 80
            Socket().use { sock ->
                sock.connect(InetSocketAddress(host, port), PROBE_TIMEOUT_MS)
                true
            }
        } catch (e: Exception) {
            Log.d(TAG, ">>> API probe failed: ${e.javaClass.simpleName}: ${e.message}")
            false
        }
    }

    fun addListener(listener: ConnectivityChangeListener) {
        listeners.add(listener)
        //  Immediately notify the new listener of the current status
        listener.onConnectivityChanged(currentStatus)
    }

    fun removeListener(listener: ConnectivityChangeListener) {
        listeners.remove(listener)
    }

    private fun notifyListeners(status: Status) {
        if (status != currentStatus) {
            Log.d(TAG, "Connectivity status changed: $currentStatus -> $status")
            currentStatus = status
            listeners.forEach { it.onConnectivityChanged(status) }
            //  Mirror OFFLINE/ONLINE to TrackingStateMonitor so Activities only need one listener
            when (status) {
                Status.OFFLINE -> TrackingStateMonitor.setState(TrackingStateMonitor.State.OFFLINE)
                else -> { /* non-offline states don't change TrackingStateMonitor unless already OFFLINE */
                    if (TrackingStateMonitor.getCurrentState() == TrackingStateMonitor.State.OFFLINE) {
                        TrackingStateMonitor.setState(TrackingStateMonitor.State.ONLINE)
                    }
                }
            }
            //  Mirror driver status through the MySQL API, which broadcasts with Socket.IO.
            val uid = appContext?.let(::SessionManager)?.getDriverId()
            when (status) {
                Status.OFFLINE -> DriverStatus.markOffline(uid)
                else -> DriverStatus.restoreOnline(uid)
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun start(context: Context) {
        if (connectivityManager != null && networkCallback != null) {
            Log.w(TAG, "ConnectivityMonitor already started.")
            return
        }

        appContext = context.applicationContext
        DriverStatus.initialize(context)
        connectivityManager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                super.onAvailable(network)
                Log.w(TAG, ">>> NetworkCallback: onAvailable(network=$network)")
                updateConnectivityStatus()
            }

            override fun onLost(network: Network) {
                super.onLost(network)
                Log.w(TAG, ">>> NetworkCallback: onLost(network=$network)")
                updateConnectivityStatus()
            }

            override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                super.onCapabilitiesChanged(network, networkCapabilities)
                Log.w(TAG, ">>> NetworkCallback: onCapabilitiesChanged(network=$network, caps=${
                    listOfNotNull(
                        if (networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) "WIFI" else null,
                        if (networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) "CELLULAR" else null,
                        if (networkCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) "ETHERNET" else null
                    ).joinToString().ifEmpty { "UNKNOWN" }
                })")
                updateConnectivityStatus()
            }
        }

        val networkRequest = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager?.registerNetworkCallback(networkRequest, networkCallback!!)
        Log.d(TAG, "ConnectivityMonitor started with NetworkCallback")

        //  Initial check
        updateConnectivityStatus()

        //  Start periodic reachability probe — catches DNS-broken / captive-portal
        //  cases where the OS-level link is up but no actual internet is reachable.
        if (probeRunning.compareAndSet(false, true)) {
            probeHandler.post(probeRunnable)
            Log.d(TAG, ">>> Reachability probe started (every ${PROBE_INTERVAL_MS}ms)")
        }
    }

    fun stop() {
        if (connectivityManager != null && networkCallback != null) {
            connectivityManager?.unregisterNetworkCallback(networkCallback!!)
            connectivityManager = null
            networkCallback = null
            Log.d(TAG, "ConnectivityMonitor stopped.")
        }
        listeners.clear()
        //  Stop periodic probe
        if (probeRunning.compareAndSet(true, false)) {
            probeHandler.removeCallbacks(probeRunnable)
            probeExecutor.shutdownNow()
            Log.d(TAG, ">>> Reachability probe stopped")
        }
    }

    @SuppressLint("MissingPermission")
    private fun updateConnectivityStatus() {
        val cm = connectivityManager ?: return
        val activeNetwork = cm.activeNetwork
        val caps = cm.getNetworkCapabilities(activeNetwork)

        //  OS says we're online if the link is up. But DNS may be broken — Android
        //  won't know. Override with our own probe result if available (i.e. we've
        //  already done at least one probe). Until then (probe latency gap), trust
        //  the OS — better than flickering offline → online at cold start.
        val osOnline = caps != null
        //  Probe result is only authoritative after at least one probe has completed.
        //  Before that, treat as "online" so we don't write "offline" on cold start.
        val probeSaysOffline = lastProbeAt > 0L && !lastProbeOk

        val newStatus = when {
            !osOnline -> Status.OFFLINE  // link-level down → definitely offline
            osOnline && probeSaysOffline -> {
                //  Link is up but we have a recent probe failure (DNS broken, captive
                //  portal, no actual internet). Treat as OFFLINE so DriverStatus writes
                //  "offline" through the API. Once the next probe succeeds, we'll flip back.
                Status.OFFLINE
            }
            else -> when {
                caps!!.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Status.ONLINE_WIFI
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Status.ONLINE_CELLULAR
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Status.ONLINE_ETHERNET
                else -> Status.ONLINE_UNKNOWN
            }
        }

        if (newStatus != currentStatus) {
            val driverName = appContext?.let(::SessionManager)?.getDriverName() ?: "Driver"
            when (newStatus) {
                Status.OFFLINE -> Log.w(TAG, "[$driverName] 🌐 OFFLINE")
                Status.ONLINE_WIFI -> Log.i(TAG, "[$driverName] 🌐 ONLINE — WIFI")
                Status.ONLINE_CELLULAR -> Log.i(TAG, "[$driverName] 🌐 ONLINE — CELLULAR")
                Status.ONLINE_ETHERNET -> Log.i(TAG, "[$driverName] 🌐 ONLINE — ETHERNET")
                Status.ONLINE_UNKNOWN -> Log.i(TAG, "[$driverName] 🌐 ONLINE — UNKNOWN")
            }
            //  Log network switch event if coming from another online state
            if (currentStatus != Status.OFFLINE && newStatus != Status.OFFLINE) {
                val from = currentStatus.name.removePrefix("ONLINE_")
                val to = newStatus.name.removePrefix("ONLINE_")
                Log.i(TAG, "[$driverName] 🔄 Network switched: $from → $to")
            }
            notifyListeners(newStatus)
        }
    }

    //  Expose current status
    fun getCurrentStatus(): Status = currentStatus
}
