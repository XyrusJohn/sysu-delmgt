# Activity log

## 2026-10-27 — Registration feedback and seeded master-data verification

The mobile auth client now presents a clear retry message for HTTP 429 instead of the generic account-request error. The shared local `sysu_fleet_app` database now has 51 active truck-company records; both App and Go MySQL master-data services return all 51. Rebuilt `phoneLocal` APK for workstation host `192.168.100.4`; phoneLocal and emulator unit tests pass 93/93 each. Device-side registration was not available to verify in this environment.

## 2026-10-27 — Phone-local registration build

Corrected the Android registration password hint from 12 to 8 characters to match client validation and MySQL backend policy (8–128). Added an opt-in `phoneLocal` build variant configured by `sysuPhoneLocalHost`, with private-LAN URL validation and local-only cleartext policy; emulator and production endpoints remain isolated. Verification: phoneLocal APK assembled; Android tests 92/92; Go API health returned 200 through workstation LAN IPv4. Physical-phone installation and registration acceptance remain unverified because no `adb` executable/device is available in this environment.

## 2026-10-14 — Blank company trip-registration recovery

Affected: Android registration/profile/home/session and GO trip controller. Preserved registration's company across profile reads, added editable company validation before QR admission, recovered ambiguous owned QR admission by token, and persisted the confirmed company in the driver profile. Verification: backend 148/148; Android unit 81/81; native workflow 16/16; liveTest build, signature and ZIP alignment pass. Controlled beta deployment `64aea5f6-beec-4a75-a984-6a8c616ba2b1` SUCCESS; health 200 and anonymous trip registration 401. Pending: install the new APK, confirm phone-to-web registration, and resolve the three static RELRO release checks.

## 2026-10-14 — Registration confirmation recovery

Fixed ambiguous phone registration responses and provisional queue display. The backend accepts only an identical committed registration retry without writing again; the app checks the server queue state before showing a failure after transport or server errors, and shows pending registration until confirmed. Deployed backend runtime to existing controlled beta as `0aeeed39-a40d-4d7e-ab10-448b83b15b28` SUCCESS; health 200, private unauthenticated route 401. Verified backend 144/144, Android unit 81/81, native Android 15 workflow 15/15, liveTest APK build and ZIP alignment. Physical phone acceptance and three static RELRO failures remain open. No Firestore rules, data migration, production secrets, infrastructure settings, commit or push.

## 2026-10-14 — Controlled beta matching backend live

User requested deployment after the remaining Android compatibility failures were explained. Runtime-only private-rank controller/route changes deployed to the existing service: `5c2b152a-714d-46a8-9b33-6f6a3be41afd` SUCCESS. Production health/queue/CORS/authenticated sockets and six availability observations pass; new endpoint denies anonymous access with 401 and staff with 403. Exact old runtime retained for rollback. Matching signed APK is ready for user installation; three static RELRO failures and broader release/device gates remain open. No operational trip/GPS/permission writes or rule/secret/infrastructure edits; no commit/push. [Evidence](../../sysu-app/docs/controlled-beta-deployment-2026-10-14.md).

## 2026-10-14 — Native queue/tracking and artifact verification

Added native workflow and real Kotlin-to-web automation using existing tooling. Fixed cached shipment snapshots mutating authoritative tracking state, replaced cross-driver queue reads with authenticated own-rank polling, disabled app backup, and aligned liveTest resources with release network policy. Applied user-approved CameraX 1.6.2 / ML Kit 17.3.0. Native UI/camera 16/16, strict 16 KB camera/QR smoke 2/2, paired native-to-web 4/4, browser regression 16/16, backend 140/140, debug/release units 79/79 each and mirrored local Firestore contracts 29/29 per policy pass. Local policy changes are undeployed; broader guard/POD/signing/IAM/device gates remain. G-30 retains three static RELRO failures despite passing runtime smoke, signature and ZIP/load alignment. [Final evidence](../../sysu-app/docs/automated-release-validation.md). No production writes, commit or push.

## 2026-10-09 — Dynamic registered queue positions (G-28)

Aligned Home and Queue Details with registered/unassigned waiting/called web eligibility and timestamp/document-ID order. Details now listens for peer changes; waiting admissions cannot load historical assignments over the position. Empty/ineligible entries have no invented number; listeners are cleaned up and guarded against queue/status changes.

