import L from "leaflet";
import {
  DriverActionService,
  driverActionCoordinates,
  driverActionDurations,
  driverActionRouteSegments,
  driverActionTimestamp,
  eventsNewestFirst,
  newestFirst,
} from "../api/driverActionService.js";
import {
  buildShipmentActivityCsv,
  shipmentActivityFileName,
  shipmentActivityShipmentIds,
} from "../api/shipmentActivityCsv.js";
import { validLocation } from "./locationState.js";
import { disposeLeafletMap, initLeafletMap } from "./MapManager.js";

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const timestamp = (value) => {
  const ms = driverActionTimestamp(value);
  if (!Number.isFinite(ms) || ms <= 0) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(ms));
};
const actionLabel = (value) =>
  ({
    app_open: "App opened",
    qr_scan_opened: "QR scanner opened",
    qr_scan: "QR scanned",
    registration_opened: "Trip registration opened",
    trip_registration: "Trip registration",
    trip_confirmation: "Trip confirmation requested",
    queue_joined: "Joined queue",
    shipment_assigned: "Shipment assigned",
    loading_started: "Loading started",
    loading_cancelled: "Loading cancelled",
    fully_loaded: "Fully loaded",
    verification_cancelled: "Verification cancelled",
    guard_verified: "Guard verified",
    transit_started: "Trip started",
    active_shipment_selected: "Active shipment selected",
    warehouse_arrival_confirmed: "Warehouse arrival confirmed",
    route_point: "Route location",
    unloading_started: "Unloading started",
    pod_captured: "POD captured",
    all_deliveries_completed: "All deliveries completed",
    return_prompt_opened: "Return-to-base prompt opened",
    return_to_base_requested: "Return to base confirmed",
    returning_to_base: "Returning to base",
    arrival_confirmation_opened: "Warehouse arrival confirmation opened",
    arrived_at_warehouse: "Arrived at warehouse",
    session_completed: "Driver session completed",
  })[value] ||
  String(value || "Action")
    .replaceAll("_", " ")
    .replace(/^./, (char) => char.toUpperCase());
