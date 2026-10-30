# SYSU Go Mobile App — Integration Checklist

Historical test totals below are scoped to their dated runs. Use [FIX_TRACKER.md](FIX_TRACKER.md) for canonical finding status; local automation does not establish phone or deployed acceptance.


## Automation checkpoint — 2026-10-14

- [x] Native UI/camera 16/16 includes real bundled QR decoding/registration, preview/zoom/cancel, dynamic Home/Details queue ranks, historical assignment exclusion and owned two-OBD loading progress.
- [x] Mobile backend 140/140; both shared local Firestore policies 29/29; Android debug/release units 79/79 each.
- [x] Disable sensitive app backup and verify source exclusions plus compiled `allowBackup=false`.
- [x] Browser regression 16/16; liveTest build/lint, compiled network policy, signature and ZIP page alignment pass.
- [x] Expanded paired native-to-web final run 4/4, zero failed/skipped/retries. [Canonical evidence](../../sysu-app/docs/automated-release-validation.md).
- [x] G-30: user-approved CameraX/ML Kit updates, build/unit/lint/signature/ZIP checks and strict 16 KB camera/QR runtime smoke 2/2 pass.
- [ ] G-30: three vendor-library static RELRO alignment failures remain on release/liveTest APKs.
- [x] Matching own-position backend deployed as controlled beta (`5c2b152a-714d-46a8-9b33-6f6a3be41afd` SUCCESS); post-deploy health/queue/CORS/authenticated sockets and six availability observations pass. [Evidence and rollback](../../sysu-app/docs/controlled-beta-deployment-2026-10-14.md).
- [ ] User installs matching tested APK and performs actual-trip acceptance. Broader strict-policy, signing, IAM, physical-device and G-30 static-alignment gates remain separate.

## Current production recovery — 2026-10-09

Follow the [workspace plan](../../production-recovery-plan.md); finding status is in [FIX_TRACKER.md](FIX_TRACKER.md). Historical DONE rows below do not establish that the current live cross-app trip works.

