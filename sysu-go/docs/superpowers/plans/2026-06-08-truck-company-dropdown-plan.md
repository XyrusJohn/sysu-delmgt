# Truck Company Dropdown — Firestore-Backed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registration dropdown pulls truck company names from Firestore via a local SharedPreferences cache, replacing the hardcoded `arrays.xml` list.

**Architecture:**
- `TruckCompanyRepository` lives in `com.sysu.go.repository` and handles Firestore fetch → SharedPreferences JSON cache → in-memory return.
- `setupTruckCompanyDropdown()` in `RegistrationActivity` reads ONLY from local cache (pre-loaded by SplashActivity).
- Seed data pushed to Firestore manually via a Node.js script.

**Tech Stack:** Kotlin, Firestore Android SDK, SharedPreferences, Coroutines (`kotlinx.coroutines.tasks.await`)

---

## File Map

| Action | File |
|---|---|
| Create | `app/src/main/java/com/sysu/go/repository/TruckCompanyRepository.kt` |
| Modify | `app/src/main/res/values/arrays.xml` |
| Modify | `app/src/main/java/com/sysu/go/activities/RegistrationActivity.kt:286-300` |
| Modify | `app/src/main/java/com/sysu/go/activities/SplashActivity.kt` |
| Create | `backend/scripts/seed-truck-companies.js` |

---

## Task 1: Seed truck_company collection in Firestore

**Files:**
- Create: `backend/scripts/seed-truck-companies.js`

- [ ] **Step 1: Create the seed script**

```javascript
// backend/scripts/seed-truck-companies.js
// Usage: node seed-truck-companies.js
// Requires Firebase Admin SDK: npm install firebase-admin

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const companies = [
  "LALAMOVE PHILIPPINES INC",
  "SCHENKER DISTRIBUTION SOLUTIONS",
  "ZBZ GLOBAL LOGISTICS (PHILS) INC.",
  "2GO LOGISTICS INC",
  "BCJ DELIVERY SERVICES",
  "DANIKO TRUCKING SERVICES",
  "EDMONTON TRUCKING SERVICES",
  "F. DRILON TRUCKING SERVICES",
  "F2 LOGISTICS PHILIPPINES INC.",
  "FAST LOGISTICS CORPORATION",
  "FASTCARGO LOGISTICS CORPORATION",
  "JONTHER CORPORATION",
  "KE ENTERPRISES",
  "KENJITSU TRANSPORTER CORPORATION",
  "LUBAY DELIVERY SERVICE",
  "METRO COMBINED LOGISTICS SOLUTIONS INC",
  "MISHABELA LOGISTICS SERVICES",
  "PHOEMIROLD TRANSPORT",
  "R.D. CASTILLO TRUCKING",
  "RL TRUCKING SERVICES",
  "TRITEK REVERSE LOGISTICS CORP.",
  "SAFEXPRESS LOGISTICS INC.",
  "RICARDO AND ANNIE TRUCKING",
  "SHIPA TRANSPORT",
  "MC3 CARMONA TRUCKING SERVICES",
  "DAPH TRUCKING SERVICES",
  "CK'5 TRUCKING SERVICES",
  "GRAMORE TRUCKING SERVICES",
  "EXCELLENT FREIGHT INC.",
  "JUANCAT DELIVERY SERVICES",
  "VDS DELIVERY SERVICES",
  "ALOYSIANZ TRUCKING SERVICES",
  "LITE EXPRESS INT'L INC",
  "RL1 TRUCKING SERVICES",
  "ST. CHRISTOPHER FORWARDERS OPC",
  "FASTLOGIC CORP.",
  "ROAR DELIVERY SERVICES",
  "MHETHZ TRUCKING SERVICES",
  "SHIASTINE LOGISTICS SERVICES",
  "J.H. CAROLINO DELIVERY SERVICES",
  "L3V LOGISTICS SERVICES",
  "DUSAU TRUCKING SERVICES",
  "QUINN&QUIAA TRUCKING SERVICES",
  "EZEKIEL DELIVERY SERVICES",
  "MSAU TRANSPORT SERVICES",
  "WE'VELINK SERVICES INCORPORATED",
];

// Load service account from environment or file
const serviceAccount = require('./config/service-account.json');

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

async function seed() {
  const collection = db.collection('truck_company');

  for (const name of companies) {
    // Use name as document ID — simple, no duplicates, readable in console
    const docRef = collection.doc(name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase());
    await docRef.set({
      name: name,
      active: true,
      createdAt: require('firebase-admin/firestore').FieldValue.serverTimestamp(),
    });
    console.log(`Seeded: ${name}`);
  }

  console.log(`\nDone. ${companies.length} companies seeded.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

