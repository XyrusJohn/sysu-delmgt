# Trip Persistence + End Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trip state persistence (survives activity restart) and a one-tap End Trip button that marks the trip as `completed` in Firestore.

**Architecture:** Trip state is persisted via SessionManager (SharedPreferences). `currentSapDocId` is saved after `startTrip()` succeeds. On `onCreate()`, if a saved `sapDocId` exists, the activity restores `isTripStarted = true` and the appropriate button state before `loadTripData()` runs. End Trip updates Firestore (`tripStatus = "completed"`, `completedAt = now`) then stops location tracking.

**Tech Stack:** Kotlin, Android SharedPreferences (SessionManager), Firebase Firestore, Android foreground service control.

---

## File Map

| File | Responsibility |
|------|----------------|
| `SessionManager.kt` | Persist/retrieve/clear `sap_doc_id` in SharedPreferences |
| `TransitActivity.kt` | State restoration on create, End Trip logic, button wiring |
| `activity_transit.xml` | End Trip button layout |

---

## Task 1: SessionManager — add SAP doc ID persistence

**Files:**
- Modify: `app/src/main/java/com/sysu/go/utils/SessionManager.kt`

- [ ] **Step 1: Read SessionManager to find the last method**

Read the file and note the last method defined, its line number, and closing brace location.

- [ ] **Step 2: Add three new methods after the last existing method**

Insert these methods at the end of the class, before the final closing `}`:

```kotlin
fun saveCurrentSapDocId(id: String) {
    prefs.edit().putString("sap_doc_id", id).apply()
}

fun getCurrentSapDocId(): String? {
    return prefs.getString("sap_doc_id", null)
}

fun clearCurrentSapDocId() {
    prefs.edit().remove("sap_doc_id").apply()
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/utils/SessionManager.kt
git commit -m "feat(SessionManager): add sap_doc_id persistence methods

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: TransitActivity — restore trip state in onCreate

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

- [ ] **Step 1: Add restore block in onCreate before setupUI() call**

In `onCreate()`, find this line:
```kotlin
setupUI()
```

Add this block immediately above it:
```kotlin
// Restore trip session state if driver re-opens app mid-trip
val savedDocId = sessionManager.getCurrentSapDocId()
if (savedDocId != null) {
    currentSapDocId = savedDocId
    isTripStarted = true
    binding.tvSubStatus.text = "Trip in progress"
}
```

- [ ] **Step 2: Verify setupUI() handles isTripStarted = true correctly**

The existing `setupUI()` has:
```kotlin
binding.btnStartTrip.setOnClickListener {
    if (isTripStarted) return@setOnClickListener
    startTrip()
}
```

This prevents re-triggering start. However, `setupUI()` does NOT currently set the button text/alpha on its own — that only happens in `startTrip()` success callback. So we need to also force the button state when restoring.

Add inside the restore block (after `binding.tvSubStatus.text = "Trip in progress"`):
```kotlin
binding.btnStartTrip.text = "TRIP IN PROGRESS..."
binding.btnStartTrip.alpha = 0.6f
binding.btnStartTrip.isEnabled = false
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/TransitActivity.kt
git commit -m "feat(TransitActivity): restore trip state from SessionManager on create

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: TransitActivity — add End Trip button wiring and visibility

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

- [ ] **Step 1: Add btnEndTrip click handler in setupUI()**

Find the end of `setupUI()` (the closing `}` of that function). Add above that:

```kotlin
binding.btnEndTrip.setOnClickListener {
    if (!isTripStarted) return@setOnClickListener
    endTrip()
}
```

- [ ] **Step 2: Show btnEndTrip after startTrip() succeeds**

In `startTrip()` success listener, after `isTripStarted = true` and `binding.btnStartTrip.alpha = 0.6f`, add:

```kotlin
binding.btnEndTrip.visibility = View.VISIBLE
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/TransitActivity.kt
git commit -m "feat(TransitActivity): wire btnEndTrip click and show after trip start

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: TransitActivity — implement endTrip() function

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

- [ ] **Step 1: Add stopLocationUpdates() helper above startTrip()**

Find `startTrip()` (line ~168). Add this function right before `startTrip()`:

```kotlin
private fun stopLocationUpdates() {
    val serviceIntent = Intent(this, LocationServices::class.java)
    stopService(serviceIntent)
    synchronized(this) {
        locationCallback?.let { try { fusedLocationClient?.removeLocationUpdates(it) } catch (_: Exception) {} }
        androidLocationListener?.let {
            try { (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(it) } catch (_: Exception) {}
        }
    }
    locationCallback = null
    androidLocationListener = null
}
```

- [ ] **Step 2: Add endTrip() function after startTrip()**

Find the closing `}` of `startTrip()`. Add this after it:

```kotlin
private fun endTrip() {
    AlertDialog.Builder(this)
        .setTitle("End Trip?")
        .setMessage("Mark this trip as completed?")
        .setPositiveButton("End Trip") { _, _ ->
            val updates = mapOf(
                "tripStatus" to "completed",
                "completedAt" to Timestamp.now()
            )
            db.collection("sap_assignments").document(currentSapDocId)
                .update(updates)
                .addOnSuccessListener {
                    isTripStarted = false
                    sessionManager.clearCurrentSapDocId()
                    stopLocationUpdates()
                    binding.btnEndTrip.visibility = View.GONE
                    binding.btnStartTrip.text = "START TRIP"
                    binding.btnStartTrip.alpha = 1.0f
                    binding.btnStartTrip.isEnabled = true
                    binding.tvSubStatus.text = "Ready to start"
                    Toast.makeText(this, "Trip completed!", Toast.LENGTH_LONG).show()
                    Log.d(TAG, "Trip ended successfully")
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "Failed to end trip: ${e.message}")
                    Toast.makeText(this, "Failed to end trip. Try again.", Toast.LENGTH_SHORT).show()
                }
        }
        .setNegativeButton("Cancel", null)
        .show()
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/TransitActivity.kt
git commit -m "feat(TransitActivity): add endTrip() with confirm dialog and Firestore update

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: activity_transit.xml — add End Trip button

**Files:**
- Modify: `app/src/main/res/layout/activity_transit.xml`

- [ ] **Step 1: Add btnEndTrip below btnStartTrip**

Find the `btnStartTrip` MaterialButton in the XML (around line 357-370). Add this MaterialButton directly after the closing `>` of `btnStartTrip`, still inside the `LinearLayout`:

```xml
<com.google.android.material.button.MaterialButton
    android:id="@+id/btnEndTrip"
    android:layout_width="match_parent"
    android:layout_height="@dimen/btn_height"
    android:layout_marginHorizontal="24dp"
    android:layout_marginTop="12dp"
    android:text="END TRIP"
    android:textColor="@color/white"
    android:textSize="@dimen/text_size_button"
    android:textStyle="bold"
    android:textAllCaps="false"
    android:visibility="gone"
    app:backgroundTint="@color/sysu_green"
    app:cornerRadius="@dimen/corner_radius_button"
    app:elevation="4dp" />
```

Verify `sysu_green` color exists in `colors.xml`. If it does not exist, add it:
```xml
<color name="sysu_green">#00C853</color>
```

Also verify `sysu_red` exists (should already exist):
```xml
<color name="sysu_red">#E53935</color>
```

- [ ] **Step 2: Commit**

```bash
git add app/src/main/res/layout/activity_transit.xml app/src/main/res/values/colors.xml
git commit -m "feat(activity_transit): add End Trip button below Start Trip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Integration test — verify full restart-survive flow

**Files:** None (manual test)

- [ ] **Step 1: Manual verification checklist**

1. Start the app with a driver that has an in-transit trip
2. Verify on TransitActivity screen: subStatus = "Trip in progress", btnStartTrip = "TRIP IN PROGRESS...", btnEndTrip is **visible**
3. Press Home / lock phone (activity destroyed)
4. Re-open the app → TransitActivity
5. Verify: subStatus = "Trip in progress", btnStartTrip = "TRIP IN PROGRESS...", btnEndTrip **visible** (state persisted)
6. Tap END TRIP → confirm dialog appears
7. Tap "End Trip" → Toast "Trip completed!", btnEndTrip **hidden**, btnStartTrip back to "START TRIP" with alpha 1.0
8. Verify Firestore: `tripStatus = "completed"`, `completedAt` is set

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| Persist `currentSapDocId` in SessionManager | Task 1 |
| Restore session state in `onCreate()` | Task 2 |
| Show End Trip button after start | Task 3 |
| End Trip Firestore update (`completed`) | Task 4 |
| Stop location service on end | Task 4 (`stopLocationUpdates()`) |
| Clear session on end | Task 4 (`clearCurrentSapDocId()`) |
| End Trip button in layout | Task 5 |
| End Trip confirm dialog | Task 4 |
| Reset UI to "Ready to start" after end | Task 4 |

---

## Self-Review

- No TBD, TODO, or placeholder steps
- All method names in later tasks match earlier tasks (`stopLocationUpdates()`, `clearCurrentSapDocId()`, etc.)
- `getCurrentSapDocId()` returns `String?` matching `currentSapDocId: String` assignment
- `sysu_green` color assumed to not exist — plan includes adding it to `colors.xml`
- One task (Task 6) is manual test — appropriate for Android UI