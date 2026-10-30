import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  clearMarkers,
  disposeLeafletMap,
  initLeafletMap,
  markers,
  seedMarker,
  updateMarker,
} from "./MapManager.js";

describe("Real Leaflet tracking markers", () => {
  let map;
  beforeAll(() => {
    document.body.innerHTML = '<div id="map"></div>';
    const container = document.getElementById("map");
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 700 },
    });
    container.getBoundingClientRect = () => ({
      width: 1200,
      height: 700,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 700,
    });
    map = initLeafletMap();
  });
  beforeEach(() => clearMarkers());
  afterAll(() => {
    clearMarkers();
    map.remove();
  });
  const fix = {
    driverId: "synthetic-driver",
    lat: 14.5,
    lng: 121,
    status: "online",
    name: "Synthetic Driver",
  };

  it("keeps zooming and panning within the Philippines viewing area", () => {
    expect(map.options.zoomSnap).toBe(0);
    expect(map.options.maxZoom).toBe(19);
    expect(map.getMinZoom()).toBeGreaterThanOrEqual(5);
    expect(map.options.maxBounds.getSouthWest().lat).toBe(4.3);
    expect(map.options.maxBounds.getSouthWest().lng).toBe(115.5);
    expect(map.options.maxBounds.getNorthEast().lat).toBe(21.5);
    expect(map.options.maxBounds.getNorthEast().lng).toBe(127.5);
    expect(map.options.maxBoundsViscosity).toBe(1);
    map.setZoom(0);
    expect(map.getZoom()).toBe(map.getMinZoom());
    expect(map.getBounds().contains(map.options.maxBounds)).toBe(true);
    map.setZoom(11);
  });

  it("reuses the overview map configuration and can safely recreate a secondary map", () => {
    const secondary = document.createElement("div");
    secondary.id = "driverActionMap";
    document.body.appendChild(secondary);
    Object.defineProperties(secondary, {
      clientWidth: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 700 },
    });
    secondary.getBoundingClientRect = () => ({
      width: 1200,
      height: 700,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 700,
    });
    const first = initLeafletMap("driverActionMap");
    expect(first.options.maxBounds.getSouthWest().lat).toBe(4.3);
    expect(first.options.maxBounds.getNorthEast().lng).toBe(127.5);
    disposeLeafletMap("driverActionMap");
    const second = initLeafletMap("driverActionMap");
    expect(second).not.toBe(first);
    disposeLeafletMap("driverActionMap");
    secondary.remove();
  });

  it("uses the minimal basemap and keeps required provider attribution visible", () => {
    expect(map.options.attributionControl).toBe(true);
    expect(map.attributionControl.options.prefix).toBe(false);
    const tileLayers = Object.values(map._layers).filter((layer) => layer._url);
    const baseLayer = tileLayers.find((layer) => layer._url.includes("World_Light_Gray_Base"));
    const detailedLayer = tileLayers.find((layer) => layer._url.includes("World_Street_Map"));
    expect(baseLayer?._url).toBe(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    );
    expect(baseLayer?.options.maxNativeZoom).toBe(16);
    expect(detailedLayer?.options.minZoom).toBe(16);
    expect(detailedLayer?.options.maxZoom).toBe(19);
    expect(detailedLayer?._url).toBe(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    );
    expect(baseLayer?.options.attribution).toContain("Esri");
    expect(baseLayer?.options.attribution).toContain("OpenStreetMap");
    expect(baseLayer?.options.attribution).toContain("<summary>Map credits</summary>");
  });

  it("moves an existing marker without rebuilding its icon", () => {
    updateMarker(fix);
    const marker = markers[fix.driverId];
    const icon = vi.spyOn(marker, "setIcon");
    updateMarker({ ...fix, lat: 14.6 });
    expect(markers[fix.driverId]).toBe(marker);
    expect(marker.getLatLng().lat).toBe(14.6);
    expect(icon).not.toHaveBeenCalled();
  });
  it("ignores a pending resize after a map is disposed", () => {
    vi.useFakeTimers();
    try {
      document.body.insertAdjacentHTML("beforeend", '<div id="temporaryMap"></div>');
      initLeafletMap("temporaryMap");
      disposeLeafletMap("temporaryMap");
      expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects malformed fixes and accepts zero coordinates", () => {
    updateMarker({ ...fix, lat: NaN });
    expect(markers[fix.driverId]).toBeUndefined();
    updateMarker({ ...fix, lat: 0, lng: 0 });
    expect(markers[fix.driverId].getLatLng().lat).toBe(0);
  });
  it("escapes driver and shipment text in popups and marker labels", () => {
    updateMarker({
      ...fix,
      name: "<img src=x onerror=alert(1)>",
      shipmentId: "<script>x</script>",
    });
    const element = document.createElement("div");
    element.innerHTML = markers[fix.driverId].getPopup().getContent();
    expect(element.querySelector("img,script")).toBeNull();
    expect(element.textContent).toContain("<script>x</script>");
  });
  it("uses theme tokens and light-theme-safe status colors in map popups", () => {
    updateMarker({ ...fix, status: "online", shipmentId: "SHIPMENT-1" });
    const popup = markers[fix.driverId].getPopup().getContent();
    expect(popup).toContain('class="flm-popup"');
    expect(popup).toContain('class="flm-status-chip"');
    expect(popup).toContain("--status-color-light:#166534");
  });
  it("shows a generic map icon label only while the trip is in transit", () => {
    updateMarker({ ...fix, tripStatus: "loading" });
    const marker = markers[fix.driverId];
    expect(marker.options.icon.options.html).toContain("Synthetic Driver");

    updateMarker({ ...fix, tripStatus: "in_transit" });
    expect(markers[fix.driverId]).toBe(marker);
    expect(marker.options.icon.options.html).toContain(">Driver</div>");
    expect(marker.options.icon.options.html).not.toContain("Synthetic Driver");
    expect(marker.getPopup().getContent()).toContain("Synthetic Driver");

    updateMarker({ ...fix, tripStatus: "completed" });
    expect(marker.options.icon.options.html).toContain("Synthetic Driver");
  });
  it("shows returning state and never seeds an invented location", () => {
    expect(seedMarker({ driverId: fix.driverId })).toBe(false);
    updateMarker({ ...fix, status: "returning_to_base" });
    expect(markers[fix.driverId].getPopup().getContent()).toContain(
      "Returning to base",
    );
    clearMarkers();
    expect(Object.keys(markers)).toEqual([]);
  });
});
