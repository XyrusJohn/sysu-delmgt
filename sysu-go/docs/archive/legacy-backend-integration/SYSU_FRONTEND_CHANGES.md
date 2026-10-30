> Contract correction, 2026-10-09: the duplicate mobile SAP proxy is retired; authorized staff receive 410 with no upstream data. Use sysu-app's guarded SAP service; Android has no shipped caller of the mobile proxy. Public Firestore diagnostics are disabled. Socket.IO requires verified Firebase identity/active profile and private tracking recipients. Historical endpoint/global-broadcast descriptions below do not supersede [the current tracker](../../FIX_TRACKER.md).

# SYSU Frontend Changes — Integration Notes
> **For Mobile App / TV App / Backend Team**
> Last Updated: 2026-05-25

---

## 1. SAP Shipments Table — New Column: Planned Date

The **SAP Shipments** tab table now has 9 columns:

| # | Shipment # | Truck Type | Route | Date | Status | Planned Date | Assignment | Actions |

### Table Structure (HTML)
**File:** `frontend/dashboard.html` (lines ~967-990)
```html
<!-- Sortable headers -->
<th onclick="window.dashboard.sortSap('SAPDispatchNumber')">Shipment #</th>
<th onclick="window.dashboard.sortSap('TruckType')">Truck Type</th>
<th onclick="window.dashboard.sortSap('Route')">Route</th>
<th onclick="window.dashboard.sortSap('PlanningDate')">Date</th>
<th onclick="window.dashboard.sortSap('PgiStatus')">Status</th>
<th onclick="window.dashboard.sortSap('ActualDelDate')">Planned Date</th>
<th>Assignment</th>
<th>Actions</th>
```

### Column Data (JavaScript)
**File:** `frontend/src/pages/dashboard.js`

| Column | Field Source | Notes |
|---|---|---|
| `#` | `index + 1` | Row number |
| `Shipment #` | `key` (SAPDispatchNumber, leading zeros stripped) | Clickable → opens dispatch detail |
| `Truck Type` | `rec.TruckType` | |
| `Route` | `g.routeDisplay` | Formatted route string |
| `Date` | `rec.PlanningDate` or `rec.Planning_Date` | Parsed via `SAPService.parseDate()` |
| `Status` | `rec.PgiStatus` or `rec.CheckStatus` | Falls back to "Pending" |
| **Planned Date** | **`rec.ActualDelDate`** | ← NEW. Parsed via `SAPService.parseDate()`. Sortable. |
| Assignment | `asgn.driverName`, `asgn.truckPlate` | Comes from `sap_assignments` Firestore |
| Actions | — | ASSIGN / CHANGE / COMPLETE |

### Planned Date Sort Logic
**File:** `frontend/src/pages/dashboard.js` (line ~568)
```javascript
if (key === "PlanningDate" || key === "Planning_Date" || key === "ActualDelDate") {
    valA = parseInt((valA + "").replace("/Date(", "").replace(")/", "")) || 0;
    valB = parseInt((valB + "").replace("/Date(", "").replace(")/", "")) || 0;
}
```

---

## 2. Firestore Collections (Reference)

### `sap_assignments`
**Purpose:** Records confirmed driver-dispatch assignments

```json
{
  "0010128043": {
    "driverId": "P7AzRAmpc9nF6rqzZO8J",
    "driverName": "Xyrus John P. Vertucio",
    "truckPlate": "BCA 1234",
    "assignedAt": "<Firestore Timestamp>"
  }
}
```

- **Document ID** = SAP Dispatch Number (e.g., `0010128044`)
- Fields: `driverId`, `driverName`, `truckPlate`, `assignedAt`
- Real-time listener: `SAPService.subscribeToAssignments()` — fires `_renderAll()` on any change

### `queue`
**Purpose:** Driver queue for QR-based check-in system

```json
{
  "<driverId>": {
    "driverId": "...",
    "driverName": "...",
    "helper": "...",
    "truckCompany": "...",
    "truckType": "10W",
    "plateNumber": "ABC 1234",
    "status": "queued",  // ⚠️ AS-BUILT — backend writes "queued", mobile queries for "queued"
    "isAssigned": false,
    "joinedAt": "<Firestore Timestamp>",
    "entryTime": "<Firestore Timestamp>"
  }
}
```

- **Document ID** = Firestore auto-generated ID (NOT the driverId — see note below)
- **Important:** `id` field IS the Firestore doc ID = queue entry ID = the `queueId` returned by `POST /api/qr/scan`
- Fields: `driverId`, `driverName`, `helper`, `truckCompany`, `truckType`, `plateNumber`, `status` (`queued` | `waiting` | `loading` | `complete` | `called`), `isAssigned`, `joinedAt`, `entryTime`
- **⚠️ Note on status**: AS-BUILT backend writes `status: "queued"`. The mobile app queries for `status === "queued"` (MainActivity.kt:107) — this is correctly aligned.

### Queue Removal on Assignment (TV Integration)
**File:** `frontend/src/pages/dashboard.js` — `confirmAssignment()` function (line ~1764)

When a driver is confirmed as assigned:
1. Document written to `sap_assignments/<dispatchKey>` with driver info
2. `queue/<driverId>` document updated: `isAssigned: true`, `status: "loading"`
3. **`onSnapshot` listener on `queue` collection** (TV app) automatically receives updates

