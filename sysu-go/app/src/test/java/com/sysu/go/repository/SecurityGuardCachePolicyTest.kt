package com.sysu.go.repository

import com.google.gson.Gson
import com.sysu.go.model.SecurityGuard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurityGuardCachePolicyTest {
    private val gson = Gson()
    private val guards = listOf(SecurityGuard("G-1", "Sam", "A", "Driver", "Sam A Driver"))

    @Test
    fun cacheIsAccountScopedAndRoundTripsTimestampedGuardData() {
        val json = SecurityGuardCachePolicy.encode(guards, gson, 10_000)!!

        assertEquals("security_guards_v1.driver-a", SecurityGuardCachePolicy.keyForAccount("driver-a"))
        assertNull(SecurityGuardCachePolicy.keyForAccount("driver/a"))
        assertEquals(CachedSecurityGuards(guards, 10_000), SecurityGuardCachePolicy.decode(json, gson, 11_000))
    }

    @Test
    fun rejectsExpiredFutureMalformedAndOversizedSnapshots() {
        val json = SecurityGuardCachePolicy.encode(guards, gson, 10_000)!!

        assertNull(SecurityGuardCachePolicy.decode(json, gson, 10_000 + SecurityGuardCachePolicy.MAX_AGE_MILLIS + 1))
        assertNull(SecurityGuardCachePolicy.decode(json, gson, 9_999))
        assertNull(SecurityGuardCachePolicy.decode("not-json", gson, 11_000))
        assertNull(SecurityGuardCachePolicy.decode(" ".repeat(256 * 1024 + 1), gson, 11_000))
    }

    @Test
    fun acceptsAConfirmedEmptySnapshotButRejectsMalformedRows() {
        assertEquals(emptyList<SecurityGuard>(), SecurityGuardCachePolicy.parseRealtime(emptyList<Any>()))
        assertNull(SecurityGuardCachePolicy.parseRealtime(listOf(mapOf("guardId" to "G-1"))))
        assertTrue(SecurityGuardCachePolicy.parseRealtime(listOf(
            mapOf("guardId" to "G-1", "firstName" to "Sam", "lastName" to "Driver", "active" to false),
        ))!!.isEmpty())
    }
}
