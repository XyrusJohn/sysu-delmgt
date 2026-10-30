package com.sysu.go.model

import java.util.concurrent.atomic.AtomicLong

/** Identifies the newest queue subscription so delayed callbacks cannot replace its state. */
internal class QueueLoadGeneration {
    private val current = AtomicLong(0)

    fun begin(): Long = current.incrementAndGet()

    fun invalidate(): Long = current.incrementAndGet()

    fun isCurrent(generation: Long): Boolean = current.get() == generation
}
