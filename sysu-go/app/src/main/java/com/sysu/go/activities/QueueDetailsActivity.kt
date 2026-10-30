package com.sysu.go.activities

import android.os.Bundle
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.sysu.go.R
import com.sysu.go.databinding.ActivityQueueDetailsBinding
import com.sysu.go.utils.KeyboardUtils
import com.sysu.go.utils.SessionManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.sysu.go.utils.ImageStorageHelper
import com.sysu.go.utils.PodPhotoTempFile
import java.io.File
import android.net.Uri
import androidx.core.content.FileProvider
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.app.Dialog
import android.Manifest
import android.content.pm.PackageManager
import androidx.fragment.app.DialogFragment
import android.graphics.Typeface
import android.util.Base64
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationResult
import android.os.Looper
import android.content.Intent
import com.sysu.go.network.SocketManager

class QueueDetailsActivity : AppCompatActivity() {

    private lateinit var binding: ActivityQueueDetailsBinding
    private var currentSapDocId: String = ""
    private var currentTripStatus: String = ""
    private var isSpecificShipmentMode: Boolean = false  // true when opened from My Queue card with specific shipment
    private var currentLineItems: List<Map<String, Any?>> = emptyList()
    private var hasShipment: Boolean = false   // true only when sap_assignment doc is loaded
    private var queueDriverId: String = ""
    private var queueListener: (() -> Unit)? = null
    private var assignmentListener: (() -> Unit)? = null
    private var hasLoadedDetails = false
    private var positionJob: kotlinx.coroutines.Job? = null
    private var currentQueueStatus: String = ""

    //  POD Launchers
    private lateinit var takePictureLauncher: androidx.activity.result.ActivityResultLauncher<Uri>
    private lateinit var cameraPermissionLauncher: androidx.activity.result.ActivityResultLauncher<String>
    private lateinit var locationPermissionLauncher: androidx.activity.result.ActivityResultLauncher<String>

    //  Location client for POD
    private lateinit var fusedLocationClient: FusedLocationProviderClient

    //  POD State Variables
    private var pendingObdItem: Map<String, Any?>? = null
    private var pendingObdGroupItems: List<Map<String, Any?>> = emptyList()
    private var pendingObdShipmentDocId: String? = null
    private var pendingCapturedAtMillis: Long = 0L
    private var pendingPodData: PendingPodData? = null
    private var pendingPhotoFile: File? = null
    private var uploadProgressDialog: android.app.AlertDialog? = null

    //  Data Class for POD State
    private data class PendingPodData(
        val status: String,
        val lineItem: Map<String, Any?>,
        val shipmentDocId: String,
        val capturedAtMillis: Long,
        val latitude: Double? = null,
        val longitude: Double? = null,
        val groupLineItems: List<Map<String, Any?>> = emptyList(),
        val captureId: String? = null
    )

