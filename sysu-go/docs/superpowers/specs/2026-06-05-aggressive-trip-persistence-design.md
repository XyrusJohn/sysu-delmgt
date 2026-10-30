# Aggressive Trip Persistence

**Date:** 2026-06-05
**Status:** Approved
**Owner:** sysu-go dev team

---

## Principle

**Only the driver's "End Trip" button ends a trip.** The local `trip_active` SharedPrefs flag is the source of truth. Firestore's `tripStatus` field is a record for reporting, not an authority — it is never checked on app open to determine if a trip is active.

---

## App Launch Flow

```
SplashActivity.onCreate()
  │
  ├─► FirebaseAuth.getInstance().currentUser != null?
  │     ├─► NO  → LoginActivity (unchanged)
  │     └─► YES → sessionManager.isTripActive()
  │              ├─► true  → TransitActivity (FLAG_ACTIVITY_CLEAR_TOP)
  │              └─► false → MainActivity (queue screen)
```

**Why SplashActivity routing?** It is the single entry point for all cold-start paths. By routing here before any other activity, we guarantee the correct screen appears without relying on deep links or activity stack history.

---

## SharedPrefs Schema — `driver_session`

| Key | Type | Written by | Read by |
|---|---|---|---|
| `sap_doc_id` | String | `saveCurrentSapDocId()` | Session restore, `emitLastKnownLocation` |
| `trip_active` | Boolean | `setTripActive(true)`, `clearTripSession()` | Splash routing, TransitActivity state restore |
| `driver_name` | String | Login | `SocketManager` emit |
| `last_emit_lat` | Float | `emitLastKnownLocation`, `LocationServices.handleLocation` | TransitActivity session restore |
| `last_emit_lng` | Float | `emitLastKnownLocation`, `LocationServices.handleLocation` | TransitActivity session restore |

---

## GPS Coordinate Persistence

Every `emitDriverMoving()` call writes its coordinates to SharedPrefs immediately before emitting — no delay, no batching. This ensures the persisted coords are always the most recent location sent to the server.

```kotlin
// SharedPrefs keys
private const val KEY_LAST_EMIT_LAT = "last_emit_lat"
private const val KEY_LAST_EMIT_LNG = "last_emit_lng"

// Write on every emit
fun persistLastEmit(lat: Double, lng: Double) {
    prefs.edit()
        .putFloat(KEY_LAST_EMIT_LAT, lat.toFloat())
        .putFloat(KEY_LAST_EMIT_LNG, lng.toFloat())
        .apply()
}
```

---

## TransitActivity Session Restore

When `sessionManager.isTripActive() == true` on `onCreate()`:

```
restore session block (already exists, lines 88-107)
  │
  ├─► Restore UI: currentSapDocId, isTripStarted=true, "END TRIP" button
  │
  ├─► read lastLat/lastLng from SharedPrefs
  │
  ├─► SocketManager.init(this)
  ├─► SocketManager.connect()
  │
  ├─► Wait for socket CONNECT event, then:
  │     ├─► read persisted lastLat/lastLng from SharedPrefs
  │     ├─► SocketManager.emitDriverMoving(lastLat, lastLng, sapDocId, "online")
  │     └─► Firestore: tripStatus → "in_transit" (idempotent, safe to re-call)
  │
  └─► startLocationUpdates()  ← regular 5s GPS tracking resumes
```

**Key change:** On session restore, we **wait for the socket CONNECT event** before emitting. Socket reconnect takes ~1-2s. If no persisted coords exist, use `0.0, 0.0` and let first GPS fix correct it.

---

## End Trip — The Only Exit Point

`performEndTrip()` is the **sole** mechanism that ends a trip.

```kotlin
performEndTrip() {
    // 1. Clear LOCAL state IMMEDIATELY —trip is over from app's perspective
    sessionManager.clearTripSession()    // clears trip_active, sapDocId, lastEmit coords

    // 2. Emit offline to both Railway backends immediately
    SocketManager.emitOfflineStatus(uid, driverName)

    // 3. Update Firestore record (not authoritative — fire and forget)
    db.collection("sap_assignments").document(currentSapDocId)
        .update(mapOf(
            "tripStatus" to "completed",
            "completedAt" to Timestamp.now()
        ))  // .addOnFailureListener { /* log only, no retry */ }

    // 4. Stop location service
    stopLocationUpdates()
}
```

**Firestore failure is non-fatal.** The local session is cleared regardless of whether Firestore update succeeds. The record eventually syncs via `SyncWorker` if needed.

---

## Changes

### 1. SessionManager — add last emit coord read/write

**File:** `app/src/main/java/com/sysu/go/utils/SessionManager.kt`

Add two methods and two constants to `SessionManager`:

```kotlin
// Keys
private const val KEY_LAST_EMIT_LAT = "last_emit_lat"
private const val KEY_LAST_EMIT_LNG = "last_emit_lng"

// Reader
fun getLastEmitLat(): Double = prefs.getFloat(KEY_LAST_EMIT_LAT, 0.0).toDouble()
fun getLastEmitLng(): Double = prefs.getFloat(KEY_LAST_EMIT_LNG, 0.0).toDouble()

// Writer
fun saveLastEmit(lat: Double, lng: Double) {
    prefs.edit()
        .putFloat(KEY_LAST_EMIT_LAT, lat.toFloat())
        .putFloat(KEY_LAST_EMIT_LNG, lng.toFloat())
        .apply()
}

// Clear (called by clearTripSession)
fun clearTripSession() {
    prefs.edit()
        .remove(KEY_SAP_DOC_ID)
        .remove(KEY_TRIP_ACTIVE)
        .remove(KEY_LAST_EMIT_LAT)
        .remove(KEY_LAST_EMIT_LNG)
        .apply()
}
```

