package com.sysu.go.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

class MysqlAuthClientTest {
    @Test
    fun rateLimitedRegistrationShowsRetryGuidance() {
        val client = MysqlAuthClient("http://192.168.100.4:3001") { url -> RateLimitedConnection(url) }

        val error = try {
            client.register("new.driver", "12345678", mapOf("name" to "New Driver"))
            throw AssertionError("Expected registration to be rate limited")
        } catch (expected: MysqlAuthException) {
            expected
        }

        assertEquals(429, error.httpStatus)
        assertTrue(error.message.orEmpty().contains("Wait a while"))
    }

    private class RateLimitedConnection(url: URL) : HttpURLConnection(url) {
        private val requestBody = ByteArrayOutputStream()

        override fun connect() = Unit
        override fun disconnect() = Unit
        override fun usingProxy() = false
        override fun getResponseCode() = 429
        override fun getOutputStream(): OutputStream = requestBody
        override fun getErrorStream() = ByteArrayInputStream("Too many requests".toByteArray())
    }
}
