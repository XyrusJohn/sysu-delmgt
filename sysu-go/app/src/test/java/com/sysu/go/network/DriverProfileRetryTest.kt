package com.sysu.go.network

import java.io.IOException
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DriverProfileRetryTest {
    @Test
    fun retriesOneTimedOutReadAndReturnsTheRecovery() {
        var attempts = 0
        var waits = 0

        val result = retryReadOnceAfterTimeout(
            request = {
                attempts++
                if (attempts == 1) throw SocketTimeoutException("first attempt")
                "profile"
            },
            waitBeforeRetry = { waits++ },
        )

        assertEquals("profile", result)
        assertEquals(2, attempts)
        assertEquals(1, waits)
    }

    @Test
    fun doesNotRetryNonTimeoutFailures() {
        var attempts = 0

        val thrown = assertThrows(IOException::class.java) {
            retryReadOnceAfterTimeout<String>(
                request = {
                    attempts++
                    throw IOException("server rejected request")
                },
                waitBeforeRetry = { error("must not wait") },
            )
        }

        assertEquals("server rejected request", thrown.message)
        assertEquals(1, attempts)
    }

    @Test
    fun propagatesASecondTimeoutWithTheFirstAttemptAttached() {
        var attempts = 0

        val thrown = assertThrows(SocketTimeoutException::class.java) {
            retryReadOnceAfterTimeout<String>(
                request = {
                    attempts++
                    throw SocketTimeoutException("attempt $attempts")
                },
                waitBeforeRetry = {},
            )
        }

        assertEquals(2, attempts)
        assertTrue(thrown.suppressed.single() is SocketTimeoutException)
    }
}
