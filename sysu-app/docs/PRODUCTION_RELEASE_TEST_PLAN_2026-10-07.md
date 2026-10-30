# SYSU release testing and remediation plan

Historical plan dated 2026-10-07; it is not release approval or current deployment evidence. Companion: [source review and observed results](archive/PRODUCTION_RELEASE_REVIEW_2026-10-07.md). This is a planned suite and release procedure; only the commands reported in that review have been executed. New commands below must be implemented before they can be used as gates.

## 1. Safe, reproducible test environment

Use a dedicated Firebase staging project, Firestore/Auth/Storage emulators for automated destructive tests, a fake SAP OData fixture server, and isolated sysu-app/sysu-go staging services. Seed synthetic users, drivers, plates, addresses, signatures and POD images. Do not import production personal data.

Make test startup fail if configured with production project IDs or hosts. Explicitly set every service URL; current Vite/API fallbacks reach production. Disable cleanup schedulers during tests and invoke cleanup functions against seeded isolated collections. Fix dependency/config issues before importing the complete server. Refactor app creation away from listen/cron/global side effects so HTTP and socket tests can start and stop deterministically.

Record the commit, lockfile hashes, Node version, container digest, rules/index hashes, fixture version and sysu-go version in every release report. Separate demo kiosk projection from private dispatch data.

## 2. Ordered implementation and test gates

| Phase | Work | Owner role | Exit evidence |
| --- | --- | --- | --- |
| A: reproducibility | Fix syntax, package ownership, optional/null contract, missing token-service API; supported Node runtime; select release entry graph | Backend/frontend maintainers | Clean Linux installs, parsing, frontend production build, complete backend import/startup and current tests green |
| B: authorization | Repair role/profile rules, requests, operational reads/writes, REST ownership and socket permissions | Backend/Firebase maintainer | Direct SDK/HTTP/socket authorization matrix passes, including pending/inactive/deleted accounts |
| C: integrity | Transactional FIFO/override/cancel/QR; authoritative payload validation; concurrent IDs and coherent capacity writes | Backend maintainer | Emulator concurrency/fault tests prove persistent invariants and safe retries |
| D: integration/UX | Real browser critical workflows, POD, mobile contracts, permissions, map/socket outages | Frontend and Android maintainers | Multi-browser staging E2E, Android integration and manual accessibility evidence |
| E: operations | Container, index deployment, monitoring, load, retention/migrations, backup/restore and rollback | Release operator | Production-like staging artifact, load report, recovery drill, validated deployment settings |
| F: public release | Fixed commit, release manifest, risk review, phased rollout and post-deploy smoke | Release owner | Every required gate closed, named owners, observed healthy rollout and rollback artifact available |

Track R01-R51 as individual issues with owner, fix commit, test IDs, artifacts and closure date. P0 must close. P1 must close or have a demonstrated technical constraint eliminating the risk; an informal promise is not closure. P2/P3 exceptions require explicit owner, rationale and deadline.

## 3. Authorization matrix — test every transport

Actors: anonymous, missing-profile authenticated user, pending, inactive, driver A, driver B, fleet manager, QR generator, admin, super admin, expired-token user, revoked/disabled/deleted Auth user. Include profile-role changes during an active session. Do not infer backend access from frontend navigation.

| Surface | Required positive cases | Required negative cases |
| --- | --- | --- |
| Profile creation/update | Own approved display fields, server-controlled initial pending state | Own role/status promotion; privileged additions; edit another profile; spoof identity |
| User lists | Authorized staff subset | Anonymous/pending/driver enumeration of all profiles |
| Role requests | Own valid request, allowed reviewer decision | Requester/role/status tampering, another request edit, admin grants super_admin, self-review, duplicate decisions |
| Assignment/peek/locations/SAP | Approved dispatcher roles | Anonymous and valid token with wrong role/status; arbitrary drivers/customers/dispatches |
| Overrides/cancellation | Own request/revoke, permitted admin decision | Other-user revoke; stolen/mismatched token; already-decided request; ineligible assignment state |
| Driver capacity/profile | Driver modifies permitted own fields; explicit staff exception | Driver A modifies driver B; public full document response; identity rewrite |
| Queue | Authenticated admission via server; narrow own progress | Fabricated creation, backdated ordering, owner/driverId swap, other queue edits, terminal-state reversal |
| Assignments/POD children | Dispatcher view; driver owns relevant delivery/POD | Anonymous read; unrelated driver view/write; editing assignedBy/driverId/OBDs; child path bypass |
| Incidents | Reporter create/view; specified staff review | Reporter identity changes, unauthorized resolve/delete, old missing-reporter document leaks |
| Guards/companies/warehouse | Staff reads and correct write hierarchy | Pending account reads; unauthorized create/edit/deactivate; warehouse changes by ordinary admin |
| Kiosk/QR | Minimal public projection and bounded authorized issuance | Token collection enumeration, anonymous consumption, private data delivered over public namespace |
| Sockets | Authorized subscription and owned payload; permitted staff events | Spoofed identity/status/capacity/POD, get_role_requests by driver, unauthorized room join, old-session events |