**TV removal flow:**
```
Dispatcher confirms assignment
  → Firestore: queue/<driverId>.isAssigned = true
  → TV app's Firestore onSnapshot (queue collection)
  → TV automatically removes driver from queue display
```

No separate socket event needed — Firestore real-time listener handles it.

---

## 3. Confirmation Assignment Flow

**Entry:** Dispatcher clicks "ASSIGN" on an unassigned dispatch row

**JavaScript function:** `window.dashboard.openAssignModal(dispatchKey, truckType)`
- Sets `this.state.assignTarget = dispatchKey`
- Sets `this.state.requiredTruckType = truckType`
- Filters `this.state.queue` by matching `truckType`
- Renders available drivers matching truck type

**Confirmation:** `window.dashboard.confirmAssignment()`
- Finds selected driver from `this.state.queue`
- Writes to `sap_assignments/<dispatchKey>` ← creates/overwrites
- Updates `queue/<driverId>` → sets `isAssigned: true`, `status: "loading"`
- Closes modal, triggers `_renderAll()` ← table auto-updates

---

## 4. QR Token System

### Endpoints

| Method | Route | Description |
|---|---|---|
| POST | `/api/qr/generate` | Generate new QR token |
| GET | `/api/qr/verify?token=XXX` | Driver scans QR → validates token (read-only, does NOT mark used, does NOT emit events) |
| POST | `/api/qr/scan` | Driver joins queue → marks token `isUsed: true`, creates queue entry, emits `qr_token_used` to all TV clients |

### Socket Events

| Event | Direction | Payload | Trigger |
|---|---|---|---|
| `qr_token_used` | Server → TV clients | `{token}` | Driver joins queue — **only** via `POST /api/qr/scan` (⚠️ NOT via verify) |
| `queue_update` | Server → All clients | `{queue: [...]}` | After every queue write (scanQR, updateQueueStatus) |
| `driver_moving` | Client → Server | `{driverId, lat, lng, ...}` | Driver GPS update |
| `update_admin_map` | Server → All clients | `{driverId, lat, lng, status}` | Broadcast driver position (from `driver_moving`) |

**⚠️ CRITICAL — QR Reset Logic (verified from code):**
```
GET /api/qr/verify → checks validity only, NO side effects
POST /api/qr/scan → marks token-used, creates queue, EMITS qr_token_used
```
Do NOT rely on verifyQR to reset the QR. Only scanQR does.

**File:** `backend/controller/qrController.js:138`
```javascript
// In scanQR():
const io = req.app.get("io");
if (io) io.emit("qr_token_used", { token });  // ← ONLY HERE, not in verifyQR
```

### TV Client (QR Display)
**File:** `frontend/src/socket-tv.js`

```javascript
socket.on("qr_token_used", () => {
    if (onRefreshQR) onRefreshQR();  // fetch new QR from /api/qr/generate
});
socket.on("disconnect", () => {});
```

---

## 5. SAP Data — Key Fields

Fetched from: `GET /api/sap/shipments` (backend proxies to SAP OData)

| Field | Description |
|---|---|
| `SAPDispatchNumber` | Dispatch ID (use as key) |
| `TruckType` | "10w", "4w", "LCL" etc. — **filter out LCL** |
| `OBDNumber` | Per-dispatch line item reference |
| `PlanningDate` / `Planning_Date` | Planning/created date |
| `ActualDelDate` | **Planned Delivery Date** |
| `Route` | Format: `"1102 --> CITY,PROVINCE"` |
| `ShipmentStart` | SAP time string `"PT00H00M00S"` — parse with `_parseSAPTime()` |
| `PgiStatus` / `CheckStatus` | Status flag ("Pending", "Delivered", etc.) |
| `Amount`, `Volume`, `Weight`, `Quantity` | Numeric delivery data |
| `SONumber`, `PONumber` | Order reference numbers |
| `ShipToParty`, `ShipToPartyName` | Customer code and name |
| `Address`, `Latitude`, `Longitude` | Delivery location details |
| `ForwardingAgent` | Agent code (e.g. `"0000001102"`) |
| `driverId` | Populated after Firestore assignment |

---

## 6. SAP Service — Key Methods

**File:** `frontend/src/api/sapService.js`

| Method | Description |
|---|---|
| `fetchShipments()` | Fetches all SAP shipments from backend, groups by dispatch number |
| `subscribeToAssignments(callback)` | Firestore `onSnapshot` on `sap_assignments` — real-time callbacks |
| `parseDate(raw)` | Parses SAP date strings (`/Date(XXX)/`) → `"5/23/2026"` format |

---

## 7. Real-Time Architecture Summary

```
Driver scans QR
  → POST /api/qr/verify
      → Firestore: qr_tokens/<token>.used = true
      → Socket.io: emit "qr_token_used" to all TV clients
          → TV refreshes QR from /api/qr/generate

Dispatcher assigns driver to dispatch
  → dashboard.confirmAssignment()
      → Firestore: sap_assignments/<dispatchKey> written
      → Firestore: queue/<driverId>.isAssigned = true, status = "loading"
          → All Firestore onSnapshot listeners automatically updated
          → SAP Shipments table updates ( ASSIGNED badge, green border )
          → TV queue removes that driver automatically
```