### 2. LocationServices — persist coords on every handleLocation emit

**File:** `app/src/main/java/com/sysu/go/services/LocationServices.kt`

In `handleLocation()`, after calling `emitDriverMoving()`:

```kotlin
// Read sapDocId from SharedPrefs (already done)
val sapDocId = prefs?.getString(sapDocIdKey, null)

// Persist coords BEFORE emit
prefs?.edit()
    ?.putFloat("last_emit_lat", lat.toFloat())
    ?.putFloat("last_emit_lng", lng.toFloat())
    ?.apply()

// Emit via Socket.IO
SocketManager.emitDriverMoving(lat, lng, sapDocId, status = "online")
```

### 3. TransitActivity — persist coords on emitLastKnownLocation

**File:** `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

In `emitLastKnownLocation()`, after emitting:

```kotlin
// Persist coords immediately before emitting
sessionManager.saveLastEmit(location.latitude, location.longitude)

SocketManager.emitDriverMoving(
    location.latitude,
    location.longitude,
    sapDocId,
    "online"
)
```

### 4. TransitActivity — restore: emit on socket reconnect

**File:** `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

In the session restore block (lines 92-103), after `SocketManager.connect()`:

```kotlin
// Wait for socket to connect, then re-emit last known location
SocketManager.addOnConnectListener {
    val lastLat = sessionManager.getLastEmitLat()
    val lastLng = sessionManager.getLastEmitLng()
    Log.d(TAG, "[RESTORE] Re-emitting last location: [$lastLat, $lastLng]")
    SocketManager.emitDriverMoving(lastLat, lastLng, currentSapDocId, "online")

    // Idempotent Firestore update
    db.collection("sap_assignments").document(currentSapDocId)
        .update(mapOf("tripStatus" to "in_transit", "startedAt" to Timestamp.now()))
        .addOnFailureListener { e ->
            Log.w(TAG, "[RESTORE] Firestore update failed (non-fatal): ${e.message}")
        }
}
```

**Note:** Requires adding `addOnConnectListener()` to `SocketManager` — a simple callback list that fires when either socket first connects.

### 5. SocketManager — add connect callback support

**File:** `app/src/main/java/com/sysu/go/network/SocketManager.kt`

Add a callback list that fires when socket connects:

```kotlin
private val connectListeners = mutableListOf<() -> Unit>()

fun addOnConnectListener(listener: () -> Unit) {
    connectListeners.add(listener)
}

private fun notifyConnectListeners() {
    connectListeners.forEach { it() }
}

// Call notifyConnectListeners() inside Socket.EVENT_CONNECT handler
socket.on(Socket.EVENT_CONNECT) {
    Log.d(TAG, "Socket connected to $url: ${socket.id()}")
    emitStatusUpdateOnSocket(socket, "online", getDriverName())
    notifyConnectListeners()  // ← ADD THIS
}
```

### 6. SplashActivity — add routing decision

**File:** `app/src/main/java/com/sysu/go/activities/SplashActivity.kt`

Replace current splash-to-main direct logic with:

```kotlin
FirebaseAuth.getInstance().addOnCompleteListener { task ->
    if (!task.isSuccessful) {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
        return@addOnCompleteListener
    }

    val user = task.result?.user
    if (user == null) {
        startActivity(Intent(this, LoginActivity::class.java))
    } else {
        SessionManager(this).initDriverSession(user.uid, user.displayName ?: "Driver")
        val intent = if (SessionManager(this).isTripActive()) {
            Intent(this, TransitActivity::class.java)
        } else {
            Intent(this, MainActivity::class.java)
        }
        intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        startActivity(intent)
    }
    finish()
}
```

---

## Failure Scenarios

| Scenario | Behavior |
|---|---|
| App force-stop mid-trip | Local state persists. On reopen: check `trip_active` → true → TransitActivity → reconnect → emit last coords |
| App killed before first GPS fix | Last coords in SharedPrefs re-emitted on reconnect |
| No network on reopen | Sockets retry via reconnection policy (10 attempts, 2-5s delay). App waits. Marker appears when connected |
| Phone restart | Same as force-stop (Firebase session survives + SharedPrefs survive) |
| Firestore `tripStatus = completed` server-side (race) | Ignored. Driver must tap End Trip to end |
| Firestore update fails on End Trip | Log and ignore. Local session cleared. Driver sees Queue screen. |
| No persisted coords on first restore | Emit `(0.0, 0.0)`. First GPS fix corrects marker position within 5s. |

---

## Testing

1. Start a trip, note last GPS coords from logcat
2. Force-stop the app (`adb shell am force-stop`)
3. Re-open app
   - Expected: Goes straight to TransitActivity with "END TRIP" showing
   - Expected: Marker appears within ~1-2s (socket reconnect time)
   - Expected: Marker uses last persisted coords, not 0,0
4. Tap End Trip → verify Local session cleared, goes to Queue
5. Kill app mid-trip, reopen → verify still shows "END TRIP" and marker with last coords

---

## Files Modified

| File | Changes |
|---|---|
| `app/src/main/java/com/sysu/go/utils/SessionManager.kt` | Add `last_emit_lat/lng` read/write, update `clearTripSession()` |
| `app/src/main/java/com/sysu/go/services/LocationServices.kt` | Persist coords in `handleLocation()` before emit |
| `app/src/main/java/com/sysu/go/activities/TransitActivity.kt` | Persist coords in `emitLastKnownLocation()`; emit on socket reconnect in session restore block |
| `app/src/main/java/com/sysu/go/network/SocketManager.kt` | Add `connectListeners` callback list + `addOnConnectListener()` |
| `app/src/main/java/com/sysu/go/activities/SplashActivity.kt` | Add routing: `trip_active` → TransitActivity, else MainActivity |