# POD Photo Timestamp Overlay — Design Spec
**Date:** 2026-06-23
**Status:** Approved

---

## 1. Goal

Embed a visible human-readable timestamp directly into POD photo pixels — bottom-left corner — before the image is compressed to JPEG and stored as base64 in Firestore. The timestamp must be visible when the photo is viewed anywhere (app, shared link, etc.), not just in the database.

---

## 2. Timestamp Source

- Use the already-captured `pendingPodData.capturedAtMillis` from `MyTripActivity`
- This is the `System.currentTimeMillis()` recorded **at the moment the driver selected the delivery status** (before the camera opened), making it the most accurate "proof of delivery moment"
- Format: **`Jun 23, 2026 • 2:30:45 PM`** (human-readable, includes seconds)

---

## 3. Visual Design

- **Position:** Bottom-left corner, 16px margin from edges
- **Background:** Semi-transparent black strip — `#CC000000` (80% opacity), 8dp vertical padding, 12dp horizontal padding, 4dp corner radius
- **Text color:** White (`#FFFFFF`)
- **Text size:** 13sp
- **Font:** Default system sans-serif (no custom font needed)
- **Format:**
  ```
  Jun 23, 2026 • 2:30:45 PM
  ```
- The background strip grows wide enough to fit the text comfortably

---

## 4. Implementation Approach — Surgical, Zero Breaking Changes

### Step 1: Add new `uploadPodImage` overload in `ImageStorageHelper.kt`

```kotlin
fun uploadPodImage(
    bitmap: Bitmap,
    timestampMillis: Long,
    context: Context,
    onSuccess: (String) -> Unit,
    onFailure: (String) -> Unit
)
```

Behavior:
1. **Stamp the watermark** onto the bitmap using `Canvas` (draw background rect + draw text)
2. **Resize** the stamped bitmap to ≤1280px max dimension (same as existing behavior)
3. **Compress** to JPEG 50%
4. **Base64-encode** to data URI
5. Return via `onSuccess`

The existing `uploadPodImage(Bitmap, ...)` overload (no timestamp) stays completely untouched — it has no timestamp parameter and no watermark drawing. This keeps `SignaturePadView` and any other non-POD caller unaffected.

### Step 2: Modify `handleCameraResult()` in `MyTripActivity.kt`

In `MyTripActivity.kt`, `handleCameraResult()` — change the encoding step:

**Before:**
```kotlin
ImageStorageHelper.uploadPodImage(
    photoFile = photoFile,
    context = this,
    onSuccess = { ... },
    onFailure = { ... }
)
```

**After:**
```kotlin
// Decode photo file to Bitmap
val stampedUri = encodePodImageWithTimestamp(
    photoFile = photoFile,
    timestampMillis = podData.capturedAtMillis,
    context = this,
    onSuccess = { ... },  // same onSuccess/onFailure as before
    onFailure = { ... }
)
```

Add a new private helper `encodePodImageWithTimestamp()` that:
1. Decodes `photoFile` to `Bitmap` (using same logic as `ImageStorageHelper.decodeAndResize`)
2. Calls `ImageStorageHelper.uploadPodImage(bitmap, timestampMillis, ...)` (the new overload)
3. Recycles the bitmap when done

### Step 3: Update `updateObdLineItemInFirestore` signature

Add `capturedAtMillis: Long` parameter to the function signature. Currently it receives this value but doesn't use it — we store only `Timestamp.now()` in Firestore. After this change, `podCapturedAt` in Firestore will use the **actual camera-captured timestamp** instead of the server-write timestamp. (The existing `podImageUrl` Firestore field is unaffected.)

---

## 5. Files Changed

| File | Change |
|------|--------|
| `ImageStorageHelper.kt` | Add `uploadPodImage(bitmap, timestampMillis, context, onSuccess, onFailure)` overload |
| `MyTripActivity.kt` | Add `encodePodImageWithTimestamp()` helper; change `handleCameraResult()` to use it; update `updateObdLineItemInFirestore` to use `capturedAtMillis` |

## 6. Files Unchanged (Safe)

- `ObdItemsBottomSheet.kt` — no changes
- `ObdStatusBottomSheet.kt` — no changes
- `ImageStorageHelper.uploadPodImage(File, ...)` — no changes
- `ImageStorageHelper.uploadPodImage(Bitmap, ...)` — no changes (no watermark)
- `AssignmentActivity.kt` — no changes
- `QueueDetailsActivity.kt` — no changes

---

## 7. Error Handling

- If timestamp drawing fails (e.g., OOM during Canvas draw) → fall back to encoding without watermark (log warning, don't fail the upload)
- Same retry/clear/error handling as current flow — no new failure paths

---

## 8. Testing Checklist

- [ ] Timestamp visible on photo taken and saved (view in full-screen preview)
- [ ] Timestamp text is readable over varied photo backgrounds (light, dark, colorful)
- [ ] Bottom sheet still shows completed OBD items correctly
- [ ] Socket `pod_updated` still triggers bottom sheet refresh
- [ ] Preview (tap completed OBD item) still shows timestamped image correctly
- [ ] No regression in image size — still within 30–80KB base64 range