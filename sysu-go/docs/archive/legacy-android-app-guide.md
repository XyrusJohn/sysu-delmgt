> Historical copy of the former Android guide. Its architecture, endpoints, setup commands, and offline-storage claims are superseded; use `../android-app-guide.md` and verify source before relying on historical details.

# SYSU Go — Android Driver App

> This guide was moved from `app/README.md`. It has not been fully revalidated against the current app; use the source code and [`FIX_TRACKER.md`](../FIX_TRACKER.md) for current behavior and release status.

Kotlin Android application for truck drivers to authenticate, track trips, and stream live GPS data to the admin dashboard.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Technology Stack](#technology-stack)
- [Application Flow](#application-flow)
  - [Login Flow](#login-flow)
  - [Trip Tracking Flow](#trip-tracking-flow)
  - [Offline Sync Flow](#offline-sync-flow)
- [Key Components](#key-components)
  - [Activities](#activities)
  - [Services](#services)
  - [Network Layer](#network-layer)
  - [Data Layer](#data-layer)
- [API Integration](#api-integration)
  - [REST Endpoints](#rest-endpoints)
  - [Socket.IO Events](#socketio-events)
- [Permissions](#permissions)
- [Session Management](#session-management)
- [Background Tracking](#background-tracking)
- [Environment Setup](#environment-setup)
- [Build & Run](#build--run)
- [Android Manifest](#android-manifest)

---

## Overview

The SYSU Go Android app is a driver-facing mobile application that:

1. **Authenticates** drivers via JWT-based login
2. **Starts/stops** GPS tracking trips
3. **Streams location** in real-time via Socket.IO to the admin dashboard
4. **Persists data** locally with Room and EncryptedSharedPreferences
5. **Syncs offline** GPS logs when connectivity is restored

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYSU Go Android Architecture                  │
└─────────────────────────────────────────────────────────────────┘

                        ┌─────────────────────┐
                        │     Activities       │
                        │  ├─ SplashActivity   │  Entry point, session check
                        │  ├─ LoginActivity    │  Username + password auth
                        │  └─ MainActivity     │  Container for fragments
                        └──────────┬────────────┘
                                   │
                        ┌──────────▼────────────┐
                        │     Fragments          │
                        │  └─ DashboardFragment  │  Start/stop trip, status
                        └──────────┬────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                          │
┌────────▼────────┐    ┌───────────▼───────────┐    ┌─────────▼────────┐
│    Services     │    │      Network Layer    │    │    Data Layer     │
│                │    │                       │    │                   │
│ LocationService│    │  ├─ RetrofitClient    │    │  ├─ AppDatabase   │
│ (Foreground)   │    │  ├─ ApiService        │    │  ├─ GpsLogDao     │
│                │    │  ├─ AuthInterceptor   │    │  ├─ TripDao       │
└───────┬────────┘    │  └─ SocketManager     │    │  └─ SessionManager│
        │            └───────────┬───────────┘    └──────────────────┘
        │                        │
        │            ┌───────────▼───────────┐
        │            │    Socket.IO Client   │
        │            │                        │
        │            │  emit: update_status  │
        │            │  emit: driver_moving   │
        │            │  on:  vendor_status    │
        │            │  on:  update_admin_map │
        │            └───────────┬───────────┘
        │                        │
        └────────────────────────┘
                  │
                  ▼
        ┌─────────────────────┐
        │   Backend Server    │
        │   Express :3001      │
        └─────────────────────┘
```

---

## Project Structure

```
app/src/main/java/com/sysu/go/
│
├── activities/
│   ├── SplashActivity.kt     # Launch entry, session check
│   ├── LoginActivity.kt     # Driver login
│   └── MainActivity.kt      # Fragment container
│
├── fragments/
│   └── DashboardFragment.kt # Trip start/stop, status display
│
├── services/
│   └── LocationServices.kt  # Foreground service for GPS tracking
│
├── api/
│   ├── ApiService.kt        # Retrofit interface definitions
│   ├── RetrofitClient.kt    # Retrofit singleton with auth interceptor
│   └── *.kt                 # Request/response data classes
│
├── model/
│   ├── LoginRequest.kt
│   ├── LoginResponse.kt
│   ├── Trip.kt
│   ├── GpsLog.kt
│   └── GpsRequest.kt
│
├── utils/
│   ├── SessionManager.kt    # EncryptedSharedPreferences wrapper
│   ├── AuthInterceptor.kt   # OkHttp JWT header injection
│   ├── SocketManager.kt     # Socket.IO singleton
│   ├── ConnectivityObserver.kt
│   └── NetworkUtils.kt
│
├── database/
│   ├── AppDatabase.kt       # Room database
│   ├── DatabaseProvider.kt
│   ├── dao/
│   │   ├── GpsLogDao.kt
│   │   └── TripDao.kt
│   └── model/
│       ├── GpsLog.kt
│       └── Trip.kt
│
├── workers/
│   └── SyncWorker.kt        # WorkManager background sync
│
└── MainActivity.kt
```

### Resources

```
app/src/main/res/
├── layout/
│   ├── activity_login.xml
│   ├── activity_main.xml
│   └── fragment_dashboard.xml
│
├── values/
│   ├── colors.xml
│   ├── strings.xml
│   └── themes.xml
│
└── drawable/
    └── icons
```

---

## Technology Stack

| Category | Library | Version | Purpose |
|----------|---------|---------|---------|
| Networking | Retrofit | 2.9.0 | REST API client |
| Networking | OkHttp | (via Retrofit) | HTTP client with interceptors |
| JSON | Gson | (via Retrofit) | JSON serialization |
| Socket | Socket.IO Client | 2.1.0 | Real-time WebSocket |
| Database | Room | (AndroidX) | Local SQLite abstraction |
| Security | AndroidX Security Crypto | 1.1.0-α06 | Encrypted SharedPreferences |
| Location | Play Services Location | 21.x | FusedLocationProviderClient |
| Async | Kotlin Coroutines | (AndroidX) | Suspend functions, scopes |
| DI | Manual | — | Constructor injection via object singletons |

---

## Application Flow

### Login Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Login Flow                                  │
└─────────────────────────────────────────────────────────────────────┘

  SplashActivity
       │
       ▼
  hasActiveSession() ?
       │
   Yes ├──► MainActivity ──► DashboardFragment
       │
   No  │
       ▼
  LoginActivity
       │
       ▼
  User enters username + password
       │
       ▼
  RetrofitClient.getInstance(context).login(request)
       │
       ├─── Success (200) ──► Save token to SessionManager
       │                          saveAuthToken(token)
       │                          saveDriverId(driverId)
       │                          saveDriverName(fullName)
       │                          ──► MainActivity ──► DashboardFragment
       │
       └─── Failure (401) ──► Toast "Invalid credentials"
```

### Trip Tracking Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Trip Tracking Flow                             │
└─────────────────────────────────────────────────────────────────────┘

  DashboardFragment
       │
  btnStartTrip clicked
       │
       ▼
  checkLocationPermissions()
       │
       ├─── Granted ──► startTracking()
       └─── Denied   ──► requestPermissions() ──► onRequestPermissionsResult()
                                              │
                                              ▼
                                        checkLocationPermissions()
                                              │
                                        startTracking()

  startTracking()
       │
       ├─── POST /api/trips { trip_id: timestamp }
       │      with activeTripId = server response trip_id
       │
       ▼
  startForegroundService(Intent(LocationServices))
       │
       ▼
  LocationServices.onStartCommand()
       │
       ├─── SocketManager.getSocket().connect()
       ├─── createNotificationChannel()
       ├─── startForeground(NOTIFICATION_ID)
       └─── startLocationUpdates()  [5s interval, 5m min distance]
                 │
                 │  ┌───────────────────────────────────┐
                 │  │       handleLocation()             │
                 │  │                                    │
                 │  │  1. Throttle: only if 10s passed   │
                 │  │  2. Drift filter: only if moved    │
                 │  │     > 30 meters since last save    │
                 │  │                                    │
                 │  │  3. Socket.emit("driver_moving",  │
                 │  │     { driverId, lat, lng })        │
                 │  │     ──► Admin map updates         │
                 │  │                                    │
                 │  │  4. POST /api/gps                  │
                 │  │     { logs: [{ trip_id, lat,      │
                 │  │                lng, timestamp }] } │
                 │  │     ──► Store in MySQL/Railway     │
                 │  └───────────────────────────────────┘
                 │
                 ▼
  DashboardFragment.btnStopTrip clicked
                 │
                 ▼
  PUT /api/trips/{tripId}/stop
                 │
  stopService(Intent(LocationServices))
                 │
  removeLocationUpdates()
```

### Offline Sync Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Offline Sync Flow                               │
└─────────────────────────────────────────────────────────────────────┘

  GPS location acquired while offline
       │
       ▼
  Room Database (offline first)
       │
       ▼
  GpsLog inserted to local DB via GpsLogDao
       │
       ▼
  ConnectivityObserver detects network available
       │
       ▼
  SyncWorker.enqueue()
       │
       ▼
  WorkManager后台 job runs
       │
       ├─── Fetch pending from GpsLogDao
       ├─── POST /api/gps { logs: [...] }
       ├─── On success: delete synced rows
       └─── On failure: retry with exponential backoff
```

---

## Key Components

### Activities

#### `SplashActivity`
Entry point. Checks for an active session via `SessionManager.hasActiveSession()`:
- **Has session** → Navigate to `MainActivity`
- **No session** → Navigate to `LoginActivity`

#### `LoginActivity`
Handles driver authentication:
1. Capture `username` and `password` from EditText fields
2. Validate non-empty fields
3. Call `POST /api/auth/login` via Retrofit
4. On success: save `token`, `driverId`, `driverName` to `SessionManager`
5. Navigate to `MainActivity`

#### `MainActivity`
Simple container using `SupportFragmentManager` to host `DashboardFragment`.

---

### Fragments

#### `DashboardFragment`
Core driver interface:

- **Driver info display** — shows Driver ID and name from `SessionManager`
- **Network status observer** — uses `ConnectivityObserver` to monitor online/offline state
  - When online: emit `update_status { status: "online" }` via Socket.IO
  - When offline: emit `update_status { status: "offline" }` and disconnect socket
- **Trip management** — `btnStartTrip` / `btnStopTrip`
  - Checks for active trip via `GET /api/trips/active` on fragment load
  - Starts `LocationServices` as foreground service
  - Stops both service and trip via `PUT /api/trips/{id}/stop`
- **Location display** — shows real-time lat/lng from `FusedLocationProviderClient`
- **Logout** — calls `POST /api/auth/logout`, clears session, redirects to `LoginActivity`

---

### Services

#### `LocationServices`
Foreground service for continuous GPS tracking:

```
Lifecycle: Started via Context.startForegroundService()
           Runs even when app is minimized or screen is off
           Stopped via Context.stopService()

Location updates:
  - Provider: FusedLocationProviderClient (Google Play Services)
  - Interval: 5000ms
  - Min distance: 5m
  - Priority: PRIORITY_HIGH_ACCURACY

On each location:
  1. Throttle: emit only if 10s since last emit
  2. Drift filter: emit only if moved > 30m from last saved location
  3. Socket.IO: emit "driver_moving" event for admin map
  4. REST API: POST /api/gps batch to Railway MySQL
```

**Notification:** Shows "Go Tracking Active" with ongoing indicator. Required for Android 13+ to keep service alive.

---

### Network Layer

#### `RetrofitClient`
Singleton that provides `ApiService` instance with:
- Base URL: `http://192.168.137.177:3001/` (update for your network)
- OkHttpClient with `AuthInterceptor`
- Gson converter factory

#### `ApiService`
Retrofit interface with all API calls:

```kotlin
@POST("api/auth/login")
suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

@POST("api/auth/logout")
suspend fun logout(): Response<ResponseBody>

@POST("api/trips")
suspend fun createTrip(@Body request: TripCreateRequest): Response<TripCreateResponse>

@PUT("api/trips/{tripId}/stop")
suspend fun stopTrip(@Path("tripId") tripId: Int): Response<TripStopResponse>

@GET("api/trips/active")
suspend fun getActiveTrip(): Response<TripActiveResponse>

@POST("api/gps")
suspend fun sendGpsBatch(@Body request: GpsBatchRequest): Response<GpsBatchResponse>
```

#### `AuthInterceptor`
OkHttp interceptor that:
1. Reads JWT from `SessionManager.getAuthToken()`
2. Injects `Authorization: Bearer <token>` header on every request
3. On 401 response: clears session and redirects to `LoginActivity`

#### `SocketManager`
Singleton Socket.IO client:
```kotlin
mSocket = IO.socket(Constants.SOCKET_URL, opts)
mSocket?.connect()
mSocket?.emit("update_status", data)
mSocket?.emit("driver_moving", data)
```

---

### Data Layer

#### `SessionManager`
Wrapper around `EncryptedSharedPreferences` (AndroidX Security Crypto AES-256-GCM):

| Key | Type | Description |
|-----|------|-------------|
| `auth_token` | String | JWT from login |
| `user_id` | Int | Driver ID |
| `driver_name` | String | Full name |
| `is_logged_in` | Boolean | Session active flag |

#### `AppDatabase` (Room)
SQLite abstraction with two entities:

**GpsLog** — cached GPS points awaiting sync:
```kotlin
@PrimaryKey(autoGenerate = true)
val id: Long = 0
val trip_id: Int
val lat: Double
val lng: Double
val timestamp: Long
val accuracy: Double?
val synced: Boolean = false
```

**Trip** — local trip records:
```kotlin
@PrimaryKey
val trip_id: Int
val started_at: Long
val ended_at: Long?
val synced: Boolean = false
```

---

## API Integration

### REST Endpoints

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| `POST` | `/api/auth/login` | Driver login | No |
| `POST` | `/api/auth/logout` | Invalidate token | JWT Bearer |
| `POST` | `/api/trips` | Start a new trip | JWT Bearer |
| `PUT` | `/api/trips/{id}/stop` | End active trip | JWT Bearer |
| `GET` | `/api/trips/active` | Get ongoing trip | JWT Bearer |
| `POST` | `/api/gps` | Batch upload GPS logs | JWT Bearer |

### Socket.IO Events

**Client → Server:**

| Event | Payload | When |
|-------|---------|------|
| `update_status` | `{ driverId, name, status }` | Network state change |
| `driver_moving` | `{ driverId, lat, lng }` | Every GPS location (throttled) |
| `disconnect` | — | Socket disconnection |

**Server → Client:**

| Event | Payload | Purpose |
|-------|---------|---------|
| `vendor_status_update` | `{ driverId, name, status }` | Other driver online/offline |
| `update_admin_map` | `{ driverId, lat, lng, name }` | Live location for admin map |

---

## Permissions

Required Android permissions (declared in `AndroidManifest.xml`):

| Permission | Purpose |
|------------|---------|
| `INTERNET` | API calls and Socket.IO |
| `ACCESS_NETWORK_STATE` | Check connectivity before uploading |
| `ACCESS_FINE_LOCATION` | GPS accuracy (street-level) |
| `ACCESS_COARSE_LOCATION` | Fallback (city-level) |
| `ACCESS_BACKGROUND_LOCATION` | Track when app is minimized/off |
| `FOREGROUND_SERVICE` | Run background service |
| `FOREGROUND_SERVICE_LOCATION` | Mark foreground service as location-type |
| `POST_NOTIFICATIONS` | Android 13+ notification requirement |

---

## Session Management

Tokens and driver data are stored in **EncryptedSharedPreferences** using AES-256-GCM:

```kotlin
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()

val secureStorage = EncryptedSharedPreferences.create(
    context,
    PREFS_NAME,
    masterKey,
    PrefKeyEncryptionScheme.AES256_SIV,
    PrefValueEncryptionScheme.AES256_GCM
)
```

On successful login:
```kotlin
sessionManager.saveAuthToken(token)   // Stored encrypted
sessionManager.saveDriverId(driverId)
sessionManager.saveDriverName(fullName)
```

On token expiry (401 response via `AuthInterceptor`):
```kotlin
sessionManager.clearSession()  // Wipes encrypted storage
context.startActivity(Intent(context, LoginActivity::class.java))
```

---

## Background Tracking

The `LocationServices` foreground service ensures GPS tracking continues even when:

- The app is minimized
- The screen is turned off
- The device is in the driver's pocket

**Key behaviors:**

1. **Throttling** — Locations are emitted at most every 10 seconds (`lastEmitTime`)
2. **Drift filtering** — Ignores locations within 30 meters of the last saved point
3. **Foreground notification** — Persistent notification with "Go Tracking Active" keeps the service alive
4. **Battery optimization** — Uses `FusedLocationProviderClient` (not the older LocationManager) for optimal GPS batching
5. **Trip binding** — Trip ID passed via `Intent.EXTRA_TRIP_ID` to associate GPS logs

**Starting the service:**
```kotlin
val intent = Intent(context, LocationServices::class.java).apply {
    putExtra(LocationServices.EXTRA_TRIP_ID, tripId)
}
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    context.startForegroundService(intent)
} else {
    context.startService(intent)
}
```

---

## Environment Setup

### 1. Update Backend URL

In `app/src/main/java/com/sysu/go/api/RetrofitClient.kt`:

```kotlin
object Constants {
    // Change this to your backend server IP/URL
    const val BASE_URL = "http://192.168.137.177:3001/"
    const val SOCKET_URL = "http://192.168.137.177:3001"
}
```

For real deployment, use your public IP or domain:
```kotlin
const val BASE_URL = "https://api.your-domain.com/"
const val SOCKET_URL = "https://api.your-domain.com"
```

> **Note:** Also update `android:usesCleartextTraffic="true"` in `AndroidManifest.xml` if using HTTP, or configure a网络安全配置 for production.

### 2. Enable Developer Options

On the Android device:
- Go to **Settings → About Phone → Build Number** → tap 7 times
- Enable **USB Debugging** in **Developer Options**
- Connect via USB or use Wi-Fi ADB for wireless debugging

### 3. Grant Permissions

The app requests permissions at runtime. Required:
- Location (Fine + Background)
- Notifications (Android 13+)

---

## Build & Run

### Via Android Studio

1. Open the `app/` directory as an Android Studio project
2. Sync Gradle (`File → Sync Project with Gradle Files`)
3. Select a device or emulator (API 24+)
4. Click **Run** (Shift + F10)

### Via Command Line

```bash
cd app
./gradlew assembleDebug    # Build APK
./gradlew installDebug     # Install to connected device
```

### Build Output

Debug APK located at:
```
app/build/outputs/apk/debug/app-debug.apk
```

---

## Android Manifest

```xml
<manifest ...>
    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>

    <application
        android:allowBackup="true"
        android:usesCleartextTraffic="true"
        ...>

        <!-- Activities -->
        <activity android:name=".activities.SplashActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
        <activity android:name=".activities.LoginActivity"/>
        <activity android:name=".activities.MainActivity"/>

        <!-- Foreground Service for GPS tracking -->
        <service
            android:name=".services.LocationServices"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="location"/>
    </application>
</manifest>
```

---

## Troubleshooting

### Socket.IO not connecting
- Verify `SOCKET_URL` in `RetrofitClient.Constants` matches backend IP
- Ensure the backend server is reachable from the device's network
- Check if mobile data is disabled and only Wi-Fi is available (Android blocks some traffic)

### Location not updating
- Check if **Location permission** is set to "Allow all the time" (not "Allow only while using")
- On Android 10+, background location requires separate permission
- Verify GPS is enabled on the device

### 401 on API calls
- Token likely expired — `AuthInterceptor` handles this by clearing session and redirecting to login
- Check if `SessionManager` is correctly saving the token on login

### App crashes on launch
- Check `AndroidManifest.xml` for typos in activity/service names
- Verify all dependencies are resolved via Gradle sync

---

## License

ISC
