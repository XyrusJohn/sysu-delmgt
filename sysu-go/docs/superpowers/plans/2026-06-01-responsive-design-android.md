# Responsive Design System — Android Resource Qualifiers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add responsive dimension resources across 3 screen-size buckets (sw360 / baseline / sw600) and replace all hardcoded `dp`/`sp` values in 11 layout files with `@dimen/` references — surgical changes only, zero layout logic changes, zero breaking changes.

**Architecture:** Android resource qualifiers via `values-swNdp/dimens.xml` files. Android automatically picks the correct file based on smallest-screen width. Layouts reference `@dimen/foo` instead of raw numbers so the value adapts without any code changes.

**Tech Stack:** Android resource system only — no Kotlin code, no layout logic changes.

---

## File Map

```
res/values/dimens.xml                    — ADD new dimension names (baseline values)
res/values-sw360dp/dimens.xml            — CREATE (small phones: ≤360dp wide)
res/values-sw600dp/dimens.xml            — CREATE (tablets/foldables: ≥600dp wide)

Layouts to update (hardcoded → @dimen/ references):
  res/layout/activity_main.xml
  res/layout/activity_login.xml
  res/layout/activity_registration.xml
  res/layout/activity_splash.xml
  res/layout/activity_profile.xml
  res/layout/activity_trip_registration.xml
  res/layout/activity_qr_scan.xml
  res/layout/activity_update_info.xml
  res/layout/activity_queue_details.xml
  res/layout/fragment_dashboard.xml
  res/layout/dialog_obd_items.xml
  res/layout/dialog_signature_pad.xml
  res/layout/dialog_guard_verification.xml
  res/layout/bottom_sheet_phone_verify.xml
  res/layout/item_obd_line.xml
  res/layout/item_helper_input.xml
```

**What is NOT touched:** Any `layout_width`, `layout_height`, `match_parent`, `wrap_content`, any view hierarchy, any Kotlin/Java code.

---

## Dimension Names & Values

### Tier A — Spacing (changes per bucket)

| Dimension name | sw360dp | baseline | sw600dp |
|---|---|---|---|
| `screen_padding_horizontal` | 16dp | 28dp | 40dp |
| `screen_padding_vertical` | 16dp | 24dp | 32dp |
| `section_spacing` | 12dp | 18dp | 24dp |
| `card_margin_horizontal` | 16dp | 32dp | 44dp |
| `card_spacing` | 10dp | 16dp | 20dp |
| `form_spacing` | 10dp | 16dp | 20dp |
| `obd_row_height` | 44dp | 50dp | 56dp |
| `obd_header_padding_vert` | 8dp | 10dp | 12dp |
| `obd_header_padding_horiz` | 12dp | 16dp | 20dp |

### Tier B — Text sizes (sp)

| Dimension name | sw360dp | baseline | sw600dp |
|---|---|---|---|
| `text_size_display` | 72sp | 100sp | 120sp |
| `text_size_title_large` | 26sp | 32sp | 40sp |
| `text_size_title` | 18sp | 22sp | 26sp |
| `text_size_subtitle` | 16sp | 20sp | 24sp |
| `text_size_body` | 13sp | 14sp | 16sp |
| `text_size_label` | 12sp | 14sp | 16sp |
| `text_size_caption` | 10sp | 11sp | 12sp |
| `text_size_button` | 14sp | 15sp | 16sp |
| `text_size_headline` | 18sp | 24sp | 28sp |
| `text_size_input` | 13sp | 14sp | 16sp |
| `text_size_tab` | 12sp | 13sp | 14sp |

### Tier C — Structural (fixed across all buckets)

