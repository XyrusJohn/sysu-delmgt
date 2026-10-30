package com.sysu.go.network

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.sysu.go.BuildConfig
import com.sysu.go.config.LocalAddressPolicy
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class MysqlAuthUser(
    val id: String,
    val username: String?,
    val displayName: String?,
    val role: String,
    val status: String,
    val profile: Map<String, String> = emptyMap(),
)

data class MysqlAuthSession(val token: String, val user: MysqlAuthUser)

class MysqlAuthException(val code: String, val httpStatus: Int) : IOException(messageFor(code, httpStatus)) {
    companion object {
        private fun messageFor(code: String, status: Int): String = when (code) {
            "INVALID_CREDENTIALS" -> "Incorrect username or password."
            "ACCOUNT_DISABLED" -> "This account has been disabled. Contact an administrator."
            "ACCOUNT_EXISTS" -> "That username is already registered."
            "INVALID_USERNAME" -> "Use 3–32 characters: letters, numbers, dots, underscores, or hyphens."
            "INVALID_PASSWORD" -> "Password must contain at least 8 characters."
            "INVALID_PROFILE" -> "Please check the registration details and try again."
            "AUTH_SERVICE_UNAVAILABLE" -> "Account service is unavailable. Please try again."
            "RATE_LIMITED" -> "Too many account requests. Wait a while, then try again."
            else -> if (status == 403) "This account is not authorized." else "Unable to complete account request. Please try again."
        }
    }
}

