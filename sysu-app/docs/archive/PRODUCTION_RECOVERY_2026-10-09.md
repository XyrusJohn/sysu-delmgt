# Railway production recovery — 2026-10-09

## Warehouse socket regression and production data verification

Incident W-01: server.js destructured getWarehouseBaseConfig/saveWarehouseBaseConfig, but warehouseBaseController defined without exporting them. The shipped socket callback returned the exact `getWarehouseBaseConfig is not a function` error. RED f04e5ee captured 4 failures/3 passes; minimal fix exports both helpers, preserving authorization. Final dedicated tests cover warehouse socket and HTTP reads/writes/denials plus all role-helper exports (10 passing); backend unit regressions 103/103 pass. GREEN commit 19b4bc9.

Uploaded sysu-app current source through Railway up. Deployment fb41db33-08f2-42d0-a06c-ccad930a31ea is SUCCESS. New deployment logs show the server running on 8080; sampled logs contain no warehouse-function error. Production health/readiness and four hosted-origin CORS preflights still pass.

Read-only Admin Firestore counts: users29, drivers21, queue17, sap_assignments12, settings1. Separate browser-facing REST reads with the existing web project's API configuration return HTTP200 and drivers21/queue17/assignments12. Production warehouse setting exists. No records or account roles/status were modified.

A legacy super_admin profile without status was identified, but reading the actual deployed rules disproved the initial hypothesis that it caused this live data issue: currently deployed rules permit these reads without that status check. The stricter local rules have not been deployed. The existing production rules remain a previously tracked security gate; no broad rules rollout was bundled into this incident repair. The user's authenticated browser dashboard rendering and SAP source have not been independently verified by these collection reads.

## Mobile Google sign-in configuration recovery

After the user reported Google sign-in error 10 from Android Studio Run/Build, the default debug target and signing registration were checked against actual APK resources/certificate and the current Firebase Android configuration. Default debug had used demo Firebase/package `com.sysu.go.debug`, while the workstation key was absent from production Android OAuth registration. Default debug now uses existing production Firebase/services/package; SDK emulator attachment is controlled by an explicit flag and isolated variant. Current SHA-1/SHA-256 were added while retaining previous registrations, and the refreshed SDK configuration confirms the matching Android OAuth client. Both actual debug/liveTest APKs pass 4/4 project/package/signing/audience checks; 43 Kotlin cases pass per debug/liveTest/emulator variant; build/lint pass; EnvironmentPolicy coverage is 100% lines/branches. No connected device was available: actual Google login is not claimed. Mobile source GREEN `861391f`; G-25 remains IN PROGRESS for phone acceptance. See [mobile Google login evidence](../../../sysu-go/docs/GOOGLE_LOGIN_RECOVERY_2026-10-09.md).

## W-02: Delivery Filter and POD display recovery

The user's production browser received queue/location data but Delivery Filter was empty despite existing `sap_assignments`. The frontend built every delivery group from `/api/sap/shipments`, which correctly returns only unassigned SAP rows. Firestore assignments supplied lifecycle data but could not create display rows. Collection-read health checks did not test this rendering failure.

The dashboard now rebuilds display groups on both SAP refresh and assignment snapshots. Stored assignment line items supply assigned cargo, preserving leading-zero identifiers, multiple OBDs, repeated OBD rows and their canonical quantities. SAP data supplements fields available upstream; absent fields remain unavailable. No database state is changed. Assigned records remain excluded from For Assignment. Delivered includes completed trips and returning-to-base trips only when their nonempty line items all have POD completion; the return phase is retained in the status label. Returning shipments expose their POD previews. Numeric, Firestore and unavailable capture timestamps render without a crash. Shipment text, callback identifiers and HTML attribute quotes are escaped.

ECC TDD checkpoints: RED `cd60628` / `d1672c3` reproduced missing rows and invalid/missing POD timestamps (8 failed, 3 passed); GREEN `22eda2c` passed all 11 new cases. Independent code/security review identified overlapping OBD multiplicity and identifier escaping: RED `5dd493c` (2 failures), GREEN `806ca51`; action-attribute injection RED `d2bc1bc`, GREEN `d9427bb`. Final dedicated suite: 14/14, plus existing grouping tests 3/3. The independent final review found no remaining critical new regression for the supplied production schema. Supplementary fields absent from repeated stored OBD rows use the first matching SAP row; canonical quantities are retained.

Final verification:

