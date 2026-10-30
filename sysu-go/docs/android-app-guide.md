# SYSU Go Android application guide

SYSU Go is the Kotlin driver application for sign-in, QR admission, queue and trip workflows, background location reporting, proof of delivery (POD), and diagnostics. The Go API validates sessions and persists accepted records in the shared MySQL database. For full Windows, macOS, and Linux setup, see the [repository README](../README.md).

## Local build variants

| Variant | Purpose | API origin |
| --- | --- | --- |
| `debug` | Physical phone on the workstation's private network | Workstation IPv4 on port `3001`; override with `-PsysuDebugHost=<private IPv4>` |
| `emulator` | Android emulator | `10.0.2.2:3001` |
| `phoneLocal` | Explicit physical-phone target | Supply `-PsysuPhoneLocalHost=<private IPv4>` |
| `release` | Hosted service | Configured HTTPS Go API |

The standard debug host has a repository default; check `app/build.gradle.kts` because a workstation address can change. A physical phone must reach workstation port `3001` through the local firewall.

From the repository root, compile and test the emulator variant on Windows PowerShell:

```powershell
.\gradlew.bat :app:compileEmulatorKotlin :app:testEmulatorUnitTest
.\gradlew.bat :app:assembleEmulator
```

For a physical-phone debug APK, replace the example address with your workstation's current private IPv4:

```powershell
.\gradlew.bat :app:assembleDebug '-PsysuDebugHost=192.168.100.25'
```

On macOS and Linux, use `./gradlew` instead of `.\gradlew.bat`. The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Sign-in and QR admission

Drivers sign in with usernames and passwords. Protected operations require a valid session and driver role. CameraX captures camera frames and ZXing decodes QR data locally. The QR API verifies the token, and queue admission is committed by the backend transaction. Only a server-confirmed response establishes that registration succeeded.

## Trips, location, and POD

Trip and return-to-base actions are checked against the driver's assignment and current state. The Android tracking service sends location updates while tracking is active; the backend persists accepted GPS records and publishes authorized updates through Socket.IO to staff. POD records belong to the appropriate shipment and OBD. See the [backend API guide](backend-api-guide.md) for route groups.

Pending driver-action history remains on the phone until the server acknowledges it. After final session upload is acknowledged, Android removes that session's acknowledged local events and associated sequence state. An interrupted upload must not be displayed as a completed server action. See the [Driver Action audit](driver-action-audit.md).

## Diagnostics and offline error reports

The **System diagnostics** action in Profile checks network state, Go API reachability, MySQL readiness, Socket.IO connection, and local session-token presence. Its database probe uses the read-only `/api/health/ready` route and does not change trips or location settings.

Ordinary authenticated error reports can wait in an account-scoped local queue during an outage and retry through Android JobScheduler after connectivity returns. This queue is capped at 20 distinct error combinations. It does not store authentication tokens, request bodies, raw exception text, or GPS coordinates. Delivery can occur more than once if connectivity fails between server acceptance and local acknowledgement.

## Verification limits

Compilation and unit tests do not establish physical-device camera behavior, GPS accuracy, background reliability, battery impact, or company-server availability. Use the [integration checklist](INTEGRATION_CHECKLIST.md) for phone-to-web acceptance and the [release test plan](RELEASE_TEST_PLAN.md) for release gates.
