package com.sysu.go.network

/** Invalidates asynchronous token/socket callbacks when account or lifecycle changes. */
class SocketSessionGate {
    private var generation = 0L
    private var currentUid: String? = null
    @Synchronized fun begin(uid: String): Long { generation += 1; currentUid = uid; return generation }
    @Synchronized fun invalidate() { generation += 1; currentUid = null }
    @Synchronized fun isCurrent(token: Long, uid: String?): Boolean = uid != null && uid == currentUid && token == generation
}
