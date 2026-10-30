package com.sysu.go.utils

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * Helper that checks all three permissions required for reliable background tracking:
 * 1. Location (fine + coarse)
 * 2. Notification (POST_NOTIFICATIONS on Android 13+)
 * 3. Battery Optimization (must be disabled so Android doesn't kill the foreground service)
 *
 * Also tracks whether the driver has completed the permission setup screen at least once,
 * so we don't annoy them on every app open.
 */
object PermissionHelper {

    private const val PREFS_NAME = "permission_setup"
    private const val KEY_SETUP_COMPLETED = "setup_completed"

    //  SharedPrefs for tracking first-time setup

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun hasCompletedSetup(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SETUP_COMPLETED, false)

    fun markSetupCompleted(context: Context) {
        prefs(context).edit().putBoolean(KEY_SETUP_COMPLETED, true).apply()
    }

    //  Individual permission checks

    /**
     * Returns true only when BOTH fine and coarse location are granted.
     * ACCESS_COARSE_LOCATION alone is NOT enough — the app needs GPS-level accuracy.
     */
    fun hasLocationPermission(context: Context): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return fine && coarse
    }

    /**
     * POST_NOTIFICATIONS is a runtime permission on Android 13+. Below 13 it's
     * granted automatically at install time, so we return true.
     */
    fun hasNotificationPermission(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true // Auto-granted pre-Android 13
        }
    }

    /**
     * Battery optimization must be IGNORED (whitelisted) so the foreground service
     * is not killed when the screen is off or the phone is idle.
     *
     * Use PowerManager.isIgnoringBatteryOptimizations() — available on API 23+.
     */
    @SuppressLint("BatteryLife")
    fun hasBatteryOptimizationDisabled(context: Context): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Camera permission check for QR scanning and POD capture.
     */
    fun hasCameraPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Returns true only when ALL required permissions for tracking and features are granted.
     */
    fun hasAllPermissions(context: Context): Boolean =
        hasLocationPermission(context) &&
        hasNotificationPermission(context) &&
        hasBatteryOptimizationDisabled(context) &&
        hasCameraPermission(context)

    data class MissingPermissionItem(
        val title: String,
        val description: String,
        val settingLocation: String
    )

    /**
     * Returns a rich list of missing permission details for the driver.
     */
    fun getDetailedMissingPermissions(context: Context): List<MissingPermissionItem> {
        val missing = mutableListOf<MissingPermissionItem>()
        if (!hasLocationPermission(context)) {
            missing.add(
                MissingPermissionItem(
                    title = "📍 Lokasyon / GPS (Precise Location)",
                    description = "Kailangan naka-set sa 'Allow all the time' o 'While using the app' at naka-ON ang 'Use precise location'.",
                    settingLocation = "Permissions > Location"
                )
            )
        }
        if (!hasBatteryOptimizationDisabled(context)) {
            missing.add(
                MissingPermissionItem(
                    title = "⚡ Unrestricted Battery (No Sleep)",
                    description = "Kailangan naka-set sa 'Unrestricted' o 'Don't optimize' para hindi mag-offline kapag naka-lock ang screen.",
                    settingLocation = "App battery usage > Unrestricted"
                )
            )
        }
        if (!hasNotificationPermission(context)) {
            missing.add(
                MissingPermissionItem(
                    title = "🔔 System Notifications",
                    description = "Kailangan naka-ON ang notifications para manatiling aktibo ang background service.",
                    settingLocation = "Permissions > Notifications"
                )
            )
        }
        if (!hasCameraPermission(context)) {
            missing.add(
                MissingPermissionItem(
                    title = "📷 Camera Access",
                    description = "Kailangan para makapag-scan ng QR at kumuha ng litrato ng POD delivery.",
                    settingLocation = "Permissions > Camera"
                )
            )
        }
        return missing
    }

    /**
     * Returns a list of permission names that are currently missing.
     */
    fun getMissingPermissions(context: Context): List<String> {
        return getDetailedMissingPermissions(context).map { it.title }
    }

    /**
     * Opens the official Android App Info settings screen for this app.
     */
    fun openAppSettings(context: Context) {
        try {
            val intent = android.content.Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = android.net.Uri.fromParts("package", context.packageName, null)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            try {
                val fallback = android.content.Intent(Settings.ACTION_SETTINGS).apply {
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(fallback)
            } catch (_: Exception) {}
        }
    }

    /**
     * Whether we should show the permission setup screen.
     * Show it only when the driver hasn't completed setup OR when core permissions are missing.
     */
    fun needsSetup(context: Context): Boolean =
        !hasCompletedSetup(context) || !hasLocationPermission(context) || !hasNotificationPermission(context) || !hasBatteryOptimizationDisabled(context)
}