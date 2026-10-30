package com.sysu.go.diagnostics

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

internal class PendingDiagnosticStore(private val prefs: SharedPreferences) {
    private companion object {
        const val KEY = "pending_operation_reports"
        val ACCOUNT = Regex("[A-Za-z0-9_-]{1,128}")
        val OPERATION = Regex("[a-z][a-z0-9_-]{0,47}")
        val ERROR_NAME = Regex("[A-Za-z][A-Za-z0-9_.]{0,79}")
        val EVENT_ID = Regex("[A-Fa-f0-9-]{36}")
    }

    fun read(): List<PendingDiagnosticReport> {
        val array = try { JSONArray(prefs.getString(KEY, "[]")) } catch (_: Exception) { return emptyList() }
        return (maxOf(0, array.length() - PendingDiagnosticPolicy.MAX_REPORTS) until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val accountId = item.optString("accountId")
            val operation = item.optString("operation")
            val errorName = item.optString("errorName")
            val eventId = item.optString("eventId")
            val details = item.optString("details")
            if (!ACCOUNT.matches(accountId) || !OPERATION.matches(operation) || !ERROR_NAME.matches(errorName)
                || !EVENT_ID.matches(eventId) || details.length > 1024) null
            else try {
                if (JSONObject(details).optString("clientEventId") != eventId) null
                else PendingDiagnosticReport(accountId, operation, errorName, eventId, details,
                    item.optBoolean("recovered", false), item.optBoolean("submitted", false),
                    item.optBoolean("recoveryOnly", false))
            } catch (_: Exception) { null }
        }
    }

    fun write(reports: List<PendingDiagnosticReport>): Boolean {
        val array = JSONArray()
        reports.takeLast(PendingDiagnosticPolicy.MAX_REPORTS).forEach { report ->
            array.put(JSONObject().put("accountId", report.accountId).put("operation", report.operation)
                .put("errorName", report.errorName).put("eventId", report.eventId).put("details", report.detailsJson)
                .put("recovered", report.recovered).put("submitted", report.submitted)
                .put("recoveryOnly", report.recoveryOnly))
        }
        return prefs.edit().putString(KEY, array.toString()).commit()
    }
}
