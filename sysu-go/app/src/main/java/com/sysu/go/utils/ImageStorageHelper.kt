package com.sysu.go.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream

/**
 * Compresses POD photos and encodes them for upload through the API.
 *
 * Images are uploaded through the authenticated SQL API — the image bytes are compressed and encoded as a
 * data URI string: "data:image/jpeg;base64,{base64_string}"
 *
 * Two-pass compression:
 *   Primary:   1280px max, JPEG 50% → ~30–80KB base64
 *   Fallback:   960px max,  JPEG 30% → smaller still
 *
 * Resilient to OOM and encode failures via automatic fallback pass.
 */
object ImageStorageHelper {

    private const val TAG = "ImageStorageHelper"
    private const val JPEG_QUALITY_PRIMARY = 50 // 50% = ~30–80KB base64 — first attempt
    private const val JPEG_QUALITY_FALLBACK = 30  // 30% = smaller still — second attempt on failure
    private const val MAX_DIMENSION_PRIMARY = 1280   // 720p on long edge — first attempt
    private const val MAX_DIMENSION_FALLBACK = 960   // smaller — second attempt on failure
    //  Shared convenience constant for single-pass callers (e.g. bitmap overload)
    private const val MAX_DIMENSION = MAX_DIMENSION_PRIMARY
    private const val JPEG_QUALITY = JPEG_QUALITY_PRIMARY

    /**
     * Compresses a POD photo and returns it as a base64-encoded data URI.
     * Suitable for sending as a string field in the API request.
     *
     * Uses a two-pass approach for resilience:
     *   1. Primary: MAX_DIMENSION_PRIMARY (1280px) + JPEG_QUALITY_PRIMARY (50%)
     *   2. Fallback: MAX_DIMENSION_FALLBACK (960px) + JPEG_QUALITY_FALLBACK (30%)
     *
     * If the primary pass fails (OOM, encode failure), the fallback pass is tried
     * automatically before returning onFailure.
     *
     * @param photoFile   The raw photo file from the camera intent.
     * @param context     Android context.
     * @param onSuccess   Called on the main thread with the base64 data URI string:
     *                    "data:image/jpeg;base64,{base64}"
     * @param onFailure   Called on the main thread with the error message string.
     */
    fun uploadPodImage(
        photoFile: java.io.File,
        context: Context,
        onSuccess: (String) -> Unit,
        onFailure: (String) -> Unit
    ) {
        //  Step 1: Decode + resize at primary resolution
        val primaryBitmap = decodeAndResize(photoFile, MAX_DIMENSION_PRIMARY)
        if (primaryBitmap == null) {
            onFailure("Photo too large to load. Please try a smaller photo.")
            return
        }

        //  Step 2: Compress + encode
        var encoded: String? = compressToBase64DataUri(primaryBitmap, JPEG_QUALITY_PRIMARY)
        primaryBitmap.recycle()

        if (encoded == null) {
            Log.w(TAG, "Primary encode failed — attempting fallback compression (960px / 30%)")
            //  Fallback pass: smaller image, lower quality
            val fallbackBitmap = decodeAndResize(photoFile, MAX_DIMENSION_FALLBACK)
            if (fallbackBitmap != null) {
                encoded = compressToBase64DataUri(fallbackBitmap, JPEG_QUALITY_FALLBACK)
                fallbackBitmap.recycle()
            }
        }

        if (encoded != null) {
            Log.d(TAG, "POD image encoded: ${encoded.length} chars (~${encoded.substringAfter("base64,").length / 1024}KB raw)")
            onSuccess(encoded)
        } else {
            onFailure("Failed to process photo. Please try again.")
        }
    }

