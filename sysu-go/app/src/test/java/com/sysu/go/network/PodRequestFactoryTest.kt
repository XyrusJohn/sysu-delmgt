package com.sysu.go.network

import org.junit.Assert.assertEquals
import org.junit.Test

class PodRequestFactoryTest {
    @Test
    fun completeRequestMatchesBackendPodContract() {
        assertEquals(
            mapOf(
                "action" to "complete",
                "base64Image" to "data:image/jpeg;base64,/9j/AA==",
                "deliveryStatus" to "All Delivered",
                "capturedAtMillis" to 1234L,
            ),
            PodRequestFactory.complete("data:image/jpeg;base64,/9j/AA==", "All Delivered", 1234L),
        )
    }

    @Test
    fun clearUnloadSendsBackendSupportedEmptyStatus() {
        assertEquals(
            mapOf("action" to "unload", "unloadStatus" to ""),
            PodRequestFactory.unload(null),
        )
    }

    @Test
    fun localUploadCheckpointRetainsUnloadingState() {
        assertEquals("UNLOADING", PodRequestFactory.checkpoint("UPLOADING"))
        assertEquals(PodRequestFactory.CLEAR_PENDING_CHECKPOINT, PodRequestFactory.checkpoint(null))
    }
}
