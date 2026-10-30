package com.sysu.go.utils

import java.io.File

/** Deletes a POD camera temporary only when its caller knows it is no longer needed. */
object PodPhotoTempFile {
    fun delete(file: File?): Boolean = file == null || !file.exists() || file.delete()
}