| Dimension name | Value |
|---|---|
| `corner_radius_small` | 8dp |
| `corner_radius_card` | 20dp |
| `corner_radius_pill` | 28dp |
| `corner_radius_button` | 12dp |
| `elevation_card` | 4dp |
| `elevation_floating` | 8dp |
| `elevation_banner` | 0dp |
| `btn_height` | 56dp |
| `input_height` | 56dp |
| `helper_card_height` | 60dp |
| `divider_height` | 1dp |
| `obd_accent_bar_width` | 3dp |
| `obd_red_bar_height` | 3.5dp |
| `drag_handle_width` | 36dp |
| `drag_handle_height` | 4dp |
| `otp_digit_size` | 56dp |
| `banner_height` | 220dp |
| `banner_card_overlap` | 180dp |
| `header_height` | 72dp |
| `count_pill_pad_h` | 10dp |
| `count_pill_pad_v` | 3.5dp |

---

## Tasks

---

### Task 1: Update `values/dimens.xml` — add all dimension names (baseline)

**Files:**
- Modify: `res/values/dimens.xml`

Add all dimension names from the table above to `res/values/dimens.xml`. The file currently has only 8 entries. Write the full updated file with ALL names and their baseline values. Existing values in the file MUST be preserved (the current card_margin_horizontal=32dp, etc. remain as-is — just add the new ones around them).

- [ ] **Step 1: Write updated `res/values/dimens.xml`**

Write the complete file with ALL dimensions — baseline values only. Current entries preserved, all new names added per the Tier A/B/C table above.

---

### Task 2: Create `res/values-sw360dp/dimens.xml` — small phones

**Files:**
- Create: `res/values-sw360dp/dimens.xml`

Write a new file containing ONLY the Tier A and Tier B values from the table (sw360dp column). Omit Tier C — they inherit from the baseline. The file starts with the standard XML header and `<resources>` root.

- [ ] **Step 1: Create `res/values-sw360dp/dimens.xml`**

Write the complete new file with Tier A (sw360dp column) and Tier B (sw360dp column) entries only.

---

### Task 3: Create `res/values-sw600dp/dimens.xml` — tablets/large screens

**Files:**
- Create: `res/values-sw600dp/dimens.xml`

Write a new file containing ONLY the Tier A and Tier B values from the table (sw600dp column). Omit Tier C — they inherit from the baseline.

- [ ] **Step 1: Create `res/values-sw600dp/dimens.xml`**

Write the complete new file with Tier A (sw600dp column) and Tier B (sw600dp column) entries only.

---

### Task 4: Update `activity_main.xml` — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/activity_main.xml`

Replace ALL hardcoded `textSize`, `cardCornerRadius`, `elevation` values with `@dimen/` references per the mapping below. Width/height/layout_width/layout_height are NOT changed.

**Mappings for activity_main.xml:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="17sp"` | `@dimen/text_size_body` |
| `textSize="32sp"` | `@dimen/text_size_title_large` |
| `textSize="14sp"` | `@dimen/text_size_label` |
| `cardCornerRadius="24dp"` | `@dimen/corner_radius_card` |
| `textSize="26sp"` | `@dimen/text_size_subtitle` |
| `textSize="16sp"` | `@dimen/text_size_body` |
| `cardCornerRadius="32dp"` | `@dimen/corner_radius_pill` |
| `textSize="12sp"` | `@dimen/text_size_caption` |
| `cardCornerRadius="28dp"` | `@dimen/corner_radius_pill` |
| `textSize="22sp"` | `@dimen/text_size_subtitle` |
| `textSize="13sp"` | `@dimen/text_size_body` |
| `elevation="8dp"` | `@dimen/elevation_floating` |
| `textSize="18sp"` | `@dimen/text_size_title` |
| `textSize="15sp"` | `@dimen/text_size_button` |
| `elevation="12dp"` | `@dimen/elevation_floating` |

- [ ] **Step 1: Replace `textSize="17sp"` with `@dimen/text_size_body`**
- [ ] **Step 2: Replace `textSize="32sp"` with `@dimen/text_size_title_large`**
- [ ] **Step 3: Replace all `textSize="14sp"` with `@dimen/text_size_label`**
- [ ] **Step 4: Replace all `cardCornerRadius="24dp"` with `@dimen/corner_radius_card`**
- [ ] **Step 5: Replace `textSize="26sp"` with `@dimen/text_size_subtitle`**
- [ ] **Step 6: Replace all `textSize="16sp"` with `@dimen/text_size_body`**
- [ ] **Step 7: Replace `cardCornerRadius="32dp"` with `@dimen/corner_radius_pill`**
- [ ] **Step 8: Replace all `textSize="12sp"` with `@dimen/text_size_caption`**
- [ ] **Step 9: Replace `cardCornerRadius="28dp"` with `@dimen/corner_radius_pill`**
- [ ] **Step 10: Replace `textSize="22sp"` with `@dimen/text_size_subtitle`**
- [ ] **Step 11: Replace `textSize="13sp"` with `@dimen/text_size_body`**
- [ ] **Step 12: Replace all `elevation="8dp"` with `@dimen/elevation_floating`**
- [ ] **Step 13: Replace `textSize="18sp"` with `@dimen/text_size_title`**
- [ ] **Step 14: Replace `textSize="15sp"` with `@dimen/text_size_button`**
- [ ] **Step 15: Replace `elevation="12dp"` with `@dimen/elevation_floating`**

---

### Task 5: Update `activity_registration.xml` — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/activity_registration.xml`

