> Contract correction, 2026-10-09: the duplicate mobile SAP proxy is retired; authorized staff receive 410 with no upstream data. Use sysu-app's guarded SAP service; Android has no shipped caller of the mobile proxy. Public Firestore diagnostics are disabled. Socket.IO requires verified Firebase identity/active profile and private tracking recipients. Historical endpoint/global-broadcast descriptions below do not supersede [the current tracker](../../FIX_TRACKER.md).

> Release correction (2026-10-08): POST /api/dispatch/status is retired in local source. Authenticated calls return 410; anonymous calls return 401. It no longer writes assignments/queues or emits dispatch_status_update. Earlier descriptions below are historical and superseded. No shipped Android HTTP caller was found; external clients need migration. Full owned progress/POD acceptance remains G-16. See [current release tracker](../../FIX_TRACKER.md) and [executed evidence](../../RELEASE_FIXES_TDD.md). This change is not yet deployed.

# SYSU-Go Backend — Integration Requirements for Frontend Team

> Last updated: 2026-05-23
> sysu-go repo contains: BACKEND (Node.js/Express) + ANDROID APP (Kotlin)
> Frontend (web dashboard + QR generator) is in a SEPARATE repo
> This file documents what the FRONTEND team must do to integrate properly

---

## OVERVIEW

The sysu-go backend exposes these interfaces:
- **REST API** on Railway (production): `https://sysu-app.onrender.com`
- **REST API** locally: `http://localhost:8080`
- **Socket.IO** on same host — verify token on handshake, send `auth: { token: firebaseIdToken }` in opts

---

## CRITICAL SECURITY FIXES — COMPLETED

### ✅ 1. Remove Firebase Credentials from Git

Files containing live secrets MUST NOT be committed to any repo:

- `backend/.env` — DELETE THIS FILE, add `.env` to `.gitignore`
- `backend/config/google-services.json` — DELETE THIS FILE, use env vars for credentials

Use `.env.example` as a template. All secrets should come from environment variables.

---

### ✅ 2. Fix `dashboard.js` — URL Decode Bug in `openAssignModal()`

**File**: `frontend/src/pages/dashboard.js`
**Severity**: HIGH — silently filters wrong truck types, causes assignment failures

`truckType` is passed through URL encoding but **never decoded**:

```js
// BROKEN (dashboard.js likely line ~600+):
openAssignModal(dispatchKey, truckType) {
  dispatchKey = decodeURIComponent(dispatchKey);
  // truckType is NOT decoded!
  this.state.requiredTruckType = truckType;
  // Fleet Queue won't filter correctly if truckType has spaces like "6-Wheeler"
}
```

**Fix applied**: Added `truckType = decodeURIComponent(truckType || "");` to `openAssignModal()`.

---

### ✅ 3. Fix `qr-generator.html` — Hardcoded Static Token Shown on Load

**File**: `frontend/src/pages/dashboard.js`
**Severity**: MEDIUM — security risk, static token can be reused by bystanders

**Fix applied**: Replaced boot sequence to show loading spinner instead of hardcoded token.

---

## INTEGRATION FIXES — COMPLETED

### ✅ 4. Re-enabled Socket.IO Real-Time Map in `dashboard.js`

**File**: `frontend/src/pages/dashboard.js`

Socket.IO real-time tracking was disabled. All related code has been re-enabled:

- Socket import uncommented
- MapManager imports `updateMarker`, `focusOnLocation`, `clearMarkers` added
- `_setupSocket()` call uncommented
- `_setupSocket()` method body uncommented

---

### ✅ 5. Built Dispatch Picker Modal for Fleet Queue Flow

**File**: `frontend/src/pages/dashboard.js` — method `openAssignModalForDriver()`

The was a stub that only showed an alert. Complete implementation now built:

