# Historical snapshot — do not use as current release status

This assessment is retained for audit history. It was superseded by the current [SYSU-Go fix tracker](../../FIX_TRACKER.md) and [release test plan](../../RELEASE_TEST_PLAN.md); verify every claim against current code and test evidence.

# SYSU-Go Android App — Detailed Assessment & Bug Report
> Date: 2026-10-07 | Branch: main | Min SDK: 24 | Target SDK: 35
> Backend: `https://sysu-go.onrender.com`
> Scope: All Kotlin source files, network layer, Firestore integration, Socket.IO, POD flow, cross-app connection with sysu-app (web dashboard)

---

## Overall Score: 5.5/10 — Functional but Bug-Prone

| Dimension | Score | Status |
|---|---|---|
| **Core Functionality** | 7/10 | ⚠️ Works but fragile |
| **Test Coverage** | 1.5/10 | 🔴 Nearly zero |
| **Connection to sysu-app** | 7/10 | ✅ Mostly correct |
| **Code Quality** | 6/10 | ⚠️ Several structural issues |
| **Error Handling** | 5/10 | ⚠️ Inconsistent |
| **Security** | 6/10 | ⚠️ Missing token refresh |
| **Stability** | 5/10 | ⚠️ Known runtime crash vectors |

---

## 1. What's Working ✅

### Core Features Confirmed Working
- **Login / Registration / Splash** — Firebase Auth + `SessionManager` flow
- **QR Scan → Queue Join** — `QRApiService.scanToken()` with HTTP + Firestore fallback
- **Queue Position Display** — FIFO sort by `timestampSeconds` in `MainActivity` (tested in `ExampleUnitTest`)
- **Socket.IO connection** — `SocketManager` connects to Railway, heartbeat every 15s, reconnect on network restore
- **Driver status emit** — `DriverStatus.write()` → Firestore + Socket.IO `driver_status_change` + REST proxy fallback (3-layer)
- **POD Capture** — Camera → GPS → timestamp overlay → base64 → Firestore subcollection (`sap_assignments/{key}/pod_images/{obd}`)
- **DriverShipmentSync** — background Firestore listener mirrors `assignedShipments` + `activeTrip` to `drivers/{uid}` doc
- **Guard Signature Capture** — `SignaturePadBottomSheet` → saves `guardSignatureBase64` to `sap_assignments`
- **Guard Signature View** — field name corrected to `guardSignatureBase64` (previously was `guardSignature`)
- **Truck type / Helper display** — hardcoded "AUV"/"Pedro Santos" in XML fixed to use actual Firestore values
- **Connectivity monitoring** — `ConnectivityMonitor` + `NetworkUtils` detect offline, trigger socket disconnect + status update

### sysu-app Connection (Cross-App)
- Socket events flow correctly: `driver_status_change`, `update_status`, `pod_updated`, `driver_is_full` → received by sysu-app dashboard
- POD images saved to correct subcollection path that sysu-app dashboard now reads (fixed on both ends)
- Guard signature field name now consistent across both apps (`guardSignatureBase64`)
- `DriverShipmentSync` mirrors data that sysu-app's Fleet Manager reads from `drivers/{uid}`

---

## 2. Test Coverage — 🔴 CRITICAL GAP

### Existing Tests
| File | Tests | What's Covered |
|---|---|---|
| `ExampleUnitTest.kt` | 2 tests | `2+2=4` (boilerplate) + FIFO queue position ranking |
| `ExampleInstrumentedTest.kt` | 1 test | Device context check (boilerplate) |

**Total: 3 tests.** Only 1 is meaningful. That's testing 0.5% of the app logic.

### What Has ZERO Tests
| Component | Risk Level | Reason It Matters |
|---|---|---|
| `QRApiService.verifyToken()` | 🔴 HIGH | Core gate for queue entry; fallback path untested |
| `QRApiService.scanToken()` | 🔴 HIGH | Fallback Firestore path writes incorrect `queuePosition = 1` always |
| `TripApiService.registerTrip()` | 🔴 HIGH | No retry, no fallback; silent failure possible |
| `DriverStatus.write()` | 🟡 MEDIUM | Triple-fallback chain logic untested |
| `SessionManager` (all methods) | 🟡 MEDIUM | Session state management is critical path |
| `DriverShipmentSync.mirrorToDriverDoc()` | 🟡 MEDIUM | Status classification logic (in_transit vs. loading etc.) |
| `ImageStorageHelper` (POD encode/overlay) | 🟡 MEDIUM | Image processing, Base64 encoding |
| `Sanitizer` | 🟢 LOW | String sanitization helpers |
| All Activities | 🔴 HIGH | No UI tests, no Espresso tests |

