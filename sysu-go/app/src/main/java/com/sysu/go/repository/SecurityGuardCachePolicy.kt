package com.sysu.go.repository

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.google.gson.reflect.TypeToken
import com.sysu.go.model.SecurityGuard

internal object SecurityGuardCachePolicy {
    const val MAX_AGE_MILLIS = 24L * 60 * 60 * 1000
    private const val MAX_GUARDS = 2000
    private const val MAX_BYTES = 256 * 1024
    private const val VERSION = 1
    private val guardListType = object : TypeToken<List<SecurityGuard>>() {}.type

    fun keyForAccount(accountId: String): String? =
        accountId.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,80}")) }?.let { "security_guards_v$VERSION.$it" }

    fun parseRealtime(data: Any?): List<SecurityGuard>? {
        val rows = data as? List<*> ?: return null
        if (rows.size > MAX_GUARDS) return null
        val guards = mutableListOf<SecurityGuard>()
        for (row in rows) {
            val fields = row as? Map<*, *> ?: return null
            val guardId = fields["guardId"] as? String ?: return null
            val firstName = fields["firstName"] as? String ?: return null
            val lastName = fields["lastName"] as? String ?: return null
            val active = fields["active"] as? Boolean ?: return null
            if (guardId.isBlank() || firstName.isBlank() || lastName.isBlank()) return null
            if (!active) continue
            val middleInitial = fields["middleInitial"] as? String ?: ""
            val fullName = fields["fullName"] as? String
                ?: "$firstName ${middleInitial.takeIf { it.isNotBlank() }?.plus(" ") ?: ""}$lastName".trim()
            guards += SecurityGuard(guardId, firstName, middleInitial, lastName, fullName, true)
        }
        return guards
    }

    fun encode(guards: List<SecurityGuard>, gson: Gson, nowMillis: Long): String? {
        if (!validGuards(guards) || nowMillis <= 0) return null
        return runCatching {
            val payload = mapOf("version" to VERSION, "updatedAtMillis" to nowMillis, "guards" to guards)
            gson.toJson(payload).takeIf { it.toByteArray(Charsets.UTF_8).size <= MAX_BYTES }
        }.getOrNull()
    }

    fun decode(json: String, gson: Gson, nowMillis: Long): CachedSecurityGuards? {
        if (json.toByteArray(Charsets.UTF_8).size > MAX_BYTES || nowMillis <= 0) return null
        return runCatching {
            val root = JsonParser.parseString(json).asJsonObject
            val version = root.get("version")?.asInt ?: return null
            val updatedAt = root.get("updatedAtMillis")?.asLong ?: return null
            if (version != VERSION || updatedAt <= 0 || updatedAt > nowMillis || nowMillis - updatedAt > MAX_AGE_MILLIS) return null
            val guards = gson.fromJson<List<SecurityGuard>>(root.get("guards"), guardListType) ?: return null
            if (!validGuards(guards)) return null
            CachedSecurityGuards(guards.toList(), updatedAt)
        }.getOrNull()
    }

    private fun validGuards(guards: List<SecurityGuard>): Boolean =
        guards.size <= MAX_GUARDS && guards.all { guard ->
            guard.active && guard.guardId.isNotBlank() && guard.guardId.length <= 80
                && guard.firstName.isNotBlank() && guard.firstName.length <= 100
                && guard.lastName.isNotBlank() && guard.lastName.length <= 100
                && guard.middleInitial.length <= 20 && guard.fullName.length <= 220
        }
}
