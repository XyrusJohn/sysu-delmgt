package com.sysu.go.network

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.sysu.go.BuildConfig
import com.sysu.go.utils.SessionManager
import java.net.HttpURLConnection
import java.net.URL

object TripApiService {
    private const val BASE_URL = BuildConfig.API_BASE_URL + "/api/trip"
    private val gson = Gson()

    sealed class Result<out T> {
        data class Success<T>(val data: T) : Result<T>()
        data class Error(val code: Int, val message: String) : Result<Nothing>()
    }

    data class TripRegisterRequest(
        val queueId: String,
        val helperFN: String,
        val helperMI: String,
        val helperLN: String,
        @SerializedName("company")
        val company: String,
        @SerializedName("truckType")
        val truckType: String,
        @SerializedName("platePrefix")
        val platePrefix: String,
        @SerializedName("plateSuffix")
        val plateSuffix: String,
        @SerializedName("driverPhone")
        val driverPhone: String? = null
    )

    data class TripRegisterResponse(
        val success: Boolean,
        val message: String?,
        @SerializedName("tripId")
        val tripId: String?
    )

    private const val TAG = "TripApiService"

    fun registerTrip(context: Context, request: TripRegisterRequest, idToken: String? = null): Result<TripRegisterResponse> {
        return try {
            val urlString = "$BASE_URL/register"
            Log.d(TAG, "Sending trip registration")
            val accountId = SessionManager(context).getDriverId()?.takeIf(String::isNotBlank)
                ?: return Result.Error(401, "Please sign in again")
            val jsonBody = gson.toJson(request)
            val payload = jsonBody.toByteArray(Charsets.UTF_8)
            val path = "/api/trip/register"
            val requestKey = IdempotencyKeyStore.begin(context, accountId, "POST", path, payload)
            val url = URL(urlString)
            val conn = url.openConnection() as HttpURLConnection
            try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Idempotency-Key", requestKey.value)
            if (!idToken.isNullOrBlank()) {
                conn.setRequestProperty("Authorization", "Bearer $idToken")
            }
            conn.connectTimeout = 15000
            conn.readTimeout = 15000

            conn.outputStream.use { it.write(payload) }

            val responseCode = conn.responseCode
            val inputStream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
            val body = inputStream?.bufferedReader()?.readText() ?: "{}"
            IdempotencyKeyStore.finish(context, requestKey, responseCode, body,
                conn.getHeaderField("Idempotency-Completed") == "true")

            Log.d(TAG, "Registration HTTP status: $responseCode")

            val parsed = gson.fromJson(body, TripRegisterResponse::class.java)

            if (responseCode == 200 && parsed.success) {
                Log.d(TAG, "Trip registration confirmed")
                Result.Success(parsed)
            } else {
                Log.w(TAG, "registerTrip FAILED ($responseCode): ${parsed.message}")
                Result.Error(responseCode, parsed.message ?: "Trip registration failed (Code: $responseCode)")
            }
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "registerTrip error: ${e.message}", e)
            Result.Error(-1, "Network error: ${e.javaClass.simpleName} - ${e.message}")
        }
    }
}
