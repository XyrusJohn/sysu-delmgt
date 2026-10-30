# SYSU-GO — rvShipmentCards Scroll Quality System

**Date:** 2026-06-15
**Status:** Approved → Implementation Planned
**Scope:** `rvShipmentCards` RecyclerView scroll quality only. No business logic changes.

---

## 1. Problem Statement

The `rvShipmentCards` RecyclerView (Phase 2: 2+ shipments) lacks enterprise-grade scroll feel. Specific issues:

1. **No rubber-band over-scroll** — scrolling feels "locked" and cheap at edges
2. **No smooth item animations** — cards appear/disappear without transitions
3. **Inconsistent item spacing** — margins inside item views cause first-item extra spacing
4. **Edge bleed risk** — cards could visually overlap other UI elements at scroll extremes

---

## 2. Design Decision: Rubber-Band (Option A)

**Decision: `OVER_SCROLL_ALWAYS`**

Rationale for a driver logistics app:
- Consumer "bounce" feel signals precision and responsiveness
- Matches enterprise logistics UX patterns (SAP Fiori, Mercedes driver dash aesthetic)
- Physically feels "heavy" and deliberate, not loose

---

## 3. Scroll System Architecture

Five layers, applied in this order (bottom to top):

| Layer | Implementation | Effect |
|---|---|---|
| **Momentum** | `LinearLayoutManager` (default) | Physics-based momentum — no override |
| **Over-scroll** | `RecyclerView.OVER_SCROLL_ALWAYS` | Android native rubber-band stretch at both ends |
| **Nested scroll** | `nestedScrollingEnabled="true"` (already set) | Safe sync with any future parent scroll host |
| **Edge treatment** | `clipToPadding="false"` + 8dp padding | Cards render into padding zone at edges, signaling "more content" |
| **Touch feedback** | Existing `foreground=selectableItemBackground` | Cards ripple + subtle scale on press (already working) |

---

## 4. Item Animation

```kotlin
rvShipmentCards.itemAnimator = DefaultItemAnimator().apply {
    addDuration = 200
    removeDuration = 200
    moveDuration = 200
    changeDuration = 200
}
```

- Cards animate in (Phase 1→2 transition) with a 200ms fade+slide
- Cards animate out (Phase 2→1 transition)
- Triggered automatically by `DiffUtil` in `ListAdapter.submitList()`

---

## 5. Item Spacing via ItemDecoration

**Problem:** `item_shipment_card.xml` has `android:layout_marginTop="8dp"` on root. In RecyclerView, top margins on item views compound with container padding, causing incorrect first-item spacing.

**Solution:** Move spacing entirely to `RecyclerView.ItemDecoration`. Item views have NO margin on root.

```kotlin
binding.rvShipmentCards.addItemDecoration(
    object : RecyclerView.ItemDecoration() {
        override fun getItemOffsets(
            outRect: Rect,
            view: View,
            parent: RecyclerView,
            state: RecyclerView.State
        ) {
            val position = parent.getChildAdapterPosition(view)
            val spacing = 8.dpToPx()
            outRect.top = if (position == 0) 0 else spacing
            outRect.bottom = spacing
        }
    }
)
```

`8dp` = existing `dimens.xml` card spacing. Applied as `8dp → px` using `TypedValue.applyDimension`.

---

## 6. Implementation Changes

### 6.1 `activity_main.xml`

**No structural changes to layout.**

One attribute addition to `rvShipmentCards`:

```xml
android:overScrollMode="always"
```

Already present via default, but explicit = documented intent.

### 6.2 `MainActivity.kt`

**Two insertion points** in `setupShipmentCards()` (lines ~618–627), after the `layoutManager =` line:

```kotlin
// 1. Rubber-band over-scroll
binding.rvShipmentCards.overScrollMode = RecyclerView.OVER_SCROLL_ALWAYS

// 2. Smooth item animations
binding.rvShipmentCards.itemAnimator = DefaultItemAnimator().apply {
    addDuration = 200
    removeDuration = 200
    moveDuration = 200
    changeDuration = 200
}

// 3. ItemDecoration — spacing only (no margins inside item views)
binding.rvShipmentCards.addItemDecoration(object : RecyclerView.ItemDecoration() {
    override fun getItemOffsets(
        outRect: Rect,
        view: View,
        parent: RecyclerView,
        state: RecyclerView.State
    ) {
        val position = parent.getChildAdapterPosition(view)
        val spacing = 8.dpToPx()
        outRect.top = if (position == 0) 0 else spacing
        outRect.bottom = spacing
    }
})
```

### 6.3 `item_shipment_card.xml`

**Remove** `android:layout_marginTop="8dp"` from root `<MaterialCardView>`.

Keep `android:layout_marginHorizontal="24dp"` — horizontal margins are fine in RecyclerView items (they refer to parent width, not compound).

---

## 7. What Does NOT Change

- All adapter classes (`ShipmentCardAdapter`, `ShipmentCardHorizontalAdapter`)
- All Firestore listener logic
- `updateQueueTabs()` — only sets adapter + LayoutManager, no scroll config
- `cardMyQueue`, `cardScanCTA`, bottom nav, `cardQueueStatus`, `redHeader`
- Any other screen or activity

---

## 8. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| `OVER_SCROLL_ALWAYS` conflicts with parent touch | Very Low | Root is non-scrolling ConstraintLayout; rvShipmentCards is the only scroll host |
| `ItemDecoration` blank top on first item | Low | `position == 0` check; outRect.top = 0 for first child |
| `DefaultItemAnimator` causes flicker on rapid phase switch | Low | `addDuration=200` is short; rapid GONE→VISIBLE swaps still render correctly |
| `clipToPadding=false` causes card bleed | Low | 8dp padding exceeds any card shadow elevation; `cardElevation=8dp` won't clip |

---

## 9. Companion File Reference

- `rvShipmentCards` declared in `activity_main.xml` lines ~391–409
- `setupShipmentCards()` in `MainActivity.kt` lines ~618–627
- `item_shipment_card.xml` — root `MaterialCardView` at line 2
- `dimens.xml` — `8dp` spacing (used as card margin standard)

---

## 10. Acceptance Criteria

- [ ] RecyclerView has rubber-band stretch when over-scrolled at both top and bottom
- [ ] Cards animate in/out (fade + slide, ~200ms) when phase changes
- [ ] Uniform 8dp vertical spacing between cards; no extra top spacing on first card
- [ ] No cards visually bleed outside rvShipmentCards container
- [ ] All existing touch/click behaviors unchanged (verified by no changes to click listeners)
- [ ] Build compiles clean with no new warnings