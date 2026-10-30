package com.sysu.go.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QueuePositionPolicyTest {
    private fun entry(id: String, seconds: Long, registered: Boolean = true) =
        QueuePositionPolicy.Entry(id, "AUV", "waiting", registered, false, seconds * 1000)

    @Test fun unregisteredEntriesDoNotInflateRegisteredDriverPosition() {
        val queue = listOf(entry("scan-1", 1, false), entry("scan-2", 2, false), entry("driver-3", 3))
        assertEquals(1, QueuePositionPolicy.position(queue, "driver-3", "AUV"))
        assertNull(QueuePositionPolicy.position(queue, "scan-1", "AUV"))
    }

    @Test fun successiveAssignmentsMoveThirdDriverFromThreeToTwoToOne() {
        val first = entry("driver-1", 1)
        val second = entry("driver-2", 2).copy(status = "called")
        val third = entry("driver-3", 3)
        assertEquals(3, QueuePositionPolicy.position(listOf(first, second, third), third.id, "AUV"))
        val assignedFirst = first.copy(status = "loading", isAssigned = true)
        assertEquals(1, QueuePositionPolicy.position(listOf(assignedFirst, second, third), second.id, "AUV"))
        assertEquals(2, QueuePositionPolicy.position(listOf(assignedFirst, second, third), third.id, "AUV"))
        assertEquals(1, QueuePositionPolicy.position(listOf(assignedFirst, second.copy(status = "assigned", isAssigned = true), third), third.id, "AUV"))
    }

    @Test fun assignmentFlagExcludesEntryBeforeItsStatusSnapshotChanges() {
        val assigned = entry("assigned", 1).copy(isAssigned = true)
        val waiting = entry("waiting", 2)
        assertEquals(1, QueuePositionPolicy.position(listOf(assigned, waiting), waiting.id, "AUV"))
        assertNull(QueuePositionPolicy.position(listOf(assigned, waiting), assigned.id, "AUV"))
    }

    @Test fun onlyWaitingAndCalledEntriesCount() {
        val closed = listOf("completed", "cancelled", "assigned", "loading", "loaded", "fully_loaded", "in_transit")
            .mapIndexed { index, status -> entry("closed-$index", 1).copy(status = status) }
        val called = entry("called", 2).copy(status = "called")
        val waiting = entry("waiting", 3)
        assertEquals(2, QueuePositionPolicy.position(closed + listOf(called, waiting), waiting.id, "AUV"))
    }

    @Test fun positionsAreSeparateForEachTruckGroupAndCaseInsensitive() {
        val queue = listOf(entry("other-truck", 1).copy(truckType = "4W"), entry("first", 2), entry("second", 3).copy(truckType = "auv"))
        assertEquals(2, QueuePositionPolicy.position(queue, "second", "auv"))
        assertNull(QueuePositionPolicy.position(queue, "second", "4W"))
    }

    @Test fun timestampMillisecondsAndQueueIdKeepSqlOrdering() {
        val later = entry("a", 1).copy(entryTimeMillis = 1001)
        val earlier = entry("z", 1).copy(entryTimeMillis = 1000)
        assertEquals(2, QueuePositionPolicy.position(listOf(later, earlier), "a", "AUV"))
        val tied = listOf(entry("b", 1), entry("a", 1), entry("c", 1))
        assertEquals(1, QueuePositionPolicy.position(tied, "a", "AUV"))
        assertEquals(2, QueuePositionPolicy.position(tied, "b", "AUV"))
    }

    @Test fun emptyAndRemovedSnapshotsDoNotInventPositionOne() {
        assertNull(QueuePositionPolicy.position(emptyList(), "removed", "AUV"))
        assertNull(QueuePositionPolicy.position(listOf(entry("other", 1)), "removed", "AUV"))
    }

    @Test fun missingTimestampAndUnsupportedTruckTypeDoNotEnterTheWebQueue() {
        val invalid = entry("missing-time", 1).copy(entryTimeMillis = null)
        val valid = entry("valid", 2)
        assertEquals(1, QueuePositionPolicy.position(listOf(invalid, valid), "valid", "AUV"))
        assertNull(QueuePositionPolicy.position(listOf(valid.copy(truckType = "unknown")), "valid", "unknown"))
    }
}
