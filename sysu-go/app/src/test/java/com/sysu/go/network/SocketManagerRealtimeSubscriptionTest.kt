package com.sysu.go.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SocketManagerRealtimeSubscriptionTest {
    @Test fun queuePositionTopicUsedAfterQueueAdmissionIsSupported() {
        assertTrue(isSupportedRealtimeTopic("queuePosition"))
    }

    @Test fun authenticatedMasterDataTopicsAreSupported() {
        assertTrue(isSupportedRealtimeTopic("securityGuards"))
        assertTrue(isSupportedRealtimeTopic("truckCompanies"))
    }

    @Test fun unknownRealtimeTopicIsRejected() {
        assertFalse(isSupportedRealtimeTopic("unknown"))
    }
}
