package com.sysu.go.diagnostics

internal data class PendingDiagnosticReport(
    val accountId: String,
    val operation: String,
    val errorName: String,
    val eventId: String,
    val detailsJson: String,
    val recovered: Boolean = false,
    val submitted: Boolean = false,
    val recoveryOnly: Boolean = false,
)

internal object PendingDiagnosticPolicy {
    const val MAX_REPORTS = 20

    fun add(reports: List<PendingDiagnosticReport>, report: PendingDiagnosticReport): List<PendingDiagnosticReport> {
        if (reports.any { it.accountId == report.accountId && it.operation == report.operation
                && it.errorName == report.errorName && it.recoveryOnly == report.recoveryOnly }) {
            return reports.map { existing ->
                if (existing.accountId == report.accountId && existing.operation == report.operation
                    && existing.errorName == report.errorName && existing.recoveryOnly == report.recoveryOnly)
                    existing.copy(recovered = report.recovered) else existing
            }
        }
        return (reports + report).takeLast(MAX_REPORTS)
    }

    fun forAccount(reports: List<PendingDiagnosticReport>, accountId: String): List<PendingDiagnosticReport> =
        reports.filter { it.accountId == accountId }

    fun markRecovered(reports: List<PendingDiagnosticReport>, accountId: String, operation: String): List<PendingDiagnosticReport> =
        reports.map { if (it.accountId == accountId && it.operation == operation) it.copy(recovered = true) else it }

    fun markSubmitted(reports: List<PendingDiagnosticReport>, eventId: String): List<PendingDiagnosticReport> =
        reports.map { if (it.eventId == eventId) it.copy(submitted = true) else it }

    fun retryDelayMs(status: Int?): Long? = when {
        status == null || status == 408 || status == 401 || status == 403 || status >= 500 -> 60_000L
        status == 429 -> 15 * 60_000L
        else -> 0L
    }
}
