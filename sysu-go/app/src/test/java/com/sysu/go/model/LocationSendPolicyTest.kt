package com.sysu.go.model

import org.junit.Assert.*
import org.junit.Test

class LocationSendPolicyTest {
    @Test fun checkpointAllowsOwnedActiveAndReturningTrips() {
        for (status in listOf("assigned", "loading", "loaded", "fully_loaded", "in_transit", "returning_to_base"))
            assertTrue(LocationSendPolicy.canCheckpoint("a", "a", status))
    }
    @Test fun checkpointRejectsClosedMissingAndForeignTrips() {
        for (status in listOf("completed", "cancelled", "unknown", null))
            assertFalse(LocationSendPolicy.canCheckpoint("a", "a", status))
        assertFalse(LocationSendPolicy.canCheckpoint("a", "b", "in_transit"))
        assertFalse(LocationSendPolicy.canCheckpoint("a", null, "in_transit"))
    }
    private fun fix(at: Long = 100_000, accuracy: Float = 10f) = LocationSendPolicy.Fix(14.5, 121.0, accuracy, at)
    @Test fun firstStationaryFixSendsImmediately() {
        assertTrue(LocationSendPolicy().shouldSend(fix(), 100_000, 0f, "a", true))
    }
    @Test fun movingCadenceIsFiveSeconds() {
        val p = LocationSendPolicy(); p.shouldSend(fix(), 100_000, 0f, "a", true); p.sent(fix(), 100_000, 0f)
        assertFalse(p.shouldSend(fix(104_999), 104_999, 20f, "a", true))
        assertTrue(p.shouldSend(fix(105_000), 105_000, 20f, "a", true))
    }
    @Test fun stationaryFixRefreshesAtThirtySeconds() {
        val p = LocationSendPolicy(); p.shouldSend(fix(), 100_000, 0f, "a", true); p.sent(fix(), 100_000, 0f)
        assertFalse(p.shouldSend(fix(129_999), 129_999, 0f, "a", true))
        assertTrue(p.shouldSend(fix(130_000), 130_000, 0f, "a", true))
    }
    @Test fun disconnectedAndFailedSendsDoNotConsumeBudget() {
        val p = LocationSendPolicy()
        assertFalse(p.shouldSend(fix(), 100_000, 0f, "a", false))
        assertTrue(p.shouldSend(fix(), 100_000, 0f, "a", true))
        assertTrue(p.shouldSend(fix(100_001), 100_001, 0f, "a", true))
    }
    @Test fun invalidOldAndInaccurateFixesAreRejected() {
        val p = LocationSendPolicy()
        for (f in listOf(fix(84_999), fix(100_001), fix(100_000, 51f), fix(100_000, Float.NaN),
            fix().copy(lat = Double.NaN), fix().copy(lat = 91.0), fix().copy(lng = 181.0))) assertFalse(p.eligible(f, 100_000))
        assertTrue(p.eligible(fix(85_000), 100_000))
    }
    @Test fun newTripClearsPreviousThrottle() {
        val p = LocationSendPolicy(); p.shouldSend(fix(), 100_000, 0f, "a", true); p.sent(fix(), 100_000, 0f)
        assertTrue(p.shouldSend(fix(100_001), 100_001, 0f, "b", true))
    }
    @Test fun stationaryRefreshDoesNotResetStoppedClock() {
        val p = LocationSendPolicy(); p.sent(fix(), 100_000, 0f); p.sent(fix(130_000), 130_000, 0f)
        assertFalse(p.isStopped(159_999)); assertTrue(p.isStopped(160_000))
        p.sent(fix(165_000), 165_000, 20f); assertFalse(p.isStopped(165_000))
    }
    @Test fun logoutResetAllowsNextValidFix() {
        val p = LocationSendPolicy(); p.sent(fix(), 100_000, 0f); p.reset()
        assertTrue(p.shouldSend(fix(100_001), 100_001, 0f, "a", true)); assertFalse(p.isStopped(170_000))
    }
}
