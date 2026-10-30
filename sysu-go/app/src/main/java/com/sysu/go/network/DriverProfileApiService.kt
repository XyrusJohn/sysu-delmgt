package com.sysu.go.network

import android.content.Context
import com.google.gson.JsonParser
import com.sysu.go.BuildConfig
import com.sysu.go.utils.SessionManager
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

internal fun <T> retryReadOnceAfterTimeout(
    request: () -> T,
    waitBeforeRetry: () -> Unit = { Thread.sleep(500) },
): T {
    try {
        return request()
    } catch (firstTimeout: SocketTimeoutException) {
        try {
            waitBeforeRetry()
        } catch (interrupted: InterruptedException) {
            Thread.currentThread().interrupt()
            firstTimeout.addSuppressed(interrupted)
            throw firstTimeout
        }
        try {
            return request()
        } catch (retryTimeout: SocketTimeoutException) {
            retryTimeout.addSuppressed(firstTimeout)
            throw retryTimeout
        }
    }
}

data class DriverProfile(
    val name: String,
    val truckType: String,
    val plateNumber: String,
    val truckingCompany: String,
    val helper: String,
    val requirements: Map<String, Boolean>,
)

object DriverProfileApiService {
    fun getOwn(context: Context): DriverProfile {
        //  This read is safe to retry once; profile updates and workflow actions are not.
        val data = retryReadOnceAfterTimeout(request = { request(context, "GET", "/api/driver/profile") })
        val requirementsJson = data.getAsJsonObject("requirements")
        val requirements = requirementsJson?.entrySet()?.associate { (key, value) -> key to value.asBoolean }.orEmpty()
        return DriverProfile(
            name = data.get("name")?.asString.orEmpty(),
            truckType = data.get("truckType")?.asString.orEmpty(),
            plateNumber = data.get("plateNumber")?.asString.orEmpty(),
            truckingCompany = data.get("truckingCompany")?.asString.orEmpty(),
            helper = data.get("helper")?.asString.orEmpty(),
            requirements = requirements,
        )
    }

    fun updateRegistration(
        context: Context,
        queueId: String,
        name: String,
        truckType: String,
        plateNumber: String,
        truckingCompany: String,
        helper: String,
        requirements: Map<String, Boolean>,
    ) {
        require(queueId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(requirements.size <= 64 && requirements.keys.all { it.matches(Regex("[A-Za-z][A-Za-z0-9_-]{0,63}")) })
        val body = JSONObject()
            .put("queueId", queueId)
            .put("name", name)
            .put("truckType", truckType)
            .put("plateNumber", plateNumber)
            .put("truckingCompany", truckingCompany)
            .put("helper", helper)
            .put("requirements", JSONObject(requirements))
        request(context, "PUT", "/api/driver/profile", body)
    }

    fun updateRequirements(context: Context, requirements: Map<String, Boolean>) {
        require(requirements.size <= 64 && requirements.keys.all { it.matches(Regex("[A-Za-z][A-Za-z0-9_-]{0,63}")) })
        val body = JSONObject().put("requirements", JSONObject(requirements))
        request(context, "PUT", "/api/driver/profile/requirements", body)
    }

    private fun request(context: Context, method: String, path: String, body: JSONObject? = null): com.google.gson.JsonObject {
        val session = SessionManager(context)
        val token = session.getAuthToken()?.takeIf(String::isNotBlank)
            ?: throw IOException("Please sign in again")
        val accountId = session.getDriverId()?.takeIf(String::isNotBlank)
            ?: throw IOException("Please sign in again")
        val payload = body?.toString()?.toByteArray(Charsets.UTF_8)
        val requestKey = if (method !in setOf("GET", "HEAD", "OPTIONS") && payload != null)
            IdempotencyKeyStore.begin(context, accountId, method, path, payload) else null
        val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = 6000
            connection.readTimeout = 8000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            requestKey?.let { connection.setRequestProperty("Idempotency-Key", it.value) }
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(payload) }
            }
            val status = connection.responseCode
            val responseBody = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (requestKey != null) IdempotencyKeyStore.finish(context, requestKey, status, responseBody,
                connection.getHeaderField("Idempotency-Completed") == "true")
            if (status !in 200..299) throw IOException("Driver profile unavailable (HTTP $status)")
            val response = JsonParser.parseString(responseBody).asJsonObject
            if (response.get("success")?.asBoolean != true) throw IOException("Driver profile unavailable")
            return response.getAsJsonObject("data") ?: throw IOException("Driver profile unavailable")
        } finally {
            connection.disconnect()
        }
    }
}
