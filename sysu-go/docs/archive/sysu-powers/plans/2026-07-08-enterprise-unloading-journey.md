> Historical plan dated 2026-07-08. Check current source and release trackers before treating any task or status as current.

# Enterprise Unloading Journey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistent 2-step unloading flow with intermediate states (UNLOADING → UPLOADING → COMPLETE), survives
app restart/crash. State stored in Firestore `unloadStatus` field per OBD item.

**Architecture:** State machine per OBD item driven by `unloadStatus` (null/UNLOADING/UPLOADING) in Firestore.
Bottom sheet row rendering delegates to `unloadStatus` and `isPodCompleted` in the item data. Existing POD
capture flow (`showObdStatusSheet`) is untouched — only augmented with `unloadStatus` writes.

**Tech Stack:** Android/Kotlin, Firestore, BottomSheetDialogFragment, existing `showObdStatusSheet` POD flow.

---

## Global Constraints

- `deliveryStatus` is NEVER written during UNLOADING/UPLOADING — only at COMPLETE. Prevents partial state appearing as valid outcome.
- Existing `showObdStatusSheet` / `showObdStatusSheetWithLocation` / `updateObdLineItemInFirestore` flow NOT modified in structure — only augmented with `unloadStatus` writes.
- DETAIL layout (item_obd_detail.xml, used in MainActivity/others) — NO changes. Unload flow is POD layout only.
- Socket listener — reads fresh lineItems from Firestore, calls `refreshWith` — state determined purely by Firestore data, no special logic needed.

---

## File Structure

```
app/src/main/res/drawable/
  bg_status_pill_outline_grey.xml          [NEW — RETAKE button]

app/src/main/java/com/sysu/go/activities/
  ObdItemsBottomSheet.kt                    [MODIFY — remove in-memory sets, add unloadStatus state machine]
  MyTripActivity.kt                         [MODIFY — write unloadStatus + RETAKE handler]
```

---

## Drawable Inventory

| Drawable | Status | Action |
|---------|--------|--------|
| `bg_status_pill_amber` | EXISTS | UNLOAD, PENDING |
| `bg_status_pill_orange` | EXISTS (orange_pill_bg) | CAPTURE |
| `bg_status_pill_blue` | EXISTS (sysu_blue) | UPLOADING PHOTO... |
| `bg_status_pill_gray` | EXISTS | UPLOADING disabled |
| `bg_status_pill_green` | EXISTS | DONE (pre-existing) |
| `bg_status_pill_outline_grey` | CREATE | RETAKE |

---

### Task 1: Create RETAKE outlined button drawable

**Files:**
- Create: `app/src/main/res/drawable/bg_status_pill_outline_grey.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <stroke android:width="1.5dp" android:color="#9E9E9E" />
    <corners android:radius="12dp" />
    <padding android:left="10dp" android:right="10dp" android:top="4dp" android:bottom="4dp" />
</shape>
```

- [ ] **Commit:** `git add app/src/main/res/drawable/bg_status_pill_outline_grey.xml && git commit -m "feat(unloading-journey): add outlined grey pill drawable for RETAKE button"`

---

### Task 2: Clean up in-memory state, update ObdItemsBottomSheet state machine

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/ObdItemsBottomSheet.kt`

**Step 1 — Remove in-memory tracking sets.** Delete these two fields from the class body:
- `private val unloadingObdNumbers: MutableSet<String> = mutableSetOf()`
- `private val podCapturedInUnloading: MutableSet<String> = mutableSetOf()`

**Step 2 — Remove all references to `unloadingObdNumbers` and `podCapturedInUnloading` in the class.**
Do a project-wide search to find:
- `unloadingObdNumbers` — should no longer appear anywhere in this file
- `podCapturedInUnloading` — should no longer appear anywhere in this file
- `onUnloadingDone` — still needed for the intermediate DONE flow (keep it)

**Step 3 — Clean up `setLineItems`.** Remove the `unloadingObdNumbers.clear()` and `podCapturedInUnloading.clear()`
calls since those sets no longer exist. `setLineItems` becomes:

```kotlin
fun setLineItems(items: List<Map<String, Any?>>) {
    lineItems = items
    if (_binding != null) {
        populateData()
    }
}
```

**Step 4 — Add `item` parameter to `configureStatusPill`.** Current signature needs to accept the full item Map
to read `unloadStatus`. Add `item: Map<String, Any?>` as a parameter:

```kotlin
private fun configureStatusPill(
    tvDeliveryStatus: TextView,
    ivPodIndicator: ImageView,
    isPodCompleted: Boolean,
    deliveryStatus: String,
    obdNumber: String = "",
    item: Map<String, Any?> = emptyMap(),    // ← ADD THIS
    @Suppress("UNUSED_PARAMETER") podImageUrl: String = ""
)
```

Update the call site in `inflatePodRow` (around line 209) to pass `item`:
```kotlin
configureStatusPill(tvDeliveryStatus, ivPodIndicator, isPodCompleted, deliveryStatus, obd, item, podImageUrl)
```

**Step 5 — Add new callbacks near the top of the class (next to `onItemClick`):**

```kotlin
/** Called when driver confirms START UNLOADING. Caller writes unloadStatus=UNLOADING to Firestore. */
var onUnloadConfirm: ((item: Map<String, Any?>, shipmentDocId: String) -> Unit)? = null

