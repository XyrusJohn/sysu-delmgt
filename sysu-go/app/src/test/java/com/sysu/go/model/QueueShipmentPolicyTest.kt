package com.sysu.go.model

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueShipmentPolicyTest {
    @Test fun previousCompletedShipmentWithoutReturnStatusStaysOutOfNewQueue() {
        assertFalse(QueueShipmentPolicy.isCurrentShipment("completed", null, "old", "new", "waiting"))
    }

    @Test fun previousActiveShipmentCannotAttachToNewQueue() {
        assertFalse(QueueShipmentPolicy.isCurrentShipment("loading", null, "old", "new", "waiting"))
    }

    @Test fun currentAssignmentArrivesEvenBeforeQueueStatusSnapshot() {
        assertTrue(QueueShipmentPolicy.isCurrentShipment("assigned", null, "new", "new", "waiting"))
    }

    @Test fun currentDeliveryRemainsAvailableForReturnUntilArrival() {
        assertTrue(QueueShipmentPolicy.isCurrentShipment("completed", null, "current", "current", "in_transit"))
        assertTrue(QueueShipmentPolicy.isCurrentShipment("completed", "returning_to_base", "current", "current", "in_transit"))
        assertFalse(QueueShipmentPolicy.isCurrentShipment("completed", "completed", "current", "current", "in_transit"))
    }

    @Test fun completedHistoryIsHiddenWithoutAnActiveQueue() {
        assertFalse(QueueShipmentPolicy.isCurrentShipment("completed", null, null, null, null))
        assertFalse(QueueShipmentPolicy.isCurrentShipment("delivered", "completed", null, null, null))
    }

    @Test fun explicitReturnRemainsAvailableWithoutAQueue() {
        assertTrue(QueueShipmentPolicy.isCurrentShipment("completed", "arrived_at_base", null, null, null))
        assertTrue(QueueShipmentPolicy.isCurrentShipment("returning_to_base", null, null, null, null))
    }

    @Test fun unlinkedLegacyShipmentNeedsCurrentTripEvidence() {
        assertFalse(QueueShipmentPolicy.isCurrentShipment("loading", null, null, "new", "waiting", 100, 200))
        assertTrue(QueueShipmentPolicy.isCurrentShipment("loading", null, null, "new", "loading", 300, 200))
        assertFalse(QueueShipmentPolicy.isCurrentShipment("completed", null, null, "new", "loading", 100, 200))
    }

    @Test fun closedReturnAndCancelledShipmentsNeverAppearAsWork() {
        assertFalse(QueueShipmentPolicy.isCurrentShipment("loading", "completed", "new", "new", "loading"))
        assertFalse(QueueShipmentPolicy.isCurrentShipment("cancelled", null, "new", "new", "loading"))
    }
}
