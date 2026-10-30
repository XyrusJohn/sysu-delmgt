package com.sysu.go.utils

/**
 * Retained as a source-compatible no-op for the old profile screen reference.
 * Assignment state now comes from the MySQL assignment API and Socket.IO stream.
 */
@Deprecated("Driver assignments are provided by the MySQL API and Socket.IO")
object DriverShipmentSync {
    @Suppress("UNUSED_PARAMETER")
    fun start(uid: String?) = Unit

    fun stop() = Unit

    @Suppress("UNUSED_PARAMETER")
    suspend fun ensureAssigned(uid: String, sapDocId: String) = Unit
}
