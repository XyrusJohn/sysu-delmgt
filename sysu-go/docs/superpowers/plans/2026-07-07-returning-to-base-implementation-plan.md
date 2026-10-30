# Returning-to-Base Feature — Surgical Implementation Plan

> **Agentic execution:** Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task.
> Checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `returning_to_base` status phase gated behind complete POD work. Add "START UNLOADING" per OBD item in the bottom sheet. Zero breaking changes to existing working features.

**Architecture:** New `tripStatus = "returning_to_base"` value stored in Firestore. Unloading is a brief per-OBD-item confirm-dialog step before the existing POD camera flow. No new schema, no refactors.

**Tech Stack:** Kotlin / Android / Firebase Firestore / Socket.IO

## Global Constraints

- `tripStatus` field: new strings `returning_to_base` accepted (existing values `in_transit`, `completed`, `pending` unchanged)
- `isPodComplete` gates `returning_to_base` transition (`isPodComplete = lineItems.all { isPodCompleted }`)
- Existing POD capture flow (camera → status selection → upload) — UNCHANGED
- Existing Firestore `tripStatus` reads/writes — only add new `when()` cases, never remove existing ones
- GPS tracking continues through `returning_to_base` phase (same as `in_transit`)

---

## Surgical File Map

| File | Change | Risk |
|---|---|---|
| `res/drawable/bg_status_pill_blue.xml` | **CREATE** — new blue pill badge | Zero risk (new file) |
| `model/Assignment.kt` | ADD `returning_to_base` cases in `when(tripStatus)` | Low — additive only |
| `adapter/MyTripTabAdapter.kt` | ADD `returning_to_base` badge + button in existing `when(tripStatus)` | Low — additive only |
| `activities/TransitActivity.kt` | ADD button state in `updateProgressStepper()` + action handler | Low — additive only |
| `activities/ObdItemsBottomSheet.kt` | ADD START UNLOADING button + confirm dialog → existing `onObdCameraTap` flow | Low — additive only |
| `res/values/colors.xml` (if needed) | Add blue color if not present | Zero risk |

---

## TASK 1: Create blue pill badge drawable

**Files:**
- Create: `app/src/main/res/drawable/bg_status_pill_blue.xml`
- Reference: existing `bg_status_pill_green.xml`, `bg_status_pill_amber.xml`, `bg_status_pill_red.xml` in same directory

**Rationale:** Returning-to-base badge uses a blue pill (distinct from green=completed, amber=pending, red=in_transit).

**Testing:** None — this is a static drawable. Verify file exists and is valid XML.

- [ ] **Step 1: Read existing pill drawable for reference**

```bash
cat app/src/main/res/drawable/bg_status_pill_amber.xml
```

Expected output — amber pill background with 16dp corner radius.

- [ ] **Step 2: Create bg_status_pill_blue.xml**

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#2196F3" />
    <corners android:radius="16dp" />
</shape>
```

Copy all contents from `bg_status_pill_amber.xml` and change `solid android:color` to `#2196F3` (Material Blue 500 — stands out from amber/red/green).

- [ ] **Step 3: Verify drawable exists**

```bash
ls app/src/main/res/drawable/bg_status_pill_blue.xml
```

