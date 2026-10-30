# Automated release validation

Updated: 2026-10-14. Scope: SYSU-App and SYSU-Go automation, requested separately from actual-phone acceptance. ECC E2E Testing guides assertions, bounded waits and retained failure evidence. This report owns this batch; existing trackers retain their broader acceptance conditions.

## Plan

| Area | Planned evidence | Initial state |
| --- | --- | --- |
| Native UI | Espresso on the existing emulator build: login/denial, queue progression, old-shipment exclusion, assignment progress, navigation/session cleanup | Existing instrumentation only checks package name; no complete native workflow suite |
| Cross-app | Native Android changes reach the real local mobile backend and are visible on the website through Playwright | Previous browser GPS publisher was JavaScript; mobile protocol was tested separately |
| Failure/security | Wrong account/role, expired/revoked sessions, denied foreign writes, concurrent admission/assignment and retry/reconnect regressions | Existing passing suites; required additional assertions to be determined from observed coverage |
| Artifact | Compile/test isolation, production endpoint/signature/cleartext checks and package hygiene | Existing liveTest APK uses workstation debug signing; owner release signing and IAM remediation remain separate evidence gates |
| Regression | Relevant web/frontend/mobile backend/Android tests and existing browser workflows, no automatic retries | Prior recorded suites pass; no new run claimed yet |

## Execution

Tests use synthetic data on loopback Firebase emulators, not operational production records. Native UI/emulator tests do not measure real GPS accuracy, OEM battery behavior or physical-route performance. No dependencies have been changed.

### Verified checkpoint — 2026-10-14

| Suite | Result | Evidence / remaining work |
| --- | --- | --- |
| Frontend | 105/105 passed | Full run in this batch |
| Web backend | 153/153 passed | Full run in this batch |
| Mobile backend | 140/140 passed; zero failed/skipped | `.tools/go-final-tests.log` |
| Android units | Debug 79/79; release 79/79 | Gradle XML reports independently counted |
| Native UI | 16/16 passed after SDK update | `.tools/sdk-native-4k.log` and `.tools/sdk-native-4k-instrumentation.log`; includes real native-library loads and camera preview/zoom/cancel, plus the 15 workflow cases |
| Native-to-web | 4/4 passed after SDK update | `.tools/sdk-paired-regression.log` and `.tools/native-bridge-result.json`; desktop/mobile web; zero failed/skipped/flaky, retries zero |
| Firestore contracts | 29/29 mobile and 29/29 web passed | `.tools/shared-rules-final.log`; identical source hashes; zero failed/skipped |
| Browser workflows | 16/16 passed | `.tools/browser-final.log`; zero failed/skipped/flaky, retries zero |
| 16 KB artifact compatibility | 3/6 native libraries passed, three failed RELRO checks | `.tools/sdk-upgrade-alignment.json`; original baseline 0/4; all upgraded load segments now 16 KB; passing runtime smoke does not override this gate |
| 16 KB runtime smoke | 2/2 passed | `.tools/sdk-native-16k-final.log`, instrumentation and HTTP logs; Android 15 reports page size 16,384; camera/library loads and full QR registration; no compatibility fallback |

### Focused fixes and test coverage

- Native Home and Queue Details use the authenticated own-position endpoint instead of reading other drivers' private queue documents. The backend binds the requested entry to the authenticated active driver, returns only rank, coalesces reads, rate-limits polling, and fails honestly when unavailable. Nine focused backend cases pass, included in the full 140-case run.
- Cached or pending-write shipment snapshots cannot terminate an active tracking session. The paired native tracking run covers retained cached completed assignments, real Kotlin location publishing, background Home, socket reconnect, return-to-base and rejection of updates after closure on both actual local services and Leaflet maps.
- Mirrored local Firestore policies accept fresh owned native loading / fully-loaded metadata and captured GPS timestamps while rejecting foreign, cargo-changing, stale and future updates. These local policies are not deployed; broader guard/POD compatibility remains a separate release gate.
- Android backup is disabled and all app-storage domains excluded from backup/transfer. Four source-policy tests pass, included in the backend total; compiled liveTest manifest independently confirms `allowBackup=false`.
- `liveTest` explicitly shares `src/release/res`: initializing a build type from release does not inherit its source-set resources. The rebuilt compiled network policy now contains only `cleartextTrafficPermitted=false` and system trust anchors, with no local HTTP exceptions. Release APK independently confirms `allowBackup=false`; both variants build. liveTest lint has zero errors and 1,171 existing warnings. APK signature and ZIP page-alignment commands pass; this does not make the four ELF-library checks pass.
- Native UI covers approved/pending/wrong-password login, logout, dynamic rank 3 → 2 → 1, recreation, old-shipment exclusion, two-OBD loading / fully-loaded updates, role/foreign-queue denial, and bundled QR decoding followed by the real registration form.
- Versioned native runners isolate demo Firebase and loopback services, require a dedicated emulator, preserve streamed instrumentation evidence, and use existing dependencies.

Run from `sysu-app` using Node 24:

```powershell
& .\.tools\node24\node-v24.21.0-win-x64\node.exe frontend/tests/e2e/runNativeAutomation.cjs native
& .\.tools\node24\node-v24.21.0-win-x64\node.exe frontend/tests/e2e/runNativeAutomation.cjs bridge
```

Build the emulator app and instrumentation first from `sysu-go`:

```powershell
.\gradlew.bat assembleEmulator assembleEmulatorAndroidTest -PsysuTestBuildType=emulator
```

