package com.sysu.go.utils

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.sysu.go.repository.SecurityGuardRepository

class SessionManager(context: Context) {
    private val appContext = context.applicationContext
    companion object {
        private const val PREFS_NAME = "driver_session"
        private const val AUTH_PREFS_NAME = "driver_auth_session"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_DRIVER_ID = "driver_id"
        private const val KEY_USERNAME = "username"
        private const val KEY_DRIVER_NAME = "driver_name"
        private const val KEY_DRIVER_FN = "driver_fn"
        private const val KEY_DRIVER_MI = "driver_mi"
        private const val KEY_DRIVER_LN = "driver_ln"
        private const val KEY_DRIVER_PHONE = "driver_phone"
        private const val KEY_DRIVER_COMPANY = "driver_company"
        private const val KEY_IS_LOGGED_IN = "is_logged_in"
        private const val KEY_SAP_DOC_ID = "sap_doc_id"
        private const val KEY_IS_TRIP_ACTIVE = "is_trip_active"

        private const val KEY_LAST_EMIT_LAT = "last_emit_lat"
        private const val KEY_LAST_EMIT_LNG = "last_emit_lng"
        private const val KEY_TRACKING_ACTIVE = "tracking_active"
        /** Tracks the sap_assignments docId that is currently in_transit — used to lock Start buttons on other shipments */
        private const val KEY_ACTIVE_SAP_DOC_ID = "active_sap_doc_id"
        /** Tracks the server ID of the current queue entry.
         *  Used by AssignmentActivity as the first approach when querying sap_assignments
         *  (many docs use queue doc ID as driverId, not account ID). */
        private const val KEY_CURRENT_QUEUE_DOC_ID = "current_queue_doc_id"
        /** Permanent record of the most recent queue doc ID — used by History queries
         *  AFTER the trip is completed and KEY_CURRENT_QUEUE_DOC_ID has been cleared.
         *  sap_assignments keeps the queue doc ID as its driverId field, so this is
         *  the only reliable lookup once the queue doc's driverId field has been deleted. */
        private const val KEY_LAST_QUEUE_DOC_ID = "last_queue_doc_id"
        private const val KEY_PENDING_CONFIRMED_DOC_ID = "pendingConfirmedDocId"

        private const val TAG = "SESSIONMANAGER_DEFINITIVE"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    init {
        prefs.edit { remove("driver_email") }
    }
    private val authPrefs: SharedPreferences? by lazy {
        runCatching {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                AUTH_PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }.onFailure { Log.e("SessionManager", "Encrypted auth storage unavailable") }.getOrNull()
    }

    fun saveAuthToken(token: String): Boolean {
        require(token.matches(Regex("[A-Za-z0-9_-]{40,128}"))) { "Invalid session token" }
        val preferences = authPrefs ?: return false
        return runCatching { preferences.edit().putString(KEY_AUTH_TOKEN, token).commit() }.getOrDefault(false)
    }

    fun getAuthToken(): String? = runCatching { authPrefs?.getString(KEY_AUTH_TOKEN, null) }.getOrNull()

    fun saveUsername(username: String) {
        prefs.edit { putString(KEY_USERNAME, username) }
    }

    fun getUsername(): String? = prefs.getString(KEY_USERNAME, null)

    fun saveDriverSession(uid: String, name: String) {
        clearGuardCacheForPreviousAccount(uid)
        val parts = parseNameParts(name)
        prefs.edit {
            putString(KEY_DRIVER_ID, uid)
            putString(KEY_DRIVER_NAME, Sanitizer.sanitizeDisplayName(name))
            putString(KEY_DRIVER_FN, parts.first)
            putString(KEY_DRIVER_MI, parts.second)
            putString(KEY_DRIVER_LN, parts.third)
            putBoolean(KEY_IS_LOGGED_IN, true)
        }
    }

    fun saveDriverSessionWithSplit(
        uid: String,
        fn: String,
        mi: String,
        ln: String,
        displayName: String,
        phone: String = "",
        company: String = ""
    ) {
        clearGuardCacheForPreviousAccount(uid)
        prefs.edit {
            putString(KEY_DRIVER_ID, uid)
            putString(KEY_DRIVER_NAME, Sanitizer.sanitizeDisplayName(displayName))
            putString(KEY_DRIVER_FN, fn)
            putString(KEY_DRIVER_MI, mi)
            putString(KEY_DRIVER_LN, ln)
            putString(KEY_DRIVER_PHONE, phone)
            putString(KEY_DRIVER_COMPANY, company)
            putBoolean(KEY_IS_LOGGED_IN, true)
        }
    }

    fun getDriverId(): String? = prefs.getString(KEY_DRIVER_ID, null)

    fun getDriverName(): String {
        val raw = prefs.getString(KEY_DRIVER_NAME, null) ?: return "Unknown Driver"
        val clean = Sanitizer.sanitizeDisplayName(raw)
        return clean.ifBlank { raw.ifBlank { "Unknown Driver" } }
    }

    fun getDriverPhone(): String? = prefs.getString(KEY_DRIVER_PHONE, null)

    fun getDriverFN(): String = prefs.getString(KEY_DRIVER_FN, "") ?: ""

    fun getDriverMI(): String = prefs.getString(KEY_DRIVER_MI, "") ?: ""

    fun getDriverLN(): String = prefs.getString(KEY_DRIVER_LN, "") ?: ""

    fun getDriverCompany(): String = prefs.getString(KEY_DRIVER_COMPANY, "") ?: ""

    fun saveDriverCompany(company: String) {
        prefs.edit { putString(KEY_DRIVER_COMPANY, company) }
    }

    /**
     * Returns Triple(driverFN, driverMI, driverLN).
     * Falls back to parsing getDriverName() if stored fields are blank.
     */
    fun getDriverNameParts(): Triple<String, String, String> {
        val fn = getDriverFN()
        val mi = getDriverMI()
        val ln = getDriverLN()
        if (fn.isNotEmpty() && ln.isNotEmpty()) {
            return Triple(fn, mi, ln)
        }
        //  Fallback: parse from the full display name
        return parseNameParts(getDriverName())
    }

    /**
     * Parses "FirstName MiddleInitial LastName" into (fn, mi, ln).
     * Handles: "Juan M. Cruz" → ("Juan", "M", "Cruz"), "Juan Cruz" → ("Juan", "", "Cruz")
     */
    private fun parseNameParts(fullName: String): Triple<String, String, String> {
        val parts = fullName.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return when {
            parts.size >= 3 -> {
                //  First Middle Last (e.g., "Juan M. Cruz")
                val fn = parts[0]
                val mi = parts.dropLast(2).lastOrNull()?.take(1)?.replace(".", "") ?: ""
                val ln = parts.last()
                Triple(fn, mi, ln)
            }
            parts.size == 2 -> Triple(parts[0], "", parts[1])
            parts.size == 1 -> Triple(parts[0], "", "")
            else -> Triple("", "", "")
        }
    }

    fun hasActiveSession(): Boolean = prefs.getBoolean(KEY_IS_LOGGED_IN, false)
        && getDriverId() != null && !getAuthToken().isNullOrBlank()

    fun clearSession() {
        SecurityGuardRepository.clearForAccount(appContext, getDriverId())
        val username = getUsername()
        prefs.edit {
            clear()
            username?.let { putString(KEY_USERNAME, it) }
        }
        runCatching { authPrefs?.edit { clear() } }
    }

    private fun clearGuardCacheForPreviousAccount(nextUid: String) {
        val previousUid = getDriverId()
        if (!previousUid.isNullOrBlank() && previousUid != nextUid) {
            SecurityGuardRepository.clearForAccount(appContext, previousUid)
        }
    }

    fun saveCurrentSapDocId(id: String) {
        prefs.edit { putString(KEY_SAP_DOC_ID, id) }
    }

    fun getCurrentSapDocId(): String? {
        return prefs.getString(KEY_SAP_DOC_ID, null)
    }

    fun clearCurrentSapDocId() {
        prefs.edit { remove(KEY_SAP_DOC_ID) }
    }

    fun setTripActive(active: Boolean) {
        prefs.edit { putBoolean(KEY_IS_TRIP_ACTIVE, active) }
    }

    fun isTripActive(): Boolean {
        return prefs.getBoolean(KEY_IS_TRIP_ACTIVE, false)
    }

    fun getLastEmitLat(): Double = prefs.getFloat(KEY_LAST_EMIT_LAT, 0.0f).toDouble()

    fun getLastEmitLng(): Double = prefs.getFloat(KEY_LAST_EMIT_LNG, 0.0f).toDouble()

    fun saveLastEmit(lat: Double, lng: Double) {
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            android.util.Log.w("SessionManager", "saveLastEmit: invalid coords [$lat, $lng] — ignoring")
            return
        }
        prefs.edit {
            putFloat(KEY_LAST_EMIT_LAT, lat.toFloat())
            putFloat(KEY_LAST_EMIT_LNG, lng.toFloat())
        }
    }

