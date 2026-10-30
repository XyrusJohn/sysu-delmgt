# Activity log

## 2026-10-27 — Seed shared local truck-company master data

Added an idempotent local MySQL startup seed for the 51 supplied forwarder codes and names. The web and Go backends both use `sysu_fleet_app`; their MySQL master-data services now return all 51 records as active. The Android registration dropdown remains its existing local resource list. Verified the local table was empty before seeding and each backend service returned 51 records after. No production database was touched.

## 2026-10-16 — Reconcile completed trips out of Overview Live Scans

The assignment snapshot now removes a live row/map marker when its linked trip becomes terminal, even if the driver's completion socket event was missed. Return-to-base assignments remain visible; when one linked shipment completes but another remains active, tracking follows the remaining shipment and ignores late fixes linked to the completed one. Focused lifecycle/map tests passed 92/92; full frontend suite passed 160/160; Vite production build passed; ESLint reported 0 errors and 66 warnings. Local only; no production deployment.

## 2026-10-16 - Grouped Dispatch Details by Ship-To location

Dispatch Details now combines OBDs with matching Ship-To, customer name, delivery address, and normalized coordinates into one summary row with summed cargo metrics. Expanding the row retains individual OBD amounts, POD previews, and delivery outcomes; incomplete location identity stays ungrouped. Focused delivery-filter tests passed 36/36, targeted ESLint had 0 errors and reported 13 warnings, and the Vite production build passed. No production deployment.

## 2026-10-16 — Restore assigned shipment detail fields across status filters

Added an active-staff-only SAP detail projection for existing assignments and merged it into the shared shipment groups used by every status filter. Restored per-OBD amount, volume, weight, Ship-To, delivery address, coordinates, route, planning date, and available delivery date without adding these fields to driver-readable Firestore assignments. Frontend delivery-filter tests passed 34/34; focused backend SAP/scoping/authorization tests passed 19/19. Local only; no production deployment.

## 2026-10-16 — Per-OBD delivery outcome in Dispatch Details

Added Delivery Status beside POD Preview using assignment line-item `deliveryStatus` only when `isPodCompleted` is true. Maps All Delivered to Delivered, preserves Rejected and Delivered w/ rejection, and shows Pending POD or Unknown without guessing. Existing assignment snapshots refresh an open detail modal; the table scrolls horizontally on narrow screens. Focused dashboard tests passed 26/26 and the Vite build passed. No API/schema changes or deployment; live phone-to-web acceptance remains pending.

## 2026-10-14 — Overview map marker lifecycle

Fixed completed-trip marker resurrection from later status-only events and corrected overview reload colors for saved positions: active saved locations await live GPS in violet, while return-to-base remains blue. Completion removes the marker until a new verified active-shipment GPS fix arrives. Validation: frontend 25/25, location-handler review 15/15, production build successful; deployed to Firebase Hosting project `sysu-web-5a25d` and verified dashboard/bundle HTTP 200. No mobile/backend change or operational data write.

## 2026-10-14 — User-requested controlled beta deployment

Deployed the runtime-only mobile own-position controller/route changes to the existing production service; Railway `5c2b152a-714d-46a8-9b33-6f6a3be41afd` SUCCESS. Web source matches its already deployed artifact. Post-deploy health, queue/CORS, both authenticated sockets, private-route anonymous/staff denial and six availability observations pass. Retained exact prior runtime for rollback; APK SHA-256 remains `ff42edc20a4773aa1b976e5603d23708e35281f9dc37762f88b39ba45faa9111`. Three static RELRO checks remain failed; no general release sign-off. No trip/GPS/permission writes, rule/secret/infrastructure edits, commit or push. [Evidence](controlled-beta-deployment-2026-10-14.md).

## 2026-10-14 — Native automation and release regression

Added isolated paired native Kotlin-to-web tests and reproducible runners, with synthetic Firebase fixtures and actual local web/mobile services. After user-approved CameraX/ML Kit updates, native UI/camera 16/16, strict 16 KB runtime smoke 2/2, paired native-to-web 4/4, browser regression 16/16, mobile backend 140/140 and shared local Firestore contracts 29/29 per repository pass; frontend 105/105 and web backend 153/153 passed in this batch. Fixed QR footer test interaction and GPS fixture publication timing. Emulator system/transport failures did not recur after using a 2,048 MB guest and a 384 MB Firestore JVM; final registration HTTP 200 took 887 ms. Three of six static RELRO checks still fail, retained as G-30 IN PROGRESS. [Evidence](automated-release-validation.md). No deployment, commit or push.

## 2026-10-09: phone-to-web tracking

