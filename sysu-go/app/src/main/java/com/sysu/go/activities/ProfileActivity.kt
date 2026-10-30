package com.sysu.go.activities

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Toast
import com.sysu.go.utils.Sanitizer
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.appcompat.app.AlertDialog
import com.google.android.material.button.MaterialButton
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.content.SharedPreferences
import com.sysu.go.R
import com.sysu.go.databinding.ActivityProfileBinding
import com.sysu.go.network.SocketManager
import com.sysu.go.network.MysqlAuthClient
import com.sysu.go.network.DriverProfileApiService
import com.sysu.go.model.ProfileAssignmentPolicy
import com.sysu.go.utils.ConnectivityMonitor
import com.sysu.go.utils.PermissionHelper
import com.sysu.go.utils.SessionManager
import com.sysu.go.diagnostics.SystemErrorReporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.graphics.Typeface
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ProfileActivity : AppCompatActivity(), ConnectivityMonitor.ConnectivityChangeListener {

    private lateinit var binding: ActivityProfileBinding
    private val prefs: SharedPreferences by lazy {
        getSharedPreferences("go_prefs", MODE_PRIVATE)
    }
    private var driverId: String? = null

    //  Status badge — uses backend database snapshot listener on drivers/{uid}.status.
    //  Source of truth: drivers/{uid}.status field. With offline persistence enabled
    //  (GoApplication.kt), the snapshot listener reads from local cache when offline
    //  and gets live updates when online. This is the simplest and most reliable path.
    private var driverStatusListener: (() -> Unit)? = null
    private var assignmentCountListener: (() -> Unit)? = null
    private var historyListener: (() -> Unit)? = null
    private var historyLoadingDialog: AlertDialog? = null

    //  Cached value from the backend database snapshot listener. We keep this around because
    //  connectivity changes don't affect backend database's view of the lifecycle state
    //  ("in_transit", "returning_to_base") — only the offline/online indicator.
    @Volatile
    private var lastDriverStatus: String = "online"

    //  Last connectivity status we painted the badge for. We use this to skip
    //  redundant re-renders from the fallback poll, and to detect missed events.
    @Volatile
    private var lastPaintedConnectivity: ConnectivityMonitor.Status = ConnectivityMonitor.Status.OFFLINE

    //  Fallback poll — every 2s, reconcile badge with current ConnectivityMonitor
    //  state. This is a belt-and-suspenders defense: even if the listener
    //  somehow misses a transition (e.g., NetworkCallback glitch on this OEM),
    //  the badge still catches up within 2s. Lightweight — just compares a
    //  status enum and re-renders if different.
    private val connectivityPoller = android.os.Handler(android.os.Looper.getMainLooper())
    private val connectivityPollRunnable = object : Runnable {
        override fun run() {
            val current = ConnectivityMonitor.getCurrentStatus()
            if (current != lastPaintedConnectivity) {
                Log.w("ProfileActivity", ">>> [POLL] detected missed transition: $lastPaintedConnectivity → $current")
                onConnectivityChanged(current)
            }
            connectivityPoller.postDelayed(this, 2000L)
        }
    }

    //  Server-pushed driver_status_change listener. The server's presence
    //  watcher (backend/utils/presenceWatcher.js) is now authoritative for
    //  OFFLINE detection — when it sees a stale driver, it writes "offline"
    //  to backend database AND broadcasts driver_status_change to room driver:{uid}.
    //  We listen for that broadcast and flip the badge IMMEDIATELY, without
    //  waiting for the backend database snapshot to land (which may take a moment
    //  due to listener dispatch + cache update).
    private val serverStatusListener: (Any?) -> Unit = listener@{ data ->
        try {
            val json = data as? org.json.JSONObject ?: return@listener
            val status = json.optString("status", "online")
            val source = json.optString("source", "unknown")
            Log.w("ProfileActivity", ">>> [SERVER] driver_status_change → $status (source=$source)")
            //  Server is authoritative for OFFLINE. For ONLINE / in_transit /
            //  returning_to_base, prefer the backend database snapshot (which may
            //  include additional lifecycle fields), but the server push is
            //  fine for the badge too.
            lastDriverStatus = status
            if (ConnectivityMonitor.getCurrentStatus() != ConnectivityMonitor.Status.OFFLINE) {
                renderStatusBadge(status)
                lastPaintedConnectivity = ConnectivityMonitor.getCurrentStatus()
            }
        } catch (e: Exception) {
            Log.w("ProfileActivity", ">>> [SERVER] driver_status_change parse error: ${e.message}")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        binding = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }

        setupUI()
        loadDriverInfo()

        binding.btnEditRequirements.setOnClickListener {
            driverId?.let { id ->
                RequirementsEditBottomSheet.newInstance(id)
                    .show(supportFragmentManager, RequirementsEditBottomSheet.TAG)
            }
        }

        binding.btnOpenAppInfo.setOnClickListener {
            PermissionHelper.openAppSettings(this)
        }

        binding.btnSystemDiagnostics.setOnClickListener { startSystemDiagnostics() }
    }

    private fun startSystemDiagnostics() {
        if (!SessionManager(this).hasActiveSession()) {
            Toast.makeText(this, "Mag-login muna para makapag-save ng diagnostics.", Toast.LENGTH_LONG).show()
            return
        }
        binding.btnSystemDiagnostics.isEnabled = false
        val progressContent = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(12), dp(8), dp(12))
            addView(android.widget.ProgressBar(context), LinearLayout.LayoutParams(dp(36), dp(36)))
            addView(TextView(context).apply {
                text = "Sinusuri ang network, API, live connection, at account session…"
                setTextColor(ContextCompat.getColor(context, R.color.text_primary))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(16) })
        }
        val progress = AlertDialog.Builder(this)
            .setTitle("System diagnostics")
            .setView(progressContent)
            .setCancelable(false)
            .show()
        SystemErrorReporter.runDiagnostics(this) { report ->
            if (isFinishing || isDestroyed) return@runDiagnostics
            progress.dismiss()
            binding.btnSystemDiagnostics.isEnabled = true
            val checks = report.optJSONArray("checks") ?: org.json.JSONArray()
            val lines = (0 until checks.length()).mapNotNull { index ->
                val check = checks.optJSONObject(index) ?: return@mapNotNull null
                val name = when (check.optString("name")) {
                    "network" -> "Internet"
                    "sysu-go-api" -> "SYSU Go server"
                    "sysu-go-database" -> "System data"
                    "sysu-go-socket" -> "Live connection"
                    "session-token" -> "Sign-in"
                    else -> "System check"
                }
                val state = check.optString("state").takeIf { it.isNotBlank() }
                    ?.let { " · ${it.replace('_', ' ')}" }.orEmpty()
                val failure = when (check.optString("failureCode")) {
                    "NETWORK_OFFLINE" -> "No internet connection"
                    "API_HOST_NOT_FOUND", "API_CONNECTION_FAILED", "NETWORK_UNREACHABLE" -> "Cannot reach the SYSU Go server"
                    "SECURE_CONNECTION_FAILED" -> "Secure connection failed"
                    "HEALTH_CHECK_TIMEOUT", "NETWORK_TIMEOUT" -> "Server took too long to respond"
                    "SESSION_TOKEN_MISSING", "SESSION_EXPIRED" -> "Sign in again"
                    "ACCOUNT_NOT_ALLOWED" -> "Account cannot save diagnostics"
                    "DATABASE_UNAVAILABLE" -> "System data is temporarily unavailable"
                    "SERVER_UNAVAILABLE", "HEALTH_CHECK_FAILED" -> "Server check failed"
                    "API_REQUEST_FAILED", "REPORT_NOT_SAVED" -> "Could not send the report"
                    else -> ""
                }.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
                val status = when (check.optString("status")) {
                    "pass" -> "OK"
                    "warning" -> "Check this"
                    else -> "Problem"
                }
                "$name: $status$state$failure"
            }
            val saved = report.optBoolean("persisted")
            val reference = report.optString("requestId").takeIf { it.isNotBlank() && it != "null" }
            val persistFailure = report.optString("persistenceFailureCode").takeIf { it.isNotBlank() && it != "null" }
            val persistenceRequestId = report.optString("persistenceRequestId")
                .takeIf { it.isNotBlank() && it != "null" }
            val saveFailureMessage = when (persistFailure) {
                "NETWORK_TIMEOUT" -> "Matagal sumagot ang server. Subukan ulit kapag stable na ang connection."
                "API_HOST_NOT_FOUND", "API_CONNECTION_FAILED", "NETWORK_UNREACHABLE", "SECURE_CONNECTION_FAILED" ->
                    "May internet, pero hindi maabot ng app ang SYSU Go server. Subukan ulit; kung maulit, ipadala sa IT ang reference."
                "API_REQUEST_FAILED" ->
                    "Hindi naipadala ang report sa SYSU Go server. Maaaring naputol ang connection habang nagse-save. Subukan ulit."
                "SESSION_EXPIRED" -> "Nag-expire ang sign-in. Mag-sign in muli bago magpatakbo ng diagnostics."
                "ACCOUNT_NOT_ALLOWED" -> "Hindi pinapayagan ng account na ito ang pag-save ng diagnostics. Ipa-check sa system manager."
                "RATE_LIMITED" -> "Masyadong maraming diagnostics ang naipadala. Maghintay muna bago subukan ulit."
                "SERVER_UNAVAILABLE" -> "Hindi nakapag-save ang SYSU Go server ngayon. Subukan ulit mamaya."
                "INVALID_DIAGNOSTICS" -> "Hindi tinanggap ng server ang report. Ipa-check sa system manager ang app version."
                "UNSAFE_API_CONFIGURATION" -> "Mali ang server address ng app. Ipa-check ito sa system manager."
                else -> "Hindi na-save ang run sa web diagnostics. Suriin ang sign-in at subukan muli."
            }
            val ending = if (saved) "\n\nNa-save ang run sa System diagnostics ng SYSU App.${reference?.let { " Reference: $it" }.orEmpty()}"
                else "\n\n$saveFailureMessage${persistenceRequestId?.let { " Reference: $it" }.orEmpty()}"
            AlertDialog.Builder(this)
                .setTitle("System diagnostics result")
                .setMessage((lines.ifEmpty { listOf("Walang check result.") }.joinToString("\n") + ending))
                .setPositiveButton("OK", null)
                .show()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onResume() {
        super.onResume()
        loadDriverInfo()
        refreshPermissionStates()
        SocketManager.connect(this)
        //  Subscribe to drivers/{uid}.status — backend database snapshot listener.
        //  Reads from local cache (offline) per GoApplication persistence config.
        setupDriverStatusListener()
        refreshAssignedCount()
        //  Subscribe to ConnectivityMonitor so the badge flips OFFLINE/ONLINE
        //  IMMEDIATELY when WiFi is toggled, without waiting for the backend database
        //  write to round-trip through the (potentially flaky) network.
        ConnectivityMonitor.addListener(this)
        //  Subscribe to server-pushed driver_status_change broadcasts. The
        //  server's presence watcher is authoritative for OFFLINE — when it
        //  detects a stale driver, it broadcasts driver_status_change:offline
        //  and we flip the badge without waiting for backend database.
        SocketManager.addEventListener("driver_status_change", serverStatusListener)
        //  Start the 2-second poll so we still catch up even if the listener
        //  somehow misses an event (defensive — covers OEM-specific quirks).
        lastPaintedConnectivity = ConnectivityMonitor.Status.OFFLINE  // force first paint to take effect
        connectivityPoller.post(connectivityPollRunnable)
    }

    /**
     * Checks and updates UI reflecting live OS permission statuses:
     * - Location (GPS)
     * - Unrestricted Battery (Doze bypass)
     * - System Notifications
     * - Camera
     */
    private fun refreshPermissionStates() {
        val hasLoc = PermissionHelper.hasLocationPermission(this)
        val hasBatt = PermissionHelper.hasBatteryOptimizationDisabled(this)
        val hasNotif = PermissionHelper.hasNotificationPermission(this)
        val hasCam = PermissionHelper.hasCameraPermission(this)

        fun updateBadge(tv: TextView, granted: Boolean) {
            tv.text = if (granted) "Active" else "Missing / Denied"
            tv.setTextColor(
                ContextCompat.getColor(
                    this,
                    if (granted) R.color.transit_green else R.color.sysu_red
                )
            )
        }

        updateBadge(binding.tvStatusPermLocation, hasLoc)
        updateBadge(binding.tvStatusPermBattery, hasBatt)
        updateBadge(binding.tvStatusPermNotification, hasNotif)
        updateBadge(binding.tvStatusPermCamera, hasCam)

        val allOk = hasLoc && hasBatt && hasNotif && hasCam
        binding.permSectionAccent.setBackgroundColor(
            ContextCompat.getColor(this, if (allOk) R.color.transit_green else R.color.sysu_red)
        )
        binding.tvPermOverview.text = if (allOk) {
            "Lahat ng Background & Tracking Permissions: MAAYOS (ACTIVE)"
        } else {
            "May Kulang na Permission para sa Background Tracking!"
        }
        binding.tvPermOverview.setTextColor(
            ContextCompat.getColor(this, if (allOk) R.color.text_muted else R.color.sysu_red)
        )

        binding.btnOpenAppInfo.text = if (allOk) {
            "Buksan ang App Info / Settings"
        } else {
            "I-Grant o Ayusin sa App Settings"
        }
    }

    override fun onPause() {
        super.onPause()
        teardownDriverStatusListener()
        teardownAssignmentCountListener()
        teardownHistoryListener()
        historyLoadingDialog?.dismiss()
        historyLoadingDialog = null
        ConnectivityMonitor.removeListener(this)
        SocketManager.removeEventListener("driver_status_change", serverStatusListener)
        connectivityPoller.removeCallbacks(connectivityPollRunnable)
    }

    /**
     * React to local connectivity changes for the badge only. We do NOT write
     * to backend database here — DriverStatus already does that via ConnectivityMonitor's
     * own listener. The badge just needs to render the right thing *now*, before
     * the backend database write completes (which can take seconds when DNS is broken).
     *
     * Lifecycle state (in_transit / returning_to_base) is preserved from the last
     * backend database snapshot so we don't clobber it with a generic ONLINE/OFFLINE.
     */
    override fun onConnectivityChanged(status: ConnectivityMonitor.Status) {
        Log.w("ProfileActivity", ">>> [BADGE] connectivity → $status (lastDriverStatus=$lastDriverStatus, lastPainted=$lastPaintedConnectivity)")
        lastPaintedConnectivity = status
        if (status == ConnectivityMonitor.Status.OFFLINE) {
            //  Connectivity is OFFLINE — show OFFLINE badge immediately, regardless
            //  of whatever lifecycle state the backend database cache happens to hold.
            //  This is the CRITICAL path the user hit: backend database write is queued
            //  offline, but the badge MUST flip immediately so the user sees reality.
            renderStatusBadge("offline")
            Log.w("ProfileActivity", ">>> [BADGE] ✓ OFFLINE badge rendered (immediate, no backend database wait)")
        } else {
            //  Connectivity is back. Re-render with whatever lifecycle state we last
            //  saw from backend database. If that state was also "offline" (because the
            //  server write hadn't flushed yet), render "online" now.
            val effective = if (lastDriverStatus == "offline") "online" else lastDriverStatus
            renderStatusBadge(effective)
            Log.w("ProfileActivity", ">>> [BADGE] ✓ re-rendered with state='$effective'")
        }
    }

    /**
     * Subscribes to the authenticated SQL-backed driver profile stream.
     *
     * Persistence is enabled in GoApplication.kt, so:
     *   - When online: snapshot listener fires whenever the server value changes
     *   - When offline: snapshot listener serves from local cache (last known value)
     *   - When transitioning offline → online: persisted writes flush, listener fires
     *
     * This is the most reliable path because backend database SDK handles all the
     * networking, caching, and reconnection logic. We just react to the result.
     */
    private fun setupDriverStatusListener() {
        val uid = driverId ?: SessionManager(this).getDriverId() ?: return
        teardownDriverStatusListener()
        driverStatusListener = SocketManager.subscribeRealtime(
            topic = "driver",
            onData = { payload ->
                val data = payload as? Map<*, *>
                val status = data?.get("status") as? String ?: "online"
                lastDriverStatus = status
                runOnUiThread {
                    if (!isFinishing && ConnectivityMonitor.getCurrentStatus() != ConnectivityMonitor.Status.OFFLINE) {
                        renderStatusBadge(status)
                    }
                }
            },
            onError = { message ->
                Log.w("ProfileActivity", "driver realtime error: $message")
                com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@ProfileActivity, "profile-subscription")
            },
        )
    }

    private fun teardownDriverStatusListener() {
        driverStatusListener?.invoke()
        driverStatusListener = null
    }
    /**
     * Maps the canonical `drivers/{uid}.status` value to a badge.
     * Values: "online" (default), "offline", "in_transit", "returning_to_base".
     * Anything else falls back to "online".
     */
    private fun renderStatusBadge(status: String) {
        when (status) {
            "offline" -> setBadge(
                getString(R.string.status_badge_offline),
                R.drawable.bg_badge_frosted_offline,
                R.color.status_offline
            )
            "in_transit" -> setBadge(
                getString(R.string.status_badge_in_transit),
                R.drawable.bg_badge_frosted_transit,
                R.color.status_in_transit
            )
            "returning_to_base" -> setBadge(
                getString(R.string.status_badge_returning_to_base),
                R.drawable.bg_badge_frosted_returning_to_base,
                R.color.status_returning_to_base
            )
            "online" -> setBadge(
                getString(R.string.status_badge_online),
                R.drawable.bg_badge_frosted_online,
                R.color.status_online
            )
            else -> setBadge(
                getString(R.string.status_badge_online),
                R.drawable.bg_badge_frosted_online,
                R.color.status_online
            )
        }
    }

    @SuppressLint("SetTextI18n")
    private fun setupUI() {
        val session = SessionManager(this)

        //  Set driver name
        val driverName = session.getDriverName() ?: "Driver"
        binding.tvDriverName.text = driverName
        binding.tvAvatarInitial.text = driverName.firstOrNull()?.uppercaseChar()?.toString() ?: "D"

        //  Set full name - build from stored parts
        val fn = session.getDriverFN() ?: ""
        val mi = session.getDriverMI() ?: ""
        val ln = session.getDriverLN() ?: ""
        binding.tvFullName.text = if (fn.isNotEmpty() && ln.isNotEmpty()) {
            val miPart = if (mi.isNotEmpty()) " ${mi.replace(".", "")}." else ""
            "$fn$miPart $ln"
        } else {
            driverName
        }

        //  Set phone
        binding.tvPhone.text = session.getDriverPhone() ?: "Not available"

        //  Set company from session (instant, no waiting for backend database).
        //  Strip any forwarder code / truck-company number and force ALL CAPS so
        //  "001-LAZADA SHIPPING" surfaces as "LAZADA SHIPPING" only.
        val companyDisplay = Sanitizer.sanitizeCompanyName(session.getDriverCompany())
        binding.tvCompany.text = companyDisplay.ifEmpty { "Not set" }

        //  Requirements section — always show. Defaults to all unchecked (false).
        //  backend database callback (loadRequirements) will merge saved values on top.
        binding.requirementsSection.visibility = View.VISIBLE
        binding.rvRequirements.layoutManager = LinearLayoutManager(this)
        if (session.getDriverId() != null) {
            binding.rvRequirements.visibility = View.GONE
            binding.requirementsSkeleton.visibility = View.VISIBLE
            binding.btnEditRequirements.isEnabled = false
        }
        val defaultAdapter = RequirementDisplayAdapter()
        binding.rvRequirements.adapter = defaultAdapter
        val defaultList = listOf(
            "aircon", "reflectorizedVest", "safetyShoes",
            "headcap", "pants", "closedShoes"
        ).map { it to false }
        defaultAdapter.submitList(defaultList)

        //  Set app version
        try {
            val pInfo = packageManager.getPackageInfo(packageName, 0)
            binding.tvAppVersion.text = pInfo.versionName
        } catch (e: PackageManager.NameNotFoundException) {
            binding.tvAppVersion.text = "1.0.0"
        }

        //  Back button
        binding.btnBack.setOnClickListener {
            finish()
        }

        //  Logout button
        binding.btnLogout.setOnClickListener {
            logout()
        }

        //  Tutorials toggle
        val tutorialsEnabled = prefs.getBoolean("tutorials_enabled", true)
        binding.switchTutorials.isChecked = tutorialsEnabled
        binding.switchTutorials.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit()
                    .putBoolean("tutorials_enabled", isChecked)
                    .apply()
        }

        //  History button — opens a dialog showing completed trips from the
        //  driver_history collection, falling back to the latest completed
        //  trip on the driver document if no history records exist.
        val historyButton = MaterialButton(this@ProfileActivity)
        historyButton.text = "View History"
        historyButton.setBackgroundTintList(ContextCompat.getColorStateList(this@ProfileActivity, R.color.sysu_blue))
        historyButton.setTextColor(ContextCompat.getColor(this@ProfileActivity, R.color.white))

        val requirementsParent = binding.requirementsSection.parent as? ViewGroup
        if (requirementsParent != null) {
            val index = requirementsParent.indexOfChild(binding.requirementsSection)
            requirementsParent.addView(historyButton, index)
            historyButton.setOnClickListener { showHistoryDialog() }
        }

        //  Assigned-count subtitle — one-shot fetch on screen open
    }

    /**
     * Reads the assigned-shipment count from drivers/{uid}.assignedShipments
     * (mirrored from sap_assignments by [DriverShipmentSync]).
     *
     * Replaces the previous approach of querying sap_assignments directly with
     * `whereEqualTo("driverId", queueDocIdOrUid).whereNotEqualTo("tripStatus", "completed")`.
     * The mirrored field is one less backend database read per screen open and is
     * kept up-to-date in real-time by the listener in GoApplication.
     */
    private fun refreshAssignedCount() {
        if (SessionManager(this).getDriverId().isNullOrBlank()) return
        teardownAssignmentCountListener()
        binding.assignedCountSkeleton.visibility = View.VISIBLE
        binding.tvAssignedCount.visibility = View.GONE
        assignmentCountListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
            val count = ProfileAssignmentPolicy.activeCount(ProfileAssignmentPolicy.ownAssignments(payload))
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                binding.tvAssignedCount.visibility = if (count > 0) View.VISIBLE else View.GONE
                if (count > 0) binding.tvAssignedCount.text =
                    if (count == 1) "Assigned: 1 shipment" else "Assigned: $count shipments"
                binding.assignedCountSkeleton.visibility = View.GONE
            }
        }, onError = { message ->
            Log.w("ProfileActivity", "assignment realtime unavailable: $message")
            runOnUiThread { binding.assignedCountSkeleton.visibility = View.GONE }
        })
    }

    private fun teardownAssignmentCountListener() {
        assignmentCountListener?.invoke()
        assignmentCountListener = null
    }

    private fun teardownHistoryListener() {
        historyListener?.invoke()
        historyListener = null
    }

    private fun setBadge(text: String, bgRes: Int, textColorRes: Int) {
        binding.tvStatusBadgeText.text = text
        binding.statusBadge.setBackgroundResource(bgRes)
        binding.tvStatusBadgeText.setTextColor(ContextCompat.getColor(this, textColorRes))
    }

    private fun loadDriverInfo() {
        val session = SessionManager(this)
        val uid = session.getDriverId() ?: return
        driverId = uid

        lifecycleScope.launch {
            try {
                val profile = withContext(Dispatchers.IO) { DriverProfileApiService.getOwn(this@ProfileActivity) }
                if (SessionManager(this@ProfileActivity).getDriverId() != uid) return@launch
                val company = profile.truckingCompany.takeIf { it.isNotBlank() } ?: session.getDriverCompany()
                val phone = session.getDriverPhone().orEmpty()
                val fn = session.getDriverFN()
                val mi = session.getDriverMI()
                val ln = session.getDriverLN()
                val cleanName = buildString {
                    append(fn)
                    if (mi.isNotEmpty()) append(" ${mi.replace(".", "")}.")
                    if (ln.isNotEmpty()) append(" $ln")
                }.trim().ifEmpty { session.getDriverName() }
                session.saveDriverSessionWithSplit(
                    uid = uid, fn = fn, mi = mi, ln = ln, displayName = cleanName,
                    phone = phone, company = company
                )
                binding.tvCompany.text = Sanitizer.sanitizeCompanyName(company).ifEmpty { "Not set" }
                if (phone.isNotEmpty()) binding.tvPhone.text = phone
                loadRequirements(profile.requirements)
            } catch (e: Exception) {
                Log.w("ProfileActivity", "SQL profile unavailable", e)
            } finally {
                binding.requirementsSkeleton.visibility = View.GONE
                binding.rvRequirements.visibility = View.VISIBLE
                binding.btnEditRequirements.isEnabled = true
            }
        }
    }

    private fun logout() {
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_destructive)
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Logout"
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Are you sure you want to sign out?"
        val dialog = AlertDialog.Builder(this).setView(dlgView).create()
        dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
            text = "Sign Out"
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@ProfileActivity, R.color.sysu_red))
            setOnClickListener { dialog.dismiss()
                val session = SessionManager(this@ProfileActivity)
                val token = session.getAuthToken()
                SocketManager.disconnect()
                session.clearSession()
                token?.let { authToken -> lifecycleScope.launch {
                    withContext(Dispatchers.IO) { runCatching { MysqlAuthClient().logout(authToken) } }
                } }
                val intent = Intent(this@ProfileActivity, LoginActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                startActivity(intent)
                finish()
            }
        }
        dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    private fun showHistoryDialog() {
        if (SessionManager(this).getDriverId().isNullOrBlank()) return
        val loadingDialog = AlertDialog.Builder(this@ProfileActivity)
            .setTitle("Loading trip history")
            .setView(R.layout.dialog_history_loading)
            .setCancelable(false)
            .create()
        historyLoadingDialog = loadingDialog
        loadingDialog.show()
        teardownHistoryListener()
        historyListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
            teardownHistoryListener()
            loadingDialog.dismiss()
            historyLoadingDialog = null
            if (isFinishing || isDestroyed) return@subscribeRealtime
            val history = ProfileAssignmentPolicy.completed(ProfileAssignmentPolicy.ownAssignments(payload))
            if (history.isEmpty()) {
                Toast.makeText(this@ProfileActivity, "No completed trip found", Toast.LENGTH_SHORT).show()
            } else {
                buildHistoryDialog(history)
            }
        }, onError = { message ->
            teardownHistoryListener()
            loadingDialog.dismiss()
            historyLoadingDialog = null
            Log.e("ProfileActivity", "Error loading history: $message")
            Toast.makeText(this@ProfileActivity, "Trip history unavailable", Toast.LENGTH_SHORT).show()
        })
    }

    private fun buildHistoryDialog(historyList: List<Map<String, Any?>>) {
        val linearLayout = LinearLayout(this@ProfileActivity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }

        linearLayout.addView(TextView(this@ProfileActivity).apply {
            text = "Completed Trips"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(Typeface.DEFAULT_BOLD)
            setPadding(0, 0, 0, 24)
        })

        val sdf = SimpleDateFormat("MMM dd, yyyy HH:mm", Locale.getDefault())
        val sdfShort = SimpleDateFormat("MMM dd HH:mm", Locale.getDefault())

        historyList.forEachIndexed { tripIndex, entry ->
            val completedAt = ProfileAssignmentPolicy.timestampMillis(entry["completedAt"])?.let(::Date)
            val driverName = (entry["driverName"] as? String) ?: "Unknown driver"
            val truckPlate = entry["truckPlate"] as? String ?: ""
            val truckCompany = entry["truckCompany"] as? String ?: ""
            val lineItems = (entry["lineItems"] as? List<*>) ?: emptyList<Any?>()
            //  Per-shipment return outcome — written by ReturnToBaseBottomSheet.performConfirmArrival()
            //  alongside tripStatus="completed". Falls back to "—" for older docs that pre-date
            //  the per-shipment mirror (added 2026-08-10).
            val returnStatus = entry["returnStatus"] as? String ?: ""
            val returnedToBaseAt = ProfileAssignmentPolicy.timestampMillis(entry["returnedToBaseAt"])?.let(::Date)

            val tripView = LinearLayout(this@ProfileActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, 0, 0, 16)
            }

            //  Trip header: "Trip #N — <date>"
            tripView.addView(TextView(this@ProfileActivity).apply {
                text = if (completedAt != null) {
                    "Trip #${tripIndex + 1} — ${sdf.format(completedAt)}"
                } else {
                    "Trip #${tripIndex + 1}"
                }
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                setTypeface(Typeface.DEFAULT_BOLD)
                setPadding(0, 0, 0, 8)
            })

            //  Trip-level details
            val tripInfo = buildString {
                append("Driver: ").append(driverName).append("\n")
                if (truckPlate.isNotBlank()) append("Truck: ").append(truckPlate).append("\n")
                if (truckCompany.isNotBlank()) append("Company: ").append(truckCompany)
            }
            tripView.addView(TextView(this@ProfileActivity).apply {
                text = tripInfo
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(0, 0, 0, 8)
            })

            //  Return-to-base outcome — only shown when the field is populated.
            //  Skipped silently for legacy docs so we don't add noise for pre-mirror trips.
            if (returnStatus.isNotBlank()) {
                val returnedLabel = buildString {
                    append("Returned to base: ")
                    when {
                        returnStatus == "completed" && returnedToBaseAt != null ->
                            sdfShort.format(returnedToBaseAt)
                        returnStatus == "completed" -> "Yes"
                        else -> returnStatus
                    }
                }
                tripView.addView(TextView(this@ProfileActivity).apply {
                    text = returnedLabel
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                    setTypeface(Typeface.DEFAULT, Typeface.ITALIC)
                    setTextColor(ContextCompat.getColor(this@ProfileActivity, R.color.text_muted))
                    setPadding(0, 0, 0, 8)
                })
            }

            //  Line items — one entry per delivery
            if (lineItems.isNotEmpty()) {
                lineItems.forEachIndexed { index, item ->
                    val itemMap = item as? Map<String, *> ?: return@forEachIndexed
                    val customer = itemMap["customerName"] as? String ?: "Unknown customer"
                    val status = itemMap["deliveryStatus"] as? String ?: ""
                    val obd = itemMap["obdNumber"] as? String ?: ""
                    val isPodDone = itemMap["isPodCompleted"] as? Boolean ?: false
                    val podAt = ProfileAssignmentPolicy.timestampMillis(itemMap["podCapturedAt"])?.let(::Date)

                    val itemDetails = buildString {
                        append("   • ").append(customer)
                        if (status.isNotBlank()) append(" — ").append(status)
                        append("\n")
                        if (obd.isNotBlank()) append("     OBD: ").append(obd).append("\n")
                        append("     POD: ").append(
                            when {
                                isPodDone && podAt != null -> "Yes (${sdfShort.format(podAt)})"
                                isPodDone -> "Yes"
                                else -> "No"
                            }
                        )
                    }

                    tripView.addView(TextView(this@ProfileActivity).apply {
                        text = itemDetails
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                        setPadding(0, 4, 0, 4)
                    })
                }
            }

            //  Divider between trips (skip after the last one)
            if (tripIndex < historyList.lastIndex) {
                tripView.addView(View(this@ProfileActivity).apply {
                    setBackgroundColor(ContextCompat.getColor(this@ProfileActivity, R.color.divider))
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        1
                    )
                })
            }

            linearLayout.addView(tripView)
        }

        val closeButton = MaterialButton(this@ProfileActivity).apply {
            text = "Close"
            setPadding(24, 12, 24, 12)
        }
        val buttonLayout = LinearLayout(this@ProfileActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 0)
        }
        buttonLayout.addView(closeButton)
        linearLayout.addView(buttonLayout)

        val dialog = AlertDialog.Builder(this@ProfileActivity)
            .setView(linearLayout)
            .create()
        dialog.show()
        closeButton.setOnClickListener { dialog.dismiss() }
    }

    private fun loadRequirements(reqMap: Map<String, Boolean>) {
        binding.requirementsSection.visibility = View.VISIBLE

        val adapter = binding.rvRequirements.adapter as? RequirementDisplayAdapter
            ?: RequirementDisplayAdapter().also { binding.rvRequirements.adapter = it }

        val displayList = listOf(
            "aircon", "reflectorizedVest", "safetyShoes",
            "headcap", "pants", "closedShoes"
        ).mapNotNull { key ->
            reqMap[key]?.let { checked -> key to checked }
        }

        adapter.submitList(displayList)
    }

}
