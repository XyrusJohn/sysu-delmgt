# Connectivity Heartbeat Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-sided internet connectivity heartbeat monitor — backend pings 1.1.1.1 every 15s and logs status; Android checks device network every 15s and logs online/offline and WiFi↔Cellular switches.

**Architecture:**
- **Backend:** Standalone `utils/heartbeatMonitor.js` module with Node's built-in `https` module. Runs an interval, makes HTTP HEAD requests to `https://1.1.1.1` (5s timeout), falls back to `https://8.8.8.8` on failure. Logs changes in status with timestamp.
- **Android:** `utils/ConnectivityMonitor.kt` object using `ConnectivityManager` + `NetworkCapabilities`. Runs every 15s via `Handler` + `Runnable`. Logs transport type on online, logs network switch events.

**Tech Stack:** Node.js built-in `http`/`https` (backend); Android `ConnectivityManager`, `NetworkCapabilities`, `Handler` (Android)

---

## Task 1: Backend Heartbeat Monitor

**Files:**
- Create: `backend/utils/heartbeatMonitor.js`
- Modify: `backend/server.js` (add `require` + call `startHeartbeat()` after server.listen)

- [ ] **Step 1: Create `backend/utils/heartbeatMonitor.js`**

Run: (no test for this — console-only utility, manual verify by starting server)

