# SYSU-GO release test plan

Historical plan dated 2026-10-08. Check the current [fix tracker](FIX_TRACKER.md) and [emulator setup](LOCAL_EMULATOR_SETUP.md) before execution. This plan does not authorize live environment writes or publication. Use isolated emulator configuration for integration tests; public readiness depends on the listed gates, not an arbitrary test count.

## Ordered execution

1. Phase 0 baseline: reproduce debug/release compilation and full lint; portable signing/JDK; source-driven Kotlin/backend tests and safe demo variant. Use Gradle with installed JDK; backend node --test. Existing Android test copied queue sorting is not proof of shipped FIFO code.
2. Phase 1 exploit tests first: G-05/06 Auth/admin; rules escalation/cross-user access; QR mandatory Auth/atomic replay; dispatch/trip IDOR and state races; socket anonymous/foreign/revocation; private SAP and reachable route inventory. Every fix preserves valid own-user/staff paths and records executed RED/GREEN checkpoint before implementation.
3. Phase 2 Android business unit tests: production FIFO/status/date/identifier functions, retry and error classification, current-user state ownership, multiple dispatches/OBDs. Add meaningful tests at reusable seams; avoid broad architecture rewrites solely for testability. Measure changed logic coverage, not test fixture coverage.
4. Isolated integration: real Auth/Firestore/Storage emulators with guarded demo project and loopback endpoints; actual HTTP and Socket.IO, fault injection and concurrent callers. No service-account loading or remote fallback. Prove transaction rollback, no duplicate queue/assignment and private recipient isolation.
5. Device instrumentation: emulator/physical devices for min-supported and modern Android; login/approval/profile disable, QR camera, permissions denied/revoked, GPS accuracy/background/foreground notification, POD/signature capture, rotation/process death, logout/account switch, offline/reconnect. USB/device availability is required; adb currently shows no device.
6. Cross-app staging: web generation/driver registration, FIFO staff assignment with repeated OBD/item rows, driver-owned progress/POD, web display, cancellation/reassignment/history and revoked-role/session denial. Validate canonical UID != queue document ID. Both socket endpoints must satisfy same private session policy.
7. Release gate: clean fixed commit and signed artifact, full release lint, dependency/security review, real staged install/update, realistic measured load/soak, observability, deployed rules/indexes/Storage, restore/rollback and release-owner acceptance. Record required platform/publishing rules from current official sources when planning actual distribution.

## Acceptance matrix

| Area | Positive case | Adversarial/failure case | Required evidence |
|---|---|---|---|
| Identity | Active approved driver/staff uses owned endpoints | Revoked/disabled/pending/deleted/missing profile and Auth outage | Unit + real Auth + HTTP/socket |
| Roles | Administration through sysu-app | Self promotion/deletion of unrelated user; legacy duplicate endpoints | HTTP + rules; no mutation |
| QR/FIFO | Valid own scan and truthful truck-group position | Foreign UID, malformed/expired token, repeated/concurrent scan, mid-write failure | Actual controller/client + real transactions |
| Trip/dispatch | Own expected transition | Foreign queue/assignment, completed/stale generation, malicious field types, concurrent edit | HTTP + database final state |
| GPS/session | Authorized active assignment and fresh location | Unrelated socket, zero coordinates, stale/out-of-order data, expired session, process death | Real sockets + device |
| POD/signature | Correct driver/OBD and image displayed on web | Other-driver read/write, oversized/malformed photo, cancellation, permission loss | Rules/Storage + device + web |
| Recovery | Own queue/trip restored after reconnect | Account swap, server restart, partial outage, stale pending write | Integration/device/staging |
| Performance | Documented realistic peak/data size | Soak, burst, slow SAP/Auth/DB and resource exhaustion | Measured agreed latency/error/memory/cost budgets |

## Baseline commands and constraints

Executed Gradle baseline: gradlew.bat --no-daemon --console=plain testDebugUnitTest lintDebug assembleDebug assembleRelease. Supply JAVA_HOME for the installed JDK; do not commit developer-specific paths. Local build reports under app/build/reports; test XML under app/build/test-results.

Backend: npm --prefix backend test -- --experimental-test-coverage. Tests mock Firebase while HTTP binds loopback; real Firebase integration remains separate. Initial test runner's wildcard failed on Windows and was replaced by native node --test discovery. Whole-app 80% coverage is not established.

No test may default to production Firebase/SAP/API/socket. Until G-04 isolation exists, do not install/launch the current production-targeting APK as an automated integration test. Compilation/lint use Firebase build configuration but do not authenticate or mutate Firestore. Emulator pass alone cannot prove deployed indexes, Storage or production readiness.

## Credential containment gate (G-24)

Private-key export was tracked and exposed. Local index removal and Docker context restrictions are complete; IAM key deletion/rotation and exposure/history review require the deployment owner. Never print parser exceptions or credential source; inspect text markers and report file paths/booleans only. Do not force-push rewritten history without repository-owner coordination. Key invalidation and replacement deployment are required before release; history cleanup alone is insufficient.