/** Blocking HTTP transport. Call from Dispatchers.IO. */
class MysqlAuthClient(
    private val baseUrl: String = BuildConfig.API_BASE_URL,
    private val openConnection: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
) {
    private val gson = Gson()

    fun login(username: String, password: String): MysqlAuthSession =
        post("/api/auth/mysql/username/login", mapOf("username" to username, "password" to password))

    fun register(
        username: String,
        password: String,
        profile: Map<String, String>,
    ): MysqlAuthSession = post("/api/auth/mysql/username/register", mapOf(
        "username" to username,
        "password" to password,
        "displayName" to profile["name"].orEmpty(),
        "profile" to profile,
    ))

    fun logout(token: String) {
        exchange("/api/auth/mysql/logout", emptyMap<String, Any>(), token, allowError = true)
    }

    fun updateProfile(context: Context, token: String, displayName: String, profile: Map<String, String>) {
        exchange(
            "/api/auth/mysql/profile",
            mapOf("displayName" to displayName, "profile" to profile),
            token,
            method = "PUT",
            idempotencyContext = context.applicationContext,
        )
    }

    fun validateSession(token: String): Boolean {
        var connection: HttpURLConnection? = null
        try {
            val url = URL(baseUrl.trimEnd('/') + "/api/auth/mysql/session")
            val local = LocalAddressPolicy.isLocalHost(url.host)
            if (url.protocol != "https" && !(url.protocol == "http" && local)) throw IOException("Unsafe account service URL")
            connection = openConnection(url).apply {
                instanceFollowRedirects = false
                requestMethod = "GET"
                connectTimeout = 5000
                readTimeout = 5000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }
            return when (connection.responseCode) {
                401 -> false
                in 200..299 -> {
                    val response = connection.inputStream.bufferedReader(Charsets.UTF_8).use { JsonParser.parseReader(it).asJsonObject }
                    val user = response.getAsJsonObject("user") ?: return false
                    response.get("success")?.asBoolean == true
                        && user.get("role")?.asString == "driver"
                        && user.get("status")?.asString == "active"
                }
                else -> throw IOException("Account service is unavailable")
            }
        } catch (error: IOException) {
            throw error
        } catch (error: Exception) {
            throw IOException("Account service is unavailable", error)
        } finally {
            connection?.disconnect()
        }
    }

    private fun post(path: String, body: Any): MysqlAuthSession {
        val response = exchange(path, body, null)
        val token = response.get("token")?.takeIf { it.isJsonPrimitive }?.asString
            ?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{40,128}")) }
            ?: throw IOException("Invalid account service response")
        val userJson = response.getAsJsonObject("user") ?: throw IOException("Invalid account service response")
        val profile = userJson.getAsJsonObject("profile")?.entrySet()?.associate { (key, value) ->
            key to value.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString.orEmpty()
        }.orEmpty()
        val user = MysqlAuthUser(
            id = userJson.get("id")?.asString ?: throw IOException("Invalid account service response"),
            username = userJson.get("username")?.takeUnless { it.isJsonNull }?.asString,
            displayName = userJson.get("displayName")?.takeUnless { it.isJsonNull }?.asString,
            role = userJson.get("role")?.asString ?: throw IOException("Invalid account service response"),
            status = userJson.get("status")?.asString ?: throw IOException("Invalid account service response"),
            profile = profile,
        )
        return MysqlAuthSession(token, user)
    }

    private fun exchange(path: String, body: Any, bearer: String?, method: String = "POST", allowError: Boolean = false,
        idempotencyContext: Context? = null): JsonObject {
        var connection: HttpURLConnection? = null
        try {
            val url = URL(baseUrl.trimEnd('/') + path)
            val local = LocalAddressPolicy.isLocalHost(url.host)
            if (url.protocol != "https" && !(url.protocol == "http" && local)) throw IOException("Unsafe account service URL")
            connection = openConnection(url).apply {
                instanceFollowRedirects = false
                requestMethod = method
                connectTimeout = 6000
                readTimeout = 6000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Content-Type", "application/json")
                bearer?.let { setRequestProperty("Authorization", "Bearer $it") }
                doOutput = true
            }
            val bytes = gson.toJson(body).toByteArray(Charsets.UTF_8)
            if (bytes.size > 8192) throw IOException("Request is too large")
            val accountId = idempotencyContext?.let { com.sysu.go.utils.SessionManager(it).getDriverId() }
                ?.takeIf(String::isNotBlank)
            val requestKey = if (method !in setOf("GET", "HEAD", "OPTIONS") && idempotencyContext != null && accountId != null)
                IdempotencyKeyStore.begin(idempotencyContext, accountId, method, path, bytes) else null
            requestKey?.let { connection.setRequestProperty("Idempotency-Key", it.value) }
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            if (status !in 200..299) {
                if (status == 429) throw MysqlAuthException("RATE_LIMITED", status)
                val errorText = connection.errorStream?.use { stream ->
                    val output = ByteArrayOutputStream()
                    stream.copyTo(output)
                    output.toString("UTF-8")
                }.orEmpty()
                if (requestKey != null && idempotencyContext != null) IdempotencyKeyStore.finish(idempotencyContext,
                    requestKey, status, errorText, connection.getHeaderField("Idempotency-Completed") == "true")
                val error = runCatching { JsonParser.parseString(errorText).asJsonObject }.getOrNull()
                val code = error?.get("code")?.takeIf { it.isJsonPrimitive }?.asString ?: "REQUEST_FAILED"
                if (allowError) return JsonObject()
                throw MysqlAuthException(code, status)
            }
            val response = connection.inputStream.use { stream ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(2048)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 32768) throw IOException("Account service response is too large")
                    output.write(buffer, 0, count)
                }
                val responseText = output.toString("UTF-8")
                if (requestKey != null && idempotencyContext != null) IdempotencyKeyStore.finish(idempotencyContext,
                    requestKey, status, responseText, connection.getHeaderField("Idempotency-Completed") == "true")
                JsonParser.parseString(responseText).asJsonObject
            }
            if (response.get("success")?.asBoolean != true) throw IOException("Invalid account service response")
            return response
        } catch (error: MysqlAuthException) {
            throw error
        } catch (error: Exception) {
            if (error is IOException) throw error
            throw IOException("Account service is unavailable. Check your connection and try again.", error)
        } finally {
            connection?.disconnect()
        }
    }
}
