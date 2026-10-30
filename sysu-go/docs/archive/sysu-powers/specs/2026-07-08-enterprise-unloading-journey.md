> Historical design specification dated 2026-07-08. It records intended behavior, not verified current implementation.

# Enterprise Unloading Journey — POD Capture Flow Spec

> **Date:** 2026-07-08
> **Goal:** Persistent 2-step unloading flow with intermediate states, survives app restart/crash

---

## State Machine

```
PENDING (unloadStatus=null, isPodCompleted=false)
  │ tap UNLOAD → Firestore: unloadStatus="UNLOADING"
  ▼
UNLOADING (unloadStatus=UNLOADING)
  │ row: UNLOADING... amber pill + CAPTURE orange btn + orange camera
  │ tap CAPTURE → Firestore: unloadStatus="UPLOADING" → camera opens
  ▼
UPLOADING (unloadStatus=UPLOADING)
  │ row: UPLOADING PHOTO... blue pill + disabled grey btn + spinner
  │ upload completes → showObdStatusSheet (existing flow)
  ▼
COMPLETE (unloadStatus=null, deliveryStatus=DELIVERED|REJECTED|DELIVERED W/ REJECTION, isPodCompleted=true)
  │ row: DELIVERED green / REJECTED red / DEL. W/ REJ orange pill + RETAKE outlined grey btn
  │ tap RETAKE → CLEAR podImageUrl in Firestore → unloadStatus=UNLOADING → capture flow
```

---

## Firestore Fields Per OBD LineItem

| Field | Type | Values | Purpose |
|-------|------|--------|---------|
| `unloadStatus` | String? | `"UNLOADING"` / `"UPLOADING"` / `null` | Journey tracker; cleared on complete |
| `deliveryStatus` | String? | `"DELIVERED"` / `"REJECTED"` / `"DELIVERED W/ REJECTION"` / `null` | Final delivery outcome |
| `podImageUrl` | String? | base64 data URI / `null` | POD photo |
| `isPodCompleted` | Boolean | `true` when deliveryStatus saved | Completion flag |

**Constraint:** `deliveryStatus` is NEVER written during UNLOADING/UPLOADING — only at COMPLETE. This prevents partial state from appearing as a valid outcome.

---

## UI State Matrix (POD layout — item_my_trip_obd.xml)

| Phase | Status Pill | Pill Color | Action Button | Button Color | Camera Icon |
|-------|------------|------------|---------------|-------------|-------------|
| PENDING | PENDING | amber | UNLOAD | amber pill | amber camera (visible) |
| UNLOADING | UNLOADING... | amber | CAPTURE | orange pill | orange camera (visible) |
| UPLOADING | UPLOADING PHOTO... | blue | uploading... | grey pill (disabled + spinner) | disabled |
| COMPLETE | DELIVERED | green | RETAKE | outlined grey | checkmark |
| COMPLETE | REJECTED | red | RETAKE | outlined grey | checkmark |
| COMPLETE | DEL. W/ REJ | orange | RETAKE | outlined grey | checkmark |

---

## Button Behaviors

### PENDING → UNLOADING
- Tap UNLOAD → confirm dialog ("Begin unloading for {OBD} at {customer}?")
- Confirm → Firestore write `unloadStatus = "UNLOADING"` → row updates immediately
- On refresh/reopen: row reads `unloadStatus` → still shows UNLOADING

### UNLOADING → UPLOADING
- Tap CAPTURE → `unloadStatus = "UPLOADING"` in Firestore → camera fires (existing POD capture flow)
- Row immediately shows UPLOADING state
- Camera flow is entirely the existing `showObdStatusSheet` / `showObdStatusSheetWithLocation` flow with no modifications

### UPLOADING → COMPLETE
- Upload completes → existing `updateObdLineItemInFirestore` saves `deliveryStatus`, `podImageUrl`, `isPodCompleted = true`
- Existing socket listener + `onRefreshRequest` fallback updates bottom sheet
- Row reads `isPodCompleted = true` + `deliveryStatus` → shows COMPLETE state with RETAKE

