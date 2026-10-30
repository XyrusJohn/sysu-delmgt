# CHANGELOG: OBD Line Items Schema Change
**Date:** 2026-05-30
**Status:** PENDING APPROVAL — Action Required by sysu-app (Backend / Fleet Manager)
**Priority:** HIGH — blocks driver app display of correct data
**Affected Collections:** `sap_assignments`

---

## 1. Overview

The OBD line items (`lineItems` array) stored inside each `sap_assignments`
document need to change structure. Customer requested the following:

| # | Change | Rationale |
|---|---|---|
| 1 | `quantity` must be **float or double**, not integer | Allows fractional/decimal quantities |
| 2 | `amount` field must be **removed** | No longer displayed on driver app |
| 3 | `truckCompany` field must be **removed** | No longer displayed on driver app |
| 4 | `truckPlate` field must be **removed** | No longer displayed on driver app |
| 5 | **`customerName` field must be added** | **Name of the delivery recipient / ship-to party — NOT the truck company** |
| 6 | `obdNumber` stays **unchanged** | Still the primary tracking key |

### IMPORTANT: What is `customerName`?

`customerName` refers to the **delivery recipient / ship-to party** —
the person or entity **receiving the delivery** at the destination address.

Examples of VALID `customerName` values:
- `"Juan dela Cruz — 123 Adel St. Makati"`
- `"ABC Corporation — Unit 4B BGC Taguig"`
- `"Maria Santos — LRT Station Annex"`
- `"Grab Holdings Inc — 8F Hubto Tower"`

**`customerName` is NOT the truck company or logistics company.** It is
the consignee — whoever signs for or receives the shipment at delivery.

---

## 2. Current Schema vs. Target Schema

### Current (`lineItems` item — as stored in Firestore today)

```json
{
  "obdNumber": "6051555386",
  "quantity": 229,              // int64
  "amount": 218359.24,         // double — TO BE REMOVED
  "truckCompany": "Lalamove Philippines Inc",  // string — TO BE REMOVED
  "truckPlate": "LMS-9578"     // string — TO BE REMOVED
}
```

### Target (`lineItems` item — AFTER this change)

```json
{
  "obdNumber": "6051555386",
  "quantity": 229.5,           // double (was int64)
  "customerName": "Juan dela Cruz — 123 Adel St. Makati"  // NEW: delivery recipient
}
```

### Summary of Field Changes per `lineItems` Array Element

| Field | Current Type | New Type | Action |
|---|---|---|---|
| `obdNumber` | `string` | `string` | KEEP (no change) |
| `quantity` | `int64` | `double` or `float` | **CHANGE TYPE** (must accept decimals) |
| `amount` | `double` | — | **REMOVE entirely** |
| `truckCompany` | `string` | — | **REMOVE entirely** |
| `truckPlate` | `string` | — | **REMOVE entirely** |
| `customerName` | — (none) | `string` | **ADD — delivery recipient / ship-to party** |

---

## 3. Required Changes by sysu-app Team

### 3.1 Firestore Data Migration (EXISTING DOCUMENTS)

For ALL existing documents in the `sap_assignments` collection,
a one-time migration script is required. Each `lineItems` array item
must be transformed from CURRENT structure to TARGET structure.

**Migration logic:**
```javascript
lineItems.map(item => ({
  obdNumber: item.obdNumber,
  quantity: parseFloat(item.quantity),   // ensure it is a number, decimals allowed
  customerName: item.customerName || item.truckCompany || "",
  // amount, truckCompany, truckPlate → do NOT include in new document
}))
```

> **IMPORTANT:** `customerName` = delivery recipient (ship-to party), NOT the truck company.
> If migrating from `truckCompany` as a placeholder, the data does NOT accurately
> represent the delivery recipient — a data backfill from SAP with the correct
> ship-to party name may be necessary.

Example transformation:
```
BEFORE:
{
  "obdNumber": "6051555386",
  "quantity": 229,
  "amount": 218359.24,
  "truckCompany": "Lalamove Philippines Inc",
  "truckPlate": "LMS-9578"
}

AFTER:
{
  "obdNumber": "6051555386",
  "quantity": 229.0,
  "customerName": "Juan dela Cruz — 123 Adel St. Makati"  // actual delivery recipient
}
```

---

### 3.2 SAP OData Integration / Fleet Manager Dispatch Creation

If `sap_assignments` documents are created via SAP OData integration or
a Fleet Manager dispatch endpoint, **that code must be updated:**

**Changes needed:**
1. Map the SAP OData field containing the **ship-to party / delivery recipient name**
   → to `customerName` in the Firestore document
2. Ensure `quantity` is stored as `float` or `double`, NOT rounded to integer
3. Stop writing `amount`, `truckCompany`, `truckPlate` to `lineItems` array items
4. Start writing `customerName` (the consignee / delivery recipient)

**Important:** `customerName` must come from the SAP field that represents the
**delivery destination / ship-to party**, NOT the vendor or carrier name.

**Minimum required fields per `lineItems` item:**
```json
{
  "obdNumber": "<SAP Delivery Number>",
  "quantity": "<float/double, e.g. 229.5>",
  "customerName": "<Ship-to party / delivery recipient name — from SAP OData field>"
}
```

---

### 3.3 API Response Changes