/** Called when RETAKE is tapped on a COMPLETE OBD row — triggers retake flow in MyTripActivity. */
var onRetakeTap: ((item: Map<String, Any?>, shipmentDocId: String) -> Unit)? = null
```

**Step 6 — Add `onUnloadConfirm` and `onRetakeTap` to `newInstance` params and apply block:**

```kotlin
fun newInstance(
    lineItems: List<Map<String, Any?>>,
    shipmentDocId: String,
    rowLayoutType: RowLayoutType = RowLayoutType.POD,
    podCaptureEnabled: Boolean = true,
    onItemClick: ((item: Map<String, Any?>) -> Unit)? = null,
    onObdCameraTap: ((lineItem: Map<String, Any?>, shipmentDocId: String) -> Unit)? = null,
    onUnloadingDone: ((lineItem: Map<String, Any?>, shipmentDocId: String) -> Unit)? = null,
    onRetakeTap: ((item: Map<String, Any?>, shipmentDocId: String) -> Unit)? = null,    // NEW
    onUnloadConfirm: ((item: Map<String, Any?>, shipmentDocId: String) -> Unit)? = null  // NEW
): ObdItemsBottomSheet {
    return ObdItemsBottomSheet().apply {
        this.lineItems = lineItems
        this.shipmentDocId = shipmentDocId
        this.rowLayoutType = rowLayoutType
        this.podCaptureEnabled = podCaptureEnabled
        this.onItemClick = onItemClick
        this.onObdCameraTap = onObdCameraTap
        this.onUnloadingDone = onUnloadingDone
        this.onRetakeTap = onRetakeTap
        this.onUnloadConfirm = onUnloadConfirm
    }
}
```

**Step 7 — Remove the `podCapturedInUnloading` tracking wrapper in `newInstance`.** The apply block should NOT
intercept `onObdCameraTap` to call `podCapturedInUnloading.add(...)`. If such code exists in `newInstance`, remove it.

**Step 8 — Rewrite the COMPLETE branch in `configureStatusPill`.** Find the entire `} else { // ── COMPLETED states...`
block (starts around line 444 after `} else {` in the `if (!isPodCompleted || deliveryStatus.isBlank())` branch)
and replace it with:

```kotlin
} else {
    // ── COMPLETED states: delivery status pill + RETAKE button ──
    val statusUpper = (item["deliveryStatus"] as? String)?.uppercase()?.trim() ?: ""
    val isPodCompletedItem = item["isPodCompleted"] as? Boolean ?: false

    if (isPodCompletedItem && statusUpper.isNotBlank()) {
        // Show delivery status pill (DELIVERED/REJECTED/DEL. W/ REJ)
        val appearance: StatusAppearance = when (statusUpper) {
            "DELIVERED" -> StatusAppearance(R.drawable.bg_badge_green, R.drawable.bg_status_pill_green, R.color.white, "DELIVERED")
            "REJECTED"  -> StatusAppearance(R.drawable.bg_badge_red, R.drawable.bg_status_pill_red, R.color.white, "REJECTED")
            "DELIVERED W/ REJECTION" -> StatusAppearance(R.drawable.bg_badge_amber, R.drawable.bg_status_pill_amber, R.color.text_amber, "DEL. W/ REJ")
            else -> StatusAppearance(R.drawable.bg_badge_amber, R.drawable.bg_status_pill_amber, R.color.text_amber, statusUpper)
        }
        tvDeliveryStatus.text = appearance.label
        tvDeliveryStatus.setBackgroundResource(appearance.pillBg)
        tvDeliveryStatus.setTextColor(ContextCompat.getColor(ctx, appearance.pillTextColor))
        tvDeliveryStatus.alpha = 1f

        // Show RETAKE in the tvUnloadAction slot (same position as UNLOAD/CAPTURE)
        val rowCardView = (tvDeliveryStatus.parent as? android.view.View)?.parent as? android.view.View
        val tvRetake = rowCardView?.findViewById<TextView>(R.id.tvUnloadAction)
        tvRetake?.visibility = View.VISIBLE
        tvRetake?.text = "RETAKE"
        tvRetake?.setBackgroundResource(R.drawable.bg_status_pill_outline_grey)
        tvRetake?.setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
        tvRetake?.setOnClickListener {
            val clickedItem: Map<String, Any?>? = tvDeliveryStatus.tag as? Map<String, Any?>
            if (clickedItem != null) {
                onRetakeTap?.invoke(clickedItem, shipmentDocId)
            }
        }
    } else {
        // isPodCompleted but no deliveryStatus yet — treat as PENDING
        tvDeliveryStatus.text = "PENDING"
        tvDeliveryStatus.setBackgroundResource(R.drawable.bg_status_pill_amber)
        tvDeliveryStatus.setTextColor(ContextCompat.getColor(ctx, R.color.text_amber))
        tvDeliveryStatus.alpha = 1f
    }
}
```

**Step 9 — Update UNLOAD button click handler in `configureStatusPill`.** Find the `UNLOAD` click handler (inside
the PENDING branch, fires `AlertDialog`). Replace the confirm-action with:

```kotlin
AlertDialog.Builder(context)
    .setTitle("Start Unloading?")
    .setMessage("Begin unloading for $obdNumber at ${clickedItem["customerName"] as? String ?: "this location"}?")
    .setPositiveButton("Confirm") { _, _ ->
        // Tell MyTripActivity to persist unloadStatus=UNLOADING in Firestore
        onUnloadConfirm?.invoke(clickedItem, shipmentDocId)
    }
    .setNegativeButton("Cancel", null)
    .show()
```

Note: Remove `unloadingObdNumbers.add(obdNumber)` and `populateData()` calls from this handler — they were
in-memory and now removed.

**Step 10 — Fix row tap in `inflatePodRow` for UPLOADING state.** In `inflatePodRow`, the `rowView.setOnClickListener`
is set AFTER `configureStatusPill` returns. The current code always fires `onObdCameraTap` for pending rows.
Add a guard so row tap is NO-OP during UPLOADING:

Read `unloadStatus` from the item at the start of `inflatePodRow` (after `val obd = safeObdNumber(...)`):
```kotlin
val unloadStatus = item["unloadStatus"] as? String
```

Then update the row click handler block:
```kotlin
rowView.setOnClickListener {
    val status = unloadStatus
    if (status == "UPLOADING") {
        // Disabled during upload
    } else {
        onObdCameraTap?.invoke(item, shipmentDocId)
    }
}
```

Also keep `ivPodIndicator.setOnClickListener { onObdCameraTap?.invoke(item, shipmentDocId) }` unchanged —
camera icon tap always fires camera (same as original behavior).

**Step 11 — Fix `notifyPodCompleted`.** This method currently calls `unloadingObdNumbers.remove()` and
`podCapturedInUnloading.remove()` which no longer exist after Step 2. Since it's also never called from anywhere in the
codebase, either delete it or clear the entire method body:

```kotlin
/**
 * @deprecated No longer needed — state is driven by Firestore unloadStatus field.
 * Removing unloadStatus is handled by updateObdLineItemInFirestore setting it to null on COMPLETE.
 */
@Deprecated("No longer needed — state driven by Firestore")
fun notifyPodCompleted(obdNumber: String) {
    // No-op: unloadStatus is cleared by updateObdLineItemInFirestore on complete
}
```

**Step 12 — Remove redundant imports.** Remove `ColorStateList` if no longer referenced after removing thumbnail
decoding from `configureStatusPill`.

- [ ] **Commit:** `git add app/src/main/java/com/sysu/go/activities/ObdItemsBottomSheet.kt && git commit -m "refactor(unloading-journey): replace in-memory state with Firestore-driven unloadStatus state machine"`

---

### Task 3: Wire MyTripActivity — UNLOAD confirm, UPLOADING write, RETAKE handler

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt`

**Step 1 — Add `writeUnloadStatus` helper method.** This is a Firestore transaction that writes
`unloadStatus` for one specific OBD in the shipment's lineItems array. Place near `updateObdLineItemInFirestore`:

```kotlin
/**
 * Writes unloadStatus for one OBD in the shipment's lineItems array.
 * Values: "UNLOADING" | "UPLOADING" | null (to clear)
 * Used to persist the driver's unloading journey state across app restarts.
 */
private fun writeUnloadStatus(shipmentDocId: String, obdNumber: String, status: String?) {
    lifecycleScope.launch {
        try {
            val docRef = db.collection("sap_assignments").document(shipmentDocId)
            db.runTransaction { transaction ->
                val snap = transaction.get(docRef)
                if (!snap.exists()) return@runTransaction
                @Suppress("UNCHECKED_CAST")
                val lineItems = (snap.get("lineItems") as? List<Map<String, Any?>>)
                    ?.toMutableList() ?: return@runTransaction
                val idx = lineItems.indexOfFirst { (it["obdNumber"] as? String) == obdNumber }
                if (idx == -1) return@runTransaction
                val updated = lineItems[idx].toMutableMap()
                if (status != null) {
                    updated["unloadStatus"] = status
                } else {
                    updated.remove("unloadStatus")
                }
                lineItems[idx] = updated
                transaction.update(docRef, "lineItems", lineItems)
            }.await()
        } catch (e: Exception) {
            Log.e(TAG, "writeUnloadStatus failed for obd=$obdNumber: ${e.message}")
        }
    }
}
```

**Step 2 — Add `retakeObdPod` helper method.** Clears podImageUrl + isPodCompleted and deliveryStatus, sets
unloadStatus=UNLOADING, then fires camera:

```kotlin
/**
 * Handles RETAKE tap on a COMPLETE OBD row.
 * 1. Clear podImageUrl + isPodCompleted + deliveryStatus in Firestore
 * 2. Set unloadStatus=UNLOADING (driver sees "UNLOADING..." immediately on refresh)
 * 3. Fire showObdStatusSheet (same camera flow as first capture)
 */
private fun retakeObdPod(item: Map<String, Any?>, shipmentDocId: String) {
    val obdNumber = item["obdNumber"] as? String ?: return
    lifecycleScope.launch {
        try {
            val docRef = db.collection("sap_assignments").document(shipmentDocId)
            db.runTransaction { transaction ->
                val snap = transaction.get(docRef)
                if (!snap.exists()) return@runTransaction
                @Suppress("UNCHECKED_CAST")
                val lineItems = (snap.get("lineItems") as? List<Map<String, Any?>>)
                    ?.toMutableList() ?: return@runTransaction
                val idx = lineItems.indexOfFirst { (it["obdNumber"] as? String) == obdNumber }
                if (idx == -1) return@runTransaction
                val updated = lineItems[idx].toMutableMap()
                updated["podImageUrl"] = null
                updated.remove("podImageUrl")
                updated["isPodCompleted"] = false
                updated["deliveryStatus"] = null
                updated.remove("deliveryStatus")
                updated.remove("podCapturedAt")
                updated["unloadStatus"] = "UNLOADING"
                lineItems[idx] = updated
                transaction.update(docRef, "lineItems", lineItems)
            }.await()
            // Fire the camera flow — same as first-time capture
            showObdStatusSheet(item, shipmentDocId)
        } catch (e: Exception) {
            Log.e(TAG, "retakeObdPod failed: ${e.message}")
            Toast.makeText(this@MyTripActivity, "Retake failed", Toast.LENGTH_SHORT).show()
        }
    }
}
```

**Step 3 — Update `onUnloadConfirm` wiring in `ObdItemsBottomSheet.newInstance` call.** In
`showObdItemsBottomSheet`, update the bottom sheet instantiation. Find the `onObdCameraTap` callback
and add the other two:

```kotlin
val bottomSheet = ObdItemsBottomSheet.newInstance(
    lineItems = lineItems,
    shipmentDocId = shipmentDocId,
    onItemClick = { item ->
        val isCompleted = item["isPodCompleted"] as? Boolean ?: false
        val dataUri = item["podImageUrl"] as? String ?: ""
        Log.d(TAG, "onItemClick: isCompleted=$isCompleted, dataUri len=${dataUri.length}")
        if (isCompleted && dataUri.isNotBlank()) {
            showPodFullScreenPreview(dataUri)
        }
    },
    onObdCameraTap = { item, docId ->
        // Persist UPLOADING state BEFORE camera fires — survives app kill during upload
        val obd = item["obdNumber"] as? String ?: return@onObdCameraTap
        writeUnloadStatus(docId, obd, "UPLOADING")
        showObdStatusSheet(item, docId)
    },
    onUnloadConfirm = { item, docId ->
        // Persist UNLOADING state — survives app restart
        val obd = item["obdNumber"] as? String ?: return@onUnloadConfirm
        writeUnloadStatus(docId, obd, "UNLOADING")
        // Refresh bottom sheet to show UNLOADING state immediately
        val sheet = (supportFragmentManager.findFragmentByTag(ObdItemsBottomSheet.TAG)
            as? ObdItemsBottomSheet)
        sheet?.let { s ->
            @Suppress("UNCHECKED_CAST")
            val current = s.lineItems.toMutableList()
            val idx = current.indexOfFirst { (it["obdNumber"] as? String) == obd }
            if (idx != -1) {
                current[idx] = current[idx].toMutableMap().apply { this["unloadStatus"] = "UNLOADING" }
                s.refreshWith(current)
            }
        }
    },
    onRetakeTap = { item, docId ->
        retakeObdPod(item, docId)
    }
)
```

**Step 4 — Wire `unloadStatus=null` on COMPLETE save.** In `updateObdLineItemInFirestore`, add to the `original` map
(the item being saved) BEFORE `transaction.update` is called:

```kotlin
original["unloadStatus"] = null      // clears journey tracker on completion
original["deliveryStatus"] = status
original["podImageUrl"] = podImageUrl
original["podCapturedAt"] = Timestamp(java.util.Date(capturedAtMillis))
original["isPodCompleted"] = true
```

**Note:** `lineItems[targetIndex] = original` already happens later in the transaction — the `unloadStatus = null`
line just ensures it's set on the item map before that assignment.

- [ ] **Commit:** `git add app/src/main/java/com/sysu/go/activities/MyTripActivity.kt && git commit -m "feat(unloading-journey): wire Firestore unloadStatus writes + RETAKE in MyTripActivity"`

---

### Task 4 (Optional): Remove `notifyPodCompleted` helper if no callers remain

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/ObdItemsBottomSheet.kt`

After Task 2, `notifyPoddCompleted` calls `unloadingObdNumbers.remove(obdNumber)` which no longer exists.
Check if `notifyPodCompleted` is called anywhere in the codebase:

```bash
grep -rn "notifyPodCompleted\|notifyPodCompleted" --include="*.kt" .
```

If NO callers found, remove `notifyPodCompleted` from `ObdItemsBottomSheet` (it was a workaround for
the old in-memory tracking that is no longer needed).

If there ARE callers, keep it but remove the `unloadingObdNumbers.remove(...)` and
`podCapturedInUnloading.remove(...)` lines.

- [ ] **Commit:** (if applicable) `git add app/src/main/java/com/sysu/go/activities/ObdItemsBottomSheet.kt && git commit -m "chore(unloading-journey): remove dead notifyPodCompleted helper"`

---

## Build Verification

Run: `JAVA_HOME='C:\Program Files\Android\Android Studio1\jbr' PATH="$JAVA_HOME/bin:$PATH" ./gradlew :app:compileDebugKotlin`

Expected: `BUILD SUCCESSFUL` — zero new errors (pre-existing unchecked cast warnings are OK).

---

## Implementation Verification Checklist

After all 4 commits:
1. Restart app → PENDING OBDs show UNLOAD button + amber camera
2. Tap UNLOAD → confirm → row shows "UNLOADING..." amber + CAPTURE orange button
3. Kill app → restart → row STILL shows "UNLOADING..." (Firestore-persisted)
4. Tap CAPTURE → row shows "UPLOADING PHOTO..." blue + disabled grey button + row tap disabled
5. Camera fires → take photo → upload completes → status selection sheet (existing flow)
6. Select DELIVERED → row shows "DELIVERED" green pill + RETAKE outlined grey button
7. Tap RETAKE → podImageUrl cleared → unloadStatus=UNLOADING → camera fires again
8. Scroll → all states preserved
9. DETAIL layout (MainActivity) → no UNLOAD/CAPTURE/RETAKE buttons visible (unchanged)
10. Existing non-unloading POD flow → behaves EXACTLY as before

---

## Self-Review Checklist

1. **Spec coverage:** All 3 unload states (UNLOADING/UPLOADING/COMPLETE) + RETAKE are implemented.
2. **Placeholder scan:** No TBD/TODO/placeholder in code blocks. Every code block is complete.
3. **Type consistency:**
   - `writeUnloadStatus(shipmentDocId: String, obdNumber: String, status: String?)` — consistent in all callers
   - `retakeObdPod(item: Map<String, Any?>, shipmentDocId: String)` — consistent with `showObdStatusSheet(item, docId)`
   - `newInstance` params include `onUnloadConfirm` and `onRetakeTap` — no naming conflicts
   - `item["unloadStatus"]` used consistently — matches Firestore field name exactly
4. **Surgical constraint:** `showObdStatusSheet`, `showObdStatusSheetWithLocation`, socket listener,
   and `onRefreshRequest` are all untouched.
5. **No in-memory state remains:** `grep -n "unloadingObdNumbers\|podCapturedInUnloading" ObdItemsBottomSheet.kt` → 0 results