// MainActivity
package com.sysu.go.activities

import android.annotation.SuppressLint
import android.Manifest
import android.util.Log
import android.content.SharedPreferences
import android.content.res.ColorStateList
import android.os.Bundle
import android.os.Build
import android.view.LayoutInflater
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ImageView
import android.widget.ImageButton
import android.widget.Toast
import com.sysu.go.utils.Sanitizer
import com.google.android.material.button.MaterialButton
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts

import android.graphics.Color
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.sysu.go.R
import com.sysu.go.databinding.ActivityMainBinding
import com.sysu.go.network.SocketManager
import com.sysu.go.network.MysqlAuthClient
import com.sysu.go.audit.DriverActionAudit
import com.sysu.go.services.LocationServices
import com.sysu.go.utils.ConnectivityMonitor
import com.sysu.go.utils.NetworkUtils // Import NetworkUtils
import com.sysu.go.utils.PermissionHelper
import com.sysu.go.utils.SessionManager
import com.sysu.go.utils.TrackingStateMonitor
import com.sysu.go.model.Assignment
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkInfo
import android.os.Handler
import android.os.Looper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var isInQueue = false
    private var hasShipment = false  // true when driver has an assigned shipment
    private var queueListener: (() -> Unit)? = null
    private val queueLoadingHandler = Handler(Looper.getMainLooper())
    private var queueLoadTimeout: Runnable? = null
    private var myTripCardsListener: (() -> Unit)? = null
    private var queueCancellationPending = false
    private var hasLoadedQueueState = false
    private val queueLoadGeneration = com.sysu.go.model.QueueLoadGeneration()
    private var positionJob: kotlinx.coroutines.Job? = null
    private var assignmentListener: (() -> Unit)? = null
    private var pulseAnimator1: ObjectAnimator? = null
    private var pulseAnimator2: ObjectAnimator? = null
    private val pulseHandler = Handler(Looper.getMainLooper())
    private var pulseRing1Runnable: Runnable? = null
    private var pulseRing2Runnable: Runnable? = null
    private var statusDotRunnable: Runnable? = null
    private val statusDotHandler = Handler(Looper.getMainLooper())
    private var isStatusDotPulsing = false
    private val uploadStatusHandler = Handler(Looper.getMainLooper())
    private var clearUploadStatusRunnable: Runnable? = null

    private val driverActionUploadStatusListener: (com.sysu.go.audit.DriverActionUploadStatus) -> Unit = { status ->
        if (com.sysu.go.audit.DriverActionAudit.claimUploadNotice(this, status)) {
            showTripUploadStatus(status.state)
        }
    }

    private val trackingStateListener = object : TrackingStateMonitor.Listener {
        override fun onTrackingStateChanged(state: TrackingStateMonitor.State) {
            runOnUiThread { updateTrackingBadge(state) }
        }
    }

    /** Tracks the current queue document ID for cancel operations */
    private var currentQueueDocId: String? = null
    private var currentQueueStatus: String? = null
    private var currentQueueEnteredAtMillis: Long? = null
    private var currentQueueShipmentIds: Set<String> = emptySet()

    //  Heartbeat monitoring variables
    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private val HEARTBEAT_INTERVAL_MS = 5000L // Check every 5 seconds
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            if (!NetworkUtils.isInternetAvailable(this@MainActivity)) {
                Log.d(TAG, "I'm losing internet connection")
            }
            heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    private var isGuardVerified = false

    /** Tracks bounce circle animators so they can be cancelled onDestroy */
    private val circleAnimators = mutableListOf<android.animation.Animator>()
    /** Tracks views injected into circleContainer so they can be removed onDestroy */
    private val circleViews = mutableListOf<View>()
    /** Tracks My Trip tab's own circle animators — separate from home banner */
    private val myTripCircleAnimators = mutableListOf<android.animation.Animator>()
    /** Tracks My Trip tab's own circle views — separate from home banner */
    private val myTripCircleViews = mutableListOf<View>()
    /** Prevents double-init of My Trip circle animations */
    private var myTripCirclesInitialized = false
    /** Tracks the bounce arrow animator so it can be cancelled onDestroy */
    private var bounceArrowAnimator: ObjectAnimator? = null
    /** Connection loss popup guard — prevents double-dialog if network flaps */
    private var isOfflineDialogShowing = false
    /** BroadcastReceiver for connectivity changes — registered in onResume, unregistered in onPause */
    private var connectionReceiver: BroadcastReceiver? = null
    /** Adapter driving rvShipmentCards.
        * Phase 1 (0-1 shipments): ShipmentCardAdapter (vertical, shown in cardMyQueue).
        * Phase 2 (2+ shipments): ShipmentCardHorizontalAdapter (horizontal scroll carousel).
        * Kept as ShipmentCardAdapter? but a local horizontal adapter is cast and assigned
        * here at runtime — only submitList is called on this field, which both types share. */
    private var shipmentCardAdapter: com.sysu.go.adapter.ShipmentCardAdapter? = null
    /** In-memory list of queue tabs — used to determine 0 / 1 / 2+ shipment visibility */
    private val currentQueueEntries = mutableListOf<com.sysu.go.adapter.QueueTab>()
    /** In-memory list of loaded Assignment objects — used to populate vertical shipment cards */
    private val currentShipments = mutableListOf<com.sysu.go.model.Assignment>()

    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "go_prefs"
        private const val KEY_QR_TUTORIAL_SEEN = "qr_tutorial_seen"
        private const val KEY_NAV_TUTORIAL_SEEN = "nav_tutorial_seen"
        private const val KEY_TUTORIALS_ENABLED = "tutorials_enabled"
        private const val QUEUE_LOAD_TIMEOUT_MS = 15_000L
    }

    private val prefs: SharedPreferences by lazy {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
    }

    //  Runtime permission request for POST_NOTIFICATIONS (Android 13+).
    //  Without this, the foreground service notification is silently dropped.
    //  On Android < 13 this is NO-OP — permission is auto-granted at manifest install.
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            Log.i(TAG, "POST_NOTIFICATIONS granted — foreground notification will show")
        } else {
            Log.w(TAG, "POST_NOTIFICATIONS denied — notification may not appear. Please enable in Settings.")
        }
        safeStartLocationServices()
    }

    @SuppressLint("MissingInflatedId")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val previousSessionHadCrash = com.sysu.go.diagnostics.SystemErrorReporter.flushPendingCrash(this)
        com.sysu.go.diagnostics.SystemErrorReporter.flushPendingReports(this)

        //  Permission setup gate
        //  If driver hasn't completed the permission wizard or is missing required
        //  permissions (location / notification / battery), show the setup screen
        //  instead of the dashboard. Mark as seen immediately so a back-press
        //  doesn't loop back to the setup screen.
        if (PermissionHelper.needsSetup(this)) {
            PermissionHelper.markSetupCompleted(this)
            startActivity(Intent(this, PermissionSetupActivity::class.java))
            if (previousSessionHadCrash) {
                com.sysu.go.diagnostics.UserErrorNotifier.show(
                    this,
                    "previous-crash",
                    "The app encountered a problem during your previous session. Please retry your last action.",
                )
            }
            //  Do NOT call finish() — let the system manage the back stack
            return
        }
        //

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.btnRetryQueueLoad.setOnClickListener { retryQueueLoad() }
        if (previousSessionHadCrash) {
            binding.root.post {
                com.sysu.go.diagnostics.UserErrorNotifier.show(
                    this,
                    "previous-crash",
                    "The app encountered a problem during your previous session. Please retry your last action.",
                )
            }
        }

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }

        //  Request notification permission (Android 13+) first, then start service in callback.
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)

        loadDriverInfo()
        setupUI()
        setupBottomNav()
        setupTutorial()
        DriverActionAudit.initialize(this)
        if (savedInstanceState == null) binding.root.post {
            DriverActionAudit.showNoticeIfNeeded(this)
        }
        SocketManager.connect(this)
        listenToQueueStatus()
        startCircleAnimation()
        startPulseAnimation()
        TrackingStateMonitor.addListener(trackingStateListener)
    }

    private fun setupTutorial() {
        //  Always show tutorials every app load — never skip based on "seen" flags
        if (binding.qrTutorialOverlay.visibility == View.VISIBLE ||
            binding.navTutorialOverlay.visibility == View.VISIBLE) return

        val tutorialsEnabled = prefs.getBoolean(KEY_TUTORIALS_ENABLED, true)
        if (!tutorialsEnabled) return

        showQrTutorial { showNavTutorial() }
    }

    private fun showQrTutorial(onDismiss: () -> Unit) {
        binding.qrTutorialOverlay.visibility = View.VISIBLE
        binding.qrTutorialOverlay.alpha = 0f
        binding.cbQrTutorialDontShow.isChecked = false
        ObjectAnimator.ofFloat(binding.qrTutorialOverlay, "alpha", 0f, 1f).apply {
            duration = 300L
            start()
        }
        binding.btnGotIt.setOnClickListener {
            val dontShowAgain = binding.cbQrTutorialDontShow.isChecked
            if (dontShowAgain) {
                prefs.edit()
                    .putBoolean(KEY_TUTORIALS_ENABLED, false)
                    .apply()
            }
            ObjectAnimator.ofFloat(binding.qrTutorialOverlay, "alpha", 1f, 0f).apply {
                duration = 300L
                addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: android.animation.Animator) {
                        binding.qrTutorialOverlay.visibility = View.GONE
                        if (!dontShowAgain) {
                            onDismiss()
                        }
                        //  If "Don't show again" was checked, suppress nav tutorial too
                    }
                })
                start()
            }
        }
    }

    private fun showNavTutorial() {
        val tutorialsEnabled = prefs.getBoolean(KEY_TUTORIALS_ENABLED, true)
        if (!tutorialsEnabled) return

        binding.navTutorialOverlay.visibility = View.VISIBLE
        binding.navTutorialOverlay.alpha = 0f
        binding.cbNavTutorialDontShow.isChecked = false
        ObjectAnimator.ofFloat(binding.navTutorialOverlay, "alpha", 0f, 1f).apply {
            duration = 300L
            start()
        }
        binding.btnNavTutorialDone.setOnClickListener {
            val dontShowAgain = binding.cbNavTutorialDontShow.isChecked
            if (dontShowAgain) {
                prefs.edit()
                    .putBoolean(KEY_TUTORIALS_ENABLED, false)
                    .apply()
            }
            ObjectAnimator.ofFloat(binding.navTutorialOverlay, "alpha", 1f, 0f).apply {
                duration = 300L
                addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: android.animation.Animator) {
                        binding.navTutorialOverlay.visibility = View.GONE
                    }
                })
                start()
            }
        }
    }

    private fun startCircleAnimation() {
        binding.circleContainer.post {
            val containerW = binding.circleContainer.width
            val containerH = binding.circleContainer.height
            val random = java.util.Random()

            val count = random.nextInt(3) + 3
            for (i in 0 until count) {
                val sizeDp = 40 + random.nextInt(101)
                val sizePx = (sizeDp * resources.displayMetrics.density).toInt()
                val startX = random.nextInt(containerW).toFloat()
                val startY = random.nextInt(containerH).toFloat()
                val minSpeed = 0.2f + random.nextFloat() * 0.2f
                val maxSpeed = minSpeed + 0.2f + random.nextFloat() * 0.3f
                val alpha = 0.35f + random.nextFloat() * 0.35f

                val circle = createBounceCircle(sizePx, alpha)
                binding.circleContainer.addView(circle)
                circleViews.add(circle)

                startBounceAnimation(
                    view = circle,
                    viewSize = sizePx,
                    containerWidth = containerW,
                    containerHeight = containerH,
                    minSpeed = minSpeed,
                    maxSpeed = maxSpeed,
                    initialX = startX,
                    initialY = startY,
                    startDelayMs = (i * 150L) + random.nextInt(500)
                )
            }
        }
    }

    private fun createBounceCircle(sizePx: Int, alpha: Float): View {
        return View(this).apply {
            layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.bg_circle_light_red)
            this.alpha = alpha
        }
    }

    private fun startBounceAnimation(
        view: View,
        viewSize: Int,
        containerWidth: Int,
        containerHeight: Int,
        minSpeed: Float,
        maxSpeed: Float,
        initialX: Float,
        initialY: Float,
        startDelayMs: Long
    ) {
        val random = java.util.Random()
        val maxX = (containerWidth - viewSize).toFloat().coerceAtLeast(0f)
        val maxY = (containerHeight - viewSize).toFloat().coerceAtLeast(0f)

        view.translationX = initialX
        view.translationY = initialY

        var velX = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) * if (random.nextBoolean()) 1f else -1f
        var velY = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) * if (random.nextBoolean()) 1f else -1f

        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 16L
            repeatCount = ValueAnimator.INFINITE
            startDelay = startDelayMs
            addUpdateListener {
                if (random.nextFloat() < 0.02f) {
                    velX += (random.nextFloat() - 0.5f) * 0.4f
                    velX = velX.coerceIn(-maxSpeed, maxSpeed)
                }
                if (random.nextFloat() < 0.02f) {
                    velY += (random.nextFloat() - 0.5f) * 0.3f
                    velY = velY.coerceIn(-maxSpeed, maxSpeed)
                }

                var newX = view.translationX + velX
                var newY = view.translationY + velY

                if (newX <= 0) {
                    newX = 0f
                    velX = kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed)
                } else if (newX >= maxX) {
                    newX = maxX
                    velX = -kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed)
                }

                if (newY <= 0) {
                    newY = 0f
                    velY = kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed)
                } else if (newY >= maxY) {
                    newY = maxY
                    velY = -kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed)
                }

                view.translationX = newX
                view.translationY = newY
            }
            circleAnimators.add(this)
            start()
        }

        ObjectAnimator.ofFloat(view, "scaleX", 1f, 1.08f).apply {
            duration = 4000L + random.nextInt(1500)
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = startDelayMs
            circleAnimators.add(this)
            start()
        }

        ObjectAnimator.ofFloat(view, "scaleY", 1f, 1.06f).apply {
            duration = 4500L + random.nextInt(1500)
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = startDelayMs + 600L
            circleAnimators.add(this)
            start()
        }
    }

    private fun startPulseAnimation() {
        bounceArrowAnimator = ObjectAnimator.ofFloat(binding.ivBounceArrow, "translationY", 0f, 12f).apply {
            duration = 800L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            start()
        }

        startPulseRing(binding.pulseRing1, 0L)
        startPulseRing(binding.pulseRing2, 1000L)
    }

    private fun startPulseRing(ring: View, delayMs: Long) {
        val runnable = Runnable {
            if (ring == binding.pulseRing1) {
                pulseAnimator1 = ObjectAnimator.ofFloat(ring, "alpha", 0f, 0.6f).apply {
                    duration = 2000L
                    start()
                }
                pulseAnimator2 = ObjectAnimator.ofFloat(ring, "scaleX", 1f, 1.5f).apply {
                    duration = 2000L
                    start()
                }
            } else {
                pulseAnimator2 = ObjectAnimator.ofFloat(ring, "alpha", 0f, 0.6f).apply {
                    duration = 2000L
                    start()
                }
                pulseAnimator1 = ObjectAnimator.ofFloat(ring, "scaleX", 1f, 1.5f).apply {
                    duration = 2000L
                    start()
                }
            }
            ObjectAnimator.ofFloat(ring, "scaleY", 1f, 1.5f).apply {
                duration = 2000L
                interpolator = AccelerateDecelerateInterpolator()
                addListener(object : android.animation.AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: android.animation.Animator) {
                        ring.scaleX = 1f
                        ring.scaleY = 1f
                        ring.alpha = 0f
                        startPulseRing(ring, 0L)
                    }
                })
                start()
            }
        }
        pulseHandler.postDelayed(runnable, delayMs)
        if (ring == binding.pulseRing1) {
            pulseRing1Runnable = runnable
        } else {
            pulseRing2Runnable = runnable
        }
    }

    private fun stopPulseRings() {
        pulseRing1Runnable?.let { pulseHandler.removeCallbacks(it) }
        pulseRing2Runnable?.let { pulseHandler.removeCallbacks(it) }
        pulseRing1Runnable = null
        pulseRing2Runnable = null
        pulseAnimator1?.cancel()
        pulseAnimator2?.cancel()
        pulseAnimator1 = null
        pulseAnimator2 = null
        binding.pulseRing1.scaleX = 1f
        binding.pulseRing1.scaleY = 1f
        binding.pulseRing1.alpha = 0f
        binding.pulseRing2.scaleX = 1f
        binding.pulseRing2.scaleY = 1f
        binding.pulseRing2.alpha = 0f
    }

    /**
     * Updates the vertical shipment cards row.
     * Shows the row only when there are 2 or more assigned shipments.
     * Called from syncShipmentCards whenever the shipment list changes.
     *
     * Phase 1 (0 or 1 shipment): cardMyQueue shows. rvShipmentCards stays GONE.
     * Phase 2+ (2+ shipments): cardMyQueue hidden. rvShipmentCards shows vertical list
     * of full-width shipment cards, each tappable → QueueDetailsActivity for that shipment.
     */
    private fun updateQueueTabs() {
        when {
            currentShipments.isEmpty() -> {
                //  No shipments — hide both shipment displays
                binding.rvShipmentCards.visibility = View.GONE
                binding.cardMyQueue.visibility = View.GONE
                binding.myQueueSection.root.visibility = View.GONE
                return
            }
            else -> {
                //  1 OR MORE shipments — always show rvShipmentCards with cards
                binding.cardMyQueue.visibility = View.GONE
                binding.myQueueSection.root.visibility = View.GONE
                binding.rvShipmentCards.visibility = View.VISIBLE
            }
        }
        //  Vertical stacking: one full-width card per shipment, scrollable
        binding.rvShipmentCards.layoutManager =
            androidx.recyclerview.widget.LinearLayoutManager(this)

        //  Re-create adapter — uses ShipmentCardAdapter (vertical layout, item_shipment_card.xml)
        shipmentCardAdapter = com.sysu.go.adapter.ShipmentCardAdapter(
            sessionActiveDocId = SessionManager(this).getActiveSapDocId()
        ) { assignment ->
            //  Card tapped → navigate to QueueDetailsActivity for POD execution / review
            val intent = Intent(this, QueueDetailsActivity::class.java)
            intent.putExtra("shipment_doc_id", assignment.docId)
            startActivity(intent)
        }
        binding.rvShipmentCards.adapter = shipmentCardAdapter
        shipmentCardAdapter?.submitList(currentShipments.toList())
    }

    private fun updateScanButtonState() {
        val tripStatus = currentShipments.firstOrNull()?.tripStatus
        when {
            //  IN TRANSIT — active trip in progress, map icon shows live tracking
            tripStatus == "in_transit" -> {
                binding.btnScanQR.setImageResource(R.drawable.map)
                binding.tvStatusPill?.text = "IN TRANSIT"
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.white))
                binding.tvCTAHeader?.text = "Trip In Progress"
                binding.tvCTABody?.text = "Your delivery is on the way. Tap to open tracking."
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill_red)
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot_green)

                updateReadyBadge("IN TRANSIT", R.color.white, R.color.frosted_green)
            }
            //  LOADED — verified, ready to start trip
            tripStatus == "loaded" -> {
                binding.btnScanQR.setImageResource(R.drawable.ticket_1)
                binding.tvStatusPill?.text = "LOADED (START TRIP)"
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.white))
                binding.tvCTAHeader?.text = "Cargo Verified & Loaded"
                binding.tvCTABody?.text = "Guard has confirmed. Ready to start your trip."
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill_green)
                startStatusDotPulse()
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot_green)

                updateReadyBadge("LOADED (START TRIP)", R.color.white, R.color.frosted_green)
            }
            //  LOADING — cargo is being loaded at bay
            tripStatus == "loading" -> {
                binding.btnScanQR.setImageResource(R.drawable.ticket_1)
                binding.tvStatusPill?.text = "LOADING CARGO"
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.white))
                binding.tvCTAHeader?.text = "Loading In Progress"
                binding.tvCTABody?.text = "Your cargo is being loaded. Stay present until fully loaded."
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill_amber_solid)
                startStatusDotPulse()
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot_amber)

                updateReadyBadge("LOADING CARGO", R.color.white, R.color.frosted_amber)
            }
            //  FULLY LOADED — guard verification needed before trip
            tripStatus == "fully_loaded" -> {
                binding.btnScanQR.setImageResource(R.drawable.ticket_1)
                binding.tvStatusPill?.text = "GUARD VERIFICATION"
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.white))
                binding.tvCTAHeader?.text = "Guard Verification Required"
                binding.tvCTABody?.text = "Loading is complete. Verify with a guard before you can start your trip."
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill_red)
                startStatusDotPulse()
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot_red)

                updateReadyBadge("GUARD VERIFICATION", R.color.white, R.color.frosted_red)
            }
            //  Guard verified, awaiting driver confirmation
            currentShipments.any { it.guardVerified } &&
                !currentShipments.all { it.guardVerified && it.driverConfirmed } -> {
                binding.btnScanQR.setImageResource(R.drawable.ticket_1)
                binding.tvStatusPill?.text = "GUARD VERIFIED"
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.white))
                binding.tvCTAHeader?.text = "Guard Verified — Confirm Shipment"
                binding.tvCTABody?.text = "Guard has signed off. Confirm your shipment to start the trip."
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill_green)
                startStatusDotPulse()
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot_green)

                updateReadyBadge("GUARD VERIFIED", R.color.white, R.color.frosted_green)
            }
            //  All shipments verified AND confirmed — START TRIP ready
            currentShipments.isNotEmpty() &&
                currentShipments.all { it.guardVerified && it.driverConfirmed } -> {
                binding.btnScanQR.setImageResource(R.drawable.map)
                binding.tvStatusPill?.text = getString(R.string.cta_status_start_trip)
                
                //  Gawing white ang text para mabasa
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.white))
                binding.tvCTAHeader?.text = getString(R.string.cta_header_start_trip)
                binding.tvCTABody?.text = getString(R.string.cta_body_start_trip)
                
                //  ANG FIX: Gamitin ang solid background (bg_status_pill_green) bago i-tint
                val purpleBg = ContextCompat.getDrawable(this, R.drawable.bg_status_pill_green)?.mutate()
                purpleBg?.setTint(android.graphics.Color.parseColor("#9C27B0"))
                binding.statusPill?.background = purpleBg
                
                startStatusDotPulse()
                
                //  Gawing white din ang dot para malinis tingnan
                val whiteDot = ContextCompat.getDrawable(this, R.drawable.bg_status_dot)?.mutate()
                whiteDot?.setTint(android.graphics.Color.WHITE)
                binding.ctaStatusDot?.background = whiteDot

                updateReadyBadge("START TRIP", R.color.white, R.color.frosted_green)
            }
            hasShipment -> {
                //  ASSIGNED — shipment assigned, guard verification happens in AssignmentActivity
                binding.btnScanQR.setImageResource(R.drawable.ticket_1)
                binding.tvStatusPill?.text = getString(R.string.cta_status_assigned)
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.white))
                binding.tvCTAHeader?.text = getString(R.string.cta_header_assigned)
                binding.tvCTABody?.text = getString(R.string.cta_body_assigned)
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill_blue)
                startStatusDotPulse()
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot_gold)

                updateReadyBadge("ASSIGNED", R.color.white, R.color.frosted_blue)
            }
            isInQueue -> {
                //  IN QUEUE — waiting in queue to be called by booth
                binding.btnScanQR.setImageResource(R.drawable.ticket_1)
                binding.tvStatusPill?.text = getString(R.string.cta_status_queue)
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.sysu_gold))
                binding.tvCTAHeader?.text = getString(R.string.cta_header_queue)
                binding.tvCTABody?.text = getString(R.string.cta_body_queue)
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill_queued)
                stopStatusDot()
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot_gold)

                updateReadyBadge("ON QUEUE", R.color.white, R.color.frosted_gold)
            }
            else -> {
                //  NOT ON QUEUE — scan QR to join queue
                binding.btnScanQR.setImageResource(R.drawable.qr_icon)
                binding.tvStatusPill?.text = getString(R.string.cta_status_scan)
                binding.tvStatusPill?.setTextColor(ContextCompat.getColor(this, R.color.sysu_red))
                binding.tvCTAHeader?.text = getString(R.string.cta_header_scan)
                binding.tvCTABody?.text = getString(R.string.cta_body_scan)
                binding.statusPill?.setBackgroundResource(R.drawable.bg_status_pill)
                startStatusDotPulse()
                binding.ctaStatusDot?.setBackgroundResource(R.drawable.bg_status_dot)

                updateReadyBadge("READY TO SCAN", R.color.white, R.color.frosted_white)
            }
        }
    }

    private fun updateReadyBadge(text: String, dotColor: Int, bgColor: Int) {
        binding.tvReadyBadgeText?.text = text
        binding.readyBadgeDot?.backgroundTintList = ColorStateList.valueOf(
            ContextCompat.getColor(this, dotColor)
        )
        binding.readyBadge?.setCardBackgroundColor(
            ColorStateList.valueOf(ContextCompat.getColor(this, bgColor))
        )
    }

    private fun startStatusDotPulse() {
        if (isStatusDotPulsing) return
        isStatusDotPulsing = true

        val dot = binding.ctaStatusDot
        statusDotRunnable = object : Runnable {
            override fun run() {
                if (!isStatusDotPulsing) return
                ObjectAnimator.ofFloat(dot, "alpha", 1f, 0.2f).apply {
                    duration = 800L
                    interpolator = AccelerateDecelerateInterpolator()
                    addListener(object : android.animation.AnimatorListenerAdapter() {
                        override fun onAnimationEnd(animation: android.animation.Animator) {
                            dot.alpha = 1f
                            if (isStatusDotPulsing) {
                                statusDotHandler.postDelayed(statusDotRunnable!!, 1200L)
                            }
                        }
                    })
                    start()
                }
            }
        }
        statusDotHandler.postDelayed(statusDotRunnable!!, 0L)
    }

    //  My Trip Tab Animations

    /**
     * Starts bouncing circles + pulse rings inside the My Trip tab's red banner.
     * Called once when the tab first appears; guarded by myTripCirclesInitialized.
     */
    private fun initMyTripTabAnimations() {
        if (myTripCirclesInitialized) return
        myTripCirclesInitialized = true

        val tabContainer = binding.myTripTabContainer
        val circleContainer = tabContainer.findViewById<FrameLayout>(R.id.circleContainer) ?: return
        val pulseRing1 = tabContainer.findViewById<View>(R.id.pulseRing1)
        val pulseRing2 = tabContainer.findViewById<View>(R.id.pulseRing2)

        circleContainer.post {
            val containerW = circleContainer.width
            val containerH = circleContainer.height
            if (containerW == 0 || containerH == 0) return@post

            val random = java.util.Random()
            val count = random.nextInt(3) + 3

            for (i in 0 until count) {
                val sizeDp = 28 + random.nextInt(61)
                val sizePx = (sizeDp * resources.displayMetrics.density).toInt()
                val startX = random.nextInt(containerW).toFloat()
                val startY = random.nextInt(containerH).toFloat()
                val minSpeed = 0.12f + random.nextFloat() * 0.15f
                val maxSpeed = minSpeed + 0.15f + random.nextFloat() * 0.2f
                val alpha = 0.25f + random.nextFloat() * 0.3f

                val circle = View(this).apply {
                    layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
                    background = ContextCompat.getDrawable(this@MainActivity, R.drawable.bg_circle_light_red)
                    this.alpha = alpha
                }
                circleContainer.addView(circle)
                myTripCircleViews.add(circle)

                startMyTripBounceAnimation(
                    circle, sizePx, containerW, containerH,
                    minSpeed, maxSpeed, startX, startY,
                    (i * 150L) + random.nextInt(500)
                )
            }
        }

        //  Pulse rings for My Trip tab
        startMyTripPulseRing(pulseRing1, 0L)
        startMyTripPulseRing(pulseRing2, 1200L)
    }

    private fun startMyTripBounceAnimation(
        view: View,
        viewSize: Int,
        containerWidth: Int,
        containerHeight: Int,
        minSpeed: Float,
        maxSpeed: Float,
        initialX: Float,
        initialY: Float,
        startDelayMs: Long
    ) {
        val random = java.util.Random()
        val maxX = (containerWidth - viewSize).toFloat().coerceAtLeast(0f)
        val maxY = (containerHeight - viewSize).toFloat().coerceAtLeast(0f)

        view.translationX = initialX
        view.translationY = initialY

        var velX = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) *
            if (random.nextBoolean()) 1f else -1f
        var velY = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) *
            if (random.nextBoolean()) 1f else -1f

        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = Long.MAX_VALUE
            repeatCount = ValueAnimator.INFINITE
            startDelay = startDelayMs
            addUpdateListener {
                if (random.nextFloat() < 0.02f) {
                    velX += (random.nextFloat() - 0.5f) * 0.4f
                    velX = velX.coerceIn(-maxSpeed, maxSpeed)
                }
                if (random.nextFloat() < 0.02f) {
                    velY += (random.nextFloat() - 0.3f) * 0.4f
                    velY = velY.coerceIn(-maxSpeed, maxSpeed)
                }
                var newX = view.translationX + velX
                var newY = view.translationY + velY
                if (newX <= 0) { newX = 0f; velX = kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed) }
                else if (newX >= maxX) { newX = maxX; velX = -kotlin.math.abs(velX).coerceIn(minSpeed, maxSpeed) }
                if (newY <= 0) { newY = 0f; velY = kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed) }
                else if (newY >= maxY) { newY = maxY; velY = -kotlin.math.abs(velY).coerceIn(minSpeed, maxSpeed) }
                view.translationX = newX
                view.translationY = newY
            }
            myTripCircleAnimators.add(this)
            start()
        }

        ObjectAnimator.ofFloat(view, "scaleX", 1f, 1.08f).apply {
            duration = 4000L + random.nextInt(1500)
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = startDelayMs
            myTripCircleAnimators.add(this)
            start()
        }

        ObjectAnimator.ofFloat(view, "scaleY", 1f, 1.06f).apply {
            duration = 4500L + random.nextInt(1500)
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = startDelayMs + 600L
            myTripCircleAnimators.add(this)
            start()
        }
    }

    private fun startMyTripPulseRing(ring: View?, delayMs: Long) {
        ring ?: return
        ring.visibility = View.VISIBLE
        ring.alpha = 0f

        val scaleUp = ObjectAnimator.ofFloat(ring, "scaleX", 0.3f, 1.5f).apply {
            duration = 2000L
            repeatMode = ValueAnimator.RESTART
            repeatCount = ValueAnimator.INFINITE
            startDelay = delayMs
        }
        val scaleUpY = ObjectAnimator.ofFloat(ring, "scaleY", 0.3f, 1.5f).apply {
            duration = 2000L
            repeatMode = ValueAnimator.RESTART
            repeatCount = ValueAnimator.INFINITE
            startDelay = delayMs
        }
        val fadeOut = ObjectAnimator.ofFloat(ring, "alpha", 0.6f, 0f).apply {
            duration = 2000L
            repeatMode = ValueAnimator.RESTART
            repeatCount = ValueAnimator.INFINITE
            startDelay = delayMs
        }

        myTripCircleAnimators.addAll(listOf(scaleUp, scaleUpY, fadeOut))
        scaleUp.start()
        scaleUpY.start()
        fadeOut.start()
    }

    private fun stopCircleAnimations() {
        circleAnimators.forEach { it.cancel() }
        circleAnimators.clear()
        circleViews.forEach { binding.circleContainer.removeView(it) }
        circleViews.clear()
        //  Also clean up My Trip tab circles
        myTripCircleAnimators.forEach { it.cancel() }
        myTripCircleAnimators.clear()
        myTripCircleViews.forEach {
            binding.myTripTabContainer.findViewById<FrameLayout>(R.id.circleContainer)?.removeView(it)
        }
        myTripCircleViews.clear()
    }

    private fun stopStatusDot() {
        isStatusDotPulsing = false
        val runnable = statusDotRunnable
        statusDotRunnable = null
        statusDotHandler.removeCallbacksAndMessages(null)
        runnable?.let { binding.ctaStatusDot.alpha = 1f }
            ?: run { binding.ctaStatusDot.alpha = 1f }
    }

    private fun openQueueDetails() {
        if (currentQueueStatus == "registration_pending") {
            startActivity(Intent(this, TripRegistrationActivity::class.java).putExtra("queueId", currentQueueDocId))
            return
        }
        if (currentQueueEntries.isEmpty() && currentShipments.isEmpty()) {
            Toast.makeText(this, "Wala ka pa sa pila. Mag-scan ng QR code para makapasok.", Toast.LENGTH_SHORT).show()
            return
        }

        //  Shipment assigned → open AssignmentActivity (shows all assignments with live guard status)
        if (hasShipment) {
            startActivity(Intent(this, AssignmentActivity::class.java))
            return
        }

        //  Otherwise, open the standard QueueDetails screen
        startActivity(Intent(this, QueueDetailsActivity::class.java))
    }

    override fun onResume() {
        super.onResume()
        DriverActionAudit.addUploadStatusListener(driverActionUploadStatusListener)
        DriverActionAudit.pendingUploadNotice(this)?.let(driverActionUploadStatusListener)
        com.sysu.go.diagnostics.SystemErrorReporter.flushPendingReports(this)
        safeStartLocationServices()
        listenToQueueStatus()
        updateScanButtonState()
        registerConnectionMonitor()
        startHeartbeatMonitoring()
        updateTrackingBadge(TrackingStateMonitor.getCurrentState())
        //  Re-check tutorials — user may have re-enabled them in Profile
        setupTutorial()
        if (DriverActionAudit.latestUploadState(this) == "pending" && DriverActionAudit.pendingCount(this) > 0) {
            showTripUploadStatus("pending")
        }
    }

    private fun showTripUploadStatus(state: String) {
        clearUploadStatusRunnable?.let(uploadStatusHandler::removeCallbacks)
        val uploaded = state == "uploaded"
        binding.tvTripUploadStatus.text = if (uploaded) {
            "Trip history uploaded. The saved copy was removed from this phone."
        } else {
            "Trip history is waiting to upload. It will stay on this phone until the server confirms it."
        }
        binding.tvTripUploadStatus.visibility = View.VISIBLE

        if (uploaded) {
            clearUploadStatusRunnable = Runnable {
                if (::binding.isInitialized) binding.tvTripUploadStatus.visibility = View.GONE
            }.also { uploadStatusHandler.postDelayed(it, 8_000L) }
        }
    }

    override fun onPause() {
        DriverActionAudit.removeUploadStatusListener(driverActionUploadStatusListener)
        super.onPause()
        unregisterConnectionMonitor()
        isOfflineDialogShowing = false
    }

    override fun onStop() {
        invalidateQueueLoad()
        super.onStop()
    }

    private fun setupUI() {
        val session = SessionManager(this)
        binding.tvDriverName.text = session.getDriverName()

        binding.btnScanQR.setOnClickListener {
            val sessionMgr = SessionManager(this)

            //  STRICTLY check currentShipments for "in_transit"
            val hasActiveTrip = currentShipments.any { it.tripStatus == "in_transit" }

            val isReturning = currentShipments.any { it.tripStatus == "returning_to_base" }
            val allCompleted = currentShipments.isNotEmpty() && currentShipments.all { it.isCompleted }

            //  Priority 1: If there is an active trip, returning to base, or completed shipments -> GeneralTrackingActivity
            if (hasActiveTrip || isReturning || allCompleted) {
                val activeDocId = sessionMgr.getActiveSapDocId()
                    ?: currentShipments.firstOrNull { it.tripStatus == "in_transit" || it.tripStatus == "returning_to_base" }?.docId

                val intent = Intent(this@MainActivity, GeneralTrackingActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    if (activeDocId != null) {
                        putExtra("shipment_doc_id", activeDocId)
                    }
                }
                startActivity(intent)
                return@setOnClickListener
            }

            when {
                //  Route 3: all shipments guardVerified && driverConfirmed → GeneralTrackingActivity
                currentShipments.isNotEmpty() &&
                    currentShipments.all { it.guardVerified && it.driverConfirmed } -> {
                    val intent = Intent(this, GeneralTrackingActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    }
                    startActivity(intent)
                }
                //  Route 4: hasShipment → AssignmentActivity
                hasShipment -> {
                    startActivity(Intent(this, AssignmentActivity::class.java))
                }
                //  Route 5: isInQueue → queue details
                isInQueue -> {
                    openQueueDetails()
                }
                else -> {
                    //  Else → QRScanActivity
                    openQRScan()
                }
            }
        }

        binding.cardMyQueue.setOnClickListener {
            //  Tapping the home card → show per-shipment detail (banner + card stack).
            //  Pass the first shipment's docId so QueueDetailsActivity loads correctly.
            if (currentShipments.isNotEmpty()) {
                val intent = Intent(this, com.sysu.go.activities.QueueDetailsActivity::class.java)
                intent.putExtra("shipment_doc_id", currentShipments.first().docId)
                startActivity(intent)
            } else if (isInQueue) {
                openQueueDetails()
            }
        }

        //  Logout removed from main activity layout as requested
        //  binding.btnLogout.setOnClickListener { logout() }

        //  Initialize My Trip tab as hidden (Home tab is shown at startup)
        binding.myTripTabContainer.visibility = View.GONE

        //  Bottom nav — Home icon: shows home content, hides My Trip tab
        binding.btnHome.setOnClickListener {
            updateBottomNavSelectionForTab(isHomeTab = true)
            //  Show home content
            binding.cardScanCTA.visibility = View.VISIBLE
            binding.tvScanHint.visibility = View.GONE
            binding.myTripTabContainer.visibility = View.GONE
        }

        //  Bottom nav — Profile icon: opens ProfileActivity (driver info, requirements, logout)
        binding.btnProfile.setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
        }

        //  Back button inside My Trip tab — returns to Home tab
        //  (kept for backwards compatibility; actual back navigation is now in MyTripActivity)
        binding.myTripTabContainer.findViewById<ImageButton>(R.id.btnBack)?.setOnClickListener {
            updateBottomNavSelectionForTab(isHomeTab = true)
            binding.cardScanCTA.visibility = View.VISIBLE
            binding.tvScanHint.visibility = View.GONE
            binding.myTripTabContainer.visibility = View.GONE
        }

        binding.btnCancelQueue.setOnClickListener { showCancelQueueDialog() }

        //  Dismiss / close the CTA notification card
        binding.btnCloseScanCTA.setOnClickListener {
            binding.cardScanCTA.visibility = View.GONE
        }

        //  Vertical Shipment Cards RecyclerView — one full-width card per shipment.
        //  Phase 1: hidden (cardMyQueue handles display).
        //  Phase 2 (2+ shipments): visible. LayoutManager set via updateQueueTabs().
        //  default canScrollVertically=true — scroll works via constraintHeight_max in XML.
        binding.rvShipmentCards.layoutManager =
            androidx.recyclerview.widget.LinearLayoutManager(this)

        //  Scroll quality: rubber-band over-scroll
        binding.rvShipmentCards.overScrollMode = androidx.recyclerview.widget.RecyclerView.OVER_SCROLL_ALWAYS

        //  Scroll quality: smooth item animations
        binding.rvShipmentCards.itemAnimator = androidx.recyclerview.widget.DefaultItemAnimator().apply {
            addDuration = 200
            removeDuration = 200
            moveDuration = 200
            changeDuration = 200
        }

        //  Scroll quality: uniform 8dp vertical spacing between cards
        binding.rvShipmentCards.addItemDecoration(object : androidx.recyclerview.widget.RecyclerView.ItemDecoration() {
            override fun getItemOffsets(
                outRect: android.graphics.Rect,
                view: View,
                parent: androidx.recyclerview.widget.RecyclerView,
                state: androidx.recyclerview.widget.RecyclerView.State
            ) {
                val position = parent.getChildAdapterPosition(view)
                val spacing = android.util.TypedValue.applyDimension(
                    android.util.TypedValue.COMPLEX_UNIT_DIP, 8f,
                    parent.context.resources.displayMetrics
                ).toInt()
                outRect.top = if (position == 0) 0 else spacing
                outRect.bottom = spacing
            }
        })
    }

    private fun setupBottomNav() {
        binding.ivHome.setColorFilter(ContextCompat.getColor(this, R.color.sysu_red))
        binding.ivProfile.setColorFilter(ContextCompat.getColor(this, R.color.text_muted))
    }

    /** Updates the header badge based on current tracking state.
     * Pill badge (statusBadge) appears only when a TRIP IS ACTIVE.
     * Default badge (readyBadge) shows when no trip. */
    private fun updateTrackingBadge(state: TrackingStateMonitor.State) {
        val isTracking = SessionManager(this).isTrackingActive()

        if (isTracking) {
            //  Show pill badge, hide "Ready to Scan"
            binding.statusBadge.visibility = View.VISIBLE
            binding.readyBadge.visibility = View.GONE

            val (pillDrawable, dotDrawable, labelText) = when (state) {
                TrackingStateMonitor.State.ONLINE -> Triple(
                    R.drawable.bg_status_pill_green,
                    R.drawable.bg_status_dot_green,
                    "Online"
                )
                TrackingStateMonitor.State.STOPPED -> Triple(
                    R.drawable.bg_status_pill_gold,
                    R.drawable.bg_status_dot_gold,
                    "Stopped"
                )
                TrackingStateMonitor.State.OFFLINE -> Triple(
                    R.drawable.bg_status_pill_red,
                    R.drawable.bg_status_dot_red,
                    "Offline"
                )
            }

            //  Find the pill background LinearLayout inside statusBadge and set its background
            val pillLayout = binding.statusBadge.getChildAt(0) as? android.widget.LinearLayout
            pillLayout?.setBackgroundResource(pillDrawable)
            //  Update dot
            binding.statusDot.setBackgroundResource(dotDrawable)
            //  Update text
            binding.tvStatusBadgeText.text = labelText
        } else {
            //  No active trip — show default "Ready to Scan", hide pill
            binding.statusBadge.visibility = View.GONE
            binding.readyBadge.visibility = View.VISIBLE
        }
    }

    private fun loadDriverInfo() {
        val session = SessionManager(this)
        val uid = session.getDriverId() ?: return

        lifecycleScope.launch {
            try {
                val profile = withContext(Dispatchers.IO) {
                    com.sysu.go.network.DriverProfileApiService.getOwn(this@MainActivity)
                }
                if (session.getDriverId() != uid) return@launch
                val storedName = profile.name.ifBlank { session.getDriverName() }
                val storedPhone = session.getDriverPhone().orEmpty()
                val storedCompany = Sanitizer.sanitizeCompanyName(
                    profile.truckingCompany.ifBlank { session.getDriverCompany() })

                val (storedFN, storedMI, storedLN) = session.getDriverNameParts()

                    //  Rebuild clean display name from parts — MySQL "name" field
                    //  may still carry the old double-dot MI from before the sanitizer fix.
                    val cleanName = buildString {
                        append(storedFN)
                        if (storedMI.isNotEmpty()) append(" ${storedMI.replace(".", "")}.")
                        if (storedLN.isNotEmpty()) append(" $storedLN")
                    }.trim().ifEmpty { storedName }

                    session.saveDriverSessionWithSplit(
                        uid = uid,
                        fn = storedFN,
                        mi = storedMI,
                        ln = storedLN,
                        displayName = cleanName,
                        phone = storedPhone,
                        company = storedCompany
                    )
                binding.tvDriverName.text = cleanName
            } catch (e: Exception) {
                Log.w(TAG, "Driver profile could not be loaded", e)
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MainActivity, "driver-profile", e)
            }
        }
    }

    private fun openQRScan() {
        startActivity(Intent(this, QRScanActivity::class.java))
    }

    private fun listenToQueueStatus() {
        val session = SessionManager(this)
        val driverId = session.getDriverId()
        if (driverId == null) {
            invalidateQueueLoad()
            return
        }
        val generation = queueLoadGeneration.begin()
        if (!hasLoadedQueueState) {
            binding.queueLoadingContainer.visibility = View.VISIBLE
            binding.queueLoadingSkeleton.root.visibility = View.VISIBLE
            binding.queueLoadErrorContent.visibility = View.GONE
            binding.tvQueueStatus.visibility = View.GONE
        }
        queueLoadTimeout?.let(queueLoadingHandler::removeCallbacks)
        queueLoadTimeout = if (!hasLoadedQueueState) Runnable {
            if (queueLoadGeneration.isCurrent(generation)) {
                showQueueLoadError("Queue status is taking longer than expected. Tap to retry.")
            }
        }.also { queueLoadingHandler.postDelayed(it, QUEUE_LOAD_TIMEOUT_MS) } else null
        queueListener?.invoke()
        queueListener = SocketManager.subscribeRealtime("queue", onData = { payload ->
            if (!queueLoadGeneration.isCurrent(generation)) return@subscribeRealtime
            val records = payload as? List<*>
            if (records == null) {
                Log.w(TAG, "Queue realtime returned an unexpected payload type: ${payload?.javaClass?.simpleName ?: "null"}")
                showQueueLoadError("Could not read queue status. Tap to retry.")
                return@subscribeRealtime
            }
            val queues = records.mapNotNull { it as? Map<String, Any?> }
            val preferredQueueId = currentQueueDocId ?: session.getCurrentQueueDocId()
            val activeStatuses = listOf("assigned", "waiting", "called", "loading", "fully_loaded", "in_transit")
            val entry = queues.firstOrNull { it["id"] == preferredQueueId &&
                (it["status"] as? String) in activeStatuses
            } ?: queues.firstOrNull {
                (it["status"] as? String) in listOf("assigned", "waiting", "called", "loading", "fully_loaded", "in_transit")
            }
            runOnUiThread {
                if (!queueLoadGeneration.isCurrent(generation) || isFinishing || isDestroyed) return@runOnUiThread
                queueLoadTimeout?.let(queueLoadingHandler::removeCallbacks)
                queueLoadTimeout = null
                hasLoadedQueueState = true
                binding.queueLoadingContainer.visibility = View.GONE
                binding.tvQueueStatus.visibility = View.VISIBLE
                if (entry != null) {
                    val queueId = entry["id"] as? String ?: return@runOnUiThread
                    val previousQueueId = currentQueueDocId
                    val previousQueueStatus = currentQueueStatus
                    val truckType = entry["truckType"] as? String ?: ""
                    val storedStatus = entry["status"] as? String ?: ""
                    val status = if (storedStatus in listOf("waiting", "called") && entry["registrationComplete"] != true) "registration_pending" else storedStatus
                    isInQueue = true
                    if (currentQueueDocId != queueId) currentShipments.clear()
                    currentQueueDocId = queueId
                    currentQueueStatus = status
                    currentQueueEnteredAtMillis = timestampMillis(entry["entryTime"]) ?: timestampMillis(entry["joinedAt"])
                    currentQueueShipmentIds = ((entry["assignedShipments"] as? List<*>)?.mapNotNull { item ->
                        val fields = item as? Map<*, *> ?: return@mapNotNull null
                        (fields["dispatchKey"] ?: fields["obdNumber"]) as? String
                    }.orEmpty() + listOfNotNull(entry["assignedShipment"] as? String)).toSet()
                    session.saveCurrentQueueDocId(queueId)
                    currentQueueEntries.clear()
                    currentQueueEntries.add(com.sysu.go.adapter.QueueTab(queueDocId = queueId, status = status, hasShipment = false))
                    updateQueueTabs()
                    positionJob?.cancel()
                    val sessionDriverId = session.getDriverId() ?: driverId
                    when {
                        status in listOf("assigned", "in_transit", "loading", "fully_loaded") -> {
                            if (previousQueueId != queueId || previousQueueStatus in listOf("waiting", "called") || assignmentListener == null) {
                                listenToAssignment(queueId, truckType, sessionDriverId)
                            }
                            updateQueueUI(null, status, truckType, null)
                        }
                        status in listOf("waiting", "called") -> {
                            assignmentListener?.invoke()
                            currentShipments.clear()
                            hasShipment = false
                            shipmentCardAdapter?.submitList(emptyList())
                            updateQueueTabs()
                            positionJob = com.sysu.go.network.observeQueuePosition(this, queueId) { position ->
                                if (isFinishing || isDestroyed || currentQueueDocId != queueId || currentQueueStatus !in listOf("waiting", "called")) return@observeQueuePosition
                                updateQueueUI(position, status, truckType, null)
                                updateScanButtonState()
                            }
                        }
                        else -> {
                            assignmentListener?.invoke()
                            currentShipments.clear()
                            hasShipment = false
                            shipmentCardAdapter?.submitList(emptyList())
                            updateQueueUI(null, status, truckType, null)
                        }
                    }
                    updateScanButtonState()
                } else {
                    isInQueue = false
                    hasShipment = false
                    currentQueueDocId = null
                    currentQueueStatus = null
                    currentQueueEnteredAtMillis = null
                    currentQueueShipmentIds = emptySet()
                    session.saveCurrentQueueDocId(null)
                    currentShipments.clear()
                    currentQueueEntries.clear()
                    shipmentCardAdapter?.submitList(emptyList())
                    binding.rvShipmentCards.visibility = View.GONE
                    positionJob?.cancel()
                    listenToAssignmentViaSessionDriverId(driverId, "")
                    binding.tvStatusBadgeText.text = "Ready to Scan"
                    binding.statusBadge.setCardBackgroundColor(android.graphics.Color.parseColor("#33FFFFFF"))
                    binding.tvScanHint.visibility = View.GONE
                    binding.tvQueueStatus.text = "NOT IN QUEUE"
                    binding.tvQueueStatus.textSize = 24f
                    binding.tvQueueStatusLabel.text = ""
                    binding.tvQueueStatusLabel.visibility = View.GONE
                    binding.tvQueueDetails.text = ""
                    binding.tvQueueDetails.visibility = View.GONE
                    binding.ivQueueIcon.setImageResource(R.drawable.ticket_1)
                    binding.ivQueueIcon.setColorFilter(ContextCompat.getColor(this, R.color.sysu_red))
                    binding.dividerCancelQueue.visibility = View.GONE
                    binding.cancelQueueContainer.visibility = View.GONE
                    updateScanButtonState()
                }
            }
        }, onError = { error ->
            if (!queueLoadGeneration.isCurrent(generation)) return@subscribeRealtime
            Log.e(TAG, "queue realtime error: $error")
            com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this, "queue-subscription")
            showQueueLoadError("Could not load queue status. Tap to retry.")
        })
    }

    private fun showQueueLoadError(message: String) {
        if (hasLoadedQueueState || isFinishing || isDestroyed) return
        queueLoadTimeout?.let(queueLoadingHandler::removeCallbacks)
        queueLoadTimeout = null
        binding.queueLoadingContainer.visibility = View.VISIBLE
        binding.queueLoadingSkeleton.root.visibility = View.GONE
        binding.tvQueueLoadError.text = message
        binding.queueLoadErrorContent.visibility = View.VISIBLE
    }

    private fun retryQueueLoad() {
        if (isFinishing || isDestroyed) return
        hasLoadedQueueState = false
        listenToQueueStatus()
    }

    private fun invalidateQueueLoad() {
        queueLoadGeneration.invalidate()
        queueLoadTimeout?.let(queueLoadingHandler::removeCallbacks)
        queueLoadTimeout = null
        queueListener?.invoke()
        queueListener = null
    }
    private fun listenToAssignment(queueId: String, truckType: String, sessionDriverId: String) {
        Log.d(TAG, ">> listenToAssignment() called — queueId=$queueId sessionDriverId=$sessionDriverId")
        listenToAssignmentViaSessionDriverId(sessionDriverId, truckType)
    }

    /**
     * Approach 2: Listen to ALL sap_assignments where driverId == driver ID.
     * Catches all new-style docs and handles multiple shipments at once.
     */
    private fun listenToAssignmentViaSessionDriverId(sessionDriverId: String, truckType: String) {
        //  Remove old approach-2 listener if any, then listen fresh
        assignmentListener?.invoke()
        val observedQueueId = currentQueueDocId
        assignmentListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
            if (observedQueueId != currentQueueDocId || isFinishing) return@subscribeRealtime
            val records = payload as? List<*> ?: return@subscribeRealtime
            val assignments = records.mapNotNull { it as? Map<String, Any?> }
            runOnUiThread {
                if (!isFinishing && !isDestroyed && observedQueueId == currentQueueDocId) {
                    isGuardVerified = assignments.firstOrNull { it["queueId"] == observedQueueId }
                        ?.get("guardVerified") as? Boolean ?: false
                    syncQueueTabsFromSapData(assignments, sessionDriverId, truckType)
                }
            }
        }, onError = { error ->
            Log.e(TAG, "assignments realtime error: $error")
            com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this, "assignment-subscription")
        })
    }

    /**
     * Core sync: converts all sap_assignment docs into Assignment objects and updates
     * currentShipments. Each assignment carries its docId so tapping a card opens
     * AssignmentActivity for that specific shipment.
     *
     * - Adds entries for ALL found shipments (handles 1, 2, 3... shipments)
     * - Removes entries that no longer have a matching sap_assignment
     * - Updates cardMyQueue with first shipment's summary
     * - Calls updateQueueTabs() which handles: 1 shipment → cardMyQueue, 2+ → vertical cards
     */
    private fun syncQueueTabsFromSapData(
        sapSnapshots: List<Map<String, Any?>>,
        sessionDriverId: String,
        truckType: String
    ) {
        if (isFinishing) return

        //  hasShipment flag reflects whether any shipments exist at all
        hasShipment = sapSnapshots.isNotEmpty()

        val eligibleSnapshots = sapSnapshots.filter { doc ->
            val docId = doc["id"] as? String ?: return@filter false
            val linkedQueueId = doc["queueId"] as? String
                ?: (doc["driverId"] as? String)?.takeIf { it != sessionDriverId }
                ?: currentQueueDocId?.takeIf { docId in currentQueueShipmentIds }
            com.sysu.go.model.QueueShipmentPolicy.isCurrentShipment(
                doc["tripStatus"] as? String, doc["returnStatus"] as? String, linkedQueueId,
                currentQueueDocId, currentQueueStatus,
                timestampMillis(doc["assignedAt"]), currentQueueEnteredAtMillis
            )
        }
        SessionManager(this).getDriverId()?.takeIf {
            DriverActionAudit.noticeAcknowledged(this, it)
        }?.let { uid ->
            val eligibleIds = eligibleSnapshots.mapNotNull { it["id"] as? String }
            val acknowledgedAt = DriverActionAudit.noticeAcknowledgedAt(this, uid)
            val firstSnapshotEligible = eligibleSnapshots.mapNotNull { doc ->
                val docId = doc["id"] as? String ?: return@mapNotNull null
                val assignedAt = timestampMillis(doc["assignedAt"]) ?: return@mapNotNull null
                docId.takeIf { assignedAt >= acknowledgedAt }
            }
            val newlyAssigned = runCatching {
                com.sysu.go.audit.DriverActionOutbox(this).use {
                    it.newlyObservedAssignments(uid, eligibleIds, firstSnapshotEligible)
                }
            }.getOrDefault(emptyList()).toSet()
            eligibleSnapshots.forEach { doc ->
                val docId = doc["id"] as? String ?: return@forEach
                if (docId !in newlyAssigned) return@forEach
                val assignedAt = timestampMillis(doc["assignedAt"]) ?: System.currentTimeMillis()
                val waitingMs = currentQueueEnteredAtMillis?.let { (assignedAt - it).coerceAtLeast(0L) }
                com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                    this,
                    eventType = "shipment_assigned",
                    subjectId = (doc["dispatchKey"] as? String)?.takeIf { it.isNotBlank() } ?: docId,
                    durationMs = waitingMs,
                    idempotencyKey = "assignment:$docId",
                    occurredAtMs = assignedAt
                )
            }
        }

        //  Build replacement list with Assignment objects (includes shipment details)
        val newShipments = mutableListOf<com.sysu.go.model.Assignment>()

        for (doc in eligibleSnapshots) {
            val docId = doc["id"] as? String ?: continue
            val linkedQueueId = doc["queueId"] as? String
                ?: (doc["driverId"] as? String)?.takeIf { it != sessionDriverId }
                ?: currentQueueDocId?.takeIf { docId in currentQueueShipmentIds }
            val tripStatus = doc["tripStatus"] as? String
            val guardVerified = doc["guardVerified"] as? Boolean ?: false
            val driverConfirmed = doc["driverConfirmed"] as? Boolean ?: false

            //  All fields are at ROOT level of sap_assignments — no nested "data" map
            val truckPlate   = doc["truckPlate"] as? String ?: ""
            val truckCompany = doc["truckCompany"] as? String ?: ""
            val helperName   = doc["helperName"] as? String ?: ""

            //  Delivery date: actualDelDate lives in lineItems[0] as OData string "/Date(millis)/"
            val lineItems = doc["lineItems"] as? List<Map<String, Any?>> ?: emptyList()
            val firstItem = lineItems.firstOrNull()
            val deliveryMillis = parseODataDate(firstItem?.get("actualDelDate") as? String)

            //  docId (shipment number) is used as the OBD reference
            val assignment = com.sysu.go.model.Assignment(
                docId = docId,              // e.g. "0010128715" — IS the shipment number
                queueId = linkedQueueId ?: currentQueueDocId ?: "",
                driverId = sessionDriverId,
                status = if (tripStatus == "in_transit") "in_transit" else "loading",
                tripStatus = tripStatus,
                plateNumber = truckPlate,
                truckType = truckCompany,
                helper = helperName,
                guardVerified = guardVerified,
                driverConfirmed = driverConfirmed,
                deliveryTimestamp = deliveryMillis,
                obdNumber = docId           // shipment number doubles as OBD reference
            )
            newShipments.add(assignment)
            Log.d(TAG, ">> Synced shipment: docId=$docId, plate=$truckPlate, lineItems=${lineItems.size}, tripStatus=$tripStatus")
        }

        currentShipments.clear()
        val activeShipments = newShipments
        hasShipment = activeShipments.isNotEmpty()
        currentShipments.addAll(activeShipments)

        //  Hanapin ang active shipment at i-restore ang SessionManager state
        val inTransitShipment = activeShipments.find { it.tripStatus == "in_transit" || it.tripStatus == "returning_to_base" }
        val loadedShipment = if (inTransitShipment == null)
            activeShipments.find { it.tripStatus == "loaded" || it.tripStatus == "fully_loaded" || it.tripStatus == "loading" }
        else null
        val session = SessionManager(this)

        //  Cached or pending snapshots must not stop a server-confirmed active tracking session.
        when {
            inTransitShipment != null -> {
                //  Driver mid-trip: restore active shipment doc ID and trip active state
                session.saveActiveSapDocId(inTransitShipment.docId)
                session.saveCurrentSapDocId(inTransitShipment.docId)
                session.setTripActive(true)
                //  STRICT BUTTON-ONLY: do not auto-force trackingActive=true here.
                //  Tracking should only start when the user taps "Start Tracking".
            }
            loadedShipment != null -> {
                //  Driver cargo loaded but not started trip yet:
                session.saveActiveSapDocId(loadedShipment.docId)
                session.saveCurrentSapDocId(loadedShipment.docId)
                session.setTripActive(false)
                //  Don't setTrackingActive(true) here — driver hasn't pressed Start Tracking yet
            }
            else -> {
                //  Siguraduhing malinis ang state kung walang active trip
                session.saveActiveSapDocId(null)
                session.clearCurrentSapDocId()
                session.setTripActive(false)
                session.setTrackingActive(false)
            }
        }

        //  Auto-sync Queue Status
        //  Queue assignment is written by the staff assignment transaction, never inferred from history.

        if (activeShipments.isEmpty()) {
            shipmentCardAdapter?.submitList(emptyList())
            binding.rvShipmentCards.visibility = View.GONE
            if (isInQueue) {
                updateQueueUI(null, currentQueueStatus ?: "waiting", truckType, null)
            } else {
                currentQueueEntries.clear()
                binding.tvQueueStatus.text = "NOT IN QUEUE"
                binding.tvQueueStatusLabel.visibility = View.GONE
                binding.tvQueueDetails.visibility = View.GONE
                binding.tvStatusBadgeText.text = "Ready to Scan"
                binding.dividerCancelQueue.visibility = View.GONE
                binding.cancelQueueContainer.visibility = View.GONE
            }
            updateQueueTabs()
            updateScanButtonState()
            return
        }

        //  Optimistic bridge: CONFIRM SHIPMENT → MainActivity live update
        //  When the user confirms a shipment in AssignmentActivity, the MySQL write
        //  (driverConfirmed=true) takes ~900ms. By the time they press back and onResume
        //  fires, the cached snapshot from addSnapshotListener still shows false.
        //  This flag bridges the gap: AssignmentActivity sets it on success,
        //  and we consume it here to optimistically mark the shipment confirmed locally
        //  until the authoritative snapshot catches up.
        SessionManager(this).consumePendingConfirmedDocId()?.let { pendingDocId ->
            val pendingIdx = currentShipments.indexOfFirst { it.docId == pendingDocId }
            if (pendingIdx >= 0) {
                val optimistic = currentShipments[pendingIdx].copy(driverConfirmed = true)
                currentShipments[pendingIdx] = optimistic
                Log.d(TAG, "Optimistic: forced driverConfirmed=true for docId=$pendingDocId")
            }
        }
        //  End optimistic bridge

        //  Update the static cardMyQueue with first shipment's summary
        val firstShipmentId = activeShipments.firstOrNull()?.docId
        updateQueueUI(null, "loading", truckType, firstShipmentId)
        updateScanButtonState()

        //  updateQueueTabs() reads currentShipments.size:
        //  < 2 → cardMyQueue visible, rvShipmentCards gone
        //  >= 2 → cardMyQueue gone, rvShipmentCards shows vertical list
        updateQueueTabs()
    }

    /**
     * Parses OData-style date strings like "/Date(1780444800000)/"
     * Returns epoch millis as Long, or 0L if unparseable.
     */
    private fun timestampMillis(value: Any?): Long? = when (value) {
        is Number -> value.toLong()
        is Map<*, *> -> (value["\$timestamp"] as? Number)?.toLong()
        else -> null
    }

    private fun parseODataDate(raw: String?): Long {
        if (raw == null) return 0L
        return try {
            raw.removePrefix("/Date(").removeSuffix(")/").toLong()
        } catch (e: Exception) {
            0L
        }
    }

    private fun updateQueueUI(position: Int?, queueStatus: String, truckType: String, shipmentId: String?) {
        runOnUiThread {
            binding.tvScanHint.text = ""
            binding.tvScanHint.visibility = View.GONE

            //  Derive display status from tripStatus (sap_assignments)
            //  Check ALL shipments to determine the aggregate status
            val allTripStatuses = currentShipments.mapNotNull { it.tripStatus }
            val firstShipmentId = shipmentId ?: currentShipments.firstOrNull()?.docId

            //  Determine the canonical display status
            val displayStatus: String = when {
                queueStatus == "registration_pending" -> "REGISTRATION PENDING"
                allTripStatuses.any { it == "in_transit" } -> "IN TRANSIT"
                allTripStatuses.any { it == "returning_to_base" } || (allTripStatuses.all { it == "completed" } && allTripStatuses.isNotEmpty()) -> "DELIVERED"
                allTripStatuses.all { it == "loaded" || it == "fully_loaded" }
                    && allTripStatuses.isNotEmpty() -> "LOADED"
                allTripStatuses.any { it == "loading" || it == "fully_loaded" } -> "LOADING"
                else -> when {
                    hasShipment && firstShipmentId != null -> "ASSIGNED"
                    position != null -> String.format(Locale.US, "No. %d", position)
                    else -> "IN QUEUE"
                }
            }

            if (displayStatus == "DELIVERED") {
                binding.tvQueueStatus.text = "COMPLETED" // Pinalitan mula "Shipment/s Delivered"
                binding.statusBadge.setCardBackgroundColor(Color.parseColor("#9E9E9E")) 
                binding.ivQueueIcon.setColorFilter(Color.parseColor("#9C27B0")) // Purple na ticket
            } else {
                binding.tvQueueStatus.text = displayStatus
            }
            binding.tvQueueStatus.textSize = when (displayStatus) {
                "NOT IN QUEUE", "DELIVERED" -> 24f
                else -> 28f
            }

            //  Badge (frosted pill at top)
            binding.tvStatusBadgeText.text = when (displayStatus) {
                "REGISTRATION PENDING" -> "Complete Registration"
                "IN TRANSIT" -> "In Transit"
                "DELIVERED" -> "Delivered"
                "LOADED" -> "Loaded"
                "LOADING" -> "Loading"
                "ASSIGNED" -> "Assigned"
                else -> "In Queue"
            }
            if (displayStatus != "DELIVERED") {
                binding.statusBadge.setCardBackgroundColor(
                    when (displayStatus) {
                        "IN TRANSIT" -> ContextCompat.getColor(this, R.color.sysu_blue)
                        "LOADED" -> ContextCompat.getColor(this, R.color.sysu_green)
                        "LOADING" -> ContextCompat.getColor(this, R.color.sysu_amber)
                        "ASSIGNED" -> ContextCompat.getColor(this, R.color.sysu_gold)
                        else -> ContextCompat.getColor(this, android.R.color.transparent)
                    }
                )
            }

            //  Ticket icon — ticket, tint varies by status
            binding.ivQueueIcon.setImageResource(R.drawable.ticket_1)
            if (displayStatus != "DELIVERED") {
                binding.ivQueueIcon.setColorFilter(
                    ContextCompat.getColor(this, when (displayStatus) {
                        "IN TRANSIT" -> R.color.sysu_blue
                        "LOADED" -> R.color.sysu_green
                        "LOADING" -> R.color.sysu_amber
                        "ASSIGNED" -> R.color.sysu_blue
                        else -> R.color.sysu_red
                    })
                )
            }

            //  Label
            binding.tvQueueStatusLabel.text = when (displayStatus) {
                "IN TRANSIT" -> "On the road"
                "DELIVERED" -> "Completed"
                "LOADED" -> "Ready"
                "LOADING" -> "Loading"
                "ASSIGNED" -> "Ready"
                else -> when (queueStatus) {
                    "waiting" -> position?.toString() ?: "Waiting"
                    "called" -> "Called!"
                    else -> ""
                }
            }
            binding.tvQueueStatusLabel.visibility = if (binding.tvQueueStatusLabel.text.isNotEmpty()) View.VISIBLE else View.GONE

            //  Detail line
            binding.tvQueueDetails.text = when (displayStatus) {
                "IN TRANSIT" -> "Shipment #${firstShipmentId ?: "—"} • On the road"
                "DELIVERED" -> "Shipment #${firstShipmentId ?: "—"} • All items delivered"
                "LOADED" -> "Shipment #${firstShipmentId ?: "—"} • Verified & ready"
                "LOADING" -> if (firstShipmentId != null) {
                    "Shipment #$firstShipmentId • Being loaded"
                } else {
                    "LOADING... • Please wait"
                }
                "ASSIGNED" -> "Shipment #${firstShipmentId ?: "—"} • $truckType"
                else -> when (queueStatus) {
                    "waiting" -> "Waiting in Queue • $truckType"
                    "called" -> "YOU ARE CALLED! • Proceed to bay"
                    else -> "Status: ${queueStatus.uppercase()} • $truckType"
                }
            }
            binding.tvQueueDetails.visibility = View.VISIBLE

            //  Show cancel queue only when driver is still waiting (not yet assigned/loading/loaded/transit)
            val canCancel = isInQueue && !hasShipment &&
                displayStatus !in listOf("ASSIGNED", "LOADING", "LOADED", "IN TRANSIT", "DELIVERED")
            binding.dividerCancelQueue.visibility = if (canCancel) View.VISIBLE else View.GONE
            binding.cancelQueueContainer.visibility = if (canCancel) View.VISIBLE else View.GONE
        }
    }

    //  Cancel Queue

    /** Shows the dual-confirmation cancel queue dialog with professional styling. */
    private fun showCancelQueueDialog() {
        val inflater = LayoutInflater.from(this)

        //  Step 1: Soft confirmation
        val confirmView = inflater.inflate(R.layout.dialog_cancel_confirm, null)
        val confirmDialog = AlertDialog.Builder(this)
            .setView(confirmView)
            .setCancelable(true)
            .create()

        confirmView.findViewById<View>(R.id.btn_cancel_1).setOnClickListener {
            confirmDialog.dismiss()
        }

        confirmView.findViewById<View>(R.id.btn_confirm_1).setOnClickListener {
            confirmDialog.dismiss()
            //  Step 2: Final warning
            val finalView = inflater.inflate(R.layout.dialog_cancel_final, null)
            val finalDialog = AlertDialog.Builder(this)
                .setView(finalView)
                .setCancelable(true)
                .create()

            finalView.findViewById<View>(R.id.btn_cancel_2).setOnClickListener {
                finalDialog.dismiss()
            }

            finalView.findViewById<View>(R.id.btn_confirm_2).setOnClickListener {
                finalDialog.dismiss()
                performQueueCancellation()
            }

            finalDialog.show()
        }

        confirmDialog.show()
    }

    /** Cancels the driver's own queue entry through the authenticated MySQL API. */
    private fun performQueueCancellation() {
        if (queueCancellationPending) return
        val queueId = currentQueueDocId
        if (queueId.isNullOrBlank()) {
            Toast.makeText(this, R.string.cancel_queue_error, Toast.LENGTH_SHORT).show()
            return
        }
        queueCancellationPending = true
        val session = SessionManager(this)
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    com.sysu.go.network.QRApiService.cancelOwnQueue(this@MainActivity, queueId)
                }
                SocketManager.emitOfflineStatus(session.getDriverId(), session.getDriverName())
                Log.d(TAG, "Queue cancellation committed for queueId=$queueId")
            } catch (error: Exception) {
                Log.e(TAG, "Queue cancellation failed: ${error.message}")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MainActivity, "queue-subscription", error)
            } finally {
                queueCancellationPending = false
            }
        }
    }

    //  Connection Monitor for offline popup

    private fun registerConnectionMonitor() {
        connectionReceiver?.let { return }  // already registered
        connectionReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != ConnectivityManager.CONNECTIVITY_ACTION) return
                val activeNetwork: NetworkInfo? = (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).activeNetworkInfo
                val isConnected = activeNetwork?.isConnected == true
                Log.d(TAG, "[ConnectionMonitor] isConnected=$isConnected")
                if (!isConnected && !isOfflineDialogShowing) {
                    isOfflineDialogShowing = true
                    SocketManager.emitOfflineStatus(
                        SessionManager(this@MainActivity).getDriverId() ?: return,
                        SessionManager(this@MainActivity).getDriverName() ?: "Driver"
                    )
                    runOnUiThread { showOfflineDialog() }
                }
            }
        }
        val filter = IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION)
        registerReceiver(connectionReceiver, filter)
    }

    private fun unregisterConnectionMonitor() {
        connectionReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Exception) {}
        }
        connectionReceiver = null
    }

    private fun showOfflineDialog() {
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_info, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_internet)
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Walang Internet Connection"
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Ikaw ay OFFLINE na sa tracker. Maaring makita ka ng dispatch bilang OFFLINE (pula) sa kanilang mapa. Babalik ka lang sa GREEN kapag may internet ka na."
        val dialog = AlertDialog.Builder(this).setView(dlgView).setCancelable(false).create()
        dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener {
            isOfflineDialogShowing = false
            dialog.dismiss()
        }
        dialog.show()
    }

    //  Start Trip (Batch execution after all shipments confirmed)

    /** Shows the final confirmation dialog before starting the trip. */
    private fun showStartTripDialog() {
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_confirm)
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = getString(R.string.confirm_start_trip_title)
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = getString(R.string.confirm_start_trip_message)
        val dialog = AlertDialog.Builder(this).setView(dlgView).create()
        dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
            text = getString(R.string.btn_start_trip)
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MainActivity, R.color.sysu_red))
            setOnClickListener { dialog.dismiss(); performBatchStartTrip() }
        }
        dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
        dialog.show()
    }

    /**
     * Batch-updates all confirmed shipments (guardVerified && driverConfirmed)
     * to tripStatus = "in_transit", then launches MyTripActivity for the first one.
     */
    private fun performBatchStartTrip() {
        val confirmed = currentShipments.filter { it.guardVerified && it.driverConfirmed }
        if (confirmed.isEmpty()) {
            Toast.makeText(this, "Walang kumpirmadong shipment na ma-i-start.", Toast.LENGTH_SHORT).show()
            return
        }

        val session = SessionManager(this)
        val firstDocId = confirmed.first().docId
        //  Mark first shipment as active in session ( MyTripActivity reads this )
        session.saveActiveSapDocId(firstDocId)
        session.saveCurrentSapDocId(firstDocId)
        session.setTripActive(true)

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.startTrip(this@MainActivity, null, firstDocId)
                }
                Log.d(TAG, "Batch startTrip: ${confirmed.size} shipment(s) → in_transit")
                //  Navigate to GeneralTrackingActivity
                val intent = Intent(this@MainActivity, GeneralTrackingActivity::class.java).apply {
                    putExtra("shipment_doc_id", firstDocId)
                }
                startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Batch startTrip failed: ${e.message}")
                session.saveActiveSapDocId(null)
                session.clearCurrentSapDocId()
                session.setTripActive(false)
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MainActivity, "trip-start", e)
            }
        }
    }

    //  Heartbeat monitoring methods
    private fun startHeartbeatMonitoring() {
        heartbeatHandler.post(heartbeatRunnable)
    }

    private fun stopHeartbeatMonitoring() {
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterConnectionMonitor()
        TrackingStateMonitor.removeListener(trackingStateListener)
        invalidateQueueLoad()
        myTripCardsListener?.invoke()
        positionJob?.cancel()
        assignmentListener?.invoke()
        stopCircleAnimations()
        bounceArrowAnimator?.cancel()
        bounceArrowAnimator = null
        stopPulseRings()
        stopStatusDot()
        stopHeartbeatMonitoring()
        //  Defensive: clear queue doc reference so stale IDs can't be used post-destroy
        currentQueueDocId = null
    }

    /**
     * Safely starts LocationServices with runtime permission verification and OS exception handling.
     * Prevents ForegroundServiceStartNotAllowedException on Android 14+ (API 34/35).
     */
    private fun safeStartLocationServices() {
        if (!PermissionHelper.hasLocationPermission(this)) {
            Log.w(TAG, "Location permission not granted — deferring LocationServices start until granted")
            return
        }
        try {
            val intent = Intent(this, LocationServices::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            Log.i(TAG, "LocationServices started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start LocationServices safely: ${e.message}", e)
            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this, "location-tracking-start", e)
        }
    }

    //  My Trip Tab

    /**
     * Updates bottom nav icon tints to reflect the active tab.
     * isHomeTab=true  → Home tab selected (red highlight on ivHome, muted on ivProfile)
     * isHomeTab=false → Profile/My Trip tab selected (red highlight on ivProfile, muted on ivHome)
     */
    private fun updateBottomNavSelectionForTab(isHomeTab: Boolean) {
        if (isHomeTab) {
            binding.ivHome.setColorFilter(ContextCompat.getColor(this, R.color.sysu_red))
            binding.ivProfile.setColorFilter(ContextCompat.getColor(this, R.color.text_muted))
        } else {
            binding.ivHome.setColorFilter(ContextCompat.getColor(this, R.color.text_muted))
            binding.ivProfile.setColorFilter(ContextCompat.getColor(this, R.color.sysu_red))
        }
    }

    /**
     * Fetches all sap_assignments for the current driver and populates the My Trip tab
     * RecyclerView using MyTripTabAdapter. Also updates the trip count and handles
     * empty state visibility.
     */
    private fun fetchAndSetupMyTripCards() {
        initMyTripTabAnimations()
        val driverId = SessionManager(this).getDriverId() ?: return

        val tabContainer = binding.myTripTabContainer
        val tabRv = tabContainer.findViewById<RecyclerView>(R.id.rvShipments)
        val emptyState = tabContainer.findViewById<LinearLayout>(R.id.emptyState)
        val aggregateBadgeContainer = tabContainer.findViewById<LinearLayout>(R.id.aggregateBadgeContainer)
        val tvAggregateBadge = tabContainer.findViewById<TextView>(R.id.tvAggregateBadge)
        val badgeVerified = tabContainer.findViewById<LinearLayout>(R.id.badgeVerified)
        val tvBadgeText = tabContainer.findViewById<TextView>(R.id.tvBadgeText)

        myTripCardsListener?.invoke()
        myTripCardsListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
            val rows = (payload as? List<*>)?.mapNotNull(::stringKeyedMap) ?: return@subscribeRealtime
            if (isFinishing || isDestroyed) return@subscribeRealtime
            val assignments = rows.mapNotNull { assignmentFromSql(it, driverId) }.filter { assignment ->
                com.sysu.go.model.QueueShipmentPolicy.isCurrentShipment(
                    assignment.tripStatus,
                    null,
                    assignment.queueId,
                    currentQueueDocId,
                    currentQueueStatus,
                    rows.firstOrNull { (it["id"] ?: it["dispatchKey"]) == assignment.docId }
                        ?.get("assignedAt")?.let(::timestampMillis),
                    currentQueueEnteredAtMillis,
                )
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                enrichMyTripAssignments(driverId, assignments) { enriched ->
                val inTransit = enriched.find { it.tripStatus == "in_transit" }
                val hasActiveTrip = inTransit != null

                val shipmentAdapter = com.sysu.go.adapter.MyTripTabAdapter(
                    initialHasActiveTrip = hasActiveTrip,
                    activeShipmentId = inTransit?.docId,
                    onTripActionClicked = { assignment, action ->
                        when (action) {
                            "START_LOADING" -> {
                                lifecycleScope.launch {
                                    try {
                                        withContext(Dispatchers.IO) {
                                            com.sysu.go.network.AssignmentApiService.update(
                                                this@MainActivity, assignment.docId, mapOf("status" to "loading")
                                            )
                                        }
                                        fetchAndSetupMyTripCards()
                                    } catch (e: Exception) {
                                        Log.e(TAG, "START_LOADING error: ${e.message}")
                                        com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MainActivity, "shipment-state-transition", e)
                                    }
                                }
                            }
                            "FULLY_LOADED" -> {
                                lifecycleScope.launch {
                                    try {
                                        withContext(Dispatchers.IO) {
                                            com.sysu.go.network.AssignmentApiService.update(
                                                this@MainActivity, assignment.docId, mapOf("status" to "fully_loaded")
                                            )
                                        }
                                        //  Notify backend via socket: truck is fully loaded
                                        SocketManager.emitDriverFull(true)
                                        fetchAndSetupMyTripCards()
                                    } catch (e: Exception) {
                                        Log.e(TAG, "FULLY_LOADED error: ${e.message}")
                                        com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MainActivity, "shipment-state-transition", e)
                                    }
                                }
                            }
                            "VERIFY_GUARD" -> {
                                val intent = Intent(this, AssignmentActivity::class.java).apply {
                                    putExtra("shipment_doc_id", assignment.docId)
                                }
                                startActivity(intent)
                            }
                            "OPEN_ACTIVE_TRIP" -> {
                                val intent = Intent(this, QueueDetailsActivity::class.java).apply {
                                    putExtra("shipment_doc_id", assignment.docId)
                                }
                                startActivity(intent)
                            }
                            "START_TRIP" -> {
                                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
                                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_confirm)
                                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = getString(R.string.confirm_start_trip_title)
                                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = getString(R.string.confirm_start_trip_message)
                                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                                dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                                    text = getString(R.string.btn_start_trip)
                                    backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MainActivity, R.color.sysu_red))
                                    setOnClickListener { dialog.dismiss(); startSingleShipment(assignment.docId) }
                                }
                                dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
                                dialog.show()
                            }
                        }
                    },
                    onObdTap = { lineItems, docId ->
                        openObdBottomSheet(lineItems, docId)
                    },
                    onShowVerification = { _ -> }
                )

                tabRv.layoutManager = LinearLayoutManager(this)
                tabRv.adapter = shipmentAdapter

                //  Update aggregate badge: show green "All Confirmed" if all trips ready
                val allConfirmed = enriched.isNotEmpty() && enriched.all { it.guardVerified && it.driverConfirmed }
                if (allConfirmed) {
                    aggregateBadgeContainer?.visibility = View.VISIBLE
                    aggregateBadgeContainer?.setBackgroundResource(R.drawable.bg_status_pill_green)
                    tvAggregateBadge?.text = getString(R.string.assignment_badge_all_verified)
                    tvAggregateBadge?.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.white))
                    //  Red banner badge: "TRIPS READY"
                    badgeVerified?.visibility = View.VISIBLE
                    tvBadgeText?.text = getString(R.string.my_trip_badge_trips_ready)
                } else if (enriched.isNotEmpty()) {
                    val pending = enriched.count { !it.guardVerified || !it.driverConfirmed }
                    aggregateBadgeContainer?.visibility = View.VISIBLE
                    aggregateBadgeContainer?.setBackgroundResource(R.drawable.bg_status_pill_amber)
                    tvAggregateBadge?.text = "$pending pending"
                    tvAggregateBadge?.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_amber))
                    badgeVerified?.visibility = View.GONE
                }

                emptyState.visibility = if (enriched.isEmpty()) View.VISIBLE else View.GONE
                tabRv.visibility = if (enriched.isEmpty()) View.GONE else View.VISIBLE
                }
            }
        }, onError = { error ->
            Log.e(TAG, "fetchAndSetupMyTripCards: $error")
            com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@MainActivity, "assignment-subscription")
        })
    }

    /** Enriches SQL assignment data with the authenticated driver's profile requirements. */
    private fun enrichMyTripAssignments(
        driverId: String,
        assignments: List<Assignment>,
        onReady: (List<Assignment>) -> Unit
    ) {
        if (assignments.isEmpty()) { onReady(assignments); return }
        lifecycleScope.launch {
            val enriched = runCatching {
                val profile = withContext(Dispatchers.IO) {
                    com.sysu.go.network.DriverProfileApiService.getOwn(this@MainActivity)
                }
                if (SessionManager(this@MainActivity).getDriverId() != driverId) return@launch
                val company = Sanitizer.sanitizeCompanyName(profile.truckingCompany)
                assignments.map { assignment ->
                    assignment.copy(
                        requirements = profile.requirements,
                        truckCompany = company.ifBlank { assignment.truckCompany },
                    )
                }
            }.getOrElse { error ->
                Log.w(TAG, "Driver profile unavailable; using assignment metadata: ${error.message}")
                assignments
            }
            if (!isFinishing && SessionManager(this@MainActivity).getDriverId() == driverId) onReady(enriched)
        }
    }

    private fun stringKeyedMap(value: Any?): Map<String, Any?>? {
        val map = value as? Map<*, *> ?: return null
        return map.entries.mapNotNull { (key, item) -> (key as? String)?.let { it to item } }.toMap()
    }

    private fun assignmentFromSql(data: Map<String, Any?>, driverId: String): Assignment? {
        val docId = (data["id"] as? String)?.takeIf(String::isNotBlank)
            ?: (data["dispatchKey"] as? String)?.takeIf(String::isNotBlank)
            ?: return null
        val lineItems = (data["lineItems"] as? List<*>)?.mapNotNull(::stringKeyedMap).orEmpty()
        @Suppress("UNCHECKED_CAST")
        val typedLineItems = lineItems as List<Map<String, Any>>
        val firstItem = lineItems.firstOrNull()
        val tripStatus = data["tripStatus"] as? String
        return Assignment(
            docId = docId,
            queueId = data["queueId"] as? String ?: "",
            driverId = driverId,
            status = data["status"] as? String ?: tripStatus.orEmpty(),
            tripStatus = tripStatus,
            plateNumber = data["truckPlate"] as? String ?: data["plateNumber"] as? String ?: "",
            truckType = data["truckType"] as? String ?: "",
            truckCompany = data["truckCompany"] as? String ?: "",
            helper = data["helper"] as? String ?: data["helperName"] as? String ?: "",
            guardVerified = data["guardVerified"] as? Boolean ?: false,
            driverConfirmed = data["driverConfirmed"] as? Boolean ?: false,
            guardFirstName = data["guardFirstName"] as? String ?: "",
            guardLastName = data["guardLastName"] as? String ?: "",
            guardSignature = data["guardSignatureBase64"] as? String ?: "",
            guardMI = data["guardMI"] as? String ?: "",
            guardVerifiedAtMs = timestampMillis(data["guardVerifiedAt"]) ?: 0L,
            deliveryTimestamp = parseODataDate(firstItem?.get("actualDelDate") as? String),
            obdCount = lineItems.size,
            lineItems = typedLineItems,
            obdNumber = firstItem?.get("obdNumber") as? String ?: "",
            shipmentNumberRaw = data["shipmentNumber"] as? String ?: "",
        )
    }

    /**
     * Opens the OBD items bottom sheet for a given shipment.
     */
    private fun openObdBottomSheet(lineItems: List<Map<String, Any>>, shipmentDocId: String) {
        if (lineItems.isEmpty()) {
            Toast.makeText(this, "Walang available na OBD items", Toast.LENGTH_SHORT).show()
            return
        }
        ObdItemsBottomSheet.newInstance(
            lineItems = lineItems,
            shipmentDocId = shipmentDocId,
            rowLayoutType = RowLayoutType.DETAIL,
            podCaptureEnabled = false,  // read-only in My Queue tab
            onItemClick = null,
            onObdCameraTap = null
        ).show(supportFragmentManager, ObdItemsBottomSheet.TAG)
    }

    /**
     * Starts one shipment through the authenticated assignment API.
     * Used when the driver taps START TRIP on a confirmed-but-not-yet-active shipment
     * from the My Trip tab.
     */
    private fun startSingleShipment(docId: String) {
        lifecycleScope.launch {
            try {
                val previous = currentShipments.firstOrNull { it.tripStatus == "in_transit" }?.docId
                    ?.takeIf { it != docId }
                withContext(Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.startTrip(this@MainActivity, previous, docId)
                }
            Toast.makeText(this@MainActivity, "Nagsimula na ang biyahe!", Toast.LENGTH_SHORT).show()
            //  Navigate to GeneralTrackingActivity
            val intent = Intent(this@MainActivity, GeneralTrackingActivity::class.java).apply {
                putExtra("shipment_doc_id", docId)
            }
            startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "startSingleShipment failed: ${e.message}")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MainActivity, "trip-start", e)
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
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MainActivity, R.color.sysu_red))
            setOnClickListener { dialog.dismiss()
                //  Stop foreground service so app is no longer tracked
                stopService(Intent(this@MainActivity, LocationServices::class.java))
                val session = SessionManager(this@MainActivity)
                val token = session.getAuthToken()
                SocketManager.disconnect()
                session.clearSession()
                token?.let { authToken -> lifecycleScope.launch {
                    withContext(Dispatchers.IO) { runCatching { MysqlAuthClient().logout(authToken) } }
                } }
                val intent = Intent(this@MainActivity, LoginActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                startActivity(intent)
                finish()
            }
        }
        dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
        dialog.show()
    }
}