**Mappings for activity_registration.xml:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `padding="24dp"` | `@dimen/screen_padding_horizontal` |
| `textSize="42sp"` | `@dimen/text_size_display` |
| `textSize="14sp"` | `@dimen/text_size_body` |
| `marginTop="48dp"` | `@dimen/section_spacing` |
| `marginTop="24dp"` | `@dimen/form_spacing` |
| `marginTop="32dp"` | `@dimen/section_spacing` |
| `textSize="12sp"` | `@dimen/text_size_caption` |
| `textSize="18sp"` | `@dimen/text_size_title` |
| `textSize="28sp"` | `@dimen/text_size_headline` |
| `textSize="26sp"` | `@dimen/text_size_subtitle` |

- [ ] **Step 1: Replace `padding="24dp"` with `@dimen/screen_padding_horizontal`**
- [ ] **Step 2: Replace `textSize="42sp"` (queue number) with `@dimen/text_size_display`**
- [ ] **Step 3: Replace all `textSize="14sp"` with `@dimen/text_size_body`**
- [ ] **Step 4: Replace `marginTop="48dp"` with `@dimen/section_spacing`**
- [ ] **Step 5: Replace `marginTop="24dp"` with `@dimen/form_spacing`**
- [ ] **Step 6: Replace `marginTop="32dp"` with `@dimen/section_spacing`**
- [ ] **Step 7: Replace all `textSize="12sp"` with `@dimen/text_size_caption`**
- [ ] **Step 8: Replace all `textSize="18sp"` with `@dimen/text_size_title`**
- [ ] **Step 9: Replace all `textSize="28sp"` with `@dimen/text_size_headline`**
- [ ] **Step 10: Replace all `textSize="26sp"` with `@dimen/text_size_subtitle`**

---

### Task 6: Update `activity_login.xml` — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/activity_login.xml`

**Mappings for activity_login.xml:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `padding="24dp"` | `@dimen/screen_padding_horizontal` |
| `textSize="24sp"` | `@dimen/text_size_headline` |
| `textSize="18sp"` | `@dimen/text_size_title` |
| `padding="8dp"` (inner) | `@dimen/card_spacing` |

- [ ] **Step 1: Replace `padding="24dp"` with `@dimen/screen_padding_horizontal`**
- [ ] **Step 2: Replace `textSize="24sp"` with `@dimen/text_size_headline`**
- [ ] **Step 3: Replace `textSize="18sp"` with `@dimen/text_size_title`**
- [ ] **Step 4: Replace inner `padding="8dp"` with `@dimen/card_spacing`**

---

