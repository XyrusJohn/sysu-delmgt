package com.sysu.go.audit

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DriverActionOutboxTest {
    @Test
    fun eventsRemainQueuedUntilAcknowledgedAndAssignmentSnapshotsAreDeduplicated() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("driver_action_outbox.db")
        DriverActionOutbox(context).use { outbox ->
            val uid = "synthetic-test-driver"
            assertEquals(
                listOf("dispatch-b"),
                outbox.newlyObservedAssignments(uid, listOf("dispatch-a", "dispatch-b"), listOf("dispatch-b"))
            )
            assertEquals(emptyList<String>(), outbox.newlyObservedAssignments(uid, listOf("dispatch-a", "dispatch-b")))

            val event = outbox.enqueue(
                ownerUid = uid,
                eventType = "shipment_assigned",
                subjectId = "dispatch-b",
                locationState = "unavailable",
                idempotencyKey = "assignment:dispatch-b"
            )
            assertNotNull(event)
            assertEquals(1, outbox.pendingCount(uid))
            assertNull(outbox.enqueue(
                ownerUid = uid,
                eventType = "shipment_assigned",
                subjectId = "dispatch-b",
                locationState = "unavailable",
                idempotencyKey = "assignment:dispatch-b"
            ))
            assertEquals(event!!.sessionId, outbox.pending(uid).single().sessionId)
            outbox.acknowledge(uid, listOf(event.eventId))
            assertEquals(0, outbox.pendingCount(uid))
        }
        context.deleteDatabase("driver_action_outbox.db")
    }

    @Test
    fun sessionCompletionClosesOnlyAfterTheGeofenceArrivalEventIsQueued() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("driver_action_outbox.db")
        DriverActionOutbox(context).use { outbox ->
            val uid = "synthetic-arrival-driver"
            val before = outbox.enqueue(uid, "transit_started")!!
            val arrival = outbox.reserveEvent(uid, "arrived_at_warehouse")!!
            val completed = outbox.reserveEvent(uid, "session_completed", closeSession = true)!!
            val nextSession = outbox.enqueue(uid, "app_open")!!
            assertEquals(before.sessionId, arrival.sessionId)
            assertEquals(arrival.sessionId, completed.sessionId)
            assertEquals(arrival.sessionId, outbox.pending(uid).first().sessionId)
            assertEquals(false, completed.sessionId == nextSession.sessionId)
            outbox.resolveReservation(uid, arrival, 14.6, 121.0, 15f, "available")
            outbox.resolveReservation(uid, completed, 14.6, 121.0, 15f, "available")
            val finalBatch = outbox.pending(uid)
            assertEquals("session_completed", finalBatch.last().eventType)
            outbox.acknowledge(uid, finalBatch.map { it.eventId })
            assertEquals(nextSession.sessionId, outbox.pending(uid).single().sessionId)
        }
        context.deleteDatabase("driver_action_outbox.db")
    }

    @Test
    fun completedSessionMetadataIsRemovedOnlyAfterServerAcknowledgesEveryEvent() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("driver_action_outbox.db")
        DriverActionOutbox(context).use { outbox ->
            val uid = "synthetic-cleanup-driver"
            val action = outbox.enqueue(uid, "shipment_assigned", idempotencyKey = "assignment:test")!!
            val completion = outbox.reserveEvent(uid, "session_completed", closeSession = true)!!

            assertEquals(emptyList<String>(), outbox.acknowledge(uid, listOf(action.eventId)))
            assertEquals(1, outbox.pendingCount(uid))
            assertEquals(listOf(completion.sessionId), outbox.acknowledge(uid, listOf(completion.eventId)))
            assertEquals(0, outbox.pendingCount(uid))

            val db = outbox.readableDatabase
            db.rawQuery("SELECT COUNT(*) FROM state WHERE owner_uid=? AND key IN (?,?)",
                arrayOf(uid, "sequence:${completion.sessionId}", "completed:${completion.sessionId}")).use {
                it.moveToFirst()
                assertEquals(0, it.getInt(0))
            }
            db.rawQuery("SELECT COUNT(*) FROM dedupe WHERE owner_uid=? AND dedupe_key LIKE ?",
                arrayOf(uid, "${completion.sessionId}:%")).use {
                it.moveToFirst()
                assertEquals(0, it.getInt(0))
            }
        }
        context.deleteDatabase("driver_action_outbox.db")
    }

    @Test
    fun actionDurationsIgnoreTransitRouteSamples() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("driver_action_outbox.db")
        DriverActionOutbox(context).use { outbox ->
            val uid = "synthetic-duration-driver"
            outbox.enqueue(uid, "app_open", occurredAtMs = 1_000L)
            val opened = outbox.enqueue(uid, "qr_scan_opened", occurredAtMs = 2_000L)!!
            outbox.enqueue(uid, "route_point", occurredAtMs = 5_000L)
            val scanned = outbox.enqueue(uid, "qr_scan", occurredAtMs = 10_000L)!!
            assertEquals(1_000L, opened.durationMs)
            assertEquals(8_000L, scanned.durationMs)
        }
        context.deleteDatabase("driver_action_outbox.db")
    }

    @Test
    fun podCaptureKeepsThePhotoTimestampAndItsRecordedLocation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("driver_action_outbox.db")
        DriverActionOutbox(context).use { outbox ->
            val event = outbox.enqueue(
                ownerUid = "synthetic-pod-driver",
                eventType = "pod_captured",
                occurredAtMs = 1_761_750_000_000L,
                lat = 14.6709822,
                lng = 121.0149736,
                locationState = "available",
                subjectId = "0010140809",
                metadata = org.json.JSONObject().put("obdRef", "OBD-TEST-1"),
                idempotencyKey = "pod:0010140809:OBD-TEST-1:1761750000000"
            )!!

            val pending = outbox.pending("synthetic-pod-driver").single()
            assertEquals("pod_captured", pending.eventType)
            assertEquals(event.eventId, pending.eventId)
            assertEquals(1_761_750_000_000L, pending.occurredAtMs)
            assertEquals(14.6709822, pending.lat!!, 0.0000001)
            assertEquals(121.0149736, pending.lng!!, 0.0000001)
            assertEquals("available", pending.locationState)
            assertEquals("0010140809", pending.subjectId)
            assertEquals("OBD-TEST-1", org.json.JSONObject(pending.metadata).getString("obdRef"))
        }
        context.deleteDatabase("driver_action_outbox.db")
    }

    @Test
    fun pendingBatchStopsBeforeAnUnresolvedLocationReservation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("driver_action_outbox.db")
        DriverActionOutbox(context).use { outbox ->
            val uid = "synthetic-ordering-driver"
            val first = outbox.enqueue(uid, "app_open")!!
            val reserved = outbox.reserveEvent(uid, "qr_scan")!!
            val third = outbox.enqueue(uid, "trip_registration")!!

            assertEquals(listOf(first.eventId), outbox.pending(uid).map { it.eventId })
            outbox.acknowledge(uid, listOf(first.eventId))
            assertEquals(emptyList<String>(), outbox.pending(uid).map { it.eventId })

            outbox.resolveReservation(uid, reserved, locationState = "unavailable")
            assertEquals(listOf(reserved.eventId, third.eventId), outbox.pending(uid).map { it.eventId })
        }
        context.deleteDatabase("driver_action_outbox.db")
    }
}
