package com.sysu.go.model

import java.util.Locale

internal data class ObdDeliveryGroup(
    val key: String,
    val lineItems: List<Map<String, Any?>>,
    val obdNumbers: List<String>,
    val pendingObdNumbers: List<String>,
    val volume: Double,
    val weight: Double,
    val quantity: Double,
    val allPendingComplete: Boolean,
    val allPendingUnloading: Boolean
)

/** Groups only records with a complete, matching SAP destination identity. */
internal object ObdDeliveryGroups {
    fun group(lineItems: List<Map<String, Any?>>): List<ObdDeliveryGroup> {
        val groups = linkedMapOf<String, MutableList<Map<String, Any?>>>()
        lineItems.forEachIndexed { index, item ->
            val identity = destinationKey(item) ?: "row:$index"
            groups.getOrPut(identity) { mutableListOf() }.add(item)
        }

        return groups.map { (key, items) ->
            val obds = items.mapNotNull { item ->
                item["obdNumber"]?.toString()?.trim()?.takeIf(String::isNotEmpty)
            }.distinct()
            val pending = items.asSequence()
                .filter { it["isPodCompleted"] != true }
                .mapNotNull { it["obdNumber"]?.toString()?.trim()?.takeIf(String::isNotEmpty) }
                .distinct()
                .toList()
            val incomplete = items.filter { it["isPodCompleted"] != true }
            ObdDeliveryGroup(
                key = key,
                lineItems = items,
                obdNumbers = obds,
                pendingObdNumbers = pending,
                volume = items.sumOf { it.number("volume") },
                weight = items.sumOf { it.number("weight") },
                quantity = items.sumOf { it.number("quantity") },
                allPendingComplete = incomplete.isEmpty(),
                allPendingUnloading = incomplete.isNotEmpty() && incomplete.all { it["unloadStatus"] == "UNLOADING" }
            )
        }
    }

    private fun destinationKey(item: Map<String, Any?>): String? {
        val shipTo = item.text("shipTo") ?: return null
        val customer = item.text("customerName") ?: return null
        val address = item.text("deliveryAddress") ?: return null
        val latitude = item.numberOrNull("latitude")?.takeIf { it in -90.0..90.0 } ?: return null
        val longitude = item.numberOrNull("longitude")?.takeIf { it in -180.0..180.0 } ?: return null
        val obd = item.text("obdNumber") ?: return null
        return listOf(shipTo, customer, address, "%.6f".format(Locale.US, latitude), "%.6f".format(Locale.US, longitude))
            .joinToString("\u001f")
            .also { require(obd.isNotBlank()) }
    }

    private fun Map<String, Any?>.text(key: String): String? = this[key]?.toString()
        ?.trim()?.replace(Regex("\\s+"), " ")?.lowercase(Locale.ROOT)?.takeIf(String::isNotEmpty)

    private fun Map<String, Any?>.number(key: String): Double = numberOrNull(key) ?: 0.0

    private fun Map<String, Any?>.numberOrNull(key: String): Double? = when (val value = this[key]) {
        is Number -> value.toDouble().takeIf(Double::isFinite)
        is String -> value.trim().toDoubleOrNull()?.takeIf(Double::isFinite)
        else -> null
    }
}
