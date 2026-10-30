# Guard Signature Verification — Design Spec

**Date:** 2026-05-31
**Feature:** Guard Signature Verification for Shipment OBD Items
**Status:** Draft

---

## 1. Problem Statement

The Guard at the booth needs a way to officially **verify and sign off** on OBD items they've checked. Currently they can only view the list — there's no capture of WHO verified (name + signature image + timestamp), and no record stored in the database.

---

## 2. Goals

1. Guard enters their **LN, FN, M.I.** before signing
2. Guard draws **signature** on a canvas → saved as **base64 image**
3. **Timestamp** captured at time of sign
4. All stored in the **`sap_assignments`** Firestore document
5. Post-verification: **View Verification** button shows the guard's name, signature image, and timestamp
6. **Remove the "Return" button** from Queue Details (redundant with back chevron)

---

## 3. Data Model

### New fields on `sap_assignments` document

| Field | Type | Description |
|---|---|---|
| `guardVerified` | boolean | `true` after guard verifies |
| `guardLastName` | string | Guard's last name |
| `guardFirstName` | string | Guard's first name |
| `guardMI` | string | Middle initial |
| `guardSignature` | string | Base64-encoded PNG image of signature |
| `verifiedAt` | Timestamp | Server timestamp when verified |

---

## 4. UI Design

### Location: Queue Details Screen — Below OBD Table

All new elements stay in `activity_queue_details.xml`, below the OBD items table.

---

### 4a. Pre-Verification State (`guardVerified != true` or field absent)

Displayed below the OBD table:

```
╔══════════════════════════════════════════════╗
║  LN: [________________]  FN: [________________] ║
║  M.I.: [________]                           ║
║                                              ║
║         [       VERIFY       ]              ║
╚══════════════════════════════════════════════╝
```

- Three `TextInputLayout` / `TextInputEditText` fields inline: Last Name, First Name, M.I.
- **VERIFY button**: Material button, full-width or prominent, accent color
- Fields use `textPersonName` input type, all caps hint if needed
- Form validates: all three fields required before enabling VERIFY
- Tapping VERIFY opens the signature pad

---

### 4b. Signature Pad Screen (Bottom Sheet or Full Screen)

Opens when VERIFY is tapped and form is valid:

- Canvas view for finger/stylus drawing
- **Clear** button — resets canvas
- **Confirm** button — captures base64 PNG, saves to `sap_assignments`, closes pad
- Simple, dark or neutral background so ink stands out

Implementation: Custom View with `Canvas.drawPath()` + `Bitmap.compress(Bitmap.CompressFormat.PNG, 100, ByteArrayOutputStream)` → base64 via `Base64.encodeToString()`

---

### 4c. Post-Verification State (`guardVerified == true`)

After successful save, the form area is replaced with:

```
╔══════════════════════════════════════════════╗
║      [   VIEW VERIFICATION   ]              ║
╚══════════════════════════════════════════════╝
```

Tapping VIEW VERIFICATION opens a bottom sheet / dialog:

```
╔══════════════════════════════════════════════╗
║  VERIFIED BY                                ║
║  ------------------------------------------ ║
║  Juan P. Dela Cruz                          ║
║                                              ║
║  ┌──────────────────────────────────────┐  ║
║  │                                      │  ║
║  │   [Signature Image — base64 decoded] │  ║
║  │                                      │  ║
║  └──────────────────────────────────────┘  ║
║                                              ║
║  May 31, 2026  2:45 PM                      ║
╚══════════════════════════════════════════════╝
```

---

## 5. Feature Flow

1. Driver arrives → shows QR → queue details loaded → guard sees OBD items table
2. Guard fills in LN, FN, M.I.
3. Guard taps VERIFY → form validated → signature pad opens
4. Guard draws signature → taps Confirm
5. App encodes signature → writes `guardVerified=true`, names, signature base64, `verifiedAt` timestamp to `sap_assignments` Firestore document
6. UI transitions to post-verification state (only VIEW VERIFICATION button shown)
7. Guard can tap VIEW VERIFICATION to review their submitted record

---

## 6. Firestore Update

```
sap_assignments / {docId}
  └── guardVerified:  true
  └── guardLastName:  "Dela Cruz"
  └── guardFirstName: "Juan"
  └── guardMI:         "P"
  └── guardSignature:  "iVBORw0KGgoAAAANS...=="  (base64 PNG)
  └── verifiedAt:      May 31 2026 14:45:00 PST
```

---

## 7. Screen Changes

| File | Changes |
|---|---|
| `activity_queue_details.xml` | Below OBD table: new verification section (form or view-only) |
| `activity_queue_details.xml` | Remove Return button (back chevron used) |
| `QueueDetailsActivity.kt` | Load current guard data; handle verify/sign/save logic; observe `guardVerified` state |
| New: `SignaturePadView.kt` | Custom View for drawing signature → base64 output |
| New: `dialog_guard_verification.xml` | Bottom sheet layout for VIEW VERIFICATION |

---

## 8. Error Handling

- **Empty form fields** → show inline error, VERIFY disabled
- **Canvas empty on Confirm** → toast "Please draw your signature"
- **Firestore write failure** → toast error, signature pad stays open, retry
- **No internet** → queue write locally or show error (no offline for this flow; guard must have connectivity to verify)

---

## 9. Out of Scope

- Admin web portal viewing (mobile app only for now)
- Per-OBD item signing (single sign-off for entire shipment)
- Changing/correcting signature after submission
- Multiple guards signing the same shipment

---

## 10. Implementation Priority

1. UI form + state swap (pre vs post verification)
2. Signature pad custom view
3. Base64 encoding + Firestore write
4. VIEW VERIFICATION bottom sheet