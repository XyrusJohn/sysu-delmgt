# Phone-to-web live location: review and implementation plan

Date: 2026-10-09. Scope: SYSU-GO Android, its Socket.IO backend, and SYSU App Overview/Tracking maps. Status: **implementation and recorded automated checks completed; dated evidence says web and production backends were deployed; phone acceptance was pending at the checkpoint**. Treat this as historical evidence; current finding state is in [FIX_TRACKER](FIX_TRACKER.md), and no current deployment or phone state is implied. Use small compatible changes, existing dependencies and existing collections. W-08/G-29 own this work; R25/R27/R39 and G-13/G-16 retain their wider acceptance conditions.

## Baseline flow and evidence before implementation

`LocationServices.kt` receives high-accuracy GPS fixes, requests a nominal five-second interval with a ten-metre provider distance gate, then applies another five-second/ten-metre filter. It emits `driver_moving` through `SocketManager` to the SYSU-GO backend. It also writes `driver_locations/{uid}` and one active assignment's `lastLocation` directly through Firestore.

`GeneralTrackingActivity.kt` independently requests GPS while visible and calls `pushLocationUpdate`, emitting the same socket event and the same two Firestore writes. Starting tracking starts both producers; returning to the screen reattaches the UI producer. The nominal interval is five seconds, but its fastest interval is two seconds. The service advances its send time/position before learning whether the socket sent anything. Disconnected socket sends are discarded. Direct Firestore write Tasks have no completion/failure handling in these paths.

The SYSU-GO backend authenticates driver packets, checks coordinates, and emits `update_admin_map` plus `vendor_status_update` to tracking staff. It reads the linked assignment for each GPS packet, but checks ownership without checking that the linked trip is still active. Location payloads omit location timestamps; replay to a newly connected staff socket supplies `sapDocId=null` and reports online even after a stopped event. Authentication and assignment reads happen asynchronously, so transport ordering alone does not establish ordering between application tasks or independent feeds.

Account compatibility also needs explicit verification: W-06 accepted the existing legacy super-admin profile without a status field for kiosk cards, while the current SYSU-GO socket-auth source requires explicit `status=active`. Queue-card success therefore does not prove that the same web account can subscribe to tracking. This is a source/deployed-version compatibility check, not a newly observed production tracking denial. Preserve authentication; establish the intended approved-account policy before any account/permission change.

The web receives SYSU-GO events, SYSU App socket events and, in the Tracking panel, Firestore snapshots. It updates marker position without a shared freshness check. The panel timestamps cached snapshots with `Date.now()` instead of the document's `updatedAt`, listens to `update_status` rather than the backend's `vendor_status_update`, and disconnects/removes all listeners from a shared socket on panel cleanup. Its Firestore listener is not unsubscribed on that cleanup. Several online handlers invent Manila coordinates when GPS is absent. `MapManager.seedMarker` already avoids this fallback, so the behavior differs between entry points.

The SYSU App backend's separate legacy socket path persists location only after **both** ten minutes and 100 metres. Its active-location query omits returning-to-base trips. Android currently connects to SYSU-GO, so changing only that legacy backend throttle will not optimize the actual phone producer. Preserve the compatibility path during the first implementation batch.

Return-to-base starts without stopping the service; arrival/closure stops tracking. Preserve that lifecycle. A socket heartbeat every 15 seconds is connectivity evidence, not proof of a fresh GPS fix. A sixty-second stopped timer without subsequent good GPS can confuse lost GPS with a stationary truck. None of these source observations establishes the behavior of the user's installed APK.

## Executed checks

| Check | Passed | Failed | Scope |
| --- | ---: | ---: | --- |
| New web tracking review | 5 | 9 | Current panel handlers executed in a VM; synthetic GPS/snapshot/event inputs and a marker adapter |
| New mobile-backend tracking review | 0 | 5 | Actual shipped server over local Socket.IO; synthetic Firebase, no live writes |
| Existing web socket authorization/persistence tests | 13 | 0 | Actual server handlers with synthetic dependencies |
| Existing mobile-backend default suite | 119 | 0 | Existing backend regressions; does not automatically discover the separate `.spec.cjs` protocol files |
| Existing real Socket.IO integration suites | 9 | 0 | Staff privacy, ownership, revocation, lifecycle and reconnect tests, explicitly invoked |
| Existing frontend suite | 81 | 0 | Vitest; current general UI regressions |
| Android SocketSessionGate debug unit tests | 3 | 0 | Compiled Kotlin session/account/replacement callback guards |

New robustness baseline: **19 checks, 5 passed / 14 failed**. Failures overlap; this is not fourteen independent production outages. L04/L08/L16 supply timestamps to describe the desired stale-update contract, which current location handlers do not implement. L15 checks the missing timestamp contract. Other failures reproduce present marker/event/cleanup/linkage behavior. Existing passing suites do not cover these new conditions.