Implement rule tests with the Firebase rules testing SDK using both `assertSucceeds` and `assertFails`. Test exact keys, types, lengths, missing fields, added privileged fields, list queries, nested collections, batches and transactions. Backend Admin tests must exercise controller authorization independently because Admin bypasses rules. Validate real staging rules/index deployment separately.

## 4. Critical backend/integration scenarios

| Test ID | Scenario / fixture | Pass condition | Findings |
| --- | --- | --- | --- |
| API-01 | Build HTTP assignment request using actual frontend service shape; absent override, null, omitted and valid token | Agreed contract succeeds; invalid input is 400/422, never uncaught 500 | R07, R21 |
| API-02 | Strings/arrays where scalar IDs expected; slash/path IDs; unknown fields; long reason; malformed/oversize JSON | Predictable JSON error; bounded work; no stack/internal message disclosure | R15, R21 |
| FIFO-01 | Timestamp ties, missing/malformed times, historical queue entries, completed/full/in-transit drivers, type casing | Documented eligibility and deterministic ranking; no ghost eligible record | R12, R15, R48 |
| FIFO-02 | Two dispatchers simultaneously assign same dispatch | Exactly one assignment, one success, others conflict; queue unchanged by losers | R12 |
| FIFO-03 | Many different dispatches concurrently assigned to same pre-transit driver | No lost entries; queue list/count equals stored active assignments; documented capacity respected | R12 |
| FIFO-04 | Driver becomes full/departs or queue order changes between selection and commit | Transaction retries/rejects; no stale eligibility or wrong FIFO winner | R12, R15 |
| FIFO-05 | UID versus queue document ID; several historical queue records; numeric/leading-zero dispatch keys | Canonical Auth UID stored and returned; correct active queue selected; identifiers preserved | R13, R48 |
| OVR-01 | Request → approve → assign alternate | One valid token, one atomic consumption, assignment and request state agree | R08 |
| OVR-02 | Expired/replayed/wrong-dispatch/wrong-driver token; two concurrent consumers | All invalid attempts denied; at most one successful use | R08 |
| OVR-03 | Approve versus approve/deny/revoke; crash after issuance | Exactly one legal final decision; no orphan usable token; safe retry | R13 |
| CAN-01 | Cancel sole or one of several pre-transit assignments | Counts/list/latest pointer/status coherent; audit retained; corrected typo covered | R13 |
| CAN-02 | Cancel loading/in-transit/completed/missing assignment; multiple active/historical queues | Policy respected, correct record targeted, no POD/history deletion outside policy | R13 |
| CAN-03 | Cancel versus progress/assign/approve/deny; failure before request decision write | Persistent state reconciles atomically or documented recoverable outcome | R13 |
| QR-01 | Verify token repeatedly and in parallel | No mutation from read-only verification; identical safe state | R11 |
| QR-02 | Scan at before/exactly/after expiry; used vs isUsed legacy variants | Server rejects expired/used token regardless of cleanup schedule | R11 |
| QR-03 | Simultaneous same-token scans | Exactly one queue admission and one consumed token | R11 |
| QR-04 | Same driver scans multiple distinct tokens concurrently; spoofed driverId; wrong role | Canonical authenticated identity; active queue uniqueness preserved | R11 |
| ADM-01 | Concurrent guard/company creations starting from same maximum ID | Unique documents; neither request overwrites another; sequence invariant holds | R51; guard/company create controllers |
| ADM-02 | Last super-admin/self/other super-admin demotion or deletion | Hierarchy and last-owner protection; recoverable administrative access | R23, R24 |
| ADM-03 | Auth deletion fails with non-not-found; database write fails after Auth action | No false success; resumable/reconciled deletion, revoked sessions and retention respected | R24 |
| CAP-01 | Driver/queue capacity updates with injected write failure and concurrent assignment | No inconsistent capacity allowing invalid dispatch | R10, R12 |
| SAP-01 | Slow/timeout/500/invalid payload/empty/paginated OData response; burst cache misses | Bounded timeout, validated shape, coalesced calls, safe freshness/error labels | R15, R40 |
| ERR-01 | Zod error, permission denied, missing index, missing record, dependency failure | Appropriate status and user-facing recovery, redacted correlated internal log | R21, R31 |

