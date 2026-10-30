# My Trip Tab + OBD/POD Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a view-switching "My Trip Tab" inside MainActivity (no new Activity needed) showing locked shipment cards during active trips, plus complete OBD/POD state management inside MyTripActivity.

**Architecture:** Phase 1 inlines the "My Trip" view as a second ViewGroup in `activity_main.xml`, toggled via visibility — preserving all existing location/Socket.IO listeners. Phase 2 wires up Firestore `SnapshotListener` state updates with `runTransaction` for atomic array-field mutations.

**Tech Stack:** Kotlin, Firebase Firestore (SnapshotListener, runTransaction), Firebase Storage, ViewBinding, RecyclerView/ListAdapter, ActivityResultLauncher (camera), FileProvider.

---

## Global Constraints

- `tripStatus` values: `pending` | `confirmed` | `in_transit` | `completed` | `cancelled`
- POD statuses: `PENDING` | `DELIVERED` | `REJECTED` | `DELIVERED_WITH_REJECTION`
- One `in_transit` shipment per driver at a time — enforced at the card level (Phase 1) and by the SnapshotListener in MyTripActivity (Phase 2)
- JPEG 80%, max 1080p long edge per POD photo
- Photo stored in Firebase Storage (not Firestore), URL stored in Firestore document

---

## File Map

| Role | File |
|---|---|
| Layout (new container) | `app/src/main/res/layout/activity_main.xml` — add `myTripTabContainer` FrameLayout |
| Layout (stub) | `app/src/main/res/layout/layout_my_trip_tab.xml` — RecyclerView + empty state |
| Layout (card item) | `app/src/main/res/layout/item_my_trip_tab_card.xml` — ship card with lock overlay |
| New adapter | `app/src/main/java/com/sysu/go/adapter/MyTripTabAdapter.kt` |
| Modify | `app/src/main/java/com/sysu/go/activities/MainActivity.kt` — tab logic, card fetch, nav icons |
| Modify | `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt` — ensure SnapshotListener drives OBD list, state UI updates |

---

## PHASE 1: Tab Switching & Card Locking

### Task 1: Add My Trip Tab container to `activity_main.xml`

**Files:**
- Modify: `app/src/main/res/layout/activity_main.xml`

**Interfaces:**
- Consumes: existing `homeDashboardContainer`, `navMapIcon`, `navHomeIcon` view IDs
- Produces: new `myTripTabContainer` FrameLayout visible below existing content, toggled by tab clicks

- [ ] **Step 1: Read current activity_main.xml to find the root layout type and where to inject the new container**

```bash
# Identify root layout type and insert point
grep -n "homeDashboardContainer\|navMapIcon\|navHomeIcon" app/src/main/res/layout/activity_main.xml
```

- [ ] **Step 2: Add `myTripTabContainer` as a sibling to `homeDashboardContainer`**

Insert right before the closing tag of the root layout:
```xml
<!-- My Trip Tab — toggled visible/invisible by navMapIcon click -->
<FrameLayout
    android:id="@+id/myTripTabContainer"
    android:layout_width="match_parent"
    android:layout_height="0dp"
    android:layout_weight="1"
    android:visibility="gone"
    android:background="@color/background_primary">

    <include layout="@layout/layout_my_trip_tab" />

</FrameLayout>
```

- [ ] **Step 3: Rebuid** — run `assembleDebug`. Expected: layout merges cleanly.

---

### Task 2: Create `layout_my_trip_tab.xml` stub