    /**
     * Decodes a photo file to Bitmap, resized so the longer edge ≤ maxDimension.
     * Returns null on OOM or decode failure.
     * Must be called on a background thread for large files.
     */
    private fun decodeAndResize(photoFile: java.io.File, maxDimension: Int): Bitmap? {
        return try {
            //  Calculate inSampleSize to avoid OOM during decode
            val boundOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(photoFile.absolutePath, boundOptions)

            val sampleSize = calculateInSampleSize(boundOptions, maxDimension, maxDimension)
            val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }

            val bitmap = BitmapFactory.decodeFile(photoFile.absolutePath, decodeOptions)
                ?: return null

            //  Resize to exact max dimension (maintaining aspect ratio)
            val resized = resizeBitmap(bitmap, maxDimension)
            if (resized !== bitmap) bitmap.recycle()
            resized
        } catch (e: OutOfMemoryError) {
            Log.e(TAG, "OOM decoding photo (maxDimension=$maxDimension): ${photoFile.name}", e)
            null
        } catch (e: Exception) {
            Log.e(TAG, "decodeAndResize failed: ${e.message}", e)
            null
        }
    }

    /**
     * Compresses bitmap to JPEG at given quality and returns as base64 data URI.
     * Returns null on compress/encode failure.
     */
    private fun compressToBase64DataUri(bitmap: Bitmap, quality: Int): String? {
        return try {
            val byteArray = ByteArrayOutputStream().use { baos ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, baos)
                baos.toByteArray()
            }
            val base64String = Base64.encodeToString(byteArray, Base64.NO_WRAP)
            "data:image/jpeg;base64,$base64String"
        } catch (e: Exception) {
            Log.e(TAG, "JPEG compress/encode failed (quality=$quality)", e)
            null
        }
    }

    /**
     * Overload: accepts a Bitmap directly (e.g., from SignaturePadView-style canvas).
     */
    fun uploadPodImage(
        bitmap: Bitmap,
        context: Context,
        onSuccess: (String) -> Unit,
        onFailure: (String) -> Unit
    ) {
        val resized = resizeBitmap(bitmap, MAX_DIMENSION)
        val byteArray = compressToJpeg(resized, JPEG_QUALITY)
        resized.recycle()

        if (byteArray == null) {
            onFailure("Failed to compress photo.")
            return
        }

        val base64String = Base64.encodeToString(byteArray, Base64.NO_WRAP)
        val dataUri = "data:image/jpeg;base64,$base64String"

        Log.d(TAG, "POD image base64 encoded: ${dataUri.length} chars, ~${byteArray.size / 1024}KB")
        onSuccess(dataUri)
    }

    /**
     * Compresses a POD photo with a visible timestamp overlay (and optional
     * location label + GPS coordinates) and returns it as a base64-encoded
     * data URI suitable for sending in the API request.
     *
     * Flow:
     *   1. Draw bottom bar watermark: GPS coords → address (wrappable) → ISO timestamp
     *   2. Resize to ≤1280px max dimension
     *   3. Compress to JPEG 50%
     *   4. Base64-encode to data URI
     *
     * @param bitmap         The raw photo bitmap to process.
     * @param timestampMillis Epoch millis for the ISO timestamp shown in the bar.
     * @param context        Android context.
     * @param onSuccess      Called on main thread with the base64 data URI string.
     * @param onFailure      Called on main thread with the error message string.
     * @param locationLabel   Optional locality string, e.g. "Dasmarinas, Cavite".
     *                        If null, address line is hidden.
     * @param latitude        Optional raw latitude for (LAT:, LNG:) line.
     * @param longitude        Optional raw longitude for (LAT:, LNG:) line.
     */
    fun uploadPodImage(
        bitmap: Bitmap,
        timestampMillis: Long,
        context: Context,
        onSuccess: (String) -> Unit,
        onFailure: (String) -> Unit,
        locationLabel: String? = null,
        latitude: Double? = null,
        longitude: Double? = null
    ) {
        val stampedBitmap = try {
            drawTimestampOverlay(bitmap, timestampMillis, locationLabel, latitude, longitude)
        } catch (e: Exception) {
            Log.w(TAG, "drawTimestampOverlay failed — encoding without watermark: ${e.message}")
            bitmap.copy(Bitmap.Config.ARGB_8888, false)
        }

        val resized = resizeBitmap(stampedBitmap, MAX_DIMENSION)
        if (resized !== stampedBitmap) stampedBitmap.recycle()

        val byteArray = compressToJpeg(resized, JPEG_QUALITY)
        resized.recycle()

        if (byteArray == null) {
            onFailure("Failed to compress photo.")
            return
        }

        val base64String = Base64.encodeToString(byteArray, Base64.NO_WRAP)
        val dataUri = "data:image/jpeg;base64,$base64String"

        Log.d(TAG, "POD timestamped image encoded: ${dataUri.length} chars, ~${byteArray.size / 1024}KB")
        onSuccess(dataUri)
    }

    //  Private helpers

    private fun calculateInSampleSize(
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
     * Resize bitmap so the longer edge == maxDimension, preserving aspect ratio.
     */
    private fun resizeBitmap(bitmap: Bitmap, maxDimension: Int): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        if (width <= maxDimension && height <= maxDimension) {
            return bitmap.copy(bitmap.config ?: Bitmap.Config.ARGB_8888, false)
        }

        val ratio = width.toFloat() / height.toFloat()
        val (newWidth, newHeight) = if (width > height) {
            maxDimension to (maxDimension / ratio).toInt()
        } else {
            (maxDimension * ratio).toInt() to maxDimension
        }

        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
    }

    private fun compressToJpeg(bitmap: Bitmap, quality: Int): ByteArray? {
        return try {
            ByteArrayOutputStream().use { baos ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, baos)
                baos.toByteArray()
            }
        } catch (e: Exception) {
            Log.e(TAG, "JPEG compression failed", e)
            null
        }
    }

    /**
     * Decodes a base64 data URI (e.g. "data:image/jpeg;base64,/9j/4AAQ...")
     * into a Bitmap. Returns null on failure.
     *
     * Call on a background thread if the string is very large (list scrolling).
     */
    fun decodeBase64ToBitmap(dataUri: String): Bitmap? {
        return try {
            val base64Index = dataUri.indexOf("base64,")
            if (base64Index == -1) {
                Log.w(TAG, "decodeBase64ToBitmap: no base64 prefix found in data URI")
                return null
            }
            val base64String = dataUri.substring(base64Index + "base64,".length)
            val decodedBytes = Base64.decode(base64String, Base64.NO_WRAP)
            BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
        } catch (e: Exception) {
            Log.e(TAG, "decodeBase64ToBitmap failed", e)
            null
        }
    }

    /**
     * Kept for backwards compatibility — no longer used internally.
     * The API accepts the encoded payload directly, so no client storage path is needed.
     */
    fun buildStoragePath(shipmentDocId: String, obdNumber: String, timestamp: Long): String {
        val safeObd = obdNumber.replace("/", "_").replace(".", "_").replace(" ", "_")
        return "shipment_pods/${shipmentDocId}/${safeObd}_${timestamp}.jpg"
    }

    /**
     * Draws a full-width black bottom bar containing:
     *   Line 1: (LAT: X.6f, LNG: Y.6f) — 18sp bold, white
     *   Line 2: Wrapped address — 15sp regular, white  (e.g. "Dasmarinas, Cavite")
     *   Line 3: yyyy-MM-dd HH:mm:ss — 14sp regular, muted alpha  (ISO 24h)
     *
     * Bar geometry (all anchored from bar TOP, stacking downward):
     *   - Full canvas width, from barTop to canvas bottom
     *   - innerPaddingV = 14dp top/bottom padding
     *   - lineGap = 10dp between lines
     *   - marginBottom = 28dp from canvas bottom
     *   - marginLeft = 24dp from left edge
     *
     * Zero-dependency on any Activity context — pure bitmap math.
     *
     * @param bitmap          The source photo bitmap (NOT modified).
     * @param timestampMillis Epoch millis for the timestamp string.
     * @param locationLabel   Optional locality string, e.g. "📍 Dasmarinas, Cavite".
     *                        The pin emoji is stripped. If null, address line is hidden.
     * @param latitude        Optional raw latitude for (LAT:, LNG:) display.
     * @param longitude       Optional raw longitude for (LAT:, LNG:) display.
     * @return A NEW bitmap with the bottom bar drawn on top. Caller must recycle
     *         the returned bitmap and the original bitmap is NEVER modified.
     */
    private fun drawTimestampOverlay(
        bitmap: Bitmap,
        timestampMillis: Long,
        locationLabel: String? = null,
        latitude: Double? = null,
        longitude: Double? = null
    ): Bitmap {
        val result = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(result)
        val canvasWidth = result.width.toFloat()
        val canvasHeight = result.height.toFloat()

        //  Design tokens
        val dp = android.content.res.Resources.getSystem().displayMetrics.scaledDensity
        val marginLeft = 24f * dp      // 24dp left inset
        val marginBottom = 28f * dp    // 28dp from canvas bottom edge
        val lineGap = 16f * dp         // 16dp gap between consecutive lines
        val innerPaddingV = 20f * dp   // 20dp vertical padding inside bar

        //  Typography
        val gpsPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {       // Line 1: 32sp bold
            color = android.graphics.Color.WHITE
            textSize = 32f * dp
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        val addressPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {   // Line 2: 26sp bold
            color = android.graphics.Color.WHITE
            textSize = 26f * dp
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        val tsPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {        // Line 3: 24sp regular, muted
            color = android.graphics.Color.WHITE
            textSize = 24f * dp
            typeface = android.graphics.Typeface.DEFAULT
            alpha = 200
        }
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xE6000000.toInt()  // 90% black
        }

        //  Line content
        val gpsLine = if (latitude != null && longitude != null) {
            String.format(java.util.Locale.US, "(LAT: %.6f, LNG: %.6f)", latitude, longitude)
        } else null

        val addressLine = locationLabel?.removePrefix("📍 ")?.trim()

        //  ISO 24-hour: YYYY-MM-DD HH:MM:SS
        val isoTimestamp = java.text.SimpleDateFormat(
            "yyyy-MM-dd HH:mm:ss", java.util.Locale.US
        ).format(java.util.Date(timestampMillis))

        //  Measure font heights (ascent is negative; use absolute value)
        val gpsAscent = -gpsPaint.ascent()      // distance baseline→top-of-text
        val addrAscent = -addressPaint.ascent()
        val tsAscent = -tsPaint.ascent()
        val gpsH = gpsAscent + gpsPaint.descent()
        val addrH = addrAscent + addressPaint.descent()
        val tsH = tsAscent + tsPaint.descent()

        //  Word-wrap address into available width
        val availableWidth = canvasWidth - marginLeft * 2
        val addressLines = mutableListOf<String>()
        if (addressLine != null) {
            val words = addressLine.split(" ")
            var current = StringBuilder()
            for (word in words) {
                val test = if (current.isEmpty()) word else "$current $word"
                if (addressPaint.measureText(test) <= availableWidth) {
                    current = StringBuilder(test)
                } else {
                    if (current.isNotEmpty()) addressLines.add(current.toString())
                    current = StringBuilder(word)
                }
            }
            if (current.isNotEmpty()) addressLines.add(current.toString())
        }
        val addrLineCount = if (addressLines.isEmpty() && addressLine != null) 1 else addressLines.size

        //  Calculate bar geometry
        //  barBottom = canvasHeight (bar flush at very bottom of image)
        //  barTop = canvasHeight - barHeight (top edge is higher = NOT at bottom of image)
        val totalBarHeight = innerPaddingV * 2 + gpsH + lineGap + (addrH * addrLineCount) + lineGap + tsH
        val barTop = canvasHeight - totalBarHeight
        val barBottom = canvasHeight

        //  Draw full-width black bar at bottom of canvas
        canvas.drawRect(0f, barTop, canvasWidth, barBottom, bgPaint)

        //  Build baselines from barTop + innerPaddingV going DOWNWARDS
        var y = barTop + innerPaddingV

        //  Line 1: GPS (top of content area)
        if (gpsLine != null) {
            canvas.drawText(gpsLine, marginLeft, y + gpsAscent, gpsPaint)
            y += gpsH + lineGap
        }

        //  Line 2: Address (wrappable, stacked below GPS)
        if (addrLineCount > 0) {
            for (i in 0 until addrLineCount) {
                val lineText = if (addressLines.isEmpty()) addressLine ?: "" else addressLines[i]
                canvas.drawText(lineText, marginLeft, y + addrAscent, addressPaint)
                y += addrH
                if (i < addrLineCount - 1) y += lineGap
            }
        }

        //  Line 3: Timestamp — anchored at BOTTOM of bar (canvasHeight - marginBottom)
        val tsBaseline = barBottom - marginBottom
        canvas.drawText(isoTimestamp, marginLeft, tsBaseline, tsPaint)

        return result
    }

    /**
     * Converts decimal GPS coordinates to a human-readable locality + region string
     * using Android's Geocoder (uses network/local database — no internet needed
     * for local geocoding, just needs Location permission).
     *
     * Falls back to decimal-degree string "12.3456, 98.7654" if Geocoder fails.
     *
     * @return A string like "📍 Dasmarinas, Cavite" or "📍 14.5995, 120.9842"
     */
    fun formatLocationLabel(latitude: Double, longitude: Double, context: Context): String {
        return try {
            val geocoder = android.location.Geocoder(context, java.util.Locale.getDefault())
            val addresses = geocoder.getFromLocation(latitude, longitude, 1)
            if (!addresses.isNullOrEmpty()) {
                val addr = addresses[0]
                val locality = addr.locality ?: addr.subAdminArea ?: addr.adminArea ?: ""
                val region = addr.adminArea ?: ""
                val label = if (locality.isNotBlank() && region.isNotBlank()) {
                    "$locality, $region"
                } else if (locality.isNotBlank()) {
                    locality
                } else if (region.isNotBlank()) {
                    region
                } else {
                    String.format(java.util.Locale.US, "%.4f, %.4f", latitude, longitude)
                }
                "📍 $label"
            } else {
                "📍 ${String.format(java.util.Locale.US, "%.4f, %.4f", latitude, longitude)}"
            }
        } catch (e: Exception) {
            "📍 ${String.format(java.util.Locale.US, "%.4f, %.4f", latitude, longitude)}"
        }
    }
}