Expected: `app/src/main/res/drawable/bg_status_pill_blue.xml` returned.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/res/drawable/bg_status_pill_blue.xml
git commit -m "feat(returning-to-base): add blue pill badge drawable"
```

**Dependencies after this task:** `bg_status_pill_blue.xml` available for use in badge/button styling.

---

## TASK 2: Add `returning_to_base` to Assignment.kt model

**Files:**
- Modify: `app/src/main/java/com/sysu/go/model/Assignment.kt`
- Read first to confirm current state: lines around `isInTransit`, `isCompleted`, `tripStatus` checks

**Surgical principle:** Only ADD new `when` cases. Do NOT remove or modify existing conditions.

**Changes needed:**

1. In `isCompleted` getter, add `returning_to_base` alongside `completed` (or add a separate `isReturningToBase` getter — see option below)
2. No new properties needed since `isPodComplete` already exists and gates the transition

**Decision point:** `returning_to_base` is not "completed" — the trip isn't done yet. Use a separate `isReturningToBase` getter rather than adding to `isCompleted`. Existing `isCompleted` logic stays 100% untouched.

- [ ] **Step 1: Read Assignment.kt for context**

Find the lines for `isInTransit` and `isCompleted`. Note the exact positions.

- [ ] **Step 2: Add `isReturningToBase` getter**

Add after `isCompleted`:

```kotlin
/** True if trip is returning to base */
val isReturningToBase: Boolean get() = tripStatus == "returning_to_base"
```

**Surgical check:** Only addition. No existing code modified. `isCompleted` stays exactly as-is.

- [ ] **Step 3: Verify no other changes needed**

Assignment.kt uses `tripStatus` in `when()` blocks elsewhere (e.g., `canStartTrip`, `isLocked`). Adding `returning_to_base` as a distinct value is backward-compatible — it will fall into the `else` branches where appropriate, which is correct behavior (you can't start a new trip while returning to base, etc.)

**Dependencies after this task:** `Assignment.isReturningToBase` available for UI conditionals.

---

## TASK 3: Add `returning_to_base` badge + button in MyTripTabAdapter

**Files:**
- Modify: `app/src/main/java/com/sysu/go/adapter/MyTripTabAdapter.kt`
- Read first: find the `when (assignment.tripStatus)` block that handles badge + button states

**Surgical principle:** Add new `returning_to_base` case INSIDE the existing `when` block. Keep all existing cases exactly as they are.

**Changes needed:**

In the existing `when(assignment.tripStatus)` block, after the `"completed"` case, add:

```kotlin
"returning_to_base" -> {
    binding.tvTripStatusBadge.text = "RETURNING TO BASE"
    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_blue)
    binding.tvTripStatusBadge.setTextColor(
        ContextCompat.getColor(ctx, R.color.white)
    )

    binding.btnTripAction.text = "ARRIVED AT WAREHOUSE"
    binding.btnTripAction.isEnabled = true
    binding.btnTripAction.alpha = 1.0f
    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_blue)

    binding.btnShowVerification.visibility = View.GONE
}
```

Note: `sysu_blue` color reference assumes it exists in `colors.xml`. If not, use hardcoded `#2196F3` directly.

- [ ] **Step 1: Read MyTripTabAdapter.kt — find the when(tripStatus) block**

Find lines for `"in_transit"` and `"completed"` cases. The block starts around line 157 in `bind()`.

- [ ] **Step 2: Add the `returning_to_base` case**

Insert AFTER the `"completed"` case, BEFORE the `else` branch.

**Surgical check:** `in_transit` case untouched. `completed` case untouched. Only new text added.

- [ ] **Step 3: Verify colors.xml has `sysu_blue`**

```bash
grep -n "sysu_blue\|blue" app/src/main/res/values/colors.xml | head -20
```

If `sysu_blue` doesn't exist, add:
```xml
<color name="sysu_blue">#2196F3</color>
```

- [ ] **Step 4: Commit**

```bash
git add app/src/main/res/drawable/bg_status_pill_blue.xml app/src/main/res/values/colors.xml app/src/main/java/com/sysu/go/model/Assignment.kt app/src/main/java/com/sysu/go/adapter/MyTripTabAdapter.kt
git commit -m "feat(returning-to-base): add returning_to_base badge and ARRIVED AT WAREHOUSE button in MyTripTabAdapter
```

**Dependencies after this task:** MyTripActivity card shows "RETURNING TO BASE" blue badge when tripStatus is `returning_to_base`.

---

