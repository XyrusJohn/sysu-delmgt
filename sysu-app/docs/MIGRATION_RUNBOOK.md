# Local MySQL migration status

SYSU App and SYSU Go use the shared loopback MySQL database for username accounts, role/session checks, QR admission, queue state, assignments, driver profiles, POD, settings, audit data, and live locations. App and Go maintain separate limited runtime database users. Socket.IO authentication uses revocable MySQL sessions; location and operational realtime topics read from MySQL-backed services.

Historical Firestore records were intentionally not imported, as approved by the owner. Accounts and operational records that existed only in Firestore are not present in this local database. New registrations and operational activity create MySQL records.

The schema and setup live under backend/src/migrations/mysql and backend/scripts/configure-local-mysql.js. SYSU Go uses that shared schema. Keep migration history intact; use new forward migrations for future schema changes.

## Local runtime

- MySQL: localhost:3306, schema sysu_fleet_app
- SYSU App API and Socket.IO: localhost:3000
- SYSU Go API and Socket.IO: localhost:3001
- SYSU App frontend: Vite defaults to localhost:5173
- Both Node packages require Node 24.x.
- SAP shipment operations use the separately configured SAP OData SAP_URL.

Run npm run dev from each app's backend/frontend directory in its own terminal. The local predev hook checks the local schema and limited runtime users. If Vite selects another port, add its exact origin to App ALLOWED_ORIGINS and restart the App backend.

## Current verification evidence (2026-10-27)

- SYSU App backend: 187/187 tests; frontend: 223/223 tests; Vite E2E build passed.
- SYSU Go backend: 168/168 tests, including MySQL-session Socket.IO handshake and tracking privacy; shipped-server Socket.IO integration: 6/6.
- SYSU Go emulator unit-test task passed after aligning registration validation with the shared 8-character minimum.
- The local CORS preflight for Vite ports 5173, 5174, and 5175 is allowed by the ignored App backend/.env.

These checks do not represent production deployment, physical-device GPS/camera behavior, or a historical Firestore data import.

### Driver Action shipment search

Before deploying the SYSU Go backend's Driver Action shipment search, apply migrations 017 and 018 from backend/src/migrations/mysql to the shared sysu_fleet_app database. They add indexed generated columns over existing activity JSON so staff can search from the beginning or end of a shipment number; they do not rewrite historical event records. Do not deploy the Go search handler before applying both migrations. Local development setup applies and verifies them automatically.

Before deploying the SYSU Go Driver Action retention/deletion changes, apply migrations 019 and 020 to the shared `sysu_fleet_app` database. Migration 019 removes automatic expiry and keeps existing session/event rows available; migration 020 allows an approved website removal request to delete the session and cascading action/location rows while retaining the request audit row. Do not deploy the new Go backend handlers before both migrations. Local development setup applies them automatically. The migration files were added but were not run against a database in this change.

Before deploying the HTTP idempotency changes in either service, apply migration 021 to the shared `sysu_fleet_app` database. Both SYSU App and SYSU Go use `app_api_idempotency`; retain the full history and do not configure automatic cleanup. Its processing rows include only the service, authenticated actor, request key, request fingerprint, and method/path needed for reconciliation; they do not store query strings, request bodies, or credentials. Local development setup applies the migration automatically. The migration file was added but was not run against any database in this change.
