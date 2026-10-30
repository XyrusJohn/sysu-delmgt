# Spec: Add sapDocId to driver_moving Socket Event

**Date:** 2026-06-05
**Status:** Implemented (commit 0a83c92)

## Context

sysu-app's dispatch dashboard needs to display live driver markers on a Leaflet/OpenStreetMap map with shipment info (shipment number + plate number) alongside each marker.

The existing `driver_moving` Socket.IO event emitted by `sysu-go` already includes `lat`, `lng`, `driverId` (Firebase UID), and `name`. However, **shipment number and plate number** are stored in `sap_assignments/<docId>` — a document ID sysu-app does not have from the socket event alone.

To get shipment data without `sapDocId`, sysu-app would need a multi-step Firestore join on **every location update (~20s per driver)**:
```
driver_moving.driverId (FirebaseUID)
  → query queue WHERE driverId = FirebaseUID
  → get queueDocId
  → query sap_assignments WHERE driverId = queueDocId AND tripStatus = "in_transit"
  → get shipmentNumber, truckPlate
```

At 20 drivers × 3 reads per update = **60 Firestore reads per 20 seconds** (~10,800/day). Unacceptable.

## Decision

Add `sapDocId` (the `sap_assignments` document ID) to the `driver_moving` payload.

sysu-app can now do a **single direct lookup**:
```
Firestore → sap_assignments/<sapDocId> → shipmentNumber, truckPlate, etc.
```

### Multi-active-trip concern

sysu-app asked if drivers could have multiple active `sap_assignments` docs simultaneously.

**No.** The `sysu-go` app enforces single active trip via:
1. `loadTripDataFromQueue()` queries `tripStatus = "in_transit"` (limit 1)
2. `TransitActivity.startTrip()` is gated by `sessionManager.isTripActive()` in MainActivity

`sapDocId` is always a single string or `null`. No array needed.

## Implementation

### Files Changed

**1. `SocketManager.kt`**
- Updated `emitDriverMoving(lat, lng, sapDocId: String?, status)`
- Includes `sapDocId` in JSON payload (can be `null` if trip not started yet)

**2. `LocationServices.kt`**
- Reads `sap_doc_id` from SharedPreferences (same `driver_session` prefs that `SessionManager` writes to)
- Passes `sapDocId` to `SocketManager.emitDriverMoving()`

### Data Flow

```
TransitActivity.startTrip()
  → sessionManager.saveCurrentSapDocId(sapDocId)    [SharedPreferences: "sap_doc_id"]

LocationServices.handleLocation()   [every ≥30m movement, every ≥20s]
  → prefs.getString("sap_doc_id")   → sapDocId
  → SocketManager.emitDriverMoving(lat, lng, sapDocId, "online")
    → Socket.IO emit: { driverId, sapDocId, lat, lng, status, name }
```

### SharedPreferences Bridge

| Component | Prefs file | Read/Write |
|-----------|-----------|------------|
| `SessionManager` (TransitActivity) | `driver_session` | **Write** `sap_doc_id` on trip start |
| `LocationServices` | `driver_session` | **Read** `sap_doc_id` on each location emit |

Both use `MODE_PRIVATE` on the same app package — fully accessible across components.

## Final driver_moving Payload

```json
{
  "driverId": "<Firebase UID>",
  "sapDocId": "0010128489",
  "lat": 14.599512,
  "lng": 120.907921,
  "status": "online",
  "name": "Driver Name"
}
```

- `sapDocId`: the `sap_assignments` document ID. `null` if trip not yet started (before driver presses START TRIP).
- sysu-app should handle `sapDocId: null` gracefully — show marker without shipment details.

## sysu-app Firestore Integration

```javascript
// On driver_moving event:
socket.on('driver_moving', ({ driverId, sapDocId, lat, lng, status, name }) => {
  if (!sapDocId) {
    // No active trip — show marker without shipment data
    updateMarker(driverId, lat, lng, name, null);
    return;
  }

  // Direct document lookup — single read per update
  db.collection('sap_assignments').doc(sapDocId).get()
    .then(doc => {
      const data = doc.data();
      const shipmentNumber = doc.id;       // Firestore doc ID IS the shipment number
      const plateNumber = data.truckPlate; // or data.plateNumber etc.
      updateMarker(driverId, lat, lng, name, { shipmentNumber, plateNumber });
    });
});
```

## Backwards Compatibility

If sysu-app hasn't updated yet and receives `sapDocId: undefined` (old payload without the field), their socket listener will just see `sapDocId: undefined` — they can handle it the same as `null` for now. No breaking change.

## Related Docs

- Previous prompt for sysu-app: see Slack/message thread 2026-06-05