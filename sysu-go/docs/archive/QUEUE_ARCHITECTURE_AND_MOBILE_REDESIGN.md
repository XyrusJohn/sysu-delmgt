# SYSU Go mobile and queue architecture proposal

> Historical proposal dated 2026-08-25. This document records a Firestore-era design and checklist. Its original release-ready label was an aspiration, not a verified current architecture or production sign-off. The active system subsequently moved to shared MySQL. Consult current source, migration notes, and the [fix tracker](../FIX_TRACKER.md) before using any recommendation here.

## 1. Proposed queue and assignment model

The proposal was to place an `assignedShipments` array directly inside each active `queue/{queueDocId}` document. The array would show the driver's load and the status of each shipment. If any shipment entered `in_transit`, the driver would stop appearing as available for another assignment. `drivers/{uid}` would keep stable profile information only.

| Expected benefit | Identified trade-off |
| --- | --- |
| Queue and dispatch views could read a driver's load from one queue document instead of joining queue and assignment collections. | Shipment status changes would have to update both the queue array and the authoritative `sap_assignments` document atomically. |
| Availability could use `activeShipmentsCount` and shipment states instead of a permanent `isAssigned: true` flag. | A disconnect during assignment could duplicate an array entry unless the operation was transactional. |
| Mobile and web could subscribe to one queue snapshot for a driver's current load. | Firestore documents had a 1 MB limit; the proposal assumed approximately 1–10 shipments per truck. |

The original assessment rated the proposal 9.5/10 and expected it to reduce cross-application desynchronization. That rating was a design opinion, not a measured result.

## 2. Firestore collection responsibilities proposed at the time

- `drivers/{uid}`: driver name, contact details, vehicle details, and other stable profile data. Do not mirror temporary queue or trip state here.
- `queue/{queueDocId}`: one active trip session with capacity, assigned shipments, overall trip state, and guard verification. A completed queue session should not overwrite the stable driver profile.

The proposed queue document contained the following fields and example values:

```json
{
  "id": "queue_doc_12345",
  "driverId": "firebase_auth_uid_abc",
  "driverName": "Example Driver",
  "driverPhone": "+639000000000",
  "plateNumber": "ABC-1234",
  "truckType": "6-Wheeler",
  "truckCompany": "Example Logistics",
  "entryTime": "2026-08-25T06:00:00.000Z",
  "status": "waiting",
  "isFull": false,
  "activeShipmentsCount": 2,
  "assignedShipments": [
    {
      "dispatchKey": "DSP-20260825-001",
      "obdNumber": "80012345",
      "customerName": "Example Customer A",
      "tripStatus": "loaded",
      "assignedAt": "2026-08-25T07:15:00.000Z"
    },
    {
      "dispatchKey": "DSP-20260825-002",
      "obdNumber": "80012346",
      "customerName": "Example Customer B",
      "tripStatus": "loading",
      "assignedAt": "2026-08-25T07:30:00.000Z"
    }
  ],
  "overallTripStatus": "loading",
  "guardVerified": false,
  "updatedAt": "2026-08-25T07:30:00.000Z"
}
```

The proposed profile document held stable identity and vehicle fields such as `uid`, `name`, `phone`, `licenseNumber`, `truckType`, `plateNumber`, `truckCompany`, `createdAt`, and `updatedAt`. The design called for retiring dynamic `DriverShipmentSync.kt` mirroring into the profile document.

## 3. Consolidated load and multi-stop lifecycle

1. On **Start Trip** or warehouse-gate exit, update every assigned shipment to `in_transit`, set `overallTripStatus` to `in_transit`, and show each OBD as traveling in the dispatch view.
2. At the first stop, mark only OBD 1 complete after unloading and POD capture; leave OBDs 2 and 3 `in_transit`.
3. At the second stop, mark OBD 2 complete; leave OBD 3 `in_transit`.
4. At the final stop, mark OBD 3 complete. Enable the **Return to Base** action only after all required OBDs are complete.

## 4. Proposed live-map marker cleanup

The proposal tried to remove a completed driver's marker immediately without requiring a browser reload:

- Mobile would emit `update_status` with `status: "completed"` and stop `LocationServices` GPS updates after the trip or return-to-base flow completed.
- Web would remove the marker on the Socket.IO `update_status` event. The Firestore-era fallback would also remove it when the assignment snapshot changed to completed.

These were proposed dual triggers. Current MySQL and Socket.IO code must be checked before applying them; the Firestore snapshot path is historical.

## 5. Original implementation checklist

The checkbox state below reflects the original document only. It is not a current implementation audit.

### SYSU App backend

- [ ] **B.1 Assignment transaction:** Append a new assignment to the queue document's `assignedShipments` array atomically and allow another assignment while the driver is assigned/loading but not full.
- [ ] **B.2 Status cascade:** When a trip starts, move all in-flight assignment documents for that driver to `tripStatus: "in_transit"` together.
- [ ] **B.3 Socket capacity event:** Add a `driver_is_full` handler for real-time queue capacity changes.

### SYSU App frontend

- [ ] **F.1 Assignment modal:** Decode `truckType`; hide a driver with an in-transit shipment or `isFull === true`, while allowing additional OBDs during assigned/loading/loaded states when not full.
- [ ] **F.2 Map marker:** Remove a completed driver marker from both the Socket.IO event and the then-proposed Firestore snapshot handler.
- [ ] **F.3 QR generator:** Remove the hardcoded `STATIC_TOKEN` boot value and show a spinner until the first dynamic token arrives.

### SYSU Go Android app

- [x] **M.1 Profile separation:** Stop dynamic mirroring into `drivers/{uid}`; keep it as profile data. The original document marked `GoApplication.kt` done.
- [x] **M.2 Queue listener:** Bind active shipment cards to `queue/{queueDocId}.assignedShipments` with an assignment sync fallback. Originally marked done.
- [x] **M.3 Status strings:** Replace `fully_loaded` with `loaded` in the cited trip/assignment UI. Originally marked done.
- [x] **M.4 Trip start:** Update all assigned OBDs to `in_transit` when starting a trip. Originally marked done.
- [x] **M.5 Socket gateway:** Use one verified server URL instead of two separate socket connections. Originally marked done.
- [x] **M.6 Multi-stop POD:** Complete only the relevant OBD on capture and enable return when all required OBDs are complete. Originally marked done.
- [x] **M.7 Trip completion:** Emit `update_status: "completed"` before stopping GPS so web can remove the marker. Originally marked done.

## 6. Original execution order

1. Update the backend assignment transaction and capacity rule.
2. Update the web assignment modal and live-marker handling.
3. Update the Android queue and shipment synchronization.

The original roadmap did not include a verified deployment result. Current source and dated test evidence take precedence over this historical plan.
