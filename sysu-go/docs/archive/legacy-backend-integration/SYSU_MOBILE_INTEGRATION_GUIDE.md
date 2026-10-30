> Contract correction, 2026-10-09: the duplicate mobile SAP proxy is retired; authorized staff receive 410 with no upstream data. Use sysu-app's guarded SAP service; Android has no shipped caller of the mobile proxy. Public Firestore diagnostics are disabled. Socket.IO requires verified Firebase identity/active profile and private tracking recipients. Historical endpoint/global-broadcast descriptions below do not supersede [the current tracker](../../FIX_TRACKER.md).

> Release correction (2026-10-08): POST /api/dispatch/status is retired in local source. Authenticated calls return 410; anonymous calls return 401. It no longer writes assignments/queues or emits dispatch_status_update. Earlier descriptions below are historical and superseded. No shipped Android HTTP caller was found; external clients need migration. Full owned progress/POD acceptance remains G-16. See [current release tracker](../../FIX_TRACKER.md) and [executed evidence](../../RELEASE_FIXES_TDD.md). This change is not yet deployed.

# SYSU Mobile App Integration Guide
> **For sysu-go Mobile App (Android/Kotlin) + Backend Team**
> Last Updated: 2026-05-26
> This is the master integration document. Paste this into your development handoff for seamless mobile ↔ web ↔ backend integration.

---

## TABLE OF CONTENTS