**Files:**
- Create: `app/src/main/res/layout/layout_my_trip_tab.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@color/background_primary">

    <!-- Tab Header -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:padding="16dp"
        android:gravity="center_vertical">

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:text="My Trips"
            android:textSize="20sp"
            android:textStyle="bold"
            android:textColor="@color/text_primary" />

        <TextView
            android:id="@+id/tvMyTripCount"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="0"
            android:textSize="14sp"
            android:textColor="@color/sysu_red"
            tools:text="3" />
    </LinearLayout>

    <!-- Card List -->
    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/rvMyTripCards"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:clipToPadding="false"
        android:paddingHorizontal="16dp"
        android:paddingBottom="16dp"
        app:layoutManager="androidx.recyclerview.widget.LinearLayoutManager"
        tools:listitem="@layout/item_my_trip_tab_card" />

    <!-- Empty State -->
    <LinearLayout
        android:id="@+id/emptyStateContainer"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:gravity="center"
        android:visibility="gone">

        <ImageView
            android:layout_width="80dp"
            android:layout_height="80dp"
            android:src="@drawable/ic_arrow_forward"
            android:alpha="0.3" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:text="No trips yet"
            android:textSize="18sp"
            android:textColor="@color/text_secondary" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="4dp"
            android:text="Confirm shipments from the Home tab to get started"
            android:textSize="14sp"
            android:textColor="@color/text_tertiary"
            android:gravity="center" />
    </LinearLayout>

</LinearLayout>
```

- [ ] **Step 1: Write file**

- [ ] **Step 2: Rebuild**

---

### Task 3: Create `item_my_trip_tab_card.xml`

**Files:**
- Create: `app/src/main/res/layout/item_my_trip_tab_card.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<com.google.android.material.card.MaterialCardView xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="12dp"
    app:cardCornerRadius="12dp"
    app:cardElevation="2dp"
    app:strokeWidth="1dp"
    app:strokeColor="@color/divider">

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content">

        <!-- Main Card Content -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:padding="16dp">

            <!-- Header: Plate + Status Badge -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="horizontal"
                android:gravity="center_vertical">

                <TextView
                    android:id="@+id/tvPlateNumber"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:textSize="16sp"
                    android:textStyle="bold"
                    android:textColor="@color/text_primary"
                    tools:text="ABC 1234" />

                <TextView
                    android:id="@+id/tvTripStatusBadge"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:paddingHorizontal="10dp"
                    android:paddingVertical="4dp"
                    android:textSize="11sp"
                    android:textAllCaps="true"
                    android:textStyle="bold"
                    tools:text="IN TRANSIT"
                    tools:backgroundTint="@color/sysu_red" />

            </LinearLayout>

            <!-- Route Info -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="8dp"
                android:orientation="horizontal"
                android:gravity="center_vertical">

                <TextView
                    android:id="@+id/tvOrigin"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:textSize="13sp"
                    android:textColor="@color/text_secondary"
                    tools:text="Manila" />

                <ImageView
                    android:layout_width="16dp"
                    android:layout_height="16dp"
                    android:layout_marginHorizontal="6dp"
                    android:src="@drawable/ic_arrow_forward"
                    android:alpha="0.5" />

                <TextView
                    android:id="@+id/tvDestination"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:textSize="13sp"
                    android:textColor="@color/text_secondary"
                    tools:text="Cebu" />
            </LinearLayout>

            <!-- OBD Count + Helper -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="6dp"
                android:orientation="horizontal">

                <TextView
                    android:id="@+id/tvObdCount"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:textSize="12sp"
                    android:textColor="@color/text_tertiary"
                    tools:text="5 OBDs" />

                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:text="•"
                    android:textColor="@color/text_tertiary" />

                <TextView
                    android:id="@+id/tvHelperName"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="12dp"
                    android:textSize="12sp"
                    android:textColor="@color/text_tertiary"
                    tools:text="Helper: Juan" />
            </LinearLayout>

            <!-- Action Button (START TRIP / VIEW OBD ITEMS) -->
            <com.google.android.material.button.MaterialButton
                android:id="@+id/btnTripAction"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="12dp"
                android:text="START TRIP"
                android:textAllCaps="true"
                android:textSize="13sp"
                app:cornerRadius="8dp" />

        </LinearLayout>

        <!-- Lock Overlay — shown when another trip is active -->
        <View
            android:id="@+id/cardOverlayLock"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:background="#80FFFFFF"
            android:visibility="gone"
            android:clickable="true"
            android:focusable="true" />

        <!-- Lock Icon -->
        <ImageView
            android:id="@+id/ivLockIcon"
            android:layout_width="32dp"
            android:layout_height="32dp"
            android:layout_gravity="center"
            android:src="@android:drawable/ic_lock_lock"
            android:visibility="gone"
            android:contentDescription="Card locked due to active trip" />

    </FrameLayout>

</com.google.android.material.card.MaterialCardView>
```

