> Historical copy of the former backend guide. Its database, authentication, endpoints, and setup claims are superseded; use `../backend-api-guide.md` for the reviewed current route map.

# SYSU Backend API

> Current contract correction (2026-10-09): this guide contains historical MySQL/JWT endpoint descriptions. Current release authority is [`FIX_TRACKER.md`](../FIX_TRACKER.md) and [`RELEASE_FIXES_TDD.md`](../RELEASE_FIXES_TDD.md). Shipped server uses Firebase identity/active profiles; Socket.IO handshake authentication is mandatory, tracking broadcasts are scoped to fleet_manager/admin/super_admin, and driver mutations are self-scoped. GET /api/sap/shipments on this mobile backend is retired (staff 410; unrelated roles 403; anonymous 401); use the guarded sysu-app SAP service. /api/firestore-test is disabled. Do not deploy from the historical examples below.

A Node.js/Express backend service powering the SYSU (Stanley University Transportation) driver management system. Provides REST API endpoints for driver authentication and real-time location tracking via Socket.IO.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
  - [Authentication](#authentication)
  - [Request/Response Formats](#requestresponse-formats)
- [Socket.IO Events](#socketio-events)
- [Database Schema](#database-schema)
- [Authentication Flow](#authentication-flow)
- [Environment Configuration](#environment-configuration)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Server](#running-the-server)
- [API Documentation](#api-documentation)
  - [POST /api/auth/signup](#post-apiauthsignup)
  - [POST /api/auth/login](#post-apiauthlogin)
  - [POST /api/auth/logout](#post-apiauthlogout)

---

## Overview

SYSU Backend is the server-side component of a truck driver management system that handles:

- **Driver Authentication** — Secure registration, login, and logout with JWT tokens
- **Real-time Location Tracking** — Socket.IO integration for live driver position updates
- **Driver Status Management** — Online/offline status broadcasting to admin dashboards
- **Token Blacklisting** — Secure logout with JWT invalidation

The system consists of a REST API for authentication and a Socket.IO server for real-time communication between driver mobile apps and admin dashboards.

---

## Architecture

```
                            ┌──────────────────────────────────────────┐
                            │            SYSU System Architecture       │
                            └──────────────────────────────────────────┘

                                        ┌─────────────────┐
                                        │   AdminDashboard │
                                        │   (React/Web)   │
                                        └────────┬────────┘
                                                 │
                                                 │ Socket.IO
                                                 │ update_admin_map
                                        ┌────────▼────────┐
                                        │                 │
  ┌──────────────┐   REST API           │  Express + IO   │   Socket.IO Events
  │ Driver App   │───/api/auth────────►│    Server      │◄──update_status
  │  (Kotlin)    │                      │   (Port 3001)  │    driver_moving
  └──────┬───────┘                      │                 │    vendor_status_update
         │                              └────────┬────────┘
         │                                       │
         │ Socket.IO                             │ Supabase queries
         │ update_status                         │
         │ driver_moving                   ┌─────▼─────────┐
         └─────────────────────────────────►│  Supabase    │
                                            │  PostgreSQL  │
                                            └──────────────┘
```

### Data Flow

```
Driver Mobile App                          Backend                          Database/Admin
     │                                        │                                   │
     │── POST /api/auth/signup ─────────────►│── Driver.createDriver() ────────►│
     │◄─ JWT Token + driver_id ──────────────│                                   │
     │                                        │                                   │
     │── POST /api/auth/login ──────────────►│── Driver.getDriverByUsername()──►│
     │◄─ JWT Token + driver_info ────────────│                                   │
     │                                        │                                   │
     │════ Socket.IO Connect ════════════════│                                   │
     │                                        │                                   │
     │── emit(update_status: {driverId,      │                                   │
     │         status: "online"}) ──────────►│── io.emit(vendor_status_update)──►│── Admin Map
     │                                        │                                   │
     │── emit(driver_moving: {driverId,      │                                   │
     │         lat, lng}) ──────────────────►│── io.emit(update_admin_map,       │
     │                                        │           {driverId, lat, lng,   │
     │                                        │            name}) ─────────────►│── Admin Map
     │                                        │                                   │
     │── emit(disconnect) ─────────────────►│── io.emit(vendor_status_update:  │
     │                                        │           {status: "offline"})──►│── Admin Map
     │                                        │                                   │
     │── POST /api/auth/logout ─────────────►│── Auth.blacklistToken() ────────►│
     │── emit(update_status: {status:       │                                   │
              "offline"})                   │                                   │
```

---

## Tech Stack

| Category | Technology | Version | Purpose |
|----------|------------|---------|---------|
| Runtime | Node.js | ^22.x | JavaScript runtime |
| Framework | Express.js | ^5.2.1 | REST API framework |
| Real-time | Socket.IO | ^4.8.3 | WebSocket communication |
| Database | Supabase | ^2.47.0 | PostgreSQL client |
| Auth | jsonwebtoken | ^9.0.3 | JWT generation/verification |
| Password | bcrypt | ^6.0.0 | Password hashing |
| Scheduler | node-cron | ^4.2.1 | Scheduled tasks |
| Env Vars | dotenv | ^17.3.1 | Environment configuration |
| CORS | cors | ^2.8.6 | Cross-origin resource sharing |
| Dev | nodemon | ^3.1.14 | Development auto-reload |

---

## Project Structure

```
backend/
├── config/
│   ├── db.js           # Supabase client initialization
│   ├── sanitize.js      # Input sanitization utilities
│   └── utils.js        # JWT token generation utility
│
├── controller/
│   └── authController.js   # Signup, login, logout handlers
│
├── jobs/
│   └── cronJobs.js     # Scheduled tasks (token cleanup)
│
├── middleware/
│   └── authMiddleware.js   # JWT verification middleware
│
├── models/
│   ├── authModel.js    # Token blacklist operations
│   └── driverModel.js # Driver CRUD operations
│
├── routes/
│   └── authRoutes.js   # Auth route definitions
│
├── docs/
│   ├── architecture.txt    # Architecture notes
│   ├── driver-app-flow.txt # Driver app flow
│   └── trip-flow.txt       # Trip flow documentation
│
├── public/             # Static assets
├── .env                # Environment variables (do not commit)
├── .env.example        # Environment template
├── package.json
└── server.js           # Entry point
```

---

## API Endpoints

### Authentication

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| `POST` | `/api/auth/signup` | No | Register a new driver |
| `POST` | `/api/auth/login` | No | Authenticate driver |
| `POST` | `/api/auth/logout` | Yes (JWT) | Invalidate token |

---

### Request/Response Formats

#### `POST /api/auth/signup`

**Request Body:**
```json
{
  "phone_number": "09123456789",
  "last_name": "Dela Cruz",
  "first_name": "Juan",
  "middle_initial": "M",
  "username": "juandelacruz",
  "password": "Password123"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Driver registered successfully.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "data": {
    "driver_id": 1,
    "full_name": "Juan M. Dela Cruz"
  }
}
```

**Error Responses:**
| Status | Message |
|--------|---------|
| 400 | "All fields are required." |
| 400 | "Invalid phone number." |
| 400 | "Invalid middle initial." |
| 400 | "Username is already taken." |
| 400 | "Phone number is already registered." |
| 400 | "Password must be at least 8 characters long." |

---

#### `POST /api/auth/login`

**Request Body:**
```json
{
  "username": "juandelacruz",
  "password": "Password123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "data": {
    "driver_id": 1,
    "username": "juandelacruz",
    "full_name": "Juan M. Dela Cruz"
  }
}
```

**Error Responses:**
| Status | Message |
|--------|---------|
| 400 | "All fields are required." |
| 401 | "Invalid credentials." |

---

#### `POST /api/auth/logout`

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Logout successful."
}
```

---

## Socket.IO Events

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `update_status` | `{ driverId, status }` | Driver goes online/offline |
| `driver_moving` | `{ driverId, lat, lng }` | Live location update |
| `disconnect` | — | Driver app disconnected |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `vendor_status_update` | `{ driverId, status, name }` | Driver status change broadcast |
| `update_admin_map` | `{ driverId, lat, lng, name }` | Live location for admin map |

### Socket.IO Configuration

```javascript
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 15000,  // 15 seconds
  pingInterval: 5000,  // 5 seconds
});
```

### Usage Example

**Driver App (going online):**
```javascript
socket.emit("update_status", { driverId: 1, status: "online" });
```

**Driver App (sending location):**
```javascript
socket.emit("driver_moving", { driverId: 1, lat: 14.5995, lng: 120.9842 });
```

**Admin Dashboard (receiving updates):**
```javascript
socket.on("vendor_status_update", (data) => {
  console.log(`${data.name} is now ${data.status}`);
});

socket.on("update_admin_map", (data) => {
  updateMapMarker(data.driverId, data.lat, data.lng, data.name);
});
```

---

## Database Schema

### Tables

#### `driver`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `driver_id` | SERIAL | PRIMARY KEY | Auto-increment ID |
| `phone_number` | VARCHAR(20) | UNIQUE, NOT NULL | 11-digit Philippine mobile |
| `last_name` | VARCHAR(100) | NOT NULL | Driver's surname |
| `first_name` | VARCHAR(100) | NOT NULL | Driver's given name |
| `middle_initial` | VARCHAR(3) | NULL | Middle initial (e.g., "M.") |
| `username` | VARCHAR(50) | UNIQUE, NOT NULL | Login username |
| `password` | TEXT | NOT NULL | Bcrypt hashed password |
| `is_active` | BOOLEAN | DEFAULT true | Account active flag |

#### `token_blacklist`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-increment ID |
| `token` | TEXT | NOT NULL | Blacklisted JWT |
| `expires_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | Token expiration time |

### Indexes

```sql
CREATE INDEX idx_driver_username ON driver(username);
CREATE INDEX idx_driver_phone ON driver(phone_number);
CREATE INDEX idx_token_blacklist_token ON token_blacklist(token);
CREATE INDEX idx_token_blacklist_expires ON token_blacklist(expires_at);
```

---

## Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Authentication Flow                          │
└─────────────────────────────────────────────────────────────────────┘

  SIGNUP                                        LOGIN
     │                                            │
     ▼                                            ▼
┌─────────────┐                            ┌─────────────┐
│ Client sends│                            │ Client sends│
│ POST with   │                            │ POST with   │
│ credentials │                            │ username +  │
└──────┬──────┘                            │ password    │
       │                                   └──────┬──────┘
       ▼                                          ▼
┌─────────────────┐                      ┌─────────────────┐
│ 1. Input        │                      │ 1. Find driver  │
│    Validation   │                      │    by username  │
└──────┬──────────┘                      └──────┬──────────┘
       │                                         │
       ▼                                         ▼
┌─────────────────┐                      ┌─────────────────┐
│ 2. Sanitize     │                      │ 2. Compare       │
│    all fields   │                      │    password     │
│    (names,      │                      │    with bcrypt  │
│     phone, etc) │                      └──────┬──────────┘
└──────┬──────────┘                             │
       │                                        ▼
       ▼                                ┌─────────────────┐
┌─────────────────┐                      │ 3. Generate     │
│ 3. Check        │                      │    JWT (7 days) │
│    duplicates   │                      │    Set httpOnly │
│    (username,   │                      │    cookie       │
│     phone)      │                      └──────┬─────────┘
└──────┬──────────┘                             │
       │                                        ▼
       ▼                                 ┌─────────────────┐
┌─────────────────┐                 ◄────│ Return token +  │
│ 4. Hash password│                       │ driver info     │
│    with bcrypt  │                       └─────────────────┘
│    (12 rounds)  │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 5. Insert to    │
│    Supabase     │
│    driver table │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 6. Sign JWT     │──────────────────────────┐
│    (7d expiry)  │                          │
└──────┬──────────┘                          │
       │                                     │
       ▼                                     ▼
┌─────────────────┐                 ┌─────────────────┐
│ 7. Return token │                 │ Return token +  │
│    + driver_id  │                 │ driver info     │
└─────────────────┘                 └─────────────────┘
```

---

## Environment Configuration

### Required Variables

Create a `.env` file in the backend root directory:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Server Configuration
PORT=3001
NODE_ENV=development

# JWT Authentication (keep secret secure)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
```

### Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | `development` or `production` |
| `JWT_SECRET` | Yes | Secret key for JWT signing (min 32 characters) |

---

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Supabase account with project created

### Installation

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

4. **Configure Supabase credentials** in `.env`

5. **Create database tables** in Supabase SQL Editor:
   ```sql
   -- Driver table
   CREATE TABLE driver (
     driver_id SERIAL PRIMARY KEY,
     phone_number VARCHAR(20) UNIQUE NOT NULL,
     last_name VARCHAR(100) NOT NULL,
     first_name VARCHAR(100) NOT NULL,
     middle_initial VARCHAR(3),
     username VARCHAR(50) UNIQUE NOT NULL,
     password TEXT NOT NULL,
     is_active BOOLEAN DEFAULT true
   );

   -- Token blacklist table
   CREATE TABLE token_blacklist (
     id SERIAL PRIMARY KEY,
     token TEXT NOT NULL,
     expires_at TIMESTAMP WITH TIME ZONE NOT NULL
   );

   -- Indexes
   CREATE INDEX idx_driver_username ON driver(username);
   CREATE INDEX idx_driver_phone ON driver(phone_number);
   CREATE INDEX idx_token_blacklist_token ON token_blacklist(token);
   CREATE INDEX idx_token_blacklist_expires ON token_blacklist(expires_at);
   ```

### Running the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

**Verify server is running:**
```
🚀 Server + Socket.IO running on port 3001
Connected to Supabase
```

---

## Development Notes

### Cron Jobs

A scheduled job runs daily at midnight to clean up expired tokens from the blacklist:

```javascript
// Runs at: 00:00 every day
cron.schedule("0 0 * * *", async () => {
  // Delete tokens expired more than 24 hours ago
});
```

### Input Sanitization

All user inputs are sanitized before processing:

| Field | Sanitization Rules |
|-------|-------------------|
| `phone_number` | Strip non-digits, validate 11 digits |
| `name fields` | Trim, collapse spaces, capitalize each word |
| `middle_initial` | Take first char, uppercase, append dot |
| `username` | Trim, lowercase |

### Password Requirements

- Minimum 8 characters
- No complex requirements (any 8+ char string accepted)

---

## Integration with sysu-web

### CORS Configuration

The server accepts requests from any origin (`"*"`). For production, update `server.js`:

```javascript
const io = new Server(server, {
  cors: {
    origin: ["https://sysu-web.com", "https://admin.sysu-web.com"],
    methods: ["GET", "POST"],
  },
  // ...
});
```

### Connecting to Socket.IO (Frontend Example)

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3001");

// Listen for admin map updates
socket.on("update_admin_map", (data) => {
  console.log(`${data.name} moved to [${data.lat}, ${data.lng}]`);
  updateMapPosition(data.driverId, data.lat, data.lng);
});

// Listen for vendor status changes
socket.on("vendor_status_update", (data) => {
  console.log(`${data.name} is ${data.status}`);
  updateDriverStatus(data.driverId, data.status);
});
```

### API Base URL

| Environment | Base URL |
|-------------|----------|
| Local | `http://localhost:3001` |
| Production | `https://api.sysu-go.com` |

---

## Error Handling

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error description"
}
```

### HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Success (login, logout, queries) |
| 201 | Created (signup) |
| 400 | Bad Request (validation errors) |
| 401 | Unauthorized (invalid credentials, bad token) |
| 500 | Internal Server Error |

---

## License

ISC
