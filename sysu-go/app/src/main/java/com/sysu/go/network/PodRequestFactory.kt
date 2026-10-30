package com.sysu.go.network

internal object PodRequestFactory {
    const val CLEAR_PENDING_CHECKPOINT = "__CLEAR_PENDING__"

    fun complete(image: String, deliveryStatus: String, capturedAtMillis: Long): Map<String, Any> = mapOf(
        "action" to "complete",
        "base64Image" to image,
        "deliveryStatus" to deliveryStatus,
        "capturedAtMillis" to capturedAtMillis,
    )

    fun unload(status: String?): Map<String, String> = mapOf(
        "action" to "unload",
        "unloadStatus" to status.orEmpty(),
    )

    fun checkpoint(status: String?): String = when (status) {
        null -> CLEAR_PENDING_CHECKPOINT
        "UPLOADING" -> "UNLOADING"
        else -> status
    }
}
