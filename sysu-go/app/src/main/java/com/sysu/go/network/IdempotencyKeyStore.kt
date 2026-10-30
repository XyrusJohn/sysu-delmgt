package com.sysu.go.network

import android.content.Context
import java.security.MessageDigest
import java.util.UUID

/** Keeps one retry key per signed-in account and exact write until the server gives a final result. */
object IdempotencyKeyStore {
    data class RequestKey(val preferenceKey: String, val value: String)

    fun begin(context: Context, accountId: String, method: String, path: String, body: ByteArray): RequestKey {
        require(accountId.isNotBlank())
        val digest = sha256("${method.uppercase()}\n$path\n" + sha256(body))
        val preferenceKey = "pending:$accountId:$digest"
        val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val existing = preferences.getString(preferenceKey, null)
        if (existing != null) return RequestKey(preferenceKey, existing)
        val created = UUID.randomUUID().toString()
        synchronized(lock) {
            val current = preferences.getString(preferenceKey, null)
            if (current != null) return RequestKey(preferenceKey, current)
            check(preferences.edit().putString(preferenceKey, created).commit()) {
                "Could not save the request retry key"
            }
        }
        return RequestKey(preferenceKey, created)
    }

    /** Keep the key after an unknown outcome so a retry replays the same server operation. */
    fun finish(context: Context, key: RequestKey, status: Int, responseBody: String, completed: Boolean = false) {
        val pending = runCatching {
            val root = org.json.JSONObject(responseBody)
            root.optString("code") == "IDEMPOTENCY_IN_PROGRESS"
                || root.optString("code") == "IDEMPOTENCY_RESULT_UNSAVED"
                || root.optString("code") == "IDEMPOTENCY_UNAVAILABLE"
                || root.optString("code") == "IDEMPOTENCY_SCHEMA_NOT_READY"
        }.getOrDefault(false)
        if (pending || status == 401 || status == 403 || status >= 500) return
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit().remove(key.preferenceKey).commit()
    }

    private fun sha256(value: String): String = sha256(value.toByteArray(Charsets.UTF_8))

    private fun sha256(value: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(value).joinToString("") { byte -> "%02x".format(byte) }

    private val lock = Any()
    private const val PREFERENCES = "sysu_go_idempotency_keys"
}
