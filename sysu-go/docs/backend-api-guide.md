# SYSU Go backend API guide

The Go backend is a Node.js Express and Socket.IO service for the driver application. It loads `backend/.env`, requires `AUTH_BACKEND=mysql`, and uses the shared `sysu_fleet_app` MySQL schema for sessions and operational records. Local MySQL configuration accepts loopback hosts; see [migration status](mysql-migration-status.md) before planning a container or remote-host deployment.

## HTTP routes

This table summarizes purpose and access. The route files in `backend/routes/` and services in `backend/services/` define exact validation and response contracts.

| Method and path | Purpose and access |
| --- | --- |
| `GET /api/health` | Process liveness |
| `GET /api/health/ready` | Read-only database readiness; returns 503 if configured MySQL cannot be reached |
| `POST /api/auth/mysql/username/register` | Username and password registration |
| `POST /api/auth/mysql/username/login` | Username and password sign-in |
| `POST /api/auth/mysql/logout` | Revoke the current session |
| `POST /api/qr/generate` | Issue a QR token for an active generator or administrator |
| `GET /api/qr/verify` | Public, read-only QR verification |
| `POST /api/qr/scan` | Admit an active driver to the queue through a MySQL transaction |
| `GET /api/qr/queue` | Read queue data for authorized staff |
| `GET /api/qr/own-position` | Read the signed-in driver's queue position |
| `POST /api/trip/register` | Register a driver-owned trip |
| `POST /api/trip/return` | Advance the return-to-base workflow |
| `GET`, `POST /api/driver/status` | Read or update authorized driver status |
| `POST /api/pod/{shipmentId}/{obdNumber}` | Record POD progress for a driver-owned assignment |
| `POST /api/pod/{shipmentId}/group` | Record grouped POD progress for one destination |
| `GET /api/warehouse/base` | Read authenticated warehouse-base settings |

The retired duplicate SAP route returns HTTP 410. SYSU App owns SAP integration.

## Authentication and request safety

Protected HTTP routes require a valid MySQL-backed session and permitted role. Mutating routes use request idempotency handling; a client retrying an uncertain submission must preserve its request key. A timeout alone does not prove that the server rejected an action. Endpoint-specific retry behavior is defined in route and service code.

The API has a shared request-rate limit and stricter authentication and diagnostics limits. Reverse-proxy deployments must configure the trusted proxy chain deliberately so the backend identifies client addresses correctly. See [container deployment status](container-deployment.md).

## Socket.IO and location

Socket.IO verifies identity at connection and rechecks protected operations. Driver GPS and lifecycle messages are bounded and validated against MySQL ownership before authorized staff rooms receive updates. The backend persists accepted location records. A client-side send or reconnect does not prove that a record was saved. See the [Android guide](android-app-guide.md) for phone behavior.

## Data ownership and local operation

Authentication, profiles, queues, assignments, POD, GPS, settings, and audit records use the shared `sysu_fleet_app` schema. Schema migrations are owned by `sysu-app/backend/src/migrations/mysql`. The two services use separate limited MySQL runtime accounts. Active runtime has no Firebase or Firestore emulator dependency.

Keep credentials in ignored local environment files or the approved host secret store. For local development, configure `backend/.env`, start MySQL, and run `npm run dev` from the Go repository root. Android emulators reach the workstation API at `10.0.2.2:3001`.

## Checks and deployment limits

Run `npm test` from `backend/` for the backend suite. `/api/health/ready` verifies database reachability, not a complete phone-to-web journey. Physical-device behavior, Apache WebSocket proxying, and company-host deployment require separate verification.
