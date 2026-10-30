# Controlled beta: SYSU App web and SYSU Go Android

This is a dated acceptance record. Check current finding status in [FIX_TRACKER](FIX_TRACKER.md); historical test counts below are scoped to their recorded runs and do not certify current production behavior.

## Automation checkpoint — 2026-10-14

- [x] Native UI/camera 16/16, mobile backend 140/140, shared local Firestore contracts 29/29 per repository, frontend 105/105 and web backend 153/153 pass.
- [x] Browser regression 16/16, zero failed/skipped/retries; compiled liveTest network policy, signature and ZIP page alignment pass.
- [x] Expanded native-to-web final run 4/4, zero failed/skipped/retries. [Automated release validation](automated-release-validation.md).
- [x] G-30: approved CameraX/ML Kit updates, build/unit/lint/signature/ZIP checks and strict 16 KB camera/QR runtime smoke 2/2 pass.
- [ ] G-30: three vendor-library static RELRO alignment failures remain; runtime smoke does not close this gate.
- [x] Matching mobile backend deployed as user-requested controlled beta: `5c2b152a-714d-46a8-9b33-6f6a3be41afd` SUCCESS; live health/queue/CORS/authenticated socket checks and availability samples pass. [Rollout and rollback](controlled-beta-deployment-2026-10-14.md).
- [ ] User installs the tested matching APK and performs actual-trip acceptance. Strict production policies, owner signing and IAM evidence retain separate approval/verification gates; G-30 remains open.

## Immediate queue recovery — 2026-10-09

Use the [workspace plan](../../production-recovery-plan.md) and [current web tracker](FIX_TRACKER.md). These items must be checked from deployed behavior, not local unit totals.

