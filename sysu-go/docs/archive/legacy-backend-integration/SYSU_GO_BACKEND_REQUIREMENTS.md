> Release correction (2026-10-08): POST /api/dispatch/status is retired in local source. Authenticated calls return 410; anonymous calls return 401. It no longer writes assignments/queues or emits dispatch_status_update. Earlier descriptions below are historical and superseded. No shipped Android HTTP caller was found; external clients need migration. Full owned progress/POD acceptance remains G-16. See [current release tracker](../../FIX_TRACKER.md) and [executed evidence](../../RELEASE_FIXES_TDD.md). This change is not yet deployed.

# SYSU-Go Backend — Outstanding Items for Frontend Integration

> Last updated: 2026-05-23
> These items require changes to the **sysu-go** repo (backend + Android), NOT the frontend repo.
> Frontend changes are complete — these backend items block full end-to-end integration testing.

---

## OVERVIEW

The frontend (this repo) has been updated to integrate with the sysu-go backend. After reviewing the sysu-go codebase, the following items are needed from the backend/Android team to fully complete the integration.

| # | Priority | Item | Owner | Status |
|---|----------|------|-------|--------|
| 1 | ~~**HIGH**~~ | ~~Add `POST /api/dispatch/status` endpoint~~ | ~~Backend~~ | ✅ **ALREADY BUILT** — `dispatchRoutes.js` |
| 2 | **HIGH** | Implement `POST /api/trip/register` endpoint | Backend | ⚠️ NOT BUILT |
| 3 | **HIGH** | Add input sanitization to qrController.js | Backend | ⚠️ NOT BUILT |
| 4 | **HIGH** | Write `registrationComplete` field in scanQR | Backend | ⚠️ NOT BUILT |
| 5 | ~~**MEDIUM**~~ | ~~Fix CORS for Android app host~~ | ~~Backend~~ | ✅ **ALREADY BUILT** — `ALLOWED_ORIGINS` env var |
| 6 | ~~**MEDIUM**~~ | ~~Align role names (Android writes `"driver"`)~~ | ~~Backend~~ | ✅ **ALREADY BUILT** — `"driver"` accepted in `userRoutes.js:14` |

---

## Item 1: `POST /api/dispatch/status` — ✅ ALREADY BUILT

The dispatch status endpoint **exists** at `backend/routes/dispatchRoutes.js`.

**Route:** `POST /api/dispatch/status`

**Implementation verified in `dispatchRoutes.js:10`**: Writes to `sap_assignments/{dispatchKey}` with `statusHistory[]`, emits `dispatch_status_update` socket event, and optionally updates `queue/{driverId}`.

**Valid statuses:** `assigned`, `loading`, `in_transit`, `delivered`, `cancelled`

This item can be removed from the outstanding list. ✅ COMPLETE.

---

## Item 2: Implement `POST /api/trip/register` — ⚠️ HIGH PRIORITY — NOT YET BUILT

> ⚠️ **This is the most critical missing piece.** The full spec follows.

### Why This Is Needed

After a driver joins the queue via `POST /api/qr/scan`, they should be able to register trip details (helper name, company, truck type, plate number). This data does NOT exist yet because:
1. The trip registration endpoint doesn't exist
2. `scanQR` doesn't write `registrationComplete`, `helperFN/MI/LN`, `company`, `platePrefix/Suffix`

**Without this**, every QR-scanned driver is immediately eligible for Fleet Manager assignment with incomplete info (no helper, no company). The two-phase enrollment in the spec cannot function.

### Location

Both files need to be created:
- `backend/routes/tripRoute.js` (NEW)
- `backend/controller/tripController.js` (NEW)

And `server.js` needs this line added:
```js
app.use("/api/trip", require("./routes/tripRoute.js"));
```

### Required Implementation

**Route:** `POST /api/trip/register`
**Auth:** Requires `Authorization: Bearer <Firebase ID Token>`

**Request:**
```json
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

**Server-side behavior:**
1. Validate auth token
2. Fetch `queue/{queueId}` — verify it exists
3. Verify `registrationComplete !== true`
4. Sanitize ALL string inputs — strip `< > & " ' ; \ /`, collapse whitespace, trim
5. Build full names:
   - `helper = helperFN + " " + helperMI + ". " + helperLN`
   - `plateNumber = platePrefix + "-" + plateSuffix`
