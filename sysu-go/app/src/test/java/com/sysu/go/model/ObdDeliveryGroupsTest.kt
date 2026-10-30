package com.sysu.go.model

import org.junit.Assert.assertEquals
import org.junit.Test

class ObdDeliveryGroupsTest {
    private fun item(
        obd: String,
        shipTo: String = "0010002870",
        address: String = "Ca Road DagatDagatan",
        latitude: Double? = 14.6628,
        quantity: String = "7.000",
        completed: Boolean = false,
        unloadStatus: String? = null
    ) = mapOf<String, Any?>(
        "obdNumber" to obd,
        "shipTo" to shipTo,
        "customerName" to "Robinsons Supermarket - Malabon",
        "deliveryAddress" to address,
        "latitude" to latitude,
        "longitude" to 120.9578,
        "volume" to "0.045",
        "weight" to 21.36,
        "quantity" to quantity,
        "isPodCompleted" to completed,
        "unloadStatus" to unloadStatus
    )

    @Test fun `same complete destination is grouped and metrics are summed`() {
        val groups = ObdDeliveryGroups.group(listOf(item("OBD-A"), item("OBD-B", address = " Ca   Road DagatDagatan ")))

        assertEquals(1, groups.size)
        assertEquals(listOf("OBD-A", "OBD-B"), groups.single().obdNumbers)
        assertEquals(0.09, groups.single().volume, 0.000001)
        assertEquals(42.72, groups.single().weight, 0.000001)
        assertEquals(14.0, groups.single().quantity, 0.000001)
    }

    @Test fun `different destination identity stays separate`() {
        val groups = ObdDeliveryGroups.group(listOf(item("OBD-A"), item("OBD-B", shipTo = "OTHER")))

        assertEquals(2, groups.size)
    }

    @Test fun `missing required destination identity never merges rows`() {
        val groups = ObdDeliveryGroups.group(listOf(item("OBD-A", latitude = null), item("OBD-B", latitude = null)))

        assertEquals(2, groups.size)
    }

    @Test fun `completed OBD is preserved while pending group IDs remain actionable`() {
        val group = ObdDeliveryGroups.group(listOf(item("OBD-A", completed = true), item("OBD-B", unloadStatus = "UNLOADING"))).single()

        assertEquals(listOf("OBD-A", "OBD-B"), group.obdNumbers)
        assertEquals(listOf("OBD-B"), group.pendingObdNumbers)
        assertEquals(false, group.allPendingComplete)
        assertEquals(true, group.allPendingUnloading)
    }

    @Test fun `duplicate OBD rows count in totals but action targets unique OBD`() {
        val group = ObdDeliveryGroups.group(listOf(item("OBD-A"), item("OBD-A", quantity = "5.000"))).single()

        assertEquals(1, group.obdNumbers.size)
        assertEquals(12.0, group.quantity, 0.000001)
    }
}
