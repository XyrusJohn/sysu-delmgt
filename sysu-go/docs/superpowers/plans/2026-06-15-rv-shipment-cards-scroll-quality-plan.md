# rvShipmentCards Scroll Quality — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add enterprise-grade rubber-band scroll, smooth item animations, and proper item spacing to `rvShipmentCards` in `MainActivity` — zero changes to existing business logic or listeners.

**Architecture:** Three-layer surgical change: (1) `setupShipmentCards()` in MainActivity gets overScrollMode + ItemAnimator + ItemDecoration, (2) item margin removed from `item_shipment_card.xml`. No structural layout changes.

**Tech Stack:** AndroidX RecyclerView, MaterialCardView, ConstraintLayout 2.x

---

## File Map

| File | Change |
|---|---|
| `app/src/main/java/com/sysu/go/activities/MainActivity.kt` | Minor: 3 blocks inserted into `setupShipmentCards()` |
| `app/src/main/res/layout/item_shipment_card.xml` | Minor: remove `android:layout_marginTop="8dp"` from root |

**No changes:** Adapters, Firestore listeners, click handlers, layout structure, `updateQueueTabs()`

---

## Tasks

### Task 1: Verify exact insertion point in `setupShipmentCards()`

**Files:**
- Read: `app/src/main/java/com/sysu/go/activities/MainActivity.kt:618-627`

- [ ] **Step 1: Read the current state of `setupShipmentCards()`**

Read lines 610–640 of `app/src/main/java/com/sysu/go/activities/MainActivity.kt`. Confirm the method body contains `binding.rvShipmentCards.layoutManager = ...` and nothing else between `// Phase 1:` comment and `setupBottomNav()`.

The insertion point for all 3 blocks is **after** the `layoutManager = ...` line in `setupShipmentCards()`. No other lines in this method will be modified.

> This is a read-only verification step to confirm exact line numbers before any write.

---

### Task 2: Add scroll quality config to `setupShipmentCards()`

**Files:**
- Modify: `app/src/main/java/com/sysu/go/activities/MainActivity.kt:625-626`
  - Insert 3 new blocks after the existing `layoutManager` assignment (line ~625-626)

- [ ] **Step 1: Add the overScrollMode line after `layoutManager`**

Find this existing line in `setupShipmentCards()`:
```kotlin
        binding.rvShipmentCards.layoutManager =
            androidx.recyclerview.widget.LinearLayoutManager(this)
```

Insert directly after it:
```kotlin
        // ── Scroll quality: rubber-band over-scroll ──
        binding.rvShipmentCards.overScrollMode = RecyclerView.OVER_SCROLL_ALWAYS
```

- [ ] **Step 2: Add the ItemAnimator block**

Insert after the `overScrollMode` line:
```kotlin
        // ── Scroll quality: smooth item animations ──
        binding.rvShipmentCards.itemAnimator = androidx.recyclerview.widget.DefaultItemAnimator().apply {
            addDuration = 200
            removeDuration = 200
            moveDuration = 200
            changeDuration = 200
        }
```

- [ ] **Step 3: Add the ItemDecoration block**

Insert after the `itemAnimator` block:
```kotlin
        // ── Scroll quality: uniform 8dp vertical spacing between cards ──
        binding.rvShipmentCards.addItemDecoration(object : androidx.recyclerview.widget.RecyclerView.ItemDecoration() {
            override fun getItemOffsets(
                outRect: android.graphics.Rect,
                view: View,
                parent: androidx.recyclerview.widget.RecyclerView,
                state: androidx.recyclerview.widget.RecyclerView.State
            ) {
                val position = parent.getChildAdapterPosition(view)
                val spacing = android.util.TypedValue.applyDimension(
                    android.util.TypedValue.COMPLEX_UNIT_DIP, 8f,
                    parent.context.resources.displayMetrics
                ).toInt()
                outRect.top = if (position == 0) 0 else spacing
                outRect.bottom = spacing
            }
        })
```

- [ ] **Step 4: Verify the method looks correct**

