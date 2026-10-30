# Aggressive Trip Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist trip state locally so it survives force-stop, app kill, phone restart. Only the End Trip button ends a trip. Marker reappears immediately on reopen using persisted coords.

**Architecture:** SharedPrefs (`driver_session`) is the sole source of truth for `trip_active`. Every `emitDriverMoving()` writes last coords to SharedPrefs. On session restore, socket reconnects and immediately re-emits persisted coords before waiting for GPS fix. SplashActivity routes to TransitActivity if `trip_active=true`.

**Tech Stack:** Kotlin, Android SharedPrefs, Firebase Auth, Socket.IO, Firestore

---

## File Map

```
app/src/main/java/com/sysu/go/utils/SessionManager.kt          — Task 1
app/src/main/java/com/sysu/go/network/SocketManager.kt         — Task 2
app/src/main/java/com/sysu/go/services/LocationServices.kt      — Task 3
app/src/main/java/com/sysu/go/activities/TransitActivity.kt     — Task 4
app/src/main/java/com/sysu/go/activities/SplashActivity.kt      — Task 5
```

No new files. No test files (manual QA test only — see Task 5 verification).

---

## Task 1: SessionManager — Add Last Emit Coord Read/Write

**Files:**
- Modify: `app/src/main/java/com/sysu/go/utils/SessionManager.kt`

- [ ] **Step 1: Verify current file content**

Read `SessionManager.kt` lines 1-145. Confirm:
- `companion object` constants end around line 21
- `clearTripSession()` is at lines 139-144

- [ ] **Step 2: Add two new constants**

After line 20 (`KEY_IS_TRIP_ACTIVE`), add:

```kotlin
        private const val KEY_LAST_EMIT_LAT = "last_emit_lat"
        private const val KEY_LAST_EMIT_LNG = "last_emit_lng"
```

- [ ] **Step 3: Add getter functions**

After `isTripActive()` (line 137), add:

```kotlin
    fun getLastEmitLat(): Double = prefs.getFloat(KEY_LAST_EMIT_LAT, 0.0).toDouble()

    fun getLastEmitLng(): Double = prefs.getFloat(KEY_LAST_EMIT_LNG, 0.0).toDouble()
```

- [ ] **Step 4: Add save function**

After `getLastEmitLng()`, add:

```kotlin
    fun saveLastEmit(lat: Double, lng: Double) {
        prefs.edit {
            putFloat(KEY_LAST_EMIT_LAT, lat.toFloat())
            putFloat(KEY_LAST_EMIT_LNG, lng.toFloat())
        }
    }
```

- [ ] **Step 5: Update clearTripSession()**

Replace the current `clearTripSession()` body (lines 139-144) with:

```kotlin
    fun clearTripSession() {
        prefs.edit {
            remove(KEY_SAP_DOC_ID)
            remove(KEY_IS_TRIP_ACTIVE)
            remove(KEY_LAST_EMIT_LAT)
            remove(KEY_LAST_EMIT_LNG)
        }
    }
```

- [ ] **Step 6: Commit**

```bash
git add app/src/main/java/com/sysu/go/utils/SessionManager.kt
git commit -m "feat(session): add last emit coord persistence for trip restore

saveLastEmit(lat, lng) writes to SharedPrefs.
getLastEmitLat/getLastEmitLng read with 0.0 default.
clearTripSession() now also clears last emit coords.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: SocketManager — Add Connect Listener Support

**Files:**
- Modify: `app/src/main/java/com/sysu/go/network/SocketManager.kt`

- [ ] **Step 1: Verify current file structure**

Read `SocketManager.kt` and find:
- Line where `mSocketGo` and `mSocketApp` are declared
- Line where `socket.on(Socket.EVENT_CONNECT)` handler is (inside `connectTo()`)

- [ ] **Step 2: Add connect listeners collection**

After line 22 (`private var prefs: SharedPreferences? = null`), add:

```kotlin
    private val connectListeners = mutableListOf<() -> Unit>()
```

- [ ] **Step 3: Add public addOnConnectListener() function**

After the `init()` function (around line 26), add:

```kotlin
    fun addOnConnectListener(listener: () -> Unit) {
        connectListeners.add(listener)
    }

    private fun notifyConnectListeners() {
        connectListeners.forEach { it() }
    }
```

- [ ] **Step 4: Call notifyConnectListeners() in EVENT_CONNECT handler**

In the `socket.on(Socket.EVENT_CONNECT)` block inside `connectTo()` (around line 62-64), add `notifyConnectListeners()` call after the existing log:

```kotlin
                socket.on(Socket.EVENT_CONNECT) {
                    Log.d(TAG, "Socket connected to $url: ${socket.id()}")
                    emitStatusUpdateOnSocket(socket, "online", getDriverName())
                    notifyConnectListeners()  // ← ADD THIS
                }