Verification: legacy predicate 3/8 passed / 5 failed; final debug/release 138/138 executions, web backend 149/149, mobile backend 119/119 on required Node 24, APK build/lint/signature checks pass. An unsupported system Node 20 run had one cancelled case before the successful Node 24 rerun. Updated production-configured APK is built; no phone/AVD available, so installation and live numbering acceptance remain pending. [Evidence](queue-position-recovery-2026-10-09.md). No database changes, commit or push.

## 2026-10-09 — Queue confirmation authentication and completion

Fixed bounded Firebase token refresh after queue HTTP 401 and connected queue admission to trip registration. Removed confirmation success on registration errors and preserved admitted queue identity for retries and recreation. Affected Activity, QR transport/service, new confirmation flow, and regression tests; unrelated user edits preserved.

Verification: new QR regression executed RED before recovery fix; final Android 53/53, backend authorization/ownership 39/39, debug APK build, QR transport 100% lines / 92.31% branches, whitespace check, and code/security review passed. No device connected. Exact production 401 cause and Android-to-web confirmation remain unverified; long combined helper names and lost registration responses need follow-up. See [TDD evidence](queue-confirmation-tdd.md). No commit, push, deploy, or install.

Production-configured `liveTest` beta APK also built successfully with its required lint check; generated configuration confirms production API and Firebase emulators disabled. Artifact identity is recorded in the TDD evidence.

## 2026-10-09: tracking regression and production compatibility

