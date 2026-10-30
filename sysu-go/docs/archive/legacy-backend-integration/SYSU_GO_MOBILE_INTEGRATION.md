> Release correction (2026-10-08): POST /api/dispatch/status is retired in local source. Authenticated calls return 410; anonymous calls return 401. It no longer writes assignments/queues or emits dispatch_status_update. Earlier descriptions below are historical and superseded. No shipped Android HTTP caller was found; external clients need migration. Full owned progress/POD acceptance remains G-16. See [current release tracker](../../FIX_TRACKER.md) and [executed evidence](../../RELEASE_FIXES_TDD.md). This change is not yet deployed.

# SYSU-Go Mobile App — Full Integration Guide
> **For sysu-go Android/Kotlin Team + sysu-go Backend Team**
> Last Updated: 2026-05-26 (fully audited against actual code)
>
> **AS BUILT vs AS DOCUMENTED — READ THIS FIRST**
>
> This document was audited against the actual codebase on 2026-05-26.
> Items marked **⚠️ NOT BUILT** are referenced in the spec but **do not exist in code yet**.
> Items marked **✅ BUILT** have been verified against actual backend files.
>
> **Critical finding**: `POST /api/trip/register` is documented as implemented but
> the backend has NO `tripController.js` and NO `tripRoute.js`. The endpoint does not exist.
> Similarly, input sanitization referenced throughout this doc does not exist in `qrController.js`.
>
> The mobile app's `TripApiService.kt` and `TripRegistrationActivity` have been built to spec,
> but the backend they talk to does not exist. These must be implemented before end-to-end works.

---

## TABLE OF CONTENTS

