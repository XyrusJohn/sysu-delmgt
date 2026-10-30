/**
 * MapTrackingPanel.js
 *
 * Dedicated full-page driver location tracking view.
 *
 * Architecture:
 *  - The main `socket` from api/socket.js carries vendor / assignment events
 *    (update_admin_map, vendor_status_update) from the sysu-app backend.
 *  - `driverSocket` (obtained via getDriverSocket()) connects to the
 *    driver-app server (VITE_DRIVER_TRACKING_URL, default sysu-go-production)
 *    and receives update_admin_map + update_status events from LocationServices.
 *
 *  Both feed the same MapManager marker layer (via updateMarker()).
 *
 *  Entry point:  initTrackingPanel()  →  connectDriverTrackingSocket()
 *  Cleanup:      destroyTrackingPanel()
 */

import {
  initLeafletMap,
  updateMarker,
  removeMarker,
  trackingMarkers,
} from "./MapManager.js";
import { getDriverSocket, connectDriverSocket } from "../api/socket.js";
import { acceptLocationUpdate, GPS_STALE_MS } from "./locationState.js";
import { subscribeRealtime } from "../api/realtimeService.js";

const MARKER_STORE_KEY = "__trackingMarkers";

//  DOM IDs (must match the HTML added to dashboard.html)

const SID = {
  map: "trackingMap", // Leaflet map container
  driverList: "trackingDriverList", // Driver list sidebar
  connDot: "trackingConnDot", // Status dot
  connLabel: "trackingConnLabel", // Status text
  driverCount: "trackingDriverCount", // "N drivers online"
  fitBounds: "trackingFitBounds", // "Fit All" button
  clearOff: "trackingClearOffline", // "Clear Offline" button
};

//  Live runtime state

let _driverSocket = null;
let _markerStore = {}; // driverId → L.Marker
let _driverMeta = new Map(); // driverId → { lat, lng, status, name, lastSeen }
let _connStatus = "disconnected";
let _locationsUnsub = null;
const _closedTrips = new Map();
let _freshnessTimer = null;

//  Public Init

/**
 * One-time Leaflet map initialization for the tracking panel.
 * Call this when the tracking view is first shown.
 */
export function initTrackingPanel() {
  const mapEl = document.getElementById(SID.map);
  if (!mapEl) {
    console.warn("[MapTrackingPanel] #trackingMap not found");
    return;
  }

  const map = initLeafletMap(SID.map);

  //  Expose map reference so map controls (fitAllDrivers, invalidateSize) work
  window.__trackingMap = map;

  //  Ensure Leaflet sizes correctly after container is visible
  setTimeout(() => map?.invalidateSize(), 300);

  //  Start the SQL-backed Socket.IO tracking fallback.
  _subscribeRealtimeDriverLocations();

  return map;
}

function _subscribeRealtimeDriverLocations() {
  if (_locationsUnsub) {
    _locationsUnsub();
    _locationsUnsub = null;
  }
  try {
    _locationsUnsub = subscribeRealtime(
      "locations",
      {},
      (rows) => {
        const current = new Set();
        rows.forEach((row) => {
          const data = { ...row, driverId: row.driverId || row.id };
          current.add(data.driverId);
          _applyDriverUpdate(data, "mysql");
        });
        for (const driverId of _driverMeta.keys()) {
          if (
            !current.has(driverId) &&
            _driverMeta.get(driverId)?.source !== "socket"
          )
            _removeDriver(driverId);
        }
      },
      (err) => {
        console.warn(
          "[MapTrackingPanel] Realtime driver location subscription error:",
          err.message,
        );
      },
    );
  } catch (e) {
    console.warn(
      "[MapTrackingPanel] Failed to subscribe to driver locations:",
      e,
    );
  }
}

/**
 * Connect the driver-location socket.
 * Safe to call repeatedly — disconnects any previous instance first.
 */
export async function connectDriverTrackingSocket() {
  destroyDriverSocket();
  _subscribeRealtimeDriverLocations();
  _driverSocket = getDriverSocket();
  _wireDriverSocket();
  if (_driverSocket?.connected) _onConnect();
  if (!_freshnessTimer)
    _freshnessTimer = setInterval(_refreshLocationAges, 5000);
  await connectDriverSocket();
}

function _wireDriverSocket() {
  if (!_driverSocket) return;

  _driverSocket.off("connect", _onConnect);
  _driverSocket.off("disconnect", _onDisconnect);
  _driverSocket.off("connect_error", _onConnectError);
  _driverSocket.off("update_admin_map", _onDriverMoving);
  _driverSocket.off("update_status", _onDriverStatus);
  _driverSocket.off("vendor_status_update", _onDriverStatus);
  _driverSocket.off("driver_status_change", _onDriverStatus);

  _driverSocket.on("connect", _onConnect);
  _driverSocket.on("disconnect", _onDisconnect);
  _driverSocket.on("connect_error", _onConnectError);
  _driverSocket.on("update_admin_map", _onDriverMoving);
  _driverSocket.on("update_status", _onDriverStatus);
  _driverSocket.on("vendor_status_update", _onDriverStatus);
  _driverSocket.on("driver_status_change", _onDriverStatus);
}

