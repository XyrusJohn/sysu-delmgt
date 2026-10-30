package com.sysu.go.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ProfileAssignmentPolicyTest {
    @Test fun assignmentSummaryExcludesCompletedRows() {
        val rows = listOf(
            mapOf("tripStatus" to "assigned"),
            mapOf("tripStatus" to "completed", "completedAt" to mapOf("\$timestamp" to 1_700_000_000_000L)),
        )
        assertEquals(1, ProfileAssignmentPolicy.activeCount(rows))
    }

    @Test fun historyReturnsNewestTenCompletedRowsWithTimestampShapes() {
        val rows = (0L..11L).map { mapOf("tripStatus" to "completed", "completedAt" to mapOf("\$timestamp" to it)) } +
            mapOf("tripStatus" to "completed")
        val history = ProfileAssignmentPolicy.completed(rows)
        assertEquals(10, history.size)
        assertEquals(11L, ProfileAssignmentPolicy.timestampMillis(history.first()["completedAt"]))
        assertEquals(2L, ProfileAssignmentPolicy.timestampMillis(history.last()["completedAt"]))
    }
}