```

**Important:** You will see this pattern twice (once per `connectGo()` and `connectApp()`). Add `notifyConnectListeners()` to BOTH `Socket.EVENT_CONNECT` handlers — one in `connectGo()` and one in `connectApp()`. The listeners will fire once each time a socket connects.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/sysu/go/network/SocketManager.kt
git commit -m "feat(socket): add connect listeners for session restore emit-on-reconnect

addOnConnectListener() allows TransitActivity to register a callback
that fires when either socket connects. notifyConnectListeners() is
called from both mSocketGo and mSocketApp EVENT_CONNECT handlers.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: LocationServices — Persist Coords Before Emit

**Files:**
- Modify: `app/src/main/java/com/sysu/go/services/LocationServices.kt`

- [ ] **Step 1: Verify current handleLocation() content**

Read `LocationServices.kt` lines 58-86 (`handleLocation()` function). Confirm it ends with:
```kotlin
        SocketManager.emitDriverMoving(lat, lng, sapDocId, status = "online")
        Log.d(TAG, "driver_moving: [$lat, $lng], sapDocId=$sapDocId")
```

- [ ] **Step 2: Add SharedPrefs write before emit**

In `handleLocation()`, **before** the `SocketManager.emitDriverMoving()` call, add:

```kotlin
        // Persist coords BEFORE emit — used for session restore on app reopen
        prefs?.edit()
            ?.putFloat("last_emit_lat", lat.toFloat())
            ?.putFloat("last_emit_lng", lng.toFloat())
            ?.apply()
```

So `handleLocation()` ending section becomes:
```kotlin
        // Persist coords BEFORE emit — used for session restore on app reopen
        prefs?.edit()
            ?.putFloat("last_emit_lat", lat.toFloat())
            ?.putFloat("last_emit_lng", lng.toFloat())
            ?.apply()

        // Emit via Socket.IO for real-time admin map
        SocketManager.emitDriverMoving(lat, lng, sapDocId, status = "online")
        Log.d(TAG, "driver_moving: [$lat, $lng], sapDocId=$sapDocId")
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/services/LocationServices.kt
git commit -m "feat(location): persist last emit coords to SharedPrefs before sending

Every driver_moving emit writes lat/lng to SharedPrefs. On session restore,
TransitActivity reads these and re-emits immediately without waiting for GPS fix.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: TransitActivity — Persist Coords + Emit on Reconnect

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

This task has TWO changes: persist coords in `emitLastKnownLocation()`, and re-emit on socket reconnect in the session restore block.

### Part A — Persist coords in emitLastKnownLocation()

- [ ] **Step A1: Find emitLastKnownLocation()**

Read `TransitActivity.kt` lines 527-553 (`emitLastKnownLocation()` function).

- [ ] **Step A2: Add coord persistence before emit**

In `emitLastKnownLocation()`, find the `if (location != null)` block. **Before** `SocketManager.emitDriverMoving(...)`, add:

```kotlin
                    // Persist immediately so session restore can re-emit if app dies
                    sessionManager.saveLastEmit(location.latitude, location.longitude)
```

After the change, the inner block should be:
```kotlin
                if (location != null) {
                    sessionManager.saveLastEmit(location.latitude, location.longitude)  // ← ADD
                    SocketManager.emitDriverMoving(
                        location.latitude,
                        location.longitude,
                        sapDocId,
                        "online"
                    )
                    Log.d(TAG, "[START EMIT] Immediate driver_moving: [${location.latitude}, ${location.longitude}], $sapDocId")
                    updateLocationUI(location.latitude, location.longitude)
                }
```

### Part B — Emit on socket reconnect in session restore

- [ ] **Step B1: Find the session restore block**

Read `TransitActivity.kt` lines 88-107 (the session restore `if` block inside `onCreate()`).

Current content around lines 92-103:
```kotlin
        if (savedDocId != null && wasTripActive) {
            currentSapDocId = savedDocId
            isTripStarted = true
            binding.tvSubStatus.text = "Trip in progress"
            binding.btnStartTrip.text = "END TRIP"
            binding.btnStartTrip.setBackgroundColor(ContextCompat.getColor(this@TransitActivity, R.color.transit_green))
            binding.btnStartTrip.isEnabled = true
            if (isLocationPermissionGranted()) {
                startLocationUpdates()
            }
            Log.d(TAG, "[STATE RESTORE] Restored trip session — location tracking started")
        }
```

