package com.sysu.go.network

import android.content.Context
import com.google.gson.JsonParser
import com.sysu.go.BuildConfig
import com.sysu.go.utils.SessionManager
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class WarehouseBase(
    val name: String,
    val lat: Double,
    val lng: Double,
    val radiusMeters: Double,
)

object WarehouseSettingsApiService {
    fun getBase(context: Context): WarehouseBase {
        val token = SessionManager(context).getAuthToken()?.takeIf(String::isNotBlank)
            ?: throw IOException("Please sign in again")
        val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/warehouse/base")
            .openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            connection.connectTimeout = 6000
            connection.readTimeout = 8000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            val status = connection.responseCode
            if (status !in 200..299) throw IOException("Warehouse settings unavailable (HTTP $status)")
            val response = connection.inputStream.bufferedReader(Charsets.UTF_8).use(JsonParser::parseReader).asJsonObject
            if (!response.get("success")?.asBoolean.orFalse()) throw IOException("Warehouse settings unavailable")
            val data = response.getAsJsonObject("data") ?: throw IOException("Warehouse settings unavailable")
            return WarehouseBase(
                name = data.get("name")?.asString?.takeIf(String::isNotBlank) ?: "SYSU Main Warehouse",
                lat = data.get("lat")?.asDouble ?: 14.6349,
                lng = data.get("lng")?.asDouble ?: 121.0392,
                radiusMeters = data.get("radiusMeters")?.asDouble?.takeIf { it >= 10 } ?: 500.0,
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun Boolean?.orFalse(): Boolean = this == true
}