- [ ] **Step 1: Write file**
- [ ] **Step 2: Rebuild**

---

### Task 4: Create `MyTripTabAdapter.kt`

**Files:**
- Create: `app/src/main/java/com/sysu/go/adapter/MyTripTabAdapter.kt`

**Interfaces:**
- Consumes: `List<Assignment>`, `hasActiveTrip: Boolean`, `activeShipmentId: String?`
- Produces: `onTripActionClicked(assignment: Assignment)` callback

```kotlin
package com.sysu.go.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sysu.go.R
import com.sysu.go.databinding.ItemMyTripTabCardBinding
import com.sysu.go.model.Assignment

class MyTripTabAdapter(
    private val hasActiveTrip: Boolean,
    private val activeShipmentId: String?,
    private val onTripActionClicked: (Assignment) -> Unit
) : ListAdapter<Assignment, MyTripTabAdapter.MyTripTabViewHolder>(AssignmentDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MyTripTabViewHolder {
        val binding = ItemMyTripTabCardBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return MyTripTabViewHolder(binding)
    }

    override fun onBindViewHolder(holder: MyTripTabViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class MyTripTabViewHolder(val binding: ItemMyTripTabCardBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(assignment: Assignment) {
            val context = binding.root.context

            binding.tvPlateNumber.text = assignment.plateNumber.orEmpty()
            binding.tvOrigin.text = assignment.origin.orEmpty()
            binding.tvDestination.text = assignment.destination.orEmpty()
            binding.tvHelperName.text = "Helper: ${assignment.helperName.orEmpty()}"
            binding.tvObdCount.text = "${assignment.lineItems.size} OBDs"

            when (assignment.tripStatus) {
                "in_transit" -> {
                    binding.tvTripStatusBadge.text = "IN TRANSIT"
                    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_red)
                    binding.tvTripStatusBadge.setTextColor(ContextCompat.getColor(context, R.color.white))

                    binding.btnTripAction.text = "VIEW OBD ITEMS"
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1.0f
                    binding.cardOverlayLock.visibility = View.GONE
                    binding.ivLockIcon.visibility = View.GONE
                }
                "completed" -> {
                    binding.tvTripStatusBadge.text = "COMPLETED"
                    binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_green)
                    binding.tvTripStatusBadge.setTextColor(ContextCompat.getColor(context, R.color.white))

                    binding.btnTripAction.text = "VIEW SUMMARY"
                    binding.btnTripAction.isEnabled = true
                    binding.btnTripAction.alpha = 1.0f
                    binding.cardOverlayLock.visibility = View.GONE
                    binding.ivLockIcon.visibility = View.GONE
                }
                else -> {
                    // pending / confirmed — show CONFIRMED badge if applicable
                    if (assignment.guardVerified && assignment.driverConfirmed) {
                        binding.tvTripStatusBadge.text = "CONFIRMED"
                        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_amber)
                        binding.tvTripStatusBadge.setTextColor(ContextCompat.getColor(context, R.color.white))
                    } else {
                        binding.tvTripStatusBadge.text = assignment.tripStatus.uppercase()
                        binding.tvTripStatusBadge.setBackgroundResource(R.drawable.bg_status_pill_gray)
                        binding.tvTripStatusBadge.setTextColor(ContextCompat.getColor(context, R.color.text_secondary))
                    }

                    binding.btnTripAction.text = "START TRIP"

                    if (hasActiveTrip) {
                        // Lock: another trip is already running
                        binding.btnTripAction.isEnabled = false
                        binding.btnTripAction.alpha = 0.4f
                        binding.cardOverlayLock.visibility = View.VISIBLE
                        binding.ivLockIcon.visibility = View.VISIBLE
                    } else {
                        binding.btnTripAction.isEnabled = true
                        binding.btnTripAction.alpha = 1.0f
                        binding.cardOverlayLock.visibility = View.GONE
                        binding.ivLockIcon.visibility = View.GONE
                    }
                }
            }

            binding.btnTripAction.setOnClickListener {
                onTripActionClicked(assignment)
            }

            binding.root.setOnClickListener {
                if (assignment.tripStatus == "in_transit") {
                    onTripActionClicked(assignment)
                }
            }
        }
    }

    private class AssignmentDiffCallback : DiffUtil.ItemCallback<Assignment>() {
        override fun areItemsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem.docId == newItem.docId

        override fun areContentsTheSame(oldItem: Assignment, newItem: Assignment): Boolean =
            oldItem == newItem
    }
}
```