## Executed QR checkpoint (2026-10-08)

G-08/G-09/G-10: 42 backend unit/HTTP/packaging, 18 real Firestore QR + 4 trip, and 19 shipped Kotlin QR transport + 2 basic Android cases pass (85 separate-run cases). Full debug/release build and lint pass; QrHttpClient scoped line/branch coverage 100%/92.73%, QR controller real integration 100%/91.36%. No device/staged acceptance claim. Next local critical targets: authoritative rules and owned Android writes (G-07/G-16), dispatch ownership/state (G-11), socket authentication/recipient privacy (G-13), SAP/diagnostic exposure (G-14), safe isolated variants (G-04). Real Auth plus combined QR HTTP, index deployment, timeout-refresh UI and cross-app end-to-end remain required. G-24 still requires IAM key invalidation and deployment replacement evidence before public release.


## G-04 next acceptance and G-07/G-16 plan

Local isolation guards, 14 unit regression cases, 7 Kotlin configuration cases, actual Auth/Firestore SDK and both Android builds/lint are implemented and passing. See LOCAL_EMULATOR_SETUP.md for required deployment variables. Remaining: inspect merged debug/release resources/config on exact artifacts, verify pre-activity startup and unreachable-emulator behavior on device, provide reviewed staging variant and clean CI. Count repeated variant runs separately from unique cases.

Next G-07/G-16: reproduce self-role escalation, public user/assignment reads and cross-driver queue/profile/assignment writes against the actual mobile rules in a demo emulator. Inventory Android user creation and owned driver/profile/location/assignment/OBD/POD/dropdown queries against web rules before changing rules. Use one reviewed canonical rule source and deploy workflow; preserve positive owned-driver operations while denying arbitrary role/status/assignment changes. Test multiple dispatches with distinct OBD items and canonical Firebase UID distinct from queue IDs. No permissive rule deployment; deployed shared project configuration requires separate read-only verification/owner evidence.


## G-07/G-16 implemented scope and remaining acceptance

Executed evidence is in RELEASE_FIXES_TDD.md; current statuses are in FIX_TRACKER.md. Shared rule exploit/positive tests and pending-account policy now exist. Run backend/scripts/check-shared-rules.cjs with the adjacent canonical sysu-app checkout; require the same reviewed version and verification in CI before any deployment.

G-11 legacy dispatch retirement is locally verified; actual Auth/deployed retirement and external-client migration remain. Owned canonical dispatch/progress coherence remains G-16. Next local critical work: G-13 actual authenticated Socket.IO handshake/revocation/private recipients; G-14 bounded staff SAP/diagnostics. G-16 must test legacy profile/requirements, owned location/POD paths and truthful errors before strict rules deployment. Preserve multiple OBD line items and canonical UID distinct from queue document ID. Do not widen rules simply to make old writes succeed.

G-09 requires combined HTTP/Auth, Android timeout-refresh and staged contention/soak. Known transaction closure has controlled read-only outcome recovery with no mutation retry; three local targeted concurrency rounds are not production stability/load acceptance. Validate canonical state under outages/ambiguous outcomes and ensure one queue with truthful client refresh.

Owner-supplied staging/device/signing, load budgets and IAM key invalidation remain required release gates. Local build/test metrics cannot replace these.


## Controlled real-driver beta priority — 2026-10-09

User selected real drivers/real data and confirmed the existing production database and deployed/installed versions. This changes priority to the [shared minimum beta checklist](../../sysu-app/docs/BETA_CHECKLIST.md), not an automatic deployment authorization or a public-release clearance. The current automated G-13/G-14/G-15 batch is verified; canonical counts/status live in FIX_TRACKER.md and executed RED/GREEN lives in RELEASE_FIXES_TDD.md.

Next locally: complete bounded owned legacy profile/requirements, location and POD/Storage contracts and truthful Android error behavior (G-16/G-19); preserve repeated OBD line items and canonical driver UID. Then inventory installed application ID/version/signer, prepare the correct signed production-configured pilot artifact, rehearse the chosen flow and coordinate shared rule/backend/web/client compatibility. No device is attached; no physical acceptance exists. Debug remains demo-only and release APK remains unsigned. IAM key invalidation/replacement (G-24) is required for the real-data pilot. Metrics are gathered during the controlled pilot after pre-beta security/workflow gates; full public-release load/soak/accessibility/CI requirements remain separate.

G-14 intentionally retires the duplicate mobile SAP proxy; do not add timeout/cache tests to a source that no longer makes upstream requests. Test anonymous 401, unrelated roles 403, staff 410, zero fetch/no raw data and disabled diagnostics 404. Canonical source timeout/filter/bounds/coalescing acceptance belongs to sysu-app's existing SAP service. External/deployed compatibility remains required. G-15 local routing is DONE; real Auth/deployment and full lifecycle transitions remain G-06/G-16/G-23.
