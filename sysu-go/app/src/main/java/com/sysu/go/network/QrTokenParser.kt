package com.sysu.go.network

import java.net.URI
import java.net.URLDecoder

object QrTokenParser {
    fun extract(payload: String): String? {
        if (payload.startsWith("SYS-")) return payload

        val scanned = runCatching { URI(payload) }.getOrNull() ?: return null
        if (
            scanned.scheme !in setOf("http", "https") ||
            scanned.host.isNullOrBlank() ||
            scanned.userInfo != null
        ) return null

        val token = scanned.rawQuery.orEmpty()
            .split('&')
            .firstOrNull { it.substringBefore('=') == "token" }
            ?.substringAfter('=', "")
            ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
        return token?.takeIf { it.startsWith("SYS-") }
    }
}