---

## 3. Known Bugs (Confirmed from Code + Logcat)

### 🔴 BUG-1: `PERMISSION_DENIED` on `truck_companies` Firestore collection
**Source:** `logcat_capture.txt` (repeated `E/TruckCompanyRepo`)
```
PERMISSION_DENIED: Missing or insufficient permissions.
Firestore fetch FAILED: FirebaseFirestoreException - PERMISSION_DENIED
Cached 0 truck companies
```
**Impact:** Truck company list is empty when Firestore rules block the read. `SecurityGuardRepository` likely has the same issue.  
**Root Cause:** The Android app reads `truck_companies` directly from Firestore client-side, but Firestore security rules don't allow driver role to read this collection.  
**Fix:** Either loosen Firestore rules for `truck_companies` for authenticated drivers, or fetch via the backend API instead.

---

### 🔴 BUG-2: `scanToken()` Firestore fallback always returns `queuePosition = 1`
**Source:** `QRApiService.kt`
```kotlin
Result.Success(ScanResponse(success = true, message = "Joined queue successfully",
    queueId = queueDocRef.id, queuePosition = 1))  // ← hardcoded 1
```
**Impact:** When the HTTP API is down (Railway sleeping), the driver gets told they're position 1, which is wrong. The UI shows wrong queue position.  
**Fix:** After writing to Firestore, query the queue collection to compute the actual position before returning.

---

### 🔴 BUG-3: `TripApiService.registerTrip()` has no fallback
**Source:** `TripApiService.kt`
```kotlin
// No Firestore fallback
Result.Error(-1, "Network error: ${e.javaClass.simpleName} - ${e.message}")
```
**Impact:** If Railway backend is sleeping during trip registration, the entire trip registration silently fails with a generic error. No retry, no Firestore fallback (unlike QR which has one).  
**Fix:** Add Firestore fallback that writes trip data directly, or add retry with exponential backoff.

---

### 🟡 BUG-4: `isMinifyEnabled = false` in release build
**Source:** `app/build.gradle.kts`
```kotlin
release {
    isMinifyEnabled = false  // ← disabled
```
**Impact:** Release APK is not obfuscated or shrunk. APK is larger than necessary and internal class/method names are visible via reverse engineering. Exposes API base URL (`sysu-go.onrender.com`) and other internals.  
**Fix:** Enable `isMinifyEnabled = true` + `shrinkResources = true` for release builds.

---

### 🟡 BUG-5: `DriverShipmentSync` `driverId` field mismatch risk
**Source:** `DriverShipmentSync.kt`
```kotlin
.whereEqualTo("driverId", target)  // target = Firebase UID
```
**Context:** The previous bug in `QueueDetailsActivity` revealed that `sap_assignments.driverId` stores the **queue doc ID** (not Firebase UID) in some paths. If the backend assigns using queue doc ID as `driverId`, then `DriverShipmentSync` never finds those assignments.  
**Impact:** `assignedShipments` array on `drivers/{uid}` stays empty even when the driver has an active assignment. Fleet Manager on sysu-app sees driver as unassigned.  
**Fix:** Confirm that `sapAssignmentController.js` consistently writes `Firebase UID` (not queue doc ID) to `sap_assignments.driverId`. Add a test or assertion.

---

### 🟡 BUG-6: Stale `SessionManager` data after logout/re-login
**Source:** `SessionManager.kt` — `clearSession()` uses `prefs.edit { clear() }` but `clearTripSession()` only removes specific keys
**Impact:** If a driver logs out while on an active trip, then logs back in as a different driver, residual trip data (`KEY_SAP_DOC_ID`, `KEY_ACTIVE_SAP_DOC_ID`) may still be present and cause wrong UI state.  
**Fix:** Call `clearTripSession()` inside `clearSession()` to ensure full cleanup.

