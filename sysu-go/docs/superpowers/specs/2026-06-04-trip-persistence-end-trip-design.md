# Trip Persistence + End Trip Flow — Design

**Date:** 2026-06-04
**Status:** Approved

---

## Context

After driver taps **START TRIP**, `isTripStarted` is set to `true` in memory only. If the activity is destroyed (phone locked, app backgrounded, crash), `isTripStarted` resets to `false` on next launch even though Firestore still shows `tripStatus: "in_transit"`. The driver sees `START TRIP` again and can potentially double-start a trip.

Additionally, there is no End Trip functionality — `btnStartTrip` becomes "TRIP IN PROGRESS..." with no way to mark the trip complete in the app.

---

## Goals

1. **Persisted trip state** survives activity restart
2. **End Trip flow** that marks the trip as `completed` in Firestore
3. Minimal, surgical changes — only three files touch

---

## Approach

### SessionManager — persist the active SAP document ID

**File:** `app/src/main/java/com/sysu/go/utils/SessionManager.kt`

Three new methods:

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

`saveCurrentSapDocId` is called in `startTrip()` after the Firestore update succeeds.

`getCurrentSapDocId` is read in `onCreate()` to restore state.

`clearCurrentSapDocId` is called after `endTrip()` completes.

---

### TransitActivity — restore state on create

**File:** `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

In `onCreate()`, right before `setupUI()`:

```kotlin
val savedDocId = sessionManager.getCurrentSapDocId()
if (savedDocId != null) {
    currentSapDocId = savedDocId
    isTripStarted = true
    binding.tvSubStatus.text = "Trip in progress"
    // button state restored by setupUI() detecting isTripStarted = true
}
```

The `loadTripData()` still runs as normal. When it calls `populateShipmentUI()`, all four data fields populate correctly. The only new behavior is that `isTripStarted = true` causes `setupUI()` to render the button in the "TRIP IN PROGRESS..." state instead of "START TRIP".

The `setupUI()` click handler already guards against double-tap via `isTripStarted` check:

```kotlin
binding.btnStartTrip.setOnClickListener {
    if (isTripStarted) return@setOnClickListener
    startTrip()
}
```

---

### End Trip — one-tap with confirm dialog

**File:** `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

New `endTrip()` function:

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

Wiring in `setupUI()` — `btnEndTrip` only becomes clickable after trip starts:

```kotlin
binding.btnEndTrip.setOnClickListener {
    if (!isTripStarted) return@setOnClickListener
    endTrip()
}
```

---

### End Trip button in layout

**File:** `app/src/main/res/layout/activity_transit.xml`

Add `MaterialButton` with id `btnEndTrip` below `btnStartTrip`, inside the scroll content:

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

State changes after `startTrip()` succeeds:

```kotlin
// Inside startTrip() success listener, add:
sessionManager.saveCurrentSapDocId(currentSapDocId)
binding.btnEndTrip.visibility = View.VISIBLE
```

---

## State Machine

| State | Button Start | Button End | tvSubStatus |
|-------|-------------|------------|-------------|
| Trip not started | "START TRIP" (red, enabled) | hidden | "Ready to start" |
| Trip in progress | "TRIP IN PROGRESS..." (red, disabled, alpha 0.6) | "END TRIP" (green, visible) | "Trip in progress" |
| Trip ending (pending Firestore) | disabled | disabled | "Trip in progress" |
| Trip completed | back to not started | hidden | back to "Ready to start" |

---

## Files Changed

| File | Changes |
|------|---------|
| `SessionManager.kt` | +`saveCurrentSapDocId`, `getCurrentSapDocId`, `clearCurrentSapDocId` |
| `TransitActivity.kt` | Restore state in `onCreate`, +`endTrip()`, +`stopLocationUpdates()`, wire End Trip button |
| `activity_transit.xml` | +`btnEndTrip` MaterialButton below `btnStartTrip` |

---

## What This Does NOT Cover

- Pre-trip checklist before Start Trip
- Live trip progress UI (timer, distance)
- Delivery confirmation / proof of delivery
- Incident reporting
- Any backend changes (assumes Firestore `completedAt` field is acceptable as-is)