> Historical implementation prompt. Current POD behavior and acceptance are documented in the Android guide, backend route, and release tracker.

# Sysu-Go AI Development Team — POD Capture Integration Task

## Objective

Implement and test the **Proof of Delivery (POD) Capture Flow** inside `GeneralTrackingActivity`.

For the first iteration, add a temporary test button to `activity_general_tracking.xml` so the POD flow can be triggered manually. Do **not** wire this into the production OBD list yet.

The intended flow is:

1. Tap **Test POD Capture (Simulate OBD Click)**.
2. Request location permission if needed.
3. Open `ObdStatusBottomSheet`.
4. Select a delivery status and confirm.
5. Request camera permission if needed.
6. Open the camera and capture the POD photo.
7. Process the image and stamp it with timestamp/location information.
8. Upload/process the POD image.
9. Update the matching OBD line item in Firestore.
10. Emit the socket update.
11. Show success/failure feedback.

---

# 1. Update `activity_general_tracking.xml`

Add the following temporary test button **directly below `tvSocketStatus`**:

```xml
<Button
    android:id="@+id/btnTestPodCapture"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:text="Test POD Capture (Simulate OBD Click)"
    android:layout_marginTop="16dp"
    android:backgroundTint="@color/sysu_red"
    android:textColor="@color/white" />
```

### Important

This button is **temporary and test-only**.

It should simulate selecting an OBD item from the future production list. Do not redesign or modify the existing list flow in this task.

---

# 2. Update `GeneralTrackingActivity.kt`

## A. Add the required imports

Add these imports at the top of the file as needed:

```kotlin
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.Timestamp
import com.sysu.go.utils.ImageStorageHelper
import java.io.File
import android.net.Uri
import androidx.core.content.FileProvider
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.Toast
import android.Manifest
```

Also ensure any existing project-required imports are present, including the Android permission/context classes used by the implementation, such as:

```kotlin
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
```

Do not duplicate imports that already exist.

---

## B. Add POD state variables

Add these variables inside `GeneralTrackingActivity`, alongside the existing class variables:

```kotlin
// Firestore instance
private val db = FirebaseFirestore.getInstance()

// POD Launchers
private lateinit var takePictureLauncher: androidx.activity.result.ActivityResultLauncher<Uri>
private lateinit var cameraPermissionLauncher: androidx.activity.result.ActivityResultLauncher<String>
private lateinit var locationPermissionLauncher: androidx.activity.result.ActivityResultLauncher<String>

// POD State Variables
private var pendingObdItem: Map<String, Any?>? = null
private var pendingObdShipmentDocId: String? = null
private var pendingCapturedAtMillis: Long = 0L
private var pendingPodData: PendingPodData? = null
private var pendingPhotoFile: File? = null
private var uploadProgressDialog: android.app.AlertDialog? = null

// Data Class for POD State
private data class PendingPodData(
    val status: String,
    val lineItem: Map<String, Any?>,
    val shipmentDocId: String,
    val capturedAtMillis: Long,
    val latitude: Double? = null,
    val longitude: Double? = null
)
```

---

# 3. Initialize POD Launchers and Test Button

At the end of `onCreate()`, before the function's closing brace, add:

```kotlin
registerPodLaunchers()

// Wire up the new button for testing
findViewById<Button>(R.id.btnTestPodCapture)?.setOnClickListener {
    // Mock data for testing - replace later with real data from the OBD list
    val mockItem = mapOf(
        "obdNumber" to "OBD-12345",
        "customerName" to "Test Customer"
    )

    val mockDocId = "TEST-DOC-ID-001"

    showObdStatusSheet(mockItem, mockDocId)
}
```

If `Button` is not already imported, add:

```kotlin
import android.widget.Button
```

### Important

The mock values are intentionally temporary:

- `obdNumber = "OBD-12345"`
- `customerName = "Test Customer"`
- `shipmentDocId = "TEST-DOC-ID-001"`

Do not treat these values as production data.

---

# 4. Add the Complete POD Logic Block

Add the following block at the end of `GeneralTrackingActivity`, immediately before the class closing brace `}`.