Real browser regressions exposed a first secondary-socket connection lost during token refresh and a fresh GPS fix retaining offline status. Fixed with current-account auth checks preserved. Both tested backends deployed; approved super-admin activation verified. Exact test/deployment evidence and actual-phone acceptance remain in the [canonical tracking plan](live-location-optimization-plan.md#implementation-checkpoint--2026-10-09). No commit/push or rules/dependency changes.


## 2026-10-15 ? Second-brain scan follow-up

Aligned HTTP, socket, QR and staff transaction account checks with explicit active status. Location persistence now reserves in-flight work and backs off empty/failed attempts for 30 seconds while retaining the successful-write movement/time throttle. Validation: 25 focused unit tests passed across authorization, socket, role review and staff driver suites. No production changes or account migration performed; profiles without active status now lose access.


## 2026-10-15 — Documentation navigation refresh

Replaced the outdated long-form root overview with a concise setup and documentation map, corrected the testing-setup pointer, and preserved the former Claude QR plan in the archive. Verified 26 Markdown files have resolvable relative links. The R06 dependency-install workflow and dated production/test evidence remain open for their existing owners. No application code changed; no tests or build were run for this documentation-only update.

## 2026-10-21 -- SAP and assignment empty/error feedback

SAP outages now remain distinct from confirmed empty shipment results: failed refreshes preserve the last successful shipment snapshot, show a retryable alert, and no longer produce a false success notice. SAP status filters/searches render explicit empty messages; Assign flows distinguish unavailable/loading data from genuine no-match results. Dispatch Detail now shows a retryable warning if SAP-only field enrichment fails while preserving saved assignment/POD rows. Frontend tests passed 197/197, Vite production build passed, targeted ESLint had 0 errors and 11 existing warnings, and git diff --check passed. Local only; no deployment, commit, or push.

## 2026-10-26 -- Local MySQL and SAP readiness

Aligned the ignored frontend Vite endpoint overrides to the App backend on port 3000; Vite proxy now reaches App API and Socket.IO. Configured the owner-provided SAP OData URL in ignored `backend/.env.local`; authenticated shipment reads through App and Vite returned HTTP 200 with 83 rows (payload not recorded). App backend suite passed 187/187 and frontend suite passed 223/223 under Node 24. Cross-app registration/login and authenticated Socket.IO smoke checks passed with temporary rows/sessions cleaned up. Local MySQL currently has no driver profiles, queue entries, assignments, live locations or trucking companies; historical Firestore records were intentionally not imported. No production deployment.

## 2026-10-27 -- Username-only local auth schema

Added a guarded forward migration that removes the Firebase UID column/index and restricts auth identities to username/password after checking existing rows. Local migration ran twice successfully; verification found four username identities and no Firebase UID column. Removed two stale Firebase keys from the ignored backend `.env` while preserving all other values. App backend tests passed 187/187, frontend tests passed 223/223, and backend lint passed. Live App readiness, port-5175 CORS, Vite-proxy login/logout, and App/Go MySQL-session plus Socket.IO authentication checks passed. The Go Android emulator unit-test task passed after replacing ML Kit's transitive Firebase runtime artifacts with local ZXing QR decoding. No historical Firestore records were imported.

## 2026-10-27 - SYSU Go live-location diagnostics

Added development-only connection and update-result diagnostics for the Overview's dedicated SYSU Go Socket.IO connection. Validation: focused map/live-tracking tests passed 84/84. The end-to-end mobile event is acknowledged only after the Go backend persists and broadcasts the fix; physical-device/browser receipt remains to be verified.
## 2026-10-27 - SYSU Go live-location clock-skew fix

The Overview marker stopped because the Go backend rejected fresh phone GPS updates as STALE_LOCATION: mobile timestamps used the phone wall clock, while freshness checks used the PC/server clock. Phone clock was about 7 seconds ahead. SYSU Go now sends monotonic fix age, the server calculates sample time relative to receipt, and its ACK follows persistence and tracking-room broadcast. Installed the rebuilt APK on the connected test phone; subsequent logs repeatedly confirm persisted/broadcast updates and one tracking-room recipient. Go health returned HTTP 200. Frontend regression suite passed 224/224; a direct Socket.IO-to-Overview-marker test verifies state and map update. Browser marker movement was not visually observed, so that UI behavior remains to be confirmed in the open browser. No production deployment.
## 2026-10-27 - Remove active Firebase integration remnants

Audited the active App frontend/backend and Go Android/backend paths. Removed the App emulator-only release CI commands and config, Firebase-named debug/test scratch artifacts and stale browser review harness, the obsolete Go emulator rule runner and index note, and Firebase Hosting defaults. QR links now use the current frontend origin; Go parses validated token links without a pinned frontend domain. Updated staging configuration to require an explicitly supplied CORS allowlist. Kept the SQL forward migration/preflight that safely handles legacy identities, credential ignore patterns, and dated historical records. Verification: App backend 188/188; frontend 225/225; Go backend 180/180; Android debug unit tests 96/96; Android debug APK build passed; frontend e2e build passed. App lint: 0 errors, 49 warnings. A plain `npm run build` was correctly blocked by the existing required `VITE_RELEASE_TARGET=production` guard; no production build or deployment was attempted.


## 2026-10-27 - Environment file consolidation
Consolidated App backend runtime settings into ignored sysu-app/backend/.env, Vite settings into ignored sysu-app/frontend/.env, and Go backend settings into ignored sysu-go/backend/.env. Kept one .env.example beside each runtime; removed duplicate local/development files and retired the staging env profile with invalid placeholder endpoints. Updated loaders and MySQL setup scripts. App API drops DB_ADMIN_* from its runtime process; the setup subprocess retains it. App backend tests 188/188, Go backend tests 180/180, frontend tests 225/225, backend lint and Vite e2e build passed. Secrets were not recorded.

## 2026-10-27 - Cross-app system diagnostics
Added allowlisted diagnostic context and a Start diagnostics action that checks App readiness, Go API health, and current App/Go socket states; reports can be downloaded as sanitized JSON. Added the authenticated, rate-limited Go mobile diagnostics ingestion route and 5xx response logging using the existing MySQL diagnostics table. Android failures now include app version and reduced source frame; the empty-log view no longer loops reloads. See `system-diagnostics.md` for data boundaries and deployment prerequisites.

Verification: frontend focused tests 40/40 and full suite 228/228; Go backend suite 184/184; Android unit tests and Kotlin compile passed; Vite e2e build passed; frontend ESLint 0 errors (49 existing unused-variable warnings). App backend focused diagnostics tests passed 5/5; its full suite had 188/189 pass with an unrelated existing POD socket-handler test failure. Production shared-database configuration and live service/device reporting remain unverified.

## 2026-10-28 - Bounded offline truck-company reference cache

Added an account-keyed browser snapshot for the authenticated truck-company reference list only. The cache is versioned, capped at 2,000 rows/256 KiB, expires after 24 hours, and is cleared on logout, account switch, or authorization loss. Cached rows are visibly labeled with their Asia/Manila update time and management controls are disabled until a live snapshot arrives. No API responses, session tokens, assignments, queues, GPS, or actions are cached.

Verification: frontend suite passed 283 tests (1 skipped); focused cache/auth/dashboard/document tests passed. Production Vite build remained blocked by the required production release target and HTTPS endpoint configuration; no deployment was performed.

## 2026-10-28 - Driver-wide shipment activity CSV export
Moved Shipment and date filters plus Export CSV from each session card to one panel for the selected driver. Shipment and date searches now filter the visible session rows, and export retrieves paginated saved sessions and event pages while preserving session-specific shipment linking and TMS timing. Existing per-session map and timeline controls remain. Export is capped at 2,000 sessions and 50,000 actions.

Verification: frontend suite passed 284 tests (1 skipped), including cross-session export and shipment-search coverage. ESLint was unavailable at the configured path; production build was blocked by the existing required `VITE_RELEASE_TARGET=production` guard. No deployment or live database export was performed.

## 2026-10-28 - Driver Action shipment lookup

Added a staff-only shipment-number prefix search to the Driver Action directory. It queries saved, unexpired activity in undeleted sessions through an indexed generated shipment reference, lists matching drivers, and opens the selected driver with the shipment filter already applied. Added migrations 017 and 018 and documented the required deployment order. A follow-up allows shipment searches by the leading or trailing digits.

Verification: App frontend suite passed 286 tests (1 skipped); Go backend suite passed 200 tests. git diff --check passed. No live database migration, LAMP deployment, or production verification was performed.

## 2026-10-29 - Manual Driver Action retention and removal

Added MySQL migrations 019/020 to remove automatic 90-day expiry and permit the existing admin-approved website flow to permanently remove a session and its action/GPS rows while preserving the removal-request audit. Local database setup now applies both migrations. SYSU Go now stores driver-action expiry as NULL and no longer filters or deletes records by age.

Verification: SYSU Go Driver Action and socket authorization tests passed; App Driver Action UI tests passed; migration setup script syntax checked. Migrations were not run against a database and no deployment was performed.

## 2026-10-29 - Diagnostics retry amplification

Diagnostics report and recovery requests now release their own idempotency reservation after a 5xx, while other mutations preserve existing replay protection. The browser coalesces recovery calls, applies account-scoped exponential backoff, and backs off queued reports. Admin Socket.IO notifications are best-effort after diagnostics writes so notification failure does not misreport a saved record as failed.

Verification: focused App backend diagnostics/idempotency tests passed 23/23 and frontend diagnostics tests passed 11/11; local readiness and liveness returned HTTP 200. Original historical database/schema failure is unconfirmed; no live production logs or database were inspected.
