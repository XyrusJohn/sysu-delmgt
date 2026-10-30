# Transit Screen Design — After Guard Verification

**Date:** 2026-06-04
**Status:** Approved

---

## Overview

After a guard signs and verifies a shipment (guardVerified = true saved to Firestore), the driver's main dashboard automatically transforms — the QR/Ticket icon becomes a Map icon. Tapping the Map icon opens the **Transit screen**, where the driver sees trip details, their live location, and the "Start Trip" button.

---

## Navigation Flow

```
guardVerified = true (saved to Firestore in sap_assignments)
        ↓
MainActivity detects via existing queue SnapshotListener + sap_assignments check
        ↓
QR/ Ticket icon → auto-changes to → Map icon (ic_map drawable)
        ↓
Driver taps Map icon
        ↓
TransitActivity opens (fresh Firestore query)
```

### MainActivity Button State Machine

| Queue Status | guardVerified | Icon | Tap Action |
|---|---|---|---|
| Not in queue | false | QR icon | QRScanActivity |
| waiting/called | false | Ticket icon | QueueDetailsActivity |
| loading | false | Ticket icon | QueueDetailsActivity |
| **loading** | **true** | **Map icon** | **TransitActivity** |

---

## TransitActivity Layout

```
┌─────────────────────────────────┐
│  HEADER: "My Trip"     [← Back] │
├─────────────────────────────────┤
│  RED BANNER                     │
│  ┌───────────────────────────┐ │
│  │  TRANSIT                  │ │ ← Bold, white, centered
│  │  14.5995° N, 120.9842° E  │ │ ← Live lat/lng
│  │  "Loaded — Ready to Go"  🟢│ │ ← Green badge
│  └───────────────────────────┘ │
│         ┌──────────────────┐    │
│         │  OVERLAPPING     │    │ ← White card, 6dp elevation
│         │  details card    │    │
│         └──────────────────┘    │
├─────────────────────────────────┤
│  ┌─────────────────────────────┐│
│  │ SHIPMENT NUMBER  SHP-001   ││
│  │ PLATE NO.       ABC 1234   ││
│  │ TRUCK TYPE      AUV        ││
│  │ HELPER          Pedro S.   ││
│  └─────────────────────────────┘│
│  ┌─────────────────────────────┐│
│  │ ⚠ WHILE ON TRANSIT KEEP    ││ ← Orange/amber warning banner
│  │ YOUR PHONE ACTIVE AND      ││
│  │ CONNECTED TO THE INTERNET. ││
│  └─────────────────────────────┘│
│  ┌─────────────────────────────┐│
│  │   [ START TRIP ]           ││ ← Red button, full width
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

### Layout Details

**Red Banner Section** (180dp tall, sysu_red background, animated circles):
- "TRANSIT" text replaces "QUEUE NUMBER" — same typography style
- Below it: live lat/lng in white, normal weight (`14.5995° N, 120.9842° E` format)
- Green badge pill showing "Loaded — Ready to Go" with a checkmark icon

**Data Card** (overlaps red banner by 24dp, same pattern as QueueDetailsActivity):
- Shipment Number, Plate No., Truck Type, Helper rows — exact same layout XML structure as QueueDetailsActivity's detail rows
- Separated by 1dp divider lines (#EEEEEE)
- 20dp horizontal padding

**Warning Banner**:
- Full-width card, amber/orange background (#FFF3E0 or similar)
- Warning icon (triangle exclamation) + warning text
- 12dp corner radius

**Start Trip Button**:
- Full width minus 48dp horizontal margin
- 56dp height, red background (sysu_red / #c8102e)
- White bold text "START TRIP"
- 12dp corner radius
- Pinned above scrollable content with adequate margin

---

## Data Flow

### MainActivity — Guard Verified Detection

The existing `queueListener` in MainActivity is extended:

```kotlin
// Inside the queue snapshot listener:
if (status == "loading") {
    // Also check sap_assignments for guardVerified
    db.collection("sap_assignments")
        .whereEqualTo("driverId", queueDocId)
        .addSnapshotListener { assignSnap, _ ->
            val guardVerified = assignSnap?.documents?.firstOrNull()
                ?.getBoolean("guardVerified") ?: false
            isGuardVerified = guardVerified
            updateScanButtonState() // swaps icon to map if guardVerified
        }
}
```

### TransitActivity — Data Loading

On `onCreate`, TransitActivity performs a fresh query:

1. Find driver's queue document (status = "loading")
2. Get linked sap_assignments document via `driverId`
3. Populate all UI fields
4. Start location tracking

```kotlin
// Pseudocode
fun loadTripData() {
    // 1. Get queue doc for current driver
    val queueQuery = db.collection("queue")
        .whereEqualTo("driverId", driverId)
        .whereEqualTo("status", "loading")
    
    // 2. From queue doc, get the sap_assignment driverId reference
    // 3. Query sap_assignments for the full trip data
    // 4. Populate: shipment number, plate, truck type, helper, etc.
}
```

### Start Trip Action

```kotlin
btnStartTrip.setOnClickListener {
    // Update Firestore
    sapAssignmentsRef.update(
        "tripStatus" to "in_transit",
        "startedAt" to Timestamp.now()
    )
    
    // Disable button and change text
    btnStartTrip.isEnabled = false
    btnStartTrip.text = "TRIP IN PROGRESS..."
}
```

After this, the shipment is marked as "in_transit". Firestore listeners will keep TransitActivity in sync if reopened.

---

## Location Tracking

- Uses existing `LocationServices` already in the app
- While TransitActivity is active, lat/lng is sent to Firestore `gps_logs` every 30 seconds
- UI lat/lng display = device's last known location (from LocationServices callback)
- Format: `"{lat}° N, {lng}° E"` (positive lat/lng for Philippines)

---

## New/Modified Files

| File | Action | Description |
|---|---|---|
| `TransitActivity.kt` | Create | New activity, loads trip data, Start Trip button handler |
| `activity_transit.xml` | Create | Layout as described above |
| `MainActivity.kt` | Modify | Extended queue listener to check guardVerified, updateScanButtonState() handles map icon swap, btnScanQR opens TransitActivity when guardVerified |
| `ic_map.xml` | Create | New map icon drawable (circle with map pin or similar) |
| `bg_warning_banner.xml` | Create | Amber/orange warning background |
| `bg_green_badge.xml` | Create | Green "Loaded — Ready to Go" pill background |

---

## Implementation Notes

- TransitActivity is only reachable after guardVerified = true, so the guard verification form logic in QueueDetailsActivity is unchanged
- The map icon in MainActivity replaces the QR/ticket icon only — pulse ring animations on the icon remain (they're decorative)
- No bottom navigation bar changes in TransitActivity (the back button returns to MainActivity)
- If driver reopens the app after tapping Start Trip, the button shows "TRIP IN PROGRESS..." (read from Firestore tripStatus field)