package com.sysu.go.model

internal class LocationSendPolicy {
    companion object {
        fun canCheckpoint(uid: String, owner: String?, status: String?): Boolean = uid == owner &&
            status in setOf("assigned", "loading", "loaded", "fully_loaded", "in_transit", "returning_to_base")
    }
    data class Fix(val lat: Double, val lng: Double, val accuracy: Float, val elapsedMs: Long)
    private var lastSent: Fix? = null
    private var lastSendMs: Long? = null
    private var lastMovementMs: Long? = null
    private var tripKey: String? = null

    fun reset(key: String? = null) {
        lastSent = null
        lastSendMs = null
        lastMovementMs = null
        tripKey = key
    }

    fun eligible(fix: Fix, nowMs: Long): Boolean = fix.lat.isFinite() && fix.lng.isFinite() &&
        fix.lat in -90.0..90.0 && fix.lng in -180.0..180.0 && fix.accuracy.isFinite() &&
        fix.accuracy in 0f..50f && nowMs - fix.elapsedMs in 0..15_000

    fun shouldSend(fix: Fix, nowMs: Long, distanceMeters: Float, key: String, connected: Boolean): Boolean {
        if (tripKey != key) reset(key)
        if (!connected || !eligible(fix, nowMs)) return false
        val last = lastSendMs ?: return true
        val interval = if (distanceMeters >= 10f) 5_000 else 30_000
        return nowMs - last >= interval
    }

    fun sent(fix: Fix, nowMs: Long, distanceMeters: Float) {
        if (lastSent == null || distanceMeters >= 10f) lastMovementMs = nowMs
        lastSent = fix
        lastSendMs = nowMs
    }

    fun isStopped(nowMs: Long): Boolean = lastMovementMs?.let { nowMs - it >= 60_000 } ?: false
}