The former App source review harness targeted a removed document-store callback and has been retired. Current App regression coverage runs through Vitest; the Go protocol review remains a separate Socket.IO check. These tests do not measure real Leaflet rendering, Android GPS/battery, hosted latency or production behavior.

From `sysu-app`, run the current frontend regression suite:

```powershell
npm test --prefix frontend
```

From `sysu-go/backend`:

```powershell
../../sysu-app/.tools/node24/node-v24.21.0-win-x64/node.exe tests/review/live-location-review.cjs
../../sysu-app/.tools/node24/node-v24.21.0-win-x64/node.exe --test tests/integration/serverSocket.spec.cjs tests/integration/socketAuth.spec.cjs
```

## Minimal implementation order

### 1. One mobile sender, reliable first fix and reconnect

- [x] Make `LocationServices` the sole owner of GPS network sends. Keep the tracking screen's callback for its existing read-only telemetry/UI; remove its socket/Firestore publication. Avoid adding a new event bus.
- [x] Request a fresh initial fix in the service, and refresh/resend the latest eligible fix after an authenticated reconnect. Keep one latest pending fix in memory rather than a GPS backlog. Clear it on logout, account/trip change and closure.
- [x] Use monotonic elapsed time for throttling and GPS-fix age. Validate finite/ranged coordinates and measured accuracy before publication. Initial proposed eligibility: age <=15 seconds and accuracy <=50 metres; tune from the device run. Rejected/absent fixes show GPS unavailable/weak instead of a new position.
- [x] Keep a five-second moving cadence. Move distance filtering into the sender policy so the provider can still supply stationary fixes. Refresh a valid stationary location about every 30 seconds; distinguish a stationary fix from no GPS fix. Preserve the existing 15-second presence heartbeat.
- [x] Do not consume the successful-send/retry budget when disconnected or when an operation fails. Bound in-flight persistence and handle completion/error without logging coordinates, identity fields or tokens. Cancel initial-fix requests/listeners on service teardown.

Affected files: `sysu-go/app/src/main/java/com/sysu/go/services/LocationServices.kt`, `activities/GeneralTrackingActivity.kt`, `network/SocketManager.kt`; add only a small testable sender policy if needed for monotonic/age/distance decisions. Check existing start/return/arrival callers. No new Android dependency is planned.

### 2. Ordered backend events and honest web markers

- [x] Include validated capture `timestamp` on new live/replay fixes, server receive time for legacy fixes and server event time for lifecycle events. Include bounded optional fix-age/accuracy metadata from updated phones; old packets remain compatible but have unknown capture quality. Finalize and test the contract before editing callers; the review tests' input timestamp is not a trusted identity or authorization field.
- [x] Keep the newest accepted fix per driver and reject older/ineligible samples. After any asynchronous assignment read, verify the sample is still current before emitting/persisting it. Retain current assignment identity and stopped/return state for late staff subscriptions; do not accept a completed historical assignment as the current link.
- [x] Have both web maps apply the same coordinate/age/state checks. A newer fix wins; duplicate or older cross-channel updates cannot rewind it. Completion/arrival blocks late packets from resurrecting that trip; a valid new trip may create a new marker.
- [x] Subscribe to actual backend lifecycle event names, preserve stopped/returning/offline states, and keep a real last-known position when offline. Online without GPS must show waiting for GPS, not an invented marker.
- [x] Use persisted `updatedAt`/`lastLocation.at` for a **last saved** position. Do not call a cached snapshot live just because it was received now. While a fresh socket fix exists, an unversioned Firestore snapshot cannot override it. Independently show socket connection and GPS freshness.
- [x] Cleanup removes only the panel's own handlers and its Firestore subscription; it does not disconnect the shared dashboard socket. Update marker position without rebuilding unchanged icons/popups; batch list updates and avoid full-dashboard renders for each GPS sample.

Affected files: `sysu-go/backend/server.js`, relevant existing socket validation/presence code; `sysu-app/frontend/src/components/MapTrackingPanel.js`, `MapManager.js`, `pages/dashboard.js`. Preserve current staff/driver ownership and revoked-session tests; do not optimize by bypassing authorization.

### 3. Persistence decision for this batch

