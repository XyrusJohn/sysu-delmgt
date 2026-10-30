package com.sysu.go.model

internal object TripSessionPolicy {
    fun shouldPreserve(
        tripActive: Boolean,
        hasCurrentQueueAnchor: Boolean,
        hasOpenShipment: Boolean,
        allDeliveriesComplete: Boolean
    ): Boolean = tripActive && hasCurrentQueueAnchor && (hasOpenShipment || allDeliveriesComplete)
}