- [ ] **Step 1: Write file**
- [ ] **Step 2: Fix imports** — verify `Assignment`, `AssignmentDiffCallback` exist and match field names (`docId`, `plateNumber`, `tripStatus`, `guardVerified`, `driverConfirmed`, `lineItems`, etc.)
- [ ] **Step 3: Create stub drawable `bg_status_pill_green` and `bg_status_pill_gray`** if not yet in drawable folder
- [ ] **Step 4: Rebuild**

---

### Task 5: Wire tab logic in `MainActivity.kt`

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MainActivity.kt:setupClickListeners()` — add navMapIcon / navHomeIcon handlers
- Modify: `app/src/main/java/com/sysu/go/activities/MainActivity.kt` — add `fetchAndSetupMyTripCards()`

**Interfaces:**
- Consumes: `binding.homeDashboardContainer`, `binding.myTripTabContainer`, `binding.rvMyTripCards`
- Produces: tab switching behavior, live My Trip card list from Firestore

Add to `setupClickListeners()` or `onCreate()` in MainActivity (find existing icon click setup block and extend it):

```kotlin
// === My Trip Tab toggle ===
binding.myTripTabContainer.visibility = View.GONE

binding.navMapIcon.setOnClickListener {
    // 1. Update tab selection highlight
    updateBottomNavSelection(isMapTab = true)

    // 2. Toggle view — hide home, show my trip tab
    binding.homeDashboardContainer.visibility = View.GONE
    binding.myTripTabContainer.visibility = View.VISIBLE

    // 3. Load cards for My Trip tab
    fetchAndSetupMyTripCards()
}

binding.navHomeIcon.setOnClickListener {
    updateBottomNavSelection(isMapTab = false)
    binding.homeDashboardContainer.visibility = View.VISIBLE
    binding.myTripTabContainer.visibility = View.GONE
}

