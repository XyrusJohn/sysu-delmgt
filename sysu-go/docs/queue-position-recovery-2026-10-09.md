# Dynamic queue position recovery

Date: 2026-10-09. Finding: G-28. The user reported web #001 versus Android No. 3 and requested testing/fixing live position updates.

## Cause and small fix

Home and Queue Details counted unregistered waiting/called entries. The registered web projection excluded them. A production read-only checkpoint had two unregistered AUV entries and one registered AUV entry, explaining the mismatch. Queue Details fetched peer positions once, so another driver's assignment did not reliably update its open screen. Both screens also invented a fallback number for a removed/missing current entry.

`QueuePositionPolicy.kt` now supplies the shared mobile calculation: registered=true, not assigned, waiting/called, same supported truck group, with entryTime then document-ID ordering. Full timestamp nanoseconds are retained. Ineligible/absent entries have no numeric position. MainActivity uses the existing snapshot listener with this policy. QueueDetails replaces its single fetch with a managed position listener, removes listeners on destruction and guards callbacks against queue/status changes and shipment display. Waiting admissions no longer load historical UID assignments over the position display.

Affected implementation: `app/src/main/java/com/sysu/go/model/QueuePositionPolicy.kt`, `MainActivity.kt`, `QueueDetailsActivity.kt`. Regression coverage: `QueuePositionPolicyTest.kt` and web `backend/tests/unit/queueCards.test.js`. Existing unrelated uncommitted changes were preserved. No production records, server code, schema, indexes, credentials or dependencies were changed for G-28.

## Executed checks

The initial policy recreated the legacy selection/fallback behavior: **3/8 passed, 5 failed**. Failures covered unregistered entries, assigned flags, mismatched groups, missing timestamps and invented positions. Local RED report: `../sysu-app/.tools/queue-position-red.xml`.

Final command, using Android Studio's JDK:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio1\jbr'
.\gradlew.bat :app:testDebugUnitTest :app:testReleaseUnitTest :app:assembleLiveTest :app:lintLiveTest --offline --console=plain
```

Result: **BUILD SUCCESSFUL**; debug **69/69**, release **69/69**, total **138/138 executions**, zero failed/errors/skipped. All eight new position cases passed in both variants, including No. 3 → No. 2 → No. 1 across successive assignments and No. 2 → No. 1 after the first assignment. APK build and lint passed; lint reports zero errors and 1,177 warnings across the app. APK signature verification passed.

Web backend **149/149 passed**, including the equivalent registered AUV three-driver renumbering scenario across successive assignment/poll states. Mobile backend **119/119 passed** with the required Node 24 binary. An initial run accidentally used the system Node 20 and ended with 118 passed / one cancelled; the declared Node 24 rerun passed with zero cancelled/skipped. No backend deployment is required for this mobile position fix. Latest web browser evidence remains the previous 14/14 run; no Android UI result is inferred from it.

## Production-configured APK and remaining acceptance

Artifact: `app/build/outputs/apk/liveTest/app-liveTest.apk`, package `com.sysu.go`, API `https://sysu-go.onrender.com`, Firebase emulators disabled, workstation debug signing. SHA-256: `0880c1e355a5c7a7a4ddf16ce7cc04c2a6beac44f9846768bb2366bf81efb9ba`.

This APK replaces the previous G-27 build at the same output path. Installing/updating the phone app is necessary; refreshing the website cannot replace phone code. No connected authorized Android device or configured AVD was available, so this run did not install the APK or execute actual-device UI assertions. G-28 remains IN PROGRESS until that acceptance passes.

- [x] Exclude unregistered/assigned entries; keep truck groups and deterministic order.
- [x] Test dynamic 3 → 2 → 1 progression and removal in both mobile variants and web projection.
- [x] Integrate snapshot updates in Home and Queue Details; guard shipment status and listener cleanup.
- [x] Build/lint/signature/configuration checks for the production-configured APK.
- [ ] Install this APK and compare the actual phone with the hosted registered kiosk.
- [ ] Keep Queue Details open during another driver's assignment; verify both phone screens automatically move No. 3 → No. 2 → No. 1 without reopening the screen. The web updates on its existing polling cycle, not instantaneously with phone snapshots.
- [ ] Verify registration, cancellation/removal, assignment and screen reopening preserve correct state.

Status: [mobile tracker](FIX_TRACKER.md). Shared plan: [production recovery plan](../../production-recovery-plan.md).