Concurrency tests must inspect the final database after all requests settle, not only count HTTP successes. Use barriers to force interleavings, inject failures after each write boundary, and repeat randomized schedules with recorded seeds. Keep reads before writes in transactions; emit notifications only after a successful commit.

## 5. Socket and Android contract suite

Run against both staging socket services and the supported Android client version; the Android source was outside this review. Maintain fixtures for event names, ack/error shape, canonical driver/shipment IDs, coordinate types, timestamp units, trip statuses and POD notification payloads.

- Test missing/invalid/expired/revoked tokens at handshake and during established connections. Demotion, disabled account, deletion and logout must stop privileged data/events.
- Test null payload, invalid coordinates, NaN-like values, extreme numbers, excessive strings, unknown event fields, spoofed driver ID and unrelated POD shipment. Process stays alive and database/map stays unchanged.
- Test high event volume, socket connection churn and public `/qr` connections with bounded resources and defined disconnect/rate-limit feedback.
- Driver moves → dispatcher sees owned marker → stops → resumes → loads → transit → completion removes marker; stale delayed transit events must not resurrect completed trips.
- POD upload/photo/signature → persisted owned object → socket invalidation → preview refresh without manual page reload. Duplicate/out-of-order notifications must be harmless.
- Drop each server separately, lose internet, background/kill/reopen Android, expire token, restart server, reconnect with missed events. Recover from persisted source of truth and show stale/disconnected state.
- Repeat across two dispatchers and one driver, multiple pre-transit dispatches, UID/legacy ID fixtures, and temporary Firestore write failure.
- Verify secondary socket disconnects on logout and refreshes credentials on reconnect. Explicitly decide whether any tokenless connection is permitted.

## 6. Browser E2E and small-detail checklist

Test the actual production `dist` output served with Hosting-equivalent rewrites/headers, not only Vite dev. Use role/accessible-name locators, seeded independent accounts, observable-state waits, and per-test cleanup. Avoid arbitrary sleeps and test ordering. Retain failure trace/screenshot/video with token/PII redaction; retries may diagnose flakiness but must not conceal release-critical failures.

Browser matrix: desktop Chromium/Firefox/WebKit; mobile Chrome and iOS Safari; at least one actual Android device for camera/socket/background behavior. Viewports 320/375/768/1440 px; portrait/landscape; 200% text zoom; touch and keyboard.

| Path | Required checks |
| --- | --- |
| Login/account | Username/password login, invalid credentials, pending/inactive account, refresh/deep link, deleted profile, logout/back button, session expiry |
| Dashboard | All permitted tabs only, unauthorized direct navigation, loading/empty/error states, safe refresh, no duplicate listeners, unreadable/denied data response |
| Dispatch | SAP fetch/filter/sort/search; leading-zero IDs; FIFO selection; conflict feedback; ordinary assignment; override and cancellation review; all state transitions and counts |
| Map/tracking | Correct markers/attribution, stale GPS timestamp, tile/geocoder outage, duplicate/out-of-order updates, pan/zoom, dark/light contrast, completed marker cleanup |
| Documents/POD | Multi-image paging, missing image/signature, invalid URL, large/rotated photo, zoom/pan/touch, close/Escape, guarded access and live refresh |
| Admin | Guards/company add/edit/deactivate, whitespace/Unicode names, duplicates, active filtering, role approvals, disabled account enforcement, last-owner protection |
| QR/kiosk | `/qr-generator` and `.html` resolve same intended experience, displayed token rotation, scan acknowledgement, expiry/used failure, offline/reconnect, unauthorized queue admission |
| Static/release | Login HTML not overwritten by public/index; no broken imported files; scan-result/logout served; missing route/asset returns intended response; refreshed tab after deploy/rollback |

