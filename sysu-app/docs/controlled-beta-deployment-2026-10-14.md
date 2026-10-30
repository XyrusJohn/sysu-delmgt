# Controlled beta deployment — 2026-10-14

User requested deployment to identify actual bugs after being informed of the three remaining Android static alignment failures. This is a controlled beta, not closure of G-30 or a general production-ready sign-off.

## Reviewed scope

- Mobile backend: only `backend/controller/qrController.js` and `backend/routes/qrRoutes.js` differ from the previous deployed runtime artifact. Add the authenticated private own-position endpoint; preserve existing registration, tracking, role and CORS behavior.
- Web backend source matches its previously deployed artifact, deployment `76d50df7-3531-48d9-bed3-8c3c09274f4b`; its current tracking/queue fixes are already live.
- Matching Android liveTest APK: CameraX 1.6.2 / ML Kit 17.3.0, private rank polling, cached-session guard, backup exclusions and release network resources. SHA-256 `ff42edc20a4773aa1b976e5603d23708e35281f9dc37762f88b39ba45faa9111`; workstation signing, `com.sysu.go`, production URLs.
- No Firestore/Storage rule deployment, migrations, production account eligibility edits, secret changes, infrastructure changes, commit or push in this rollout.

## Validation and limitations

Mobile backend 140/140, native UI/camera 16/16, paired native-to-web 4/4, strict 16 KB camera/QR smoke 2/2, Android debug/release units 79/79 each and browser regression 16/16 pass. [Canonical test evidence](automated-release-validation.md).

Three static RELRO checks still fail: arm64/x86_64 surface JNI and x86_64 barcode JNI. Passing the two x86_64 runtime smoke cases does not establish every ARM64/native path. Keep G-30 IN PROGRESS; do not report these checks as passed.

## Preflight

Both service health endpoints return 200. Approved super-admin sockets connect on both services, web queue-cards returns 200 with the correct CORS origin, and the exact registered waiting/called production rank query succeeds. The new own-position route returns 404 before rollout, confirming that the matching backend must precede installing the APK. Probes sent no GPS events and made no trip or permission writes. `.tools/beta-production-preflight.log` owns detailed results.

## Rollout and rollback

Project `6caec00e-4b8c-4b50-8d1e-0de2fe67de81`, production environment `fef6863a-5ffc-42d4-a0f0-f86f5b1d4ec5`, mobile service `dfdcaa39-51ba-4534-b6f5-c3d264fdf829`.

Upload the runtime-only artifact `.tools/beta-mobile-2026-10-14` to the existing service. It contains no `.env`, credentials, Android sources/APKs or test helpers; source hashes are recorded in `.tools/beta-deployment-metadata.json`. Existing Docker/Railway configuration matches the previous artifact.

Previous mobile deployment: `334ad995-bd37-4da5-a352-3659730a6e13`. Its exact runtime source is retained in `.tools/beta-mobile-rollback-2026-10-14`. If startup, registration/queue availability, CORS or authenticated socket checks regress, upload that saved artifact to the same project/environment/service and repeat health/auth checks. Reverting removes the new rank endpoint, so retain the previous installed APK until beta verification succeeds.

After a successful deployment, verify health, both authenticated sockets, web queue-cards/CORS, anonymous own-position denial (401), and non-driver staff denial (403). Then provide the matching APK for the user's actual trip acceptance. Production operational records are not fabricated by automated probes.

## Deployment result

Mobile deployment `5c2b152a-714d-46a8-9b33-6f6a3be41afd` is SUCCESS. Post-deployment production checks pass: web liveness and mobile health 200, own-position CORS preflight 204 with the hosted origin, anonymous denial 401, non-driver staff denial 403, exact production rank query succeeds, both authenticated super-admin sockets connect, and web queue-cards returns 200 with the correct CORS header. `.tools/beta-production-postflight.log` owns the redacted result.

Two availability samples 20 seconds apart pass 6/6: web readiness, mobile health and public web queue display all return 200; queue display retains the correct CORS origin. Observed response times were 296–562 ms. `.tools/beta-monitor-result.json` records the samples; this short observation is not long-term load or operational-trip acceptance.

The tested matching APK is ready for the user's manual installation from `sysu-go/app/build/outputs/apk/liveTest/app-liveTest.apk`. It has not been installed on a physical phone by this agent. No production queue, shipment, GPS or permission records were written by the probes. Three static Android RELRO checks remain failed; controlled beta deployment does not close G-30.