1. [AS BUILT Status Summary](#1-as-built-status-summary)
2. [Overview: Complete Driver Flow](#2-overview-complete-driver-flow)
3. [Driver Registration](#3-driver-registration)
4. [QR Scan — Queue Join Flow](#4-qr-scan--queue-join-flow)
5. [Trip Registration — ⚠️ NOT BUILT ON BACKEND](#5-trip-registration--not-built-on-backend)
6. [API Contract — AS BUILT](#6-api-contract--as-built)
7. [Firestore Queue Schema — AS BUILT](#7-firestore-queue-schema--as-built)
8. [Socket.IO Events — Verified](#8-socketio-events--verified)
9. [Backend Required Changes Checklist](#9-backend-required-changes-checklist)
10. [Android Required Changes Checklist](#10-android-required-changes-checklist)
11. [Testing Checklist](#11-testing-checklist)

---

## 1. AS BUILT Status Summary

### ✅ VERIFIED BUILT IN BACKEND CODE

| Item | File | Evidence |
|------|------|----------|
| `GET /api/qr/generate` | `qrController.js:21` | Generates SYS-XXXXXX token, writes to `qr_tokens/` |
| `GET /api/qr/verify` | `qrController.js:47` | Checks token validity, returns 200/404/410 |
| `POST /api/qr/scan` | `qrController.js:81` | Marks token used, creates queue entry with `status: "queued"`, emits `qr_token_used` |
| `qr_token_used` socket event | `qrController.js:138` | Emitted ONLY from `scanQR`, NOT from `verifyQR` |
| `GET /api/qr/queue` | `qrController.js:191` | Returns queue grouped by truck type |
| `PATCH /api/qr/queue-status` | `qrController.js:219` | Admin updates queue entry status |
| `POST /api/dispatch/status` | `dispatchRoutes.js:10` | Writes to `sap_assignments/`, emits `dispatch_status_update` |
| `POST /api/users/update-role` | `userRoutes.js:7` | Valid roles include `"driver"` — verified ✅ |
| `POST /api/users/delete` | `userRoutes.js:31` | Deletes user doc + disables Auth user |
| CORS with env var | `server.js:26-32` | Uses `ALLOWED_ORIGINS` env var |
| Socket.IO handshake auth | `server.js:103` | Verifies Firebase ID token on handshake |
| `status: "queued"` write | `qrController.js:129` | Explicit comment: "must match what mobile queries for" |

### ⚠️ NOT BUILT — NEEDS IMPLEMENTATION

| Item | Priority | Why Missing |
|------|----------|-------------|
| `POST /api/trip/register` | **HIGH** | No `tripController.js`, no `tripRoute.js` in codebase |
| Input sanitization in `qrController.js` | **HIGH** | Zero sanitization — raw `req.body` values written to Firestore |
| `registrationComplete` field write | **HIGH** | Not in `scanQR` queue write |
| `driverFN`, `driverMI`, `driverLN` separate fields | **MEDIUM** | Only `driverName` (full string) is written |
| `helperFN`, `helperMI`, `helperLN` separate fields | **MEDIUM** | Only `helper` (full string) is written |
| `company`, `platePrefix`, `plateSuffix` fields | **MEDIUM** | Not written by any backend endpoint |
| `GET /api/qr/verify` → `qr_token_used` emission | **LOW** | Only `scanQR` emits; `verifyQR` does NOT emit this event |

---

## 2. Overview: Complete Driver Flow

```
NEW DRIVER                          SYSU-GO BACKEND                    Firestore
                                        │                                   │
[1] Login with Google Firebase Auth       │                                   │
    → FirebaseUser obtained               │                                   │
                                                                              │
[2] Registration (full name, email,        │                                   │
    password via RegistrationActivity)     │                                   │
    → users/{uid}.set({displayName,        │                                   │
         email, role: "driver"})           │                                   │
                                                                              │
[3] App calls GET /api/qr/generate        │ { token: "SYS-XXXXXXXX" }        │
    ← ─────────────────────────────────── │                                   │
                                                                              │
[4] Driver scans QR on TV                  │                                   │
    → GET /api/qr/verify?token=SYS-XXX    │ Checks: exists, not isUsed,      │
                                        │   not expired                     │
                                        │ ← ───────────────────────────────── │
                                        │ NO qr_token_used here (⚠️)        │
                                        │ Only scanQR emits it              │
                                                                              │
[5] App calls POST /api/qr/scan           │                                   │
    (token, driverId, driverName,         │ qr_tokens/{token}.isUsed = true  │
    truckType, plateNumber, ...)          │ ← ───────────────────────────────── │
                                        │ queue.add({                       │
                                        │   driverId, driverName,          │
                                        │   status: "queued", ← ⚠️ NOTE    │
                                        │   isAssigned: false,             │
                                        │   joinedAt: serverTS(),            │
                                        │ })                                │
                                        │ ← ───────────────────────────────── │
                                        │ Socket.io: "qr_token_used"        │
                                        │   → ALL QR Generators refresh     │
                                                                              │
    App shows UpdateInfoActivity form       │                                   │
    (NOT TripRegistrationActivity —         │                                   │
     TripRegistrationActivity ⚠️ NOT BUILT)│                                   │
                                                                              │
[6] Driver enters truck info in UpdateInfoActivity │
    → Writes to Firestore "drivers/{uid}"  │                                   │
       (NOT to queue document)              │                                   │
                                                                              │
    ✅ Driver in queue — visible on QR TV  │                                   │
    ❌ Driver NOT in Fleet Manager         │                                   │
       (registrationComplete field         │                                   │
        NOT written by backend)            │                                   │
                                                                              │
[7] NO TRIP REGISTRATION YET — ⚠️         │                                   │
    POST /api/trip/register does NOT EXIST │
    Driver remains in `registrationComplete: ???` │
    (field not written by backend at all)  │                                   │
    driver is visible on QR TV but NOT     │                                   │
    distinguishable in Fleet Manager       │                                   │
```

**Critical limitation:** Without `POST /api/trip/register`, every driver is immediately
visible in Fleet Manager based purely on queue existence. The two-phase enrollment
described in other docs (QR scan → visibility on QR TV; trip register → visibility in Fleet Manager)
is **not yet functional** because `registrationComplete` is never set.

---

## 3. Driver Registration

### 3.1 Registration Form Fields (Android — `RegistrationActivity.kt`)

**Current state:** Single `Full Name` field (no FN/MI/LN split)

```kotlin
// Current code (RegistrationActivity.kt:34-39)
// Only captures: name, email, password, truckCompany
val name = binding.etFullName.text.toString().trim()
val email = binding.etEmail.text.toString().trim()
val password = binding.etPassword.text.toString()
val truckCompany = binding.etTruckCompany.text.toString().trim()
```

**What gets written to Firestore:**
```json
{
  "displayName": "Full Name String",
  "email": "driver@email.com",
  "role": "driver",
  "photoURL": "https://...",
  "createdAt": "<Firestore Timestamp>"
}
```

**Note:** `driverData: {fn, mi, ln}` is NOT written by current registration.
The backend accepts `"driver"` as a valid role in the update-role endpoint (verified in `userRoutes.js:14`).

---

## 4. QR Scan — Queue Join Flow

### 4.1 Generate QR Token

```
GET /api/qr/generate
```

**Response (200):**
```json
{
  "success": true,
  "token": "SYS-A1B2C3D4E5F6",
  "expiresAt": "2026-05-28T10:00:00.000Z",
  "scanUrl": "https://sysu-web-5a25d.web.app/scan?token=SYS-A1B2C3D4E5F6"
}
```

### 4.2 Verify Token — ⚠️ IMPORTANT: Does NOT Reset QR or Emit Event

```
GET /api/qr/verify?token=SYS-A1B2C3D4E5F6
```

**What it does (verified from `qrController.js:47`):**
1. Checks token exists in `qr_tokens/`
2. Checks `isUsed === false`
3. Checks not expired
4. Returns 200 if valid

**What it does NOT do:**
- Does NOT mark token as used (that only happens in `scanQR`)
- Does NOT emit `qr_token_used` (only `scanQR` emits this — `qrController.js:138`)

**Response (200) — token valid:**
```json
{ "success": true, "message": "Token verified", "token": "SYS-A1B2C3D4E5F6" }
```

**Response (410) — token used or expired:**
```json
{ "success": false, "message": "Token already used" }
```

**Response (404) — token invalid:**
```json
{ "success": false, "message": "Invalid or expired token" }
```

### 4.3 Join Queue — `POST /api/qr/scan`

```
POST /api/qr/scan
Authorization: Bearer <Firebase ID Token>  ← optional unless QR_SCAN_REQUIRE_AUTH=true
Content-Type: application/json

{
  "token": "SYS-A1B2C3D4E5F6",
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "driverFN": "Juan",         ← Android model HAS this, but UpdateInfoActivity
  "driverMI": "M",             ← does NOT populate it (sends default/empty)
  "driverLN": "Cruz",          ← only driverName (full string) is required
  "truckType": "10W",
  "plateNumber": "ABC 1234",
  "truckCompany": "ABC Logistics",
  "helperName": "Maria Santos"
}
```

**Minimum required:** `token` + `driverId` + `driverName` + `truckType` + `plateNumber`

**⚠️ Sanitization status:** NONE exists in current code. Raw strings written to Firestore.

**Response (200):**
```json
{
  "success": true,
  "message": "Successfully joined the queue",
  "queueId": "firestore-auto-id-abc123",
  "queuePosition": 3
}
```

**⚠️ NOTE: `queueId` is Firestore auto-generated document ID — NOT the `driverId`.**
**Mobile app must save this `queueId` for any future trip registration call.**

**Side effects on success (from `qrController.js`):**
1. `qr_tokens/{token}.isUsed` → `true` (line 111)
2. `queue/{newId}` created (lines 117-132)
3. `qr_token_used` socket event emitted (line 138)
4. `queue_update` socket event emitted (line 152)

### 4.4 Queue Query (Mobile — `MainActivity.kt`)

```kotlin
// MainActivity.kt:105-107 — CORRECT, uses "queued"
db.collection("queue")
    .whereEqualTo("driverId", driverId)
    .whereEqualTo("status", "queued")  // ⚠️ This is correct — backend writes "queued"
    .addSnapshotListener { ... }
```

**⚠️ The mobile app correctly queries for `"queued"`. The backend writes `"queued"`.
This alignment is correct.**

---

## 5. Trip Registration — ⚠️ NOT BUILT ON BACKEND

### What Exists

**Android:** `TripApiService.kt` and `TripRegistrationActivity` are built to spec.
**Backend:** `tripController.js` and `tripRoute.js` **DO NOT EXIST**.
`server.js` has NO `app.use("/api/trip", ...)` route.

### How It Should Work (Spec Only — Not Implemented)

```
POST /api/trip/register
Authorization: Bearer <Firebase ID Token>

{
  "queueId": "firestore-auto-id-abc123",
  "helperFN": "Maria",
  "helperMI": "L",
  "helperLN": "Santos",
  "company": "ABC Logistics Corp.",
  "truckType": "10W",
  "platePrefix": "ABC",
  "plateSuffix": "1234"
}
```

**Expected behavior (not implemented):**
1. Fetch queue document — verify it exists
2. Verify `registrationComplete !== true`
3. Sanitize all inputs (strip `< > & " ' ; \ /`, collapse whitespace)
4. Write: `helperFN`, `helperMI`, `helperLN`, `helper` (full computed string)
5. Write: `company`, `platePrefix`, `plateSuffix`, `plateNumber` (computed)
6. Write: `registrationComplete: true`
7. Emit `qr_token_used` via Socket.IO
8. Return success

**⚠️ This endpoint needs to be implemented in:**
- `backend/routes/tripRoute.js` (NEW)
- `backend/controller/tripController.js` (NEW)
- `server.js`: Add `app.use("/api/trip", require("./routes/tripRoute.js"))`

### Expected Queue Document After Trip Registration (Spec — Not Implemented)

```json
{
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "helper": "Maria L. Santos",
  "company": "ABC Logistics Corp.",
  "truckType": "10W",
  "platePrefix": "ABC",
  "plateSuffix": "1234",
  "plateNumber": "ABC-1234",
  "registrationComplete": true,   ← ⚠️ NOT written by current code
  "status": "queued",             ← ⚠️ should eventually be "waiting"
  "isAssigned": false,
  "joinedAt": "<Firestore Timestamp>"
}
```

---

## 6. API Contract — AS BUILT

### Base URLs

| Environment | REST API |
|---|---|
| Production | `https://sysu-app.onrender.com` |
| Local | `http://localhost:8080` |

**Auth header (for protected endpoints):** `Authorization: Bearer <Firebase ID Token>`

---

### `GET /api/qr/generate` — ✅ BUILT (qrController.js:21)

No auth required. Returns a fresh token for TV display.

---

### `GET /api/qr/verify?token=XXX` — ✅ BUILT (qrController.js:47)

Does NOT mark token as used. Does NOT emit `qr_token_used`.

**⚠️ Key behavior (this doc is the authoritative source):**
```
verifyQR: Checks validity only. Read-only operation.
scanQR: Marks token as used, creates queue entry, emits qr_token_used.
```

---

### `POST /api/qr/scan` — ✅ BUILT (qrController.js:81)

**Auth:** Optional — controlled by `QR_SCAN_REQUIRE_AUTH` env var (qrRoutes.js:9).
When disabled (default), no Bearer token needed.
When enabled, mobile app must send `Authorization: Bearer <idToken>`.

**Fields sent by Android (from `ScanRequest` model):**
```kotlin
data class ScanRequest(
    val token: String,
    val driverId: String,
    val driverName: String,
    val driverFN: String,      // ← Android model has, NOT populated by UpdateInfoActivity
    val driverMI: String,      // ← NOT populated
    val driverLN: String,      // ← NOT populated
    val truckType: String,
    val truckCompany: String,
    val plateNumber: String,
    val helperName: String
)
```

**Current implementation:**
```javascript
// qrController.js:83 — destructures all fields but only uses some
const { token, driverName, helperName, truckCompany, truckType, plateNumber, driverId } = req.body;
```

⚠️ **Backend currently IGNORES `driverFN`, `driverMI`, `driverLN`**, `company`, `platePrefix`, `plateSuffix`, `registrationComplete`. Only writes the fields shown in queue schema below.

**Queue write (qrController.js:117-132):**
```javascript
const queueEntry = {
  id: queueRef.id,
  driverId,
  driverName,
  helper: helperName || null,   // Note: writes "helper" not "helperName"
  truckCompany: truckCompany || null,
  truckType,
  plateNumber,
  entryTime: FieldValue.serverTimestamp(),
  joinedAt: FieldValue.serverTimestamp(),
  isAssigned: false,
  status: "queued",             // ⚠️ THIS IS THE ACTUAL VALUE
  notes: "",
};
```

---

### `POST /api/trip/register` — ⚠️ NOT BUILT

**Do not attempt to call this endpoint.** The route does not exist in `server.js`.
When the backend team implements it, use the spec in Section 5 above.

---

### `PATCH /api/qr/queue-status` — ✅ BUILT (qrController.js:219)

**Auth:** Requires `Authorization: Bearer <Firebase ID Token>` (verified against `verifyToken` middleware).

**Valid status values:**
```
"queued", "waiting", "called", "loading", "in_transit", "complete", "departed", "cancelled"
```

---

### `GET /api/qr/queue` — ✅ BUILT (qrController.js:191)

No auth. Returns queue grouped by truck type:
```json
{
  "success": true,
  "queue": {
    "AUV": [...],
    "4W": [...],
    "6W": [...],
    "10W": [...],
    "20F": [...],
    "40F": [...]
  }
}
```

⚠️ Uses `where("status", "in", ["queued", "called"])` + `orderBy("joinedAt", "asc")` — requires composite Firestore index.

---

### `POST /api/dispatch/status` — ✅ BUILT (dispatchRoutes.js:10)

**Valid status values:** `assigned`, `loading`, `in_transit`, `delivered`, `cancelled`

**Emits:** `dispatch_status_update` socket event.

---

### `POST /api/users/update-role` — ✅ BUILT (userRoutes.js:7)

**Valid roles:** `"admin"`, `"super_admin"`, `"fleet_manager"`, `"qr_generator"`, `"pending"`, `"driver"` (✅ `"driver"` IS accepted as of current code).

---

## 7. Firestore Queue Schema — AS BUILT

### After `POST /api/qr/scan` (Phase 1 — ACTUAL)

```json
{
  "id": "abc123xyz",                    // ← Firestore auto-generated doc ID
  "driverId": "firebase-uid-xxxxx",     // ← Firebase UID (NOT same as doc ID)
  "driverName": "Juan M. Cruz",         // ← Full name string only
  "helper": "Maria Santos",             // ← Full helper name (NOT split into FN/MI/LN)
  "truckCompany": "ABC Logistics",      // ← Written as-is, no sanitization
  "truckType": "10W",                  // ← AUV, 4W, 6W, 10W, 20F, 40F
  "plateNumber": "ABC 1234",
  "entryTime": "<Firestore Timestamp>",
  "joinedAt": "<Firestore Timestamp>",
  "status": "queued",                   // ← ⚠️ ACTUAL VALUE — NOT "waiting"
  "isAssigned": false,
  "notes": ""
}
```

**MISSING from current backend write:**
- `registrationComplete` (not written)
- `driverFN`, `driverMI`, `driverLN` (not written separately)
- `helperFN`, `helperMI`, `helperLN` (not written separately)
- `company` (only `truckCompany` written)
- `platePrefix`, `plateSuffix` (only `plateNumber` written)
- `token` is NOT stored in queue doc (only checked in qr_tokens/)

### After Trip Registration (Phase 2 — SPEC ONLY, NOT YET BUILT)

See Section 5 above. The Phase 2 schema describes what SHOULD exist once `POST /api/trip/register` is implemented.

---

## 8. Socket.IO Events — Verified

### Connection

```kotlin
val socket = IO.socket("https://sysu-app.onrender.com")
socket.connect()
```

**Handshake auth:** Pass Firebase ID token:
```javascript
const socket = io.connect(URL, {
  auth: { token: firebaseIdToken }
});
```

### Events Emitted by Mobile App → Backend

#### `driver_moving` — ✅ VERIFIED
Emitted on GPS update (throttle: ≥30m movement OR ≥20 seconds).
Backend verifies `driverId === verifiedUid` — spoofing prevented.

```json
{
  "driverId": "firebase-uid-xxxxx",
  "lat": 14.5995,
  "lng": 120.9842,
  "name": "Juan M. Cruz",
  "status": "online",
  "heading": 45,
  "speed": 30
}
```

#### `update_status` — ✅ VERIFIED
Emitted when driver goes online/offline.
Backend broadcasts: `vendor_status_update` with driver name and status.

---

### Events Received by Mobile App (from Backend)

#### `qr_token_used` — ⚠️ CRITICAL NOTE

**Emitted by:** `POST /api/qr/scan` ONLY (`qrController.js:138`)
**NOT emitted by:** `GET /api/qr/verify` (verified — verifyQR has no socket emission)

Payload:
```json
{ "token": "SYS-A1B2C3D4E5F6" }
```

**QR reset flow (the CORRECT version):**
```
1. scanQR called → token marked isUsed: true → qr_token_used emitted
2. ALL QR Generator TV clients receive event
3. ALL immediately fetch new token from /api/qr/generate
4. Fresh QR displayed
```

**⚠️ Do NOT call verifyQR expecting QR reset. It doesn't work that way.**

#### `queue_update` — Emitted by scanQR

Broadcast after every queue write. May fail due to missing composite index.

#### `dispatch_status_update` — Emitted by POST /api/dispatch/status

```json
{
  "type": "dispatch_status_update",
  "dispatchKey": "0010128044",
  "status": "in_transit",
  "driverId": "firebase-uid-xxxxx",
  "lat": 14.5995,
  "lng": 120.9842,
  "notes": "Cargo loaded",
  "updatedAt": "2026-05-26T10:30:00.000Z"
}
```

#### `update_admin_map` — For web dashboard map, not mobile

---

## 9. Backend Required Changes Checklist

| Priority | Item | Files | AS-BUILT Status |
|----------|------|-------|-----------------|
| **HIGH** | Implement `POST /api/trip/register` | New: `backend/controller/tripController.js`, `backend/routes/tripRoute.js` | ❌ Does not exist |
| **HIGH** | Add input sanitization to `qrController.js` | `backend/controller/qrController.js` | ❌ No sanitization exists |
| **HIGH** | Write `registrationComplete: false` in `scanQR` | `backend/controller/qrController.js` | ❌ Not written |
| **HIGH** | Add tripRoute to `server.js` | `backend/server.js` | ⚠️ Line missing: `app.use("/api/trip", require("./routes/tripRoute.js"))` |
| **MEDIUM** | Write `driverFN`, `driverMI`, `driverLN` in `scanQR` | `backend/controller/qrController.js` | ❌ Not written |
| **MEDIUM** | Write `helperFN`, `helperMI`, `helperLN` + `company` + `platePrefix`/`plateSuffix` (requires trip registration) | `backend/controller/tripController.js` | ❌ Will be new |
| **MEDIUM** | Change `status: "queued"` to `status: "waiting"` (if preferred) | `backend/controller/qrController.js:129` | ⚠️ Currently writes `"queued"` which IS what mobile queries for — both are right |

---

## 10. Android Required Changes Checklist

| Priority | Item | File | Status |
|----------|------|------|--------|
| **HIGH** | Populate `driverFN`, `driverMI`, `driverLN` in `ScanRequest` | `UpdateInfoActivity.kt:84-92` | ❌ Currently passing empty strings |
| **HIGH** | Pass correct `helperName` — currently `helperName` instead of split | `UpdateInfoActivity.kt:67` | ⚠️ Form uses single `helperName`, not FN/MI/LN split |
| **MEDIUM** | Open `TripRegistrationActivity` after scanQR | Flow navigation | ⚠️ Not wired yet |
| **MEDIUM** | Call `POST /api/trip/register` using `TripApiService` | `TripRegistrationActivity.kt` | ⚠️ Activity exists but not called |
| **LOW** | Sanitize form inputs before sending | All input fields | ✅ `Sanitizer.kt` utilities exist on Android |
| **LOW** | Handle `409 Already Registered` from trip register | `TripRegistrationActivity.kt` | ⚠️ Needs error handling for 409 |

---

## 11. Testing Checklist

### Phase 1 — QR Scan (CAN BE TESTED NOW)

- [ ] App calls `GET /api/qr/generate` → gets token ✅ (backend works)
- [ ] Driver scans QR
- [ ] App calls `GET /api/qr/verify` → 200 returned, QR NOT reset yet (⚠️ — verify doesn't emit)
- [ ] App calls `POST /api/qr/scan` → 200, queue ID returned ✅ (backend works)
- [ ] QR Generator TV receives `qr_token_used` and refreshes ✅ (backend emits)
- [ ] Driver appears on QR Generator TV ✅
- [ ] Mobile app calls `POST /api/qr/scan` with `driverName`, `truckType`, `plateNumber` ✅

### Phase 2 — Trip Registration (CANNOT BE TESTED — BACKEND NOT BUILT)

- [ ] `POST /api/trip/register` → **500 or 404** expected now (endpoint doesn't exist)
- [ ] After implementation: test all field validation, sanitization, conflict detection

### Status Alignment Verification

- [ ] Mobile queries for `status === "queued"` ✅ — verified in `MainActivity.kt`
- [ ] Backend writes `status === "queued"` ✅ — verified in `qrController.js:129`
- [ ] Alignment confirmed: mobile queries for what backend writes ✅

---

## Related Documentation

| File | Purpose |
|------|---------|
| `DISCREPANCY_LOG.md` | Complete discrepancy table between docs and code |
| `SYSU_MASTER_INTEGRATION_GUIDE.md` | Master integration guide — most accurate single doc |
| `SYSU_GO_BACKEND_REQUIREMENTS.md` | Outstanding backend items (needs updates for dispatch endpoint) |
| `SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md` | Web dashboard integration requirements |

---

*This is the AS-BUILT state of the system as of 2026-05-26. Items marked ⚠️ NOT BUILT are referenced in the flow description but have not yet been implemented in the codebase. This document was fully audited against the actual source code in `qrController.js`, `qrRoutes.js`, `dispatchRoutes.js`, `userRoutes.js`, `server.js`, `QRApiService.kt`, `TripApiService.kt`, `UpdateInfoActivity.kt`, and `MainActivity.kt`.*
