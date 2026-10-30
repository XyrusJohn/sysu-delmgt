package com.sysu.go.network

import android.content.Context
import com.google.gson.Gson
import com.sysu.go.BuildConfig
import com.sysu.go.utils.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.io.InputStream

/** Server-owned atomic OBD/image progress. UI succeeds only after committed response. */
object PodApiService {
    suspend fun getImage(context: Context, shipmentId: String, obdNumber: String): String? {
        val session = SessionManager(context)
        val userId = session.getDriverId() ?: error("Please sign in again")
        val token = session.getAuthToken() ?: error("Please sign in again")
        return withContext(Dispatchers.IO) {
            check(session.getDriverId() == userId) { "Account changed. Please retry" }
            fun segment(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
            val connection = URL(BuildConfig.API_BASE_URL + "/api/pod/" + segment(shipmentId) + "/" + segment(obdNumber))
                .openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "GET"
                connection.connectTimeout = 10000
                connection.readTimeout = 15000
                connection.setRequestProperty("Authorization", "Bearer " + token)
                connection.setRequestProperty("Accept", "application/json")
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.use { readLimited(it, MAX_RESPONSE_CHARS) }
                if (code !in 200..299) throw IllegalStateException("POD image is unavailable")
                val root = Gson().fromJson(body, Map::class.java)
                check(root["success"] == true) { "POD image is unavailable" }
                val data = root["data"] as? Map<*, *> ?: return@withContext null
                data["base64Image"] as? String
            } finally {
                connection.disconnect()
            }
        }
    }

    suspend fun updateGroup(context: Context, shipmentId: String, payload: Map<String, Any?>): Map<String, Any?> {
        val session = SessionManager(context)
        val userId = session.getDriverId() ?: error("Please sign in again")
        val token = session.getAuthToken() ?: error("Please sign in again")
        return withContext(Dispatchers.IO) {
            check(session.getDriverId() == userId) { "Account changed. Please retry" }
            val segment = URLEncoder.encode(shipmentId, "UTF-8").replace("+", "%20")
            val path = "/api/pod/$segment/group"
            val requestBody = Gson().toJson(payload).toByteArray(Charsets.UTF_8)
            val requestKey = IdempotencyKeyStore.begin(context, userId, "POST", path, requestBody)
            val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 15000
                connection.readTimeout = 30000
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer " + token)
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Idempotency-Key", requestKey.value)
                connection.outputStream.use { it.write(requestBody) }
                val code = connection.responseCode
                val body = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }
                IdempotencyKeyStore.finish(context, requestKey, code, body.orEmpty(),
                    connection.getHeaderField("Idempotency-Completed") == "true")
                val parsed = runCatching { Gson().fromJson(body, Map::class.java)?.entries?.associate { it.key.toString() to it.value } }.getOrNull()
                    ?: emptyMap()
                check(code in 200..299 && parsed["success"] == true) { "POD group was not saved. Check connection and retry." }
                parsed
            } finally {
                connection.disconnect()
            }
        }
    }

    suspend fun update(context: Context, shipmentId: String, obdNumber: String, payload: Map<String, Any?>) {
        val session = SessionManager(context)
        val userId = session.getDriverId() ?: error("Please sign in again")
        val token = session.getAuthToken() ?: error("Please sign in again")
        withContext(Dispatchers.IO) {
            check(session.getDriverId() == userId) { "Account changed. Please retry" }
            fun segment(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
            val path = "/api/pod/" + segment(shipmentId) + "/" + segment(obdNumber)
            val requestBody = Gson().toJson(payload).toByteArray(Charsets.UTF_8)
            val requestKey = IdempotencyKeyStore.begin(context, userId, "POST", path, requestBody)
            val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer " + token)
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Idempotency-Key", requestKey.value)
                connection.outputStream.use { it.write(requestBody) }
                val code = connection.responseCode
                val body = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }
                IdempotencyKeyStore.finish(context, requestKey, code, body.orEmpty(),
                    connection.getHeaderField("Idempotency-Completed") == "true")
                val success = runCatching { Gson().fromJson(body, Map::class.java)["success"] == true }.getOrDefault(false)
                check(code in 200..299 && success) { "POD was not saved. Check connection and retry." }
            } finally {
                connection.disconnect()
            }
        }
    }

    private fun readLimited(input: InputStream, maximumChars: Int): String {
        val reader = input.bufferedReader(Charsets.UTF_8)
        val text = StringBuilder()
        val buffer = CharArray(4096)
        while (true) {
            val count = reader.read(buffer)
            if (count < 0) return text.toString()
            if (text.length + count > maximumChars) throw IllegalStateException("POD response is too large")
            text.append(buffer, 0, count)
        }
    }

    private const val MAX_RESPONSE_CHARS = 1_100_000
}
