package com.sysu.go.model

import java.util.Locale

internal object QueuePositionPolicy {
    data class Entry(
        val id: String,
        val truckType: String,
        val status: String,
        val registrationComplete: Boolean,
        val isAssigned: Boolean,
        val entryTimeMillis: Long?
    )

    fun position(entries: List<Entry>, queueId: String, truckType: String): Int? {
        val type = truckType.uppercase(Locale.ROOT)
        if (type !in listOf("AUV", "4W", "6W", "10W", "20F", "40F")) return null
        val queue = entries.filter {
            it.registrationComplete && !it.isAssigned && it.entryTimeMillis != null &&
                it.truckType.uppercase(Locale.ROOT) == type && it.status in listOf("waiting", "called")
        }.sortedWith(compareBy<Entry> { it.entryTimeMillis }.thenBy { it.id })
        val index = queue.indexOfFirst { it.id == queueId }
        return if (index >= 0) index + 1 else null
    }
}
