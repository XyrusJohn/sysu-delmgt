# Mobile previous shipments and registered kiosk cards

Date: 2026-10-09. Scope: mobile G-27 and web W-05 in the canonical fix trackers. Small fixes to existing data selection, queue projection and renderer; no production records, rules, credentials or database schema were changed.

## G-27 implementation

`QueueShipmentPolicy.kt` selects work using the current queue link, existing queue shipment references and bounded legacy admission-time evidence. Previous completed records without return status no longer become current cards. Genuine current completed shipments remain available for the return flow until arrival is confirmed; explicit ongoing return states remain accessible. The policy is used by MainActivity's home and My Trip cards and by AssignmentActivity's active-card filter.

MainActivity processes empty snapshots, clears stale shipment cards while retaining a valid waiting queue, clears the expired queue session reference and ignores UID-listener callbacks from a different admission. The broad mobile write promoting every waiting/called queue to assigned was removed; the staff assignment transaction already writes the specific queue and assignment together. Unrelated existing Android changes were preserved.

Regression evidence: reproducing the original terminal-state predicate passed 3/8 policy cases and failed 5/8. The corrected policy passed all eight cases in both debug/release variants. Final debug/release unit tasks passed **122/122 executions**, zero failed/skipped. `:app:assembleLiveTest :app:lintLiveTest --offline` passed; APK signature verification passed. A transient implementation compile error was corrected before accepting these results.

Historical G-27 production-configured test APK: `sysu-go/app/build/outputs/apk/liveTest/app-liveTest.apk`, package `com.sysu.go`, workstation debug signing. SHA-256 at that checkpoint: `74230c28e4bcffcecb7041f4e2d10fc880616bca9d7a6347b39874b57647a54f`. This build was not installed on a verified phone and incorporated existing uncommitted mobile changes as well as G-27. G-28 subsequently replaced the file at this output path; [current APK identity and numbering checks](../../../sysu-go/docs/queue-position-recovery-2026-10-09.md).

## W-05 implementation

The shared kiosk query now requires registrationComplete=true and waiting/called status, groups by supported truck type, orders by entryTime with Firestore's document-ID tie order and omits already assigned records. The new `/api/qr/queue-cards` endpoint uses existing Firebase token and role authorization (active admin, super_admin or qr_generator) and returns only position, name, plate and status. The anonymous `/api/qr/queue-display` remains position-only.

The kiosk reuses the existing Firebase session; signed-in staff receive driver cards, while signed-out viewers get positions and a sign-in link. Card text is escaped, missing fields have safe defaults, logout clears identity fields immediately and stale authenticated responses are discarded. Polling and the shared server cache are five seconds each. Local browser runs use the configured backend URL rather than a hard-coded port.

Initial tests failed for the missing authorized projection/route and missing driver-card rendering. Final web backend suite: **146/146**. Final frontend suite: **81/81**, including six kiosk cases covering anonymous privacy, token use, text injection, defaults, errors and logout/in-flight responses. Frontend lint: zero errors, 64 existing warnings. Production build passed (78 modules).

Initial real browser/demo Firebase run: **11/12 passed** on desktop and Pixel 7 browser projects. The new kiosk scenario passed on both: unregistered entry absent → registration completes → name/plate card appears once → called badge → assignment removes the card. Existing assignment/cancellation/reassignment and delivery/POD display scenarios passed. The disabled-profile case failed during the emulator Admin SDK update with gRPC `2 UNKNOWN`, before the logout assertion (W-04). The final recovery run below supersedes that browser result. These runs do not test an Android device.

## W-04 browser harness recovery

Diagnostic focused run: **3/6 passed, 3 failed**. Two failures returned gRPC `2 UNKNOWN` even though authoritative read-back showed `status=disabled`. The emulator log recorded `Stream is already completed, no further calls are allowed` in commit/watch notification handling. The other failure exhausted the test budget; the trace showed external Leaflet CSS taking about 20 seconds and font requests taking several seconds.