- [x] G-29/W-08 tracking review and small implementation plan prepared. [Executed baseline and 31-scenario matrix](../../sysu-app/docs/live-location-optimization-plan.md).
- [x] Implement one service GPS sender, fresh reconnect, ordered web markers and bounded guarded checkpoints; regression suites, build and signature pass. [Current evidence](../../sysu-app/docs/live-location-optimization-plan.md#implementation-checkpoint--2026-10-09).
- [ ] Install the intended APK and perform phone-to-web GPS/background/reconnect/return/closure acceptance and battery/latency/write-count measurements.
- [ ] G-26: registered-queue index and exact live query pass (verified); authorized read and actual registration still need acceptance.
- [ ] W-03: hosted Queue displays the persisted registration and polls successfully.
- [ ] G-27/W-05: old shipments stay out of the new queue; registered driver card and new assignment pass workspace plan Q01–Q10.
- [x] G-27 implementation and 122/122 Android unit executions; liveTest APK build/lint/signature pass. Web card fix is deployed. [Executed evidence](../../sysu-app/docs/archive/queue-card-recovery-2026-10-09.md). APK installation and actual-device UI/return flow remain open.
- [x] W-06 production kiosk access hotfix: user confirmed the registered AUV card appears after resolving the legacy super-admin 403. The reported installed phone counted unregistered waiting entries; G-28 fixes that behavior in the rebuilt APK, with S05 actual-device agreement pending installation.
- [x] G-28 implemented: shared registered-position policy and live details snapshots; Android 138/138, mobile backend 119/119 and web backend 149/149 pass; updated APK build/lint/signature pass. [Evidence](queue-position-recovery-2026-10-09.md).
- [ ] S05/G-28: install the updated APK and confirm both phone screens match web, including 3→2→1 assignment progression without reopening details.
- [x] Run guarded QR/trip/POD integration cases and Android debug/release unit checks (47/47 and 106/106).
- [ ] S01–S05: actual Android/web login, QR, trip registration, Queue group/order and duplicate prevention.
- [ ] S06–S08: intended assignment/OBDs, loading/capacity, transit/location on web.
- [ ] S09–S12: POD preview, delivery/return/next trip, cancellation/reassignment and recovery.
- [ ] Record installed APK, service/index versions and sanitized expected/actual results.

Current evidence: mobile backend 119/119, guarded integration 47/47 (earlier recovery) and Android debug/release unit tests 138/138 executions after G-28. Web backend 149/149 passes, including matching position progression. Latest web browser workflows remain the previous 14/14 run including legacy super-admin kiosk access; earlier W-04 disabled-session repeats passed 6/6, without automatic retries. [Browser evidence](../../sysu-app/docs/archive/queue-card-recovery-2026-10-09.md#w-06-production-super-admin-403). These are not actual Android device tests. Full phone-to-web acceptance remains unverified.

> **Generated:** 2026-08-01  
> **Branch:** `main`  
> **Purpose:** Modular checklist for cross-team integration (Mobile ↔ Sysu Web App)  

---

## 1. 🇵🇭 Tagalog Localization (Notifications)

All user-facing notifications, toast messages, dialog texts, and navbar overlays translated to Filipino.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1.1 | `strings.xml` — all resource strings in Tagalog | ✅ DONE | Includes CTA, QR scan, login, registration, trip, POD, permissions, assignment, cancel queue, return-to-base |
| 1.2 | QR tutorial overlay text | ✅ DONE | `activity_main.xml` — "Paano Mag-Check In" (How to check in) / "Nakuha Ko Na!" (Got it!) |
| 1.3 | Nav tutorial overlay text | ✅ DONE | `activity_main.xml` — "Iyong Navbar" (Your navigation bar); each button was described in Filipino |
| 1.4 | LocationServices foreground notification | ✅ DONE | "Aktibo ang SYSU Tracking" (SYSU Tracking is active) / "Ipinapadala ang iyong lokasyon sa dispatch" (Your location is being sent to dispatch) |
| 1.5 | Hardcoded Toast messages in `MainActivity` | ✅ DONE | Welcome, queue, start-trip, OBD toasts |
| 1.6 | Hardcoded Toast messages in `TransitActivity` | ✅ DONE | Start/end trip, return-to-base, POD blocking |
| 1.7 | `tvScanHint` banner text | ✅ DONE | "Ipakita ang QR code sa booth para mag-check in" (Show the QR code at the booth to check in) |

---

## 2. 🧹 Sanitizer — Middle Initial Fix

Prevents double-dot middle initial patterns like `"Carlo B.. Locar"`.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2.1 | `Sanitizer.sanitizeDisplayName()` | ✅ DONE | Collapses `\.{2,}` → `.`, squashes extra whitespace, trims trailing dot |
| 2.2 | Applied in `SessionManager` save/read paths | ✅ DONE | `saveDriverSession()`, `saveDriverSessionWithSplit()`, `getDriverName()` |
| 2.3 | `ProfileActivity` sync applies clean name | ✅ DONE | Rebuilds from FN/MI/LN parts on Firestore sync |

---

## 2B. 🔒 OBD/POD Lock Until Start Trip

Driver cannot interact with OBD items or do POD capture until the trip has started (`tripStatus == "in_transit"`).

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2B.1 | `MyTripTabAdapter.isObdLocked` — STRICT lock | ✅ DONE | Lock condition: `tripStatus != "in_transit" && != "completed"`. Closes the gap where `loaded` (guard-verified, pre-Start-Trip) used to allow entry |
| 2B.2 | Toast message on locked OBD tap | ✅ DONE | `R.string.obd_locked_msg` — "Simulan ang trip para maka pag-POD" (Start the trip before capturing POD) |
| 2B.3 | `AssignmentActivity.openObdBottomSheet()` — pre-transit = read-only | ✅ DONE | Always passes `podCaptureEnabled = false` for non-in_transit; opens Detail row layout only |
| 2B.4 | `MainActivity.openObdBottomSheet()` — read-only | ✅ DONE | Same `podCaptureEnabled = false` read-only pattern in My Queue tab |
| 2B.5 | `QueueDetailsActivity.openObdBottomSheet()` — read-only | ✅ DONE | `podCaptureEnabled = false` outside transit context |

---

## 3. 🚛 Trucking Company Display Fix

Display company name without forwarder number / truck company number. ALL CAPS + bold.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 3.1 | `Sanitizer.sanitizeCompanyName()` | ✅ DONE | Strips `001-` / `045— ` / raw number prefixes → uppercase result |
| 3.2 | Pattern: `"001-LAZADA SHIPPING"` → `"LAZADA SHIPPING"` | ✅ DONE | Regex: `"""^\d+\s*[-—–]+\s*""".replace("")` then `.uppercase()` |
| 3.3 | Fallback: if all digits stripped leaves empty, returns uppercased original | ✅ DONE | `.ifBlank { input.trim().uppercase() }` |
| 3.4 | `ProfileActivity.tvCompany` layout — ALL CAPS + bold | ✅ DONE | `textAllCaps="true"` + `textStyle="bold"` + `fontFamily="atkinson_hyperlegible_bold"` |
| 3.5 | `ProfileActivity` reads apply `sanitizeCompanyName` | ✅ DONE | Both session-init path + Firestore callback path |
| 3.6 | `MainActivity` stores apply `sanitizeCompanyName` | ✅ DONE | `syncProfileWithFirestore()` + `enrichAssignmentsWithDriverData()` |

---

## 4. 📍 Strict GPS Geo-Tracking (Start → Arrival Only)

GPS tracking activates only when driver clicks Start Trip, and stops immediately when reaching warehouse (returning_to_base / completed). No stale emits leak.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 4.1 | Tracking: ON = `TransitActivity.startTrip()` → `sessionManager.setTrackingActive(true)` | ✅ DONE | Line 379, immediately after `saveCurrentSapDocId()` |
| 4.2 | Tracking: OFF = `TransitActivity.performEndTrip()` → `setTrackingActive(false)` + `stopService(LocationServices)` + `emitOfflineStatus()` | ✅ DONE | Lines 473–486. The flag flip happens BEFORE `stopService` so the service's own auto-restart by the system reads `FALSE` on its `onStartCommand` guard |
| 4.3 | Tracking: OFF = `ReturnToBaseBottomSheet.performArrivedAtBase()` → same triple-stop pattern | ✅ DONE | First tap on **"ARRIVED AT WAREHOUSE"**. Per the spec, geo ends at physical arrival — not on the administrative CONFIRM step |
| 4.4 | Tracking: OFF = `ReturnToBaseBottomSheet.performConfirmArrival()` → same triple-stop | ✅ DONE | Belt-and-suspenders. Catches the case where a driver somehow skips the ARRIVED tap and goes straight to CONFIRM |
| 4.5 | LocationServices guard: re-checks `isTrackingActive()` on EVERY callback | ✅ DONE | `handleLocation()` first-line guard (line 118): if `!isTrackingActive()`, return silently — no stray emit after the trip ends |
| 4.6 | LocationServices guard: `onStartCommand` only starts GPS if `tracking_active=TRUE` | ✅ DONE | Pre-existing. Foreground service runs as usual; GPS only kicks in when flag flips true (Start Trip click) |
| 4.7 | Battery critical receiver → setTrackingActive(false) + emitOffline | ✅ DONE | `LocationServices.batteryReceiver` (line 81) — safety: even if app is unreachable, marker drops |

---

## 5. ✅ Overall Integration Status

| Feature | Status | Blocks Web Integration? |
|---------|--------|------------------------|
| Tagalog notifications | ✅ COMPLETE | No |
| Middle Initial fix | ✅ COMPLETE | No |
| Trucking company display | ✅ COMPLETE | No |
| Strict geo-tracking | ✅ COMPLETE | Yes — sysu-app Railway map depends on this |
| OBD/POD lock until trip starts | ✅ COMPLETE | No |
| History dialog (sap_assignments fallback chain) | ✅ COMPLETE | No |
| Per-shipment returnStatus mirror | ✅ COMPLETE | No — backward-compatible |
| Modular checklist | ✅ COMPLETE | This file |

---

## 5B. 📜 Schema: Per-Shipment Return Outcome Mirror

**Problem:** `drivers.{uid}.returnStatus` and `drivers.{uid}.returnedToBaseAt` are
**single-value, get overwritten** on every return-to-base cycle. Querying past
trips by those fields loses history (only the LAST cycle is visible).

**Solution (2026-08-10):** Mirror the driver-level return outcome into each
`sap_assignments.{docId}` document at the moment of confirm arrival. This makes
the per-shipment document carry its own complete lifecycle.

### Schema comparison

| Field | Where | Persists across trips? |
|---|---|---|
| `drivers.{uid}.returnStatus` | driver doc | ❌ — single value, overwritten |
| `drivers.{uid}.returnedToBaseAt` | driver doc | ❌ — single value, overwritten |
| `drivers.{uid}.sessionHistory[]` | driver doc, array | ✅ — append-only, last 50 |
| `sap_assignments.{docId}.returnStatus` | per-shipment doc | ✅ — JOINED 2026-08-10 |
| `sap_assignments.{docId}.returnedToBaseAt` | per-shipment doc | ✅ — JOINED 2026-08-10 |
| `sap_assignments.{docId}.tripStatus` | per-shipment doc | ✅ — already correct |
| `sap_assignments.{docId}.completedAt` | per-shipment doc | ✅ — already correct |

### What writes these new fields

`ReturnToBaseBottomSheet.performConfirmArrival()` (line ~289-300):

```kotlin
val updates = mapOf(
    "tripStatus" to "completed",
    "completedAt" to now,
    "returnStatus" to "completed",      // NEW
    "returnedToBaseAt" to now           // NEW
)
for (docId in docIds) {
    db.collection("sap_assignments").document(docId).update(updates).await()
}
```

### Backward compatibility

- Legacy docs (created before this change) won't have `returnStatus` / `returnedToBaseAt`
  on `sap_assignments`. History dialog treats missing fields as "—" (silent skip).
- History dialog query is still `whereEqualTo("tripStatus", "completed")` — works
  for both legacy and new docs.

### Why not queue collection?

The queue doc's `driverId` field is `FieldValue.delete()`-ed on Confirm Arrival
(line 385 of `ReturnToBaseBottomSheet`), so the queue doc loses its link to the
driver. sap_assignments is the more durable per-trip record.

### Future work (for sysu-app team)

- Consider adding `returnStatus` and `returnedToBaseAt` to **every** sap_assignment
  update path (not just Confirm Arrival), so the per-shipment mirror is
  consistent across all writes.
- Decide whether `drivers.{uid}.returnStatus` should be **renamed** to
  `drivers.{uid}.currentReturnStatus` to clarify its lifecycle-state semantics.



---

## 6. file/docs

| File | Change Type |
|------|-------------|
| `res/values/strings.xml` | Full rewrite — Tagalog translations |
| `res/layout/activity_main.xml` | Scan hint, QR tutorial, Nav tutorial → Tagalog |
| `res/layout/activity_profile.xml` | `tvCompany` → ALL CAPS + bold |
| `utils/Sanitizer.kt` | New: `sanitizeCompanyName()` and `sanitizeDisplayName()` (from previous commit) |
| `utils/SessionManager.kt` | Previously updated with `sanitizeDisplayName` |
| `services/LocationServices.kt` | Strict guard in `handleLocation()`; Tagalog notification text; battery-low offline emit |
| `activities/TransitActivity.kt` | `performEndTrip()` stops GPS; Tagalog toasts. `transitionToReturningToBase()` is dead code — kept as documentation |
| `activities/ReturnToBaseBottomSheet.kt` | `performArrivedAtBase()` + `performConfirmArrival()` apply triple-stop pattern |
| `activities/MainActivity.kt` | Tagalog toasts; company sanitization apply |
| `activities/ProfileActivity.kt` | Added `Sanitizer` import; `sanitizeCompanyName` on both read paths |
| `adapter/MyTripTabAdapter.kt` | Tightened OBD row lock — only `in_transit` + `completed` allow unlock (was `loaded`/`in_transit`/`completed`) |