### Task 7: Update `activity_profile.xml` — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/activity_profile.xml`

**Mappings for activity_profile.xml:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="20sp"` | `@dimen/text_size_title` |
| `textSize="28sp"` | `@dimen/text_size_headline` |
| `textSize="12sp"` | `@dimen/text_size_caption` |
| `cardCornerRadius="24dp"` | `@dimen/corner_radius_card` |
| `textSize="16sp"` | `@dimen/text_size_body` |
| `textSize="14sp"` | `@dimen/text_size_label` |

- [ ] **Step 1: Replace `textSize="20sp"` with `@dimen/text_size_title`**
- [ ] **Step 2: Replace `textSize="28sp"` with `@dimen/text_size_headline`**
- [ ] **Step 3: Replace all `textSize="12sp"` with `@dimen/text_size_caption`**
- [ ] **Step 4: Replace all `cardCornerRadius="24dp"` with `@dimen/corner_radius_card`**
- [ ] **Step 5: Replace all `textSize="16sp"` with `@dimen/text_size_body`**
- [ ] **Step 6: Replace all `textSize="14sp"` with `@dimen/text_size_label`**

---

### Task 8: Update `activity_trip_registration.xml` — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/activity_trip_registration.xml`

**Mappings for activity_trip_registration.xml:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="28sp"` | `@dimen/text_size_headline` |
| `textSize="14sp"` | `@dimen/text_size_body` |
| `textSize="18sp"` | `@dimen/text_size_title` |
| `textSize="15sp"` | `@dimen/text_size_label` |
| `textSize="26sp"` | `@dimen/text_size_subtitle` |
| `textSize="17sp"` | `@dimen/text_size_body` |
| `elevation="8dp"` | `@dimen/elevation_floating` |

- [ ] **Step 1: Replace all `textSize="28sp"` with `@dimen/text_size_headline`**
- [ ] **Step 2: Replace all `textSize="14sp"` with `@dimen/text_size_body`**
- [ ] **Step 3: Replace all `textSize="18sp"` with `@dimen/text_size_title`**
- [ ] **Step 4: Replace all `textSize="15sp"` with `@dimen/text_size_label`**
- [ ] **Step 5: Replace all `textSize="26sp"` with `@dimen/text_size_subtitle`**
- [ ] **Step 6: Replace `textSize="17sp"` with `@dimen/text_size_body`**
- [ ] **Step 7: Replace `elevation="8dp"` with `@dimen/elevation_floating`**

---

### Task 9: Update `fragment_dashboard.xml` — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/fragment_dashboard.xml`

**Mappings for fragment_dashboard.xml:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `padding="28dp"` | `@dimen/screen_padding_horizontal` |
| `textSize="24sp"` | `@dimen/text_size_headline` |
| `textSize="18sp"` | `@dimen/text_size_title` |
| `padding="8dp"` | `@dimen/card_spacing` |

- [ ] **Step 1: Replace `padding="28dp"` with `@dimen/screen_padding_horizontal`**
- [ ] **Step 2: Replace `textSize="24sp"` with `@dimen/text_size_headline`**
- [ ] **Step 3: Replace `textSize="18sp"` with `@dimen/text_size_title`**
- [ ] **Step 4: Replace `padding="8dp"` with `@dimen/card_spacing`**

---

### Task 10: Update remaining layout files (small audit-driven edits)

**Files:**
- Modify: `res/layout/activity_splash.xml` (no hardcoded sp/dp found — skip)
- Modify: `res/layout/activity_qr_scan.xml`
- Modify: `res/layout/activity_update_info.xml`

**activity_qr_scan.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="18sp"` | `@dimen/text_size_title` |
| `textSize="16sp"` | `@dimen/text_size_body` |

**activity_update_info.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="24sp"` | `@dimen/text_size_headline` |
| `textSize="14sp"` | `@dimen/text_size_body` |
| `textSize="16sp"` | `@dimen/text_size_body` |
| `textSize="13sp"` | `@dimen/text_size_body` |

