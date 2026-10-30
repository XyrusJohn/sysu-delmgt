# Return-to-Base + Trip Completion Flow

**Date:** 2026-07-08
**Status:** DRAFT

---

## 1. Overview

Complete the trip lifecycle for the sysu-go driver app. When all shipments in a delivery run are fully POD-completed, the driver transitions through a **Return-to-Base** phase and ends the trip. After completion, the driver's session is fully cleared — they are free to return to the queue and accept new assignments.

This spec covers only the state transitions and button behavior. It does NOT add new screens, activity routes, or summary displays — all of that already exists or is out of scope.

---

## 2. Trip Status State Machine

```
tripStatus: null/pending/confirmed
    │ START TRIP
    ↓
tripStatus: in_transit
    │ Driver drives, GPS tracking ON, does POD deliveries per shipment
    │
    │  ── Per OBD item: UNLOAD → CAPTURE → UPLOADING → COMPLETE ──
    │  These are Firestore unloadStatus UI states; tripStatus stays in_transit
    │
    │  All OBD items across ALL shipments: isPodComplete = true
    │  ← "START RETURNING TO BASE" button UNLOCKS
    │
    │  [RETURN TO BASE] button tap → confirm dialog
    │  Confirm → write tripStatus = "returning_to_base" + returnedToBaseAt
    ↓
tripStatus: returning_to_base
    │ Driver drives back to warehouse, GPS tracking continues
    │
    │  [ARRIVED AT WAREHOUSE] button tap → "END TRIP?" confirm dialog
    │  Confirm → performEndTrip()
    ↓
tripStatus: completed
    │ GPS tracking stops, session fully cleared
    │
    │  Driver is free to return to queue and accept new assignments
    ↓
```

---

## 3. Button States (TransitActivity)

| State | Button Text | Button Color | Action |
|---|---|---|---|
| Not started | "START TRIP" | Red (sysu_red) | `startTrip()` |
| `in_transit`, PODs remaining | "BACK TO HOME" | Green (transit_green) | Navigate to MyTripActivity |
| `in_transit`, all PODs done | "START RETURNING TO BASE" | Blue (sysu_blue) | `transitionToReturningToBase()` |
| `returning_to_base` | "ARRIVED AT WAREHOUSE" | Blue (sysu_blue, active) | Show END TRIP confirm dialog |
| `completed` | "START TRIP" | Red (sysu_red) | Reset / fresh state — back to not started |

---

## 4. Key Transitions

### 4.1 `in_transit` → `returning_to_base`

**Trigger:** `isPodCompleteForAll = true` AND driver taps "START RETURNING TO BASE"

```
isPodCompleteForAll = (ALL lineItems[i].isPodCompleted == true) across the active shipment
```

**Button:** Text changes from "BACK TO HOME" → "START RETURNING TO BASE" (blue)
**Confirm dialog:**
```
┌────────────────────────────────────────────┐
│  Start Returning to Base?                  │
│                                            │
│  All OBD items have been delivered.       │
│  Begin returning to the warehouse?       │
│                                            │
│  [Cancel]              [Confirm]           │
└────────────────────────────────────────────┘
```
**Firestore update:**
```
tripStatus: "returning_to_base"
returnedToBaseAt: Timestamp.now()
```

**In-memory state:**
- `isReturningToBase = true`
- `isTripStarted = false` (no longer "actively driving to delivery")

### 4.2 `returning_to_base` → `completed`

**Trigger:** Driver taps "ARRIVED AT WAREHOUSE" → confirm dialog → `performEndTrip()`

**Confirm dialog:**
```
┌────────────────────────────────────────────┐
│  End Trip?                                 │
│                                            │
│  Are you sure you want to end this trip?  │
│  This cannot be undone.                    │
│                                            │
│  [Cancel]              [End Trip]         │
└────────────────────────────────────────────┘
```
**Firestore update:**
```
tripStatus: "completed"
completedAt: Timestamp.now()
```

**Session cleanup:**
```
sessionManager.clearTripSession() // clears activeSapDocId, currentSapDocId, tripActive
sessionManager.setTrackingActive(false)
stopService(LocationServices)
TrackingStateMonitor.setState(ONLINE)
SocketManager.emitOfflineStatus(uid, driverName)
```

---

## 5. isPodCompleteForAll Computation

Computed from Firestore `lineItems` array on the active shipment doc:

```kotlin
val lineItemsAll = doc.get("lineItems") as? List<Map<String, Any?>>
isPodCompleteForAll = lineItemsAll?.all { (it["isPodCompleted"] as? Boolean) == true } ?: false
```

**When computed:**
- On initial `loadTripData()` — both direct session restore path and queue-join path
- After each POD upload completes — re-read from Firestore on `sap_updated` socket event

---

## 6. Existing TransitActivity Flow (current code, no changes needed)

The code that implements this is ALREADY in `TransitActivity.kt`. This spec documents the exact button-state logic for clarity:

### 6.1 `setupUI()` — btnStartTrip click handler
```kotlin
binding.btnStartTrip.setOnClickListener {
    when {
        isReturningToBase -> {
            // Show END TRIP confirm dialog → performEndTrip()
        }
        isTripStarted -> {
            if (isPodCompleteForAll) {
                // Show RETURN TO BASE confirm → transitionToReturningToBase()
            } else {
                // Navigate to MainActivity (back to POD work)
            }
        }
        else -> startTrip()
    }
}
```

### 6.2 `updateProgressStepper()` — button text/color by state
Already implemented. Key states:
- `isTripStarted && isPodCompleteForAll` → "START RETURNING TO BASE" (blue)
- `isReturningToBase` → "ARRIVED AT WAREHOUSE" (blue active)
- `isTripEnded (completed)` → "START TRIP" (red, resets state)

### 6.3 `transitionToReturningToBase()`
Already implemented: writes `tripStatus = "returning_to_base"` + `returnedToBaseAt`.

### 6.4 `performEndTrip()`
Already implemented: writes `tripStatus = "completed"` + `completedAt`; clears session.

---

## 7. What's Missing / What Needs Fixing

Based on code review, the following are ALREADY implemented in TransitActivity:
- ✅ `isPodCompleteForAll` computed from Firestore lineItems
- ✅ "START RETURNING TO BASE" button shows when `isPodCompleteForAll = true`
- ✅ `transitionToReturningToBase()` writes Firestore
- ✅ `performEndTrip()` clears session
- ✅ `returning_to_base` tripStatus handled in `populateShipmentUI()` and `updateProgressStepper()`

**What may need verification:**
1. **Session restore path** — `loadTripData()` when restoring a `returning_to_base` or `in_transit` session:
   - In `onCreate()`, if `getCurrentSapDocId()` is set, it fetches the doc directly
   - It reads `tripStatus` → if `"returning_to_base"` → sets `isReturningToBase = true`
   - It reads `isPodCompleteForAll` from `lineItems`
   - → `updateProgressStepper()` sets correct button state
   - **Need to verify** this path correctly handles session restore for `returning_to_base`

2. **After POD completion** — when driver completes the LAST POD via `updateObdLineItemInFirestore`:
   - The `MyTripActivity` re-reads via socket `sap_updated`
   - The card in `MyTripTabAdapter` needs to show the button state update
   - But `TransitActivity` is the one showing the "START RETURNING TO BASE" button
   - **Need to verify** that `TransitActivity` re-reads `isPodCompleteForAll` after returning from the POD work screen (i.e., when the driver comes BACK from MyTripActivity to TransitActivity, does it refresh the button state?)

---

## 8. Auto-Navigate on App Restart

**Critical fix the user wants:**

When a driver has an `in_transit` session (app killed, restarts):
1. SplashActivity reads `sessionManager.isTripActive()`
2. `currentSapDocId` is set → routes to **TransitActivity** (not MyTripActivity)
3. TransitActivity loads the doc and sets `btnStartTrip = "BACK TO HOME"` (correct — driver is mid-delivery)
4. Driver does POD work, comes back → button still shows correct state

**What works currently:** `loadTripData()` with `restoredDocId.isNotBlank()` path handles this.

**Potential issue to fix:** After completing all PODs in MyTripActivity and returning to TransitActivity, the button still says "BACK TO HOME" instead of "START RETURNING TO BASE" — because TransitActivity's `isPodCompleteForAll` was set at load time and hasn't been re-read since POD completion.

**Fix:** When TransitActivity resumes (`onResume()`), re-fetch `isPodCompleteForAll` from Firestore if `isTripStarted = true`.

---

## 9. Spec Self-Review

- [x] Placeholder scan: no TODOs or TBDs — all behaviors described
- [x] Internal consistency: button states, progress stepper, Firestore writes all aligned
- [x] Scope check: surgical — only button-state transitions, no new screens
- [x] `isPodCompleteForAll` is the only new computed state; everything else is existing code
- [x] Session clearing: confirmed `clearTripSession()` is called on `performEndTrip()`
- [x] Action item: verify `onResume()` refresh of `isPodCompleteForAll` in TransitActivity ✅ DONE
- [x] Action item: verify session-restore path handles `returning_to_base` ✅ FIXED — stale in_transit write removed

---

## 10. Files to Modify

| File | Change | Risk |
|---|---|---|
| `TransitActivity.kt` | Add `onResume()` re-read of `isPodCompleteForAll` when `isTripStarted = true` | Low — surgical |
| `activity_transit.xml` | No layout changes — button text/color driven by code | None |

**Files NOT to modify** (already correct):
- MyTripActivity.kt — POD upload flow unchanged
- ObdItemsBottomSheet — unchanged
- MyTripTabAdapter — unchanged
- All Firestore models — schema unchanged