```kotlin
// ══════════════════════════════════════════════════════════════
// POD CAPTURE INTEGRATION BLOCK
// ══════════════════════════════════════════════════════════════

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
    shipmentDocId: String
) {
    val capturedAtMillis = System.currentTimeMillis()

    pendingObdItem = item
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
    val shipmentDocId = pendingObdShipmentDocId

    if (item == null || shipmentDocId == null) {
        proceedToCamera(null, null)
        return
    }

    // Try to get last known location first
    fusedLocationClient.lastLocation
        .addOnSuccessListener { location ->
            if (location != null) {
                proceedToCamera(
                    location.latitude,
                    location.longitude,
                    capturedAtMillis,
                    item,
                    shipmentDocId
                )
            } else {
                // Fallback if no cached location
                proceedToCamera(
                    null,
                    null,
                    capturedAtMillis,
                    item,
                    shipmentDocId
                )
            }
        }
        .addOnFailureListener {
            proceedToCamera(
                null,
                null,
                capturedAtMillis,
                item,
                shipmentDocId
            )
        }
}

private fun proceedToCamera(
    lat: Double?,
    lng: Double?,
    capturedAtMillis: Long = pendingCapturedAtMillis,
    item: Map<String, Any?>? = pendingObdItem,
    shipmentDocId: String? = pendingObdShipmentDocId
) {
    if (item == null || shipmentDocId == null) return

    showObdStatusSheetWithLocation(
        item,
        shipmentDocId,
        capturedAtMillis,
        lat,
        lng
    )
}

private fun showObdStatusSheetWithLocation(
    item: Map<String, Any?>,
    shipmentDocId: String,
    capturedAtMillis: Long,
    lat: Double?,
    lng: Double?
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
            longitude = lng
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
                    updateObdLineItemInFirestore(
                        shipmentDocId = podData.shipmentDocId,
                        lineItem = podData.lineItem,
                        status = podData.status,
                        podImageUrl = base64DataUri,
                        capturedAtMillis = podData.capturedAtMillis
                    )

                    hideUploadProgress()

                    SocketManager.emitPodUpdated(
                        podData.shipmentDocId
                    )

                    Toast.makeText(
                        this@GeneralTrackingActivity,
                        "POD Uploaded Successfully!",
                        Toast.LENGTH_SHORT
                    ).show()
                } catch (e: Exception) {
                    hideUploadProgress()

                    Toast.makeText(
                        this@GeneralTrackingActivity,
                        "Upload failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        },
        onFailure = { errorMsg ->
            hideUploadProgress()

            Toast.makeText(
                this,
                "Photo processing failed: $errorMsg",
                Toast.LENGTH_LONG
            ).show()
        }
    )
}

private fun encodePodImageWithTimestamp(
    photoFile: File,
    timestampMillis: Long,
    latitude: Double?,
    longitude: Double?,
    onSuccess: (String) -> Unit,
    onFailure: (String) -> Unit
) {
    val boundOptions = BitmapFactory.Options().apply {
        inJustDecodeBounds = true
    }

    BitmapFactory.decodeFile(
        photoFile.absolutePath,
        boundOptions
    )

    var inSampleSize = 1

    if (
        boundOptions.outHeight > 1280 ||
        boundOptions.outWidth > 1280
    ) {
        val halfHeight = boundOptions.outHeight / 2
        val halfWidth = boundOptions.outWidth / 2

        while (
            (halfHeight / inSampleSize) >= 1280 &&
            (halfWidth / inSampleSize) >= 1280
        ) {
            inSampleSize *= 2
        }
    }

    val decodeOptions = BitmapFactory.Options().apply {
        this.inSampleSize = inSampleSize
    }

    val bitmap = BitmapFactory.decodeFile(
        photoFile.absolutePath,
        decodeOptions
    )

    if (bitmap == null) {
        onFailure("Failed to load photo.")
        return
    }

    val locationLabel =
        latitude?.let { lat ->
            longitude?.let { lng ->
                ImageStorageHelper.formatLocationLabel(
                    lat,
                    lng,
                    this
                )
            }
        }

    ImageStorageHelper.uploadPodImage(
        bitmap = bitmap,
        timestampMillis = timestampMillis,
        context = this,
        onSuccess = onSuccess,
        onFailure = onFailure,
        locationLabel = locationLabel,
        latitude = latitude,
        longitude = longitude
    )
}

private suspend fun updateObdLineItemInFirestore(
    shipmentDocId: String,
    lineItem: Map<String, Any?>,
    status: String,
    podImageUrl: String,
    capturedAtMillis: Long
) {
    val obdNumber =
        lineItem["obdNumber"] as? String
            ?: throw IllegalArgumentException(
                "Missing obdNumber"
            )

    val docRef = db
        .collection("sap_assignments")
        .document(shipmentDocId)

    db.runTransaction { transaction ->
        val snap = transaction.get(docRef)

        if (!snap.exists()) {
            throw IllegalStateException(
                "Shipment document not found"
            )
        }

        val lineItemsRaw =
            snap.get("lineItems") as? List<*>
                ?: emptyList<Any>()

        val lineItems =
            lineItemsRaw
                .filterIsInstance<Map<String, Any?>>()
                .toMutableList()

        val targetIndex = lineItems.indexOfFirst {
            (it["obdNumber"] as? String) == obdNumber
        }

        if (targetIndex == -1) {
            throw IllegalStateException(
                "OBD item not found"
            )
        }

        val original =
            lineItems[targetIndex].toMutableMap()

        original["deliveryStatus"] = status
        original["podImageUrl"] = podImageUrl
        original["podCapturedAt"] =
            Timestamp(java.util.Date(capturedAtMillis))
        original["isPodCompleted"] = true
        original["unloadStatus"] = null

        lineItems[targetIndex] = original

        transaction.update(
            docRef,
            "lineItems",
            lineItems
        )
    }.await()
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
```

