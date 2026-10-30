# SYSU public release review

Date: 2026-10-07. Branch: `feature/admin-module-enhancements`. Base HEAD: `65964df`. Assessment includes the existing modified and untracked working-tree files, not just HEAD.

**Production audit: 25/100, blocked. Do not release this checkout publicly.** This is an engineering prioritization score, not a measured security certification. The checkout fails its frontend build, has a non-reproducible backend dependency declaration, and contains authorization and data-integrity defects. Existing utility tests do not exercise those boundaries.

## Scope and evidence limits

Applied ECC `production-audit`, `security-review`, `deployment-patterns`, and `e2e-testing`. Reviewed Express routes/controllers/middleware, Socket.IO handlers, Firebase initialization, Firestore rules/indexes, QR and FIFO services, cleanup jobs, migration scripts, frontend entry points/services/hooks, tests, Docker/Railway/Firebase configuration, environment examples, and existing readiness documents.

No production writes, migrations, cleanup jobs, credentialed live tests, deployment, dependency upgrades, or source fixes were performed. Local secret file values were not printed. Existing user changes and deleted documents were preserved. This review adds documentation only.

Local rules are not proof of the rules currently deployed. No deployed Firebase rules, Storage rules, IAM permissions, Auth configuration, Railway logs/settings, real SAP responses, production telemetry, browser sessions, Android implementation, restore drill, or full Git-history secret scan were verified. These are explicit release gates in the testing plan, not assumed passes. No external repository scanner or registry audit was run. Dependency vulnerability status is unverified.

## Checks actually executed

| Check | Result | Meaning |
| --- | --- | --- |
| Backend `npm test` | 17 passed, 0 failed | Only ID formatting/parsing and pure queue-ordering utilities; no HTTP/controller/rules/socket integration coverage |
| Frontend `npm test` | 11 passed, 8 failed; 3 failing test files, 2 passing files | Dashboard tests lack `whatwg-fetch`; GuardSignature and PodPreview suites cannot resolve `prop-types` |
| Frontend `npm run build` | Failed | Invalid Unicode escape in legacy dashboard source |
| `node --check frontend/src/pages/dashboard.js` | Failed at line 270 | Escaped parentheses and literal PowerShell newline text in JavaScript |
| `node --check frontend/src/api/socket.js` | Failed at line 62 | Literal PowerShell newline text causes unexpected template string |
| `node --check backend/src/server.js` | Passed | Syntax only; does not prove imports, credentials, startup, or readiness |
| Package/lockfile inspection | `zod` absent from backend manifest and lockfile | Multiple controllers import it; clean backend container cannot rely on parent/local dependencies |
| Git tracking check for three local environment files | No tracked paths returned | Those current files are ignored; historical secret absence was not established |
| Repository CI inventory | No root `.github/workflows` directory | No repository release pipeline demonstrated |

Initial test/build runs were blocked by sandbox `EPERM` during Node path resolution; approved reruns produced the results above. A separate inline dependency-resolution probe had a shell quoting error and supplies no dependency evidence; the missing dependency finding comes from manifest/lockfile inspection. Installed local dependencies are not equivalent to a clean Linux/container installation.

## Severity and disposition

P0 = release blocker with privilege escalation, sensitive exposure, build/startup failure, or broken critical workflow. P1 = must resolve or demonstrate a tested safe constraint before public release. P2 = hardening/product issue to close or accept explicitly with owner and deadline. P3 = small correctness/maintenance detail. Findings below are source-confirmed unless explicitly labeled as a risk or verification gap. Runtime consequences not exercised against an emulator/staging system are predictions from the source.

## Release blockers

### R01 — P0: a user can make themselves super admin

`frontend/firestore.rules:9-13` lets any authenticated user create/update their own entire profile, including `role`, `status`, and other privileged fields. Backend `authorize` trusts that profile. A user can set their own role to `super_admin` and then invoke protected APIs. Comments saying role changes must use the backend do not impose field restrictions.

