/**
 * MapManager.js — Premium Fleet Marker
 *
 * Design: Exact truck.svg at 40px, circular status ring, radar ping for live trucks.
 * No SVG modifications — your truck delivered as-is.
 */

import L from "leaflet";
import truckSvg from "../../public/truck.svg?raw";
import { validLocation } from "./locationState.js";
const safeText = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

//  Registry

const _defaultId = "map";
const _reg = {};
const _e = (id = _defaultId) =>
  (_reg[id] ??= { map: null, tileLayer: null, detailTileLayer: null, markers: {} });
export const PHILIPPINES_BOUNDS = L.latLngBounds([
  [4.3, 115.5],
  [21.5, 127.5],
]);

export const constrainMapToPhilippines = (map) => {
  const constrainMinimumZoom = () => {
    const size = map.getSize().subtract(L.point(48, 48));
    if (!size.x || !size.y) return;
    const northWest = PHILIPPINES_BOUNDS.getNorthWest();
    const southEast = PHILIPPINES_BOUNDS.getSouthEast();
    const boundsSize = L.bounds(
      map.project(southEast, 0),
      map.project(northWest, 0),
    ).getSize();
    const scale = Math.min(size.x / boundsSize.x, size.y / boundsSize.y);
    const fitZoom = map.getScaleZoom(scale, 0);
    if (Number.isFinite(fitZoom)) {
      const minZoom = L.Browser.any3d
        ? fitZoom
        : Math.max(5, Math.floor(fitZoom));
      map.setMinZoom(minZoom);
    }
  };

  map.on("resize", constrainMinimumZoom);
  map.on("zoomend", () => {
    if (map.getZoom() <= map.getMinZoom() + 0.001) {
      map.panTo(PHILIPPINES_BOUNDS.getCenter(), { animate: false });
    }
  });
  constrainMinimumZoom();
};

export const markers = _e(_defaultId).markers;
export const trackingMarkers = _e("trackingMap").markers;

const mapCredits = `<details class="map-credit-disclosure"><summary>Map credits</summary><div><strong>Minimal map:</strong> Tiles &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, GIS user community.<br><strong>Street details:</strong> Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, GIS user community.</div></details>`;

export const addMinimalMapTiles = (map, containerId = "map") => {
  const baseLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { maxNativeZoom: 16, maxZoom: 19, attribution: mapCredits },
  ).addTo(map);
  const detailLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    { minZoom: 16, maxNativeZoom: 19, maxZoom: 19, attribution: mapCredits },
  ).addTo(map);

  [baseLayer, detailLayer].forEach((layer) => {
    layer.on("tileerror", (errorEvent) => {
      console.error(`[MapManager:${containerId}] Tile failed to load:`, {
        tileSrc: errorEvent.tile?.src,
        coords: errorEvent.coords,
        error: errorEvent.error,
      });
    });
  });
  return { baseLayer, detailLayer };
};

export const initLeafletMap = (containerId = _defaultId) => {
  const e = _e(containerId);
  if (e.map) {
    return e.map;
  }

  e.map = L.map(containerId, {
    center: [14.5995, 120.9842],
    zoom: 11,
    zoomSnap: 0,
    minZoom: 5,
    maxZoom: 19,
    maxBounds: PHILIPPINES_BOUNDS,
    maxBoundsViscosity: 1,
    zoomControl: false,
    attributionControl: true,
  });
  e.map.attributionControl?.setPrefix(false);
  e.map.attributionControl?.setPosition("bottomright");
  constrainMapToPhilippines(e.map);

  const tileLayers = addMinimalMapTiles(e.map, containerId);
  e.tileLayer = tileLayers.baseLayer;
  e.detailTileLayer = tileLayers.detailLayer;

  _injectCSS();

  const initializedMap = e.map;
  setTimeout(() => {
    if (_reg[containerId] !== e || e.map !== initializedMap) return;
    initializedMap.invalidateSize();
    constrainMapToPhilippines(initializedMap);
  }, 400);
  if (containerId === _defaultId) window.map = e.map;

  return e.map;
};

