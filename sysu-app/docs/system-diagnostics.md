# System diagnostics

## Coverage

The admin System diagnostics view reads `app_system_error_logs`. SYSU App records browser failures and server responses with HTTP status 5xx. SYSU Go records authenticated mobile operation failures and its server's HTTP 5xx responses. Go mobile reports are accepted at `POST /api/system-errors/report`; the App admin API lists and resolves the shared log rows.

Both backends must use the same MySQL database for Go events to appear in the App admin view. Local development provisions the shared diagnostics table through SYSU App migration `015_system_error_logs.sql`. Production database sharing and migration status must be verified before relying on a unified log.

SYSU Go's Profile screen includes **System diagnostics**. It runs read-only checks for the cached device network state, Go API liveness, Go MySQL readiness, current Go socket state, and presence of a local session token (the report request validates the session with the backend). The run is submitted to the Go backend and stored as a separate `mobile_diagnostic_run` record in the existing shared table. SYSU App admins see one latest-run summary per account, with search, an attention/review filter, expandable prior-run history, and pagination for larger fleets. **Refresh** fetches the latest summaries. When a run is saved, Go emits a minimal Socket.IO event to its admin/super-admin diagnostics room; the App dashboard fetches that account's current run immediately. The event carries no diagnostic checks or request data. Admins can delete one selected run from its summary or history after confirming; the backend only deletes rows whose event code is `mobile_diagnostic_run`. A run cannot be saved when the Go API is unavailable, in which case SYSU Go still shows the local check results and explains that web persistence failed.

Ordinary authenticated mobile operation reports are stored in a bounded, account-scoped local queue when delivery fails. Android JobScheduler persists a network-constrained retry across process restarts and device reboots; a session refresh or connectivity recovery also triggers delivery. The queue keeps at most 20 distinct account/operation/error combinations and may discard the oldest item when full. Successful recovery is retained until its server request succeeds. Delivery is at least once if the process stops after server acceptance but before the local queue update is committed.

## Manual diagnostics run

The **Start diagnostics** action performs bounded, read-only checks:

- SYSU App readiness at `/health/ready`.
- SYSU Go API liveness at `/api/health` and database readiness at `/api/health/ready`.
- Current SYSU App and (if initialized) SYSU Go Socket.IO connection states.

The Go mobile run applies the same separate liveness and database readiness checks. Each readiness endpoint verifies a successful read-only `SELECT 1` while configured for the expected `sysu_fleet_app` schema. This confirms each service can reach its configured database; it cannot prove that two separate production hosts resolve to the same MySQL instance. The local development services were checked directly and returned the same MySQL server UUID and schema.

It reports HTTP status and request reference where available, displays elapsed time, and offers a JSON download. It does not start SAP sync, update assignments or trips, request GPS access, or change tracking state.

## Stored context and privacy

Reports may include event category, operation/stage, error class, allowlisted HTTP status, app version, a reduced source frame, timestamp, and correlation reference. Server normalization discards unapproved fields. Request/response bodies, exception messages, auth tokens, exact locations, POD content, and full stack traces are not stored.

Report endpoints require an authenticated active account with an approved reporting role and are rate limited. Log listing, resolution, and deletion are restricted to admins in SYSU App. Incident deletion is available only for resolved rows; mobile run deletion applies only to the selected `mobile_diagnostic_run` row. Both require explicit UI confirmation and permanently remove one row; there is no bulk-delete operation. Deletion notifies connected admin views so they can refresh.

Successful recovery signals automatically resolve allowlisted failures for the same authenticated account and exact operation. This currently covers browser realtime reconnects (only after both initialized App and Go live sockets are connected), App/Go API and database health checks, SAP shipment sync, SAP dispatch-detail fetches, and Go mobile realtime reconnects. Matching repeat failures while an incident remains open are counted on the existing row with a last-seen timestamp instead of creating another row. Auto-resolved incidents remain in **Resolved**; they are not deleted. Other operation failures remain open until an explicit recovery signal is added or an admin resolves them.

## Dispatcher guidance

Each row includes a concise explanation and recommended next action derived only from normalized fields such as operation, source, failure code, and HTTP status. Guidance is operational help, not proof that the underlying workflow succeeded. Dispatchers should verify current trip/assignment state before retrying or escalating and include the request reference when contacting engineering. Diagnostic records never expose request bodies, credentials, stack traces, or exception messages.

## Coverage limits

Diagnostics can only record instrumented failures and failures reaching the server. They do not capture every handled exception, failures before an authenticated session, device/OS logs, SAP backend internals, or the mobile device's GPS/sensor state. The web run checks endpoint reachability and current socket state; it is not a complete end-to-end workflow test. Use the event request reference with backend logs and browser/device logs when investigating a report.
