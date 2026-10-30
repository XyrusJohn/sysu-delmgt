# Historical snapshot — do not use as current test or release status

This assessment is retained for audit history. It was superseded by the current [beta checklist](../../BETA_CHECKLIST.md) and [fix tracker](../../FIX_TRACKER.md); verify every claim against current code and test evidence.

# SYSU-App & Cross-App Integration Testing & Technical Assessment
> Date: 2026-10-07 | Branch: `feature/admin-module-enhancements`
> Assessment Focus: Cross-app contract (`sysu-go` <-> `sysu-app`), test coverage, backend controller reliability, runtime errors & bugs.

---

## Overall System Score: 6/10

| Component | Status | Notes |
|---|---|---|
| **FIFO & Queue Assignment Engine** | ⚠️ Minor Crash Bug Found | Controller has runtime reference error in `decideCancelAssignment` |
| **Backend Unit Tests** | 8/10 (17/17 passing) | Unit tests cover `queueOrdering` & `idGenerator`, but **0 integration tests for controllers** |
| **Frontend Test Coverage** | 🔴 0% (CI/npm test broken) | `npm test` script is completely missing from `frontend/package.json` |
| **sysu-go <-> sysu-app Socket Flow** | ⚠️ Gap in POD updates | `pod_updated` socket event broadcast by backend, but dashboard UI never handles it |
| **Driver Identity Contract** | 8/10 (Mostly Consistent) | `driverId` is normalized to Auth UID, but fallback lookup logic exists for queue doc IDs |
| **Code Hygiene** | 🟡 80+ Console logs | Monolithic `dashboard.js` (7,390 lines) |

---

## 🔴 CRITICAL BUGS FOUND (Must Fix Immediately)

### 1. [CRITICAL BUG] ReferenceError crash in `decideCancelAssignment`
- **Location**: `backend/src/controllers/sapAssignmentController.js` (Line 445)
- **Problem**:
  ```javascript
  tx.update(queueDoc.ref, {
      assignedShipments: remainingHShipments, // ❌ Typo: "remainingHShipments" is not defined!
      activeShipmentsCount: remainingShipments.length,
      ...
  });
  ```
  Variable `remainingHShipments` does not exist (`remainingShipments` is the defined variable).
- **Impact**: Any admin attempting to approve a shipment cancellation request will trigger an unhandled 500 internal server error and transaction failure (`ReferenceError: remainingHShipments is not defined`).
- **Fix**: Change `remainingHShipments` to `remainingShipments`.

---

### 2. [INTEGRATION BUG] `pod_updated` Event Missing Listener in `dashboard.js`
- **Contract Flow**:
  1. Driver captures POD in `sysu-go` (`QueueDetailsActivity.kt` / `GeneralTrackingActivity.kt`).
  2. `sysu-go` calls `SocketManager.emitPodUpdated(shipmentDocId)`.
  3. Backend server (`server.js` line 427) receives event and broadcasts `io.emit("pod_updated", data)`.
  4. ❌ `dashboard.js` **does not listen** for `pod_updated`.
- **Impact**: Dispatcher looking at the Shipment Table / Orders view sees no update when a driver finishes delivery. Dispatcher must manually refresh or wait for full polling intervals.
- **Fix**: Add `socket.on("pod_updated", (data) => { ... })` in `dashboard.js` to invalidate and re-render the affected shipment's POD preview button.

---

### 3. [TDD & CI GAP] `npm test` Missing in Frontend
- **Problem**: Running `npm test` in `frontend/` fails immediately with `Missing script: "test"`.
- **Existing Test Files**:
  - `frontend/src/pages/dashboard.test.js` (written with Jest mocks)
  - `frontend/src/components/__tests__/PodPreview.test.js`
  - `frontend/src/components/__tests__/GuardSignature.test.js`
  - `frontend/src/components/__tests__/securityGuardService.test.js`
  - `frontend/src/components/__tests__/truckCompanyService.test.js`
- **Impact**: Frontend has test suites that are orphaned and cannot run in CI or pre-commit hooks.
- **Fix**: Add Vitest/Jest script in `package.json` and ensure test mocks align with current Vite ES module build.

---

## 🟡 MEDIUM PRIORITY FINDINGS

### 4. Dual Socket Connection Architecture
- `dashboard.js` connects to two separate Socket.IO servers:
  1. Main socket -> `sysu-app.onrender.com` (Handles role requests, admin config, vendor updates).
  2. Driver socket -> `sysu-go.onrender.com` (Handles driver GPS tracking, `update_admin_map`).
- **Risk**: If one server restarts or fails, partial UI desynchronization occurs (e.g. GPS moves but trip status doesn't change, or vice versa).

### 5. `driverId` Data Inconsistency (Firebase UID vs Queue Doc ID)
- In `sapAssignmentController.js`, `requested.driverId || requestedDriverId` is used to normalize to Auth UID.
- However, if a driver was created via older offline/kiosk flows where `driverId` in `queue` is missing or is the queue doc ID itself, `DriverShipmentSync.kt` in the Android app will fail to match `sap_assignments.driverId == currentUser.uid`.
- **Recommendation**: Enforce at the schema level that `driverId` in `queue` is strictly a non-empty Firebase Auth UID.

---

## 📋 TDD WORKFLOW ACTION PLAN (Where We Start)

1. **Phase 1: Fix Core Controller Crash (TDD style)**
   - Fix typo `remainingHShipments` -> `remainingShipments` in `sapAssignmentController.js`.
   - Write a unit/integration test for `decideCancelAssignment` in `backend/test/` to verify cancel flow passes without ReferenceError.

2. **Phase 2: Wire `pod_updated` Socket Handler in Dashboard**
   - Add `socket.on("pod_updated")` in `dashboard.js`.
   - Update state for the matching dispatchKey / OBD item.

3. **Phase 3: Configure Frontend Test Runner**
   - Setup Vitest in `frontend/package.json` to get frontend test suites executing and verified.
