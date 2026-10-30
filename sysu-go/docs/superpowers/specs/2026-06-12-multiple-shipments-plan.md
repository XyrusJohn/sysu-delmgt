# Multiple Shipments - Phase 1 Implementation Plan

## What We're Building
- Dashboard: single `cardMyQueue` → **horizontal scrollable tab row** (tabs = queue entries)
- Assignment screen: accessible via **map icon** (appears when `hasShipment && isGuardVerified`)
- Assignment screen shows **one card per shipment** (same fields as QueueDetailsActivity + Start/End Trip)
- **Start Trip lock**: only 1 trip active at a time. If Shipment A is in transit, Shipment B's Start Trip button is grayed/disabled
- Phase 1: works with existing 1-doc Firestore. Data architecture supports multiple docs when sysu-app is ready

---

## Files to Create/Modify

### New Files
1. `app/src/main/java/com/sysu/go/model/Assignment.kt` — data class `Assignment(id, queueDocId, driverId, status, tripStatus, plateNumber, truckType, helper, shipmentNumber, guardVerified, ...)`
2. `app/src/main/java/com/sysu/go/activities/AssignmentActivity.kt` — shows one card per shipment
3. `app/src/main/res/layout/activity_assignment.xml` — header with bouncing circles red navbar + scrollable card list
4. `app/src/main/res/layout/item_assignment_card.xml` — reusable shipment card (plate, truck, helper, requirements, guard status, Start/End Trip)
5. `app/src/main/java/com/sysu/go/adapter/AssignmentAdapter.kt` — `RecyclerView.Adapter` for assignment cards

### Files to Modify
6. `app/src/main/java/com/sysu/go/utils/SessionManager.kt` — add `activeSapDocId` field for cross-activity trip lock
7. `app/src/main/res/layout/activity_main.xml` — replace `cardMyQueue` with horizontal `TabLayout` + `ViewPager2` inside the dashboard scroll area
8. `app/src/main/java/com/sysu/go/activities/MainActivity.kt`
   - Remove singular `currentQueueDocId` → use list `List<Pair<queueDocId, shipmentId>>`
   - Replace `cardMyQueue` click + UI with tab navigation
   - Keep existing `listenToQueueStatus` logic — adapt to populate list
   - In `btnScanQR` click: when `hasShipment && isGuardVerified` → navigate to `AssignmentActivity` (new), NOT `TransitActivity`
9. `app/src/main/res/values/strings.xml` — add string resources

---

## Step-by-Step Implementation Order

### Step 1: SessionManager — add activeSapDocId tracking
- Add `saveActiveSapDocId(String?)` and `getActiveSapDocId()` to `SessionManager`
- Used by ALL assignment cards to know which shipment is active/locked

### Step 2: Assignment model
- Create `data class Assignment` with all fields from `sap_assignments` + queue-derived fields (helper, truckType)
- Include `isLocked` computed property: `tripStatus == "in_transit" && docId != SessionManager.getActiveSapDocId()`

### Step 3: item_assignment_card.xml
- Compact card matching `activity_queue_details.xml` + `activity_transit.xml` fields:
  - Shipment Number (top, bold)
  - Plate Number, Truck Type (with red accent bars)
  - Helper
  - Customer Requirements (compact rows)
  - Guard verification status (checkmark if verified, "Tap to verify" if not)
  - OBD count with chevron
  - **START TRIP / END TRIP button** — red if not started, green if in transit, **disabled+gray** if locked
- When locked: button shows "LOCKED" and `alpha=0.4`, `isEnabled=false`

### Step 4: item_assignment_card layout placement in activity_assignment.xml
- `activity_assignment.xml`: full-screen, header with back + "My Trip" title, **red banner with bouncing circles** (same `circleContainer` pattern as QueueDetailsActivity/TransitActivity), then scrollable content area
- For Phase 1 (1 shipment): 1 card fills the content
- RecyclerView loads `AssignmentAdapter` with list of `Assignment` objects