One mobile sender and guarded checkpoints; shared web ordering/freshness and marker reuse; backend timestamp/replay/closure and delayed-disconnect protections. Real browser tests found and fixed first-connect token-refresh and offline recovery defects. Approved existing super-admin profile activation verified without changing its role. Both tested backends deployed; current APK built/signed. Automated evidence and remaining actual-phone gates are owned by the [tracking plan](../../sysu-app/docs/live-location-optimization-plan.md#implementation-checkpoint--2026-10-09). No commit/push or rules/dependency changes.

## 2026-10-14 — Registration company persistence and provisional queue display

Confirmed company was only retained on-device during account registration and erased by pending login session clearing. Added persistent user company, bounded local rule support, login fallback, legacy driver alias reading, explicit unconfirmed queue display, and pre-admission API length validation. Backend registration tests passed 18/18; focused Android compilation/tests and whitespace check passed. New rules regression remains unexecuted without the Firestore emulator. Production rule reconciliation/deployment and device acceptance remain pending; no migration or production changes made. See [review and release requirements](registration-company-review.md).



## 2026-10-15 ? Second-brain scan follow-up

Corrected README prerequisite to Node 24.x and documented required Firebase environment isolation and safe local emulator configuration. Documentation-only change; configuration checked against backend/package.json, backend/.env.example and backend/config/runtimeConfig.js.


## 2026-10-15 — Documentation consolidation verification

Verified that the root README routes readers to the current Android/backend guides, the docs index distinguishes active guidance from archived records, and former app/backend and integration documents are preserved under docs/archive/. All 81 Markdown files have resolvable relative links. No app code changed and no tests or build were run for this documentation review.
## 2026-10-26 — Local MySQL driver tracking slice

Added shared `app_driver_live_locations` MySQL schema/bootstrap migration and a Go SQL repository. Accepted GPS samples are saved before Socket.IO map broadcasts, and staff connections replay saved active rows. MySQL 8.0.46 bootstrap, synthetic location round-trip/stale-sample check, App backend tests (198/198), Go backend tests (195/195), and local frontend/API health checks passed. Assignment authorization, socket identity, protected APIs, realtime data subscriptions, and Android identity/data still use Firebase; migration remains incomplete.

## 2026-10-26 -- Local migration regression verification

SYSU Go backend suite passed 167/167 under Node 24. Emulator Kotlin compile and unit tests passed; after cleaning generated `app/build` outputs that contained deleted Firebase instrumentation classes, connected Android instrumentation ran and passed 5/5 on the API 37 QA AVD. The emulator build installed and opened LoginActivity. App and Go local auth and authenticated Socket.IO connections were verified against shared MySQL. No physical-device camera/GPS/QR workflow or production deployment was tested; historical Firestore data was intentionally not imported. The current default shell remains Node 20.20.2 despite the package engine requirement of Node 24.x.

## 2026-10-27 -- Remove transitive Firebase QR runtime libraries

Replaced ML Kit barcode decoding with CameraX Y-plane frames decoded locally by ZXing 3.5.4. The decoder handles CameraX rotation and row/pixel strides; token parsing retains raw-token and configured-frontend URL QR formats. Emulator unit task passed with 89 tests, including six QR decoder/parser cases; dependency insight found no Firebase artifact in `emulatorRuntimeClasspath`. Current App readiness, Vite proxy login/logout, and cross-app MySQL session plus Socket.IO auth smoke checks passed. The temporary Go test server on port 3041 was stopped and the port verified closed; the user's App server on port 3000 was left running.

The expected `npm run dev` path on Go port 3001 and a fresh App process on temporary port 3040 both passed health/auth/socket checks; their test listeners were stopped afterward. The rebuilt APK installed on the API 37 AVD, but the emulator low-memory killer terminated the app UI before a device workflow could be verified. Removed the remaining unused Google Sign-In labels and web-client ID. The user-owned App/Vite listeners remain on 3000/5175; test ports and the AVD are closed.

## 2026-10-27 -- Point standard debug APK at local services

The standard `debug` variant used by Android Studio Run and `app-debug.apk` was still configured for the hosted API, while the user's account-registration flow expected the local Go backend. Debug now uses the configured private LAN host (default `192.168.100.4`) for API, Socket.IO and frontend URLs, with debug-only cleartext networking; release remains hosted and HTTPS-only. Updated README instructions and the environment isolation regression test.

Verification: `:app:testDebugUnitTest :app:assembleDebug --offline --console=plain` passed; generated BuildConfig points to `http://192.168.100.4:3001`; local registration endpoint responded with expected `INVALID_USERNAME` to a harmless empty-payload probe. The physical phone flow was not available to verify from this session.

## 2026-10-27 -- Allow return start after all PODs are complete

Aligned the MySQL return-start transition with the Android tracking screen's readiness rule: an `in_transit` or `unloading` assignment may enter `returning_to_base` when all saved line items have completed PODs. The backend still rejects the transition if any POD is incomplete or the assignment is outside a delivery state.

Verification: the Go backend suite passed 170/170 under the available Node 20 runtime (the project declares Node 24); the running local API returned health 200 after its watcher restarted.

## 2026-10-27 -- Permit authorized web staff to preview driver POD images

The SYSU App dashboard reads saved POD images through the Go API using its MySQL staff session. The GET handler had been restricted to driver-role accounts, returning 403 to authenticated staff. Added read-only POD access for fleet managers, admins, and super admins; driver reads remain owner-scoped, while all POD write routes remain driver-only.

Verification: Go backend test suite passed (175 tests); local API health returned 200. Route tests cover driver ownership, staff preview access, denied roles, and staff write denial. No production service was changed.

## 2026-10-27 -- Explain return-arrival conflicts as GPS/state errors

The return API returned structured 409 codes such as `LOCATION_STALE` and `OUTSIDE_GEOFENCE`, but the Android client discarded the response body and the notifier showed a generic connection message. The client now maps known return codes to specific Tagalog guidance and retains the HTTP/code in diagnostic logs. Server-side location freshness and geofence enforcement are unchanged. The original device log did not preserve the API code, so its exact 409 cause is not retrospectively verified.

Verification: debug unit tests passed 96/96; `:app:assembleDebug` built the local `app-debug.apk`. Physical-device arrival behavior remains unverified; the updated APK is required to see the improved message.

## 2026-10-27 - GPS Socket Delivery Acknowledgment

SYSU Go now waits for a server acknowledgment before marking a GPS fix sent. The server acknowledges only after MySQL persistence and tracking-room broadcast, and reports rejection codes so the mobile service retries rejected or unacknowledged fixes. SYSU App dev mode logs Go tracking-socket connection and whether Overview applied each received fix. Validation: Go backend 178/178, focused App map/tracking tests 84/84, Android debug unit tests passed, and the local debug APK rebuilt. Physical-device delivery remains to be verified.
## 2026-10-27 - GPS clock-skew fix verified on device

Root cause of the stationary Overview marker was a timestamp-domain mismatch: SYSU Go sent phone wall-clock time while the backend judged freshness against the PC/server clock. The phone clock was about 7 seconds ahead, and otherwise fresh GPS fixes were rejected as STALE_LOCATION. The app now sends monotonic fix age; Go derives sample time from server receipt, persists the fix, broadcasts it, and ACKs with the number of staff tracking-room recipients. Rejections/timeouts remain retryable. The debug APK was installed on the connected test phone; subsequent logcat entries repeatedly show successful persistence/broadcast with recipients=1. Go health returned HTTP 200. Go focused socket/location tests passed 13/13; Android unit tests passed 96/96 and the debug APK built; SYSU App frontend suite passed 224/224. A frontend integration test verifies update_admin_map changes Overview state and invokes map marker update. Browser marker movement was not visually observed in this session; a tracking-room recipient was present. No production deployment.
## 2026-10-27 - Remove active Firebase integration remnants

Removed the Go QR scanner's pinned hosted-frontend origin and Firebase-era URL dependency; its parser now validates raw tokens or tokens in HTTP(S) URLs and rejects invalid schemes, user-info, and malformed tokens. The backend's default web origin is localhost. Removed the stale emulator rule runner and Firestore index note. Kept the historical migration records and retired emulator setup pointer for dated-link compatibility. Verification: Go backend suite 180/180; Android debug unit tests 96/96; `:app:assembleDebug` passed; App frontend/backend suites passed 225/225 and 188/188. This does not establish hosted deployment or physical QR scan behavior.


## 2026-10-27 - Environment file consolidation
SYSU Go backend now reads one ignored backend/.env; the shared App local MySQL setup prepares it. Kept the backend .env.example as the deployment template and updated current setup guidance. Go backend tests passed 180/180; App setup validation and frontend build passed. No credentials recorded.

## 2026-10-27 - System diagnostics ingestion
Restored authenticated `POST /api/system-errors/report` for mobile reports, added allowlisted context and 5xx API logging, and assigned server request references. Go writes to the existing `app_system_error_logs` table so SYSU App can display the events when both services share the same MySQL schema. Android reports include app version and a reduced app source frame.

Verification: Go backend suite 184/184; Android unit tests and Kotlin compile passed. Local schema is provisioned by SYSU App migration 015. Production DB sharing, table migration, insert permission, and account foreign-key compatibility must be verified before unified production diagnostics are relied on. Offline ordinary report retry and physical-device delivery are not covered by these checks.

## 2026-10-27 - Preserve driver presence across transient background socket drops

SYSU Go previously emitted an `offline` status on every Socket.IO disconnect, and the Go backend immediately broadcast `offline_in_transit` as soon as the final socket disappeared. Android background/OEM network pauses therefore changed the Overview marker to offline before reconnection. The client now leaves transient disconnect classification to server presence handling; the backend retains current presence during its existing 45-second heartbeat grace and marks genuinely stale drivers offline afterward. Explicit stop/logout status events remain unchanged.

Verification: Go backend suite passed 195/195, including transient disconnect/reconnect coverage; Android debug unit tests passed and `:app:assembleDebug` succeeded. ADB detected a connected phone, but no active trip was started and Google Maps foreground behavior was not physically exercised. No deployment was performed.

## 2026-10-28 - Account-scoped offline guard reference cache

Bound the existing active-guard snapshot cache to the signed-in driver, with a versioned 24-hour expiry and 2,000-row/256 KiB limits. Logout and account changes clear the matching cache. A cached list is shown with its Asia/Manila update time as read-only; guard selection stays disabled until a fresh authenticated Socket.IO snapshot arrives. Trip actions, location, assignments, queue state, and session credentials are not added to this cache.

Verification: full Android `:app:testDebugUnitTest` passed, including cache parsing, account-key, TTL, malformed-snapshot, and empty-snapshot cases. No device or production verification was performed.

## 2026-10-29 - Confirmed trip-history upload cleanup

Removed 90-day rejection from SYSU Go Driver Action uploads. On final server acknowledgement, the phone now removes that session's acknowledged action/location rows and session-only sequence/dedupe metadata, then opportunistically compacts the local SQLite file. Added an upload-pending/uploaded message at return-to-warehouse completion; unconfirmed records remain on device. Updated the driver audit notice to describe server retention and admin-approved website removal.

Verification: Android debug Kotlin compile, unit tests, and Android-test compilation passed; focused outbox instrumentation coverage was added but not run because `adb` is unavailable. No physical-device, shared-MySQL, or production verification was performed.

## 2026-10-29 - Diagnostics retry amplification

Go idempotency now releases the matching reservation after a 5xx only for diagnostics report and recovery endpoints. Other operations retain existing idempotent replay protection.

Verification: focused Go idempotency and diagnostics-route tests passed 10/10. The earlier mobile socket/profile failures and later App browser 503s were separate routes and timestamps; no production logs or database health at those times were available.