`frontend/tests/e2e/release.e2e.js` now serves the installed Leaflet CSS and an empty external-font stylesheet for these functional tests. A failed disabled-profile write is accepted only when code 2 accompanies a newly logged closed-watch error and authoritative read-back confirms the requested state. Other errors still fail. Required browser assertions verify persisted disabled status, logout to visible login UI and rejected dashboard re-entry. No auth/rules checks were removed.

Post-fix focused repeats: **6/6 passed** (three desktop, three mobile-web). The first full rerun still passed 11/12 because its mobile login exceeded the default 5-second assertion: the trace showed a Google API script request taking 5.3 seconds before password login. Installed Firebase Auth source confirms proactive popup/iframe initialization on mobile browsers. The login assertion now waits for the actual dashboard URL for at most 15 seconds; the test budget remains 30 seconds.

Final full command: `node .tools/run-delivery-e2e.cjs` (Playwright `test release.e2e.js --reporter=list,json`, current-source isolated build and demo Auth/Firestore). Result: **12/12 passed, 0 failed, 0 skipped**, about 2.3 minutes, **retries=0**. Local ignored evidence: `.tools/w04-browser-full-result.json` and `.tools/w04-emulator-diagnostic.log`. JavaScript syntax check passed. This resolves W-04's harness blocker; the emulator closed-watch warning may still occur and must satisfy the explicit state and UX assertions. No production deployment or dependency change was needed.

## W-06 production super-admin 403

The user's actual kiosk session repeatedly returned 403 from `/api/qr/queue-cards`. A read-only projection of role/status fields confirmed a legacy super-admin profile without status. The new handler incorrectly required literal `active`, whereas existing role authorization accepts approved legacy profiles without that field. A new synthetic route regression reproduced **6/7 passed, 1 failed** with `legacySuper: 403 !== 200`.

The handler now retains existing approved legacy compatibility after token and staff-role authorization. Explicit inactive/disabled/null/unknown statuses remain denied; no account records, rules, permissions settings or secrets were edited. Added route tests cover missing status for super-admin/admin/QR-generator and explicit invalid-status denial. Backend suite passed **148/148**, zero failed/skipped. Browser coverage now includes the actual legacy super-admin profile shape; its first full run passed 13/14 because the new desktop assertion did not allow the existing 5-second cache/polling cycle. Trace showed queue-cards HTTP 200. The assertion now uses the same polling allowance as the existing kiosk flow. Final full rerun: **14/14 passed**, zero failed/skipped/flaky, retries=0, about 2.6 minutes; seven desktop and seven Pixel 7 browser cases. Machine-readable evidence: `.tools/queue-card-legacy-browser-result.json` (local ignored file).

Backend-only Railway hotfix `a0f7d493-9613-4d95-8c07-860542f20c26` completed **SUCCESS**. Its controller matches tested source by SHA-256; upload artifact contains no credential/environment files. Production liveness/readiness both HTTP 200; both backends remain healthy and CORS probes pass. Public registered queue HTTP 200 with one eligible AUV entry; anonymous private-card request remains HTTP 401 as required. No frontend deployment was needed.

The user confirmed **the AUV driver card appeared in the production QR Generator session after refresh**. This closes the 403/display blocker, not the full cross-app trip. Additional S05 observation: Android calculates position across all waiting/called entries, while the registered kiosk ranks only completed registrations. Two unregistered AUV entries plus one registered entry explain the reported mobile No. 3 versus the kiosk's registered-only rank; queue-number agreement remains pending and was not changed by this access hotfix.

## W-07 kiosk CORS and polling quota

The user reported missing CORS headers on queue-display, QR generation and authenticated queue-card preflight. Subsequent read-only live probes returned 200/204 with the expected hosted origin, so the original failed response status remains unconfirmed. Source inspection identified rate limiting before CORS and frequent five-second polling sharing the default 200-request/15-minute business quota. Four real Express middleware regression tests reproduced the resulting failures: **0/4 passed before the fix**.