Manual details to record as individual defects: focus starts in modal and returns to trigger; focus trap and Escape; visible keyboard focus; form labels/autocomplete; errors linked to fields and announced; loading buttons prevent duplicate submit; horizontal overflow/table navigation; scroll trapped/blocked background; camera permission denied; file selection cancelled; text truncation with access to full value; contrast in every theme; color-independent status; reduced motion; screen-reader table headings; tooltip touch behavior; international characters; timezone/midnight formatting; leading-zero plate/dispatch IDs; readable empty/429/403/timeout states; unsaved-change recovery; map attribution visible; duplicate IDs; broken links; favicon/title; browser console errors; third-party CDN offline; external-link referrer/privacy; stale cached assets; old client calling new API. Automated accessibility checks supplement keyboard and screen-reader review.

## 7. Operations, security and performance tests

| Test ID | Required experiment | Acceptance evidence |
| --- | --- | --- |
| OPS-01 | Build/run backend container using only backend declared production packages | Startup succeeds as non-root, image contains no env/service-account secrets, correct ports and signal handling |
| OPS-02 | Missing/wrong project, malformed credentials, invalid port/proxy/origin/SAP config | Fail fast with safe actionable diagnostics; no healthy deployment using production fallback accidentally |
| OPS-03 | Liveness/readiness during Firestore/Auth/SAP outage | Bounded readiness response, correct routing policy, alert and recovery; no restart storm |
| OPS-04 | Rolling restart/SIGTERM during request/transaction/driver updates | Bounded drain, no acknowledged lost writes, reconnect/resync and no duplicate jobs |
| OPS-05 | Real staging index/query inventory and permission-denied tests | All release queries succeed with deployed rules/indexes; denied cases fail intentionally |
| OPS-06 | Migration dry-run → apply → rerun → interrupted batch → restore using >500 mixed records | Explicit target, idempotency, correct per-item data, count/checksum report, resumable progress and tested backup |
| OPS-07 | Cleanup boundary times, >500 records, missing timestamps, overlapping/repeated job and mid-batch failure | Only retention-approved records removed, references/storage handled, bounded memory, retry/reporting and correct timezone |
| SEC-01 | Approved current dependency/lockfile and container advisory checks; tracked/history/image secret checks | No untriaged reachable critical/high issue; rotated exposed credentials where applicable; redacted report |
| SEC-02 | CSP/framing/referrer/HSTS/CORS/OPTIONS/cache/proxy tests at actual hosts | Intended allowed origins, no spoofing bypass, no public private-data cache, login/QR/map/POD remain functional |
| SEC-03 | Stored/DOM input and URL payloads in every HTML/attribute/handler/POD/export context | No script execution, unsafe protocol, broken markup, formula injection or secret disclosure |
| SEC-04 | Storage uploads/view/delete: ownership, size, type, malformed image, URL expiry | Required valid uploads work; unauthorized/malicious ones rejected; safe rendering and orphan policy |
| PERF-01 | Representative dispatchers/drivers behind one office NAT and kiosk traffic | Legitimate users do not exhaust global 200/15min limit; defined 429 behavior and retry policy |
| PERF-02 | GPS/socket/load bursts, SAP cache miss storm, large historical collections and map rendering | Latency/error/resource/cost budgets met without lost assignments or hung browser |
| PERF-03 | 8-hour staging soak with reconnects, login/logout and listener creation | No monotonic listener/socket/cache/memory growth; stable freshness and operational cost |
| DR-01 | Restore synthetic backup and roll back frontend/backend/rules/data-compatible version | Recovery time/data loss recorded, evidence against agreed RTO/RPO, previous artifact restored and critical smoke green |

