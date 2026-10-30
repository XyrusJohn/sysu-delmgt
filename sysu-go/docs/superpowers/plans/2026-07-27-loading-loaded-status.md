# LOADING → LOADED → IN TRANSIT: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `loading`, `fully_loaded`, and `loaded` `tripStatus` values between ASSIGNED and IN TRANSIT with progressive card buttons and auto-transition on guard verification.

**Architecture:** New `tripStatus` values stored in `sap_assignments/{docId}`. Card buttons in `MyTripTabAdapter` drive state transitions via Firestore writes. Guard verification in `AssignmentActivity.saveGuardVerificationToFirestore` auto-transitions `fully_loaded` → `loaded`. `drivers/{driverId}.isFull` flag set when FULLY LOADED is pressed.

**Tech Stack:** Android Kotlin, Firebase Firestore, ViewBinding

## Global Constraints

- Only one shipment `in_transit` at a time (existing lock logic unchanged)
- START TRIP remains locked if another shipment is already `in_transit`
- Guard verification flow uses existing `GuardVerificationBottomSheet`
- `drivers/{driverId}.isFull` set to `true` when FULLY LOADED is pressed
- `tripStatus` values are lowercase strings: `"loading"`, `"fully_loaded"`, `"loaded"`

---

### Task 1: Add derived properties to Assignment.kt

**Files:**
- Modify: `app/src/main/java/com/sysu/go/model/Assignment.kt`

**Interfaces:**
- Produces: `isLoading: Boolean`, `isFullyLoaded: Boolean`, `isPriorClosed: Boolean`, `isLoaded: Boolean`

- [ ] **Step 1: Add new derived properties**

After line 87 (`val isDelivered: Boolean get() = tripStatus == "delivered"`), insert:

```kotlin
/** True if driver is actively loading cargo at the loading bay */
val isLoading: Boolean get() = tripStatus == "loading"

/** True if truck is physically fully loaded, awaiting guard verification */
val isFullyLoaded: Boolean get() = tripStatus == "fully_loaded"

/** True if guard has verified the loaded cargo — ready to start the trip */
val isLoaded: Boolean get() = tripStatus == "loaded"
```

- [ ] **Step 2: Build**

Run `./gradlew :app:assembleDebug` and verify compilation passes.

---

### Task 2: Add tripStatus when branches in MyTripTabAdapter

**Files:**
- Modify: `app/src/main/java/com/sysu/go/adapter/MyTripTabAdapter.kt` (the `when (assignment.tripStatus)` block around line 157, and the button action mapping around line 275, and the OBD lock condition around line 289)

**Interfaces:**
- Consumes: `Assignment.isLoading`, `Assignment.isFullyLoaded`, `Assignment.isLoaded` (from Task 1)
- Produces: Action strings `"START_LOADING"`, `"FULLY_LOADED"`, `"VERIFY_GUARD"`

- [ ] **Step 1: Insert new `when` branches BEFORE the `else` block**

Before the `else -> {` at line 234, insert the following three branches:

```kotlin
"loading" -> {
    binding.tvTripStatusBadge.text = "LOADING..."
    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_amber)
    binding.tvTripStatusBadge.setTextColor(
        ContextCompat.getColor(ctx, R.color.white)
    )

    binding.btnTripAction.visibility = View.VISIBLE
    binding.btnTripAction.text = "FULLY LOADED"
    binding.btnTripAction.isEnabled = true
    binding.btnTripAction.alpha = 1.0f
    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_blue)

    binding.btnShowVerification.visibility = View.GONE
}
"fully_loaded" -> {
    if (assignment.guardVerified) {
        // Guard already verified via external trigger; treat as loaded
        binding.tvTripStatusBadge.text = "LOADED"
        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
        binding.tvTripStatusBadge.setTextColor(
            ContextCompat.getColor(ctx, R.color.white)
        )
        binding.btnTripAction.visibility = View.VISIBLE
        binding.btnTripAction.text = "START TRIP"
        binding.btnTripAction.isEnabled = !hasActiveTrip
        binding.btnTripAction.alpha = if (hasActiveTrip) 0.4f else 1.0f
        binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)
    } else {
        binding.tvTripStatusBadge.text = "FULLY LOADED"
        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_blue)
        binding.tvTripStatusBadge.setTextColor(
            ContextCompat.getColor(ctx, R.color.white)
        )
        binding.btnTripAction.visibility = View.VISIBLE
        binding.btnTripAction.text = "VERIFY WITH GUARD"
        binding.btnTripAction.isEnabled = true
        binding.btnTripAction.alpha = 1.0f
        binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_amber)
    }

    binding.btnShowVerification.visibility = View.GONE
}
"loaded" -> {
    binding.tvTripStatusBadge.text = "LOADED"
    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
    binding.tvTripStatusBadge.setTextColor(
        ContextCompat.getColor(ctx, R.color.white)
    )

    binding.btnTripAction.visibility = View.VISIBLE
    binding.btnTripAction.text = "START TRIP"
    binding.btnTripAction.isEnabled = !hasActiveTrip
    binding.btnTripAction.alpha = if (hasActiveTrip) 0.4f else 1.0f
    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)

    binding.btnShowVerification.visibility = View.VISIBLE
    binding.btnShowVerification.setOnClickListener {
        onShowVerification(assignment)
    }
}
```

- [ ] **Step 2: Update the `else` block**

In the existing `else -> {` block (line 234), change the button from "START TRIP" to "START LOADING":

```kotlin
else -> {
    if (assignment.guardVerified && assignment.driverConfirmed) {
        binding.tvTripStatusBadge.text = "ASSIGNED"
        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_amber)
        binding.tvTripStatusBadge.setTextColor(
            ContextCompat.getColor(ctx, R.color.white)
        )
    } else {
        binding.tvTripStatusBadge.text = assignment.tripStatus?.uppercase() ?: "PENDING"
        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_gray)
        binding.tvTripStatusBadge.setTextColor(
            ContextCompat.getColor(ctx, R.color.text_secondary)
        )
    }

    binding.btnTripAction.text = "START LOADING"

    if (hasActiveTrip) {
        binding.btnTripAction.isEnabled = false
        binding.btnTripAction.alpha = 0.4f
    } else {
        binding.btnTripAction.isEnabled = true
        binding.btnTripAction.alpha = 1.0f
    }
    binding.btnTripAction.backgroundTintList = ContextCompat.getColorStateList(ctx, R.color.sysu_red)
    binding.btnTripAction.visibility = View.VISIBLE

    binding.btnShowVerification.visibility = if (assignment.guardVerified) {
        View.VISIBLE
    } else {
        View.GONE
    }
    binding.btnShowVerification.setOnClickListener {
        onShowVerification(assignment)
    }
}
```

- [ ] **Step 3: Update button action text mapping**

Replace the existing `when (binding.btnTripAction.text)` block (around line 275-284) with:

```kotlin
binding.btnTripAction.setOnClickListener {
    val action = when (binding.btnTripAction.text) {
        "END TRIP", "ENDING..." -> "END_TRIP"
        "END SHIPMENT" -> "END_SHIPMENT"
        "START TRIP" -> "START_TRIP"
        "START LOADING" -> "START_LOADING"
        "FULLY LOADED" -> "FULLY_LOADED"
        "VERIFY WITH GUARD" -> "VERIFY_GUARD"
        "VIEW SUMMARY" -> "VIEW_SUMMARY"
        "OPEN ACTIVE TRIP" -> "OPEN_ACTIVE_TRIP"
        else -> "OPEN_ACTIVE_TRIP"
    }
    onTripActionClicked(assignment, action)
}
```

- [ ] **Step 4: Update OBD unlock condition to include `loaded`**

Change the `isObdLocked` assignment (around line 289-291) to:

