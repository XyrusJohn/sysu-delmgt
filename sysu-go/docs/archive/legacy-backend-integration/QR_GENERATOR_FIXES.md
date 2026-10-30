# qr-generator.html — Required Code Changes

> The file is either at `frontend/qr-generator.html` or served from `backend/public/` in production
> If hosted in `backend/public/`, it uses Vite build-time `%VITE_%` placeholders for secrets
> **Status: ALL ITEMS COMPLETED** (2026-05-23)

---

## 1. Remove Hardcoded STATIC_TOKEN (CRITICAL) ✅ DONE

**Before (boot sequence)**:
```js
const STATIC_TOKEN = "SYS-4BFC433C7B79ACA11B58EAF7";  // ← REMOVED
// ...
renderQR(STATIC_TOKEN);  // ← REMOVED FROM BOOT
fetchQR();  // ← This runs but QR is already showing stale token
```

**After (boot sequence)**:
```js
// Show loading spinner before first QR token arrives
const spinnerHTML=`<div style="width:440px;height:440px;display:flex;align-items:center;justify-content:center;"><div style="width:48px;height:48px;border:4px solid rgba(200,16,46,0.2);border-top-color:#c8102e;border-radius:50%;animation:spin 0.8s linear infinite;"></div></div>`;
document.getElementById("qr-box").innerHTML=spinnerHTML;
document.getElementById("qr-token").textContent="LOADING...";
document.getElementById("qr-token").className="tok";
fetchQR();  // Only fetch; renderQR() is called inside fetchQR() on success
```

**Why this matters**: On a slow network, the hardcoded token persists for several seconds during boot. Anyone can photograph the displayed token and use it before `fetchQR()` returns a fresh one. In production on Railway, the static token could be valid for up to 5 minutes (until it's replaced by the auto-refresh) — making it exploitable.

---

## 2. Verify Token Expiry Display ✅ DONE

The backend gives **5-minute tokens** but the UI was hardcoded to 30 seconds:

**Before**: `const QR_SEC = 30` + countdown displayed `30s`
**After**: `const QR_SEC = 300` + countdown now uses dynamic `expiresAt` from API response:

```js
// In fetchQR():
const j = await r.json();
renderQR(j.token);
// Dynamic countdown from server's expiresAt
const expiresAt = j.expiresAt ? new Date(j.expiresAt) : null;
if (expiresAt) {
  cd = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  cdEl.textContent = cd;
} else {
  cd = QR_SEC;
}
```

---

## 3. Add Error Toast on Token Fetch Failure ✅ DONE

```js
catch(e){
    errEl.textContent = "Token fetch failed — check backend: " + e.message;
    errEl.style.display = "block";
    // Also show a toast notification
    const w = document.getElementById("toasts"), t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = '<div class="tico" style="background:rgba(200,16,46,0.1);border-color:rgba(200,16,46,0.3);">...</div>'
        + '<div><div class="tlbl" style="color:#c8102e;">Token Error</div>...</div>';
    w.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, 5000);
}
```

---

## 4. Align Status Mapping in Queue Display — ⚠️ CORRECTION NEEDED

The QR generator docs describe status mapping as if backend writes `status: "waiting"`. **This is wrong.**

Backend `qrController.js:129` writes `status: "queued"`. This is intentional because mobile app `MainActivity.kt:107` queries for `whereEqualTo("status", "queued")`.

Queue cards should map `status: "queued"` (not `status: "waiting"`) as the default waiting state:

```js
// Correct mapping for AS-BUILT backend:
st === "queued"  → "Naghihintay"   (default — waiting in queue)
// OR handle as "waiting" label from web dashboard side:
st === "waiting" → "Naghihintay"   (if dashboard normalized the status)

// But NOT as the mapping target — backend writes "queued" not "waiting"
```

**Action needed:** QR generator status display must handle `status: "queued"` as the primary waiting indicator, not `status: "waiting"`.

**AS-BUILT status values written by backend:**
- `status: "queued"` — driver is in queue, not yet assigned
- `status: "called"` — driver called to loading
- `status: "loading"` / `status: "in_transit"` — assigned and en route
- `status: "complete"` — trip done

`updateQueueStatus` in qrController.js accepts: `["queued", "waiting", "called", "loading", "in_transit", "complete", "departed", "cancelled"]`

---

## API Response Shapes

### GET /api/qr/generate
```json
{
  "success": true,
  "token": "SYS-XXXXXXXXXXXX",
  "expiresAt": "2026-05-23TXX:XX:XX.XXXZ",
  "scanUrl": "https://sysu-web-5a25d.web.app/scan?token=SYS-XXXXXXXXXXXX"
}
```

### POST /api/qr/scan (AS BUILT — corrected)
```json
// Request body:
{
  "token": "SYS-XXXXXXXXXXXX",
  "driverId": "firebase-uid",
  "driverName": "Juan Dela Cruz",
  "truckType": "6W",
  "truckCompany": "SYSU Internal",
  "plateNumber": "ABC 1234",
  "helperName": "Pedro Santos"
  // driverFN, driverMI, driverLN fields exist in Android model but
  // updateInfoActivity does NOT populate them — only driverName sent
}

// Response (200):
{
  "success": true,
  "message": "Successfully joined the queue",
  "queueId": "firestore-doc-id",
  "queuePosition": 3    // ← NOTE: this field IS returned by current backend
}

// What backend actually writes to queue/ collection:
{
  "id": "firestore-doc-id",
  "driverId": "firebase-uid",
  "driverName": "Juan Dela Cruz",
  "helper": "Pedro Santos",
  "truckCompany": "SYSU Internal",
  "truckType": "6W",
  "plateNumber": "ABC 1234",
  "isAssigned": false,
  "status": "queued",    // ← NOT "waiting"
  "joinedAt": "<Firestore Timestamp>",
  "entryTime": "<Firestore Timestamp>",
  "notes": ""
}
```

The `queuePosition` reflects the driver's FIFO position within their truck type group. This can be shown on the Android's `UpdateInfoActivity` confirmation screen.