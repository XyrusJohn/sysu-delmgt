package com.sysu.go.diagnostics

import java.io.IOException
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Test

class DiagnosticsFailurePolicyTest {
    @Test
    fun persistenceResponsesMapToActionableFailureCodes() {
        assertEquals("SESSION_EXPIRED", diagnosticsPersistenceFailureCode(401))
        assertEquals("ACCOUNT_NOT_ALLOWED", diagnosticsPersistenceFailureCode(403))
        assertEquals("RATE_LIMITED", diagnosticsPersistenceFailureCode(429))
        assertEquals("INVALID_DIAGNOSTICS", diagnosticsPersistenceFailureCode(400))
        assertEquals("SERVER_UNAVAILABLE", diagnosticsPersistenceFailureCode(503))
        assertEquals("REPORT_NOT_SAVED", diagnosticsPersistenceFailureCode(404))
    }

    @Test
    fun networkFailuresDistinguishUnsafeConfigurationTimeoutAndOffline() {
        assertEquals(
            "UNSAFE_API_CONFIGURATION",
            diagnosticsNetworkFailureCode(IOException("Unsafe diagnostics API URL"), "NETWORK_TIMEOUT")
        )
        assertEquals(
            "NETWORK_TIMEOUT",
            diagnosticsNetworkFailureCode(SocketTimeoutException(), "NETWORK_TIMEOUT")
        )
        assertEquals("API_REQUEST_FAILED", diagnosticsNetworkFailureCode(IOException("offline"), "NETWORK_TIMEOUT"))
        assertEquals("API_HOST_NOT_FOUND", diagnosticsNetworkFailureCode(java.net.UnknownHostException(), "NETWORK_TIMEOUT"))
        assertEquals("API_CONNECTION_FAILED", diagnosticsNetworkFailureCode(java.net.ConnectException(), "NETWORK_TIMEOUT"))
        assertEquals("NETWORK_UNREACHABLE", diagnosticsNetworkFailureCode(java.net.SocketException("Network is unreachable"), "NETWORK_TIMEOUT"))
        assertEquals("SECURE_CONNECTION_FAILED", diagnosticsNetworkFailureCode(javax.net.ssl.SSLException("certificate"), "NETWORK_TIMEOUT"))
        assertEquals("REPORT_NOT_SAVED", diagnosticsNetworkFailureCode(IllegalStateException(), "NETWORK_TIMEOUT"))
    }

    @Test
    fun apiHealthTimeoutUsesHealthSpecificCode() {
        assertEquals(
            "HEALTH_CHECK_TIMEOUT",
            diagnosticsNetworkFailureCode(SocketTimeoutException(), "HEALTH_CHECK_TIMEOUT")
        )
    }
}