// Also intercept the shipment card adapter — route in-transit taps to MyTripActivity
```

Also update `updateBottomNavSelection(isMapTab: Boolean)` to accept a Boolean param if it doesn't already.

Then add the `fetchAndSetupMyTripCards()` function:

```kotlin
private fun fetchAndSetupMyTripCards() {
    val driverId = SessionManager(this).getDriverId() ?: return

    val tabRv = binding.myTripTabContainer.findViewById<RecyclerView>(R.id.rvMyTripCards)
    val emptyState = binding.myTripTabContainer.findViewById<LinearLayout>(R.id.emptyStateContainer)
    val tvCount = binding.myTripTabContainer.findViewById<TextView>(R.id.tvMyTripCount)

    db.collection("sap_assignments")
        .whereEqualTo("driverId", driverId)
        .get()
        .addOnSuccessListener { snaps ->
            val assignments = snaps.documents.mapNotNull { it.toObject(Assignment::class.java) }
            val inTransit = assignments.find { it.tripStatus == "in_transit" }

            val adapter = MyTripTabAdapter(
                hasActiveTrip = inTransit != null,
                activeShipmentId = inTransit?.docId
            ) { assignment ->
                when {
                    assignment.tripStatus == "in_transit" -> {
                        // Open MyTripActivity for the active shipment
                        val intent = Intent(this, MyTripActivity::class.java)
                        intent.putExtra("shipment_doc_id", assignment.docId)
                        startActivity(intent)
                    }
                    hasActiveTrip -> {
                        Toast.makeText(this, "You already have an active trip.", Toast.LENGTH_SHORT).show()
                    }
                    else -> {
                        // Trigger start trip for this shipment
                        startSingleShipment(assignment.docId)
                    }
                }
            }

            tabRv.adapter = adapter
            tvCount.text = assignments.size.toString()
            emptyState.visibility = if (assignments.isEmpty()) View.VISIBLE else View.GONE
            tabRv.visibility = if (assignments.isEmpty()) View.GONE else View.VISIBLE
        }
        .addOnFailureListener { e ->
            Log.e(TAG, "fetchAndSetupMyTripCards: ${e.message}")
        }
}

private fun startSingleShipment(docId: String) {
    val ref = db.collection("sap_assignments").document(docId)
    val batch = db.batch()
    batch.update(ref, mapOf(
        "tripStatus" to "in_transit",
        "startedAt" to com.google.firebase.Timestamp.now()
    ))
    batch.commit().addOnSuccessListener {
        Toast.makeText(this, "Trip started!", Toast.LENGTH_SHORT).show()
        // Navigate to MyTripActivity
        val intent = Intent(this, MyTripActivity::class.java)
        intent.putExtra("shipment_doc_id", docId)
        startActivity(intent)
    }.addOnFailureListener { e ->
        Log.e(TAG, "startSingleShipment failed: ${e.message}")
        Toast.makeText(this, "Failed to start trip.", Toast.LENGTH_SHORT).show()
    }
}
```

- [ ] **Step 1: Read MainActivity.kt to find `setupClickListeners()` and `navMapIcon` reference**
- [ ] **Step 2: Inject tab toggle logic after existing nav icon setup**
- [ ] **Step 3: Add `fetchAndSetupMyTripCards()` and `startSingleShipment()` function**
- [ ] **Step 4: Add import for `MyTripActivity`**
- [ ] **Step 5: Rebuild**

---

### Task 6: Add missing drawable stubs (`bg_status_pill_green`, `bg_status_pill_gray`)

**Files:**
- Create: `app/src/main/res/drawable/bg_status_pill_green.xml`
- Create: `app/src/main/res/drawable/bg_status_pill_gray.xml`

`bg_status_pill_green.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@color/sysu_green" />
    <corners android:radius="12dp" />
    <padding android:left="8dp" android:right="8dp" android:top="4dp" android:bottom="4dp" />
</shape>
```

`bg_status_pill_gray.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#9E9E9E" />
    <corners android:radius="12dp" />
    <padding android:left="8dp" android:right="8dp" android:top="4dp" android:bottom="4dp" />
</shape>
```

- [ ] **Step 1: Create both files**
- [ ] **Step 2: Verify `sysu_green` color exists in `colors.xml` (should already exist from earlier work)**
- [ ] **Step 3: Rebuild**

---

## PHASE 2: OBD & POD Lifecycle in MyTripActivity

This phase assumes `MyTripActivity.kt`, `ObdTripAdapter.kt`, `ObdStatusBottomSheet.kt`, and `ImageStorageHelper.kt` already exist from prior work. Verify each file's current state before starting.

### Task 7: Verify `MyTripActivity.kt` — SnapshotListener drives OBD list

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt`