---

# 5. Required Existing Dependencies / Project Integration

The implementation assumes the project already contains the following existing components:

- `fusedLocationClient`
- `ObdStatusBottomSheet`
- `ObdStatusBottomSheet.TAG`
- `ObdStatusBottomSheet.newInstance(...)`
- `ObdStatusBottomSheet.onConfirmWithStatus`
- `SocketManager.emitPodUpdated(...)`
- `ImageStorageHelper`
- `ImageStorageHelper.formatLocationLabel(...)`
- `ImageStorageHelper.uploadPodImage(...)`

Do **not** create duplicate versions of these components if they already exist.

If any of these APIs differ in the current project, adapt the integration to the project's actual API rather than blindly duplicating classes or methods.

---

# 6. AndroidManifest / FileProvider Requirement

The camera flow uses:

```kotlin
FileProvider.getUriForFile(
    this,
    "${packageName}.fileprovider",
    photoFile
)
```

Therefore, verify that `AndroidManifest.xml` has a correctly configured `FileProvider` using the same authority:

```text
${packageName}.fileprovider
```

The provider must point to an appropriate `FileProvider` paths XML resource.

Also verify that the project declares the required permissions for the implemented flow, particularly:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

Do not add permissions that are unnecessary for the project.

---

# 7. Expected Runtime Flow

### Step 1 — Test button

User taps:

**Test POD Capture (Simulate OBD Click)**

The activity creates:

```kotlin
val mockItem = mapOf(
    "obdNumber" to "OBD-12345",
    "customerName" to "Test Customer"
)

val mockDocId = "TEST-DOC-ID-001"
```

Then:

```kotlin
showObdStatusSheet(mockItem, mockDocId)
```

### Step 2 — Location

If location permission has not been granted:

- Explain that location is needed for the POD photo stamp.
- Request `ACCESS_FINE_LOCATION`.

If permission is granted:

- Attempt to retrieve `fusedLocationClient.lastLocation`.
- Continue even if a cached location is unavailable.
- Location is therefore optional at the final camera stage.

### Step 3 — OBD status sheet

Open:

```kotlin
ObdStatusBottomSheet
```

The user selects the delivery status and confirms.

The selected status, line item, shipment document ID, capture timestamp, and location are stored in `PendingPodData`.