6. Atomic update `queue/{queueId}` with:
   - `helperFN`, `helperMI`, `helperLN`, `helper`
   - `company`, `truckType`, `platePrefix`, `plateSuffix`, `plateNumber`
   - `registrationComplete: true`
   - `updatedAt: FieldValue.serverTimestamp()`
7. Emit `qr_token_used` via Socket.IO (confirms TV refresh)
8. Return success

**Response (200):**
```json
{
  "success": true,
  "message": "Trip registered successfully",
  "queueId": "abc123xyz",
  "registrationComplete": true
}
```

**Error responses:**
| Status | When | Message |
|--------|------|---------|
| 400 | Missing/invalid fields | `"Missing required fields: helperFN, company, ..."` |
| 400 | Invalid truckType | `"Invalid truckType. Must be: AUV, 4W, 6W, 10W, 20F, 40F"` |
| 400 | Invalid plateSuffix | `"plateSuffix must be 3-4 digits"` |
| 404 | queueId not found | `"Queue entry not found"` |
| 409 | Already registered | `"Trip already registered for this queue entry"` |

---

## Item 3: Add Input Sanitization to qrController.js — ⚠️ HIGH PRIORITY — NOT YET BUILT

### Why This Is Needed

The `scanQR` function in `qrController.js` writes raw `req.body` values directly to Firestore with **zero sanitization**. Any string field can contain_script injection, HTML tags, or special characters that corrupt data or break UI rendering.

### Current State

```javascript
// qrController.js:83 — NO sanitization
const { token, driverName, helperName, truckCompany, truckType, plateNumber, driverId } = req.body;
// ... all used directly in queueEntry object
```

### Required Implementation

**Add a SANITIZE helper at the top of qrController.js:**
```javascript
const SANITIZE = (str, max = 50) => {
  if (!str) return "";
  return str
    .replace(/[<>$ &""|;'\\\/]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, max);
};

const SANITIZE_MI = (str) => {
  if (!str) return "";
  return str.charAt(0).toUpperCase();
};
```

**Apply to all incoming body fields BEFORE queue write:**
```javascript
const queueEntry = {
  driverName: SANITIZE(driverName, 100),
  helper: SANITIZE(helperName, 100),
  truckCompany: SANITIZE(truckCompany, 100),
  truckType: SANITIZE(truckType, 10).toUpperCase(),
  plateNumber: SANITIZE(plateNumber, 20),
  // ...
};
```

---

## Item 4: Write `registrationComplete` Field in scanQR — ⚠️ NOT YET BUILT

The `scanQR` queue write (line 117-132 of `qrController.js`) does NOT include:
- `registrationComplete: false`
- `driverFN`, `driverMI`, `driverLN`
- `helperFN`, `helperMI`, `helperLN`
- `company`, `platePrefix`, `plateSuffix`

These must be added to the queue write. Even if they come as empty strings initially, having them in the schema enables:
1. The `registrationComplete` gate for Fleet Manager visibility
2. Future trip registration to know which fields to update

---

## Integration Test Plan

After implementing Items 2, 3, and 4 above:

### Test 1: QR Scan + Trip Registration
1. Driver scans QR → `POST /api/qr/scan` → driver in queue with `status: queued`
2. App shows trip registration form → driver fills Helper FN/MI/LN, Company, Truck Type, Plate
3. App calls `POST /api/trip/register` → succeeds with 200
4. Queue doc updated with all helper/company/plate fields + `registrationComplete: true`
5. `qr_token_used` emitted → QR Generator TV refreshes
6. Driver visible in Fleet Manager (after regComplete = true gate is implemented client-side)

### Test 2: Role Assignment — ✅ Already works
1. Register new user via Android → `role: "driver"` in Firestore ✅
2. Admin changes role via web dashboard → `POST /api/users/update-role` succeeds ✅

---

## File Locations Reference (sysu-go repo)