export const disposeLeafletMap = (containerId) => {
  const entry = _reg[containerId];
  if (!entry) return;
  Object.values(entry.markers).forEach((marker) => marker.remove());
  entry.map?.remove();
  if (containerId === _defaultId) {
    Object.keys(entry.markers).forEach((key) => delete entry.markers[key]);
    entry.map = null;
    entry.tileLayer = null;
    entry.detailTileLayer = null;
    window.map = null;
  } else {
    delete _reg[containerId];
  }
};

//  CSS

let _cssDone = false;
const _injectCSS = () => {
  if (_cssDone) return;
  _cssDone = true;

  const s = document.createElement("style");
  s.id = "_flm-css";
  s.innerHTML = `
    /* Marker outer shell */
    .flm-wrap {
      position: relative;
      width: 44px; height: 44px;
      cursor: pointer;
      margin-left: -22px; margin-top: -22px;
    }

    /* Status ring */
    .flm-ring {
      position: absolute; inset: 1px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 2px solid var(--rc, #64748B);
      background: #fff;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.28);
    }

    /* Truck SVG inside ring */
    .flm-trk {
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .flm-trk svg {
      width: 30px; height: 30px;
      /* truck SVG renders at exact original colors — no fill overrides */
    }

    /* ── Radar ping for live trucks ───────────────────────────────────────────── */
    /* ── Tooltip ──────────────────────────────────────────────────────────────── */
    .flm-tip {
      position: absolute; bottom: calc(100% + 5px); left: 50%;
      transform: translateX(-50%);
      padding: 3px 7px; border-radius: 4px;
      background: var(--map-popup-surface, #fff);
      color: var(--map-popup-text, #1f2937); font-size: 11px; font-weight: 600;
      white-space: nowrap; opacity: 0; pointer-events: none; z-index: 20;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.18);
    }
    .flm-status-chip { color: var(--status-color); }
    [data-theme="light"] .flm-status-chip { color: var(--status-color-light, var(--status-color)); }
    .flm-popup {
      min-width: 180px;
      padding: 10px 12px;
      background: var(--map-popup-surface, #fff);
      color: var(--map-popup-text, #1f2937);
      font: 13px/1.4 'DM Sans', sans-serif;
    }
    .flm-popup__heading,
    .flm-popup__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .flm-popup__heading { padding-right: 18px; }
    .flm-popup__heading > strong,
    .flm-popup__row > strong { overflow-wrap: anywhere; }
    .flm-popup__row {
      justify-content: flex-start;
      margin-top: 7px;
      color: var(--map-popup-muted, #64748b);
      font-size: 12px;
    }
    .flm-popup__row > strong { color: var(--map-popup-text, #1f2937); font-weight: 600; }
    .flm-popup .flm-status-chip { padding: 2px 6px; border-radius: 999px; font-size: 10px; }
    .flm-wrap:hover .flm-tip { opacity: 1; transform: translateX(-50%) translateY(0); }

    /* ── Hover: glow lift ──────────────────────────────────────────────────────── */
    .flm-wrap:hover .flm-ring {
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.3);
    }

    /* ── Marker glide ───────────────────────────────────────────────────────────── */
    .leaflet-marker-icon {
      transition: transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.25s;
    }

    /* ── Popup ──────────────────────────────────────────────────────────────── */
    .leaflet-popup-content-wrapper.flm-pop {
      background: var(--map-popup-surface, #fff); border-radius: 8px;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.2);
      padding: 0; overflow: hidden;
    }
    .leaflet-popup-content-wrapper.flm-pop .leaflet-popup-content { margin: 0; }
    .leaflet-popup-tip-container { display: none; }
    .leaflet-popup-close-button {
      color: var(--map-popup-muted, #64748b) !important;
      font-size: 16px !important; top: 7px !important; right: 8px !important;
    }
    .leaflet-popup-close-button:hover { color: var(--map-popup-text, #fff) !important; }`;
  document.head.appendChild(s);
};

