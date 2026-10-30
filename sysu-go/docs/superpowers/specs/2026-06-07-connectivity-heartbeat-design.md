# Connectivity Heartbeat Monitor — Design Spec
**Date:** 2026-06-07
**Status:** Approved

---

## Overview

Add a dual-sided internet connectivity heartbeat monitor to sysu-go:
- Backend server monitors its own internet reachability every 15 seconds
- Android app monitors device connectivity every 15 seconds
- Both log status to their respective consoles with timestamps

This gives developers immediate visibility into whether connectivity issues are a device problem or a server problem.

---

## Backend — Heartbeat Monitor

### File
`backend/utils/heartbeatMonitor.js` (new)

### Behavior
- On `startHeartbeat()`: immediately performs one check, then schedules every **15 seconds**
- Makes HTTP HEAD request to `https://1.1.1.1` (Cloudflare DNS) with 5s timeout
- On failure: retries against `https://8.8.8.8` before declaring offline
- Uses Node.js built-in `http` / `https` module — no npm dependencies

### Console Output
```
[HEARTBEAT] 🌐 Internet: ONLINE  (2026-06-07T14:23:01.000Z)
[HEARTBEAT] ⚠️  Internet: OFFLINE — will retry in 15s
[HEARTBEAT] 🌐 Internet: ONLINE  (2026-06-07T14:23:16.001Z)
[HEARTBEAT] 🔄 Internet status changed: OFFLINE → ONLINE
```

### Exported API
```js
startHeartbeat()  // start monitoring
stopHeartbeat()   // stop monitoring (for graceful shutdown)
```

### Integration
Called in `server.js` after server startup:
```js
const { startHeartbeat } = require('./utils/heartbeatMonitor');
startHeartbeat();
```

### Development Mode
When `NODE_ENV=development`, also logs which URL it's pinging to confirm localhost/production targeting.

---

## Android — Connectivity Monitor

### File
`app/src/main/java/com/sysu/go/utils/ConnectivityMonitor.kt` (new)

### Behavior
- Uses `ConnectivityManager` + `NetworkCapabilities` to check active network type
- Runs every **15 seconds** via `Handler` + `Runnable`
- Tracks last known state to avoid duplicate logs on consecutive same-state checks
- Logs `ONLINE` with transport type (WIFI / CELLULAR / ETHERNET / UNKNOWN)
- Logs `OFFLINE` when no active network
- Logs `NETWORK_SWITCH` event when transport type changes between checks (e.g. WiFi → Cellular)

### Console Output (Logcat)
```
D/ConnectivityMonitor: 🌐 ONLINE — WIFI
D/ConnectivityMonitor: 🌐 OFFLINE — waiting 15s
D/ConnectivityMonitor: 🌐 ONLINE — CELLULAR
D/ConnectivityMonitor: 🔄 Network switched: CELLULAR → WIFI
```

### Lifecycle
- Starts in `MainActivity.onCreate()` (after `SocketManager.init()`)
- No-stop — runs for entire app lifecycle
- Uses `Application` context (no leak risk)

### Dependencies
Builds on existing `NetworkUtils.isInternetAvailable()` — reuses or enhances it.

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Check interval | 15 seconds | Fast enough to catch issues, not noisy |
| Backend check target | 1.1.1.1 → 8.8.8.8 fallback | Reliable, fast, not blocked by most networks |
| Backend no `require()` on hot path | File is independent | `require()` in heartbeat loop is fine (runs once at startup), but the module itself has no external deps |
| Android transport detection | `hasTransport()` check | Distinguishes WiFi vs Cellular vs Ethernet |
| Network switch detection | Track prev vs current | Immediate log on type change, not waiting for 15s |

---

## Files to Create/Modify

| File | Action |
|---|---|
| `backend/utils/heartbeatMonitor.js` | Create |
| `backend/server.js` | Modify — add `startHeartbeat()` call |
| `app/.../utils/ConnectivityMonitor.kt` | Create |
| `app/.../activities/MainActivity.kt` | Modify — init `ConnectivityMonitor` |

---

## Out of Scope

- Push notifications on connectivity change (developer-only logging for now)
- Backend persists connectivity history
- Socket.IO integration — this is a standalone console monitor, not a user-facing feature