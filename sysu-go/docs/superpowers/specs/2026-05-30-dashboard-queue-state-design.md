# Dashboard Queue State Icon Swap — Design Spec

## Date: 2026-05-30

## Overview

After a driver registers a trip and returns to the dashboard, the pulsing QR scan button is swapped to a **ticket icon** that also pulses. Clicking it opens `QueueDetailsActivity` directly — no re-scan needed. When the driver leaves the queue, the icon reverts to the QR icon and the pulse animation continues.

## Problem Statement

Currently the dashboard always shows the same pulsing QR button, regardless of queue state. The `checkQueueAndScan()` dialog handles the "already in queue" case but is confusing UX. The fix: the button **is the menu** — it reflects current state and routes correctly on click.

## UI States

| State | Button Icon | Pulse Rings | `cardScanCTA` Message | Click Action |
|-------|-------------|-------------|----------------------|--------------|
| Not in queue | `qr_icon` | Active | "Ready to get started? Tap the pulsing QR icon below and point your camera at the screen at the booth to join the queue." | `openQRScan()` |
| In queue | `ticket_1` | Active (same rings, new anchor) | "You're in the queue! Tap the ticket icon below to check your status." | `openQueueDetails()` |

Both states show `cardScanCTA` — only the text changes. The existing bounce arrow (`ivBounceArrow`) pointing down works for both states. Both states have pulsing animation — only the icon changes.

## Architecture

### Files Changed

- `app/src/main/java/com/sysu/go/activities/MainActivity.kt`

### No new files needed:
- `@drawable/ticket_1` already exists
- `@drawable/qr_icon` already exists
- `@drawable/bg_pulse_ring` already exists

### State Tracking

Existing `isInQueue` boolean (line 34) is the source of truth, already maintained by `listenToQueueStatus()`.

### Animation Control

`startPulseRing()` chains itself recursively. To stop/cancel cleanly:
- Store two `ObjectAnimator` references as fields (`pulseAnimator1`, `pulseAnimator2`)
- Call `cancel()` when swapping icon state
- New `stopPulseRings()` function resets `alpha`, `scaleX`, `scaleY` to defaults

### Icon Swap Logic

New function: `updateScanButtonState()`

```
isInQueue == false:
  → btnScanQR.src = @drawable/qr_icon
  → startPulseRingsFromScratch()
  → btnScanQR.setOnClickListener { openQRScan() }

isInQueue == true:
  → btnScanQR.src = @drawable/ticket_1
  → // pulse rings keep running, just new anchor icon
  → btnScanQR.setOnClickListener { openQueueDetails() }
```

Called from:
1. `onResume()` after `listenToQueueStatus()`
2. Inside `listenToQueueStatus()` whenever `isInQueue` value changes

## Implementation Details

### `stopPulseRings()`
Cancels both stored animators and resets ring transforms to defaults (scale 1f, alpha 0f).

### `startPulseRingsFromScratch()`
Cancels existing → resets rings → calls `startPulseRing()` for both rings.

### `openQueueDetails()`
Replaces `checkQueueAndScan()` as the click target:
```kotlin
private fun openQueueDetails() {
    if (isInQueue) {
        startActivity(Intent(this, QueueDetailsActivity::class.java))
    }
}
```

### `checkQueueAndScan()` — Remove
Dialog becomes unused. Remove the function entirely from MainActivity.kt.

### `cardScanCTA` Text Swap
In `updateScanButtonState()`, set the appropriate string based on queue state:
- `isInQueue == false` → `cardScanCTA` text +2nd child TextView (hint) = "Ready to get started? Tap the pulsing QR icon..."
- `isInQueue == true` → `cardScanCTA` text + 2nd child TextView (hint) = "You're in the queue! Tap the ticket icon below..."
- `cardScanCTA` stays visible in both states — no visibility changes needed
- Remove the line `binding.cardScanCTA.visibility = View.GONE` from `listenToQueueStatus()` (line ~368) since it should never be hidden

## Edge Cases

- Driver dismissed from queue → `isInQueue` flips to `false` → icon reverts to `qr_icon`, pulse resumes
- Driver clicks ticket when not yet in queue → `openQueueDetails()` checks `isInQueue`, shows toast if false (already implemented in `cardMyQueue` click handler)
- `onResume()` called repeatedly → animation restart is idempotent (cancel + restart)

## Commit

Save to `docs/superpowers/specs/2026-05-30-dashboard-queue-state-design.md`