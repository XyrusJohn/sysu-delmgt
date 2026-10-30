# OBD Line Items Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (recommended) or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only OBD line items table to the `My Queue` screen (`QueueDetailsActivity`), showing OBD Number, Quantity, and Amount (PHP) per item, from the `lineItems` array in `sap_assignments` Firestore documents.

**Architecture:** Two-file change in Android. Insert a new `CardView` into `activity_queue_details.xml`. Populate item rows programmatically in `QueueDetailsActivity.kt` using a dedicated `item_obd_line.xml` layout. All styling lives in XML; Kotlin handles population and empty-state toggle only.

**Tech Stack:** Android (Kotlin + XML), Firebase Firestore, ViewBinding.

---

## File Structure

| Action | File | Responsibility |
|---|---|---|
| Modify | `app/src/main/res/layout/activity_queue_details.xml` | Add `obdItemsCard` CardView with section header, column headers, empty-state TextView, and a `LinearLayout` container for item rows |
| Create | `app/src/main/res/layout/item_obd_line.xml` | Reusable row layout: OBD Number (monospace, left) \| Quantity (right) \| Amount PHP (right) with 1dp divider above |
| Modify | `app/src/main/java/com/sysu/go/activities/QueueDetailsActivity.kt` | After fetching `sap_assignments`, read `lineItems`; populate container with `item_obd_line` rows or show empty state |

---

## Task 1: Add OBD Items CardView to `activity_queue_details.xml`

**Files:**
- Modify: `app/src/main/res/layout/activity_queue_details.xml:217-218`

**Reference layout context (line 216–232):**
```xml
        </LinearLayout>
    </androidx.cardview.widget.CardView>

    <!-- Return Button -->
    <Button
        android:id="@+id/btnReturn"
```

Insert the new card **between line 217** (`</androidx.cardview.widget.CardView>`) and line 219 (`<!-- Return Button -->`).

**Steps:**

- [ ] **Step 1: Add dimensions**

Add to `app/src/main/res/values/dimens.xml` (create file if missing — check with `Glob` first):
```xml
<?xml version="1d" encoding="utf-8"?>
<resources>
    <dimen name="card_margin_horizontal">32dp</dimen>
    <dimen name="card_corner_radius">20dp</dimen>
    <dimen name="card_elevation">4dp</dimen>
    <dimen name="card_spacing">16dp</dimen>
    <dimen name="obd_row_height">50dp</dimen>
    <dimen name="obd_padding_horizontal">16dp</dimen>
    <dimen name="obd_col_header_padding_vert">10dp</dimen>
    <dimen name="obd_col_header_padding_horiz">16dp</dimen>
    <dimen name="obd_empty_padding">24dp</dimen>
</resources>
```

Run: `grep -n "dimens.xml" app/src/main/res/values/` to check if it already exists.

- [ ] **Step 2: Insert the OBD Items CardView**

After line 217 (`</androidx.cardview.widget.CardView>`) and before line 219 (`<!-- Return Button -->`), insert:

