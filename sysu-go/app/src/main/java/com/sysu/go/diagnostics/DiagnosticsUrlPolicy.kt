package com.sysu.go.diagnostics

import java.net.URL

internal fun isSafeDiagnosticsUrl(url: URL, debugBuild: Boolean): Boolean {
    if (url.protocol.equals("https", ignoreCase = true)) return true
    if (!url.protocol.equals("http", ignoreCase = true)) return false
    val host = url.host.lowercase()
    if (host in setOf("localhost", "127.0.0.1", "[::1]")) return true
    return debugBuild && isPrivateIpv4(host)
}

private fun isPrivateIpv4(host: String): Boolean {
    val octets = host.split('.').map { it.toIntOrNull() ?: return false }
    if (octets.size != 4 || octets.any { it !in 0..255 }) return false
    return octets[0] == 10
        || (octets[0] == 172 && octets[1] in 16..31)
        || (octets[0] == 192 && octets[1] == 168)
}
