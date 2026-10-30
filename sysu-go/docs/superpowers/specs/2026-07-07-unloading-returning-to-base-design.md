# Unloading + Returning-to-Base Status Feature

**Date:** 2026-07-07
**Status:** APPROVED

---

## 1. Overview

Extend the trip status flow to include a **returning-to-base** phase gated behind complete POD work. The `unloading` per-OBD-item moment triggers a brief UI step but does NOT change the persistent trip status — the trip remains `in_transit` throughout the delivery run.

---

## 2. Trip Status Flow

```
pending / confirmed
    │
    │ START TRIP
    ▼
in_transit  ────────────────────────────────────────────────────────────────┐
    │  (GPS tracking starts, driver is driving)                              │
    │                                                                         │
    │  ── PER OBD ITEM (at customer stop) ─────────────────────────────     │
    │  ARRIVED at customer → Tap "START UNLOADING [OBD#]" → Confirm         │
    │      ↓                                                                  │
    │  Brief "unloading" UI moment (driver does physical unload)           │
    │      ↓                                                                  │
    │  POD capture: Delivered / Delivered w/ Rejection / Rejection          │
    │  isPodCompleted = true for that OBD item                              │
    │      ↓                                                                  │
    │  → back to in_transit (driver continues to next stop)                  │
    │  ── repeat for every OBD item across ALL shipments ──                 │
    │                                                                         │
    └─ [ALL OBD items complete: isPodComplete = true]                       │
         → "RETURNING TO BASE" button unlocked                               │
    ▼                                                                         │
returning_to_base ──────────────────────────────────────────────────────────┘
    │  (GPS tracking continues — driver is returning to warehouse)
    │  TRIP STATUS = returning_to_base
    │
    │  ARRIVED at warehouse
    │  Driver taps "END TRIP"
    ▼
completed
    │  (GPS tracking stops, session cleared)
    ▼
```

---

## 3. Status Definitions

| Status | Persists as tripStatus? | GPS Tracking | POD Work |
|---|---|---|---|
| `pending` / `confirmed` | N/A | Off | No |
| `in_transit` | ✅ Yes | On | No |
| `unloading` | ❌ No — transient per-OBD-item moment only | On | Yes — per OBD item |
| `returning_to_base` | ✅ Yes | On | No |
| `completed` | ✅ Yes (final) | Off | No |

**Key rule:** `unloading` is NOT a persistent trip status. It is a brief UI step during POD capture. The tripStatus remains `in_transit` throughout the delivery run. Only when ALL OBD items are complete does tripStatus change to `returning_to_base`.

---

## 4. Firestore Field

Trip status lives in `sap_assignments/{docId}` as `tripStatus` (String).

New values added:
- `returning_to_base`

**`unloading` is NOT stored in Firestore — it only exists as a UI state.**

`isPodComplete` gating rule: `tripStatus` cannot transition to `returning_to_base` unless ALL OBD items across ALL shipments have `isPodCompleted = true`.

---

## 5. UI Changes

### 5.1 OBD Items Bottom Sheet (Main Unloading UI)

When tripStatus = `in_transit` and OBD item is NOT yet completed:

Each pending OBD row shows:
```
┌────────────────────────────────────────────────────────┐
│ [OBD-001234]  Customer: Garcia St.     [ 📷 START UNLOADING ] │
│               Status: PENDING                         │
└────────────────────────────────────────────────────────┘
```

**START UNLOADING button flow:**
1. Driver taps "START UNLOADING [OBD#]"
2. Confirm dialog appears:

```
┌──────────────────────────────────────────┐
│  Start Unloading?                        │
│                                          │
│  Begin unloading for [OBD Number]        │
│  at [Customer Address / Location]?       │
│                                          │
│  [Cancel]           [Confirm]           │
└──────────────────────────────────────────┘
```

3. After Confirm → brief in-sheet "UNLOADING" state (amber highlight on row)
4. POD capture sheet slides in (Delivered / Delivered w/ Rejection / Rejection)
5. POD captured → OBD item marked `isPodCompleted = true` → row shows green checkmark
6. Status returns to `in_transit`

Completed row (isPodCompleted = true):
```
┌────────────────────────────────────────────────────────┐
│ [OBD-001234]  Customer: Garcia St.     [ ✓ DELIVERED ] │
│               Status: COMPLETE                        │
└────────────────────────────────────────────────────────┘
```

### 5.2 MyTripActivity Card — Trip Status Badge

Updated badge values:

| tripStatus | Badge | Color |
|---|---|---|
| `in_transit` | "ON TRANSIT" | Red pill |
| `returning_to_base` | "RETURNING TO BASE" | Blue pill |
| `completed` | "COMPLETED" | Green pill |

**Note:** During `in_transit`, the "END TRIP" button is replaced with "RETURNING TO BASE" when `isPodComplete = true`. The button text/behavior changes dynamically — no new persistent `unloading` badge on the card needed.

### 5.3 TransitActivity — Action Button States

| State | Button Text | Color | Behavior |
|---|---|---|---|
| Not started | "START TRIP" | Red | Starts the trip |
| `in_transit` (driving) | "BACK TO HOME" | Green | Navigate to home/dashboard |
| `in_transit` + isPodComplete=true | "START RETURNING TO BASE" | Blue | Transitions to returning_to_base |
| `returning_to_base` | "ARRIVED AT WAREHOUSE" | Blue (active) | Triggers END TRIP confirmation |

### 5.4 TransitActivity Header Banner (during in_transit)

Optional summary banner during `in_transit` delivery run:

