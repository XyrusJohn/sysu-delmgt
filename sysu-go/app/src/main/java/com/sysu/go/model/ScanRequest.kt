package com.sysu.go.model

import com.google.gson.annotations.SerializedName

data class ScanRequest(
    val token: String,
    val driverId: String,
    val driverName: String,
    val driverFN: String,
    val driverMI: String,
    val driverLN: String,
    val truckType: String,
    val truckCompany: String,
    val plateNumber: String,
    val helperName: String,
    val driverPhone: String? = null
)

data class ScanResponse(
    val success: Boolean,
    val message: String?,
    val queueId: String?,
    val queuePosition: Int?
)

data class VerifyResponse(
    val success: Boolean,
    val message: String?,
    val token: String?
)