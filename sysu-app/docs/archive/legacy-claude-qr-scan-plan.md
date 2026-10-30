# QR Scan Flow — Implementation Plan

## Goal
Fix the web app QR scan flow: phone scans QR → lands on page → verifies token → driver is queued → sees confirmation. Clean, Seamless, GCash-style.

---

## Issues to Fix

### 1. Token Display Bug (`qr-generator.html` line 574)
**Bug**: `var shortToken = 'SYS-' + token...` doubles the prefix. Token already has `SYS-`.
**Fix**: Just display `token` directly.

### 2. Dead Offline URL (`qr-generator.html` line 586)
**Bug**: `https://sysu-queue.web.app/scan` returns 404.
**Fix**: Change to `https://sysu-web-5a25d.web.app/qr-generator.html` (self-reference or a dedicated offline page).

### 3. `index.js` Scan Handler Never Built/Deployed
**Bug**: My scan-handler code was written to `src/pages/index.js` but `npm run build` was never run with those changes included (checked `dist/assets/main-*.js` — zero trace of the code).
**Fix**: Run `npm run build` then `firebase deploy`.

### 4. Wrong Redirect Target After Scan Success
**Bug**: On success, `index.js` redirects to `queue-management.html?token=...` — that's the admin panel with driver cards, not a driver confirmation page.
**Fix**: Create `scan-result.html` — a lightweight "you're queued" page. This becomes the redirect target after scan.

### 5. Scan Overlay CSS Bug (`index.js`)
**Bug**: `position: absolute; inset: 0` requires the parent to have `position: relative`. The right panel in `index.html` doesn't have it, so the overlay renders full-page instead of contained in the right panel.
**Fix**: Add `position: relative` to the right panel via JS before showing overlay, OR use a fixed fullscreen overlay.

### 6. `qr-generator.html` Excluded from Vite Build
**Bug**: `vite.config.js` only builds `{ main, dashboard }`. `qr-generator.html` is never in the pipeline.
**Fix**: Keep it as a standalone static file — copy changes manually to `public/qr-generator.html` and `dist/qr-generator.html` after each edit. No Vite bundling for this file.

### 7. Backend Not Yet Redeployed
**Bug**: My QR controller changes (`qrController.js`, `qrRoute.js`) exist only locally.
**Fix**: Deploy to Railway.

---

## Implementation Steps

### Phase 1 — Backend
- [ ] Push new `qrController.js` + `qrRoute.js` to git
- [ ] Redeploy Railway backend

### Phase 2 — Token Display Fix
- [ ] Fix `qr-generator.html` line ~574: remove `'SYS-' +` prefix from token display  
- [ ] Fix offline fallback URL to use a real page
- [ ] Sync: `cp frontend/qr-generator.html frontend/public/qr-generator.html && cp frontend/qr-generator.html frontend/dist/qr-generator.html`

### Phase 3 — Scan Result Page (`scan-result.html`)
- [ ] Create `frontend/scan-result.html` — standalone, no Firebase auth needed
  - Checks `?token=` param from URL
  - Shows loading UI ("Verifying your QR...")
  - On success: green checkmark + "You're in the queue!" + queue position
  - On error: red X + message + "Try Again" button
  - Mobile-first responsive design
- [ ] Copy to `public/scan-result.html` and `dist/scan-result.html`

### Phase 4 — Fix `index.js` Redirect Target
- [ ] Change redirect from `queue-management.html?token=...` to `scan-result.html?token=...`
- [ ] Build: `npm run build` (this bundles new index.js into dist/assets)
- [ ] Verify `dist/assets/main-*.js` contains `handleTokenScan` and `URLSearchParams`

### Phase 5 — Fix Scan Overlay CSS
- [ ] In `index.js`, before showing overlay, set `rightPanel.style.position = 'relative'`
- [ ] Rebuild and redeploy

### Phase 6 — Deploy
- [ ] `firebase deploy --only hosting`
- [ ] Test full flow: QR scanned → verify called → scan-result.html shows → user sees queue confirmation

---

## Files Affected
| File | Change |
|------|--------|
| `backend/src/controllers/qrController.js` | DB-backed tokens, new verify/scanToken endpoints |
| `backend/src/routes/qrRoute.js` | Added `/verify` GET, `/scan` POST routes |
| `frontend/qr-generator.html` | Token prefix fix, offline URL fix |
| `frontend/public/qr-generator.html` | Sync from root |
| `frontend/dist/qr-generator.html` | Sync from root |
| `frontend/scan-result.html` | **NEW** — driver-facing confirmation page |
| `frontend/src/pages/index.js` | Scan handler with corrected redirect |
| `frontend/dist/` | Rebuild after index.js changes |

---

## Not Included (Later)
- Kotlin app integration (user said "later")
- Queue position numbering (backend returns `position: null` — needs separate work)
- Token cleanup (expired tokens not purged from DB — needs a scheduled cleanup)