- [x] Keep the existing mobile persistence owner to avoid a larger ownership migration. At most one checkpoint transaction runs at a time; successful checkpoints are separated by 30 seconds. Each transaction reads the linked assignment and requires the current driver owner and an active/returning trip, then atomically writes the existing driver-location and assignment-location fields. Failed transactions can retry on a later eligible fix; they do not queue a GPS backlog offline. Capture time is retained in existing timestamp fields.
- [ ] Measure actual sends, writes, reads and battery on the intended phone. Source-derived steady-state estimate: about four location document writes/minute plus two transaction reads/minute, excluding retries, restarts, Socket.IO authorization/assignment reads and other business traffic. This is not measured billing or production performance.
- [ ] Revisit backend-only checkpoint ownership only if device results justify it. No dependency, schema, Firestore rules or index change in this tracking batch. Strict checked-in rules have wider legacy/return-state acceptance gates; do not deploy them as part of this batch.

## Acceptance matrix and proposed targets

Targets below are **not measured production results**. Keep moving sends at most once per five seconds per driver; accepted fresh fix -> displayed web marker p95 <=10 seconds on a healthy connection. A persisted reload position is labelled last saved. GPS age >45 seconds is stale even while heartbeat is online. Existing heartbeat timeout/scanning implies offline detection roughly 45-60 seconds; keep that initially. Track age and transport delay separately.

| Cases | Expected result | Current evidence |
| --- | --- | --- |
| L01-L03 | Real coordinates render; null/malformed coordinates do not | L01-L03 PASS in current handler review; real Leaflet regression tests PASS |
| L04-L06 | Older socket/snapshot fixes cannot rewind; persisted age stays truthful | PASS in current handler review |
| L07-L09 | Completion removes; old trip cannot reappear; missing fix creates no fallback location | L07-L09 PASS in current handler review; backend closure/new-trip checks PASS |
| L10-L11 | Offline keeps last real fix; moving packet preserves ongoing return state | Offline retention PASS in both actual browser maps; return-state policy/backend PASS; phone acceptance pending |
| L12-L14 | Correct lifecycle subscription, shared-socket isolation, SQL subscription teardown | covered by current source/tests |
| L15-L19 | Timestamped events, stale rejection, late staff assignment/state replay, no completed link | L15-L19 PASS in real local protocol; legacy metadata and async lookup regressions PASS |
| L20 | Tracking screen open/closed produces one sender; repeated starts do not duplicate callbacks | Planned Android/device test |
| L21 | Initial stationary start obtains a real fix without requiring ten metres of movement | Planned device test |
| L22 | Five-second moving limit and 30-second stationary refresh; noisy/old fixes rejected | Sender-policy tests PASS; intended-phone tuning pending |
| L23 | Airplane mode/network switch -> latest fresh fix on reconnect; no GPS backlog replay | Planned protocol/device test |
| L24 | Socket/persistence failure does not consume retry budget; writes remain bounded | Sender dispatch budget and backend failure/async races PASS; Android SDK persistence failure/device acceptance pending |
| L25 | GPS disabled/weak signal differs from stopped and from network offline | Planned device/browser test |
| L26 | Screen-off/background tracking continues; permission removal is recoverable and visible | Planned device test |
| L27 | Return-to-base stays tracked until arrival; closure prevents late writes/ghost markers | Planned phone-to-web test |
| L28 | Next trip/account switch clears previous fix, retry state and listeners | Planned sender/browser/device test |
| L29 | Overview and Tracking agree on position/state; tab switching adds no listener/read leak | Desktop/mobile-web map position/state and tab-switch cases PASS; broader read/listener leak measurement pending |
| L30 | Updated and installed legacy APK versions remain compatible; stored snapshots show truthful age | Planned compatibility test |
| L31 | Supervised route records p50/p95 fix-to-marker lag, sends/writes/minute and battery delta | Planned device measurement |

Prepared matrix: **31 scenarios; L01-L19 review checks pass; L20-L31 have partial automated evidence and remaining device/measurement gates**. Some pending scenarios need several assertions rather than one test. On implementation, rerun the nineteen review checks, add policy/failure tests in the existing suites, run real desktop/mobile-web marker tests with local Leaflet assets and no retries, and run Android checks/build/signature for the changed APK. Then deploy only tested affected components and perform the intended-version phone run. Close W-08/G-29 only after that evidence is recorded.

Use synthetic GPS for automated tests. For a supervised real route, record aggregate timing/counts and redacted screenshots, not precise route/driver data in repository logs. Restore only this tracking batch if rollback is required; retain the shipped W-07 queue/CORS fix. No commit/push is part of preparation.

## Implementation checkpoint — 2026-10-09

Implemented with ECC E2E Testing and Living Docs Governance. Small compatible changes preserve queue registration/numbering, assignment/POD flows and existing authorization. No commits, pushes, dependency upgrades, rules or index deployment.

