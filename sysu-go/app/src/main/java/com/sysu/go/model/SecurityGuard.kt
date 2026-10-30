package com.sysu.go.model

data class SecurityGuard(
    val guardId: String,
    val firstName: String,
    val middleInitial: String,
    val lastName: String,
    val fullName: String,
    val active: Boolean = true
)

data class GuardSelection(
    val guards: List<SecurityGuard>
)