## TASK 4: Add `returning_to_base` button state in TransitActivity

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`
- No structural changes — only add new branch in existing button/stepper logic

**Changes needed (2 places):**

### Change 1 — `updateProgressStepper()`: add `returning_to_base` branch

Read `updateProgressStepper()` and find the `completed` branch. Add `returning_to_base` branch AFTER `isTripEnded` check but BEFORE the `isTripStarted` check. Or better: add it as a guard in the existing state machine.

The flow should be:
- `isTripEnded` (tripStatus=completed) → all 3 steps ✓ → return
- **`isReturningToBase`** (tripStatus=returning_to_base) → all 3 steps ✓ → "RETURNING TO BASE" subtitle → BUTTON: "ARRIVED AT WAREHOUSE" → return  ← **NEW**
- `isTripStarted` (tripStatus=in_transit) → existing behavior → return
- Not started → existing behavior → return

**Note:** `isReturningToBase` reads the current `tripStatus` from the Firestore doc. See `populateShipmentUI()` — add a local `isReturningToBase` flag similar to `isTripStarted` and `isTripEnded`.

### Change 2 — `setupUI()` / `btnStartTrip` click: handle "ARRIVED AT WAREHOUSE" case

In `btnStartTrip.setOnClickListener`, add a case:

```kotlin
// returning_to_base: confirm arrival, then end trip
isReturningToBaseState -> {
    AlertDialog.Builder(this)
        .setTitle("Arrived at Warehouse?")
        .setMessage("Confirm that you have returned to the warehouse.")
        .setPositiveButton("Confirm") { _, _ -> performEndTrip() }
        .setNegativeButton("Cancel", null)
        .show()
}
```

`performEndTrip()` already exists and sets `tripStatus = completed`. No changes needed there.

### Change 3 — `loadTripData` path: detect `returning_to_base` from Firestore

In `populateShipmentUI()`, add detection of `tripStatus == "returning_to_base"`:

```kotlin
val tripStatus = sapDoc.getString("tripStatus")
if (tripStatus == "completed") {
    isTripStarted = false
    isTripEnded = true
} else if (tripStatus == "returning_to_base") {
    isReturningToBase = true
    isTripStarted = false
    isTripEnded = false
}
```

Declare `isReturningToBase` as a local variable in `loadTripData` (similar to `isTripEnded`) — do NOT add as a class-level property unless there's a restore-session need.

- [ ] **Step 1: Read TransitActivity — find `updateProgressStepper()` branch structure**

Confirm the 3 states handled: `isTripEnded/completed`, `isTripStarted/in_transit`, default not-started.

- [ ] **Step 2: Read TransitActivity — find `btnStartTrip.setOnClickListener`**

Confirm the `when` block handles: `isTripStarted` → BACK TO HOME, and the `else` → `startTrip()`.

- [ ] **Step 3: Read TransitActivity — find `populateShipmentUI()` to see how `isTripEnded` is detected**

- [ ] **Step 4: Make surgical edits**

1. In `populateShipmentUI()`: add `returning_to_base` detection after the `completed` check
2. In `updateProgressStepper()`: add a `returning_to_base` branch (all steps ✓, amber text "RETURNING TO BASE", button "ARRIVED AT WAREHOUSE")
3. In `btnStartTrip.setOnClickListener`: add `isReturningToBase` → confirm arrival → `performEndTrip()`

**Surgical check:** All existing branches (not-started, in_transit, completed) untouched. Only ONE new branch added per location.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(returning-to-base): add returning_to_base button state in TransitActivity
```

**Dependencies after this task:** TransitActivity shows "ARRIVED AT WAREHOUSE" button when tripStatus=`returning_to_base`, and transitioning works after confirm dialog.

---

