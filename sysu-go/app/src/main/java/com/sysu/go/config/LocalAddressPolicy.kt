package com.sysu.go.config

object LocalAddressPolicy {
    fun isPrivateIpv4(host: String): Boolean {
        val octets = host.split('.').map { it.toIntOrNull() ?: return false }
        if (octets.size != 4 || octets.any { it !in 0..255 }) return false
        return octets[0] == 10
            || (octets[0] == 172 && octets[1] in 16..31)
            || (octets[0] == 192 && octets[1] == 168)
    }

    fun isPrivateNetworkHost(host: String): Boolean = host == "localhost"
        || (host.endsWith(".mshome.net") && host.length > ".mshome.net".length)
        || isPrivateIpv4(host)

    fun isLocalHost(host: String): Boolean = host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host == "[::1]"
        || host == "10.0.2.2"
        || isPrivateNetworkHost(host)
}