- [x] W-08/G-29 tracking review and implementation/test plan prepared. [Canonical plan and executed counts](live-location-optimization-plan.md).
- [x] Implement and run tracking regression suites; nineteen review checks and sixteen desktop/mobile-web browser cases pass. Both backends deployed and authenticated production checks pass. [Evidence](live-location-optimization-plan.md#implementation-checkpoint--2026-10-09).
- [ ] Install the updated tracking APK; verify actual-phone GPS freshness, background/reconnect/return/closure and measure latency/write counts.
- [ ] W-05: show accurate registered-driver cards with authorized details; pass plan Q06–Q10 alongside mobile G-27.
- [x] W-05 implementation, automated card/registration checks and web/backend/index deployment verified. [Executed evidence](archive/queue-card-recovery-2026-10-09.md). Q10 actual-phone acceptance remains open.

- [ ] W-03: production web `queue` status/entryTime index and Queue endpoint pass (verified); hosted page and actual registration still need acceptance.
- [ ] G-26: mobile registered-queue index and exact read-only query pass (verified); authorized API read and actual registration still need acceptance.
- [x] W-04: emulator fixture/timing failure diagnosed; disabled-session repeats 6/6 and full browser suite 12/12, zero failed/skipped, no automatic retries. [Evidence](archive/queue-card-recovery-2026-10-09.md#w-04-browser-harness-recovery).
- [x] W-06: legacy super-admin queue-cards 403 fixed/deployed; backend 148/148 and browser 14/14 pass. User confirmed the registered AUV driver card appears in the production kiosk. Full trip and queue-number agreement retain separate acceptance gates.
- [x] W-07: exact-origin CORS precedes API limits; kiosk GET polling has a separate bounded quota. Backend 153/153 and deployed checks 20/20 pass (eight initial probes plus twelve reads at five-second intervals); Railway deployment SUCCESS. User confirmed QR/card visible and no new CORS errors. [Evidence](archive/queue-card-recovery-2026-10-09.md#w-07-kiosk-cors-and-polling-quota).
- [x] G-28 mobile numbering implemented; current web backend 149/149 includes 3→2→1 projection regression. [Mobile checks and updated APK](../../sysu-go/docs/queue-position-recovery-2026-10-09.md). Actual phone/web position acceptance remains pending after installation.
- [ ] S01–S05: real Android login, QR, trip registration, web Queue and FIFO/duplicate checks.
- [ ] S06–S08: assignment/OBDs, loading/capacity, transit/location agree across apps.
- [ ] S09–S12: POD preview, delivery/return/next trip, cancellation/reassignment, recovery.
- [ ] Record intended APK and deployed web/backend/index versions plus sanitized expected/actual results.

The 347 passed / 1 failed automated and 12 passed / 2 failed production figures are the pre-recovery baseline. Current additional checks: guarded mobile integration 47/47, Android debug/release unit tests 106/106; both exact queue queries and public Queue endpoint HTTP 200. Complete phone-to-web acceptance remains unverified.

Historical checkpoint: 2026-10-09. Requested scope: selected real drivers and real shipments in the existing production Firebase database. **At that checkpoint: NO-GO for distributing the new version to real drivers.** The subsequent user-requested controlled beta and current evidence are recorded above; broader general-release gates remain unclosed.

Canonical finding status lives in [web FIX_TRACKER](FIX_TRACKER.md) and [mobile FIX_TRACKER](../../sysu-go/docs/FIX_TRACKER.md). This document owns the smaller controlled-beta gate, not the full public-release checklist. Executed checks live in each repository's dated RELEASE_FIXES_TDD.md evidence.

## Minimum before real-data beta

| Gate | Evidence needed | Current gap |
|---|---|---|
| Critical security | Deployed Auth/role/ownership/privacy policy for both backends and shared rules; exposed service-account key invalidated and replacement verified | Local socket/API/rules fixes exist. Deployed policy, real Auth acceptance and G-24 IAM invalidation are unverified |
| Required mobile contracts | Owned profile, location, assignment/OBD progress and POD/Storage work with the reviewed rules; unauthorized writes remain denied | G-16/G-19 location/POD/legacy profile work remains. Strict rules must not be deployed alone |
| Exact deployable versions | Fixed web/backend commits and reviewed production config; Android application ID, version, signing certificate and endpoints match the intended driver update | No new version deployed. Debug is demo-only; current release APK is unsigned. Existing installed APK/signing identity is unknown |
| Compatibility and recovery | Prove current non-pilot clients remain usable or coordinate their upgrade; validate legacy account status/UID/schema and a recovery plan | Both services share a live database. Tightened rules/Auth and retired routes can affect existing clients; emulator success is insufficient |
| One supervised cross-app run | On an actual Android device: approved login → QR admission → staff assignment with multiple OBDs → loading/transit/location → POD → web display → completion; logout/reconnect and denied cross-driver access | No device connected to adb; no actual Android-to-web acceptance run |
| Pilot control | Named driver/staff participants, limited planned shipments, operator observing outcomes, previous APK/web/backend/config and data recovery reference available | Participants, installed version and rollout/recovery owner not recorded |

The beta can start once these gates are proven for its agreed scope. Public-release CI, broader device/accessibility coverage and full load/soak remain on the release trackers; they are not all prerequisites for a small supervised pilot. A broken or unsafe required beta flow cannot be substituted with a disclaimer.

## Rollout order

1. Finish and verify the required mobile contracts locally. Inventory the installed driver's APK and legacy accounts without changing operational data.
2. Rehearse the selected workflow using synthetic data and the exact intended web/backend/Android configuration. Prepare a signed production-configured pilot APK using the correct owner-controlled key; do not give drivers the demo debug APK or the unsigned release APK.
3. Review the coordinated change set, configuration/rules/index versions, client compatibility and recovery procedure. Changes to shared production rules affect all clients, even when only a few drivers participate.
4. Apply the reviewed changes through the release owner's rollout process; verify deployed behavior and the supervised device workflow before allowing further real shipments. Local fixes are not automatically present in the currently deployed system.
5. Begin the small selected cohort and record each shipment outcome. Stop on unauthorized data access, lost/duplicated admission, wrong assignment/OBD, missing POD, crashes blocking work or ambiguous state. Capture identifiers/timestamps and sanitized errors; retain sensitive evidence in the approved operational system.

## Metrics during beta

Collect crashes/ANRs, QR success/conflict/timeout, assignment/progress/POD success, web-update delay, socket reconnect/expiry behavior, API error/latency and device network/battery behavior. Record device/OS/app and server/config versions with each observation. These measurements can be gathered during the supervised pilot; they do not replace the pre-beta security and workflow proof. Agree operating thresholds from the existing operation and the first supervised run rather than inventing unsupported production capacity claims.

No production database, rules, deployment, IAM key, installed driver application or signing configuration has been changed by this local beta-preparation batch.

## 2026-10-09 local fix checkpoint

Hosting update: current frontend built and deployed successfully to the existing Firebase Hosting site. Live root/dashboard/QR pages match the current build exactly and return 200. This supersedes the earlier statement that Hosting deployment was unverified; Firebase rules and phone workflows remain unverified.

Production update: [Railway startup recovery](archive/PRODUCTION_RECOVERY_2026-10-09.md) now proves both backend deployments SUCCESS and passing production health/CORS checks. Earlier statements that no Railway changes had been performed refer to the prior local batch; real configuration repair and restarts have now occurred. Firebase Hosting/rules, APK installation and complete authenticated acceptance have not been verified by this recovery.

Workstation startup correction: see [tomorrow's testing setup](TOMORROW_TESTING.md). Web now explicitly supports existing Firebase with a localhost backend only during the opted-in Vite development server; all 64 frontend tests pass. Backend Firebase readiness returns HTTP 200. A separate liveTest mobile APK uses existing Firebase/services with emulators disabled, signed by the machine's debug key; assemble/lint and 42 unit tests pass, and its APK signature verifies. Device acceptance, installed-certificate compatibility and deployment of the matching mobile backend remain unverified.

Latest local evidence is GREEN: sysu-go backend 119/119, shared Firestore profile/location contracts 24/24, atomic POD emulator transaction 1/1, mobile socket lifecycle regressions 2/2, Android session-gate unit test 3/3, and Android debug/release unit tests, lint, and assemble tasks all BUILD SUCCESSFUL. The duplicate rules-function regression found by the first contract run was removed and the suite rerun successfully. These are local/demo-emulator results; deployment, IAM rotation, signing, and actual-device gates remain open.
