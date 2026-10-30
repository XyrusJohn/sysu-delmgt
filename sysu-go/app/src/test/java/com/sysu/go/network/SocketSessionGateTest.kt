package com.sysu.go.network
import org.junit.Assert.*
import org.junit.Test

class SocketSessionGateTest {
    @Test fun logoutDiscardsPendingTokenAndReconnect() {
        val gate = SocketSessionGate()
        val pending = gate.begin("driver-a")
        gate.invalidate()
        assertFalse(gate.isCurrent(pending, "driver-a"))
    }
    @Test fun accountSwitchRejectsPreviousUsersToken() {
        val gate = SocketSessionGate()
        val pending = gate.begin("driver-a")
        assertFalse(gate.isCurrent(pending, "driver-b"))
        assertFalse(gate.isCurrent(pending, null))
    }
    @Test fun replacementConnectionRejectsOldCallbacks() {
        val gate = SocketSessionGate()
        val old = gate.begin("driver-a")
        val current = gate.begin("driver-a")
        assertFalse(gate.isCurrent(old, "driver-a"))
        assertTrue(gate.isCurrent(current, "driver-a"))
    }
}
