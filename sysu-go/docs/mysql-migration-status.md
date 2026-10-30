# Local MySQL migration status

**Reviewed:** 2026-10-27

SYSU Go's backend now uses the shared MySQL database for authentication, driver profiles, queue admission/position, trip registration and progress, POD, warehouse settings, and driver action history. MySQL is the source for protected HTTP and Socket.IO authentication and data access. Realtime GPS tracking and other approved updates use Socket.IO.

SYSU Go registration and login use usernames and passwords. The local backend loads one `backend/.env`, requires `AUTH_BACKEND=mysql`, and restricts DB hostnames to loopback. The Android `emulator` variant connects to the workstation through `10.0.2.2:3001`; the Vite frontend uses the local App backend and Socket.IO URLs from `sysu-app/frontend/.env`.

The shared local auth schema now enforces username-only identities and no longer contains a Firebase UID column. The guarded forward migration aborts when it finds a non-username identity or a populated Firebase UID, so existing accounts are not silently discarded.

The shared schema belongs to `sysu-app/backend/src/migrations/mysql`; Go's `npm run dev` runs the App's local MySQL setup hook before starting the API. Confirm MySQL is running and both backends use the same database name and host. Each app retains its own limited MySQL runtime account.

Historical Firestore records were not imported, as requested. Existing accounts/data that exist only in Firestore will not appear in MySQL. The local migration supports fresh MySQL registration and new operational records.

## Verification recorded for this cutover

- SYSU Go backend suite passed 168 tests after removing the dormant Firestore Socket.IO fallback and aligning username registration validation.
- SYSU App frontend suite passed 223 tests; App backend suite passed 187 tests after removing Firestore diagnostics fallback code.
- Android emulator Kotlin compile, emulator unit tests, and AndroidTest Kotlin compile passed after Firebase Auth/Firestore client wiring removal.
- Google Services JSON, Firebase Auth/Firestore dependencies, and ML Kit's transitive Firebase utility artifacts were removed. CameraX with local ZXing decoding preserves the QR scan path; all six decoder/parser tests passed. Gradle dependency checks found no Firebase artifacts in emulator, debug, release, or liveTest runtime classpaths.
- Local App live/readiness, browser-origin CORS, Vite-proxy login/logout, App/Go MySQL sessions, and Socket.IO handshakes passed. `npm run dev` on Go port 3001 passed health and login/logout checks; that test server was stopped after verification.
- Emulator unit task and local APK build passed. The API 37 AVD installed the APK, but Android killed the UI process under low-memory pressure; device UI/camera behavior remains unverified. Production behavior and historical Firestore data import were not tested/performed.