### Step 4 — Camera

If camera permission is already granted:

```kotlin
takePicture()
```

Otherwise request:

```kotlin
Manifest.permission.CAMERA
```

Then launch the Android camera contract.

### Step 5 — Photo processing

After successful capture:

- Read the captured image.
- Downsample images larger than approximately `1280px`.
- Generate a location label when coordinates are available.
- Pass the image through `ImageStorageHelper.uploadPodImage(...)`.

### Step 6 — Firestore update

After image processing succeeds, update:

```text
sap_assignments/{shipmentDocId}
```

The matching item is found by:

```text
lineItem.obdNumber
```

Update these fields:

```text
deliveryStatus = selected status
podImageUrl = processed image data
podCapturedAt = Firestore Timestamp
isPodCompleted = true
unloadStatus = null
```

Use the existing Firestore transaction logic so the line-item update is atomic.

### Step 7 — Socket update

After Firestore succeeds:

```kotlin
SocketManager.emitPodUpdated(
    podData.shipmentDocId
)
```

### Step 8 — User feedback

Success:

```text
POD Uploaded Successfully!
```

Failure:

```text
Upload failed: <error>
```

Photo-processing failure:

```text
Photo processing failed: <error>
```

---

# 8. Implementation Guardrails

The development team should follow these rules:

1. **Do not modify the existing production OBD list flow yet.**
2. The new XML button is only a temporary integration test trigger.
3. Reuse existing project components wherever possible.
4. Do not duplicate `ObdStatusBottomSheet`, `SocketManager`, `ImageStorageHelper`, or location infrastructure.
5. Do not hard-code production shipment IDs or OBD values beyond the explicit test mock.
6. Preserve existing `GeneralTrackingActivity` behavior.
7. Avoid lifecycle leaks from dialogs or callbacks.
8. Clean up pending POD state after failed camera capture or denied permissions.
9. Keep Firestore updates transactional.
10. Do not mark the POD complete unless the image-processing/upload step and Firestore update succeed.
11. Verify that `FileProvider` authority exactly matches:
   ```text
   ${packageName}.fileprovider
   ```
12. Resolve compile/import/API mismatches against the actual project code instead of introducing unnecessary replacement implementations.

---

# 9. Acceptance Criteria

The task is complete when all of the following are true:

- [ ] `activity_general_tracking.xml` compiles with the new test button.
- [ ] `GeneralTrackingActivity.kt` compiles.
- [ ] POD launchers are registered inside `onCreate()`.
- [ ] Test button triggers the POD flow.
- [ ] Location permission flow works.
- [ ] `ObdStatusBottomSheet` opens correctly.
- [ ] Status confirmation transitions to camera.
- [ ] Camera permission flow works.
- [ ] Camera opens and captures a photo.
- [ ] Captured photo is processed through `ImageStorageHelper`.
- [ ] Timestamp is passed correctly.
- [ ] Location metadata is passed when available.
- [ ] Firestore transaction locates the OBD item correctly.
- [ ] POD fields are updated correctly.
- [ ] Socket POD update is emitted only after the Firestore update succeeds.
- [ ] Success/failure Toasts appear correctly.
- [ ] Temporary test button does not interfere with the existing tracking/list functionality.
- [ ] `FileProvider` is configured correctly.
- [ ] No duplicate existing project components are introduced.

---

# 10. Important Testing Note

The mock shipment document ID is:

```text
TEST-DOC-ID-001
```

If this document does not exist in:

```text
sap_assignments
```

the final Firestore transaction is expected to fail with:

```text
Shipment document not found
```

That is acceptable during UI/camera-flow testing.

For a complete end-to-end Firestore test, use a valid test document containing a `lineItems` array with an item whose:

```text
obdNumber
```

matches:

```text
OBD-12345
```

Do not use a production shipment for initial testing.

---

# Deliverable

Implement the above changes in the existing Sysu-Go Android project.

The immediate goal is a **working test-only POD capture flow inside `GeneralTrackingActivity`**.

After this is verified end-to-end, the next phase will replace the mock button trigger with the real OBD list-item trigger.