1. [Architecture Overview](#1-architecture-overview)
2. [New Driver Registration Flow (First Time)](#2-new-driver-registration-flow-first-time)
3. [Queue + Trip Registration Flow (QR Scan)](#3-queue--trip-registration-flow-qr-scan)
4. [API Base URLs & Environment](#4-api-base-urls--environment)
5. [Authentication](#5-authentication)
6. [REST API Endpoints](#6-rest-api-endpoints)
7. [Firestore Collections](#7-firestore-collections)
8. [Socket.IO Events](#8-socketio-events)
9. [Queue → Assignment Flow (Step-by-Step)](#9-queue--assignment-flow-step-by-step)
10. [Outstanding Backend Items](#10-outstanding-backend-items)
11. [Security Rules Summary](#11-security-rules-summary)
12. [Firestore Composite Indexes](#12-firestore-composite-indexes)
13. [Field Name Reference](#13-field-name-reference)
14. [Mobile App Checklist](#14-mobile-app-checklist)
15. [Firestore Cleanup Schedulers](#15-firestore-cleanup-schedulers)

---

## 1. Architecture Overview

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│   Mobile App    │────────▶│   sysu-go Backend    │────────▶│  SAP OData API  │
│   (Android/K)   │  HTTPS  │   (Express/Node.js)  │  Proxy  │   (on-premise)  │
└────────┬────────┘         └──────────┬───────────┘         └─────────────────┘
         │                             │
         │  Firestore real-time        │  Socket.IO
         │  (queue, sap_assignments,   │  (driver_moving,
         └────────────────────────────▶│  update_admin_map)
                                      └────────────────────────────▶┌─────────────────┐
                                                                       │  Web Dashboard  │
                                                                       │  (this repo)    │
                                                                       └─────────────────┘
```

### Two-Phase Driver Enrollment

**Phase 1 — Queue Entry (QR Scan):**
- Driver opens app → scans QR → joins queue with basic info
- Driver appears in **QR Generator** (TV display) immediately
- Driver NOT yet visible in **Fleet Manager** (trip registration incomplete)

**Phase 2 — Trip Registration:**
- Driver taps queue entry on scan-result.html (or separate trip registration screen)
- Fills: Helper FN/MI/LN, Company, Truck Type, Plate Prefix + Suffix
- On submit: driver is marked `registrationComplete: true`
- Driver now appears in **Fleet Manager** and can be assigned to dispatch

---

## 2. New Driver Registration Flow (First Time)

```
Driver opens app
       ↓
Google Sign-In via Firebase Auth
       ↓
[Web Dashboard] Registration Modal:
  - First Name (FN)
  - Middle Initial (MI) — 1 character max
  - Last Name (LN)
  - Phone Number
       ↓
Firebase Phone Auth OTP (if on Spark plan, SMS costs apply)
       ↓
Firestore: users/{uid} created with:
  - displayName: "FN MI. LN"
  - phone: "09XX..."
  - role: "driver"
  - driverData: { fn, mi, ln, registrationComplete: false }
       ↓
Dashboard: [Scan QR to Queue] button visible
```

**Registration modal fields (split name for proper display):**

| Field | Type | Max Len | Notes |
|-------|------|---------|-------|
| First Name | text | 50 | Required |
| Middle Initial | text | 1 | Required, single char |
| Last Name | text | 50 | Required |
| Phone | tel | 20 | Required, Philippine format |

---

## 3. Queue → Trip Registration Flow (QR Scan)

```
TV displays QR                  Driver opens app         Driver taps scan button
(qr-generator.html)       →     + logs in           →    → parses token from QR URL
                                                              ↓
                                              POST /api/qr/scan
                                        Body: token, driverId, driverName,
                                              truckType (optional initial)
                                              + driverFN, driverMI, driverLN
                                                              ↓
                                         Backend: queue.add({
                                                   driverId, token,
                                                   driverName: "FN MI. LN",
                                                   driverFN, driverMI, driverLN,
                                                   registrationComplete: false,
                                                   status: "waiting", ...
                                                 })
                                                              ↓
                                       scan-result.html (or app) shows:
                                         ✅ "QR Verified — You're in the queue!"
                                         📋 But first... Complete your trip info below
                                         (Trip Registration Form appears)
                                                              ↓
                                    Driver fills Trip Registration Form:
                                         Helper FN: [__________]
                                         Helper MI: [__]
                                         Helper LN: [__________]
                                         Company:  [__________________]
                                         Truck Type: [▼ Select AUV/4W/6W/10W/20F/40F]
                                         Plate: [ABC] - [1234]
                                                              ↓
                                              POST /api/trip/register
                                              Body: queueId, helperFN, helperMI,
                                                    helperLN, company, truckType,
                                                    platePrefix, plateSuffix
                                                              ↓
                                         Backend: queue/{queueId} updated with:
                                           helperFN, helperMI, helperLN
                                           company, truckType
                                           platePrefix, plateSuffix
                                           registrationComplete: true
                                           helper: "helperFN MI. helperLN"
                                           plateNumber: "ABC-1234"
                                           driverName: "FN MI. LN"
                                                              ↓
                                         Socket.IO: "qr_token_used" emitted
                                                    → ALL QR Generators refresh
                                                    → QR code reset immediately
                                                    (old token invalidated)
                                                              ↓
                                       scan-result.html / app shows:
                                         ✅ "Trip registered! Proceed to loading zone."
                                         (QR can no longer be reused)
                                                              ↓
                            Driver now visible in Fleet Manager
                            (isAssigned: false, registrationComplete: true)
```

---

## 4. API Base URLs & Environment

| Environment | URL |
|---|---|
| **Production REST** | `https://sysu-app.onrender.com` |
| **Production Socket.IO** | `https://sysu-go.onrender.com` |
| **Local REST** | `http://localhost:8080` |
| **Local Socket.IO** | `http://localhost:8080` |

### Environment Variables (Android / Retrofit)

```kotlin
// YourApiClient.kt
companion object {
    private const val BASE_URL = "https://sysu-app.onrender.com/"
    private const val SOCKET_URL = "https://sysu-go.onrender.com"
}
```

---

## 5. Authentication

### Mobile App

Firebase Authentication handles all mobile auth:

```kotlin
// After Firebase Google Sign-In
val user = FirebaseAuth.getInstance().currentUser
user?.getIdToken(true)?.addOnSuccessListener { result ->
    val idToken = result.token
    // Use idToken as Bearer token for REST API calls
}
```

### API Authentication Header

All authenticated REST calls must include:

```
Authorization: Bearer <Firebase ID Token>
```

```kotlin
// Retrofit interceptor
class AuthInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.result?.token
        val request = chain.request().newBuilder()
            .addHeader("Authorization", "Bearer $token")
            .build()
        return chain.proceed(request)
    }
}
```

### Auth Flow Summary

| Step | Action | Result |
|------|--------|--------|
| 1 | Driver signs in with Google via Firebase Auth | `FirebaseUser` obtained |
| 2 | Get Firebase ID Token via `user.getIdToken()` | Fresh JWT token |
| 3 | Attach token as `Authorization: Bearer <token>` | Backend validates via `admin.auth().verifyIdToken()` |
| 4 | Token valid | Request proceeds |
| 5 | Token expired/invalid | `401 Not authorized` response |

### Role System

Roles are stored in Firestore `users/{uid}.role`. Backend API validates.

**Valid roles:**
```
super_admin   — Full access
admin         — Manage users + all operations
fleet_manager — View queue, assign drivers, view SAP
qr_generator  — Generate QR tokens only
driver        — Mobile app user
pending       — Unregistered/unapproved
```

---

## 6. REST API Endpoints

### 6.1 QR Token Operations

#### `GET /api/qr/generate`
Generate a new QR token (for TV display). No auth required.

**Request:**
```
GET /api/qr/generate
```

**Response (200):**
```json
{
  "success": true,
  "token": "SYS-A1B2C3D4E5F6",
  "expiresAt": "2026-05-28T10:00:00.000Z"
}
```

**Response if error (500):**
```json
{
  "success": false,
  "message": "Failed to generate token"
}
```

---

#### `GET /api/qr/verify?token=XXX`
Driver scans QR → **checks validity of token only** (read-only operation). Does NOT:
- Mark the token as used
- Emit `qr_token_used` socket event
- Create any queue entry

**⚠️ QR reset happens via `POST /api/qr/scan` ONLY**, which marks the token used and emits the event.

**Request:**
```
GET /api/qr/verify?token=SYS-A1B2C3D4E5F6
```

**Response (200) — token valid and unused:**
```json
{
  "success": true,
  "message": "Token verified",
  "token": "SYS-A1B2C3D4E5F6"
}
```

**Response (410) — token already used:**
```json
{
  "success": false,
  "message": "Token already used"
}
```

**Response (404) — token invalid:**
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

---

#### `POST /api/qr/scan`
Driver joins the queue after QR verification. **Requires Firebase ID Token in Authorization header.**

**Request:**
```
POST /api/qr/scan
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>

{
  "token": "SYS-A1B2C3D4E5F6",
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "driverFN": "Juan",
  "driverMI": "M",
  "driverLN": "Cruz",
  "truckType": "10W",
  "plateNumber": "ABC 1234",
  "truckCompany": "ABC Logistics",
  "helperName": "Maria Santos"
}
```

**Field limits:**
- `driverId`: max 100 chars
- `driverName`: max 100 chars
- `driverFN`: max 50 chars
- `driverMI`: max 1 char
- `driverLN`: max 50 chars
- `truckType`: max 50 chars
- `plateNumber`: max 20 chars
- `truckCompany`: max 100 chars
- `helperName`: max 100 chars
- HTML characters `< > & " ' ; \ /` are stripped from all string fields
- Whitespace is collapsed (multiple spaces → single space)

**Enhanced Sanitization (backend):**
The backend now applies stronger sanitization:
- Strips: `< > & " ' ; \ /` characters
- Collapses whitespace
- Trims leading/trailing spaces
- Truncates to max length

**Response (200):**
```json
{
  "success": true,
  "message": "Successfully joined the queue",
  "queueId": "firestore-auto-id-abc123"
}
```

**Firestore write — updated queue schema:**
```json
{
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "driverFN": "Juan",
  "driverMI": "M",
  "driverLN": "Cruz",
  "token": "SYS-A1B2C3D4E5F6",
  "truckType": "10W",
  "plateNumber": "ABC 1234",
  "truckCompany": "ABC Logistics",
  "helperName": "Maria Santos",
  "registrationComplete": false,
  "joinedAt": "<Firestore Timestamp>",
  "status": "queued",  // ⚠️ AS-BUILT — backend writes "queued" not "waiting"
  "isAssigned": false
}
```

**⚠️ CORRECTION — AS-BUILT STATUS:** The backend writes `status: "queued"` (qrController.js:129), not `"waiting"`. The mobile app correctly queries for `"queued"` (MainActivity.kt:107). These docs incorrectly show `status: "waiting"` in many places — all such references should be `status: "queued"`.

**Important:** `registrationComplete: false` at this stage. Driver NOT yet visible in Fleet Manager until trip registration is completed — and `registrationComplete` is NOT YET written by backend (⚠️).

---

### 6.2 Trip Registration (NEW — `POST /api/trip/register`)

**Purpose:** Complete driver trip information AFTER joining the queue. Updates queue entry to `registrationComplete: true`, enabling Fleet Manager visibility and Viber contact.

**When to call:** After `POST /api/qr/scan`, from scan-result.html or in-app trip registration form.

**Request:**
```
POST /api/trip/register
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>

{
  "queueId": "firestore-auto-id-abc123",
  "helperFN": "Maria",
  "helperMI": "L",
  "helperLN": "Santos",
  "company": "ABC Logistics Corp.",
  "truckType": "10W",
  "platePrefix": "ABC",
  "plateSuffix": "1234"
}
```

**Validation:**
- `queueId`: Required — doc ID returned from `/api/qr/scan`
- `helperFN`, `helperLN`: Required, 1-50 chars
- `helperMI`: Required, 1 char max
- `company`: Required, 1-100 chars (sanitized)
- `truckType`: Required, must be one of: `"AUV"`, `"4W"`, `"6W"`, `"10W"`, `"20F"`, `"40F"`
- `platePrefix`: Required, 2-4 alphanumeric chars (sanitized)
- `plateSuffix`: Required, 3-4 numeric digits (sanitized)

**Sanitization (all fields):**
- Strips: `< > & " ' ; \ /`
- Collapses whitespace
- Trims
- Truncates to max

**Response (200):**
```json
{
  "success": true,
  "message": "Trip registered successfully",
  "queueId": "firestore-auto-id-abc123",
  "registrationComplete": true
}
```

**Response (400) — validation error:**
```json
{
  "success": false,
  "message": "Invalid truckType. Must be one of: AUV, 4W, 6W, 10W, 20F, 40F"
}
```

**Response (404) — queue entry not found:**
```json
{
  "success": false,
  "message": "Queue entry not found"
}
```

**Response (409) — already registered:**
```json
{
  "success": false,
  "message": "Trip already registered for this queue entry"
}
```

**Server behavior:**
1. Validate auth token
2. Validate all field values
3. Check queue entry exists and `registrationComplete !== true`
4. Build sanitized `helper` string: `helperFN + " " + helperMI + ". " + helperLN`
5. Build `plateNumber`: `platePrefix + "-" + plateSuffix`
6. Update `queue/{queueId}` with:
   - `helperFN`, `helperMI`, `helperLN`, `helper`
   - `company`
   - `truckType` (validate against allowed list)
   - `platePrefix`, `plateSuffix`, `plateNumber`
   - `registrationComplete: true`
   - `updatedAt: serverTimestamp()`
7. **Emit `qr_token_used` via Socket.IO** — ALL QR Generator displays will immediately fetch a fresh new token (old token was already marked `used` on verify, but this step ensures displays refresh)
8. Return success

**Firestore update — queue entry with `registrationComplete: true`:**
```json
{
  "helperFN": "Maria",
  "helperMI": "L",
  "helperLN": "Santos",
  "helper": "Maria L. Santos",
  "company": "ABC Logistics Corp.",
  "truckType": "10W",
  "platePrefix": "ABC",
  "plateSuffix": "1234",
  "plateNumber": "ABC-1234",
  "registrationComplete": true,
  "updatedAt": "<Firestore Timestamp>"
}
```

---

### 6.3 Queue Status Operations

#### `PATCH /api/qr/queue-status`
Update a queue entry's status. **Requires admin role.**

**Request:**
```
PATCH /api/qr/queue-status
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>

{
  "queueId": "firestore-auto-id-abc123",
  "status": "loading"
}
```

**Valid status values:** `"waiting"` | `"loading"` | `"complete"`

**Response (200):**
```json
{
  "success": true,
  "message": "Status updated"
}
```

---

### 6.4 SAP Operations

#### `GET /api/sap/shipments`
Fetch SAP shipment data. **Requires valid Firebase ID Token.**

**Request:**
```
GET /api/sap/shipments
Authorization: Bearer <Firebase ID Token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "d": {
      "results": [
        {
          "SAPDispatchNumber": "0010128044",
          "TruckType": "10W",
          "TruckType2": "10W",
          "OBDNumber": "OBD-2024-001",
          "PlanningDate": "/Date(1751587200000)/",
          "Route": "1102 --> CITY,PROVINCE",
          "PgiStatus": "Pending",
          "CheckStatus": "Pending",
          "Amount": "10000.00",
          "SONumber": "SO-2024-001",
          "ShipToParty": "CUSTOMER-001",
          "ShipToPartyName": "Customer Name Inc.",
          "Latitude": "14.5995",
          "Longitude": "120.9842"
        }
      ]
    }
  }
}
```

### 6.5 User Management

#### `POST /api/users/update-role`
Change a user's role. **Requires admin role.**

**Request:**
```
POST /api/users/update-role
Content-Type: application/json
Authorization: Bearer <Firebase ID Token>

{
  "uid": "firebase-uid-target-user",
  "role": "fleet_manager"
}
```

**Valid roles:** `"admin"`, `"driver"`, `"fleet_manager"`, `"super_admin"`, `"qr_generator"`, `"pending"`

---

## 7. Firestore Collections

### 7.1 `queue`

**Document ID:** Firestore auto-generated ID (e.g., `abc123xyz`)

⚠️ **Important:** Document ID is NOT the driver's Firebase UID. Use the `driverId` **field** for lookups.

**Phase 1 — Initial queue entry** (`POST /api/qr/scan`):
```json
{
  "driverId": "firebase-uid-xxxxx",
  "driverName": "Juan M. Cruz",
  "driverFN": "Juan",
  "driverMI": "M",
  "driverLN": "Cruz",
  "token": "SYS-A1B2C3D4E5F6",
  "truckType": "10W",
  "plateNumber": "ABC 1234",
  "truckCompany": "ABC Logistics",
  "helperName": "Maria Santos",
  "registrationComplete": false,
  "joinedAt": "<Firestore Timestamp>",
  "status": "queued",  // ⚠️ AS-BUILT — backend writes "queued" not "waiting"
  "isAssigned": false
}
```

**Phase 2 — After trip registration** (`POST /api/trip/register`):
```json
{
  "driverFN": "Juan",
  "driverMI": "M",
  "driverLN": "Cruz",
  "driverName": "Juan M. Cruz",
  "helperFN": "Maria",
  "helperMI": "L",
  "helperLN": "Santos",
  "helper": "Maria L. Santos",
  "company": "ABC Logistics Corp.",
  "truckType": "10W",
  "platePrefix": "ABC",
  "plateSuffix": "1234",
  "plateNumber": "ABC-1234",
  "registrationComplete": true,
  "status": "queued",  // ⚠️ AS-BUILT — backend writes "queued" not "waiting"
  "isAssigned": false,
  "joinedAt": "<Firestore Timestamp>"
}
```

**Queue visibility rules:**

| Collection field | Fleet Manager visibility | QR Generator visibility |
|---|---|---|
| `registrationComplete === false` | ❌ Hidden | ✅ Shown (incomplete) |
| `registrationComplete === true` | ✅ Shown | ✅ Shown |
| `status === 'complete'` | ❌ Hidden | ❌ Hidden (after cleanup) |

**Status values (all lowercase):**
| Status | Meaning |
|---|---|
| `waiting` | In queue, not yet assigned |
| `loading` | Assigned to dispatch, en route |
| `complete` | Trip done — eligible for 30-day cleanup |

**Queue Filter Guide:** Always use `status != 'complete'`. Use `registrationComplete === true` for Fleet Manager view.

---

### 7.2 `sap_assignments`

```json
{
  "0010128044": {
    "driverId": "firebase-uid-xxxxx",
    "driverName": "Juan M. Cruz",
    "truckPlate": "ABC-1234",
    "assignedAt": "<Firestore Timestamp>"
  }
}
```

---

### 7.3 `users`

```json
{
  "email": "driver@email.com",
  "displayName": "Juan M. Cruz",
  "phone": "09171234567",
  "role": "driver",
  "driverData": {
    "fn": "Juan",
    "mi": "M",
    "ln": "Cruz"
  },
  "photoURL": "https://...",
  "createdAt": "<Firestore Timestamp>"
}
```

| Field | Type | Notes |
|---|---|---|
| `phone` | string | Philippine format `09XX...` |
| `driverData.fn` | string | First name |
| `driverData.mi` | string | Middle initial (1 char) |
| `driverData.ln` | string | Last name |
| `role` | string | `"admin"`, `"driver"`, `"fleet_manager"`, `"pending"`, etc. |

---

### 7.4 `drivers`

Live fleet tracking data (location, status).

```json
{
  "driverId": "firebase-uid-xxxxx",
  "name": "Juan M. Cruz",
  "phone": "09171234567",
  "lat": 14.5995,
  "lng": 120.9842,
  "status": "online",
  "heading": 45,
  "speed": 30,
  "updatedAt": "<Firestore Timestamp>"
}
```

---

### 7.5 `qr_tokens`

```json
{
  "token": "SYS-A1B2C3D4E5F6",
  "createdAt": "<Firestore Timestamp>",
  "expiresAt": "<Firestore Timestamp>",
  "isUsed": false   // ⚠️ NOTE: field is "isUsed" not "used"
}
```

**Token lifecycle (AS BUILT):**
1. Generated on `GET /api/qr/generate` → `isUsed: false`, `expiresAt = now + 5 min`
2. Driver scans → `GET /api/qr/verify` → **validity check only, no side effects**
3. Driver submits → `POST /api/qr/scan` → `isUsed: true` + Socket.IO `qr_token_used` emitted → QR Generator TV refreshes
4. Token permanently invalidated after scan (any subsequent verify returns 410)
5. Auto-cleanup: `isUsed=true` → 7 days TTL, unused → 5-minute TTL via `expiresAt`

---

## 8. Socket.IO Events

### 8.1 Connection Setup (Mobile App → Backend)

```kotlin
// Android/Kotlin with Socket.IO client
val socket = IO.socket("https://sysu-go.onrender.com")
socket.connect()
```

### 8.2 Events Emitted by Mobile App

#### `driver_moving`
Emitted on GPS update (throttle to ≥30m movement or ≥20 seconds).

```json
{
  "driverId": "firebase-uid-xxxxx",
  "lat": 14.5995,
  "lng": 120.9842,
  "name": "Juan M. Cruz",
  "status": "online",
  "heading": 45,
  "speed": 30,
  "timestamp": 1751587200000
}
```

---

### 8.3 Events Received by Mobile App (from Backend)

#### `update_admin_map`
Broadcast to ALL connected clients. Used by web dashboard for live map.

```json
{
  "driverId": "firebase-uid-xxxxx",
  "lat": 14.5995,
  "lng": 120.9842,
  "name": "Juan M. Cruz",
  "status": "online",
  "heading": 45,
  "speed": 30
}
```

#### `qr_token_used`
TV client (QR Generator) receives this when a driver scans a QR token. ALL QR Generator displays refresh immediately.

```json
{
  "token": "SYS-A1B2C3D4E5F6"
}
```

**⚠️ CRITICAL — AS-BUILT emission:** This event is emitted ONLY by `POST /api/qr/scan` (qrController.js:138).

**It is NOT emitted by `GET /api/qr/verify`** — verifyQR is a read-only operation.

1. ~~`GET /api/qr/verify` — (NOT - this does NOT emit)~~
2. `POST /api/qr/scan` ✅ — token marked `isUsed: true`, queue entry created, event emitted
3. `POST /api/trip/register` (⚠️ NOT YET BUILT — endpoint doesn't exist): should emit for TV consistency

---

## 9. Queue → Assignment Flow (Step-by-Step)

```
MOBILE APP                           BACKEND                          FIRESTORE                   QR GENERATOR / WEB DASHBOARD
    │                                   │                                │                              │
    │ 1. GET /api/qr/generate          │                                │                              │
    │◀─────────────────────────────────│                                │                              │
    │   { token: "SYS-XXXX",          │                                │                              │
    │     expiresAt: "..." }           │                                │                              │
    │                                   │                                │                              │
    │ [Driver scans QR from TV]        │                                │                              │
    │                                   │                                │                              │
    │ 2. GET /api/qr/verify?token=SYS  │                                │                              │
    │──────────────────────────────────▶│                                │                              │
    │                                   │ qr_tokens/{token}.used = true  │                              │
    │                                   │ ───────────────────────────────▶│                              │
    │                                   │ socket.emit("qr_token_used")   │                              │
    │                                   │───────────────────────────────▶│ QR display refreshes NOW     │
    │                                   │                                │ (old token invalidated)     │
    │ 3. POST /api/qr/scan             │                                │                              │
    │   Body: token, driverId,         │                                │                              │
    │         driverName,              │                                │                              │
    │         driverFN, driverMI,      │                                │                              │
    │         driverLN,                │                                │                              │
    │         truckType, plateNumber.. │                                │                              │
    │──────────────────────────────────▶│                                │                              │
    │                                   │ queue.add({                    │                              │
    │                                   │   driverId, token,            │                              │
    │                                   │   driverName, driverFN,       │                              │
    │                                   │   driverMI, driverLN,        │                              │
    │                                   │   registrationComplete: false,│                              │
    │                                   │   status: "waiting",          │                              │
    │                                   │   isAssigned: false,          │                              │
    │                                   │   ... })                      │                              │
    │                                   │ ───────────────────────────────▶│ onSnapshot fires            │
    │                                   │                                │                              │
    │ 4. scan-result.html shows:        │                                │                              │
    │   "QR Verified!" +                │                                │                              │
    │   Trip Registration Form          │                                │                              │
    │                                   │                                │                              │
    │ 5. Driver fills Helper FN/MI/LN, │                                │                              │
    │        Company, Truck Type,      │                                │                              │
    │        Plate Prefix + Suffix      │                                │                              │
    │                                   │                                │                              │
    │ 6. POST /api/trip/register       │                                │                              │
    │   Body: queueId, helperFN,        │                                │                              │
    │         helperMI, helperLN,      │                                │                              │
    │         company, truckType,       │                                │                              │
    │         platePrefix, plateSuffix  │                                │                              │
    │──────────────────────────────────▶│                                │                              │
    │                                   │ queue/{queueId}.update({       │                              │
    │                                   │   helperFN, helperMI,         │                              │
    │                                   │   helperLN, helper,           │                              │
    │                                   │   company, truckType,         │                              │
    │                                   │   platePrefix, plateSuffix,  │                              │
    │                                   │   plateNumber,               │                              │
    │                                   │   registrationComplete:true, │                              │
    │                                   │   updatedAt: serverTS()       │                              │
    │                                   │ })                            │                              │
    │                                   │ ───────────────────────────────▶│ onSnapshot fires            │
    │                                   │                                │                              │
    │ 7. scan-result.html shows:        │                                │                              │
    │   "Trip registered!              │                                │                              │
    │    Proceed to loading zone."      │                                │                              │
    │                                   │                                │─────────────────────────────▶│ Fleet Manager:
    │                                   │                                │                              │ Driver now visible
    │                                   │                                │                              │ (regComplete === true)
    │                                   │                                │                              │
    │                                   │                                │                              │ [Dispatcher clicks ASSIGN]
    │                                   │                                │                              │ Updates queue/{id} +
    │                                   │                                │                              │ Writes sap_assignments
```

---

## 10. Outstanding Backend Items

> ⚠️ **CORRECTION** — Multiple items below marked "✅ IMPLEMENTED" are actually NOT built.
> After audit against actual code:
> - `POST /api/trip/register` does NOT exist in code — ⚠️ NOT BUILT
> - `qrController.js` has ZERO sanitization — ⚠️ NOT BUILT
> - `config/sanitize.js` exists but does NOT export SANITIZE helpers used in these docs

| Item | Status | File | Verification |
|------|--------|------|--------------|
| `POST /api/trip/register` endpoint | ⚠️ **NOT BUILT** — no tripRoute.js, no tripController.js | Does not exist in codebase | Verified 2026-05-26 |
| `POST /api/qr/scan` enhanced sanitization | ⚠️ **NOT BUILT** — zero sanitization in qrController.js | `qrController.js` has no sanitize calls | Verified 2026-05-26 |
| `POST /api/dispatch/status` endpoint | ✅ IMPLEMENTED | `dispatchRoutes.js` | Verified 2026-05-26 |
| `qr_token_used` emission ONLY from scanQR, not verifyQR | ✅ Verified | `qrController.js:138` only in scanQR | Verified 2026-05-26 |
| `dispatch_status_update` Socket.IO event | ✅ IMPLEMENTED | `dispatchRoutes.js:84` | Verified 2026-05-26 |
| "driver" role accepted in backend | ✅ IMPLEMENTED | `userRoutes.js:14` | Verified 2026-05-26 |
| CORS with ALLOWED_ORIGINS env var | ✅ IMPLEMENTED | `server.js:26-32` | Verified 2026-05-26 |

**See `DISCREPANCY_LOG.md` for the full table of doc-vs-code differences.**

---

## 11. Security Rules Summary

See full rules in `frontend/firestore.rules`. Key points for mobile app:

| Collection | Read | Write | Notes |
|---|---|---|---|
| `users/{uid}` | Auth | Own doc only | Role changes via backend API |
| `queue/{id}` | Public | Match `driverId` field | Use backend endpoint for admin updates |
| `drivers/{id}` | Public | Own doc only | Live tracking data |
| `sap_assignments/{id}` | Public | Authenticated | Backend only (use API) |
| `qr_tokens/{id}` | Public | **DISALLOWED** | Backend generates |
| `role_requests/{id}` | Auth | Auth | |
| `incidents/{id}` | Own reports | Own reports | |

---

## 12. Firestore Composite Indexes

```json
[
  { "collectionGroup": "role_requests", "fields": [{"fieldPath":"status","order":"ASCENDING"},{"fieldPath":"createdAt","order":"DESCENDING"}] },
  { "collectionGroup": "queue",         "fields": [{"fieldPath":"status","order":"ASCENDING"},{"fieldPath":"joinedAt","order":"ASCENDING"}] },
  { "collectionGroup": "queue",         "fields": [{"fieldPath":"registrationComplete","order":"ASCENDING"},{"fieldPath":"joinedAt","order":"ASCENDING"}] },
  { "collectionGroup": "queue",         "fields": [{"fieldPath":"driverId","order":"ASCENDING"},{"fieldPath":"status","order":"ASCENDING"}] },
  { "collectionGroup": "sap_assignments","fields":[{"fieldPath":"driverId","order":"ASCENDING"},{"fieldPath":"assignedAt","order":"DESCENDING"}] },
  { "collectionGroup": "qr_tokens",   "fields": [{"fieldPath":"used","order":"ASCENDING"},{"fieldPath":"createdAt","order":"ASCENDING"}] },
  { "collectionGroup": "incidents",   "fields": [{"fieldPath":"createdAt","order":"DESCENDING"}] }
]
```

---

## 13. Field Name Reference

### Complete Field Map (updated 2026-05-26)

| Field | Type | Source | Notes |
|---|---|---|---|
| `driverFN` | string | scan flow | First name (1-50 chars) |
| `driverMI` | string | scan flow | Middle initial (1 char) |
| `driverLN` | string | scan flow | Last name (1-50 chars) |
| `driverName` | string | computed | `"driverFN + ' ' + driverMI + '. ' + driverLN"` |
| `helperFN` | string | trip registration | Helper first name |
| `helperMI` | string | trip registration | Helper middle initial (1 char) |
| `helperLN` | string | trip registration | Helper last name |
| `helper` | string | computed | `"helperFN + ' ' + helperMI + '. ' + helperLN"` |
| `company` | string | trip registration | Trucking company name (replaces `truckCompany`) |
| `platePrefix` | string | trip registration | Alphabet portion of plate (e.g., "ABC") |
| `plateSuffix` | string | trip registration | Numeric portion of plate (e.g., "1234") |
| `plateNumber` | string | computed | `"platePrefix + '-' + plateSuffix"` (e.g., "ABC-1234") |
| `truckType` | string | scan + registration | `"AUV"`, `"4W"`, `"6W"`, `"10W"`, `"20F"`, `"40F"` |
| `registrationComplete` | boolean | trip registration | `false` after scan, `true` after trip register |
| `status` | string | backend | `"waiting"`, `"loading"`, `"complete"` |
| `isAssigned` | boolean | assignment | `true` after SAP dispatch assignment |
| `token` | string | scan | QR token used (marked `used` on verify) |
| `joinedAt` | Timestamp | scan | Server timestamp — FIFO ordering field |

### Legacy field compatibility:

| Old field name | New field name | Notes |
|---|---|---|
| `truckCompany` | `company` | Trip registration writes both |
| `helperName` | `helper` / `helperFN+helperMI+helperLN` | Still written for backward compatibility |

### Truck Types (canonical list):
```
AUV  — Asian Utility Vehicle
4W   — 4-Wheeler
6W   — 6-Wheeler
10W  — 10-Wheeler
20F  — 20-Foot Container
40F  — 40-Foot Container
```

---

## 14. Mobile App Checklist

Before shipping mobile app integration:

- [ ] **Auth:** Firebase Auth configured with Google Sign-In
- [ ] **Auth:** `getIdToken()` used for all authenticated API calls
- [ ] **QR scan:** `POST /api/qr/scan` sends `driverFN`, `driverMI`, `driverLN` (name split) + `driverName`
- [ ] **QR scan:** `registrationComplete` not yet set (backend defaults to `false`)
- [ ] **Trip registration:** `POST /api/trip/register` called after scan with:
  - Helper FN/MI/LN (sanitized, validated max lengths)
  - Company (sanitized)
  - Truck Type (validated against 6 allowed values)
  - platePrefix (2-4 alphanumeric), plateSuffix (3-4 numeric)
- [ ] **Sanitization:** All string inputs strip `< > & " ' ; \ /` before sending
- [ ] **GPS:** `driver_moving` Socket.IO event throttled to ≥30m movement + ≥20s interval
- [ ] **CORS:** Mobile app origin added to backend's `allowedOrigins` in `server.js`
- [ ] **Status:** `PATCH /api/qr/queue-status` used for status updates
- [ ] **Indexes:** Composite indexes deployed

---

## 15. Firestore Cleanup Schedulers

All cleanup jobs run automatically in the backend via `node-cron`.

### 15.1 QR Tokens Cleanup — Daily 2:00 AM (Asia/Manila)

| Token state | Deleted after |
|---|---|
| `used === false` | 48 hours from `createdAt` (via `expiresAt` TTL) |
| `used === true` | 7 days from `createdAt` |

### 15.2 Queue Cleanup — Daily 2:00 AM (Asia/Manila)
Completed queue entries (status: `"complete"`) older than **30 days** are auto-deleted.

### 15.3 Incidents Cleanup — Daily 2:00 AM (Asia/Manila)
Incidents older than **60 days** are auto-deleted regardless of status.

---

## Related Documentation

| File | Purpose |
|------|---------|
| `docs/archive/legacy-backend-integration/SYSU_GO_BACKEND_REQUIREMENTS.md` | Historical backend requirements |
| `docs/archive/legacy-backend-integration/SYSU_FRONTEND_CHANGES.md` | Historical web dashboard changes |
| `docs/archive/legacy-backend-integration/FLEET_QUEUE_ASSIGNMENT_STEPS.md` | Historical assignment flow details |
| `docs/archive/legacy-backend-integration/QR_GENERATOR_FIXES.md` | Historical QR integration notes |
| `/frontend/firestore.rules` | Full Firestore security rules |
| `/frontend/firestore.indexes.json` | Firestore composite indexes |