The small `backend/src/server.js` fix registers the existing exact-origin CORS policy before API rate limits, so allowed OPTIONS requests terminate before quota accounting and 429 responses retain CORS headers. Only GET queue-display/queue-cards use a separate bounded **120 requests/minute/IP** shared quota. Other API limits and private-card token/role authorization remain in place. No dependency, schema, secret, permission or infrastructure-setting changes were made. The CORS fixture now extracts only its actual registration; new regressions exercise production middleware order, quota isolation and bounded polling.

Focused CORS/quota tests: **6/6 passed**. Full Node 24 backend suite: **153/153 passed**, zero failed/cancelled/skipped. Changed-server ESLint and `git diff --check` passed. Upload source matches tested backend; credential/environment files absent. Server SHA-256: `c42119da27c8edfbd85390e134958af9841bfc17f89438290354ba229b0f4c8c`.

Railway backend deployment `4ad63518-aaf3-4c23-804e-aa3e756ace1b` completed **SUCCESS**. Eight initial live assertions pass: health/live and health/ready 200, queue-display 200 with exact-origin CORS and the new 120/minute quota, private cards 401 without credentials, all three QR Authorization preflights 204 with exact-origin CORS and no rate-limit charge, and an untrusted-origin preflight 403 without a CORS grant. No QR generation or operational data mutation was performed by these probes.

An additional twelve queue-display reads at five-second intervals all passed, bringing deployed assertions to **20/20, zero failed**. The read-only probe consumed responses without printing driver fields. This short polling check does not represent a long-duration load test.

The user confirmed **QR and card visible; no new CORS errors** in the actual production kiosk after refresh. W-07 is closed for this reported incident; the original failed status remains unconfirmed and this result does not complete the separate Android/full-trip acceptance. No Android APK change is needed for W-07.

## Deployment and remaining acceptance

The exact registered-kiosk composite index (`registrationComplete`, `status`, `entryTime`, all ascending) was added to both checked-in index files. An index-only deployment preserved all nine existing live indexes. Production index `CICAgOi3voUK` is READY; live project now has ten indexes.

Web backend deployment `9c733482-021d-4990-a8fd-89128670b8f4` completed SUCCESS on the existing Railway sysu-app production service. Its isolated backend artifact matches the tested controller/routes. Firebase Hosting deployment completed successfully; served kiosk HTML and auth asset `qrGenerator-Qb4J8qQG.js` both return HTTP 200 and match the final local build by SHA-256. The driver-details Authorization preflight returns HTTP 204 with the exact hosted origin and allowed header.

Initial read-only production checkpoint: registered public queue HTTP 200, six truck groups and zero registered waiting/called cards; anonymous `/api/qr/queue-cards` HTTP 401 as required. The exact registered-kiosk index is ready. Authenticated staff rendering was initially proven only in demo browser tests. W-06 above adds the later actual production staff/phone-registration card confirmation. Installation/acceptance of the rebuilt mobile APK remains unverified; the latest artifact now includes G-28 and its identity is in the linked numbering evidence.

- [x] Confirm the deployed backend/hosting versions and read-only live responses.
- [ ] Install the rebuilt APK and verify old trip closure → new QR → registration → correct kiosk card → new assignment.
- [ ] Verify mobile empty/removal snapshots and current return-to-base UI on the actual phone.
- [ ] Keep G-27/W-05 IN PROGRESS until actual intended-version acceptance passes.
- [x] Close W-04 after diagnosed harness failures, focused 6/6 and full browser 12/12 acceptance.

Execution plan and Q01–Q10 scenarios: [workspace plan](../../../production-recovery-plan.md). Status owners: [web tracker](../FIX_TRACKER.md) and [mobile tracker](../../../sysu-go/docs/FIX_TRACKER.md).