- [ ] **Step B2: Replace session restore block with full logic**

Replace the entire `if (savedDocId != null && wasTripActive)` block (lines 92-103) with:

```kotlin
        if (savedDocId != null && wasTripActive) {
            currentSapDocId = savedDocId
            isTripStarted = true
            binding.tvSubStatus.text = "Trip in progress"
            binding.btnStartTrip.text = "END TRIP"
            binding.btnStartTrip.setBackgroundColor(ContextCompat.getColor(this@TransitActivity, R.color.transit_green))
            binding.btnStartTrip.isEnabled = true

            // Pre-connect sockets so emitLastKnownLocation succeeds on Start Trip
            SocketManager.init(this)
            SocketManager.connect()

            // On socket connect: re-emit last known location immediately, then start tracking
            SocketManager.addOnConnectListener {
                val lastLat = sessionManager.getLastEmitLat()
                val lastLng = sessionManager.getLastEmitLng()
                Log.d(TAG, "[RESTORE] Re-emitting last location: [$lastLat, $lastLng]")
                SocketManager.emitDriverMoving(lastLat, lastLng, currentSapDocId, "online")

                // Idempotent Firestore update — safe to re-call
                val updates = mapOf(
                    "tripStatus" to "in_transit",
                    "startedAt" to Timestamp.now()
                )
                db.collection("sap_assignments").document(currentSapDocId)
                    .update(updates)
                    .addOnFailureListener { e ->
                        Log.w(TAG, "[RESTORE] Firestore update failed (non-fatal): ${e.message}")
                    }
            }

            // Restart location tracking — survives force-stop
            if (isLocationPermissionGranted()) {
                startLocationUpdates()
            }
            Log.d(TAG, "[STATE RESTORE] Restored trip session — socket reconnect + tracking started")
        }
```

**Note:** Verify `Timestamp` import is already present (it is — line 32: `com.google.firebase.Timestamp`).

- [ ] **Step B3: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/TransitActivity.kt
git commit -m "feat(transit): persist coords + emit on socket reconnect for session restore

emitLastKnownLocation() now calls sessionManager.saveLastEmit() before emitting.

Session restore block now:
- Pre-connects sockets on reopen
- Registers addOnConnectListener to re-emit persisted coords immediately
- Fires idempotent Firestore tripStatus=in_transit update on reconnect

Marker reappears instantly on app reopen without waiting for GPS fix.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: SplashActivity — Add Trip-Based Routing

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/SplashActivity.kt`

- [ ] **Step 1: Verify current checkUserSession() content**

Read `SplashActivity.kt` lines 55-62:

```kotlin
    private fun checkUserSession() {
        val session = SessionManager(this)
        if (session.hasActiveSession()) {
            navigateTo(MainActivity::class.java)
        } else {
            navigateTo(LoginActivity::class.java)
        }
    }
```

- [ ] **Step 2: Replace checkUserSession() logic**

Replace the `checkUserSession()` function with:

```kotlin
    private fun checkUserSession() {
        val session = SessionManager(this)
        if (!session.hasActiveSession()) {
            navigateTo(LoginActivity::class.java)
            return
        }

        // User is logged in — route based on trip state
        val destination = if (session.isTripActive()) {
            Log.d(TAG, "[SPLASH] Active session + active trip → TransitActivity")
            TransitActivity::class.java
        } else {
            Log.d(TAG, "[SPLASH] Active session, no trip → MainActivity")
            MainActivity::class.java
        }
        navigateTo(destination)
    }
```

This removes the call to `MainActivity::class.java` as a default and routes to `TransitActivity` if a trip is active.

- [ ] **Step 3: Verify imports**

Confirm these imports are present in `SplashActivity.kt`:
```kotlin
import com.sysu.go.utils.SessionManager   // already present (line 13)
import com.sysu.go.activities.TransitActivity  // ADD if not present
```

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/SplashActivity.kt
git commit -m "feat(splash): route to TransitActivity if trip is active on app open

If user is logged in and trip_active=true in SharedPrefs, app opens
TransitActivity directly so driver sees their active trip immediately.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all 5 tasks complete:

- [ ] `./gradlew assembleDebug` — must build successfully
- [ ] Force-stop mid-trip, reopen app → goes to TransitActivity, "END TRIP" showing
- [ ] On reopen → marker appears within ~1-2s (socket reconnect time) using persisted coords
- [ ] Tap End Trip → clears trip_active, goes to Queue/Marketplace
- [ ] Kill app mid-trip, reopen → same behavior as force-stop
- [ ] No "Start Trip" re-tap needed — state and marker restored automatically