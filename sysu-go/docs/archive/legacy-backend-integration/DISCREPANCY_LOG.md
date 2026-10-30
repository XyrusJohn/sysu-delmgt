> Release correction (2026-10-08): POST /api/dispatch/status is retired in local source. Authenticated calls return 410; anonymous calls return 401. It no longer writes assignments/queues or emits dispatch_status_update. Earlier descriptions below are historical and superseded. No shipped Android HTTP caller was found; external clients need migration. Full owned progress/POD acceptance remains G-16. See [current release tracker](../../FIX_TRACKER.md) and [executed evidence](../../RELEASE_FIXES_TDD.md). This change is not yet deployed.

# DISCREPANCY LOG — Docs vs As-Built Code

> Generated: 2026-05-26
> Scope: Historical Markdown files now archived in `docs/archive/legacy-backend-integration/`, audited against backend + Android code

---

## SUMMARY

| Category | Count |
|---|---|
| Docs claim implemented, NOT in code | ~40 |
| Code has, docs don't mention | ~10 |
| Status value errors | 6 files |
| False "ALL ITEMS COMPLETED" markers | 3 files |
| POST /api/trip/register incorrectly marked as built | 2 files |

---

## DISCREPANCY TABLE

| Doc File | Code Says | Doc Says | Impact | Fix Needed? |
|---|---|---|---|---|
| **All integration docs** | `status: "queued"` (qrController.js:129) | `status: "waiting"` in queue schema sections | Mobile queries for `"queued"` (correct), but docs describe `"waiting"`. Dashboard may filter wrong status. | YES — fix status in all docs |
| **SYSU_GO_MOBILE_INTEGRATION.md** | `POST /api/trip/register` NOT IMPLEMENTED — no tripController.js, no tripRoute.js | "NEW ENDPOINT — sysu-go backend must implement" + "✅ IMPLEMENTED" mixed signals | App teams will build against spec that doesn't exist | YES — mark clearly as ⚠️ NOT BUILT |
| **SYSU_MOBILE_INTEGRATION_GUIDE.md** | Routes said to be in `backend/src/routes/tripRoute.js` and `backend/src/controllers/tripController.js` — those paths don't exist | Table says "✅ IMPLEMENTED" | Misleads readers into thinking endpoint exists | YES — mark as ⚠️ NOT BUILT |
| **All mobile integration docs** | Backend writes `status: "queued"`, not `"waiting"` | Queue schema sections show `status: "waiting"` | Wrong field value for queries and filters | YES |
| **SYSU_GO_MOBILE_INTEGRATION.md Section 10** | `qrController.js` has ZERO sanitization. `config/sanitize.js` does not export SANITIZE/SANITIZE_PLATE_PREFIX/etc. | Documents SANITIZE functions in `qrController.js + tripController.js` | Teams will reference non-existent functions | YES — mark sanitization as ⚠️ NOT BUILT |
| **All mobile docs** | `GET /api/qr/verify` does NOT emit `qr_token_used`. Only `POST /api/qr/scan` does (qrController.js:138). | Both verify and scan are listed as emitting `qr_token_used` | QR reset logic described inaccurately | YES — fix verifyQR description |
| **SYSU_GO_MOBILE_INTEGRATION.md / SYSU_MOBILE_INTEGRATION_GUIDE.md** | Backend does NOT write `registrationComplete` — field is absent from qrController scanQR writes | Queue schemas show `registrationComplete: false` after scan | Driver visibility gate cannot work | YES — mark as ⚠️ NOT BUILT |
| **SYSU_GO_MOBILE_INTEGRATION.md / SYSU_MOBILE_INTEGRATION_GUIDE.md** | Backend writes only `driverName` (full string), NOT `driverFN`/`driverMI`/`driverLN` | Queue schemas include `driverFN`, `driverMI`, `driverLN` | Name splitting done on Android but not stored separately | YES — document actual state |
| **SYSU_GO_MOBILE_INTEGRATION.md / SYSU_MOBILE_INTEGRATION_GUIDE.md** | Backend does NOT write `helperFN`/`helperMI`/`helperLN`/`company`/`platePrefix`/`plateSuffix` | Queue Phase 2 schemas include all these | Trip registration needs these to be written | YES — mark as ⚠️ NOT BUILT |
| **SYSU_GO_MOBILE_INTEGRATION.md / SYSU_MOBILE_INTEGRATION_GUIDE.md** | `qr_tokens` document uses field `isUsed: true`, NOT `used: true` | Some schemas show `used: true` | Token verification logic mismatch | YES — fix field name to `isUsed` |
| **SYSU_GO_MOBILE_INTEGRATION.md** | `POST /api/qr/scan` accepts auth optionally via `QR_SCAN_REQUIRE_AUTH` env var (qrRoutes.js:9) | Documented as "Requires Firebase ID Token in Authorization header" | Mobile may not send token if not required | YES — note auth is conditional |
| **SYSU_GO_BACKEND_REQUIREMENTS.md** | `POST /api/dispatch/status` IS IMPLEMENTED (dispatchRoutes.js) | Item 1: "Add `POST /api/dispatch/status` endpoint" listed as blocking item | Backlog incorrectly shows complete item as pending | YES — mark ✅ BUILT |
| **SYSU_GO_BACKEND_REQUIREMENTS.md** | `POST /api/trip/register` NOT implemented | Not listed in outstanding items (wrong) | Correctly mentioned in doc but not identified as missing | Partial fix |
| **SYSU_GO_BACKEND_REQUIREMENTS.md** | `qr_token_used` emitted only by `scanQR`, not by `verifyQR` | Socket.IO description suggests verify emits it | Misleads implementers about QR reset flow | YES |
| **SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md** | `PATCH /api/qr/queue-status` marked as no-auth; valid statuses includes all including `"queued"` | Item says "Backend needs `POST /api/dispatch/status`" when dispatch status IS built | Unclear on actual status of dispatch endpoint | YES |
| **SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md** | Queue schema shows `status: "waiting"` | Says "Important: Do NOT use status: queued" | Self-contradicting because code writes "queued" | YES |
| **FRONTEND_DASHBOARD_JS_CHANGES.md** | All items status says "ALL ITEMS COMPLETED" — actual status check needed on queue schema | Status indicates no open items | May be accurate but needs verification against current state | Partial review |
| **QR_GENERATOR_FIXES.md** | Status display uses `waiting\|loading\|complete` class mapping | Says "status mapping is correct" when backend writes `queued` | Status display would show wrong text for `queued` drivers | YES — fix status mapping reference |
| **FLEET_QUEUE_ASSIGNMENT_STEPS.md** | Correctly states `status: "waiting"` was changed from `"queued"` | Says backend changed to `"waiting"` — but code changed BACK to `"queued"` | Recovers from original state but not current state | YES |
| **FLEET_QUEUE_ASSIGNMENT_STEPS.md** | Says `status: "waiting"` is correct after backend fix | Current backend writes `status: "queued"` — discrepancy | Status mismatch persists | YES |
| **SYSU_FRONTEND_CHANGES.md** | `GET /api/qr/verify` marks token as used and emits `qr_token_used` via Socket | States this only for scanQR, verify just marks used flag | Mis-states event emission for verify route | YES |

