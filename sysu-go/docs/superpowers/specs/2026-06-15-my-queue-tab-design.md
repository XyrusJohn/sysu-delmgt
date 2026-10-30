# My Queue Tab — Embedded Queue Details Design

**Date:** 2026-06-15
**Author:** Claude (via brainstorming with user)
**Status:** APPROVED — ready for implementation

---

## Overview

Replace `cardMyQueue` in `MainActivity`'s Home tab with a full-fidelity queue detail view. The new structure replaces the existing simple card (ticket icon + subtitle) with:

- A **pinned red banner** showing queue number + status
- A **scrollable content area** containing the shipment details card, customer requirements, OBD items, and guard verification
- A floating **"VIEW VERIFICATION" pill** when guard has verified

The change is **strictly additive to the layout** — `tvMyQueueLabel` (section label), `rvShipmentCards`, and `cardScanCTA` are untouched.

---

## Layout Structure (from top to bottom, Home tab)

```
tvMyQueueLabel  (existing, stays pinned)
│
├── Queue Banner  [NEW — replaces cardMyQueue in DOM position]
│   ├── Red background  (sysu_red)
│   ├── Animated floating circles (existing pattern)
│   ├── "QUEUE NUMBER" label (small caps, white, 70% opacity)
│   ├── Queue number: "1", "2", "LOADING", "GO", or "—"  (bold, large)
│   └── Sub-status label: "Ready to depart" / "Shipment Assigned" / etc.
│
├── Scrollable Content  [NEW — scrolls under the banner]
│   ├── Shipment Details Card  (overlaps banner bottom by 20dp)
│   │   ├── Shipment Number row
│   │   ├── Plate No row
│   │   ├── Truck Type row
│   │   ├── Helper row
│   │   ├── Separator
│   │   ├── Customer Requirements  (6-item table: Aircon, Vest, Headcap, Shoes, Pants, Closed)
│   │   ├── Separator
│   │   └── Planned Delivery row (date + time)
│   │
│   ├── OBD Items Card  [tappable — opens ObdItemsBottomSheet]
│   │   ├── Red top bar (3.5dp)
│   │   ├── "OBD ITEMS" label + count pill + chevron
│   │
│   └── Guard Verification Card
│       ├── "Guard Verification" header
│       ├── Guard selection card → GuardSelectionBottomSheet
│       ├── "SIGN" button → SignaturePadBottomSheet (only when guard selected)
│       └── "VERIFY & SEND" button (only after signature confirmed)
│
├── Floating "VIEW VERIFICATION" Pill  [only when guardVerified == true]
│   (overlaps bottom, anchored above bottom nav, not part of scroll)
│
cardScanCTA  (existing, stays — anchored to bottom nav)
```

---

## Visibility Rules

### Driver NOT in queue
- Banner: **gone**
- Scrollable content: **gone**
- `cardMyQueue` (simple card): still gone (current behavior — nothing to show)
- `cardScanCTA` shown (QR scan prompt)
- `tvScanHint` shows "Show QR code at booth to check in"

### Driver IN QUEUE, 1 shipment
- Banner: **visible** (queue number)
- Scrollable content: **visible** (full detail)
- `cardMyQueue` (simple card): **hidden**
- `cardScanCTA`: **hidden**
- `rvShipmentCards` (2+ shipments RecyclerView): **hidden** (size < 2)

### Driver IN QUEUE, 2+ shipments
- Banner: **visible**
- Scrollable content: **visible** (first shipment details, or a summary)
- `cardMyQueue`: **hidden**
- `cardScanCTA`: **hidden**
- `rvShipmentCards`: **visible** (vertical list of simple shipment cards for other shipments)

---

## View Components

### 1. Queue Banner (layout: `my_queue_banner.xml`)
- Height: 160dp
- Background: `sysu_red`
- Animated circles (same `circleContainer` + bounce pattern used in `redHeader` / `QueueDetailsActivity`)
- `tvQueueNumberLabel`: "QUEUE NUMBER" — 11sp, white, 70% opacity, letter-spacing 0.05
- `tvQueueNumber`: queue position number — fallback text "—" if not available
- `tvSubStatus`: "Ready to depart" / "Assigned" / "Being loaded" / etc. — 13sp, white, 90% opacity

### 2. Shipment Details Card (layout: `my_queue_shipment_card.xml`)
- Overlaps banner bottom by **20dp** (negative marginTop)
- CardView with no elevation (flat), background white, corner radius 16dp, stroke 1dp #EEEEEE
- Same shipment fields as `QueueDetailsActivity`:
  - Shipment Number (from sap_assignments docId, truncated)
  - Plate No (from queue doc)
  - Truck Type / company name
  - Helper name
  - **Customer Requirements** — 6-item grid (3 + 3 columns), icon + label + checkmark/dash
  - Planned Delivery date/time
