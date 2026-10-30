# SYSU App

SYSU App is the web dashboard, kiosk, and API for SYSU fleet operations. It supports shipment dispatch, driver queues, assignment workflows, and fleet tracking. The companion Android driver application and its API are maintained in [SYSU Go](../sysu-go/).

The web application is the operations view for staff. The App and Go backends share the `sysu_fleet_app` MySQL database; each service keeps its own API and Socket.IO endpoint. SAP OData remains an external source for shipment data. The dashboard's live map depends on the Go tracking service and working Socket.IO connections.

## Features

- Fleet dashboard with shipment, queue, assignment, and driver status views.
- Interactive map and live driver updates over Socket.IO.
- SAP OData shipment and dispatch-detail integration.
- MySQL-backed authentication, queue, assignment, driver, POD, and operational data workflows.
- Administrative system diagnostics and operational error reporting.

## Technology

- **Frontend:** React, Vite, Tailwind CSS, Leaflet, and Socket.IO client.
- **Backend:** Node.js, Express, Socket.IO, and MySQL.
- **Runtime:** Node.js 24.x, pinned by `.node-version`.

## Requirements

- Node.js 24.x and npm.
- MySQL 8 for local development.
- Network access to the configured SAP OData service for SAP-backed shipment data.

## Installation and local setup

The steps below use Windows PowerShell. Run them from the `sysu-app` repository root. Install Node.js 24.x, npm, and MySQL 8 first; make sure MySQL is running before starting either development server.

Install the root, backend, and frontend dependencies:

```powershell
npm ci
npm ci --prefix backend
npm ci --prefix frontend
```

Create the local environment files from the checked-in examples:

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (-not (Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
```

Configure `backend/.env` with the local MySQL connection, SAP OData URL, and allowed frontend origin. Configure `frontend/.env` with the App API and Socket.IO origins and the SYSU Go tracking origin. The examples list the supported variable names and safe placeholders. Local MySQL bootstrap settings are required by the backend and frontend `predev` setup hooks, which prepare the schema and limited runtime accounts.

| Setting | Purpose | Where to configure |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | App backend connection to MySQL; local examples use `sysu_fleet_app` | `backend/.env` |
| `DB_ADMIN_*` | Local development bootstrap only; do not place these in deployed service configuration | `backend/.env` for local setup |
| `SAP_URL` | SAP OData shipment source | `backend/.env` |
| `ALLOWED_ORIGINS` | Exact browser origins allowed to call the App API | `backend/.env` |
| `VITE_API_URL`, `VITE_SOCKET_URL` | Browser origins for the App API and Socket.IO service | `frontend/.env` |
| `VITE_DRIVER_TRACKING_URL`, `VITE_SYSU_GO_API_URL` | Browser origins for Go tracking and Go API access | `frontend/.env` |
| `VITE_RELEASE_TARGET` | `local`, `staging`, or `production` build target | `frontend/.env` |

The values above are names, not a complete configuration template. Read [backend/.env.example](backend/.env.example) and [frontend/.env.example](frontend/.env.example) for all recognized settings, including rate limits and readiness timeout. Set the Go backend's MySQL configuration to the same database before using driver workflows.

Do not place database credentials or other server secrets in `frontend/.env`; Vite variables are included in browser assets. For production, provide backend secrets through the host's secret-management mechanism and use public HTTPS origins.

## Run locally

Open two PowerShell terminals at the `sysu-app` repository root. Start one service in each terminal:

```powershell
# Terminal 1: API and Socket.IO
npm run dev --prefix backend
```

```powershell
# Terminal 2: web dashboard
npm run dev --prefix frontend
```

The default local addresses are:

- Frontend: `http://localhost:5173`
- SYSU App API and Socket.IO: `http://localhost:3000`
- SYSU Go API and Socket.IO: `http://localhost:3001`

If Vite selects a different port, add that exact origin to the backend `ALLOWED_ORIGINS` setting and restart the backend.

For a complete local workflow, start the separate SYSU Go API as described in its [README](../sysu-go/README.md). The App frontend can load without the Go API, but driver tracking and Go-backed requests require that service.

### macOS and Linux

The npm commands above are the same on macOS and Linux. Copy each environment example only when its local file does not already exist, then start each service in a separate terminal:

```sh
test -f backend/.env || cp backend/.env.example backend/.env
test -f frontend/.env || cp frontend/.env.example frontend/.env
npm run dev --prefix backend
npm run dev --prefix frontend
```

## Tests and builds

```sh
npm run lint
npm test --prefix backend
npm test --prefix frontend
npm run build:e2e --prefix frontend
```

The frontend production build writes static files to `frontend/hosting-dist/`:

```sh
npm run build --prefix frontend
```

Production builds require `VITE_RELEASE_TARGET=production` and public HTTPS values for the App API, App Socket.IO, and SYSU Go tracking endpoints. The E2E build uses its separate local target and output directory.

The test commands check local code behavior. They do not prove that SAP, live GPS, Android camera/POD, the company MySQL server, or an Apache WebSocket proxy works in the deployed environment. Use the [deployment guide](docs/container-deployment.md) and its read-only smoke check before relying on a release.

## Project structure

```text
backend/   Express API, MySQL configuration and migrations, and backend tests
frontend/  React dashboard, kiosk pages, map, and frontend tests
docs/      Setup, API, migration, deployment, and project-status documentation
```

## Troubleshooting

- **API does not start:** Confirm MySQL is running and the values in `backend/.env` are valid. Keep local `DB_ADMIN_*` bootstrap credentials out of deployed service configuration.
- **Browser requests are blocked:** Confirm the exact frontend origin is included in backend `ALLOWED_ORIGINS`, then restart the backend.
- **SAP shipment data is unavailable:** Check the configured `SAP_URL` and access to the SAP OData service.
- **Production build rejects endpoints:** Use `VITE_RELEASE_TARGET=production` with public HTTPS service origins; local HTTP origins are restricted to local development.
- **Historical data is missing:** Historical records from the previous storage system are not automatically imported into the local MySQL database. See the [MySQL migration runbook](docs/MIGRATION_RUNBOOK.md).
- **Live tracking is stale:** Check the Go API and both Socket.IO connections. Treat a disconnected map as stale until a new position is confirmed.
- **QR generation or scanning fails:** Confirm the App and Go APIs use the same MySQL database and that the QR token has not expired or been used. See the [backend API guide](docs/backend-api-guide.md) for the queue endpoints.

## Documentation

- [Documentation index](docs/README.md)
- [Frontend guide](docs/frontend-guide.md)
- [Backend API guide](docs/backend-api-guide.md)
- [System diagnostics](docs/system-diagnostics.md)
- [Container deployment notes](docs/container-deployment.md)
- [MySQL migration runbook](docs/MIGRATION_RUNBOOK.md)
- [Project status and acceptance notes](docs/project-status-summary.md)