---

## PER-FILE DETAILED FINDINGS

### 1. SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md

**Lines 139-150 (Queue schema):** Shows `status: "waiting"`, says "Do NOT use status: queued" — **WRONG**. The backend writes `status: "queued"` (qrController.js:129).

**Line 227:** Checklist shows `[ ] Backend: add POST /api/dispatch/status endpoint` — **WRONG**. It IS implemented at `dispatchRoutes.js`.

**Line 242:** `[ ] Align role names` — `"driver"` IS accepted (userRoutes.js:14).

**Status markers:** Mixed — some items are actually complete, some aren't tracked as complete.

---

### 2. FRONTEND_DASHBOARD_JS_CHANGES.md

**Status marker:** "ALL ITEMS COMPLETED" at line 4 — likely accurate for JS changes, but queue schema section (lines 97-115) describes `status: "waiting"` which the backend does NOT write.

**Lines 97-115:** Describes queue sorting fallbacks and `status: "waiting"` value that doesn't match actual backend.

---

### 3. QR_GENERATOR_FIXES.md

**Status marker:** "ALL ITEMS COMPLETED" at line 5 — appears accurate based on qr-generator.html analysis.

**Lines 76-77:** "Align Status Mapping — Verified" states status mapping is `waiting | loading | complete` and backend emits `status: "waiting"`. **WRONG** — backend writes `status: "queued"`.

