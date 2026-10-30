# POD Timestamp Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a visible timestamp watermark (bottom-left corner) into POD photos before base64-encoding and saving to Firestore — zero breaking changes to existing code.

**Architecture:** Add a new `uploadPodImage(Bitmap, timestampMillis, ...)` overload in `ImageStorageHelper.kt` that draws the watermark onto the bitmap using `Canvas` before compressing. `MyTripActivity` decodes the photo file to a `Bitmap` and calls this new overload with the already-captured `capturedAtMillis`. Existing overloads remain untouched.

**Tech Stack:** Android SDK (Canvas, Bitmap, Paint), Kotlin, Firebase Firestore, Base64

---

## Global Constraints

- Timestamp format: `Jun 23, 2026 • 2:30:45 PM`
- Watermark position: bottom-left, 16px margin, white text on `#CC000000` (80% black) background strip
- Text size: 13sp, white (`#FFFFFF`)
- Max image dimension: 1280px (same as current)
- JPEG quality: 50% (same as current)
- No changes to Firestore document schema (same fields, same types)
- Existing `uploadPodImage(File, ...)` and `uploadPodImage(Bitmap, ...)` overloads — untouched

---

## Files Modified

| File | Responsibilities |
|------|-----------------|
| `app/src/main/java/com/sysu/go/utils/ImageStorageHelper.kt` | New timestamp-overloaded `uploadPodImage` function |
| `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt` | New helper `encodePodImageWithTimestamp()`; updated `handleCameraResult()` to use it; `updateObdLineItemInFirestore()` uses `capturedAtMillis` |

---

## Task Breakdown

---

### Task 1: Add `drawTimestampOverlay()` helper to `ImageStorageHelper.kt`

**File:**
- Modify: `app/src/main/java/com/sysu/go/utils/ImageStorageHelper.kt`

**Interface:**
- Produces: `private fun drawTimestampOverlay(bitmap: Bitmap, timestampMillis: Long): Bitmap` — returns a new bitmap with the watermark drawn on top. Caller is responsible for recycling the returned bitmap.

- [ ] **Step 1: Read the file to confirm current content**

Confirm `ImageStorageHelper.kt` ends after `buildStoragePath()` with the closing `}` of the `object`.

- [ ] **Step 2: Add the `drawTimestampOverlay` function**

Add this function at the end of the `ImageStorageHelper` object, before the closing `}`:

```kotlin
/**
 * Draws a timestamp watermark in the bottom-left corner of the given bitmap.
 * Returns a NEW bitmap (caller must recycle it) with the watermark drawn on top.
 * The original bitmap is NOT modified.
 *
 * Watermark style:
 *   - Background strip: #CC000000, 4dp corner radius, 12dp horizontal / 8dp vertical padding
 *   - Text: 13sp, white (#FFFFFF), system sans-serif
 *   - Format: "Jun 23, 2026 • 2:30:45 PM"
 *   - Position: 16px margin from bottom and left edges
 */
private fun drawTimestampOverlay(bitmap: Bitmap, timestampMillis: Long): Bitmap {
    val result = bitmap.copy(Bitmap.Config.ARGB_8888, true)
    val canvas = Canvas(result)

    // Format timestamp
    val dateFormat = java.text.SimpleDateFormat("MMM dd, yyyy • h:mm:ss a", java.util.Locale.US)
    val dateStr = dateFormat.format(java.util.Date(timestampMillis))

    // Text paint
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        textSize = 13f * android.content.res.Resources.getSystem().displayMetrics.scaledDensity
        typeface = android.graphics.Typeface.DEFAULT
    }

    // Measure text to size the background strip
    val textWidth = textPaint.measureText(dateStr)
    val textHeight = textPaint.descent() - textPaint.ascent()
    val textBottomY = result.height - 16f

    // Background strip rect: left = 0, right = text + horizontal padding
    val stripLeft = 0f
    val stripRight = textWidth + 24f  // 12dp horizontal padding each side
    val stripTop = textBottomY - textHeight - 16f  // 8dp vertical padding
    val stripBottom = textBottomY + 8f

    val stripRect = android.graphics.RectF(
        stripLeft, stripTop, stripRight, stripBottom
    )

    // Draw background strip
    val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xCC000000.toInt()  // #CC000000 — 80% black
    }
    canvas.drawRoundRect(stripRect, 8f, 8f, bgPaint)

    // Draw text on top of background
    val textX = stripLeft + 12f  // 12dp left padding inside strip
    val textY = stripBottom - 8f - textPaint.descent()  // align baseline
    canvas.drawText(dateStr, textX, textY, textPaint)

    return result
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/utils/ImageStorageHelper.kt
git commit -m "feat(ImageStorageHelper): add drawTimestampOverlay helper
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Add `uploadPodImage(bitmap, timestamp, context, onSuccess, onFailure)` overload

**File:**
- Modify: `app/src/main/java/com/sysu/go/utils/ImageStorageHelper.kt`

**Interface:**
- Produces: `fun uploadPodImage(bitmap: Bitmap, timestampMillis: Long, context: Context, onSuccess: (String) -> Unit, onFailure: (String) -> Unit)` — new public overload that draws the timestamp overlay before encoding
- Consumes: `drawTimestampOverlay()` from Task 1, existing `resizeBitmap()`, `compressToJpeg()`, and internal helper chain

- [ ] **Step 1: Add the new overload**

Add this function in `ImageStorageHelper.kt`, after the existing `uploadPodImage(bitmap: Bitmap, ...)` overload (around line 156, before the private helpers section):

```kotlin
/**
 * Compresses a POD photo with a visible timestamp overlay and returns it as a
 * base64-encoded data URI. Suitable for storing directly in Firestore.
 *
 * Flow:
 *   1. Draw timestamp watermark (bottom-left, white-on-black strip)
 *   2. Resize to ≤1280px max dimension
 *   3. Compress to JPEG 50%
 *   4. Base64-encode to data URI
 *
 * @param bitmap         The raw photo bitmap to process.
 * @param timestampMillis Epoch millis for the timestamp shown in the watermark.
 * @param context        Android context (for display metrics).
 * @param onSuccess      Called on main thread with the base64 data URI string.
 * @param onFailure      Called on main thread with the error message string.
 */