    /**
     * Called by TransitActivity on "Start Trip" to mark that GPS tracking should be active.
     * LocationServices reads this on onStartCommand to decide whether to start GPS updates.
     */
    fun setTrackingActive(active: Boolean) {
        Log.d(TAG, "[SESSION] setTrackingActive called: $active")
        prefs.edit { putBoolean(KEY_TRACKING_ACTIVE, active) }
    }

    fun isTrackingActive(): Boolean {
        val result = prefs.getBoolean(KEY_TRACKING_ACTIVE, false)
        Log.d(TAG, "[SESSION] isTrackingActive called: $result")
        return result
    }

    fun clearTripSession() {
        prefs.edit {
            remove(KEY_SAP_DOC_ID)
            remove(KEY_IS_TRIP_ACTIVE)
            remove(KEY_LAST_EMIT_LAT)
            remove(KEY_LAST_EMIT_LNG)
            remove(KEY_TRACKING_ACTIVE)
            remove(KEY_ACTIVE_SAP_DOC_ID)
        }
    }

    /**
     * Saves the sap_assignments docId of the shipment that is currently in transit.
     * Used by AssignmentActivity to lock Start Trip buttons on OTHER shipments.
     */
    fun saveActiveSapDocId(docId: String?) {
        prefs.edit {
            if (docId != null) putString(KEY_ACTIVE_SAP_DOC_ID, docId)
            else remove(KEY_ACTIVE_SAP_DOC_ID)
        }
    }