//  Socket Event Handlers

function _onConnect() {
  _setConnStatus("connected");
}

function _onDisconnect() {
  _setConnStatus("disconnected");
}

function _onConnectError(err) {
  console.error("[driverSocket] ✗ CONNECT ERROR:", err?.message ?? err);
  _setConnStatus("reconnecting");
}

function _removeDriver(driverId) {
  removeMarker(driverId, "trackingMap");
  delete _markerStore[driverId];
  _driverMeta.delete(driverId);
  window[MARKER_STORE_KEY] = _markerStore;
  _refreshDriverList();
}

function _applyDriverUpdate(data, source = "socket", kind = "location") {
  const next = acceptLocationUpdate(_driverMeta.get(data?.driverId), data, {
    source,
    kind,
    closedAt: _closedTrips.get(data?.driverId) || 0,
  });
  if (!next) return;
  if (next.removed) {
    _closedTrips.set(next.driverId, next.timestamp);
    if (_closedTrips.size > 1000)
      _closedTrips.delete(_closedTrips.keys().next().value);
    _removeDriver(next.driverId);
    return;
  }
  _driverMeta.set(next.driverId, next);
  _upsertMarker(
    next.driverId,
    next.lat,
    next.lng,
    next.status,
    next.name,
    next.tripStatus,
  );
  _refreshDriverList();
}

function _refreshLocationAges() {
  for (const [id, data] of _driverMeta) {
    if (
      ["online", "returning_to_base", "stopped"].includes(data.status) &&
      Date.now() - data.lastSeen > GPS_STALE_MS
    ) {
      data.status = "stale";
      _upsertMarker(
        id,
        data.lat,
        data.lng,
        data.status,
        data.name,
        data.tripStatus,
      );
    }
  }
  _refreshDriverList();
}

function _onDriverMoving(data) {
  _applyDriverUpdate(data);
}
function _onDriverStatus(data) {
  _applyDriverUpdate(data, "socket", "status");
}

function _upsertMarker(driverId, lat, lng, status, name, tripStatus) {
  //  updateMarker handles both create and update (checks trackingMarkers[driverId] internally).
  //  No need for a separate setLatLng — updateMarker rebuilds the icon and sets position.
  updateMarker({ driverId, lat, lng, status, name, tripStatus }, "trackingMap");

  if (!_markerStore[driverId]) {
    _markerStore[driverId] = trackingMarkers[driverId] ?? null;
    window[MARKER_STORE_KEY] = _markerStore;
  }
}

/** Immediately capture marker references for existing (pre-polled) drivers */
function _captureMarkerRef(driverId) {
  //  Marker was already created synchronously by updateMarker(); grab it now.
  _markerStore[driverId] = trackingMarkers[driverId] ?? null;
  window[MARKER_STORE_KEY] = _markerStore;
}

//  UI Helpers

function _setConnStatus(status) {
  _connStatus = status;
  const dot = document.getElementById(SID.connDot);
  const label = document.getElementById(SID.connLabel);
  if (!dot || !label) return;

  const styles = {
    connected: {
      cls: "bg-green-500  animate-pulse",
      txt: "● Connected",
      color: "text-green-400",
    },
    reconnecting: {
      cls: "bg-yellow-500 animate-pulse",
      txt: "● Reconnecting…",
      color: "text-yellow-400",
    },
    disconnected: {
      cls: "bg-red-500",
      txt: "● Disconnected",
      color: "text-red-400",
    },
  };

  const s = styles[status] ?? styles.disconnected;
  dot.className = `w-2 h-2 rounded-full ${s.cls}`;
  label.textContent = status === "reconnecting"
    ? "Reconnecting — map may be out of date"
    : status === "disconnected"
      ? "Disconnected — map may be out of date"
      : s.txt;
  label.className = `text-[11px] font-bold ${s.color}`;
  label.title = status === "reconnecting"
    ? "Live locations may be old while the map reconnects. Check your connection. If this continues, contact IT."
    : status === "disconnected"
      ? "Live locations are not updating. Check your connection and refresh the map. Contact IT if it stays disconnected."
      : "Live driver locations are updating.";
}