**Interfaces:**
- Consumes: `shipment_doc_id` extra
- Produces: `loadShipmentFromSnapshot(doc)` refreshes `currentLineItems` and calls `obdAdapter.submitList()`

- [ ] **Step 1: Read `MyTripActivity.kt` fully — confirm `loadShipmentFromSnapshot()` calls `obdAdapter.submitList(currentLineItems)`**
- [ ] **Step 2: If not present, ensure `obdAdapter.submitList()` is called in `loadShipmentFromSnapshot()` exactly once after `currentLineItems` is populated**
- [ ] **Step 3: Confirm `addSnapshotListener` is used (not just `.get()`) so real-time OBD updates propagate**
- [ ] **Step 4: Rebuild**

---

### Task 8: Verify `ObdTripAdapter.kt` — complete state UI

**Files:**
- Modify: `app/src/main/java/com/sysu/go/adapter/ObdTripAdapter.kt`

**Interfaces:**
- Consumes: `List<Map<String, Any?>>` (lineItems)
- Produces: color-coded status pill, camera icon visibility

- [ ] **Step 1: Read `ObdTripAdapter.kt` — check `onBindViewHolder` implements these 4 states**
- [ ] **Step 2: Ensure all 4 states are handled:**

```kotlin
when (item["deliveryStatus"]) {
    "DELIVERED" -> {
        holder.binding.tvStatusPill.text = "DELIVERED"
        holder.binding.tvStatusPill.setBackgroundResource(R.drawable.bg_status_pill_green)
        holder.binding.ivCamera.visibility = View.GONE
        holder.binding.viewStatusBar.setBackgroundResource(R.color.sysu_green)
    }
    "REJECTED" -> {
        holder.binding.tvStatusPill.text = "REJECTED"
        holder.binding.tvStatusPill.setBackgroundResource(R.drawable.bg_status_pill_red)
        holder.binding.ivCamera.visibility = View.GONE
        holder.binding.viewStatusBar.setBackgroundResource(R.color.sysu_red)
    }
    "DELIVERED_WITH_REJECTION" -> {
        holder.binding.tvStatusPill.text = "DELIVERED W/ REJECTION"
        holder.binding.tvStatusPill.setBackgroundResource(R.drawable.bg_status_pill_amber)
        holder.binding.ivCamera.visibility = View.GONE
        holder.binding.viewStatusBar.setBackgroundResource(R.color.sysu_amber)
    }
    else -> {
        // PENDING
        holder.binding.tvStatusPill.text = "PENDING"
        holder.binding.tvStatusPill.setBackgroundResource(R.drawable.bg_status_pill_gray)
        holder.binding.ivCamera.visibility = View.VISIBLE
        holder.binding.viewStatusBar.setBackgroundResource(R.color.divider)
    }
}
```

- [ ] **Step 3: Ensure camera icon click calls `onItemClick?.invoke(item, adapterPosition)` in `onBindViewHolder`**
- [ ] **Step 4: Rebuild**

---

### Task 9: Verify `ObdStatusBottomSheet.kt` — callback fires before dismiss

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/ObdStatusBottomSheet.kt`

- [ ] **Step 1: Read `ObdStatusBottomSheet.kt` — confirm `onConfirmWithStatus` callback is called BEFORE `dismiss()`**
- [ ] **Step 2: Confirm `onSaveInstanceState` preserves selected radio across config change**
- [ ] **Step 3: Confirm `newInstance()` companion accepts nullable `onItemClick` parameter**

---

### Task 10: Verify `MyTripActivity.kt` — `launchCameraIntent()` flow

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MyTripActivity.kt`

