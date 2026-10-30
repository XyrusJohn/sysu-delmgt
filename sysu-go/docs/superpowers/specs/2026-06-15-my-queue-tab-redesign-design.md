# My Queue Tab — Full Queue Detail Display Per Shipment

**Date:** 2026-06-15
**Status:** Approved → Implementation Planned
**Scope:** Phase 1 (`cardMyQueue`) and Phase 2 (`rvShipmentCards`) both show full queue detail per shipment — matching `activity_queue_details.xml` design, with all shipment data from Firestore, zero business logic changes.

---

## 1. Problem Statement

Current My Queue tab in `MainActivity`:
- **Phase 1** (0-1 shipments): `cardMyQueue` is a simple 2-line card (icon + "My Queue" + subtitle). No shipment detail visible.
- **Phase 2** (2+ shipments): `rvShipmentCards` shows simple 2-line cards (same as Phase 1). No detail visible.

The full queue detail design exists in `activity_queue_details.xml` (used by `QueueDetailsActivity`). It shows:
- Red banner with animated circles + queue number
- Overlapping details card (shipment #, plate, truck, helper)
- Customer requirements (6 items, 2-col grid)
- Planned delivery date
- Tappable OBD items card with count pill
- Guard verification section (guard selection → sign → verify & send)
- Floating "View Verification" pill when guard verified

The user wants BOTH Phase 1 and Phase 2 to show this same level of detail — **one full queue detail per shipment**.

---

## 2. Design Integration Strategy

**Decision: Two-slot surgical expansion**

### Architecture:
- `cardMyQueue` (Phase 1): inner LinearLayout replaced with full detail content — same as `activity_queue_details.xml` stripped of its scroll host and outer header
- `rvShipmentCards` (Phase 2): `item_shipment_card.xml` replaced with a full detail item `item_shipment_queue_detail.xml`
- Same Firestore data (`currentShipments` list, `Assignment` model — no changes)
- Same bottom sheets (`ObdItemsBottomSheet`, `GuardSelectionBottomSheet`, `SignaturePadBottomSheet`, `GuardVerificationBottomSheet`)
- Same Firestore write path for guard verification

### What NOT changing:
- `syncShipmentCards()` — builds `currentShipments` from Firestore, unchanged
- `updateQueueTabs()` — Phase 1/2 visibility switch, unchanged
- `updateQueueUI()` — queue status text update, unchanged
- Phase 1/2 switching logic — unchanged
- All Firestore listeners — unchanged
- Guard verification flow — unchanged (uses same bottom sheets, same Firestore writes)
- Requirements loading — unchanged (from `drivers/{driverId}/requirements`)
- Bottom sheet classes — **completely unchanged** (reused as-is)

### Constraint chain change in `activity_main.xml`:
`cardMyQueue` currently has `bottom→cardScanCTA.top`. When expanded with `wrap_content`, this creates an oversized fixed height. **Remove** that bottom anchor from `cardMyQueue` so it expands freely in Phase 1.
- Phase 1: `cardMyQueue` top→`tvMyQueueLabel.bottom`, no bottom anchor → expands to content
- Phase 2: `cardMyQueue` GONE, `rvShipmentCards` top→`tvMyQueueLabel.bottom`, bottom→`cardScanCTA.top` → unchanged

`tvMyQueueLabel`: hidden in Phase 1 (redundant — the detail card has its own "My Queue" header), visible in Phase 2.

---

## 3. Layout File Changes

### 3.1 `activity_main.xml` — `cardMyQueue`

**Remove** from `cardMyQueue`:
```xml
app:layout_constraintBottom_toTopOf="@id/cardScanCTA"
app:layout_constraintVertical_bias="0.0"
```

**Replace** inner `<LinearLayout>` with full detail content from `activity_queue_details.xml`.

The root `MaterialCardView` ID stays `cardMyQueue`. Constraints become:
```xml
app:layout_constraintTop_toBottomOf="@id/tvMyQueueLabel"
app:layout_constraintStart_toStartOf="parent"
app:layout_constraintEnd_toEndOf="parent"
android:layout_marginHorizontal="24dp"
android:layout_marginTop="8dp"
android:layout_marginBottom="8dp"
```

**Hide `tvMyQueueLabel`** in Phase 1 (`View.GONE`), show in Phase 2 (`View.VISIBLE`).

**Phase 1 cardMyQueue structure (all inside MaterialCardView, vertical stack):**

```
MaterialCardView (cardMyQueue)
├── FrameLayout (myQueueBannerStack) — no padding, match_parent width, 0dp height
│   ├── FrameLayout (myQueueQueueBanner) — red 260dp banner, z-order 0
│   │   ├── FrameLayout (myQueueCircleContainer) — animated circles
│   │   └── LinearLayout — queue number label + number
│   └── CardView (myQueueCardDetails) — overlap at 180dp, z-order 1
│       └── LinearLayout (vertical)
│           ├── Shipment number row
│           ├── Plate no row
│           ├── Truck type row
│           ├── Helper row
│           ├── Requirements grid (2-col)
│           └── Planned delivery row
├── NestedScrollView (myQueueScrollContent) — 0dp height, wrap_content
│   └── LinearLayout (vertical)
│       ├── OBD Items tappable card
│       ├── Guard verification section
│       └── Bottom padding (100dp)
└── MaterialCardView (cardFloatingViewVerification) — NOT inside ScrollView
    (floats above all, visibility gone by default)
```

**View ID naming convention** inside `cardMyQueue`:
Prefix all IDs with `myQueue` to avoid conflicts with existing `activity_main.xml` views and future Phase 2 `item_shipment_queue_detail.xml` IDs.

### 3.2 `item_shipment_queue_detail.xml` (NEW FILE)

Replaces `item_shipment_card.xml` for Phase 2 list items.

Same structure as Phase 1 `cardMyQueue` inner content, but with **RecyclerView item context** (position-aware binding) and `wrap_content` heights adjusted for list item use.

Key differences from Phase 1:
- IDs prefixed with `shi` (shipment item): `shiQueueBanner`, `shiCardDetails`, `shiCircleContainer`, `shiScrollContent`, etc.
- `shiTvShipmentNumber` = `assignment.shipmentNumber`
- `shiTvQueueNumber` = queue position (from `syncShipmentCards` position tracking)
- `shiTvPlateNo` = `assignment.plateNumber`
- `shiTvTruckType` = `assignment.truckType`
- `shiTvHelper` = `assignment.helper`
- `shiTvDeliveryDate` = `assignment.deliveryTimestamp` (formatted)
- `shiTvObdCount` = `assignment.obdCount`
- `shiTvReqAircon` etc. = `assignment.requirements[key]`
- Guard section shows per-shipment: `shiGuardVerificationSection`, `shiCardSelectGuard`, `shiBtnSign`, `shiBtnVerify`
- `shiCardFloatingViewVerification` shown when `assignment.guardVerified == true`

For the guard verification per shipment, each item needs:
- Its own guard selection state (stored in a `LinkedHashMap<String, ShipmentGuardState>` in MainActivity keyed by `docId`)
- Guard selection → bottom sheet → signature → verify per shipment
- The `Assignment` model already has `guardVerified`, `guardFirstName`, `guardLastName`, `guardSignature` fields — these are per-shipment in Firestore already

---

## 4. Data Architecture (No Changes)

All data comes from existing `currentShipments: List<Assignment>` populated by `syncShipmentCards()`.

| View | Data Source |
|---|---|
| Queue number | `queue.position` — resolved from `syncShipmentCards` queue query (existing, already in `updateQueueUI`) |
| Shipment number | `assignment.docId` / `assignment.shipmentNumber` |
| Plate no. | `assignment.plateNumber` |
| Truck type | `assignment.truckType` |
| Helper | `assignment.helper` |
| Requirements | `assignment.requirements` Map (already populated) |
| Delivery date | `assignment.deliveryTimestamp` (already in model) |
| OBD count | `assignment.obdCount` (already in model) |
| Guard verification | `assignment.guardVerified` etc. (already in model from Firestore) |

**Guard verification per shipment**: The `Assignment` model already stores `guardVerified`, `guardId`, `guardFirstName`, `guardLastName`, `guardSignature` per shipment. The existing Firestore write path in `QueueDetailsActivity.saveVerificationToFirestore()` writes to `sap_assignments/{docId}`. This same path works for Phase 1 and Phase 2 — data is per-shipment in Firestore already.

**Per-shipment guard state during selection** (before verify is tapped): `LinkedHashMap<String, GuardSelectionState>` in MainActivity:
```kotlin
data class GuardSelectionState(
    val selectedGuardId: String = "",
    val pendingSignatureBase64: String? = null
)

// Keyed by assignment.docId
private val guardSelectionState = LinkedHashMap<String, GuardSelectionState>()
```

---

## 5. MainActivity.kt Changes

### 5.1 Update Phase 1 `cardMyQueue` content

In `setupUI()`, replace the simple 2-line inner LinearLayout with full content binding:
- Bind all `myQueue*` views to `currentShipments.getOrNull(0)`
- `startMyQueueCircleAnimation()` — moved from `QueueDetailsActivity`, identical logic
- OBD items click → `ObdItemsBottomSheet.newInstance(lineItems)`
- Guard selection → `GuardSelectionBottomSheet` with per-shipment state
- Sign → `SignaturePadBottomSheet` with per-shipment state
- Verify → `saveVerificationToFirestore(docId, selectedGuard, signature)` — new helper method (same logic as `QueueDetailsActivity`)

### 5.2 New Phase 2 adapter: `ShipmentCardDetailAdapter`

**Create** `app/src/main/java/com/sysu/go/adapter/ShipmentCardDetailAdapter.kt`:
- Uses `item_shipment_queue_detail.xml` (new layout)
- **Same DiffUtil** as `ShipmentCardAdapter` (no change)
- Phase 2 `updateQueueTabs()` switches to this adapter from `ShipmentCardAdapter`
- Binds per-item: each `Assignment` in `currentShipments` drives one item
- Guard verification: shows per-shipment state from `guardSelectionState` map
- Each item has its own complete bottom section (OBD items, guard verification, floating button if verified)

### 5.3 Update `updateQueueTabs()`

```kotlin
private fun updateQueueTabs() {
    when {
        currentShipments.size < 2 -> {
            binding.rvShipmentCards.visibility = View.GONE
            binding.cardMyQueue.visibility = View.VISIBLE
            binding.tvMyQueueLabel.visibility = View.GONE  // hide "MY QUEUE" label — card has its own header
            updateCardMyQueueContent()  // new: bind Phase 1 detail to first shipment
            return
        }
        else -> {
            binding.cardMyQueue.visibility = View.GONE
            binding.tvMyQueueLabel.visibility = View.VISIBLE
            binding.rvShipmentCards.visibility = View.VISIBLE
            // Switch to detail adapter for Phase 2
            setupShipmentCardDetailAdapter()  // new: creates ShipmentCardDetailAdapter
            binding.rvShipmentCards.adapter = shipmentCardDetailAdapter
            shipmentCardDetailAdapter.submitList(currentShipments.toList())
        }
    }
}
```

### 5.4 Remove `cardMyQueue.setOnClickListener { openQueueDetails() }`

Phase 1 `cardMyQueue` now shows full detail content — the user can see OBD items, guard verification, guard status directly. No need to tap to open `QueueDetailsActivity`. The floating "View Verification" button and per-shipment details are visible.

However, we can **keep a tap on the `cardMyQueue` banner area** to still open `AssignmentActivity` for the active shipment — surgical, preserves existing function.

### 5.5 Guard verification flow

In `MainActivity`, add:
```kotlin
private val guardSelectionState = LinkedHashMap<String, GuardSelectionState>()

data class GuardSelectionState(
    val selectedGuard: SecurityGuard? = null,
    val pendingSignatureBase64: String? = null
)

private fun updateCardMyQueueContent() { /* bind Phase 1 card to currentShipments[0] */ }

private fun setupShipmentCardDetailAdapter() {
    shipmentCardDetailAdapter = ShipmentCardDetailAdapter(
        sessionActiveDocId = SessionManager(this).getActiveSapDocId(),
        guardSelectionState = guardSelectionState,
        onObdItemsClick = { assignment, lineItems -> /* open ObdItemsBottomSheet */ },
        onGuardSelected = { docId, guard -> /* update guardSelectionState, rebind item */ },
        onSignClick = { docId -> /* open SignaturePadBottomSheet, set pendingSignature */ },
        onVerifyClick = { docId, guard, signature -> /* write to Firestore, update guardVerified */ },
        onViewVerificationClick = { assignment -> /* open GuardVerificationBottomSheet */ }
    )
}
```

---

## 6. Security Guard Repository

`SecurityGuardRepository` is already used in `QueueDetailsActivity`. In `MainActivity`, load guards on startup:
```kotlin
private val securityGuardRepository = SecurityGuardRepository(this)
private var securityGuards: List<SecurityGuard> = emptyList()
```

In `onCreate`: call `repository.getCachedGuards()` and refresh in background.

---

## 7. File Map

| File | Change |
|---|---|
| `activity_main.xml` | `cardMyQueue` inner content replaced with full detail; `tvMyQueueLabel` visibility toggle added; `cardMyQueue` bottom anchor removed |
| `item_shipment_card.xml` | **Replaced by** `item_shipment_queue_detail.xml` (full detail item) |
| `item_shipment_queue_detail.xml` | **NEW** — full queue detail item for Phase 2 RecyclerView |
| `MainActivity.kt` | New adapter `ShipmentCardDetailAdapter`, `guardSelectionState` map, `updateCardMyQueueContent()`, `setupShipmentCardDetailAdapter()`, Phase 1/2 content binding, guard verification flow |
| `ShipmentCardAdapter.kt` | **Replaced by** `ShipmentCardDetailAdapter` |

**No changes**: `ObdItemsBottomSheet`, `GuardSelectionBottomSheet`, `SignaturePadBottomSheet`, `GuardVerificationBottomSheet`, `AssignmentActivity`, `QueueDetailsActivity`, `Assignment` model, `SecurityGuard` model, `SecurityGuardRepository`, `SessionManager`, `FirestoreListener` setup.

---

## 8. Task Decomposition

### Task 1: Replace `cardMyQueue` inner content in `activity_main.xml`
- Remove bottom anchor from `cardMyQueue`
- Replace inner LinearLayout with full detail stack (banner, overlapping card, scroll content, floating button)
- Prefix all new view IDs with `myQueue`
- Add `myQueueTvSubStatus` below the top "My Queue" header

### Task 2: Create `item_shipment_queue_detail.xml`
- Full queue detail item layout for Phase 2 RecyclerView items
- Prefixed IDs: `shi*`
- Same structure as Phase 1 content

### Task 3: Create `ShipmentCardDetailAdapter.kt`
- New adapter using `item_shipment_queue_detail.xml`
- Same DiffUtil as `ShipmentCardAdapter`
- Per-item guard state from `guardSelectionState` map
- Per-item OBD items from `Assignment.obdCount` + line items from Firestore

### Task 4: Add guard verification to MainActivity
- `guardSelectionState` LinkedHashMap
- Guard loading via `SecurityGuardRepository`
- Guard selection → bottom sheet → sign → verify (same as `QueueDetailsActivity` logic)
- `saveGuardVerification(docId, guard, base64)` — writes to `sap_assignments/{docId}`
- `updateCardMyQueueContent()` — binds Phase 1 `cardMyQueue` to `currentShipments[0]`

### Task 5: Update `updateQueueTabs()` + `setupUI()`
- `updateQueueTabs()` → Phase 1: show & bind `cardMyQueue`, hide `tvMyQueueLabel`; Phase 2: hide `cardMyQueue`, show `tvMyQueueLabel`, use `ShipmentCardDetailAdapter`
- `setupUI()` → initialize guard repository, load guards

### Task 6: Build, test, verify
- Build clean
- Phase 1 (0-1 shipments): full detail card visible with correct data
- Phase 2 (2+ shipments): full detail list items visible, guard verification per item
- Guard verification end-to-end works
- All existing functions unchanged

---

## 9. Acceptance Criteria

1. Phase 1: `cardMyQueue` shows full queue detail page (banner, queue number, shipment #, plate, truck, helper, requirements, delivery, OBD items tappable, guard verification) for the first shipment
2. Phase 2: Each shipment in `rvShipmentCards` shows the same full detail layout
3. `tvMyQueueLabel` hidden in Phase 1, visible in Phase 2
4. When `guardVerified == true`: floating "VIEW VERIFICATION" button shows; guard section hides
5. Guard verification works per-shipment (select guard → sign → verify → floating button)
6. OBD items tappable → opens `ObdItemsBottomSheet` with that shipment's items
7. Circle animation plays on `cardMyQueue` red banner
8. `cardScanCTA` stays pinned above `bottomNavContainer` in all states
9. All existing click handlers (bottom nav, scan button, profile, cancel queue) unchanged
10. No changes to `ObdItemsBottomSheet`, `GuardSelectionBottomSheet`, `SignaturePadBottomSheet`, `GuardVerificationBottomSheet`
11. Build: `BUILD SUCCESSFUL`