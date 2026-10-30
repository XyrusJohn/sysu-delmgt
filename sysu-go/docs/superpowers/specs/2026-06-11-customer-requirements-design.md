# Customer Requirements — Design Spec

## Overview
Add driver-claimed customer/safety requirements (things the driver HAS on their truck/person) to:
- **UpdateInfoActivity** — editable checkboxes (edit screen)
- **ProfileActivity** — read-only chip display (profile overview)

## Requirements Items (driver-claimed equipment)
1. Aircon
2. Reflectorized Vest
3. Safety Shoes
4. Headcap
5. Pants
6. Closed Shoes

## Design Language
- **Design system**: Material Design 3, consistent with existing cancel dialog styling
- **Color**: `sysu_red` (#c8102e) accent for checkmarks/indicators; `#4CAF50` green for filled/good status
- **Typography**: Atkinson Hyperlegible (existing app font), text_size_label for item names
- **Spacing**: 16dp between items, 2-column grid layout (8dp gap)

## ProfileActivity — Read-Only Display

### Layout
Inside the existing **"Truck Information" CardView**, after the "Trucking Company" row:
- Sub-section header: "Customer Requirements" (bold, text_size_body)
- 2-column grid (2 per row) of requirement chips
- Each chip: icon (24dp) + label + filled/empty dot indicator

### Chip States
- **Filled (has it)**: White background, sysu_red icon, green filled circle indicator
- **Empty (not set)**: Light gray background (#F5F5F5), muted icon (#CCCCCC), hollow circle (#CCCCCC)

### Visual
```
┌─────────────────────────────────┐
│ Truck Information               │
│                                 │
│ Trucking Company                │
│ ABC Trucking Inc.               │
│                                 │
│ ─────────────────────────────── │
│ Customer Requirements           │
│                                 │
│ [❄ Aircon         ●]  [🦺 Vest ●]│
│ [👟 Safety Shoes ●]  [🧢 Cap   ●]│
│ [👖 Pants         ●]  [👞 Shoes ●]│
└─────────────────────────────────┘
```
Circles: ● = filled/green, ○ = empty/gray

## UpdateInfoActivity — Editable Checkboxes

### Layout
After the plate number inputs (before submit button area):
- Section header: "Customer Requirements"
- 6 checkboxes in a vertical list (NOT grid — more touch-friendly)
- Each checkbox: vector icon (24dp) + item label, full-width tap target (48dp min height)

### Checkbox Style
- Material Checkbox with custom accent color (sysu_red)
- Icon to the left of label (not inside checkbox)
- Tint color on icon changes between checked (sysu_red) and unchecked (muted gray)

### States
- **Checked**: sysu_red icon + checkbox, label in text_primary
- **Unchecked**: gray icon + hollow checkbox, label in text_muted

## Firestore Field
- Path: `drivers/{driverId}`
- Field: `requirements` (Map<String, Boolean>)
```json
{
  "aircon": true,
  "reflectorizedVest": true,
  "safetyShoes": false,
  "headcap": false,
  "pants": false,
  "closedShoes": true
}
```

## Vector Drawable Icons (24dp, monochrome)
| Item              | Filename            | Visual concept |
|-------------------|---------------------|---------------|
| Aircon            | ic_req_aircon.xml   | Snowflake/wind chevrons |
| Reflectorized Vest | ic_req_vest.xml    | Safety vest silhouette |
| Safety Shoes      | ic_req_safety_shoes.xml | Boot outline |
| Headcap           | ic_req_headcap.xml  | Peaked cap outline |
| Pants             | ic_req_pants.xml    | Simple pants silhouette |
| Closed Shoes      | ic_req_shoes.xml    | Closed shoe outline |

All icons monochrome (currentColor), tint programmatically.

## Files to Create/Modify

### New files
- `app/src/main/res/drawable/ic_req_aircon.xml`
- `app/src/main/res/drawable/ic_req_vest.xml`
- `app/src/main/res/drawable/ic_req_safety_shoes.xml`
- `app/src/main/res/drawable/ic_req_headcap.xml`
- `app/src/main/res/drawable/ic_req_pants.xml`
- `app/src/main/res/drawable/ic_req_shoes.xml`
- `app/src/main/res/layout/item_requirement_edit.xml` (single checkbox row)
- `app/src/main/res/layout/item_requirement_chip.xml` (single read-only chip)

### Modify
- `ProfileActivity.kt` — load and display requirements from Firestore
- `activity_update_info.xml` — add requirement checkboxes container
- `UpdateInfoActivity.kt` — read checkbox state, save to Firestore
- `activity_profile.xml` — add requirements section to Truck Information card

## Implementation Sequence (surgical, incremental)
1. Create all 6 vector icon drawables
2. Create `item_requirement_edit.xml` (checkbox row layout)
3. Create `item_requirement_chip.xml` (chip row layout)
4. Add requirements container to `activity_update_info.xml`
5. Wire up checkboxes in `UpdateInfoActivity.kt`
6. Add requirements section to Truck Information card in `activity_profile.xml`
7. Wire up display in `ProfileActivity.kt`