# Dashboard Queue State Icon Swap — Implementation Plan

**Goal:** Swap the dashboard's pulsing QR button to a ticket icon (with continued pulse) when driver is in queue, and change the CTA text accordingly. Revert when out of queue.

**Architecture:** Single-`MainActivity` change. Store `ObjectAnimator` references to cancel/restart pulse rings cleanly. New `updateScanButtonState()` function drives both icon `src` and `cardScanCTA` text. `checkQueueAndScan()` is removed; click listener routes directly.

**Tech Stack:** Android ViewBinding, `ObjectAnimator`, `FirebaseFirestore` listener, Kotlin

---

## Task 1: Add `pulseAnimator1` and `pulseAnimator2` fields

**Files:** `app/src/main/java/com/sysu/go/activities/MainActivity.kt`

Add two `ObjectAnimator?` fields after line 34 (`isInQueue = false`):

```kotlin
private var pulseAnimator1: ObjectAnimator? = null
private var pulseAnimator2: ObjectAnimator? = null
```

---

## Task 2: Refactor `startPulseRing()` to store animator references

**Files:** `app/src/main/java/com/sysu/go/activities/MainActivity.kt:233-257` (approximate)

Modify `startPulseRing(ring: View, delayMs: Long)` to store the alpha and scaleX animators in `pulseAnimator1` / `pulseAnimator2` when they are created. The function signature stays the same. The self-referential `onAnimationEnd` chain remains — it just uses the stored refs for cancellation.

```kotlin
private fun startPulseRing(ring: View, delayMs: Long) {
    ring.postDelayed({
        pulseAnimator1 = ObjectAnimator.ofFloat(ring, "alpha", 0f, 0.6f).apply {
            duration = 2000L
            start()
        }
        pulseAnimator2 = ObjectAnimator.ofFloat(ring, "scaleX", 1f, 1.5f).apply {
            duration = 2000L
            start()
        }
        ObjectAnimator.ofFloat(ring, "scaleY", 1f, 1.5f).apply {
            duration = 2000L
            interpolator = AccelerateDecelerateInterpolator()
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    ring.scaleX = 1f
                    ring.scaleY = 1f
                    ring.alpha = 0f
                    startPulseRing(ring, 0L)
                }
            })
            start()
        }
    }, delayMs)
}
```

---

## Task 3: Add `stopPulseRings()` function

**Files:** `app/src/main/java/com/sysu/go/activities/MainActivity.kt` (new function, after `startPulseRing`)

```kotlin
private fun stopPulseRings() {
    pulseAnimator1?.cancel()
    pulseAnimator2?.cancel()
    binding.pulseRing1.scaleX = 1f
    binding.pulseRing1.scaleY = 1f
    binding.pulseRing1.alpha = 0f
    binding.pulseRing2.scaleX = 1f
    binding.pulseRing2.scaleY = 1f
    binding.pulseRing2.alpha = 0f
}
```

---

## Task 4: Add `updateScanButtonState()` function

**Files:** `app/src/main/java/com/sysu/go/activities/MainActivity.kt` (new function)

This function updates three things based on `isInQueue`:
1. `btnScanQR` icon (`src`)
2. `cardScanCTA` text (the two `TextView` children inside the `LinearLayout`)
3. Click listener

```kotlin
private fun updateScanButtonState() {
    // Find the TextView children inside cardScanCTA LinearLayout
    val ctaContainer = binding.cardScanCTA
    val headerTextView = ctaContainer.getChildAt(0) as? android.widget.TextView
    val bodyTextView = ctaContainer.getChildAt(1) as? android.widget.TextView

    if (isInQueue) {
        // Icon: ticket
        binding.btnScanQR.setImageResource(R.drawable.ticket_1)
        binding.btnScanQR.setOnClickListener { openQueueDetails() }
        // CTA text: in queue
        headerTextView?.text = "You're in the queue!"
        bodyTextView?.text = "Tap the ticket icon below to check your status."
    } else {
        // Icon: QR
        binding.btnScanQR.setImageResource(R.drawable.qr_icon)
        binding.btnScanQR.setOnClickListener { openQRScan() }
        // CTA text: not in queue (restore original)
        headerTextView?.text = "Ready to get started?"
        bodyTextView?.text = "Tap the pulsing QR icon below and point your camera at the screen at the booth to join the queue."
    }
}
```

---

## Task 5: Add `openQueueDetails()` function

Replaces `checkQueueAndScan()` as the click target.

```kotlin
private fun openQueueDetails() {
    if (isInQueue) {
        startActivity(Intent(this, QueueDetailsActivity::class.java))
    } else {
        Toast.makeText(this, "You are not in the queue yet. Scan a QR code to join.", Toast.LENGTH_SHORT).show()
    }
}
```

---

## Task 6: Update `onResume()`

Replace `onResume()` (lines 259-261):

```kotlin
override fun onResume() {
    super.onResume()
    listenToQueueStatus()
    updateScanButtonState()
}
```

---

## Task 7: Call `updateScanButtonState()` when `isInQueue` changes in `listenToQueueStatus()`

Find inside `listenToQueueStatus()` where `isInQueue = true` is set (line ~365). Add `updateScanButtonState()` after. Also add after `isInQueue = false` (line ~390).

```kotlin
if (snapshots != null && !snapshots.isEmpty) {
    // ... existing code ...
    isInQueue = true
    // ... existing cleanup code ...
    updateScanButtonState()
} else {
    // ... existing code ...
    isInQueue = false
    updateScanButtonState()
}
```

---

## Task 8: Remove `binding.cardScanCTA.visibility = View.GONE` from `listenToQueueStatus()`

Remove the line `binding.cardScanCTA.visibility = View.GONE` from `listenToQueueStatus()`. The `cardScanCTA` must always be visible — only its text changes.

---

## Task 9: Remove `checkQueueAndScan()` entirely

Delete the `checkQueueAndScan()` function (lines ~328-341). Its logic is replaced by `openQueueDetails()` and `openQRScan()` routed through `updateScanButtonState()`.

---

## Task 10: Verify compilation

Run `./gradlew assembleDebug` or build in Android Studio. Expected: clean build.

---

## Task 11: Commit

```bash
git add app/src/main/java/com/sysu/go/activities/MainActivity.kt
git commit -m "feat(dashboard): swap QR button to ticket icon when driver is in queue

- Add pulseAnimator1/2 fields to control pulse ring cancellation
- Refactor startPulseRing() to store animator references
- Add stopPulseRings(), updateScanButtonState(), openQueueDetails()
- cardScanCTA text changes based on queue state (always visible)
- Remove checkQueueAndScan() dialog (no longer needed)
- Remove cardScanCTA.visibility = View.GONE (always visible)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```