## TASK 5: Add START UNLOADING in ObdItemsBottomSheet

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/ObdItemsBottomSheet.kt`
- No changes to `ObdStatusBottomSheet.kt` or the POD camera flow

**Current behavior:**
- Pending rows with `podCaptureEnabled=true`: tap camera icon → `onObdCameraTap` → calls `showObdStatusSheet` → location → camera → POD capture
- COMPLETED rows: tap checkmark → `onItemClick` → full-screen preview

**New behavior (SAME flow, with confirm dialog inserted before POD step):**
- Pending `in_transit` rows: "START UNLOADING" button → tap → confirm dialog → on confirm → `onObdCameraTap` (existing POD flow continues from here)
- After confirm: existing flow runs as-is

**Surgical principle:** Add ONE confirm dialog. Everything after Confirm is the exact same existing `onObdCameraTap` callback that already works.

### Implementation

In `configureStatusPill()` method, when `!isPodCompleted` and `rowLayoutType == POD` and `podCaptureEnabled`:

**REPLACE** the camera icon with a "START UNLOADING" button (or a labeled button that still calls `onObdCameraTap`).

The simplest surgical approach — change the `ivPodIndicator` from camera icon to a styled "UNLOAD" button that calls the exact same `onObdCameraTap` on click.

Option A (simplest — modify `configureStatusPill`):
- Set `ivPodIndicator` to show "START UNLOADING" text as a button-like appearance (change text, background, size)
- On click → existing `onObdCameraTap?.invoke(item, shipmentDocId)` (same as before)

Option B (add confirm dialog):
- On click of "START UNLOADING" → show AlertDialog confirm first
- On Confirm → `onObdCameraTap?.invoke(item, shipmentDocId)` (existing flow)

**Decision:** Option B — add the brief confirm dialog as specified in the design.

**New callback needed:** Add a new callback `onObdUnloadTap` or reuse `onObdCameraTap` after the confirm dialog. Since confirm dialog is a UI-only addition (MyTripActivity shows the dialog, not the bottom sheet), the cleanest approach:

- In `ObdItemsBottomSheet.kt`, capture the existing `onObdCameraTap` once as `pendingOnObdCameraTap`
- Pending row: on click, show confirm dialog
- On Confirm: invoke `pendingOnObdCameraTap?.invoke(item, shipmentDocId)` (continues existing flow)

This way MyTripActivity's `onObdCameraTap` is unchanged — the dialog is inserted inside the bottom sheet only.

**Wait** — need a way to show the AlertDialog from within the bottom sheet. The bottom sheet has `requireContext()` — it can show dialogs.

**Simplified surgical approach:**
- Change `ivPodIndicator` appearance from camera icon to an amber button "UNLOAD"
- On click: create and show an AlertDialog.Builder(requireContext()) for confirm
- On Confirm: call `onObdCameraTap?.invoke(item, shipmentDocId)` — EXACTLY the same callback the existing code already uses
- After confirm, `onObdCameraTap` runs the existing POD flow unchanged

- [ ] **Step 1: Read current `configureStatusPill()` method**

Find where `!isPodCompleted` + `POD` + `podCaptureEnabled` sets the camera icon. Lines ~337-356.

- [ ] **Step 2: Change camera icon to "START UNLOADING" button for pending rows**

In `configureStatusPill()` for the `!isPodCompleted` + `POD layout` case:

**REPLACE:**
```kotlin
// POD layout: show amber camera icon
ivPodIndicator.visibility = View.VISIBLE
ivPodIndicator.alpha = 1f
ivPodIndicator.setBackgroundResource(R.drawable.bg_badge_amber)
ivPodIndicator.setImageResource(R.drawable.ic_camera_pod)
ivPodIndicator.imageTintList = null
ivPodIndicator.isClickable = true
```

**WITH:**
```kotlin
// POD layout: show amber START UNLOADING button with text
ivPodIndicator.visibility = View.VISIBLE
ivPodIndicator.alpha = 1f
ivPodIndicator.setBackgroundResource(R.drawable.bg_status_pill_amber)
ivPodIndicator.setImageDrawable(null) // remove camera icon — we'll show text via setText workaround
ivPodIndicator.isClickable = true
ivPodIndicator.setPadding(16, 8, 16, 8)
// Note: ivPodIndicator is ImageView, can't set text easily. Better approach: 
// use a TextView instead. See Option C below.
```

**Option C (cleanest surgical):** Modify the layout to use a small button-style TextView beside the status pill. But this changes the layout XML.

**Option D (minimal change, works):** Keep the image view but add a click override that shows the confirm dialog before triggering the existing callback. The `ivPodIndicator.setOnClickListener` already exists — wrap it with dialog + existing callback.

**Recommended (Option D — minimal):**

Replace the `ivPodIndicator.setOnClickListener` in the pending POD case with:

```kotlin
val onConfirmUnload: (() -> Unit) = {
    onObdCameraTap?.invoke(item, shipmentDocId)
}

// Show brief amber badge with "UNLOAD" text
ivPodIndicator.visibility = View.VISIBLE
ivPodIndicator.alpha = 1f
ivPodIndicator.setBackgroundResource(R.drawable.bg_badge_amber)
ivPodIndicator.setImageResource(R.drawable.ic_truck_unload) // NEW icon for unload — OR reuse existing
ivPodIndicator.imageTintList = null
ivPodIndicator.isClickable = true

