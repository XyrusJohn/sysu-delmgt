# Responsive UI/UX System — Implementation Plan

## Context
The Sysu Go app needs a complete responsive design system so fonts and spacing scale properly across all phone sizes — from compact (5.4" phones) to small tablets (600dp+). Currently 159 hardcoded dimension values exist across all layouts; nothing scales. The existing `values-sw360dp/dimens.xml` and `values-sw600dp/dimens.xml` have partial coverage for Tier A (spacing), but Tier B (text sizes) only exists in the default file.

---

## Audit Results
| Category | Count | Files |
|---|---|---|
| Hardcoded `textSize` | 28 | login, registration, queue_details, trip_registration, phone_verify, obd_line, spinner_truck_type |
| Hardcoded `padding/paddingH/paddingV` | 48 | activity_main, login, registration, profile, queue_details, qrd_scan, trip_registration, guard_verification, obd_items, phone_verify |
| Hardcoded `layout_margin*` | 71 | all layouts |
| Hardcoded `cornerRadius` | 9 | login, registration, queue_details, profile, trip_registration, signature_pad, phone_verify |
| Hardcoded `elevation` | 3 | main, registration, queue_details |

---

## Design Direction
**Newspaper Editorial meets Modern Fleet Dashboard.** Bacasime Antique (vintage serif) for display and headline text gives authoritative, journalistic weight. Atkinson Hyperlegible (accessibility-optimized) for all body and label text ensures readability for drivers of all ages. Clean geometric spacing in pure dp — no single hardcoded px everywhere.

### Font Scale (sp, linear interpolation across breakpoints)
| Variable | sw360dp | default | sw400dp | sw480dp | sw600dp |
|---|---|---|---|---|---|
| `text_size_display` | 32sp | 40sp | 46sp | 52sp | 58sp |
| `text_size_title_large` | 24sp | 32sp | 36sp | 40sp | 44sp |
| `text_size_headline` | 18sp | 24sp | 26sp | 28sp | 32sp |
| `text_size_title` | 16sp | 22sp | 24sp | 26sp | 28sp |
| `text_size_subtitle` | 14sp | 20sp | 22sp | 24sp | 26sp |
| `text_size_body` | 12sp | 14sp | 15sp | 16sp | 18sp |
| `text_size_label` | 11sp | 13sp | 14sp | 15sp | 16sp |
| `text_size_caption` | 9sp | 11sp | 12sp | 12sp | 14sp |
| `text_size_button` | 13sp | 15sp | 16sp | 16sp | 17sp |
| `text_size_input` | 12sp | 14sp | 15sp | 16sp | 17sp |
| `text_size_tab` | 11sp | 13sp | 14sp | 14sp | 15sp |

### Structural Spacing Scale (dp, non-linear for tactile feel)
| Variable | sw360dp | default | sw400dp | sw480dp | sw600dp |
|---|---|---|---|---|---|
| `screen_padding_horizontal` | 16dp | 28dp | 32dp | 36dp | 44dp |
| `screen_padding_vertical` | 16dp | 24dp | 28dp | 32dp | 40dp |
| `section_spacing` | 12dp | 18dp | 22dp | 24dp | 28dp |
| `card_margin_horizontal` | 16dp | 32dp | 38dp | 44dp | 56dp |
| `card_spacing` | 8dp | 16dp | 18dp | 20dp | 24dp |
| `form_spacing` | 10dp | 16dp | 18dp | 20dp | 24dp |
| `obd_row_height` | 44dp | 50dp | 54dp | 56dp | 64dp |
| `obd_header_padding_vert` | 8dp | 10dp | 12dp | 14dp | 14dp |
| `obd_header_padding_horiz` | 12dp | 16dp | 18dp | 20dp | 24dp |
| `card_corner_radius` | 16dp | 20dp | 22dp | 24dp | 28dp |
| `corner_radius_small` | 6dp | 8dp | 8dp | 10dp | 12dp |
| `corner_radius_button` | 10dp | 12dp | 12dp | 14dp | 16dp |
| `topbar_height` | 56dp | 64dp | 64dp | 68dp | 72dp |
| `banner_height` | 170dp | 220dp | 240dp | 260dp | 280dp |
| `banner_card_overlap` | 130dp | 180dp | 200dp | 220dp | 240dp |
| `header_height` | 56dp | 72dp | 72dp | 80dp | 84dp |
| `btn_height` | 48dp | 56dp | 56dp | 60dp | 64dp |
| `input_height` | 48dp | 56dp | 56dp | 60dp | 64dp |
| `helper_card_height` | 52dp | 60dp | 64dp | 68dp | 72dp |

---

## Implementation Steps

### Step 1 — Create `values-sw400dp/dimens.xml` and `values-sw480dp/dimens.xml`
New intermediate breakpoint files. Every variable in the above two tables goes in here (values-sw400dp and values-sw480dp contain FULL overrides — NOT incremental). Place after the Tier A and Tier B section headers with same structure as existing files.

### Step 2 — Update `values/dimens.xml` (default)
- Add 12 missing structural dimension names (topbar_height, banner_card_overlap, etc.) with current numeric baseline values
- Fix `text_size_display` from 100sp → 40sp (100sp was a ridiculous outlier; 40sp is right for a display headline)

### Step 3 — Update `values-sw360dp/dimens.xml`
- Add the new structural dimensions (topbar_height, corner_radius_small, etc.) with compact-phone values since sw360dp currently only has the shared Tier A and Tier B names

### Step 4 — Update `values-sw600dp/dimens.xml`
- Add the new structural dimensions with tablet-scale values (already has text sizes)

### Step 5 — Extend `values/styles.xml` with full TextAppearances
New styles covering all 10 text size levels using the corresponding `@dimen/text_size_X` variable (not hardcoded sp):
```
TextAppearance.Sysu.Display    — @font/bacasime_antique, @dimen/text_size_display
TextAppearance.Sysu.Headline  — @font/bacasime_antique, @dimen/text_size_headline
TextAppearance.Sysu.Title     — @font/atkinson_hyperlegible_bold, @dimen/text_size_title
TextAppearance.Sysu.TitleLarge— @font/atkinson_hyperlegible_bold, @dimen/text_size_title_large
TextAppearance.Sysu.Subtitle  — @font/atkinson_hyperlegible_bold, @dimen/text_size_subtitle
TextAppearance.Sysu.Body      — @font/atkinson_hyperlegible_regular, @dimen/text_size_body
TextAppearance.Sysu.Label     — @font/atkinson_hyperlegible_bold, @dimen/text_size_label
TextAppearance.Sysu.Caption   — @font/atkinson_hyperlegible_regular, @dimen/text_size_caption
TextAppearance.Sysu.Button    — @font/atkinson_hyperlegible_bold, @dimen/text_size_button
TextAppearance.Sysu.Input     — @font/atkinson_hyperlegible_regular, @dimen/text_size_input
```
Existing CTA styles (CTA.Header, CTA.Body, CTA.StatusPill) remain but their sizes are updated to reference `@dimen/text_size_label` / `@dimen/text_size_caption`.

### Step 6 — Batch-update all layout files (28 text sizes first)
Per-file targeted replacements:
- `activity_login.xml` — update 8 `android:textSize="12/14sp"` to `@dimen/text_size_label` and `@dimen/text_size_input`; add `android:textAppearance="@style/TextAppearance.Sysu.Body"` where missing
- `activity_registration.xml` — update 18 `android:textSize="13/15sp"` → `@dimen/text_size_label` / `@dimen/text_size_button`
- `activity_queue_details.xml` — update 11 hardcoded textSize values (100sp display, 20sp headline, etc.)
- `activity_trip_registration.xml` — update 1 textSize
- `bottom_sheet_phone_verify.xml` — update 4 textSize values
- `activity_main.xml` — update any inline textSize on custom views not using @dimen
- `item_obd_line.xml` — update 3 textSize values (11.5sp, 10sp) → `@dimen/text_size_caption`
- `spinner_truck_type.xml` — update 1 textSize; also add missing `android:textAppearance`
- `dropdown_truck_company_item.xml` — update 1 textSize; add `android:textAppearance`

After text sizes, batch-replace spacing values in high-priority layout files:
- `activity_main.xml` — update paddingHorizontal (28dp → @dimen/screen_padding_horizontal), hardcoded spacing in card layouts
- `activity_login.xml` — screen-level padding
- `activity_registration.xml` — form field paddingH and margins

### Step 7 — Verify build
Run `.\gradlew.bat assembleDebug --no-daemon` to confirm no resource reference errors.

---

## Critical Files Touched
`values-sw400dp/dimens.xml` (new), `values-sw480dp/dimens.xml` (new), `values/dimens.xml`, `values-sw360dp/dimens.xml`, `values-sw600dp/dimens.xml`, `values/styles.xml`, plus all 18 layout XML files.

## Risks
- Some inline `android:textSize` + `android:fontFamily` combinations where applying `textAppearance` would override the fontFamily incorrectly — handled by setting both in the style definition
- `bacasime_antique` only has regular weight — no bold variant. Display/headline styles use it as-is.
- `wrap_content` height views with large text may still overflow on small screens — handled by reviewing and adjusting minHeight where needed.