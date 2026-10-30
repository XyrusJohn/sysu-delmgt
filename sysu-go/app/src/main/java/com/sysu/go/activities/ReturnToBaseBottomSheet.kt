package com.sysu.go.activities

import android.app.Dialog
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.lifecycleScope
import com.sysu.go.R
import com.sysu.go.databinding.LayoutReturnPanelBinding
import com.sysu.go.network.SocketManager
import com.sysu.go.network.WarehouseSettingsApiService
import com.sysu.go.network.TripReturnApiException
import com.sysu.go.network.TripReturnApiService
import com.sysu.go.services.LocationServices
import com.sysu.go.utils.SessionManager
import com.sysu.go.utils.DriverStatus
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Three-step return flow. The backend records return state on the SQL assignments,
 * validates arrival from the persisted live location, then releases the owned queue.
 */
class ReturnToBaseBottomSheet : DialogFragment() {

    private var _binding: LayoutReturnPanelBinding? = null
    private val binding get() = _binding!!
    private val sessionManager by lazy { SessionManager(requireContext()) }

    /** Comma-separated dispatch keys for the active queue session. */
    private var shipmentDocIds: String = ""

    /** Return stage supplied by the caller and reconciled from the SQL assignments stream. */
    private var currentReturnStatus: String? = null
    private var returnStatusListener: (() -> Unit)? = null

    /**
     * True once the user has tapped "ARRIVED AT BASE" — the panel
     * transitions to the inline confirmation step.
     */
    private var awaitingWarehouseConfirm: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        shipmentDocIds = arguments?.getString(ARG_SHIPMENT_DOC_IDS, "") ?: ""
        currentReturnStatus = arguments?.getString(ARG_RETURN_STATUS, null)
        setStyle(STYLE_NORMAL, R.style.ThemeOverlay_FrostedBlueBottomSheet)
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val dialog = super.onCreateDialog(savedInstanceState)
        dialog.window?.requestFeature(Window.FEATURE_NO_TITLE)
        return dialog
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = LayoutReturnPanelBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        if (savedInstanceState == null) {
            com.sysu.go.audit.DriverActionAudit.recordFreshLocation(requireContext(), "return_prompt_opened")
            if (awaitingWarehouseConfirm || currentReturnStatus == "arrived_at_base") {
                com.sysu.go.audit.DriverActionAudit.recordFreshLocation(requireContext(), "arrival_confirmation_opened")
            }
        }

        binding.overlay.setOnClickListener { dismiss() }
        binding.btnDismiss.setOnClickListener { dismiss() }