const durationLabel = (durationMs) => {
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60),
    remaining = seconds % 60;
  if (minutes < 60)
    return remaining ? `${minutes} min ${remaining} sec` : `${minutes} min`;
  const hours = Math.floor(minutes / 60),
    remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${hours} hr ${remainingMinutes} min`
    : `${hours} hr`;
};
const MAX_EXPORT_EVENTS = 50000;
const MAX_EXPORT_SESSIONS = 2000;
const activityDateKey = (value) => {
  const time = driverActionTimestamp(value);
  if (!time) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map(({type, value: part}) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
};
const actionMarkerKind = (eventType) => {
  if (["app_open", "qr_scan_opened", "qr_scan", "registration_opened", "trip_registration"].includes(eventType)) return "screen";
  if (["queue_joined", "trip_confirmation"].includes(eventType)) return "queue";
  if (["shipment_assigned", "active_shipment_selected"].includes(eventType)) return "shipment";
  if (["loading_started", "loading_cancelled", "fully_loaded", "verification_cancelled", "guard_verified"].includes(eventType)) return "loading";
  if (["transit_started"].includes(eventType)) return "transit";
  if (["unloading_started", "pod_captured", "all_deliveries_completed"].includes(eventType)) return "delivery";
  return "warehouse";
};
const actionMarkerGlyph = (kind) => ({
  screen: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M9 5.5h6M10 18.5h4"/>',
  queue: '<path d="M8 4H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 11h8M8 15h6"/>',
  shipment: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21"/>',
  loading: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/>',
  transit: '<path d="M4 17 17 4M7 4h10v10"/><path d="M4 20h16"/>',
  delivery: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
  warehouse: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1V10Z"/>',
}[kind] || '<circle cx="12" cy="12" r="7"/>');
const podCameraGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M12 16C13.6569 16 15 14.6569 15 13C15 11.3431 13.6569 10 12 10C10.3431 10 9 11.3431 9 13C9 14.6569 10.3431 16 12 16Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 16.8V9.2C3 8.0799 3 7.51984 3.21799 7.09202C3.40973 6.71569 3.71569 6.40973 4.09202 6.21799C4.51984 6 5.0799 6 6.2 6H7.25464C7.37758 6 7.43905 6 7.49576 5.9935C7.79166 5.95961 8.05705 5.79559 8.21969 5.54609C8.25086 5.49827 8.27836 5.44328 8.33333 5.33333C8.44329 5.11342 8.49827 5.00346 8.56062 4.90782C8.8859 4.40882 9.41668 4.08078 10.0085 4.01299C10.1219 4 10.2448 4 10.4907 4H13.5093C13.7552 4 13.8781 4 13.9915 4.01299C14.5833 4.08078 15.1141 4.40882 15.4394 4.90782C15.5017 5.00345 15.5567 5.11345 15.6667 5.33333C15.7216 5.44329 15.7491 5.49827 15.7803 5.54609C15.943 5.79559 16.2083 5.95961 16.5042 5.9935C16.561 6 16.6224 6 16.7454 6H17.8C18.9201 6 19.4802 6 19.908 6.21799C20.2843 6.40973 20.5903 6.71569 20.782 7.09202C21 7.51984 21 8.0799 21 9.2V16.8C21 17.9201 21 18.4802 20.782 18.908C20.5903 19.2843 20.2843 19.5903 19.908 19.782C19.4802 20 18.9201 20 17.8 20H6.2C5.0799 20 4.51984 20 4.09202 19.782C3.71569 19.5903 3.40973 19.2843 3.21799 18.908C3 18.4801 3 17.9201 3 16.8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const podPreviewButton = (item) =>
  item.eventType === "pod_captured" && item.subjectId && item.metadata?.obdRef
    ? `<button type="button" data-view-pod data-shipment="${escapeHtml(item.subjectId)}" data-obd="${escapeHtml(item.metadata.obdRef)}" class="mt-2 inline-flex min-h-10 items-center rounded border border-sysu-red px-3 py-2 text-sm font-medium text-sysu-red hover:bg-sysu-red/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sysu-red">View POD</button>`
    : "";
const actionEventDetails = (item, duration) => {
  const [lat, lng] = driverActionCoordinates(item);
  const durationText = duration
    ? `<br>${escapeHtml(duration.basis.replaceAll("_", " "))}: ${escapeHtml(durationLabel(duration.durationMs))}`
    : "";
  const metadataText = ["shipmentCount", "phase", "errorCode"]
    .filter((field) => item.metadata?.[field] != null)
    .map((field) => `<br>${escapeHtml(field)}: ${escapeHtml(item.metadata[field])}`)
    .join("");
  const references = item.eventType === "pod_captured"
    ? `${item.subjectId ? `<br>Shipment #: ${escapeHtml(item.subjectId)}` : ""}${item.metadata?.obdRef ? `<br>OBD #: ${escapeHtml(item.metadata.obdRef)}` : ""}`
    : `${item.subjectId ? `<br>Reference: ${escapeHtml(item.subjectId)}` : ""}${item.metadata?.obdRef ? `<br>OBD: ${escapeHtml(item.metadata.obdRef)}` : ""}`;
  return `<div class="driver-action-event-details">Outcome: ${escapeHtml(item.outcome || "unknown")}${durationText}<br>Location: ${escapeHtml(item.locationState || "unavailable")}<br>Recorded GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}${references}${item.accuracy != null ? `<br>GPS accuracy: ${escapeHtml(item.accuracy)} m` : ""}${metadataText}</div>`;
};
const actionMarkerIconHtml = (events) => {
  const isPodGroup = events.every((item) => item.eventType === "pod_captured");
  const count = events.length > 1 ? `<span class="driver-action-marker__count">${events.length}</span>` : "";
  const glyph = isPodGroup
    ? podCameraGlyph
    : events.length > 1
      ? `<span class="driver-action-marker__count">${events.length}</span>`
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="10" r="3" fill="currentColor" stroke="none"/></svg>';
  return `<span class="driver-action-marker${isPodGroup ? " driver-action-marker--pod" : ""}" aria-hidden="true">${glyph}${isPodGroup ? count : ""}</span>`;
};

export class DriverActionView {
  constructor({ container, drivers, liveTracking, canView, isAdmin = false, onSelect, onViewPod }) {
    this.container = container;
    this.drivers = drivers || [];
    this.liveTracking = liveTracking || {};
    this.canView = canView;
    this.isAdmin = isAdmin;
    this.onSelect = onSelect;
    this.onViewPod = onViewPod;
    this.selectedDriver = null;
    this.sessions = [];
    this.sessionsNextCursor = null;
    this.filteredSessions = null;
    this._sessionFilterEvents = new Map();
    this._sessionFilterGeneration = 0;
    this._shipmentSearchTimer = null;
    this._shipmentSearchGeneration = 0;
    this._shipmentMatches = new Map();
    this._shipmentSearchStatus = "Search by driver, company, or any 3 characters of a shipment number. Spaces and dashes are okay.";
    this._sessionFilterTimer = null;
    this._driverDrawerController = null;
    this.events = [];
    this._eventLoads = new Map();
    this.activePlotSessionId = null;
    this.deleteRequests = [];
    this._requestPending = false;
    this.map = null;
    this.route = null;
    this.routeCasing = null;
    this.routeLayers = [];
    this.routeCasingLayers = [];
    this.routeFilterPhase = null;
    this.handleMapClick = (event) => {
      if (event?.layer?._driverActionPhase) return;
      this._setRoutePhaseFilter(null);
    };
    this.handlePopupOpen = (event) => {
      event?.popup?.getElement?.()?.querySelectorAll("[data-view-pod]").forEach((button) => {
        button.addEventListener("click", () => {
          this.onViewPod?.(button.dataset.shipment, button.dataset.obd);
        });
      });
    };
    this.routePointMarkers = new Map();
    this.selectedRoutePointMarker = null;
    this.updating = this._onUpdated.bind(this);
  }

  mount() {
    if (!this.canView) {
      this.container.innerHTML =
        '<div class="flex-1 grid place-items-center text-db-text3">Driver Action is available to fleet managers and administrators.</div>';
      return;
    }
    this.container.innerHTML = `
          <div id="driverActionScreen" class="flex flex-1 min-h-0 bg-db-bg">
            <aside id="driverActionDirectoryPanel" class="w-[290px] shrink-0 border-r border-db-border bg-db-panel flex flex-col">
              <div class="p-4 border-b border-db-border"><div class="flex items-center justify-between gap-2"><div><div class="text-xs font-bold uppercase tracking-widest text-db-text">Driver Action</div><div class="mt-1 text-[11px] text-db-text3">Driver sessions and action history</div></div>${this.isAdmin ? '<button id="driverActionReviewRequests" type="button" class="rounded-md border border-db-border px-2 py-1.5 text-[10px] font-semibold text-db-text2 hover:bg-db-item-hover">Review requests</button>' : ""}</div>
                <input id="driverActionSearch" type="search" autocomplete="off" placeholder="Search drivers, companies, or shipment #" aria-label="Search drivers, companies, or shipment number" class="mt-3 w-full rounded-lg border border-db-border bg-db-bg px-3 py-2 text-xs text-db-text outline-none focus:border-sysu-red/60" />
                <p id="driverActionSearchStatus" role="status" class="mt-2 text-[10px] text-db-text3"></p>
              </div><div id="driverActionDirectory" class="flex-1 overflow-y-auto p-2"></div>
            </aside>
            <section class="relative min-w-0 flex-1 overflow-hidden"><div id="driverActionMap" class="absolute inset-0"></div>
              <button id="driverActionDirectoryToggle" type="button" class="driver-action-directory-toggle" aria-controls="driverActionDirectoryPanel" aria-expanded="false">Drivers</button>
              <div id="driverActionPlotStatus" role="status" class="absolute top-4 left-4 z-[500] max-w-[min(28rem,calc(100%-2rem))] rounded-lg bg-db-panel/90 px-3 py-2 text-xs text-db-text">Select a driver, then load a session plot. Location points come from the driver app.</div>
              <details id="driverActionMapKey" class="driver-action-map-key absolute bottom-4 left-4 z-[500]"><summary>Map key</summary><div class="driver-action-map-key__panel"><div class="driver-action-map-key__grid"><span><i class="driver-action-map-key__action"></i>Action</span><span><i class="driver-action-map-key__pod"></i>POD</span><span><i class="driver-action-map-key__gps"></i>GPS</span></div><div class="driver-action-map-key__routes"><div class="driver-action-map-key__route"><i aria-hidden="true"></i>Outbound</div><div class="driver-action-map-key__route driver-action-map-key__route--returning"><i aria-hidden="true"></i>Return</div></div></div></details>
              <aside id="driverActionDrawer" class="absolute inset-y-0 right-0 z-[600] flex w-[460px] max-w-[94vw] translate-x-full flex-col border-l border-db-border bg-db-panel/95 shadow-2xl backdrop-blur transition-transform duration-200" aria-label="Driver action details" aria-hidden="true"></aside>
            </section>
          </div>`;
    this.map = initLeafletMap("driverActionMap");
    this._renderDirectory();
    this.container
      .querySelector("#driverActionSearch")
      .addEventListener("input", () => this._onDirectorySearch());
    this.container
      .querySelector("#driverActionDirectoryToggle")
      .addEventListener("click", () => {
        const panel = this.container.querySelector("#driverActionDirectoryPanel");
        this._setDirectoryOpen(!panel?.classList.contains("is-open"));
      });
    this.map.on?.("click", this.handleMapClick);
    this.map.on?.("popupopen", this.handlePopupOpen);
    this.container
      .querySelector("#driverActionDirectory")
      .addEventListener("click", (event) => {
        const exportButton = event.target.closest("[data-driver-export]");
        if (exportButton) {
          this.selectDriver(exportButton.dataset.driverId, exportButton.dataset.shipmentId || "", true);
          return;
        }
        const button = event.target.closest("[data-driver-id]");
        if (button) this.selectDriver(button.dataset.driverId, button.dataset.shipmentId || "");
      });
    this.container.querySelector("#driverActionReviewRequests")?.addEventListener("click", () => this._openDeletionRequests());
    this.unsubscribe = DriverActionService.subscribeUpdated(this.updating);
    if (this.isAdmin) void this._refreshDeletionRequests();
    setTimeout(() => this.map?.invalidateSize(), 150);
  }

  _setDirectoryOpen(isOpen) {
    const panel = this.container.querySelector("#driverActionDirectoryPanel");
    const toggle = this.container.querySelector("#driverActionDirectoryToggle");
    if (!panel || !toggle) return;
    panel.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.textContent = isOpen ? "Hide drivers" : "Drivers";
    setTimeout(() => this.map?.invalidateSize(), 220);
  }

  _onDirectorySearch() {
    const input = this.container.querySelector("#driverActionSearch");
    const query = String(input?.value || "").trim();
    const generation = ++this._shipmentSearchGeneration;
    clearTimeout(this._shipmentSearchTimer);
    this._shipmentMatches.clear();
    this._shipmentSearchStatus = "Type at least 3 letters or numbers to search shipment numbers. Spaces and dashes are okay.";
    this._renderDirectory();
    const shipmentQuery = query.replace(/[^A-Za-z0-9]/g, "");
    if (shipmentQuery.length < 3 || shipmentQuery.length > 128) return;
    this._shipmentSearchStatus = "Searching shipment records…";
    this._renderDirectory();
    this._shipmentSearchTimer = setTimeout(async () => {
      try {
        const result = await DriverActionService.searchShipmentDrivers(shipmentQuery);
        if (generation !== this._shipmentSearchGeneration
          || String(this.container.querySelector("#driverActionSearch")?.value || "").trim() !== query) return;
        for (const match of result.drivers || []) {
          const id = String(match.driverId || "");
          if (id && Array.isArray(match.shipmentIds)) this._shipmentMatches.set(id, match.shipmentIds.map(String));
        }
        const count = this._shipmentMatches.size;
        this._shipmentSearchStatus = count
          ? `${count} driver${count === 1 ? "" : "s"} found for this shipment${result.truncated ? "; showing the first 200 matches" : ""}.`
          : "No shipment records match this number. Driver and company matches are still shown.";
        this._renderDirectory();
      } catch {
        if (generation !== this._shipmentSearchGeneration) return;
        this._shipmentSearchStatus = "Could not search shipments. Check the connection and try again. Driver and company search is still available.";
        this._renderDirectory();
      }
    }, 300);
  }

  _renderDirectory() {
    const target = this.container.querySelector("#driverActionDirectory");
    if (!target) return;
    const term = (
      this.container.querySelector("#driverActionSearch")?.value || ""
    )
      .trim()
      .toLowerCase();
    const groups = new Map();
    this.drivers.forEach((driver) => {
      const name = driver.driverName || driver.name || "Unnamed driver";
      const company =
        String(
          driver.truckingCompany ||
            driver.truckCompany ||
            driver.company ||
            "Other",
        ).trim() || "Other";
      const id = String(driver.id || driver.driverId || "");
      const shipmentIds = this._shipmentMatches.get(id) || [];
      const textMatch = !term || `${name} ${company} ${driver.plateNumber || ""}`.toLowerCase().includes(term);
      if (term && !textMatch && !shipmentIds.length)
        return;
      if (!groups.has(company)) groups.set(company, []);
      groups.get(company).push({ ...driver, name, company, shipmentIds });
    });
    target.innerHTML =
      [...groups.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map(
          (company) => `
          <details open class="mb-1 rounded-lg"><summary class="cursor-pointer rounded px-2 py-2 text-[11px] font-semibold text-db-text2 hover:bg-db-item-hover">${escapeHtml(company)} <span class="text-db-text3">${groups.get(company).length}</span></summary>
          <div class="space-y-1 pl-1">${groups
            .get(company)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((driver) => {
              const id = String(driver.id || driver.driverId || "");
              const plate = driver.plateNumber || driver.plate || "";
              const shipmentId = driver.shipmentIds[0] || "";
              const matchLabel = driver.shipmentIds.length ? `<span class="block truncate text-[10px] text-sysu-red">Shipment match: ${escapeHtml(driver.shipmentIds.join(", "))}</span>` : "";
              return `<div class="flex items-stretch gap-1"><button type="button" data-driver-id="${escapeHtml(id)}" data-shipment-id="${escapeHtml(shipmentId)}" class="min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-db-item-hover ${this.selectedDriver?.id === id ? "bg-sysu-red/10" : ""}"><span class="block truncate text-xs font-medium text-db-text">${escapeHtml(driver.name)}</span>${plate ? `<span class="block truncate text-[10px] text-db-text3">${escapeHtml(plate)}</span>` : ""}${matchLabel}</button><button type="button" data-driver-export data-driver-id="${escapeHtml(id)}" data-shipment-id="${escapeHtml(shipmentId)}" aria-label="Export activity for ${escapeHtml(driver.name)}" title="Export activity" class="shrink-0 self-center rounded-md border border-db-border px-2 py-1.5 text-[10px] font-semibold text-db-text2 hover:bg-db-item-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-sysu-red">Export</button></div>`;
            })
            .join("")}</div></details>`,
        )
        .join("") ||
      '<p class="px-2 py-6 text-center text-xs text-db-text3">No matching drivers found.</p>';
    const status = this.container.querySelector("#driverActionSearchStatus");
    if (status) status.textContent = this._shipmentSearchStatus;
  }

  async selectDriver(driverId, initialShipmentId = "", openExport = false) {
    const driver = this.drivers.find(
      (item) => String(item.id || item.driverId) === String(driverId),
    );
    if (!driver) return;
    const selectedId = String(driver.id || driver.driverId);
    this._clearRoute();
    this.activePlotSessionId = null;
    this._eventLoads.clear();
    this.sessionsNextCursor = null;
    this.filteredSessions = null;
    this._sessionFilterEvents.clear();
    clearTimeout(this._sessionFilterTimer);
    this.selectedDriver = {
      ...driver,
      id: selectedId,
      name: driver.driverName || driver.name || "Unnamed driver",
    };
    this.events = [];
    this._renderDirectory();
    if (window.matchMedia?.("(max-width: 767px)").matches) {
      this._setDirectoryOpen(false);
    }
    const drawer = this.container.querySelector("#driverActionDrawer");
    this._driverDrawerController?.abort();
    const drawerController = new AbortController();
    this._driverDrawerController = drawerController;
    drawer.classList.remove("translate-x-full");
    drawer.setAttribute("aria-hidden", "false");
    this.onSelect?.(this.selectedDriver);
    this._focusDriver();
    const driverMeta = [driver.truckingCompany || driver.company || "Other", driver.plateNumber || driver.plate || ""].filter(Boolean).map(escapeHtml).join(" | ");
    drawer.innerHTML = `
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-db-border px-5 py-4">
        <div class="min-w-0"><h2 class="truncate text-base font-semibold leading-tight text-db-text">${escapeHtml(this.selectedDriver.name)}</h2><p class="mt-1 truncate text-xs text-db-text2">${driverMeta || "Driver details"}</p></div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button type="button" data-close-drawer aria-label="Close driver sessions" class="grid size-9 place-items-center rounded-lg text-lg text-db-text2 transition hover:bg-db-item-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-sysu-red">×</button>
        </div>
      </header>
      <details data-export-panel ${openExport ? "open" : ""} class="shrink-0 border-b border-db-border">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-db-text outline-none hover:bg-db-item-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sysu-red"><span>Export activity</span><span data-export-driver class="text-xs font-normal text-db-text2">CSV</span></summary>
        <div class="max-h-[42vh] overflow-y-auto border-t border-db-border px-5 py-4">
          <p class="mb-3 text-xs leading-relaxed text-db-text2">Filter the sessions and export the driver's saved actions. Leave filters blank to include all sessions.</p>
          <div class="space-y-3">
            <label class="block text-xs font-medium text-db-text2">Shipment number<input data-export-shipment type="search" inputmode="text" autocomplete="off" placeholder="Search shipment number" class="mt-1 h-10 w-full rounded-lg border border-db-border bg-db-bg px-3 text-[13px] text-db-text placeholder:text-db-text3 focus:border-sysu-red focus:outline-none focus:ring-2 focus:ring-sysu-red/20" /></label>
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-xs font-medium text-db-text2">From date<input data-export-from type="date" class="mt-1 h-10 min-w-0 w-full rounded-lg border border-db-border bg-db-bg px-2 text-[13px] text-db-text focus:border-sysu-red focus:outline-none focus:ring-2 focus:ring-sysu-red/20" /></label>
              <label class="block text-xs font-medium text-db-text2">To date<input data-export-to type="date" class="mt-1 h-10 min-w-0 w-full rounded-lg border border-db-border bg-db-bg px-2 text-[13px] text-db-text focus:border-sysu-red focus:outline-none focus:ring-2 focus:ring-sysu-red/20" /></label>
            </div>
          </div>
          <p data-session-filter-status role="status" aria-live="polite" class="mt-3 min-h-4 text-xs text-db-text2">Loading saved sessions…</p>
          <div class="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <button type="button" data-export-csv disabled aria-busy="false" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-sysu-red px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sysu-red-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sysu-red disabled:cursor-not-allowed disabled:opacity-50">Export CSV</button>
            <span data-export-status role="status" aria-live="polite" class="text-xs text-db-text2">Loading saved sessions…</span>
          </div>
          <p class="mt-3 rounded-lg bg-db-bg px-3 py-2.5 text-[11px] leading-relaxed text-db-text2">Dates use Asia/Manila. TMS is time between driver actions; GPS points do not reset it.</p>
        </div>
      </details>
      <div id="driverActionSessions" class="min-h-0 flex-1 overflow-y-auto p-5"><p role="status" class="text-xs text-db-text2">Loading sessions…</p></div>`;
    const exportPanel = drawer.querySelector("[data-export-panel]");
    exportPanel.querySelector("[data-export-driver]").textContent = this.selectedDriver.name;
    exportPanel.querySelector("[data-export-shipment]").value = initialShipmentId;
    exportPanel.querySelector("[data-export-status]").textContent = "Loading saved sessions…";
    exportPanel.querySelector("[data-export-csv]").disabled = true;
    drawer
      .querySelector("[data-close-drawer]")
      .addEventListener("click", () => {
        drawer.classList.add("translate-x-full");
        drawer.setAttribute("aria-hidden", "true");
        this._clearRoute();
      });
    exportPanel.querySelector("[data-export-csv]")?.addEventListener("click", () => void this._exportDriverCsv(), {signal: drawerController.signal});
    const scheduleSessionFilter = () => {
      clearTimeout(this._sessionFilterTimer);
      this._sessionFilterTimer = setTimeout(() => void this._applySessionFilters(), 200);
    };
    exportPanel.querySelector("[data-export-shipment]")?.addEventListener("input", scheduleSessionFilter, {signal: drawerController.signal});
    exportPanel.querySelector("[data-export-from]")?.addEventListener("change", scheduleSessionFilter, {signal: drawerController.signal});
    exportPanel.querySelector("[data-export-to]")?.addEventListener("change", scheduleSessionFilter, {signal: drawerController.signal});
    try {
      const response = await DriverActionService.getSessions(selectedId, 500);
      if (this.selectedDriver?.id !== selectedId) return;
      this.sessions = newestFirst(response.items);
      this.sessionsNextCursor = response.nextCursor;
      exportPanel.querySelector("[data-export-csv]").disabled = false;
      exportPanel.querySelector("[data-export-status]").textContent = "Ready to export. Add filters to narrow the report.";
      this._renderSessions();
      this._updateSessionFilterStatus();
      if (exportPanel.querySelector("[data-export-shipment]").value.trim()
        || exportPanel.querySelector("[data-export-from]").value
        || exportPanel.querySelector("[data-export-to]").value) {
        void this._applySessionFilters();
      }
    } catch (error) {
      if (this.selectedDriver?.id !== selectedId) return;
      exportPanel.querySelector("[data-export-status]").textContent = error.message || "Saved sessions could not be loaded.";
      exportPanel.querySelector("[data-export-status]").setAttribute("role", "alert");
      drawer.querySelector("#driverActionSessions").innerHTML =
        `<p role="alert" class="text-xs text-sysu-red">${escapeHtml(error.message || "Sessions could not be loaded.")}</p><button data-retry-sessions class="mt-3 rounded border border-db-border px-3 py-2 text-xs text-db-text">Retry</button>`;
      this.container
        .querySelector("[data-retry-sessions]")
        ?.addEventListener("click", () => this.selectDriver(driverId));
    }
  }

  _focusDriver() {
    const live =
      this.liveTracking[this.selectedDriver.id] ||
      this.liveTracking[this.selectedDriver.phone];
    const lat = Number(live?.lat ?? live?.latitude),
      lng = Number(live?.lng ?? live?.longitude);
    if (validLocation(lat, lng))
      this.map?.flyTo([lat, lng], 13, { duration: 0.5 });
    else this.map?.setView([14.5995, 120.9842], 11, { animate: false });
  }

  _renderSessions() {
    const host = this.container.querySelector("#driverActionSessions");
    if (!host) return;
    const visibleSessions = this.filteredSessions ?? this.sessions;
    if (!visibleSessions.length) {
      if (this.sessions.length && this.filteredSessions) {
        host.innerHTML = '<p role="status" class="py-8 text-center text-xs text-db-text3">No sessions match these shipment and date filters.</p>';
        return;
      }
      host.innerHTML = '<p role="status" class="py-8 text-center text-xs text-db-text3">No action sessions recorded for this driver.</p>';
      return;
    }
    const sessionCount = this.filteredSessions ? `${visibleSessions.length} of ${this.sessions.length}` : this.sessions.length;
    host.innerHTML = `<div class="mb-4 flex items-center justify-between gap-3"><h3 class="text-sm font-semibold text-db-text">Action sessions</h3><span class="rounded-full bg-db-item-hover px-2.5 py-1 text-[11px] font-semibold text-db-text2">${escapeHtml(sessionCount)}</span></div><div class="space-y-3">${visibleSessions.map((session) => {
      const tripStartedAt = driverActionTimestamp(session.tripStartedAt);
      const tripCompletedAt = driverActionTimestamp(session.tripCompletedAt);
      const sessionTitle = session.title || session.actionType || (tripStartedAt > 0
        ? "Driver Trip Session"
        : "App Activity Session");
      const hasTripCompletion = tripStartedAt > 0 && tripCompletedAt >= tripStartedAt;
      const hasCompletedSession = tripCompletedAt > 0;
      const canShowElapsed = tripStartedAt > 0 && !hasCompletedSession && session.status !== "completed";
      const duration = hasTripCompletion
        ? tripCompletedAt - tripStartedAt
        : canShowElapsed ? Math.max(0, Date.now() - tripStartedAt) : null;
      const durationKind = hasTripCompletion ? "Session total" : canShowElapsed ? "Session elapsed" : null;
      const durationText = duration == null
        ? ""
        : ` · ${durationKind} ${durationLabel(duration)}`;
      const sessionId = String(session.sessionId || session.id || "");
      const deletionState = session.pendingDeletionRequestId ? "Removal request pending" : "";
      const tripStartLabel = tripStartedAt > 0
        ? `Session started ${timestamp(tripStartedAt)}`
        : "";
      const sessionEndLabel = hasCompletedSession
        ? ` · Session ended ${timestamp(tripCompletedAt)}`
        : session.status === "completed" ? " · Session end unconfirmed" : "";
      const sessionStatusLabel = session.status === "completed" && !hasCompletedSession
        ? "Completed status · final end unconfirmed"
        : session.status || session.outcome || "Session";
      const isActive = session.status === "active";
      const statusTone = isActive ? "text-green-400" : "text-db-text2";
      const statusDot = isActive ? "bg-green-400" : "bg-db-text3";
      const assignedShipments = [...new Set((Array.isArray(session.shipments) ? session.shipments : [])
        .filter((shipment) => typeof shipment === "string" && shipment.trim()))];
      const shipmentSummary = assignedShipments.length
        ? `<div class="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Assigned shipments"><span class="mr-1 text-[11px] text-db-text2">Assigned shipments</span>${assignedShipments.map((shipment) => `<span class="rounded-md border border-db-border bg-db-panel px-2 py-1 text-[11px] font-medium text-db-text">${escapeHtml(shipment)}</span>`).join("")}</div>`
        : "";
    return `<details class="group rounded-lg border border-db-border bg-db-bg/60 transition-colors open:border-sysu-red/40 open:bg-db-panel" data-session-id="${escapeHtml(sessionId)}"><summary class="cursor-pointer list-none rounded-lg p-4 outline-none transition hover:bg-db-item-hover/50 focus-visible:ring-2 focus-visible:ring-sysu-red"><div class="flex flex-wrap items-center justify-between gap-2"><span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-db-text">${escapeHtml(sessionTitle)}</span><span class="inline-flex items-center gap-1.5 rounded-full bg-db-item-hover px-2 py-0.5 text-[11px] font-medium ${statusTone}"><i class="size-1.5 rounded-full ${statusDot}" aria-hidden="true"></i>${escapeHtml(sessionStatusLabel)}</span></div>${tripStartLabel ? `<p class="mt-2 text-xs text-db-text2">${escapeHtml(tripStartLabel)}</p>` : ""}<div class="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs"><span class="font-semibold text-db-text">${durationText ? escapeHtml(durationText.replace(/^ · /, "")) : ""}</span>${sessionEndLabel ? `<span class="text-db-text2">${escapeHtml(sessionEndLabel.replace(/^ · /, ""))}</span>` : ""}</div>${shipmentSummary}<span class="sr-only">Toggle session details</span></summary><div class="border-t border-db-border px-4 pb-4 pt-3"><div class="mb-3 flex flex-wrap items-center gap-3"><button type="button" data-load-plot class="inline-flex min-h-9 items-center rounded-lg bg-sysu-red px-3 text-xs font-semibold text-white transition hover:bg-sysu-red/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sysu-red">Load plots</button><span data-plot-state role="status" class="text-xs text-db-text2">Plot not loaded</span></div><div class="session-events text-[13px] leading-relaxed text-db-text"><p>Load this session to view its actions and map locations.</p></div><div class="mt-4 border-t border-db-border pt-3" data-delete-request>${deletionState ? `<span role="status" class="text-xs text-db-text2">${escapeHtml(deletionState)}</span>` : `<button type="button" data-open-delete-form class="inline-flex min-h-9 items-center rounded-lg border border-db-border px-3 text-xs font-medium text-db-text2 transition hover:bg-db-item-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-sysu-red">Request session removal</button>`}</div></div></details>`;
    }).join("")}</div>`;
    host.querySelectorAll("details[data-session-id]").forEach((detail) => {
      detail.querySelector("[data-load-plot]")?.addEventListener("click", () => void this._loadEvents(detail.dataset.sessionId, detail));
      detail.querySelector("[data-open-delete-form]")?.addEventListener("click", () => this._showDeletionForm(detail));
      const cached = this._eventLoads.get(detail.dataset.sessionId);
      if (cached) {
        detail.dataset.loaded = "true";
        this._setPlotStatus(detail, `${cached.items.length} actions loaded for this session.`, "loaded");
      }
    });
  }

  _getExportPanel() {
    return this.container.querySelector("#driverActionDrawer [data-export-panel]");
  }

  _updateSessionFilterStatus(message) {
    const exportPanel = this._getExportPanel();
    const status = exportPanel?.querySelector("[data-session-filter-status]");
    if (!status) return;
    if (message) {
      status.textContent = message;
      return;
    }
    const filtered = this.filteredSessions;
    status.textContent = filtered
      ? `${filtered.length} of ${this.sessions.length} sessions match.`
      : `Showing all ${this.sessions.length} saved session${this.sessions.length === 1 ? "" : "s"}. Add a shipment number or dates to narrow the list.`;
  }

  _updateShipmentSuggestions(ids) {
    const exportPanel = this._getExportPanel();
    const input = exportPanel?.querySelector("[data-export-shipment]");
    if (!exportPanel || !input) return;
    let datalist = exportPanel.querySelector("#driverActionExportShipments");
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = "driverActionExportShipments";
      input.after(datalist);
    }
    input.setAttribute("list", "driverActionExportShipments");
    datalist.innerHTML = [...new Set(ids)].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))
      .map((id) => `<option value="${escapeHtml(id)}"></option>`).join("");
  }

  async _getAllSessionEvents(sessionId) {
    if (this._sessionFilterEvents.has(sessionId)) return this._sessionFilterEvents.get(sessionId);
    const driverId = this.selectedDriver?.id;
    const cached = this._eventLoads.get(sessionId);
    let events = cached ? [...cached.items] : [];
    let cursor = cached?.nextCursor || null;
    if (!cached) {
      const first = await DriverActionService.getEvents(driverId, sessionId, 500);
      events = [...first.items];
      cursor = first.nextCursor;
    }
    const seenCursors = new Set();
    while (cursor) {
      if (seenCursors.has(String(cursor))) throw new Error("The session actions could not be read completely. Please retry the search.");
      seenCursors.add(String(cursor));
      if (events.length >= MAX_EXPORT_EVENTS) throw new Error("This driver's saved actions exceed the 50,000-action search limit.");
      const next = await DriverActionService.getEvents(driverId, sessionId, 500, cursor);
      events.push(...next.items);
      if (events.length > MAX_EXPORT_EVENTS) throw new Error("This driver's saved actions exceed the 50,000-action search limit.");
      cursor = next.nextCursor;
    }
    const complete = events.map((event) => ({...event, sessionId: event.sessionId || sessionId}));
    this._sessionFilterEvents.set(sessionId, complete);
    return complete;
  }

  async _applySessionFilters() {
    const exportPanel = this._getExportPanel();
    if (!exportPanel) return;
    if (!this.sessions.length) {
      this.filteredSessions = null;
      this._renderSessions();
      this._updateSessionFilterStatus("No saved sessions are available to search.");
      return;
    }
    const shipment = exportPanel.querySelector("[data-export-shipment]")?.value.trim().toLowerCase() || "";
    const from = exportPanel.querySelector("[data-export-from]")?.value || "";
    const to = exportPanel.querySelector("[data-export-to]")?.value || "";
    const generation = ++this._sessionFilterGeneration;
    if (!shipment && !from && !to) {
      this.filteredSessions = null;
      this._renderSessions();
      this._updateSessionFilterStatus();
      return;
    }
    if (from && to && from > to) {
      this.filteredSessions = [];
      this._renderSessions();
      this._updateSessionFilterStatus("From date must be on or before To date.");
      return;
    }
    this._updateSessionFilterStatus("Searching saved actions in each session...");
    try {
      const matches = [];
      let scannedEvents = 0;
      const shipmentIds = new Set();
      for (let index = 0; index < this.sessions.length; index += 1) {
        const session = this.sessions[index];
        const sessionId = String(session.sessionId || session.id || "");
        if (!sessionId) continue;
        this._updateSessionFilterStatus(`Searching session ${index + 1} of ${this.sessions.length}...`);
        const events = await this._getAllSessionEvents(sessionId);
        scannedEvents += events.length;
        if (scannedEvents > MAX_EXPORT_EVENTS) throw new Error("This driver's saved actions exceed the 50,000-action search limit.");
        shipmentActivityShipmentIds(events).forEach((id) => shipmentIds.add(id));
        const shipmentMatches = !shipment || shipmentActivityShipmentIds(events)
          .some((id) => id.toLowerCase().includes(shipment));
        const dateMatches = (!from && !to) || events.some((event) => {
          const date = activityDateKey(event.occurredAtMs);
          return date && (!from || date >= from) && (!to || date <= to);
        });
        if (shipmentMatches && dateMatches) matches.push(session);
      }
      if (generation !== this._sessionFilterGeneration || this.selectedDriver?.id == null) return;
      this._updateShipmentSuggestions([...shipmentIds]);
      this.filteredSessions = matches;
      this._renderSessions();
      this._updateSessionFilterStatus();
    } catch (error) {
      if (generation !== this._sessionFilterGeneration) return;
      this.filteredSessions = null;
      this._renderSessions();
      this._updateSessionFilterStatus(error.message || "Could not search the saved sessions. Please retry.");
    }
  }

  _setPlotStatus(detail, message, state = "idle") {
    const status = detail.querySelector("[data-plot-state]");
    const button = detail.querySelector("[data-load-plot]");
    if (status) status.textContent = message;
    if (button) {
      button.disabled = state === "loading";
      button.textContent = state === "loading" ? "Loading plots…" : state === "loaded" ? "Show plots" : state === "error" ? "Retry loading plots" : "Load plots";
      button.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    }
  }

  async _exportDriverCsv() {
    const exportPanel = this._getExportPanel();
    const button = exportPanel?.querySelector("[data-export-csv]");
    const status = exportPanel?.querySelector("[data-export-status]");
    const driverId = this.selectedDriver?.id;
    const driverName = this.selectedDriver?.name;
    if (!button || !status || !driverId || button.disabled) return;
    const originalText = button.textContent;
    const shipmentId = exportPanel.querySelector("[data-export-shipment]")?.value.trim() || "";
    const dateFrom = exportPanel.querySelector("[data-export-from]")?.value || "";
    const dateTo = exportPanel.querySelector("[data-export-to]")?.value || "";
    button.disabled = true;
    button.textContent = "Preparing CSV...";
    button.setAttribute("aria-busy", "true");
    status.textContent = "Fetching this driver's saved sessions...";
    try {
      buildShipmentActivityCsv({events: [], driverName, shipmentId, dateFrom, dateTo});
      let sessions = [...this.sessions];
      let sessionCursor = this.sessionsNextCursor;
      const seenSessionCursors = new Set();
      while (sessionCursor) {
        if (seenSessionCursors.has(String(sessionCursor))) throw new Error("The saved session list could not be read completely. Please retry.");
        seenSessionCursors.add(String(sessionCursor));
        if (sessions.length >= MAX_EXPORT_SESSIONS) throw new Error("This driver's history exceeds the 2,000-session export limit. Ask IT for a larger export.");
        const next = await DriverActionService.getSessions(driverId, 500, sessionCursor);
        sessions.push(...next.items);
        if (sessions.length > MAX_EXPORT_SESSIONS) throw new Error("This driver's history exceeds the 2,000-session export limit. Ask IT for a larger export.");
        sessionCursor = next.nextCursor;
      }
      if (this.selectedDriver?.id !== driverId) return;
      const allEvents = [];
      for (let index = 0; index < sessions.length; index += 1) {
        const sessionId = String(sessions[index].sessionId || sessions[index].id || "");
        if (!sessionId) continue;
        status.textContent = `Fetching saved actions for session ${index + 1} of ${sessions.length}...`;
        let cursor = null;
        const seenEventCursors = new Set();
        do {
          if (cursor && seenEventCursors.has(String(cursor))) throw new Error("The saved actions could not be read completely. Please retry.");
          if (cursor) seenEventCursors.add(String(cursor));
          const page = await DriverActionService.getEvents(driverId, sessionId, 500, cursor);
          allEvents.push(...page.items.map((item) => ({...item, sessionId: item.sessionId || sessionId})));
          if (allEvents.length > MAX_EXPORT_EVENTS) throw new Error("This driver's history exceeds the 50,000-action export limit. Ask IT for a larger export.");
          cursor = page.nextCursor;
        } while (cursor);
      }
      if (!exportPanel.isConnected || this.selectedDriver?.id !== driverId) return;
      const availableShipmentIds = shipmentActivityShipmentIds(allEvents);
      const matchingShipmentIds = shipmentId
        ? availableShipmentIds.filter((id) => id.toLowerCase().includes(shipmentId.toLowerCase()))
        : [];
      const exactShipmentId = matchingShipmentIds.find((id) => id.toLowerCase() === shipmentId.toLowerCase());
      if (shipmentId && !exactShipmentId && matchingShipmentIds.length > 1) {
        status.textContent = "More than one shipment matches. Choose or enter the full shipment number.";
        this._updateShipmentSuggestions(availableShipmentIds);
        return;
      }
      const report = buildShipmentActivityCsv({
        events: allEvents,
        driverName,
        shipmentId: exactShipmentId || matchingShipmentIds[0] || shipmentId,
        dateFrom,
        dateTo,
      });
      this._updateShipmentSuggestions(availableShipmentIds);
      if (!report.rows.length) {
        status.textContent = "No saved actions match the selected filters.";
        return;
      }
      const blob = new Blob([report.csv], {type: "text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = shipmentActivityFileName();
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = `Downloaded ${report.rows.length} chronological activity record${report.rows.length === 1 ? "" : "s"}.`;
    } catch (error) {
      if (exportPanel?.isConnected && this.selectedDriver?.id === driverId) status.textContent = error.message || "CSV export failed. Please retry.";
    } finally {
      if (exportPanel?.isConnected && this.selectedDriver?.id === driverId) {
        button.textContent = originalText;
        button.setAttribute("aria-busy", "false");
        button.disabled = false;
      }
    }
  }

  async _loadEvents(sessionId, detail) {
    if (!sessionId || detail.dataset.loading === "true") return;
    const cached = this._eventLoads.get(sessionId);
    if (cached && detail.dataset.loaded === "true") {
      this.activePlotSessionId = sessionId;
      this._renderTimeline(detail, cached);
      this._drawRoute(cached.items);
      this._setPlotStatus(detail, `${cached.items.length} actions loaded for this session.`, "loaded");
      return;
    }
    this.activePlotSessionId = sessionId;
    detail.dataset.loading = "true";
    const driverId = this.selectedDriver?.id;
    this._setPlotStatus(detail, "Fetching session actions and plotting available locations…", "loading");
    detail.querySelector(".session-events").innerHTML = '<p role="status">Loading this session’s timeline…</p><div class="mt-2 h-1.5 overflow-hidden rounded-full bg-db-border"><div class="h-full w-1/3 animate-pulse rounded-full bg-sysu-red"></div></div>';
    try {
      const response = await DriverActionService.getEvents(driverId, sessionId, 200);
      if (!detail.isConnected || this.selectedDriver?.id !== driverId) return;
      const page = {items: eventsNewestFirst(response.items), nextCursor: response.nextCursor};
      this._eventLoads.set(sessionId, page);
      detail.dataset.loaded = "true";
      this._renderTimeline(detail, page);
      const locations = page.items.filter((item) => driverActionCoordinates(item)).length;
      if (this.activePlotSessionId === sessionId) this._drawRoute(page.items);
      this._setPlotStatus(detail, `${page.items.length} actions loaded · ${locations} mapped locations.`, "loaded");
    } catch (error) {
      if (!detail.isConnected || this.selectedDriver?.id !== driverId) return;
      this._setPlotStatus(detail, error.message || "Plots could not be loaded.", "error");
      detail.querySelector(".session-events").innerHTML = `<p role="alert" class="text-sysu-red">${escapeHtml(error.message || "Timeline unavailable.")}</p><p class="mt-1">Other session plots remain available.</p>`;
    } finally {
      detail.dataset.loading = "false";
    }
  }

  _showDeletionForm(detail) {
    const host = detail.querySelector("[data-delete-request]");
    if (!host) return;
    host.innerHTML = `<label class="block text-[10px] font-medium text-db-text2">Why should this session be removed?<textarea data-delete-reason maxlength="500" rows="2" class="mt-1 w-full rounded-md border border-db-border bg-db-bg p-2 text-[11px] text-db-text" placeholder="Provide a short reason for admin review"></textarea></label><div class="mt-2 flex gap-2"><button type="button" data-submit-delete class="rounded-md border border-sysu-red/50 px-2.5 py-1.5 text-[10px] font-semibold text-sysu-red">Submit request</button><button type="button" data-cancel-delete class="rounded-md border border-db-border px-2.5 py-1.5 text-[10px] text-db-text2">Cancel</button></div><p data-delete-status role="status" class="mt-2 text-[10px] text-db-text3"></p>`;
    host.querySelector("[data-cancel-delete]").addEventListener("click", () => this._renderSessions());
    host.querySelector("[data-submit-delete]").addEventListener("click", async (event) => {
      if (this._requestPending) return;
      const reason = host.querySelector("[data-delete-reason]").value.trim();
      const status = host.querySelector("[data-delete-status]");
      const button = event.currentTarget;
      if (reason.length < 5) { status.textContent = "Please enter a reason of at least 5 characters."; return; }
      const driverId = this.selectedDriver?.id;
      if (!driverId) { status.textContent = "Select a driver before requesting removal."; return; }
      this._requestPending = true;
      button.disabled = true;
      button.textContent = "Sending request…";
      this._showRequestOverlay();
      try {
        const response = await DriverActionService.requestDeletion(driverId, detail.dataset.sessionId, reason);
        const session = this.sessions.find((item) => String(item.sessionId || item.id) === detail.dataset.sessionId);
        if (session) session.pendingDeletionRequestId = response.requestId;
        host.innerHTML = '<span role="status" tabindex="-1" class="text-[10px] text-db-text3">Removal request sent for admin approval.</span>';
        this._hideRequestOverlay(host.querySelector('[role="status"]'));
        if (this.isAdmin) void this._refreshDeletionRequests();
      } catch (error) {
        status.setAttribute("role", "alert");
        status.textContent = this._deletionRequestError(error);
        button.disabled = false;
        button.textContent = "Retry request";
        this._hideRequestOverlay(button);
      } finally {
        this._requestPending = false;
      }
    });
  }
  _deletionRequestError(error) {
    if (["SOCKET_CONNECT_FAILED", "SOCKET_CONNECT_TIMEOUT", "SOCKET_DISCONNECTED"].includes(error?.code))
      return "Could not reach SYSU Go. Check the connection or service status, then retry.";
    if (error?.code === "SOCKET_ACK_TIMEOUT")
      return "SYSU Go did not acknowledge this request. Confirm its latest backend is deployed, then retry.";
    return error?.message || "The removal request could not be sent. Please retry.";
  }
  _showRequestOverlay() {
    if (this.container.querySelector("[data-driver-action-request-overlay]")) return;
    const screen = this.container.querySelector("#driverActionScreen");
    if (!screen) return;
    screen.setAttribute("inert", "");
    const overlay = document.createElement("div");
    overlay.dataset.driverActionRequestOverlay = "true";
    overlay.className = "fixed inset-0 z-[1500] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm";
    overlay.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="driverActionRequestTitle" tabindex="-1" class="w-full max-w-sm rounded-xl border border-db-border bg-db-panel p-5 text-db-text shadow-2xl"><div class="flex items-start gap-3"><span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sysu-red/10 text-sysu-red"><svg class="motion-safe:animate-spin" aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity=".2"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span><div><h2 id="driverActionRequestTitle" class="text-sm font-semibold">Sending removal request</h2><p class="mt-1 text-xs leading-relaxed text-db-text3">Please wait while SYSU Go sends this request for administrator review.</p></div></div><p class="mt-4 text-[11px] text-db-text2" role="status" aria-live="polite">Your session will not be deleted unless an administrator approves the request.</p></div>';
    this.container.append(overlay);
    overlay.querySelector('[role="dialog"]')?.focus();
  }
  _hideRequestOverlay(focusTarget) {
    this.container.querySelector("[data-driver-action-request-overlay]")?.remove();
    this.container.querySelector("#driverActionScreen")?.removeAttribute("inert");
    focusTarget?.focus?.();
  }
  async _refreshDeletionRequests() {
    if (!this.isAdmin) return;
    const button = this.container.querySelector("#driverActionReviewRequests");
    if (button) { button.disabled = true; button.textContent = "Checking requests…"; }
    try {
      this.deleteRequests = await DriverActionService.getDeletionRequests();
      if (button) button.textContent = `Review requests${this.deleteRequests.length ? ` (${this.deleteRequests.length})` : ""}`;
      const modal = this.container.querySelector("#driverActionDeletionModal");
      if (modal) this._renderDeletionRequests(modal);
    } catch (error) {
      if (button) button.textContent = "Review requests";
      const status = this.container.querySelector("#driverActionDeletionQueueStatus");
      if (status) status.textContent = error.message || "Requests are temporarily unavailable.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  _openDeletionRequests() {
    if (!this.isAdmin) return;
    let modal = this.container.querySelector("#driverActionDeletionModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "driverActionDeletionModal";
      modal.className = "absolute inset-0 z-[1000] grid place-items-center bg-black/50 p-4";
      modal.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="driverActionDeletionTitle" class="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border border-db-border bg-db-panel shadow-2xl"><header class="flex items-center justify-between border-b border-db-border p-4"><div><h2 id="driverActionDeletionTitle" class="text-sm font-bold text-db-text">Session removal requests</h2><p class="mt-1 text-[11px] text-db-text3">Approval permanently deletes that session’s actions and map points. The request record stays for accountability.</p></div><button type="button" data-close-requests aria-label="Close requests" class="rounded p-2 text-db-text3 hover:bg-db-item-hover">×</button></header><div id="driverActionDeletionQueueStatus" role="status" class="px-4 pt-3 text-xs text-db-text3"></div><div data-request-list class="max-h-[65vh] space-y-2 overflow-y-auto p-4"></div></section>';
      this.container.append(modal);
      modal.querySelector("[data-close-requests]").addEventListener("click", () => modal.remove());
    }
    this._renderDeletionRequests(modal);
    void this._refreshDeletionRequests();
  }

  _renderDeletionRequests(modal) {
    const list = modal.querySelector("[data-request-list]");
    if (!list) return;
    if (!this.deleteRequests.length) {
      list.innerHTML = '<p class="py-8 text-center text-xs text-db-text3">No pending session removal requests.</p>';
      return;
    }
    list.innerHTML = this.deleteRequests.map((request) => {
      const driver = this.drivers.find((item) => String(item.id || item.driverId) === request.driverId);
      const name = driver?.driverName || driver?.name || request.driverId;
      return `<article class="rounded-lg border border-db-border bg-db-bg/60 p-3" data-request-id="${escapeHtml(request.id)}" data-driver-id="${escapeHtml(request.driverId)}"><div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-xs text-db-text">${escapeHtml(name)}</strong><span class="text-[10px] text-db-text3">${escapeHtml(timestamp(request.requestedAt))}</span></div><p class="mt-1 text-[10px] text-db-text3">Session ${escapeHtml(request.sessionId)} · Requested by ${escapeHtml(request.requestedByRole || "staff")}</p><p class="mt-2 whitespace-pre-wrap text-xs text-db-text2">${escapeHtml(request.reason)}</p><label class="mt-3 block text-[10px] text-db-text3">Decision note (optional)<input data-decision-note maxlength="500" class="mt-1 w-full rounded border border-db-border bg-db-panel px-2 py-1.5 text-xs text-db-text" /></label><div class="mt-3 flex gap-2"><button type="button" data-decide="approved" class="rounded-md bg-sysu-red px-3 py-2 text-[10px] font-semibold text-white">Approve removal</button><button type="button" data-decide="denied" class="rounded-md border border-db-border px-3 py-2 text-[10px] font-medium text-db-text2">Deny</button></div><p data-request-status role="status" class="mt-2 text-[10px] text-db-text3"></p></article>`;
    }).join("");
    list.querySelectorAll("[data-request-id]").forEach((card) => {
      card.querySelectorAll("[data-decide]").forEach((button) => button.addEventListener("click", async () => {
        const requestId = card.dataset.requestId;
        const decision = button.dataset.decide;
        if (decision === "approved" && !window.confirm("Approve permanent deletion of this session's saved actions and map points? The removal request will remain in the audit.")) return;
        const request = this.deleteRequests.find((item) => item.id === requestId);
        const status = card.querySelector("[data-request-status]");
        card.querySelectorAll("button").forEach((item) => { item.disabled = true; });
        status.textContent = decision === "approved" ? "Applying approved removal…" : "Saving decision…";
        try {
          await DriverActionService.decideDeletion(requestId, decision, card.querySelector("[data-decision-note]").value.trim());
          this.deleteRequests = this.deleteRequests.filter((item) => item.id !== requestId);
          if (decision === "approved" && this.activePlotSessionId === request?.sessionId) {
            this.activePlotSessionId = null;
            this._clearRoute();
          }
          if (this.selectedDriver?.id === card.dataset.driverId) void this._refreshSelectedSessions();
          this._renderDeletionRequests(modal);
          const reviewButton = this.container.querySelector("#driverActionReviewRequests");
          if (reviewButton) reviewButton.textContent = `Review requests${this.deleteRequests.length ? ` (${this.deleteRequests.length})` : ""}`;
        } catch (error) {
          status.textContent = error.message || "The decision could not be saved. Please retry.";
          card.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        }
      }));
    });
  }
  _renderTimeline(detail, page) {
    const events = page.items;
    const durations = driverActionDurations(events);
    const routePoints = events.filter(item => item.eventType === "route_point");
    const previousRouteGroupOpen = detail.querySelector("[data-route-location-group]")?.open || false;
    const routePageSize = 50;
    const routePageCount = Math.max(1, Math.ceil(routePoints.length / routePageSize));
    page.routePage = Math.min(Math.max(0, page.routePage || 0), routePageCount - 1);
    const routeStart = page.routePage * routePageSize;
    const visibleRoutePoints = routePoints.slice(routeStart, routeStart + routePageSize);
    let routeGroupRendered = false;
    detail.querySelector(".session-events").innerHTML = events.length
      ? `<ol class="relative ml-1 border-l border-db-border pl-4">${events
          .flatMap((item, index) => {
            if (item.eventType === "route_point") {
              if (routeGroupRendered) return [];
              routeGroupRendered = true;
              const routeRows = visibleRoutePoints.map((point, visibleIndex) => {
                const pointIndex = routeStart + visibleIndex;
                const coordinates = driverActionCoordinates(point);
                const location = coordinates
                  ? `${coordinates[0].toFixed(5)}, ${coordinates[1].toFixed(5)}`
                  : `Location ${point.locationState || "unavailable"}`;
              return `<li class="border-b border-db-border/60 last:border-0"><button type="button" data-route-point-index="${pointIndex}" class="w-full rounded px-2 py-2 text-left text-db-text hover:bg-db-item-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-sysu-red"><span class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs"><span class="text-db-text2">Time</span><span class="break-words">${escapeHtml(timestamp(point.occurredAtMs))}${point.outcome ? ` · ${escapeHtml(point.outcome)}` : ""}</span><span class="text-db-text2">Location</span><span class="break-words">${escapeHtml(location)}</span>${Number.isFinite(Number(point.accuracy)) && point.accuracy != null ? `<span class="text-db-text2">GPS accuracy</span><span>${escapeHtml(point.accuracy)} m</span>` : ""}</span></button></li>`;
              }).join("");
              return [`<li class="relative mb-3"><span class="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-sysu-red"></span><details data-route-location-group class="rounded-md border border-db-border bg-db-bg/40"><summary class="cursor-pointer px-2 py-2 font-medium text-db-text">Route locations (${routePoints.length} loaded) <span class="ml-2 text-db-text2">Latest ${escapeHtml(timestamp(routePoints[0]?.occurredAtMs))}</span></summary><ol class="max-h-64 overflow-y-auto border-t border-db-border px-3">${routeRows}</ol>${routePoints.length > routePageSize ? `<div class="flex items-center justify-between gap-2 border-t border-db-border px-2 py-2"><button type="button" data-route-page="newer" ${page.routePage === 0 ? "disabled" : ""} class="rounded border border-db-border px-2 py-1 text-xs text-db-text disabled:opacity-40">Newer</button><span class="text-xs text-db-text2">Points ${routeStart + 1}–${Math.min(routeStart + routePageSize, routePoints.length)} of ${routePoints.length}</span><button type="button" data-route-page="older" ${page.routePage >= routePageCount - 1 ? "disabled" : ""} class="rounded border border-db-border px-2 py-1 text-xs text-db-text disabled:opacity-40">Older</button></div>` : ""}</details></li>`];
            }
            const key = String(item.eventId || item.id || item.sequence || `${item.eventType}:${index}`);
            const duration = durations.get(key);
            const durationText = duration
              ? `${duration.basis === "until_next_action" ? "Until next action" : duration.basis === "since_previous_action" ? "Since previous action" : duration.basis === "session_total" ? "Session total" : "Duration"}: ${durationLabel(duration.durationMs)}`
              : "";
            const coordinates = driverActionCoordinates(item);
            const locationText = coordinates
              ? `${coordinates[0].toFixed(5)}, ${coordinates[1].toFixed(5)}`
              : "Unavailable";
            const rows = [
              ["Time", timestamp(item.occurredAtMs)],
              ...(item.outcome ? [["Result", item.outcome]] : []),
              ...(durationText ? [["Elapsed", durationText]] : []),
              ["Location", locationText],
              ...(item.subjectId ? [["Reference", item.subjectId]] : []),
              ...(item.metadata?.obdRef ? [["OBD", item.metadata.obdRef]] : []),
              ...(Number.isFinite(Number(item.accuracy)) && item.accuracy != null ? [["GPS accuracy", `${item.accuracy} m`]] : []),
            ];
            return `<li class="relative mb-3 text-db-text"><span class="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-sysu-red"></span><h4 class="mb-1 text-[13px] font-semibold">${escapeHtml(actionLabel(item.eventType))}</h4><dl class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-relaxed">${rows.map(([label, value]) => `<dt class="text-db-text2">${escapeHtml(label)}</dt><dd class="min-w-0 break-words">${escapeHtml(value)}</dd>`).join("")}</dl>${podPreviewButton(item)}</li>`;
          })
          .join(
            "",
          )}</ol>${page.nextCursor ? '<button type="button" data-load-older class="mt-2 rounded border border-db-border px-2 py-1.5 text-[10px] text-db-text2">Load older actions</button>' : ""}`
      : '<p class="py-3">No events in this session.</p>';
    const routeGroup = detail.querySelector("[data-route-location-group]");
    if (routeGroup) {
      routeGroup.open = previousRouteGroupOpen;
      routeGroup.querySelectorAll("[data-route-page]").forEach(button => {
        button.addEventListener("click", () => {
          page.routePage += button.dataset.routePage === "older" ? 1 : -1;
          this._renderTimeline(detail, page);
        });
      });
      routeGroup.querySelectorAll("[data-route-point-index]").forEach(button => {
        button.addEventListener("click", () => {
          const point = routePoints[Number(button.dataset.routePointIndex)];
          if (point) this._focusRoutePoint(point);
        });
      });
    }
    detail.querySelectorAll("[data-view-pod]").forEach((button) => {
      button.addEventListener("click", () => {
        this.onViewPod?.(button.dataset.shipment, button.dataset.obd);
      });
    });
    detail
      .querySelector("[data-load-older]")
      ?.addEventListener("click", () =>
        this._loadOlderEvents(detail.dataset.sessionId, detail),
      );
  }

  async _loadOlderEvents(sessionId, detail) {
    const page = this._eventLoads.get(sessionId);
    if (!page?.nextCursor || detail.dataset.loading === "true") return;
    detail.dataset.loading = "true";
    try {
      const response = await DriverActionService.getEvents(
        this.selectedDriver.id,
        sessionId,
        200,
        page.nextCursor,
      );
      if (!detail.isConnected) return;
      page.items = eventsNewestFirst([...page.items, ...response.items]);
      page.nextCursor = response.nextCursor;
      this._eventLoads.set(sessionId, page);
      this._renderTimeline(detail, page);
      if (this.activePlotSessionId === sessionId) {
        this._drawRoute(page.items);
        this._setPlotStatus(detail, `${page.items.length} actions loaded · ${page.items.filter((item) => driverActionCoordinates(item)).length} mapped locations.`, "loaded");
      }
    } catch (error) {
      const host = detail.querySelector(".session-events");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className =
        "mt-2 rounded border border-db-border px-2 py-1.5 text-[10px] text-sysu-red";
      retry.textContent = error.message || "Older actions unavailable. Retry";
      retry.addEventListener("click", () =>
        this._loadOlderEvents(sessionId, detail),
      );
      host?.append(retry);
    } finally {
      detail.dataset.loading = "false";
    }
  }

  _drawRoute(events = []) {
    this._clearRoute();
    const locatedEvents = [...events]
      .reverse()
      .filter((item) => driverActionCoordinates(item));
    const actionEvents = locatedEvents.filter((item) => item.eventType !== "route_point");
    const routeSegments = driverActionRouteSegments(events);
    const points = routeSegments.flatMap((segment) => segment.points);
    const durations = driverActionDurations(events);
    const markersByLocation = new Map();
    actionEvents.forEach((item) => {
      const [lat, lng] = driverActionCoordinates(item);
      const markerType = item.eventType === "pod_captured" ? "pod" : "action";
      const locationKey = `${markerType}:${lat},${lng}`;
      if (!markersByLocation.has(locationKey)) markersByLocation.set(locationKey, []);
      markersByLocation.get(locationKey).push(item);
    });
    for (const group of markersByLocation.values()) {
      const [lat, lng] = driverActionCoordinates(group[0]);
      const firstEvent = group[0];
      const firstKey = String(firstEvent.eventId || firstEvent.id || firstEvent.sequence || `${firstEvent.eventType}:${firstEvent.occurredAtMs}`);
      const eventHeading = firstEvent.eventType === "pod_captured"
        ? "Driver took POD here"
        : actionLabel(firstEvent.eventType);
      const popup = group.length === 1
        ? `<strong>${escapeHtml(eventHeading)}</strong><br>${escapeHtml(timestamp(firstEvent.occurredAtMs))}${actionEventDetails(firstEvent, durations.get(firstKey))}${podPreviewButton(firstEvent)}`
        : `<strong>${group.length} ${group.every((item) => item.eventType === "pod_captured") ? "POD photos taken here" : "driver actions at this location"}</strong><div class="driver-action-event-list">${group.map((item) => {
          const key = String(item.eventId || item.id || item.sequence || `${item.eventType}:${item.occurredAtMs}`);
          const heading = item.eventType === "pod_captured" ? "Driver took POD here" : actionLabel(item.eventType);
          return `<details class="driver-action-event-item"><summary><strong>${escapeHtml(heading)}</strong><br><small>${escapeHtml(timestamp(item.occurredAtMs))} · ${escapeHtml(item.outcome || "unknown")}</small></summary>${actionEventDetails(item, durations.get(key))}${podPreviewButton(item)}</details>`;
        }).join("")}</div>`;
      const icon = L.divIcon({
        className: "driver-action-marker-host",
        html: actionMarkerIconHtml(group),
        iconSize: [50, 50],
        iconAnchor: [25, 47],
        popupAnchor: [0, -40],
      });
      const markerLabel = group.every((item) => item.eventType === "pod_captured")
        ? group.length === 1
          ? `Driver took POD here${group[0].metadata?.obdRef ? ` for OBD ${group[0].metadata.obdRef}` : ""}${group[0].subjectId ? ` on shipment ${group[0].subjectId}` : ""}; select to view its location`
          : `${group.length} POD photos were taken here; select to inspect each OBD`
        : group.length === 1
          ? `${actionLabel(group[0].eventType)} location marker`
          : `${group.length} driver actions at this GPS point; select to inspect each action`;
      const marker = L.marker([lat, lng], {
        icon, keyboard: true, riseOnHover: true,
        zIndexOffset: group.every((item) => item.eventType === "pod_captured") ? 1000 : 0,
        title: markerLabel,
        alt: markerLabel,
      })
        .bindPopup(popup, { maxWidth: 360 })
        .addTo(this.map);
      marker.getElement?.()?.setAttribute("aria-label", markerLabel);
      this.plotMarkers.push(marker);
    }
    this.routePointMarkers = new Map();
    locatedEvents.filter((item) => item.eventType === "route_point").forEach((item) => {
      const location = driverActionCoordinates(item);
      const pointKey = String(item.eventId || item.id || item.sequence || `${item.eventType}:${item.occurredAtMs}`);
      const marker = L.circleMarker(location, {
        radius: 5,
        color: "#fff",
        weight: 2,
        fillColor: "#334155",
        fillOpacity: 1,
      }).bindPopup(`<strong>${escapeHtml(actionLabel(item.eventType))}</strong><br>Recorded at: ${escapeHtml(timestamp(item.occurredAtMs))}<br>${location[0].toFixed(5)}, ${location[1].toFixed(5)}${item.accuracy != null ? `<br>GPS accuracy: ${escapeHtml(item.accuracy)} m` : ""}`).bindTooltip(escapeHtml(timestamp(item.occurredAtMs)), {direction: "top", sticky: true}).addTo(this.map);
      this.routePointMarkers.set(pointKey, marker);
      this.plotMarkers.push(marker);
    });
    if (points.length > 1) {
      routeSegments.filter((segment) => segment.points.length > 1).forEach((segment) => {
        const color = segment.phase === "returning" ? "#2563eb" : "#16a34a";
        const casing = L.polyline(segment.points, {
          color: "#fff",
          weight: 8,
          opacity: 0.88,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        }).addTo(this.map);
        casing._driverActionPhase = segment.phase;
        casing._driverActionVisibleOpacity = 0.88;
        const route = L.polyline(segment.points, {
          color,
          weight: 4,
          opacity: 0.96,
          lineCap: "round",
          lineJoin: "round",
          interactive: true,
          bubblingMouseEvents: false,
        });
        route._driverActionPhase = segment.phase;
        route._driverActionVisibleOpacity = 0.96;
        route.on("click", (event) => {
          event?.originalEvent?.stopPropagation?.();
          this._setRoutePhaseFilter(segment.phase);
        });
        route.addTo(this.map);
        this.routeCasingLayers.push(casing);
        this.routeLayers.push(route);
        this._applyRouteLayerVisibility(casing);
        this._applyRouteLayerVisibility(route);
      });
      this.route = this.routeLayers[this.routeLayers.length - 1] || null;
      this.routeCasing = this.routeCasingLayers[this.routeCasingLayers.length - 1] || null;
      this.map.fitBounds(L.latLngBounds(points), {
        padding: [48, 48],
        maxZoom: 14,
      });
    } else if (points.length === 1) this.map.flyTo(points[0], 14);
    const selectedSession = this.sessions.find((item) => String(item.sessionId || item.id) === this.activePlotSessionId);
    const plotStatus = this.container.querySelector("#driverActionPlotStatus");
    if (plotStatus) plotStatus.textContent = selectedSession
      ? `Showing ${selectedSession.title || "driver session"}: ${actionEvents.length} action events at their recorded GPS locations across ${markersByLocation.size} clickable map markers and ${points.length} route points.`
      : "Select a driver, then load a session plot when you need it.";
  }

  _setRoutePhaseFilter(phase) {
    if (phase !== null && phase !== "outbound" && phase !== "returning") return;
    this.routeFilterPhase = phase;
    [...this.routeCasingLayers, ...this.routeLayers]
      .forEach((layer) => this._applyRouteLayerVisibility(layer));
  }

  _applyRouteLayerVisibility(layer) {
    const visible = this.routeFilterPhase === null || layer._driverActionPhase === this.routeFilterPhase;
    layer.setStyle?.({ opacity: visible ? layer._driverActionVisibleOpacity : 0 });
  }

  _focusRoutePoint(point) {
    const location = driverActionCoordinates(point);
    if (!location || !this.map) return;
    const pointKey = String(point.eventId || point.id || point.sequence || `${point.eventType}:${point.occurredAtMs}`);
    const marker = this.routePointMarkers.get(pointKey);
    if (this.selectedRoutePointMarker && this.selectedRoutePointMarker !== marker) {
      this.selectedRoutePointMarker.setStyle?.({radius: 5, color: "#fff", weight: 2, fillColor: "#334155", fillOpacity: 1});
    }
    this.selectedRoutePointMarker = marker || null;
    marker?.setStyle?.({radius: 9, color: "#fbbf24", weight: 4, fillColor: "#c8102e", fillOpacity: 1});
    marker?.openPopup?.();
    this.map.flyTo(location, 17, {duration: 0.45});
  }

  _clearRoute() {
    this.routeLayers?.forEach((layer) => this.map?.removeLayer(layer));
    this.routeCasingLayers?.forEach((layer) => this.map?.removeLayer(layer));
    if (this.route && !this.routeLayers?.includes(this.route)) this.map?.removeLayer(this.route);
    if (this.routeCasing && !this.routeCasingLayers?.includes(this.routeCasing)) this.map?.removeLayer(this.routeCasing);
    this.route = null;
    this.routeCasing = null;
    this.routeLayers = [];
    this.routeCasingLayers = [];
    this.plotMarkers?.forEach((layer) => this.map?.removeLayer(layer));
    this.plotMarkers = [];
    this.routePointMarkers?.clear();
    this.selectedRoutePointMarker = null;
    this.events = [];
  }
  _onUpdated(update) {
    if (update?.deletionRequestUpdated) {
      if (this.isAdmin) void this._refreshDeletionRequests();
      if (update.driverId === this.selectedDriver?.id) void this._refreshSelectedSessions();
      return;
    }
    if (update?.driverId === this.selectedDriver?.id)
      void this.selectDriver(update.driverId);
  }
  async _refreshSelectedSessions() {
    const driverId = this.selectedDriver?.id;
    if (!driverId) return;
    try {
      const response = await DriverActionService.getSessions(driverId, 500);
      if (this.selectedDriver?.id !== driverId) return;
      this.sessions = newestFirst(response.items);
      this._renderSessions();
    } catch (_) {
      const status = this.container.querySelector("#driverActionPlotStatus");
      if (status) status.textContent = "Session approval changed, but the session list could not refresh. Retry by reopening the driver.";
    }
  }
  destroy() {
    clearTimeout(this._shipmentSearchTimer);
    this._shipmentSearchGeneration += 1;
    this._driverDrawerController?.abort();
    this._driverDrawerController = null;
    this._sessionFilterGeneration += 1;
    clearTimeout(this._sessionFilterTimer);
    this.map?.off?.("click", this.handleMapClick);
    this.map?.off?.("popupopen", this.handlePopupOpen);
    this._hideRequestOverlay();
    this._requestPending = false;
    this.unsubscribe?.();
    this.container.querySelector("#driverActionDeletionModal")?.remove();
    disposeLeafletMap("driverActionMap");
    this.map = null;
  }
}
