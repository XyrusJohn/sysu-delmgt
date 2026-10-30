# Internet Connection Identifier — Localhost Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the internet connection identifier to work on localhost so driver name + connectivity status shows in the app's logs during development testing.

**Root Problem:** `ConnectivityMonitor` fires events but `SocketManager` never registers as a listener in `MainActivity` because `SocketManager.init(this)` is not called in `MainActivity.onCreate()`.

**Components:**
1. `MainActivity.kt` — add `SocketManager.init(this)` call so SocketManager registers as a ConnectivityChangeListener
2. `ConnectivityMonitor.kt` — add driver name prefix to logs
3. `build.gradle.kts` — add `local` build variant with localhost SOCKET_URL

---

## Task 1: Wire SocketManager.init() in MainActivity

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MainActivity.kt`

- [ ] **Step 1: Add SocketManager import and init() call in MainActivity.onCreate()**

Find in MainActivity.kt:
```kotlin
FirebaseAuthManager.initialize(this)
ConnectivityMonitor.start(this)
```

Change to:
```kotlin
FirebaseAuthManager.initialize(this)
ConnectivityMonitor.start(this)
SocketManager.init(this)  // enables connectivity listener so SocketManager receives onConnectivityChanged events
```

Also add `import com.sysu.go.network.SocketManager` if not already present in the import section.

Expected result: When connectivity changes, SocketManager receives `onConnectivityChanged()` and auto-disconnects/reconnects sockets accordingly.

- [ ] **Step 2: Verify**

After this change, when running the app with a working SOCKET_URL, the SocketManager will:
- Call `ConnectivityMonitor.addListener(this)` on `init()`
- Receive `onConnectivityChanged(OFFLINE)` → call `forceDisconnectSockets()`
- Receive `onConnectivityChanged(ONLINE_WIFI)` → call `connect()` → re-establish sockets → emit `update_status` to server with driver name

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/MainActivity.kt
git commit -m "feat(main): wire SocketManager.init() so connectivity listener activates on app launch"
```

---

## Task 2: Add Driver Name to ConnectivityMonitor Logs

**Files:**
- Modify: `app/src/main/java/com/sysu/go/utils/ConnectivityMonitor.kt`

- [ ] **Step 1: Update updateConnectivityStatus() to include driver name in logs**

Add at the top of the `ConnectivityMonitor` object:
```kotlin
import com.google.firebase.auth.FirebaseAuth
```

Change `private fun updateConnectivityStatus()` to fetch driver name and prefix logs:
```kotlin
private fun updateConnectivityStatus() {
    val driverName = FirebaseAuth.getInstance().currentUser?.displayName ?: "Driver"

    when (currentStatus) {
        Status.OFFLINE -> Log.w(TAG, "[$driverName] 🌐 OFFLINE")
        Status.ONLINE_WIFI -> Log.i(TAG, "[$driverName] 🌐 ONLINE — WIFI")
        Status.ONLINE_CELLULAR -> Log.i(TAG, "[$driverName] 🌐 ONLINE — CELLULAR")
        Status.ONLINE_ETHERNET -> Log.i(TAG, "[$driverName] 🌐 ONLINE — ETHERNET")
        Status.ONLINE_UNKNOWN -> Log.i(TAG, "[$driverName] 🌐 ONLINE — UNKNOWN")
    }

    if (lastStatus != null && lastStatus != Status.OFFLINE && currentStatus != Status.OFFLINE) {
        val from = lastStatus!!.name.removePrefix("ONLINE_")
        val to = currentStatus.name.removePrefix("ONLINE_")
        Log.i(TAG, "[$driverName] 🔄 Network switched: $from → $to")
    }
}
```

Note: Remove the previous standalone `when (currentStatus)` block and `if (lastStatus != null...)` block that do NOT include driver name — consolidate into one block that handles all status logging.

**Before editing:** Read the full `ConnectivityMonitor.kt` to find exactly where `updateConnectivityStatus()` is and what the current log calls look like. Then edit in place.

- [ ] **Step 2: Verify**

Build the project to confirm no compilation errors:
```
./gradlew assembleDebug 2>&1 | head -30
```

Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/utils/ConnectivityMonitor.kt
git commit -m "feat(connectivity): include driver name in connectivity log output"
```

---

## Task 3: Add Localhost Build Variant

**Files:**
- Modify: `app/build.gradle.kts`

- [ ] **Step 1: Add `local` buildType with localhost SOCKET_URL**

Read the current `build.gradle.kts` first. Then after the `debug` buildType block (lines ~14-29), add a new `local` buildType:

```kotlin
create("local") {
    applicationIdSuffix = ".local"
    versionNameSuffix = "-local"
    buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3001\"")
    buildConfigField("String", "SOCKET_URL", "\"http://10.0.2.2:3001\"")
    buildConfigField("String", "FRONTEND_URL", "\"http://10.0.2.2:3001\"")
}
```

`10.0.2.2` is Android emulator's alias for the host machine's localhost. For physical devices on the same WiFi, use your PC's LAN IP (e.g., `http://192.168.1.x:3001`).

**Important:** Add the `local` buildType BEFORE the `debug` block so it doesn't override debug's production URLs. Actually check the actual order in the file and place the `local` block appropriately.

- [ ] **Step 2: Verify**

Check that `local` build variant appears:
```bash
./gradlew tasks --group=build | grep -i local
```

Should show: `assembleLocal`, `buildLocal`, etc.

- [ ] **Step 3: Commit**

```bash
git add app/build.gradle.kts
git commit -m "feat(build): add local build variant for localhost development"
```

---

## Self-Review Checklist

- [ ] MainActivity: `SocketManager.init(this)` is called AFTER `FirebaseAuthManager.initialize(this)` and AFTER `ConnectivityMonitor.start(this)`
- [ ] ConnectivityMonitor: FirebaseAuth import added, driver name fetched via `FirebaseAuth.getInstance().currentUser?.displayName`
- [ ] ConnectivityMonitor: driver name shown in every log line — ONLINE, OFFLINE, and NETWORK_SWITCH
- [ ] build.gradle.kts: `local` buildType has unique `applicationIdSuffix = ".local"` so it installs alongside debug/release on the same device
- [ ] build.gradle.kts: `local` uses `http://10.0.2.2:3001` for emulator access
- [ ] All three tasks committed separately