//  Status config

const ST = {
  returning_to_base: {
    rc: "#3B82F6",
    lightRc: "#1E40AF",
    rg: "rgba(59,130,246,0.25)",
    lbl: "Returning to base",
  },
  stale: {
    rc: "#64748B",
    lightRc: "#475569",
    rg: "rgba(100,116,139,0.25)",
    lbl: "GPS stale",
  },
  online: {
    rc: "#10B981",
    lightRc: "#166534",
    rg: "rgba(16,185,129,0.32)",
    lbl: "Moving",
  },
  idle: {
    rc: "#F59E0B",
    lightRc: "#92400E",
    rg: "rgba(245,158,11,0.26)",
    lbl: "Idle",
  },
  delayed: {
    rc: "#F97316",
    lightRc: "#9A3412",
    rg: "rgba(249,115,22,0.26)",
    lbl: "Delayed",
  },
  stopped: {
    rc: "#EF4444",
    lightRc: "#991B1B",
    rg: "rgba(239,68,68,0.26)",
    lbl: "Stopped",
  },
  offline: {
    rc: "#EF4444",
    lightRc: "#991B1B",
    rg: "rgba(239,68,68,0.25)",
    lbl: "Offline",
  },
  //  Marker seeded from persisted lastLocation, but real-time GPS hasn't
  //  arrived yet (or driver app is paused / stationary). Amber color so it's
  //  visually distinct from "real" online markers.
  pending: {
    rc: "#A78BFA",
    lightRc: "#6B21A8",
    rg: "rgba(167,139,250,0.30)",
    lbl: "Awaiting GPS",
  },
};
const _st = (s) => ST[s] ?? ST.offline;

//  Default fallback coordinates when no real GPS has arrived yet. Manila
//  center — same as the map's initial center so the marker is at least
//  visible somewhere sensible.
const FALLBACK_LAT = 14.5995;
const FALLBACK_LNG = 120.9842;

//  Popup HTML

const _popup = ({ name, shipmentId, lat, lng }, cfg) => `
<div class="flm-popup">
  <div class="flm-popup__heading">
    <strong>${name || "Unknown Driver"}</strong>
    <span class="flm-status-chip" style="--status-color:${cfg.rc};--status-color-light:${cfg.lightRc || cfg.rc};background:${cfg.rc}18">${cfg.lbl}</span>
  </div>
  ${shipmentId ? `<div class="flm-popup__row"><span>Shipment</span><strong>${shipmentId}</strong></div>` : ""}
  <div class="flm-popup__row"><span>Location</span><strong>${lat != null && lng != null ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : "No GPS"}</strong></div>
</div>`;

/**
 * @param {{ driverId, lat, lng, name, status, shipmentId, tripStatus }} driver
 * @param {string} [containerId="map"]
 */
