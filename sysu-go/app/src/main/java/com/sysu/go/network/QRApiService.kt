package com.sysu.go.network

import android.content.Context
import com.sysu.go.BuildConfig
import com.sysu.go.model.ScanRequest
import com.sysu.go.model.ScanResponse
import com.sysu.go.model.VerifyResponse
import com.sysu.go.utils.SessionManager
import java.net.HttpURLConnection
import java.net.URL
import java.io.IOException
import org.json.JSONObject

object QRApiService {
    sealed class Result<out T> {
        data class Success<T>(val data: T): Result<T>()
        data class Error(val code: Int, val message: String): Result<Nothing>()
    }

    private val verifyClient = QrHttpClient(BuildConfig.API_BASE_URL + "/api/qr", { null })

    fun verifyToken(token: String): Result<VerifyResponse> = adapt(verifyClient.verifyToken(token))

    fun scanToken(context: Context, request: ScanRequest): Result<ScanResponse> {
        val session = SessionManager(context)
        if (session.getDriverId() != request.driverId) return Result.Error(401, "Please sign in again")
        val client = QrHttpClient(BuildConfig.API_BASE_URL + "/api/qr",
            tokenProvider = { session.getAuthToken() },
            forceRefreshTokenProvider = { null },
            idempotencyContext = context.applicationContext,
            idempotencyAccountId = request.driverId)
        return adapt(client.scanToken(request))
    }

    fun ownPosition(context: Context, queueId: String): Int? {
        if (!queueId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) return null
        val session = SessionManager(context)
        val uid = session.getDriverId() ?: return null
        val token = session.getAuthToken() ?: return null
        val connection = URL(BuildConfig.API_BASE_URL + "/api/qr/own-position?queueId=" + queueId)
            .openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 6000
            connection.readTimeout = 6000
            connection.setRequestProperty("Authorization", "Bearer $token")
            if (connection.responseCode != 200) return null
            val text = connection.inputStream.bufferedReader().use { reader ->
                val buffer = CharArray(1024)
                val result = StringBuilder()
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    if (result.length + count > 4096) return null
                    result.append(buffer, 0, count)
                }
                result.toString()
            }
            val body = JSONObject(text)
            if (session.getDriverId() != uid || !body.optBoolean("success")
                || body.optString("queueId") != queueId || body.isNull("position")) return null
            val position = body.optInt("position", -1)
            return position.takeIf { it in 1..2000 }
        } finally { connection.disconnect() }
    }

    fun cancelOwnQueue(context: Context, queueId: String) {
        require(queueId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        val session = SessionManager(context)
        val driverId = session.getDriverId() ?: throw IOException("Please sign in again")
        val token = session.getAuthToken()?.takeIf(String::isNotBlank)
            ?: throw IOException("Please sign in again")
        val path = "/api/qr/queue/$queueId/cancel"
        val payload = "{}".toByteArray(Charsets.UTF_8)
        val requestKey = IdempotencyKeyStore.begin(context, driverId, "POST", path, payload)
        val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path)
            .openConnection() as HttpURLConnection
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
            val body = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            IdempotencyKeyStore.finish(context, requestKey, status, body,
                connection.getHeaderField("Idempotency-Completed") == "true")
            if (body.length > 8192) throw IOException("Queue cancellation response is too large")
            val response = JSONObject(body)
            if (session.getDriverId() != driverId) throw IOException("Account changed. Please retry")
            if (status !in 200..299 || !response.optBoolean("success")
                || response.optString("queueId") != queueId || response.optString("status") != "cancelled") {
                throw IOException(response.optString("message").ifBlank { "Queue cancellation failed (HTTP $status)" })
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun <T> adapt(result: QrResult<T>): Result<T> = when (result) {
        is QrResult.Success -> Result.Success(result.data)
        is QrResult.Error -> Result.Error(result.code, result.message)
    }
}
