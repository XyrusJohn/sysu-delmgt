package com.sysu.go.diagnostics

import java.net.URL
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticsUrlPolicyTest {
    @Test
    fun releaseBuildRequiresHttpsExceptLoopback() {
        assertTrue(isSafeDiagnosticsUrl(URL("https://api.example.test"), debugBuild = false))
        assertTrue(isSafeDiagnosticsUrl(URL("http://localhost:3001"), debugBuild = false))
        assertFalse(isSafeDiagnosticsUrl(URL("http://192.168.1.20:3001"), debugBuild = false))
    }

    @Test
    fun debugBuildAllowsOnlyPrivateLanHttpHosts() {
        assertTrue(isSafeDiagnosticsUrl(URL("http://192.168.100.4:3001"), debugBuild = true))
        assertTrue(isSafeDiagnosticsUrl(URL("http://10.0.2.2:3001"), debugBuild = true))
        assertFalse(isSafeDiagnosticsUrl(URL("http://api.example.test"), debugBuild = true))
        assertFalse(isSafeDiagnosticsUrl(URL("http://8.8.8.8:3001"), debugBuild = true))
    }
}