ivPodIndicator.setOnClickListener {
    androidx.appcompat.app.AlertDialog.Builder(requireContext())
        .setTitle("Start Unloading?")
        .setMessage("Begin unloading for $obd at ${item["customerName"] ?: "this location"}?")
        .setPositiveButton("Confirm") { _, _ -> onConfirmUnload() }
        .setNegativeButton("Cancel", null)
        .show()
}
```

**Key constraint:** We need both a background AND an image/icon for the unload action. If we use `bg_badge_amber` (circular background) + a truck icon, that's visually distinct from the camera icon. The text on the badge won't show, but the truck icon + amber circle conveys "unload" clearly.

**If we want text visible on the button:** Change from `ImageView` to `TextView` in the layout — requires modifying `item_my_trip_obd.xml`. This is still surgical (one small layout change).

**Recommended:** For maximum clarity, change `ivPodIndicator` in `item_my_trip_obd.xml` to accept text drawable OR make it a `Button`. Simpler: add a small `TextView` next to it.

**Final decision for surgical approach (Option D):**
- Add a new small `TextView` with id `@+id/tvUnloadAction` in `item_my_trip_obd.xml` — initially `gone`
- Show it only in pending POD rows (in `configureStatusPill`)
- Set text to "UNLOAD" in amber style
- On click → confirm dialog → `onObdCameraTap`

This is surgical: adds one new view, existing views untouched.

- [ ] **Step 3: Read item_my_trip_obd.xml — find a good spot to add the UNLOAD TextView**

Add after `ivPodIndicator` or before `tvDeliveryStatus`.

- [ ] **Step 4: Add tvUnloadAction TextView to item_my_trip_obd.xml**

```xml
<TextView
    android:id="@+id/tvUnloadAction"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:layout_marginStart="8dp"
    android:paddingHorizontal="10dp"
    android:paddingVertical="4dp"
    android:background="@drawable/bg_status_pill_amber"
    android:textColor="@color/text_amber"
    android:textSize="@dimen/text_size_caption"
    android:textStyle="bold"
    android:text="UNLOAD"
    android:visibility="gone" />
```

- [ ] **Step 5: Modify `configureStatusPill()` to show `tvUnloadAction` for pending POD rows**

In `configureStatusPill()`, for the `!isPodCompleted && rowLayoutType == POD && podCaptureEnabled` branch:
- Show `tvUnloadAction` (visibility = visible, not gone)
- Set click listener → confirm dialog → `onObdCameraTap`
- Hide `ivPodIndicator` (camera icon) for pending POD rows during unloading phase

```kotlin
// Find the unload action TextView
val tvUnloadAction = rowView.findViewById<TextView>(R.id.tvUnloadAction)
tvUnloadAction.visibility = View.VISIBLE
tvUnloadAction.setOnClickListener {
    AlertDialog.Builder(requireContext())
        .setTitle("Start Unloading?")
        .setMessage("Begin unloading for $obd at ${item["customerName"] ?: "this location"}?")
        .setPositiveButton("Confirm") { _, _ ->
            onObdCameraTap?.invoke(item, shipmentDocId)
        }
        .setNegativeButton("Cancel", null)
        .show()
}
// Hide camera icon in pending POD row — UNLOAD replaces it
ivPodIndicator.visibility = View.GONE
```

**Surgical check:** All existing click handlers in `inflatePodRow()` preserved. The existing `isPodCompleted` branch still uses camera icon (for COMPLETED rows). Only pending POD rows are modified.

- [ ] **Step 6: Also update the `inflatePodRow()` method**

The existing `!isLoading` + `isPodCompleted` + `!podCaptureEnabled` branches must be preserved. The `podCaptureEnabled=false` case should still show the amber camera icon (not our UNLOAD button — that's only for MyTrip delivery context).

**Condition to show UNLOAD:** `!isPodCompleted && podCaptureEnabled && rowLayoutType == POD`

All other cases (existing code paths) remain unchanged.

- [ ] **Step 7: Find or create `ic_truck_unload` icon**

Check if it exists:
```bash
ls app/src/main/res/drawable/ic_truck*.xml 2>/dev/null
```

If not, we don't need a separate icon — the UNLOAD button is just styled text in an amber pill. `tvUnloadAction` uses `bg_status_pill_amber` + amber text — no icon needed.

- [ ] **Step 8: Commit**

```bash
git add app/src/main/res/drawable/bg_status_pill_blue.xml app/src/main/res/values/colors.xml app/src/main/java/com/sysu/go/model/Assignment.kt app/src/main/java/com/sysu/go/adapter/MyTripTabAdapter.kt app/src/main/java/com/sysu/go/activities/TransitActivity.kt app/src/main/java/com/sysu/go/activities/ObdItemsBottomSheet.kt app/src/main/res/layout/item_my_trip_obd.xml
git commit -m "feat(returning-to-base): add START UNLOADING button with confirm dialog in OBD bottom sheet
```

**Dependencies after this task:** Full feature is integrated. All changes are additive — no existing functions broken.

---

## TASK 6: Connect the `returning_to_base` transition trigger

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`
- Also: `app/src/main/java/com/sysu/go/adapter/MyTripTabAdapter.kt`