    /**
     * Returns the sap_assignments docId of the currently-active in-transit shipment,
     * or null if no trip is active.
     */
    fun getActiveSapDocId(): String? = prefs.getString(KEY_ACTIVE_SAP_DOC_ID, null)

    /**
     * Saves the server ID of the driver's current queue entry.
     * Used by AssignmentActivity as the first lookup when loading assignments,
     * since many sap_assignments docs store queue doc ID (not account ID) as driverId.
     */
    fun saveCurrentQueueDocId(queueDocId: String?) {
        prefs.edit {
            if (queueDocId != null) {
                putString(KEY_CURRENT_QUEUE_DOC_ID, queueDocId)
                putString(KEY_LAST_QUEUE_DOC_ID, queueDocId)
            } else {
                remove(KEY_CURRENT_QUEUE_DOC_ID)
            }
        }
    }

    /**
     * Returns the server ID of the driver's current queue entry,
     * or null if not in queue.
     */
    fun getCurrentQueueDocId(): String? = prefs.getString(KEY_CURRENT_QUEUE_DOC_ID, null)

    /**
     * Returns the most recent queue doc ID, even after the current entry has been
     * cleared (e.g. after the driver returned to base). Used by History queries
     * because sap_assignments keeps the queue doc ID as its driverId field forever.
     */
    fun getLastQueueDocId(): String? = prefs.getString(KEY_LAST_QUEUE_DOC_ID, null)

    /**
     * Optimistic bridge: AssignmentActivity sets this when confirmShipment succeeds,
     * so MainActivity can optimistically update the local shipment state on resume
     * without waiting for a realtime update to arrive (avoids a visible UI gap).
     */
    fun savePendingConfirmedDocId(docId: String) {
        prefs.edit { putString(KEY_PENDING_CONFIRMED_DOC_ID, docId) }
    }

    /**
     * Reads and clears the pending-confirmation flag. Returns the docId if one was
     * set, or null otherwise.
     */
    fun consumePendingConfirmedDocId(): String? {
        val id = prefs.getString(KEY_PENDING_CONFIRMED_DOC_ID, null)
        if (id != null) prefs.edit { remove(KEY_PENDING_CONFIRMED_DOC_ID) }
        return id
    }
}
