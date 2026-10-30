# Google sign-in recovery — 2026-10-09

User reported Android Studio Run/Build error `Google sign-in failed: 10`. Google identifies status 10 as [application misconfiguration](https://developers.google.com/android/reference/com/google/android/gms/common/api/CommonStatusCodes). Android Google sign-in registration requires the exact [package and signing SHA-1](https://developer.android.com/identity/legacy/gsi); Firebase documents [registering the fingerprint and refreshing google-services.json](https://firebase.google.com/docs/auth/android/google-signin).

Verified causes: default debug APK/resources targeted demo-sysu-security/com.sysu.go.debug. The prepared liveTest APK used com.sysu.go but its signing SHA-1 9A:FD:44:EE:CE:42:77:5C:53:0B:CC:61:70:4B:BE:6B:87:60:58:36 was absent from the production Android OAuth clients. The existing web OAuth audience was correct; Railway health could not prove this login configuration.

Applied: existing production Android app 1:713214426806:android:3e10b702bf9330074d7017 gained the workstation SHA-1 and SHA-256 647a763ae3b5476b4e9aad715b6220852981ad19528ba5c59ceef12eb2dff530. Previous registrations remain. Refreshed Firebase SDK configuration confirms a matching com.sysu.go Android OAuth client. The ignored app/google-services.json was refreshed from that configuration. Default Android Studio debug and liveTest use this production project/package and Railway URLs; USE_FIREBASE_EMULATORS=false. Isolated testing is an explicit emulator variant with demo resources, separate package and USE_FIREBASE_EMULATORS=true. Account approval, endpoint validation and authentication checks were retained.

ECC TDD and independent changed-only security/regression review applied. Kotlin RED d25ad54: 8 tests executed, 2 failed on wrong compiled services and missing explicit routing switch. Root APK verification RED 0dbedfb: default-debug 3 failures/1 pass; prepared-liveTest 2 failures/2 passes against the captured pre-repair SDK configuration. An initial APK resource-dump buffer failure was test setup, not RED; it was corrected before the recorded valid RED checkpoint. GREEN mobile source commit 861391f.

| Verification | Result |
| --- | --- |
| testDebugUnitTest | 43/43, zero failures |
| testLiveTestUnitTest | 43/43, zero failures |
| testEmulatorUnitTest | 43/43, zero failures; variant reruns are not new distinct cases |
| assembleDebug / assembleLiveTest | BUILD SUCCESSFUL; actual signed APKs rebuilt |
| lintDebug / lintLiveTest | PASS; existing warnings remain |
| tests/release/googleLoginConfig.test.cjs in sibling sysu-app | 4/4 per debug/liveTest APK; actual APK project/package/certificate/audience and current cloud SDK registration verified |
| environmentPolicyCoverage | 100% lines (4/4), branches (8/8), instructions (83/83); not whole-app coverage |
| Independent changed-only review | No new high/critical regression found |
| Actual Android device | adb devices lists none; installation and Google login remain unverified |

The APK verification uses aapt2 compiled resources and manifest, apksigner certificate verification, generated BuildConfig, and the refreshed cloud SDK configuration stored only in ignored local tooling. It does not print API keys or private signing material. Config checks do not execute a Google user-account login.

Retry: Android Studio Sync Project with Gradle Files, select debug, then Run. Rebuilt APKs are app/build/outputs/apk/debug/app-debug.apk and app/build/outputs/apk/liveTest/app-liveTest.apk. An older installed com.sysu.go APK with another certificate may reject an update; inspect installed signing identity before any uninstall/data-erasing action. Owner-controlled production signing remains G-18. Google account selection, Firebase authentication and active-driver profile acceptance on the actual phone are the remaining G-25 acceptance condition.