| Check | Actual result |
| --- | --- |
| Node 24 frontend Vitest suite | 78/78, 16 files |
| ESLint frontend source | 0 errors; 64 existing warnings |
| Production `npm run build` | PASS, 77 modules |
| Playwright current-source desktop and Pixel 7 browser flows | 10/10 PASS, 34.5 seconds final rerun |
| Delivery browser scenario | Login → stored assignment absent from SAP → Delivered → search second OBD → detail → subcollection POD preview → For Assignment exclusion → live In Transit update → assignment removal |
| Existing browser regressions | Staff profile save/logout, anonymous access, disabled-session termination, assignment/approved cancellation/archive/reassignment all pass on both browser projects |
| Production read-only projection | HTTP200; 12 stored assignments / 12 displayable; 40 stored line rows / 40 projected; 8 delivered, 2 in transit |
| Firebase Hosting | `firebase deploy --only hosting --project sysu-web-5a25d` completed with final dashboard asset `dashboard-BxvCpPnx.js` |
| Served root/dashboard/QR HTML and dashboard JavaScript | HTTP200; SHA-256 matches final local production build, including `dashboard-BxvCpPnx.js` |
| Railway post-deployment probes | Both services HTTP200, sysu-app Firestore readiness HTTP200, four hosted-origin preflights HTTP204 with exact origins |

Browser tests use isolated demo Auth/Firestore and a freshly built test artifact; they do not write to production. Production projection checks only read existing documents and print aggregate counts. The existing production project, credentials, Railway endpoints and records were preserved. Actual owner-session rendering in the user's browser and Android-device cross-app acceptance are separate from these checks. No new whole-app coverage percentage was measured (Vitest coverage provider is absent); no 80% coverage claim is made. These results close the reported display incident, not every public-release gate.

## Firebase Hosting recovery

The user's `firebase deploy --only hosting` failed before upload because frontend had no `.firebaserc` project mapping. Added default project sysu-web-5a25d. Rebuilt the current frontend with Node 24 (76 modules, successful production configuration validation), then successfully executed `firebase deploy --only hosting --project sysu-web-5a25d` from frontend. Firebase reported release complete. No Firestore rules were included in this deployment.

Live root, dashboard.html and qr-generator.html each return HTTP 200; SHA-256 of each delivered HTML matches the freshly built file exactly. Both Railway health endpoints, sysu-app Firestore readiness and all four hosted-origin CORS preflights were rechecked and still pass after Hosting release. The installed phone APK and complete authenticated shipment flow remain unverified.

Project: splendid-courage (`6caec00e-4b8c-4b50-8d1e-0de2fe67de81`), environment production.

Both services were observed CRASHED after the user's deployments. The startup guards required configuration which the deployed variables did not satisfy. sysu-go lacked SYSU_ENV and FIREBASE_PROJECT_ID; sysu-app included a localhost origin which its production origin guard rejects. Existing credential JSON was present in both services and identified the existing project sysu-web-5a25d. No credential values were printed by the Railway inspection.

Production variables were repaired through the linked authenticated CLI, preserving existing credentials and the existing database. sysu-go now has SYSU_ENV=production, FIREBASE_PROJECT_ID=sysu-web-5a25d and NODE_ENV=production. Its allowed origins include both existing hosted website origins and the existing workstation origins. sysu-app's production allowed origins are exactly https://sysu-web-5a25d.web.app and https://sysu-web-5a25d.firebaseapp.com.

The first CLI origin list lost comma separators under PowerShell argument parsing. This was detected during verification and corrected with quoted arguments before accepting the recovery. The final live CORS checks pass.

Verified production deployments:

| Service | Deployment | State |
|---|---|---|
| sysu-app | 555b3bd7-5b49-48cd-a515-492f3fc8d217 | SUCCESS |
| sysu-go | c6e4e51f-c179-4fa0-addc-bfc3d23a0e31 | SUCCESS |

Verified public responses after these deployments completed:

| Check | Result |
|---|---|
| sysu-app /health/live | 200 live |
| sysu-app /health/ready (actual Firestore read probe) | 200 ready |
| sysu-go /api/health | 200 ok |
| sysu-app OPTIONS from each hosted website origin | 204 with exact matching allow-origin |
| sysu-go OPTIONS from each hosted website origin | 204 with exact matching allow-origin |

This recovers the Railway startup outage. It is not evidence of phone installation, authenticated shipment/POD acceptance, credential rotation, or Firebase Hosting/rules deployment. Variable-triggered deployments reuse the already-uploaded service artifacts; exact source-commit correspondence has not been independently proven. Existing release gates retain their status.
