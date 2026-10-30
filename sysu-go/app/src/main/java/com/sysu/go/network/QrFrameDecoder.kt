package com.sysu.go.network

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.nio.ByteBuffer

/** Decodes CameraX Y-plane frames locally without a hosted barcode service. */
object QrFrameDecoder {
    private const val MAX_FRAME_PIXELS = 16_777_216L

    private val reader = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.TRY_HARDER to true,
            ),
        )
    }

    @Synchronized
    fun decode(
        plane: ByteBuffer,
        width: Int,
        height: Int,
        rowStride: Int,
        pixelStride: Int,
        rotationDegrees: Int,
    ): String? {
        if (width <= 0 || height <= 0 || width.toLong() * height > MAX_FRAME_PIXELS) return null
        if (rowStride <= 0 || pixelStride <= 0 || rotationDegrees !in setOf(0, 90, 180, 270)) return null

        val buffer = plane.duplicate()
        val base = buffer.position()
        val lastPixel = base.toLong() + (height - 1L) * rowStride + (width - 1L) * pixelStride
        if (lastPixel >= buffer.limit()) return null

        val luminance = ByteArray(width * height)
        for (y in 0 until height) {
            val sourceRow = base + y * rowStride
            val targetRow = y * width
            for (x in 0 until width) {
                luminance[targetRow + x] = buffer.get(sourceRow + x * pixelStride)
            }
        }

        val (pixels, decodedWidth, decodedHeight) = rotate(luminance, width, height, rotationDegrees)
        val source = PlanarYUVLuminanceSource(
            pixels,
            decodedWidth,
            decodedHeight,
            0,
            0,
            decodedWidth,
            decodedHeight,
            false,
        )
        return try {
            reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
        } catch (_: NotFoundException) {
            null
        } finally {
            reader.reset()
        }
    }

    private fun rotate(source: ByteArray, width: Int, height: Int, degrees: Int): Triple<ByteArray, Int, Int> {
        if (degrees == 0) return Triple(source, width, height)

        val rotatedWidth = if (degrees == 180) width else height
        val rotatedHeight = if (degrees == 180) height else width
        val rotated = ByteArray(source.size)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val (targetX, targetY) = when (degrees) {
                    90 -> height - 1 - y to x
                    180 -> width - 1 - x to height - 1 - y
                    else -> y to width - 1 - x
                }
                rotated[targetY * rotatedWidth + targetX] = source[y * width + x]
            }
        }
        return Triple(rotated, rotatedWidth, rotatedHeight)
    }
}
