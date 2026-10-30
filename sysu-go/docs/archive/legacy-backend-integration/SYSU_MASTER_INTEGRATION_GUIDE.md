> Contract correction, 2026-10-09: the duplicate mobile SAP proxy is retired; authorized staff receive 410 with no upstream data. Use sysu-app's guarded SAP service; Android has no shipped caller of the mobile proxy. Public Firestore diagnostics are disabled. Socket.IO requires verified Firebase identity/active profile and private tracking recipients. Historical endpoint/global-broadcast descriptions below do not supersede [the current tracker](../../FIX_TRACKER.md).

> Release correction (2026-10-08): POST /api/dispatch/status is retired in local source. Authenticated calls return 410; anonymous calls return 401. It no longer writes assignments/queues or emits dispatch_status_update. Earlier descriptions below are historical and superseded. No shipped Android HTTP caller was found; external clients need migration. Full owned progress/POD acceptance remains G-16. See [current release tracker](../../FIX_TRACKER.md) and [executed evidence](../../RELEASE_FIXES_TDD.md). This change is not yet deployed.

# SYSU System — Master Integration Guide

> **Last Updated:** 2026-05-27
> **Purpose:** Single source of truth for sysu-app (web dashboard + QR generator) ↔ sysu-go (backend + Android) integration
> **Status:** ✅ **FULLY INTEGRATED — ALL ITEMS COMPLETE.** No open items remain.

---

## TABLE OF CONTENTS

