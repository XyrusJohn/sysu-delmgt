package com.sysu.go.utils

import android.app.Activity
import android.app.Application
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.LayoutInflater
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.sysu.go.R
import com.sysu.go.activities.PermissionSetupActivity
import com.sysu.go.activities.SplashActivity

/**
 * Strict Global Permission Monitor.
 *
 * Hooks into Application ActivityLifecycleCallbacks so whenever ANY screen/tab/activity
 * is visible to the driver:
 * 1. Checks if all critical background tracking & system permissions are granted.
 * 2. If ANY permission is missing (Location GPS, Unrestricted Battery, Notifications, Camera),
 *    shows an unavoidable, un-dismissible floating alert window.
 * 3. The modal will NOT disappear until the user actually enables the missing permission(s).
 * 4. Tapping the action button opens the App Info Settings directly so the driver can grant it.
 */
object StrictPermissionMonitor : Application.ActivityLifecycleCallbacks {

    private var currentActivity: Activity? = null
    private var currentDialog: AlertDialog? = null

    fun initialize(application: Application) {
        application.registerActivityLifecycleCallbacks(this)
    }

    override fun onActivityResumed(activity: Activity) {
        currentActivity = activity
        evaluatePermissions(activity)
    }

    override fun onActivityPaused(activity: Activity) {
        if (currentActivity == activity) {
            currentActivity = null
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {
        if (currentActivity == activity) {
            dismissDialog()
            currentActivity = null
        }
    }

    /**
     * Checks permission status on the active screen.
     */
    fun evaluatePermissions(activity: Activity? = currentActivity) {
        val act = activity ?: return
        if (act.isFinishing || act.isDestroyed) return

        //  Do not block during Splash or the dedicated Permission Setup screen
        if (act is SplashActivity || act is PermissionSetupActivity) {
            dismissDialog()
            return
        }

        //  Only enforce strict floating alert if user has logged in session
        if (!SessionManager(act).hasActiveSession()) {
            dismissDialog()
            return
        }

        val missing = PermissionHelper.getDetailedMissingPermissions(act)
        if (missing.isEmpty()) {
            //  All permissions granted — dismiss floating alert immediately if showing
            dismissDialog()
        } else {
            //  Permissions are missing — show or update strict non-dismissible floating window
            showStrictAlert(act, missing)
        }
    }

    private fun showStrictAlert(activity: Activity, missing: List<PermissionHelper.MissingPermissionItem>) {
        if (activity.isFinishing || activity.isDestroyed) return

        try {
            dismissDialog()

            val dlgView = LayoutInflater.from(activity).inflate(R.layout.dialog_strict_permission_alert, null)
            dlgView.findViewById<ImageView>(R.id.ivPermAlertIcon).apply {
                backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(activity, R.color.sysu_red))
            }

            val container = dlgView.findViewById<android.widget.LinearLayout>(R.id.llMissingItemsList)
            container?.removeAllViews()

            missing.forEach { item ->
                val itemView = LayoutInflater.from(activity).inflate(R.layout.item_strict_missing_perm, container, false)
                itemView.findViewById<TextView>(R.id.tvItemTitle).text = item.title
                itemView.findViewById<TextView>(R.id.tvItemDescription).text = item.description
                itemView.findViewById<TextView>(R.id.tvItemGuide).text = "Saan ia-adjust: ${item.settingLocation}"
                container?.addView(itemView)
            }

            val dialog = AlertDialog.Builder(activity)
                .setView(dlgView)
                .setCancelable(false) // Strict: Cannot tap outside or back button to dismiss
                .create()

            dialog.setCanceledOnTouchOutside(false)

            dlgView.findViewById<MaterialButton>(R.id.btnGrantPermissionsNow).setOnClickListener {
                PermissionHelper.openAppSettings(activity)
            }

            dialog.show()
            currentDialog = dialog
        } catch (e: Exception) {
            //  If window cannot be added (e.g. activity destroyed in race condition)
        }
    }

    private fun dismissDialog() {
        try {
            if (currentDialog?.isShowing == true) {
                currentDialog?.dismiss()
            }
        } catch (_: Exception) {}
        currentDialog = null
    }
}
