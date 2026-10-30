package com.sysu.go.config

import java.net.URI

object EnvironmentPolicy {
    fun validate(useLocalServices: Boolean, api: String, socket: String) {
        if (!useLocalServices) {
            require(listOf(api, socket) == listOf(
                "https://sysu-go.onrender.com",
                "https://sysu-go.onrender.com",
            )) { "Invalid service configuration" }
            return
        }

        val apiUri = localUri(api, 3001)
        val socketUri = localUri(socket, 3001)
        require(apiUri.host == socketUri.host) {
            "Local API and Socket.IO services must use the same private host"
        }
    }

    private fun localUri(value: String, port: Int): URI {
        val uri = try {
            URI(value)
        } catch (_: Exception) {
            throw IllegalArgumentException("Invalid service configuration")
        }
        require(uri.scheme == "http" && uri.port == port && uri.rawPath.isNullOrEmpty()
            && uri.rawQuery == null && uri.rawFragment == null && uri.userInfo == null
            && LocalAddressPolicy.isPrivateNetworkHost(uri.host.orEmpty())) { "Invalid service configuration" }
        return uri
    }
}