```xml
    <!-- OBD Items Card -->
    <androidx.cardview.widget.CardView
        android:id="@+id/cardObdItems"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginHorizontal="@dimen/card_margin_horizontal"
        android:layout_marginTop="@dimen/card_spacing"
        android:layout_marginBottom="@dimen/card_spacing"
        app:cardCornerRadius="@dimen/card_corner_radius"
        app:cardElevation="@dimen/card_elevation"
        app:layout_constraintTop_toBottomOf="@id/cardDetails"
        app:layout_constraintBottom_toTopOf="@id/btnReturn"
        app:layout_constraintVertical_bias="0">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:paddingTop="4dp"
            android:paddingBottom="4dp">

            <!-- Section header: OBD ITEMS + count pill -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:paddingHorizontal="@dimen/obd_col_header_padding_horiz"
                android:paddingVertical="12dp">

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="OBD ITEMS"
                    android:textColor="@color/sysu_red"
                    android:textSize="13sp"
                    android:textStyle="bold"
                    android:letterSpacing="0.04" />

                <TextView
                    android:id="@+id/tvObdCount"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:background="@drawable/bg_obd_count_pill"
                    android:paddingHorizontal="8dp"
                    android:paddingVertical="2dp"
                    android:text="0"
                    android:textColor="@color/white"
                    android:textSize="11sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <!-- Column headers row -->
            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:paddingHorizontal="@dimen/obd_col_header_padding_horiz"
                android:paddingVertical="@dimen/obd_col_header_padding_vert">

                <TextView
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:text="OBD NUMBER"
                    android:textColor="#999999"
                    android:textSize="11sp"
                    android:textStyle="bold" />

                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:minWidth="40dp"
                    android:gravity="end"
                    android:text="QTY"
                    android:textColor="#999999"
                    android:textSize="11sp"
                    android:textStyle="bold" />

                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:minWidth="110dp"
                    android:gravity="end"
                    android:text="AMOUNT"
                    android:textColor="#999999"
                    android:textSize="11sp"
                    android:textStyle="bold" />
            </LinearLayout>

            <!-- Divider below column headers -->
            <View android:layout_width="match_parent" android:layout_height="1dp" android:background="#EEEEEE" />

            <!-- Empty state (hidden by default, shown when no items) -->
            <TextView
                android:id="@+id/tvObdEmpty"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center"
                android:padding="@dimen/obd_empty_padding"
                android:text="No items to display"
                android:textColor="#999999"
                android:textStyle="italic"
                android:textSize="14sp"
                android:visibility="gone" />

            <!-- Dynamic rows container — item_obd_line rows will be added here by Kotlin -->
            <LinearLayout
                android:id="@+id/llObdItemsContainer"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical" />
        </LinearLayout>
    </androidx.cardview.widget.CardView>
```

- [ ] **Step 3: Create pill background drawable for count badge**

Create `app/src/main/res/drawable/bg_obd_count_pill.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@color/sysu_red" />
    <corners android:radius="6dp" />
</shape>
```

- [ ] **Step 4: Verify layout renders**

Open `activity_queue_details.xml` in Android Studio layout preview. Confirm: card appears between the details card and Return button, empty state is hidden by default, count pill is red, section header is red bold.

---

## Task 2: Create `item_obd_line.xml` row layout

**Files:**
- Create: `app/src/main/res/layout/item_obd_line.xml`

**Steps:**

- [ ] **Step 1: Create item layout**

Create `app/src/main/res/layout/item_obd_line.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="@dimen/obd_row_height"
    android:gravity="center_vertical"
    android:paddingHorizontal="@dimen/obd_col_header_padding_horiz"
    android:orientation="horizontal"
    android:background="?attr/selectableItemBackground">

    <!-- OBD Number — monospace left-aligned -->
    <TextView
        android:id="@+id/tvObdNumber"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:fontFamily="monospace"
        android:textColor="#1A1A1A"
        android:textSize="15sp"
        android:textStyle="normal"
        android:ellipsize="end"
        android:maxLines="1" />

    <!-- Quantity — right-aligned, fixed min-width -->
    <TextView
        android:id="@+id/tvObdQuantity"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:minWidth="40dp"
        android:gravity="end"
        android:textColor="#1A1A1A"
        android:textSize="15sp"
        android:textStyle="normal" />

    <!-- Amount — right-aligned with PHP prefix, fixed min-width -->
    <TextView
        android:id="@+id/tvObdAmount"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:minWidth="110dp"
        android:gravity="end"
        android:textColor="#1A1A1A"
        android:textSize="15sp"
        android:textStyle="bold" />
</LinearLayout>
```

- [ ] **Step 2: Update the ViewBinding**

Since this is a new file, Android ViewBinding will auto-generate `ItemObdLineBinding` on next build. No additional changes needed for binding class.

- [ ] **Step 3: Verify**

Open `item_obd_line.xml` in Android Studio layout preview. Confirm: 3-column row, 50dp height, OBD number is monospace and left-aligned, quantity and amount are right-aligned with their respective min-widths respected.

---

## Task 3: Wire up OBD items in `QueueDetailsActivity.kt`

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/QueueDetailsActivity.kt`

**Current `loadQueueDetails()` sap_assignments block (lines 79–88):**
```kotlin
// Check for shipment assignment
val queueId = snapshots.documents[0].id
db.collection("sap_assignments")
    .whereEqualTo("driverId", queueId)
    .get()
    .addOnSuccessListener { assignSnaps ->
        if (!assignSnaps.isEmpty) {
            binding.tvShipmentNumber.text = assignSnaps.documents[0].id
        }
    }