**This task wires the trigger — when does `tripStatus` become `returning_to_base`?**

After the LAST OBD item is marked complete (all `isPodCompleted = true`), the "ARRIVED AT WAREHOUSE" button needs to transition to `returning_to_base` state FIRST before the arrival confirmation.

**Current state:** After completing the last POD, the TransitActivity still shows the `in_transit` state (BACK TO HOME button). The transition to `returning_to_base` needs to be triggered.

**Trigger place:** In the POD camera result handler in MyTripActivity, after the LAST OBD item is marked complete, update Firestore `tripStatus = returning_to_base`.

The update to `returning_to_base` should happen:
- When MyTripActivity processes the last POD completion and `isPodComplete` becomes `true`
- OR: when the user opens TransitActivity and it detects `isPodComplete=true` while `tripStatus=in_transit`

**Surgical decision:** Use the TransitActivity approach (detect on-open) for safety — the bottom sheet/POD flow already updates Firestore, but the transition to `returning_to_base` should be done carefully. Since we can't easily detect "last item" in MyTripActivity without re-reading the full list, do it in TransitActivity.

**In TransitActivity**, when the user opens the activity with `tripStatus=in_transit` and the Firestore lineItems show `isPodComplete=true` for ALL items:
- Show "START RETURNING TO BASE" button (blue) immediately
- User taps → confirm dialog → `tripStatus` updates to `returning_to_base` → button becomes "ARRIVED AT WAREHOUSE"

**Implementation in TransitActivity:**

In `loadTripData()` / `populateShipmentUI()` — after getting the `tripStatus` and `lineItems`:

```kotlin
val lineItems = sapDoc.get("lineItems") as? List<Map<String, Any?>>
val isPodComplete = lineItems?.all { (it["isPodCompleted"] as? Boolean) == true } ?: false

// isPodComplete gates the RETURN TO BASE button
val isPodCompleteForAll = isPodComplete
```

Store `isPodCompleteForAll` as a class property `isPodCompleteForAll` in TransitActivity (add at top as `false`).

In `updateProgressStepper()` — add condition:

```kotlin
// in_transit: driver is on the road
if (isTripStarted) {
    // Check if all PODs are complete → show RETURNING TO BASE button
    if (isPodCompleteForAll) {
        setStepState(R.id.dotQueue, null, R.id.checkQueue, R.id.labelQueue, StepState.DONE)
        setStepState(R.id.dotLoading, null, R.id.checkLoading, R.id.labelLoading, StepState.DONE)
        setStepState(R.id.dotTransit, null, R.id.checkTransit, R.id.labelTransit, StepState.DONE)
        binding.tvSubStatus.text = "Ready to return"
        binding.btnStartTrip.text = "START RETURNING TO BASE"
        binding.btnStartTrip.setBackgroundColor(ContextCompat.getColor(this, R.color.sysu_blue))
        binding.btnStartTrip.isEnabled = true
        return
    }
    // ... existing in_transit logic
}

// returning_to_base state
if (isReturningToBase) {
    // ... (from Task 4)
}
```

In `btnStartTrip.setOnClickListener`, add:

```kotlin
// in_transit + all PODs complete → transition to returning_to_base
isTripStarted && isPodCompleteForAll -> {
    AlertDialog.Builder(this)
        .setTitle("Return to Base?")
        .setMessage("All OBD items are complete. Begin returning to the warehouse?")
        .setPositiveButton("Confirm") { _, _ ->
            transitionToReturningToBase()
        }
        .setNegativeButton("Cancel", null)
        .show()
}
```

Add new method:

