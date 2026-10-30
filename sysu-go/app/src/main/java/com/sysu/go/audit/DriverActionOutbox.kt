package com.sysu.go.audit

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.util.UUID

data class DriverActionEvent(
    val eventId: String,
    val sessionId: String,
    val sequence: Long,
    val eventType: String,
    val occurredAtMs: Long,
    val lat: Double?,
    val lng: Double?,
    val accuracy: Float?,
    val locationState: String,
    val subjectId: String?,
    val outcome: String,
    val durationMs: Long?,
    val metadata: String,
) {
    fun toPayload(): JSONObject = JSONObject().apply {
        put("eventId", eventId)
        put("sessionId", sessionId)
        put("sequence", sequence)
        put("eventType", eventType)
        put("occurredAtMs", occurredAtMs)
        put("lat", lat ?: JSONObject.NULL)
        put("lng", lng ?: JSONObject.NULL)
        put("accuracy", accuracy ?: JSONObject.NULL)
        put("locationState", locationState)
        put("subjectId", subjectId ?: JSONObject.NULL)
        put("outcome", outcome)
        put("durationMs", durationMs ?: JSONObject.NULL)
        put("metadata", JSONObject(metadata))
    }
}

data class DriverActionReservation(
    val eventId: String,
    val sessionId: String,
    val sequence: Long,
    val occurredAtMs: Long,
)

/** Durable, private-device outbox. It never sends a driver ID; Socket.IO auth owns identity. */
class DriverActionOutbox(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "driver_action_outbox.db", null, 2) {