        bindPanelContent()
        bindConfirmButton()
        subscribeReturnState()
    }

    private fun bindPanelContent() {
        when {
            awaitingWarehouseConfirm -> configureForWarehouseConfirmStep()
            currentReturnStatus == "arrived_at_base" -> configureForWarehouseConfirmStep()
            currentReturnStatus == "returning_to_base" -> configureForReturningState()
            else -> configureForDeliveredState()
        }
    }

    private fun subscribeReturnState() {
        val expectedKeys = getAllDocIds().toSet()
        if (expectedKeys.isEmpty()) return
        returnStatusListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
            val rows = (payload as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()
            val ownRows = rows.filter { (it["dispatchKey"] ?: it["id"]) in expectedKeys }
            if (ownRows.size != expectedKeys.size) return@subscribeRealtime
            val statusValues = ownRows.map { it["returnStatus"] as? String }
            if (statusValues.any { it == null }) return@subscribeRealtime
            val statuses = statusValues.filterNotNull().toSet()
            val next = statuses.singleOrNull()?.takeIf { it in setOf("returning_to_base", "arrived_at_base") }
                ?: return@subscribeRealtime
            if (next != currentReturnStatus && _binding != null) {
                currentReturnStatus = next
                bindPanelContent()
                bindConfirmButton()
            }
        })
    }

    private fun bindConfirmButton() {
        binding.btnConfirmReturn.setOnClickListener {
            when {
                //  Step 2: Arrived at Base (Unlocked only if inside geofence)
                currentReturnStatus == "returning_to_base" && !awaitingWarehouseConfirm -> {
                    com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                        requireContext(), "arrival_confirmation_opened"
                    )
                    showDualConfirmation(
                        title = "Dumating na sa Base?",
                        message = "Kumpirmahin kung nakarating ka na sa $warehouseName. Ito ay magsisilbing senyales ng pagdating sa warehouse.",
                        confirmText = "Oo, Dumating Na",
                        confirmColor = R.color.sysu_blue,
                        iconRes = R.drawable.ic_location_crosshairs
                    ) {
                        com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                            requireContext(), "warehouse_arrival_confirmed", outcome = "requested"
                        )
                        performArrivedAtBase()
                    }
                }
                //  Step 3: Final Confirm Arrival (release driver & complete trip)
                currentReturnStatus == "arrived_at_base" || awaitingWarehouseConfirm -> {
                    showDualConfirmation(
                        title = "Kumpirmahin ang Pagtatapos?",
                        message = "Ito ang magtatapos sa biyahe mo at magbabalik sa iyo sa pila. Pagkatapos, ia-upload muna ang trip history at hihintayin ang kumpirmasyon ng server bago bumalik sa dashboard. Kung walang koneksyon, mananatili muna ang kopya sa phone.",
                        confirmText = "Oo, Tapusin ang Biyahe",
                        confirmColor = R.color.sysu_green,
                        iconRes = R.drawable.ic_dialog_confirm
                    ) {
                        com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                            requireContext(), "arrived_at_warehouse", outcome = "requested"
                        )
                        performConfirmArrival()
                    }
                }
                //  Step 1: Start Returning to Base
                else -> {
                    showDualConfirmation(
                        title = "Babalik na sa Warehouse?",
                        message = "Kumpirmahin kung tapos na ang lahat ng deliveries at papunta ka na pabalik sa $warehouseName.",
                        confirmText = "Oo, Bumalik sa Base",
                        confirmColor = R.color.sysu_blue,
                        iconRes = R.drawable.ic_dialog_confirm
                    ) {
                        com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                            requireContext(), "return_to_base_requested", outcome = "requested"
                        )
                        performStartReturning()
                    }
                }
            }
        }
    }

    private fun showDualConfirmation(
        title: String,
        message: String,
        confirmText: String,
        confirmColor: Int,
        iconRes: Int,
        onConfirm: () -> Unit
    ) {
        val ctx = requireContext()
        val dlgView = LayoutInflater.from(ctx).inflate(R.layout.dialog_sysu_confirmation, null)
        val dialog = androidx.appcompat.app.AlertDialog.Builder(ctx)
            .setView(dlgView)
            .setCancelable(true)
            .create()

        dlgView.findViewById<android.widget.ImageView>(R.id.ivDialogIcon)?.apply {
            setImageResource(iconRes)
            backgroundTintList = android.content.res.ColorStateList.valueOf(
                ContextCompat.getColor(ctx, confirmColor)
            )
        }
        dlgView.findViewById<android.widget.TextView>(R.id.tvDialogTitle)?.text = title
        dlgView.findViewById<android.widget.TextView>(R.id.tvDialogMessage)?.text = message

        dlgView.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnCancel)?.setOnClickListener {
            dialog.dismiss()
        }

        dlgView.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnConfirm)?.apply {
            text = confirmText
            backgroundTintList = android.content.res.ColorStateList.valueOf(
                ContextCompat.getColor(ctx, confirmColor)
            )
            setOnClickListener {
                dialog.dismiss()
                onConfirm()
            }
        }

        dialog.show()
    }

    //  DocId helpers

    private fun getFirstDocId(): String? =
        shipmentDocIds.split(",").firstOrNull { it.isNotBlank() }
            ?: sessionManager.getActiveSapDocId()

    private fun getAllDocIds(): List<String> =
        shipmentDocIds.split(",").filter { it.isNotBlank() }.ifEmpty {
            listOfNotNull(sessionManager.getActiveSapDocId())
        }

    //  Panel content

    //  Warehouse Geofence Configuration
    private var warehouseLat: Double = 14.671073
    private var warehouseLng: Double = 121.014855
    private var warehouseRadiusMeters: Double = 100.0
    private var warehouseName: String = "SYSU Main Warehouse"
    private var isInsideGeofence: Boolean = false

    private val fusedLocationClient by lazy {
        com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(requireContext())
    }

    private var geofenceLocationCallback: com.google.android.gms.location.LocationCallback? = null

    private fun configureForDeliveredState() {
        stopGeofenceLocationUpdates()
        binding.tvPanelTitle.text = "All Deliveries Complete"
        binding.tvPanelSubtitle.text = "All shipments have been delivered. Ready to return to base?"
        binding.tvDeliveredSummary.visibility = View.VISIBLE
        binding.tvDeliveredSummary.text = getString(R.string.return_panel_all_delivered)
        binding.llGeofenceStatus.visibility = View.GONE
        binding.btnConfirmReturn.text = "START RETURNING TO BASE"
        binding.btnConfirmReturn.isEnabled = true
        binding.btnConfirmReturn.alpha = 1.0f
        binding.btnConfirmReturn.backgroundTintList = ContextCompat.getColorStateList(
            requireContext(), R.color.sysu_blue
        )
    }

    private fun configureForReturningState() {
        binding.tvPanelTitle.text = "Returning to Base"
        binding.tvPanelSubtitle.text = "Heading back to $warehouseName. Mag-a-unlock ang 'Arrived' button kapag nasa loob na ng ${warehouseRadiusMeters.toInt()}m radius."
        binding.tvDeliveredSummary.visibility = View.GONE
        binding.llGeofenceStatus.visibility = View.VISIBLE

        binding.btnConfirmReturn.text = "ARRIVED AT BASE"
        //  Initially locked until GPS confirms driver is inside geofence
        updateGeofenceUI(false, null)

        //  Fetch dynamic warehouse config and start live GPS geofence tracking
        fetchWarehouseBaseSettingsAndStartTracking()
    }

    private fun configureForWarehouseConfirmStep() {
        stopGeofenceLocationUpdates()
        binding.tvPanelTitle.text = "Confirm Arrival"
        binding.tvPanelSubtitle.text = "You're at $warehouseName. Tap CONFIRM to finalize the trip and return to queue."
        binding.tvDeliveredSummary.visibility = View.GONE
        binding.llGeofenceStatus.visibility = View.GONE
        binding.btnConfirmReturn.text = "YES, CONFIRM ARRIVAL"
        binding.btnConfirmReturn.isEnabled = true
        binding.btnConfirmReturn.alpha = 1.0f
        binding.btnConfirmReturn.backgroundTintList = ContextCompat.getColorStateList(
            requireContext(), R.color.sysu_green
        )
    }

    /**
     * Fetches the warehouse geofence from the authenticated MySQL API.
     * Then initiates live GPS updates to continuously check distance against geofence.
     */
    private fun fetchWarehouseBaseSettingsAndStartTracking() {
        lifecycleScope.launch {
            try {
                val base = withContext(Dispatchers.IO) {
                    WarehouseSettingsApiService.getBase(requireContext())
                }
                warehouseLat = base.lat
                warehouseLng = base.lng
                warehouseRadiusMeters = base.radiusMeters
                warehouseName = base.name
            } catch (e: Exception) {
                Log.w(TAG, "Failed to fetch warehouse_base settings, using defaults: ${e.message}")
            }
            startGeofenceLocationUpdates()
        }
    }

    @android.annotation.SuppressLint("MissingPermission")
    private fun startGeofenceLocationUpdates() {
        if (!com.sysu.go.utils.PermissionHelper.hasLocationPermission(requireContext())) {
            updateGeofenceUI(false, null, "Kailangan ng Location Permission para ma-verify ang distansya.")
            return
        }

        //  Quick initial check via lastLocation
        fusedLocationClient.lastLocation.addOnSuccessListener { loc ->
            if (loc != null) {
                evaluateLocation(loc)
            } else {
                updateGeofenceUI(false, null, "Kinukuha pa ang GPS signal...")
            }
        }

        //  Continuous location requests while bottom sheet is open in returning_to_base state
        if (geofenceLocationCallback == null) {
            val locationRequest = com.google.android.gms.location.LocationRequest.Builder(
                com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY,
                3000L
            ).setMinUpdateIntervalMillis(2000L)
             .setMinUpdateDistanceMeters(2f)
             .build()

            geofenceLocationCallback = object : com.google.android.gms.location.LocationCallback() {
                override fun onLocationResult(result: com.google.android.gms.location.LocationResult) {
                    val location = result.lastLocation ?: return
                    evaluateLocation(location)
                }
            }

            try {
                fusedLocationClient.requestLocationUpdates(
                    locationRequest,
                    geofenceLocationCallback!!,
                    android.os.Looper.getMainLooper()
                )
            } catch (e: SecurityException) {
                Log.w(TAG, "SecurityException on geofence location updates: ${e.message}")
            }
        }
    }

    private fun evaluateLocation(loc: android.location.Location) {
        val results = FloatArray(1)
        android.location.Location.distanceBetween(
            loc.latitude, loc.longitude,
            warehouseLat, warehouseLng,
            results
        )
        val distanceMeters = results[0]
        val inside = distanceMeters <= warehouseRadiusMeters
        isInsideGeofence = inside
        updateGeofenceUI(inside, distanceMeters)
    }

    private fun stopGeofenceLocationUpdates() {
        geofenceLocationCallback?.let {
            try {
                fusedLocationClient.removeLocationUpdates(it)
            } catch (_: Exception) {}
            geofenceLocationCallback = null
        }
    }

    private fun updateGeofenceUI(inside: Boolean, distanceMeters: Float?, customError: String? = null) {
        if (_binding == null) return

        isInsideGeofence = inside
        if (customError != null) {
            binding.tvGeofenceDistance.text = customError
            binding.tvGeofenceBadge.text = "GPS Error"
            binding.tvGeofenceBadge.setTextColor(ContextCompat.getColor(requireContext(), R.color.sysu_red))
            binding.tvGeofenceBadge.setBackgroundResource(R.drawable.bg_chip_required)
            binding.ivGeofenceIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.sysu_red))
            binding.btnConfirmReturn.isEnabled = false
            binding.btnConfirmReturn.alpha = 0.5f
            return
        }

        if (inside) {
            val distStr = if (distanceMeters != null) "${distanceMeters.toInt()}m mula sa base" else "Nasa loob ng warehouse area"
            binding.tvGeofenceDistance.text = "✓ $distStr (Pasok sa ${warehouseRadiusMeters.toInt()}m radius)"
            binding.tvGeofenceBadge.text = "Nasa Base Na ✓"
            binding.tvGeofenceBadge.setTextColor(ContextCompat.getColor(requireContext(), R.color.transit_green))
            binding.tvGeofenceBadge.setBackgroundResource(R.drawable.bg_chip_granted)
            binding.ivGeofenceIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.transit_green))
            binding.btnConfirmReturn.isEnabled = true
            binding.btnConfirmReturn.alpha = 1.0f
            binding.btnConfirmReturn.backgroundTintList = ContextCompat.getColorStateList(
                requireContext(), R.color.sysu_blue
            )
        } else {
            val distText = if (distanceMeters != null) {
                if (distanceMeters >= 1000) {
                    String.format(java.util.Locale.US, "%.1f km layo mula sa base", distanceMeters / 1000.0)
                } else {
                    "${distanceMeters.toInt()}m layo mula sa base"
                }
            } else "Kinakalkula..."
            binding.tvGeofenceDistance.text = "Kasalukuyang distansya: $distText (Kailangan ≤ ${warehouseRadiusMeters.toInt()}m)"
            binding.tvGeofenceBadge.text = "Nasa Labas Pa"
            binding.tvGeofenceBadge.setTextColor(ContextCompat.getColor(requireContext(), R.color.sysu_red))
            binding.tvGeofenceBadge.setBackgroundResource(R.drawable.bg_chip_required)
            binding.ivGeofenceIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.sysu_red))
            binding.btnConfirmReturn.isEnabled = false
            binding.btnConfirmReturn.alpha = 0.5f
        }
    }

    //  Actions

    /** Persists the return transition before starting the return-leg location service. */
    private fun performStartReturning() {
        val docIds = getAllDocIds()
        if (docIds.isEmpty()) {
            Toast.makeText(requireContext(), "Walang shipment na naka-link sa biyahe.", Toast.LENGTH_LONG).show()
            return
        }
        if (!com.sysu.go.utils.PermissionHelper.hasLocationPermission(requireContext())) {
            Toast.makeText(requireContext(), "Kailangan ng Location Permission para ma-track ang biyahe pabalik sa base.", Toast.LENGTH_LONG).show()
            return
        }
        showLoading("Saving return status...")
        lifecycleScope.launch {
            try {
                TripReturnApiService.transition(requireContext(), "start", docIds, sessionManager.getCurrentQueueDocId())
                val trackingAnchor = docIds.first()
                sessionManager.saveActiveSapDocId(trackingAnchor)
                sessionManager.saveCurrentSapDocId(trackingAnchor)
                sessionManager.setTripActive(true)
                sessionManager.setTrackingActive(true)
                DriverStatus.seedLastOnlineState(DriverStatus.State.RETURNING_TO_BASE)
                ContextCompat.startForegroundService(requireContext(), Intent(requireContext(), LocationServices::class.java))
                com.sysu.go.audit.DriverActionAudit.recordFreshLocation(requireContext(), "returning_to_base",
                    subjectId = trackingAnchor, idempotencyKey = "returning:$trackingAnchor")
                Log.d(TAG, "performStartReturning: driver status returning_to_base")
                currentReturnStatus = "returning_to_base"
                hideLoading()
                bindPanelContent()
                bindConfirmButton()
            } catch (e: Exception) {
                Log.e(TAG, "performStartReturning error: ${e.message}")
                hideLoading()
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(
                    requireActivity(), "trip-start", e, (e as? TripReturnApiException)?.userMessage
                )
                binding.btnConfirmReturn.isEnabled = true
                binding.btnConfirmReturn.text = "START RETURNING TO BASE"
            }
        }
    }

    /** The backend verifies the latest SQL location against the warehouse geofence. */
    private fun performArrivedAtBase() {
        if (!isInsideGeofence) {
            Toast.makeText(requireContext(), "Nasa labas ka pa ng warehouse base! Hindi pa pwedeng mag-arrive.", Toast.LENGTH_LONG).show()
            return
        }
        showLoading("Confirming arrival...")
        lifecycleScope.launch {
            try {
                TripReturnApiService.transition(requireContext(), "arrived", getAllDocIds(), sessionManager.getCurrentQueueDocId())
                Log.d(TAG, "performArrivedAtBase: driver arrival recorded")
                DriverStatus.seedLastOnlineState(DriverStatus.State.RETURNING_TO_BASE)
                sessionManager.setTrackingActive(false)
                try {
                    val uid = sessionManager.getDriverId()
                    SocketManager.init(requireContext())
                    if (uid != null) SocketManager.emitOfflineStatus(uid, sessionManager.getDriverName())
                    requireContext().stopService(Intent(requireContext(), LocationServices::class.java))
                } catch (e: Exception) {
                    Log.w(TAG, "performArrivedAtBase: offline emit skipped ? ${e.message}")
                }
                currentReturnStatus = "arrived_at_base"
                com.sysu.go.audit.DriverActionAudit.recordFreshLocation(requireContext(), "arrival_confirmation_opened")
                hideLoading()
                bindPanelContent()
                bindConfirmButton()
            } catch (e: Exception) {
                Log.e(TAG, "performArrivedAtBase error: ${e.message}")
                hideLoading()
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(
                    requireActivity(), "shipment-state-transition", e, (e as? TripReturnApiException)?.userMessage
                )
                binding.btnConfirmReturn.isEnabled = true
                binding.btnConfirmReturn.text = "ARRIVED AT BASE"
            }
        }
    }

    /**
     * Step 3: YES, CONFIRM ARRIVAL — writes tripStatus="completed" + completedAt
     * on all non-completed shipments, releases the queue, sets
     * SQL assignment returnStatus = "completed", and navigates back to MainActivity.
     * Shipments at this point may already be "completed" from the END SHIPMENT
     * step — this just stamps the final completedAt timestamp and clears state.
     */
    private fun performConfirmArrival() {
        val docIds = getAllDocIds()
        if (docIds.isEmpty()) {
            Toast.makeText(requireContext(), "Walang aktibong biyahe.", Toast.LENGTH_SHORT).show()
            dismiss(); return
        }
        val queueDocId = sessionManager.getCurrentQueueDocId()
        showLoading("Completing trip...")
        lifecycleScope.launch {
            try {
                TripReturnApiService.transition(requireContext(), "complete", docIds, queueDocId)
                Log.d(TAG, "performConfirmArrival: return session completed")
                DriverStatus.seedLastOnlineState(DriverStatus.State.ONLINE)
                sessionManager.setTrackingActive(false)
                sessionManager.clearTripSession()
                try {
                    val uid = sessionManager.getDriverId()
                    val driverName = sessionManager.getDriverName() ?: "Driver"
                    SocketManager.init(requireContext())
                    if (uid != null) {
                        SocketManager.emitCompletedStatus(uid, driverName)
                        SocketManager.emitStatusUpdate("completed", driverName)
                    }
                    requireContext().stopService(Intent(requireContext(), LocationServices::class.java))
                } catch (e: Exception) {
                    Log.w(TAG, "performConfirmArrival: completed/offline emit skipped ? ${e.message}")
                }
                showTripUploadLoading()
                val uploadConfirmed = com.sysu.go.audit.DriverActionAudit
                    .completeSessionAndAwaitUpload(requireContext())
                if (sessionManager.getCurrentQueueDocId() == queueDocId) sessionManager.saveCurrentQueueDocId(null)
                if (uploadConfirmed) {
                    dismiss()
                    startActivity(Intent(requireContext(), MainActivity::class.java))
                } else {
                    hideLoading()
                    AlertDialog.Builder(requireContext())
                        .setTitle("Trip completed; upload pending")
                        .setMessage("Hindi pa nakukumpirma ng server ang trip history. Nananatili ang kopya sa phone at susubukan itong i-upload ulit kapag may koneksyon. Lalabas ito sa SYSU App kapag nakumpirma na ang upload.")
                        .setCancelable(false)
                        .setPositiveButton("Continue") { _, _ ->
                            dismiss()
                            startActivity(Intent(requireContext(), MainActivity::class.java))
                        }
                        .show()
                }
            } catch (e: Exception) {
                Log.e(TAG, "performConfirmArrival error: ${e.message}")
                hideLoading()
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(
                    requireActivity(), "shipment-completion", e, (e as? TripReturnApiException)?.userMessage
                )
                binding.btnConfirmReturn.isEnabled = true
                binding.btnConfirmReturn.text = "YES, CONFIRM ARRIVAL"
            }
        }
    }

    private fun showLoading(message: String) {
        binding.llLoading.visibility = View.VISIBLE
        binding.tvLoadingText.text = message
        binding.btnConfirmReturn.isEnabled = false
    }

    private fun hideLoading() {
        binding.llLoading.visibility = View.GONE
        binding.uploadBlockingOverlay.visibility = View.GONE
        binding.btnConfirmReturn.isEnabled = true
    }

    private fun showTripUploadLoading() {
        binding.llLoading.visibility = View.GONE
        binding.uploadBlockingOverlay.visibility = View.VISIBLE
        binding.uploadBlockingOverlay.findViewById<android.widget.TextView>(R.id.tvUploadBlockingText)
            ?.text = "Ina-upload ang trip history..."
        binding.btnConfirmReturn.isEnabled = false
        binding.btnDismiss.isEnabled = false
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.apply {
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundDrawableResource(android.R.color.transparent)
        }
    }

    override fun onDestroyView() {
        returnStatusListener?.invoke()
        returnStatusListener = null
        stopGeofenceLocationUpdates()
        super.onDestroyView()
        _binding = null
    }

    companion object {
        private const val TAG = "ReturnToBaseBottomSheet"
        private const val ARG_SHIPMENT_DOC_IDS = "shipment_doc_ids"
        private const val ARG_RETURN_STATUS = "return_status"

        /** @param shipmentDocIds comma-separated dispatch keys in this queue session. */
        fun newInstance(
            shipmentDocIds: String = "",
            currentReturnStatus: String? = null
        ): ReturnToBaseBottomSheet {
            return ReturnToBaseBottomSheet().apply {
                arguments = Bundle().apply {
                    putString(ARG_SHIPMENT_DOC_IDS, shipmentDocIds)
                    putString(ARG_RETURN_STATUS, currentReturnStatus)
                }
            }
        }
    }
}
