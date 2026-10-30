package com.sysu.go.model

internal object QueueShipmentPolicy {
    fun isCurrentShipment(
        tripStatus: String?,
        returnStatus: String?,
        shipmentQueueId: String?,
        currentQueueId: String?,
        queueStatus: String?,
        assignedAtMillis: Long? = null,
        queueEnteredAtMillis: Long? = null
    ): Boolean {
        if (returnStatus == "completed" || tripStatus in listOf("cancelled", "canceled")) return false
        val terminal = tripStatus in listOf("completed", "delivered")
        if (currentQueueId.isNullOrBlank()) {
            return !terminal || returnStatus in listOf("returning_to_base", "arrived_at_base")
        }
        if (!shipmentQueueId.isNullOrBlank()) {
            if (shipmentQueueId != currentQueueId) return false
            return !terminal || queueStatus !in listOf("waiting", "called")
        }
        //  Legacy records need evidence that the assignment belongs to this admission.
        if (queueStatus in listOf("waiting", "called")) return false
        if (assignedAtMillis != null && queueEnteredAtMillis != null) {
            return assignedAtMillis >= queueEnteredAtMillis
        }
        return !terminal
    }
}
