package com.sysu.go.network

import android.content.Context
import com.sysu.go.BuildConfig
import com.sysu.go.utils.SessionManager
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

object AssignmentApiService {
    fun startTrip(context: Context, previousDispatchKey: String?, nextDispatchKey: String) {
        require(nextDispatchKey.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(previousDispatchKey == null || previousDispatchKey.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        post(context, "/api/trip/assignments/start", JSONObject().apply {
            if (previousDispatchKey != null) put("previousDispatchKey", previousDispatchKey)
            put("nextDispatchKey", nextDispatchKey)
        })
    }

    fun update(context: Context, dispatchKey: String, patch: Map<String, Any?>) {
        require(dispatchKey.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(patch.isNotEmpty() && patch.keys.all { it in ALLOWED_FIELDS })
        post(context, "/api/trip/assignments/$dispatchKey/update", JSONObject().apply {
            patch.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
        })
    }

    fun confirm(context: Context, dispatchKeys: Collection<String>) {
        require(dispatchKeys.isNotEmpty() && dispatchKeys.size <= 100)
        require(dispatchKeys.all { it.matches(Regex("[A-Za-z0-9_-]{1,128}")) })
        post(context, "/api/trip/assignments/confirm", JSONObject().put("dispatchKeys", org.json.JSONArray(dispatchKeys)))
    }

    private fun post(context: Context, path: String, body: JSONObject) {
        val session = SessionManager(context)
        val token = session.getAuthToken()?.takeIf(String::isNotBlank)
            ?: throw IOException("Please sign in again")
        val accountId = session.getDriverId()?.takeIf(String::isNotBlank)
            ?: throw IOException("Please sign in again")
        val url = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path)
        val connection = url.openConnection() as HttpURLConnection
        val payload = body.toString().toByteArray(Charsets.UTF_8)
        val requestKey = IdempotencyKeyStore.begin(context, accountId, "POST", path, payload)
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.connectTimeout = 6000
            connection.readTimeout = 8000
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Idempotency-Key", requestKey.value)
            connection.outputStream.use { it.write(payload) }
            val status = connection.responseCode
            val responseBody = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            IdempotencyKeyStore.finish(context, requestKey, status, responseBody,
                connection.getHeaderField("Idempotency-Completed") == "true")
            if (status !in 200..299) throw IOException("Assignment update failed (HTTP $status)")
        } finally {
            connection.disconnect()
        }
    }

    private val ALLOWED_FIELDS = setOf(
        "status", "driverConfirmed", "guardVerified", "guardFirstName", "guardLastName", "guardMI",
        "guardSignatureBase64",
    )
}
