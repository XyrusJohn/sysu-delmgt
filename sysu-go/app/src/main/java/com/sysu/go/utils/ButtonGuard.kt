package com.sysu.go.utils

/**
 * Lightweight per-key click guard: prevents rapid double-taps on action buttons.
 *
 * Usage:
 *   button.setOnClickListener {
 *       if (!ButtonGuard.allow("unload:6051569270")) return@setOnClickListener
 *       // … action
 *   }
 *
 * Cooldown defaults to 3 seconds. Each key is independently tracked so different
 * OBD rows don't block each other.
 */
object ButtonGuard {
    private const val DEFAULT_COOLDOWN_MS = 3000L
    private val lastAllowed = mutableMapOf<String, Long>()

    /**
     * Returns true if [key] hasn't been allowed within the cooldown window,
     * then records the current timestamp. Returns false if still cooling.
     */
    @Synchronized
    fun allow(key: String, cooldownMs: Long = DEFAULT_COOLDOWN_MS): Boolean {
        val now = System.currentTimeMillis()
        val last = lastAllowed[key] ?: 0L
        if (now - last < cooldownMs) return false
        lastAllowed[key] = now
        return true
    }

    /** Clear all tracked keys (e.g. on Activity destroy). */
    @Synchronized
    fun clear() {
        lastAllowed.clear()
    }
}