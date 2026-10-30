package com.sysu.go.network
import org.junit.Test
import org.junit.Assert.*
import com.sysu.go.model.ScanRequest
import java.net.HttpURLConnection
import java.net.URL
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException

class QrHttpClientTest {
    @Test fun unauthorizedUsesForcedProviderOnlyOnce() {
        var cachedCalls = 0
        var refreshCalls = 0
        var requests = 0
        val denied = Connection(401, "{}")
        val accepted = Connection(200, "{\"success\":true,\"queueId\":\"queue-a\"}")
        val client = QrHttpClient("https://synthetic.invalid/api/qr",
            { cachedCalls++; "cached-token" },
            { if (requests++ == 0) denied else accepted },
            { refreshCalls++; "fresh-token" })
        assertTrue(client.scanToken(request) is QrResult.Success)
        assertEquals(1, cachedCalls)
        assertEquals(1, refreshCalls)
        assertEquals(2, requests)
        assertEquals("Bearer fresh-token", accepted.getRequestProperty("Authorization"))
        assertArrayEquals(denied.sent.toByteArray(), accepted.sent.toByteArray())
    }

    @Test fun secondUnauthorizedCannotRetryForever() {
        var requests = 0
        var refreshCalls = 0
        val client = QrHttpClient("https://synthetic.invalid/api/qr", { "cached-token" },
            { requests++; Connection(401, "{}") }, { refreshCalls++; "fresh-token" })
        assertEquals(401, (client.scanToken(request) as QrResult.Error).code)
        assertEquals(2, requests)
        assertEquals(1, refreshCalls)
    }

    @Test fun unavailableRefreshCannotSendAnotherAdmission() {
        for (throws in listOf(false, true)) {
            var requests = 0
            val client = QrHttpClient("https://synthetic.invalid/api/qr", { "cached-token" },
                { requests++; Connection(401, "{}") },
                { if (throws) throw IllegalStateException("private details") else null })
            val result = client.scanToken(request) as QrResult.Error
            assertEquals(401, result.code)
            assertEquals(1, requests)
            assertFalse(result.message.contains("private"))
        }
    }

    @Test fun unauthorizedAdmissionRefreshesIdentityAndRetriesOnce() {
        val denied = Connection(401, "{}")
        val accepted = Connection(200, "{\"success\":true,\"queueId\":\"queue-a\",\"queuePosition\":2}")
        var requests = 0
        var tokens = 0
        val client = QrHttpClient("https://synthetic.invalid/api/qr",
            { if (tokens++ == 0) "stale-token" else "refreshed-token" },
            { if (requests++ == 0) denied else accepted })

        assertTrue(client.scanToken(request) is QrResult.Success)
        assertEquals(2, requests)
        assertEquals("Bearer refreshed-token", accepted.getRequestProperty("Authorization"))
        assertTrue(denied.closed)
        assertTrue(accepted.closed)
    }
    @Test fun nonAuthenticationErrorsDoNotRetryAdmission() {
        for (status in listOf(403, 409, 410, 500)) {
            var requests = 0
            val denied = Connection(status, "private details")
            val client = QrHttpClient("https://synthetic.invalid/api/qr", { "token" },
                { requests++; denied })
            assertEquals(status, (client.scanToken(request) as QrResult.Error).code)
            assertEquals(1, requests)
            assertTrue(denied.closed)
        }
    }
    private val request = ScanRequest("SYS-TEST", "driver-a", "Driver", "Driver", "", "Test", "AUV", "Synthetic", "ABC-123", "Helper")
    private class Connection(val status: Int, val body: String): HttpURLConnection(URL("https://synthetic.invalid")) {
        val sent=ByteArrayOutputStream()
        var closed=false
        override fun connect() {}
        override fun usingProxy()=false
        override fun disconnect() {closed=true}
        override fun getResponseCode()=status
        override fun getInputStream()=ByteArrayInputStream(body.toByteArray())
        override fun getErrorStream()=ByteArrayInputStream(body.toByteArray())
        override fun getOutputStream()=sent
    }
    @Test fun scanSendsBearerAndOwnedPayload() {
        val c=Connection(200,"{\"success\":true,\"queueId\":\"queue-a\",\"queuePosition\":2}")
        val client=QrHttpClient("https://synthetic.invalid/api/qr",{"current-token"},{c})
        val result=client.scanToken(request) as QrResult.Success
        assertEquals("queue-a",result.data.queueId);assertEquals(2,result.data.queuePosition)
        assertEquals("POST",c.requestMethod);assertEquals("Bearer current-token",c.getRequestProperty("Authorization"))
        assertTrue(c.sent.toString().contains("driver-a"));assertTrue(c.closed)
    }
    @Test fun missingIdentityMakesNoRequest() {
        var calls=0;val client=QrHttpClient("https://synthetic.invalid/api/qr",{null},{calls++;Connection(200,"{}")})
        assertEquals(401,(client.scanToken(request) as QrResult.Error).code);assertEquals(0,calls)
    }
    @Test fun networkFailureCannotCreateOfflineQueueOrRetryMutation() {
        var calls=0;val client=QrHttpClient("https://synthetic.invalid/api/qr",{"token"},{calls++;throw IOException("private network details")})
        val result=client.scanToken(request) as QrResult.Error;assertEquals(-1,result.code);assertEquals(1,calls);assertFalse(result.message.contains("private"))
    }
    @Test fun serverDenialRemainsDenial() {
        val c=Connection(403,"{\"message\":\"private details\"}")
        val result=QrHttpClient("https://synthetic.invalid/api/qr",{"token"},{c}).scanToken(request) as QrResult.Error
        assertEquals(403,result.code);assertFalse(result.message.contains("private"));assertTrue(c.closed)
    }
    @Test fun malformedResponseCannotReportSuccess() {
        val c=Connection(200,"not-json");assertEquals(502,(QrHttpClient("https://synthetic.invalid/api/qr",{"token"},{c}).scanToken(request) as QrResult.Error).code);assertTrue(c.closed)
    }
    @Test fun successWithoutQueueIdentityDenied() {
        val c=Connection(200,"{\"success\":true}");assertEquals(502,(QrHttpClient("https://synthetic.invalid/api/qr",{"token"},{c}).scanToken(request) as QrResult.Error).code)
    }
    @Test fun oversizedResponseBounded() {
        val c=Connection(200,"x".repeat(65537));assertEquals(502,(QrHttpClient("https://synthetic.invalid/api/qr",{"token"},{c}).scanToken(request) as QrResult.Error).code);assertTrue(c.closed)
    }
    @Test fun verifyUsesReadOnlyGetAndDoesNotAcquireAuth() {
        val c=Connection(200,"{\"success\":true,\"token\":\"SYS-TEST\"}")
        val client=QrHttpClient("https://synthetic.invalid/api/qr",{throw AssertionError("verification acquired identity")},{c})
        assertTrue(client.verifyToken("SYS-TEST") is QrResult.Success);assertEquals("GET",c.requestMethod);assertEquals(0,c.sent.size());assertTrue(c.closed)
    }
    @Test fun expiredVerifyCannotBecomeOfflineSuccess() {
        val c=Connection(410,"{}");assertEquals(410,(QrHttpClient("https://synthetic.invalid/api/qr",{null},{c}).verifyToken("SYS-TEST") as QrResult.Error).code)
    }
    @Test fun differentVerifiedTokenDenied() {
        val c=Connection(200,"{\"success\":true,\"token\":\"OTHER\"}");assertEquals(502,(QrHttpClient("https://synthetic.invalid/api/qr",{null},{c}).verifyToken("SYS-TEST") as QrResult.Error).code)
    }
    @Test fun invalidTokenRejectedBeforeNetwork() {
        var calls=0;val client=QrHttpClient("https://synthetic.invalid/api/qr",{null},{calls++;Connection(200,"{}")})
        assertEquals(400,(client.verifyToken("../token") as QrResult.Error).code);assertEquals(0,calls)
    }