If the backend exposes an endpoint that returns `sap_assignments` data
(e.g. fleet manager dashboard API), update the response to:

- Include `customerName` in the `lineItems` array
- Exclude `amount`, `truckCompany`, `truckPlate` from `lineItems` items

---

## 4. Implications for Android App (sysu-go — Already Handled)

The Android app (`com.sysu.go`) has already been updated to consume and
render the new schema.

### 4.1 Column Labels on Driver App

The OBD items table on the My Queue screen will display:

```
┌──────────────────────────────────────────────────────────┐
│ OBD  ITEMS                                       [ 3 ]  │
├──────────────────────────────────────────────────────────┤
│  OBD NUMBER          QTY         CUSTOMER NAME          │
├──────────────────────────────────────────────────────────┤
│  6051555387            2         Juan dela Cruz           │
│  6051555388          1.5         ABC Corp — BGC           │
│  6051555396         3.25         Maria Santos — LRT      │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Android Code Already Updated

```kotlin
val obdNumber     = item["obdNumber"] as? String ?: "—"
val quantity      = item["quantity"] as? Number   // handles int, float, double
val customerName  = item["customerName"] as? String ?: "—"
```

---

## 5. Firestore Security Rules

If Firestore security rules validate the structure of `sap_assignments`
documents, update rules to:

- Allow the new `customerName` field
- Remove `amount`, `truckCompany`, `truckPlate` as required (or allow them to be absent)

```javascript
allow read, write: if request.resource.data.lineItems.size() > 0
  && request.resource.data.lineItems[0].keys().hasAll(['obdNumber', 'quantity', 'customerName'])
  && !request.resource.data.lineItems[0].keys().hasAny(['amount', 'truckCompany', 'truckPlate']);
```

> Adjust based on actual security rule implementation.

---

## 6. Test Data

Updated test payload reflecting the corrected `customerName` definition:

```json
[
  {
    "obdNumber": "6051555397",
    "quantity": 2.0,
    "customerName": "Juan dela Cruz — 123 Adel St. Makati"
  },
  {
    "obdNumber": "6051555398",
    "quantity": 1.5,
    "customerName": "ABC Corporation — Unit 4B BGC Taguig"
  },
  {
    "obdNumber": "6051555396",
    "quantity": 3.25,
    "customerName": "Maria Santos — LRT Station Annex Pasay"
  }
]
```

**Expected rendering on Android:**
```
OBD  ITEMS                     [ 3 ]
─────────────────────────────────────────────
OBD NUMBER         QTY    CUSTOMER NAME
─────────────────────────────────────────────
 6051555397          2     Juan dela Cruz — 123 Adel St.
 6051555398        1.5     ABC Corporation — Unit 4B BGC
 6051555396       3.25     Maria Santos — LRT Station Annex
─────────────────────────────────────────────
```

---

## 7. Checklist for sysu-app Team

- [ ] **Migration script**: Write and execute a one-time Firestore migration
  for ALL `sap_assignments` documents:
  - Convert `quantity` to `float/double`
  - Convert `truckCompany` or `customerName` → `customerName` (as delivery recipient)
  - Remove `amount`, `truckCompany`, `truckPlate` from `lineItems` items
  - ⚠️ If using `truckCompany` as `customerName` source, note: this is NOT
    the correct delivery recipient — a proper data backfill from the SAP
    ship-to party field may be needed for data accuracy

- [ ] **SAP OData mapping**: Update the SAP integration to:
  - Write `quantity` as float/double (not integer)
  - Map the SAP **ship-to party / delivery recipient** field → `customerName`
  - Stop writing `amount`, `truckCompany`, `truckPlate`

- [ ] **New assignment creation endpoint**: Ensure dispatch/assignment creation
  code writes the new schema with `customerName` = delivery recipient

- [ ] **Firestore security rules**: Update rules to reflect new structure

- [ ] **Fleet Manager dashboard**: If FM dashboard shows a preview of
  `lineItems`, update to show `customerName` (delivery recipient) instead
  of `amount` or `truckCompany`

- [ ] **Notify sysu-go team**: Once migration is complete, confirm so we can
  do final QA on the driver app

---

## 8. Rollout Sequence

| Step | Who | Action |
|---|---|---|
| 1 | sysu-app | Deploy new `sap_assignments` creation logic (new writes must use new schema) |
| 2 | sysu-app | Run one-time migration on ALL existing `sap_assignments` Firestore documents |
| 3 | sysu-app | Update Firestore security rules |
| 4 | sysu-app | Notify sysu-go team when migration is done |
| 5 | sysu-go | Final QA on driver app — verify all OBD items render correctly |

---

## 9. Definitions

| Term | Meaning |
|---|---|
| **Ship-to Party / Delivery Recipient** | The person or entity who **receives** the shipment at the destination |
| **customerName** | The name of the **delivery recipient**, usually includes name + delivery address |
| **truckCompany** | The trucking/logistics company (e.g. "Lalamove") — **NOT what customerName represents** |
| **obdNumber** | SAP Outbound Delivery number — the tracking identifier |

---

## 10. Questions / Contact

- **Android app owner:** sysu-go team (`com.sysu.go`)
- **Backend / Firestore owner:** sysu-app team

---

*Prepared by: sysu-go development team — 2026-05-30*