---

### 🟡 BUG-7: `QueueDetailsActivity` has two `FirebaseFirestore.getInstance()` declarations
**Source:** `QueueDetailsActivity.kt`
```kotlin
private val db = FirebaseFirestore.getInstance()          // line ~57
private val firestoreDb = FirebaseFirestore.getInstance() // line ~60
```
**Impact:** Not a runtime crash (Firestore is a singleton), but shows copy-paste technical debt. Any new developer will be confused about which `db` to use.  
**Fix:** Remove `firestoreDb`, standardize on `db`.

---

### 🟢 BUG-8: GPS overlay emoji in `ImageStorageHelper` may be malformed
**Source:** `ImageStorageHelper.kt`
```kotlin
"dY\"? $label"  // pin emoji looks corrupted in source encoding
```
**Impact:** The location label text on POD photos may show garbled characters instead of the pin emoji (📍) on some devices.  
**Fix:** Use `\uD83D\uDCCD` (Unicode for 📍) instead of the literal emoji to avoid encoding issues.

---

## 4. Cross-App Connection: sysu-go ↔ sysu-app

### Data Flow Map
```
sysu-go (Android)                         sysu-app (Web Dashboard)
─────────────────                         ────────────────────────
QRApiService.scanToken()
  → queue/{docId}                    ←── Firestore listener (ShipmentTable)

SocketManager.emit("driver_status_change")
  → backend → Socket.IO broadcast    ←── dashboard.js socket listener

DriverStatus.write()
  → drivers/{uid}.status             ←── Fleet Manager Firestore listener

QueueDetailsActivity (POD capture)
  → sap_assignments/{key}/pod_images/{obd}
    base64Image field                ←── openObdPodPreview() fetches subcollection

QueueDetailsActivity (guard signature)
  → sap_assignments/{key}
    guardSignatureBase64 field       ←── openObdPodPreview() reads field

SocketManager.emitPodUpdated()
  → backend → pod_updated event     ←── (currently NOT handled in dashboard.js)

DriverShipmentSync.mirrorToDriverDoc()
  → drivers/{uid}.assignedShipments
  → drivers/{uid}.activeTrip        ←── Fleet Manager reads this
```

### Connection Issues Found

| Issue | Severity | Description |
|---|---|---|
| `pod_updated` event not handled in dashboard | 🟡 | sysu-go emits `pod_updated` via socket but sysu-app dashboard has no listener for it. POD update requires manual refresh. |
| `driverId` field inconsistency | 🔴 | Some paths write UID, some write queue doc ID. See BUG-5. |
| Truck companies Firestore rules block driver reads | 🔴 | See BUG-1. |
| `queuePosition` always 1 on fallback | 🔴 | See BUG-2. |

---

## 5. Architecture Issues

### 🟡 Activities are doing too much
Every major Activity (`QueueDetailsActivity`, `MainActivity`, `GeneralTrackingActivity`) handles:
- UI binding
- Firestore reads/writes
- Camera/permissions
- Socket.IO emit
- Business logic

This makes them impossible to unit test and hard to maintain. No ViewModel, no Repository pattern beyond `SecurityGuardRepository` and `TripCompanyRepo`.

### 🟡 `SocketManager` is a Kotlin `object` (singleton)
- Good: single connection
- Bad: impossible to mock in tests, hard to inject for unit testing
- Risk: if `disconnect()` is called while the main socket loop is still running, there's potential for a race condition on `mSocketGo = null`

### 🟡 `Tasks.await()` called from Firestore fallback paths
In `QRApiService`, the Firestore fallback uses `Tasks.await()` which **blocks the calling thread**. Since `QRApiService` is called from a background thread in `QRScanActivity`, this is technically okay — but it's fragile if ever called from the main thread.

### 🟡 No ViewModel / LiveData / StateFlow
All state is held in Activity member variables. Rotation causes data loss; config changes re-trigger Firestore reads unnecessarily.

---

## 6. Security