    @Test fun invalidScanTokenMakesNoRequest() {
        val client=QrHttpClient("https://synthetic.invalid",{throw AssertionError("auth requested")},{throw AssertionError("network requested")})
        assertEquals(400,(client.scanToken(request.copy(token="../bad")) as QrResult.Error).code)
    }
    @Test fun identityProviderFailureDeniesBeforeNetwork() {
        val client=QrHttpClient("https://synthetic.invalid",{throw IllegalStateException("private")},{throw AssertionError("network requested")})
        assertEquals(401,(client.scanToken(request) as QrResult.Error).code)
    }
    @Test fun oversizedRegistrationMakesNoRequest() {
        val client=QrHttpClient("https://synthetic.invalid",{"token"},{throw AssertionError("network requested")})
        assertEquals(400,(client.scanToken(request.copy(driverName="x".repeat(8193))) as QrResult.Error).code)
    }
    @Test fun unsafeRemoteCleartextMakesNoRequest() {
        val client=QrHttpClient("http://synthetic.invalid",{null},{throw AssertionError("network requested")})
        assertEquals(400,(client.verifyToken("SYS-TEST") as QrResult.Error).code)
    }
    @Test fun nullAndNegativeRepliesCannotReportSuccess() {
        for(body in listOf("null","{\"success\":false}")) {
            val c=Connection(200,body)
            val client=QrHttpClient("https://synthetic.invalid",{"token"},{c})
            assertEquals(502,(client.verifyToken("SYS-TEST") as QrResult.Error).code)
            assertEquals(502,(client.scanToken(request) as QrResult.Error).code)
        }
    }
    @Test fun authConflictAndUnknownServerErrorsStayControlled() {
        for(code in listOf(401,409,500)) {
            val result=QrHttpClient("https://synthetic.invalid",{"token"},{Connection(code,"private")}).scanToken(request) as QrResult.Error
            assertEquals(code,result.code);assertFalse(result.message.contains("private"))
        }
    }
    @Test fun unexpectedTransportFailureIsControlled() {
        val client=QrHttpClient("https://synthetic.invalid",{null},{throw IllegalStateException("private")})
        val result=client.verifyToken("SYS-TEST") as QrResult.Error
        assertEquals(502,result.code);assertFalse(result.message.contains("private"))
    }
    @Test fun realLoopbackTransportUsesDefaultConnectionFactory() {
        val listener=java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))
        val worker=Thread {
            listener.accept().use { socket ->
                val reader=socket.getInputStream().bufferedReader()
                while(true){val line=reader.readLine() ?: break;if(line.isEmpty())break}
                val body="{\"success\":true,\"token\":\"SYS-TEST\"}"
                val reply="HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+body.toByteArray().size+"\r\nConnection: close\r\n\r\n"+body
                socket.getOutputStream().write(reply.toByteArray());socket.getOutputStream().flush()
            }
        }
        worker.isDaemon=true;worker.start()
        try {assertTrue(QrHttpClient("http://127.0.0.1:"+listener.localPort,{null}).verifyToken("SYS-TEST") is QrResult.Success)}
        finally {listener.close();worker.join(2000)}
    }

    @Test fun privateLanHttpIsAcceptedForLocalQrService() {
        val client = QrHttpClient("http://192.168.100.4:3001/api/qr", {null}, {
            Connection(200, "{\"success\":true,\"token\":\"SYS-TEST\"}")
        })
        assertTrue(client.verifyToken("SYS-TEST") is QrResult.Success)
    }
}
