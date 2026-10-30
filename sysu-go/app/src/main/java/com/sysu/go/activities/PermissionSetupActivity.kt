package com.sysu.go.activities

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.sysu.go.R
import com.sysu.go.databinding.ActivityPermissionSetupBinding
import com.sysu.go.utils.PermissionHelper

/**
 * Permission setup wizard — "Safety Protocol" design.
 *
 * Shown on first login (guarded by PermissionHelper.needsSetup() in MainActivity).
 * Handles three permissions with independent rows, expandable tutorial hints,
 * and a full success-flow with countdown overlay.
 *
 * Each row:
 *  - Tap anywhere to request that permission
 *  - Tap chevron to expand a "how to enable" tutorial hint
 *  - Left accent bar + icon container both turn green when granted
 *  - Chip switches from red "Required" → green "Granted"
 *
 * "Enable All" button requests the first missing permission in order.
 * All-granted triggers animated success overlay + auto-navigate after 1.5s.
 * "Skip" marks setup seen and bypasses to MainActivity.
 */
class PermissionSetupActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPermissionSetupBinding
    private val handler = Handler(Looper.getMainLooper())

    //  Expand state
    private var expandedId: Int? = null
        set(value) {
            field = value
            syncHintExpansion()
        }

    //  Permission launchers
    private val locationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        Log.i(TAG, "Location result: $results")
        onPermissionResult(
            hasLocation = PermissionHelper.hasLocationPermission(this),
            hasNotification = PermissionHelper.hasNotificationPermission(this),
            hasBattery = PermissionHelper.hasBatteryOptimizationDisabled(this)
        )
    }

    private val notificationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        Log.i(TAG, "Notification result")
        onPermissionResult(
            hasLocation = PermissionHelper.hasLocationPermission(this),
            hasNotification = PermissionHelper.hasNotificationPermission(this),
            hasBattery = PermissionHelper.hasBatteryOptimizationDisabled(this)
        )
    }

    private val batteryLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { _ ->
        Log.i(TAG, "Battery result")
        onPermissionResult(
            hasLocation = PermissionHelper.hasLocationPermission(this),
            hasNotification = PermissionHelper.hasNotificationPermission(this),
            hasBattery = PermissionHelper.hasBatteryOptimizationDisabled(this)
        )
    }

    //  Lifecycle
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        binding = ActivityPermissionSetupBinding.inflate(layoutInflater)
        setContentView(binding.root)

        syncAllUI()
        wireClicks()
        wireChevrons()
        startBounceAnimations()
    }

    /** Kick off the floating circle bounce animations with staggered timing */
    private fun startBounceAnimations() {
        val circles = listOf(
            binding.bounceCircle1 to R.anim.bounce1,
            binding.bounceCircle2 to R.anim.bounce2,
            binding.bounceCircle3 to R.anim.bounce3,
            binding.bounceCircle4 to R.anim.bounce4
        )
        circles.forEach { (view, animRes) ->
            view.startAnimation(
                android.view.animation.AnimationUtils.loadAnimation(this, animRes)
            )
        }
    }

    override fun onResume() {
        super.onResume()
        syncAllUI()
    }

    //  Click wiring
    private fun wireClicks() {
        //  Row taps — request permission directly
        binding.itemLocation.setOnClickListener { requestLocation() }
        binding.itemNotification.setOnClickListener { requestNotification() }
        binding.itemBattery.setOnClickListener { requestBatteryOptimization() }

        //  Global CTA
        binding.btnGrantAll.setOnClickListener { onMainCTAClick() }

        //  Skip
        binding.tvSkip.setOnClickListener { skipAndGoToMain() }
    }

    /** Expand/collapse tutorial hints via chevron tap. */
    private fun wireChevrons() {
        fun toggle(id: Int) {
            expandedId = if (expandedId == id) null else id
        }
        binding.chevronLocation.setOnClickListener { toggle(R.id.itemLocation) }
        binding.chevronNotification.setOnClickListener { toggle(R.id.itemNotification) }
        binding.chevronBattery.setOnClickListener { toggle(R.id.itemBattery) }
    }

    //  Permission request dispatchers
    private fun requestLocation() {
        locationLauncher.launch(
            arrayOf(
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
    }

    private fun requestNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        } else {
            //  Pre-13: already granted
            onPermissionResult(
                hasLocation = PermissionHelper.hasLocationPermission(this),
                hasNotification = true,
                hasBattery = PermissionHelper.hasBatteryOptimizationDisabled(this)
            )
        }
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryOptimization() {
        if (PermissionHelper.hasBatteryOptimizationDisabled(this)) {
            onPermissionResult(
                hasLocation = PermissionHelper.hasLocationPermission(this),
                hasNotification = PermissionHelper.hasNotificationPermission(this),
                hasBattery = true
            )
            return
        }
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            batteryLauncher.launch(intent)
        } catch (e: Exception) {
            Log.w(TAG, "Battery intent unavailable", e)
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (e2: Exception) {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                })
            }
        }
    }

    //  "Enable All" button logic
    private fun onMainCTAClick() {
        if (PermissionHelper.hasAllPermissions(this)) {
            showSuccessAndFinish()
            return
        }
        when {
            !PermissionHelper.hasLocationPermission(this) -> requestLocation()
            !PermissionHelper.hasNotificationPermission(this) -> requestNotification()
            !PermissionHelper.hasBatteryOptimizationDisabled(this) -> requestBatteryOptimization()
        }
    }

    //  Shared result handler
    private fun onPermissionResult(hasLocation: Boolean, hasNotification: Boolean, hasBattery: Boolean) {
        refreshAllChips()
        refreshAllIconStates()
        refreshStepDots()
        updateCTALabel()

        if (hasLocation && hasNotification && hasBattery) {
            showSuccessAndFinish()
        }
    }

    //  Chip + icon sync
    private fun syncLocationState(granted: Boolean) {
        //  Chip
        binding.chipLocation.text = if (granted) "Granted" else "Required"
        binding.chipLocation.setBackgroundResource(
            if (granted) R.drawable.bg_chip_granted else R.drawable.bg_chip_required
        )
        //  Icon container
        binding.iconLocation.setBackgroundResource(
            if (granted) R.drawable.bg_perm_icon_green else R.drawable.bg_perm_icon_gray
        )
        //  Tint icon color
        val iconTint = if (granted) R.color.transit_green else R.color.text_muted
        (binding.iconLocation.getChildAt(0) as? ImageView)?.setColorFilter(
            ContextCompat.getColor(this, iconTint)
        )
        //  Left accent
        binding.accentLocation.setBackgroundResource(
            if (granted) R.drawable.accent_granted else R.drawable.accent_required
        )
    }

    private fun syncNotificationState(granted: Boolean) {
        binding.chipNotification.text = if (granted) "Granted" else "Required"
        binding.chipNotification.setBackgroundResource(
            if (granted) R.drawable.bg_chip_granted else R.drawable.bg_chip_required
        )
        binding.iconNotification.setBackgroundResource(
            if (granted) R.drawable.bg_perm_icon_green else R.drawable.bg_perm_icon_gray
        )
        val iconTint = if (granted) R.color.transit_green else R.color.text_muted
        (binding.iconNotification.getChildAt(0) as? ImageView)?.setColorFilter(
            ContextCompat.getColor(this, iconTint)
        )
        binding.accentNotification.setBackgroundResource(
            if (granted) R.drawable.accent_granted else R.drawable.accent_required
        )
    }

    private fun syncBatteryState(granted: Boolean) {
        binding.chipBattery.text = if (granted) "Granted" else "Required"
        binding.chipBattery.setBackgroundResource(
            if (granted) R.drawable.bg_chip_granted else R.drawable.bg_chip_required
        )
        binding.iconBattery.setBackgroundResource(
            if (granted) R.drawable.bg_perm_icon_green else R.drawable.bg_perm_icon_gray
        )
        val iconTint = if (granted) R.color.transit_green else R.color.text_muted
        (binding.iconBattery.getChildAt(0) as? ImageView)?.setColorFilter(
            ContextCompat.getColor(this, iconTint)
        )
        binding.accentBattery.setBackgroundResource(
            if (granted) R.drawable.accent_granted else R.drawable.accent_required
        )
    }

    /** Called on create and on resume to reflect current OS state. */
    private fun syncAllUI() {
        refreshAllChips()
        refreshAllIconStates()
        refreshStepDots()
        updateCTALabel()
    }

    private fun refreshAllChips() {
        syncLocationState(PermissionHelper.hasLocationPermission(this))
        syncNotificationState(PermissionHelper.hasNotificationPermission(this))
        syncBatteryState(PermissionHelper.hasBatteryOptimizationDisabled(this))
    }

    private fun refreshAllIconStates() {
        syncLocationState(PermissionHelper.hasLocationPermission(this))
        syncNotificationState(PermissionHelper.hasNotificationPermission(this))
        syncBatteryState(PermissionHelper.hasBatteryOptimizationDisabled(this))
    }

    private fun refreshStepDots() {
        val loc = PermissionHelper.hasLocationPermission(this)
        val notif = PermissionHelper.hasNotificationPermission(this)
        val batt = PermissionHelper.hasBatteryOptimizationDisabled(this)

        val grantedCount = listOf(loc, notif, batt).count { it }
        val totalSteps = 3

        //  Update step counter text
        val currentStep = when {
            !loc -> 1
            !notif -> 2
            !batt -> 3
            else -> 3
        }
        binding.tvStepCounter.text = getString(R.string.perm_step_label, currentStep, totalSteps)

        //  Animate dot changes
        fun updateDot(view: View, active: Boolean) {
            view.setBackgroundResource(if (active) R.drawable.dot_active else R.drawable.dot_inactive)
        }
        updateDot(binding.dot1, loc)
        updateDot(binding.dot2, notif)
        updateDot(binding.dot3, batt)
    }

    private fun updateCTALabel() {
        binding.btnGrantAll.text = if (PermissionHelper.hasAllPermissions(this)) {
            getString(R.string.perm_continue)
        } else {
            getString(R.string.perm_enable_all)
        }
    }

    //  Hint expansion UI
    private fun syncHintExpansion() {
        listOf(
            R.id.hintLocation to R.id.chevronLocation,
            R.id.hintNotification to R.id.chevronNotification,
            R.id.hintBattery to R.id.chevronBattery
        ).forEach { (hintId, chevronId) ->
            val hint = findViewById<TextView>(hintId)
            val chevron = findViewById<ImageView>(chevronId)
            val isOpen = expandedId != null && isHintForId(hintId, expandedId!!)

            hint.visibility = if (isOpen) View.VISIBLE else View.GONE
            animateChevron(chevron, isOpen)
        }
    }

    private fun isHintForId(hintId: Int, rowId: Int): Boolean {
        return when (hintId) {
            R.id.hintLocation -> rowId == R.id.itemLocation
            R.id.hintNotification -> rowId == R.id.itemNotification
            R.id.hintBattery -> rowId == R.id.itemBattery
            else -> false
        }
    }

    private fun animateChevron(chevron: ImageView?, expanded: Boolean) {
        chevron ?: return
        val targetRotation = if (expanded) 180f else 0f
        chevron.animate()
            .rotation(targetRotation)
            .setDuration(220)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()
    }

    //  Success flow
    private fun showSuccessAndFinish() {
        PermissionHelper.markSetupCompleted(this)

        //  Fade in the success overlay
        binding.successOverlay.alpha = 0f
        binding.successOverlay.visibility = View.VISIBLE
        binding.successOverlay.animate()
            .alpha(1f)
            .setDuration(350)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()

        //  Pulse the redirecting dots
        startPulseAnimation()

        binding.btnGrantAll.text = getString(R.string.perm_continue)
        binding.btnGrantAll.isEnabled = false

        handler.postDelayed({ navigateToMain() }, 1500L)
    }

    private fun startPulseAnimation() {
        val overlay = binding.successOverlay
        val pulseViews = mutableListOf<View>()
        //  Find all views tagged "pulse" inside the overlay
        for (i in 0 until overlay.childCount) {
            val child = overlay.getChildAt(i)
            if ("pulse" == child.tag) pulseViews.add(child)
            //  Also check direct LinearLayout children (the dot container)
            if (child is android.view.ViewGroup) {
                for (j in 0 until child.childCount) {
                    val sub = child.getChildAt(j)
                    if ("pulse" == sub.tag) pulseViews.add(sub)
                }
            }
        }
        pulseViews.forEachIndexed { index, dot ->
            handler.postDelayed({
                dot.startAnimation(
                    android.view.animation.AnimationUtils.loadAnimation(this@PermissionSetupActivity, R.anim.dot_pulse)
                )
            }, (index * 150).toLong())
        }
    }

    //  Navigation
    private fun skipAndGoToMain() {
        PermissionHelper.markSetupCompleted(this)
        navigateToMain()
    }

    private fun navigateToMain() {
        startActivity(Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
    }

    companion object {
        private const val TAG = "PermissionSetup"
    }
}