- Shows unassigned SAP dispatches filtered by driver's truck type
- Sorts by planning date (oldest first = FIFO)
- Dispatcher picks one → highlights row → "Confirm Assignment"
- Writes to `sap_assignments/{dispatchKey}` and Updates `queue/{driverId}`
- Helper methods `_selectFleetDispatch()` and `_confirmFleetAssignment()` added

---

### ✅ 6. Fixed Field Name Inconsistency in Queue Sorting

**File**: `frontend/src/pages/dashboard.js`

Queue subscription was sorting by `entryTime` only. Updated to fall back to `joinedAt` and `updatedAt`:

```js
.sort((a, b) => {
  const getTs = (d) =>
    d.entryTime?.toDate?.() ??
    d.joinedAt?.toDate?.() ??
    (d.updatedAt ? new Date(d.updatedAt) : new Date(0));
  return getTs(a) - getTs(b);
});
```

---

### ✅ 7. QR Generator Token Countdown Fix

**File**: `frontend/src/qr-generator.html`

- Changed `QR_SEC` from `30` to `300` to match 5-minute backend token expiry
- Added dynamic countdown reading `expiresAt` from API response
- Enhanced error handling with toast notification on fetch failure

---

## OUTSTANDING ITEMS (sysu-go team / backend)

These require changes to the **sysu-go** repo (backend + Android), NOT this frontend repo:

| Priority | Item | Description | Status |
|----------|------|-------------|--------|
| **HIGH** | Implement `POST /api/trip/register` | Endpoint does not exist. No tripController.js, no tripRoute.js. | ⚠️ NOT BUILT |
| **HIGH** | Add sanitization to qrController.js | Backend writes raw req.body values to Firestore — no input sanitization exists | ⚠️ NOT BUILT |
| **HIGH** | Write `registrationComplete` field | Backend does not write this field; two-phase enrollment cannot function | ⚠️ NOT BUILT |
| ~~Medium~~ | ~~Dispatch status endpoint~~ | ~~`POST /api/dispatch/status`~~ | ✅ **ALREADY BUILT** — `dispatchRoutes.js` |
| ~~Low~~ | ~~CORS for Android~~ | ~~Backend CORS to include Android app host~~ | ✅ **ALREADY BUILT** — uses `ALLOWED_ORIGINS` env var (`server.js:26`) |
| ~~Low~~ | ~~Role alignment~~ | ~~Android writes `"driver"` role but backend accepts it~~ | ✅ **ALREADY BUILT** — `userRoutes.js:14` accepts `"driver"` |

---

## DATA SCHEMA REFERENCE

### Queue Document (`firestore queue/` collection)

Web-created and backend-created queue entries MUST use the same schema:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | YES | Firestore auto ID (doc id = queue entry id) |
| `driverName` | string | YES | Driver's full name |
| `phone` | string | NO | Phone number |
| `plateNumber` | string | YES | Vehicle plate |
| `license` | string | NO | Driver license |
| `truckType` | string | YES | "AUV", "4W", "6W", "10W", "20F", "40F" |
| `truckCompany` | string | NO | Trucking company name |
| `helper` | string | NO | Helper name (note: NOT `helperName`) |
| `entryTime` | Timestamp | YES | For FIFO sorting — use `serverTimestamp()` |
| `isAssigned` | boolean | YES | Must be `false` initially. Web dashboard filters `isAssigned === false` |
| `status` | string | YES | One of: `"queued"` \| `"waiting"` \| `"loading"` \| `"complete"` |
| `notes` | string | NO | Free text |

**IMPORTANT — AS-BUILT STATUS**: The backend writes `status: "queued"` (qrController.js:129).
Mobile app queries for `status === "queued"` — this is correct and aligned.
Web dashboard must account for `"queued"` value, not only `"waiting"`.

### SAP Assignment Document (`firestore sap_assignments/` collection)

| Field | Type | Notes |
|-------|------|-------|
| `driverId` | string | Firestore doc ID of the queue entry |
| `driverName` | string | Driver's full name |
| `truckPlate` | string | Plate number |
| `assignedAt` | Timestamp | Set via `serverTimestamp()` |

