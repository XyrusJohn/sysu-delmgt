# Trip Registration Redesign — Plate Number & Company Fix

**Date:** 2026-05-29
**Status:** Approved

---

## 1. Overview

Tighten validation and UX on the Trip Registration screen so drivers cannot register with invalid plate numbers, and the company field is locked to whatever was set during driver registration.

---

## 2. Changes

### 2.1 Company Field — Read-Only Display

- Field becomes non-editable (`android:enabled="false"` / `isFocusable = false`).
- It is pre-filled from `truckingCompany` or `company` in the driver's Firestore document (existing behavior).
- User can see the value but cannot modify it.
- Remove the error state for this field — it is never user-editable so validation error is moot.

### 2.2 Plate Prefix — Exactly 3 Capital Letters

| Before | After |
|--------|-------|
| `textCapCharacters`, max 4, accepts 2–4 chars (letters or digits) | `textCapCharacters`, max 3, letters only |
| Error: "2-4 characters" | Error: "Exactly 3 letters" |

**Input filter logic (applied via `InputFilter`):**
- Allow only `A–Z` (uppercase)
- Reject digits, dashes, special chars on input
- Force to uppercase in real-time

**Validation (in `submitTrip()`):**
- Must be exactly 3 characters
- All must be letters `A–Z`

**`Sanitizer.sanitizePlatePrefix` update:**
```kotlin
fun sanitizePlatePrefix(input: String?): String {
    return input
        ?.uppercase()
        ?.filter { it in 'A'..'Z' }
        ?.take(3)
        ?: ""
}
```

### 2.3 Plate Suffix — Exactly 4 Digits

| Before | After |
|--------|-------|
| `inputType="number"`, max 4, expects 3–4 digits | `inputType="number"`, max 4, expects exactly 4 |
| Error: "3-4 digits" | Error: "Exactly 4 digits" |

**Input filter logic:**
- Allow only `0–9`
- Auto-submit or cursor-move on full entry? No — just limit to 4.

**Validation (in `submitTrip()`):**
- Must be exactly 4 digits

**`Sanitizer.sanitizePlateSuffix` update:**
```kotlin
fun sanitizePlateSuffix(input: String?): String {
    return input?.filter { it.isDigit() }?.take(4) ?: ""
}
```

---

## 3. Files to Modify

| File | Change |
|------|--------|
| `app/src/main/res/layout/activity_trip_registration.xml` | Set `etCompany` enabled=false; update prefix/suffix hint, inputType, maxLength |
| `app/src/main/java/com/sysu/go/utils/Sanitizer.kt` | Tighten `sanitizePlatePrefix` and `sanitizePlateSuffix` |
| `app/src/main/java/com/sysu/go/activities/TripRegistrationActivity.kt` | Update validation checks (exact 3 / exact 4), remove company error, add InputFilters |
| `app/src/main/res/values/strings.xml` (or inline) | Update error hint strings |

---

## 4. UX Summary

- Company shown as read-only text, pre-filled — no manual entry.
- Plate prefix: 3-letter code, auto-caps, letter-only. Shows error if not exactly 3 letters.
- Plate suffix: 4-digit number, digit-only. Shows error if not exactly 4 digits.
- Submit blocked until both plate fields are valid.