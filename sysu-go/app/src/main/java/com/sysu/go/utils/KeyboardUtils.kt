package com.sysu.go.utils

import android.app.Activity
import android.content.Context
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText

/**
 * Utility to provide seamless keyboard auto-dismissal when touching outside input fields.
 */
object KeyboardUtils {

    /**
     * Call this in an Activity's `dispatchTouchEvent` to automatically hide
     * the soft keyboard and remove focus when the user touches outside an active EditText.
     */
    fun handleTouchOutsideEditText(activity: Activity, ev: MotionEvent?) {
        if (ev?.action == MotionEvent.ACTION_DOWN) {
            val currentFocus = activity.currentFocus
            if (currentFocus is EditText) {
                val outRect = Rect()
                currentFocus.getGlobalVisibleRect(outRect)
                if (!outRect.contains(ev.rawX.toInt(), ev.rawY.toInt())) {
                    currentFocus.clearFocus()
                    val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
                    imm?.hideSoftInputFromWindow(currentFocus.windowToken, 0)
                }
            }
        }
    }

    /**
     * Explicitly hides the soft keyboard for the given view or current focused view.
     */
    fun hideKeyboard(activity: Activity, view: View? = null) {
        val targetView = view ?: activity.currentFocus ?: activity.window.decorView
        val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(targetView.windowToken, 0)
    }
}