- Does NOT include guard verification (that's in the section below)

### 3. OBD Items Card (layout: `my_queue_obd_card.xml`)
- Same as `cardObdItems` in `QueueDetailsActivity`:
  - Red top bar (3.5dp)
  - "OBD ITEMS" label + count pill + expand chevron
- Tap → `ObdItemsBottomSheet.newInstance(currentLineItems)`

### 4. Guard Verification Card (layout: `my_queue_guard_card.xml`)
- Tap guard card → `GuardSelectionBottomSheet` (existing)
- SIGN button → `SignaturePadBottomSheet` (existing) → on confirmed, show VERIFY & SEND
- VERIFY & SEND button → writes to Firestore `sap_assignments` (existing pattern in `QueueDetailsActivity`)

### 5. Floating VIEW VERIFICATION Pill
- Same as `cardFloatingViewVerification` in `QueueDetailsActivity`
- Only visible when `guardVerified == true`
- Anchored to bottom above `cardScanCTA` / bottom nav
- Tap → `GuardVerificationBottomSheet` (existing)

---

## Constraint Chain (Home tab)

```
tvMyQueueLabel (existing)
  ↓ top margin 20dp
bannerQueueCard (NEW — pinned, no scroll, fixed height ~160dp with overlap)
  ↓ negative marginTop overlaps banner
scrollContent (NEW — fills remaining space, scrolls)
  ↓
cardScanCTA (existing)
  ↓
bottomNavContainer (existing)
```

For the overlap to work: `bannerQueueCard` bottom is constrained to start of scroll area with no margin; `scrollContent` uses `constraintVertical_bias="0"` and `marginTop` accounts for the banner's visual height minus overlap.

**Simplest implementation:** Use `FrameLayout` as parent for `bannerQueueCard` + `scrollContent` in the chain, where `bannerQueueCard` has `elevation="2dp"` and is above the scroll content. Scroll area clips to avoid drawing over banner bottom.

---

## Data Flow

- `MainActivity` already listens to Firestore via `listenToQueueStatus()` and `listenToAssignment()`
- `currentShipments` (List<Assignment>) holds loaded shipment data
- Kotlin state flags already exist: `isInQueue`, `hasShipment`, `isGuardVerified`
- New UI fields are added to `ActivityMainBinding` via `activity_main.xml`
- ViewModel pattern NOT introduced — all binding updates stay in `MainActivity` (consistent with existing code)
- All bottom sheets (ObdItems, GuardSelection, SignaturePad, GuardVerification) are **reused** from `QueueDetailsActivity` — no new sheets needed

---

## Rollout Steps (Implementation Order)

These are **safe, incremental steps** — existing `cardMyQueue` becomes invisible only once the new content is wired to real Firestore data and confirmed working.

1. **New layout file** (`my_queue_detail_section.xml`) — banner + shipment card + requirements + OBD + guard; uses `include` or inline FragmentLayout
2. **Add views to `activity_main.xml`** — insert new section, keep `cardMyQueue` in DOM (initially `visibility="gone"`)
3. **Wire Firestore data to new fields** — populates banner queue number and shipment details from existing `currentShipments` / queue listener
4. **Show/hide logic** — `isInQueue` toggle shows/hides new section; `cardMyQueue` stays gone
5. **Guard verification flow** — connect SIGN → SignaturePad → VERIFY & SEND (same as `QueueDetailsActivity`)
6. **OBD items tap** → opens `ObdItemsBottomSheet` with `currentLineItems`
7. **Floating VERIFICATION pill** — only shown when `guardVerified == true`
8. **Verify all existing flows work** — QR scan, `cardScanCTA`, bottom nav, logout, etc.
9. **Remove old `cardMyQueue` references** (DOM cleanup, optional deferred step)
10. **Commit**

---

## Files Changed

| File | Change |
|------|--------|
| `activity_main.xml` | Add `bannerQueueCard` + `scrollContent` section; keep `cardMyQueue` in DOM initially |
| `MainActivity.kt` | Wire banner fields, guard verification, OBD tap; remove `cardMyQueue` click listener |
| `my_queue_banner.xml` | New layout — red banner with queue number + circles |
| `my_queue_shipment_card.xml` | New layout — shipment details + requirements table |
| `my_queue_obd_card.xml` | New layout — OBD items tappable card |
| `my_queue_guard_card.xml` | New layout — guard selection + sign + verify buttons |

---

## Boundary Conditions

- If driver has 2+ shipments and `rvShipmentCards` is visible, the new section shows **first shipment's** details (consistent with how `cardQueueStatus` works today via `updateQueueUI` with `firstShipmentId`)
- If `guardVerified == true` when the section loads: guard card section hidden, floating pill shown (same logic as `QueueDetailsActivity`)
- If Firestore data not yet loaded: show "—" placeholder for all fields, queue number "—" — consistent with `QueueDetailsActivity`
- OBD Tap opens bottom sheet with `currentLineItems`; empty list shows empty bottom sheet (existing `ObdItemsBottomSheet` handles this gracefully)

---

## Anti-Breakage Checklist

- [x] `cardScanCTA` anchor not changed — it is still `app:layout_constraintBottom_toTopOf="@id/bottomNavContainer"`
- [x] `rvShipmentCards` constraint anchors unchanged — `app:layout_constraintTop_toBottomOf="@id/tvMyQueueLabel"` and `app:layout_constraintBottom_toTopOf="@id/cardScanCTA"`
- [x] `cardMyQueue` click → `openQueueDetails()` — existing, no change needed during transition
- [x] No bottom navigation changes — Home / Profile tabs untouched
- [x] Existing Firestore listeners (`listenToQueueStatus`, `listenToAssignment`) reuse the same data (`currentShipments`, flags) — no new API calls needed
- [x] `openQueueDetails()` still routes to `QueueDetailsActivity` — `cardMyQueue` still navigates there until removed