| Item | File Path | What to Change | Status |
|------|-----------|----------------|--------|
| 1 | `backend/routes/dispatchRoutes.js` | Already complete | ✅ |
| 2 | `backend/routes/tripRoute.js` | CREATE new file | ⚠️ NOT BUILT |
| 2 | `backend/controller/tripController.js` | CREATE new file | ⚠️ NOT BUILT |
| 2 | `backend/server.js` | Add: `app.use("/api/trip", ...)` | ⚠️ NOT BUILT |
| 3 | `backend/controller/qrController.js` | Add SANITIZE helper, apply to all body fields | ⚠️ NOT BUILT |
| 4 | `backend/controller/qrController.js` | Add `registrationComplete: false`, split name fields to queue write | ⚠️ NOT BUILT |
| — | `backend/config/sanitize.js` | Exists but doesn't export SANITIZE helpers for Firestore | ⚠️ NOT USED |

---

## Related Documentation

- Frontend integration: `docs/archive/legacy-backend-integration/SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md`
- QR generator fixes: `docs/archive/legacy-backend-integration/QR_GENERATOR_FIXES.md`
- Fleet queue assignment: `docs/archive/legacy-backend-integration/FLEET_QUEUE_ASSIGNMENT_STEPS.md`
- Complete discrepancy table: `docs/archive/legacy-backend-integration/DISCREPANCY_LOG.md`

### Required Implementation

**New endpoint**: `POST /api/dispatch/status`

**Request shape**:
```json
{
  "dispatchKey": "0000123456",
  "status": "in_transit",
  "driverId": "firebase-uid",
  "lat": 14.5995,
  "lng": 120.9842,
  "notes": "Cargo loaded, departing warehouse"
}
```

**Response shape**:
```json
{
  "success": true,
  "dispatchKey": "0000123456",
  "status": "in_transit",
  "updatedAt": "2026-05-23T10:30:00.000Z"
}
```

**Valid status values**: `"assigned"` | `"loading"` | `"in_transit"` | `"delivered"` | `"cancelled"`

**Server-side behavior**:
1. Validate user is authenticated (Bearer token)
2. Validate `dispatchKey` exists in SAP data
3. Validate `status` is one of the allowed values
4. Write update to Firestore (either `sap_dispatches/{dispatchKey}` or as metadata on `sap_assignments/{dispatchKey}`)
5. Emit Socket.IO event `"dispatch_status_update"` to all connected clients:
   ```json
   {
     "type": "dispatch_status_update",
     "dispatchKey": "0000123456",
     "status": "in_transit",
     "driverId": "firebase-uid",
     "lat": 14.5995,
     "lng": 120.9842,
     "notes": "Cargo loaded, departing warehouse",
     "updatedAt": "2026-05-23T10:30:00.000Z"
   }
   ```
6. If driverId is provided, also update the corresponding queue entry status

**Frontend impact**:
- The Socket.IO listener in `dashboard.js` (`_setupSocket()`) needs to listen for `"dispatch_status_update"` events and update the SAP table view accordingly
- This requires adding a new event handler to `_setupSocket()`:
   ```js
   socket.on("dispatch_status_update", (data) => {
       // Update dispatch state and re-render SAP table
       this._renderSapTable();
   });
   ```

**Firestore schema** — suggested document at `sap_dispatches/{dispatchKey}`:
```json
{
  "dispatchKey": "0000123456",
  "status": "in_transit",
  "driverId": "firebase-uid",
  "driverName": "Juan Dela Cruz",
  "truckPlate": "ABC 1234",
  "statusHistory": [
    { "status": "assigned", "at": "Timestamp", "by": "firebase-uid" },
    { "status": "loading", "at": "Timestamp", "by": "firebase-uid" },
    { "status": "in_transit", "at": "Timestamp", "lat": 14.5995, "lng": 120.9842, "by": "firebase-uid" }
  ],
  "updatedAt": "Timestamp",
  "updatedBy": "firebase-uid"
}
```

**Location of related code in sysu-go**:
- `backend/controller/qrController.js` — reference for existing PATCH endpoint pattern
- `backend/routes/qrRoutes.js` — route registration
- `backend/services/socketService.js` — Socket.IO emit pattern

---

## Item 5: CORS for Android App Host — ✅ ALREADY BUILT