```kotlin
private fun transitionToReturningToBase() {
    val updates = mapOf(
        "tripStatus" to "returning_to_base",
        "returnedToBaseAt" to Timestamp.now()
    )
    db.collection("sap_assignments").document(currentSapDocId)
        .update(updates)
        .addOnSuccessListener {
            if (isFinishing) return@addOnSuccessListener
            isReturningToBase = true  // rename local flag tracking
            isTripStarted = false
            updateProgressStepper()
            Toast.makeText(this, "Heading back to base!", Toast.LENGTH_SHORT).show()
        }
        .addOnFailureListener { e ->
            Log.e(TAG, "Failed to transition to returning_to_base: ${e.message}")
            Toast.makeText(this, "Failed. Check connection.", Toast.LENGTH_SHORT).show()
        }
}
```

⚠️ **Important:** Rename `isReturningToBase` local variable in Task 4 to a class-level property if needed for cleanup. Keep it local for now.

**Surgical check:** All existing paths in `updateProgressStepper()` remain untouched. Only one new branch added. Button click handling adds one new `when` branch, existing branches unchanged.

- [ ] **Step 1: Read TransitActivity — find class property declarations (top of class)**

Find where `isTripEnded`, `isTripStarted` are declared.

- [ ] **Step 2: Add isPodCompleteForAll as class property**

```kotlin
private var isPodCompleteForAll: Boolean = false
```

- [ ] **Step 3: In `populateShipmentUI()` — compute isPodCompleteForAll from lineItems**

After getting lineItems:
```kotlin
val lineItemsAll = sapDoc.get("lineItems") as? List<Map<String, Any?>>
isPodCompleteForAll = lineItemsAll?.all { (it["isPodCompleted"] as? Boolean) == true } ?: false
```

- [ ] **Step 4: In `updateProgressStepper()` — add the isPodCompleteForAll branch**

Insert after `isTripStarted` check starts, inside the `isTripStarted` block: check `if (isPodCompleteForAll)` first.

- [ ] **Step 5: In `setupUI()` — add START RETURNING TO BASE click handler**

Add the case in `btnStartTrip.setOnClickListener`.

- [ ] **Step 6: Add `transitionToReturningToBase()` method**

Add this method to TransitActivity after `endTrip()`.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/TransitActivity.kt app/src/main/java/com/sysu/go/activities/MyTripActivity.kt
git commit -m "feat(returning-to-base): connect RETURNING TO BASE trigger and transition logic
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| `returning_to_base` status added to Firestore | Task 3, 4, 6 |
| `unloading` per OBD item with confirm dialog | Task 5 |
| Unloading does NOT persist as tripStatus (trip remains in_transit) | Task 5 (dialog only, no Firestore write for unloading) |
| Transition to `returning_to_base` gated by `isPodComplete` | Task 6 |
| START UNLOADING button appears in OBD Items bottom sheet per row | Task 5 |
| ARRIVED AT WAREHOUSE button in TransitActivity | Task 4 |
| Blue badge in MyTripActivity card for `returning_to_base` | Task 3 |
| GPS tracking continues in `returning_to_base` | Task 4 (button state only, socket emit already continues) |

## Post-Implementation Smoke Test (Manual)

1. Start a trip — verify `in_transit`, green BACK TO HOME button ✅
2. Open OBD Items bottom sheet — verify UNLOAD button on pending rows ✅
3. Tap UNLOAD → verify confirm dialog appears ✅
4. Confirm → verify existing POD camera/status flow runs ✅
5. Complete all PODs → open TransitActivity → verify "START RETURNING TO BASE" blue button appears ✅
6. Tap "START RETURNING TO BASE" → verify confirm dialog ✅
7. Confirm → verify button changes to "ARRIVED AT WAREHOUSE" + tripStatus=`returning_to_base` in Firestore ✅
8. Tap "ARRIVED AT WAREHOUSE" → verify END TRIP confirm ✅
9. Confirm → verify tripStatus=`completed` ✅
10. MyTripActivity card shows blue "RETURNING TO BASE" badge when status is `returning_to_base` ✅
11. **Existing flows unbroken:**
    - Not-in-transit start trip flow ✅
    - All existing BADGE colors and BEHAVIOR unchanged ✅
    - POD camera flow unchanged ✅
    - Socket tracking unchanged ✅