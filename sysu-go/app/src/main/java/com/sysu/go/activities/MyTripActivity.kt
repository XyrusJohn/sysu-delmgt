package com.sysu.go.activities

import android.Manifest
import android.Manifest.permission.ACCESS_FINE_LOCATION
import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.google.android.material.button.MaterialButton
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.sysu.go.R
import com.sysu.go.activities.GeneralTrackingActivity
import com.sysu.go.adapter.MyTripTabAdapter
import com.sysu.go.databinding.ActivityMyTripBinding
import com.sysu.go.model.Assignment
import com.sysu.go.network.SocketManager
import com.sysu.go.utils.ImageStorageHelper
import com.sysu.go.utils.PodPhotoTempFile
import com.sysu.go.utils.SessionManager

import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.io.File

/**
 * MY TRIP — shows all confirmed shipments (guardVerified && driverConfirmed)
 * as cards with START TRIP buttons. Mirrors AssignmentActivity's structure.
 *
 * Red banner: bouncing circles + pulse rings (same animation as AssignmentActivity).
 * RecyclerView: one card per confirmed shipment using item_my_trip_tab_card.
 * Tapping START TRIP on a card → confirmShipment() + startSingleShipment()
 * → saves activeSapDocId → launches MyTripActivity (OBD delivery execution).
 * Tapping "VIEW OBD ITEMS" on an in_transit card → launches MyTripActivity
 * scoped to that shipment.
 *
 * Bouncing circles and pulse rings are cleaned up in onDestroy.
 */
class MyTripActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMyTripBinding
    private val sessionManager by lazy { SessionManager(this) }

    /** Shared adapter — created once in onCreate */
    private lateinit var shipmentAdapter: MyTripTabAdapter

    /** Authenticated assignment subscription removed onDestroy */
    private var assignmentsListener: (() -> Unit)? = null
    private var hasLoadedAssignments = false

    /** Bouncing circles — cancelled onDestroy */
    private val circleAnimators = mutableListOf<android.animation.Animator>()
    private val circleViews = mutableListOf<View>()

    /** Prevents double-init of bouncing circles */
    private var circlesInitialized = false

    //  POD Camera state

    private lateinit var takePictureLauncher: ActivityResultLauncher<Uri>
    private lateinit var cameraPermissionLauncher: ActivityResultLauncher<String>
    private lateinit var locationPermissionLauncher: ActivityResultLauncher<String>
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    /** Carries the selected item+shipment while location permission is being resolved */
    private var pendingObdItem: Map<String, Any?>? = null
    /** Carries the shipment docId while location permission is being resolved */
    private var pendingObdShipmentDocId: String? = null
    /** Captured timestamp while awaiting location resolution */
    private var pendingCapturedAtMillis: Long = 0L
    //  ⚠️ These three are the main camera-flow state — still used throughout the camera path
    private var pendingPodData: PendingPodData? = null
    private var pendingPhotoFile: File? = null
    private var uploadProgressDialog: android.app.AlertDialog? = null

    /** Reference to the currently-open OBD items bottom sheet, so we can refresh it in-place */
    private var currentObdBottomSheet: ObdItemsBottomSheet? = null

    //  Socket.IO event listeners — registered in onResume, removed in onPause
    private val socketSapUpdatedListener: (data: Any?) -> Unit = { data ->
        //  Server emits sap_updated with the full driver assignment list after any change.
        //  Data shape: JSON array of SQL-backed assignment records.
        runOnUiThread {
            if (isFinishing) return@runOnUiThread
            try {
                val list = parseSapAssignmentsFromSocket(data)
                val sessionDriverId = sessionManager.getDriverId() ?: return@runOnUiThread
                fetchDriverData(list) { enriched ->
                    enrichWithQueueData(enriched) { final ->
                        val intentDocId = intent.getStringExtra("shipment_doc_id")
                        handleAssignmentList(final, intentDocId)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "sap_updated listener parse error: ${e.message}")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "assignment-subscription", e)
            }
        }
    }

    private val socketPodUpdatedListener: (data: Any?) -> Unit = { data ->
        //  Server emits pod_updated after a POD photo is successfully saved to MySQL.
        //  Data shape: { "shipmentDocId": "...", "lineItems": [...] }
        runOnUiThread {
            try {
                if (data is org.json.JSONObject) {
                    val shipmentDocId = data.optString("shipmentDocId")
                    val bottomSheet = currentObdBottomSheet
                    if (bottomSheet != null && shipmentDocId.isNotBlank()) {
                        val fresh = jsonMap(data)["lineItems"] as? List<Map<String, Any?>>
                        if (!fresh.isNullOrEmpty()) {
                            bottomSheet.refreshWith(fresh)
                        }
                    }
                }
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "pod-refresh", e)
                Log.e(TAG, "pod_updated listener error: ${e.message}")
            }
        }
    }

    /** Holds the camera → status selection → upload pipeline state */
    private data class PendingPodData(
        val status: String,
        val lineItem: Map<String, Any?>,
        val shipmentDocId: String,
        val capturedAtMillis: Long,
        val latitude: Double? = null,
        val longitude: Double? = null
    )

    //  Register camera result handler before onCreate finishes
    private fun registerCameraLauncher() {
        cameraPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                //  Camera permission granted — proceed to camera
                pendingPodData?.let { takePicture() }
            } else {
                pendingPodData = null
                pendingPhotoFile = null
                pendingObdItem = null
                pendingObdShipmentDocId = null
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

        //  Location permission launcher — requests fine location for GPS stamp on POD.
        //  Uses the captured item/shipment args stored in pendingObdItem/pendingObdShipmentDocId.
        locationPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { isGranted ->
            if (isGranted) {
                //  Permission granted — do a one-shot GPS fix, then resume showObdStatusSheet
                requestFreshLocationAndProceed()
            } else {
                //  Denied — proceed without location stamp
                proceedToCamera(null, null)
            }
        }
    }

    private fun showUploadProgress() {
        uploadProgressDialog = android.app.AlertDialog.Builder(this)
            .setMessage("Uploading photo…")
            .setCancelable(false)
            .create().apply { show() }
    }

    private fun hideUploadProgress() {
        runOnUiThread {
            uploadProgressDialog?.dismiss()
            uploadProgressDialog = null
        }
    }

    //  Location helpers for GPS stamp

    /**
     * Called by the location permission launcher callback after permission is granted.
     * Attempts a fresh one-shot GPS fix via FusedLocationProviderClient, then proceeds
     * to show the OBD status sheet with the resolved lat/lng.
     *
     * If getLastLocation() returns null (no active LocationServices fix in flight),
     * registers a brief single-update callback that resolves within ~2s of a GPS lock.
     * Falls back to the LocationServices cache (null) if all else fails.
     */
    private fun requestFreshLocationAndProceed() {
        val capturedAtMillis = pendingCapturedAtMillis
        val item = pendingObdItem
        val shipmentDocId = pendingObdShipmentDocId
        Log.d(TAG, "requestFreshLocationAndProceed: item=${item?.get("obdNumber")}, shipmentDocId=$shipmentDocId")
        if (item == null || shipmentDocId == null) {
            Log.w(TAG, "requestFreshLocationAndProceed: item or docId is NULL — calling proceedToCamera with nulls")
            proceedToCamera(null, null)
            return
        }

        @SuppressLint("MissingPermission")
        fusedLocationClient.lastLocation.addOnSuccessListener { location ->
            Log.d(TAG, "requestFreshLocationAndProceed: getLastLocation result = $location")
            if (location != null) {
                Log.d(TAG, "Fresh GPS fix from FusedLocationProviderClient: ${location.latitude}, ${location.longitude}")
                proceedToCamera(location.latitude, location.longitude, capturedAtMillis, item, shipmentDocId)
            } else {
                //  No cached fix available — request a single fresh update.
                //  This takes ~1-3s after GPS lock. Register a one-shot callback.
                Log.d(TAG, "No cached fix; requesting single GPS update...")
                requestOneShotLocation(item, shipmentDocId, capturedAtMillis)
            }
        }.addOnFailureListener {
            Log.e(TAG, "getLastLocation failed: ${it.message}")
            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "location-fetch", it)
            proceedToCamera(
                null, null,
                capturedAtMillis, item, shipmentDocId
            )
        }
    }

    /**
     * Does a one-shot GPS update (Priority.PRIORITY_HIGH_ACCURACY, 10s timeout).
     * On success: calls proceedToCamera with fresh lat/lng.
     * On timeout or failure: falls back to LocationServices cache → proceedToCamera.
     *
     * This bridges the gap when the driver is NOT in transit mode
     * (i.e., LocationServices never ran, so null returned null).
     */
    @SuppressLint("MissingPermission")
    private fun requestOneShotLocation(
        item: Map<String, Any?>,
        shipmentDocId: String,
        capturedAtMillis: Long
    ) {
        val locationRequest = com.google.android.gms.location.LocationRequest.Builder(
            com.google.android.gms.location.Priority.PRIORITY_HIGH_ACCURACY,
            10000L  // interval doesn't matter for one-shot
        ).setMaxUpdates(1).setMinUpdateIntervalMillis(1000).build()

        val oneShotCallback = object : com.google.android.gms.location.LocationCallback() {
            override fun onLocationResult(result: com.google.android.gms.location.LocationResult) {
                val loc = result.lastLocation
                Log.d(TAG, "requestOneShotLocation onLocationResult: loc=$loc")
                if (loc != null) {
                    Log.d(TAG, "One-shot GPS resolve: ${loc.latitude}, ${loc.longitude}")
                    proceedToCamera(loc.latitude, loc.longitude, capturedAtMillis, item, shipmentDocId)
                } else {
                    //  loc null from onLocationResult — try system cache as last resort
                    @SuppressLint("MissingPermission")
                    fusedLocationClient.lastLocation.addOnSuccessListener { cachedLoc ->
                        val lat = cachedLoc?.latitude
                        val lng = cachedLoc?.longitude
                        Log.d(TAG, "onLocationResult loc=null — system cache fallback: lat=$lat, lng=$lng")
                        proceedToCamera(lat, lng, capturedAtMillis, item, shipmentDocId)
                    }.addOnFailureListener {
                        proceedToCamera(null, null, capturedAtMillis, item, shipmentDocId)
                    }
                }
                fusedLocationClient.removeLocationUpdates(this)
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            oneShotCallback,
            mainLooper
        ).addOnFailureListener {
            Log.e(TAG, "One-shot location request failed: ${it.message}")
            //  Fall back to system cache as a last resort
            @SuppressLint("MissingPermission")
            fusedLocationClient.lastLocation.addOnSuccessListener { cachedLoc ->
                val lat = cachedLoc?.latitude
                val lng = cachedLoc?.longitude
                Log.d(TAG, "One-shot addOnFailureListener — system cache fallback: lat=$lat, lng=$lng")
                proceedToCamera(lat, lng, capturedAtMillis, item, shipmentDocId)
            }.addOnFailureListener {
                proceedToCamera(null, null, capturedAtMillis, item, shipmentDocId)
            }
        }

        //  Timeout fallback: if no GPS fix within 10s, try system cache then proceed
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            try {
                fusedLocationClient.removeLocationUpdates(oneShotCallback)
            } catch (_: Exception) { }
            //  Last-resort: ask the system cache even if LocationServices never ran
            @SuppressLint("MissingPermission")
            fusedLocationClient.lastLocation.addOnSuccessListener { cachedLoc ->
                val lat = cachedLoc?.latitude
                val lng = cachedLoc?.longitude
                Log.d(TAG, "One-shot timeout — system cache fallback: lat=$lat, lng=$lng")
                proceedToCamera(lat, lng, capturedAtMillis, item, shipmentDocId)
            }.addOnFailureListener {
                //  Truly nothing — GPS unavailable on this device
                Log.w(TAG, "One-shot timeout AND system cache failed — proceeding without location stamp")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "location-fetch", it)
                proceedToCamera(null, null, capturedAtMillis, item, shipmentDocId)
            }
        }, 10_000L)
    }

    /**
     * Ends the location-request flow by showing the OBD status bottom sheet
     * with the resolved/resolved lat/lng baked into the pendingPodData.
     */
    private fun proceedToCamera(
        lat: Double?,
        lng: Double?,
        capturedAtMillis: Long = pendingCapturedAtMillis,
        item: Map<String, Any?>? = pendingObdItem,
        shipmentDocId: String? = pendingObdShipmentDocId
    ) {
        if (item == null || shipmentDocId == null) return
        showObdStatusSheetWithLocation(item, shipmentDocId, capturedAtMillis, lat, lng)
    }

    //  Camera launch + handling

    /** Creates a temp JPEG file, gets a FileProvider content:// URI, launches camera. */
    private fun takePicture(): Boolean {
        val capturedAtMillis = pendingPodData?.capturedAtMillis ?: System.currentTimeMillis()
        val picturesDir = getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES)
            ?: return false
        if (!picturesDir.exists()) picturesDir.mkdirs()

        val photoFile = File(picturesDir, "pod_${capturedAtMillis}.jpg")
        pendingPhotoFile = photoFile

        val photoUri = FileProvider.getUriForFile(
            this,
            "${packageName}.fileprovider",
            photoFile
        )

        takePictureLauncher.launch(photoUri)
        return true
    }

    /**
     * Opens ObdStatusBottomSheet (status selection), then launches the camera
     * via the registered TakePicture launcher. Handles runtime CAMERA + LOCATION
     * permissions. GPS stamp flow:
     *
     *   1. Store item/docId as pending for use after permission resolves.
     *   2. Check if ACCESS_FINE_LOCATION is already granted.
     *   3. If granted → request fresh GPS fix (FusedLocationProviderClient), or use
     *      LocationServices cache if the driver is already in transit mode.
     *   4. If not granted → request permission.
     *   5. After GPS is resolved → show ObdStatusBottomSheet with lat/lng baked
     *      into PendingPodData so the POD timestamp watermark includes the location.
     */
    private fun showObdStatusSheet(
        item: Map<String, Any?>,
        shipmentDocId: String
    ) {
        try {
            val capturedAtMillis = System.currentTimeMillis()

            //  Store args so the permission-callback lambda can access them
            pendingObdItem = item
            pendingObdShipmentDocId = shipmentDocId
            pendingCapturedAtMillis = capturedAtMillis
            Log.d(TAG, "showObdStatusSheet: stored item=${item["obdNumber"]}, docId=$shipmentDocId, capturedAt=$capturedAtMillis")

            val hasLocationPermission = ContextCompat.checkSelfPermission(
                this, ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (hasLocationPermission) {
                //  Permission already granted — go straight to GPS fix + show sheet
                requestFreshLocationAndProceed()
            } else {
                //  First GPS permission request — show rationale toast, then request
                Toast.makeText(
                    this,
                    "Location is needed to stamp your POD photo with the delivery address.",
                    Toast.LENGTH_LONG
                ).show()
            locationPermissionLauncher.launch(ACCESS_FINE_LOCATION)
        }
        } catch (e: Throwable) {
            Log.e(TAG, "showObdStatusSheet CRASHED: ${e.javaClass.simpleName}: ${e.message}")
            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this, "camera-status-sheet", e)
        }
    }

    /**
     * Internal: called after a GPS fix is obtained (either from cache, one-shot fix,
     * or fallback). Shows the OBD status bottom sheet with lat/lng embedded.
     */
    private fun showObdStatusSheetWithLocation(
        item: Map<String, Any?>,
        shipmentDocId: String,
        capturedAtMillis: Long,
        lat: Double?,
        lng: Double?
    ) {
        try {
            Log.d(TAG, "showObdStatusSheetWithLocation: lat=$lat, lng=$lng, capturedAt=$capturedAtMillis, item=${item["obdNumber"]}")
            //  Reverse-geocode — uses Android's on-device Geocoder, no internet needed (~30ms)
            val locationLabel: String? = if (lat != null && lng != null) {
                ImageStorageHelper.formatLocationLabel(lat, lng, this)
            } else null

            val sheet = ObdStatusBottomSheet.newInstance(item, shipmentDocId)
            sheet.onConfirmWithStatus = { status, lineItem, docId ->
                pendingPodData = PendingPodData(
                    status = status,
                    lineItem = lineItem,
                    shipmentDocId = docId,
                    capturedAtMillis = capturedAtMillis,
                    latitude = lat,
                    longitude = lng
                )
                Log.d(TAG, "onConfirmWithStatus: lat=$lat, lng=$lng, status=$status, obdNumber=${(lineItem["obdNumber"] as? String) ?: "?"}")

                if (ContextCompat.checkSelfPermission(
                        this@MyTripActivity,
                        Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    val launched = takePicture()
                    if (!launched) {
                        pendingPodData = null
                        pendingPhotoFile = null
                        pendingObdItem = null
                        pendingObdShipmentDocId = null
                        Toast.makeText(
                            this@MyTripActivity,
                            "Camera not available. Please try again.",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                } else {
                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }
            sheet.show(supportFragmentManager, ObdStatusBottomSheet.TAG)
            Log.d(TAG, "showObdStatusSheetWithLocation: ObdStatusBottomSheet.show() called OK")
        } catch (e: Throwable) {
            Log.e(TAG, "showObdStatusSheetWithLocation CRASHED: ${e.javaClass.simpleName}: ${e.message}")
            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this, "camera-status-sheet", e)
        }
    }

    /**
     * Decodes a base64 data URI and shows it as a full-screen preview dialog.
     * Called when tapping a green thumbnail square on a completed OBD row.
     */
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
     * Handles the optional "data:image/jpeg;base64," prefix returned by the API.
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

    private fun handleCameraResult(success: Boolean) {
        val podData = pendingPodData
        val photoFile = pendingPhotoFile

        if (!success || podData == null || photoFile == null) {
            //  Camera was cancelled or failed
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

        //  Decode photo to Bitmap, embed timestamp, encode and upload
        encodePodImageWithTimestamp(
            photoFile = photoFile,
            timestampMillis = podData.capturedAtMillis,
            latitude = podData.latitude,
            longitude = podData.longitude,
            onSuccess = { base64DataUri ->
                Log.d(TAG, "POD image base64 encoded: ${base64DataUri.length} chars")

                lifecycleScope.launch {
                    try {
                        updateObdLineItemViaApi(
                            shipmentDocId = podData.shipmentDocId,
                            lineItem = podData.lineItem,
                            status = podData.status,
                            podImageUrl = base64DataUri,
                            capturedAtMillis = podData.capturedAtMillis
                        )
                        if (!PodPhotoTempFile.delete(photoFile)) {
                            Log.w(TAG, "Could not delete uploaded POD photo temporary")
                        }
                        com.sysu.go.audit.DriverActionAudit.recordPodCapture(
                            this@MyTripActivity,
                            shipmentId = podData.shipmentDocId,
                            obdNumbers = listOf(podData.lineItem["obdNumber"]?.toString() ?: ""),
                            latitude = podData.latitude,
                            longitude = podData.longitude,
                            capturedAtMillis = podData.capturedAtMillis,
                        )
                        hideUploadProgress()

                        //  Real-time socket broadcast
                        //  Refresh legacy observers while the SQL assignment stream catches up.
                        SocketManager.emitPodUpdated(podData.shipmentDocId)

                        //  Immediate bottom sheet refresh
                        //  Two-path update guarantees the status pill updates even if the
                        //  socket event is lost or arrives after the sheet is reopened.
                        //
                        //  The authenticated assignments stream is the source for the refreshed line items.
                        val bottomSheet = (supportFragmentManager.findFragmentByTag(ObdItemsBottomSheet.TAG)
                            as? ObdItemsBottomSheet)
                        bottomSheet?.showRefreshing()  // spinner ON immediately
                        bottomSheet?.onRefreshRequest?.invoke()  // refreshes the authenticated assignment stream

                        Toast.makeText(
                            this@MyTripActivity,
                            "Status updated!",
                            Toast.LENGTH_SHORT
                        ).show()
                    } catch (e: Exception) {
                        hideUploadProgress()
                        Log.e(TAG, "POD API update failed: ${e.message}")
                        com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "pod-save", e)
                    }
                }
            },
            onFailure = { _ ->
                if (!PodPhotoTempFile.delete(photoFile)) {
                    Log.w(TAG, "Could not delete unprocessable POD photo temporary")
                }
                hideUploadProgress()
                Log.e(TAG, "POD image processing failed")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "pod-processing")
            }
        )
    }

    /** Saves a completed OBD photo through the authenticated MySQL-backed POD API. */
    private suspend fun updateObdLineItemViaApi(
        shipmentDocId: String,
        lineItem: Map<String, Any?>,
        status: String,
        podImageUrl: String,
        capturedAtMillis: Long
    ) {
        val obdNumber = lineItem["obdNumber"] as? String
            ?: throw IllegalArgumentException("Missing obdNumber in lineItem")

        com.sysu.go.network.PodApiService.update(
            this,
            shipmentDocId,
            obdNumber,
            com.sysu.go.network.PodRequestFactory.complete(podImageUrl, status, capturedAtMillis),
        )
        clearUnloadCheckpoint(shipmentDocId, obdNumber)
        Log.d(TAG, "POD API committed OBD=$obdNumber in dispatch=$shipmentDocId")
    }

    /**
     * Saves a crash-proof unload-state checkpoint to SharedPreferences.
     * Uses synchronous commit() so it survives process death before the API responds.
     */
    private fun saveUnloadCheckpoint(docId: String, obd: String, status: String) {
        val prefs = getSharedPreferences(UNLOAD_CHECKPOINTS_PREFS, MODE_PRIVATE)
        prefs.edit()
            .putString("${docId}__${obd}", status)
            .putLong("${docId}__${obd}_ts", System.currentTimeMillis())
            .commit()
    }

    /**
     * Clears a checkpoint after the API has successfully persisted the state.
     * Uses async apply() — no need to block at this point.
     */
    private fun clearUnloadCheckpoint(docId: String, obd: String) {
        getSharedPreferences(UNLOAD_CHECKPOINTS_PREFS, MODE_PRIVATE)
            .edit()
            .remove("${docId}__${obd}")
            .remove("${docId}__${obd}_ts")
            .apply()
    }

    /** Persists the local recovery checkpoint before sending the server-owned unload update. */
    private fun writeUnloadStatus(
        shipmentDocId: String,
        obdNumber: String,
        status: String?
    ) {
        Log.d(TAG, "writeUnloadStatus: BEGIN docId=$shipmentDocId, obd=$obdNumber, status=$status")

        val checkpoint = com.sysu.go.network.PodRequestFactory.checkpoint(status)
        saveUnloadCheckpoint(shipmentDocId, obdNumber, checkpoint)

        if (status == "UPLOADING") {
            //  Uploading is a local recovery marker; the backend accepts only UNLOADING or clear.
            return
        }

        lifecycleScope.launch {
            try {
                com.sysu.go.network.PodApiService.update(
                    this@MyTripActivity,
                    shipmentDocId,
                    obdNumber,
                    com.sysu.go.network.PodRequestFactory.unload(status),
                )
                clearUnloadCheckpoint(shipmentDocId, obdNumber)
                Log.d(TAG, "writeUnloadStatus: COMPLETE for obd=$obdNumber")
                if (status == "UNLOADING") {
                    com.sysu.go.audit.DriverActionAudit.recordFreshLocation(
                        this@MyTripActivity,
                        "unloading_started",
                        subjectId = shipmentDocId,
                        metadata = org.json.JSONObject().put("obdRef", obdNumber),
                        idempotencyKey = "unloading:$shipmentDocId:$obdNumber"
                    )
                }

            } catch (e: Exception) {
                Log.e(TAG, "POD API unload update failed for obd=$obdNumber: ${e.message}")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "shipment-state-transition", e)
            }
        }
    }

    /**
     * Handles RETAKE tap on a COMPLETE OBD row.
     * Shows a strict confirmation dialog before wiping the current POD image.
     * 1. Alert the driver that existing photo will be cleared.
     * 2. If confirmed: clear the stored POD through the authenticated API
     * 3. Set unloadStatus=UNLOADING and fire showObdStatusSheet (camera flow)
     */
    private fun retakeObdPod(item: Map<String, Any?>, shipmentDocId: String) {
        val obdNumber = item["obdNumber"] as? String ?: return

        //  Confirmation window before triggering retake
        val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
        dlgView.findViewById<ImageView>(R.id.ivDialogIcon).apply {
            setImageResource(R.drawable.ic_dialog_destructive)
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MyTripActivity, R.color.sysu_red))
        }
        dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Ulitin ang Litrato?"
        dlgView.findViewById<TextView>(R.id.tvDialogMessage).text =
            "Mawawala ang kasalukuyang na-capture na litrato para sa OBD #$obdNumber kapag nagpatuloy ka.\n\nSigurado ka bang nais mong mag-retake?"

        val dialog = AlertDialog.Builder(this)
            .setView(dlgView)
            .setCancelable(false)
            .create()

        dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener {
            dialog.dismiss()
        }

        dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
            text = "I-retake ang Litrato"
            backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MyTripActivity, R.color.sysu_red))
            setOnClickListener {
                dialog.dismiss()
                performRetake(item, shipmentDocId, obdNumber)
            }
        }

        dialog.show()
    }

    private fun performRetake(item: Map<String, Any?>, shipmentDocId: String, obdNumber: String) {
        lifecycleScope.launch {
            try {
                com.sysu.go.network.PodApiService.update(
                    this@MyTripActivity,
                    shipmentDocId,
                    obdNumber,
                    mapOf("action" to "retake"),
                )
                (supportFragmentManager.findFragmentByTag(ObdItemsBottomSheet.TAG) as? ObdItemsBottomSheet)
                    ?.onRefreshRequest?.invoke()
                showObdStatusSheet(item, shipmentDocId)
            } catch (e: Exception) {
                Log.e(TAG, "retakeObdPod failed: ${e.message}")
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "pod-save", e)
            }
        }
    }

    companion object {
        private const val TAG = "MyTripActivity"
        //  Bundle keys for savedInstanceState (survives Activity restart from permission dialog)
        private const val KEY_PENDING_OBD_ITEM = "pending_obd_item"
        private const val KEY_PENDING_SHIPMENT_DOC_ID = "pending_obd_shipment_doc_id"
        private const val KEY_PENDING_CAPTURED_AT = "pending_captured_at_millis"
        /** SharedPreferences file name for unload state checkpoints — survives app crashes. */
        private const val UNLOAD_CHECKPOINTS_PREFS = "unload_checkpoints"
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        //  Persist the pending OBD state so if the Activity is restarted while
        //  the location permission dialog is showing (e.g., memory pressure, OEM
        //  behavior), these values are available in onCreate for the fresh instance.
        pendingObdItem?.let { outState.putSerializable(KEY_PENDING_OBD_ITEM, HashMap(it)) }
        pendingObdShipmentDocId?.let { outState.putString(KEY_PENDING_SHIPMENT_DOC_ID, it) }
        if (pendingCapturedAtMillis != 0L) {
            outState.putLong(KEY_PENDING_CAPTURED_AT, pendingCapturedAtMillis)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        binding = ActivityMyTripBinding.inflate(layoutInflater)
        setContentView(binding.root)

        //  Restore savedInstanceState from before the permission-dialog restart.
        //  When the location permission dialog appears, the Activity is STOPPED and
        //  CAN be recreated (e.g., memory pressure, some OEM implementations).
        //  Without this restore, the new Activity instance has null pendingObdItem
        //  and the GPS fix → camera flow silently falls through with no location.
        savedInstanceState?.let { bundle ->
            @Suppress("UNCHECKED_CAST")
            (bundle.getSerializable(KEY_PENDING_OBD_ITEM) as? HashMap<String, Any?>)?.let {
                pendingObdItem = it
            }
            pendingObdShipmentDocId = bundle.getString(KEY_PENDING_SHIPMENT_DOC_ID)
            pendingCapturedAtMillis = bundle.getLong(KEY_PENDING_CAPTURED_AT, 0L)
            Log.d(TAG, "Restored pending state from savedInstanceState: item=${pendingObdItem?.get("obdNumber")}, docId=$pendingObdShipmentDocId")
        }

        //  FusedLocationProviderClient for one-shot GPS fixes during POD capture
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        //  Register camera result BEFORE adapter so callbacks can use it
        registerCameraLauncher()

        //  Create adapter once — stored as class field so we can update state without re-creating
        shipmentAdapter = MyTripTabAdapter(
            initialHasActiveTrip = false,
            activeShipmentId = null,
            onTripActionClicked = { assignment, action -> onTripActionClicked(assignment, action) },
            onObdTap = { lineItems, docId -> openObdBottomSheet(lineItems, docId) },
            onShowVerification = { assignment -> showGuardVerificationSheet(assignment) }
        )

        setupRecyclerView()
        setupUI()
        //  Defer animations so the first frame completes before GPU work starts.
        //  This prevents DequeueBuffer timeouts during activity transition.
        binding.root.post {
            if (!isFinishing) {
                startCircleAnimation()
                startPulseRings()
            }
        }
    }

    /** Prevents auto-navigation when TransitActivity has called BACK TO MY TRIP. */
    private var returnedFromTransitDocId: String? = null

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        //  When BACK TO MY TRIP in TransitActivity calls startActivity with
        //  NEW_TASK|CLEAR_TOP|SINGLE_TOP, Android delivers the new intent here on the
        //  existing MyTripActivity. Store the extra — handleAssignmentList uses it
        //  (via returnedFromTransitDocId) to block auto-navigation for the entire
        //  visible lifetime of this instance.
        this.intent = intent  // update the Activity's intent reference
        returnedFromTransitDocId = intent.getStringExtra("shipment_doc_id")
        Log.d(TAG, "onNewIntent: returnedFromTransitDocId=$returnedFromTransitDocId")
    }

    override fun onResume() {
        super.onResume()
        //  Register Socket.IO listeners
        //  sap_updated → rebuilds the full shipment list in real-time
        //  pod_updated → refreshes the bottom sheet in-place after POD capture
        //  Both fire immediately when the backend starts emitting (after MySQL migration).
        //  MyTripActivity stays in sync through authenticated Socket.IO subscriptions.
        SocketManager.addEventListener("sap_updated", socketSapUpdatedListener)
        SocketManager.addEventListener("pod_updated", socketPodUpdatedListener)

        //  Load initial data (deferred by 150ms)
        //  Assignment stream triggers handleAssignmentList which can auto-navigate.
        //  Deferred start prevents GPU overload during first-frame render, avoiding
        //  DequeueBuffer timeouts that can cascade into Watchdog process kills.
        binding.root.post {
            if (!isFinishing) loadAssignments()
        }
    }

    override fun onPause() {
        super.onPause()
        //  Remove socket listeners so we don't get callbacks while paused.
        //  The socket connection itself stays alive (managed by LocationServices/TransitActivity).
        SocketManager.removeEventListener("sap_updated", socketSapUpdatedListener)
        SocketManager.removeEventListener("pod_updated", socketPodUpdatedListener)
    }

    override fun onDestroy() {
        super.onDestroy()
        circleAnimators.forEach { it.cancel() }
        circleAnimators.clear()
        circleViews.forEach { binding.circleContainer.removeView(it) }
        circleViews.clear()
        assignmentsListener?.invoke()
        uploadProgressDialog?.dismiss()
        uploadProgressDialog = null
    }

    //  UI setup

    private fun setupUI() {
        binding.btnBack.setOnClickListener { finish() }
    }

    private suspend fun awaitAssignmentSnapshot(dispatchKey: String): Map<String, Any?> =
        withTimeout(8000) {
            suspendCancellableCoroutine { continuation ->
                var unsubscribe: (() -> Unit)? = null
                unsubscribe = SocketManager.subscribeRealtime(
                    topic = "assignments",
                    onData = { payload ->
                        if (continuation.isActive) {
                            val row = (payload as? List<*>)
                                ?.mapNotNull(::stringKeyedMap)
                                ?.firstOrNull { it["id"] == dispatchKey || it["dispatchKey"] == dispatchKey }
                            if (row != null) {
                                unsubscribe?.invoke()
                                continuation.resume(row)
                            }
                        }
                    },
                    onError = { message ->
                        if (continuation.isActive) {
                            unsubscribe?.invoke()
                            continuation.resumeWithException(IllegalStateException(message))
                        }
                    },
                )
                continuation.invokeOnCancellation { unsubscribe?.invoke() }
            }
        }

    private fun stringKeyedMap(value: Any?): Map<String, Any?>? {
        val map = value as? Map<*, *> ?: return null
        return map.entries.mapNotNull { (key, item) -> (key as? String)?.let { it to item } }.toMap()
    }

    private fun jsonMap(value: org.json.JSONObject): Map<String, Any?> =
        value.keys().asSequence().associateWith { key -> jsonValue(value.opt(key)) }

    private fun jsonValue(value: Any?): Any? = when (value) {
        null, org.json.JSONObject.NULL -> null
        is org.json.JSONObject -> jsonMap(value)
        is org.json.JSONArray -> (0 until value.length()).map { jsonValue(value.opt(it)) }
        else -> value
    }

    private fun setupRecyclerView() {
        val rv = binding.rvShipments
        rv.layoutManager = LinearLayoutManager(this)
        rv.adapter = shipmentAdapter
        rv.overScrollMode = RecyclerView.OVER_SCROLL_ALWAYS
        rv.itemAnimator = androidx.recyclerview.widget.DefaultItemAnimator().apply {
            addDuration = 200
            removeDuration = 200
            moveDuration = 200
            changeDuration = 200
        }
    }

    //  Authenticated SQL assignment stream

    /**
     * Loads assignments from the authenticated SQL-backed Socket.IO stream.
     */
    private fun loadAssignments() {
        assignmentsListener?.invoke()
        val sessionDriverId = sessionManager.getDriverId() ?: return
        if (!hasLoadedAssignments) {
            binding.loadingSkeleton.root.visibility = View.VISIBLE
            binding.rvShipments.visibility = View.GONE
            binding.emptyState.visibility = View.GONE
        }
        binding.tvLoadError.visibility = View.GONE
        SocketManager.connect(this)
        val intentDocId = intent.getStringExtra("shipment_doc_id")

        //  The backend scopes assignments by the authenticated MySQL driver ID; status filtering stays client-side.
        assignmentsListener = SocketManager.subscribeRealtime("assignments", onData = { payload ->
                val records = payload as? List<*> ?: return@subscribeRealtime
                if (isFinishing) return@subscribeRealtime

                //  Render active shipments from this QR queue session only; prior trips remain history.
                val currentQueueId = sessionManager.getCurrentQueueDocId()
                val active = records.mapNotNull { it as? Map<String, Any?> }.filter { doc ->
                    val s = doc["tripStatus"] as? String
                    s != "completed" && s != "delivered" &&
                        (currentQueueId.isNullOrBlank() || doc["queueId"] == currentQueueId)
                }

                val list = active.mapNotNull { snap ->
                    @Suppress("UNCHECKED_CAST")
                    buildAssignmentFromMap(snap + ("docId" to (snap["id"] ?: "")))
                }
                fetchDriverData(list) { enriched ->
                    enrichWithQueueData(enriched) { final ->
                        handleAssignmentList(final, intentDocId)
                    }
                }
            }, onError = { error ->
                Log.e(TAG, "loadAssignments realtime error: $error")
                com.sysu.go.diagnostics.UserErrorNotifier.showRealtimeFailure(this@MyTripActivity, "assignment-subscription")
                if (!hasLoadedAssignments && !isFinishing) {
                    binding.loadingSkeleton.root.visibility = View.GONE
                    binding.tvLoadError.visibility = View.VISIBLE
                }
            })
    }

    /**
     * Second pass: fetch the queue document (source of truth for truckType and helper).
     * Sap_assignments only holds a driverId reference pointing to the queue doc;
     * the queue doc itself carries the canonical truckType ("AUV") and helper ("Hshs A. Dnzb").
     * Mirrors AssignmentActivity.submitToAdapter's queue lookup pattern.
     *
     * This is a fire-and-forget parallel fetch — each assignment fires its own
     * queue doc lookup; all results are collected before the onReady callback fires.
     */
    private fun enrichWithQueueData(
        assignments: List<Assignment>,
        onReady: (List<Assignment>) -> Unit
    ) {
        //  Authenticated SQL assignment snapshots already carry these fields.
        onReady(assignments)
    }

    /** Enriches assignments from the authenticated SQL driver-profile endpoint. */
    private fun fetchDriverData(
        assignments: List<Assignment>,
        onReady: (List<Assignment>) -> Unit
    ) {
        lifecycleScope.launch {
            val enriched = runCatching {
                val profile = withContext(Dispatchers.IO) {
                    com.sysu.go.network.DriverProfileApiService.getOwn(this@MyTripActivity)
                }
                assignments.map { assignment ->
                    assignment.copy(
                        requirements = profile.requirements,
                        truckCompany = profile.truckingCompany.ifBlank { assignment.truckCompany },
                    )
                }
            }.getOrElse { error ->
                Log.w(TAG, "Driver profile unavailable; using assignment metadata: ${error.message}")
                assignments
            }
            if (!isFinishing) onReady(enriched)
        }
    }

    private fun handleAssignmentList(list: List<Assignment>, intentDocId: String?) {
        hasLoadedAssignments = true
        binding.loadingSkeleton.root.visibility = View.GONE
        binding.tvLoadError.visibility = View.GONE
        val isReturningFromTransit = returnedFromTransitDocId != null

        //  Suppress auto-navigation when the user explicitly opened MyTripActivity
        //  (no shipment_doc_id Intent extra, not returning from TransitActivity).
        //  Let them browse the card list and tap OBD Items themselves.
        //  Only auto-navigate if launched with a specific shipment_doc_id (continuity).
        val suppressAutoNav = intentDocId == null || isReturningFromTransit

        //  If launched with a specific shipment_doc_id — load that shipment card
        //  without auto-navigating. This handles both fresh Intent launches
        //  (from dashboard) and onNewIntent calls (from BACK TO MY TRIP).
        if (!intentDocId.isNullOrBlank()) {
            val target = list.find { it.docId == intentDocId }
            if (target != null) {
                loadSpecificShipment(target)
                //  Consume the extra so future onResume cycles don't re-trigger.
                //  returnedFromTransitDocId stays set if we are in the return path
                //  (it is the authoritative "don't auto-nav" signal).
                intent.removeExtra("shipment_doc_id")
                Log.d(TAG, "handleAssignmentList: loaded specific shipment intentDocId=$intentDocId, cleared intent extra")
                return
            }
        }

        //  If BACK TO MY TRIP brought us here, load that specific shipment and stop.
        //  Don't auto-navigate — we are already on the My Trip tab. The
        //  returnedFromTransitDocId flag stays set so subsequent SQL updates
        //  (socket sap_updated) won't fire auto-navigation while the user is here.
        if (isReturningFromTransit) {
            val target = list.find { it.docId == returnedFromTransitDocId }
            if (target != null) {
                loadSpecificShipment(target)
                Log.d(TAG, "handleAssignmentList: loaded from transit return returnedFromTransitDocId=$returnedFromTransitDocId")
            }
            //  NOTE: do NOT clear returnedFromTransitDocId here. It is the authoritative
            //  "don't auto-nav" signal until the session is cleared (trip completion/cancellation).
            return
        }

        //  Normal start (app launch, no in-flight return) — auto-navigate if in_transit
        val inTransit = list.find { it.tripStatus == "in_transit" }
        if (inTransit != null && !suppressAutoNav) {
            launchDeliveryActivity(inTransit.docId)
            return
        }

        //  Show confirmed-but-not-in-transit and in_transit shipments as cards.
        //  In_transit shipments are included so the user can see their active trip
        //  without auto-navigation (suppressAutoNav case from home tab).
        val showable = list.filter {
            (it.guardVerified && it.driverConfirmed && it.tripStatus != "in_transit" && it.tripStatus != "completed") ||
            it.tripStatus == "in_transit"
        }

        //  Lock all non-in-transit cards if ANY shipment is in_transit.
        //  Derived from FULL list (not showable) so we catch in_transit even when
        //  it was filtered out of showable due to suppressAutoNav.
        val hasOtherActiveTrip = list.any { it.tripStatus == "in_transit" }

        shipmentAdapter.hasActiveTrip = hasOtherActiveTrip
        shipmentAdapter.activeShipmentId = null
        shipmentAdapter.submitList(showable.toList())

        updateAggregateBadge(showable)
        updateEmptyState(showable.isEmpty(), list.isEmpty())
        binding.tvBadgeText.text = getString(R.string.my_trip_badge_trips_ready)
    }

    /**
     * Shows the shipment's card in MyTripActivity.
     * Does NOT auto-navigate — the card's action button (START TRIP or VIEW OBD ITEMS)
     * handles navigation. This prevents double-navigation when confirmAndStartTrip saves
     * tripStatus=in_transit and re-launches MyTripActivity via Intent with shipment_doc_id.
     */
    private fun loadSpecificShipment(shipment: Assignment) {
        val isInTransit = shipment.tripStatus == "in_transit"

        shipmentAdapter.hasActiveTrip = isInTransit
        shipmentAdapter.activeShipmentId = if (isInTransit) shipment.docId else null
        shipmentAdapter.submitList(listOf(shipment))

        //  Do NOT auto-navigate here — let the card's action button handle it.
        //  Auto-navigation only happens in handleAssignmentList for non-intentDocId cases.
        updateAggregateBadge(listOf(shipment))
        binding.tvBadgeText.text = if (isInTransit) {
            getString(R.string.cta_status_transit)
        } else {
            shipment.shipmentNumber.ifBlank { shipment.docId }
        }
        binding.emptyState.visibility = View.GONE
    }

    private fun updateEmptyState(listEmpty: Boolean, totalEmpty: Boolean) {
        if (totalEmpty) {
            //  No assignments at all
            binding.rvShipments.visibility = View.GONE
            binding.emptyState.visibility = View.VISIBLE
            binding.badgeVerified.visibility = View.GONE
            binding.aggregateBadgeContainer.visibility = View.GONE
        } else if (listEmpty) {
            //  Assignments exist but none confirmed yet
            binding.rvShipments.visibility = View.GONE
            binding.emptyState.visibility = View.VISIBLE
        } else {
            binding.rvShipments.visibility = View.VISIBLE
            binding.emptyState.visibility = View.GONE
        }
    }

    //  Per-card action

    private fun onTripActionClicked(assignment: Assignment, action: String) {
        when (action) {
            "LOCKED_HAS_ACTIVE_TRIP" -> {
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_info, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_alert)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = getString(R.string.locked_has_active_trip_title)
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = getString(R.string.locked_has_active_trip_msg)
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnDismiss).setOnClickListener { dialog.dismiss() }
                dialog.show()
            }
            "END_TRIP", "END_SHIPMENT" -> {
                endSingleShipment(assignment.docId)
            }
            "OPEN_ACTIVE_TRIP" -> {
                launchDeliveryActivity(assignment.docId)
            }
            "START_TRIP" -> {
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_confirm)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = getString(R.string.confirm_start_trip_title)
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = getString(R.string.confirm_start_trip_message)
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                    text = getString(R.string.btn_start_trip)
                    backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MyTripActivity, R.color.sysu_red))
                    setOnClickListener { dialog.dismiss(); confirmAndStartTrip(assignment) }
                }
                dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
                dialog.show()
            }
            "START_LOADING" -> {
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_shipping)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Simulan ang Pag-Load?"
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Sigurado ka bang gusto mong simulan ang pag-load ng shipment ${assignment.shipmentNumber}?"
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                    text = "Yes, Start Loading"
                    backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MyTripActivity, R.color.sysu_red))
                    setOnClickListener { dialog.dismiss(); lifecycleScope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                com.sysu.go.network.AssignmentApiService.update(
                                    this@MyTripActivity, assignment.docId, mapOf("status" to "loading")
                                )
                            }
                            Log.d(TAG, "START_LOADING: ${assignment.docId}")
                            loadAssignments()
                        } catch (e: Exception) {
                            Log.e(TAG, "START_LOADING error: ${e.message}")
                            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "shipment-state-transition", e)
                        }
                    }}
                }
                dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
                dialog.show()
            }
            "FULLY_LOADED" -> {
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_shipping)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Fully Loaded?"
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Ang shipment ${assignment.shipmentNumber} ba ay kumpletong na-load at handa na para sa guard verification?"
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                    text = "Yes, Fully Loaded"
                    backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MyTripActivity, R.color.sysu_red))
                    setOnClickListener { dialog.dismiss(); lifecycleScope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                com.sysu.go.network.AssignmentApiService.update(
                                    this@MyTripActivity, assignment.docId, mapOf("status" to "fully_loaded")
                                )
                            }
                            val driverId = sessionManager.getDriverId() ?: ""
                            if (driverId.isNotBlank()) SocketManager.emitDriverFull(true)
                            Log.d(TAG, "FULLY_LOADED: ${assignment.docId}")
                            loadAssignments()
                        } catch (e: Exception) {
                            Log.e(TAG, "FULLY_LOADED error: ${e.message}")
                            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "shipment-state-transition", e)
                        }
                    }}
                }
                dlgView.findViewById<MaterialButton>(R.id.btnCancel).setOnClickListener { dialog.dismiss() }
                dialog.show()
            }
            "CANCEL_LOADING" -> {
                val dlgView = LayoutInflater.from(this).inflate(R.layout.dialog_sysu_confirmation, null)
                dlgView.findViewById<ImageView>(R.id.ivDialogIcon).setImageResource(R.drawable.ic_dialog_destructive)
                dlgView.findViewById<TextView>(R.id.tvDialogTitle).text = "Kanselahin ang Loading?"
                dlgView.findViewById<TextView>(R.id.tvDialogMessage).text = "Ibalik ang shipment ${assignment.shipmentNumber} sa pending? Kakanselahin nito ang proseso ng loading."
                val dialog = AlertDialog.Builder(this).setView(dlgView).create()
                dlgView.findViewById<MaterialButton>(R.id.btnConfirm).apply {
                    text = "Yes, Cancel"
                    backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@MyTripActivity, R.color.sysu_red))
                    setOnClickListener { dialog.dismiss(); lifecycleScope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                com.sysu.go.network.AssignmentApiService.update(
                                    this@MyTripActivity, assignment.docId, mapOf("status" to null)
                                )
                            }
                            val driverId = sessionManager.getDriverId() ?: ""
                            if (driverId.isNotBlank()) SocketManager.emitDriverFull(false)
                val uid = sessionManager.getDriverId()
                val driverName = sessionManager.getDriverName() ?: "Driver"
                if (uid != null) {
                    SocketManager.emitCompletedStatus(uid, driverName)
                }
                            Log.d(TAG, "CANCEL_LOADING: ${assignment.docId}")
                            loadAssignments()
                        } catch (e: Exception) {
                            Log.e(TAG, "CANCEL_LOADING error: ${e.message}")
                            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "shipment-state-transition", e)
                        }
                    }}
                }
                dlgView.findViewById<MaterialButton>(R.id.btnCancel).apply {
                    text = "Keep Loading"
                    setOnClickListener { dialog.dismiss() }
                }
                dialog.show()
            }
            "VERIFY_GUARD" -> {
                //  Navigate to AssignmentActivity where guard verification happens.
                //  The existing guard verification flow writes guardVerified=true.
                //  Task 5 auto-detects tripStatus=="fully_loaded" + guardVerified==true → "loaded".
                val intent = Intent(this@MyTripActivity, AssignmentActivity::class.java).apply {
                    putExtra("shipment_doc_id", assignment.docId)
                    flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                startActivity(intent)
            }
            "VIEW_SUMMARY" -> {
                //  Completed shipment — refresh the list instead.
                //  (TransitActivity handles viewing completed trip details in read mode.)
                loadAssignments()
            }
            //  RETURNING_TO_BASE is intentionally NOT handled here:
            //  with the per-shipment refactor, multi-shipment drivers END each shipment
            //  individually (END SHIPMENT routes tripStatus → "completed"). Once ALL
            //  shipments hit "completed", the map icon in MainActivity Route 0 opens
            //  ReturnToBaseBottomSheet, which manages the multi-step driver-level
            //  return journey entirely on drivers.{driverId}.returnStatus:
            //  1. START RETURNING TO BASE → "returning_to_base"
            //  2. ARRIVED AT BASE → "arrived_at_base" (geo tracking stops here)
            //  3. YES, CONFIRM ARRIVAL → "completed" + queue released
            //  The old per-shipment RETURNING_TO_BASE action was dead code after that
            //  refactor and would have caused duplicate tripStatus writes.
        }
    }

    private fun confirmShipment(assignment: Assignment, onSuccess: () -> Unit) {
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.update(
                        this@MyTripActivity, assignment.docId, mapOf("driverConfirmed" to true)
                    )
                }
                Log.d(TAG, "Shipment confirmed: ${assignment.docId}")
                onSuccess()
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "shipment-completion", e)
                Log.e(TAG, "confirmShipment error: ${e.message}")
            }
        }
    }

    private fun confirmAndStartTrip(assignment: Assignment) {
        lifecycleScope.launch {
            try {
                //  Save as active trip in session FIRST
                sessionManager.saveActiveSapDocId(assignment.docId)
                sessionManager.saveCurrentSapDocId(assignment.docId)
                sessionManager.setTripActive(true)
                sessionManager.setTrackingActive(true)

                withContext(Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.update(
                        this@MyTripActivity, assignment.docId, mapOf("status" to "in_transit")
                    )
                }

                Log.d(TAG, "startTrip: ${assignment.docId} → in_transit")
                Toast.makeText(this@MyTripActivity, "Nagsimula na ang biyahe!", Toast.LENGTH_SHORT).show()

                //  Navigate directly to TransitActivity for live tracking.
                //  Driver-driven: single tap selects which shipment to start tracking.
                //  For multi-shipment: driver completes this trip → BACK TO HOME →
                //  MainActivity → MyTripActivity → picks next shipment → same flow.
                launchDeliveryActivity(assignment.docId)
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "trip-start", e)
                Log.e(TAG, "confirmAndStartTrip error: ${e.message}")
                sessionManager.saveActiveSapDocId(null)
                sessionManager.clearCurrentSapDocId()
                sessionManager.setTripActive(false)
            }
        }
    }

    private fun launchDeliveryActivity(sapDocId: String) {
        sessionManager.saveCurrentSapDocId(sapDocId)
        val intent = Intent(this, GeneralTrackingActivity::class.java).apply {
            putExtra("shipment_doc_id", sapDocId)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        startActivity(intent)
    }

    /**
     * Marks a single shipment as completed when all PODs have been captured.
     * Called from "END TRIP" button in MyTripActivity card list.
     * Updates the SQL assignment, clears session for this shipment, and reloads the card list.
     */
    private fun endSingleShipment(docId: String) {
        //  Industry-standard: block completion if any POD still pending.
        //  Defense-in-depth — the UI button guard (isPodComplete) already protects
        //  this path, but enforce at business-logic level in case of direct calls.
        val shipment = shipmentAdapter.currentList.find { it.docId == docId }
        val isPodComplete = shipment?.lineItems?.all { (it["isPodCompleted"] as? Boolean) == true } == true
        if (!isPodComplete) {
            Toast.makeText(this, "Tapusin lahat ng POD items bago tapusin ang shipment.", Toast.LENGTH_LONG).show()
            Log.w(TAG, "[endSingleShipment] BLOCKED — PODs incomplete for $docId")
            return
        }

        //  Set ending state on the card — shows "ENDING..." disabled button
        shipmentAdapter.setEndingDocId(docId)
        shipmentAdapter.notifyDataSetChanged()

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    com.sysu.go.network.AssignmentApiService.update(
                        this@MyTripActivity, docId, mapOf("status" to "completed")
                    )
                }

                Log.d(TAG, "endSingleShipment: $docId → completed")

                //  Check remaining active shipments in current adapter list
                val remainingActive = shipmentAdapter.currentList.filter {
                    it.docId != docId && it.tripStatus != "completed" && it.tripStatus != "delivered" 
                }

                //  Keep one owned assignment as the location checkpoint anchor throughout this queue session.
                //  On the final delivery, retain this shipment as the anchor until return-to-base changes it
                //  to returning_to_base, so location updates can continue on the return leg.
                if (sessionManager.getActiveSapDocId() == docId) {
                    val trackingAnchor = remainingActive.firstOrNull()?.docId ?: docId
                    sessionManager.saveActiveSapDocId(trackingAnchor)
                    sessionManager.saveCurrentSapDocId(trackingAnchor)
                    sessionManager.setTripActive(true)
                    sessionManager.setTrackingActive(true)
                }

                if (remainingActive.isEmpty()) {
                    //  Keep the overview marker and GPS session until base arrival is confirmed.
                    SocketManager.emitDriverFull(false)
                    runOnUiThread {
                        Toast.makeText(this@MyTripActivity, "Lahat ng karga ay nai-deliver na! Maaari nang bumalik sa planta.", Toast.LENGTH_LONG).show()
                    }
                } else {
                    runOnUiThread {
                        Toast.makeText(this@MyTripActivity, "Nai-deliver ang shipment! May ${remainingActive.size} pang natitira.", Toast.LENGTH_SHORT).show()
                    }
                }

                //  Clear ending state and reload so card transitions to "VIEW SUMMARY"
                shipmentAdapter.setEndingDocId(null)
                loadAssignments()
            } catch (e: Exception) {
                com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "shipment-completion", e)
                Log.e(TAG, "endSingleShipment error: ${e.message}")
                shipmentAdapter.setEndingDocId(null)
                shipmentAdapter.notifyDataSetChanged()
                runOnUiThread {
                }
            }
        }
    }

    /**
     * Scans SharedPreferences for orphaned unload-state checkpoints and reconciles them
     * with the current assignment stream lineItems. Called every time openObdBottomSheet loads.
     *
     * - If a checkpoint matches the assignment item, clean it up
     * - Otherwise, re-apply it locally and retry the authenticated API write
     * - If no checkpoint exists → no-op
     *
     * Returns a potentially-modified copy of lineItems with recovered states applied.
     */
    @Suppress("UNCHECKED_CAST")
    private fun recoverOrphanedCheckpoints(
        lineItems: List<Map<String, Any>>,
        docId: String
    ): List<Map<String, Any>> {
        val prefs = getSharedPreferences(UNLOAD_CHECKPOINTS_PREFS, MODE_PRIVATE)
        val prefix = "${docId}__"
        val keys = prefs.all.keys.filter { it.startsWith(prefix) && !it.endsWith("_ts") }

        if (keys.isEmpty()) return lineItems

        var result = lineItems
        val cleaned = mutableListOf<String>()

        for (key in keys) {
            val obd = key.removePrefix(prefix)
            val checkpoint = prefs.getString(key, null) ?: continue

            val idx = result.indexOfFirst { (it["obdNumber"] as? String) == obd }
            if (idx == -1) continue

            val savedStatus = result[idx]["unloadStatus"] as? String
            val clearRequested = checkpoint == com.sysu.go.network.PodRequestFactory.CLEAR_PENDING_CHECKPOINT
            val desiredStatus = if (clearRequested) null else if (checkpoint == "UPLOADING") "UNLOADING" else checkpoint
            val savedNormalized = savedStatus?.takeIf(String::isNotBlank)

            if (savedNormalized == desiredStatus) {
                cleaned.add(obd)
                continue
            }

            Log.d(TAG, "Recovering local unload checkpoint: obd=$obd status=$desiredStatus")
            result = result.toMutableList().also {
                it[idx] = it[idx].toMutableMap().apply {
                    if (desiredStatus == null) remove("unloadStatus")
                    else this["unloadStatus"] = desiredStatus
                }
            }
            //  Keep the checkpoint until the authenticated server update succeeds.
            writeUnloadStatus(docId, obd, desiredStatus)
        }

        //  Batch-clean synced checkpoints
        if (cleaned.isNotEmpty()) {
            val editor = prefs.edit()
            for (obd in cleaned) {
                editor.remove("${docId}__${obd}")
                editor.remove("${docId}__${obd}_ts")
            }
            editor.apply()
        }

        return result
    }

    /**
     * Opens the OBD items bottom sheet for any shipment state.
     * For in-transit shipments, tapping a row navigates to that shipment.
     * For confirmed/not-yet-in-transit shipments, items are read-only.
     * Pending OBD rows show a camera button that triggers showObdStatusSheet().
     */
    private fun openObdBottomSheet(lineItems: List<Map<String, Any>>, shipmentDocId: String) {
        if (lineItems.isEmpty()) {
            Toast.makeText(this, "Walang available na OBD items", Toast.LENGTH_SHORT).show()
            return
        }

        //  Recover any orphaned unload-state checkpoints from a previous crash
        val recoveredItems = recoverOrphanedCheckpoints(lineItems, shipmentDocId)

        val bottomSheet = ObdItemsBottomSheet.newInstance(
            lineItems = recoveredItems,
            shipmentDocId = shipmentDocId,
            onItemClick = { item ->
                val isCompleted = item["isPodCompleted"] as? Boolean ?: false
                val dataUri = item["podImageUrl"] as? String ?: ""
                Log.d(TAG, "onItemClick: isCompleted=$isCompleted, dataUri len=${dataUri.length}")
                if (isCompleted) {
                    if (dataUri.startsWith("data:image/")) {
                        showPodFullScreenPreview(dataUri)
                    } else {
                        val obd = item["obdNumber"] as? String
                        if (obd.isNullOrBlank()) return@newInstance
                        lifecycleScope.launch {
                            try {
                                val image = com.sysu.go.network.PodApiService.getImage(
                                    this@MyTripActivity, shipmentDocId, obd
                                )
                                if (image.isNullOrBlank()) {
                                    Toast.makeText(this@MyTripActivity, "Hindi ma-load ang preview ng litrato", Toast.LENGTH_SHORT).show()
                                } else {
                                    val uri = if (image.startsWith("data:image/")) image else "data:image/jpeg;base64,$image"
                                    showPodFullScreenPreview(uri)
                                }
                            } catch (error: Exception) {
                                Log.w(TAG, "POD image fetch failed for OBD=$obd: ${error.message}")
                                Toast.makeText(this@MyTripActivity, "Hindi ma-load ang preview ng litrato", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            },
            onObdCameraTap = { item, docId ->
                val obd = item["obdNumber"] as? String ?: return@newInstance
                Log.d(TAG, "onObdCameraTap FIRED: obd=$obd, docId=$docId")
                //  Persist UPLOADING state BEFORE camera fires — survives app kill during upload
                val sheet = (supportFragmentManager.findFragmentByTag(ObdItemsBottomSheet.TAG)
                    as? ObdItemsBottomSheet)
                writeUnloadStatus(docId, obd, "UPLOADING")
                Log.d(TAG, "onObdCameraTap: calling showObdStatusSheet NOW")
                showObdStatusSheet(item, docId)
                Log.d(TAG, "onObdCameraTap: showObdStatusSheet RETURNED (camera should be open)")
            },
            onUnloadConfirm = { item, docId ->
                val obd = item["obdNumber"] as? String ?: return@newInstance
                Log.d(TAG, "onUnloadConfirm: OBD=$obd, docId=$docId")
                //  Keep a sheet reference so the status can update optimistically.
                val sheet = (supportFragmentManager.findFragmentByTag(ObdItemsBottomSheet.TAG)
                    as? ObdItemsBottomSheet)
                writeUnloadStatus(docId, obd, "UNLOADING")
                //  Refresh bottom sheet to show UNLOADING state immediately
                sheet?.let { s ->
                    @Suppress("UNCHECKED_CAST")
                    val current = s.lineItems.toMutableList()
                    val idx = current.indexOfFirst { (it["obdNumber"] as? String) == obd }
                    Log.d(TAG, "onUnloadConfirm: found OBD at index=$idx in ${current.size} items")
                    if (idx != -1) {
                        current[idx] = current[idx].toMutableMap().apply { this["unloadStatus"] = "UNLOADING" }
                        Log.d(TAG, "onUnloadConfirm: calling refreshWith with UNLOADING state for obd=$obd")
                        s.refreshWith(current)
                    }
                } ?: Log.w(TAG, "onUnloadConfirm: bottom sheet was null!")
            },
            onRetakeTap = { item, docId ->
                retakeObdPod(item, docId)
            },
            onUnloadCancel = { item, docId ->
                //  Clear unloadStatus through the API — returns to PENDING state
                val obd = item["obdNumber"] as? String ?: return@newInstance
                val s = (supportFragmentManager.findFragmentByTag(ObdItemsBottomSheet.TAG)
                    as? ObdItemsBottomSheet)
                writeUnloadStatus(docId, obd, null)
                //  Optimistic UI update — refresh sheet to show PENDING immediately
                s?.let { sheet ->
                    @Suppress("UNCHECKED_CAST")
                    val current = sheet.lineItems.toMutableList()
                    val idx = current.indexOfFirst { (it["obdNumber"] as? String) == obd }
                    if (idx != -1) {
                        current[idx] = current[idx].toMutableMap().apply { remove("unloadStatus") }
                        sheet.refreshWith(current)
                    }
                }
            }
        ).also { sheet ->
            //  SAFETY NET: if socket pod_updated never fires (race, server issue, app kill),
            //  this fallback re-fetches the shipment through the authenticated assignment stream and calls
            //  sheet.refreshWith() to update status pills in real-time without reopening the sheet.
            //  Uses lifecycleScope so the coroutine outlives any UI state changes.
            sheet.onRefreshRequest = {
                Log.d(TAG, "onRefreshRequest: requesting assignment snapshot for shipment=$shipmentDocId")
                lifecycleScope.launch {
                    try {
                        SocketManager.connect(this@MyTripActivity)
                        val assignment = awaitAssignmentSnapshot(shipmentDocId)
                        val fresh = (assignment["lineItems"] as? List<*>)?.mapNotNull(::stringKeyedMap)
                        if (!fresh.isNullOrEmpty()) {
                            sheet.refreshWith(fresh)
                            Log.d(TAG, "onRefreshRequest: refreshWith called, ${fresh.size} items")
                        } else {
                            Log.w(TAG, "onRefreshRequest: lineItems was null or empty in SQL snapshot")
                            sheet.hideRefreshing()
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "onRefreshRequest: assignment snapshot failed: ${e.message}")
                        com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "assignment-subscription", e)
                        sheet.hideRefreshing()
                    }
                }
            }
        }

        currentObdBottomSheet = bottomSheet
        bottomSheet.show(supportFragmentManager, ObdItemsBottomSheet.TAG)
    }

    /**
     * Shows current assignment guard verification data in read-only mode.
     * Safe to call even if the data is stale in the local Assignment object.
     */
    private fun showGuardVerificationSheet(assignment: Assignment) {
        GuardVerificationBottomSheet.newInstance(
            firstName = assignment.guardFirstName,
            lastName = assignment.guardLastName,
            mi = assignment.guardMI,
            signature = assignment.guardSignature,
            verifiedAt = assignment.guardVerifiedAtMs,
        ).apply {
            onSubmitConfirmed = { }
        }.show(supportFragmentManager, GuardVerificationBottomSheet.TAG)
    }

    //  Assignment builder

    /**
     * Builds an Assignment from SQL-backed Socket.IO JSON data.
     */
    private fun buildAssignmentFromMap(data: Map<String, Any?>): Assignment? {
        return try {
            //  The server includes the dispatch document key in the data map as "docId".
            val queueId = data["queueId"] as? String ?: ""
            val tripStatus = data["tripStatus"] as? String
            val guardVerified = data["guardVerified"] as? Boolean ?: false
            val driverConfirmed = data["driverConfirmed"] as? Boolean ?: false
            val guardFirstName = data["guardFirstName"] as? String ?: ""
            val guardLastName = data["guardLastName"] as? String ?: ""
            val guardSignature = data["guardSignatureBase64"] as? String ?: data["guardSignature"] as? String ?: ""
            val guardMI = data["guardMI"] as? String ?: ""
            val guardVerifiedAtMs = when (val raw = data["guardVerifiedAt"]) {
                is Number -> raw.toLong()
                is Map<*, *> -> (raw["\$timestamp"] as? Number)?.toLong() ?: 0L
                else -> 0L
            }
            val shipmentNumberRaw = data["shipmentNumber"] as? String ?: ""

            val lineItemsList = data["lineItems"] as? List<*> ?: emptyList<Any>()
            val lineItems = lineItemsList.filterIsInstance<Map<String, Any?>>()
            val firstItem = lineItems.firstOrNull()
            val delTsRaw = firstItem?.get("actualDelDate") as? String
            val deliveryTs = try {
                delTsRaw?.removePrefix("/Date(")?.removeSuffix(")/")?.toLong() ?: 0L
            } catch (e: Exception) { 0L }

            val obdCount = lineItems.size
            val obdNumber = firstItem?.get("obdNumber") as? String ?: ""

            Assignment(
                docId = (data["docId"] as? String) ?: queueId, // socket sends "docId", fallback to driverId
                queueId = queueId,
                driverId = sessionManager.getDriverId() ?: "",
                status = data["status"] as? String ?: "",
                tripStatus = tripStatus,
                plateNumber = data["truckPlate"] as? String ?: data["plateNumber"] as? String ?: "",
                truckType = data["truckType"] as? String ?: "",
                truckCompany = data["truckCompany"] as? String ?: "",
                helper = data["helper"] as? String ?: data["helperName"] as? String ?: "",
                guardVerified = guardVerified,
                driverConfirmed = driverConfirmed,
                guardFirstName = guardFirstName,
                guardLastName = guardLastName,
                guardSignature = guardSignature,
                guardMI = guardMI,
                guardVerifiedAtMs = guardVerifiedAtMs,
                deliveryTimestamp = deliveryTs,
                obdCount = obdCount,
                requirements = emptyMap(),
                lineItems = lineItems as List<Map<String, Any>>,
                obdNumber = obdNumber,
                shipmentNumberRaw = shipmentNumberRaw
            )
        } catch (e: Exception) {
            Log.e(TAG, "buildAssignmentFromMap error: ${e.message}")
            com.sysu.go.diagnostics.UserErrorNotifier.showFailure(this@MyTripActivity, "assignment-subscription", e)
            null
        }
    }

    private fun parseSapAssignmentsFromSocket(data: Any?): List<Assignment> {
        return when (data) {
            is org.json.JSONArray -> {
                val result = mutableListOf<Assignment>()
                for (i in 0 until data.length()) {
                    val obj = data.getJSONObject(i)
                    val map = mutableMapOf<String, Any?>()
                    obj.keys().forEach { key ->
                        val value = obj.get(key)
                        map[key] = if (value == org.json.JSONObject.NULL) null else value
                    }
                    buildAssignmentFromMap(map)?.let { result.add(it) }
                }
                result
            }
            is org.json.JSONObject -> {
                //  Single object (edge case — server sent one assignment)
                val map = mutableMapOf<String, Any?>()
                data.keys().forEach { key ->
                    val value = data.get(key)
                    map[key] = if (value == org.json.JSONObject.NULL) null else value
                }
                listOfNotNull(buildAssignmentFromMap(map))
            }
            else -> {
                Log.w(TAG, "sap_updated: unexpected data type ${data?.javaClass?.name}")
                emptyList()
            }
        }
    }

    //  Badge updates

    private fun updateAggregateBadge(list: List<Assignment>) {
        if (list.isEmpty()) {
            binding.aggregateBadgeContainer.visibility = View.GONE
            binding.badgeVerified.visibility = View.GONE
            return
        }
        binding.aggregateBadgeContainer.visibility = View.VISIBLE
        binding.badgeVerified.visibility = View.VISIBLE

        //  Count any in_transit shipment
        val inTransitCount = list.count { it.tripStatus == "in_transit" }

        if (inTransitCount > 0) {
            //  Active trip running
            binding.aggregateBadgeContainer.setBackgroundResource(R.drawable.bg_status_pill_green)
            binding.aggregateBadgeDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            binding.tvAggregateBadge.text = "$inTransitCount in transit"
            binding.tvAggregateBadge.setTextColor(ContextCompat.getColor(this, R.color.white))

            binding.badgeVerified.setBackgroundResource(R.drawable.bg_status_pill_green)
            binding.badgeDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            binding.tvBadgeText.text = getString(R.string.cta_status_transit)
        } else {
            //  Confirmed, ready to start (list already filtered to confirmed-only)
            binding.aggregateBadgeContainer.setBackgroundResource(R.drawable.bg_status_pill_green)
            binding.aggregateBadgeDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            binding.tvAggregateBadge.text = "${list.size} ready"
            binding.tvAggregateBadge.setTextColor(ContextCompat.getColor(this, R.color.white))

            binding.badgeVerified.setBackgroundResource(R.drawable.bg_status_pill_green)
            binding.badgeDot.setBackgroundResource(R.drawable.bg_status_dot_green)
            binding.tvBadgeText.text = getString(R.string.my_trip_badge_trips_ready)
        }
    }

    //  Bouncing Circles + Pulse Rings (AssignmentActivity pattern)

    private fun startCircleAnimation() {
        if (circlesInitialized) return
        circlesInitialized = true

        binding.circleContainer.post {
            val containerW = binding.circleContainer.width
            val containerH = binding.circleContainer.height
            if (containerW == 0 || containerH == 0) return@post

            val random = java.util.Random()
            val count = random.nextInt(4) + 3  // 3–6 circles

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
                    background = ContextCompat.getDrawable(this@MyTripActivity, R.drawable.bg_circle_light_red)
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

    private fun startPulseRings() {
        startPulseRing(binding.pulseRing1, 0L)
        startPulseRing(binding.pulseRing2, 1200L)
    }

    private fun startPulseRing(ring: View, delayMs: Long) {
        ring.visibility = View.VISIBLE
        ring.alpha = 0f

        val scaleUp = android.animation.ObjectAnimator.ofFloat(ring, "scaleX", 0.3f, 1.5f).apply {
            duration = 2000L
            repeatMode = android.animation.ObjectAnimator.RESTART
            repeatCount = android.animation.ValueAnimator.INFINITE
            startDelay = delayMs
        }
        val scaleUpY = android.animation.ObjectAnimator.ofFloat(ring, "scaleY", 0.3f, 1.5f).apply {
            duration = 2000L
            repeatMode = android.animation.ObjectAnimator.RESTART
            repeatCount = android.animation.ValueAnimator.INFINITE
            startDelay = delayMs
        }
        val fadeOut = android.animation.ObjectAnimator.ofFloat(ring, "alpha", 0.6f, 0f).apply {
            duration = 2000L
            repeatMode = android.animation.ObjectAnimator.RESTART
            repeatCount = android.animation.ValueAnimator.INFINITE
            startDelay = delayMs
        }

        circleAnimators.addAll(listOf(scaleUp, scaleUpY, fadeOut))
        scaleUp.start()
        scaleUpY.start()
        fadeOut.start()
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
            duration = Long.MAX_VALUE
            repeatCount = android.animation.ValueAnimator.INFINITE
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
                ImageStorageHelper.formatLocationLabel(lat, lng, this@MyTripActivity)
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

    //  Stub for compatibility — the original MyTripActivity had these UI helpers
    //  but the new design doesn't need them in this screen
    private val isActivityFinished: Boolean
        get() = isFinishing || isDestroyed
}


