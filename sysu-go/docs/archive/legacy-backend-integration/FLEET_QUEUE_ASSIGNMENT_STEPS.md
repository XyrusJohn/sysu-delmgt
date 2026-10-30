# Step-by-Step: Complete Assignment Flow (Flow 6B)

> This file is for the frontend (separate `sysu-web` repo).
> Apply changes in order. Each step is independent and copy-paste ready.
> **Status: ALL STEPS COMPLETED** (2026-05-23)

---

## Step 1 — `truckType` URL Decode Fix in `openAssignModal` ✅ DONE

**Find this in `dashboard.js`:**
```js
openAssignModal(dispatchKey, truckType) {
  dispatchKey = decodeURIComponent(dispatchKey);
  truckType = decodeURIComponent(truckType || "");  // ← ADDED
```

**Added** `truckType = decodeURIComponent(truckType || "");` after the `dispatchKey` line.
This affects the SAP table's Assign button and the Fleet Queue's Assign button (same method handles both).

---

## Step 2 — Uncomment Socket.IO (live map markers) ✅ DONE

### A. Import
```js
import {EVENTS, socket} from "../api/socket.js"; // uncommented
```

### B. MapManager imports
```js
import {
  initLeafletMap,
  switchMapTheme,
  updateMarker,    // ← ADDED
  focusOnLocation, // ← ADDED
  clearMarkers,     // ← ADDED
} from "../components/MapManager.js";
```

### C. Call in `_startDataEngines()`
```js
this._setupSocket(); // ← uncommented
```

### D. Uncomment `_setupSocket()` method ✅ DONE
Full implementation now active:
```js
_setupSocket() {
    socket.on(EVENTS.DRIVER_MOVING, (data) => {
        this.state.liveTracking[data.driverId] = {
            ...this.state.liveTracking[data.driverId],
            ...data,
            status: "online",
        };
        updateMarker(this.state.liveTracking[data.driverId]);
        this._renderAll();
    });

    socket.on(EVENTS.STATUS_UPDATE, (data) => {
        if (this.state.liveTracking[data.driverId]) {
            this.state.liveTracking[data.driverId].status = data.status;
            updateMarker(this.state.liveTracking[data.driverId]);
            this._renderAll();
        }
    });

    socket.on("connect", () => console.log("📡 Socket Connected"));
    socket.on("connect_error", (err) =>
        console.warn("📡 Socket Connection Failed:", err.message),
    );
}
```

---

## Step 3 — Dispatch Picker Modal for Fleet Queue Assign ✅ DONE

**The fleet assign flow (flow 6B):**
Fleet Queue → "ASSIGN" button → shows unassigned SAP dispatches (filtered by truck type) → dispatcher picks one → "Confirm Assignment" → driver assigned to that SAP dispatch.

### `openAssignModalForDriver` — replaces stub with full implementation:

The modal (`assignDriverModal`) now shows dispatch rows filtered by truck type:

```js
openAssignModalForDriver(driverId, truckType) {
    // Decode truckType from URL encoding
    truckType = decodeURIComponent(truckType || "");

    // Store which driver we're assigning
    this.state.assignFromFleetDriverId = driverId;
    this.state.assignFromFleetTruckType = truckType;

    // Find driver from queue by id
    const driver = this.state.queue.find((q) => q.id === driverId);
    if (!driver) {
        alert("Driver not found in queue.");
        return;
    }

    // Build list of unassigned SAP dispatches matching truck type
    const unassignedKeys = Object.entries(this.state.sapGroupedByDispatch).filter(([key, records]) => {
        // Skip if already assigned or has driver
        // Filter by truck type
        // ...
    });
    // Sort by planning date (oldest first)
    // Show dispatch rows in modal, each with onclick → _selectFleetDispatch
    // Disable confirm button until dispatch selected
    // Show modal
}
```

### `openAssignModalForDriver` helper methods:

**`_selectFleetDispatch(dispatchKey, driverId)`** — called when dispatcher clicks a dispatch row:
- Sets `this.state.assignTarget = dispatchKey`
- Sets `this.state.selectedQueueDriverId = driverId`
- Highlights selected row
- Enables Confirm button

**`_confirmFleetAssignment()`** — called when dispatcher clicks "Confirm Assignment":
- Writes `sap_assignments/{dispatchKey}` with driver info and `serverTimestamp()`
- Updates `queue/{driverId}` with `isAssigned: true`, `status: "loading"`, `serverTimestamp()`
- Shows success alert
- Calls `this.closeAssignModal()` + `this._renderAll()`

**Methods bound to window** for HTML onclick access:
```js
window.dashboard._selectFleetDispatch = this._selectFleetDispatch.bind(this);
window.dashboard._confirmFleetAssignment = this._confirmFleetAssignment.bind(this);
```

---

## Step 4 — Confirm `confirmAssignment()` State Reset ✅ VERIFIED

The standard `confirmAssignment()` already resets `assignTarget` and `selectedQueueDriverId` in `closeAssignModal()`. `_confirmFleetAssignment()` also resets them in its finally block.

---

## Integration Test Checklist ✅ READY

After applying all steps above, verify:

1. **SAP Table Assign flow (Flow 6A)** still works:
   - Click ASSIGN on an unassigned SAP row → modal shows queue drivers → pick driver → Confirm → driver assigned

2. **Fleet Queue Assign flow (Flow 6B)** — NEW:
   - Go to Fleet Queue view
   - Click ASSIGN on any driver card
   - Modal appears showing unassigned SAP dispatches (filtered by truck type)
   - Click one dispatch row → it highlights blue/red
   - Click "Confirm Assignment" → driver assigned → SAP dispatches table shows the driver

3. **truckType URL decode**:
   - Click ASSIGN on "6-Wheeler" dispatch → queue drivers matching "6-Wheeler" appear (not empty)

4. **Socket.IO live map**:
   - Android app sends `driver_moving` → web dashboard shows live marker on map
   - Status dot changes to green in Fleet Tree

5. **FIFO order**:
   - Driver who checked in earliest (lowest `entryTime`) appears as #1 in Fleet Queue

---

## Backend Changes (sysu-go repo — AS-BUILT state)

| Done | Description |
|------|-------------|
| ✅ | `qrController.js:129` writes `status: "queued"` (⚠️ NOTE: some docs say "waiting" — the actual code writes "queued") |
| ✅ | `qrController.js:128` writes `isAssigned: false` |
| ✅ | `qrController.js:126` writes `entryTime: serverTimestamp()` |
| ✅ | `qrController.js:122` writes `helper: helperName \|\| null` (maps body param `helperName` to firestore field `helper`) |
| ✅ | Socket.IO verifies token on handshake (prevents fake GPS) |
| ✅ | Socket.IO rejects `driverId` mismatch with verified UID |

**⚠️ Important correction**: The table above was updated to claim `status: "waiting"` was the fix — this is incorrect history. The current actual code at `qrController.js:129` writes `status: "queued"`. The correct interpretation is that the mobile app queries for `"queued"` so `"queued"` is correct. If you want `"waiting"` everywhere, you must change BOTH the backend write AND all mobile queries simultaneously.