Shared policy regression from the workspace root:

```powershell
& .\sysu-app\.tools\node24\node-v24.21.0-win-x64\node.exe sysu-go/tools/run-client-rules.cjs
```

### Retained failure evidence

The expanded paired run initially passed two QR cases but failed both GPS background assertions: a mock injection completed before asynchronous provider publication, so the next single fix was supplied inside the service's five-second moving interval. The fixture now measures from the website's acknowledgement of the published sample. The next run passed both GPS cases and desktop QR, but mobile-web QR ended in a native input-focus ANR after the expected card appeared. This overlapped a Gradle release build on an 8 GB host with approximately 180 MB free RAM; resource contention was suspected. The final 4/4 run passed without Gradle overlap, after browser regression finished, on a dedicated 1,536 MB emulator. That establishes the tested flows, not a guarantee against all ANRs. RED results are retained in `.tools/native-background-cadence-red.json` and `.tools/native-qr-anr-red.json`.

Current signed liveTest APK SHA-256 after the approved SDK update: `ff42edc20a4773aa1b976e5603d23708e35281f9dc37762f88b39ba45faa9111`. It uses workstation debug signing, not owner-controlled release signing. The matching own-position backend was subsequently deployed at the user's request as controlled beta, deployment `5c2b152a-714d-46a8-9b33-6f6a3be41afd` SUCCESS. [Deployment and rollback evidence](controlled-beta-deployment-2026-10-14.md). APK physical installation remains user-owned; G-30 is not closed.

### Approved native SDK update — 2026-10-14

User approved the bounded update: CameraX 1.3.1 → 1.6.2 and bundled ML Kit barcode-scanning 17.2.0 → 17.3.0 in `sysu-go/gradle/libs.versions.toml`. Build, debug/release units (79/79 each), native UI/camera (16/16), paired native-to-web (4/4), strict 16 KB runtime smoke (2/2) and liveTest lint pass; lint has zero errors and 1,166 warnings. Release and liveTest APK ZIP checks and the liveTest signature pass; all six 64-bit libraries have 16 KB load alignment. The complete ELF check still fails three RELRO segments: arm64/x86_64 `libsurface_util_jni.so`, and x86_64 `libbarhopper_v3.so`. Three libraries pass. G-30 remains IN PROGRESS: passing two runtime smoke cases does not override the failed static gate or establish all ARM64/native paths.

The [Android 16 KB guide](https://developer.android.com/guide/practices/page-sizes) requires checking load alignment, RELRO and ZIP packaging, plus runtime testing. The final dedicated Android 15 emulator reports `getconf PAGE_SIZE=16384`. Android 15 has native 16 KB support; fallback compatibility was [introduced in Android 16](https://developer.android.com/about/versions/16/behavior-changes-all#16-kb-page-size-compatibility-mode). The runner requires the reported page size and verifies disabled fallback settings on API 36+, rather than attempting unsupported settings on API 35. SDK versions are documented in [CameraX releases](https://developer.android.com/jetpack/androidx/releases/camera) and [ML Kit releases](https://developers.google.com/ml-kit/release-notes).

### Final 16 KB execution and remaining gate

The installed API 37 image did not reach usable boot readiness. Official Android 15 16 KB x86_64 revision 5 was downloaded and its published SHA-1 `d709cf26b375abecfbbf5803afd20749ddfa2865` verified before extraction. An initial runner setup failed because Android 15 does not expose the later fallback properties; this was a setup failure, not a business-flow result. On a 1,536 MB guest, `system_server` aborted on an ART thread-suspend timeout before a valid camera test result, and a separate QR attempt reached decoding/form submission but failed with transport code -1. Those failed attempts remain retained.

The final run uses a 2,048 MB dedicated guest, bounds the local Firestore JVM to 384 MB and avoids simultaneous Gradle work. Both unchanged camera/QR assertions pass in one run, with no automatic retries. The actual mobile `/api/qr/scan` request returned HTTP 200 in 887 ms; exactly one completed queue registration and native queue number 1 were asserted. Test-only HTTP tracing records only the constant endpoint's response status/duration, never credentials or request bodies. This supports a test-resource explanation for the earlier interruption, without hiding the original failures.

Evidence: `.tools/sdk-native-16k-final.log`, `.tools/sdk-native-16k-final-instrumentation.log`, `.tools/sdk-native-16k-final-http.log`. Earlier diagnostics: `.tools/sdk-native-16k-crash.log`, `.tools/sdk-native-16k-camera-system-red.log`, `.tools/sdk-native-16k-qr-transport-red.log` and `.tools/sdk-native-16k-setup-blocked.log`.

Scoped functional testing is complete. Three static vendor-library RELRO checks remain failed, on both current release and liveTest artifacts. Further remediation requires verified compliant SDK binaries; no vendor binary edits, ABI removal or lowered checks were applied. The user subsequently requested controlled beta deployment to identify actual bugs; the matching backend is live and post-deployment health/queue/CORS/authenticated socket checks pass. Owner release signing, production policy compatibility/IAM and physical-route acceptance remain separate gates.

## Outstanding evidence

- Actual phone/route acceptance is outside this requested automation batch.
- Deployed Firestore/Storage policy compatibility and historical service-account key invalidation are not established by local emulator tests.
- Owner-controlled release signing and compatibility with existing installed certificates require the intended artifacts/evidence.

See [web tracker](FIX_TRACKER.md), [mobile tracker](../../sysu-go/docs/FIX_TRACKER.md) and [tracking evidence](live-location-optimization-plan.md).
