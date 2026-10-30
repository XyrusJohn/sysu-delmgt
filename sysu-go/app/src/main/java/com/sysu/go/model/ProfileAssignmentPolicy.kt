package com.sysu.go.model

object ProfileAssignmentPolicy {
    fun ownAssignments(payload: Any?): List<Map<String, Any?>> =
        (payload as? List<*>)?.mapNotNull { it as? Map<String, Any?> }.orEmpty()

    fun activeCount(assignments: List<Map<String, Any?>>): Int =
        assignments.count { it["tripStatus"] != "completed" }

    fun completed(assignments: List<Map<String, Any?>>): List<Map<String, Any?>> =
        assignments.asSequence()
            .filter { it["tripStatus"] == "completed" && timestampMillis(it["completedAt"]) != null }
            .sortedByDescending { timestampMillis(it["completedAt"]) }
            .take(10)
            .toList()

    fun timestampMillis(value: Any?): Long? = when (value) {
        is Number -> value.toLong()
        is Map<*, *> -> (value["\$timestamp"] as? Number)?.toLong()
        is String -> value.toLongOrNull()
        else -> null
    }
}
