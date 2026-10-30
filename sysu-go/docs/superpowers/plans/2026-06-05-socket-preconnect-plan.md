# Socket Pre-Connect on TransitActivity Open — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-connect Socket.IO sockets when TransitActivity opens, so the driver's location emits immediately on Start Trip instead of being silently dropped.

**Architecture:** Add `SocketManager.init()` and `SocketManager.connect()` to `TransitActivity.onCreate()` before `setupUI()` is called. Existing `SocketManager.connect()` is already a no-op if already connected, so this is safe to call again from `LocationServices.onStartCommand()`.

**Tech Stack:** Kotlin, Firebase Auth, Socket.IO (io.socket.client), SharedPreferences

---

## File Map

```
app/src/main/java/com/sysu/go/activities/TransitActivity.kt
  - Modify: insert 2 lines after line 107 (after the if-else block that ends at line 107)
  - No other files need changing
```

No new files created. No test files (manual QA test only — see Task 1).

---

## Task 1: Insert socket pre-connect in TransitActivity.onCreate()

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt:108`

- [ ] **Step 1: Verify the insertion point**

Read lines 105–113 of `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`:

Expected content:
```
105:            sessionManager.clearCurrentSapDocId()
106:        }
107:
108:        setupUI()
109:        loadTripData()
110:        startCircleAnimation()
111:        updateProgressStepper()
112:    }
```

Confirm these exact line numbers match before proceeding.

- [ ] **Step 2: Add socket pre-connect lines**

Insert the following two lines **after line 107** (blank line before `setupUI()`):

```kotlin
        // Pre-connect sockets now so emitLastKnownLocation() succeeds on Start Trip
        SocketManager.init(this)
        SocketManager.connect()
```

After insertion, lines 107–111 should read:
```
107:
108:        // Pre-connect sockets now so emitLastKnownLocation() succeeds on Start Trip
109:        SocketManager.init(this)
110:        SocketManager.connect()
111:
112:        setupUI()
```

Run: Open `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`, navigate to line 107, insert the two lines above it.

- [ ] **Step 3: Verify the import is already present**

Check that `SocketManager` is already imported at the top of the file:

```kotlin
import com.sysu.go.network.SocketManager
```

Run: grep for `import com.sysu.go.network.SocketManager` in `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

Expected: already present (it is — you can see it on line 38 of the original file).

- [ ] **Step 4: Build to verify no compile errors**

Run: `./gradlew assembleDebug 2>&1 | tail -30`

Expected: `BUILD SUCCESSFUL` with no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/TransitActivity.kt
git commit -m "fix(transit): pre-connect sockets on Activity open so Start Trip emits immediately

Previously emitLastKnownLocation() was called before SocketManager.connect(),
causing mSocketApp to be null and the driver_moving emit to be silently dropped.
Marker now appears on sysu-app map within <1s of tapping Start Trip.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verification Checklist

- [ ] Sockets connect when TransitActivity is opened
- [ ] Tapping Start Trip emits `driver_moving` with connected socket (no silent drop)
- [ ] Marker appears on sysu-app web dashboard within < 1 second of tap
- [ ] No regression: `LocationServices.onStartCommand()` calls `SocketManager.connect()` again — verify it's still a no-op for already-connected sockets (it is, per existing guard in `connectGo()` / `connectApp()`)