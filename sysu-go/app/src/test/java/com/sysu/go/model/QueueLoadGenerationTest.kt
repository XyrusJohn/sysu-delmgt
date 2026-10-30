package com.sysu.go.model

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueLoadGenerationTest {
    @Test
    fun retryMakesDelayedCallbacksFromPreviousSubscriptionStale() {
        val generations = QueueLoadGeneration()
        val first = generations.begin()
        val retry = generations.begin()

        assertFalse(generations.isCurrent(first))
        assertTrue(generations.isCurrent(retry))
    }

    @Test
    fun lifecycleTeardownInvalidatesTheCurrentSubscription() {
        val generations = QueueLoadGeneration()
        val active = generations.begin()

        generations.invalidate()

        assertFalse(generations.isCurrent(active))
    }
}
