# SYSU Go

**Android driver app and API for SYSU fleet operations.** SYSU Go supports driver authentication, queue admission, trip workflows, proof of delivery, and live location updates. The SYSU App web dashboard and shared MySQL schema are maintained in the sibling `sysu-app` project.

## Features

- Username and password registration and sign-in through the MySQL-backed API.
- QR-based queue admission and driver trip workflows.
- Proof-of-delivery capture and progress updates.
- Live driver location and authorized realtime updates over Socket.IO.
- QR scanning with CameraX and local ZXing decoding.

## Technology

- Android client: Kotlin, Android SDK, CameraX, ZXing, Google Play location services, and Socket.IO client.
- API: Node.js, Express, MySQL, and Socket.IO.
- Android build: Gradle Kotlin DSL.

## Prerequisites

- Node.js 24.x and npm.
- MySQL 8 with the shared `sysu_fleet_app` schema initialized by `sysu-app`.
- Android Studio and a JDK compatible with the checked-in Gradle wrapper.
- For physical-device local testing, a workstation and phone on the same Wi-Fi network.

## Install and configure the backend

The local MySQL setup is shared with SYSU App. Keep the `sysu-app` and `sysu-go` repositories side by side, install the App backend dependencies, and configure its local environment before starting SYSU Go. MySQL must be running on the same workstation; the Go API currently accepts only loopback database hosts.

### Windows (PowerShell)

From the folder containing both repositories, prepare the App backend. Copy the example only if `.env` does not already exist, then add your local MySQL administrator settings:

```powershell
Set-Location .\sysu-app\backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm ci
```

Install and start the Go API. Its `predev` hook runs the shared local MySQL setup and prepares the ignored Go backend environment file with a limited database account:

```powershell
Set-Location ..\..\sysu-go\backend
npm ci
Set-Location ..
npm run dev
```

### macOS or Linux

From the folder containing both repositories, prepare the App backend and its local environment:

```sh
cd sysu-app/backend
[ -f .env ] || cp .env.example .env
${EDITOR:-vi} .env
npm ci
```

Then install and start SYSU Go:

```sh
cd ../../sysu-go/backend
npm ci
cd ..
npm run dev
```

For a standalone Node or LAMP-hosted deployment, provide the variables from `backend/.env.example` through an ignored `backend/.env` file or the host's environment/secret store. The example lists supported variable names and safe placeholders. Never commit runtime credentials.

## Run the local system

The Go API uses port `3001` by default. Run the App backend and frontend as well when a workflow depends on their services. In PowerShell, open separate terminals from the folder containing both repositories:

```powershell
Set-Location .\sysu-app\backend
npm run dev
```

```powershell
Set-Location .\sysu-app\frontend
npm run dev
```

Start the Go API in another terminal with `Set-Location .\sysu-go` followed by `npm run dev`. The same npm commands work from these directories on macOS and Linux; use the path navigation below if you prefer shell commands:

```sh
# sysu-app/backend/
npm run dev

# sysu-app/frontend/
npm run dev
```

Start the Go API separately from the `sysu-go` root with `npm run dev` as shown above.

## Build the Android app

The standard `debug` variant, used by Android Studio's **Run app** action, targets the local Go API on port `3001` using the workstation's private Wi-Fi IPv4 address. Its default is `192.168.100.4`. From the `sysu-go` repository root in Windows PowerShell, build the APK with:

```powershell
.\gradlew.bat :app:assembleDebug '-PsysuDebugHost=192.168.100.25'
```

Replace the example address with the workstation's actual private IPv4 address. The phone must be on the same Wi-Fi, and Windows Firewall must allow inbound connections on port `3001`. The default debug build output is `app/build/outputs/apk/debug/app-debug.apk`. The same Gradle task works on macOS and Linux through `./gradlew` with the same `-PsysuDebugHost` option.

The `emulator` build variant uses `10.0.2.2:3001` to reach the workstation's local API from an Android emulator. Build it from PowerShell with:

```powershell
.\gradlew.bat :app:assembleEmulator
```

On macOS or Linux, use `./gradlew :app:assembleEmulator` instead.

The optional `phoneLocal` variant is available when a private address is supplied with `-PsysuPhoneLocalHost=<private IPv4>`. The `release` variant targets the hosted Go service over HTTPS. Local builds and tests do not establish production readiness or physical-device behavior.

## Checks

Backend unit tests:

```sh
cd backend
npm test
```

Android emulator Kotlin compilation and unit tests on Windows PowerShell:

```powershell
.\gradlew.bat :app:compileEmulatorKotlin :app:testEmulatorUnitTest
```

On macOS or Linux, use `./gradlew :app:compileEmulatorKotlin :app:testEmulatorUnitTest`.

## Project structure

```text
sysu-go/
├── app/       Kotlin Android application
├── backend/   Express, MySQL, and Socket.IO API
├── docs/      Setup, API, migration, and project status guides
└── gradle/    Shared Gradle configuration and wrapper files
```

## Troubleshooting

- **The API cannot reach MySQL:** Confirm MySQL is running and the ignored backend environment file has the correct loopback host, port, database, and runtime credentials.
- **A physical phone cannot reach the local API:** Confirm both devices are on the same Wi-Fi, the API is listening on port `3001`, the firewall permits the connection, and the debug host address matches the workstation's current private IPv4 address.
- **An emulator cannot reach the API:** Use the `emulator` variant and verify the Go API is running on the workstation at port `3001`.
- **Registration or sign-in fails:** Check that the shared MySQL schema and required migrations are available. The backend owns authentication and role checks.

## Further documentation

- [Android app guide](docs/android-app-guide.md)
- [Backend API and Socket.IO guide](docs/backend-api-guide.md)
- [MySQL migration status](docs/mysql-migration-status.md)
- [Documentation index](docs/README.md)