```js
const https = require("https");

const PRIMARY_HOST = "1.1.1.1";   // Cloudflare DNS
const FALLBACK_HOST = "8.8.8.8";  // Google DNS
const CHECK_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

let intervalId = null;
let lastStatus = null; // null = unknown, true = online, false = offline

function checkInternet reachability(host) {
  return new Promise((resolve) => {
    const url = `https://${host}`;
    const req = https.request(
      url,
      { method: "HEAD", timeout: REQUEST_TIMEOUT_MS },
      (res) => resolve(true)
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function formatTimestamp() {
  return new Date().toISOString();
}

async function tick() {
  const isOnline = await checkInternetReachability(PRIMARY_HOST);
  let online = isOnline;

  // Fallback: if primary fails, try secondary
  if (!online) {
    online = await checkInternetReachability(FALLBACK_HOST);
  }

  // Avoid duplicate logs on same status
  if (online !== lastStatus) {
    const prev = lastStatus === null ? "UNKNOWN" : lastStatus ? "ONLINE" : "OFFLINE";
    const curr = online ? "ONLINE" : "OFFLINE";
    if (!online) {
      console.warn(`[HEARTBEAT] ⚠️  Internet: OFFLINE — will retry in 15s`);
    } else {
      console.log(`[HEARTBEAT] 🌐 Internet: ONLINE  (${formatTimestamp()})`);
    }
    if (lastStatus !== null) {
      console.log(`[HEARTBEAT] 🔄 Internet status changed: ${prev} → ${curr}`);
    }
    lastStatus = online;
  }
}

function startHeartbeat() {
  // Run immediately, then schedule
  tick();
  intervalId = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[HEARTBEAT] Started — checking every ${CHECK_INTERVAL_MS / 1000}s (dev: ${PRIMARY_HOST})`);
}

function stopHeartbeat() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[HEARTBEAT] Stopped");
  }
}

module.exports = { startHeartbeat, stopHeartbeat };
```

- [ ] **Step 2: Modify `backend/server.js` — add require and call**

**File:** `backend/server.js`

After line 8 (`const { getDb } = require("./config/firebaseAdmin.js");`), add:

```js
const { startHeartbeat } = require("./utils/heartbeatMonitor");
```

After the `server.listen(...)` block — find the line `console.log(`🚀 Server + Socket.IO running on port ${RAILWAY_PORT}`);` and add after it:

```js
  // Start internet connectivity heartbeat monitor
  startHeartbeat();
```

Expected result after `console.log("🚀 Server + Socket.IO running on port 3001")`:
```
[HEARTBEAT] Started — checking every 15s (dev: 1.1.1.1)
[HEARTBEAT] 🌐 Internet: ONLINE  (2026-06-07T...)
```

- [ ] **Step 3: Verify by starting the server**

Run: `npm run dev` in `backend/`
Expected:
```
[firebaseAdmin] Firebase Admin initialized.
🚀 Server + Socket.IO running on port 3001
[HEARTBEAT] Started — checking every 15s (dev: 1.1.1.1)
[HEARTBEAT] 🌐 Internet: ONLINE  (2026-...)
```
Wait 15s — should see the next tick log.

- [ ] **Step 4: Commit**

```bash
git add backend/utils/heartbeatMonitor.js backend/server.js
git commit -m "feat(backend): add internet connectivity heartbeat monitor"
```

---

## Task 2: Android Connectivity Monitor

**Files:**
- Create: `app/src/main/java/com/sysu/go/utils/ConnectivityMonitor.kt`
- Modify: `app/src/main/java/com/sysu/go/activities/MainActivity.kt` (init in `onCreate`)

- [ ] **Step 1: Create `app/src/main/java/com/sysu/go/utils/ConnectivityMonitor.kt`**

```kotlin
package com.sysu.go.utils

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log

object ConnectivityMonitor {
    private const val TAG = "ConnectivityMonitor"
    private const val INTERVAL_MS = 15_000L

    private val handler = Handler(Looper.getMainLooper())
    private var lastStatus: Status? = null

    private enum class Status {
        ONLINE_WIFI,
        ONLINE_CELLULAR,
        ONLINE_ETHERNET,
        ONLINE_UNKNOWN,
        OFFLINE
    }

    private val runnable = object : Runnable {
        override fun run() {
            checkAndLog()
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    @SuppressLint("MissingPermission")
    private fun checkAndLog() {
        val ctx = applicationContext
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        val network = cm.activeNetwork
        val caps = cm.getNetworkCapabilities(network)

        val currentStatus = if (caps == null) {
            Status.OFFLINE
        } else {
            when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Status.ONLINE_WIFI
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Status.ONLINE_CELLULAR
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Status.ONLINE_ETHERNET
                else -> Status.ONLINE_UNKNOWN
            }
        }

        if (currentStatus != lastStatus) {
            when (currentStatus) {
                Status.OFFLINE -> Log.w(TAG, "🌐 OFFLINE — waiting 15s")
                Status.ONLINE_WIFI -> Log.i(TAG, "🌐 ONLINE — WIFI")
                Status.ONLINE_CELLULAR -> Log.i(TAG, "🌐 ONLINE — CELLULAR")
                Status.ONLINE_ETHERNET -> Log.i(TAG, "🌐 ONLINE — ETHERNET")
                Status.ONLINE_UNKNOWN -> Log.i(TAG, "🌐 ONLINE — UNKNOWN")
            }

            // Log network switch event if we have a prior state
            if (lastStatus != null && lastStatus != Status.OFFLINE && currentStatus != Status.OFFLINE) {
                val from = lastStatus!!.name.removePrefix("ONLINE_")
                val to = currentStatus.name.removePrefix("ONLINE_")
                Log.i(TAG, "🔄 Network switched: $from → $to")
            }

            lastStatus = currentStatus
        }
    }

    fun start(context: Context) {
        applicationContext = context.applicationContext
        handler.post(runnable)
        Log.d(TAG, "ConnectivityMonitor started — checking every 15s")
    }

    private lateinit var applicationContext: Context
}
```

- [ ] **Step 2: Modify `MainActivity.kt` — init ConnectivityMonitor**

**File:** `app/src/main/java/com/sysu/go/activities/MainActivity.kt`

After line 106:
```kotlin
FirebaseAuthManager.initialize(this)
```

Add:
```kotlin
import com.sysu.go.utils.ConnectivityMonitor
```

And after line 106 (`FirebaseAuthManager.initialize(this)`) add:
```kotlin
        ConnectivityMonitor.start(this)
```

The start call should be after FirebaseAuthManager but anywhere in `onCreate` is fine.

Expected result in Logcat:
```
D/ConnectivityMonitor: ConnectivityMonitor started — checking every 15s
D/ConnectivityMonitor: 🌐 ONLINE — WIFI
// 15s later...
D/ConnectivityMonitor: 🌐 ONLINE — WIFI
// if WiFi disconnects...
W/ConnectivityMonitor: 🌐 OFFLINE — waiting 15s
// if switches to cellular...
I/ConnectivityMonitor: 🔄 Network switched: WIFI → CELLULAR
```

- [ ] **Step 3: Verify — run the app on emulator**

Run the Android app on emulator, filter Logcat by `ConnectivityMonitor`.
Expected: periodic logs every 15 seconds.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/sysu/go/utils/ConnectivityMonitor.kt app/src/main/java/com/sysu/go/activities/MainActivity.kt
git commit -m "feat(android): add connectivity heartbeat monitor logging to Logcat"
```

---

## Self-Review Checklist

- [ ] Backend: `heartbeatMonitor.js` uses only Node built-ins — no new npm deps
- [ ] Backend: `stopHeartbeat()` is exported for graceful shutdown (not used yet but follows spec)
- [ ] Backend: falls back to 8.8.8.8 if 1.1.1.1 fails — matches spec
- [ ] Backend: initial status-change log only fires after first check (lastStatus = null guard)
- [ ] Android: uses `applicationContext` to avoid Activity memory leak
- [ ] Android: Handler with `Looper.getMainLooper()` — context-safe for UI-logging thread
- [ ] Android: `NetworkCapabilities` check handles all transport types from spec
- [ ] Android: `applicationContext` lateinit var is set before handler posts the runnable
- [ ] Both sides: 15s interval matches spec
- [ ] Both sides: logs include ONLINE/OFFLINE emoji as spec shows

---

**Execution choice:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks
**2. Inline Execution** — Execute tasks in this session, batch with checkpoints

Which approach?