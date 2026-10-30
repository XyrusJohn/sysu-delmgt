# SYSU-GO project notes summary

Updated: 2026-10-15

Audit limitation: reported test and deployment results are documented evidence; this docs audit did not rerun them. See the [documentation index](README.md) and canonical [fix tracker](FIX_TRACKER.md).

This is a navigation summary of the active SYSU-GO notes and trackers. Detailed acceptance criteria and test evidence remain in the linked source documents; historical test counts describe their dated runs and are not cumulative totals.

## What this project owns

`sysu-go` owns the Android driver's account/profile, QR queue admission, dynamic queue position, trip registration/progress, GPS publishing, and POD experience, plus the mobile backend endpoints used by the app. `sysu-app` owns the web dashboard, queue kiosk, SAP assignment view, and web maps. Cross-app acceptance is shared.

## Current status

- The latest broad automation checkpoint is 2026-10-14: native UI/camera 16/16, mobile backend 140/140, Android debug and release unit runs 79/79 each, mirrored local Firestore policy tests 29/29 per project, paired native-to-web workflows 4/4, browser workflows 16/16, and strict 16 KB runtime smoke 2/2. These results cover the listed scenarios; they do not prove actual-phone GPS/battery performance or full production acceptance.
- The trucking-company registration and confirmation recovery changes are documented as deployed to the controlled beta backend. The app retains company information through profile/session reads, requires it before queue admission, and reconciles ambiguous registration responses against server state. The 2026-10-14 focused hotfix checkpoint records backend 148/148, Android unit 81/81, and native workflow 16/16. The updated installed phone's complete registration-to-kiosk flow remains to be confirmed.
- Dynamic queue numbering uses registered, eligible drivers and refreshes on both Home and Queue Details. Automated 3 → 2 → 1 progression checks pass; the APK must still be installed and compared against the live web queue.
- Historical shipment display and stale queue snapshots have code-level regression coverage. The old-assignment exclusion and actual return-to-base behavior still require intended-phone checks.
- Tracking work consolidates location sending, rejects stale/out-of-order updates, and keeps map lifecycle behavior aligned. The phone's actual GPS, background, reconnect, latency, battery, and write-count behavior has not been measured.

## Open production and release work

- **G-26 / registered queue read:** index and exact read-only query are verified; authorized endpoint behavior and a real phone registration appearing on the hosted kiosk remain open.
- **G-27 / historical shipments and queue card:** implementation and automated checks are recorded; Q01–Q05/Q10 phone UI and phone-to-web card acceptance remain open.
- **G-28 / dynamic queue position:** the automated renumbering and live Details listener pass; install the matching APK and confirm both mobile screens track web when another driver is assigned.
- **G-29 / location tracking:** local regression and backend work are recorded; complete intended-phone tracking and device measurements.
- **G-30 / Android 16 KB compatibility:** runtime smoke passes, but three vendor-library static RELRO alignment checks still fail. This remains an open release gate.
- **S01–S12:** full deployed phone-to-web journey acceptance remains open, from login and QR registration through assignment, loading, transit, POD, return, next trip, and recovery.
- The release plan also retains security, IAM/key remediation, signed-artifact, deployed-rules, and rollback/recovery evidence gates. A controlled beta deployment is not public-release sign-off.

## Source documents

- [SYSU-GO fix tracker](FIX_TRACKER.md) — G-01–G-30 findings, statuses, and “done when” criteria.
- [Integration checklist](INTEGRATION_CHECKLIST.md) — shared beta workflow and current device acceptance items.
- [Release test plan](RELEASE_TEST_PLAN.md) — test strategy, isolation requirements, and security/release gates.
- [Queue position recovery](queue-position-recovery-2026-10-09.md) — cause, implementation, test evidence, and APK acceptance still needed.
- [Company registration review](registration-company-review.md) — company persistence, confirmation recovery, and deployment/device caveats.
- [Activity log](activity-log.md) — dated implementation and deployment checkpoints.
- [SYSU App summary](../../sysu-app/docs/project-status-summary.md) — web/backend status and shared release gates.

## Reading historical notes

The `superpowers`, `sysu-powers`, and `archive` documents preserve earlier designs, implementation plans, and legacy integration notes. Use the current fix tracker and latest dated verification for present status; archived assessments are historical context rather than live findings.
