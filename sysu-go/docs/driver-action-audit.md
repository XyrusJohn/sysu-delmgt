# Driver Action audit

SYSU Go records an operational activity timeline after the driver acknowledges the in-app notice. Events are buffered in a private SQLite outbox and synchronized over authenticated Socket.IO. Existing queue, shipment, and live-location operations remain authoritative; audit capture is best-effort and must not block those actions.

## Event and access contract

- Mobile batches use `driver_actions:sync` with a session ID and ordered event IDs/sequences. The server derives driver identity from the authenticated socket, validates bounded event/location fields, and ACKs accepted event IDs. The client retains unacknowledged records for retry.
- Audit writes are confined to `driver_action_sessions` and `driver_action_events`; they do not create or mutate canonical `drivers` profile documents.
- Authorized staff request paginated history with `driver_actions:get_sessions` and `driver_actions:get_events`. Reads are limited to `fleet_manager`, `admin`, and `super_admin`; driver identity is never accepted from a driver's event payload.
- Each logical driver session has one `driver_action_sessions` document; ordered action and route events are stored as separate `driver_action_events` documents linked by the same `sessionId`. SYSU App groups those child events into one expandable session row. Firestore client rules deny direct client access; backend Admin SDK owns persistence.
- Screen opens, QR scans, registration/queue, assignments, loading/verification (including cancellations), trip selection/start, per-OBD unloading/POD, delivery completion, return-to-base prompts/actions, warehouse arrival, and final session completion are recorded with best-effort GPS. Action durations are either captured explicitly or labeled as time since the prior action; sparse route samples are excluded from lifecycle duration calculations.
- The map uses generic clickable markers for located events and a polyline from `route_point` events. Per-OBD unloading/POD events include the OBD reference in allowlisted metadata. Events without a GPS fix remain visible in the timeline with their unavailable location state but have no map marker.
- The `arrived_at_warehouse` action is recorded only from the existing geofence-gated final confirmation flow. After the trip/queue writes succeed, the client appends `session_completed` with the session duration and closes its local SQLite session. The server still treats `arrived_at_warehouse` as terminal for older clients and accepts the final marker from updated clients after that arrival has already synchronized.
- SQLite synchronizes opportunistically when authenticated Socket.IO is available; offline events remain ordered in the outbox and retry after reconnection. The client does not wait until trip completion to upload online actions, so dispatch can review an active session as it arrives.

## Session review and removal

- SYSU App loads plotted events only when a dispatcher selects **Load plot** for an individual session. Loading, loaded, and retry states are isolated per row; a successful result is cached for the view, and only the selected session's route is drawn.
- Staff may request removal of a session with a reason. Only `admin` and `super_admin` may decide; the requester cannot approve their own request. Approval soft-hides the session from normal history reads while retaining the session and event documents for audit. A denied request clears the pending marker so staff can submit a new request.
- Pending review requests are stored in `driverActionDeleteRequests`; the `status` + `requestedAt` composite index in `firestore.indexes.json` is required for the admin queue.

## Data handling and limitations

- Events may include precise device-reported coordinates, accuracy, timestamps, shipment references, and action outcomes. Collection begins only after the driver acknowledges the notice. Do not treat acknowledgement as a substitute for the organization’s privacy/legal review.
- Synced server records are retained for up to 90 days after receipt. Device events older than 90 days are terminally acknowledged as expired and removed from the local outbox so they cannot retry forever. Firestore TTL is not required for correctness because a scheduled cleanup deletes expired event and session documents.
- Reported GPS history is useful for operational review but does not prove a device location was authentic; rooted devices and mock-location tooling can falsify client GPS. It does not replace server-side geofence enforcement.
- If GPS permission/fix is unavailable, the action is retained with an explicit unavailable/permission-denied location state. The feature does not delay dispatch or shipment workflows while reconnecting.

## Deployment and verification

Deploy the SYSU Go backend together with the composite indexes in `firestore.indexes.json` before enabling staff history reads in production. Confirm that the hosting environment runs the backend cleanup scheduler and has the existing Admin SDK Firestore permissions. Do not deploy Firebase credentials to the Android client.

The Android instrumentation test `app/src/androidTest/java/com/sysu/go/audit/DriverActionOutboxTest.kt` requires an emulator/device. Automated unit/backend tests do not replace physical-device checks for consent, offline buffering/reconnect, permission-denied location, app process death, multi-shipment lifecycle, and geofenced warehouse arrival.