fun uploadPodImage(
    bitmap: Bitmap,
    timestampMillis: Long,
    context: Context,
    onSuccess: (String) -> Unit,
    onFailure: (String) -> Unit
) {
    // Step 1: Draw timestamp overlay (bottom-left corner, white on 80% black strip)
    val stampedBitmap = try {
        drawTimestampOverlay(bitmap, timestampMillis)
    } catch (e: Exception) {
        Log.w(TAG, "drawTimestampOverlay failed — encoding without watermark: ${e.message}")
        // Fallback: use original bitmap if overlay drawing fails
        bitmap.copy(Bitmap.Config.ARGB_8888, false)
    }

    // Step 2: Resize (same logic as existing single-bitmap overload)
    val resized = resizeBitmap(stampedBitmap, MAX_DIMENSION)
    if (resized !== stampedBitmap) stampedBitmap.recycle()

    // Step 3: Compress to JPEG
    val byteArray = compressToJpeg(resized, JPEG_QUALITY)
    resized.recycle()

    if (byteArray == null) {
        onFailure("Failed to compress photo.")
        return
    }

    // Step 4: Base64-encode
    val base64String = Base64.encodeToString(byteArray, Base64.NO_WRAP)
    val dataUri = "data:image/jpeg;base64,$base64String"

    Log.d(TAG, "POD timestamped image encoded: ${dataUri.length} chars, ~${byteArray.size / 1024}KB")
    onSuccess(dataUri)
}
```

**Placement note:** Add the overload after the existing `uploadPodImage(bitmap, ...)` overload (which ends around line 156 with `Log.d(TAG, ...` followed by `onSuccess(dataUri)` and a closing `}`). Insert it after that, before the `// ─── Private helpers ───` comment.

- [ ] **Step 2: Commit**

```bash
git add app/src/main/java/com/sysu/go/utils/ImageStorageHelper.kt
git commit -m "feat(ImageStorageHelper): add timestamped uploadPodImage overload
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Add `encodePodImageWithTimestamp()` helper in `MyTripActivity.kt`

**File:**
- Modify: `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt`

**Interface:**
- Produces: `private fun encodePodImageWithTimestamp(photoFile: File, timestampMillis: Long, onSuccess: (String) -> Unit, onFailure: (String) -> Unit)` — decodes the photo file to a Bitmap, then calls the new `ImageStorageHelper.uploadPodImage(bitmap, timestamp, ...)` overload
- Consumes: `ImageStorageHelper.uploadPodImage(bitmap, timestamp, ...)`

- [ ] **Step 1: Add the helper function**

Add this as a new private method in `MyTripActivity`, inside the class body (suggest placing it near `deletePhotoFile()` at line 516):

```kotlin
/**
 * Decodes a photo file to a Bitmap and passes it to ImageStorageHelper's
 * timestamped upload method, which draws a watermark before encoding.
 *
 * This is the bridge between the raw photo file and the new timestamped
 * encoding path. It replaces the direct uploadPodImage(photoFile, ...) call
 * in handleCameraResult().
 *
 * @param photoFile       The JPEG file from the camera intent.
 * @param timestampMillis The capturedAtMillis used for the watermark text.
 * @param onSuccess       Forwarded to ImageStorageHelper — receives base64 data URI.
 * @param onFailure        Forwarded to ImageStorageHelper — receives error message.
 */
