# SYSU App project notes summary

Updated: 2026-10-15

This is a navigation summary of the active SYSU App notes and trackers. Detailed acceptance criteria and test evidence remain in the linked source documents; older counts below are dated checkpoints, not a single cumulative test total.

## What this project owns

`sysu-app` owns the web dashboard and kiosk, SAP shipment display and assignment workflows, queue-card projection, and the web tracking maps. `sysu-go` owns the Android driver experience and its mobile backend. Cross-app acceptance is tracked in both projects and in the [workspace recovery plan](../../production-recovery-plan.md).

## Current status

- The latest documented broad automation checkpoint is 2026-10-14: frontend 105/105, web backend 153/153, browser workflows 16/16, mirrored Firestore rule tests 29/29 in each project, and paired native-to-web workflows 4/4. These are scoped suite results, not complete production sign-off.
- The overview-map marker lifecycle fix is deployed. Completed trips no longer reappear from later status-only events; saved active locations show as awaiting GPS until fresh fixes arrive. Marker and frontend regression checks passed as recorded in the [fix tracker](FIX_TRACKER.md).
- Queue-card authorization and polling/CORS fixes are deployed. The owner confirmed the AUV queue card became visible and later reported no new CORS errors. The hosted queue's full registration acceptance still depends on the intended phone and deployed versions.
- On 2026-10-15, temporary SAP review-only visibility was deployed for a dispatch row that lacks required assignment data. The row is not assignable; the dispatch-specific exception remains pending owner review. Consult the authorized operational record for identifiers and deployment references.

## Open production and release work

- **W-03 / queue endpoint:** the composite index, exact query, and endpoint have passed read-only checks. Hosted polling and actual Android registration appearing in the expected group/order still need acceptance.
- **W-05 / queue cards:** code and deployment checks are recorded and the owner saw an AUV card. End-to-end registration from the intended installed app and the correct card details/order remain open.
- **W-08 / live tracking:** sender, backend ordering, map lifecycle, and regression work are implemented and deployed. GPS freshness, background/reconnect behavior, latency, battery, and write-count evidence from the intended phone remain open.
- **S01–S12 cross-app trip:** actual login/QR/registration, assignment and OBDs, loading, transit/location, POD, return-to-base, next trip, cancellation, and recovery have not all been accepted on the matching deployed versions.
- The broader **R01–R51 security and release tracker** is not closed. Its status definitions require deployed/negative authorization evidence and tested rollback/recovery where specified; passing local tests alone does not close it.

## Source documents

- [Production fix tracker](FIX_TRACKER.md) — W-01–W-08 incidents, R01–R51 release findings, and closure criteria.
- [Controlled beta checklist](BETA_CHECKLIST.md) — current shared phone-to-web acceptance sequence and outstanding beta gates.
- [Automated release validation](automated-release-validation.md) — dated suite results, artifact checks, and retained compatibility failures.
- [Live-location plan](live-location-optimization-plan.md) — implementation decisions, tracking checks, and phone measurements still required.
- [Queue-card recovery](archive/queue-card-recovery-2026-10-09.md) — QR card, queue access, and kiosk polling evidence.
- [Controlled beta deployment](controlled-beta-deployment-2026-10-14.md) — deployed scope and rollback details for the mobile tracking beta.
- [SYSU-GO summary](../../sysu-go/docs/project-status-summary.md) — mobile-specific status and remaining gates.

## Reading historical notes

The dated production recovery reports, test plans, and archived assessments explain how findings were discovered. Prefer the current tracker and the latest dated evidence when they disagree with an older snapshot. Archived documents are retained as history, not as current acceptance status.
