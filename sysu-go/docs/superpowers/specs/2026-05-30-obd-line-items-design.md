# OBD Line Items Table — My Queue Screen
**Date:** 2026-05-30
**Status:** Approved

---

## 1. Overview

Add a read-only OBD (Outbound Delivery) line items table to the My Queue screen (`QueueDetailsActivity`). The table appears below the existing details card (Shipment Number, Plate No., Truck Type, Helper) and above the Return button. It shows the guard checkpoint operator what items/shipments are part of this assignment.

**Data source:** `lineItems` array field on `sap_assignments` Firestore documents. Already agreed with sysu-app team — the field is live.

---

## 2. Placement & Layout

Insert a new `CardView` as a sibling below the existing details card (`androidx.cardview.widget.CardView`) and above the Return `Button`.

```
ConstraintLayout (root)
├── header (LinearLayout)
├── queueNumberBanner (FrameLayout)
├── detailsCard (CardView — existing)
├── obdItemsCard (CardView — NEW)
└── btnReturn (Button)
```

**CardView specs:**
- `android:layout_marginHorizontal="32dp"`
- `android:layout_marginTop="16dp"` (gap below details card)
- `app:cardCornerRadius="20dp"`
- `app:cardElevation="4dp"`
- `android:layout_marginBottom="16dp"` (gap above Return button)

---

## 3. Row Structure

### Empty state — `lineItems` is `null`, `undefined`, or empty `[]`

Show a single centered row:

```
<TextView
    android:text="No items to display"
    android:textColor="#999999"
    android:textStyle="italic"
    android:textSize="14sp"
    android:gravity="center"
    android:padding="24dp" />
```

### Populated state — show table

**Section header row (LinearLayout, horizontal):**
```
OBD ITEMS                    [Count badge: 4]
```
- Left: "OBD ITEMS" — 13sp, bold, color `#c8102e` (SYSU red)
- Right: count pill — 11sp, medium, `#FFFFFF` on `#c8102e`, 6dp corner radius, 8dp horizontal padding, 2dp vertical padding

**Column headers row:**
```
OBD NUMBER        QTY         AMOUNT
```
- 11sp, medium, color `#999999`, 16dp horizontal padding, 10dp vertical padding
- No dividers above/below this row

**Per-item rows (generating dynamically in Kotlin):**
```
6051555397           2         PHP 446.92
```
- `android:layout_height="50dp"`
- `android:paddingHorizontal="16dp"`
- OBD Number: 15sp, monospace weight (use `android:fontFamily="monospace"`), color `#1A1A1A`
- Quantity: 15sp, regular, right-aligned, color `#1A1A1A`, min-width 40dp
- Amount: 15sp, medium, right-aligned, color `#1A1A1A`, PHP prefix in same size/weight
- 1dp divider `#EEEEEE` below each row (except last)

---

## 4. PHP Amount Formatting

```
PHP {amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
```

Kotlin equivalent:
```kotlin
String.format("PHP %,.2f", amount)
```

Examples: `PHP 446.92`, `PHP 5,544.64`, `PHP 1,312.58`

---

## 5. Quantity Display

Display as-is integer. `2` not `2.00`. No formatting.

---

## 6. Files to Change

| File | Changes |
|---|---|
| `app/src/main/res/layout/activity_queue_details.xml` | Add `obdItemsCard` CardView with header + column row pre-declared; leave container LinearLayout empty for dynamic item rows |
| `app/src/main/java/com/sysu/go/activities/QueueDetailsActivity.kt` | In `loadQueueDetails()`, after fetching `sap_assignments`, read `lineItems` array; populate or show "No items to display"; generate row views dynamically |

---

## 7. Data Flow

```
Firebase Firestore
  └── sap_assignments collection
        └── whereEqualTo("driverId", queueId)
              └── read lineItems: Array<Map<String, Any>>
                    │
                    ▼
QueueDetailsActivity.loadQueueDetails()
  └── for each lineItem → inflate row → add to container
  └── if empty/null → show "No items" TextView, hide table rows
```

---

## 8. Backward Compatibility

- If `lineItems` field does not exist on a document (before sysu-app push), treat same as empty — show "No items to display"
- No changes to existing card or Return button

---

## 9. Testing Data

```json
[
  { "obdNumber": "6051555397", "quantity": 2, "amount": 446.92 },
  { "obdNumber": "6051555398", "quantity": 1, "amount": 5544.64 },
  { "obdNumber": "6051555396", "quantity": 1, "amount": 836.10 },
  { "obdNumber": "6051555395", "quantity": 2, "amount": 1312.58 }
]
```

Expected rendering:
- Count badge: 4
- 4 data rows with dividers
- Amounts formatted with PHP prefix and comma separators