---

## SOCKET.IO REFERENCE

### Android → Backend Events

**`update_status`** — emitted when driver goes online/offline
```json
{ "driverId": "firebase-uid", "status": "online", "name": "Driver Name" }
```

**`driver_moving`** — emitted on GPS update (throttled to every ~20 seconds with 30m movement filter)
```json
{
  "driverId": "firebase-uid",
  "lat": 14.5995,
  "lng": 120.9842,
  "name": "Driver Name",
  "status": "online"
}
```

### Backend → Web Dashboard Events (broadcast to all connected clients)

**`update_admin_map`** — live driver location
```json
{
  "driverId": "firebase-uid",
  "lat": 14.5995,
  "lng": 120.9842,
  "name": "Driver Name",
  "status": "online"
}
```

**`vendor_status_update`** — driver online/offline status change
```json
{ "driverId": "firebase-uid", "name": "Driver Name", "status": "online" }
```

**`queue_update`** — queue changed (broadcast from backend on every queue write)
```json
{ "queue": [{ "id": "...", "driverName": "...", ... }] }
```

### Web Dashboard → Backend (listening only, no emits needed)

The web dashboard listens to `update_admin_map` and `vendor_status_update` via the re-enabled Socket.IO listener in `_setupSocket()`.

---

## API ENDPOINTS SUMMARY

All production: `https://sysu-app.onrender.com`
All local: `http://localhost:8080`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/sap/shipments` | Bearer token | Fetch SAP OData shipments |
| GET | `/api/qr/generate` | None | Get new QR auth token (5 min expiry) |
| GET | `/api/qr/verify?token=XXX` | None | Verify QR token before scanning — does NOT mark used, does NOT emit event |
| POST | `/api/qr/scan` | None* | Submit driver info after QR scan → writes to `queue` collection; emits `qr_token_used` |
| GET | `/api/qr/queue` | None | Get current queue (grouped by truck type) |
| PATCH | `/api/qr/queue-status` | Bearer (admin) | Update queue entry status |
| POST | `/api/dispatch/status` | Bearer (admin) | Update SAP dispatch assignment status — **ALREADY BUILT** ✅ |
| POST | `/api/users/update-role` | Bearer (admin) | Change user role |
| POST | `/api/users/delete` | Bearer (admin) | Delete user account |
| GET | `/api/health` | None | Health check |
| GET | `/api/firestore-test` | None | Firestore connectivity test |

**QR_SCAN_REQUIRE_AUTH*: `POST /api/qr/scan` currently requires NO auth by default (controlled by `QR_SCAN_REQUIRE_AUTH` env var in qrRoutes.js:9). Mobile app does not need to send Bearer token unless that env var is enabled on the server.

---

## CHECKLIST

**Status Legend:** ✅ = Verified in code | ⚠️ = Needs implementation | ❌ = Not implemented / discrepancy fixed

- [x] Fix `truckType` URL decode in `dashboard.js` `openAssignModal()`
- [x] Remove hardcoded `STATIC_TOKEN` in QR generator, show loading spinner
- [x] Uncomment Socket.IO in `dashboard.js` (`_setupSocket()`)
- [x] Backend emits `status: "queued"` — mobile app correctly queries for `"queued"` (aligned ✅)
- [x] Build dispatch picker modal for Fleet Queue assign flow
- [x] Add `entryTime` field fallback (`joinedAt`, `updatedAt`) for queue sorting
- [x] `POST /api/dispatch/status` endpoint — ✅ ALREADY BUILT in `dispatchRoutes.js`
- [x] CORS env var `ALLOWED_ORIGINS` — ✅ ALREADY BUILT in `server.js`
- [x] Role `"driver"` accepted — ✅ ALREADY BUILT in `userRoutes.js:14`
- [ ] `POST /api/trip/register` endpoint — ⚠️ NOT BUILT (needs tripController.js + tripRoute.js)
- [ ] Add sanitization to qrController.js — ⚠️ NOT BUILT