Affected implementation: Android `LocationServices`, `GeneralTrackingActivity`, `SocketManager` and `LocationSendPolicy`; SYSU GO `server.js`; web `socket.js`, `locationState`, `MapManager`, `MapTrackingPanel`, `dashboard.js` and `dashboard.html`; SYSU App server timestamps and active-location return-state query. Relevant policy, protocol, marker and browser tests plus the existing trackers/checklists were updated.

Browser packets come from a synthetic authenticated JavaScript driver against the isolated SYSU App server; both web socket endpoints use that local fixture. SYSU GO server behavior is verified separately with its real local Socket.IO protocol and synthetic Firebase. These automated runs do not prove the installed Android-to-production topology or a real moving route.

| Executed verification | Result | Scope |
| --- | --- | --- |
| SYSU App frontend full suite | 105/105 PASS | Includes 19 location-policy, 4 real Leaflet and token-refresh connection regression cases |
| SYSU App backend full suite | 153/153 PASS | Includes shipped queue-card/auth/CORS quota regressions |
| SYSU GO backend full default suite | 127/127 PASS | Includes 8 new real local GPS/failure/async/closure/reconnect cases |
| Existing real mobile Socket.IO integration suites | 9/9 PASS | Synthetic Firebase and real server/client protocol; separate from default suite |
| Explicit tracking review commands | Web 14/14; backend 5/5 PASS | Same nineteen review checks; initial diagnostic failures preserved above |
| Real Chromium browser suite | 16/16 PASS, retries 0 | Desktop and mobile-web; login/denial, kiosk, legacy super-admin, POD, cancellation/reassignment, both Leaflet maps and offline recovery |
| Android unit tests | 79/79 debug and 79/79 release PASS | 79 unique cases repeated in two variants, including 10 sender/checkpoint-policy cases |
| Android liveTest APK / lint / signature | PASS | Build successful; lint 0 errors / 1,171 warnings; APK v2 signature verifies |
| Changed-file ESLint / production Vite build | PASS | 0 errors / 17 warnings; production build 79 modules |

The new browser cases initially failed on label matching, already-connected initialization, offline recovery and a first-connection token-refresh race. Final UX assertions also exposed duplicate count IDs. Tracking now permits normal interaction, renders status labels and updates both counts using distinct IDs; sidebar selection uses a data attribute instead of interpolating IDs into executable handlers. The final implementation retains a requested secondary connection across token updates, keeps current-account/revocation checks, and clears that request on logout. Invalid coordinate tests continue to expect rejection/disconnection at the existing authorization boundary. No assertion was skipped or retried to obtain the final browser pass.

Production backend deployments: SYSU App `76d50df7-3531-48d9-bed3-8c3c09274f4b` and SYSU GO `334ad995-bd37-4da5-a352-3659730a6e13`, both SUCCESS. Health checks return 200; hosted-origin CORS preflights return 204; queue-display and authenticated super-admin queue-cards return 200. User explicitly approved setting the sole existing legacy super-admin profile's status to active; Auth is enabled and the role was verified unchanged. Actual authenticated super-admin sockets connect to both deployed services without sending GPS events or creating trip/queue test records.

Current APK: `sysu-go/app/build/outputs/apk/liveTest/app-liveTest.apk`; SHA-256 `438bb9d718148ee5fdbb6392252ad96217a3b3ad2ae17ede0765f79fc9103262`. Production Firebase/endpoints, workstation debug signing. No adb device connected; installation, real GPS, screen-off/background behavior, installed legacy APK compatibility, full trip-to-arrival flow and p50/p95 latency/battery/actual write counts remain unverified. W-08/G-29 stay IN PROGRESS. Socket dispatch is not a server acknowledgement.

Firebase Hosting deployment completed. Remote index, dashboard and QR Generator HTML plus `/assets/dashboard-_ZXCz6Eu.js` returned HTTP 200 and SHA-256 matched the current production build. Browser evidence: sixteen expected, zero skipped/unexpected/flaky, retries zero, duration 120.5 seconds, recorded in `.tools/tracking-browser-result.json`. Both worktrees pass `git diff --check`; canonical tracker IDs and documentation links verify.

## Primary references

Android fixes provide monotonic elapsed-realtime metadata and accuracy: [Android Location API](https://developer.android.com/reference/android/location/Location). Firestore Android offline persistence queues updates, and changes to one document follow last-write-wins behavior: [Firestore offline data](https://firebase.google.com/docs/firestore/manage-data/enable-offline). Socket.IO preserves transport ordering, but its default delivery is at most once; server events missed during disconnection are not automatically replayed: [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/). Therefore the proposed latest-fix recovery and cross-source ordering checks address application behavior rather than assuming the transport reorders packets.

Canonical status: [web tracker](FIX_TRACKER.md), [mobile tracker](../../sysu-go/docs/FIX_TRACKER.md), [workspace recovery plan](../../production-recovery-plan.md).
