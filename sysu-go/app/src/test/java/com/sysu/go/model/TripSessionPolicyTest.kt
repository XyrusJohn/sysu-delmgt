package com.sysu.go.model

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripSessionPolicyTest {
    @Test fun keepsSessionBetweenShipmentsWhenNextShipmentIsNotInTransitYet() {
        assertTrue(TripSessionPolicy.shouldPreserve(
            tripActive = true,
            hasCurrentQueueAnchor = true,
            hasOpenShipment = true,
            allDeliveriesComplete = false
        ))
    }

    @Test fun keepsDeliveredSessionUntilReturnToBaseIsConfirmed() {
        assertTrue(TripSessionPolicy.shouldPreserve(
            tripActive = true,
            hasCurrentQueueAnchor = true,
            hasOpenShipment = false,
            allDeliveriesComplete = true
        ))
    }

    @Test fun clearsSessionWhenAnchorIsOutsideTheCurrentQueue() {
        assertFalse(TripSessionPolicy.shouldPreserve(
            tripActive = true,
            hasCurrentQueueAnchor = false,
            hasOpenShipment = true,
            allDeliveriesComplete = false
        ))
    }

    @Test fun doesNotActivateAnUnstartedQueueSession() {
        assertFalse(TripSessionPolicy.shouldPreserve(
            tripActive = false,
            hasCurrentQueueAnchor = true,
            hasOpenShipment = true,
            allDeliveriesComplete = false
        ))
    }
}
