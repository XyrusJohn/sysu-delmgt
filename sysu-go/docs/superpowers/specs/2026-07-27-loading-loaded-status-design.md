# LOADING → LOADED → IN TRANSIT: Pre-Delivery Status Flow

**Date:** 2026-07-27
**Status:** Draft — pending user review

## Overview

Add two new `tripStatus` values (`loading`, `fully_loaded`) between assignment and delivery, plus an auto-set `loaded` state triggered by guard verification. This gives the company visibility into which drivers are loading cargo vs. fully loaded and ready for delivery.

## Status Flow

```
NOT IN QUEUE → QUEUE (with No.) → ASSIGNED → loading → fully_loaded → loaded → in_transit
```

| # | State | Trigger | Who |
|---|-------|---------|-----|
| 1 | ASSIGNED | Admin assigns shipment | System |
| 2 | `loading` | Driver taps **START LOADING** | Driver |
| 3 | `fully_loaded` | Driver taps **FULLY LOADED** | Driver |
| 4 | `loaded` | Guard verification succeeds | System (auto) |
| 5 | `in_transit` | Driver taps **START TRIP** | Driver |

## Firestore Writes Per Transition

### START LOADING → `tripStatus = "loading"`
**Collection:** `sap_assignments/{docId}`
```
tripStatus: "loading"
loadingStartedAt: Timestamp.now()
```

### FULLY LOADED → `tripStatus = "fully_loaded"` + driver doc update
**Collection 1:** `sap_assignments/{docId}`
```
tripStatus: "fully_loaded"
fullyLoadedAt: Timestamp.now()
```
**Collection 2:** `drivers/{driverId}`
```
isFull: true
```

### Guard verification → auto `tripStatus = "loaded"`
When `guardVerified` field is written (existing GuardVerificationBottomSheet flow), the listener sees `tripStatus == "fully_loaded"` AND `guardVerified == true` → auto-updates:
```
sap_assignments/{docId}.tripStatus: "loaded"
```

### START TRIP → `tripStatus = "in_transit"` (existing flow)
No change to existing START TRIP logic.

## Card UI Progression (MyTripTabAdapter)

| `tripStatus` | Badge Text | Badge Color | Button Text | Button Color | OBD Access | Guard Pill |
|---|---|---|---|---|---|---|
| `null` / pending | ASSIGNED | Gray (`bg_status_pill_gray`) | **START LOADING** | sysu_red | 🔒 | Pending |
| `loading` | LOADING... | Amber (`bg_status_pill_amber`) | **FULLY LOADED** | sysu_blue | 🔒 | Pending |
| `fully_loaded`, not verified | FULLY LOADED | Blue (`bg_status_pill_blue`) | **VERIFY WITH GUARD** | Amber | 🔒 | Pending |
| `loaded` | LOADED ✓ | Green (`bg_status_pill_green`) | **START TRIP** | sysu_red | ✅ Unlocked | Verified ✓ |

## Action Buttons (values matched in `onTripActionClicked`)

| Button Text | Action String | What it does |
|---|---|---|
| START LOADING | `START_LOADING` | Sets `tripStatus = "loading"` |
| FULLY LOADED | `FULLY_LOADED` | Sets `tripStatus = "fully_loaded"` + `drivers/{id}.isFull = true` |
| VERIFY WITH GUARD | `VERIFY_GUARD` | Opens `GuardVerificationBottomSheet` |
| START TRIP | `START_TRIP` | Existing flow → `tripStatus = "in_transit"` |

## Lock Logic

- Only ONE shipment can be `in_transit` at a time (existing logic unchanged)
- Only ONE shipment can be in `loading` or `fully_loaded` state while another is `in_transit`? No — `loading`/`fully_loaded` are pre-trip states. Multiple shipments can be in pre-trip states simultaneously (different days).
- START TRIP is locked (disabled) if another shipment is already `in_transit` (existing logic, unchanged)

## Files Modified

1. **`Assignment.kt`** — Add `isLoading`, `isFullyLoaded`, `isReadyToDeliver` derived properties
2. **`MyTripTabAdapter.kt`** — Add `when` branches for `loading`, `fully_loaded`, `loaded` tripStatus values
3. **`MyTripActivity.kt`** — Add `START_LOADING`, `FULLY_LOADED`, `VERIFY_GUARD` actions in `onTripActionClicked`
4. **`MainActivity.kt`** — Same actions in `fetchAndSetupMyTripCards` callback handlers

## Non-Goals (out of scope)

- Web dashboard display of loading/loaded statuses (handled separately by the emap app)
- Push notifications for stage transitions
- Timer/elapsed time tracking for loading duration