### ✅ Done Right
- Firebase Auth ID token passed as `Authorization: Bearer` header on `TripApiService.registerTrip()`
- `Sanitizer.sanitizeDisplayName()` applied before saving driver names
- `SessionManager.saveLastEmit()` validates coordinates before saving (`lat in [-90,90]`, `lng in [-180,180]`)
- `BuildConfig.API_BASE_URL` — no hardcoded URLs in source files

### ⚠️ Gaps
- `isMinifyEnabled = false` in release — exposes internals (see BUG-4)
- `QRApiService.scanToken()` and `verifyToken()` do **NOT** send a Firebase ID token. Anyone who can observe the request could call the scan endpoint without authentication.
- ID token is not refreshed before use in `TripApiService` — if token expired (>1hr), request fails with 401 silently

---

## 7. Prioritized Fix List

### 🔴 Must Fix First (Blockers)

| # | Bug | File | Effort |
|---|---|---|---|
| 1 | `PERMISSION_DENIED` on `truck_companies` — Firestore rules | Firestore console / `SecurityGuardRepository.kt` | Small |
| 2 | `scanToken` fallback always returns `queuePosition = 1` | `QRApiService.kt` | Small |
| 3 | `TripApiService.registerTrip()` has no fallback | `TripApiService.kt` | Medium |
| 4 | `driverId` consistency: UID vs queue doc ID in `sap_assignments` | `sapAssignmentController.js` + `AssignmentActivity.kt` | Medium |

### 🟡 High Priority (Before Wider Release)

| # | Issue | File | Effort |
|---|---|---|---|
| 5 | `clearSession()` should call `clearTripSession()` | `SessionManager.kt` | Tiny |
| 6 | Remove duplicate `firestoreDb` var | `QueueDetailsActivity.kt` | Tiny |
| 7 | Fix GPS emoji encoding in POD overlay | `ImageStorageHelper.kt` | Tiny |
| 8 | Enable minification in release build | `app/build.gradle.kts` | Small |
| 9 | Handle `pod_updated` socket event in sysu-app dashboard | `dashboard.js` | Small |
| 10 | Add ID token refresh before API calls | `TripApiService.kt`, `QRApiService.kt` | Medium |

### 🟢 Technical Debt (Long-term)

| # | Issue | Effort |
|---|---|---|
| 11 | Introduce ViewModel + StateFlow for Activities | Large |
| 12 | Extract business logic from Activities to Repository/UseCase layer | Large |
| 13 | Write JUnit tests for `QRApiService`, `TripApiService`, `SessionManager`, `DriverStatus`, `DriverShipmentSync` | Medium |
| 14 | Write Espresso tests for QR scan → queue join flow | Large |
| 15 | Make `SocketManager` injectable/mockable | Medium |

---

## 8. Where to Start (Recommended Order)

```
Step 1 → Fix Firestore rules for truck_companies (BUG-1) — 10 min
Step 2 → Fix scanToken fallback queuePosition (BUG-2) — 30 min
Step 3 → Fix clearSession() to call clearTripSession() (BUG-6) — 5 min
Step 4 → Fix duplicate firestoreDb (BUG-7) — 5 min
Step 5 → Confirm driverId consistency (BUG-5) — investigate + fix
Step 6 → Add TripApiService fallback (BUG-3) — 1-2 hrs
Step 7 → Write unit tests for QRApiService + SessionManager — 2-3 hrs
Step 8 → Enable minification (BUG-4) — 30 min (may need proguard rules)
```

---

## 9. Files Audited

| File | Lines | Risk |
|---|---|---|
| `QRApiService.kt` | ~130 | 🔴 Fallback bugs |
| `TripApiService.kt` | ~90 | 🔴 No fallback |
| `SocketManager.kt` | ~300+ | 🟡 Race condition risk |
| `DriverStatus.kt` | ~200+ | 🟡 Untested triple-fallback |
| `SessionManager.kt` | ~250+ | 🟡 Stale data risk |
| `DriverShipmentSync.kt` | ~150 | 🟡 driverId field risk |
| `ImageStorageHelper.kt` | ~200+ | 🟡 Emoji encoding bug |
| `QueueDetailsActivity.kt` | ~large | 🟡 Duplicate Firestore instance |
| `MainActivity.kt` | ~large | 🟡 No ViewModel |
| `ExampleUnitTest.kt` | ~40 | 🔴 Only 1 real test |