Run: `node backend/scripts/seed-truck-companies.js`
Expected: Logs each company name, then `Done. 46 companies seeded.`

- [ ] **Step 2: Run the seed script**

Before running, ensure `backend/scripts/config/service-account.json` points to your Firebase project with Firestore write access.

Expected output:
```
Seeded: LALAMOVE PHILIPPINES INC
Seeded: SCHENKER DISTRIBUTION SOLUTIONS
...
Done. 46 companies seeded.
```

- [ ] **Step 3: Verify in Firestore console**

Open Firebase console → Firestore Database → confirm collection `truck_company` exists with 46 documents, each containing `name`, `active: true`, and `createdAt`.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/seed-truck-companies.js
git commit -m "chore(backend): add seed script for truck_company Firestore collection"
```

---

## Task 2: Create TruckCompanyRepository

**Files:**
- Create: `app/src/main/java/com/sysu/go/repository/TruckCompanyRepository.kt`

- [ ] **Step 1: Write the repository class**

```kotlin
package com.sysu.go.repository

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Reads truck company names from Firestore and caches them in SharedPreferences.
 * All methods are safe to call on the main thread — network calls are coroutine-backed.
 *
 * Cache key: PREF_TRUCK_COMPANIES → JSON array of strings, e.g. ["LALAMOVE...","2GO..."]
 */
class TruckCompanyRepository(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREF_PREFS_NAME, Context.MODE_PRIVATE)

    private val firestore: FirebaseFirestore
        get() = Firebase.firestore

    companion object {
        private const val PREF_PREFS_NAME = "sysu_go_prefs"
        private const val PREF_TRUCK_COMPANIES = "truck_companies"
        private const val COLLECTION = "truck_company"
        private const val TAG = "TruckCompanyRepo"
    }

    /**
     * Returns the cached list of active company names.
     * Returns an empty list if never cached (caller handles gracefully).
     * NEVER makes a network call — use [fetchAndCache] to refresh.
     */
    fun getCached(): List<String> {
        val json = prefs.getString(PREF_TRUCK_COMPANIES, null) ?: return emptyList()
        return try {
            val array = android.util.Json.parseToJsonArray(json)
            array.map { it.toString() }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse truck companies cache, dropping it", e)
            prefs.edit { remove(PREF_TRUCK_COMPANIES) }
            emptyList()
        }
    }

    /**
     * Fetches all [active] truck companies from Firestore and writes them to
     * SharedPreferences as a JSON array. Called on every app open.
     *
     * Swallows all exceptions — if Firestore is unreachable, the existing cache
     * is preserved and not overwritten.
     */
    suspend fun fetchAndCache() {
        try {
            val names = fetchFromFirestore()
            val json = android.util.Json.encodeToString(names)
            prefs.edit { putString(PREF_TRUCK_COMPANIES, json) }
            Log.i(TAG, "Cached ${names.size} truck companies")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch truck companies from Firestore, keeping existing cache", e)
            // Do NOT clear the cache on failure — preserve whatever was there
        }
    }

    /**
     * Fetches active company names from Firestore and returns them as a list.
     * Returns empty list on any error.
     */
    suspend fun fetchFromFirestore(): List<String> = withContext(Dispatchers.IO) {
        try {
            val snapshot = firestore.collection(COLLECTION)
                .whereEqualTo("active", true)
                .orderBy("name")
                .get()
                .await()

            snapshot.documents.mapNotNull { doc ->
                doc.getString("name")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Firestore fetch failed", e)
            emptyList()
        }
    }
}
```

- [ ] **Step 2: Run build to verify**

Run: `JAVA_HOME="C:/Program Files/Android/Android Studio1/jbr" ./gradlew assembleDebug 2>&1 | grep -E "error:|BUILD SUCCESSFUL|BUILD FAILED"`
Expected: `BUILD SUCCESSFUL`

If `android.util.Json` is not available (API 21 compatibility), replace with `org.json.JSONArray`:
```kotlin
import org.json.JSONArray  // fallback if Json is unavailable