**This item is complete.** The backend uses `ALLOWED_ORIGINS` environment variable (server.js:26-32) which supports comma-separated origins. Mobile apps with no origin header (`!origin`) are automatically allowed.

Verified CORS implementation in `server.js:24-33`:
```js
const rawOrigins = process.env.ALLOWED_ORIGINS || FRONTEND_ORIGIN;
const allowedOrigins = rawOrigins.split(",").map((s) => s.trim()).filter(Boolean);
const isAllowedOrigin = (origin, cb) => {
  if (!origin) return cb(null, true);  // Mobile apps / Socket.IO
  if (allowedOrigins.includes(origin)) return cb(null, true);
  if (process.env.NODE_ENV !== "production") return cb(null, true);
  cb(new Error(`CORS: origin ${origin} not allowed`));
};
```

To add the Android app origin in production:
```
ALLOWED_ORIGINS=https://sysu-web-5a25d.web.app,https://your-android-host.firebaseapp.com,https://your-android-host.web.app
```

---

## Item 6: Align Role Names — ✅ ALREADY BUILT

**This item is complete.** The backend's `userRoutes.js:14` now accepts `"driver"` as a valid role:

```js
const validRoles = ["admin", "super_admin", "fleet_manager", "qr_generator", "pending", "driver"];
```

Android-registered users with `role: "driver"` can now be managed via the web dashboard's user role management.

---

## Integration Test Plan

After implementing Items 2 (trip register), 3 (sanitization), and 4 (registrationComplete):

### Test 1: Full Queue Flow
1. Android driver registers → `POST /api/qr/scan` via Android app
2. Driver appears in web dashboard Fleet Queue (filtered by `isAssigned: false`)
3. Admin clicks "ASSIGN" on driver → modal shows SAP dispatches
4. Admin selects dispatch → `POST /sap_assignments` writes successfully
5. Queue entry updates with `isAssigned: true`, `status: "loading"`
6. Driver disappears from Fleet Queue (filter hides assigned)

### Test 2: Dispatch Status Updates
1. After assignment, backend calls `POST /api/dispatch/status` with `"status": "loading"`
2. Web dashboard receives Socket.IO `"dispatch_status_update"` event
3. SAP table reflects new status (color coding changes)
4. Sequence: `assigned` → `loading` → `in_transit` → `delivered`

### Test 3: Android CORS
1. Install Android app on physical device (not emulator — emulator uses localhost)
2. Open app, login → `POST /api/qr/generate` succeeds (no CORS error)
3. Scan QR → `POST /api/qr/scan` succeeds
4. Location service starts → `POST /api/qr/queue-status` succeeds
5. Driver appears in web dashboard Fleet Queue

### Test 4: Role Assignment
1. Register new user via Android → `role: "driver"` in Firestore
2. Admin login to web dashboard → Users tab
3. Select `"driver"` user → change role to `"fleet_manager"` → succeeds
4. User now has `fleet_manager` permissions on web dashboard

---

## File Locations Reference (sysu-go repo)

| Item | File Path | What to Change |
|------|-----------|----------------|
| 1 | `backend/controller/qrController.js` or new `backend/controller/dispatchController.js` | Add `POST /api/dispatch/status` handler |
| 1 | `backend/routes/index.js` or `backend/routes/dispatchRoutes.js` | Register new route |
| 1 | `backend/services/socketService.js` | Emit `dispatch_status_update` event |
| 2 | `backend/index.js` or `backend/app.js` | Add Android origin to CORS config |
| 2 | `backend/.env` | Add `ALLOWED_ORIGINS` env var |
| 3 | `backend/controller/userController.js` | Add `"driver"` to `VALID_ROLES` |
| 3 | `android/app/src/main/java/.../RegistrationActivity.kt` | Verify `role: "driver"` is written |

---

## Related Documentation

- Frontend integration: `docs/archive/legacy-backend-integration/SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md`
- Frontend dashboard changes: `docs/archive/legacy-backend-integration/FRONTEND_DASHBOARD_JS_CHANGES.md`
- QR generator fixes: `docs/archive/legacy-backend-integration/QR_GENERATOR_FIXES.md`
- Fleet queue assignment: `docs/archive/legacy-backend-integration/FLEET_QUEUE_ASSIGNMENT_STEPS.md`