```kotlin
val isObdLocked = assignment.tripStatus != "in_transit" &&
    assignment.tripStatus != "completed" &&
    assignment.tripStatus != "delivered" &&
    assignment.tripStatus != "loaded"
```

- [ ] **Step 5: Build and verify**

---

### Task 3: Add action handlers in MyTripActivity.onTripActionClicked

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt` at `onTripActionClicked`

**Interfaces:**
- Consumes: Action strings `"START_LOADING"`, `"FULLY_LOADED"`, `"VERIFY_GUARD"` from Task 2

Additional import needed:
```kotlin
import com.google.firebase.Timestamp
```

- [ ] **Step 1: Insert new action cases before the `"VIEW_SUMMARY"` case**

```kotlin
"START_LOADING" -> {
    lifecycleScope.launch {
        try {
            db.collection("sap_assignments").document(assignment.docId)
                .update(
                    mapOf(
                        "tripStatus" to "loading",
                        "loadingStartedAt" to Timestamp.now()
                    )
                )
                .await()
            Log.d(TAG, "START_LOADING: ${assignment.docId}")
            loadAssignments()
        } catch (e: Exception) {
            Log.e(TAG, "START_LOADING error: ${e.message}")
            Toast.makeText(this@MyTripActivity, "Failed to update. Check connection.", Toast.LENGTH_SHORT).show()
        }
    }
}
"FULLY_LOADED" -> {
    lifecycleScope.launch {
        try {
            db.collection("sap_assignments").document(assignment.docId)
                .update(
                    mapOf(
                        "tripStatus" to "fully_loaded",
                        "fullyLoadedAt" to Timestamp.now()
                    )
                )
                .await()
            val driverId = sessionManager.getDriverId() ?: ""
            if (driverId.isNotBlank()) {
                db.collection("drivers").document(driverId)
                    .update("isFull", true)
                    .await()
            }
            Log.d(TAG, "FULLY_LOADED: ${assignment.docId}")
            loadAssignments()
        } catch (e: Exception) {
            Log.e(TAG, "FULLY_LOADED error: ${e.message}")
            Toast.makeText(this@MyTripActivity, "Failed to update. Check connection.", Toast.LENGTH_SHORT).show()
        }
    }
}
"VERIFY_GUARD" -> {
    // Navigate to AssignmentActivity where guard verification happens.
    // The existing guard verification flow writes guardVerified=true.
    // Task 5 auto-detects tripStatus=="fully_loaded" + guardVerified==true → "loaded".
    val intent = Intent(this@MyTripActivity, AssignmentActivity::class.java).apply {
        putExtra("shipment_doc_id", assignment.docId)
        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    startActivity(intent)
}
```

- [ ] **Step 2: Build and verify**

---

### Task 4: Add action handlers in MainActivity.fetchAndSetupMyTripCards

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MainActivity.kt` lines 1629-1648 (`onTripActionClicked` callback)

- [ ] **Step 1: Insert new actions into the `when (action)` block**

Replace lines 1631-1648 with:

```kotlin
onTripActionClicked = { assignment, action ->
    when (action) {
        "START_LOADING" -> {
            lifecycleScope.launch {
                try {
                    db.collection("sap_assignments").document(assignment.docId)
                        .update(
                            mapOf(
                                "tripStatus" to "loading",
                                "loadingStartedAt" to Timestamp.now()
                            )
                        )
                        .await()
                    fetchAndSetupMyTripCards()
                } catch (e: Exception) {
                    Log.e(TAG, "START_LOADING error: ${e.message}")
                }
            }
        }
        "FULLY_LOADED" -> {
            lifecycleScope.launch {
                try {
                    db.collection("sap_assignments").document(assignment.docId)
                        .update(
                            mapOf(
                                "tripStatus" to "fully_loaded",
                                "fullyLoadedAt" to Timestamp.now()
                            )
                        )
                        .await()
                    val driverId = SessionManager(this@MainActivity).getDriverId() ?: ""
                    if (driverId.isNotBlank()) {
                        db.collection("drivers").document(driverId)
                            .update("isFull", true)
                            .await()
                    }
                    fetchAndSetupMyTripCards()
                } catch (e: Exception) {
                    Log.e(TAG, "FULLY_LOADED error: ${e.message}")
                }
            }
        }
        "VERIFY_GUARD" -> {
            val intent = Intent(this, MyTripActivity::class.java).apply {
                putExtra("shipment_doc_id", assignment.docId)
            }
            startActivity(intent)
        }
        "OPEN_ACTIVE_TRIP" -> {
            val intent = Intent(this, MyTripActivity::class.java)
            intent.putExtra("shipment_doc_id", assignment.docId)
            startActivity(intent)
        }
        "START_TRIP" -> {
            AlertDialog.Builder(this)
                .setTitle(R.string.confirm_start_trip_title)
                .setMessage(getString(R.string.confirm_start_trip_message))
                .setPositiveButton(R.string.btn_start_trip) { _, _ ->
                    startSingleShipment(assignment.docId)
                }
                .setNegativeButton(R.string.cancel, null)
                .show()
        }
    }
},
```

- [ ] **Step 2: Build and verify**

---

### Task 5: Auto-transition `fully_loaded` → `loaded` on guard verification

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/AssignmentActivity.kt` function `saveGuardVerificationToFirestore` (lines 211-264)

**Interfaces:**
- Consumes: assignment doc with `tripStatus == "fully_loaded"` being guard-verified

- [ ] **Step 1: Add auto-transition logic after the optimistic UI update**

In `saveGuardVerificationToFirestore`, replace lines 231-244 (the optimistic local update block) with:

```kotlin
// Optimistically update local list so the card instantly shows the new state
val idx = assignments.indexOfFirst { it.docId == assignment.docId }
if (idx >= 0) {
    val currentTripStatus = assignments[idx].tripStatus
    if (currentTripStatus == "fully_loaded") {
        // Guard verified a fully-loaded shipment → auto-promote to "loaded"
        assignments = assignments.toMutableList().apply {
            set(idx, assignments[idx].copy(
                tripStatus = "loaded",
                guardVerified = true,
                guardFirstName = guard.firstName,
                guardLastName = guard.lastName
            ))
        }
        // Write "loaded" to Firestore alongside guard verification
        db.collection("sap_assignments").document(assignment.docId)
            .update("tripStatus", "loaded")
            .addOnFailureListener { e ->
                Log.e(TAG, "Auto-set loaded failed: ${e.message}")
            }
    } else {
        assignments = assignments.toMutableList().apply {
            set(idx, assignments[idx].copy(
                guardVerified = true,
                guardFirstName = guard.firstName,
                guardLastName = guard.lastName
            ))
        }
    }
    submitToAdapter(assignments)
    updateAggregateBadge(assignments)
}
```

- [ ] **Step 2: Build and verify**

---

### Acceptance Criteria

1. **ASSIGNED → START LOADING**: Driver shown "ASSIGNED" badge with "START LOADING" button. Tapping it sets `tripStatus = "loading"`.
2. **LOADING → FULLY LOADED**: Driver sees "LOADING..." badge with "FULLY LOADED" button. Tapping it sets `tripStatus = "fully_loaded"` and `drivers/{id}.isFull = true`.
3. **FULLY LOADED → VERIFY WITH GUARD**: Driver sees "FULLY LOADED" badge with "VERIFY WITH GUARD" button. Tapping it navigates to AssignmentActivity for guard verification.
4. **Guard verification → LOADED**: After guard submits verification, `tripStatus` auto-pdocts to `"loaded"`. Card shows "LOADOS" badge with "START TRIP" button. OBD rows unlock.
5. **LOADED → IN TRANSIT**: Driver taps "START TRIP" — existing flow kicks in with confirmation dialog.