The method should now read:
```kotlin
    private fun setupShipmentCards() {
        // ... existing code ...

        // ── Vertical Shipment Cards RecyclerView — one full-width card per shipment.
        // Phase 1: hidden (cardMyQueue handles display).
        // Phase 2 (2+ shipments): visible. LayoutManager set via updateQueueTabs().
        // default canScrollVertically=true — scroll works via constraintHeight_max in XML.
        binding.rvShipmentCards.layoutManager =
            androidx.recyclerview.widget.LinearLayoutManager(this)

        // ── Scroll quality: rubber-band over-scroll ──
        binding.rvShipmentCards.overScrollMode = RecyclerView.OVER_SCROLL_ALWAYS

        // ── Scroll quality: smooth item animations ──
        binding.rvShipmentCards.itemAnimator = androidx.recyclerview.widget.DefaultItemAnimator().apply {
            addDuration = 200
            removeDuration = 200
            moveDuration = 200
            changeDuration = 200
        }

        // ── Scroll quality: uniform 8dp vertical spacing between cards ──
        binding.rvShipmentCards.addItemDecoration(object : androidx.recyclerview.widget.RecyclerView.ItemDecoration() {
            override fun getItemOffsets(
                outRect: android.graphics.Rect,
                view: View,
                parent: androidx.recyclerview.widget.RecyclerView,
                state: androidx.recyclerview.widget.RecyclerView.State
            ) {
                val position = parent.getChildAdapterPosition(view)
                val spacing = android.util.TypedValue.applyDimension(
                    android.util.TypedValue.COMPLEX_UNIT_DIP, 8f,
                    parent.context.resources.displayMetrics
                ).toInt()
                outRect.top = if (position == 0) 0 else spacing
                outRect.bottom = spacing
            }
        })
    }
```

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/sysu/go/activities/MainActivity.kt
git commit -m "feat(MainActivity): add scroll quality to rvShipmentCards

- OVER_SCROLL_ALWAYS rubber-band at both scroll edges
- DefaultItemAnimator 200ms for card in/out transitions
- ItemDecoration 8dp spacing, no margin on first card
- Surgical: zero changes to listeners, adapters, click handlers"
```

---

### Task 3: Remove top margin from `item_shipment_card.xml`

**Files:**
- Modify: `app/src/main/res/layout/item_shipment_card.xml:8-9`

- [ ] **Step 1: Read the root MaterialCardView attributes**

Confirm line 9 reads: `android:layout_marginTop="8dp"`.

- [ ] **Step 2: Remove `android:layout_marginTop="8dp"` from root**

Change:
```xml
    android:layout_marginHorizontal="24dp"
    android:layout_marginTop="8dp"
```
To:
```xml
    android:layout_marginHorizontal="24dp"
```
(The `layout_marginHorizontal="24dp"` stays. Vertical spacing is now handled by `ItemDecoration` only.)

- [ ] **Step 3: Verify the root tag is clean**

The root `<com.google.android.material.card.MaterialCardView>` should now have:
- `android:layout_width="match_parent"`
- `android:layout_height="wrap_content"`
- `android:layout_marginHorizontal="24dp"` ← only margin attribute
- `android:clickable="true"`
- `android:focusable="true"`
- `app:cardBackgroundColor`... etc. (all existing attrs preserved)

- [ ] **Step 4: Commit**

```bash
git add app/src/main/res/layout/item_shipment_card.xml
git commit -m "refactor(item_shipment_card): remove top margin — spacing now via ItemDecoration"
```

---

## Final Verification

- [ ] **Build**: `./gradlew :app:assembleDebug` → `BUILD SUCCESSFUL`
- [ ] **No new Kotlin warnings** in MainActivity.kt
- [ ] Check `updateQueueTabs()` still only sets `layoutManager` + `adapter` — unchanged

---

## Rollback Triggers (stop, do not continue if any occur)

- Any compilation error in MainActivity.kt
- Any `NoSuchMethodError` or `IncompatibleClassChangeError` at runtime
- Any existing click handler (cardMyQueue, shipment card tap, CTA dismiss) stops responding

---

## Acceptance Criteria (for manual testing)

1. Rubber-band stretch + snap-back when over-scrolling `rvShipmentCards` at top or bottom
2. When 2+ shipments appear (Phase 1→2), cards fade+slide in with visible animation
3. When returning to 1 shipment (Phase 2→1), cards animate out
4. Cards have uniform 8dp space between them; first card flush at top, last card has 8dp before CTA
5. All touch/click behaviors (cardMyQueue tap, shipment card tap → AssignmentActivity, CTA dismiss) unchanged