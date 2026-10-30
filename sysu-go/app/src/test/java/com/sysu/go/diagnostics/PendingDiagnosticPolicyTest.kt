package com.sysu.go.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingDiagnosticPolicyTest {
    private fun report(account: String, operation: String, eventId: String = operation) =
        PendingDiagnosticReport(account, operation, "IOException", eventId, "{}")

    @Test fun pendingReportsAreBoundedAndRepeatedFailuresCoalesce() {
        val first = report("driver-a", "pod-save", "first")
        assertEquals(listOf(first), PendingDiagnosticPolicy.add(listOf(first), report("driver-a", "pod-save", "second")))
        val reports = (0 until 25).fold(emptyList<PendingDiagnosticReport>()) { current, index ->
            PendingDiagnosticPolicy.add(current, report("driver-a", "operation-$index"))
        }
        assertEquals(20, reports.size)
        assertEquals("operation-5", reports.first().operation)
    }

    @Test fun reportsCannotCrossAccountsAndRecoveryIsRememberedUntilDelivery() {
        val own = report("driver-a", "queue-load")
        val other = report("driver-b", "queue-load")
        val scoped = PendingDiagnosticPolicy.forAccount(listOf(own, other), "driver-a")
        assertEquals(listOf(own), scoped)
        val recovered = PendingDiagnosticPolicy.markRecovered(scoped, "driver-a", "queue-load")
        assertEquals(true, recovered.single().recovered)
        assertEquals(false, PendingDiagnosticPolicy.add(recovered, report("driver-a", "queue-load", "new-event")).single().recovered)
        val recovery = own.copy(recovered = true, submitted = true, recoveryOnly = true)
        assertEquals(true, PendingDiagnosticPolicy.add(listOf(recovery), recovery.copy(eventId = "second"))
            .single().recovered)
        assertEquals(2, PendingDiagnosticPolicy.add(listOf(recovery), own.copy(errorName = "Recovered")).size)
        assertEquals(listOf(other), PendingDiagnosticPolicy.markRecovered(listOf(other), "driver-a", "queue-load"))
        assertEquals(true, PendingDiagnosticPolicy.markSubmitted(recovered, own.eventId).single().submitted)
    }

    @Test fun transientFailuresRetryAndInvalidRequestsDoNotBlockTheQueue() {
        assertEquals(60_000L, PendingDiagnosticPolicy.retryDelayMs(null))
        assertEquals(60_000L, PendingDiagnosticPolicy.retryDelayMs(503))
        assertEquals(900_000L, PendingDiagnosticPolicy.retryDelayMs(429))
        assertEquals(60_000L, PendingDiagnosticPolicy.retryDelayMs(401))
        assertEquals(60_000L, PendingDiagnosticPolicy.retryDelayMs(403))
        assertEquals(0L, PendingDiagnosticPolicy.retryDelayMs(400))
    }
}