```

**Steps:**

- [ ] **Step 1: Add LayoutInflater import**

Add after the existing imports block:
```kotlin
import android.view.LayoutInflater
import com.sysu.go.R
import com.sysu.go.databinding.ItemObdLineBinding
```

- [ ] **Step 2: Replace the sap_assignments block**

Replace the `addOnSuccessListener` body (lines 84–88) with:
```kotlin
    if (!assignSnaps.isEmpty) {
        binding.tvShipmentNumber.text = assignSnaps.documents[0].id

        // Populate OBD line items
        val lineItemsRef = assignSnaps.documents[0].get("lineItems")
        if (lineItemsRef != null && lineItemsRef is List<*>) {
            val lineItems = lineItemsRef.filterIsInstance<Map<String, Any>>()
            if (lineItems.isNotEmpty()) {
                populateObdItems(lineItems)
            } else {
                showObdEmptyState()
            }
        } else {
            showObdEmptyState()
        }
    }
```

- [ ] **Step 3: Add `populateObdItems()` function**

After `loadQueueDetails()`, add:
```kotlin
private fun populateObdItems(lineItems: List<Map<String, Any>>) {
    val container = binding.llObdItemsContainer
    val itemBinding = ItemObdLineBinding::class

    binding.tvObdCount.text = lineItems.size.toString()

    container.removeAllViews()
    lineItems.forEachIndexed { index, item ->
        val rowBinding = ItemObdLineBinding.inflate(
            LayoutInflater.from(this),
            container,
            false
        )

        rowBinding.tvObdNumber.text = item["obdNumber"] as? String ?: "—"

        val quantity = item["quantity"] as? Number
        rowBinding.tvObdQuantity.text = quantity?.toInt()?.toString() ?: "—"

        val amount = item["amount"] as? Number
        val amountFormatted = if (amount != null) {
            String.format("PHP %,.2f", amount.toDouble())
        } else {
            "PHP —"
        }
        rowBinding.tvObdAmount.text = amountFormatted

        container.addView(rowBinding.root)

        // Add divider after each row except the last
        if (index < lineItems.size - 1) {
            val divider = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, 1
                )
                setBackgroundColor(getColor(R.color.surface2))
            }
            container.addView(divider)
        }
    }

    // Show container, hide empty state
    binding.tvObdEmpty.visibility = View.GONE
    container.visibility = View.VISIBLE
}
```

- [ ] **Step 4: Add `showObdEmptyState()` function**

After `populateObdItems()`, add:
```kotlin
private fun showObdEmptyState() {
    binding.tvObdCount.text = "0"
    binding.llObdItemsContainer.removeAllViews()
    binding.tvObdEmpty.visibility = View.VISIBLE
    binding.llObdItemsContainer.visibility = View.GONE
}
```

- [ ] **Step 5: Add View import**

Ensure `View` is imported (add to imports if not present):
```kotlin
import android.view.View
```

- [ ] **Step 6: Build and verify**

Run: `./gradlew assembleDebug --no-daemon`
Expected: BUILD SUCCESSFUL

Connect device/emulator and navigate to My Queue → Queue Details. Verify:
- Empty state: "No items to display" centered, count shows "0"
- With test `lineItems` data: 4 rows appear with correct OBD numbers, quantities, PHP-formatted amounts, and dividers between rows

---

## Spec Coverage Checklist

- [x] OBD Number column (monospace, left-aligned) → `tvObdNumber` in `item_obd_line.xml`
- [x] Quantity column (integer, right-aligned) → `tvObdQuantity` in `item_obd_line.xml`
- [x] Amount column (PHP formatted `String.format("PHP %,.2f", ...)`, right-aligned) → `tvObdAmount` in `item_obd_line.xml`
- [x] Count badge in section header → `tvObdCount`
- [x] Empty state "No items to display" → `tvObdEmpty` with `visibility="gone"` initially
- [x] Divider between rows → added programmatically in `populateObdItems()`
- [x] PHP amount formatting → `String.format("PHP %,.2f", amount.toDouble())`
- [x] Null/undefined/empty `lineItems` → `showObdEmptyState()` called
- [x] New card between details card and Return button → `app:layout_constraintTop_toBottomOf` and `app:layout_constraintBottom_toTopOf`
- [x] SYSU red section header → `android:textColor="@color/sysu_red"`
- [x] Test data renders correctly → test with sample `lineItems` array