Define expected peak drivers/dispatchers, GPS frequency, collection sizes and kiosk issuance before load testing. Proposed initial targets for review: exercise 2× expected peak for 30 minutes plus an 8-hour soak; healthy cached API p95 <1s; committed notification-to-dashboard p95 <2s; no lost/duplicate authoritative writes; error rate <1%; no sustained memory growth after steady state. Separate SAP upstream latency from application latency. These are proposed acceptance targets, not measured results or existing service promises.

Agree backup frequency/RPO/RTO, privacy/retention requirements and cost budget with the release owner. Observe HTTP latency/status, authorization failures, socket connections/event rejection, GPS age, SAP latency/cache behavior, Firestore failures, transaction retries, scheduler last-success, readiness, heap/CPU and daily read/write/egress costs. Define concrete alert recipients and runbooks.

## 8. CI and release artifact requirements

After package ownership is corrected, use pinned supported Node tooling and committed lockfiles. Candidate pipeline: clean install → lint/syntax/import checks → current unit/component tests → rule and HTTP/socket integration tests → production frontend build → isolated backend image startup → staging deployment of same artifacts and rules/indexes → staging browser/mobile smoke → release approval.

Proposed script names to implement: `test:rules`, `test:integration`, `test:contract`, `test:e2e`, `test:smoke`, `lint`, `test:coverage`. Existing commands are only backend/frontend `npm test` and frontend `npm run build`; the root package currently has no orchestration scripts.

Coverage should expose untested critical branches; prioritize 100% of the authorization/state-transition cases listed above. Proposed critical-module branch target is >=90% after test infrastructure is in place, with documented exceptions. Do not interpret that number or utility-test totals as proof of correctness. For new critical tests, prove they fail against the pre-fix behavior and pass against the fix.

Require no skipped/quarantined release-critical cases, no `.only`, no unexpected console errors, and preserved reports. Use synthetic auth fixtures and isolated parallel data, fake deterministic time for expiry, and bounded eventual-consistency assertions. Protect tokens, signed URLs and personal fields in uploaded artifacts. Repeat concurrency/contract tests after changes affecting their boundaries.

## 9. Release checklist and stop conditions

- [ ] R01-R15 resolved with negative and positive integration evidence; all additional P1 findings closed or risk eliminated by a tested constraint.
- [ ] Exact release commit is clean/reviewed; untracked React work and deleted documentation consciously included/excluded; all declared dependency graphs build from clean installs.
- [ ] Existing tests, new critical suites and production build pass on Linux with supported Node; no release-critical skips/flakes.
- [ ] Deployed Firestore/Storage/IAM/Auth/Hosting/Railway settings match the release manifest; all indexes ready; no secret in browser bundle/image/history report.
- [ ] Approved dispatcher/driver/kiosk role and data matrix tested on HTTP, sockets and direct Firebase client.
- [ ] Browser E2E and supported Android contract test pass against same staging artifacts; accessibility/mobile recovery defects resolved or explicitly owned.
- [ ] Load/soak budgets and Firestore cost reviewed; office NAT traffic succeeds; abuse controls and alert delivery tested.
- [ ] Backup/restore, migration recovery and rollback rehearsed; previous image/frontend/rules versions preserved; old/new clients compatible.
- [ ] Named release operator, support path, incident owner and rollback decision-maker; monitoring dashboards and runbooks usable.
- [ ] Release begins with a limited operational cohort, verifies real health/critical reads and approved synthetic smoke, then expands after observation.

Stop/roll back for any unauthorized access, privilege escalation, lost/duplicated assignment, invalid QR admission, nonfunctional login/dispatch/POD, missing monitoring, failed readiness, or exceeded agreed error/latency limits. Code rollback alone cannot undo destructive data changes; restore or forward repair must be part of the tested procedure. Public production load/destructive tests need a separate defined production test window and data policy.

## 10. Release evidence record

Each test execution should record: test ID, finding IDs, commit/artifact, environment/project, synthetic fixture, exact command/scenario, expected versus actual result, timestamp/duration, pass/fail/blocked, redacted artifact path, defect/owner, fix commit and retest result. Unknown infrastructure or browser evidence stays **not verified** until collected. Re-score and make the final ship decision only after all required gates are complete.