- [ ] **Step 1 (qr_scan): Replace `textSize="18sp"` with `@dimen/text_size_title`**
- [ ] **Step 2 (qr_scan): Replace `textSize="16sp"` with `@dimen/text_size_body`**
- [ ] **Step 3 (update_info): Replace `textSize="24sp"` with `@dimen/text_size_headline`**
- [ ] **Step 4 (update_info): Replace all `textSize="14sp"` with `@dimen/text_size_body`**
- [ ] **Step 5 (update_info): Replace all `textSize="16sp"` with `@dimen/text_size_body`**
- [ ] **Step 6 (update_info): Replace all `textSize="13sp"` with `@dimen/text_size_body`**

---

### Task 11: Update `activity_queue_details.xml` — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/activity_queue_details.xml`

This file was already updated in earlier work. Only a few hardcoded values may remain. Replace these if found:

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `paddingHorizontal="16dp"` | `@dimen/obd_header_padding_horiz` |
| `paddingVertical="14dp"` | `@dimen/obd_header_padding_vert` |
| `textSize="15sp"` | `@dimen/text_size_title` |
| `textSize="10sp"` | `@dimen/text_size_caption` |
| `cardCornerRadius="16dp"` | `@dimen/corner_radius_card` |
| `elevation="3dp"` | `@dimen/elevation_card` |
| `cardCornerRadius="28dp"` (floating pill) | `@dimen/corner_radius_pill` |
| `elevation="8dp"` (floating pill) | `@dimen/elevation_floating` |

- [ ] **Step 1: Replace all `textSize="15sp"` with `@dimen/text_size_title`**
- [ ] **Step 2: Replace all `textSize="10sp"` with `@dimen/text_size_caption`**
- [ ] **Step 3: Replace all `cardCornerRadius="16dp"` with `@dimen/corner_radius_card`**
- [ ] **Step 4: Replace all `cardCornerRadius="28dp"` with `@dimen/corner_radius_pill`**
- [ ] **Step 5: Replace all `elevation="3dp"` with `@dimen/elevation_card`**
- [ ] **Step 6: Replace all `elevation="8dp"` with `@dimen/elevation_floating`**

---

### Task 12: Update dialog and bottom sheet layouts — replace hardcoded dimensions

**Files:**
- Modify: `res/layout/dialog_obd_items.xml`
- Modify: `res/layout/dialog_signature_pad.xml`
- Modify: `res/layout/dialog_guard_verification.xml`
- Modify: `res/layout/bottom_sheet_phone_verify.xml`
- Modify: `res/layout/item_obd_line.xml`

**dialog_obd_items.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="16sp"` | `@dimen/text_size_title` |
| `textSize="11sp"` | `@dimen/text_size_caption` |
| `cardCornerRadius="14dp"` | `@dimen/corner_radius_small` |
| `textSize="10sp"` (column headers) | `@dimen/text_size_caption` |
| `textSize="14sp"` (empty state) | `@dimen/text_size_body` |

**dialog_signature_pad.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `layout_height="4dp"` (drag handle) | `@dimen/drag_handle_height` |
| `textSize="20sp"` | `@dimen/text_size_title` |
| `textSize="13sp"` | `@dimen/text_size_body` |
| `cardCornerRadius="12dp"` | `@dimen/corner_radius_button` |
| `layout_height="1dp"` | `@dimen/divider_height` |
| `textSize="12sp"` | `@dimen/text_size_caption` |

**item_obd_line.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="11.5sp"` | `@dimen/text_size_caption` |
| `textSize="10sp"` | `@dimen/text_size_caption` |

**item_helper_input.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="14sp"` | `@dimen/text_size_label` |
| `textSize="16sp"` | `@dimen/text_size_body` |

**dialog_guard_verification.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="12sp"` | `@dimen/text_size_caption` |
| `layout_height="1dp"` | `@dimen/divider_height` |
| `textSize="18sp"` | `@dimen/text_size_title` |
| `cardCornerRadius="8dp"` | `@dimen/corner_radius_small` |
| `textSize="14sp"` | `@dimen/text_size_label` |