```
╔════════════════════════════════════════╗
║  🚚 DELIVERY IN PROGRESS              ║
║  5 of 11 OBD items complete            ║
║  [Open OBD Items →]                    ║
╚════════════════════════════════════════╝
```

Tapping the banner opens the OBD Items bottom sheet.

### 5.5 Progress Stepper (in TransitActivity header)

The 3-step stepper remains unchanged. `unloading` is a UI moment only — it does not add a persistent step to the stepper.

```
[1. Verified ✓] → [2. Transit ✓] → [3. Done ○]
```

When `returning_to_base` is active: all 3 steps show green / checkmark. When `completed`: all done.

---

## 6. Full POD Capture Flow (Per OBD Item)

```
1. OBD Items bottom sheet open
   → Row shows "START UNLOADING [OBD Number]" button

2. Driver taps → Confirm dialog
   [Cancel] [Confirm]

3. On Confirm:
   → Brief "unloading moment" state on the row (amber)
   → ObdStatusBottomSheet appears

4. ObdStatusBottomSheet:
   [Delivered]
   [Delivered w/ Rejection]
   [Rejection]

5. Driver selects status → Camera launches → Photo captured

6. Firestore update:
   lineItems[i].deliveryStatus = selected_status
   lineItems[i].podImageUrl = base64_photo
   lineItems[i].podCapturedAt = timestamp
   lineItems[i].isPodCompleted = true

7. Bottom sheet refreshes → Row shows green ✓
   → Driver continues to next pending OBD item
   → tripStatus remains "in_transit"
```

**Repeat until ALL OBD items across ALL shipments have `isPodCompleted = true`.**

---

## 7. Transition to `returning_to_base`

When the LAST OBD item is marked complete (isPodComplete transitions to true):

1. **Automatic or manual?** → Decided: Manual trigger via TransitActivity button (not automatic)
2. Driver opens TransitActivity
3. Button shows **"START RETURNING TO BASE"** (enabled because isPodComplete = true)
4. Driver taps → Confirm dialog:

```
┌──────────────────────────────────────────────┐
│  Start Returning to Base?                    │
│                                              │
│  All 11 OBD items have been delivered.      │
│  Begin returning to warehouse?              │
│                                              │
│  [Cancel]              [Confirm]           │
└──────────────────────────────────────────────┘
```

5. On Confirm:
   - `tripStatus` → `returning_to_base`
   - `returnedToBaseAt` → Timestamp.now()
   - Button changes to **"ARRIVED AT WAREHOUSE"**

6. Driver drives back to warehouse

7. Driver taps **"ARRIVED AT WAREHOUSE"** → END TRIP confirm → `tripStatus` → `completed`

---

## 8. Backend / Server Requirements

- **No schema changes** — `tripStatus` field accepts new string values; `returning_to_base` is a valid Firestore string
- **Socket.IO `driver_moving`** — must continue emitting during `returning_to_base` phase so dispatch map shows driver returning
- **`tripStatus` in `sap_updated`** — server must include the updated `tripStatus` in all broadcast events

---

## 9. Files to Modify

### Android (app/)

| File | Change |
|---|---|
| `model/Assignment.kt` | Add `returning_to_base` to tripStatus checks; `isPodComplete` used for gating |
| `activities/TransitActivity.kt` | Add `returning_to_base` button state; when tripStatus=`in_transit`+isPodComplete→show "START RETURNING TO BASE"; `returning_to_base`→show "ARRIVED AT WAREHOUSE"; GPS tracking continues in both phases; emit correct status to socket |
| `activities/MyTripActivity.kt` | `returning_to_base` badge on card; ensure bottom sheet handles in_transit deliveries correctly; isPodComplete gates the return button logic |
| `adapter/MyTripTabAdapter.kt` | Add "RETURNING TO BASE" badge (blue); "START RETURNING TO BASE" button on in_transit cards when isPodComplete; "ARRIVED AT WAREHOUSE" when returning_to_base; hide/show verification button as appropriate |
| `activities/ObdItemsBottomSheet.kt` | Add "START UNLOADING" button per pending OBD row; confirm dialog; brief unloading state on row; existing POD camera/status flow unchanged |
| `layout/item_my_trip_tab_card.xml` | Update badge display for `returning_to_base` (blue pill) |
| `layout/activity_transit.xml` | Update button colors for "START RETURNING TO BASE" (blue); add optional header banner for delivery progress |
| `drawable/` | Add `bg_status_pill_blue` for "RETURNING TO BASE" badge |

---

## 10. Changes NOT Needed

- **POD capture flow** (ObdStatusBottomSheet camera + status selection) — unchanged
- **Stepper in TransitActivity** — no new persistent step for `unloading`
- **Firestore schema** — no new fields; `returning_to_base` is a string value for existing `tripStatus` field
- **Socket.IO events** — no new events; `driver_moving` continues; `tripStatus` sent in existing `sap_updated` broadcasts

---

## 11. Spec Self-Review

- [x] Placeholder scan: no TODOs or TBDs remaining — all decisions finalized
- [x] Internal consistency: stepper (3-step), button states, badge colors all aligned
- [x] Scope check: `unloading` = per-OBD-item UI moment only (NOT persisted), `returning_to_base` = persistent tripStatus, scope is focused
- [x] Ambiguity check: all decisions confirmed with user — `unloading` is brief/per-item, `returning_to_base` locked behind isPodComplete, confirm dialog simple OK/Cancel, unload trigger in OBD bottom sheet, transitActivity shows current OBD during unloading

---

**Next:** → Invoke writing-plans skill for implementation plan.