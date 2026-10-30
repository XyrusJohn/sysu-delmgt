package com.sysu.go.network

import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.ByteBuffer

class QrFrameDecoderTest {
    @Test
    fun `decodes QR from a padded Y plane with a nonzero buffer position`() {
        val text = "SYS-0123456789AB"
        val qr = qrPixels(text, 256, 220)
        val frame = cameraFrame(qr.pixels, qr.width, qr.height, rotationDegrees = 0, pixelStride = 2)

        assertEquals(
            text,
            QrFrameDecoder.decode(
                frame.buffer,
                frame.width,
                frame.height,
                frame.rowStride,
                frame.pixelStride,
                frame.rotationDegrees,
            ),
        )
    }

    @Test
    fun `decodes frames for every CameraX rotation`() {
        val text = "SYS-ROTATION-TEST"
        val qr = qrPixels(text, 256, 220)

        for (rotation in listOf(0, 90, 180, 270)) {
            val frame = cameraFrame(qr.pixels, qr.width, qr.height, rotation, pixelStride = 1)
            assertEquals(
                "rotation=$rotation",
                text,
                QrFrameDecoder.decode(
                    frame.buffer,
                    frame.width,
                    frame.height,
                    frame.rowStride,
                    frame.pixelStride,
                    frame.rotationDegrees,
                ),
            )
        }
    }

    @Test
    fun `returns null for an image plane too short for its declared strides`() {
        assertNull(
            QrFrameDecoder.decode(
                ByteBuffer.allocate(8),
                width = 16,
                height = 16,
                rowStride = 16,
                pixelStride = 1,
                rotationDegrees = 0,
            ),
        )
    }

    private data class QrPixels(val pixels: ByteArray, val width: Int, val height: Int)

    private data class CameraFrame(
        val buffer: ByteBuffer,
        val width: Int,
        val height: Int,
        val rowStride: Int,
        val pixelStride: Int,
        val rotationDegrees: Int,
    )

    private fun qrPixels(text: String, width: Int, height: Int): QrPixels {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, width, height)
        val pixels = ByteArray(width * height)
        for (y in 0 until height) {
            for (x in 0 until width) pixels[y * width + x] = if (matrix.get(x, y)) 0 else 0xff.toByte()
        }
        return QrPixels(pixels, width, height)
    }

    private fun cameraFrame(
        uprightPixels: ByteArray,
        uprightWidth: Int,
        uprightHeight: Int,
        rotationDegrees: Int,
        pixelStride: Int,
    ): CameraFrame {
        val inverseRotation = (360 - rotationDegrees) % 360
        val (pixels, width, height) = rotate(uprightPixels, uprightWidth, uprightHeight, inverseRotation)
        val rowStride = width * pixelStride + 9
        val offset = 5
        val buffer = ByteBuffer.allocate(offset + rowStride * height)
        for (y in 0 until height) {
            for (x in 0 until width) buffer.put(offset + y * rowStride + x * pixelStride, pixels[y * width + x])
        }
        buffer.position(offset)
        return CameraFrame(buffer, width, height, rowStride, pixelStride, rotationDegrees)
    }

    private fun rotate(source: ByteArray, width: Int, height: Int, degrees: Int): Triple<ByteArray, Int, Int> {
        if (degrees == 0) return Triple(source, width, height)
        val targetWidth = if (degrees == 180) width else height
        val targetHeight = if (degrees == 180) height else width
        val target = ByteArray(source.size)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val (targetX, targetY) = when (degrees) {
                    90 -> height - 1 - y to x
                    180 -> width - 1 - x to height - 1 - y
                    else -> y to width - 1 - x
                }
                target[targetY * targetWidth + targetX] = source[y * width + x]
            }
        }
        return Triple(target, targetWidth, targetHeight)
    }
}