fun getCached(): List<String> {
    val json = prefs.getString(PREF_TRUCK_COMPANIES, null) ?: return emptyList()
    return try {
        val array = JSONArray(json)
        (0 until array.length()).map { array.getString(it) }
    } catch (e: Exception) { ... }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/java/com/sysu/go/repository/TruckCompanyRepository.kt
git commit -m "feat(repository): add TruckCompanyRepository with Firestore fetch and SharedPreferences cache"
```

---

## Task 3: Empty arrays.xml (keep key, remove items)

**Files:**
- Modify: `app/src/main/res/values/arrays.xml`

- [ ] **Step 1: Remove all item entries, keep the array key**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!--
        NOTE: truck_companies is now sourced from Firestore (truck_company collection).
        This array is kept as a placeholder to avoid breaking R.array.truck_companies
        references if any remain in the codebase.
    -->
    <string-array name="truck_companies">
    </string-array>
</resources>
```

Run: `grep -n "truck_companies" app/src/main/res/values/arrays.xml`
Expected output: shows the empty array declaration

- [ ] **Step 2: Commit**

```bash
git add app/src/main/res/values/arrays.xml
git commit -m "chore(res): empty truck_companies array — now sourced from Firestore"
```

---

## Task 4: Update RegistrationActivity dropdown

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/RegistrationActivity.kt:286-300`

- [ ] **Step 1: Update setupTruckCompanyDropdown to use repository**

Replace the entire `setupTruckCompanyDropdown()` method (lines 286–300):

```kotlin
    private fun setupTruckCompanyDropdown() {
        val repository = TruckCompanyRepository(this)
        val companies = repository.getCached()

        if (companies.isEmpty()) {
            // No cache — fall back to a placeholder so the UI doesn't break.
            // App must have had network on a previous open.
            val fallback = listOf("Loading companies…")
            val adapter = ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, fallback)
            binding.actvTruckCompany.setAdapter(adapter)
        } else {
            val adapter = ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, companies)
            binding.actvTruckCompany.setAdapter(adapter)
        }

        binding.actvTruckCompany.setOnClickListener {
            binding.actvTruckCompany.showDropDown()
        }

        binding.actvTruckCompany.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus) {
                binding.actvTruckCompany.showDropDown()
            }
        }
    }
```

- [ ] **Step 2: Add import for TruckCompanyRepository**

Add at the top of the file (after existing imports):

```kotlin
import com.sysu.go.repository.TruckCompanyRepository
```

- [ ] **Step 3: Run build to verify**

Run: `JAVA_HOME="C:/Program Files/Android/Android Studio1/jbr" ./gradlew assembleDebug 2>&1 | grep -E "error:|BUILD SUCCESSFUL|BUILD FAILED"`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/RegistrationActivity.kt
git commit -m "feat(registration): wire truck company dropdown to TruckCompanyRepository cache"
```

---

## Task 5: Call fetchAndCache from SplashActivity

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/SplashActivity.kt`

- [ ] **Step 1: Add imports**

Add after the existing `import` block:
```kotlin
import com.sysu.go.repository.TruckCompanyRepository
import kotlinx.coroutines.launch
```

- [ ] **Step 2: Update onCreate to trigger fetchAndCache**

In `onCreate`, add a lifecycleScope call BEFORE the session check:

```kotlin
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        startFerrisWheelAnimation()

        // Kick off truck company cache refresh in background — non-blocking
        lifecycleScope.launch {
            TruckCompanyRepository(this@SplashActivity).fetchAndCache()
        }

        Handler(Looper.getMainLooper()).postDelayed({
            checkUserSession()
        }, 2000)
    }
```

- [ ] **Step 3: Run build to verify**

Run: `JAVA_HOME="C:/Program Files/Android/Android Studio1/jbr" ./gradlew assembleDebug 2>&1 | grep -E "error:|BUILD SUCCESSFUL|BUILD FAILED"`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/SplashActivity.kt
git commit -m "feat(splash): prefetch truck companies from Firestore on every app open"
```

---

## Post-Implementation Verification

After all tasks complete, run a final build:

```bash
JAVA_HOME="C:/Program Files/Android/Android Studio1/jbr" ./gradlew assembleDebug 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| `truck_company` Firestore collection with name/active/createdAt | Task 1 |
| `TruckCompanyRepository.getCached()` | Task 2 |
| `TruckCompanyRepository.fetchFromFirestore()` | Task 2 |
| `TruckCompanyRepository.fetchAndCache()` | Task 2 |
| SharedPreferences JSON cache under `PREF_TRUCK_COMPANIES` | Task 2 |
| arrays.xml emptied (key kept) | Task 3 |
| `setupTruckCompanyDropdown()` reads from cache, no network call | Task 4 |
| SplashActivity calls `fetchAndCache()` on ogni | Task 5 |
| No changes to `users` schema | Verified — not touched |