export const updateMarker = (
  { driverId, lat, lng, name, status, shipmentId, tripStatus },
  containerId = _defaultId,
) => {
  const e = _e(containerId);
  if (!e.map || !validLocation(lat, lng) || !driverId) {
    return;
  }
  const previous = e.markers[driverId]?._sysuLocation;
  if (
    previous &&
    previous.name === name &&
    previous.status === status &&
    previous.shipmentId === shipmentId &&
    previous.tripStatus === tripStatus
  ) {
    if (previous.lat !== lat || previous.lng !== lng) {
      e.markers[driverId].setLatLng([lat, lng]);
      e.markers[driverId].getPopup()?.setContent(
        _popup(
          {
            name: safeText(name),
            driverId: safeText(driverId),
            shipmentId: safeText(shipmentId),
            lat,
            lng,
          },
          _st(status),
        ),
      );
    }
    e.markers[driverId]._sysuLocation = { lat, lng, name, status, shipmentId };
    return;
  }
  const rawName = name;
  name = safeText(name);
  _injectCSS();

  const cfg = _st(status);
  const markerLabel =
    String(tripStatus ?? "")
      .trim()
      .toLowerCase() === "in_transit"
      ? "Driver"
      : name || "Unknown Driver";

  const icon = L.divIcon({
    className: "",
    html: `
      <div class="flm-wrap">
        <div class="flm-ring" style="--rc:${cfg.rc}">
          <div class="flm-trk">${truckSvg}</div>
        </div>
        <div class="flm-tip" style="--rc:${cfg.rc}">${markerLabel}</div>
      </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });

  if (e.markers[driverId]) {
    e.markers[driverId].setLatLng([lat, lng]);
    e.markers[driverId].setIcon(icon);
    e.markers[driverId].getPopup()?.setContent(
      _popup(
        {
          name,
          driverId: safeText(driverId),
          shipmentId: safeText(shipmentId),
          lat,
          lng,
        },
        cfg,
      ),
    );
  } else {
    e.markers[driverId] = L.marker([lat, lng], { icon })
      .addTo(e.map)
      .bindPopup(
        _popup(
          {
            name,
            driverId: safeText(driverId),
            shipmentId: safeText(shipmentId),
            lat,
            lng,
          },
          cfg,
        ),
        { className: "flm-pop", maxWidth: 260 },
      );
  }
  e.markers[driverId]._sysuLocation = {
    lat,
    lng,
    name: rawName,
    status,
    shipmentId,
    tripStatus,
  };
};

/**
 * Render a marker for a driver even when no real GPS coordinates have
 * arrived yet. Uses the dispatch record's `lastLocation` if available, and
 * falls back to Manila center coordinates with status "pending" so the
 * dispatcher sees a marker the moment they reload the page (instead of an
 * empty map while waiting for the driver app to start emitting).
 *
 * The marker auto-updates as soon as `updateMarker()` is called with real
 * coordinates from a live `driver_moving` event — `pending` is purely the
 * initial seed visual.
 *
 * @param {{ driverId: string, name?: string, shipmentId?: string,
 *           lat?: number|null, lng?: number|null, hasRealGps?: boolean }} input
 * @param {string} [containerId="map"]
 */
export const seedMarker = (input, containerId = _defaultId) => {
  const { driverId, name, shipmentId, lat, lng } = input;
  if (!driverId) return false;

  const realLat = lat;
  const realLng = lng;
  const hasRealGps = validLocation(lat, lng);

  //  Do NOT draw ghost marker at fallback coords if the truck has not sent real GPS
  if (!hasRealGps) {
    return false;
  }

  updateMarker(
    {
      driverId,
      lat: realLat,
      lng: realLng,
      name: name || "Unknown Driver",
      status: "offline",
      shipmentId: shipmentId || null,
    },
    containerId,
  );
  return true;
};

//  Helpers

export const focusOnLocation = (lat, lng, containerId = _defaultId) =>
  _e(containerId).map?.flyTo([lat, lng], 14, { duration: 1.5 });

export const clearMarkers = (containerId = _defaultId) => {
  const e = _e(containerId);
  Object.values(e.markers).forEach((m) => m.remove());
  for (const id of Object.keys(e.markers)) delete e.markers[id];
};

/** Remove a single driver's marker from the map (used when driver explicitly ends trip with no last known position). */
export const removeMarker = (driverId, containerId = _defaultId) => {
  const e = _e(containerId);
  if (e.markers[driverId]) {
    e.markers[driverId].remove();
    delete e.markers[driverId];
  }
};

export const switchMapTheme = (theme, containerId = _defaultId) => {
  //  CSS applies the monochrome theme without reloading tiles or altering labels.
  void theme;
  void containerId;
};
