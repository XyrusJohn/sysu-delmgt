package com.sysu.go.network

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonParser
import com.sysu.go.BuildConfig
import com.sysu.go.utils.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class TripReturnApiException(
    val httpStatus: Int,
    val apiCode: String?,
    val userMessage: String,
) : IOException("Return status was not saved (HTTP $httpStatus${apiCode?.let { ", $it" }.orEmpty()})")

internal fun tripReturnErrorMessage(action: String, status: Int, code: String?): String = when (code) {
    "LOCATION_STALE" -> "Kailangan ng bagong GPS location. Panatilihing bukas ang tracking at subukan ulit kapag updated na ang lokasyon."
    "OUTSIDE_GEOFENCE" -> "Hindi ka pa nasa arrival area ng warehouse. Lumapit sa base at hintaying mag-update ang lokasyon."
    "INVALID_RETURN_TRANSITION", "QUEUE_NOT_ACTIVE", "ASSIGNMENT_SET_CHANGED", "QUEUE_MISMATCH" ->
        "Nagbago ang status ng biyahe. Bumalik sa tracking at i-refresh bago subukan ulit."
    "DRIVER_UNAVAILABLE", "AUTHENTICATION_REQUIRED", "SESSION_INVALID" ->
        "Hindi na valid ang sign-in mo. Mag-sign in ulit bago magpatuloy."
    "ASSIGNMENT_UNAVAILABLE", "QUEUE_UNAVAILABLE" ->
        "Hindi na makita ang aktibong biyahe. I-refresh ang tracking at subukan ulit."
    else -> when {
        status == 401 || status == 403 -> "Hindi awtorisado ang account para sa aksiyong ito. Mag-sign in ulit kung kailangan."
        status >= 500 -> "Pansamantalang hindi ma-save ng server ang status. Subukan ulit mamaya."
        action == "arrived" -> "Hindi makumpirma ang pagdating. Hintaying mag-update ang GPS at subukan ulit."
        else -> "Hindi ma-update ang status ng biyahe. I-refresh at subukan ulit."
    }
}

object TripReturnApiService {
    suspend fun transition(context: Context, action: String, dispatchKeys: List<String>, queueId: String? = null) {
        require(action in ACTIONS)
        require(dispatchKeys.isNotEmpty() && dispatchKeys.size <= MAX_KEYS)
        require(dispatchKeys.all { KEY_PATTERN.matches(it) } && dispatchKeys.distinct().size == dispatchKeys.size)
        require(queueId == null || KEY_PATTERN.matches(queueId))

        val session = SessionManager(context)
        val driverId = session.getDriverId()?.takeIf(String::isNotBlank) ?: throw IOException("Please sign in again")
        val token = session.getAuthToken()?.takeIf(String::isNotBlank) ?: throw IOException("Please sign in again")
        val payload = linkedMapOf<String, Any>("action" to action, "dispatchKeys" to dispatchKeys)
        if (queueId != null) payload["queueId"] = queueId
        val path = "/api/trip/return"
        val payloadBytes = Gson().toJson(payload).toByteArray(Charsets.UTF_8)
        val requestKey = IdempotencyKeyStore.begin(context, driverId, "POST", path, payloadBytes)

        withContext(Dispatchers.IO) {
            check(session.getDriverId() == driverId) { "Account changed. Please retry" }
            val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path)
                .openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.requestMethod = "POST"
                connection.connectTimeout = 8000
                connection.readTimeout = 15000
                connection.doOutput = true
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Idempotency-Key", requestKey.value)
                connection.outputStream.use { it.write(payloadBytes) }
                val code = connection.responseCode
                val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                IdempotencyKeyStore.finish(context, requestKey, code, body.orEmpty(),
                    connection.getHeaderField("Idempotency-Completed") == "true")
                val response = runCatching { JsonParser.parseString(body.orEmpty()).takeIf { it.isJsonObject }?.asJsonObject }.getOrNull()
                val success = response?.get("success")?.asBoolean == true
                if (code !in 200..299 || !success) {
                    val apiCode = response?.get("code")?.takeUnless { it.isJsonNull }?.asString
                    throw TripReturnApiException(code, apiCode, tripReturnErrorMessage(action, code, apiCode))
                }
            } finally {
                connection.disconnect()
            }
        }
    }

    private val ACTIONS = setOf("start", "arrived", "complete")
    private val KEY_PATTERN = Regex("[A-Za-z0-9_-]{1,128}")
    private const val MAX_KEYS = 100
}
