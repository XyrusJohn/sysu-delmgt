# SYSU App Backend API Guide

## Architecture

The App backend is Node.js 24 and Express. MySQL is the source of truth for accounts and operational records. Username sessions authenticate both HTTP and Socket.IO clients. The Go backend uses the same MySQL schema for driver workflows. Socket.IO carries live queue, assignment, role, location, and master-data updates.

SAP shipment data remains an external OData read through SAP_URL; assignment writes are stored in MySQL after the backend validates the current SAP dispatch. This SAP connection is separate from MySQL persistence.

## Authentication

The username endpoints are mounted at /api/auth/mysql:

- POST /username/register
- POST /username/login
- GET /session
- PATCH /profile (App web client)
- POST /logout

Registration creates a pending, inactive account. A privileged administrator must grant an active role before protected workflows are available. Bearer session tokens are checked against MySQL; password hashes and token hashes are stored separately.

The legacy /api/auth/check endpoint is protected by the same MySQL session middleware. Google sign-in and Firebase Auth are not supported.

## Operational APIs

Routes are mounted by backend/src/server.js. The main groups are:

| Prefix | Responsibility |
| --- | --- |
| /api/sap | SAP shipment reads and MySQL-backed dispatch assignment/governance |
| /api/users | Role changes and account administration |
| /api/qr | QR admission, queue reads, and queue status |
| /api/drivers | Driver profiles and requirements |
| /api/admin | Guard, trucking-company, and warehouse administration |
| /api/system-errors | SQL-backed application diagnostics |

Route files and Zod schemas are authoritative for request and response details.

## Socket.IO

Connect with the MySQL session token in the Socket.IO auth.token field. Subscriptions are server-authorized and delivered through realtime:state; clients must unsubscribe or disconnect when their view closes.

The App backend serves SQL-backed securityGuards, truckCompanies, users, drivers, queue, locations, assignments, overrideRequests, and cancelRequests topics. GPS updates from SYSU Go are persisted to MySQL before map events are broadcast. Unsupported topics fail closed.

## Local development

1. Start local MySQL and confirm the ignored backend/.env points to loopback and the sysu_fleet_app database.
2. Set SAP_URL in backend/.env if the local workflow needs live SAP shipments.
3. From separate backend/ and frontend/ terminals, run npm run dev.

The default addresses are App API/Socket.IO http://localhost:3000 and Vite http://localhost:5173. If Vite selects another port, add that exact origin to ALLOWED_ORIGINS in backend/.env and restart the backend.

Do not copy local credentials into tracked files. The SQL schema is maintained in backend/src/migrations/mysql; local setup is handled by backend/scripts/configure-local-mysql.js. Historical Firestore records were intentionally not imported.

## Source references

- Server wiring: ../backend/src/server.js
- MySQL authentication service: ../backend/src/services/mysqlAuthService.js
- Realtime subscriptions: ../backend/src/services/realtimeSubscriptions.js
- MySQL migrations: ../backend/src/migrations/mysql
- Local migration runbook: MIGRATION_RUNBOOK.md
