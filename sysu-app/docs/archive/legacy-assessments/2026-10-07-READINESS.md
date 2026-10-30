# Historical readiness snapshot — 2026-10-07

This backlog is retained for audit history. Its architecture, issue status, counts, and suggested fixes reflect the date below and may no longer describe the current MySQL system. Use the [beta checklist](../../BETA_CHECKLIST.md), [fix tracker](../../FIX_TRACKER.md), current source, and recent test evidence for present decisions.

**Original branch:** `feature/admin-module-enhancements`

**Original scope:** SYSU App web and backend, with cross-app integration to SYSU Go Android.

**Recorded overall score:** 6.0/10; functional, with critical crash and integration gaps.

## Capabilities recorded as working at the time

- **FIFO dispatch:** Server-authoritative logic in `queueOrdering.js` with 17/17 tests passing.
- **SAP data:** Live fetch, a 60-second cache, and a 60-second timeout fallback.
- **Overview and tracking map:** Leaflet and OpenStreetMap with a dark monochrome CSS filter; no map API key error was reported.
- **POD and guard signature preview:** Read the historical `sap_assignments/{key}/pod_images/{obd}` subcollection and `guardSignatureBase64`.
- **Security and access control:** Helmet, rate limiters, a CORS allowlist, and Firebase Auth token checks on routes.
- **Scheduled tasks:** Jobs for QR tokens, queues, and incident cleanup.

These are historical observations, not verification of today's runtime.

## Critical blockers listed before release or pilot

### 1. `decideCancelAssignment` ReferenceError

- **File:** [`sapAssignmentController.js`](../../../backend/src/controllers/sapAssignmentController.js)
- **Recorded problem:** A typo used `remainingHShipments` instead of `remainingShipments`.
- **Recorded impact:** Approving a shipment cancellation could produce an HTTP 500 error.
- **Proposed fix:** Use `remainingShipments`.

### 2. Dashboard did not listen for `pod_updated`

- **Files:** [`dashboard.js`](../../../frontend/src/pages/dashboard.js), [`server.js`](../../../backend/src/server.js)
- **Recorded problem:** SYSU Go emitted `pod_updated` and the backend forwarded it, but the web dashboard had no matching listener.
- **Recorded impact:** Dispatchers had to refresh the page to see a new POD.
- **Proposed fix:** Add a dashboard listener that updates the shipment row when the event arrives.

### 3. Frontend lacked an `npm test` script

- **File:** [`frontend/package.json`](../../../frontend/package.json)
- **Recorded problem:** Five test files existed, but the package manifest had no `test` script.
- **Recorded impact:** Frontend regressions were not covered by the listed automated test command.
- **Proposed fix:** Configure a test runner and verify the suites.

### 4. Debug logs in `dashboard.js`

- **File:** [`dashboard.js`](../../../frontend/src/pages/dashboard.js)
- **Recorded problem:** Approximately 80 debug `console.log` statements were present in the production build.
- **Proposed fix:** Remove or guard development-only logging.

### 5. Content Security Policy was disabled

- **File:** [`server.js`](../../../backend/src/server.js)
- **Recorded problem:** Helmet was configured with `contentSecurityPolicy: false`.
- **Proposed fix:** Define and verify a CSP compatible with the then-current Firebase, map, Socket.IO, and font dependencies.

## High-priority items before unsupervised general availability

### 6. No integration tests for `sapAssignmentController.js`

- **File:** `backend/src/controllers/sapAssignmentController.js`
- **Recorded problem:** Roughly 520 lines of dispatch logic lacked integration coverage for driver assignment, FIFO override approval, and cancellation.
- **Proposed fix:** Add integration tests with a fake Firestore implementation and the Node test runner.

### 7. No dedicated error monitoring service

- **Recorded problem:** The review did not find production observability for uncaught exceptions.
- **Proposed fix at the time:** Integrate Sentry for backend and frontend using the then-current deployment environment.

### 8. Missing empty and error states

- **Recorded problem:** Some panels appeared blank when shipment data was empty or a Firestore/SAP request failed.
- **Proposed fix:** Show clear warnings and empty-state components.

## Technical debt recorded at the time

### 9. Large `dashboard.js`

- **Recorded problem:** Approximately 7,390 lines contained views, socket listeners, and modals together.
- **Proposed fix:** Split the file into focused components, preserving behavior.

### 10. Two Socket.IO server connections

- **Recorded problem:** The web app connected to both the SYSU App and SYSU Go Socket.IO services.
- **Proposed fix:** Document the responsibilities of each connection or evaluate a unified gateway.

## Original suggested work order

1. Correct the cancellation typo.
2. Connect the dashboard's `pod_updated` listener.
3. Remove or guard debug logging.
4. Configure and verify CSP headers.
5. Add the frontend test script and runner.
6. Add dispatch controller integration tests.

This order is a historical proposal and is not a current release plan.

## Related archived assessments

- [SYSU Go bug backlog](../../../../sysu-go/docs/archive/legacy-assessments/2026-10-07-TODO_BUGS.md)
- [SYSU Go assessment](../../../../sysu-go/docs/archive/legacy-assessments/2026-10-07-SYSU_GO_ASSESSMENT.md)
- [Cross-app testing assessment](2026-10-07-CROSS_APP_TESTING_ASSESSMENT.md)
