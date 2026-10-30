package com.sysu.go.utils

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PodPhotoTempFileTest {
    @Test
    fun deleteRemovesAnExistingTemporaryPhoto() {
        val photo = File.createTempFile("sysu-pod-", ".jpg")
        photo.writeBytes(byteArrayOf(1, 2, 3))

        assertTrue(PodPhotoTempFile.delete(photo))
        assertFalse(photo.exists())
    }

    @Test
    fun deleteIsSafeWhenTheTemporaryPhotoIsAlreadyGone() {
        val photo = File.createTempFile("sysu-pod-", ".jpg")
        assertTrue(photo.delete())

        assertTrue(PodPhotoTempFile.delete(photo))
    }

    @Test
    fun deleteIsSafeForANullReference() {
        assertTrue(PodPhotoTempFile.delete(null))
    }
}