### COMPLETE → RETAKE
- Tap RETAKE → Firestore: `podImageUrl = null`, `unloadStatus = "UNLOADING"`, `isPodCompleted = false`
- This effectively resets the OBD to the UNLOADING state but keeps it visible as "in progress" on refresh
- `onObdCameraTap` fires → existing POD capture flow from camera onwards
- After capture: flows through UPLOADING → COMPLETE again

---

## Bottom Sheet `refreshWith` / `setLineItems` Logic

When populating each row in `configureStatusPill`:

```
Read: unloadStatus, isPodCompleted, deliveryStatus, podImageUrl

if isPodCompleted:
    → COMPLETE branch (current code, no changes needed)
elif unloadStatus == "UPLOADING":
    → "UPLOADING PHOTO..." blue pill + disabled grey button + spinner
elif unloadStatus == "UNLOADING":
    → "UNLOADING..." amber pill + CAPTURE orange button
else:
    → "PENDING" amber pill + UNLOAD amber button (current behavior)
```

---

## Surgical Constraints

1. **Existing `showObdStatusSheet` flow** — NOT modified. Camera capture → upload → status selection → Firestore save works exactly as-is.
2. **Socket listener** — NOT modified. It re-fetches lineItems from Firestore and calls `refreshWith` — the new state logic in `configureStatusPill` handles the display.
3. **MyTripActivity** — minimal changes:
   - Before firing camera: write `unloadStatus = "UPLOADING"` to Firestore
   - RETAKE handler: write `podImageUrl = null`, `unloadStatus = "UNLOADING"`, `isPodCompleted = false`, then fire camera
4. **UNLOAD confirm**: write `unloadStatus = "UNLOADING"` in Firestore
5. **`updateObdLineItemInFirestore`**: add `unloadStatus = null` in FINAL save (COMPLETE transition)

---

## Drawables Needed

- `bg_status_pill_orange.xml` — CAPTURE button background
- `bg_status_pill_blue.xml` — UPLOADING PHOTO... pill background (may already exist — check `bg_status_pill_blue.xml`)
- `bg_status_pill_outline_grey.xml` — RETAKE outlined button

Verify before creating:
- `bg_status_pill_orange` → create if missing
- `bg_status_pill_blue` → reuse if exists
- `bg_status_pill_outline_grey` → create if missing

---

## Files to Modify

1. **`ObdItemsBottomSheet.kt`** — `configureStatusPill` state logic, remove in-memory `unloadingObdNumbers`, use `unloadStatus` from Firestore data
2. **`item_my_trip_obd.xml`** — add grey pill drawable for UPLOADING state in btn
3. **New drawables** — orange pill, outline grey pill
4. **`MyTripActivity.kt`** — wire UNLOAD confirm → Firestore write, wire RETAKE → reset + fire camera
5. **`showObdCameraTap`** (MyTripActivity) — add `unloadStatus = "UPLOADING"` write before camera
6. **Socket listener** — no change needed; just passes fresh lineItems to `refreshWith`
7. **Firestore transaction** — add `unloadStatus = null` and `isPodCompleted = false` fields on complete save

---

## Verification Checklist

- [ ] UNLOAD confirm → Firestore has `unloadStatus = UNLOADING`
- [ ] App restart → row still shows UNLOADING
- [ ] Tap CAPTURE → row immediately shows UPLOADING PHOTO...
- [ ] Upload done → status selection shows → pick DELIVERED → row shows green COMPLETE
- [ ] Tap RETAKE → podImageUrl cleared in Firestore → row shows UNLOADING again
- [ ] Scroll → state preserved (no reset)
- [ ] Existing POD rows (non-unloading flow) → unchanged behavior
- [ ] DETAIL layout → unchanged (no unload button)