private fun encodePodImageWithTimestamp(
    photoFile: File,
    timestampMillis: Long,
    onSuccess: (String) -> Unit,
    onFailure: (String) -> Unit
) {
    // Decode the photo file to a Bitmap, resized to 1280px max dimension
    // (same decodeAndResize logic used internally by uploadPodImage for File)
    val boundOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(photoFile.absolutePath, boundOptions)

    val sampleSize = calculateInSampleSizeForFile(boundOptions, MAX_DIMENSION_PRIMARY, MAX_DIMENSION_PRIMARY)
    val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
    val bitmap = BitmapFactory.decodeFile(photoFile.absolutePath, decodeOptions)

    if (bitmap == null) {
        onFailure("Photo too large to load. Please try a smaller photo.")
        return
    }

    // Use the new timestamped overload — draws watermark before encoding
    ImageStorageHelper.uploadPodImage(
        bitmap = bitmap,
        timestampMillis = timestampMillis,
        context = this,
        onSuccess = { dataUri ->
            bitmap.recycle()
            onSuccess(dataUri)
        },
        onFailure = { errorMsg ->
            bitmap.recycle()
            onFailure(errorMsg)
        }
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
```

**Note on constants:** `MAX_DIMENSION_PRIMARY = 1280` needs to be accessible. Since `ImageStorageHelper` is an `object` with those as `private const`, two options:
- (Preferred, no breaking change) Inline the decode logic inside `encodePodImageWithTimestamp` using `BitmapFactory` directly with a fixed sample-size calculation
- Or: make those constants `internal` in `ImageStorageHelper` — but this is a bigger change

The code above uses option 1 (inline decode) which is fully self-contained.

- [ ] **Step 2: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/MyTripActivity.kt
git commit -m "feat(MyTripActivity): add encodePodImageWithTimestamp helper
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Update `handleCameraResult()` to call the new helper**

**File:**
- Modify: `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt` — in `handleCameraResult()` function

**Interface:**
- Consumes: `encodePodImageWithTimestamp()` from Task 3
- Produces: Same success/failure paths as before, now using timestamped encoding

- [ ] **Step 1: Find and replace the `ImageStorageHelper.uploadPodImage(photoFile, ...)` call**

In `handleCameraResult()` around line 383, find:

```kotlin
        ImageStorageHelper.uploadPodImage(
            photoFile = photoFile,
            context = this,
            onSuccess = { base64DataUri ->
```

Replace with:

```kotlin
        encodePodImageWithTimestamp(
            photoFile = photoFile,
            timestampMillis = podData.capturedAtMillis,
            onSuccess = { base64DataUri ->
```

Also change the trailing `context = this` to remove it since the new helper doesn't take a context parameter.

The full replacement block should read:

```kotlin
        encodePodImageWithTimestamp(
            photoFile = photoFile,
            timestampMillis = podData.capturedAtMillis,
            onSuccess = { base64DataUri ->
                Log.d(TAG, "POD image encoded SUCCESS: ${base64DataUri.length} chars. Proceeding to Firestore update...")
                Log.d(TAG, "  → shipmentDocId=${podData.shipmentDocId}, obdNumber=${podData.lineItem["obdNumber"]}, status=${podData.status}")
```

- [ ] **Step 2: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/MyTripActivity.kt
git commit -m "feat(MyTripActivity): use timestamped encoding for POD photos
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Update `updateObdLineItemInFirestore` to use `capturedAtMillis`

**File:**
- Modify: `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt`

**Interface:**
- Consumes: `capturedAtMillis: Long` parameter (already in the function signature but unused)
- Produces: `podCapturedAt` in Firestore now uses the actual camera-capture timestamp instead of `Timestamp.now()` (server write time)

**What to change:**

In `updateObdLineItemInFirestore()` (line 608), find:

```kotlin
            original["podCapturedAt"] = Timestamp.now()
```

Replace with:

```kotlin
            original["podCapturedAt"] = Timestamp(java.util.Date(capturedAtMillis))
```

This ensures the Firestore `podCapturedAt` field reflects the **actual moment of delivery** (when the status was selected, before camera opened) rather than when the Firestore write happened (potentially seconds later).

- [ ] **Step 2: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/MyTripActivity.kt
git commit -m "fix(MyTripActivity): use capturedAtMillis for podCapturedAt in Firestore
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Build succeeds: `./gradlew assembleDebug` — no compile errors
- [ ] POD photo captured → open full-screen preview → watermark is visible bottom-left with correct timestamp
- [ ] Timestamp format is `Jun 23, 2026 • 2:30:45 PM` (verify AM/PM is correct)
- [ ] Bottom sheet shows completed OBD items without regression
- [ ] No new crash on camera cancel (handleCameraResult still handles `success == false`)
- [ ] Image size still within 30–80KB range (same compression settings)

---

## Task Order

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 (each builds on the previous, but Tasks 1 and 2 can run in parallel if Task 2's implementation references Task 1's newly added helper).

Actual execution order: **1 → 2 → 3 → 4 → 5** in sequence.