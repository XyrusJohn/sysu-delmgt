# Socket Pre-Connect on TransitActivity Open

**Date:** 2026-06-05
**Status:** Approved
**Owner:** sysu-go dev team

---

## Problem

When a driver taps "Start Trip" in the sysu-go app, the marker on the sysu-app web map appears **several seconds late** instead of immediately.

### Root Cause

`emitLastKnownLocation()` (called from `startTrip()`) emits `driver_moving` **before** `SocketManager.connect()` is ever called. At that moment, `mSocketGo` and `mSocketApp` are both `null`, so `socket?.connected() != true` evaluates to `true` in `emitDriverMovingOnSocket()`, and the emit is **silently dropped**.

The marker only appears ~5 seconds later when `LocationServices` fires its first GPS fix.

### Call Flow (Before Fix)

```
TAP START TRIP
  │  onCreate() was NOT calling SocketManager.connect()
  ▼
emitLastKnownLocation()
  └─► SocketManager.emitDriverMoving()
        └─► emitDriverMovingOnSocket(mSocketApp, ...)
              └─► mSocketApp == null  →  connected() == false  → SILENT DROP ✗
  │
  ├─► Firestore update (tripStatus = in_transit)
  │
  └─► startLocationUpdates()
        └─► LocationServices.onStartCommand()
              └─► SocketManager.connect()  ← socks connect HERE, too late
                    └─► LocationServices.handleLocation()
                          └─► emitDriverMoving()  ← marker appears ~5s late
```

---

## Solution

Pre-connect both sockets in `TransitActivity.onCreate()` before the driver can tap Start Trip. By the time they tap, sockets are already connected and `emitDriverMovingOnSocket()` succeeds immediately.

### Call Flow (After Fix)

```
TransitActivity.onCreate()
  └─► SocketManager.init(this)
  └─► SocketManager.connect()       ← both sockets connect async (~1-2s)

... driver reads screen, taps Start Trip (~1-5s later)

TAP START TRIP
  └─► emitLastKnownLocation()
        └─► SocketManager.emitDriverMoving()
              └─► mSocketApp.connected() == true  → EMIT SUCCEEDS ✓
  └─► Marker appears on sysu-app map immediately (< 1s from tap)
```

---

## Changes

### 1. TransitActivity.onCreate()

**File:** `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

Add two lines before `setupUI()`:

```kotlin
// In onCreate(), after super.onCreate() and view setup, before setupUI():
SocketManager.init(this)   // ensures driver_name SharedPrefs is loaded
SocketManager.connect()    // pre-connect both sockets before driver can tap Start Trip
```

### 2. SocketManager.connect() — No Changes

The existing `SocketManager.connect()` is already a no-op if sockets are already connected:

```kotlin
fun connect() {
    connectGo()
    connectApp()
}

private fun connectGo() {
    if (mSocketGo?.connected() == true) return   // already connected → no-op
    connectTo(SOCKET_URL_GO) { socket -> mSocketGo = socket }
}
```

So calling `connect()` twice (e.g., from `onCreate` and later from `LocationServices.onStartCommand`) is safe.

---

## Impact

| Aspect | Before | After |
|---|---|---|
| Marker latency | ~5 seconds | < 1 second |
| Socket state on Start Trip | `null` (dropped emit) | `connected` |
| Code changes | — | 2 lines in `onCreate()` |
| Side effects | — | Sockets connect when Activity opens |

---

## Testing

1. Open sysu-go app → TransitActivity
2. Open sysu-app web dashboard (Chrome DevTools console filter: `update_admin_map`)
3. Wait 5+ seconds (let sockets fully connect)
4. Tap **START TRIP**
5. **Expected:** `update_admin_map` received in web console within **< 1 second** of tap
6. **Verify:** Timestamp diff between app tap and web console log is under 1 second

---

## Files Modified

- `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`
  - Line ~92: Add `SocketManager.init(this)` before `setupUI()`
  - Line ~93: Add `SocketManager.connect()` before `setupUI()`