**bottom_sheet_phone_verify.xml mappings:**

| Hardcoded value | Use `@dimen/name` |
|---|---|
| `textSize="22sp"` | `@dimen/text_size_headline` |
| `textSize="13sp"` | `@dimen/text_size_body` |

- [ ] **Step 1 (dialog_obd_items): Replace `textSize="16sp"` with `@dimen/text_size_title`**
- [ ] **Step 2 (dialog_obd_items): Replace `textSize="11sp"` column headers with `@dimen/text_size_caption`**
- [ ] **Step 3 (dialog_obd_items): Replace `textSize="10sp"` column headers with `@dimen/text_size_caption`**
- [ ] **Step 4 (dialog_obd_items): Replace `textSize="14sp"` empty state with `@dimen/text_size_body`**
- [ ] **Step 5 (dialog_signature_pad): Replace `textSize="20sp"` with `@dimen/text_size_title`**
- [ ] **Step 6 (dialog_signature_pad): Replace `textSize="13sp"` with `@dimen/text_size_body`**
- [ ] **Step 7 (dialog_signature_pad): Replace `textSize="12sp"` (confirm button) with `@dimen/text_size_caption`**
- [ ] **Step 8 (dialog_guard_verification): Replace `textSize="12sp"` with `@dimen/text_size_caption`**
- [ ] **Step 9 (dialog_guard_verification): Replace `textSize="18sp"` with `@dimen/text_size_title`**
- [ ] **Step 10 (dialog_guard_verification): Replace `cardCornerRadius="8dp"` with `@dimen/corner_radius_small`**
- [ ] **Step 11 (dialog_guard_verification): Replace `textSize="14sp"` with `@dimen/text_size_label`**
- [ ] **Step 12 (bottom_sheet_phone_verify): Replace `textSize="22sp"` with `@dimen/text_size_headline`**
- [ ] **Step 13 (bottom_sheet_phone_verify): Replace `textSize="13sp"` with `@dimen/text_size_body`**
- [ ] **Step 14 (item_obd_line): Replace `textSize="11.5sp"` with `@dimen/text_size_caption`**
- [ ] **Step 15 (item_obd_line): Replace `textSize="10sp"` with `@dimen/text_size_caption`**
- [ ] **Step 16 (item_helper_input): Replace `textSize="14sp"` with `@dimen/text_size_label`**
- [ ] **Step 17 (item_helper_input): Replace `textSize="16sp"` with `@dimen/text_size_body`**

---

### Task 13: Final audit — verify all `@dimen/` references resolve

**Files:**
- Read all updated layout files

Confirm that all `@dimen/` references used in the layout files actually exist in `res/values/dimens.xml`. Flag any that reference a name not defined in the dimens file and add the missing name.

- [ ] **Step 1: Grep all `@dimen/` references across all layout files**

Command: `grep -rho "@dimen/[a-z_]*" res/layout/` and collect unique names.

- [ ] **Step 2: Compare against all names defined in `values/dimens.xml`**

If any reference is not in the dimens file — add it to `values/dimens.xml` with baseline value.

- [ ] **Step 3: Build verification**

Build the app (or at minimum verify resource merge passes) to confirm all references resolve.

---

## Self-Review Checklist

- [ ] All 3 bucket files created with correct tier assignments
- [ ] Baseline file (values/dimens.xml) has ALL dimen names + values
- [ ] No layout_width or layout_height changed
- [ ] No view hierarchy changed
- [ ] No Kotlin/Java code changed
- [ ] No logic changes — only raw number → `@dimen/name` substitution
- [ ] activity_splash.xml confirmed to have no hardcoded sp/dp values
- [ ] All `@dimen/` references in layouts resolve to a defined name