### Step 5: AssignmentAdapter
- `submitList(List<Assignment>)` — diff util
- Each holder binds: shipment number, plate, truck type, helper, guard status, button state (Start/End Trip/Locked)
- Locked state: button disabled, shows "LOCKED"
- In-transit state: button shows "END TRIP", green
- Not-yet-started + guard verified: button shows "START TRIP", red

### Step 6: AssignmentActivity.kt
- Loads all `sap_assignments` for driver (query by driverId from SessionManager) — returns `List<Assignment>`, same list used for both `MainActivity` tabs and this screen
- `startTrip(docId)`: sets `SessionManager.saveActiveSapDocId(docId)`, calls Firestore `update(tripStatus=in_transit)`, notifies adapter to refresh all cards (other cards lock)
- `endTrip(docId)`: clears `SessionManager.saveActiveSapDocId(null)`, Firestore `update(tripStatus=completed)`, notifies adapter (all cards unlocked)
- Red bouncing circles: same pattern as `QueueDetailsActivity.startCircleAnimation()`
- On resume (pop back from TransitActivity after start trip): reload list to pick up active trip state

### Step 7: MainActivity tab system — replace cardMyQueue
- Keep existing `listenToQueueStatus()` — it returns 1 doc today
- Adapt: convert single-item logic to list. Add `activeAssignments: List<Assignment>` field
- `cardMyQueue` → **horizontal `RecyclerView` of tab views** showing each queue entry
  - Each tab: `MaterialCardView` (compact, ~200dp wide) with Queue number/status, tap → `openQueueDetails(queueId)` (existing behavior)
  - Tab layout sits ABOVE the `cardScanCTA` CTA card in the scroll hierarchy
  - If only 1 queue: tabs still visible but horizontal scrolling not needed (only 1 tab)
  - If 0 queues: hide the tab row entirely
- Tab row hidden when not in queue (same visibility as current `cardMyQueue`)

### Step 8: MainActivity navigation — map icon → AssignmentActivity
- In `setupUI()` `btnScanQR` click handler:
  - **Existing**: `hasShipment && isGuardVerified` → `startActivity(TransitActivity)`
  - **New**: `hasShipment && isGuardVerified` → `startActivity(AssignmentActivity)`
  - `AssignmentActivity` handles the per-shipment Start Trip
- `isGuardVerified` guard: ensures only verified drivers can access Assignment screen (map icon only shows AFTER verification anyway)

### Step 9: Strings
- Add: `my_trip`, `locked`, `shipment_short` (tab short label)

---

## Key Architectural Decisions

### Data source: `sap_assignments` only
Each shipment's data comes from Firestore `sap_assignments` documents + optionally `queue` collection for helper/truckType (queue has fields sap doesn't: helperName, truckType).

Since queue query today returns 1 doc → `sap_assignments` query also returns 1 doc → 1 Assignment in list → 1 tab + 1 card. Works today, scales tomorrow.

### Active trip lock
`SessionManager.saveActiveSapDocId(docId)` is set when driver taps "START TRIP" on any card. All cards check this on bind to decide if their button should be locked. Firestore `tripStatus == "in_transit"` is the source of truth; SharedPrefs is the session cache (survives process death).

### Card reuse
`item_assignment_card.xml` is designed to work in ALL contexts:
- Scrollable list in `AssignmentActivity` (My Trip screen)
- Future: could be embedded anywhere

### Existing functions preserved
- `QueueDetailsActivity` — unchanged (existing flow, tap cardMyQueue → existing screen)
- `TransitActivity` — unchanged (handles GPS tracking + stepper, gets opened from AssignmentActivity's "START TRIP" button? OR AssignmentActivity directly calls startTrip/endTrip and TransitActivity becomes the GPS map view)
  - **Correction**: TransitActivity is the GPS tracking screen with the map. AssignmentActivity should trigger TransitActivity for the START TRIP flow, similar to how it works today from MainActivity's cardMyQueue.

---

## Surgery Notes
- No existing function signatures changed in MainActivity.kt — only additional logic added in existing lambda callbacks
- `QueueDetailsActivity.kt` — untouched
- `TransitActivity.kt` — untouched
- All new files follow existing naming/app style conventions
- Existing `circleContainer` animation pattern reused verbatim (same 3-method bounce + scale animation)