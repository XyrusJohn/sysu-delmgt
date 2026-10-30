package com.sysu.go.diagnostics

import android.app.Activity
import android.app.Application
import android.graphics.Color
import android.view.View
import com.google.android.material.snackbar.Snackbar
import java.util.concurrent.ConcurrentHashMap
import java.lang.ref.WeakReference

/** Presents safe, consistent feedback without exposing backend or exception details. */
object UserErrorNotifier {
    private val lastShown = ConcurrentHashMap<String, Long>()
    @Volatile private var resumedActivity = WeakReference<Activity>(null)

    fun install(application: Application) {
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, state: android.os.Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityResumed(activity: Activity) { resumedActivity = WeakReference(activity) }
            override fun onActivityPaused(activity: Activity) {
                if (resumedActivity.get() === activity) resumedActivity.clear()
            }
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: android.os.Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) {
                if (resumedActivity.get() === activity) resumedActivity.clear()
            }
        })
    }

    fun showCurrent(key: String, message: String) {
        resumedActivity.get()?.let { show(it, key, message) }
    }

    fun showFailure(activity: Activity, operation: String, error: Throwable? = null, messageOverride: String? = null) {
        if (error != null) SystemErrorReporter.reportOperationFailure(operation, error)
        show(activity, operation, messageOverride ?: messageFor(operation))
    }

    fun showRealtimeFailure(activity: Activity, operation: String) {
        SystemErrorReporter.reportOperationFailure(operation, "RealtimeError")
        show(activity, operation, messageFor(operation))
    }

    private fun messageFor(operation: String): String = when (operation) {
            "realtime-connection", "queue-subscription", "assignment-subscription", "guard-subscription" ->
                "Live data is temporarily unavailable. Reconnecting; check your internet connection."
            "profile-subscription" -> "Your profile status is temporarily unavailable. Check your connection and retry."
            "driver-profile" -> "Your driver profile could not be saved. Some details may not be available next time."
            "queue-load" -> "Queue details could not be loaded. Check your connection and retry."
            "qr-camera-start" -> "The camera could not be opened. Check camera permission and try again."
            "location-tracking-start", "location-fetch" -> "Your location could not be retrieved. Check GPS and location permission."
            "pod-refresh", "pod-save", "pod-preview" -> "Proof of delivery could not be loaded or saved. Check your connection and try again."
            "trip-history" -> "Trip history could not be loaded. Check your connection and try again."
            "pod-processing", "camera-status-sheet" -> "The delivery photo could not be processed. Check camera permission and try again."
            "guard-verification" -> "Guard verification could not be saved. Check your connection and try again."
            "trip-start" -> "The trip could not be started. Check your connection and try again."
            "shipment-completion" -> "The shipment could not be completed. Check your connection and try again."
            "shipment-state-transition" -> "The shipment status could not be updated. Check your connection and try again."
            else -> "That action could not be completed. Check your connection and try again."
        }

    fun show(activity: Activity, key: String, message: String) {
        if (activity.isFinishing || activity.isDestroyed) return
        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
            val now = System.currentTimeMillis()
            val dedupeKey = "${activity.javaClass.simpleName}:$key"
            val previous = lastShown.put(dedupeKey, now)
            val throttleMs = if (key == "realtime-connection" || key.endsWith("-subscription")) 60_000L else 8_000L
            if (previous != null && now - previous < throttleMs) return@runOnUiThread
            val root = activity.findViewById<View>(android.R.id.content) ?: return@runOnUiThread
            Snackbar.make(root, message, Snackbar.LENGTH_LONG)
                .setBackgroundTint(Color.rgb(153, 27, 27))
                .setTextColor(Color.WHITE)
                .setActionTextColor(Color.WHITE)
                .setAction("Dismiss") { }
                .show()
        }
    }
}