    //  Circle animation tracking
    private val circleAnimators = mutableListOf<android.animation.Animator>()
    private val circleViews = mutableListOf<View>()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        binding = ActivityQueueDetailsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }

        setupUI()
        startCircleAnimation()

        //  Initialize location client for POD
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        //  Initialize POD launchers
        registerPodLaunchers()

        //  Per-shipment loading: if opened from a "My Queue" card tap
        val explicitShipmentDocId = intent.getStringExtra("shipment_doc_id")
        isSpecificShipmentMode = !explicitShipmentDocId.isNullOrBlank()
        if (!explicitShipmentDocId.isNullOrBlank()) {
            loadSpecificShipment(explicitShipmentDocId)
        } else {
            loadQueueDetails()
        }
    }

    private fun startCircleAnimation() {
        circleViews.forEach { binding.circleContainer.removeView(it) }
        circleViews.clear()

        binding.circleContainer.post {
            val containerW = binding.circleContainer.width
            val containerH = binding.circleContainer.height
            if (containerW == 0 || containerH == 0) return@post

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

                val circle = View(this).apply {
                    layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
                    background = ContextCompat.getDrawable(this@QueueDetailsActivity, R.drawable.bg_circle_light_red)
                    this.alpha = alpha
                }

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

        var velX = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) *
            if (random.nextBoolean()) 1f else -1f
        var velY = (random.nextFloat() * (maxSpeed - minSpeed) + minSpeed) *
            if (random.nextBoolean()) 1f else -1f

        android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 16L
            repeatCount = android.animation.ValueAnimator.INFINITE
            this.startDelay = startDelayMs
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

        android.animation.ObjectAnimator.ofFloat(view, "scaleX", 1f, 1.08f).apply {
            duration = 4000L + random.nextInt(1500)
            repeatCount = android.animation.ObjectAnimator.INFINITE
            repeatMode = android.animation.ObjectAnimator.REVERSE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            startDelay = startDelayMs
            circleAnimators.add(this)
            start()
        }

        android.animation.ObjectAnimator.ofFloat(view, "scaleY", 1f, 1.06f).apply {
            duration = 4500L + random.nextInt(1500)
            repeatCount = android.animation.ObjectAnimator.INFINITE
            repeatMode = android.animation.ObjectAnimator.REVERSE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            startDelay = startDelayMs + 600L
            circleAnimators.add(this)
            start()
        }
    }

    override fun onDestroy() {
        queueListener?.invoke()
        assignmentListener?.invoke()
        positionJob?.cancel()
        super.onDestroy()
        circleAnimators.forEach { it.cancel() }
        circleAnimators.clear()
        circleViews.forEach { binding.circleContainer.removeView(it) }
        circleViews.clear()
        uploadProgressDialog?.dismiss()
        uploadProgressDialog = null
    }

    private fun setupUI() {
        binding.btnBack.setOnClickListener { finish() }

        binding.btnGoToTracking.setOnClickListener {
            val intent = Intent(this, GeneralTrackingActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            startActivity(intent)
            finish()
        }

        //  OBD items
        binding.cardObdItems.setOnClickListener {
            val isTrackingStarted = sessionManager.isTrackingActive()
            val sheet = ObdItemsBottomSheet.newInstance(
                lineItems = currentLineItems,
                shipmentDocId = currentSapDocId,
                rowLayoutType = RowLayoutType.POD,
                podCaptureEnabled = (currentTripStatus == "in_transit" && isTrackingStarted),
                onItemClick = { item ->
                    showObdItemDetailsDialog(item)
                },
                onObdCameraTap = { lineItem, shipmentDocId ->
                    val obd = lineItem["obdNumber"] as? String ?: return@newInstance
                    Log.d("OBD", "onObdCameraTap FIRED: obd=$obd, shipmentDocId=$shipmentDocId")
                    showObdStatusSheet(lineItem, shipmentDocId)
                },
                onGroupCameraTap = { items, shipmentDocId ->
                    items.firstOrNull()?.let { showObdStatusSheet(it, shipmentDocId, items) }
                },
                onGroupUnloadTap = { items, shipmentDocId -> startGroupUnload(items, shipmentDocId) },
                onUnloadConfirm = { lineItem, shipmentDocId ->
                    //  Handle unload confirmation - set unloadStatus to "UNLOADING" in MySQL
                    val obdNumber = lineItem["obdNumber"] as? String
                    if (obdNumber != null) {
                        lifecycleScope.launch {
                            try {
                                updateObdUnloadStatusInMySQL(
                                    shipmentDocId = shipmentDocId,
                                    lineItem = lineItem,
                                    unloadStatus = "UNLOADING"
                                )
                                //  UPDATE local state immediately
                                updateLineItemUnloadStatus(obdNumber, "UNLOADING")
                                //  REFRESH the bottom sheet to reflect changes
                                refreshObdItemsSheet()
                                Toast.makeText(
                                    this@QueueDetailsActivity,
                                    "Unload started for $obdNumber",
                                    Toast.LENGTH_SHORT
                                ).show()
                            } catch (e: Exception) {
                                Log.e("QUEUE_DETAILS", "Failed to start unload: ${e.message}")
                                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "shipment-state-transition", e)
                            }
                        }
                    }
                },
                onUnloadCancel = { lineItem, shipmentDocId ->
                    //  Handle unload cancel - set unloadStatus back to empty to return to PENDING state
                    val obdNumber = lineItem["obdNumber"] as? String
                    if (obdNumber != null) {
                        lifecycleScope.launch {
                            try {
                                updateObdUnloadStatusInMySQL(
                                    shipmentDocId = shipmentDocId,
                                    lineItem = lineItem,
                                    unloadStatus = ""  // Empty string means PENDING/UNSTARTED
                                )
                                //  UPDATE local state immediately
                                updateLineItemUnloadStatus(obdNumber, "")
                                //  REFRESH the bottom sheet to reflect changes
                                refreshObdItemsSheet()
                                Toast.makeText(
                                    this@QueueDetailsActivity,
                                    "Unload cancelled for $obdNumber",
                                    Toast.LENGTH_SHORT
                                ).show()
                            } catch (e: Exception) {
                                Log.e("QUEUE_DETAILS", "Failed to cancel unload: ${e.message}")
                                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "shipment-state-transition", e)
                            }
                        }
                    }
                },
                onRetakeTap = { lineItem, shipmentDocId ->
                    android.app.AlertDialog.Builder(this@QueueDetailsActivity)
                        .setTitle("Are you sure to retake POD?")
                        .setMessage("Warning, previous pictures will be deleted if you proceed!!")
                        .setPositiveButton("Proceed") { _, _ ->
                            //  Handle retake - reset POD data and restart the POD capture flow
                            val obdNumber = lineItem["obdNumber"] as? String
                            if (obdNumber != null) {
                                lifecycleScope.launch {
                                    try {
                                        //  Reset POD data to allow retake (sets unloadStatus to UNLOADING)
                                        resetPodDataForRetake(shipmentDocId, lineItem)
                                        //  UPDATE local state with ALL POD fields reset
                                        updateLineItemForRetake(obdNumber)
                                        //  REFRESH the bottom sheet to reflect changes
                                        refreshObdItemsSheet()
                                        Toast.makeText(
                                            this@QueueDetailsActivity,
                                            "Ready to retake POD for $obdNumber",
                                            Toast.LENGTH_SHORT
                                        ).show()
                                    } catch (e: Exception) {
                                        Log.e("QUEUE_DETAILS", "Failed to reset POD for retake: ${e.message}")
                                        com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "pod-save", e)
                                    }
                                }
                            }
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
            )
            sheet.show(supportFragmentManager, ObdItemsBottomSheet.TAG)
        }
    }

    private fun loadQueueDetails() {
        val sessionDriverId = sessionManager.getDriverId() ?: return
        showDetailsLoading()
        queueListener?.invoke()
        SocketManager.connect(this)
        queueListener = SocketManager.subscribeRealtime("queue", onData = { payload ->
            val records = payload as? List<*> ?: return@subscribeRealtime
            val queueRecords = records.mapNotNull { it as? Map<String, Any?> }
            val preferredQueueId = sessionManager.getCurrentQueueDocId()
            val active = queueRecords.firstOrNull { it["id"] == preferredQueueId &&
                (it["status"] as? String) in listOf("assigned", "waiting", "called", "loading", "in_transit", "fully_loaded")
            } ?: queueRecords.firstOrNull {
                (it["status"] as? String) in listOf("assigned", "waiting", "called", "loading", "in_transit", "fully_loaded")
            } ?: run {
                showDetailsLoadError("No active queue found.")
                return@subscribeRealtime
            }
            runOnUiThread {
                if (!isFinishing && !isDestroyed) processQueueRecord(active, "socket_driver_queue")
            }
        }, onError = { error ->
            Log.e("OBD", "queue realtime error: $error")
            com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@QueueDetailsActivity, "queue-subscription")
            if (!hasLoadedDetails) showDetailsLoadError("Could not load queue details. Reopen this screen to retry.")
        })
    }

    private fun loadSpecificShipment(shipmentDocId: String) {
        showDetailsLoading()
        assignmentListener?.invoke()
        SocketManager.connect(this)
        assignmentListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
            val records = payload as? List<*> ?: return@subscribeRealtime
            val shipment = records.mapNotNull { it as? Map<String, Any?> }.firstOrNull { it["id"] == shipmentDocId }
                ?: run {
                    showDetailsLoadError("Shipment details are no longer available.")
                    return@subscribeRealtime
                }
            runOnUiThread {
                if (!isFinishing && !isDestroyed) {
                    populateQueueDetailsUI(shipment)
                    hideDetailsLoading()
                }
            }
        }, onError = { error ->
            Log.e("OBD", "shipment realtime error: $error")
            com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@QueueDetailsActivity, "assignment-subscription")
            if (!hasLoadedDetails) showDetailsLoadError("Could not load shipment details. Reopen this screen to retry.")
        })
    }

    private fun showDetailsLoading() {
        binding.detailsLoadingContainer.visibility = View.VISIBLE
        binding.detailsLoadingSkeleton.root.visibility = View.VISIBLE
        binding.tvDetailsLoadError.visibility = View.GONE
    }

    private fun hideDetailsLoading() {
        hasLoadedDetails = true
        binding.detailsLoadingContainer.visibility = View.GONE
    }

    private fun showDetailsLoadError(message: String) {
        if (isFinishing || isDestroyed) return
        binding.tvDetailsLoadError.text = message
        binding.detailsLoadingContainer.visibility = View.VISIBLE
        binding.detailsLoadingSkeleton.root.visibility = View.GONE
        binding.tvDetailsLoadError.visibility = View.VISIBLE
    }
    /**
     * Populates all UI fields from a sap_assignments document.
     * sap_assignments/{shipmentNumber} — doc ID is the shipment number itself.
     * Requirements are loaded via 2-hop: driverId (queue doc ID) → queue.driverId (driver ID) → drivers.requirements.
     */
    private fun populateQueueDetailsUI(doc: Map<String, Any?>) {
        val shipmentNumber = doc["id"] as? String ?: return
        currentTripStatus = doc["tripStatus"] as? String ?: ""

        //  Banner: show shipment number as queue reference
        binding.tvQueueNumberLabel.text = "SHIPMENT"
        binding.tvQueueNumber.text = shipmentNumber

        //  Subtitle
        binding.tvSubStatus.text = "Being loaded"

        //  Details card fields from sap_assignments root
        binding.tvShipmentNumber.text = shipmentNumber
        binding.tvPlateNo.text   = doc["truckPlate"] as? String   ?: "—"
        //  tvTruckType and tvHelper come from the queue doc (loaded inside loadRequirementsAndQueueData below)

        //  Customer Requirements + Queue fields: 2-hop via queue doc
        //  sap_assignments.driverId is the driver ID, used to query queue collection by driverId field
        val driverIdFromDoc = doc["driverId"] as? String ?: ""
        if (driverIdFromDoc.isNotBlank()) {
            loadRequirementsAndQueueData(driverIdFromDoc)
        } else {
            //  Fallback: clear requirements and fields
            bindRequirement(binding.tvReqAircon, null)
            bindRequirement(binding.tvReqVest, null)
            bindRequirement(binding.tvReqHeadcap, null)
            bindRequirement(binding.tvReqSafetyShoes, null)
            bindRequirement(binding.tvReqPants, null)
            bindRequirement(binding.tvReqClosedShoes, null)
            binding.tvTruckType.text = "—"
            binding.tvHelper.text    = "—"
        }

        //  Planned Delivery: actualDelDate lives in lineItems[0] as OData string "/Date(millis)/"
        @Suppress("UNCHECKED_CAST")
        val lineItems = doc["lineItems"] as? List<Map<String, Any?>> ?: emptyList()
        val guardSignature = doc["guardSignatureBase64"] as? String ?: ""
        currentLineItems = lineItems.mapNotNull {
            it as? Map<String, Any?>
        }.map {
            it.toMutableMap().apply {
                put("guardSignature", guardSignature)
            }
        }
        val firstItem = lineItems.firstOrNull()
        val rawDate = firstItem?.get("actualDelDate") as? String
        binding.tvDeliveryDate.text = formatODataDate(rawDate)

        //  OBD count pill
        binding.tvObdCount.text = lineItems.size.toString()

        currentSapDocId = shipmentNumber
        hasShipment = true

        //  "Go to Tracking" — only show for the active trip when it's in_transit
        val activeDocId = sessionManager.getActiveSapDocId()
        if (currentSapDocId == activeDocId && currentTripStatus == "in_transit") {
            binding.btnGoToTracking.visibility = View.VISIBLE
        } else {
            binding.btnGoToTracking.visibility = View.GONE
        }
    }

    /**
     * Loads queue doc data AND driver requirements via 2-hop:
     * sap_assignments.driverId (= driver ID) → queue.driverId (driver ID) → drivers.requirements
     *
     * Also sets truckType, helper, and plateNumber from the queue doc (source of truth for these fields).
     */
    private fun loadRequirementsAndQueueData(driverUid: String) {
        binding.tvTruckType.text = "?"
        binding.tvHelper.text = "?"
        if (driverUid != sessionManager.getDriverId()) {
            clearRequirements()
            return
        }
        lifecycleScope.launch {
            try {
                val profile = withContext(Dispatchers.IO) {
                    com.sysu.go.network.DriverProfileApiService.getOwn(this@QueueDetailsActivity)
                }
                if (isFinishing || isDestroyed) return@launch
                binding.tvTruckType.text = profile.truckType.ifBlank { "?" }
                binding.tvHelper.text = profile.helper.ifBlank { "?" }
                if (profile.plateNumber.isNotBlank()) binding.tvPlateNo.text = profile.plateNumber
                bindProfileRequirements(profile.requirements)
            } catch (error: Exception) {
                Log.e("QUEUE_DETAILS", "Failed to load SQL driver profile")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "queue-load", error)
            }
        }
    }

    /** Binds a requirement TextView: green ✓ (true), gray — (false/null). */
    private fun bindRequirement(tv: android.widget.TextView, value: Boolean?) {
        if (isFinishing) return
        when (value) {
            true -> {
                tv.text = "✔"
                tv.setTextColor(ContextCompat.getColor(this, R.color.transit_green))
            }
            else -> {
                tv.text = "—"
                tv.setTextColor(ContextCompat.getColor(this, R.color.text_muted))
            }
        }
    }

    /** Parses OData date string "/Date(millis)/" into a human-readable "MMM dd, yyyy • h:mm a". */
    private fun formatODataDate(raw: String?): String {
        if (raw == null) return "—"
        return try {
            val millis = raw.removePrefix("/Date(").removeSuffix(")/").toLong()
            val sdf = java.text.SimpleDateFormat("MMM dd, yyyy • h:mm a", java.util.Locale.US)
            sdf.format(java.util.Date(millis))
        } catch (e: Exception) {
            "—"
        }
    }

    private fun processQueueRecord(doc: Map<String, Any?>, source: String) {
        if (isFinishing || isDestroyed) return
        val status = doc["status"] as? String ?: "unknown"
        currentQueueStatus = status
        positionJob?.cancel()
        positionJob = null
        Log.d("OBD", ">>> processQueueDocument source=$source status='$status'")

        binding.tvQueueNumber.text = status.replaceFirstChar {
            if (it.isLowerCase()) it.titlecase() else it.toString()
        }
        binding.tvQueueNumberLabel.visibility = View.GONE

        //  Persist queue doc ID for later lookup
        currentQueueDocId = doc["id"] as? String ?: return
        sessionManager.saveCurrentQueueDocId(currentQueueDocId!!)

        //  2-hop: queue.driverId (driver ID) → drivers.requirements
        val driverId = doc["driverId"] as? String ?: ""
        if (driverId.isNotBlank()) {
            queueDriverId = driverId
            loadRequirementsFromDriver(driverId)
        } else {
            clearRequirements()
        }

        binding.tvPlateNo.text    = doc["plateNumber"] as? String   ?: "—"
        binding.tvTruckType.text  = doc["truckType"] as? String      ?: "—"
        binding.tvHelper.text     = doc["helper"] as? String         ?: "—"
        Log.d("QUEUE_DETAILS", "Helper name from queue doc: ${binding.tvHelper.text}")

        if (status in listOf("waiting", "called") && doc["isAssigned"] != true) {
            assignmentListener?.invoke()
            assignmentListener = null
            hasShipment = false
            currentSapDocId = ""
            currentLineItems = emptyList()
            binding.tvShipmentNumber.text = "—"
            binding.tvObdCount.text = "0"
            binding.btnGoToTracking.visibility = View.GONE
            if (doc["registrationComplete"] != true) {
                hideDetailsLoading()
                binding.tvQueueNumber.text = "Complete Registration"
                binding.tvQueueNumberLabel.visibility = View.GONE
                return
            }
            positionJob = com.sysu.go.network.observeQueuePosition(this, currentQueueDocId!!) { position ->
                    if (isFinishing || isDestroyed || currentQueueDocId != doc["id"] ||
                        currentQueueStatus != status || hasShipment) return@observeQueuePosition
                    binding.tvQueueNumber.text = position?.toString() ?: "Waiting"
                    binding.tvQueueNumberLabel.visibility = if (position == null) View.GONE else View.VISIBLE
                }
            hideDetailsLoading()
            //  Waiting admissions must not load historical UID assignments over the queue number.
            return
        } else if (status == "loading") {
            binding.tvQueueNumber.text = "GO"
        }

        //  sap_assignments.driverId stores the driver ID (queue["driverId"]), NOT
        //  the queue document id (queueDocId). Use queueDriverId here, NOT currentQueueDocId.
        assignmentListener?.invoke()
        assignmentListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
            val records = payload as? List<*> ?: return@subscribeRealtime
            val assignedIds = (doc["assignedShipments"] as? List<*>)?.mapNotNull { item ->
                val fields = item as? Map<*, *> ?: return@mapNotNull null
                (fields["dispatchKey"] ?: fields["obdNumber"]) as? String
            }.orEmpty()
            val candidates = records.mapNotNull { it as? Map<String, Any?> }
            val linkedAssignments = candidates.filter { record ->
                record["queueId"] == currentQueueDocId || (record["id"] as? String) in assignedIds
            }
            val activeStatuses = setOf("assigned", "loading", "loaded", "fully_loaded", "in_transit", "returning_to_base")
            val assignment = linkedAssignments.firstOrNull { (it["tripStatus"] as? String) in activeStatuses }
                ?: linkedAssignments.firstOrNull()
                ?: candidates.filter { it["driverId"] == queueDriverId && (it["tripStatus"] as? String) in activeStatuses }
                    .singleOrNull()
            runOnUiThread {
                if (isFinishing || isDestroyed || currentQueueDocId != doc["id"] || currentQueueStatus != status) return@runOnUiThread
                if (assignment == null) {
                    hasShipment = false
                    currentLineItems = emptyList()
                    binding.tvObdCount.text = "0"
                    showDetailsLoadError("Shipment details are not available yet.")
                    return@runOnUiThread
                }
                if (!isSpecificShipmentMode) {
                    populateQueueDetailsUI(assignment)
                    hideDetailsLoading()
                    binding.tvQueueNumber.text = if (status == "loading") "GO" else "LOADING"
                    binding.tvQueueNumberLabel.visibility = View.GONE
                }
            }
        }, onError = { error ->
            Log.e("OBD", "assignment realtime error: $error")
            com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@QueueDetailsActivity, "assignment-subscription")
        })
    }
    private val sessionManager by lazy { SessionManager(this) }
    private var currentQueueDocId: String = ""

    private fun loadRequirementsFromDriver(driverId: String) {
        if (driverId.isBlank()) return
        if (driverId != sessionManager.getDriverId()) {
            clearRequirements()
            return
        }
        lifecycleScope.launch {
            try {
                val profile = withContext(Dispatchers.IO) {
                    com.sysu.go.network.DriverProfileApiService.getOwn(this@QueueDetailsActivity)
                }
                if (!isFinishing && !isDestroyed) bindProfileRequirements(profile.requirements)
            } catch (error: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "driver-profile", error)
            }
        }
    }

    private fun bindProfileRequirements(requirements: Map<String, Boolean>) {
        displayRequirement("aircon", requirements, binding.tvReqAircon)
        displayRequirement("reflectorizedVest", requirements, binding.tvReqVest)
        displayRequirement("safetyShoes", requirements, binding.tvReqSafetyShoes)
        displayRequirement("headcap", requirements, binding.tvReqHeadcap)
        displayRequirement("pants", requirements, binding.tvReqPants)
        displayRequirement("closedShoes", requirements, binding.tvReqClosedShoes)
    }

    private fun displayRequirement(
        key: String,
        reqMap: Map<String, Boolean>?,
        tv: android.widget.TextView
    ) {
        val checked = reqMap?.get(key) ?: false
        if (isFinishing) return
        tv.text = if (checked) "✔" else "—"
        tv.setTextColor(
            ContextCompat.getColor(
                this@QueueDetailsActivity,
                if (checked) R.color.transit_green else R.color.text_muted
            )
        )
    }

    private fun clearRequirements() {
        listOf(
            binding.tvReqAircon,
            binding.tvReqVest,
            binding.tvReqHeadcap,
            binding.tvReqSafetyShoes,
            binding.tvReqPants,
            binding.tvReqClosedShoes
        ).forEach { tv ->
            tv.text = "—"
            tv.setTextColor(ContextCompat.getColor(this, R.color.text_muted))
        }
        binding.tvTruckType.text = "—"
        binding.tvHelper.text    = "—"
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        KeyboardUtils.handleTouchOutsideEditText(this, ev)
        return super.dispatchTouchEvent(ev)
    }

    //
    //  POD CAPTURE INTEGRATION BLOCK
    //

    private fun registerPodLaunchers() {
        cameraPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                pendingPodData?.let { takePicture() }
            } else {
                pendingPodData = null
                pendingPhotoFile = null
                Toast.makeText(
                    this,
                    "Camera permission is required to capture POD photos.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }

        takePictureLauncher = registerForActivityResult(
            ActivityResultContracts.TakePicture()
        ) { success ->
            handleCameraResult(success)
        }

        locationPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                requestFreshLocationAndProceed()
            } else {
                proceedToCamera(null, null)
            }
        }
    }

    private fun showObdStatusSheet(
        item: Map<String, Any?>,
        shipmentDocId: String,
        groupItems: List<Map<String, Any?>> = emptyList()
    ) {
        val capturedAtMillis = System.currentTimeMillis()

        pendingObdItem = item
        pendingObdGroupItems = groupItems
        pendingObdShipmentDocId = shipmentDocId
        pendingCapturedAtMillis = capturedAtMillis

        val hasLocationPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (hasLocationPermission) {
            requestFreshLocationAndProceed()
        } else {
            Toast.makeText(
                this,
                "Location is needed to stamp your POD photo.",
                Toast.LENGTH_LONG
            ).show()

            locationPermissionLauncher.launch(
                Manifest.permission.ACCESS_FINE_LOCATION
            )
        }
    }

    private fun requestFreshLocationAndProceed() {
        val capturedAtMillis = pendingCapturedAtMillis
        val item = pendingObdItem
        val groupItems = pendingObdGroupItems
        val shipmentDocId = pendingObdShipmentDocId

        if (item == null || shipmentDocId == null) {
            proceedToCamera(null, null)
            return
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Location permission is required for POD capture", Toast.LENGTH_LONG).show()
            return
        }
        try {
        //  Try to get last known location first
        fusedLocationClient.lastLocation
            .addOnSuccessListener { location ->
                if (location != null) {
                    proceedToCamera(
                        location.latitude,
                        location.longitude,
                        capturedAtMillis,
                        item,
                        shipmentDocId,
                        groupItems
                    )
                } else {
                    //  Fallback if no cached location
                    proceedToCamera(
                        null,
                        null,
                        capturedAtMillis,
                        item,
                        shipmentDocId,
                        groupItems
                    )
                }
            }
            .addOnFailureListener {
                proceedToCamera(
                    null,
                    null,
                    capturedAtMillis,
                    item,
                    shipmentDocId,
                    groupItems
                )
            }
        } catch (_: SecurityException) {
            Toast.makeText(this, "Location permission is required for POD capture", Toast.LENGTH_LONG).show()
        }
    }

    private fun proceedToCamera(
        lat: Double?,
        lng: Double?,
        capturedAtMillis: Long = pendingCapturedAtMillis,
        item: Map<String, Any?>? = pendingObdItem,
        shipmentDocId: String? = pendingObdShipmentDocId,
        groupItems: List<Map<String, Any?>> = pendingObdGroupItems
    ) {
        if (item == null || shipmentDocId == null) return

        showObdStatusSheetWithLocation(
            item,
            shipmentDocId,
            capturedAtMillis,
            lat,
            lng,
            groupItems
        )
    }

    private fun showObdStatusSheetWithLocation(
        item: Map<String, Any?>,
        shipmentDocId: String,
        capturedAtMillis: Long,
        lat: Double?,
        lng: Double?,
        groupItems: List<Map<String, Any?>> = emptyList()
    ) {
        val sheet = ObdStatusBottomSheet.newInstance(
            item,
            shipmentDocId
        )

        sheet.onConfirmWithStatus = { status, lineItem, docId ->
            pendingPodData = PendingPodData(
                status = status,
                lineItem = lineItem,
                shipmentDocId = docId,
                capturedAtMillis = capturedAtMillis,
                latitude = lat,
                longitude = lng,
                groupLineItems = groupItems,
                captureId = if (groupItems.mapNotNull { it["obdNumber"]?.toString() }.distinct().size > 1)
                    java.util.UUID.randomUUID().toString() else null
            )

            if (
                ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.CAMERA
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                takePicture()
            } else {
                cameraPermissionLauncher.launch(
                    Manifest.permission.CAMERA
                )
            }
        }

        sheet.show(
            supportFragmentManager,
            ObdStatusBottomSheet.TAG
        )
    }

    private fun takePicture(): Boolean {
        val capturedAtMillis =
            pendingPodData?.capturedAtMillis ?: System.currentTimeMillis()

        val picturesDir =
            getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES)
                ?: return false

        if (!picturesDir.exists()) {
            picturesDir.mkdirs()
        }

        val photoFile = File(
            picturesDir,
            "pod_${capturedAtMillis}.jpg"
        )

        pendingPhotoFile = photoFile

        val photoUri = FileProvider.getUriForFile(
            this,
            "${packageName}.fileprovider",
            photoFile
        )

        takePictureLauncher.launch(photoUri)

        return true
    }

    private fun handleCameraResult(success: Boolean) {
        val podData = pendingPodData
        val photoFile = pendingPhotoFile

        if (!success || podData == null || photoFile == null) {
            if (!PodPhotoTempFile.delete(photoFile)) {
                Log.w(TAG, "Could not delete cancelled POD photo temporary")
            }
            pendingPodData = null
            pendingPhotoFile = null
            return
        }

        pendingPodData = null
        pendingPhotoFile = null

        showUploadProgress()

        encodePodImageWithTimestamp(
            photoFile = photoFile,
            timestampMillis = podData.capturedAtMillis,
            latitude = podData.latitude,
            longitude = podData.longitude,
            onSuccess = { base64DataUri ->
                lifecycleScope.launch {
                    try {
                        val groupObdNumbers = podData.groupLineItems.mapNotNull { it["obdNumber"]?.toString()?.trim()?.takeIf(String::isNotEmpty) }.distinct()
                        val groupPodId = if (groupObdNumbers.size > 1) {
                            val captureId = podData.captureId ?: error("Missing POD group capture ID")
                            val result = com.sysu.go.network.PodApiService.updateGroup(this@QueueDetailsActivity, podData.shipmentDocId, mapOf(
                                "action" to "complete",
                                "obdNumbers" to groupObdNumbers,
                                "captureId" to captureId,
                                "deliveryStatus" to podData.status,
                                "base64Image" to base64DataUri,
                                "capturedAtMillis" to podData.capturedAtMillis
                            ))
                            result["podGroupId"] as? String ?: error("Missing saved POD group reference")
                        } else {
                            updateObdLineItemInMySQL(
                                shipmentDocId = podData.shipmentDocId,
                                lineItem = podData.lineItem,
                                status = podData.status,
                                podImageUrl = base64DataUri,
                                capturedAtMillis = podData.capturedAtMillis
                            )
                            null
                        }

                        //  UPDATE local state immediately
                        if (!PodPhotoTempFile.delete(photoFile)) {
                            Log.w(TAG, "Could not delete uploaded POD photo temporary")
                        }
                        com.sysu.go.audit.DriverActionAudit.recordPodCapture(
                            context = this@QueueDetailsActivity,
                            shipmentId = podData.shipmentDocId,
                            obdNumbers = groupObdNumbers.ifEmpty {
                                listOf(podData.lineItem["obdNumber"]?.toString() ?: "")
                            },
                            latitude = podData.latitude,
                            longitude = podData.longitude,
                            capturedAtMillis = podData.capturedAtMillis,
                        )
                        updateLineItemPodStatus(
                            obdNumber = (podData.lineItem["obdNumber"] as? String) ?: "",
                            podImageUrl = "saved_in_subcollection", // Wag i-save sa local memory ang Base64 para iwas crash
                            status = podData.status,
                            capturedAtMillis = podData.capturedAtMillis,
                            groupPodId = groupPodId
                        )
                        groupObdNumbers.drop(1).forEach { obd ->
                            updateLineItemPodStatus(obd, "saved_in_subcollection", podData.status, podData.capturedAtMillis, groupPodId)
                        }
                        //  REFRESH the bottom sheet to reflect changes
                        refreshObdItemsSheet()

                        hideUploadProgress()

                        SocketManager.emitPodUpdated(
                            podData.shipmentDocId
                        )

                        Toast.makeText(
                            this@QueueDetailsActivity,
                            "POD Uploaded Successfully!",
                            Toast.LENGTH_SHORT
                        ).show()
                    } catch (e: Exception) {
                        hideUploadProgress()
                        com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "pod-save", e)
                    }
                }
            },
            onFailure = { _ ->
                if (!PodPhotoTempFile.delete(photoFile)) {
                    Log.w(TAG, "Could not delete unprocessable POD photo temporary")
                }
                hideUploadProgress()
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "pod-processing")
            }
        )
    }

    private suspend fun updateObdLineItemInMySQL(
        shipmentDocId: String, lineItem: Map<String, Any?>, status: String,
        podImageUrl: String, capturedAtMillis: Long
    ) {
        val obdNumber = lineItem["obdNumber"] as? String ?: error("Missing OBD")
        com.sysu.go.network.PodApiService.update(this@QueueDetailsActivity, shipmentDocId, obdNumber, mapOf(
            "action" to "complete", "deliveryStatus" to status,
            "base64Image" to podImageUrl, "capturedAtMillis" to capturedAtMillis
        ))
    }

    private fun startGroupUnload(items: List<Map<String, Any?>>, shipmentDocId: String) {
        val obdNumbers = items.mapNotNull { it["obdNumber"]?.toString()?.trim()?.takeIf(String::isNotEmpty) }.distinct()
        if (obdNumbers.isEmpty()) return
        lifecycleScope.launch {
            try {
                com.sysu.go.network.PodApiService.updateGroup(this@QueueDetailsActivity, shipmentDocId, mapOf(
                    "action" to "unload",
                    "obdNumbers" to obdNumbers,
                    "unloadStatus" to "UNLOADING"
                ))
                val selected = obdNumbers.toSet()
                currentLineItems = currentLineItems.map { lineItem ->
                    if ((lineItem["obdNumber"] as? String) in selected && lineItem["isPodCompleted"] != true) {
                        lineItem.toMutableMap().apply { this["unloadStatus"] = "UNLOADING" }
                    } else lineItem
                }
                refreshObdItemsSheet()
                Toast.makeText(this@QueueDetailsActivity, "Unload started for ${obdNumbers.size} OBDs", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "shipment-state-transition", e)
            }
        }
    }

    private suspend fun updateObdUnloadStatusInMySQL(
        shipmentDocId: String, lineItem: Map<String, Any?>, unloadStatus: String
    ) {
        val obdNumber = lineItem["obdNumber"] as? String ?: error("Missing OBD")
        com.sysu.go.network.PodApiService.update(this@QueueDetailsActivity, shipmentDocId, obdNumber,
            mapOf("action" to "unload", "unloadStatus" to unloadStatus))
    }

    private suspend fun resetPodDataForRetake(shipmentDocId: String, lineItem: Map<String, Any?>) {
        val obdNumber = lineItem["obdNumber"] as? String ?: error("Missing OBD")
        com.sysu.go.network.PodApiService.update(this@QueueDetailsActivity, shipmentDocId, obdNumber, mapOf("action" to "retake"))
    }

    private fun showUploadProgress() {
        uploadProgressDialog =
            android.app.AlertDialog.Builder(this)
                .setMessage("Uploading photo...")
                .setCancelable(false)
                .create()
                .apply {
                    show()
                }
    }

    private fun hideUploadProgress() {
        runOnUiThread {
            uploadProgressDialog?.dismiss()
            uploadProgressDialog = null
        }
    }

    /**
     * Decodes a photo file to Bitmap (with inSampleSize to avoid OOM), embeds a
     * timestamp overlay using capturedAtMillis, then passes the stamped bitmap
     * to ImageStorageHelper for compression and base64-encoding.
     *
     * Mirrors the two-step decode → process flow already in ImageStorageHelper,
     * separated here so the PhotoFile overload can participate in timestamp
     * embedding without duplicating ImageStorageHelper internals.
     */
    private fun encodePodImageWithTimestamp(
        photoFile: File,
        timestampMillis: Long,
        latitude: Double?,
        longitude: Double?,
        onSuccess: (String) -> Unit,
        onFailure: (String) -> Unit
    ) {
        val boundOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(photoFile.absolutePath, boundOptions)

        val sampleSize = calculateInSampleSizeForFile(boundOptions, 1280, 1280)
        val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }

        val bitmap: Bitmap? = try {
            BitmapFactory.decodeFile(photoFile.absolutePath, decodeOptions)
        } catch (e: OutOfMemoryError) {
            Log.e(TAG, "OOM decoding photo for timestamp encoding: ${photoFile.name}", e)
            null
        } catch (e: Exception) {
            Log.e(TAG, "decode failed during timestamp encoding: ${e.message}", e)
            null
        }

        if (bitmap == null) {
            onFailure("Failed to load photo for timestamp embedding. Please try again.")
            return
        }

        Log.d(TAG, "encodePodImageWithTimestamp: latitude=$latitude, longitude=$longitude, timestampMillis=$timestampMillis")
        //  Build locationLabel from provided coordinates (or null if unavailable)
        val locationLabel: String? = latitude?.let { lat ->
            longitude?.let { lng ->
                ImageStorageHelper.formatLocationLabel(lat, lng, this@QueueDetailsActivity)
            }
        }
        Log.d(TAG, "encodePodImageWithTimestamp: locationLabel=${locationLabel ?: "null"}")

        ImageStorageHelper.uploadPodImage(
            bitmap = bitmap,
            timestampMillis = timestampMillis,
            context = this,
            onSuccess = { encoded ->
                bitmap.recycle()
                onSuccess(encoded)
            },
            onFailure = { errorMsg ->
                bitmap.recycle()
                onFailure(errorMsg)
            },
            locationLabel = locationLabel,
            latitude = latitude,
            longitude = longitude
        )
    }

    /**
     * Copy of BitmapFactory's calculateInSampleSize for use with File decode path.
     * Mirrors the logic already in ImageStorageHelper.decodeAndResize() — kept here
     * so encodePodImageWithTimestamp is fully self-contained.
     */
    private fun calculateInSampleSizeForFile(
        options: BitmapFactory.Options,
        reqWidth: Int,
        reqHeight: Int
    ): Int {
        val (height, width) = options.outHeight to options.outWidth
        var inSampleSize = 1
        if (height > reqHeight || width > reqWidth) {
            val halfHeight = height / 2
            val halfWidth = width / 2
            while (halfHeight / inSampleSize >= reqHeight && halfWidth / inSampleSize >= reqWidth) {
                inSampleSize *= 2
            }
        }
        return inSampleSize
    }

    /**
     * Opens a fullscreen black overlay dialog showing the POD photo.
     * The image is decoded from a base64 data URI string.
     *
     * Layout: dialog_image_preview.xml — semi-transparent black background,
     * center-fitted ImageView, accessible close (X) button top-right.
     *
     * @param base64ImageString Full base64 data URI (data:image/jpeg;base64,...).
     *                           The prefix is stripped before decoding.
     */
    private fun showPodFullScreenPreview(base64ImageString: String) {
        val tag = "showPodFullScreenPreview"
        Log.d(tag, "dataUri length=${base64ImageString.length}")

        val bitmap: Bitmap? = decodeBase64ToBitmap(base64ImageString)
        if (bitmap == null) {
            Log.e(tag, "decodeBase64ToBitmap returned null")
            Toast.makeText(this, "Hindi ma-load ang preview ng litrato", Toast.LENGTH_SHORT).show()
            return
        }
        Log.d(tag, "bitmap decoded: ${bitmap.width}x${bitmap.height}")

        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dialog.setContentView(R.layout.dialog_image_preview)

        val previewImageView = dialog.findViewById<ImageView>(R.id.previewImageView)
            .apply { setImageBitmap(bitmap) }

        val closeBtn = dialog.findViewById<ImageButton>(R.id.closePreviewButton)
        closeBtn.setOnClickListener { dialog.dismiss() }

        //  Tap anywhere on the image to dismiss
        previewImageView.setOnClickListener { dialog.dismiss() }

        dialog.show()
    }

    /**
     * Decodes a base64-encoded data URI string into a Bitmap.
     *
     * Handles the optional "data:image/jpeg;base64," prefix that MySQL
     * stores alongside the raw base64 bytes.
     *
     * @param base64Str  A base64 string, optionally prefixed with
     *                    "data:image/jpeg;base64," or similar.
     * @return Decoded Bitmap, or null on failure (bad data, OOM, etc.)
     */
    private fun decodeBase64ToBitmap(base64Str: String): Bitmap? {
        return try {
            //  Strip the "data:image/jpeg;base64," prefix if present
            val cleanBase64 = if (base64Str.contains(",")) {
                base64Str.substring(base64Str.indexOf(",") + 1)
            } else {
                base64Str
            }
            val decodedBytes = Base64.decode(cleanBase64, Base64.NO_WRAP)
            BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
        } catch (e: Exception) {
            Log.e(TAG, "decodeBase64ToBitmap failed: ${e.message}", e)
            null
        }
    }

    /**
     * Updates the unloadStatus of a specific lineItem in currentLineItems
     * so the UI reflects the change immediately without full reload.
     */
    private fun updateLineItemUnloadStatus(obdNumber: String, newUnloadStatus: String) {
        currentLineItems = currentLineItems.map { item ->
            if ((item["obdNumber"] as? String) == obdNumber) {
                item.toMutableMap().apply {
                    this["unloadStatus"] = newUnloadStatus
                }
            } else {
                item
            }
        }
    }

    /**
     * Closes the current bottom sheet and re-opens it with updated data.
     */
    private fun refreshObdItemsSheet() {
        //  Dismiss existing sheet if open
        supportFragmentManager.findFragmentByTag(ObdItemsBottomSheet.TAG)
            ?.let { (it as? androidx.fragment.app.DialogFragment)?.dismiss() }

        //  Re-open with fresh data
        val sheet = ObdItemsBottomSheet.newInstance(
            lineItems = currentLineItems,
            shipmentDocId = currentSapDocId,
            rowLayoutType = RowLayoutType.POD,
            podCaptureEnabled = (currentTripStatus == "in_transit" && sessionManager.isTrackingActive()),
            onItemClick = { item ->
                val isCompleted = item["isPodCompleted"] as? Boolean ?: false
                val dataUri = item["podImageUrl"] as? String ?: ""
                showObdItemDetailsDialog(item)
            },
            onObdCameraTap = { lineItem, shipmentDocId ->
                val obd = lineItem["obdNumber"] as? String ?: return@newInstance
                Log.d("OBD", "onObdCameraTap FIRED: obd=$obd, shipmentDocId=$shipmentDocId")
                showObdStatusSheet(lineItem, shipmentDocId)
            },
            onGroupCameraTap = { items, shipmentDocId ->
                items.firstOrNull()?.let { showObdStatusSheet(it, shipmentDocId, items) }
            },
            onGroupUnloadTap = { items, shipmentDocId -> startGroupUnload(items, shipmentDocId) },
            onUnloadConfirm = { lineItem, shipmentDocId ->
                val obdNumber = lineItem["obdNumber"] as? String
                if (obdNumber != null) {
                    lifecycleScope.launch {
                        try {
                            updateObdUnloadStatusInMySQL(
                                shipmentDocId = shipmentDocId,
                                lineItem = lineItem,
                                unloadStatus = "UNLOADING"
                            )
                            updateLineItemUnloadStatus(obdNumber, "UNLOADING")
                            refreshObdItemsSheet()
                            Toast.makeText(
                                this@QueueDetailsActivity,
                                "Unload started for $obdNumber",
                                Toast.LENGTH_SHORT
                            ).show()
                        } catch (e: Exception) {
                            Log.e("QUEUE_DETAILS", "Failed to start unload: ${e.message}")
                            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "shipment-state-transition", e)
                        }
                    }
                }
            },
            onUnloadCancel = { lineItem, shipmentDocId ->
                val obdNumber = lineItem["obdNumber"] as? String
                if (obdNumber != null) {
                    lifecycleScope.launch {
                        try {
                            updateObdUnloadStatusInMySQL(
                                shipmentDocId = shipmentDocId,
                                lineItem = lineItem,
                                unloadStatus = ""
                            )
                            updateLineItemUnloadStatus(obdNumber, "")
                            refreshObdItemsSheet()
                            Toast.makeText(
                                this@QueueDetailsActivity,
                                "Unload cancelled for $obdNumber",
                                Toast.LENGTH_SHORT
                            ).show()
                        } catch (e: Exception) {
                            Log.e("QUEUE_DETAILS", "Failed to cancel unload: ${e.message}")
                            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "shipment-state-transition", e)
                        }
                    }
                }
            },
            onRetakeTap = { lineItem, shipmentDocId ->
                android.app.AlertDialog.Builder(this@QueueDetailsActivity)
                    .setTitle("Are you sure to retake POD?")
                    .setMessage("Warning, previous pictures will be deleted if you proceed!!")
                    .setPositiveButton("Proceed") { _, _ ->
                        //  Handle retake - reset POD data and restart the POD capture flow
                        val obdNumber = lineItem["obdNumber"] as? String
                        if (obdNumber != null) {
                            lifecycleScope.launch {
                                try {
                                    //  Reset POD data to allow retake (sets unloadStatus to UNLOADING)
                                    resetPodDataForRetake(shipmentDocId, lineItem)
                                    //  UPDATE local state with ALL POD fields reset
                                    updateLineItemForRetake(obdNumber)
                                    //  Refresh the bottom sheet to reflect changes
                                    refreshObdItemsSheet()
                                    Toast.makeText(
                                        this@QueueDetailsActivity,
                                        "Ready to retake POD for $obdNumber",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } catch (e: Exception) {
                                    Log.e("QUEUE_DETAILS", "Failed to reset POD for retake: ${e.message}")
                                    com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "pod-save", e)
                                }
                            }
                        }
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        )
        sheet.show(supportFragmentManager, ObdItemsBottomSheet.TAG)
    }

    /**
     * Updates the POD status of a specific lineItem in currentLineItems
     * so the UI reflects the POD completion immediately without full reload.
     */
    private fun updateLineItemPodStatus(
        obdNumber: String,
        podImageUrl: String,
        status: String,
        capturedAtMillis: Long,
        groupPodId: String? = null
    ) {
        currentLineItems = currentLineItems.map { item ->
            if ((item["obdNumber"] as? String) == obdNumber) {
                item.toMutableMap().apply {
                    this["isPodCompleted"] = true
                    this["podImageUrl"] = podImageUrl
                    this["deliveryStatus"] = status
                    this["podCapturedAt"] = capturedAtMillis
                    this["unloadStatus"] = null
                    if (groupPodId != null) this["podGroupId"] = groupPodId else remove("podGroupId")
                }
            } else {
                item
            }
        }
    }

    /**
     * Updates the currentLineItems when RETAKE is clicked.
     * Resets all POD-related fields to allow new capture.
     */
    private fun updateLineItemForRetake(obdNumber: String) {
        currentLineItems = currentLineItems.map { item ->
            if ((item["obdNumber"] as? String) == obdNumber) {
                item.toMutableMap().apply {
                    this["isPodCompleted"] = false
                    this["podImageUrl"] = ""
                    this["deliveryStatus"] = ""
                    this["podCapturedAt"] = null
                    this["unloadStatus"] = "UNLOADING"
                    remove("podGroupId")
                }
            } else {
                item
            }
        }
    }

    /**
     * Converts dp to pixels.
     */
    private fun dpToPx(dp: Int): Int {
        val density = resources.displayMetrics.density
        return (dp * density).toInt()
    }

    /**
     * Shows a professional, industry-standard floating dialog with the POD image
     * and action buttons. Features a clean white card layout with rounded corners.
     */
    private fun showObdItemDetailsDialog(item: Map<String, Any?>) {
        val isCompleted = item["isPodCompleted"] as? Boolean ?: false
        val obdNumber = item["obdNumber"] as? String ?: return

        if (!isCompleted) {
            Toast.makeText(this, "No POD available for this OBD item", Toast.LENGTH_SHORT).show()
            return
        }

        //  1. Magpakita ng Loading Dialog
        val progressDialog = android.app.AlertDialog.Builder(this)
            .setMessage("Loading POD image...")
            .setCancelable(false)
            .create()
        progressDialog.show()

        lifecycleScope.launch {
            try {
                val image = com.sysu.go.network.PodApiService.getImage(
                    this@QueueDetailsActivity,
                    currentSapDocId,
                    obdNumber,
                )
                progressDialog.dismiss()
                if (image.isNullOrBlank()) {
                    Toast.makeText(this@QueueDetailsActivity, "POD image not found in database", Toast.LENGTH_SHORT).show()
                } else {
                    showDialogWithFetchedImage(image)
                }
            } catch (error: Exception) {
                progressDialog.dismiss()
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@QueueDetailsActivity, "pod-preview", error)
            }
        }
    }

    //  Ito yung dati mong UI code na nilipat lang sa bagong function
    private fun showDialogWithFetchedImage(dataUri: String) {
        val bitmap = decodeBase64ToBitmap(dataUri)
        if (bitmap == null) {
            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this, "pod-preview")
            return
        }

        val dialog = Dialog(this, android.R.style.Theme_DeviceDefault_Light_Dialog_NoActionBar)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))

        val cornerRadius = 24f * resources.displayMetrics.density

        val rootView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                this.cornerRadius = cornerRadius
            }
            setPadding(0, 0, 0, 0)
        }

        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setPadding(dpToPx(20), dpToPx(20), dpToPx(16), dpToPx(12))
            gravity = Gravity.CENTER_VERTICAL
        }

        val titleText = TextView(this).apply {
            text = "Proof of Delivery"
            textSize = 18f
            setTextColor(Color.BLACK)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        headerLayout.addView(titleText)

        val closeIconBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(dpToPx(36), dpToPx(36))
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setOnClickListener { dialog.dismiss() }
        }
        headerLayout.addView(closeIconBtn)
        rootView.addView(headerLayout)

        val divider = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(1))
            setBackgroundColor(Color.parseColor("#E0E0E0"))
        }
        rootView.addView(divider)

        val imageContainer = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 0)
            }
        }

        val imageView = ImageView(this).apply {
            setImageBitmap(bitmap)
            val aspectRatio = bitmap.height.toFloat() / bitmap.width.toFloat()
            val calculatedHeight = (resources.displayMetrics.widthPixels * 0.85 * aspectRatio).toInt()
            val finalHeight = calculatedHeight.coerceIn(dpToPx(200), dpToPx(400))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                finalHeight
            ).apply {
                setMargins(dpToPx(16), dpToPx(16), dpToPx(16), 0)
            }
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        imageContainer.addView(imageView)
        rootView.addView(imageContainer)

        val buttonContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(dpToPx(16), dpToPx(20), dpToPx(16), dpToPx(24))
            }
        }

        val viewPodBtn = Button(this).apply {
            text = "VIEW PROOF OF DELIVERY"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setBackgroundColor(ContextCompat.getColor(this@QueueDetailsActivity, R.color.sysu_red))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(48))
            setOnClickListener {
                showPodFullScreenPreview(dataUri)
            }
        }
        buttonContainer.addView(viewPodBtn)

        val closeBtn = Button(this).apply {
            text = "CLOSE"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.BLACK)
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(48)).apply {
                topMargin = dpToPx(8)
            }
            setOnClickListener { dialog.dismiss() }
        }
        buttonContainer.addView(closeBtn)

        rootView.addView(buttonContainer)

        dialog.setContentView(rootView)
        dialog.show()
    }

    /**
     * Opens a fullscreen black overlay dialog showing the guard signature photo.
     * The image is decoded from a base64 data URI string.
     *
     * Layout: dialog_image_preview.xml — semi-transparent black background,
     * center-fitted ImageView, accessible close (X) button top-right.
     *
     * @param base64ImageString Full base64 data URI (data:image/jpeg;base64,...).
     *                           The prefix is stripped before decoding.
     */
    private fun showGuardSignatureFullScreenPreview(base64ImageString: String) {
        val tag = "showGuardSignatureFullScreenPreview"
        Log.d(tag, "dataUri length=${base64ImageString.length}")

        val bitmap: Bitmap? = decodeBase64ToBitmap(base64ImageString)
        if (bitmap == null) {
            Log.e(tag, "decodeBase64ToBitmap returned null")
            Toast.makeText(this, "Hindi ma-load ang preview ng litrato ng signature", Toast.LENGTH_SHORT).show()
            return
        }
        Log.d(tag, "bitmap decoded: ${bitmap.width}x${bitmap.height}")

        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dialog.setContentView(R.layout.dialog_image_preview)

        val previewImageView = dialog.findViewById<ImageView>(R.id.previewImageView)
            .apply { setImageBitmap(bitmap) }

        val closeBtn = dialog.findViewById<ImageButton>(R.id.closePreviewButton)
        closeBtn.setOnClickListener { dialog.dismiss() }

        //  Tap anywhere on the image to dismiss
        previewImageView.setOnClickListener { dialog.dismiss() }

        dialog.show()
    }

    companion object {
        private const val TAG = "QueueDetailsActivity"
    }
}
