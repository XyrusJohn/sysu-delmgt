# dashboard.js — Required Code Changes

> Apply these edits to `frontend/src/pages/dashboard.js` (the sidebar nav imports it from `./src/pages/dashboard.js`)
> **Status: ALL ITEMS COMPLETED** (2026-05-23)

---

## 1. Fix truckType URL Decode Bug (CRITICAL) ✅ DONE

Find the `openAssignModal` method. Add `decodeURIComponent` for `truckType`:

```js
openAssignModal(dispatchKey, truckType) {
  dispatchKey = decodeURIComponent(dispatchKey);
  truckType = decodeURIComponent(truckType || "");  // ← ADDED
  this.state.assignTarget = dispatchKey;
  this.state.requiredTruckType = truckType;
  // ... rest unchanged
}
```

**Impact**: Without this fix, truck types with special chars (spaces like "6-Wheeler") fail the queue filter silently and the modal shows empty drivers.

---

## 2. Uncomment Socket.IO for Live Map Markers ✅ DONE

### A. Uncomment the socket import — top of file:

```js
// Change FROM:
import {EVENTS, socket} from "../api/socket.js"; // [REALTIME] disabled until integration

// Change TO:
import {EVENTS, socket} from "../api/socket.js";
```

### B. Uncomment MapManager imports:

```js
import {
  initLeafletMap,
  switchMapTheme,
  updateMarker,    // ← ADDED
  focusOnLocation, // ← ADDED
  clearMarkers,     // ← ADDED
} from "../components/MapManager.js";
```

### C. Uncomment `_setupSocket()` call in `_startDataEngines()`:

```js
// Change FROM:
// this._setupSocket(); // [REALTIME] disabled

// Change TO:
this._setupSocket();
```

### D. Uncomment the entire `_setupSocket()` method body ✅ DONE

---

## 3. Fix Queue Sort to Use `joinedAt` as Fallback ✅ DONE

```js
onSnapshot(collection(db, "queue"), (snap) => {
  this.state.queue = snap.docs
    .map((doc) => ({id: doc.id, ...doc.data()}))
    .filter((q) => q.isAssigned === false)
    .sort((a, b) => {
      // Prefer entryTime, fall back to joinedAt, then to updatedAt
      const getTs = (d) =>
        d.entryTime?.toDate?.() ??
        d.joinedAt?.toDate?.() ??
        (d.updatedAt ? new Date(d.updatedAt) : new Date(0));
      return getTs(a) - getTs(b);
    });
  this._renderAll();
});
```

---

## 4. Build Dispatch Picker Modal for Fleet Queue Assign ✅ DONE

`openAssignModalForDriver` was a stub showing only an alert. Full implementation now in place:

- Opens `assignDriverModal` showing unassigned SAP dispatches filtered by truck type
- Sorts by planning date (oldest first = FIFO)
- On click of dispatch row → highlights selection, sets `assignTarget` and `selectedQueueDriverId`
- Confirm button activates → calls `_confirmFleetAssignment()`
- `_confirmFleetAssignment()` writes to `sap_assignments` and updates `queue/{driverId}` with `isAssigned: true`, `status: "loading"`

---

## 5. Fix `saveDriver()` to Write `isAssigned: false` for Queue Entries

The "Add Driver" form in `saveDriver()` creates/updates entries in `drivers` collection, NOT `queue` collection.

Queue entries are created by:
- Android app via QR scan → `POST /api/qr/scan` → backend writes to `queue` with correct schema
- The web dashboard Add Driver modal does NOT create queue entries

If there's a separate "Add to Queue" flow that writes to `queue` instead of `drivers`, ensure it sets:
- `isAssigned: false` — required for Fleet Queue filter
- `entryTime: serverTimestamp()` — required for FIFO sorting
- `status: "queued"` — ⚠️ AS-BUILT value (NOT "waiting" — backend writes `status: "queued"`, mobile app queries for `"queued"`)

**If using Firestore directly (not serverTimestamp)**:
```js
entryTime: firebase.firestore.FieldValue.serverTimestamp()
// NOT: entryTime: new Date().toISOString()  ← this breaks FIFO sort
```

---

## 6. Confirm `sapService.js` Subscription Uses `serverTimestamp` Compatible Date

```js
// This should already be correct — verify that entries written via
// the Assign Driver flow in dashboard use serverTimestamp():
confirmAssignment() {
  await setDoc(doc(db, "sap_assignments", dispatchKey), {
    driverId, driverName, truckPlate,
    assignedAt: serverTimestamp(), // ← this is correct
  });
  await updateDoc(doc(db, "queue", driverId), {
    isAssigned: true,
    status: "loading",
    updatedAt: serverTimestamp(), // ← this is correct
  });
}
```

All Firestore timestamp writes should use `serverTimestamp()` from `firebase/firestore`, NOT JavaScript `new Date()` — JavaScript Dates don't convert to Firestore Timestamps when `.toDate()` is called on them.