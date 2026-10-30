package com.sysu.go

import org.junit.Test

import org.junit.Assert.*

/**
 * Example local unit test, which will execute on the development machine (host).
 *
 * See [testing documentation](http://d.android.com/tools/testing).
 */
class ExampleUnitTest {
    @Test
    fun addition_isCorrect() {
        assertEquals(4, 2 + 2)
    }

    @Test
    fun testQueuePositionRanking_fourDrivers() {
        data class QueueDoc(val id: String, val truckType: String, val timestampSeconds: Long)

        val targetTruckType = "AUV"
        val driverDocs = listOf(
            QueueDoc("driver-A", "AUV", 100L),
            QueueDoc("driver-B", "AUV", 200L),
            QueueDoc("driver-C", "AUV", 300L),
            QueueDoc("driver-D", "AUV", 400L)
        )

        // Same matching & sorting logic as MainActivity.kt and QueueDetailsActivity.kt
        val queueList = driverDocs.filter { it.truckType.equals(targetTruckType, ignoreCase = true) }
            .sortedWith(compareBy({ it.timestampSeconds }, { it.id }))

        val posA = queueList.indexOfFirst { it.id == "driver-A" } + 1
        val posB = queueList.indexOfFirst { it.id == "driver-B" } + 1
        val posC = queueList.indexOfFirst { it.id == "driver-C" } + 1
        val posD = queueList.indexOfFirst { it.id == "driver-D" } + 1

        assertEquals(1, posA)
        assertEquals(2, posB)
        assertEquals(3, posC)
        assertEquals(4, posD)
    }
}