function _refreshDriverList() {
  const list = document.getElementById(SID.driverList);
  const activeCount = Array.from(_driverMeta.values()).filter((d) =>
    ["online", "stopped", "returning_to_base"].includes(d.status),
  ).length;
  for (const id of [SID.driverCount, "trackingSidebarCount"]) {
    const countEl = document.getElementById(id);
    if (countEl) countEl.textContent = activeCount;
  }

  if (!list) return;

  if (_driverMeta.size === 0) {
    list.innerHTML = `
      <div class="flex flex-col items-center justify-center flex-1 gap-4 text-db-text3 opacity-40 px-6 text-center">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
        </svg>
        <p class="text-sm leading-relaxed">No drivers online.<br/>Drivers appear here once their app sends location.</p>
      </div>`;
    return;
  }

  const fmt = (ts) => {
    if (!ts) return "—";
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 5) return "just now";
    if (d < 60) return `${d}s ago`;
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    return `${Math.floor(d / 3600)}h ago`;
  };
  const labels = {
    online: "Moving",
    stopped: "Stopped",
    returning_to_base: "Returning to base",
    offline: "Offline",
    pending: "Awaiting GPS",
    stale: "GPS stale",
  };

  list.innerHTML = Array.from(_driverMeta.entries())
    .sort((a, b) => (b[1].lastSeen ?? 0) - (a[1].lastSeen ?? 0))
    .map(
      ([id, d]) => `
      <div class="flex items-center gap-3 px-4 py-3 border-b border-db-border/40
                  hover:bg-db-item-hover/50 cursor-pointer transition-colors"
           data-driver-id="${_esc(id)}">
        <div class="w-2.5 h-2.5 rounded-full shrink-0 ${d.status === "online" ? "bg-green-500 animate-pulse" : "bg-db-text3"}"></div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-db-text truncate">${_esc(d.name)}</div>
          <div class="text-[10px] text-db-text3 font-mono">${d.lat?.toFixed(5)}, ${d.lng?.toFixed(5)}</div>
          <div class="text-[10px] text-db-text3">${labels[d.status] || "Awaiting GPS"}</div>
        </div>
        <div class="text-[10px] text-db-text3 shrink-0">${fmt(d.lastSeen)}</div>
      </div>`,
    )
    .join("");
  list.querySelectorAll("[data-driver-id]").forEach((row) => {
    row.onclick = () => window.__trackingFlyTo(row.dataset.driverId);
  });
}

//  Map Controls

/** Flies the map to show all active driver markers on the tracking map. */
export function fitAllDrivers() {
  const map = window.__trackingMap;
  if (!map) return;
  const ms = Object.values(trackingMarkers).filter((m) => m?.getLatLng);
  if (!ms.length) return;
  map.flyToBounds(
    ms.map((m) => m.getLatLng()),
    {
      padding: [60, 60],
      duration: 1.2,
      maxZoom: 14,
    },
  );
}

/** Removes offline driver markers from the tracking map. */
export function clearOfflineDrivers() {
  const map = window.__trackingMap;
  if (!map) return;
  Object.entries(trackingMarkers).forEach(([id, marker]) => {
    const meta = _driverMeta.get(id);
    if (!meta || meta.status !== "online") {
      try {
        map.removeLayer(marker);
      } catch (_) {
        /* Best-effort cleanup; the view is already dismissed. */
      }
      delete trackingMarkers[id];
      delete _markerStore[id];
    }
  });
  _refreshDriverList();
}

/** Fly map to a specific driver by ID (exposed for onclick in the driver-list sidebar) */
window.__trackingFlyTo = (driverId) => {
  const marker = trackingMarkers[driverId];
  if (marker?.getLatLng) {
    const { lat, lng } = marker.getLatLng();
    (window.__trackingMap ?? window.map)?.flyTo([lat, lng], 15, {
      duration: 1.2,
    });
  }
};

//  Lifecycle

export function destroyTrackingPanel() {
  destroyDriverSocket();
  _locationsUnsub?.();
  _locationsUnsub = null;
  if (_freshnessTimer) clearInterval(_freshnessTimer);
  _freshnessTimer = null;
  for (const id of _driverMeta.keys()) removeMarker(id, "trackingMap");
  _driverMeta.clear();
  _closedTrips.clear();
  _markerStore = {};
  window[MARKER_STORE_KEY] = {};
  _connStatus = "disconnected";
}

function destroyDriverSocket() {
  if (!_driverSocket) return;
  _driverSocket.off("connect", _onConnect);
  _driverSocket.off("disconnect", _onDisconnect);
  _driverSocket.off("connect_error", _onConnectError);
  _driverSocket.off("update_admin_map", _onDriverMoving);
  _driverSocket.off("update_status", _onDriverStatus);
  _driverSocket.off("vendor_status_update", _onDriverStatus);
  _driverSocket.off("driver_status_change", _onDriverStatus);
  _driverSocket = null;
}

function _esc(str) {
  if (str == null) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
