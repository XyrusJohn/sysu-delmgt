# Transit Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After guard verifies a shipment (guardVerified=true in Firestore), MainActivity's button icon auto-swaps from QR/Ticket to Map. Tapping the Map icon opens TransitActivity showing trip details, live location, and a Start Trip button.

**Architecture:** New `TransitActivity` + layout. `MainActivity` extends its existing Firestore queue listener to also check `guardVerified` in `sap_assignments`. Icon swap in `updateScanButtonState()`. LocationServices emits to Firestore every 30s; TransitActivity displays the device's last known location.

**Tech Stack:** Kotlin, Android, Firebase Firestore (existing), LocationServices (existing foreground service), Material Design components (existing).

---

## File Structure

| File | Action |
|---|---|
| `app/src/main/res/drawable/ic_map.xml` | Create - Map icon drawable |
| `app/src/main/res/drawable/bg_warning_banner.xml` | Create - Amber/orange warning card background |
| `app/src/main/res/drawable/bg_green_badge.xml` | Create - Green badge background |
| `app/src/main/res/values/colors.xml` | Modify - Add transit_green and transit_amber colors |
| `app/src/main/res/layout/activity_transit.xml` | Create - Full layout as in spec |
| `app/src/main/java/com/sysu/go/activities/TransitActivity.kt` | Create - Activity with data loading, location display, Start Trip |

---

## Task 1: Create Map Icon Drawable

**Files:**
- Create: `app/src/main/res/drawable/ic_map.xml`

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="116dp"
    android:height="116dp"
    android:viewportWidth="116"
    android:viewportHeight="116">
  <path
      android:fillColor="#FFFFFFFF"
      android:strokeColor="#C8102E"
      android:strokeWidth="7"
      android:pathData="M 58, 3.5 a 54.5,54.5 0 1,0 0,109 a 54.5,54.5 0 1,0 0,-109"/>
  <path
      android:fillColor="#FFFFFFFF"
      android:pathData="M 58, 22 C 45.5,22 35.5,31.2 35.5,42.5 C 35.5,57 58,79 58,79 C 58,79 80.5,57 80.5,42.5 C 80.5,31.2 70.5,22 58,22 Z M 58,49.5 C 52.5,49.5 48,45.5 48,40.5 C 48,35.5 52.5,31.5 58,31.5 C 63.5,31.5 68,35.5 68,40.5 C 68,45.5 63.5,49.5 58,49.5 Z"/>
  <path
      android:fillColor="#C8102E"
      android:pathData="M 58, 37.5 a 3,3 0 1,0 0,6 a 3,3 0 1,0 0,-6"/>
</vector>
```

---

## Task 2: Create Background Drawables

**Files:**
- Create: `app/src/main/res/drawable/bg_warning_banner.xml`
- Create: `app/src/main/res/drawable/bg_green_badge.xml`
- Create: `app/src/main/res/drawable/bg_transit_badge.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <corners android:radius="12dp" />
    <solid android:color="#FFF3E0" />
    <padding android:left="16dp" android:top="14dp" android:right="16dp" android:bottom="14dp" />
</shape>
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <corners android:radius="16dp" />
    <solid android:color="#E8F5E9" />
    <padding android:left="12dp" android:top="6dp" android:right="12dp" android:bottom="6dp" />
</shape>
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <corners android:radius="16dp" />
    <solid android:color="#4CAF50" />
    <padding android:left="12dp" android:top="5dp" android:right="12dp" android:bottom="5dp" />
</shape>
```

Also: `app/src/main/res/drawable/bg_status_dot_green.xml` (green status dot):
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="@color/transit_green" />
    <size android:width="6dp" android:height="6dp" />
</shape>
```

---

## Task 3: Add New Color Resources

**Files:**
- Modify: `app/src/main/res/values/colors.xml`

Add after `sysu_gold`:
```xml
    <!-- Transit / Status -->
    <color name="transit_green">#4CAF50</color>
    <color name="transit_green_bg">#E8F5E9</color>
    <color name="transit_amber">#FFF3E0</color>
    <color name="transit_amber_dark">#FF9800</color>
```

---

## Task 4: Create activity_transit.xml Layout

**Files:**
- Create: `app/src/main/res/layout/activity_transit.xml`

Layout structure:
- 72dp fixed header: "My Trip" title + back button
- Red banner (180dp) with animated circles + "TRANSIT" label + live lat/lng + green "Loaded — Ready to Go" badge
- Overlapping white card at y=140dp (overlaps banner bottom) with Shipment Number, Plate No., Truck Type, Helper rows (same structure as QueueDetailsActivity)
- Warning banner card (amber/orange background) with warning text
- "Start Trip" button (red, full width minus 24dp margins, 56dp height)
- NestedScrollView with bottom padding

Key view IDs used in Kotlin:
- `btnBack` (ImageButton)
- `tvLocationCoords` (TextView — shows "Acquiring location..." initially)
- `tvShipmentNumber`, `tvPlateNo`, `tvTruckType`, `tvHelper` (TextViews)
- `btnStartTrip` (MaterialButton)
- `tvSubStatus` (TextView — shows "Ready to start" or "Trip in progress")
- `circleContainer` (FrameLayout for animated circles)

---

## Task 5: Create TransitActivity.kt

**Files:**
- Create: `app/src/main/java/com/sysu/go/activities/TransitActivity.kt`

Key behaviors:
1. On create: start LocationServices foreground service, start FusedLocationClient updates for UI lat/lng
2. `loadTripData()`: query queue (status=loading, driverId match) → get queueDocId → query sap_assignments where driverId=queueDocId → populate all fields
3. `startTrip()`: update sap_assignments.docId with {tripStatus: "in_transit", startedAt: Timestamp.now()} → disable button, change text to "TRIP IN PROGRESS..."
4. Circle animation: identical physics to QueueDetailsActivity (same bounce animation code)
5. `onResume()`: re-check tripStatus from Firestore
6. `currentSapDocId` stored as class property

---

## Task 6: Register TransitActivity in AndroidManifest

**Files:**
- Modify: `app/src/main/AndroidManifest.xml`

Add after the ProfileActivity entry:
```xml
        <activity
            android:name=".activities.TransitActivity"
            android:exported="false"/>
```

---

## Task 7: Modify MainActivity — Guard Verified Detection + Icon Swap

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MainActivity.kt`

Changes:
1. Add `private var isGuardVerified = false`
2. In `listenToQueueStatus()`: when `status == "loading"`, query sap_assignments to get guardVerified flag → store in `isGuardVerified` → call `updateScanButtonState()`
3. In `updateScanButtonState()`: when `isInQueue && isGuardVerified`, show `R.drawable.ic_map` icon (not ticket_1); CTA text changes to "TRANSIT" / "Ready to go!"
4. In `setupUI()` `btnScanQR` click: add condition `if (isInQueue && isGuardVerified) → startActivity(TransitActivity::class.java)`
5. Pulse rings stay active (do NOT stop them on guardVerified)

---

## Self-Review Checklist

- [ ] All spec requirements have a corresponding task
- [ ] No placeholders (TBD, TODO) in any step
- [ ] All method/field names consistent: `guardVerified`, `tripStatus` / `"in_transit"`, `startedAt`, `tvLocationCoords`, `btnStartTrip`
- [ ] TransitActivity uses same circle animation pattern as QueueDetailsActivity
- [ ] MainActivity does NOT stop pulse rings when guard is verified