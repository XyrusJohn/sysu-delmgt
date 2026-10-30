package com.sysu.go.config

import com.sysu.go.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EnvironmentIsolationTest {
    @Test
    fun compiledVariantTargetsExpectedServices() {
        val local = BuildConfig.USE_LOCAL_SERVICES
        val host = java.net.URI(BuildConfig.API_BASE_URL).host
        val api = if (local) "http://$host:3001" else "https://sysu-go.onrender.com"
        assertEquals(api, BuildConfig.API_BASE_URL)
        assertEquals(api, BuildConfig.SOCKET_URL)
        assertEquals(local, BuildConfig.USE_LOCAL_SERVICES)
        val expectedApplicationId = when (BuildConfig.BUILD_TYPE) {
            "emulator" -> "com.sysu.go.debug"
            "phoneLocal" -> "com.sysu.go.phoneLocal"
            else -> "com.sysu.go"
        }
        assertEquals(expectedApplicationId, BuildConfig.APPLICATION_ID)
        if (BuildConfig.BUILD_TYPE == "debug") {
            assertEquals(true, local)
            assertEquals(true, LocalAddressPolicy.isLocalHost(host))
        }
    }

    @Test
    fun policyAcceptsExactLocalAndProductionConfigurations() {
        EnvironmentPolicy.validate(true, "http://10.0.2.2:3001", "http://10.0.2.2:3001")
        EnvironmentPolicy.validate(true, "http://192.168.100.4:3001", "http://192.168.100.4:3001")
        EnvironmentPolicy.validate(true, "http://sysu-host.mshome.net:3001", "http://sysu-host.mshome.net:3001")
        EnvironmentPolicy.validate(false, "https://sysu-go.onrender.com", "https://sysu-go.onrender.com")
    }

    @Test
    fun policyRejectsProductionEndpointsInLocalVariant() {
        assertThrows(IllegalArgumentException::class.java) {
            EnvironmentPolicy.validate(true, "https://sysu-go.onrender.com", "http://10.0.2.2:3001")
        }
    }

    @Test
    fun policyRejectsLocalOrDecoratedProductionUrls() {
        for (url in listOf("http://10.0.2.2:3001", "https://user@sysu-go.onrender.com", "https://sysu-go.onrender.com?wrong=1")) {
            assertThrows(IllegalArgumentException::class.java) {
            EnvironmentPolicy.validate(false, url, "https://sysu-go.onrender.com")
            }
        }
    }

    @Test
    fun policyRejectsPublicOrMismatchedPhoneLocalHosts() {
        assertThrows(IllegalArgumentException::class.java) {
            EnvironmentPolicy.validate(true, "http://8.8.8.8:3001", "http://8.8.8.8:3001")
        }
        assertThrows(IllegalArgumentException::class.java) {
            EnvironmentPolicy.validate(true, "http://192.168.100.4:3001", "http://192.168.100.5:3001")
        }
    }

    @Test
    fun localAddressPolicyAllowsPrivateLanHostsOnly() {
        assertEquals(true, LocalAddressPolicy.isLocalHost("192.168.100.4"))
        assertEquals(true, LocalAddressPolicy.isLocalHost("sysu-host.mshome.net"))
        assertEquals(true, LocalAddressPolicy.isLocalHost("10.0.2.2"))
        assertEquals(false, LocalAddressPolicy.isLocalHost("8.8.8.8"))
        assertEquals(false, LocalAddressPolicy.isLocalHost("192.168.100.999"))
    }
}
