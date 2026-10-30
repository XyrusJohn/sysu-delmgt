package com.sysu.go.repository

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import com.google.gson.Gson
import com.sysu.go.model.SecurityGuard

data class CachedSecurityGuards(
    val guards: List<SecurityGuard>,
    val updatedAtMillis: Long,
)

/** Stores only the signed-in driver's last active-guard reference snapshot. */
class SecurityGuardRepository(context: Context, accountId: String?) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREF_PREFS_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()
    private val cacheKey = accountId?.let(SecurityGuardCachePolicy::keyForAccount)

    companion object {
        private const val PREF_PREFS_NAME = "sysu_go_prefs"
        private const val TAG = "SecurityGuardRepo"

        fun clearForAccount(context: Context, accountId: String?) {
            val key = accountId?.let(SecurityGuardCachePolicy::keyForAccount) ?: return
            context.applicationContext.getSharedPreferences(PREF_PREFS_NAME, Context.MODE_PRIVATE)
                .edit { remove(key) }
        }
    }

    /** Returns a bounded, unexpired snapshot for this account without a network request. */
    fun getCachedSnapshot(nowMillis: Long = System.currentTimeMillis()): CachedSecurityGuards? {
        val key = cacheKey ?: return null
        val json = prefs.getString(key, null) ?: return null
        val snapshot = SecurityGuardCachePolicy.decode(json, gson, nowMillis)
        if (snapshot == null) prefs.edit { remove(key) }
        return snapshot
    }

    /** Replaces the cache only when the server supplied a complete valid snapshot. */
    fun updateFromRealtime(data: Any?, nowMillis: Long = System.currentTimeMillis()): List<SecurityGuard>? {
        val key = cacheKey ?: return null
        val guards = SecurityGuardCachePolicy.parseRealtime(data) ?: return null
        val encoded = SecurityGuardCachePolicy.encode(guards, gson, nowMillis) ?: return null
        prefs.edit { putString(key, encoded) }
        return guards
    }
}