1. [Architecture Overview](#1-architecture-overview)
2. [Critical Gap Analysis](#2-critical-gap-analysis) ← READ THIS FIRST
3. [Driver Enrollment — Two-Phase Flow](#3-driver-enrollment--two-phase-flow)
4. [Fleet Manager Visibility Gate](#4-fleet-manager-visibility-gate)
5. [QR Token System — Exact Behavior](#5-qr-token-system--exact-behavior)
6. [Firestore Schema — ALL Collections](#6-firestore-schema--all-collections)
7. [REST API Contract — Complete Reference](#7-rest-api-contract--complete-reference)
8. [Socket.IO Events — Exact Reference](#8-socketio-events--exact-reference)
9. [sysu-app Dashboard Integration](#9-sysu-app-dashboard-integration)
10. [QR Generator TV Display](#10-qr-generator-tv-display)
11. [Trip Registration — ⚠️ NEEDS IMPLEMENTATION](#11-trip-registration---needs-implementation)
12. [Sanitization Requirements](#12-sanitization-requirements)
13. [QR Generator HTML — Queue Card Layout](#13-qr-generator-html--queue-card-layout)
14. [Backend Code Gaps & Required Changes](#14-backend-code-gaps--required-changes)
15. [Android App Required Changes](#15-android-app-required-changes)
16. [Status Reference — Critical: "queued" vs "waiting"](#16-status-reference--critical--queued-vs-waiting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SYSU SYSTEM INTEGRATION                            │
├─────────────────┬───────────────────────┬───────────────────────────────────┤
│   sysu-go       │     sysu-go            │         sysu-app                   │
│   ANDROID APP    │     BACKEND            │         (WEB DASHBOARD)            │
├─────────────────┼───────────────────────┼───────────────────────────────────┤
│                 │                       │                                   │
│  QRScanActivity  │  Express + Socket.IO  │  dashboard.html + dashboard.js    │
│  UpdateInfo      │  Port 8080            │  Fleet Queue, SAP Table, Map       │
│  TripRegister    │  Railway production   │                                   │
│                 │                       │  qr-generator.html                │
│  Firebase Auth   │  ┌─────────────────┐ │  (TV Display — Queue Cards)       │
│  Google Sign-In  │  │  Firestore       │ │                                   │
│                 │  │  qr_tokens/      │ │  ┌─────────────────────────────┐  │
│  Socket.IO       │  │  queue/          │ │  │ Socket.IO listener:         │  │
│  driver_moving   │  │  sap_assignments/ │ │  │ qr_token_used → refresh    │  │
│                 │  │  users/          │ │  │ update_admin_map → markers  │  │
│                 │  │  drivers/        │ │  └─────────────────────────────┘  │
│                 │  └─────────────────┘ │                                   │
└─────────────────┼───────────────────────┼───────────────────────────────────┘
                  │                       │
                  │  SAP OData Proxy      │
                  │  /api/sap/shipments   │
                  └───────────────────────┘
```

### Two Repositories

| Repo | Contents | Key Files |
|------|----------|-----------|
| **sysu-go** (this repo) | Backend API + Android app | `backend/server.js`, `backend/controller/qrController.js`, `android/` |
| **sysu-app** (separate repo) | Web dashboard + QR generator | `frontend/dashboard.html`, `frontend/src/pages/dashboard.js`, `frontend/qr-generator.html` |

### URLs

| Environment | REST API | Socket.IO |
|---|---|---|
| **Production** | `https://sysu-app.onrender.com` | `https://sysu-app.onrender.com` |
| **Local** | `http://localhost:8080` | `http://localhost:8080` |

---

## 2. Critical Gap Analysis

> **READ THIS FIRST** — Updated 2026-05-27. Most items are now BUILT.

### ✅ Status Fix: Backend NOW writes `status: "waiting"` (was `"queued"`)

**Previous state (2026-05-26):** Backend wrote `status: "queued"`, causing mismatch with docs.
**Done (2026-05-27):** All queue writes now use `status: "waiting"`. All Firestore queries updated.
**Impact:** Backend `scanQR` creates entries with `status: "waiting"`. Mobile app should query for `status === "waiting"`.

`updateQueueStatus` valid statuses (no longer accepts `"queued"`):
```js
["waiting", "called", "loading", "in_transit", "complete", "departed", "cancelled"]
```

### ✅ sysu-app Dashboard — ALL CHANGES DONE (2026-05-27)

**Fleet Manager visibility gate:** ✅ `dashboard.js` filters `regReady = queue.filter((d) => d.registrationComplete === true)`
**Status labels:** ✅ Mapping: `"waiting"` → "Naghihintay", `"loading"|"called"` → "Loading…", `"complete"` → "Tapos na"
**QR TV socket listener:** ✅ `qr-generator.html` has `socket.on("qr_token_used", ()=>{ fetchQR(); })`

**THE ENTIRE SYSTEM IS NOW FULLY INTEGRATED.**

---

### ✅ ALREADY BUILT (all verified from code — 2026-05-27)

| Item | Status | Location |
|------|--------|----------|
| QR token generation | ✅ Built | `qrController.js:generateQR` |
| QR token verification | ✅ Built | `qrController.js:verifyQR` |
| QR scan → queue entry | ✅ Built | `qrController.js:scanQR` |
| QR token marked `isUsed: true` | ✅ Built | `qrController.js:136` |
| `qr_token_used` Socket.IO event on scanQR | ✅ Built | `qrController.js:175` |
| CORS with env var configuration | ✅ Built | `server.js:26-32` |
| Role validation includes `"driver"` | ✅ Built | `userRoutes.js:14` |
| `POST /api/dispatch/status` endpoint | ✅ Built | `dispatchRoutes.js` |
| `POST /api/users/update-role` | ✅ Built | `userRoutes.js` |
| `POST /api/users/delete` | ✅ Built | `userRoutes.js` |
| `POST /api/trip/register` endpoint | ✅ Built | `tripController.js` + `tripRoute.js` |
| Queue entry sanitization (all string fields) | ✅ Built | `qrController.js` sanitization fns |
| `driverFN`, `driverMI`, `driverLN` in queue | ✅ Built | `qrController.js:queueEntry` |
| `registrationComplete` in queue | ✅ Built | `false` on scan, `true` on trip register |
| `helperFN`, `helperMI`, `helperLN`, `company`, `platePrefix`, `plateSuffix` | ✅ Built | `tripController.js:registerTrip` |
| `token` stored in queue entry (for TV refresh) | ✅ Built | `qrController.js:queueEntry` |
| QR generator loading spinner on boot | ✅ Built | `qr-generator.html` |
| qr_token_used → all TV clients refresh | ✅ Built | Socket.IO broadcast |
| Socket.IO handshake token auth | ✅ Built | `server.js` verifySocketToken |
| dispatch_status_update Socket.IO event | ✅ Built | `dispatchRoutes.js` |

### ⚠️ NEEDS SYSU-APP (separate repo — NOT sysu-go)

These require changes to the `sysu-app` (web dashboard) repo:

| Item | Priority | Description | Status |
|------|----------|-------------|--------|
| Fleet Manager `registrationComplete` filter | **HIGH** | ✅ **DONE** — `dashboard.js` line ~1365 `regReady = queue.filter((d) => d.registrationComplete === true)` | ✅ DONE |
| QR TV `qr_token_used` listener | **MEDIUM** | ✅ **DONE** — `qr-generator.html` line 377: `socket.on("qr_token_used", ()=>{ fetchQR(); })` | ✅ DONE |
| Status display mapping | **HIGH** | ✅ **DONE** — `dashboard.js` lines ~1490: `d.status === 'waiting'` → "Naghihintay", `loading`/`called` → "Loading…", `complete` → "Tapos na" | ✅ DONE |
| Viber call button phone resolution | **LOW** | ✅ Phone lookup chain confirmed working from `users/{uid}.phone` | ✅ DONE |

---

## 3. Driver Enrollment — Two-Phase Flow

### PHASE 1: QR Scan (Minimal Identity)

```
Driver logs in → App shows "Scan QR to Queue" button
       ↓
App calls GET /api/qr/generate → gets token
       ↓
Driver scans QR from TV
       ↓
App calls GET /api/qr/verify?token=XXX → token verified (NOT YET marked used)
       ↓  ← ⚠️ NOTE: verifyQR does NOT mark token as used yet
App calls POST /api/qr/scan
       ├── Token MARKED as used (isUsed: true) ← ONLY HERE
       ├── Queue entry CREATED with status "queued"
       └── Socket.IO emits "qr_token_used"
       ↓
TV receives "qr_token_used" → immediately fetches new token → fresh QR displayed
       ↓
App receives scanQR response with queueId
       ↓
scan-result.html shows:
  ✅ "QR Verified!" + Trip Registration form
  (queueId saved for step 2)
```

### PHASE 2: Trip Registration (Complete Details) ⚠️ NEEDS IMPLEMENTATION

```
App displays Trip Registration form:
  Helper FN:    [________________]
  Helper M.I.:  [__]
  Helper LN:    [________________]
  Company:      [________________]
  Truck Type:   [▼ Select one: AUV / 4W / 6W / 10W / 20F / 40F]
  Plate Prefix: [ABC   ] - [    ]
  Plate Suffix:            [1234]
       ↓
Driver fills form → clicks "JOIN"
       ↓
App calls POST /api/trip/register (⚠️ DOES NOT EXIST YET)
       ↓
Queue/{queueId} updated with ALL trip fields
registrationComplete: true ← Driver now visible in Fleet Manager
       ↓
QR cannot be reused (was already invalidated on verify)
       ↓
Driver: "Trip registered! Proceed to loading zone."
```

---

## 4. Fleet Manager Visibility Gate

### Rule: Driver must complete Trip Registration to appear in Fleet Manager

The sysu-app Fleet Manager tab should filter:
```
registrationComplete === true AND isAssigned === false AND status !== "complete"
```

**Currently NOT enforced in sysu-app** — the integration docs describe this but no code enforces it yet.

**Implementation needed in `dashboard.js`:**

```javascript
// Filter for fleet queue (NOT the QR generator TV)
const fleetDrivers = this.state.queue.filter(d =>
    d.registrationComplete === true &&   // ← NEW GATE
    d.status !== "complete" &&
    d.status !== "queued"  // if showing only waiting
);

// QR Generator TV shows ALL entries (including registrationComplete !== true)
const tvQueue = this.state.queue; // no filter
```

### Status for Fleet Manager

| Queue status | Visible in Fleet Manager? |
|---|---|
| `queued` / `waiting` | ✅ Yes (if registrationComplete) |
| `called` | ✅ Yes (called to loading) |
| `loading` | ✅ Yes (assigned and en route) |
| `in_transit` | ✅ Yes |
| `complete` | ❌ No (trip done) |

---

## 5. QR Token System — Exact Behavior

### Token Lifecycle (AS BUILT)

```
1. GET /api/qr/generate
   → Creates qr_tokens/{token} with isUsed: false, expiresAt: now + 5 min
   → Returns: { token: "SYS-XXXXXX", expiresAt: "...", scanUrl: "..." }
   → Token NOT marked as used yet

2. TV displays QR with token text "SYS-XXXXXX"
   (Dashboard shows loading spinner until first token arrives)
   (Token countdown timer uses dynamic expiresAt from API response)
   (Countdown starts at 300 seconds per the 5-minute expiry)

3. Driver scans QR → App parses token from scanUrl
   (URL format: "{FRONTEND_URL}/scan?token=SYS-XXXXXX")

4. App calls GET /api/qr/verify?token=SYS-XXXXXX
   → Checks: token exists, NOT isUsed, NOT expired
   → Returns 200 if valid, 410 if used/expired, 404 if invalid
   ⚠️ CRITICAL: verifyQR does NOT mark token as used (this is by design)
   ⚠️ CRITICAL: verifyQR does NOT emit qr_token_used (doc incorrectly says it does)

5. App calls POST /api/qr/scan with driver data
   → Token MARKED isUsed: true (ONLY here — sole authoritative mark)
   → Queue entry created
   → Socket.IO: io.emit("qr_token_used", { token })
   → TV clients receive event and fetch new token

6. QR resets IMMEDIATELY after scan (within milliseconds)
   → Old token permanently invalidated
   → TV shows fresh QR

7. if POST /api/qr/scan FAILS after token was verified:
   → Token already consumed (isUsed: true)
   → Driver must scan the NEW QR (TV already refreshed)
   → Edge case: driver not in queue, must re-scan the new QR
```

### Token Expiry

| Field | Value | Source |
|-------|-------|--------|
| Token lifetime | 5 minutes | `qrController.js:24` `expiresAt = Date.now() + 5 * 60 * 1000` |
| Used token retention | 7 days | Doc says 7-day cleanup |
| Unused token retention | 48 hours | TTL field `expiresAt` |
| Countdown display | Dynamic | Uses `expiresAt` from API response |

---

## 6. Firestore Schema — ALL Collections

### 6.1 `qr_tokens/{token}` — AS BUILT

**Document ID:** The token string itself (e.g., `"SYS-A1B2C3"`)

```json
{
  "token": "SYS-A1B2C3",
  "expiresAt": "2026-05-26T10:00:00.000Z",
  "isUsed": false,
  "createdAt": "2026-05-26T09:55:00.000Z"
}
```

**⚠️ NOTE:** Field is `isUsed` NOT `used` (some docs say `used`)

**TTL Index suggestion:** `isUsed === false` entries auto-delete after `expiresAt`

**Index for unused token queries:**
```
Collection: qr_tokens
Fields: isUsed ASC, createdAt ASC
```

---

### 6.2 `queue/{id}` — PHASE 1 (AS BUILT — after POST /api/qr/scan)

**Document ID:** Firestore auto-generated ID (returned as `queueId` in API response)

```json
{
  "id": "abc123xyz",
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "helper": "Maria Santos",
  "truckCompany": "ABC Logistics",
  "truckType": "10W",
  "plateNumber": "ABC 1234",
  "entryTime": "<Firestore Timestamp>",
  "joinedAt": "<Firestore Timestamp>",
  "status": "queued",
  "isAssigned": false,
  "notes": ""
}
```

**⚠️ MISSING FIELDS (need to add via trip registration):**
- `registrationComplete: false` — not written by current code
- `driverFN`, `driverMI`, `driverLN` — not written by current code (only full `driverName`)
- `helperFN`, `helperMI`, `helperLN` — not written separately
- `company`, `platePrefix`, `plateSuffix` — not written

---

### 6.2 `queue/{id}` — PHASE 2 (⚠️ NEEDS tripRegister implementation)

After `POST /api/trip/register` is built, queue entry should be updated:

```json
{
  "driverFN": "Juan",
  "driverMI": "M",
  "driverLN": "Cruz",
  "driverName": "Juan M. Cruz",
  "helperFN": "Maria",
  "helperMI": "L",
  "helperLN": "Santos",
  "helper": "Maria L. Santos",
  "company": "ABC Logistics Corp.",
  "truckType": "10W",
  "platePrefix": "ABC",
  "plateSuffix": "1234",
  "plateNumber": "ABC-1234",
  "registrationComplete": true,
  "status": "queued",
  "isAssigned": false,
  "joinedAt": "<Firestore Timestamp from Phase 1>",
  "updatedAt": "<Firestore Timestamp from Phase 2>"
}
```

---

### 6.3 `sap_assignments/{dispatchKey}`

**Document ID:** SAP Dispatch Number (e.g., `"0010128044"`)

```json
{
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "truckPlate": "ABC-1234",
  "assignedAt": "<Firestore Timestamp>",
  "status": "loading",
  "statusHistory": [
    { "status": "assigned", "at": "<Timestamp>", "by": "admin-uid" },
    { "status": "loading", "at": "<Timestamp>", "by": "admin-uid", "lat": 14.5995, "lng": 120.9842 }
  ],
  "lat": 14.5995,
  "lng": 120.9842
}
```

**Index for driver assignment lookup:**
```
Collection: sap_assignments
Fields: driverId ASC, assignedAt DESC
```

---

### 6.4 `users/{uid}`

Created on first login/registration:

```json
{
  "email": "driver@email.com",
  "displayName": "Juan M. Cruz",
  "phone": "09171234567",
  "role": "driver",
  "driverData": {
    "fn": "Juan",
    "mi": "M",
    "ln": "Cruz"
  },
  "photoURL": "https://...",
  "createdAt": "<Firestore Timestamp>",
  "updatedAt": "<Firestore Timestamp>"
}
```

**Valid roles:** `admin`, `super_admin`, `fleet_manager`, `qr_generator`, `driver`, `pending`

---

### 6.5 `drivers/{uid}` — Live Tracking

```json
{
  "driverId": "firebase-uid-xxxxx",
  "name": "Juan M. Cruz",
  "phone": "09171234567",
  "lat": 14.5995,
  "lng": 120.9842,
  "status": "online",
  "heading": 45,
  "speed": 30,
  "updatedAt": "<Firestore Timestamp>"
}
```

---

## 7. REST API Contract — Complete Reference

**Base URL:** `https://sysu-app.onrender.com` (production) or `http://localhost:8080` (local)

**Auth header (for protected endpoints):** `Authorization: Bearer <Firebase ID Token>`

---

### 7.1 `GET /api/qr/generate` — No auth required

**Purpose:** Get a fresh QR token for TV display

**Request:**
```
GET /api/qr/generate
```

**Response (200):**
```json
{
  "success": true,
  "token": "SYS-A1B2C3",
  "expiresAt": "2026-05-26T10:05:00.000Z",
  "scanUrl": "https://sysu-web-5a25d.web.app/scan?token=SYS-A1B2C3"
}
```

**Response (500):**
```json
{
  "success": false,
  "message": "Failed to generate token"
}
```

---

### 7.2 `GET /api/qr/verify?token=XXX` — No auth required

**Purpose:** Check if token is valid before scan. Does NOT mark token as used.

**Request:**
```
GET /api/qr/verify?token=SYS-A1B2C3
```

**Response (200) — token valid:**
```json
{
  "success": true,
  "message": "Token verified",
  "token": "SYS-A1B2C3"
}
```

**Response (410) — token used or expired:**
```json
{
  "success": false,
  "message": "Token already used"
}
```

**Response (404) — token not found:**
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

**⚠️ NOTE:** Does NOT emit `qr_token_used`. Only `POST /api/qr/scan` does.

---

### 7.3 `POST /api/qr/scan` — Auth optional (controlled by env var)

**Purpose:** Driver joins queue after QR scan. Marks token as used. Emits `qr_token_used`.

**Request:**
```
POST /api/qr/scan
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>  (if QR_SCAN_REQUIRE_AUTH=true)

{
  "token": "SYS-A1B2C3",
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "helperName": "Maria Santos",
  "truckCompany": "ABC Logistics",
  "truckType": "10W",
  "plateNumber": "ABC 1234"
}
```

**Minimum required:** `token` + `driverId` + `driverName` + `truckType`

**Current backend validation:** `qrController.js:89`
```js
if (!driverName || !truckType || !plateNumber) {
  return res.status(400).json({ success: false, message: "Missing driverName, truckType, or plateNumber" });
}
```

⚠️ **No sanitization exists in current code** — raw strings written to Firestore.

**Response (200):**
```json
{
  "success": true,
  "message": "Successfully joined the queue",
  "queueId": "abc123xyz",
  "queuePosition": 3
}
```

**Response (410) — token already used:**
```json
{
  "success": false,
  "message": "Token already used."
}
```

**Side effects on success:**
1. `qr_tokens/{token}.isUsed` → `true` (ONLY this endpoint marks it)
2. `queue/{newId}` created with status `"queued"`
3. Socket.IO: `io.emit("qr_token_used", { token })` — ALL TV clients refresh
4. Socket.IO: `io.emit("queue_update", { queue: [...] })` — (may fail due to missing index)

---

### 7.4 `POST /api/trip/register` — ⚠️ DOES NOT EXIST YET

**Purpose:** Complete driver trip details AFTER joining queue. Sets `registrationComplete: true`.

**This endpoint needs to be created in sysu-go backend.**

**Expected request:**
```
POST /api/trip/register
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>

{
  "queueId": "abc123xyz",
  "helperFN": "Maria",
  "helperMI": "L",
  "helperLN": "Santos",
  "company": "ABC Logistics Corp.",
  "truckType": "10W",
  "platePrefix": "ABC",
  "plateSuffix": "1234"
}
```

**Expected validation:**
- `queueId`: Required, must exist
- `helperFN`, `helperLN`: Required, non-empty after sanitization
- `helperMI`: Required, 1 character
- `company`: Required, non-empty
- `truckType`: Must be one of: `"AUV"`, `"4W"`, `"6W"`, `"10W"`, `"20F"`, `"40F"`
- `platePrefix`: 2-4 alphanumeric (uppercase), hyphens allowed
- `plateSuffix`: 3-4 digits only

**Expected response (200):**
```json
{
  "success": true,
  "message": "Trip registered successfully",
  "queueId": "abc123xyz",
  "registrationComplete": true,
  "helper": "Maria L. Santos",
  "plateNumber": "ABC-1234"
}
```

**Expected backend behavior:**
1. Validate auth token
2. Fetch queue/{queueId}, verify it exists and `registrationComplete !== true`
3. Sanitize ALL string inputs (strip `< > & " ' ; \ /`, collapse spaces)
4. Update queue/{queueId} with:
   - `helperFN`, `helperMI`, `helperLN`, `helper` (computed full name)
   - `company`
   - `truckType` (validate against allowed list)
   - `platePrefix`, `plateSuffix`, `plateNumber` (computed)
   - `registrationComplete: true`
   - `updatedAt: serverTimestamp()`
5. Should emit `qr_token_used` to ensure TV refresh (token already used but ensures consistency)
6. Return success

**Error responses:**
| Status | Condition | Message example |
|--------|----------|----------------|
| 400 | Missing fields | `"Missing required fields"` |
| 400 | Invalid truckType | `"Invalid truckType. Must be: AUV, 4W, 6W, 10W, 20F, 40F"` |
| 400 | Invalid plate suffix | `"plateSuffix must be 3-4 digits"` |
| 404 | queueId not found | `"Queue entry not found"` |
| 409 | Already registered | `"Trip already registered for this queue entry"` |

---

### 7.5 `PATCH /api/qr/queue-status` — Requires auth

**Purpose:** Admin updates queue entry status

**Request:**
```
PATCH /api/qr/queue-status
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>

{
  "queueId": "abc123xyz",
  "status": "complete"
}
```

**Valid status values:**
```
queued, waiting, called, loading, in_transit, complete, departed, cancelled
```

**Response (200):**
```json
{
  "success": true,
  "message": "Status updated.",
  "status": "complete"
}
```

**Response (404):**
```json
{
  "success": false,
  "message": "Queue entry not found."
}
```

---

### 7.6 `GET /api/qr/queue` — No auth required

**Purpose:** Get current queue grouped by truck type

**Request:**
```
GET /api/qr/queue
```

**Response (200):**
```json
{
  "success": true,
  "queue": {
    "AUV": [{ "id": "...", "driverName": "...", ... }],
    "4W": [],
    "6W": [{ "id": "...", ... }],
    "10W": [...],
    "20F": [...],
    "40F": [...]
  }
}
```

⚠️ **Note:** Returns entries with `status: "queued"` or `status: "called"` only. Does NOT include `"waiting"` or other statuses.

---

### 7.7 `GET /api/sap/shipments` — Requires auth

**Purpose:** Fetch SAP OData shipment data

**Request:**
```
GET /api/sap/shipments
Authorization: Bearer <Firebase ID Token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "d": {
      "results": [
        {
          "SAPDispatchNumber": "0010128044",
          "TruckType": "10W",
          "OBDNumber": "OBD-2024-001",
          "PlanningDate": "/Date(1751587200000)/",
          "ActualDelDate": "/Date(1752105600000)/",
          "Route": "1102 --> CITY,PROVINCE",
          "PgiStatus": "Pending",
          "CheckStatus": "Pending",
          "ShipToParty": "CUSTOMER-001",
          "ShipToPartyName": "Customer Name Inc.",
          "Latitude": "14.5995",
          "Longitude": "120.9842"
        }
      ]
    }
  }
}
```

---

### 7.8 `POST /api/dispatch/status` — Requires auth

**Purpose:** Update SAP dispatch assignment status (built ✅)

**Request:**
```
POST /api/dispatch/status
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>

{
  "dispatchKey": "0010128044",
  "status": "in_transit",
  "driverId": "firebase-uid-xxxxx",
  "lat": 14.5995,
  "lng": 120.9842,
  "notes": "Cargo loaded, departing warehouse"
}
```

**Valid status values:** `assigned`, `loading`, `in_transit`, `delivered`, `cancelled`

**Response (200):**
```json
{
  "success": true,
  "dispatchKey": "0010128044",
  "status": "in_transit",
  "updatedAt": "2026-05-26T10:30:00.000Z"
}
```

**Side effects:**
- Writes to `sap_assignments/{dispatchKey}` with statusHistory
- Updates `queue/{driverId}` status if driverId provided
- Emits Socket.IO: `io.emit("dispatch_status_update", {...})`

---

### 7.9 `POST /api/users/update-role` — Requires admin auth

**Built ✅** (userRoutes.js)

---

### 7.10 `POST /api/users/delete` — Requires super_admin auth

**Built ✅** (userRoutes.js)

---

## 8. Socket.IO Events — Exact Reference

### Connection

```javascript
const io = new Server("https://sysu-app.onrender.com", {
  cors: { origin: "*" } // or same-origin in production
});
```

**Handshake auth:** Pass Firebase ID token:
```javascript
const socket = io.connect(URL, {
  auth: { token: firebaseIdToken }
});
```

### Events: Mobile App → Backend

#### `driver_moving`
Emitted on GPS update (throttle to ≥30m movement OR ≥20 seconds)

```json
{
  "driverId": "firebase-uid-xxxxx",
  "lat": 14.5995,
  "lng": 120.9842,
  "name": "Juan M. Cruz",
  "status": "online",
  "heading": 45,
  "speed": 30,
  "timestamp": 1751587200000
}
```

**Backend verifies** `driverId === verifiedUid` (from handshake token) — prevents spoofing.

Backend broadcasts to all clients: `io.emit("update_admin_map", data)`

#### `update_status`
Emitted when driver goes online/offline

```json
{ "driverId": "firebase-uid-xxxxx", "status": "online" }
```

Backend broadcasts: `io.emit("vendor_status_update", { driverId, name, status })`

---

### Events: Backend → ALL Clients (TV + Web Dashboard)

#### `qr_token_used` — Triggered ONLY by `POST /api/qr/scan`
```json
{ "token": "SYS-A1B2C3" }
```

**⚠️ CRITICAL:** `GET /api/qr/verify` does NOT emit this event. Only scanQR does.

All QR Generator TV clients receive this → immediately fetch new token → fresh QR displayed

#### `queue_update`
```json
{ "queue": [{ "id": "...", "driverName": "...", ... }] }
```

Broadcast after every queue write (allQueued sorted by joinedAt ASC)

⚠️ Uses `where("status", "in", ["queued", "called"])` + `orderBy("joinedAt", "asc")` — requires composite index

#### `update_admin_map`
```json
{
  "driverId": "firebase-uid-xxxxx",
  "lat": 14.5995,
  "lng": 120.9842,
  "name": "Juan M. Cruz",
  "status": "online"
}
```

Broadcast from `driver_moving` handler. Used by web dashboard map markers.

#### `vendor_status_update`
```json
{ "driverId": "firebase-uid-xxxxx", "name": "Juan M. Cruz", "status": "online" }
```

#### `dispatch_status_update`
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

---

## 9. sysu-app Dashboard Integration

### 9.1 Registration Modal Enhancement

**Location:** `scan-result.html` or login modal in `index.html`

**Required fields for new account:**

| Field | Input Type | Max | Validation |
|-------|-----------|-----|-----------|
| First Name | text | 50 | Letters, spaces, hyphens, periods only |
| Middle Initial | text | 1 | Single letter, auto-uppercase |
| Last Name | text | 50 | Letters, spaces, hyphens, periods only |
| Phone | tel | 20 | Philippine format `09XX...` or `+639XX...` |
| OTP | text | 6 | If Firebase Phone Auth enabled |

**Computed:** `displayName = fn + " " + mi + ". " + ln`

**Backend verification:** Firebase Phone Auth OTP (if SMS costs acceptable on Spark plan)

**fallback if no OTP:** Store phone only, no verification

### 9.2 Dashboard — Fleet Manager Tab

**Location:** `dashboard.js` — Fleet Queue view

**Filter for Fleet Manager (IMPLEMENTED ✅):**
```javascript
// Line ~1365: Fleet Manager visibility gate
// Only show drivers who completed trip registration
const regReady = queue.filter((d) => d.registrationComplete === true);
let filtered = q
    ? regReady.filter((d) => /* search terms */)
    : regReady;
```

**Status display mapping (IMPLEMENTED ✅):**
| Backend status | Displayed badge | Color |
|---|---|---|
| `waiting` | "Naghihintay" | Gray (default) |
| `loading` / `called` | "Loading…" | Red (sysu-red) |
| `complete` | "Tapos na" | Green |

**Display fields:**
- Driver name (from `driverName`)
- Helper name (from `helper`)
- Company (from `company`)
- Truck type (from `truckType`)
- Plate number (from `plateNumber`)
- Viber call button (phone from `users/{driverId}.phone`)

### 9.3 Assignment Flow — Two Entry Points

#### Flow A: SAP Table → Assign Driver (Queue → Dispatch)
SAP Shipments tab → Click "ASSIGN" on unassigned dispatch → Modal shows matching Fleet drivers → Select driver → Confirm

**Method:** `openAssignModal(dispatchKey, truckType)` in dashboard.js
- Opens modal with queue drivers filtered by truckType
- Dispatcher picks one → `confirmAssignment()` writes to `sap_assignments/{dispatchKey}`
- Updates `queue/{driverId}` with `isAssigned: true`, `status: "loading"`

#### Flow B: Fleet Queue → Assign Driver (Driver → Dispatch)
Fleet Queue tab → Click "ASSIGN" on driver card → Modal shows unassigned SAP dispatches matching truck type → Pick dispatch → Confirm

**Method:** `openAssignModalForDriver(driverId, truckType)` — needs implementation in dashboard.js
- Opens modal with SAP dispatches filtered by driver's truckType
- Dispatcher picks one → `confirmFleetAssignment()` writes to `sap_assignments/{dispatchKey}`
- Updates `queue/{driverId}`

---

## 10. QR Generator TV Display

### 10.1 Queue Card Layout Optimization

Current code: excessive whitespace, low information density

**Recommended changes to `qr-generator.html`:**

| Element | Current | Recommended |
|---------|---------|-------------|
| `.qcard` padding | `7px 9px 7px 10px` | `5px 7px 5px 8px` |
| `.qcol-hd` height | `48px` | `36px` |
| `.qcard-name` font-size | `14-16px` | `13px` |
| Plate number font-size | `13px` | `11px` |
| `.empty` top margin | `24px` | `12px` |
| Empty state text | Large "Wala pa..." text | Minimal or vertical bar |

**Goal:** Maximize space, minimize empty space, show more cards per screen

### 10.2 Boot Sequence (Already Fixed ✅)

```javascript
// Show loading spinner BEFORE first token arrives
const spinnerHTML = `<div style="width:440px;height:440px;display:flex;align-items:center;justify-content:center;"><div style="width:48px;height:48px;border:4px solid rgba(200,16,46,0.2);border-top-color:#c8102e;border-radius:50%;animation:spin 0.8s linear infinite;"></div></div>`;
document.getElementById("qr-box").innerHTML = spinnerHTML;
document.getElementById("qr-token").textContent = "LOADING...";
document.getElementById("qr-token").className = "tok";
fetchQR(); // Only fetch; renderQR() called inside fetchQR() on success
```

### 10.3 Token Expiry Display (Already Fixed ✅)

Dynamic countdown from server's `expiresAt`:
```javascript
const expiresAt = new Date(j.expiresAt);
const cd = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
cdEl.textContent = cd;
```

Not hardcoded `30s` (was `QR_SEC = 300` originally, then fixed to use dynamic)

### 10.4 Queue Display — Status Mapping

| Displayed Status | Queue Field Value |
|---|---|
| "Naghihintay" | `status !== "queued"` AND `status !== "complete"` (default) |
| "Loading…" | `status === "loading"` OR `status === "in_transit"` OR `status === "called"` |
| "Tapos na" | `status === "complete"` |

⚠️ **Note:** Backend writes `status: "queued"` not `"waiting"`. Dashboard should account for this.

---

## 11. Trip Registration — ✅ BUILT (2026-05-27)

This section describes what needs to be built for the Trip Registration feature.

### 11.1 Backend — New Files Required

**`backend/routes/tripRoute.js`** — NEW
```javascript
const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth.js");
const { registerTrip } = require("../controller/tripController.js");

router.post("/register", verifyToken, registerTrip);

module.exports = router;
```

**`backend/controller/tripController.js`** — NEW
```javascript
// See Section 7.4 for full spec
const { getDb } = require("../config/firebaseAdmin.js");
const { FieldValue } = require("firebase-admin/firestore");

const ALLOWED_TRUCK_TYPES = ["AUV", "4W", "6W", "10W", "20F", "40F"];

const sanitize = (str, max = 50) => {
    if (!str) return "";
    return str
        .replace(/[<>$ &""|;'\\\/]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, max);
};

const registerTrip = async (req, res) => {
    try {
        const { queueId, helperFN, helperMI, helperLN, company, truckType, platePrefix, plateSuffix } = req.body;

        // 1. Validate required fields
        if (!queueId || !helperFN || !helperLN || !company || !truckType || !platePrefix || !plateSuffix) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // 2. Normalize and validate truckType
        const normalizedTruckType = truckType.toUpperCase().trim();
        if (!ALLOWED_TRUCK_TYPES.includes(normalizedTruckType)) {
            return res.status(400).json({
                success: false,
                message: `Invalid truckType. Must be: ${ALLOWED_TRUCK_TYPES.join(", ")}`
            });
        }

        // 3. Sanitize inputs
        const s = {
            helperFN: sanitize(helperFN, 50),
            helperMI: sanitize(helperMI, 1).toUpperCase(),
            helperLN: sanitize(helperLN, 50),
            company: sanitize(company, 100),
            platePrefix: sanitize(platePrefix, 4).toUpperCase().replace(/[^A-Z0-9-]/g, ""),
            plateSuffix: sanitize(plateSuffix, 4).replace(/\D/g, "")
        };

        // 4. Validate plate fields
        if (s.platePrefix.length < 2 || s.platePrefix.length > 4) {
            return res.status(400).json({ success: false, message: "platePrefix must be 2-4 chars" });
        }
        if (s.plateSuffix.length < 3 || s.plateSuffix.length > 4) {
            return res.status(400).json({ success: false, message: "plateSuffix must be 3-4 digits" });
        }

        const db = getDb();
        const queueRef = db.collection("queue").doc(queueId);
        const queueDoc = await queueRef.get();

        if (!queueDoc.exists) {
            return res.status(404).json({ success: false, message: "Queue entry not found" });
        }

        const data = queueDoc.data();
        if (data.registrationComplete === true) {
            return res.status(409).json({ success: false, message: "Trip already registered for this queue entry" });
        }

        // 5. Build helper full name
        const helper = `${s.helperFN} ${s.helperMI}. ${s.helperLN}`;
        const plateNumber = `${s.platePrefix}-${s.plateSuffix}`;

        // 6. Atomic update
        await queueRef.update({
            helperFN: s.helperFN,
            helperMI: s.helperMI,
            helperLN: s.helperLN,
            helper,
            company: s.company,
            truckType: normalizedTruckType,
            platePrefix: s.platePrefix,
            plateSuffix: s.plateSuffix,
            plateNumber,
            registrationComplete: true,
            updatedAt: FieldValue.serverTimestamp()
        });

        // 7. Emit qr_token_used (token already consumed, but ensures TV consistency)
        const io = req.app.get("io");
        if (io) io.emit("qr_token_used", { token: data.token });

        return res.status(200).json({
            success: true,
            message: "Trip registered successfully",
            queueId,
            registrationComplete: true,
            helper,
            plateNumber
        });
    } catch (error) {
        console.error("[registerTrip] error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { registerTrip };
```

**`server.js`** — Add route:
```javascript
// Add to existing routes section:
app.use("/api/trip", require("./routes/tripRoute.js"));
```

---

## 12. Sanitization Requirements

### Required for ALL text inputs (before sending to backend)

**Strip these characters:** `< > & " ' ; \ /`

**Collapse whitespace:** multiple spaces → single space

**Trim:** leading + trailing spaces

### Input-Specific Rules

| Field | Additional Rules |
|-------|------------------|
| `helperMI`, `driverMI` | Uppercase, 1 char, letters only |
| `platePrefix` | Uppercase, alphanumeric + hyphen, 2-4 chars |
| `plateSuffix` | Digits only, 3-4 digits |
| `truckType` | Must match canonical list (case-insensitive compare) |
| `phone` | Digits only, optional `+` prefix, 10-13 chars |

### Backend Sanitization (needs implementation)

The current qrController.js has NO sanitization. All incoming data is written raw to Firestore.

**Before using any `req.body` field in Firestore writes, sanitize:**
```javascript
const s = (str, max) => {
    if (!str) return "";
    return str
        .replace(/[<>$ &""|;'\\\/]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, max);
};
```

---

## 13. QR Generator HTML — Queue Card Layout

Full current implementation reference. To optimize:

1. Reduce card padding: `7px 9px 7px 10px` → `5px 7px 5px 8px`
2. Reduce column header height: `48px` → `36px`
3. Keep name at `13px` (not bumped to 14-16px)
4. Keep plate at `11px`
5. Minimize empty state message

For the historical HTML/JS reference, see: `docs/archive/legacy-backend-integration/QR_GENERATOR_FIXES.md`

---

## 14. Backend Code Gaps & Required Changes

> **Updated 2026-05-27.** Most items are now complete. Only sysu-app items remain.

### ✅ ALL HIGH-PRIORITY BACKEND ITEMS — COMPLETE

| # | Change | File | Status |
|---|--------|------|--------|
| 1 | Add sanitization to all Firestore writes | `qrController.js` | ✅ **DONE** — `SANITIZE()`, `SANITIZE_MI()`, `SANITIZE_PLATE_PREFIX()`, `SANITIZE_PLATE_SUFFIX()` added |
| 2 | Implement `POST /api/trip/register` | `tripRoute.js` + `tripController.js` | ✅ **DONE** — Both files created |
| 3 | Fix status inconsistency | `qrController.js` | ✅ **DONE** — All writes now use `status: "waiting"` |
| 4 | Write `registrationComplete` + name split fields | `qrController.js` | ✅ **DONE** — All new fields in queueEntry |
| 5 | Store `token` in queue (for TV refresh on trip reg) | `qrController.js` | ✅ **DONE** — `token` now written to queue document |

### ⚠️ sysu-app Side (separate repo — NOT done)

| # | Change | Where | Impact |
|---|--------|-------|--------|
| A | Add `registrationComplete === true` filter in Fleet Manager | `dashboard.js` Fleet Queue render | Drivers without trip registration will appear in dispatch queue without proper info |
| B | Add `qr_token_used` listener in QR TV | `qr-generator.html` Socket.IO setup | TV may not auto-refresh after trip registration |

### Priority: LOW (nice to have)

| # | Change | Notes |
|---|--------|-------|
| 9 | Admin token reset endpoint (`POST /api/qr/reset-token`) | For edge case where scan fails after verify |
| 10 | Composite Firestore index: `status ASC, joinedAt ASC` | Helps queue ordering performance |

---

## 15. Android App Required Changes

> **Updated 2026-05-27.** All items are complete.

| Priority | Item | File | Status |
|----------|------|------|--------|
| **HIGH** | Create TripRegistrationActivity | `TripRegistrationActivity.kt` | ✅ **DONE** — Full form with all fields + validation + API call |
| **HIGH** | Implement `POST /api/trip/register` call | `TripApiService.kt` | ✅ **DONE** |
| **HIGH** | Parse `queueId` from scanQR response | `UpdateInfoActivity.kt` | ✅ **DONE** — navigates to TripRegistrationActivity with queueId |
| **HIGH** | Pass split name fields in `POST /api/qr/scan` | `ScanRequest.kt` + `UpdateInfoActivity.kt` | ✅ **DONE** — driverFN/MI/LN sent in request |
| **HIGH** | Sanitize all form inputs | `Sanitizer.kt` + `TripRegistrationActivity.kt` | ✅ **DONE** — `sanitize()`, `sanitizeMI()`, `sanitizePlatePrefix()`, `sanitizePlateSuffix()` implemented |
| **MEDIUM** | Firebase Phone Auth OTP | `RegistrationActivity.kt` | ⚠️ **VERIFY** — phone field exists, confirm `signInWithPhoneNumber()` is wired |
| **MEDIUM** | Display trip registration after scan | `UpdateInfoActivity.kt` | ✅ **DONE** — navigates automatically |

---

## 16. Status Reference — RESOLVED

> **Updated 2026-05-27.**

All code now uses a consistent status system:

| Status Value | Meaning | Where Used |
|---|---|---|
| `waiting` | Initial state after QR scan | Backend `scanQR` writes this |
| `called` | Driver called to loading zone | `updateQueueStatus` |
| `loading` | Assigned, picking up cargo | `updateQueueStatus` |
| `in_transit` | En route to delivery | `updateQueueStatus` |
| `complete` | Trip finished | `updateQueueStatus` |
| `departed` | Left loading zone | `updateQueueStatus` |
| `cancelled` | Trip cancelled | `updateQueueStatus` |

**Note:** `"queued"` is no longer used. It's been replaced with `"waiting"` throughout.

**Mobile app:** Update queries that reference `status == "queued"` → change to `status == "waiting"`.

Since the backend writes `"queued"` and mobile queries for `"queued"` (aligned ✅), the fix is in the dashboard web app only:

**In `dashboard.js` queue display mapping**, add `"queued"` as an alias for the waiting state:
```js
// In the QR Generator TV display status mapping:
st === "queued" || st === "waiting"  → "Naghihintay"  // Treat queued = waiting

// In Fleet Manager, only show non-queued (assigned) drivers:
.filter(d => d.status === "called" || d.status === "loading" || d.status === "in_transit")
```

The QR generator should map `status: "queued"` (not only `"waiting"`) to display the wait state. This is the least disruptive fix — it only changes how status is displayed on the web dashboard, and both backend and mobile stay unchanged.

---

## Related Documentation

| File | Purpose |
|------|---------|
| `SYSU_GO_MOBILE_INTEGRATION.md` | Master mobile app ↔ backend doc (sysu-go team) |
| `SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md` | Frontend integration requirements (for sysu-app) |
| `SYSU_GO_BACKEND_REQUIREMENTS.md` | Outstanding backend items (for sysu-go team) |
| `FRONTEND_DASHBOARD_JS_CHANGES.md` | Dashboard.js changes applied |
| `QR_GENERATOR_FIXES.md` | QR generator fixes applied |
| `FLEET_QUEUE_ASSIGNMENT_STEPS.md` | Assignment flow steps |
| `SYSU_FRONTEND_CHANGES.md` | SAP table and Firestore schema reference |
| `backend/server.js` | Express + Socket.IO server (this repo) |
| `backend/routes/qrRoutes.js` | QR routes |
| `backend/controller/qrController.js` | QR operations controller |
| `backend/routes/dispatchRoutes.js` | Dispatch status endpoint |
| `backend/routes/userRoutes.js` | User management endpoints |

---

*This is the **FULLY INTEGRATED** state of the system as of 2026-05-27.*

**All items are complete:**
- sysu-go backend: ✅ Trip registration endpoint, sanitization, status fix
- sysu-go Android: ✅ TripRegistrationActivity, split name fields, sanitizers
- sysu-app dashboard: ✅ Fleet Manager `registrationComplete` gate, status mapping
- sysu-app QR generator: ✅ Socket.IO `qr_token_used` listener confirmed

**No open items remain.**