Fix: constrain account creation to a safe initial role/status and approved keys; constrain updates with `diff().affectedKeys().hasOnly(...)`; keep roles/status server-owned. Verify all privileged fields including unknown additions. Test direct SDK writes, REST API calls, and role-request pathways; hiding a UI control is insufficient. See [Firebase field restrictions](https://firebase.google.com/docs/firestore/security/rules-fields).

### R02 — P0: public reads expose operational documents and QR capabilities

`frontend/firestore.rules:30-31,46-47,55-56,77-78` permits anonymous reads of queue, drivers, assignments, and QR tokens. These schemas contain driver names/identity, plates/company, customer/dispatch information, last-known coordinates, and usable queue tokens. `backend/src/routes/driverRoute.js` also exposes the complete driver document without authentication; `driverController.js` spreads every stored field into its response.

Fix: define an explicit read matrix; return field-selected responses; separate a minimal public kiosk projection from private operational data. Do not grant public token enumeration. Confirm actual deployed data and rules without exporting personal data into test artifacts.

### R03 — P0: direct writes bypass FIFO and assignment ownership controls

Rules allow arbitrary authenticated queue creation, unrestricted owner queue updates, and unrestricted assigned-driver assignment updates (`firestore.rules:34-38,59-61`). A caller can fabricate queue identity/timestamps, rewrite ordering/capacity, or alter assignment fields such as driver identity, metadata and line items. Driver documents also permit unrestricted owner writes/deletes. Server-authoritative comments are stronger than the actual rules.

Fix: server-own queue admission/order/assignment identity; narrowly permit only necessary progress/POD fields with identity immutability, types, bounds and allowed state transitions. Define which fields the Android client needs before tightening rules. Test valid driver progress and adversarial field changes together.

### R04 — P0: role requests offer a second escalation path

`firestore.rules:18-20` grants every authenticated caller arbitrary writes to any role request. `roleRequestController.js` accepts unvalidated `requestedRole`, trusts stored requester/role on approval, and performs separate profile/request writes. `server.js:249-264` permits an ordinary admin to approve requests for `super_admin`, unlike the direct role-update API. Self-review is not prohibited. Concurrent approval/rejection can leave mismatched state.

Fix: server-owned decisions and identity, role allowlist, reviewer/target hierarchy, no self-approval, and atomic transition of request and user. Restrict request reads; `get_role_requests` currently has no admin check and role notifications broadcast to all authenticated sockets.

### R05 — P0: critical frontend source does not parse

`dashboard.js:270` contains `this._setupDriverLocationSocket\(\);` followed by a literal PowerShell newline marker; `socket.js:62` has the same marker in the events object. Both fail independent syntax checks. Production build fails before an artifact is generated.

Fix both and inspect adjacent edits for escaped replacement artifacts. Re-run syntax, tests, and the production build. The only `_setupPodSocket` occurrence is this call: no implementation exists in the dashboard. Add and verify the actual handler; repairing syntax alone leaves a missing-method runtime failure and does not fix live POD refresh.

### R06 — P0: dependency boundaries cannot support a clean release

Controllers import `zod`, but `backend/package.json` and its lockfile do not declare it. Docker installs only backend dependencies. Frontend JSX imports React/ReactDOM/PropTypes while frontend does not declare those runtime dependencies; Vitest/jsdom/testing-library are supplied from the root package. Current frontend suites demonstrate missing modules.

Fix package ownership or introduce documented npm workspaces. A component package must not depend accidentally on ancestor installs or peer auto-installation. Use clean `npm ci` from the documented install root and build/test in an isolated Linux job. Add a production start script and supported Node engines.

### R07 — P0: ordinary assignments send a value the server rejects

`frontend/src/api/sapAssignmentService.js:65-79` serializes absent `overrideTokenId` as `null`. Backend `assignDriverSchema` accepts an optional string, not null (`sapAssignmentController.js:31`). Normal frontend assignment requests therefore fail schema parsing before FIFO processing. The generic error handler turns that validation exception into a 500.

Fix the shared contract: omit absent optional properties or explicitly support a nullable value. Cover the exact service-generated JSON in an HTTP integration test, not just controller fixtures.

### R08 — P0: FIFO override consumption has incompatible APIs

`sapAssignmentController.js:211` invokes `consumeTokenInTransaction`, which is not exported. `tokenService.js:149` exports `consumeInTransaction`, with different arguments and a result containing `ok`, whereas the caller expects `valid`. The service implementation also does not await `transaction.get`, so its snapshot variable is a promise (`tokenService.js:129-131`). Renaming the method alone will not fix this workflow.

Fix the entire contract, await reads, verify dispatch/driver/actor binding and expiry, and consume within the assignment transaction after all reads. Test approved override success, reuse, expiry, mismatches, concurrent attempts, and failed assignment rollback.

### R09 — P0: dispatch writes lack dispatcher authorization

`sapAssignmentRoute.js` applies token authentication globally, but `/assign`, `/peek`, `/locations`, override requests, and cancellation requests have no dispatcher role allowlist. `sapRoute.js` similarly grants SAP shipment access to any valid token. `protectRoute` verifies identity without checking profile status/role. Pending or disabled-profile accounts can reach operational surfaces if their token remains valid.

Fix a documented HTTP/socket/rules role matrix and enforce it on the server, including active-account policy. Firebase Admin SDK bypasses Firestore rules, so rules cannot repair these route permissions. See [Firebase rule conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).

### R10 — P1: REST and socket driver impersonation

`driverController.updateDriverFull` accepts any path driver ID without matching the driver caller UID. `server.js:294-315` trusts payload driverId for capacity writes; status/stopped handlers trust payload identity; POD handler rebroadcasts arbitrary data. Any authenticated socket can spoof operational notifications, and capacity changes can affect dispatch eligibility.

Fix ownership checks plus explicit staff exceptions; validate event schemas, target assignments, allowed transitions, and per-event permissions. Authenticate with Socket.IO middleware before connection handling, authorize rooms, and avoid broadcasting private data to every logged-in account.

### R11 — P1: QR verification consumes tokens anonymously; expiry is unenforced

`qrController.verifyToken` is a public GET that updates `used/isUsed` without a transaction. It does not check expiry. `scanToken` transaction does not check expiry or bind submitted driverId to `req.user.uid`; there is no driver role check or active-queue uniqueness check. An anonymous verification request can consume a token without admitting a driver; two verification requests can both observe unused state. Scheduled deletion is not expiry enforcement.

Fix a read-only verification contract, authenticated transactional consumption, server-time expiry, canonical caller identity, and atomic duplicate-admission prevention. Public token generation also needs abuse/cost controls and a safe kiosk policy.

### R12 — P1: FIFO transaction reads do not cover the queue snapshot

`assignDriver` calls `loadQueueForType` inside the callback, but that helper uses ordinary collection `.get()` (`sapAssignmentController.js:75-76,140`), not `tx.get`. The selected queue document's assignedShipments list is therefore outside transaction conflict tracking in the normal path. Concurrent assignments to different dispatches can base updates on the same stale queue list and lose an entry; intervening queue eligibility changes need not trigger transaction retry.

Fix transactional reads of every invariant or a serialized per-driver dispatch strategy. Prove FIFO under concurrency and verify the persisted queue list/count against all assignments. Firestore transactions retry on tracked changes; ordinary reads do not provide that guarantee. See [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).

### R13 — P1: decisions and cancellations can race or partially apply

Override decision/revoke read pending status and later update outside a transaction. Token issuance is separate from request approval. Cancellation checks request status outside its assignment transaction and marks the request approved afterward (`sapAssignmentController.js:388-467`). Queue lookup uses driverId with `limit(1)` and no active-state selection; historical queue entries can be selected. Cancellation deletes the assignment regardless of in-transit/completed status and can discard POD/history.

Fix atomic request-state transitions and a cancellation state policy; bind cancellation to the active queue/assignment and preserve an audit/tombstone as appropriate. Demonstrate crash recovery between each write and competing approve/deny/revoke operations. Decide whether in-transit cancellation is ever permitted.

### R14 — P1: declared Firestore permissions do not support existing UI paths

The dashboard subscribes to `cancelRequests` (`dashboard.js:6260`), reads POD subcollections, and writes other drivers/queue documents from staff flows (`4077,4092,6159`). No explicit cancelRequests or POD child matches exist; the default denies them. Owner-only driver/queue rules deny these staff writes. Fix by routing authoritative staff actions through protected APIs and adding deliberate, tested read grants to necessary child collections. Do not resolve this by broadening all writes.

### R15 — P1: line-item validation and data authority are incomplete

`sapAssignmentController.js:22` uses a double-escaped digit regex in a regex literal, rejecting normal numeric strings. Numeric quantities are not constrained positive. Caller-selected truckType, dispatch key, customers/OBDs and free-form driverSnapshot are not cross-checked against authoritative SAP/driver data. The pre-transit fast path can bypass normal FIFO/type eligibility checks.

Fix numeric normalization/bounds, bounded strings and arrays, authoritative SAP membership/type checks, and canonical driver snapshots. Test quantities `"10"`, `"10.5"`, zero, negatives, excessive values, whitespace, invalid IDs and inconsistent truck types. Confirm maximum legitimate payloads fit the 10kb JSON limit.

## Additional operational, security and product findings

| ID / priority | Evidence and consequence | Required action / verification |
| --- | --- | --- |
| R16 P1 | Docker uses `node:20-alpine`; Node 20 is EOL as of this review date | Move to a supported LTS, pin an image digest, repeat clean tests/build/container checks. [Official Node release schedule](https://github.com/nodejs/Release#release-schedule) |
| R17 P1 | Docker uses `npm install --production`, runs as root, copies the entire backend, has no healthcheck | Use `npm ci --omit=dev`, non-root user, minimal source copy, secret exclusion and image inspection. `.dockerignore` only names `.env`, not an explicit recursive policy for every secret variant; actual ignore behavior and image contents must be tested |
| R18 P1 | No health/readiness route or Railway healthcheck; Firebase initialization catches errors instead of failing | Fail startup on invalid required config; bounded dependency readiness checks, release version and liveness. Confirm invalid credentials never yield a healthy deployment |
| R19 P1 | `TRUST_PROXY` accepts IP-looking strings but later `parseInt` changes them into a number; PORT allows out-of-range digit strings | Typed, bounded config; preserve supported proxy semantics; test forwarded-IP spoofing and shared proxy/NAT behavior |
| R20 P1 | Hardcoded production origins include localhost; documented `ALLOWED_ORIGINS` and limit overrides are unused | Environment-specific validated origin/limit settings; test preflight/actual responses and add `Vary: Origin`. CORS is a browser control, not authentication |
| R21 P1 | Generic handler returns raw error message and defaults Zod errors to 500 | Map validation/not-found/conflict/body-parser failures correctly; generic production 5xx responses, request IDs, redacted internal logs |
| R22 P1 | Token verification lacks revocation checks; connected sockets do not enforce subsequent disabled/deleted account state | Define revocation policy, revalidate sensitive actions, disconnect revoked/deleted users; test old HTTP tokens and long-lived sockets |
| R23 P1 | Admin can demote existing super admins through update-role; no last-super-admin guard | Hierarchy and target checks, last-owner protection, recovery/bootstrap runbook and audit trail |
| R24 P1 | deleteUser ignores every Auth deletion error and continues Firestore deletion | Only tolerate user-not-found; reconcile partial deletes, revoke sessions, prevent deletion of last owner, handle assignments/POD retention |
| R25 P1 | Driver location handler accesses `data.driverId` without schema/try catch; broadcasts before validating coordinates | Reject null/oversized payloads, finite lat/lng with bounds, allowed IDs; prove malformed events cannot crash process or poison map |
| R26 P1 | Rate limiting is HTTP/IP/in-memory; sockets and public QR namespace lack event/connection limits | Per-user/event budgets, socket payload bounds, kiosk issuance limits, representative office NAT traffic and abuse tests |
| R27 P1 | Entire location/status/POD payloads and user/warehouse data are console logged | Structured bounded logs, redact precise GPS/email/tokens/POD URLs; retention and access policy, correlation IDs and actionable alerts |
| R28 P1 | No demonstrated CI, staging gate, backup restore, release rollback or incident ownership | Establish artifact promotion pipeline, rules/indexes coordination, tested restore/rollback and named operator; see testing plan |
| R29 P1 | Migration scripts default to writes and a production project ID, remove amount data, read full collections | Explicit target assertion, dry-run default, backup, resumable pagination, full-item validation, verification counts and tested recovery |
| R30 P1 | Line-item migration decides already-migrated from first item only and substitutes truckCompany as customerName | Test mixed arrays and missing customer data; do not treat fallback guesses as correct migrated business data |
| R31 P1 | Stored indexes do not demonstrate every query path, including assignment driverId/tripStatus and cancel request status | Maintain query/index inventory; verify all queries in real staging after indexes finish building; emulator alone is insufficient |
| R32 P1 | Vite dev proxy and API fallbacks point to production systems | Isolated local/emulator/staging defaults; fail tests if production hosts/projects appear in network attempts |
| R33 P1 | Incomplete React migration: active HTML still uses legacy main.js/dashboard.js; new Dashboard imports absent MapView/TrackingView/ProfileModal/AssignDriverModal/DriverModal files | Choose and verify the release entry graph. New JSX is not automatically shipped; if adopting it, complete imports, behavior parity and role gates first |
| R34 P1 | `frontend/public/index.html` contains only a root div; duplicate root/public QR pages exist | Remove collision or prove actual dist output. Test served login/dashboard/QR HTML, scripts and direct navigation; copied public assets can conflict with built entries |
| R35 P2 | API Helmet CSP disabled; frontend Hosting has no security headers, uses inline scripts/handlers and CDN scripts without a demonstrated integrity policy | Set policy at actual HTML host, stage CSP reporting then enforcement; test framing, referrer leakage and CDN failure. Do not assume API Helmet protects Firebase-hosted HTML |
| R36 P2 | Numerous HTML interpolation/onclick/URL sinks remain despite some escapeHtml use | Inventory context-specific escaping and allowlisted image/link protocols; adversarial driver/company/customer/dispatch/POD fixtures; no confirmed exploit claimed from search alone |
| R37 P2 | AuthService.subscribe returns Auth unsubscribe but discards nested profile snapshot unsubscribe | Unsubscribe profile listeners on identity change/unmount; test repeated login/logout and no stale previous-user callbacks |
| R38 P2 | Secondary driver socket has tokenless fallback, no demonstrated token refresh/logout cleanup | Match sysu-go auth contract, remove silent anonymous fallback if private, test token expiry, partial service outage and resync |
| R39 P2 | GPS persistence marks throttle before DB write succeeds, uses limit(1), Map has no eviction, treats zero coordinates as invalid | Mark after successful persistence, define all-active-dispatch updates, bounded cache and timestamp/staleness semantics; test failed write recovery and valid equator/meridian coordinates |
| R40 P2 | Whole-collection queries/listeners, unbounded assignment/location reads, SAP 60s fetch and per-process cache | Active-only bounded queries/pagination, request coalescing, timeouts/abort and stale data labels; load/soak and Firestore cost test |
| R41 P2 | Cleanup reads whole collections and runs in every process at 02:00 server timezone; no leadership/lock or missed-run recovery | Bounded scheduled jobs, explicit business timezone, idempotency/overlap policy, result metrics, alerts and retention approval |
| R42 P2 | Incident rule permits reporter update/delete but no explicit dispatcher review access | Define reporter/staff read/resolve/delete permissions, immutable reporter identity and retention; test historical missing-reporter records |
| R43 P2 | No Storage rules/config in repository; POD child permissions unverified | Verify actual upload/view/delete permissions, ownership, MIME/size/content checks, URL expiry, malicious image handling and orphan cleanup |
| R44 P2 | Hosting immutable policy covers unhashed public images/scripts as well as hashed assets | Cache immutable only content-addressed assets, revalidate HTML/unhashed assets; test rollback and stale open clients |
| R45 P2 | Single Railway replica, in-memory cache/limits/sockets/jobs; no shutdown hooks | Document capacity boundary, graceful SIGTERM/drain/reconnect; before scaling require shared limiter/socket adapter/sticky transport policy and singleton jobs |
| R46 P2 | xlsx and other dependencies have no fresh advisory evidence | Run approved lockfile advisory checks and image scanning; triage reachable impact and upgrade paths. No CVE or clean-audit claim is made here |
| R47 P2 | Accessibility, mobile forms/modals, empty/error states, camera/offline recovery and map attribution not browser-verified | Execute the browser/manual checklist; record screenshots and actionable defects, including low contrast, focus and large-text failures |
| R48 P3 | Double-escaped whitespace regex in guard full-name construction; inconsistent date/status representations | Fix regex and normalize identifiers/status/timestamps; whitespace, Unicode, leading-zero SAP IDs and timezone-boundary tests |
| R49 P3 | Hook filename ends in a backtick; duplicate Jest/Vitest metadata, backups and multiple page implementations | Remove accidental filenames/dead configuration after verifying imports; maintain a single test/entry convention and LF/UTF-8 tooling |
| R50 P3 | READINESS/CROSS_APP assessment claims missing frontend test script and unfixed cancellation typo | Both are stale: test script now exists and remainingShipments typo is corrected. Keep regression tests; link current review rather than repeat old conclusions |
| R51 P1 | Guard/company create handlers read all IDs, calculate max+1, then `.set()` outside a transaction | Concurrent creates can choose the same ID and overwrite a successful record. Allocate IDs atomically and use create-only writes; test simultaneous creations and retries |

## Strengths to retain

Bearer verification and role middleware exist; several admin routes use explicit checks; QR scan already uses a transaction for same-token contention; dispatch documents use a deterministic key with an existing-assignment check; override storage denies direct access; body size is limited; SAP client errors are generic; queue and incident cleanup batch writes; 17 useful utility tests pass. These controls need integration tests and do not offset the escalation/build blockers.

## Release decision and next action

Start with R01-R04 and R09-R11 authorization/data boundaries, while repairing R05-R08 build/dependency/contracts. Then correct transactional invariants R12-R15 and establish an isolated staging pipeline. Do not use production data to reproduce these attacks. Public release requires the acceptance evidence in [the testing plan](../PRODUCTION_RELEASE_TEST_PLAN_2026-10-07.md), reviewed against a fixed commit and deployed configuration.
