package com.sysu.go.network

import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class TripReturnErrorMessageTest {
    @Test
    fun staleGpsErrorDoesNotBlameInternet() {
        val message = tripReturnErrorMessage("arrived", 409, "LOCATION_STALE")
        assertTrue(message.contains("GPS"))
        assertFalse(message.contains("internet"))
    }

    @Test
    fun outsideGeofenceErrorExplainsWarehouseDistance() {
        val message = tripReturnErrorMessage("arrived", 409, "OUTSIDE_GEOFENCE")
        assertTrue(message.contains("arrival area"))
    }

    @Test
    fun unknownConflictsExplainStateRefresh() {
        val message = tripReturnErrorMessage("arrived", 409, "UNKNOWN_CONFLICT")
        assertTrue(message.contains("GPS"))
        assertTrue(message.contains("subukan ulit"))
    }
}
