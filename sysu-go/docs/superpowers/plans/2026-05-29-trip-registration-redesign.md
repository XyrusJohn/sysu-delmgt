# Trip Registration Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the company field to read-only (pre-filled from driver profile) and tighten plate number validation so prefix accepts exactly 3 capital letters and suffix accepts exactly 4 digits.

**Architecture:** Three files changed — a sanitizer utility, an XML layout, and the activity logic. No new architecture; existing patterns are preserved.

**Tech Stack:** Android (Kotlin), Material TextInputLayout, Firebase Firestore, ViewBinding

---

## File Map

| File | Responsibility |
|------|----------------|
| `app/src/main/java/com/sysu/go/utils/Sanitizer.kt` | Strip invalid chars from plate prefix/suffix |
| `app/src/main/res/layout/activity_trip_registration.xml` | Layout: company readonly, plate field hints/maxLength |
| `app/src/main/java/com/sysu/go/activities/TripRegistrationActivity.kt` | Validation logic, InputFilters, submit flow |

---

## Tasks

---

### Task 1: Update Sanitizer — Plate Prefix & Suffix

**Files:**
- Modify: `app/src/main/java/com/sysu/go/utils/Sanitizer.kt`

- [ ] **Step 1: Replace `sanitizePlatePrefix`**

Replace the existing `sanitizePlatePrefix` function with:

```kotlin
fun sanitizePlatePrefix(input: String?): String {
    return input
        ?.uppercase()
        ?.filter { it in 'A'..'Z' }
        ?.take(3)
        ?: ""
}
```

- [ ] **Step 2: Replace `sanitizePlateSuffix`**

Replace the existing `sanitizePlateSuffix` function with:

```kotlin
fun sanitizePlateSuffix(input: String?): String {
    return input?.filter { it.isDigit() }?.take(4) ?: ""
}
```

- [ ] **Step 3: Verify Sanitizer.kt still compiles**

Open the file and confirm it still has all other functions (`sanitize`, `sanitizeMI`, `sanitizePhone`, `sanitizeName`) intact.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/sysu/go/utils/Sanitizer.kt
git commit -m "fix(sanitizer): tighten plate prefix to 3 letters, suffix to 4 digits"
```

---

### Task 2: Update TripRegistrationActivity — Validation & InputFilters

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/TripRegistrationActivity.kt`

- [ ] **Step 1: Add `InputFilter` for plate prefix (letters only, auto-caps)**

In `TripRegistrationActivity.kt`, add this `InputFilter` extension just before the class:

```kotlin
private val platePrefixInputFilter = InputFilter { source, start, end, dest, dstart, dend ->
    val filtered = StringBuilder()
    for (i in start until end) {
        val c = source[i]
        if (c in 'A'..'Z' || c in 'a'..'z') {
            filtered.append(c.uppercaseChar())
        }
    }
    filtered.toString()
}
```

- [ ] **Step 2: Apply InputFilter to `etPlatePrefix`**

After `binding = ActivityTripRegistrationBinding.inflate(...)` in `onCreate`, chain the filter onto `etPlatePrefix`:

```kotlin
binding.etPlatePrefix.filters = arrayOf(platePrefixInputFilter)
```

- [ ] **Step 3: Remove company error handling in `submitTrip()`**

Find the `hasError` check for empty company:

```kotlin
if (company.isEmpty()) {
    binding.tilCompany.error = "Required"
    hasError = true
}
```

Remove it entirely (company is read-only and always pre-filled, so this error is impossible).

- [ ] **Step 4: Update plate prefix validation to exactly 3 letters**

Replace:
```kotlin
if (platePrefix.length < 2) {
    binding.tilPlatePrefix.error = "2-4 characters"
    hasError = true
}
```
With:
```kotlin
if (platePrefix.length != 3) {
    binding.tilPlatePrefix.error = "Exactly 3 letters"
    hasError = true
}
```

- [ ] **Step 5: Update plate suffix validation to exactly 4 digits**

Replace:
```kotlin
if (plateSuffix.length < 3) {
    binding.tilPlateSuffix.error = "3-4 digits"
    hasError = true
}
```
With:
```kotlin
if (plateSuffix.length != 4) {
    binding.tilPlateSuffix.error = "Exactly 4 digits"
    hasError = true
}
```

- [ ] **Step 6: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/TripRegistrationActivity.kt
git commit -m "fix(trip): update plate validation to exact 3 letters / 4 digits, add InputFilter"
```

---

### Task 3: Update activity_trip_registration.xml — Layout Changes

**Files:**
- Modify: `app/src/main/res/layout/activity_trip_registration.xml`

- [ ] **Step 1: Make company field read-only**

On `etCompany` (`TextInputEditText`), change `android:inputType` from `textCapWords` to remove editability. Set `android:enabled="false"` and `android:focusable="false"` and `android:textColor="#666666"` (muted):

```xml
<com.google.android.material.textfield.TextInputEditText
    android:id="@+id/etCompany"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:enabled="false"
    android:focusable="false"
    android:clickable="false"
    android:inputType="none"
    android:textColor="#666666"
    android:maxLength="100" />
```

Also update the `TextInputLayout` `android:hint` to say something like "Company (from registration)" to make it clear it's pre-filled.

- [ ] **Step 2: Update plate prefix hint and maxLength**

Change `etPlatePrefix` field from `maxLength="4"` to `maxLength="3"` and update the hint:

```xml
android:hint="Prefix (ABC)"
android:maxLength="3"
```

- [ ] **Step 3: Update plate suffix hint**

```xml
android:hint="Suffix (1234)"
android:maxLength="4"
```

- [ ] **Step 4: Commit**

```bash
git add app/src/main/res/layout/activity_trip_registration.xml
git commit -m "ui(trip): lock company field, reduce plate prefix maxLength to 3"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| Company field read-only, pre-filled | Task 3 |
| Remove company validation error | Task 2 |
| Plate prefix exactly 3 capital letters | Tasks 1, 2, 3 |
| Plate suffix exactly 4 digits | Tasks 1, 2, 3 |
| InputFilter for real-time letter-only input | Task 2 |
| Updated hint copy ("Exactly 3 letters" / "Exactly 4 digits") | Tasks 2, 3 |

All spec requirements covered. No placeholders, no TODOs.