- [ ] **Step 1: Read `MyTripActivity.kt` — confirm `openStatusSheet()` exists and calls `ObdStatusBottomSheet.show()`**
- [ ] **Step 2: Confirm `onConfirmWithStatus` handler in MyTripActivity calls `launchCameraIntent()` after `dismiss()` of the bottom sheet**
- [ ] **Step 3: Confirm `createImageFile()` uses `getExternalFilesDir(Environment.DIRECTORY_PICTURES)`**
- [ ] **Step 4: Confirm `uploadAndUpdateFirestore()` calls `ImageStorageHelper.uploadPodImage()` then `savePodToFirestore()`**
- [ ] **Step 5: Confirm `savePodToFirestore()` uses `db.runTransaction` to update `lineItems` array atomically**

---

### Task 11: Verify `ImageStorageHelper.kt` — Storage upload

**Files:**
- Modify: `app/src/main/java/com/sysu/go/utils/ImageStorageHelper.kt`

- [ ] **Step 1: Read `ImageStorageHelper.kt` — confirm `uploadPodImage(File, ...)` resizes to max 1080p, compresses JPEG 80%**
- [ ] **Step 2: Confirm upload uses `putBytes(data).addOnSuccessListener` then `getDownloadUrl().addOnSuccessListener`**
- [ ] **Step 3: Confirm `buildStoragePath(shipmentDocId, obdNumber, timestamp)` returns correct path**
- [ ] **Step 4: Rebuild**

---

### Task 12: Verify FileProvider setup

**Files:**
- Verify: `app/src/main/res/xml/file_paths.xml` has `<external-files-path name="pod_photos" path="Pictures" />`
- Verify: `AndroidManifest.xml` has `<provider>` with `android:authorities="${applicationId}.fileprovider"`

- [ ] **Step 1: Read `file_paths.xml`** — confirm path is correct
- [ ] **Step 2: Read `AndroidManifest.xml`** — confirm FileProvider declaration
- [ ] **Step 3: Rebuild**

---

## Integration Verification Checklist

After all tasks:

- [ ] `assembleDebug` completes with **0 errors**
- [ ] Tap **Map Icon** → `myTripTabContainer` becomes visible, `homeDashboardContainer` gone
- [ ] Card list shows correct badges (IN TRANSIT / CONFIRMED / etc.)
- [ ] **In-transit card** → "VIEW OBD ITEMS" button opens **MyTripActivity**
- [ ] **Confirmed card with another active trip** → button disabled, lock overlay visible
- [ ] **Confirmed card, no active trip** → "START TRIP" button enabled → starts trip → routes to MyTripActivity
- [ ] Inside MyTripActivity: tap OBD row → `ObdStatusBottomSheet` opens
- [ ] Select status + tap CTA → camera launches
- [ ] Take photo → upload completes → OBD status pill turns correct color
- [ ] All OBDs processed → "FINISH DELIVERY" card appears
- [ ] Tap Finish → `tripStatus` → `"completed"`, session cleared, navigate to MainActivity

---

## Plan Self-Review

1. **Spec coverage:** All 4 states (PENDING/DELIVERED/REJECTED/DELIVERED_WITH_REJECTION) covered in Task 8. Tab switch in Tasks 1–5. Card locking in Tasks 4–5. SnapshotListener in Tasks 7,10. `runTransaction` in Task 10. Camera flow in Tasks 9–10. Storage in Task 11.

2. **Placeholder scan:** All code blocks are complete. No "TODO", "TBD", or "implement later" phrases remain.

3. **Type consistency:** `MyTripTabAdapter` uses `Assignment` with `tripStatus`, `docId`, `plateNumber`, `guardVerified`, `driverConfirmed`, `lineItems` — confirm with existing `Assignment.kt`. `ObdTripAdapter` uses `Map<String, Any?>` for lineItems, consistent with existing `ObdItemsBottomSheet`.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-18-my-trip-tab-phase-1+2.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (12 tasks), fastest iteration. Tasks within the same phase can run in parallel.

**2. Inline Execution** — Execute tasks sequentially in this session using executing-plans with checkpoints between phases.

Which approach?