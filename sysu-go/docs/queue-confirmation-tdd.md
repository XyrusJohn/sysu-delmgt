# Queue confirmation fix — 2026-10-09

Journeys were derived from the reported `Queue Error: Unauthorized` on `Kumpirmahin ang Biyahe` (Confirm Trip). ECC `orch-fix-defect`, `orch-pipeline`, and `tdd-workflow` were used. The user approved the focused fix. No commits, pushes, dependency changes, production changes, or device installs were performed.

## Findings and changes

- Queue admission used a cached Firebase token without recovery after HTTP 401. `QrHttpClient` now retries exactly once with a forced refresh supplied by `QRApiService`. The same Firebase driver UID is checked before and after token retrieval. Other errors and ambiguous network failures are not retried automatically.
- `TripRegistrationActivity` previously returned home after admission, although the server created the entry with `registrationComplete: false`. It now calls the tested `TripRegistrationFlow` to complete registration before showing success.
- Existing registration treated 401, 409, and 500 as success. These now remain errors. The admitted queue ID is retained in the session and saved activity state so a registration retry does not consume another QR.
- Existing user changes to truck validation and other files were preserved. Modified production files: `TripRegistrationActivity.kt`, `QrHttpClient.kt`, `QRApiService.kt`, and new `TripRegistrationFlow.kt`. Tests: `QrHttpClientTest.kt` and new `TripRegistrationFlowTest.kt`.

## Executed evidence

JDK: `C:/Program Files/Android/Android Studio1/jbr`, OpenJDK 21.0.10. The other Android Studio installation's JDK failed before Gradle with missing `lib/jvm.cfg`; that was an environment failure, not RED evidence.

| Guarantee | RED | GREEN |
|---|---|---|
| A rejected cached token can recover queue admission | `:app:testDebugUnitTest --tests com.sysu.go.network.QrHttpClientTest --tests com.sysu.go.network.TripRegistrationFlowTest`: executed QR suite 21 tests, 1 failure, `unauthorizedAdmissionRefreshesIdentityAndRetriesOnce` | Full Android suite passed; QR suite 24/24 |
| Admission must be followed by registration; errors cannot become success; saved IDs skip repeat admission | Initial test compilation failed because the new `TripRegistrationFlow` contract was absent; this is compile-time contract RED, not a runtime reproduction of the old Activity | Flow suite 5/5; updated Activity compiled and APK built |
| Existing backend authorization and ownership restrictions remain | Existing regression input, not new RED | `node --test tests/security/authBoundaries.test.cjs tests/security/qrRouteGates.test.cjs tests/security/tripOwnership.test.cjs` in `backend`: 39/39 |

Final Android command, with the JDK above set as `JAVA_HOME`:

```powershell
./gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:qrTransportCoverage --console=plain
```

Result: `BUILD SUCCESSFUL`; 53 tests, zero failures and zero skipped. QR recovery tests additionally cover explicit forced-provider use, identical retry payload, second 401 stopping, missing/throwing refresh provider, and no retry for 403/409/410/500. `git diff --check` passed.

QR transport JaCoCo: 69/69 lines (100%), 60/65 branches (92.31%), 533/544 instructions (97.98%), 7/7 methods. This covers `QrHttpClient` only; it does not establish whole-app or Firebase SDK coverage.

Code and security review found no Critical/High blockers in the changed flow or QR recovery. Existing multi-helper contract limitation remains: the Activity combines other helper names into `helperLN`, whose backend limit is 50 characters, while admission permits `helperName` up to 100. Long combined helper names can still fail registration with 400. A registration response lost after a committed write can require authoritative queue refresh rather than another blind retry. These are follow-ups, not successful confirmations.

## Artifact and live verification gap

APK: `app/build/outputs/apk/debug/app-debug.apk`, 33,938,176 bytes, production endpoint configuration. SHA-256: `B5D3D2D0C871D32026C03E61804795D95F492FF77C90FA004FB10A23454F5F76`.

Production-configured beta artifact: `app/build/outputs/apk/liveTest/app-liveTest.apk`, built 2026-10-09 10:43:56 local time, 31,209,541 bytes. `./gradlew.bat :app:assembleLiveTest --console=plain` completed successfully, including `lintVitalLiveTest`. Generated configuration confirms `https://sysu-go.onrender.com` and `USE_FIREBASE_EMULATORS = false`. SHA-256: `E3E97084CE66EDAC16C04F339901DF2692186E5885028EBFE5CB38301F41B1F9`. This is the beta artifact handed over after the user requested simpler, faster production fixes.

Public production `GET /api/health` returned HTTP 200 with `status: ok`; this does not exercise Firebase authentication. `adb devices -l` found no connected devices. The user reports installing the new build APK; an older installed build is not established. The exact live 401 cause remains unverified because backend auth maps token, configuration, and profile-read exceptions to the same 401 response. Current source maps QR 401 to `Please sign in again`, which differs from the reported `Unauthorized` wording.

Required live follow-up: install this artifact, use an active driver account and a fresh QR, confirm the trip, and verify the owned queue entry has `registrationComplete: true` and appears in the web queue. If 401 persists after forced refresh, inspect sanitized server error categories and the installed APK identity; do not assume another refresh fixes a server credential/configuration failure. No whole-app readiness claim is made.