**Line 90-93:** Response type in `POST /api/qr/scan` shows `queueId` but backend actually also returns `queuePosition`.

---

### 4. FLEET_QUEUE_ASSIGNMENT_STEPS.md

**Status marker:** "ALL STEPS COMPLETED" at line 5 — appears accurate for the fleet queue flow changes.

**Line 174:** Backend Change table claims `qrController.js writes status: "waiting"` — **WRONG**. It writes `status: "queued"` (qrController.js:129). There was a brief period where it was `"waiting"` but it was reverted to `"queued"`.

---

### 5. SYSU_GO_BACKEND_REQUIREMENTS.md

**Overview section:** Says "Backend needs `POST /api/dispatch/status` endpoint" — **WRONG**. It IS implemented (dispatchRoutes.js).

**Item 1, lines 21-123:** Correctly describes behavior needed but mischaracterizes the dispatch_status_update socket event origin.

**Socket.IO reference:** Lists `qr_token_used` as emitted during "verifyToken" on line 147 — **WRONG**. Only scanQR emits this.

---

### 6. SYSU_FRONTEND_CHANGES.md

**Lines 55-90:** References queue schema with `status: "waiting"` — **WRONG**. Backend writes `status: "queued"`.

**Line 138-139:** Says `GET /api/qr/verify` → `qr_tokens/{token}.used = true` — wrong field name (`isUsed`) and wrong event description (verify doesn't emit socket event).

---

### 7. SYSU_MOBILE_INTEGRATION_GUIDE.md

**Line 270-272:** Describes `GET /api/qr/verify` emitting `qr_token_used` — **WRONG**. Only scanQR emits.

**Lines 327-338:** Field limits section describes sanitization rules implemented in backend — **IMPLEMENTATION DOES NOT EXIST** in qrController.js.

**Lines 341-347:** Enhanced sanitization section — **NOT IMPLEMENTED** in backend.

**Lines 381-486:** Full section 6.2 Trip Registration — complete `POST /api/trip/register` spec — **THIS ENDPOINT DOES NOT EXIST**. No tripController.js, no tripRoute.js.

**Section 10 outstanding items:** Lists `POST /api/trip/register` as "✅ IMPLEMENTED" referencing `backend/src/routes/tripRoute.js` — **WRONG PATH AND DOES NOT EXIST**.

**Queue schema Phase 2 (lines 607-628):** Shows `registrationComplete: true` and all helperFN/MI/LN fields — **NOT WRITTEN BY BACKEND**.

---

### 8. SYSU_GO_MOBILE_INTEGRATION.md

**Lines 59-87 (flow):** Step 5 claims `registrationComplete: false` written — NOT by backend.

**Line 65:** Claims backend writes `status: "waiting"` — **WRONG**, code writes `status: "queued"`.

**Lines 234-251 (scanQR request):** Shows `driverFN`, `driverMI`, `driverLN` in request body — **Android sends these but backend doesn't write them separately to queue**.

**Section 4 trip registration:** Comprehensive spec for `POST /api/trip/register` — **⚠️ NOT BUILT**.

**Section 10 Backend sanitization:** Shows SANITIZE functions in `tripController.js` — **tripController.js does not exist**.

**Table of backend changes (lines 804-816):** Shows "Implement `POST /api/trip/register`" — correctly identified as needed. But Item 4 says "Add `registrationComplete` + new fields to queue write" — NOT implemented.

**Lines 9-11:** Status table shows `driverId`, `driverName`, `token`, `truckType`, `plateNumber`, `helperName`, `status: "waiting"`, `isAssigned: false` — **status wrong**. Missing `registrationComplete`.

---

### 9. SYSU_MASTER_INTEGRATION_GUIDE.md

**Most accurate document** — already correctly identifies:
- `status: "queued"` (not "waiting") 
- `POST /api/trip/register` does not exist
- No sanitization in qrController.js
- `registrationComplete` not written by backend
- `qr_token_used` only emitted by scanQR (not verifyQR)

**NEEDS MINOR FIXES:**
- Section 2 says "Critical Gap Analysis" and lists items accurately but needs to verify if status comment at line 85 `status: "queued"` is consistent with mobile query
- Section 16 status reference uses "Option A (recommended)" to change backend to `"waiting"` — but the mobile app actually queries for `"queued"` so the AS-BUILT choice of `"queued"` is actually correct; Option A is the LESS correct choice for this codebase
- Minor inconsistencies in Sanitization section (lines 1174-1187) describing non-existent SANITIZE function location

---

## FIELD-LEVEL DISCREPANCIES (Queue Document Schema)

| Field | Actually Written By Backend? | Docs Say |
|---|---|---|
| `status` | YES — `"queued"` (qrController.js:129) | `"waiting"` in most docs |
| `driverName` | YES — full string | YES |
| `driverFN` | NO | YES (docs show it) |
| `driverMI` | NO | YES (docs show it) |
| `driverLN` | NO | YES (docs show it) |
| `helper` | YES — full string from `helperName` body param | YES |
| `helperFN` | NO | YES (Phase 2 docs) |
| `helperMI` | NO | YES (Phase 2 docs) |
| `helperLN` | NO | YES (Phase 2 docs) |
| `company` | NO (only `truckCompany`) | YES (Phase 2 docs) |
| `truckCompany` | YES — written from body param | YES |
| `truckType` | YES | YES |
| `plateNumber` | YES | YES |
| `platePrefix` | NO | YES (Phase 2) |
| `plateSuffix` | NO | YES (Phase 2) |
| `token` | Stored in `qr_tokens`, not in `queue` doc | YES |
| `isAssigned` | YES — `false` (qrController.js:128) | YES |
| `registrationComplete` | NO | YES (all mobile docs) |
| `joinedAt` | YES (qrController.js:127) | YES |
| `entryTime` | YES (qrController.js:126) | Different docs show different fields |
| `notes` | YES — empty string (qrController.js:130) | Some docs show it, some don't |
| `id` | YES — Firestore auto-ID | YES |
| `driverId` | YES | YES |

---

## ANDROID-SPECIFIC DISCREPANCIES

| Issue | Location | Actual Code | Doc Claims |
|---|---|---|---|
| UpdateInfoActivity ScanRequest | `app/src/.../UpdateInfoActivity.kt:84` | Creates ScanRequest with token, driverId, driverName, truckType, truckCompany, plateNumber, helperName — BUT driverFN/MI/LN are **null/default** (not set) | ScanRequest includes driverFN/MI/LN fields — Android sets them (some docs claim) |
| ScanRequest model | `app/src/.../model/ScanRequest.kt` | Has `driverFN`, `driverMI`, `driverLN` fields BUT UpdateInfoActivity doesn't populate them | Docs say Android sends split name fields |
| MainActivity queue query | `app/src/.../MainActivity.kt:107,147` | `whereEqualTo("status", "queued")` — **CORRECT** | Docs say mobile queries for `"waiting"` |
| TripApiService exists | `app/src/.../network/TripApiService.kt` | Service IS implemented and has correct schema | Backend's trip endpoint doesn't exist, but Android does |
| Sanitizer.kt exists | `app/src/.../utils/Sanitizer.kt` | Android HAS sanitization utilities | Docs reference backend sanitization (not implemented) |

---

## FILES NEEDING CHANGES

| File | Priority | Main Issues |
|---|---|---|
| `DISCREPANCY_LOG.md` | CREATE | This log |
| `SYSU_GO_MOBILE_INTEGRATION.md` | HIGH | Trip register false status, wrong status, missing AS-BUILT callout |
| `SYSU_MASTER_INTEGRATION_GUIDE.md` | MEDIUM | Minor fixes only — already most accurate |
| `SYSU_BACKEND_INTEGRATION_REQUIREMENTS.md` | HIGH | Wrong status, false checklist items |
| `SYSU_GO_BACKEND_REQUIREMENTS.md` | HIGH | Dispatch endpoint listed as needed when built |
| `SYSU_FRONTEND_CHANGES.md` | MEDIUM | Wrong status, wrong verify event description |
| `QR_GENERATOR_FIXES.md` | MEDIUM | Status mention wrong |
| `FLEET_QUEUE_ASSIGNMENT_STEPS.md` | MEDIUM | Wrong status in backend changes table |

---

*End of DISCREPANCY_LOG.md*
