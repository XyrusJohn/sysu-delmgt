# Responsive Design System — Android Resource Qualifiers

**Date:** 2026-06-01
**Status:** Draft

---

## 1. Problem Statement

The app's layouts use hardcoded dimension values (`dp` and `sp`) throughout. On small phones, content can overflow, text can clip, and margins can be too generous. On large phones and tablets, layouts can feel stretched or sparse. No responsive resource system exists.

**Requirement:** Make the app usable and visually sound across all phone screen sizes — small to large — without breaking any existing functions. Surgical insertion only.

---

## 2. Mechanism

Android has no CSS media queries. It uses **resource qualifiers** — alternate resource files Android selects automatically based on device configuration. When a dimension name exists in multiple `values-*` folders, Android uses the one that best matches the device's smallest-width (`sw`).

**Qualified folders to create:**

| Folder | Triggers on |
|---|---|
| `values-sw360dp/` | screens ≤ 360dp wide |
| `values/` (baseline) | screens 361dp – 599dp wide |
| `values-sw600dp/` | screens ≥ 600dp wide (tablets, foldables) |

All existing hardcoded `dp`/`sp` values in layouts will be replaced with dimension resource references (`@dimen/foo`). No layout logic changes. No Kotlin/Java changes.

---

## 3. Scope — What Changes and What Doesn't

### What DOES change
- New `values-sw360dp/dimens.xml` — condensed spacing and text for small phones
- New `values-sw600dp/dimens.xml` — expanded spacing for tablets
- Updated `values/dimens.xml` — central reference for all dimension names
- Layout XML files — replace hardcoded `dp`/`sp` with `@dimen/foo` references

### What DOES NOT change
- Any `wrap_content` / `match_parent` / `0dp` (match_constraints) — these already adapt
- Colors, drawables, styles
- Any Java or Kotlin code
- Any layout logic (views, hierarchy, constraints)
- Any bottom sheet or dialog layouts already handled

---

## 4. Dimension Taxonomy

All dimensions are classified into one of three tiers:

### Tier A — Condense on small, expand on large (primary targets)
These need adaptation because they directly affect whether content fits:

| Dimin name | sw360dp | baseline (values/) | sw600dp |
|---|---|---|---|
| `card_margin_horizontal` | 16dp | 32dp | 40dp |
| `card_corner_radius` | 16dp | 20dp | 24dp |
| `card_elevation` | 3dp | 4dp | 6dp |
| `card_spacing` | 12dp | 16dp | 20dp |
| `screen_padding_horizontal` | 16dp | 28dp | 40dp |
| `screen_padding_vertical` | 16dp | 24dp | 32dp |
| `section_spacing` | 16dp | 24dp | 32dp |
| `obd_row_height` | 44dp | 50dp | 56dp |
| `obd_col_header_padding_vert` | 8dp | 10dp | 12dp |

### Tier B — Text sizes (sp, for accessibility/screen-fitting)
Font sizes shrink on small screens but grow slightly on large:

| Dimin name | sw360dp | baseline | sw600dp |
|---|---|---|---|
| `text_size_headline` | 20sp | 24sp | 28sp |
| `text_size_title` | 16sp | 18sp | 22sp |
| `text_size_body` | 13sp | 14sp | 16sp |
| `text_size_caption` | 10sp | 11sp | 12sp |
| `text_size_button` | 14sp | 15sp | 16sp |
| `text_size_queue_number` | 72sp | 100sp | 120sp |
| `text_size_obd_number` | 10sp | 11.5sp | 13sp |
| `text_size_obd_customer` | 9sp | 10sp | 11sp |

### Tier C — Structural dimensions (mostly fixed)
These stay constant across buckets:

| Dimin name | Value |
|---|---|
| `obd_padding_horizontal` | 16dp |
| `obd_empty_padding` | 24dp |
| `obd_count_pill_padding_h` | 10dp |
| `obd_count_pill_padding_v` | 3.5dp |
| `banner_height` | 220dp |
| `card_banner_overlap` | 180dp |
| `header_height` | 72dp |
| `fab_height` | 56dp |

---

## 5. Implementation Inventory

### 5.1 Dimension Files

**`app/src/main/res/values/dimens.xml` (baseline — current values plus all missing names)**

Add all new dimension entries. Existing values stay as-is.

**`app/src/main/res/values-sw360dp/dimens.xml` (small phones)**

Only the Tier A and Tier B values listed above. Omit Tier C (they inherit from baseline).

**`app/src/main/res/values-sw600dp/dimens.xml` (large screens/tablets)**

Only the Tier A and Tier B values listed above. Omit Tier C.

### 5.2 Layout Files to Update

Only layouts with hardcoded spacing/padding/textSize values that are NOT already using `@dimen/...` references:

| Layout | Changes needed |
|---|---|
| `activity_queue_details.xml` | Replace 24px+ hardcoded margins, padding, text sizes |
| `activity_main.xml` | Replace card margin, button padding, large text sizes |
| `activity_login.xml` | Replace horizontal margins, button sizes, logo sizing |
| `activity_registration.xml` | Replace form margin, field padding, button sizes |
| `activity_splash.xml` | Replace logo sizing, text sizes |
| `activity_profile.xml` | Replace card/button dimensions |
| `activity_trip_registration.xml` | Replace form layout dimensions |
| `fragment_dashboard.xml` | Replace stat card sizes, padding |
| `dialog_obd_items.xml` | Replace card margins, padding, text sizes |
| `dialog_signature_pad.xml` | Replace canvas dimensions, text sizes |
| `dialog_guard_verification.xml` | Replace spacing, text sizes |

Layouts that are likely already safe (mostly dynamic: `spinner_truck_type.xml`, `dropdown_truck_company_item.xml`, `item_obd_line.xml`, `item_helper_input.xml`, `bottom_sheet_phone_verify.xml`).

> **Note:** Bottom sheet layouts (`dialog_*.xml`) are used inside `BottomSheetDialogFragment` which has its own window/behavior. They may not need the same level of adaptation. Will assess per-file during implementation.

### 5.3 Values Not Modified

- `colors.xml` — no changes needed
- `strings.xml` — no changes needed
- `themes.xml` / `styles.xml` — no structural changes

---

## 6. Surgical Rules

To ensure zero breakage:

1. **Never change a view's layout_width or layout_height** — only margin, padding, textSize, and elevation
2. **Never remove a view** — only change its sizing
3. **Never change layout hierarchy** — constraint relationships stay intact
4. **Use dimension references only where hardcoded values existed** — `wrap_content` stays `wrap_content`
5. **Test on sw360 (small), sw400 (mid-small), sw480 (large mid-range) conceptually** — ensure no content overflow

---

## 7. Out of Scope

- Dark mode adaptation (already exists separately in `values-night/`)
- Tablet-specific layouts (`layout-sw600dp/`) — full layouts, not just dimension overrides
- Localization (`values-*/strings.xml`)
- Refactoring layouts to ConstraintLayout purely for responsive reasons

---

## 8. Success Criteria

- [ ] Small phone (sw360): no content clipped, no overflow, readable text
- [ ] Large phone (sw480+): layout uses available space, not cramped
- [ ] Tablet (sw600+): content centered/filled appropriately, not sparse
- [ ] Zero runtime crashes caused by dimension changes
- [ ] Zero layout logic changes — only sizing