    private val appContext = context.applicationContext

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE events(
                event_id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, session_id TEXT NOT NULL,
                sequence INTEGER NOT NULL, event_type TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL,
                lat REAL, lng REAL, accuracy REAL, location_state TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 1,
                subject_id TEXT, outcome TEXT NOT NULL, duration_ms INTEGER, metadata TEXT NOT NULL
            )""".trimIndent()
        )
        db.execSQL("CREATE INDEX events_pending ON events(owner_uid, session_id, sequence)")
        db.execSQL("CREATE TABLE state(owner_uid TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner_uid,key))")
        db.execSQL("CREATE TABLE dedupe(owner_uid TEXT NOT NULL, dedupe_key TEXT NOT NULL, event_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL, PRIMARY KEY(owner_uid,dedupe_key))")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            //  Preserve queued events from earlier development builds while adding reservation/dedupe support.
            db.execSQL("ALTER TABLE events ADD COLUMN ready INTEGER NOT NULL DEFAULT 1")
            db.execSQL("CREATE TABLE IF NOT EXISTS dedupe(owner_uid TEXT NOT NULL, dedupe_key TEXT NOT NULL, event_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL, PRIMARY KEY(owner_uid,dedupe_key))")
        }
    }

    @Synchronized
    fun reserveEvent(
        ownerUid: String,
        eventType: String,
        occurredAtMs: Long = System.currentTimeMillis(),
        subjectId: String? = null,
        outcome: String = "success",
        durationMs: Long? = null,
        metadata: JSONObject = JSONObject(),
        idempotencyKey: String? = null,
        closeSession: Boolean = false,
    ): DriverActionReservation? {
        require(ownerUid.isNotBlank() && EVENT_TYPES.contains(eventType))
        require(subjectId == null || subjectId.length <= 128 && !subjectId.contains('/') && !subjectId.contains('\\'))
        require(durationMs == null || durationMs >= 0L)
        require(metadata.toString().length <= 1024)
        require(idempotencyKey == null || idempotencyKey.length in 1..160)
        val db = writableDatabase
        db.beginTransaction()
        try {
            val sessionId = getState(db, ownerUid, "active_session") ?: UUID.randomUUID().toString().also {
                putState(db, ownerUid, "active_session", it)
            }
            val dedupeKey = idempotencyKey?.let { "$sessionId:$it" }
            if (dedupeKey != null) {
                val duplicate = db.rawQuery("SELECT 1 FROM dedupe WHERE owner_uid=? AND dedupe_key=?", arrayOf(ownerUid, dedupeKey))
                    .use { it.moveToFirst() }
                if (duplicate) { db.setTransactionSuccessful(); return null }
            }
            val sequence = (getState(db, ownerUid, "sequence:$sessionId")?.toLongOrNull() ?: 0L) + 1L
            putState(db, ownerUid, "sequence:$sessionId", sequence.toString())
            val id = UUID.randomUUID().toString()
            val actionDuration = durationMs ?: inferDuration(db, ownerUid, sessionId, eventType, occurredAtMs, metadata)
            db.execSQL(
                """INSERT INTO events(event_id,owner_uid,session_id,sequence,event_type,occurred_at_ms,
                    lat,lng,accuracy,location_state,ready,subject_id,outcome,duration_ms,metadata)
                    VALUES(?,?,?,?,?,?,NULL,NULL,NULL,'unavailable',0,?,?,?,?)""".trimIndent(),
                arrayOf<Any?>(id, ownerUid, sessionId, sequence, eventType, occurredAtMs,
                    subjectId, outcome.take(40), actionDuration, metadata.toString())
            )
            if (dedupeKey != null) db.execSQL(
                "INSERT INTO dedupe(owner_uid,dedupe_key,event_id,created_at_ms) VALUES(?,?,?,?)",
                arrayOf<Any?>(ownerUid, dedupeKey, id, occurredAtMs)
            )
            if (closeSession && getState(db, ownerUid, "active_session") == sessionId) {
                putState(db, ownerUid, "completed:$sessionId", occurredAtMs.toString())
                putState(db, ownerUid, "active_session", "")
            }
            db.setTransactionSuccessful()
            return DriverActionReservation(id, sessionId, sequence, occurredAtMs)
        } finally { db.endTransaction() }
    }

    @Synchronized
    fun resolveReservation(
        ownerUid: String,
        reservation: DriverActionReservation,
        lat: Double? = null,
        lng: Double? = null,
        accuracy: Float? = null,
        locationState: String = if (lat != null && lng != null) "available" else "unavailable",
    ) {
        require(locationState in LOCATION_STATES && (lat == null) == (lng == null))
        require((locationState == "available") == (lat != null))
        require(lat == null || lat in -90.0..90.0)
        require(lng == null || lng in -180.0..180.0)
        require(accuracy == null || accuracy.isFinite() && accuracy >= 0f)
        writableDatabase.execSQL(
            "UPDATE events SET lat=?,lng=?,accuracy=?,location_state=?,ready=1 WHERE owner_uid=? AND event_id=? AND ready=0",
            arrayOf<Any?>(lat, lng, accuracy, locationState, ownerUid, reservation.eventId)
        )
    }

    @Synchronized
    fun finalizeUnresolvedReservations(ownerUid: String) {
        if (ownerUid.isNotBlank()) writableDatabase.execSQL(
            "UPDATE events SET ready=1,location_state='unavailable' WHERE owner_uid=? AND ready=0", arrayOf(ownerUid)
        )
    }

    @Synchronized
    fun enqueue(
        ownerUid: String,
        eventType: String,
        occurredAtMs: Long = System.currentTimeMillis(),
        lat: Double? = null,
        lng: Double? = null,
        accuracy: Float? = null,
        locationState: String = if (lat != null && lng != null) "available" else "unavailable",
        subjectId: String? = null,
        outcome: String = "success",
        durationMs: Long? = null,
        metadata: JSONObject = JSONObject(),
        idempotencyKey: String? = null,
    ): DriverActionEvent? {
        require(ownerUid.isNotBlank())
        require(EVENT_TYPES.contains(eventType))
        require(locationState in LOCATION_STATES)
        require((lat == null) == (lng == null))
        require(lat == null || lat in -90.0..90.0)
        require(lng == null || lng in -180.0..180.0)
        require(accuracy == null || accuracy.isFinite() && accuracy >= 0f)
        require(durationMs == null || durationMs >= 0L)
        require(metadata.toString().length <= 1024)
        val db = writableDatabase
        db.beginTransaction()
        try {
            val sessionId = getState(db, ownerUid, "active_session") ?: UUID.randomUUID().toString().also {
                putState(db, ownerUid, "active_session", it)
            }
            val scopedDedupeKey = idempotencyKey?.let { "$sessionId:$it" }
            if (idempotencyKey != null) {
                require(idempotencyKey.length in 1..160)
                val alreadyRecorded = db.rawQuery(
                    "SELECT 1 FROM dedupe WHERE owner_uid=? AND dedupe_key=?",
                    arrayOf(ownerUid, scopedDedupeKey)
                ).use { it.moveToFirst() }
                if (alreadyRecorded) {
                    db.setTransactionSuccessful()
                    return null
                }
            }
        val sequence = (getState(db, ownerUid, "sequence:$sessionId")?.toLongOrNull() ?: 0L) + 1L
        putState(db, ownerUid, "sequence:$sessionId", sequence.toString())
        val id = UUID.randomUUID().toString()
        val actionDuration = durationMs ?: inferDuration(db, ownerUid, sessionId, eventType, occurredAtMs, metadata)
        val event = DriverActionEvent(
            id, sessionId, sequence, eventType, occurredAtMs, lat, lng, accuracy,
            locationState, subjectId, outcome.take(40), actionDuration, metadata.toString()
        )
        db.execSQL(
            """INSERT INTO events(event_id,owner_uid,session_id,sequence,event_type,occurred_at_ms,
                lat,lng,accuracy,location_state,subject_id,outcome,duration_ms,metadata)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""".trimIndent(),
                arrayOf<Any?>(id, ownerUid, sessionId, sequence, eventType, occurredAtMs, lat, lng,
                accuracy, locationState, subjectId, event.outcome, actionDuration, event.metadata)
        )
        if (idempotencyKey != null) {
            db.execSQL(
                "INSERT INTO dedupe(owner_uid,dedupe_key,event_id,created_at_ms) VALUES(?,?,?,?)",
                arrayOf<Any?>(ownerUid, scopedDedupeKey, id, occurredAtMs)
            )
        }
        if (eventType == "session_completed") {
            putState(db, ownerUid, "completed:$sessionId", occurredAtMs.toString())
            putState(db, ownerUid, "active_session", "")
        }
        db.setTransactionSuccessful()
        return event
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun pending(ownerUid: String, limit: Int = MAX_BATCH): List<DriverActionEvent> {
        if (ownerUid.isBlank()) return emptyList()
        val db = readableDatabase
        val firstSession = db.rawQuery(
            "SELECT session_id,ready FROM events WHERE owner_uid=? ORDER BY rowid LIMIT 1",
            arrayOf(ownerUid)
        ).use { if (it.moveToFirst()) if (it.getInt(1) == 1) it.getString(0) else "" else null }
            ?.takeIf { it.isNotEmpty() } ?: return emptyList()
        return db.rawQuery(
            """SELECT event_id,session_id,sequence,event_type,occurred_at_ms,lat,lng,accuracy,
                location_state,subject_id,outcome,duration_ms,metadata FROM events
                WHERE owner_uid=? AND session_id=? AND ready=1
                  AND rowid < COALESCE((SELECT MIN(rowid) FROM events AS unresolved
                    WHERE unresolved.owner_uid=? AND unresolved.session_id=? AND unresolved.ready=0), 9223372036854775807)
                ORDER BY sequence LIMIT ?""".trimIndent(),
            arrayOf(ownerUid, firstSession, ownerUid, firstSession, limit.coerceIn(1, MAX_BATCH).toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(DriverActionEvent(
                        cursor.getString(0), cursor.getString(1), cursor.getLong(2),
                        cursor.getString(3), cursor.getLong(4),
                        if (cursor.isNull(5)) null else cursor.getDouble(5),
                        if (cursor.isNull(6)) null else cursor.getDouble(6),
                        if (cursor.isNull(7)) null else cursor.getFloat(7),
                        cursor.getString(8), if (cursor.isNull(9)) null else cursor.getString(9),
                        cursor.getString(10), if (cursor.isNull(11)) null else cursor.getLong(11),
                        cursor.getString(12)
                    ))
                }
            }
        }
    }

    @Synchronized
    fun acknowledge(ownerUid: String, eventIds: Collection<String>): List<String> {
        if (ownerUid.isBlank() || eventIds.isEmpty()) return emptyList()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val validIds = eventIds.filter { UUID_PATTERN.matches(it) }.distinct()
            val completedSessions = mutableSetOf<String>()
            validIds.chunked(100).forEach { chunk ->
                val placeholders = chunk.joinToString(",") { "?" }
                db.rawQuery(
                    "SELECT session_id FROM events WHERE owner_uid=? AND event_type='session_completed' AND event_id IN ($placeholders)",
                    arrayOf(ownerUid, *chunk.toTypedArray())
                ).use { cursor -> while (cursor.moveToNext()) completedSessions.add(cursor.getString(0)) }
                db.execSQL("DELETE FROM events WHERE owner_uid=? AND event_id IN ($placeholders)", arrayOf(ownerUid, *chunk.toTypedArray()))
            }
            completedSessions.removeAll { sessionId ->
                val stillPending = db.rawQuery(
                    "SELECT 1 FROM events WHERE owner_uid=? AND session_id=? LIMIT 1",
                    arrayOf(ownerUid, sessionId)
                ).use { it.moveToFirst() }
                if (!stillPending) {
                    db.execSQL("DELETE FROM state WHERE owner_uid=? AND key IN (?,?)", arrayOf(ownerUid, "sequence:$sessionId", "completed:$sessionId"))
                    db.execSQL("DELETE FROM dedupe WHERE owner_uid=? AND dedupe_key LIKE ?", arrayOf(ownerUid, "$sessionId:%"))
                }
                stillPending
            }
            db.setTransactionSuccessful()
            return completedSessions.toList()
        } finally {
            db.endTransaction()
        }
    }

    /** Reclaims SQLite pages only after a full trip has been confirmed and cleared. */
    @Synchronized
    fun compactIfNeeded(): Boolean {
        val file = appContext.getDatabasePath("driver_action_outbox.db")
        if (file.length() < MIN_COMPACT_DB_BYTES) return false
        val db = writableDatabase
        val pages = db.rawQuery("PRAGMA page_count", null).use { if (it.moveToFirst()) it.getLong(0) else 0L }
        val freePages = db.rawQuery("PRAGMA freelist_count", null).use { if (it.moveToFirst()) it.getLong(0) else 0L }
        if (pages == 0L || freePages * 2 < pages) return false
        db.execSQL("VACUUM")
        return true
    }

    @Synchronized
    fun pendingCount(ownerUid: String): Int = readableDatabase.rawQuery(
        "SELECT COUNT(*) FROM events WHERE owner_uid=?", arrayOf(ownerUid)
    ).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    /** Returns only assignment IDs first observed after the initial listener snapshot. */
    @Synchronized
    fun newlyObservedAssignments(
        ownerUid: String,
        assignmentIds: Collection<String>,
        firstSnapshotEligibleIds: Collection<String> = emptyList(),
    ): List<String> {
        if (ownerUid.isBlank()) return emptyList()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val current = assignmentIds.filter { it.isNotBlank() && it.length <= 128 }.toSet()
            val priorJson = getState(db, ownerUid, "observed_assignments")
            val prior: Set<String> = if (priorJson == null) emptySet() else runCatching {
                val values = mutableSetOf<String>()
                val json = org.json.JSONArray(priorJson)
                for (index in 0 until json.length()) {
                    val value = json.optString(index)
                    if (value.isNotBlank()) values.add(value)
                }
                values.toSet()
            }.getOrDefault(emptySet())
            putState(db, ownerUid, "observed_assignments", org.json.JSONArray(current.toList()).toString())
            db.setTransactionSuccessful()
            return if (priorJson == null) {
                (current intersect firstSnapshotEligibleIds.toSet()).toList()
            } else (current - prior).toList()
        } finally {
            db.endTransaction()
        }
    }

    private fun getState(db: SQLiteDatabase, uid: String, key: String): String? =
        db.rawQuery("SELECT value FROM state WHERE owner_uid=? AND key=?", arrayOf(uid, key))
            .use { if (it.moveToFirst()) it.getString(0).takeIf(String::isNotEmpty) else null }

    private fun inferDuration(
        db: SQLiteDatabase,
        ownerUid: String,
        sessionId: String,
        eventType: String,
        occurredAtMs: Long,
        metadata: JSONObject,
    ): Long? {
        if (eventType == "route_point" || eventType == "app_open") return null
        val previousActionAt = db.rawQuery(
            "SELECT occurred_at_ms FROM events WHERE owner_uid=? AND session_id=? AND event_type!='route_point' ORDER BY sequence DESC LIMIT 1",
            arrayOf(ownerUid, sessionId)
        ).use { if (it.moveToFirst()) it.getLong(0) else null }
        val duration = if (eventType == "session_completed") {
            db.rawQuery(
                "SELECT MIN(occurred_at_ms) FROM events WHERE owner_uid=? AND session_id=?",
                arrayOf(ownerUid, sessionId)
            ).use { if (it.moveToFirst() && !it.isNull(0)) (occurredAtMs - it.getLong(0)).coerceIn(0L, MAX_DURATION_MS) else null }
                ?.also { metadata.put("durationBasis", "session_total") }
        } else previousActionAt?.let { (occurredAtMs - it).coerceIn(0L, MAX_DURATION_MS) }
            ?.also { metadata.put("durationBasis", "since_previous_action") }
        if (metadata.toString().length > 1024) metadata.remove("durationBasis")
        return duration
    }

    private fun putState(db: SQLiteDatabase, uid: String, key: String, value: String) {
        db.execSQL(
            "INSERT OR REPLACE INTO state(owner_uid,key,value) VALUES(?,?,?)",
            arrayOf(uid, key, value)
        )
    }

    companion object {
        const val MAX_BATCH = 50
        private const val MIN_COMPACT_DB_BYTES = 1024L * 1024L
        private const val MAX_DURATION_MS = 90L * 24 * 60 * 60 * 1000
        val EVENT_TYPES = setOf(
            "app_open", "qr_scan", "trip_registration", "queue_joined", "shipment_assigned",
            "loading_started", "fully_loaded", "guard_verified", "transit_started",
            "route_point", "unloading_started", "pod_captured", "returning_to_base",
            "arrived_at_warehouse", "qr_scan_opened", "registration_opened", "loading_cancelled",
            "verification_cancelled", "trip_confirmation", "active_shipment_selected", "warehouse_arrival_confirmed",
            "all_deliveries_completed", "return_prompt_opened", "return_to_base_requested",
            "arrival_confirmation_opened", "session_completed"
        )
        val LOCATION_STATES = setOf("available", "unavailable", "permission_denied")
        private val UUID_PATTERN = Regex("^[0-9a-fA-F-]{36}$")
    }
}
