# SYSU App frontend guide

The SYSU App frontend serves the staff dashboard and kiosk. It displays shipment and queue information, dispatch assignments, driver tracking, and system diagnostics. React and Vite build the browser application; the Express API and Socket.IO service provide authenticated data and live updates. MySQL is the backend source of truth.

## Prerequisites and installation

Use Node.js 24.x and npm, as declared in [`frontend/package.json`](../frontend/package.json). Install dependencies from the repository root with `npm ci` and `npm ci --prefix frontend`. The backend has its own dependencies and must be started separately; see the [project setup guide](../README.md).

On Windows PowerShell, create a local configuration file without overwriting an existing one:

```powershell
if (-not (Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
```

On macOS or Linux:

```sh
test -f frontend/.env || cp frontend/.env.example frontend/.env
```

The backend and frontend `predev` scripts invoke `backend/scripts/configure-local-mysql.js`; local MySQL bootstrap settings must be configured before starting development servers. Read the checked-in environment examples for the supported variable names.

## Browser configuration

`frontend/.env.example` defines `VITE_RELEASE_TARGET`, the App API and Socket.IO origins (`VITE_API_URL`, `VITE_SOCKET_URL`), and the Go tracking/API origins (`VITE_DRIVER_TRACKING_URL`, `VITE_SYSU_GO_API_URL`). Local defaults use Vite on `http://localhost:5173`, the App backend on `http://localhost:3000`, and the Go backend on `http://localhost:3001`. If Vite selects a different port, add its exact origin to the App backend's `ALLOWED_ORIGINS` and restart the backend.

Only browser-safe values belong in `frontend/.env`. Vite embeds its exposed variables in the built assets; keep database passwords, SAP credentials, and server secrets in backend configuration. Endpoint validation is implemented in [`src/api/releaseConfig.js`](../frontend/src/api/releaseConfig.js). A production build requires `VITE_RELEASE_TARGET=production` and public HTTPS service origins.

## Development and build

Run these commands from the repository root in separate terminals:

```sh
npm run dev --prefix backend
npm run dev --prefix frontend
```

The same npm commands work in PowerShell, macOS, and Linux shells. The frontend `predev` hook prepares local MySQL configuration; start MySQL before the development commands. For a production static bundle, run `npm run build --prefix frontend` with valid production environment values. Vite writes the output to `frontend/hosting-dist/`. The dedicated local end-to-end artifact uses `npm run build:e2e --prefix frontend` and writes to `frontend/e2e-dist/`.

The static bundle can be served by Apache or another static web server. The App and Go Node.js APIs remain separate services. See [container deployment](container-deployment.md) for hosting boundaries and a read-only deployment smoke check.

## Authentication and live updates

[`src/api/authService.js`](../frontend/src/api/authService.js) calls the MySQL username/password API for registration, sign-in, profile and session reads, and sign-out. The backend decides whether an account can access a protected operation. [`src/api/socket.js`](../frontend/src/api/socket.js) and [`src/api/realtimeService.js`](../frontend/src/api/realtimeService.js) manage authenticated Socket.IO connections and subscriptions for queues, assignments, profiles, reference data, and tracking. A disconnected socket means live data may be stale until the connection returns.

The active frontend setup does not use the Firebase client SDK, Firestore rules, or Firebase deployment configuration. Historical documents may still describe retired integrations; use the current source and [backend API guide](backend-api-guide.md) when checking behavior.

## Verification

```sh
npm test --prefix frontend
npm run lint --prefix frontend
npm run build:e2e --prefix frontend
```

Vitest runs the frontend unit and regression tests. The production build additionally checks release-target and endpoint configuration. A successful unit test or build does not establish that SAP, MySQL, Socket.IO, Android GPS, or the company proxy works in a deployed environment. The retired Firebase emulator harness has not been replaced by a live-MySQL Playwright suite.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser API calls are blocked | Confirm the exact frontend origin in backend `ALLOWED_ORIGINS`, then restart the backend. |
| A production build rejects endpoints | Set `VITE_RELEASE_TARGET=production` and supply public HTTPS origins for the required App and Go services. |
| Live data stops updating | Check the Socket.IO connection indicator and the backend/proxy connection; refresh after the connection has recovered. |
| SAP-backed shipments are missing | Check the App backend's SAP configuration and service reachability. The frontend cannot repair an unavailable SAP source. |

For operational errors and safe troubleshooting instructions, see [system diagnostics](system-diagnostics.md). For local database setup and historical-data limitations, see the [MySQL migration runbook](MIGRATION_RUNBOOK.md).
