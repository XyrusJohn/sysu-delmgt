package com.sysu.go.activities

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.util.Base64
import android.view.MotionEvent
import android.view.View
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SignaturePadView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    init {
        //  Opt out of nested scrolling so this view NEVER participates in
        //  the scroll hierarchy — combined with requestDisallowInterceptTouchEvent,
        //  this guarantees the parent NestedScrollView will never steal our touches
        isNestedScrollingEnabled = false
    }

    private val path = Path()
    private val paint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 6f
        color = Color.BLACK
    }

    private var lastX = 0f
    private var lastY = 0f

    private var isEmpty = true

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawPath(path, paint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x
        val y = event.y

        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                //  Prevent any ancestor scroll view from intercepting this touch stream
                parent?.requestDisallowInterceptTouchEvent(true)
                path.moveTo(x, y)
                lastX = x
                lastY = y
                isEmpty = false
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                path.quadTo(lastX, lastY, (x + lastX) / 2, (y + lastY) / 2)
                lastX = x
                lastY = y
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                //  Release the lock so parent scroll can work normally again
                parent?.requestDisallowInterceptTouchEvent(false)
                path.lineTo(lastX, lastY)
            }
        }

        invalidate()
        return true
    }

    fun clear() {
        path.reset()
        isEmpty = true
        invalidate()
    }

    fun isEmpty(): Boolean = isEmpty

    suspend fun getSignatureBase64(): String? {
        if (isEmpty) return null
        val w = width.takeIf { it > 0 } ?: return null
        val h = height.takeIf { it > 0 } ?: return null

        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE) // white background
        draw(canvas)

        return try {
            withContext(Dispatchers.Default) {
                ByteArrayOutputStream().use { stream ->
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) null
                    else Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                }
            }
        } finally {
            bitmap.recycle()
        }
    }
}