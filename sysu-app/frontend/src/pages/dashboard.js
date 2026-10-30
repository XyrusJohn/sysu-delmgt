import {
  initLeafletMap,
  switchMapTheme,
  updateMarker,
  focusOnLocation,
  clearMarkers,
  markers,
  removeMarker,
  addMinimalMapTiles,
  constrainMapToPhilippines,
  PHILIPPINES_BOUNDS,
} from "../components/MapManager.js";
import {
  initTrackingPanel,
  connectDriverTrackingSocket,
  destroyTrackingPanel,
  fitAllDrivers,
  clearOfflineDrivers,
} from "../components/MapTrackingPanel.js";
import {
  acceptLocationUpdate,
  GPS_STALE_MS,
  savedLocationStatus,
} from "../components/locationState.js";
import {
  EVENTS,
  socket,
  getDriverSocket,
  connectDriverSocket,
} from "../api/socket.js";
import { AuthService } from "../api/authService.js";
import { SAPService } from "../api/sapService.js";
import {
  mergeAssignmentGroups,
  isDeliveredAssignment,
  assignmentDisplayStatus,
  obdDeliveryStatus,
  queueDriverDisplayName,
  groupObdRowsByShipTo,
  driverAssignmentFields,
} from "./shipmentDisplay.js";
import { SAPAssignmentService } from "../api/sapAssignmentService.js";
import { PodService } from "../api/podService.js";
import { API_CONFIG } from "../api/config.js";
import { SecurityGuardService } from "../api/securityGuardService.js";
import { TruckCompanyService } from "../api/truckCompanyService.js";
import { StaffDriverService } from "../api/staffDriverService.js";
import { SystemErrorService } from "../api/systemErrorService.js";
import { fetchWithTimeout } from "../api/fetchWithTimeout.js";
import {
  systemDiagnosticsGuidance,
  systemDiagnosticsOperation,
  systemDiagnosticsSource,
  systemDiagnosticsSummary,
} from "../api/systemDiagnosticsGuidance.js";
import {
  subscribeRealtime,
  asCollectionSnapshot,
} from "../api/realtimeService.js";
import L from "leaflet";
import { DriverActionView } from "../components/DriverActionView.js";

//  XSS Prevention

const escapeHtml = (str) => {
  if (str == null) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
};
const setButtonBusy = (button, label = "Retrying") => {
  button.disabled = true;
  button.classList.add("inline-flex", "items-center", "gap-2");
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", label);
  button.innerHTML = `<span aria-hidden="true" class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"></span><span>${escapeHtml(label)}</span>`;
};
const resetButton = (button, label) => {
  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.removeAttribute("aria-label");
  button.textContent = label;
};
const formatCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : "—";
};
const timestampMillis = (value) => {
  if (Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (!value || typeof value !== "object") return 0;
  if (Number.isFinite(value.$timestamp)) return value.$timestamp;
  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  if (Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  return 0;
};

export class Dashboard {
  constructor() {
    this.config = {
      mapId: "map",
      sidePanelId: "sidePanel",
      logoutBtnId: "logoutBtn",
      gatekeeperId: "gatekeeper",
      uNameId: "uName",
      uAvId: "uAv",
      uRoleId: "uRole",
      securityOverlayId: "securityOverlay",
      fleetTreeId: "fleetTree",
    };

    this.state = {
      activeView: "overview",
      sapShipments: [],
      sapLoading: true,
      sapLoadError: false,
      sapLoadFailure: null,
      sapAssignments: {},
      sapDispatchDetails: {},
      sapDispatchDetailsErrors: {},
      sapDispatchDetailsMismatches: {},
      systemErrorLogs: [],
      systemErrorLogsLoading: false,
      systemErrorLogsLoaded: false,
      systemErrorLogsError: null,
      mobileDiagnosticRuns: [],
      mobileDiagnosticRunsError: null,
      mobileDiagnosticRunsHasMore: false,
      mobileDiagnosticRunsOffset: 0,
      mobileDiagnosticRunsLoadingMore: false,
      mobileDiagnosticRunHistories: {},
      mobileDiagnosticRunsExpanded: null,
      mobileDiagnosticRunsSearch: "",
      mobileDiagnosticRunsFilter: "all",
      systemErrorFilter: "open",
      sapSortKey: "SAPDispatchNumber",
      sapSortDir: 1,
      user: null,
      drivers: [],
      driversLoading: true,
      driversLoadError: false,
      liveTracking: {},
      liveScans: {}, // driverId +’ {lat, lng, status, name, sapDocId, lastSeen, shipmentNumber, truckPlate}
      liveScansLoading: true,
      sapDocCache: {}, // sapDocId +’ {shipmentNumber, truckPlate, tripStatus}
      sapFilter: "all",
      theme: "dark",
      sapGroupedByDispatch: {},
      queue: [],
      queueLoading: true,
      queueLoadError: false,
      assignmentsLoading: true,
      assignmentsLoadError: false,
      guardsLoading: true,
      guardsLoadError: false,
      truckCompaniesLoading: true,
      truckCompaniesLoadError: false,
      truckCompaniesCacheInfo: null,
      roleRequestsLoading: true,
      roleRequestsLoadError: false,
      assignTarget: null,
      requiredTruckType: null,
      overrideRequestId: null, // pending override request, if any
      overrideTokenId: null, // approved token id (used by next assign call)
      overrideRequestStatus: null, // 'pending' | 'approved' | 'denied' | 'revoked' | 'expired'
      ordersTruckTypeFilter: "all",
      podZoomLevel: 1,
      podIsDragging: false,
      podDragStartX: 0,
      podDragStartY: 0,
      podImageOffsetX: 0,
      podImageOffsetY: 0,
      podMaxOffsetX: 0,
      podMaxOffsetY: 0,
      podVelocityX: 0,
      podVelocityY: 0,
      podMomentumAnimationFrame: null,
      podResetAnimationFrame: null,
      _lastDragTime: 0,
      _lastDragX: 0,
      _lastDragY: 0,
      _activeDocsTab: "pending",
    };

    this.renderTimer = null;
    this._sapDispatchDetailsPending = new Set();
    this._sapDispatchDetailsFetchedAt = new Map();
    this._sapDispatchDetailsRetryAfter = new Map();
    this._podPreviewEscapeListener = null;
    this._driverActionView = null;
    this._globalEscapeListener = null;
    this._sapObdPreviewGroups = [];
    this._bindMethods();
  }

  _bindMethods() {
    this.handleLogout = this.handleLogout.bind(this);
    this.handleNavClick = this.handleNavClick.bind(this);
    this._updateGuardFullNamePreview =
      this._updateGuardFullNamePreview.bind(this);
  }

  _getSavedTheme() {
    try {
      const savedTheme = localStorage.getItem("sysu-theme");
      return savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : "dark";
    } catch {
      return "dark";
    }
  }

  _applyTheme(theme) {
    const selectedTheme = theme === "light" ? "light" : "dark";
    const iconLight = document.getElementById("iconLight");
    const iconDark = document.getElementById("iconDark");
    const themeToggle = document.getElementById("themeToggle");
    const isLight = selectedTheme === "light";

    this.state.theme = selectedTheme;
    if (isLight) {
      document.documentElement.setAttribute("data-theme", "light");
      iconLight?.classList.add("hidden");
      iconDark?.classList.remove("hidden");
    } else {
      document.documentElement.removeAttribute("data-theme");
      iconLight?.classList.remove("hidden");
      iconDark?.classList.add("hidden");
    }
    themeToggle?.setAttribute(
      "aria-label",
      `Switch to ${isLight ? "dark" : "light"} theme`,
    );
    if (themeToggle)
      themeToggle.title = `Switch to ${isLight ? "dark" : "light"} theme`;

    try {
      localStorage.setItem("sysu-theme", selectedTheme);
    } catch {
      //  The theme remains active for this session if storage is unavailable.

    }
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const isSelected = button.dataset.themeChoice === selectedTheme;
      button.setAttribute("aria-pressed", String(isSelected));
      button.classList.toggle("border-sysu-red", isSelected);
      button.classList.toggle("bg-sysu-red/5", isSelected);
      button.classList.toggle("ring-1", isSelected);
      button.classList.toggle("ring-sysu-red/30", isSelected);
    });
    switchMapTheme(selectedTheme);
  }

  _setupThemeControls() {
    const themeToggle = document.getElementById("themeToggle");
    this._applyTheme(this._getSavedTheme());

    themeToggle?.addEventListener("click", () => {
      this._applyTheme(this.state.theme === "light" ? "dark" : "light");
    });
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () =>
        this._applyTheme(button.dataset.themeChoice),
      );
    });
  }

  async init() {
    SystemErrorService.installGlobalHandlers((message) =>
      this._showErrorToast(message),
    );
    this._startupStage = "authentication and profile verification";
    this._startupRecoveryTimer = setTimeout(
      () => this._showStartupRecovery(),
      15000,
    );
    AuthService.subscribe((user, error) => {
      if (error) {
        if (
          ["NOT_REGISTERED", "Unauthorized", "ACCOUNT_DISABLED"].includes(
            error.message,
          )
        ) {
          window.location.href = "index.html";
        }
        return;
      }

      if (user) {
        if (user.roleChanged) {
          this.triggerSecurityEnforcement();
        } else {
          this._startupStage = "initial dashboard data loading";
          this.state.user = user;
          void SystemErrorService.flushReports();
          this._updateUserUI(user);
          this.applyRBAC(user);
          this._startDataEngines();
        }
      }
    });

    this._initMap();
    this._setupEventListeners();
    this._listenToRoleRequests();
  }

  applyRBAC(user) {
    const role = user.role || "pending";

    const isAdmin = role === "admin" || role === "super_admin";
    const canSeeQR =
      role === "admin" || role === "super_admin" || role === "qr_generator";

    const qrBtn = document.getElementById("rQR");
    if (qrBtn) {
      qrBtn.style.display = canSeeQR ? "flex" : "none";
    }

    const settingsBtn = document.getElementById("rSettings");
    if (settingsBtn) {
      settingsBtn.style.display = isAdmin ? "flex" : "none";
    }

    const usersBtn = document.getElementById("rUsers");
    if (usersBtn) {
      usersBtn.style.display = isAdmin ? "flex" : "none";
    }

    const canSeeDriverAction = [
      "fleet_manager",
      "admin",
      "super_admin",
    ].includes(role);
    ["rDriverAction", "lDriverAction"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.style.display = canSeeDriverAction ? "flex" : "none";
    });

    const exportBtn = document.getElementById("tbarExportArea");
    if (exportBtn) {
      exportBtn.style.display = isAdmin ? "flex" : "none";
    }

    //  Show admin-only sub-tabs in the Documents view

    const guardsTab = document.getElementById("docsGuardsTabBtn");
    const tcTab = document.getElementById("docsTruckCompaniesTabBtn");
    const warehouseTab = document.getElementById("docsWarehouseTabBtn");
    const roleReqTab = document.getElementById("docsRoleRequestsTabBtn");
    const systemErrorsTab = document.getElementById("docsSystemErrorsTabBtn");
    const isSuperAdmin = role === "super_admin";
    if (guardsTab) guardsTab.classList.toggle("hidden", !isAdmin);
    if (tcTab) tcTab.classList.toggle("hidden", !isAdmin);
    if (warehouseTab) warehouseTab.classList.toggle("hidden", !isSuperAdmin);
    if (roleReqTab) roleReqTab.classList.toggle("hidden", !isAdmin);
    if (systemErrorsTab) systemErrorsTab.classList.toggle("hidden", !isAdmin);
  }

  async _startDataEngines() {
    let assignmentReady;
    let assignmentSnapshotReceived = false;
    let sapSyncSettled = false;
    const assignmentsLoaded = new Promise((r) => {
      assignmentReady = r;
    });

    try {
      SAPService.subscribeToAssignments(
        (data) => {
          if (!assignmentSnapshotReceived) {
            assignmentSnapshotReceived = true;
          }
          this.state.sapAssignments = data;
          this.state.assignmentsLoading = false;
          this.state.assignmentsLoadError = false;
          this._reconcileLiveScansWithAssignments(data);
          this._rebuildShipmentGroups();
          assignmentReady();
          this._renderAll();
          this._scheduleLiveScansRender();
          this._refreshOpenDispatchDetail();
        },
        (err) => {
          console.warn("Assignments subscription failed:", err);
          this._notifyFailure(
            "assignment-subscription",
            err,
            "Live shipment data is temporarily unavailable. Check your connection and retry.",
          );
          this.state.assignmentsLoading = false;
          this.state.assignmentsLoadError = true;
          assignmentReady();
          this._renderAll();
        },
      );
    } catch (err) {
      this.state.assignmentsLoading = false;
      this.state.assignmentsLoadError = true;
      assignmentReady(); // unblock even on failure
      console.warn(err.message);
      this._notifyFailure(
        "assignment-subscription",
        err,
        "Live shipment data could not be started. Refresh and try again.",
      );
    }

    this._subscribeGuards();
    this._subscribeTruckCompanies();

    try {
      let initialDataTimeout;
      try {
        await Promise.race([
          (async () => {
            await this._syncSAP(true); // defer render until assignments arrive
            sapSyncSettled = true;
            await assignmentsLoaded;
            this._renderAll();
          })(),
          new Promise((resolve) => {
            initialDataTimeout = setTimeout(() => {
              console.warn("[startup] initial data wait reached 5 seconds", {
                sapSyncSettled,
                assignmentSnapshotReceived,
              });
              resolve();
            }, 5000);
          }),
        ]);
      } finally {
        clearTimeout(initialDataTimeout);
      }

      this._unlockDashboard();
    } catch (err) {
      console.error("Initial sync error:", err);
      this._notifyFailure(
        "dashboard-startup",
        err,
        "Some dashboard data could not be loaded. Check your connection and retry.",
      );
      this._unlockDashboard();
    }

    setInterval(() => this._syncSAP(), 300000);

    subscribeRealtime(
      "drivers",
      {},
      (rows) => {
        this.state.drivers = asCollectionSnapshot(rows).docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        this.state.driversLoading = false;
        this.state.driversLoadError = false;
        this._renderAll();
      },
      (err) => {
        console.warn("Drivers subscription failed:", err);
        this._notifyFailure(
          "driver-subscription",
          err,
          "Driver data is temporarily unavailable. Check your connection and retry.",
        );
        this.state.driversLoading = false;
        this.state.driversLoadError = true;
        this._renderAll();
      },
    );

    subscribeRealtime(
      "queue",
      { order: "asc", limit: 100 },
      (rows) => {
        const docs = asCollectionSnapshot(rows).docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        this.state.queue = docs
          .filter((q) => q.status !== "completed")
          .sort((a, b) => {
            //  Prefer entryTime, fall back to joinedAt, then to updatedAt

            const getTs = (d) =>
              d.entryTime && d.entryTime.toDate
                ? d.entryTime.toDate()
                : d.joinedAt && d.joinedAt.toDate
                  ? d.joinedAt.toDate()
                  : d.updatedAt
                    ? new Date(d.updatedAt)
                    : new Date(0);
            return getTs(a) - getTs(b);
          });
        this.state.queueLoading = false;
        this.state.queueLoadError = false;
        this._scheduleLiveScansRender();
        this._renderAll();
      },
      (err) => {
        console.warn("Queue subscription failed:", err);
        this._notifyFailure(
          "queue-subscription",
          err,
          "Queue data is temporarily unavailable. Check your connection and retry.",
        );
        this.state.queueLoading = false;
        this.state.queueLoadError = true;
        this._renderAll();
      },
    );

    this._setupSocket();
    this._setupDriverLocationSocket();
    this._setupPodSocket();
    this._renderLiveScansTable();
    this._seedLastKnownLocations();
  }

  /**
   * ONE-SHOT poll on page load. Pulls the last persisted location for every
   * in-flight dispatch (assigned / loading / loaded / fully_loaded / in_transit) and seeds both
   * `liveTracking` and `liveScans` so markers appear on the overview map
   * immediately — even before any live `driver_moving` event arrives from
   * the driver app.
   *
   * After this runs, live socket events take over (see `_setupSocket` and
   * `_setupDriverLocationSocket`). No interval poll: refreshing the page
   * is the explicit way to re-sync.
   */
  _setupPodSocket() {
    if (this._podSocketHandler) return;
    this._podSocketHandler = () => {
      //  POD documents are fetched when a preview opens; notifications

      //  refresh availability without modifying authoritative trip state.

      this._renderSapTable();
    };
    socket.on(EVENTS.POD_UPDATED, this._podSocketHandler);
  }

  async _seedLastKnownLocations() {
    try {
      const { locations } = await SAPAssignmentService.fetchActiveLocations();
      for (const loc of locations || []) {
        this._applyTrackingUpdate(
          {
            driverId: loc.driverId,
            lat: loc.lat,
            lng: loc.lng,
            name: loc.driverName,
            sapDocId: loc.dispatchKey,
            truckPlate: loc.truckPlate,
            shipmentNumber: loc.dispatchKey,
            tripStatus: loc.tripStatus,
            timestamp: loc.at || 0,
            status: savedLocationStatus(loc.tripStatus),
          },
          "location",
          "mysql",
        );
      }
    } catch (error) {
      console.warn("Saved driver locations unavailable");
      this._notifyFailure(
        "saved-locations",
        error,
        "Saved driver locations could not be loaded. Live updates may be delayed.",
      );
    } finally {
      this.state.liveScansLoading = false;
      this._scheduleLiveScansRender();
    }
  }

  async _syncSAP(skipRender = false) {
    try {
      const shipments = await SAPService.fetchShipments();
      if (SAPService.state?.lastError)
        throw new Error(SAPService.state.lastError);
      void SystemErrorService.resolveOperation(
        "frontend_operation_failure",
        "sap-sync",
      ).catch(() => {});
      this.state.sapShipments = shipments;
      this.state.sapLoadError = false;
      this.state.sapLoadFailure = null;
      this._sapErrorNotified = false;
      this._rebuildShipmentGroups();
      this.state.sapLoading = false;
      if (!skipRender) this._renderAll();
    } catch (err) {
      this.state.sapLoading = false;
      this.state.sapLoadError = true;
      this.state.sapLoadFailure = this._sapFailureGuidance(
        SAPService.state?.lastErrorStatus,
        SAPService.state?.lastRequestId,
      );
      console.error("SAP sync error:", err);
      if (!this._sapErrorNotified) {
        this._sapErrorNotified = true;
        this._notifyFailure(
          "sap-sync",
          err,
          `${this.state.sapLoadFailure.title} ${this.state.sapLoadFailure.action}`,
        );
      }
      //  Keep the last successful shipment snapshot visible if SAP is temporarily unavailable.

      if (!skipRender) this._renderAll();
      else this._renderSapTable();
    } finally {
      this._updateConnectionBadge();
    }
  }

  _sapFailureGuidance(status, requestId) {
    if (status === 503) {
      return {
        title: "SAP is temporarily unavailable.",
        action: "Wait a moment and try again. Do not make new assignments until the shipment list refreshes.",
        requestId: requestId || null,
      };
    }
    if (status === 401) {
      return {
        title: "Your sign-in has expired.",
        action: "Sign in again, then reopen the shipment list.",
        requestId: requestId || null,
      };
    }
    if (status === 403) {
      return {
        title: "Your account cannot open this shipment list.",
        action: "Ask an administrator to check your account access.",
        requestId: requestId || null,
      };
    }
    if (status === 429) {
      return {
        title: "Too many requests were made.",
        action: "Wait a moment before trying again.",
        requestId: requestId || null,
      };
    }
    if (status >= 500) {
      return {
        title: "SYSU App could not load the shipment list.",
        action: "Try again in a moment. If it keeps happening, contact IT.",
        requestId: requestId || null,
      };
    }
    if (!status) {
      return {
        title: "SYSU App could not be reached.",
        action: "Check your internet and try again. If it keeps happening, contact IT.",
        requestId: null,
      };
    }
    return {
      title: "The shipment list could not be loaded.",
      action: "Try again. If it keeps happening, contact IT.",
      requestId: requestId || null,
    };
  }

  _sapFailureNotice({ stale = false, status, requestId, centered = false } = {}) {
    const failure = this._sapFailureGuidance(
      status ?? SAPService.state?.lastErrorStatus,
      requestId ?? SAPService.state?.lastRequestId,
    );
    const title = stale ? "Showing the last shipment list that loaded." : failure.title;
    const action = stale
      ? `${failure.action} Do not use this old list for new assignments.`
      : failure.action;
    const layout = centered
      ? "flex flex-col items-center justify-center gap-2 min-h-[240px] px-4 text-center"
      : "flex flex-wrap items-center justify-between gap-2";
    return `<div role="alert" class="${layout} rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-db-text2">
      <div><p class="font-semibold">${escapeHtml(title)}</p><p class="mt-1 text-xs text-db-text3">${escapeHtml(action)}${failure.requestId ? ` Reference: ${escapeHtml(failure.requestId)}` : ""}</p></div>
      <button type="button" data-action="sap-retry" class="shrink-0 rounded-lg border border-db-border px-3 py-2 text-xs font-bold text-db-text2 hover:bg-db-item-hover">Retry</button>
    </div>`;
  }

  _updateConnectionBadge() {
    const badge = document.getElementById("sapConnBadge");
    if (!badge) return;

    const dot = badge.querySelector(".rounded-full");
    const text = document.getElementById("sapConnStatus");
    const helpButton = document.getElementById("sapConnHelpButton");
    const helpText = document.getElementById("sapConnHelpText");
    const isConnected = !SAPService.state?.lastError;

    if (isConnected) {
      if (dot)
        dot.className = "w-1.5 h-1.5 rounded-full bg-green-500 pulse-dot";
      if (text) {
        text.className = "text-[11px] text-green-500";
        text.textContent = "Connected";
      }
      if (helpButton) {
        helpButton.classList.add("hidden");
        helpButton.setAttribute("aria-expanded", "false");
      }
      if (helpText) helpText.classList.add("hidden");
    } else {
      if (dot) dot.className = "w-1.5 h-1.5 rounded-full bg-red-500";
      if (text) {
        text.className = "text-[11px] text-red-500";
        text.textContent = "Disconnected";
      }
      if (helpButton) helpButton.classList.remove("hidden");
      if (helpText) {
        const failure = this._sapFailureGuidance(
          SAPService.state?.lastErrorStatus,
          SAPService.state?.lastRequestId,
        );
        helpText.textContent = `${failure.title} ${failure.action}${failure.requestId ? ` Reference: ${failure.requestId}` : ""}`;
      }
    }
  }

  _toggleSapConnectionHelp() {
    const button = document.getElementById("sapConnHelpButton");
    const helpText = document.getElementById("sapConnHelpText");
    if (!button || !helpText || button.classList.contains("hidden")) return;
    const isExpanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isExpanded));
    helpText.classList.toggle("hidden", isExpanded);
  }

  _setSapFilterTab(type) {
    const tabIdMap = {
      all: "sapTabAll",
      delivered: "sapTabDelivered",
      in_transit: "sapTabTransit",
      fully_loaded: "sapTabFullyLoaded",
      loading: "sapTabLoading",
      assigned: "sapTabAssigned",
      forAssignment: "sapTabForAssignment",
    };
    this.state.sapFilter = type;

    document.querySelectorAll('[id^="sapTab"]').forEach((tab) => {
      tab.classList.remove("bg-db-item-active", "text-db-text", "active");
      tab.classList.add("bg-db-panel/40", "text-db-text3");
    });

    const activeTab = document.getElementById(tabIdMap[type]);
    if (activeTab) {
      activeTab.classList.remove("bg-db-panel/40", "text-db-text3");
      activeTab.classList.add("bg-db-item-active", "text-db-text", "active");
    }
  }

  _initMap() {
    try {
      this.map = initLeafletMap(this.config.mapId);
      window.map = this.map;
    } catch (err) {
      console.error("Map init error:", err);
      this._notifyFailure(
        "map-initialization",
        err,
        "The map could not be loaded. Refresh the page or check your connection.",
      );
    }
  }

  //  Driver Tracking View


  _trackingViewReady = false;

  _initTrackingView() {
    if (!this._trackingViewReady) {
      initTrackingPanel();
      connectDriverTrackingSocket();
      this._trackingViewReady = true;
    }

    //  Give the container a tick to settle before invalidating Leaflet size

    setTimeout(() => {
      if (window.__trackingMap) window.__trackingMap.invalidateSize();
    }, 200);
  }

  fitTrackingBounds() {
    fitAllDrivers();
  }

  clearOfflineMarkers() {
    clearOfflineDrivers();
  }

  triggerSecurityEnforcement() {
    const overlay = document.getElementById(this.config.securityOverlayId);
    if (overlay) {
      overlay.style.opacity = "1";
      overlay.style.pointerEvents = "auto";
      setTimeout(() => window.location.reload(), 2000);
    }
  }

  _unlockDashboard() {
    clearTimeout(this._startupRecoveryTimer);
    this._startupRecoveryTimer = null;
    const gatekeeper = document.getElementById(this.config.gatekeeperId);
    if (gatekeeper) {
      gatekeeper.style.opacity = "0";
      setTimeout(() => gatekeeper.remove(), 500);
    }
  }

  _showStartupRecovery() {
    const gatekeeper = document.getElementById(this.config.gatekeeperId);
    if (!gatekeeper) return;

    console.error("[startup] dashboard startup timed out", {
      stage: this._startupStage,
    });
    gatekeeper.innerHTML = `
            <div class="max-w-md px-6 text-center">
                <h2 class="text-db-text text-lg font-black tracking-[0.12em] uppercase">Dashboard could not start</h2>
                <p class="mt-3 text-sm text-db-text3">Secure sign-in or the live profile connection did not respond. The dashboard stays locked until your account is verified.</p>
                <div class="mt-6 flex justify-center gap-3">
                    <button id="retryDashboardStartup" class="rounded-lg bg-sysu-red px-4 py-2 text-sm font-bold text-white">Retry</button>
                    <button id="returnToDashboardSignIn" class="rounded-lg border border-db-border px-4 py-2 text-sm font-bold text-db-text">Return to sign in</button>
                </div>
            </div>`;
    gatekeeper.setAttribute("role", "alert");
    gatekeeper.setAttribute("aria-live", "assertive");
    gatekeeper
      .querySelector("#retryDashboardStartup")
      ?.addEventListener("click", () => window.location.reload());
    gatekeeper
      .querySelector("#returnToDashboardSignIn")
      ?.addEventListener("click", () => {
        window.location.href = "index.html";
      });
  }

  _updateUserUI(user) {
    const nameEl = document.getElementById(this.config.uNameId);
    const avEl = document.getElementById(this.config.uAvId);
    const uRoleEl = document.getElementById(this.config.uRoleId);
    const name = user.displayName || user.username || "User";
    const initial = name[0].toUpperCase();
    const roleText = user.role
      ? user.role.replace(/_/g, " ").toUpperCase()
      : "USER";

    //  Header user pill —" simple text and photo

    if (nameEl) nameEl.textContent = name;
    if (uRoleEl) uRoleEl.textContent = roleText;
    if (avEl) {
      if (user.photoURL) {
        avEl.innerHTML = "";
        const img = document.createElement("img");
        img.setAttribute("src", user.photoURL);
        img.setAttribute("alt", escapeHtml(name));
        img.className = "w-full h-full object-cover";
        avEl.appendChild(img);
      } else {
        avEl.textContent = initial;
      }
    }

    //  Fly-out panel —" photo and role

    const pTopName = document.getElementById("pTopName");
    const pTopRole = document.getElementById("pTopRole");
    const pTopAv = document.getElementById("pTopAv");

    if (pTopName) pTopName.textContent = name;
    if (pTopRole) pTopRole.textContent = roleText;
    if (pTopAv) {
      if (user.photoURL) {
        pTopAv.innerHTML = "";
        const img = document.createElement("img");
        img.setAttribute("src", user.photoURL);
        img.setAttribute("alt", escapeHtml(name));
        img.className = "w-full h-full object-cover rounded-full";
        pTopAv.appendChild(img);
      } else {
        pTopAv.textContent = initial;
      }
    }
  }

  _openProfileModal(user) {
    const modal = document.getElementById("profileModal");
    if (!modal || !user) return;
    modal.classList.remove("hidden");
    modal.style.display = "flex";

    const isSuperAdmin = user.role === "super_admin";
    const hasPending = !!user.pendingRoleChange;
    const roleLabels = {
      super_admin: "Super Admin",
      admin: "Admin",
      dispatcher: "Dispatcher",
      viewer: "Viewer",
    };

    const username = user.username || "";
    const profile = user.profile || {};
    let firstName = profile.firstName || profile.fn || "";
    let middleName = profile.middleName || "";
    let lastName = profile.lastName || profile.ln || "";
    const legacyName = profile.name || user.displayName || "";
    if (!firstName && !lastName && legacyName && legacyName !== username) {
      const parts = legacyName.trim().split(/\s+/);
      firstName = parts.shift() || "";
      lastName = parts.pop() || "";
      middleName = parts.join(" ");
    } else if (!middleName && profile.mi) {
      middleName = profile.mi;
    }
    document.getElementById("profileModalFirstName").value = firstName;
    document.getElementById("profileModalMiddleName").value = middleName;
    document.getElementById("profileModalLastName").value = lastName;
    document.getElementById("profileModalUsername").value = username;

    //  Reset role request UI

    const requestPanel = document.getElementById(
      "profileModalRoleRequestPanel",
    );
    const requestSubmitBtn = document.getElementById("profileModalRequest");
    if (requestPanel) {
      requestPanel.classList.add("hidden");
      requestPanel.classList.remove("flex");
    }
    if (requestSubmitBtn) requestSubmitBtn.classList.add("hidden");

    document
      .getElementById("profileModalRoleSelectWrapper")
      ?.classList.add("hidden");
    document
      .getElementById("profileModalRoleStaticWrapper")
      ?.classList.remove("hidden");
    document.getElementById("profileModalRoleStatic").textContent =
      roleLabels[user.role] || user.role || "Viewer";

    if (!isSuperAdmin) {
      //  Non-Super Admin: read-only role + request button

      document
        .getElementById("profileModalRoleSelectWrapper")
        ?.classList.add("hidden");
      document
        .getElementById("profileModalRoleStaticWrapper")
        ?.classList.remove("hidden");
      document.getElementById("profileModalRoleStatic").textContent =
        roleLabels[user.role] || user.role || "Viewer";

      const requestRoleBtn = document.getElementById(
        "profileModalRequestRoleBtn",
      );
      if (requestRoleBtn) {
        if (hasPending) {
          requestRoleBtn.textContent = "Pending Approval";
          requestRoleBtn.disabled = true;
          requestRoleBtn.classList.add("opacity-50", "cursor-not-allowed");
        } else {
          requestRoleBtn.textContent = "Request Role Change";
          requestRoleBtn.disabled = false;
          requestRoleBtn.classList.remove("opacity-50", "cursor-not-allowed");
        }
        requestRoleBtn.classList.remove("hidden");
      }
    }

    //  Pending banner

    const pendingBanner = document.getElementById("profileModalPendingBanner");
    if (pendingBanner) {
      if (hasPending) {
        pendingBanner.innerHTML = `
                    <div class="flex items-center gap-2 bg-sysu-gold/10 border border-sysu-gold/30 rounded-lg px-3 py-2">
                        <svg class="w-4 h-4 text-sysu-gold shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span class="text-[12px] text-sysu-gold">Role change to <strong>${roleLabels[user.pendingRoleChange] || user.pendingRoleChange}</strong> is pending admin approval.</span>
                    </div>`;
        pendingBanner.classList.remove("hidden");
        pendingBanner.classList.add("flex");
      } else {
        pendingBanner.classList.add("hidden");
      }
    }

    const avatarImg = document.getElementById("profileModalAvatarImg");
    if (user.photoURL) {
      avatarImg.src = user.photoURL;
      document.getElementById("profileModalPhotoUrl").value = user.photoURL;
    } else {
      const initial = (user.displayName ||
        user.username ||
        "?")[0].toUpperCase();
      avatarImg.src =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'%3E%3Ccircle cx='36' cy='36' r='36' fill='%23c8102e'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='central' text-anchor='middle' fill='white' font-size='32' font-family='sans-serif' font-weight='bold'%3E" +
        initial +
        "%3C/text%3E%3C/svg%3E";
      document.getElementById("profileModalPhotoUrl").value = "";
    }

    modal.style.display = "flex";
    setTimeout(() => {
      modal.classList.remove("hidden");
      modal.classList.add("flex");
    }, 10);

    document.getElementById("profileModalFirstName").focus();
  }

  _closeProfileModal() {
    const modal = document.getElementById("profileModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.style.display = "none";
  }

  async _saveProfile() {
    const firstNameInput = document.getElementById("profileModalFirstName");
    const middleNameInput = document.getElementById("profileModalMiddleName");
    const lastNameInput = document.getElementById("profileModalLastName");
    const photoUrlInput = document.getElementById("profileModalPhotoUrl");

    const firstName = (firstNameInput.value || "").trim().replace(/\s+/g, " ");
    const middleName = (middleNameInput.value || "")
      .trim()
      .replace(/\s+/g, " ");
    const lastName = (lastNameInput.value || "").trim().replace(/\s+/g, " ");
    const newPhoto = (photoUrlInput.value || "").trim();

    if (!firstName || !lastName) {
      const invalidInput = !firstName ? firstNameInput : lastNameInput;
      invalidInput.classList.add("border-red-500");
      invalidInput.focus();
      return;
    }
    firstNameInput.classList.remove("border-red-500");
    lastNameInput.classList.remove("border-red-500");

    const saveBtn = document.getElementById("profileModalSave");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;

    try {
      const updatedProfile = await AuthService.saveProfile({
        displayName: [firstName, middleName, lastName]
          .filter(Boolean)
          .join(" "),
        photoURL: newPhoto || null,
        profile: {
          firstName,
          middleName,
          lastName,
          fn: firstName,
          mi: middleName ? `${middleName[0].toUpperCase()}.` : "",
          ln: lastName,
          name: [firstName, middleName, lastName].filter(Boolean).join(" "),
        },
      });
      this.state.user = updatedProfile;
      this._updateUserUI(updatedProfile);
      this.applyRBAC(updatedProfile);
      this._showToast("Profile updated");

      this._closeProfileModal();
    } catch (err) {
      console.error("Profile save error:", err);
      this._notifyFailure(
        "profile-save",
        err,
        "Profile changes could not be saved. Check your connection and try again.",
      );
    } finally {
      saveBtn.textContent = originalText;
      saveBtn.disabled = false;
    }
  }

  _showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    clearTimeout(this._toastTimeout);
    toast.classList.remove("toast-error");
    toast.classList.remove("flex", "items-start");
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = message;
    toast.classList.add("show");
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }

  _showErrorToast(
    message = "Something went wrong. Check your connection and try again.",
  ) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    const now = Date.now();
    if (
      this._lastErrorToast?.message === message &&
      now - this._lastErrorToast.at < 8000
    )
      return;
    this._lastErrorToast = { message, at: now };
    clearTimeout(this._toastTimeout);
    toast.classList.add("toast-error");
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", "assertive");
    toast.setAttribute("aria-atomic", "true");
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.className =
      "mr-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-black";
    icon.textContent = "!";
    const label = document.createElement("span");
    label.textContent = message;
    toast.replaceChildren(icon, label);
    toast.classList.add("flex", "items-start");
    toast.classList.add("show");
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove("show", "toast-error", "flex", "items-start");
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
    }, 5000);
  }

  _notifyFailure(
    operation,
    error,
    message = "Something went wrong. Check your connection and try again.",
  ) {
    SystemErrorService.report("frontend_operation_failure", {
      operation,
      errorName: error?.name || "Error",
    });
    this._showErrorToast(message);
  }

  _listenToRoleRequests() {
    //  Pure Socket.IO listener for role requests, replacing the former snapshot subscription.

    socket.on(EVENTS.ROLE_REQUEST_CREATED, (req) => {
      this._handleRoleRequestUpdate(req);
    });

    socket.on(EVENTS.ROLE_REQUEST_UPDATED, (req) => {
      this._handleRoleRequestUpdate(req);
    });

    socket.on(EVENTS.USER_ROLE_CHANGED, ({ uid, role }) => {
      const currentUser = this.state.user;
      if (currentUser?.uid === uid || currentUser?.id === uid) {
        const updated = { ...currentUser, role, pendingRoleChange: null };
        this.state.user = updated;
        AuthService.updateProfile(updated);
        this._updateUserUI(updated);
        this.applyRBAC(updated);
      }
    });

    //  Request initial list via socket

    this._fetchRoleRequestsSocket();
  }

  _fetchRoleRequestsSocket() {
    if (!socket.connected) return;
    socket.emit(EVENTS.GET_ROLE_REQUESTS, { status: "all" }, (res) => {
      if (res && res.success && Array.isArray(res.data)) {
        this.state._roleRequestsList = res.data;
        this.state.roleRequestsLoading = false;
        this.state.roleRequestsLoadError = false;
        const pendingCount = res.data.filter(
          (r) => r.status === "pending",
        ).length;
        this._refreshRoleRequestBadge(pendingCount);
        if (this.state._activeDocsTab === "role-requests") {
          this._renderRoleRequestsInDocs();
        }
      } else {
        this.state.roleRequestsLoading = false;
        this.state.roleRequestsLoadError = true;
        if (this.state._activeDocsTab === "role-requests")
          this._renderRoleRequestsInDocs();
      }
    });
  }

  _handleRoleRequestUpdate(req) {
    this.state.roleRequestsLoading = false;
    this.state.roleRequestsLoadError = false;
    if (!this.state._roleRequestsList) this.state._roleRequestsList = [];
    const index = this.state._roleRequestsList.findIndex(
      (r) => r.id === req.id,
    );
    if (index >= 0) {
      this.state._roleRequestsList[index] = {
        ...this.state._roleRequestsList[index],
        ...req,
      };
    } else {
      this.state._roleRequestsList.unshift(req);
    }
    const pendingCount = this.state._roleRequestsList.filter(
      (r) => r.status === "pending",
    ).length;
    this._refreshRoleRequestBadge(pendingCount);
    if (this.state._activeDocsTab === "role-requests") {
      this._renderRoleRequestsInDocs();
    }
  }

  _refreshRoleRequestBadge(count) {
    const badge = document.getElementById("docsBadgeRoleRequests");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  _renderRoleRequestsInDocs() {
    const container = document.getElementById("docsListContainer");
    if (!container) return;
    if (this.state.roleRequestsLoading) {
      container.innerHTML = this._loadingCards("Loading role requests");
      return;
    }
    if (this.state.roleRequestsLoadError) {
      container.innerHTML =
        '<p class="text-sm text-sysu-red">Role requests unavailable.</p>';
      return;
    }

    const requests = this.state._roleRequestsList || [];
    const pending = requests.filter((r) => r.status === "pending");
    const history = requests.filter((r) => r.status !== "pending");

    const roleLabels = {
      super_admin: "Super Admin",
      admin: "Admin",
      dispatcher: "Dispatcher",
      viewer: "Viewer",
      fleet_manager: "Fleet Manager",
      qr_generator: "QR Generator",
      driver: "Driver",
    };

    if (requests.length === 0) {
      container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-16 text-db-text3 text-sm gap-2">
                    <svg class="w-10 h-10 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"/>
                    </svg>
                    No role change requests found.
                </div>`;
      return;
    }

    const renderCard = (req) => {
      const isPending = req.status === "pending";
      const statusClass =
        req.status === "approved"
          ? "bg-green-500/15 border-green-500/30 text-green-400"
          : req.status === "rejected"
            ? "bg-sysu-red/15 border-sysu-red/30 text-sysu-red"
            : "bg-sysu-gold/15 border-sysu-gold/30 text-sysu-gold";

      const elapsed = this._formatElapsed(
        req.createdAt ? new Date(req.createdAt) : null,
      );

      return `
            <div class="bg-db-panel border border-db-border rounded-xl p-5 hover:border-sysu-gold/30 transition-all">
                <div class="flex items-start justify-between gap-4">
                    <div class="flex flex-col gap-1 min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-sm font-bold text-db-text">${escapeHtml(req.requesterName || "User")}</span>
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-db-item-hover text-db-text3 border border-db-border">${roleLabels[req.currentRole] || req.currentRole}</span>
                            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusClass}">${escapeHtml(req.status)}</span>
                        </div>
                        
                        <div class="flex items-center gap-2 text-xs mt-2 bg-db-bg border border-db-border p-2.5 rounded-lg w-max">
                            <span class="text-db-text3">Requested Role:</span>
                            <span class="text-db-text2 line-through">${roleLabels[req.currentRole] || req.currentRole}</span>
                            <svg class="w-3.5 h-3.5 text-sysu-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
                            <span class="text-sysu-gold font-bold uppercase">${roleLabels[req.requestedRole] || req.requestedRole}</span>
                        </div>
                        
                        ${req.rejectionReason ? `<div class="text-xs text-sysu-red/80 mt-1">Reason: ${escapeHtml(req.rejectionReason)}</div>` : ""}
                        <span class="text-[11px] text-db-text3 opacity-60 mt-1">Submitted ${elapsed}</span>
                    </div>

                    ${
                      isPending
                        ? `
                    <div class="flex items-center gap-2 shrink-0">
                        <button
                            data-action="reject-role-request-socket"
                            data-request-id="${escapeHtml(req.id)}"
                            class="px-3.5 py-1.5 text-xs font-bold text-db-text3 border border-db-border hover:border-sysu-red/50 hover:text-sysu-red hover:bg-sysu-red/10 rounded-lg cursor-pointer transition-all"
                        >Reject</button>
                        <button
                            data-action="approve-role-request-socket"
                            data-request-id="${escapeHtml(req.id)}"
                            class="px-3.5 py-1.5 text-xs font-bold text-white bg-green-600 hover:bg-green-500 rounded-lg cursor-pointer transition-all shadow-sm"
                        >Approve</button>
                    </div>`
                        : ""
                    }
                </div>
            </div>`;
    };

    let html = '<div class="flex flex-col gap-4">';
    if (pending.length > 0) {
      html += `
                <div>
                    <h3 class="text-xs font-bold uppercase tracking-wider text-sysu-gold mb-3 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-sysu-gold animate-pulse"></span>
                        Pending Role Requests (${pending.length})
                    </h3>
                    <div class="flex flex-col gap-3">${pending.map(renderCard).join("")}</div>
                </div>`;
    }

    if (history.length > 0) {
      html += `
                <div class="${pending.length > 0 ? "mt-4 pt-4 border-t border-db-border" : ""}">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-db-text3 mb-3">
                        Request History (${history.length})
                    </h3>
                    <div class="flex flex-col gap-3">${history.map(renderCard).join("")}</div>
                </div>`;
    }
    html += "</div>";

    container.innerHTML = html;

    //  Wire action listeners

    container
      .querySelectorAll("[data-action='approve-role-request-socket']")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const requestId = btn.dataset.requestId;
          this._approveRoleRequestSocket(requestId);
        });
      });

    container
      .querySelectorAll("[data-action='reject-role-request-socket']")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const requestId = btn.dataset.requestId;
          this._rejectRoleRequestSocket(requestId);
        });
      });
  }

  async _approveRoleRequestSocket(requestId) {
    if (!confirm("Approve this role change request?")) return;

    socket.emit(EVENTS.APPROVE_ROLE_REQUEST, { requestId }, (res) => {
      if (res && res.success) {
        this._showToast("Role change request approved successfully.");
        this._fetchRoleRequestsSocket();
      } else {
        this._showErrorToast(
          "The request could not be approved. Refresh the list and try again.",
        );
      }
    });
  }

  async _rejectRoleRequestSocket(requestId) {
    const reason = prompt("Reason for rejection (optional):");
    if (reason === null) return;

    socket.emit(EVENTS.REJECT_ROLE_REQUEST, { requestId, reason }, (res) => {
      if (res && res.success) {
        this._showToast("Role change request rejected.");
        this._fetchRoleRequestsSocket();
      } else {
        this._showErrorToast(
          "The request could not be rejected. Refresh the list and try again.",
        );
      }
    });
  }

  _handleProfileModalCancel() {
    const requestPanel = document.getElementById(
      "profileModalRoleRequestPanel",
    );
    const requestBtn = document.getElementById("profileModalRequest");
    if (requestPanel && !requestPanel.classList.contains("hidden")) {
      requestPanel.classList.add("hidden");
      requestPanel.classList.remove("flex");
      if (requestBtn) requestBtn.classList.add("hidden");
      return;
    }
    this._closeProfileModal();
  }

  _openRoleRequestPanel() {
    const requestPanel = document.getElementById(
      "profileModalRoleRequestPanel",
    );
    const requestBtn = document.getElementById("profileModalRequest");
    const currentUser = this.state.user;
    const currentRole = currentUser?.role || "viewer";

    const select = document.getElementById("profileModalRequestedRole");
    if (select) {
      const options = Array.from(select.options);
      const firstAvailable = options.find((o) => o.value !== currentRole);
      if (firstAvailable) select.value = firstAvailable.value;
    }

    if (requestPanel) {
      requestPanel.classList.remove("hidden");
      requestPanel.classList.add("flex");
    }
    if (requestBtn) requestBtn.classList.remove("hidden");
  }

  async _submitRoleRequest() {
    const select = document.getElementById("profileModalRequestedRole");
    const requestedRole = select?.value;
    if (!requestedRole) return;

    const saveBtn = document.getElementById("profileModalRequest");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Submitting...";
    saveBtn.disabled = true;

    try {
      socket.emit(EVENTS.CREATE_ROLE_REQUEST, { requestedRole }, (res) => {
        if (res && res.success) {
          this._showToast("Role change request submitted for approval");
          this._closeProfileModal();
        } else {
          this._showErrorToast(
            "Your request could not be submitted. Check your connection and try again.",
          );
        }
      });
    } catch (err) {
      console.error("Submit role request error:", err);
      this._notifyFailure(
        "role-request",
        err,
        "Your request could not be submitted. Check your connection and try again.",
      );
    } finally {
      saveBtn.textContent = originalText;
      saveBtn.disabled = false;
    }
  }

  _setupEventListeners() {
    document
      .getElementById(this.config.logoutBtnId)
      ?.addEventListener("click", this.handleLogout);

    this._initLiveScansPanel();

    //  Profile pill †’ open modal with current user data

    document.getElementById("uPill")?.addEventListener("click", () => {
      const profile = AuthService.getUserProfile();
      this._openProfileModal(profile);
    });

    //  Profile modal event listeners

    document
      .getElementById("profileModalClose")
      ?.addEventListener("click", () => this._closeProfileModal());
    document
      .getElementById("profileModalCancel")
      ?.addEventListener("click", () => this._handleProfileModalCancel());
    document
      .getElementById("profileModalSave")
      ?.addEventListener("click", () => this._saveProfile());
    document
      .getElementById("profileModalBackdrop")
      ?.addEventListener("click", () => this._closeProfileModal());

    //  Non-Super Admin role change trigger

    document
      .getElementById("profileModalRequestRoleBtn")
      ?.addEventListener("click", () => {
        this._openRoleRequestPanel();
      });

    //  Submit role change request

    document
      .getElementById("profileModalRequest")
      ?.addEventListener("click", () => {
        this._submitRoleRequest();
      });

    //  Role request approve/reject via event delegation (handles dynamically rendered HTML)

    document.addEventListener("click", (e) => {
      const approveBtn = e.target.closest(
        "[data-action='approve-role-request']",
      );
      const rejectBtn = e.target.closest("[data-action='reject-role-request']");
      if (approveBtn) {
        const { requestId, requesterId, requestedRole } = approveBtn.dataset;
        this._approveRoleRequest(requestId, requesterId, requestedRole);
      }
      if (rejectBtn) {
        const { requestId, requesterId } = rejectBtn.dataset;
        this._rejectRoleRequest(requestId, requesterId);
      }
    });

    //  Bind assignment methods to window for HTML access

    window.dashboard.openAssignModal = this.openAssignModal.bind(this);
    window.dashboard.closeAssignModal = this.closeAssignModal.bind(this);
    window.dashboard.selectDriver = this.selectDriver.bind(this);
    window.dashboard.confirmAssignment = this.confirmAssignment.bind(this);
    window.dashboard._selectFleetDispatch =
      this._selectFleetDispatch.bind(this);
    window.dashboard._confirmFleetAssignment =
      this._confirmFleetAssignment.bind(this);
    window.dashboard.renderFleet = this.renderFleet.bind(this);
    window.dashboard.renderOrders = this.renderOrders.bind(this);
    window.dashboard.exportOrdersExcel = this.exportOrdersExcel.bind(this);
    window.dashboard._approveRoleRequestSocket =
      this._approveRoleRequestSocket.bind(this);
    window.dashboard._rejectRoleRequestSocket =
      this._rejectRoleRequestSocket.bind(this);
    window.dashboard.fitTrackingBounds = this.fitTrackingBounds.bind(this);
    window.dashboard.clearOfflineMarkers = this.clearOfflineMarkers.bind(this);
    window.dashboard.openObdPodPreview = this.openObdPodPreview.bind(this);
    window.dashboard.openObdPodGroupPreview =
      this.openObdPodGroupPreview.bind(this);
    window.dashboard.closePodPreview = this.closePodPreview.bind(this);
    window.dashboard.openGuardSigPreview = this.openGuardSigPreview.bind(this);
    window.dashboard.closeGuardSigPreview =
      this.closeGuardSigPreview.bind(this);
    window.dashboard.changeUserRole = this.changeUserRole.bind(this);
    window.dashboard.deleteUserRecord = this.deleteUserRecord.bind(this);

    [
      "Overview",
      "Orders",
      "Drivers",
      "Fleet",
      "Docs",
      "Settings",
      "Users",
      "SAP",
      "DriverAction",
    ].forEach((view) => {
      const rBtn = document.getElementById(`r${view}`);
      const lBtn = document.getElementById(`l${view}`);

      const clickHandler = () => this.handleNavClick(view);

      if (rBtn) rBtn.addEventListener("click", clickHandler);
      if (lBtn) lBtn.addEventListener("click", clickHandler);
    });

    document
      .getElementById("underDevReturnBtn")
      ?.addEventListener("click", () => this.handleNavClick("Overview"));

    document
      .getElementById("sapConnHelpButton")
      ?.addEventListener("click", () => this._toggleSapConnectionHelp());

    document.getElementById("tbarExportArea")?.addEventListener("click", () => {
      this._syncSAP().then(() => {
        this._showToast(
          this.state.sapLoadError
            ? "SAP is unavailable. Shipment data was not refreshed."
            : "SAP shipment data synchronized.",
        );
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeSapDispatchModal();
        this.closeAssignModal();
      }
    });

    //  Theme Toggle

    this._setupThemeControls();

    //  Dispatch on btn.dataset.tab. Guards/Truck Companies sub-tabs are admin-only

    //  (RBAC visibility handled in applyRBAC). Other tabs (pending/approved/rejected/

    //  expired/completed) flow into _renderDocsView, which is the foundation owned by

    //  the override_requests spec — when that lands, _renderDocsView will replace this

    //  placeholder. The feature-detect guards against the method being absent.

    document.querySelectorAll(".docs-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        //  Active-tab styling

        document.querySelectorAll(".docs-tab-btn").forEach((b) => {
          b.classList.remove(
            "border-sysu-red",
            "text-sysu-red",
            "bg-sysu-red/5",
          );
          b.classList.add("border-transparent", "text-db-text3");
        });
        btn.classList.add("border-sysu-red", "text-sysu-red", "bg-sysu-red/5");
        btn.classList.remove("border-transparent", "text-db-text3");

        //  Track active tab in state for subscription gating

        this.state._activeDocsTab = btn.dataset.tab || "pending";

        //  Dispatch

        const tab = btn.dataset.tab;
        if (tab === "guards") {
          this._renderGuardsView();
        } else if (tab === "truck-companies") {
          this._renderTruckCompaniesView();
        } else if (tab === "warehouse") {
          //  If we haven't loaded the data yet, fetch it now then render

          if (!this.state._warehouseBase && socket.connected) {
            socket.emit(EVENTS.GET_WAREHOUSE_BASE, (res) => {
              if (res && res.success && res.data) {
                this.state._warehouseBase = res.data;
              }
              this._renderWarehouseBaseView();
            });
          } else {
            this._renderWarehouseBaseView();
          }
        } else if (tab === "role-requests") {
          this._renderRoleRequestsInDocs();
        } else if (tab === "system-errors") {
          this.state.systemErrorFilter = "open";
          this._renderDocsView();
        } else if (typeof this._renderDocsView === "function") {
          this._renderDocsView();
        } else {
          //  Placeholder while override_requests spec foundation is uncommitted.

          const container = document.getElementById("docsListContainer");
          if (container) {
            container.innerHTML = `<div class="flex items-center justify-center min-h-[200px] text-db-text3 italic text-sm">No ${escapeHtml(tab)} items.</div>`;
          }
        }
      });
    });

    //  Default to Pending active

    const pendingTabBtn = document.querySelector(
      ".docs-tab-btn[data-tab='pending']",
    );
    if (pendingTabBtn) {
      pendingTabBtn.classList.add(
        "border-sysu-red",
        "text-sysu-red",
        "bg-sysu-red/5",
      );
      pendingTabBtn.classList.remove("border-transparent", "text-db-text3");
    }
  }

  _applyTrackingUpdate(data, kind = "location", source = "socket") {
    this._closedTrackingTrips ??= new Map();
    const dispatchKey = data?.sapDocId ?? data?.shipmentId;
    const linkedAssignment = dispatchKey
      ? this.state.sapAssignments?.[dispatchKey]
      : null;
    const linkedStatus = String(linkedAssignment?.tripStatus || "")
      .trim()
      .toLowerCase();
    const terminalStatuses = ["completed", "complete", "delivered"];
    const activeStatuses = [
      "assigned",
      "loading",
      "loaded",
      "fully_loaded",
      "in_transit",
      "returning_to_base",
    ];
    const hasActiveAssignment = Object.values(
      this.state.sapAssignments || {},
    ).some(
      (assignment) =>
        assignment?.driverId === data?.driverId &&
        activeStatuses.includes(
          String(assignment.tripStatus || "")
            .trim()
            .toLowerCase(),
        ),
    );
    if (
      linkedAssignment?.driverId === data?.driverId &&
      terminalStatuses.includes(linkedStatus) &&
      kind !== "status"
    )
      return null;
    if (
      kind === "status" &&
      String(data?.status || "")
        .trim()
        .toLowerCase() === "completed" &&
      hasActiveAssignment
    )
      return null;
    const next = acceptLocationUpdate(
      this.state.liveTracking[data?.driverId],
      data,
      {
        kind,
        source,
        closedAt: this._closedTrackingTrips.get(data?.driverId) || 0,
      },
    );
    if (!next) return null;
    if (next.removed) {
      this._closedTrackingTrips.set(next.driverId, next.timestamp);
      if (this._closedTrackingTrips.size > 1000)
        this._closedTrackingTrips.delete(
          this._closedTrackingTrips.keys().next().value,
        );
      removeMarker(next.driverId, "map");
      delete this.state.liveTracking[next.driverId];
      delete this.state.liveScans[next.driverId];
    } else {
      this.state.liveTracking[next.driverId] = next;
      this.state.liveScans[next.driverId] = {
        ...this.state.liveScans[next.driverId],
        ...next,
      };
      updateMarker({ ...next, shipmentId: next.sapDocId }, "map");
    }
    this._scheduleLiveScansRender();
    return next;
  }

  _reconcileLiveScansWithAssignments(assignments) {
    const activeStatuses = new Set([
      "assigned",
      "loading",
      "loaded",
      "fully_loaded",
      "in_transit",
      "returning_to_base",
    ]);
    const terminalStatuses = new Set(["completed", "complete", "delivered"]);
    for (const [driverId, location] of Object.entries(
      this.state.liveTracking || {},
    )) {
      const dispatchKey = location.sapDocId || location.shipmentId;
      const linked = dispatchKey ? assignments?.[dispatchKey] : null;
      const linkedStatus = String(linked?.tripStatus || "")
        .trim()
        .toLowerCase();
      if (
        !linked ||
        linked.driverId !== driverId ||
        !terminalStatuses.has(linkedStatus)
      )
        continue;

      const nextActive = Object.entries(assignments || {})
        .filter(
          ([, assignment]) =>
            assignment?.driverId === driverId &&
            activeStatuses.has(
              String(assignment.tripStatus || "")
                .trim()
                .toLowerCase(),
            ),
        )
        .sort(
          (a, b) =>
            Number(b[1].tripStatus === "in_transit") -
            Number(a[1].tripStatus === "in_transit"),
        )[0];

      if (!nextActive) {
        this._applyTrackingUpdate(
          { driverId, status: "completed", timestamp: Date.now() },
          "status",
        );
        continue;
      }

      const [nextDispatchKey, assignment] = nextActive;
      const updated = {
        ...location,
        sapDocId: nextDispatchKey,
        shipmentId: nextDispatchKey,
        shipmentNumber: nextDispatchKey,
        tripStatus: assignment.tripStatus,
      };
      this.state.liveTracking[driverId] = updated;
      this.state.liveScans[driverId] = {
        ...this.state.liveScans[driverId],
        ...updated,
      };
      updateMarker(updated, "map");
      this._scheduleLiveScansRender();
    }
  }

  _setupSocket() {
    socket.on(EVENTS.DRIVER_MOVING, (data) => this._applyTrackingUpdate(data));
    socket.on(EVENTS.STATUS_UPDATE, (data) =>
      this._applyTrackingUpdate(data, "status"),
    );

    socket.on(EVENTS.WAREHOUSE_BASE_UPDATED, (data) => {
      this.state._warehouseBase = data;
      if (this.state._activeDocsTab === "warehouse") {
        this._renderWarehouseBaseView();
      }
    });

    const _fetchWarehouseBase = () => {
      socket.emit(EVENTS.GET_WAREHOUSE_BASE, (res) => {
        if (res && res.success && res.data) {
          this.state._warehouseBase = res.data;
          if (this.state._activeDocsTab === "warehouse") {
            this._renderWarehouseBaseView();
          }
        }
      });
    };

    socket.on("connect", () => {
      //  Request latest warehouse base config upon connect / reconnect

      _fetchWarehouseBase();

      //  Request latest role requests list upon connect

      this._fetchRoleRequestsSocket();
    });

    //  If socket is already connected (listener registered after connect fired), fetch immediately

    if (socket.connected) {
      _fetchWarehouseBase();
      this._fetchRoleRequestsSocket();
    }

    socket.on("connect_error", () => {});
  }

  //  Live Scans: driver-location socket †’ Overview Live Scans table

  //  Connects to the configured SYSU Go tracking service to receive driver_moving events

  //  and joins them with MySQL-backed assignment records for shipment/plate data.

  async _setupDriverLocationSocket() {
    if (this._driverLocationSocket) return;
    const driverSocket = getDriverSocket();
    if (!driverSocket) return;
    this._driverLocationSocket = driverSocket;
    this._locationFetches = new Map();
    driverSocket.on("connect_error", (error) =>
      SystemErrorService.report("frontend_operation_failure", {
        operation: "realtime-connection",
        errorName: error?.name || "Error",
      }),
    );
    driverSocket.on("connect", () => {
      if (socket.connected) {
        void SystemErrorService.resolveOperation(
          "frontend_operation_failure",
          "realtime-connection",
        ).catch(() => {});
      }
    });
    driverSocket.on("mobile_diagnostic_run_created", (payload) => {
      void this._refreshMobileDiagnosticRun(payload);
    });
    if (import.meta.env.DEV) {
      driverSocket.on("connect_error", (error) =>
        console.warn(
          "[tracking] SYSU Go live-location socket failed:",
          error.message,
        ),
      );
      driverSocket.on("disconnect", (reason) =>
        console.warn(
          "[tracking] SYSU Go live-location socket disconnected:",
          reason,
        ),
      );
    }
    driverSocket.on("update_admin_map", async (data) => {
      const next = this._applyTrackingUpdate(data);
      if (!next || next.removed || !next.sapDocId) return;
      const scan = this.state.liveScans[next.driverId];
      const id = next.sapDocId;
      if (!this.state.sapDocCache[id]) {
        if (!this._locationFetches.has(id)) {
          this._locationFetches.set(
            SAPAssignmentService.getAssignment(id)
              .then((record) => {
                if (!record) return;
                if (Object.keys(this.state.sapDocCache).length >= 100)
                  delete this.state.sapDocCache[
                    Object.keys(this.state.sapDocCache)[0]
                  ];
                this.state.sapDocCache[id] = {
                  shipmentNumber: id,
                  truckPlate: record.truckPlate || "?",
                  tripStatus: record.tripStatus,
                };
              })
              .catch(() => {
                console.warn("Tracking shipment details unavailable");
              })
              .finally(() => this._locationFetches.delete(id)),
          );
        }
        await this._locationFetches.get(id);
      }
      if (
        this.state.liveScans[next.driverId] === scan &&
        this.state.sapDocCache[id]
      ) {
        Object.assign(scan, this.state.sapDocCache[id]);
        this._scheduleLiveScansRender();
      }
    });
    for (const event of [
      "update_status",
      "vendor_status_update",
      "driver_status_change",
    ]) {
      driverSocket.on(event, (data) =>
        this._applyTrackingUpdate(data, "status"),
      );
    }
    this._locationAgeTimer = setInterval(() => {
      let changed = false;
      for (const [id, data] of Object.entries(this.state.liveTracking)) {
        if (
          ["online", "stopped", "returning_to_base"].includes(data.status) &&
          Date.now() - data.lastSeen > GPS_STALE_MS
        ) {
          data.status = "stale";
          if (this.state.liveScans[id])
            this.state.liveScans[id].status = "stale";
          updateMarker(data, "map");
          changed = true;
        }
      }
      if (changed) this._scheduleLiveScansRender();
    }, 5000);
    if (!driverSocket.connected) await connectDriverSocket();
  }

  _liveScansRenderTimer = null;

  _scheduleLiveScansRender() {
    if (this._liveScansRenderTimer) return;
    this._liveScansRenderTimer = setTimeout(() => {
      this._liveScansRenderTimer = null;
      this._renderLiveScansTable();
      this._renderFleetOperations();
      this._renderFleetTree();
    }, 150);
  }

  _initLiveScansPanel() {
    const panel = document.getElementById("resizePanel");
    const handle = document.getElementById("liveScansResizeHandle");
    if (!panel || !handle || this._liveScansPanelInitialized) return;

    this._liveScansPanelInitialized = true;
    this._liveScansExpandedHeight = 240;
    this._setLiveScansPanelHeight(this._liveScansExpandedHeight);

    let dragStart = null;
    let suppressClick = false;
    const stopDragging = (event) => {
      if (!dragStart) return;
      window.removeEventListener("pointermove", moveHandle);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      dragStart = null;
      if (event.type === "pointercancel") {
        suppressClick = false;
      } else if (suppressClick) {
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
    };
    const moveHandle = (event) => {
      if (!dragStart) return;
      const delta = dragStart.y - event.clientY;
      if (Math.abs(delta) > 3) suppressClick = true;
      this._setLiveScansPanelHeight(dragStart.height + delta);
    };

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      dragStart = {
        y: event.clientY,
        height:
          panel.getBoundingClientRect().height ||
          Number.parseFloat(panel.style.height) ||
          240,
      };
      window.addEventListener("pointermove", moveHandle);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
    });
    handle.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const collapsed = panel.dataset.collapsed === "true";
      this._setLiveScansPanelHeight(
        collapsed ? this._liveScansExpandedHeight : 56,
      );
    });
    handle.addEventListener("keydown", (event) => {
      const height =
        panel.getBoundingClientRect().height ||
        Number.parseFloat(panel.style.height) ||
        240;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this._setLiveScansPanelHeight(height + 24);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        this._setLiveScansPanelHeight(height - 24);
      } else if (event.key === "Home") {
        event.preventDefault();
        this._setLiveScansPanelHeight(56);
      } else if (event.key === "End") {
        event.preventDefault();
        this._setLiveScansPanelHeight(this._getLiveScansPanelMaxHeight());
      }
    });
    window.addEventListener("resize", () => {
      if (panel.dataset.collapsed !== "true") {
        this._setLiveScansPanelHeight(
          Number.parseFloat(panel.style.height) || 240,
        );
      }
    });
  }

  _getLiveScansPanelMaxHeight() {
    const panel = document.getElementById("resizePanel");
    const availableHeight = panel?.parentElement?.clientHeight || 680;
    return Math.max(140, availableHeight - 350);
  }

  _setLiveScansPanelHeight(requestedHeight) {
    const panel = document.getElementById("resizePanel");
    const handle = document.getElementById("liveScansResizeHandle");
    if (!panel || !handle) return;

    const collapsed = requestedHeight <= 64;
    const minHeight = collapsed ? 56 : 140;
    const height = collapsed
      ? 56
      : Math.min(
          this._getLiveScansPanelMaxHeight(),
          Math.max(minHeight, requestedHeight),
        );
    if (!collapsed) this._liveScansExpandedHeight = height;

    panel.style.height = `${height}px`;
    panel.dataset.collapsed = String(collapsed);
    handle.setAttribute("aria-expanded", String(!collapsed));
    handle.setAttribute(
      "aria-label",
      `${collapsed ? "Expand" : "Collapse"} Live Scans panel; drag to resize`,
    );
    handle.title = `Drag to resize; click to ${collapsed ? "expand" : "collapse"}`;
    document
      .getElementById("liveScansHeader")
      ?.classList.toggle("py-1", collapsed);
    document
      .getElementById("liveScansHeader")
      ?.classList.toggle("py-3", !collapsed);
    document
      .querySelectorAll("[data-live-scans-detail], #shipmentTabs, #tableWrap")
      .forEach((element) => element.classList.toggle("hidden", collapsed));

    if (!this._liveScansMapResizeFrame) {
      const refreshMapSize = () => {
        this._liveScansMapResizeFrame = null;
        window.map?.invalidateSize({ pan: false });
      };
      this._liveScansMapResizeFrame =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(refreshMapSize)
          : setTimeout(refreshMapSize, 0);
    }
  }

  _formatCoord(val, digits = 5) {
    if (val == null) return "—";
    return Number(val).toFixed(digits);
  }

  //  Renders the Live Scans table into #tableWrap inside #resizePanel (Overview)

  _renderLiveScansTable() {
    const container = document.getElementById("tableWrap");
    if (!container) return;

    const drivers = Object.values(this.state.liveScans);

    if (this.state.liveScansLoading) {
      const skeletonRows = Array.from(
        { length: 3 },
        () => `
                <tr aria-hidden="true" class="border-b border-db-border/50 animate-pulse">
                    ${Array.from({ length: 5 }, () => '<td class="px-4 py-3"><div class="h-3 w-24 rounded bg-db-border/60"></div></td>').join("")}
                </tr>`,
      ).join("");
      container.innerHTML = `
                <div class="overflow-y-auto h-full" role="status" aria-label="Loading live scans">
                    <table class="w-full border-collapse">
                        <thead class="sticky top-0 z-10 bg-db-panel/95 backdrop-blur-sm">
                            <tr class="text-left border-b border-db-border">
                                <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Shipment No.</th>
                                <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Driver Name</th>
                                <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Plate No.</th>
                                <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Current Lat / Lng</th>
                                <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest text-right">Last Update</th>
                            </tr>
                        </thead>
                        <tbody>${skeletonRows}</tbody>
                    </table>
                </div>`;
      return;
    }

    if (drivers.length === 0) {
      container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full gap-2 text-db-text3">
                    <svg class="w-8 h-8 opacity-25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <p class="text-[12px] italic opacity-60">No active drivers in transit.</p>
                </div>`;
      return;
    }

    //  Sort: online drivers first, then by lastSeen descending

    drivers.sort((a, b) => {
      if (a.status !== b.status) return a.status === "online" ? -1 : 1;
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });

    const fmtElapsed = (ts) => {
      const diff = Math.floor((Date.now() - ts) / 1000);
      if (diff < 5) return "just now";
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      return `${Math.floor(diff / 3600)}h ago`;
    };

    const esc = escapeHtml;

    const activeTripStatuses = new Set([
      "assigned",
      "loading",
      "loaded",
      "fully_loaded",
      "in_transit",
      "returning_to_base",
    ]);
    const rows = drivers
      .map((d) => {
        const isOnline = d.status === "online";
        const linkedAssignment = Object.entries(this.state.sapAssignments || {})
          .filter(
            ([, assignment]) =>
              assignment?.driverId === d.driverId &&
              activeTripStatuses.has(assignment.tripStatus),
          )
          .sort(
            (a, b) =>
              Number(b[1].tripStatus === "in_transit") -
              Number(a[1].tripStatus === "in_transit"),
          )[0];
        const queueEntry = this.state.queue.find(
          (entry) => entry.driverId === d.driverId,
        );
        const profile = this.state.drivers.find(
          (entry) => entry.id === d.driverId,
        );
        const usableName =
          d.name &&
          !["driver", "unknown", "unknown driver"].includes(
            d.name.trim().toLowerCase(),
          );
        const driverName = usableName
          ? d.name
          : linkedAssignment?.[1]?.driverName ||
            queueDriverDisplayName(queueEntry, [profile].filter(Boolean));
        const shipmentNumber = d.shipmentNumber || linkedAssignment?.[0];
        const truckPlate =
          d.truckPlate ||
          linkedAssignment?.[1]?.truckPlate ||
          queueEntry?.plateNumber ||
          profile?.truckPlate;
        const shipNo = shipmentNumber
          ? `<span class="font-mono font-bold text-db-text text-[12px]">${esc(shipmentNumber)}</span>`
          : `<span class="text-db-text3 italic text-[11px]">No shipment</span>`;
        const plate = truckPlate
          ? `<span class="font-mono text-[11px] text-db-text2">${esc(truckPlate)}</span>`
          : `<span class="text-db-text3 text-[11px]">—"</span>`;
        const latLng =
          d.lat != null && d.lng != null
            ? `<span class="font-mono text-[10.5px] text-db-text3">${this._formatCoord(d.lat)}</span>
                   <span class="text-db-text3/40 mx-0.5">‚·</span>
                   <span class="font-mono text-[10.5px] text-db-text3">${this._formatCoord(d.lng)}</span>`
            : `<span class="text-db-text3 text-[11px]">—"</span>`;
        const lastSeen = d.lastSeen ? fmtElapsed(d.lastSeen) : "—";

        return `
            <tr class="border-b border-db-border/50 hover:bg-db-item-hover/50 transition-colors">
                <td class="px-4 py-2.5">${shipNo}</td>
                <td class="px-4 py-2.5">
                    <div class="flex items-center gap-1.5">
                        <div class="w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-500 animate-pulse" : "bg-db-text3"}"></div>
                        <span class="text-[12px] font-semibold text-db-text">${esc(driverName)}</span>
                    </div>
                </td>
                <td class="px-4 py-2.5">${plate}</td>
                <td class="px-4 py-2.5">
                    <div class="flex items-center gap-1 flex-wrap">
                        ${latLng}
                    </div>
                </td>
                <td class="px-4 py-2.5 text-right">
                    <span class="text-[10px] text-db-text3">${lastSeen}</span>
                </td>
            </tr>`;
      })
      .join("");

    container.innerHTML = `
            <div class="overflow-y-auto h-full">
                <table class="w-full border-collapse">
                    <thead class="sticky top-0 z-10 bg-db-panel/95 backdrop-blur-sm">
                        <tr class="text-left border-b border-db-border">
                            <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Shipment No.</th>
                            <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Driver Name</th>
                            <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Plate No.</th>
                            <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest">Current Lat / Lng</th>
                            <th class="px-4 py-2 text-[10px] font-black text-db-text3 uppercase tracking-widest text-right">Last Update</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
  }

  //  Converts a string to Title Case: each word starts with uppercase

  _toTitleCase(str) {
    return (str || "").replace(
      /\w\S*/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    );
  }

  _renderGuardsView() {
    const container = document.getElementById("docsListContainer");
    if (!container) return;

 //  Build filtered list first

    const docs = Object.values(this.state._guards || {});
    docs.sort((a, b) => {
      const an = parseInt(String(a.guardId || "").replace(/\D/g, ""), 10) || 0;
      const bn = parseInt(String(b.guardId || "").replace(/\D/g, ""), 10) || 0;
      return an - bn;
    });
    const search = this.state._guardSearch || "";
    const filtered = search.trim()
      ? SecurityGuardService.search(search, docs)
      : docs;

 //  Scaffold once: toolbar + list wrapper

    //  The toolbar (search input + add button) is created only once so

    //  that typing into the search box doesn't destroy its own DOM node

    //  and lose focus (the classic innerHTML-rerender bug).

    if (!document.getElementById("guardSearchInput")) {
      container.innerHTML = `
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="relative flex-1">
                            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-db-text3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input id="guardSearchInput" type="text" placeholder="Search guards by name or ID..." value="" class="w-full h-10 bg-db-bg border border-db-border hover:border-sysu-gold/40 focus:border-sysu-red rounded-xl pl-9 pr-4 text-sm text-db-text outline-none transition-all" />
                        </div>
                        <button id="guardAddBtn" class="px-4 h-10 rounded-xl text-[12px] font-bold uppercase tracking-wider bg-sysu-red hover:bg-sysu-red/80 text-white transition-colors flex items-center gap-1.5 shrink-0">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add Guard
                        </button>
                    </div>
                    <div id="guardListBody" class="flex flex-col gap-2"></div>
                </div>
            `;

      //  Wire search — updates only the list body, NOT the toolbar

      document
        .getElementById("guardSearchInput")
        ?.addEventListener("input", (e) => {
          this.state._guardSearch = e.target.value;
          this._refreshGuardList();
        });
      document.getElementById("guardAddBtn")?.addEventListener("click", () => {
        this._openGuardModal(null);
      });
    } else {
      //  Toolbar already exists: make sure the input value reflects state

      //  without stealing focus from whatever the user is typing.

      const inp = document.getElementById("guardSearchInput");
      if (inp && document.activeElement !== inp) {
        inp.value = this.state._guardSearch || "";
      }
    }

 //  Render / refresh only the list body

    this._refreshGuardList();
  }

  _refreshGuardList() {
    const listBody = document.getElementById("guardListBody");
    if (!listBody) return;
    if (this.state.guardsLoading) {
      listBody.innerHTML = this._loadingCards("Loading security guards");
      return;
    }
    if (this.state.guardsLoadError) {
      listBody.innerHTML =
        '<p class="text-sm text-sysu-red">Security guards unavailable.</p>';
      return;
    }

    const docs = Object.values(this.state._guards || {});
    const canDeleteMasterRecords = ["admin", "super_admin"].includes(
      this.state.user?.role,
    );
    docs.sort((a, b) => {
      const an = parseInt(String(a.guardId || "").replace(/\D/g, ""), 10) || 0;
      const bn = parseInt(String(b.guardId || "").replace(/\D/g, ""), 10) || 0;
      return an - bn;
    });
    const search = this.state._guardSearch || "";
    const filtered = search.trim()
      ? SecurityGuardService.search(search, docs)
      : docs;

    if (filtered.length === 0) {
      listBody.innerHTML = `<div class="flex items-center justify-center min-h-[200px] text-db-text3 italic text-sm">${search ? `No guards matching "${escapeHtml(search)}".` : "No guards yet. Click Add Guard to get started."}</div>`;
      return;
    }

    listBody.innerHTML = filtered
      .map((g) => this._renderGuardCard(g, canDeleteMasterRecords))
      .join("");

    listBody.querySelectorAll("[data-action='guard-edit']").forEach((btn) => {
      btn.addEventListener("click", () => this._openGuardModal(btn.dataset.id));
    });
    listBody.querySelectorAll("[data-action='guard-toggle']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const currentlyActive = btn.dataset.active === "true";
        this._softDeleteGuard(id, currentlyActive);
      });
    });
    listBody.querySelectorAll("[data-action='guard-delete']").forEach((btn) => {
      btn.addEventListener("click", () => this._deleteGuard(btn.dataset.id));
    });
  }

  _renderGuardCard(g, canDelete = false) {
    //  Guard fullName is stored with Title Case from _saveGuard. Display as-is (already sanitized).

    const displayName = this._toTitleCase(g.fullName || "");
    const statusPill = g.active
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-green-500/20 text-green-400 border border-green-500/30">Active</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-db-item-hover text-db-text3 border border-db-border">Inactive</span>`;
    const toggleLabel = g.active ? "Deactivate" : "Reactivate";
    const toggleClass = g.active
      ? "border border-sysu-red/30 text-sysu-red hover:bg-sysu-red/10"
      : "border border-green-500/30 text-green-400 hover:bg-green-500/10";
    return `
            <div class="bg-db-panel border border-db-border rounded-xl p-4 hover:border-sysu-gold/30 transition-all group">
                <div class="flex items-center justify-between gap-4">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        <div class="w-9 h-9 rounded-full bg-sysu-red/10 border border-sysu-red/20 flex items-center justify-center shrink-0">
                            <svg class="w-4 h-4 text-sysu-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-db-text3 font-mono tracking-wider">${escapeHtml(g.guardId || g.id || "")}</span>
                                ${statusPill}
                            </div>
                            <div class="text-sm font-bold text-db-text truncate mt-0.5">${escapeHtml(displayName)}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button data-action="guard-edit" data-id="${escapeHtml(g.id || "")}" class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-db-text2 border border-db-border hover:border-sysu-gold/40 hover:bg-db-item-hover transition-all">Edit</button>
                        <button data-action="guard-toggle" data-id="${escapeHtml(g.id || "")}" data-active="${g.active ? "true" : "false"}" class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${toggleClass} transition-all">${toggleLabel}</button>
                        ${canDelete ? `<button data-action="guard-delete" data-id="${escapeHtml(g.id || "")}" class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-sysu-red/30 text-sysu-red hover:bg-sysu-red/10 transition-all">Delete</button>` : ""}
                    </div>
                </div>
            </div>
        `;
  }

  _renderTruckCompaniesView() {
    const container = document.getElementById("docsListContainer");
    if (!container) return;

 //  Scaffold toolbar once

    if (!document.getElementById("tcSearchInput")) {
      container.innerHTML = `
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="relative flex-1">
                            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-db-text3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input id="tcSearchInput" type="text" placeholder="Search truck companies by name or code..." value="" class="w-full h-10 bg-db-bg border border-db-border hover:border-sysu-gold/40 focus:border-sysu-red rounded-xl pl-9 pr-4 text-sm text-db-text outline-none transition-all" />
                        </div>
                        <button id="tcAddBtn" class="px-4 h-10 rounded-xl text-[12px] font-bold uppercase tracking-wider bg-sysu-red hover:bg-sysu-red/80 text-white transition-colors flex items-center gap-1.5 shrink-0">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add Company
                        </button>
                    </div>
                    <div id="tcListBody" class="flex flex-col gap-2"></div>
                </div>
            `;

      document
        .getElementById("tcSearchInput")
        ?.addEventListener("input", (e) => {
          this.state._tcSearch = e.target.value;
          this._refreshTcList();
        });
      document.getElementById("tcAddBtn")?.addEventListener("click", () => {
        this._openTruckCompanyModal(null);
      });
    } else {
      const inp = document.getElementById("tcSearchInput");
      if (inp && document.activeElement !== inp) {
        inp.value = this.state._tcSearch || "";
      }
    }

    this._refreshTcList();
  }

  _refreshTcList() {
    const listBody = document.getElementById("tcListBody");
    if (!listBody) return;
    const cacheInfo = this.state.truckCompaniesCacheInfo;
    const usingCachedData = cacheInfo?.stale === true;
    const cacheNotice = usingCachedData
      ? `<p class="text-xs text-amber-400" role="status">Saved copy · last updated ${escapeHtml(new Date(cacheInfo.fetchedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }))}. Read-only until the live list returns.</p>`
      : "";
    const addButton = document.getElementById("tcAddBtn");
    if (addButton) addButton.disabled = usingCachedData;
    if (this.state.truckCompaniesLoading) {
      listBody.innerHTML = this._loadingCards("Loading truck companies");
      return;
    }
    if (this.state.truckCompaniesLoadError && !usingCachedData) {
      listBody.innerHTML =
        '<p class="text-sm text-sysu-red">Truck companies unavailable.</p>';
      return;
    }

    const docs = Object.values(this.state._truckCompanies || {});
    const canDeleteMasterRecords = ["admin", "super_admin"].includes(
      this.state.user?.role,
    );
    docs.sort((a, b) => {
      const an = parseInt(a.companyCode || "0", 10) || 0;
      const bn = parseInt(b.companyCode || "0", 10) || 0;
      return an - bn;
    });
    const search = this.state._tcSearch || "";
    const filtered = search.trim()
      ? TruckCompanyService.search(search, docs)
      : docs;

    if (filtered.length === 0) {
      listBody.innerHTML = `${cacheNotice}<div class="flex items-center justify-center min-h-[200px] text-db-text3 italic text-sm">${search ? `No companies matching "${escapeHtml(search)}".` : usingCachedData ? "No saved truck companies." : "No truck companies yet. Click Add Company to get started."}</div>`;
      return;
    }

    listBody.innerHTML = `${cacheNotice}${filtered.map((c) => this._renderTruckCompanyCard(c, canDeleteMasterRecords, usingCachedData)).join("")}`;
    if (usingCachedData)
      listBody.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });

    listBody.querySelectorAll("[data-action='tc-edit']").forEach((btn) => {
      btn.addEventListener("click", () =>
        this._openTruckCompanyModal(btn.dataset.id),
      );
    });
    listBody.querySelectorAll("[data-action='tc-toggle']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const currentlyActive = btn.dataset.active === "true";
        this._softDeleteTruckCompany(id, currentlyActive);
      });
    });
    listBody.querySelectorAll("[data-action='tc-delete']").forEach((btn) => {
      btn.addEventListener("click", () =>
        this._deleteTruckCompany(btn.dataset.id),
      );
    });
  }

  _renderTruckCompanyCard(c, canDelete = false, readOnly = false) {
    //  Truck company name is stored UPPERCASE from _saveTruckCompany

    const displayName = (c.name || "").toUpperCase();
    const statusPill = c.active
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-green-500/20 text-green-400 border border-green-500/30">Active</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-db-item-hover text-db-text3 border border-db-border">Inactive</span>`;
    const toggleLabel = c.active ? "Deactivate" : "Reactivate";
    const toggleClass = c.active
      ? "border border-sysu-red/30 text-sysu-red hover:bg-sysu-red/10"
      : "border border-green-500/30 text-green-400 hover:bg-green-500/10";
    return `
            <div class="bg-db-panel border border-db-border rounded-xl p-4 hover:border-sysu-gold/30 transition-all group">
                <div class="flex items-center justify-between gap-4">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        <div class="w-9 h-9 rounded-full bg-sysu-gold/10 border border-sysu-gold/20 flex items-center justify-center shrink-0">
                            <svg class="w-4 h-4 text-sysu-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-db-text3 font-mono tracking-wider">${escapeHtml(c.companyCode || c.id || "")}</span>
                                <span class="text-[10px] font-mono text-sysu-gold/70">${escapeHtml(c.forwarderCode || "")}</span>
                                ${statusPill}
                            </div>
                            <div class="text-sm font-bold text-db-text truncate mt-0.5 uppercase tracking-wide">${escapeHtml(displayName)}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button data-action="tc-edit" data-id="${escapeHtml(c.id || "")}" ${readOnly ? "disabled" : ""} class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-db-text2 border border-db-border hover:border-sysu-gold/40 hover:bg-db-item-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed">Edit</button>
                        <button data-action="tc-toggle" data-id="${escapeHtml(c.id || "")}" data-active="${c.active ? "true" : "false"}" ${readOnly ? "disabled" : ""} class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${toggleClass} transition-all disabled:opacity-50 disabled:cursor-not-allowed">${toggleLabel}</button>
                        ${canDelete ? `<button data-action="tc-delete" data-id="${escapeHtml(c.id || "")}" ${readOnly ? "disabled" : ""} class="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-sysu-red/30 text-sysu-red hover:bg-sysu-red/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed">Delete</button>` : ""}
                    </div>
                </div>
            </div>
        `;
  }

  _openGuardModal(id) {
    this._editGuardId = id || null;
    const modal = document.getElementById("guardModal");
    const title = document.getElementById("guardModalTitle");
    const idWrap = document.getElementById("guardModalIdWrap");
    const idInput = document.getElementById("guardModalId");
    const fn = document.getElementById("guardFirstName");
    const ln = document.getElementById("guardLastName");
    const mi = document.getElementById("guardMiddleInitial");
    const preview = document.getElementById("guardFullNamePreview");

    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    if (title) title.textContent = id ? "Edit Guard" : "Add Guard";
    if (fn) fn.value = "";
    if (ln) ln.value = "";
    if (mi) mi.value = "";
    if (preview) preview.textContent = "—";

    if (id) {
      const g = this.state._guards?.[id];
      if (g) {
        if (idInput) idInput.value = g.guardId || g.id || "";
        if (idWrap) idWrap.classList.remove("hidden");
        if (fn) fn.value = g.firstName || "";
        if (ln) ln.value = g.lastName || "";
        if (mi) mi.value = g.middleInitial || "";
        this._updateGuardFullNamePreview();
      }
    } else {
      if (idWrap) idWrap.classList.add("hidden");
    }

    const closeModal = () => this._closeGuardModal();
    document
      .getElementById("guardModalCloseBtn")
      ?.addEventListener("click", closeModal, { once: true });
    document
      .getElementById("guardModalCancelBtn")
      ?.addEventListener("click", closeModal, { once: true });
    document
      .getElementById("guardModalSaveBtn")
      ?.addEventListener("click", () => this._saveGuard(), { once: true });
    [fn, ln, mi].forEach((el) => {
      if (!el) return;
      el.removeEventListener("input", this._updateGuardFullNamePreview);
      el.addEventListener("input", () => this._updateGuardFullNamePreview());
    });
  }

  _updateGuardFullNamePreview() {
    const fn = (document.getElementById("guardFirstName")?.value || "").trim();
    const ln = (document.getElementById("guardLastName")?.value || "").trim();
    const mi = (
      document.getElementById("guardMiddleInitial")?.value || ""
    ).trim();
    const preview = document.getElementById("guardFullNamePreview");
    if (!preview) return;
    if (!fn && !ln && !mi) {
      preview.textContent = "—";
      return;
    }
    preview.textContent = `${fn}${mi ? " " + mi : ""} ${ln}`
      .replace(/\s+/g, " ")
      .trim();
  }

  _closeGuardModal() {
    const modal = document.getElementById("guardModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
    this._editGuardId = null;
  }

  async _saveGuard() {
    //  Apply Title Case to names regardless of how user typed them

    const rawFn = (
      document.getElementById("guardFirstName")?.value || ""
    ).trim();
    const rawLn = (
      document.getElementById("guardLastName")?.value || ""
    ).trim();
    const rawMi = (
      document.getElementById("guardMiddleInitial")?.value || ""
    ).trim();
    const fn = this._toTitleCase(rawFn);
    const ln = this._toTitleCase(rawLn);
    const mi = rawMi.toUpperCase(); // Middle initial always uppercase
    const saveBtn = document.getElementById("guardModalSaveBtn");

    if (!fn || !ln) {
      this._showToast("First name and last name are required");
      return;
    }
    if (fn.length > 60 || ln.length > 60 || mi.length > 5) {
      this._showToast("Field length exceeds the limit");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "SAVING...";
    }
    try {
      if (this._editGuardId) {
        await SecurityGuardService.update(this._editGuardId, {
          firstName: fn,
          lastName: ln,
          middleInitial: mi,
        });
        this._showToast("Guard updated");
      } else {
        await SecurityGuardService.create({
          firstName: fn,
          lastName: ln,
          middleInitial: mi,
        });
        this._showToast("Guard added");
      }
      this._closeGuardModal();
    } catch (err) {
      console.error("Save guard error:", err);
      this._notifyFailure(
        "guard-save",
        err,
        "The security guard could not be saved. Check your connection and try again.",
      );
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    }
  }

  async _softDeleteGuard(guardId, currentlyActive) {
    const guard = this.state._guards?.[guardId];
    const label = guard?.fullName || guard?.guardId || guardId;
    const action = currentlyActive ? "Deactivate" : "Reactivate";
    if (!window.confirm(`${action} ${guardId} ${label}?`)) return;
    try {
      await SecurityGuardService.setActive(guardId, !currentlyActive);
      this._showToast(`Guard ${action.toLowerCase()}d`);
    } catch (err) {
      console.error("Toggle guard error:", err);
      this._notifyFailure(
        "guard-status",
        err,
        "The guard status could not be updated. Check your connection and try again.",
      );
    }
  }

  async _deleteGuard(guardId) {
    const guard = this.state._guards?.[guardId];
    const label = guard?.fullName || guard?.guardId || guardId;
    if (
      !window.confirm(
        `Permanently delete guard ${guardId} (${label})? Historical POD/assignment snapshots will be kept.`,
      )
    )
      return;
    try {
      await SecurityGuardService.delete(guardId);
      this._showToast("Guard permanently deleted");
    } catch (err) {
      console.error("Delete guard error:", err);
      this._notifyFailure(
        "guard-delete",
        err,
        "The security guard could not be deleted. Check your permissions or try again.",
      );
    }
  }

  _openTruckCompanyModal(code) {
    this._editTruckCompanyCode = code || null;
    const modal = document.getElementById("truckCompanyModal");
    const title = document.getElementById("truckCompanyModalTitle");
    const codeWrap = document.getElementById("truckCompanyCodeWrap");
    const codeInput = document.getElementById("truckCompanyCodeInput");
    const fc = document.getElementById("truckCompanyForwarderCode");
    const nm = document.getElementById("truckCompanyName");

    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    if (title)
      title.textContent = code ? "Edit Truck Company" : "Add Truck Company";
    if (fc) fc.value = "";
    if (nm) nm.value = "";

    if (code) {
      const c = this.state._truckCompanies?.[code];
      if (c) {
        if (codeInput) codeInput.value = c.companyCode || c.id || "";
        if (codeWrap) codeWrap.classList.remove("hidden");
        if (fc) fc.value = c.forwarderCode || "";
        if (nm) nm.value = c.name || "";
      }
    } else {
      if (codeWrap) codeWrap.classList.add("hidden");
    }

    const closeModal = () => this._closeTruckCompanyModal();
    document
      .getElementById("truckCompanyModalCloseBtn")
      ?.addEventListener("click", closeModal, { once: true });
    document
      .getElementById("truckCompanyModalCancelBtn")
      ?.addEventListener("click", closeModal, { once: true });
    document
      .getElementById("truckCompanyModalSaveBtn")
      ?.addEventListener("click", () => this._saveTruckCompany(), {
        once: true,
      });
  }

  _closeTruckCompanyModal() {
    const modal = document.getElementById("truckCompanyModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
    this._editTruckCompanyCode = null;
  }

  async _saveTruckCompany() {
    const fc = (
      document.getElementById("truckCompanyForwarderCode")?.value || ""
    ).trim();
    const nm = (
      document.getElementById("truckCompanyName")?.value || ""
    ).trim();
    const saveBtn = document.getElementById("truckCompanyModalSaveBtn");

    if (!fc || !nm) {
      this._showToast("Forwarder code and name are required");
      return;
    }
    if (!/^[A-Za-z0-9-]+$/.test(fc)) {
      this._showToast(
        "Forwarder code may only contain letters, digits, and dashes",
      );
      return;
    }
    if (fc.length > 50 || nm.length > 200) {
      this._showToast("Field length exceeds the limit");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "SAVING...";
    }
    try {
      //  Truck company name is always stored UPPERCASE

      const nmUpper = nm.toUpperCase();
      if (this._editTruckCompanyCode) {
        await TruckCompanyService.update(this._editTruckCompanyCode, {
          forwarderCode: fc,
          name: nmUpper,
        });
        this._showToast("Truck company updated");
      } else {
        await TruckCompanyService.create({ forwarderCode: fc, name: nmUpper });
        this._showToast("Truck company added");
      }
      this._closeTruckCompanyModal();
    } catch (err) {
      console.error("Save truck company error:", err);
      this._notifyFailure(
        "truck-company-save",
        err,
        "The truck company could not be saved. Check your connection and try again.",
      );
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    }
  }

  async _softDeleteTruckCompany(code, currentlyActive) {
    const c = this.state._truckCompanies?.[code];
    const label = c?.name || c?.companyCode || code;
    const action = currentlyActive ? "Deactivate" : "Reactivate";
    if (!window.confirm(`${action} ${code} ${label}?`)) return;
    try {
      await TruckCompanyService.setActive(code, !currentlyActive);
      this._showToast(`Truck company ${action.toLowerCase()}d`);
    } catch (err) {
      console.error("Toggle truck company error:", err);
      this._notifyFailure(
        "truck-company-status",
        err,
        "The truck company status could not be updated. Check your connection and try again.",
      );
    }
  }

  async _deleteTruckCompany(code) {
    const company = this.state._truckCompanies?.[code];
    const label = company?.name || company?.companyCode || code;
    if (
      !window.confirm(
        `Permanently delete truck company ${code} (${label})? Historical assignment snapshots will be kept.`,
      )
    )
      return;
    try {
      await TruckCompanyService.delete(code);
      this._showToast("Truck company permanently deleted");
    } catch (err) {
      console.error("Delete truck company error:", err);
      this._notifyFailure(
        "truck-company-delete",
        err,
        "The truck company could not be deleted. Check your permissions or try again.",
      );
    }
  }

  _renderWarehouseBaseView() {
    const container = document.getElementById("docsListContainer");
    if (!container) return;

    //  Base configuration state

    const base = this.state._warehouseBase || {
      name: "SYSU Main Warehouse",
      address: "SYSU International, Quezon City, Metro Manila",
      lat: 14.6349,
      lng: 121.0392,
      radiusMeters: 500,
      updatedAt: null,
      updatedBy: "—",
    };

    const currentLat = typeof base.lat === "number" ? base.lat : 14.6349;
    const currentLng = typeof base.lng === "number" ? base.lng : 121.0392;
    const currentRadius =
      typeof base.radiusMeters === "number" ? base.radiusMeters : 500;

    container.innerHTML = `
            <div class="flex flex-col gap-5 max-w-5xl mx-auto pb-10">
                <!-- Header Banner -->
                <div class="bg-gradient-to-r from-db-panel to-db-bg border border-db-border rounded-2xl p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-sysu-red/15 text-sysu-red">
                                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                            </span>
                            <h2 class="text-base font-bold text-db-text font-display tracking-tight">Warehouse Base & Geofence Radius</h2>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sysu-red/20 text-sysu-red border border-sysu-red/30">Super Admin Only</span>
                        </div>
                        <p class="text-xs text-db-text3">Configure your main warehouse coordinate and geofence boundary. Drivers can only check in and click <strong class="text-db-text2">"Arrived at Warehouse"</strong> when inside this radius.</p>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                        <button id="wbUseCurrentLocBtn" type="button" class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-db-bg hover:bg-db-item-hover text-db-text2 border border-db-border transition-colors flex items-center gap-1.5 shadow-sm">
                            <svg class="w-3.5 h-3.5 text-sysu-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="12 8 8 12 12 16 12 8"></polygon></svg>
                            My Location
                        </button>
                        <button id="wbSaveBtn" type="button" class="px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-sysu-red hover:bg-sysu-red-dark text-white transition-all shadow-lg shadow-sysu-red/25 flex items-center gap-2 active:scale-95">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            Save Base Location
                        </button>
                    </div>
                </div>

                <!-- Main Layout Grid -->
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <!-- Left: Interactive Map Container -->
                    <div class="lg:col-span-8 bg-db-panel p-4 flex flex-col">
                        <div class="flex items-center justify-between mb-3 px-1">
                            <div class="flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span class="text-xs font-bold text-db-text uppercase tracking-wider">Interactive Map Picker</span>
                            </div>
                            <span class="text-[11px] text-db-text3 italic">Click anywhere or drag marker to set warehouse position</span>
                        </div>

                        <!-- Address & Landmark Search Bar -->
                        <div class="relative mb-3.5 z-20">
                            <div class="relative flex items-center">
                                <div class="absolute left-3.5 pointer-events-none text-db-text3">
                                    <svg class="w-4 h-4 text-sysu-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                </div>
                                <input id="wbLocationSearchInput" type="text" placeholder="Search address, landmark, building, street, or city (e.g., SYSU International, Quezon City, SM North, Ortigas)..." class="w-full h-11 bg-db-bg/90 backdrop-blur-md border border-db-border hover:border-sysu-gold/50 focus:border-sysu-red rounded-xl pl-10 pr-24 text-xs text-db-text placeholder:text-db-text3/70 outline-none transition-all shadow-md" />
                                <div class="absolute right-2 flex items-center gap-1">
                                    <span id="wbSearchSpinner" class="hidden text-xs text-sysu-gold animate-spin mr-1">†</span>
                                    <button id="wbSearchClearBtn" type="button" class="hidden px-2 py-1 text-[11px] text-db-text3 hover:text-db-text rounded-md hover:bg-db-item-hover transition-colors">Clear</button>
                                </div>
                            </div>

                            <!-- Search Autocomplete Results Dropdown -->
                            <div id="wbSearchResultsDropdown" class="hidden absolute left-0 right-0 top-12 max-h-60 overflow-y-auto bg-db-panel/95 backdrop-blur-xl border border-db-border rounded-xl shadow-2xl z-50 divide-y divide-db-border/50 text-xs">
                            </div>
                        </div>

                        <div id="warehouseBaseMap" class="w-full h-[460px] overflow-hidden bg-db-bg relative z-0"></div>

                        <div class="mt-3 flex items-center justify-between text-[11px] text-db-text3 px-1">
                            <span id="wbMapCoordsDisplay" class="font-mono text-db-text2 font-semibold">Coordinates: ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}</span>
                            <span id="wbMapRadiusDisplay" class="font-mono text-sysu-gold font-semibold">Active Geofence: ${currentRadius >= 1000 ? (currentRadius / 1000).toFixed(2) + " km" : currentRadius + " m"}</span>
                        </div>
                    </div>

                    <!-- Right: Parameters & Settings Form -->
                    <div class="lg:col-span-4 flex flex-col gap-4">
                        <!-- Geofence Radius Slider Card -->
                        <div class="bg-db-panel border border-db-border rounded-2xl p-5 shadow-xl space-y-4">
                            <div class="flex items-center justify-between">
                                <label class="text-xs font-bold text-db-text uppercase tracking-wider flex items-center gap-1.5">
                                    <svg class="w-4 h-4 text-sysu-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
                                    Geofence Radius
                                </label>
                                <span id="wbRadiusBadge" class="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-sysu-gold/15 text-sysu-gold border border-sysu-gold/30">
                                    ${currentRadius} m
                                </span>
                            </div>

                            <div>
                                <input id="wbRadiusSlider" type="range" min="50" max="5000" step="25" value="${currentRadius}" class="w-full h-2 bg-db-bg rounded-lg appearance-none cursor-pointer accent-sysu-red" />
                                <div class="flex justify-between text-[10px] text-db-text3 mt-1.5 font-mono">
                                    <span>50m</span>
                                    <span>500m</span>
                                    <span>1km</span>
                                    <span>2.5km</span>
                                    <span>5km</span>
                                </div>
                            </div>

                            <!-- Radius Quick Preset Buttons -->
                            <div class="flex flex-wrap gap-1.5 pt-1">
                                <button type="button" class="wb-preset-btn px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-db-bg hover:bg-db-item-hover text-db-text2 border border-db-border transition-colors" data-radius="100">100m</button>
                                <button type="button" class="wb-preset-btn px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-db-bg hover:bg-db-item-hover text-db-text2 border border-db-border transition-colors" data-radius="250">250m</button>
                                <button type="button" class="wb-preset-btn px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-db-bg hover:bg-db-item-hover text-db-text2 border border-db-border transition-colors" data-radius="500">500m</button>
                                <button type="button" class="wb-preset-btn px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-db-bg hover:bg-db-item-hover text-db-text2 border border-db-border transition-colors" data-radius="1000">1 km</button>
                                <button type="button" class="wb-preset-btn px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-db-bg hover:bg-db-item-hover text-db-text2 border border-db-border transition-colors" data-radius="2000">2 km</button>
                            </div>
                        </div>

                        <!-- Location Metadata Card -->
                        <div class="bg-db-panel border border-db-border rounded-2xl p-5 shadow-xl space-y-3.5">
                            <div>
                                <label class="block text-[10px] font-bold uppercase tracking-wider text-db-text3 mb-1.5">Warehouse Name</label>
                                <input id="wbNameInput" type="text" value="${escapeHtml(base.name || "SYSU Main Warehouse")}" placeholder="e.g. SYSU Main Warehouse" class="w-full h-10 bg-db-bg border border-db-border rounded-xl px-3.5 text-sm text-db-text focus:border-sysu-red outline-none" />
                            </div>

                            <div class="relative">
                                <div class="flex items-center justify-between mb-1.5">
                                    <label class="block text-[10px] font-bold uppercase tracking-wider text-db-text3">Address / Landmark (Google Maps-like Search)</label>
                                    <span class="text-[10px] text-sysu-gold font-medium">Type & Press Enter or Search</span>
                                </div>
                                <div class="relative flex items-center">
                                    <input id="wbAddressInput" type="text" value="${escapeHtml(base.address || "")}" placeholder="e.g. Quezon City, SM North EDSA, BGC Taguig, SYSU..." class="w-full h-10 bg-db-bg border border-db-border hover:border-sysu-gold/40 focus:border-sysu-red rounded-xl pl-3.5 pr-20 text-xs text-db-text focus:outline-none transition-all" />
                                    <div class="absolute right-1.5 flex items-center gap-1">
                                        <button id="wbAddressSearchBtn" type="button" class="px-2.5 py-1 bg-sysu-red/15 hover:bg-sysu-red text-sysu-red hover:text-white rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 shadow-sm">
                                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                            Find
                                        </button>
                                    </div>
                                </div>
                                <!-- Address Input Autocomplete Results Dropdown -->
                                <div id="wbAddressResultsDropdown" class="hidden absolute left-0 right-0 top-16 max-h-56 overflow-y-auto bg-db-panel/95 backdrop-blur-xl border border-db-border rounded-xl shadow-2xl z-50 divide-y divide-db-border/50 text-xs">
                                </div>
                            </div>

                            <div class="grid grid-cols-2 gap-2.5 pt-1">
                                <div>
                                    <label class="block text-[10px] font-bold uppercase tracking-wider text-db-text3 mb-1.5">Latitude</label>
                                    <input id="wbLatInput" type="number" step="0.000001" value="${currentLat}" class="w-full h-9 bg-db-bg border border-db-border rounded-xl px-3 text-xs text-db-text font-mono focus:border-sysu-red outline-none" />
                                </div>
                                <div>
                                    <label class="block text-[10px] font-bold uppercase tracking-wider text-db-text3 mb-1.5">Longitude</label>
                                    <input id="wbLngInput" type="number" step="0.000001" value="${currentLng}" class="w-full h-9 bg-db-bg border border-db-border rounded-xl px-3 text-xs text-db-text font-mono focus:border-sysu-red outline-none" />
                                </div>
                            </div>
                        </div>

                        <!-- Current Status & Info Card -->
                        <div class="bg-db-panel/60 border border-db-border rounded-2xl p-4 text-xs space-y-2">
                            <div class="flex items-center justify-between text-db-text3">
                                <span>Last Updated:</span>
                                <span class="font-mono text-db-text2">${base.updatedAt ? new Date(base.updatedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Never"}</span>
                            </div>
                            <div class="flex items-center justify-between text-db-text3">
                                <span>Updated By:</span>
                                <span class="font-mono text-db-text2 truncate max-w-[150px]">${escapeHtml(base.updatedBy || "—")}</span>
                            </div>
                            <div class="flex items-center justify-between text-db-text3">
                                <span>Sync Mode:</span>
                                <span class="font-mono text-emerald-400 font-bold flex items-center gap-1">
                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                    Socket.IO Real-time
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

    //  Initialize Map

    this._initWarehouseBaseMap(currentLat, currentLng, currentRadius);
  }

  _initWarehouseBaseMap(initLat, initLng, initRadius) {
    const mapContainer = document.getElementById("warehouseBaseMap");
    if (!mapContainer) return;

    //  Cleanup existing base map instance if any

    if (this._wbMap) {
      try {
        this._wbMap.remove();
      } catch (e) {
        /* Best-effort cleanup; the view is already dismissed. */
      }
      this._wbMap = null;
    }

    //  Dynamically create leaflet map instance

    const map = L.map("warehouseBaseMap", {
      center: [initLat, initLng],
      zoom: 15,
      zoomSnap: 0,
      minZoom: 5,
      maxBounds: PHILIPPINES_BOUNDS,
      maxBoundsViscosity: 1,
      maxZoom: 19,
      zoomControl: true,
      attributionControl: true,
    });
    this._wbMap = map;
    map.attributionControl?.setPosition("bottomleft");
    map.attributionControl?.setPrefix(false);
    constrainMapToPhilippines(map);

    addMinimalMapTiles(map, "warehouseBaseMap");

    //  Custom Warehouse Icon

    const warehouseIcon = L.divIcon({
      className: "wb-marker-icon",
      html: `
                <div style="position:relative; width:44px; height:44px; display:flex; align-items:center; justify-content:center;">
                    <div style="position:absolute; inset:0; background:rgba(220,38,38,0.25); border-radius:50%; animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
                    <div style="width:36px; height:36px; background:linear-gradient(135deg, #DC2626 0%, #991B1B 100%); border:2px solid #FFFFFF; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.5);">
                        <svg style="width:18px; height:18px; color:#FFFFFF;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                    </div>
                </div>
            `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    //  Add Draggable Marker

    const marker = L.marker([initLat, initLng], {
      draggable: true,
      icon: warehouseIcon,
    }).addTo(map);
    this._wbMarker = marker;

    //  Add Geofence Circle

    const circle = L.circle([initLat, initLng], {
      radius: initRadius,
      color: "#DC2626",
      weight: 2,
      opacity: 0.85,
      fillColor: "#DC2626",
      fillOpacity: 0.15,
      dashArray: "6, 6",
    }).addTo(map);
    this._wbCircle = circle;

    //  Helper to sync UI fields

    const syncCoords = (lat, lng, optAddress) => {
      const latIn = document.getElementById("wbLatInput");
      const lngIn = document.getElementById("wbLngInput");
      const addressIn = document.getElementById("wbAddressInput");
      const coordsDisp = document.getElementById("wbMapCoordsDisplay");
      if (latIn) latIn.value = lat.toFixed(6);
      if (lngIn) lngIn.value = lng.toFixed(6);
      if (coordsDisp)
        coordsDisp.textContent = `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      if (
        optAddress &&
        addressIn &&
        (!addressIn.value || addressIn.value.trim() === "")
      ) {
        addressIn.value = optAddress;
      }
    };

    const syncRadiusDisplay = (rad) => {
      const badge = document.getElementById("wbRadiusBadge");
      const radDisp = document.getElementById("wbMapRadiusDisplay");
      const txt = rad >= 1000 ? `${(rad / 1000).toFixed(2)} km` : `${rad} m`;
      if (badge) badge.textContent = `${rad} m`;
      if (radDisp) radDisp.textContent = `Active Geofence: ${txt}`;
    };

    //  Marker drag handler

    marker.on("drag", (e) => {
      const pos = e.target.getLatLng();
      circle.setLatLng(pos);
      syncCoords(pos.lat, pos.lng);
    });

    //  Map click handler (moves marker and circle to clicked location)

    map.on("click", (e) => {
      const pos = e.latlng;
      marker.setLatLng(pos);
      circle.setLatLng(pos);
      syncCoords(pos.lat, pos.lng);
    });

 //  Address & Landmark Autocomplete Search via OpenStreetMap Nominatim

    const searchInput = document.getElementById("wbLocationSearchInput");
    const resultsDropdown = document.getElementById("wbSearchResultsDropdown");
    const searchSpinner = document.getElementById("wbSearchSpinner");
    const searchClearBtn = document.getElementById("wbSearchClearBtn");
    let searchDebounceTimer = null;

    const performSearch = async (query) => {
      const trimmed = (query || "").trim();
      if (trimmed.length < 2) {
        if (resultsDropdown) resultsDropdown.classList.add("hidden");
        if (searchSpinner) searchSpinner.classList.add("hidden");
        return;
      }

      if (searchSpinner) searchSpinner.classList.remove("hidden");

      try {
        //  Query Nominatim with Philippines bias/priority (countrycodes=ph)

        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&countrycodes=ph&limit=7&addressdetails=1`;
        const response = await fetchWithTimeout(
          url,
          {
            headers: { "Accept-Language": "en" },
          },
          12_000,
        );
        const data = await response.json();

        if (searchSpinner) searchSpinner.classList.add("hidden");

        if (!Array.isArray(data) || data.length === 0) {
          if (resultsDropdown) {
            resultsDropdown.innerHTML = `<div class="p-3.5 text-center text-db-text3 italic">No locations found for "${escapeHtml(trimmed)}". Try a street, city, or landmark name.</div>`;
            resultsDropdown.classList.remove("hidden");
          }
          return;
        }

        if (resultsDropdown) {
          resultsDropdown.innerHTML = data
            .map((item) => {
              const displayName = item.display_name || "Unknown location";
              const lat = parseFloat(item.lat);
              const lon = parseFloat(item.lon);
              const type = item.type || item.class || "Place";
              const shortTitle = displayName.split(",")[0];
              const subtitle = displayName.split(",").slice(1).join(",").trim();

              return `
                            <button type="button" class="wb-search-item w-full p-3 text-left hover:bg-db-item-hover transition-colors flex items-start gap-2.5 cursor-pointer group" data-lat="${lat}" data-lng="${lon}" data-name="${escapeHtml(displayName)}">
                                <div class="w-6 h-6 rounded-lg bg-sysu-gold/15 text-sysu-gold flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-sysu-red group-hover:text-white transition-colors">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                </div>
                                <div class="flex-1 overflow-hidden">
                                    <div class="font-bold text-db-text group-hover:text-sysu-gold truncate transition-colors">${escapeHtml(shortTitle)} <span class="text-[10px] font-normal uppercase text-db-text3 bg-db-bg px-1.5 py-0.5 rounded border border-db-border ml-1">${escapeHtml(type)}</span></div>
                                    <div class="text-[11px] text-db-text3 truncate mt-0.5">${escapeHtml(subtitle || displayName)}</div>
                                </div>
                            </button>
                        `;
            })
            .join("");

          resultsDropdown.classList.remove("hidden");

          //  Wire click on search results

          resultsDropdown.querySelectorAll(".wb-search-item").forEach((btn) => {
            btn.addEventListener("click", () => {
              const lat = parseFloat(btn.dataset.lat);
              const lng = parseFloat(btn.dataset.lng);
              const fullName = btn.dataset.name;

              if (!isNaN(lat) && !isNaN(lng)) {
                const newPos = L.latLng(lat, lng);
                marker.setLatLng(newPos);
                circle.setLatLng(newPos);
                map.setView(newPos, 16);
                syncCoords(lat, lng);

                //  Auto fill address input if empty or updated

                const addressInput = document.getElementById("wbAddressInput");
                if (addressInput) addressInput.value = fullName;

                if (searchInput) searchInput.value = fullName;
                resultsDropdown.classList.add("hidden");
                this._showToast(`Moved base to: ${fullName.split(",")[0]}`);
              }
            });
          });
        }
      } catch (err) {
        console.error("Geocoding search error:", err);
        if (searchSpinner) searchSpinner.classList.add("hidden");
        if (resultsDropdown) {
          resultsDropdown.innerHTML = `<div class="p-3.5 text-center text-sysu-red italic">Search failed. Check your internet connection.</div>`;
          resultsDropdown.classList.remove("hidden");
        }
      }
    };

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const val = e.target.value;
        if (searchClearBtn)
          searchClearBtn.classList.toggle("hidden", val.length === 0);
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => performSearch(val), 400);
      });

      searchInput.addEventListener("focus", () => {
        if (
          searchInput.value.trim().length >= 2 &&
          resultsDropdown &&
          resultsDropdown.children.length > 0
        ) {
          resultsDropdown.classList.remove("hidden");
        }
      });

      //  Enter key triggers search immediately

      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearTimeout(searchDebounceTimer);
          performSearch(searchInput.value);
        }
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        searchClearBtn.classList.add("hidden");
        if (resultsDropdown) resultsDropdown.classList.add("hidden");
      });
    }

 //  Address / Landmark Direct Field Search & Enter Key Action

    const addressInput = document.getElementById("wbAddressInput");
    const addressSearchBtn = document.getElementById("wbAddressSearchBtn");
    const addressDropdown = document.getElementById("wbAddressResultsDropdown");
    let addressDebounceTimer = null;

    const performAddressSearch = async (query) => {
      const trimmed = (query || "").trim();
      if (trimmed.length < 2) {
        if (addressDropdown) addressDropdown.classList.add("hidden");
        return;
      }

      if (addressSearchBtn) {
        addressSearchBtn.innerHTML = `<span class="animate-spin text-[10px]">†</span>`;
      }

      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&countrycodes=ph&limit=6&addressdetails=1`;
        const response = await fetchWithTimeout(
          url,
          {
            headers: { "Accept-Language": "en" },
          },
          12_000,
        );
        const data = await response.json();

        if (addressSearchBtn) {
          addressSearchBtn.innerHTML = `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Find`;
        }

        if (!Array.isArray(data) || data.length === 0) {
          if (addressDropdown) {
            addressDropdown.innerHTML = `<div class="p-3 text-center text-db-text3 italic">No matching locations found for "${escapeHtml(trimmed)}".</div>`;
            addressDropdown.classList.remove("hidden");
          }
          return;
        }

        if (addressDropdown) {
          addressDropdown.innerHTML = data
            .map((item) => {
              const displayName = item.display_name || "Unknown location";
              const lat = parseFloat(item.lat);
              const lon = parseFloat(item.lon);
              const shortTitle = displayName.split(",")[0];
              const subtitle = displayName.split(",").slice(1).join(",").trim();

              return `
                            <button type="button" class="wb-addr-search-item w-full p-2.5 text-left hover:bg-db-item-hover transition-colors flex items-start gap-2 cursor-pointer group" data-lat="${lat}" data-lng="${lon}" data-name="${escapeHtml(displayName)}">
                                <div class="w-5 h-5 rounded bg-sysu-gold/15 text-sysu-gold flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-sysu-red group-hover:text-white transition-colors">
                                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path></svg>
                                </div>
                                <div class="flex-1 overflow-hidden">
                                    <div class="font-bold text-db-text text-[11px] group-hover:text-sysu-gold truncate transition-colors">${escapeHtml(shortTitle)}</div>
                                    <div class="text-[10px] text-db-text3 truncate mt-0.5">${escapeHtml(subtitle || displayName)}</div>
                                </div>
                            </button>
                        `;
            })
            .join("");

          addressDropdown.classList.remove("hidden");

          addressDropdown
            .querySelectorAll(".wb-addr-search-item")
            .forEach((btn) => {
              btn.addEventListener("click", () => {
                const lat = parseFloat(btn.dataset.lat);
                const lng = parseFloat(btn.dataset.lng);
                const fullName = btn.dataset.name;

                if (!isNaN(lat) && !isNaN(lng)) {
                  const newPos = L.latLng(lat, lng);
                  marker.setLatLng(newPos);
                  circle.setLatLng(newPos);
                  map.setView(newPos, 16);
                  syncCoords(lat, lng);

                  if (addressInput) addressInput.value = fullName;
                  if (searchInput) searchInput.value = fullName;
                  addressDropdown.classList.add("hidden");
                  this._showToast(
                    `Pinned location to: ${fullName.split(",")[0]}`,
                  );
                }
              });
            });
        }
      } catch (err) {
        console.error("Address geocoding search error:", err);
        if (addressSearchBtn) {
          addressSearchBtn.innerHTML = `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Find`;
        }
        if (addressDropdown) {
          addressDropdown.innerHTML = `<div class="p-3 text-center text-sysu-red italic">Search failed. Try again.</div>`;
          addressDropdown.classList.remove("hidden");
        }
      }
    };

    if (addressInput) {
      addressInput.addEventListener("input", (e) => {
        const val = e.target.value;
        clearTimeout(addressDebounceTimer);
        addressDebounceTimer = setTimeout(() => performAddressSearch(val), 450);
      });

      //  Enter key directly on Address / Landmark input performs instant search & pins first result

      addressInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearTimeout(addressDebounceTimer);
          const val = (addressInput.value || "").trim();
          if (!val) return;

          this._showToast("Searching location on map...");
          try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=ph&limit=1&addressdetails=1`;
            const res = await fetchWithTimeout(
              url,
              { headers: { "Accept-Language": "en" } },
              12_000,
            );
            const items = await res.json();
            if (Array.isArray(items) && items.length > 0) {
              const first = items[0];
              const lat = parseFloat(first.lat);
              const lon = parseFloat(first.lon);
              const name = first.display_name;

              const newPos = L.latLng(lat, lon);
              marker.setLatLng(newPos);
              circle.setLatLng(newPos);
              map.setView(newPos, 16);
              syncCoords(lat, lon);

              addressInput.value = name;
              if (searchInput) searchInput.value = name;
              if (addressDropdown) addressDropdown.classList.add("hidden");
              this._showToast(`Pinned location to: ${name.split(",")[0]}`);
            } else {
              performAddressSearch(val);
            }
          } catch (err) {
            performAddressSearch(val);
          }
        }
      });
    }

    if (addressSearchBtn) {
      addressSearchBtn.addEventListener("click", () => {
        const val = (addressInput?.value || "").trim();
        if (val) performAddressSearch(val);
      });
    }

    //  Close dropdowns when clicking outside

    document.addEventListener("click", (e) => {
      if (
        !e.target.closest("#wbLocationSearchInput") &&
        !e.target.closest("#wbSearchResultsDropdown")
      ) {
        if (resultsDropdown) resultsDropdown.classList.add("hidden");
      }
      if (
        !e.target.closest("#wbAddressInput") &&
        !e.target.closest("#wbAddressSearchBtn") &&
        !e.target.closest("#wbAddressResultsDropdown")
      ) {
        if (addressDropdown) addressDropdown.classList.add("hidden");
      }
    });

    //  Radius Slider Event

    const slider = document.getElementById("wbRadiusSlider");
    if (slider) {
      slider.addEventListener("input", (e) => {
        const rad = parseInt(e.target.value, 10) || 500;
        circle.setRadius(rad);
        syncRadiusDisplay(rad);
      });
    }

    //  Quick Preset Buttons

    document.querySelectorAll(".wb-preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rad = parseInt(btn.dataset.radius, 10) || 500;
        if (slider) slider.value = rad;
        circle.setRadius(rad);
        syncRadiusDisplay(rad);
      });
    });

    //  Manual Lat/Lng inputs

    const handleManualCoordChange = () => {
      const lat = parseFloat(document.getElementById("wbLatInput")?.value);
      const lng = parseFloat(document.getElementById("wbLngInput")?.value);
      if (
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      ) {
        const pos = L.latLng(lat, lng);
        marker.setLatLng(pos);
        circle.setLatLng(pos);
        map.panTo(pos);
        syncCoords(lat, lng);
      }
    };

    document
      .getElementById("wbLatInput")
      ?.addEventListener("change", handleManualCoordChange);
    document
      .getElementById("wbLngInput")
      ?.addEventListener("change", handleManualCoordChange);

    //  My Location Button

    document
      .getElementById("wbUseCurrentLocBtn")
      ?.addEventListener("click", () => {
        if (!navigator.geolocation) {
          this._showToast("Geolocation is not supported by your browser");
          return;
        }
        this._showToast("Acquiring GPS location...");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const latLng = L.latLng(lat, lng);
            marker.setLatLng(latLng);
            circle.setLatLng(latLng);
            map.setView(latLng, 16);
            syncCoords(lat, lng);
            this._showToast("Location updated from device GPS");
          },
          (err) => {
            console.error("GPS error:", err);
            this._showErrorToast(
              "Could not get your location. Check location permission and GPS, then try again.",
            );
          },
          { enableHighAccuracy: true, timeout: 10000 },
        );
      });

    //  Save Button via Socket.IO

    document.getElementById("wbSaveBtn")?.addEventListener("click", () => {
      this._saveWarehouseBase();
    });

    setTimeout(() => map.invalidateSize(), 300);
  }

  async _saveWarehouseBase() {
    const lat = parseFloat(document.getElementById("wbLatInput")?.value);
    const lng = parseFloat(document.getElementById("wbLngInput")?.value);
    const radiusMeters =
      parseInt(document.getElementById("wbRadiusSlider")?.value, 10) || 500;
    const name =
      (document.getElementById("wbNameInput")?.value || "").trim() ||
      "SYSU Main Warehouse";
    const address = (
      document.getElementById("wbAddressInput")?.value || ""
    ).trim();
    const saveBtn = document.getElementById("wbSaveBtn");

    if (isNaN(lat) || isNaN(lng)) {
      this._showToast("Please enter valid latitude and longitude coordinates");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⏳</span> SAVING...`;
    }

    const restoreSaveButton = () => {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Save Base Location`;
      }
    };

    const payload = {
      name,
      address,
      lat,
      lng,
      radiusMeters,
    };

    try {
      if (!socket?.connected) {
        throw new Error("socket disconnected");
      }
      let acknowledgementExpired = false;
      const acknowledgementTimeout = setTimeout(() => {
        acknowledgementExpired = true;
        restoreSaveButton();
        this._notifyFailure(
          "warehouse-save",
          new Error("acknowledgement timeout"),
          "The warehouse location could not be saved. Check your connection and try again.",
        );
      }, 10000);
      //  Emit via authenticated Socket.IO

      socket.emit(EVENTS.SAVE_WAREHOUSE_BASE, payload, (res) => {
        clearTimeout(acknowledgementTimeout);
        if (acknowledgementExpired) return;
        restoreSaveButton();

        if (res && res.success) {
          this.state._warehouseBase = res.data;
          this._showToast("Warehouse Base & Geofence saved successfully!");
          this._renderWarehouseBaseView();
        } else {
          console.error("Socket save_warehouse_base failed");
          this._showErrorToast(
            "The warehouse location could not be saved. Check your connection and try again.",
          );
        }
      });
    } catch (err) {
      console.error("Save base error:", err);
      this._notifyFailure(
        "warehouse-save",
        err,
        "The warehouse location could not be saved. Check your connection and try again.",
      );
      restoreSaveButton();
    }
  }

  _subscribeGuards() {
    if (this._guardsUnsub) return; // guard against double-subscribe
    SecurityGuardService.subscribe(
      (data) => {
        this.state._guards = data;
        this.state.guardsLoading = false;
        this.state.guardsLoadError = false;
        const currentTab = this.state._activeDocsTab;
        if (currentTab === "guards") {
          //  If the toolbar is already rendered (user is actively on this tab),

          //  only refresh the list body so the search input keeps its focus.

          if (document.getElementById("guardListBody")) {
            this._refreshGuardList();
          } else {
            this._renderGuardsView();
          }
        }
      },
      (err) => {
        console.warn("Security guards unavailable:", err);
        this._notifyFailure(
          "guard-subscription",
          err,
          "Security guard data is temporarily unavailable. Check your connection and retry.",
        );
        this.state.guardsLoading = false;
        this.state.guardsLoadError = true;
        if (this.state._activeDocsTab === "guards") this._refreshGuardList();
      },
    )
      .then((unsub) => {
        this._guardsUnsub = unsub;
      })
      .catch((err) => {
        console.warn("Guards listener failed:", err.message);
        this._notifyFailure(
          "guard-subscription",
          err,
          "Security guard data could not be loaded. Check your connection and retry.",
        );
        this.state.guardsLoading = false;
        this.state.guardsLoadError = true;
        if (this.state._activeDocsTab === "guards") this._refreshGuardList();
      });
  }

  _subscribeTruckCompanies() {
    if (this._truckCompaniesUnsub) return;
    TruckCompanyService.subscribe(
      (data, cacheInfo) => {
        this.state._truckCompanies = data;
        this.state.truckCompaniesLoading = false;
        this.state.truckCompaniesLoadError = false;
        this.state.truckCompaniesCacheInfo = cacheInfo || null;
        const currentTab = this.state._activeDocsTab;
        if (currentTab === "truck-companies") {
          if (document.getElementById("tcListBody")) {
            this._refreshTcList();
          } else {
            this._renderTruckCompaniesView();
          }
        }
      },
      (err, details) => {
        console.warn("Truck companies unavailable:", err);
        this._notifyFailure(
          "truck-company-subscription",
          err,
          "Truck company data is temporarily unavailable. Check your connection and retry.",
        );
        this.state.truckCompaniesLoading = false;
        this.state.truckCompaniesLoadError = !details?.cached;
        if (this.state._activeDocsTab === "truck-companies")
          this._refreshTcList();
      },
    )
      .then((unsub) => {
        this._truckCompaniesUnsub = unsub;
      })
      .catch((err) => {
        console.warn("Truck companies listener failed:", err.message);
        this._notifyFailure(
          "truck-company-subscription",
          err,
          "Truck company data could not be loaded. Check your connection and retry.",
        );
        this.state.truckCompaniesLoading = false;
        this.state.truckCompaniesLoadError = true;
        if (this.state._activeDocsTab === "truck-companies")
          this._refreshTcList();
      });
  }

  _renderAll() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this._renderFleetTree();
      this._renderFleetOperations();
      this._renderSapTable();
      if (this.state.activeView === "driveraction" && this._driverActionView) {
        this._driverActionView.drivers = this.state.drivers;
        this._driverActionView.liveTracking = this.state.liveTracking;
        this._driverActionView._renderDirectory();
      }
      const view = this.state.activeView;
      if (view === "drivers" || view === "fleet" || view === "")
        this.renderFleet();
      if (view === "orders") this.renderOrders();
      this.renderTimer = null;
    }, 150);
  }

  _renderFleetTree() {
    const tree = document.getElementById(this.config.fleetTreeId);
    if (!tree) return;

    if (this.state.driversLoading) {
      const count = document.getElementById("fleetDirectoryCount");
      if (count) count.textContent = "Loading drivers";
      tree.innerHTML = this._loadingCards("Loading driver directory", 4);
      return;
    }
    if (this.state.driversLoadError) {
      const count = document.getElementById("fleetDirectoryCount");
      if (count) count.textContent = "Unavailable";
      tree.innerHTML =
        '<p class="px-2 py-3 text-[11px] text-sysu-red">Driver directory unavailable.</p>';
      return;
    }

    const search = document.getElementById("driverDirectorySearch");
    if (search && !search.dataset.searchWired) {
      search.addEventListener("input", () => this._renderFleetTree());
      search.dataset.searchWired = "true";
    }
    if (!tree.dataset.focusWired) {
      tree.addEventListener("click", (event) => {
        const button = event.target.closest("[data-focus-driver]");
        if (button && !button.disabled)
          this.focusOnTruck(button.dataset.focusDriver);
      });
      tree.dataset.focusWired = "true";
    }

    const term = (search?.value || "").trim().toLowerCase();
    if (tree.querySelector("details") && !this._fleetSearchActive) {
      this._fleetExpandedCompanies = new Set(
        [...tree.querySelectorAll("details[open]")].map(
          (group) => group.dataset.company,
        ),
      );
    }
    const expandedCompanies = this._fleetExpandedCompanies || new Set();
    this._fleetSearchActive = Boolean(term);
    const groups = Object.create(null);
    this.state.drivers.forEach((profile) => {
      const live =
        this.state.liveTracking[profile.id] ||
        this.state.liveTracking[profile.phone];
      const company =
        String(profile.truckingCompany || profile.company || "Other").trim() ||
        "Other";
      const name = String(
        profile.driverName || profile.name || "Unnamed driver",
      );
      if (term && !`${name} ${company}`.toLowerCase().includes(term)) return;
      if (!groups[company]) groups[company] = [];
      groups[company].push({
        ...profile,
        ...(live || {}),
        name,
        company,
        live,
      });
    });

    const companies = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const total = companies.reduce(
      (count, company) => count + groups[company].length,
      0,
    );
    const countLabel = document.getElementById("fleetDirectoryCount");
    if (countLabel)
      countLabel.textContent = `${total} ${total === 1 ? "driver" : "drivers"}`;
    if (!total) {
      tree.innerHTML = `<p class="px-2 py-3 text-center text-[11px] text-db-text3">${term ? "No drivers match your search." : "No drivers registered yet."}</p>`;
      return;
    }

    tree.innerHTML = companies
      .map((company) => {
        const drivers = groups[company].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        const visibleDrivers = drivers.slice(0, 20);
        const hasMore = drivers.length > visibleDrivers.length;
        const rows = visibleDrivers
          .map((driver) => {
            const live = driver.live;
            const id = String(driver.id || driver.driverId || "");
            const hasLocation =
              Number.isFinite(live?.lat) && Number.isFinite(live?.lng);
            return `
                    <button type="button" data-focus-driver="${escapeHtml(id)}" ${hasLocation ? "" : "disabled"}
                            aria-label="${escapeHtml(`Focus map on ${driver.name}`)}${hasLocation ? "" : "; no saved location"}"
                            class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors ${hasLocation ? "cursor-pointer hover:bg-db-item-hover" : "cursor-default opacity-70"}">
                        <span class="min-w-0 truncate text-[11.5px] text-db-text2">${escapeHtml(driver.name)}</span>
                    </button>`;
          })
          .join("");
        return `
                <details class="group rounded-md" data-company="${escapeHtml(company)}" ${term || expandedCompanies.has(company) ? "open" : ""}>
                    <summary class="flex items-center justify-between px-2 py-1.5 hover:bg-db-item-hover rounded-md cursor-pointer transition-colors list-none">
                        <span class="min-w-0 truncate text-[11px] font-medium text-db-text2">${escapeHtml(company)}</span>
                        <span class="ml-2 shrink-0 text-[10px] font-bold text-db-text3 bg-db-item-hover px-1.5 rounded">${drivers.length}</span>
                    </summary>
                    <div class="pl-1 mt-1 space-y-0.5">
                        ${rows}
                        ${hasMore ? `<div class="px-2 py-1 text-[10px] text-db-text3 italic">Showing ${visibleDrivers.length} of ${drivers.length}; refine search to find others.</div>` : ""}
                    </div>
                </details>`;
      })
      .join("");
  }

  _renderFleetOperations() {
    const transitEl = document.getElementById("fleetStatTransit");
    const queueEl = document.getElementById("fleetStatQueue");
    const returningEl = document.getElementById("fleetStatReturning");
    if (!transitEl && !queueEl && !returningEl) return;

    const transit = new Set();
    const returning = new Set();
    for (const assignment of Object.values(this.state.sapAssignments || {})) {
      if (!assignment?.driverId) continue;
      const status = String(assignment.tripStatus || "").toLowerCase();
      if (status === "in_transit") transit.add(assignment.driverId);
      if (status === "returning_to_base") returning.add(assignment.driverId);
    }
    for (const [key, location] of Object.entries(
      this.state.liveTracking || {},
    )) {
      const driverId = location.driverId || key;
      if (location.tripStatus === "in_transit") transit.add(driverId);
      if (
        location.tripStatus === "returning_to_base" ||
        location.status === "returning_to_base"
      )
        returning.add(driverId);
    }
    const queued = new Set(
      (this.state.queue || [])
        .filter(
          (entry) =>
            ["waiting", "available"].includes(
              String(entry.status || "").toLowerCase(),
            ) &&
            entry.isAssigned !== true &&
            entry.registrationComplete !== false,
        )
        .map((entry) => entry.driverId || entry.id)
        .filter(Boolean),
    );

    if (transitEl) transitEl.textContent = String(transit.size);
    if (queueEl) queueEl.textContent = String(queued.size);
    if (returningEl) returningEl.textContent = String(returning.size);
  }

  focusOnTruck(id) {
    const profile = this.state.drivers.find((driver) => driver.id === id);
    const d =
      this.state.liveTracking[id] || this.state.liveTracking[profile?.phone];
    if (Number.isFinite(d?.lat) && Number.isFinite(d?.lng))
      focusOnLocation(d.lat, d.lng);
  }

  _loadingCards(label, count = 3) {
    return `<div role="status" aria-label="${label}" aria-busy="true" class="space-y-3">
            ${Array.from(
              { length: count },
              () => `<div class="p-4 rounded-lg border border-db-border animate-pulse" aria-hidden="true">
                <div class="h-4 w-1/3 rounded bg-db-item-hover mb-3"></div>
                <div class="h-3 w-3/4 rounded bg-db-item-hover mb-2"></div>
                <div class="h-3 w-1/2 rounded bg-db-item-hover"></div>
            </div>`,
            ).join("")}
        </div>`;
  }

  _loadingTableRows(columns, count, label) {
    return `<tr><td colspan="${columns}" class="p-4">
            <div role="status" aria-label="${label}" aria-busy="true" class="space-y-3">
                ${Array.from(
                  { length: count },
                  () => `<div class="flex gap-4 py-3 border-b border-db-border/50 animate-pulse" aria-hidden="true">
                    <div class="h-4 w-1/5 rounded bg-db-item-hover"></div>
                    <div class="h-4 w-2/5 rounded bg-db-item-hover"></div>
                    <div class="h-4 w-1/4 rounded bg-db-item-hover"></div>
                </div>`,
                ).join("")}
            </div>
        </td></tr>`;
  }

  _renderSapTable() {
    const body = document.getElementById("sapBody");
    if (!body) return;

    if (!body.dataset.sapRetryWired) {
      body.dataset.sapRetryWired = "1";
      body.addEventListener("click", (event) => {
        const button = event.target.closest('[data-action="sap-retry"]');
        if (!button) return;
        setButtonBusy(button);
        this._syncSAP();
      });
    }

    if (this.state.sapLoading) {
      body.innerHTML = this._loadingTableRows(9, 4, "Loading shipments");
      return;
    }

    const groups = this.state.sapGroupedByDispatch;
    const allKeys = Object.keys(groups);

    if (allKeys.length === 0) {
      for (const id of ["sapStatAll", "sapStatDel", "sapStatTransit"]) {
        const stat = document.getElementById(id);
        if (stat) stat.textContent = "0";
      }
      const resultCount = document.getElementById("sapResultCount");
      if (resultCount) resultCount.textContent = "0 dispatches";
      body.innerHTML = this.state.sapLoadError
        ? `<tr>
          <td colspan="9" class="px-4 py-0">
            ${this._sapFailureNotice({centered: true})}
        </td>
        </tr>`
        : `<tr>
          <td colspan="9" class="px-4 py-0">
            <div class="flex flex-col items-center justify-center min-h-[240px] text-center w-full">
              <span class="text-db-text3 italic tracking-wide">No shipments available.</span>
            </div>
        </td>
        </tr>`;
      return;
    }

    const q = (document.getElementById("sapSearch") || {}).value || "";

    const stripZeros = (str) => {
      const n = Number(str);
      return !isNaN(n) && n !== 0 ? String(n) : str || "";
    };

    //  Build grouped list with helper fields

    const groupedList = allKeys
      .map((key) => {
        const records = groups[key];
        const rec =
          records.find(
            (row) =>
              row.Route ||
              row.PlanningDate ||
              row.Planning_Date ||
              row.ActualDelDate,
          ) || records[0]; // prefer a row with dispatch-level date and route fields

        //  Skip records that are still in planning stage

        //  No SAPDispatchNumber †’ still planning, don't show

        if (!rec.SAPDispatchNumber || rec.SAPDispatchNumber.trim() === "")
          return null;
        //  No OBDNumber †’ still planning, don't show

        if (!rec.OBDNumber || rec.OBDNumber.trim() === "") return null;
        //  LCL truck type †’ filtered out

        if ((rec.TruckType || "").toUpperCase().trim() === "LCL") return null;

        const noDriver =
          !rec.Driver ||
          rec.Driver.trim() === "" ||
          [
            "DRIVER",
            "*",
            "*-*",
            "-",
            "FOR PICK-U",
            "FOR CANCEL",
            "driver",
          ].includes(rec.Driver.trim().toUpperCase());
        const noPlate = !rec.PlateNumber || rec.PlateNumber.trim() === "";
        const noStart =
          !rec.ShipmentStart ||
          rec.ShipmentStart.trim() === "" ||
          rec.ShipmentStart === "PT00H00M00S";

        //  ForwardingAgent: SYSU's own vendor code is "0000001102". Anything else

        //  (including "0000000000") means the shipment was not dispatched by us yet.

        //  Only treat as "for assignment" when ForwardingAgent matches our company.

        const fwdAgent = (rec.ForwardingAgent || "").trim();
        //  const isOurs = fwdAgent === "0000001102"; // COMMENTED OUT PER REQUEST

        const isOurs = true; // TEMPORARILY SET TO TRUE TO BYPASS FORWARDINGAGENT CHECK
        const noForwardingAgent = !isOurs;

        return {
          key,
          records,
          count: records.length,
          rec,
          routeDisplay: (rec.Route || "").split("-->").pop()?.trim() || "—",
          isUnassignable: noDriver && noPlate && noStart,
          isOurs,
          noForwardingAgent,
        };
      })
      .filter((g) => g); // remove nulls (still-planning / LCL entries)

    //  Stats from flat list —" only from valid, non-planning entries

    const validKeys = groupedList.filter((g) => g).map((g) => g.key);
    const total = validKeys.length;

    //  Filter

    const filtered = groupedList.filter((g) => {
      const isTemporaryReviewDispatch = g.key === "0010139586";
      if (q) {
        const hay =
          `${g.key} ${g.records.map((rec) => `${rec.OBDNumber || ""} ${rec.SoldToParty || rec.ShipToPartyName || ""} ${rec.Route || ""}`).join(" ")}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }

      const asgn = this.state.sapAssignments[g.key];
      const tripStatus = asgn?.tripStatus;
      const tripStatusLower = (tripStatus || "").toLowerCase();

      if (this.state.sapFilter === "delivered") {
        if (!isDeliveredAssignment(asgn)) return false;
      } else if (this.state.sapFilter === "in_transit") {
        if (tripStatusLower !== "in_transit") return false;
      } else if (this.state.sapFilter === "fully_loaded") {
        //  Matches either "loaded" or "fully_loaded" (case-insensitive)

        if (tripStatusLower !== "loaded" && tripStatusLower !== "fully_loaded")
          return false;
      } else if (this.state.sapFilter === "loading") {
        if (tripStatusLower !== "loading") return false;
      } else if (this.state.sapFilter === "assigned") {
        //  A fresh assignment has tripStatus === "assigned" until the

        //  driver transitions to "loading" / "loaded" / "in_transit".

        if (tripStatusLower !== "assigned") return false;
      } else if (this.state.sapFilter === "forAssignment") {
        //  Exclude already DELIVERED — no point assigning something already delivered

        if (
          !isTemporaryReviewDispatch &&
          (g.rec.Delivery || "").toUpperCase() === "DELIVERED"
        )
          return false;
        //  Only show SYSU-owned shipments (ForwardingAgent == "0000001102")

        if (!isTemporaryReviewDispatch && !g.isOurs) return false;
        if (!isTemporaryReviewDispatch && !g.isUnassignable) return false;
        if (!isTemporaryReviewDispatch && this.state.sapAssignments[g.key])
          return false;
      }
      //  For any other filter (including undefined or 'all'), show all

      return true;
    });

    const filterEmptyMessages = {
      delivered: "No completed shipments yet.",
      in_transit: "No shipments are currently in transit.",
      fully_loaded: "No fully loaded shipments yet.",
      loading: "No shipments are currently loading.",
      assigned: "No assigned shipments yet.",
      forAssignment: "No shipments are ready for assignment right now.",
    };
    if (filtered.length === 0) {
      const message = q.trim()
        ? "No shipments match your search."
        : filterEmptyMessages[this.state.sapFilter] ||
          "No shipments available.";
      const e = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      };
      e("sapStatAll", String(total));
      e(
        "sapStatDel",
        String(
          validKeys.filter((key) =>
            isDeliveredAssignment(this.state.sapAssignments[key]),
          ).length,
        ),
      );
      e(
        "sapStatTransit",
        String(
          validKeys.filter(
            (key) =>
              this.state.sapAssignments[key]?.tripStatus?.toLowerCase() ===
              "in_transit",
          ).length,
        ),
      );
      e("sapResultCount", "0 dispatches");
      const errorNotice = this.state.sapLoadError
        ? this._sapFailureNotice({stale: true})
        : "";
      body.innerHTML = `<tr><td colspan="9" class="px-4 py-0"><div class="py-3">${errorNotice}<div role="status" class="flex items-center justify-center min-h-[200px] text-center text-db-text3">${message}</div></div></td></tr>`;
      return;
    }

    //  Sort —" "planned" filter overrides to sort by PlanningDate ascending

    let key = this.state.sapSortKey;
    let dir = this.state.sapSortDir;
    if (this.state.sapFilter === "planned") {
      key = "PlanningDate";
      dir = 1; // oldest planning date = highest priority = top
    }

    filtered.sort((a, b) => {
      let valA = a.rec[key] || "";
      let valB = b.rec[key] || "";

      if (key === "PlanningDate" || key === "Planning_Date") {
        valA =
          parseInt((valA + "").replace("/Date(", "").replace(")/", "")) || 0;
        valB =
          parseInt((valB + "").replace("/Date(", "").replace(")/", "")) || 0;
      } else if (key === "SAPDispatchNumber") {
        valA = parseInt(valA) || 0;
        valB = parseInt(valB) || 0;
      }

      if (valA < valB) return -1 * dir;
      if (valA > valB) return 1 * dir;
      return 0;
    });

    //  Stats from valid (non-planning) entries only

    const del = validKeys.filter((k) =>
      isDeliveredAssignment(this.state.sapAssignments[k]),
    ).length;
    const tra = validKeys.filter(
      (k) =>
        this.state.sapAssignments[k]?.tripStatus?.toLowerCase() ===
        "in_transit",
    ).length;

    const e = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    e("sapStatAll", total);
    e("sapStatDel", del);
    e("sapStatTransit", tra);

    const timeEl = document.getElementById("sapLastUpdate");
    if (timeEl)
      timeEl.textContent = new Date().toLocaleString("en-US", {
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: true,
        month: "short",
        day: "numeric",
        year: "numeric",
      });

    const sapLimit = 500;
    const finalRenderList = filtered.slice(0, sapLimit);
    if (filtered.length > sapLimit) {
      e(
        "sapResultCount",
        `Showing ${sapLimit} of ${filtered.length} dispatches`,
      );
    } else {
      e(
        "sapResultCount",
        `${filtered.length} dispatch${filtered.length !== 1 ? "es" : ""}`,
      );
    }

    body.innerHTML =
      (this.state.sapLoadError
        ? `<tr><td colspan="9" class="px-4 py-3">${this._sapFailureNotice({stale: true})}</td></tr>`
        : "") +
      finalRenderList
        .map((g, index) => {
          const { key, rec, count } = g;
          const shipmentDisplay = stripZeros(key);
          const asgn = this.state.sapAssignments[key];
          const status = assignmentDisplayStatus(asgn, rec);
          const isDelivered = isDeliveredAssignment(asgn);
          const isTemporaryReviewDispatch = key === "0010139586";

          return `
        <tr class="hover:bg-db-item-hover transition-colors border-b border-db-border">
          <td class="px-6 py-4 text-center font-mono text-[10px] text-db-text3 font-bold">${index + 1}</td>
          <td class="px-6 py-4 font-mono font-bold text-db-text cursor-pointer hover:text-sysu-red transition-colors"
              onclick="window.dashboard.openSapDispatchDetail('${encodeURIComponent(key).replaceAll("'", "%27")}')">
              #${escapeHtml(shipmentDisplay)}
              ${count > 1 ? `<span class="ml-1 text-[12px] bg-db-item-hover px-1.5 py-0.5 rounded font-bold">${count}</span>` : ""}
          </td>
          <td class="px-6 py-4 text-db-text2 font-semibold uppercase">${escapeHtml(rec.TruckType || "—")}</td>
          <td class="px-6 py-4 text-db-text2">${escapeHtml(g.routeDisplay)}</td>
          <td class="px-6 py-4 text-db-text2 font-mono text-[11px]">${SAPService.parseDate(rec.PlanningDate || rec.Planning_Date)}</td>
          <td class="px-6 py-4 text-db-text2 font-mono text-[11px] font-bold text-sysu-red">${SAPService.parseDate(rec.ActualDelDate)}</td>
          <td class="px-6 py-4">
             <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isDelivered ? "bg-green-500/10 text-green-400" : "bg-sysu-gold/10 text-sysu-gold"}">
               ${escapeHtml(status)}
             </span>
          </td>
          <td class="px-6 py-4">
             ${asgn?.driverName || rec.Driver || asgn?.truckPlate || rec.PlateNumber ? `<div class="font-bold text-db-text">${escapeHtml(asgn?.driverName || rec.Driver || "")}</div><div class="text-[10px] text-db-text3">${escapeHtml(asgn?.truckPlate || rec.PlateNumber || "")}</div>` : '<span class="text-db-text3">Unassigned</span>'}
          </td>
          <td class="px-6 py-4 text-right">
             ${
               isTemporaryReviewDispatch
                 ? '<span class="text-db-text3 text-[10px] font-bold uppercase tracking-wider">Review only — not assignable</span>'
                 : isDelivered
                   ? `<span class="text-green-500 font-bold text-xs">${asgn?.tripStatus?.toLowerCase() === "returning_to_base" ? "RETURNING TO BASE" : "COMPLETE"}</span>`
                   : asgn
                     ? // Hide the cancel/change dropdown once the driver
                       //  has actually started loading. Cancellations and

                       //  driver changes are no longer useful (or even

                       //  allowed server-side) once the trip is in

                       //  loading / loaded / in_transit. Only the

                       //  freshly-assigned state keeps the action menu.

                       (asgn.tripStatus || "").toLowerCase() === "assigned"
                       ? `<select data-action="row-action" data-dispatch="${escapeHtml(key)}" data-truck-type="${escapeHtml(rec.TruckType || "")}" class="bg-db-bg border border-db-border text-db-text2 px-2.5 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider cursor-pointer hover:border-sysu-red/50 focus:outline-none focus:border-sysu-red/50">
                                     <option value="" disabled selected>Action &mdash; choose</option>
                                     <option value="cancel-assignment">Cancel assignment</option>
                                     <option value="change-assignment">Change assignment</option>
                                   </select>`
                       : '<span class="text-db-text3 text-[10px] font-bold uppercase tracking-wider opacity-60">In progress</span>'
                     : `<button
                             onclick="window.dashboard.openAssignModal('${encodeURIComponent(key)}', '${escapeHtml(rec.TruckType || "")}')"
                             class="bg-sysu-red/10 hover:bg-sysu-red/20 text-sysu-red px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer">
                             ASSIGN
                           </button>`
             }
          </td>
        </tr>
      `;
        })
        .join("");

    this._loadSapDispatchDetails(finalRenderList.map((group) => group.key));

    //  Wire the per-row action dropdown (Cancel / Change). One delegated

    //  listener, attached once, so re-renders don't lose it.

    if (!body.dataset.rowActionWired) {
      body.dataset.rowActionWired = "1";
      body.addEventListener("change", (evt) => {
        const sel = evt.target.closest('[data-action="row-action"]');
        if (!sel) return;
        const action = sel.value;
        const dispatchKey = sel.dataset.dispatch;
        const truckType = sel.dataset.truckType || "";
        if (!action || !dispatchKey) return;

        if (action === "change-assignment") {
          //  Reset the dropdown so re-opening the modal doesn't

          //  double-fire on re-render.

          sel.value = "";
          this.openAssignModal(encodeURIComponent(dispatchKey), truckType);
          return;
        }

        if (action === "cancel-assignment") {
          //  Reset immediately so the confirm dialog isn't blocking

          //  a stale value if the user cancels.

          sel.value = "";
          //  Inline reason prompt — keeping parity with the

          //  Confirmed Assignments card view's reason dropdown,

          //  but condensed to a single prompt since the SAP table

          //  doesn't have room for a long dropdown.

          const reason = window.prompt(
            `Cancel assignment for dispatch ${dispatchKey}?\n\nReason (will be sent for admin approval):`,
            "Wrong driver assigned",
          );
          if (!reason || !reason.trim()) return;
          this._cancelAssignment(dispatchKey, reason.trim(), sel, body);
          return;
        }
      });
    }
  }

  _renderDrivers() {
    const grid = document.getElementById("drvGrid");
    if (!grid) return;

    const q = (document.getElementById("drvSearch") || {}).value || "";
    const filtered = this.state.drivers.filter((d) => {
      const nm = d.name || "";
      return (
        !q ||
        nm.toLowerCase().includes(q.toLowerCase()) ||
        (d.phone || "").includes(q)
      );
    });

    const total = this.state.drivers.length;
    const onlineCount = Object.values(this.state.liveTracking).filter(
      (d) => d.status === "online",
    ).length;

    const e = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    e("pDrvAll", total);
    e("pDrvActive", onlineCount);

    if (filtered.length === 0) {
      grid.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "col-span-full py-20 text-center text-db-text3 italic";
      empty.textContent = "No drivers found matching your search.";
      grid.appendChild(empty);
      return;
    }

    grid.innerHTML = "";
    filtered.forEach((d) => {
      const nm = d.name || "Unknown";
      const initial = nm.charAt(0).toUpperCase();
      const live =
        this.state.liveTracking[d.id] || this.state.liveTracking[d.phone];
      const isOnline = live?.status === "online";
      const card = document.createElement("div");
      card.className = "drv-card-premium group relative overflow-hidden";

      const topSection = document.createElement("div");
      topSection.className = "flex items-center gap-4 mb-6";

      const avatar = document.createElement("div");
      avatar.className =
        "w-12 h-12 rounded-xl bg-sysu-red/10 flex items-center justify-center text-sysu-red font-bold text-xl border border-sysu-red/20";
      avatar.textContent = initial;

      const info = document.createElement("div");
      info.className = "flex-1 min-width-0";

      const title = document.createElement("h3");
      title.className = "text-db-text font-bold truncate";
      title.textContent = nm;

      const statusWrap = document.createElement("div");
      statusWrap.className = "flex items-center gap-2 mt-1";

      const dot = document.createElement("div");
      dot.className = `w-2 h-2 rounded-full ${isOnline ? "bg-green-500 animate-pulse" : "bg-db-text3"}`;

      const statusText = document.createElement("span");
      statusText.className = `text-[10px] font-bold uppercase tracking-wider ${isOnline ? "text-green-400" : "text-db-text3"}`;
      statusText.textContent = isOnline ? "Online" : "Offline";

      statusWrap.appendChild(dot);
      statusWrap.appendChild(statusText);
      info.appendChild(title);
      info.appendChild(statusWrap);
      topSection.appendChild(avatar);
      topSection.appendChild(info);

      const gridSection = document.createElement("div");
      gridSection.className = "grid grid-cols-2 gap-y-4 gap-x-2";

      const createField = (label, value) => {
        const div = document.createElement("div");
        const labelEl = document.createElement("div");
        labelEl.className =
          "text-[10px] font-bold text-db-text3 uppercase mb-0.5";
        labelEl.textContent = label;
        const valueEl = document.createElement("div");
        valueEl.className = "text-sm text-db-text2 truncate";
        valueEl.textContent = value;
        div.appendChild(labelEl);
        div.appendChild(valueEl);
        return div;
      };

      gridSection.appendChild(createField("Phone", d.phone || "—"));
      gridSection.appendChild(createField("Plate", d.plateNumber || "—"));
      gridSection.appendChild(
        createField("Company", d.truckingCompany || d.company || "—"),
      );
      gridSection.appendChild(createField("Truck Type", d.truckType || "—"));

      const footer = document.createElement("div");
      footer.className = "mt-6 pt-6 border-t border-db-border flex gap-3";

      const editBtn = document.createElement("button");
      editBtn.className =
        "flex-1 h-9 bg-db-item-hover hover:bg-db-border text-db-text text-[11px] font-bold rounded-lg transition-colors uppercase tracking-wider";
      editBtn.textContent = "Edit Profile";
      editBtn.onclick = () => this.openDrvModal(d.id);

      const delBtn = document.createElement("button");
      delBtn.className =
        "w-9 h-9 flex items-center justify-center bg-db-item-hover hover:bg-sysu-red/10 hover:text-sysu-red text-db-text3 rounded-lg transition-all";
      delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;
      delBtn.onclick = () => this.deleteDriver(d.id);

      footer.appendChild(editBtn);
      footer.appendChild(delBtn);

      card.appendChild(topSection);
      card.appendChild(gridSection);
      card.appendChild(footer);
      grid.appendChild(card);
    });
  }

  //  DRIVER FLEET QUEUE VIEW

  renderFleet() {
    const body = document.getElementById("fleetBody");
    const container = document.getElementById("fleetContent");
    if (!body || !container || container.classList.contains("hidden")) return;
    if (this.state.queueLoading) {
      body.innerHTML = this._loadingCards("Loading fleet queue");
      return;
    }
    if (this.state.queueLoadError) {
      body.innerHTML =
        '<p class="text-sm text-sysu-red">Fleet queue unavailable.</p>';
      return;
    }

    const queue = this.state.queue;
    const drivers = this.state.drivers;
    const q = (
      document.getElementById("fleetSearch")?.value || ""
    ).toLowerCase();

    //  Fleet Manager visibility gate: new queue entries are marked registrationComplete: false

    //  by the mobile app scan. They become visible after Edit Driver is saved (sets to true).

    //  Old entries with undefined (before this field existed) are also shown for backwards compat.

    const regReady = queue.filter((d) => d.registrationComplete !== false);

    //  Filter by search

    let filtered = q
      ? regReady.filter(
          (d) =>
            (d.driverName || "").toLowerCase().includes(q) ||
            (d.plateNumber || "").toLowerCase().includes(q) ||
            (d.phone || d.driverPhone || "").toLowerCase().includes(q) ||
            (d.truckType || "").toLowerCase().includes(q),
        )
      : regReady;

    //  Update stat chips

    const totalEl = document.getElementById("fleetStatTotal");
    const typesEl = document.getElementById("fleetStatTypes");
    if (totalEl) totalEl.textContent = filtered.length;
    if (typesEl) {
      const types = [
        ...new Set(filtered.map((d) => d.truckType).filter(Boolean)),
      ];
      typesEl.textContent = types.length;
    }

    if (filtered.length === 0) {
      body.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center gap-3 pb-20">
                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" class="text-db-text3 opacity-30">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                    <div class="text-center">
                        <p class="text-db-text3 font-semibold text-sm">No drivers in queue</p>
                        <p class="text-db-text3/60 text-xs mt-1">Drivers appear here once they check in and are awaiting assignment.</p>
                    </div>
                </div>`;
      return;
    }

    //  Group by truck type

    const groups = {};
    filtered.forEach((d) => {
      const t = d.truckType || "Unknown";
      if (!groups[t]) groups[t] = [];
      groups[t].push(d);
    });

    //  Canonical truck types —" always render all columns (empty if no drivers)

    const FLEET_TYPES = [
      { key: "AUV", label: "AUV" },
      { key: "4W", label: "4W" },
      { key: "6W", label: "6W" },
      { key: "10W", label: "10W" },
      { key: "20F", label: "20F" },
      { key: "40F", label: "40F" },
      { key: "Reefer", label: "Reefer" },
      { key: "Unknown", label: "Others" },
    ];

    //  Sort each type's drivers by entryTime (FIFO)

    const sortAsc = true;
    FLEET_TYPES.forEach(({ key }) => {
      if (groups[key]) {
        groups[key].sort((a, b) => {
          const ta = a.entryTime?.toDate?.()?.getTime() || 0;
          const tb = b.entryTime?.toDate?.()?.getTime() || 0;
          return sortAsc ? ta - tb : tb - ta;
        });
      }
    });

    const TRUCK_ICONS = {
      AUV: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/></svg>`,
      "4W": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="12" height="9"/><circle cx="6.5" cy="17.5" r="1.5"/><circle cx="13.5" cy="17.5" r="1.5"/></svg>`,
      "6W": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
      "10W": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
      "20F": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>`,
      "40F": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>`,
      Reefer: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M2 10h20M12 4v6M12 10v6"/></svg>`,
      Unknown: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
    };
    const DEF_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;

    const fmtTime = (d) =>
      d?.toDate
        ? d.toDate().toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : d?.seconds
          ? new Date(d.seconds * 1000).toLocaleTimeString("en-PH", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
          : "—";

    const fmtElapsed = (d) => {
      const ms = d?.toDate
        ? d.toDate()
        : d?.seconds
          ? new Date(d.seconds * 1000)
          : new Date(0);
      const mins = Math.floor((Date.now() - ms) / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
    };

    const norm = (s) =>
      (s || "")
        .replace(/\./g, "")
        .replace(/\b[A-Z]\b ?/g, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();

    const cc = (t) => {
      const u = (t || "").toUpperCase();
      if (u === "AUV")
        return {
          bg: "bg-amber-400",
          text: "text-amber-400",
          border: "border-amber-500/30",
        };
      if (u.includes("4W") || u === "4-WHEELER")
        return {
          bg: "bg-sky-400",
          text: "text-sky-400",
          border: "border-sky-500/30",
        };
      if (u.includes("6W") || u === "6-WHEELER")
        return {
          bg: "bg-blue-400",
          text: "text-blue-400",
          border: "border-blue-500/30",
        };
      if (u.includes("10W") || u === "10-WHEELER")
        return {
          bg: "bg-indigo-400",
          text: "text-indigo-400",
          border: "border-indigo-500/30",
        };
      if (u === "20F")
        return {
          bg: "bg-purple-400",
          text: "text-purple-400",
          border: "border-purple-500/30",
        };
      if (u === "40F")
        return {
          bg: "bg-pink-400",
          text: "text-pink-400",
          border: "border-pink-500/30",
        };
      if (u.includes("REEFER"))
        return {
          bg: "bg-cyan-400",
          text: "text-cyan-400",
          border: "border-cyan-500/30",
        };
      return {
        bg: "bg-db-text3",
        text: "text-db-text3",
        border: "border-db-text3/20",
      };
    };

    const columns = FLEET_TYPES.map(({ key, label }) => {
      const queueDrivers = groups[key] || [];
      const icon = TRUCK_ICONS[key] || DEF_ICON;

      const cards = queueDrivers
        .map((d, i) => {
          const rank = i + 1;
          const phone =
            d.phone ||
            d.driverPhone ||
            drivers.find((x) => x.name && norm(x.name) === norm(d.driverName))
              ?.phone ||
            "";
          const viberHref = phone
            ? `viber://contact?number=${phone.replace(/^0/, "63")}`
            : "#";
          const hasPhone = !!phone;
          const assignedLabel = d.entryTime?.toDate
            ? d.entryTime.toDate().toLocaleString("en-PH", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              })
            : "—";
          const elapsedLabel = d.entryTime ? fmtElapsed(d.entryTime) : "—";
          const statusDisplay = (() => {
            if (d.status === "loading" || d.status === "called")
              return { badge: "Loading—¦", dot: "text-sysu-red" };
            if (d.status === "complete")
              return { badge: "Tapos na", dot: "text-green-400" };
            return { badge: "Naghihintay", dot: "text-db-text3" };
          })();
          return `
                        <div class="order-card rounded-xl border border-db-border bg-db-panel cursor-pointer overflow-hidden transition-all hover:border-blue-500/50 hover:shadow-lg" onclick="window.dashboard.openDrvModal('${d.id}')">
                            <div class="flex items-start gap-4 px-5 pt-4 pb-3">
                                <div class="flex flex-col gap-1 min-w-0">
                                    <span class="text-[9px] font-mono uppercase tracking-widest text-db-text3 opacity-50">Queue</span>
                                    <span class="text-[17px] font-bold font-mono text-db-text leading-none ${rank === 1 ? "text-sysu-red" : rank === 2 ? "text-yellow-400" : ""}">#${rank}</span>
                                </div>
                                <div class="flex-1 min-w-0 pt-0.5">
                                    <div class="text-[11px] font-semibold text-db-text2 mb-1 truncate leading-tight">${escapeHtml(d.driverName || "—")}</div>
                                    <span class="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${statusDisplay.dot === "text-sysu-red" ? "bg-sysu-red/10 text-sysu-red border-sysu-red/30" : statusDisplay.dot === "text-green-400" ? "bg-green-500/10 text-green-400 border-green-500/30" : "text-db-text3 bg-db-text3/10 border-db-text3/20"}">${statusDisplay.badge}</span>
                                </div>
                                <div class="flex flex-col items-end gap-0.5 shrink-0">
                                    <span class="text-[8px] font-bold uppercase tracking-widest text-db-text3 opacity-40">${statusDisplay.dot === "text-sysu-red" ? "Assigned" : "Queued"}</span>
                                    <span class="text-[10px] font-mono font-semibold text-blue-400">${assignedLabel}</span>
                                    <span class="text-[9px] text-db-text3 opacity-50">${elapsedLabel}</span>
                                </div>
                            </div>
                            <div class="flex items-center gap-3 px-5 pb-4 border-t border-db-border pt-2.5 mt-0.5">
                                <div class="flex items-center gap-2.5 rounded-lg px-3 py-2 flex-1 min-w-0 bg-db-bg border border-db-border">
                                    <div class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 bg-sysu-red/10 text-sysu-red">${escapeHtml((d.driverName || "?").charAt(0).toUpperCase())}</div>
                                    <div class="min-w-0">
                                        <div class="text-[12px] font-bold text-db-text truncate">${escapeHtml(d.driverName || "—")}</div>
                                        <div class="text-[9px] font-mono text-db-text3 opacity-60">${escapeHtml(d.plateNumber || "—")}</div>
                                        ${d.truckCompany ? `<div class="text-[9px] font-medium mt-0.5 truncate text-sysu-gold">${escapeHtml(d.truckCompany)}</div>` : ""}
                                    </div>
                                </div>
                                <div class="flex items-center gap-1.5 text-[9px] text-db-text3 shrink-0 opacity-50">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                                    ${escapeHtml(d.truckType || "—")}
                                </div>
                                <a
                                        href="${viberHref}"
                                        target="_blank"
                                        class="flex items-center justify-center gap-1.5 ${hasPhone ? "bg-green-600 hover:bg-green-700" : "bg-db-item-hover opacity-50 cursor-not-allowed"} text-white rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all shrink-0"
                                        ${hasPhone ? "" : `onclick="event.preventDefault(); window.dashboard._showToast('No phone number is on file for this driver.');"`}
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                    ${hasPhone ? "Viber" : "No Phone"}
                                </a>
                            </div>
                        </div>`;
        })
        .join("");

      if (queueDrivers.length === 0) {
        return `
                    <div class="flex flex-col gap-3" style="flex:1 0 320px;min-width:320px;">
                        <div class="flex items-center gap-2 mb-1 px-1">
                            <div class="w-2.5 h-2.5 rounded-full ${cc(label).bg} shrink-0"></div>
                            <div class="w-7 h-7 rounded-lg bg-db-bg border border-db-border flex items-center justify-center shrink-0 text-db-text3">
                                ${icon}
                            </div>
                            <span class="text-[13px] font-bold uppercase tracking-widest ${cc(label).text}">${escapeHtml(label)}</span>
                            <div class="flex-1 h-px ${cc(label).border.replace("border-", "bg-")} opacity-30"></div>
                            <span class="font-mono text-[11px] font-semibold text-db-text3 opacity-40">0 queued</span>
                        </div>
                        <div class="flex flex-col items-center justify-center py-12 rounded-xl border border-db-border bg-db-panel">
                            <div class="text-db-text3 opacity-30 mb-2"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></div>
                            <span class="text-[11px] text-db-text3 opacity-40">No orders</span>
                        </div>
                    </div>`;
      }

      return `
                    <div class="flex flex-col gap-3" style="flex:1 0 320px;min-width:320px;">
                        <div class="flex items-center gap-2 mb-1 px-1">
                            <div class="w-2.5 h-2.5 rounded-full ${cc(label).bg} shrink-0"></div>
                            <div class="w-7 h-7 rounded-lg bg-db-bg border border-db-border flex items-center justify-center shrink-0 text-db-text3">
                                ${icon}
                            </div>
                            <span class="text-[13px] font-bold uppercase tracking-widest ${cc(label).text}">${escapeHtml(label)}</span>
                            <div class="flex-1 h-px ${cc(label).border.replace("border-", "bg-")} opacity-30"></div>
                            <span class="font-mono text-[11px] font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-full px-2 py-0.5">${queueDrivers.length} queued</span>
                            <div class="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-db-text3">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                                FIFO
                            </div>
                        </div>
                        <div class="flex flex-col gap-3">${cards}</div>
                    </div>`;
    });
    body.innerHTML = `<div class="flex flex-wrap gap-5 w-full" style="padding:4px 2px 12px;">${columns.join("")}</div>`;
  }

  openAssignModalForDriver(driverId, truckType) {
    //  Decode truckType from URL encoding

    truckType = decodeURIComponent(truckType || "");

    //  Store which driver we're assigning

    this.state.assignFromFleetDriverId = driverId;
    this.state.assignFromFleetTruckType = truckType;

    //  Find driver from queue by id

    const driver = this.state.queue.find((q) => q.id === driverId);
    if (!driver) {
      this._showToast(
        "This driver is no longer in the queue. Refresh the fleet list and try again.",
      );
      return;
    }

    const driverName = driver.driverName || "Unknown Driver";
    const plateNum = driver.plateNumber || "—";

    //  Build list of unassigned SAP dispatches matching this truck type

    const unassignedKeys = Object.entries(
      this.state.sapGroupedByDispatch,
    ).filter(([key, records]) => {
      const rec = records[0];

      //  Skip if already assigned in our local state

      if (this.state.sapAssignments[key]) return false;

      //  Skip if already DELIVERED —" nothing to assign

      if ((records[0].Delivery || "").toUpperCase() === "DELIVERED")
        return false;

      //  Skip if already has a driver assigned (based on SAP data)

      const noDriver =
        !rec.Driver ||
        rec.Driver.trim() === "" ||
        ["DRIVER", "*", "*-*", "FOR PICK-U", "FOR CANCEL", "driver"].includes(
          rec.Driver.trim().toUpperCase(),
        );
      if (!noDriver) return false;

      //  Filter by truck type if a truck type was identified for this driver

      if (truckType) {
        const match =
          (rec.TruckType || "").toUpperCase().trim() ===
          truckType.toUpperCase().trim();
        if (!match) return false;
      }
      return true;
    });

    if (unassignedKeys.length === 0) {
      const listEl = document.getElementById("assignModalDriverList");
      if (!listEl) return;
      const modal = document.getElementById("assignDriverModal");
      const dispatchNum = document.getElementById("assignModalDispatchNum");
      const truckTypeEl = document.getElementById("assignModalTruckType");
      const confirmBtn = document.getElementById("assignConfirmBtn");
      if (dispatchNum)
        dispatchNum.textContent = `${driverName} — Select Dispatch`;
      if (truckTypeEl) truckTypeEl.textContent = truckType || "ANY";
      listEl.innerHTML = this.state.sapLoadError
        ? `<div role="alert" class="p-8 text-center"><p class="text-sm font-semibold text-db-text2">SAP shipment data is temporarily unavailable.</p><p class="mt-2 text-xs text-db-text3">Assignment availability could not be confirmed. Please retry after SAP reconnects.</p></div>`
        : `<div role="status" class="p-8 text-center"><p class="text-sm font-semibold text-db-text2">No unassigned shipments available.</p><p class="mt-2 text-xs text-db-text3">No unassigned SAP shipments match ${escapeHtml(truckType || "this driver's")} truck type. Check SAP Shipments or try again later.</p></div>`;
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "No shipment available";
      }
      modal?.classList.remove("hidden");
      modal?.classList.add("flex");
      return;
    }

    //  Sort by planning date (oldest first = FIFO-ish)

    const parseSAPDate = (rec) => {
      const raw = rec.PlanningDate || rec.Planning_Date || "";
      return parseInt(
        (raw + "").replace("/Date(", "").replace(")/", "") || "0",
      );
    };
    unassignedKeys.sort(
      (a, b) => parseSAPDate(a[1][0]) - parseSAPDate(b[1][0]),
    );

    //  Build dispatch rows HTML

    const dispatchRows = unassignedKeys
      .slice(0, 25)
      .map(([key, records]) => {
        const rec = records[0];
        const routeDisplay =
          (rec.Route || "").split("-->").pop()?.trim() || "—";
        const plannedDate = SAPService.parseDate(
          rec.PlanningDate || rec.Planning_Date,
        );
        const dispatchNum = key.replace(/^0+/, "") || key;
        const truckTypeDisplay = rec.TruckType || "—";

        return `<div
            class="driver-row flex items-center justify-between px-4 py-3 border-b border-db-border cursor-pointer hover:bg-db-item-hover transition-colors"
            data-dispatch-key="${key}"
            data-truck-type="${truckTypeDisplay}"
            onclick="window.dashboard._selectFleetDispatch('${key}', '${driverId}')"
        >
            <div class="flex flex-col gap-0.5">
                <span class="text-sm font-bold font-mono text-db-text">#${dispatchNum}</span>
                <span class="text-[10px] text-db-text3">${routeDisplay}</span>
            </div>
            <div class="flex flex-col items-end gap-0.5">
                <span class="text-[10px] font-bold uppercase text-db-text2 bg-db-item-hover px-2 py-0.5 rounded">${truckTypeDisplay}</span>
                <span class="text-[10px] text-db-text3 font-mono">${plannedDate}</span>
            </div>
        </div>`;
      })
      .join("");

    //  Update modal header

    document.getElementById("assignModalDispatchNum").textContent =
      `${driverName} — Select Dispatch`;
    document.getElementById("assignModalTruckType").textContent =
      truckType || "ANY";

    //  Show dispatch list in the modal's driver list area

    const listEl = document.getElementById("assignModalDriverList");
    if (!listEl) return;
    listEl.innerHTML = dispatchRows
      ? dispatchRows
      : `<div class="p-10 text-center text-db-text3 italic text-sm">No unassigned dispatches found.</div>`;

    //  Footer prompt

    const footerHint = document.createElement("div");
    footerHint.className =
      "px-4 py-3 border-t border-db-border text-[11px] text-db-text3 bg-db-bg/50 text-center";
    footerHint.dataset.assignmentInstructions = "true";
    const dispatchCount = Math.min(unassignedKeys.length, 25);
    footerHint.textContent = dispatchCount === 1
      ? `1 dispatch available. Select it to assign it to ${driverName}.`
      : `${dispatchCount} dispatches available. Select one to assign one to ${driverName}.`;
    listEl.appendChild(footerHint);

    //  Disable Confirm button until a dispatch is selected

    const confirmBtn = document.getElementById("assignConfirmBtn");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Select a dispatch above";
      confirmBtn.onclick = () => window.dashboard._confirmFleetAssignment();
    }

    //  Show the modal

    const modal = document.getElementById("assignDriverModal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  _selectFleetDispatch(dispatchKey, driverId) {
    this.state.assignTarget = dispatchKey;
    this.state.selectedQueueDriverId = driverId;

    const listEl = document.getElementById("assignModalDriverList");
    if (listEl) {
      listEl.querySelectorAll(".driver-row").forEach((row) => {
        if (row.dataset.dispatchKey === dispatchKey) {
          row.classList.add(
            "bg-sysu-red/10",
            "border-l-4",
            "border-l-sysu-red",
          );
        } else {
          row.classList.remove(
            "bg-sysu-red/10",
            "border-l-4",
            "border-l-sysu-red",
          );
        }
      });
    }

    const confirmBtn = document.getElementById("assignConfirmBtn");
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirm Assignment";
      confirmBtn.onclick = () => window.dashboard._confirmFleetAssignment();
    }
  }

  _confirmFleetAssignment() {
    const dispatchKey = this.state.assignTarget;
    const driverId = this.state.selectedQueueDriverId;

    if (!dispatchKey || !driverId) {
      this._showErrorToast("Select a shipment and a driver before assigning.");
      return;
    }

    const confirmBtn = document.getElementById("assignConfirmBtn");
    const originalText = confirmBtn?.textContent || "Confirm Assignment";
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Assigning...";
    }

    const driver = this.state.queue.find((q) => q.id === driverId);
    if (!driver) {
      this._showErrorToast(
        "This driver is no longer available in the queue. Refresh and try again.",
      );
      this.closeAssignModal();
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
      }
      return;
    }

    const driverName = driver.driverName || "Unknown Driver";
    const truckPlate = driver.plateNumber || "—";

    //  Read the Auth UID from the queue entry (unifies with sysu-go mobile app's driverId assumption)

    const driverUid = driver.driverId;
    if (!driverUid) {
      this._showErrorToast(
        "This queue entry is incomplete. Contact an administrator before assigning.",
      );
      this.closeAssignModal();
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
      }
      return;
    }

    //  Derive OBD line items from the receiving records grouped by dispatch

    const receivingRecords = this.state.sapGroupedByDispatch[dispatchKey] || [];
    const lineItems = receivingRecords
      .filter((r) => r.OBDNumber && r.OBDNumber.trim() !== "")
      .map((r) => {
        //  Preserve exact SAP precision: store as string so "20.000" never becomes 20.

        //  If Quantity arrives as a number (e.g. 20.0), pad to 3 decimal places.

        //  If it arrives as a string "20.000", store as-is.

        const rawQty = r.Quantity;
        const qtyStr =
          typeof rawQty === "string"
            ? rawQty
            : typeof rawQty === "number"
              ? rawQty.toFixed(3)
              : "0.000";
        return {
          obdNumber: r.OBDNumber,
          quantity: qtyStr,
          quantityNumeric: parseFloat(qtyStr) || 0,
          customerName: r.ShipToPartyName || r.ShipToParty || "",
          ...driverAssignmentFields(r),
          actualDelDate: this._normalizeDelDate(r.ActualDelDate),
        };
      });

    //  Server-authoritative assignment write. Same path as the SAP modal.

    SAPAssignmentService.assignDriver({
      dispatchKey,
      requestedDriverId: driverUid,
      truckType: this.state.requiredTruckType || driver.truckType || "",
      lineItems,
      driverSnapshot: {
        driverName,
        truckPlate,
        truckCompany: driver.truckCompany || driver.company || "—",
      },
      overrideTokenId: this.state.overrideTokenId || null,
    })
      .then(() => {
        this._showToast(
          `Successfully assigned ${driverName} to dispatch #${dispatchKey}`,
        );
        this.state.overrideTokenId = null;
        this.closeAssignModal();
        this._renderAll();
      })
      .catch((err) => {
        console.error("Fleet assign error:", err.code, err.message);
        this._showErrorToast(
          "The driver could not be assigned. Check your connection and try again.",
        );
      })
      .finally(() => {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = originalText;
        }
        this.state.assignTarget = null;
        this.state.selectedQueueDriverId = null;
      });
  }

  sortSap(key) {
    if (this.state.sapSortKey === key) {
      this.state.sapSortDir *= -1;
    } else {
      this.state.sapSortKey = key;
      this.state.sapSortDir = 1;
    }
    this._renderSapTable();
  }

  filterSap(type) {
    this._setSapFilterTab(type);

    //  Show loading spinner and refresh data

    const spinner = document.getElementById("sapFilterSpinner");
    if (spinner) {
      spinner.classList.remove("hidden");
    }

    //  Refresh data and render

    this._renderSapTable();
    return this._syncSAP().finally(() => {
      //  Hide spinner when data is loaded

      if (spinner) {
        spinner.classList.add("hidden");
      }
      this._renderSapTable();
    });
  }

  async handleNavClick(viewName) {
    const sidePanel = document.getElementById("sidePanel");
    const viewId = viewName.toLowerCase();

    if (
      this.state.activeView === viewId &&
      viewId !== "users" &&
      viewId !== "driveraction" &&
      viewId !== "sap"
    ) {
      if (sidePanel) {
        sidePanel.classList.toggle("open");
        setTimeout(() => {
          if (window.map) window.map.invalidateSize();
        }, 300);
      }
      return;
    }

    this.state.activeView = viewId;

    const mainContent = document.getElementById("mainContent");
    const usersContent = document.getElementById("usersContent");
    const sapContent = document.getElementById("sapContent");
    const fleetContent = document.getElementById("fleetContent");
    const ordersContent = document.getElementById("ordersContent");
    const trackingContent = document.getElementById("trackingContent");
    const docsContent = document.getElementById("docsContent");
    const settingsContent = document.getElementById("settingsContent");
    const driverActionContent = document.getElementById("driverActionContent");
    if (viewId !== "driveraction" && this._driverActionView) {
      this._driverActionView.destroy();
      this._driverActionView = null;
    }

    const views = [
      mainContent,
      usersContent,
      sapContent,
      fleetContent,
      ordersContent,
      trackingContent,
      docsContent,
      settingsContent,
      driverActionContent,
    ];
    views.forEach((v) => {
      if (v) v.style.setProperty("display", "none", "important");
    });

    const showView = (el) => {
      if (!el) return;
      el.style.setProperty("display", "", "important");
      el.classList.remove("hidden");
      el.style.setProperty("display", "flex", "important");
      el.style.setProperty("flex", "1 1 0%", "important");
      el.style.setProperty("width", "100%", "important");
      el.style.setProperty("height", "100%", "important");
      el.style.setProperty("flex-direction", "column", "important");
      el.classList.add("w-full", "flex-1");
    };

    //  Hide ALL content views first —" then caller shows what it needs

    document
      .querySelectorAll(
        "#mainContent, #fleetContent, #ordersContent, #usersContent, #sapContent, #trackingContent, #docsContent, #settingsContent, #driverActionContent",
      )
      .forEach((el) => el?.classList.add("hidden"));

    if (viewId === "users") {
      showView(usersContent);
      if (sidePanel) sidePanel.classList.remove("open");
      this.loadAdminPortal();
    } else if (viewId === "sap") {
      showView(sapContent);
      if (sidePanel) sidePanel.classList.remove("open");
      //  Open SAP on the next actionable workflow state, not historical deliveries.

      this._setSapFilterTab("forAssignment");
      //  Show loading spinner while fetching fresh SAP data

      const spinner = document.getElementById("sapFilterSpinner");
      if (spinner) spinner.classList.remove("hidden");
      try {
        await this._syncSAP();
      } catch (e) {
        console.error("Error syncing SAP data on navigation:", e);
      }
      if (spinner) spinner.classList.add("hidden");
      this._renderSapTable();
    } else if (viewId === "drivers") {
      showView(fleetContent);
      if (sidePanel) sidePanel.classList.remove("open");
      this.renderFleet();
    } else if (viewId === "orders") {
      if (sidePanel) sidePanel.classList.remove("open");
    } else if (viewId === "tracking") {
      showView(trackingContent);
      if (sidePanel) sidePanel.classList.remove("open");
      this._initTrackingView();
    } else if (viewId === "driveraction") {
      showView(driverActionContent);
      if (sidePanel) sidePanel.classList.remove("open");
      const canView = ["fleet_manager", "admin", "super_admin"].includes(
        this.state.user?.role,
      );
      if (canView && driverActionContent) {
        this._driverActionView?.destroy();
        this._driverActionView = new DriverActionView({
          container: driverActionContent,
          drivers: this.state.drivers,
          liveTracking: this.state.liveTracking,
          canView,
          isAdmin: ["admin", "super_admin"].includes(this.state.user?.role),
          onViewPod: (shipmentId, obdNumber) =>
            this.openObdPodPreview(obdNumber, shipmentId),
        });
        this._driverActionView.mount();
      }
    } else if (viewId === "docs") {
      showView(docsContent);
      if (sidePanel) sidePanel.classList.remove("open");

      //  Render documents UI into docsContent (with internal tabs: guards, truck companies, etc.)

      const activeTab = this.state._activeDocsTab || "pending";
      if (
        activeTab === "guards" &&
        typeof this._renderGuardsView === "function"
      ) {
        this._renderGuardsView();
      } else if (
        activeTab === "truck-companies" &&
        typeof this._renderTruckCompaniesView === "function"
      ) {
        this._renderTruckCompaniesView();
      } else if (typeof this._renderDocsView === "function") {
        this._renderDocsView();
      } else {
        //  Placeholder for pending/approved/rejected/expired/completed until the

        //  override_requests spec's _renderDocsView lands.

        const container = document.getElementById("docsListContainer");
        if (container) {
          container.innerHTML = `<div class="flex items-center justify-center min-h-[200px] text-db-text3 italic text-sm">No ${escapeHtml(activeTab)} items.</div>`;
        }
      }

      //  Reset any side-by-side layout styling that might have been applied

      if (docsContent) {
        docsContent.style.flex = "";
        docsContent.style.maxWidth = "";
      }
      if (usersContent) {
        usersContent.style.flex = "";
        usersContent.style.maxWidth = "";
      }
    } else if (viewId === "settings") {
      showView(settingsContent);
      if (sidePanel) sidePanel.classList.remove("open");
      this._applyTheme(this.state.theme || this._getSavedTheme());
    } else {
      showView(mainContent);
      if (sidePanel && !sidePanel.classList.contains("open")) {
        sidePanel.classList.add("open");
      }
      if (this.map) {
        setTimeout(() => this.map.invalidateSize(), 300);
      }
    }

    //  Keep unfinished workspaces unavailable until they are ready in every build.

    const underDevOverlay = document.getElementById("underDevOverlay");
    if (underDevOverlay) {
      const driversUnderDevelopment = viewId === "drivers";
      const showUnderDevelopment =
        driversUnderDevelopment || viewId === "orders";
      if (showUnderDevelopment) {
        const title = document.getElementById("underDevTitle");
        const description = document.getElementById("underDevDescription");
        if (title)
          title.textContent = driversUnderDevelopment
            ? "Fleet Manager is under development"
            : "Orders is under development";
        if (description)
          description.textContent = driversUnderDevelopment
            ? "We are refining the Fleet Manager workspace before it becomes available."
            : "We are refining the Orders workspace before it becomes available.";
        underDevOverlay.style.opacity = "1";
        underDevOverlay.style.pointerEvents = "auto";
        underDevOverlay.setAttribute("aria-hidden", "false");
      } else {
        //  Hide overlay for all other views

        underDevOverlay.style.opacity = "0";
        underDevOverlay.style.pointerEvents = "none";
        underDevOverlay.setAttribute("aria-hidden", "true");
      }
    }

    document
      .querySelectorAll("nav button")
      .forEach((btn) => btn.classList.remove("on", "text-sysu-red"));

    document.querySelectorAll("#sidePanel button").forEach((btn) => {
      btn.classList.remove("active", "bg-db-item-active", "text-db-text");
      btn.classList.add("text-db-text2");
    });

    const rBtn = document.getElementById(`r${viewName}`);
    if (rBtn) {
      rBtn.classList.add("on");
    }

    const lBtn = document.getElementById(`l${viewName}`);
    if (lBtn) {
      lBtn.classList.remove("text-db-text2");
      lBtn.classList.add("active", "bg-db-item-active", "text-db-text");
    }

    const titleEl = document.getElementById("viewTitle");
    if (titleEl) titleEl.textContent = viewName;
  }

  async handleLogout() {
    if (!confirm("Are you sure you want to sign out?")) return;
    try {
      await AuthService.logout();
      window.location.href = "index.html";
    } catch (err) {
      console.error("Logout error:", err);
      this._notifyFailure(
        "logout",
        err,
        "You could not be signed out. Check your connection and try again.",
      );
    }
  }

  openDrvModal(id = null) {
    this.state.editDrvId = id;
    const modal = document.getElementById("drvMov");
    const title = document.getElementById("drvModalTtl");
    if (!modal) return;

    modal.classList.remove("hidden");
    modal.classList.add("flex");
    if (title) title.textContent = id ? "Edit Driver" : "Add Driver";

    [
      "drvFName",
      "drvLName",
      "drvPhone",
      "drvLicense",
      "drvTruckType",
      "drvPlate",
      "drvCompany",
      "drvHelper",
      "drvNotes",
    ].forEach((f) => {
      const el = document.getElementById(f);
      if (el) el.value = "";
    });

    if (id) {
      const d = this.state.drivers.find((x) => x.id === id);
      if (d) {
        const parts = (d.name || "").split(" ");
        if (document.getElementById("drvFName"))
          document.getElementById("drvFName").value = parts[0] || "";
        if (document.getElementById("drvLName"))
          document.getElementById("drvLName").value =
            parts.slice(1).join(" ") || "";
        if (document.getElementById("drvPhone"))
          document.getElementById("drvPhone").value = d.phone || "";
        if (document.getElementById("drvLicense"))
          document.getElementById("drvLicense").value = d.license || "";
        if (document.getElementById("drvTruckType"))
          document.getElementById("drvTruckType").value = d.truckType || "";
        if (document.getElementById("drvPlate"))
          document.getElementById("drvPlate").value = d.plateNumber || "";
        if (document.getElementById("drvCompany"))
          document.getElementById("drvCompany").value =
            d.truckingCompany || d.company || "";
        if (document.getElementById("drvHelper"))
          document.getElementById("drvHelper").value = d.helper || "";
        if (document.getElementById("drvNotes"))
          document.getElementById("drvNotes").value = d.notes || "";
      }
    }
  }

  closeDrvModal() {
    const modal = document.getElementById("drvMov");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
    this.state.editDrvId = null;
  }

  async saveDriver() {
    const fn = document.getElementById("drvFName").value.trim();
    const ln = document.getElementById("drvLName").value.trim();
    const nm = `${fn} ${ln}`.trim();
    const phone = document.getElementById("drvPhone").value.trim();
    const saveBtn = document.getElementById("drvSaveBtn");

    if (!nm || !phone) {
      this._showErrorToast("Driver name and phone number are required.");
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "SAVING...";
    }

    const data = {
      name: nm,
      phone: phone,
      license: document.getElementById("drvLicense").value.trim(),
      truckType: document.getElementById("drvTruckType").value.trim(),
      plateNumber: document.getElementById("drvPlate").value.trim(),
      truckingCompany: document.getElementById("drvCompany").value.trim(),
      helper: document.getElementById("drvHelper").value.trim(),
      notes: document.getElementById("drvNotes").value.trim(),
    };

    try {
      const id = this.state.editDrvId;
      await StaffDriverService.save(id, data);

      this.closeDrvModal();
      this._showToast("Driver saved. Fleet Manager updated.");
      this._renderAll();
    } catch (err) {
      console.error("Save Driver Error:", err);
      this._notifyFailure(
        "driver-save",
        err,
        "The driver could not be saved. Check your connection and try again.",
      );
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "SAVE DRIVER PROFILE";
      }
    }
  }

  async deleteDriver(id) {
    if (
      !confirm(
        "Are you sure you want to delete this driver profile? This action cannot be undone.",
      )
    )
      return;

    try {
      await StaffDriverService.remove(id);
      const toast = document.getElementById("toast");
      if (toast) {
        toast.textContent = "Driver profile deleted.";
        toast.style.opacity = "1";
        setTimeout(() => (toast.style.opacity = "0"), 3000);
      }
    } catch (err) {
      console.error("Delete Driver Error:", err);
      this._notifyFailure(
        "driver-delete",
        err,
        "The driver could not be deleted. Check your permissions or try again.",
      );
    }
  }

  loadAdminPortal() {
    const tbody = document.getElementById("userTableBody");
    if (!tbody) return;

    tbody.innerHTML = this._loadingTableRows(5, 4, "Loading users");

    const myUser = this.state.user;
    if (!myUser) return;

    const isSuperAdmin = myUser.role === "super_admin";
    const isAdmin = myUser.role === "admin" || isSuperAdmin;

    if (!isAdmin) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center py-8 text-sysu-red">Access Denied</td></tr>';
      return;
    }

    //  Initialize active user tab if not set

    if (!this.state._activeUserTab) {
      this.state._activeUserTab = "employees";
    }

    //  Wire sub-tabs (Employees vs Drivers) once

    const tabsContainer = document.querySelector(
      ".user-management-tab",
    )?.parentElement;
    if (tabsContainer && !tabsContainer._wired) {
      tabsContainer._wired = true;
      tabsContainer.querySelectorAll(".user-management-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetTab = btn.dataset.userTab;
          this.state._activeUserTab = targetTab;

          //  Update styling

          tabsContainer
            .querySelectorAll(".user-management-tab")
            .forEach((b) => {
              const isTarget = b.dataset.userTab === targetTab;
              if (isTarget) {
                b.className =
                  "user-management-tab px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-sysu-red text-white transition-all flex items-center gap-2 shadow-sm";
                const badge = b.querySelector("span");
                if (badge)
                  badge.className =
                    "px-2 py-0.5 rounded-full text-[10px] bg-white/20 text-white font-mono";
              } else {
                b.className =
                  "user-management-tab px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-db-panel hover:bg-db-item-hover text-db-text3 hover:text-db-text border border-db-border transition-all flex items-center gap-2";
                const badge = b.querySelector("span");
                if (badge)
                  badge.className =
                    "px-2 py-0.5 rounded-full text-[10px] bg-db-item-hover text-db-text3 font-mono";
              }
            });

          this._renderUsersTable(this.state._rawUsersList || []);
        });
      });
    }

    //  Wire search input once

    const searchInput = document.getElementById("userSearchInput");
    if (searchInput && !searchInput._wired) {
      searchInput._wired = true;
      searchInput.addEventListener("input", (e) => {
        this.state._userSearchQuery = e.target.value;
        this._renderUsersTable(this.state._rawUsersList || []);
      });
    }

    //  Subscribe to the SQL-backed users topic over Socket.IO.

    if (this._usersSubs) {
      this._usersSubs();
      this._usersSubs = null;
    }

    this._usersSubs = subscribeRealtime(
      "users",
      {},
      (rows) => {
        const users = [];
        asCollectionSnapshot(rows).forEach((docSnap) => {
          const user = { id: docSnap.id, ...docSnap.data() };
          if (user.deletionState !== "complete") users.push(user);
        });
        //  Sort: Super Admins, Admins, Fleet Managers, QR Generator, Drivers, Pending

        const roleOrder = {
          super_admin: 1,
          admin: 2,
          fleet_manager: 3,
          qr_generator: 4,
          driver: 5,
          pending: 6,
        };
        users.sort(
          (a, b) => (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99),
        );

        this.state._rawUsersList = users;

        //  Update badge counts

        const employeeCount = users.filter((u) => u.role !== "driver").length;
        const driverCount = users.filter((u) => u.role === "driver").length;
        const empBadge = document.getElementById("userCountEmployees");
        const drvBadge = document.getElementById("userCountDrivers");
        if (empBadge) empBadge.textContent = employeeCount;
        if (drvBadge) drvBadge.textContent = driverCount;

        this._renderUsersTable(users);
      },
      (err) => {
        console.error("Users subscription error:", err);
        this._notifyFailure(
          "user-list-subscription",
          err,
          "User accounts could not be loaded. Check your connection and retry.",
        );
        tbody.innerHTML =
          '<tr><td colspan="5" class="text-center py-8 text-sysu-red">User accounts are temporarily unavailable. Refresh to try again.</td></tr>';
      },
    );
  }

  _renderUsersTable(users) {
    const tbody = document.getElementById("userTableBody");
    if (!tbody) return;

    const visibleUsers = users.filter(
      (user) => user.deletionState !== "complete",
    );

    const myUser = this.state.user;
    const isSuperAdmin = myUser?.role === "super_admin";
    const isAdmin = myUser?.role === "admin" || isSuperAdmin;
    const currentUserId = myUser?.uid || myUser?.id;

    const activeTab = this.state._activeUserTab || "employees";

    //  Tab filter: Drivers only vs Employees/Executives (non-driver)

    const tabFilteredUsers = visibleUsers.filter((u) => {
      if (activeTab === "drivers") {
        return u.role === "driver";
      } else {
        //  Employees: super_admin, admin, fleet_manager, qr_generator, pending / other

        return u.role !== "driver";
      }
    });

    const query = (this.state._userSearchQuery || "").trim().toLowerCase();
    const filtered = query
      ? tabFilteredUsers.filter(
          (u) =>
            (u.name || "").toLowerCase().includes(query) ||
            (u.username || "").toLowerCase().includes(query) ||
            (u.position || "").toLowerCase().includes(query) ||
            (u.role || "").toLowerCase().includes(query),
        )
      : tabFilteredUsers;

    tbody.innerHTML = "";
    if (filtered.length === 0) {
      const emptyLabel =
        activeTab === "drivers" ? "drivers" : "employees / staff";
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-db-text3">${query ? `No ${emptyLabel} matching "${escapeHtml(query)}".` : `No ${emptyLabel} found.`}</td></tr>`;
      return;
    }

    filtered.forEach((u) => {
      const docId = u.id;
      const accountSuffix = docId.slice(-6);
      const name = [u.displayName, u.name, u.fullName]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value && value.toLowerCase() !== "user");
      const username = typeof u.username === "string" ? u.username.trim() : "";
      const userLabel = name || username || `Account …${accountSuffix}`;
      const isPending = u.role === "pending" || u.status === "inactive";
      const deletionPending = u.deletionState === "pending";
      const isLightTheme = document.documentElement.dataset.theme === "light";

      let roleSelectHtml;
      if (isSuperAdmin && u.role !== "super_admin" && !u.deletionState) {
        roleSelectHtml = `
                <select data-action="change-role" data-uid="${escapeHtml(docId)}" class="bg-db-panel border border-db-border text-db-text px-3 py-1.5 rounded-lg text-xs font-semibold outline-none cursor-pointer hover:border-blue-400 transition-colors focus:ring-1 focus:ring-blue-400">
                  <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
                  <option value="fleet_manager" ${u.role === "fleet_manager" ? "selected" : ""}>Fleet Manager</option>
                  <option value="qr_generator" ${u.role === "qr_generator" ? "selected" : ""}>QR Generator</option>
                  <option value="driver" ${u.role === "driver" ? "selected" : ""}>Driver</option>
                  <option value="pending" ${isPending ? "selected" : ""}>Pending (Suspended)</option>
                </select>`;
      } else if (
        isAdmin &&
        !isSuperAdmin &&
        u.role !== "super_admin" &&
        u.role !== "admin" &&
        !u.deletionState
      ) {
        roleSelectHtml = `
                <select data-action="change-role" data-uid="${escapeHtml(docId)}" class="bg-db-panel border border-db-border text-db-text px-3 py-1.5 rounded-lg text-xs font-semibold outline-none cursor-pointer hover:border-blue-400 transition-colors focus:ring-1 focus:ring-blue-400">
                  <option value="fleet_manager" ${u.role === "fleet_manager" ? "selected" : ""}>Fleet Manager</option>
                  <option value="qr_generator" ${u.role === "qr_generator" ? "selected" : ""}>QR Generator</option>
                  <option value="driver" ${u.role === "driver" ? "selected" : ""}>Driver</option>
                  <option value="pending" ${isPending ? "selected" : ""}>Pending (Suspended)</option>
                </select>`;
      } else {
        const roleColor = isLightTheme
          ? {
              super_admin: "#b91c1c",
              admin: "#166534",
              qr_generator: "#6b21a8",
              fleet_manager: "#155e75",
            }[u.role] || "#1e40af"
          : {
              super_admin: "#f04444",
              admin: "#4ade80",
              qr_generator: "#a78bfa",
              fleet_manager: "#38bdf8",
            }[u.role] || "#60a5fa";
        const roleBg =
          u.role === "super_admin"
            ? "rgba(240,68,68,0.1)"
            : u.role === "admin"
              ? "rgba(74,222,128,0.1)"
              : u.role === "qr_generator"
                ? "rgba(167,139,250,0.1)"
                : u.role === "fleet_manager"
                  ? "rgba(56,189,248,0.1)"
                  : "rgba(96,165,250,0.1)";
        roleSelectHtml = `<span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${roleBg};color:${roleColor};">${(u.role || "user").replace(/_/g, " ")}</span>`;
      }

      const statusColor = isPending
        ? isLightTheme
          ? "#92400e"
          : "#fbbf24"
        : isLightTheme
          ? "#166534"
          : "#4ade80";
      const statusBg = isPending
        ? "rgba(251,191,36,0.1)"
        : "rgba(74,222,128,0.1)";
      const statusText = deletionPending
        ? "Deletion in progress"
        : isPending
          ? "Pending"
          : "Active";

      const canDelete =
        isSuperAdmin && u.role !== "super_admin" && docId !== currentUserId;

      const tr = document.createElement("tr");
      tr.className = "hover:bg-db-item-hover transition-colors";
      tr.innerHTML = `
              <td class="px-6 py-4 border-b border-db-border">
                <div class="font-semibold text-db-text">${escapeHtml(userLabel)}</div>
                <div class="text-[11px] text-db-text3">${escapeHtml(username || `Account ID ending ${accountSuffix}`)}</div>
              </td>
              <td class="px-6 py-4 border-b border-db-border text-db-text2 text-sm">${escapeHtml(u.position || "—")}</td>
              <td class="px-6 py-4 border-b border-db-border">${roleSelectHtml}</td>
              <td class="px-6 py-4 border-b border-db-border">
                <span class="px-2 py-1 rounded-full text-[11px] font-bold flex items-center w-max gap-1.5" style="background:${statusBg};color:${statusColor};">
                   <div class="w-1.5 h-1.5 rounded-full" style="background:${statusColor};"></div>
                   ${statusText}
                </span>
              </td>
              <td class="px-6 py-4 border-b border-db-border text-right">
                ${canDelete ? `<button data-action="delete-user" data-uid="${escapeHtml(docId)}" data-name="${escapeHtml(userLabel)}" class="bg-[#f04444]/10 hover:bg-[#f04444]/20 border border-[#f04444]/20 text-[#f04444] px-3 py-1.5 rounded-lg text-xs cursor-pointer font-bold transition-colors">${deletionPending ? "Retry Delete" : "Delete Account"}</button>` : ""}
              </td>`;
      tbody.appendChild(tr);
    });

    //  Wire change role listeners

    tbody.querySelectorAll("[data-action='change-role']").forEach((select) => {
      select.addEventListener("change", (e) => {
        const uid = select.dataset.uid;
        const newRole = e.target.value;
        this.changeUserRole(uid, newRole);
      });
    });

    //  Wire delete user listeners

    tbody.querySelectorAll("[data-action='delete-user']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        this.deleteUserRecord(uid, name);
      });
    });
  }

  async deleteUserRecord(uid, name = "this user") {
    if (
      !confirm(
        `Are you sure you want to permanently delete account for "${name}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      const token = await AuthService.getToken();
      const response = await fetchWithTimeout(
        `${API_CONFIG.BASE_URL}/api/users/delete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ uid }),
        },
      );

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          throw new Error(`HTTP Error ${response.status}`);
        }
        throw new Error(errorData.message || "Failed to delete user");
      }

      this._showToast("User account deleted successfully");
    } catch (e) {
      console.error("Error deleting user:", e);
      this._notifyFailure(
        "user-delete",
        e,
        "The account could not be deleted. Check your permissions or try again.",
      );
    }
  }

  /**
   * Load FIFO override requests into a given container with specified filter
   * @param {HTMLElement} container - The container element to populate
   * @param {string} filter - The filter to apply (pending, approved, rejected, expired, completed, guards, truck-companies)
   */
  loadOverrideRequestsIntoContainer(container, filter) {
    if (!container) return;

    container.innerHTML = `<div role="status" aria-label="Loading requests" class="space-y-3" aria-busy="true">
            ${Array.from(
              { length: 3 },
              () => `<div class="rounded-lg border border-db-border p-4 animate-pulse" aria-hidden="true">
                <div class="h-4 w-1/3 rounded bg-db-item-hover mb-4"></div>
                <div class="h-3 w-3/4 rounded bg-db-item-hover mb-2"></div>
                <div class="h-3 w-1/2 rounded bg-db-item-hover"></div>
            </div>`,
            ).join("")}
        </div>`;

    //  Subscribe to MySQL-backed override requests through Socket.IO.

    //  Dispose of any existing subscription to avoid conflicts

    if (this._overrideRequestsSubs) {
      this._overrideRequestsSubs();
      this._overrideRequestsSubs = null;
    }

    //  Build query based on filter

    //  Only apply status filter for actual status values

    const statusFilters = [
      "pending",
      "approved",
      "rejected",
      "expired",
      "completed",
    ];
    //  For guards and truck-companies filters, we show all requests (can be refined later)


    this._overrideRequestsSubs = subscribeRealtime(
      "overrideRequests",
      { status: statusFilters.includes(filter) ? filter : null },
      (rows) => {
        const snap = asCollectionSnapshot(rows);
        container.innerHTML = "";
        if (snap.empty) {
          container.innerHTML =
            '<div class="flex items-center justify-center min-h-[200px] text-db-text3 italic text-sm">No pending items.</div>';
          return;
        }

        //  Create a simple list of override requests

        const requestsList = document.createElement("div");
        requestsList.className = "space-y-3";

        snap.forEach((doc) => {
          const request = doc.data();
          const docId = doc.id;

          const requestDiv = document.createElement("div");
          requestDiv.className = "p-4 border border-db-border rounded-lg";
          requestDiv.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-semibold text-db-text">Request #${docId.substring(0, 8)}</span>
                        <span class="px-2 py-1 rounded-full text-[11px] font-bold ${request.status === "pending" ? "bg-[rgba(251,191,36,0.1)] text-[#fbbf24]" : request.status === "approved" ? "bg-[rgba(74,222,128,0.1)] text-[#4ade80]" : request.status === "rejected" ? "bg-[rgba(244,63,94,0.1)] text-[#f43f5f]" : request.status === "expired" ? "bg-[rgba(244,63,94,0.1)] text-[#f43f5f]" : request.status === "completed" ? "bg-[rgba(16,185,129,0.1)] text-[#10b981]" : "bg-[rgba(107,114,128,0.2)] text-[#6b7280]"}" style="text-transform: capitalize;">
                            ${request.status}
                        </span>
                    </div>
                    <div class="mb-2 text-sm text-db-text3">
                        <strong>Driver:</strong> ${escapeHtml(request.requestedDriverName || "Unknown")}<br>
                        <strong>Dispatch Key:</strong> ${escapeHtml(request.dispatchKey || "N/A")}<br>
                        <strong>Reason:</strong> ${escapeHtml(request.reason || "No reason provided")}
                    </div>
                    <div class="text-xs text-db-text4">
                        ${new Date(request.createdAt?.toDate?.() || request.createdAt || 0).toLocaleString()}
                    </div>
                `;
          requestsList.appendChild(requestDiv);
        });

        container.appendChild(requestsList);
      },
    );
  }

  async changeUserRole(uid, newRole) {
    if (!confirm("Update user role to " + newRole + "?")) return;

    try {
      const token = await AuthService.getToken();
      const response = await fetchWithTimeout(
        `${API_CONFIG.BASE_URL}/api/users/update-role`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ uid, role: newRole }),
        },
      );

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          if (response.status === 403)
            throw new Error("CORS or Permission Blocked (403)", { cause: e });
          throw new Error(`HTTP Error ${response.status}`, { cause: e });
        }
        throw new Error(errorData.message || "Failed to update role");
      }

      this._showToast("Role updated successfully.");
    } catch (e) {
      console.error("Error updating role", e);
      this._notifyFailure(
        "user-role-update",
        e,
        "The user role could not be updated. Check your permissions or try again.",
      );
    }
  }

  groupByDispatch(shipments) {
    const groups = Object.create(null);
    for (const s of shipments) {
      const key =
        typeof s?.SAPDispatchNumber === "string"
          ? s.SAPDispatchNumber.trim()
          : "";
      if (!key) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }

  async _loadSapDispatchDetails(dispatchKeys) {
    const now = Date.now();
    const keys = [...new Set(dispatchKeys)].filter(
      (key) =>
        this.state.sapAssignments[key] &&
        !this._sapDispatchDetailsPending.has(key) &&
        now - (this._sapDispatchDetailsFetchedAt.get(key) || 0) >=
          5 * 60 * 1000 &&
        now >= (this._sapDispatchDetailsRetryAfter.get(key) || 0),
    );
    if (!keys.length) return;

    const batches = [];
    for (let index = 0; index < keys.length; index += 100)
      batches.push(keys.slice(index, index + 100));
    await Promise.all(
      batches.map(async (batch) => {
        batch.forEach((key) => this._sapDispatchDetailsPending.add(key));
        try {
          const response = await SAPService.fetchDispatchDetails(batch);
          void SystemErrorService.resolveOperation(
            "frontend_operation_failure",
            "sap-detail-enrichment",
          ).catch(() => {});
          const details = response?.data || response;
          const warnings = Array.isArray(response?.warnings)
            ? response.warnings
            : [];
          const warningByDispatch = new Map(
            warnings.map((warning) => [warning.dispatchKey, warning]),
          );
          for (const key of batch) {
            this.state.sapDispatchDetails[key] = Array.isArray(details?.[key])
              ? details[key]
              : [];
            const mismatch = warningByDispatch.get(key);
            if (
              mismatch &&
              Number.isInteger(mismatch.missingCount) &&
              mismatch.missingCount > 0
            ) {
              this.state.sapDispatchDetailsMismatches[key] = {
                expectedCount: mismatch.expectedCount,
                receivedCount: mismatch.receivedCount,
                missingCount: mismatch.missingCount,
              };
              this._sapDispatchDetailsFetchedAt.delete(key);
              this._sapDispatchDetailsRetryAfter.set(key, Date.now() + 30_000);
            } else {
              delete this.state.sapDispatchDetailsMismatches[key];
              this._sapDispatchDetailsFetchedAt.set(key, Date.now());
              this._sapDispatchDetailsRetryAfter.delete(key);
            }
            delete this.state.sapDispatchDetailsErrors[key];
          }
          this._rebuildShipmentGroups();
          this._renderSapTable();
          this._refreshOpenDispatchDetail();
        } catch (error) {
          for (const key of batch)
            this._sapDispatchDetailsRetryAfter.set(key, Date.now() + 30_000);
          for (const key of batch)
            this.state.sapDispatchDetailsErrors[key] = {
              requestId: error.requestId || null,
              status: Number(error.status) || null,
            };
          SystemErrorService.report("frontend_operation_failure", {
            operation: "sap-detail-enrichment",
            errorName: error?.name || "Error",
          });
          console.warn("[SAP] Assigned shipment details unavailable", {
            requestId: error.requestId || null,
          });
          if (batch.includes(this._currentDispatchKey))
            this._refreshOpenDispatchDetail();
        } finally {
          batch.forEach((key) => this._sapDispatchDetailsPending.delete(key));
        }
      }),
    );
  }

  _rebuildShipmentGroups() {
    this.state.sapGroupedByDispatch = mergeAssignmentGroups(
      this.groupByDispatch(this.state.sapShipments),
      this.state.sapAssignments,
      this.state.sapDispatchDetails,
    );
  }

  _refreshOpenDispatchDetail() {
    const modal = document.getElementById("sapDispatchDetail");
    if (
      !modal ||
      modal.classList.contains("hidden") ||
      !this._currentDispatchKey
    )
      return;
    if (!this.state.sapGroupedByDispatch[this._currentDispatchKey]?.length) {
      this.closeSapDispatchModal();
      return;
    }
    this.openSapDispatchDetail(this._currentDispatchKey);
  }

  openSapDispatchDetail(dispatchNumber) {
    this._currentDispatchKey = dispatchNumber;
    const group = this.state.sapGroupedByDispatch[dispatchNumber];
    if (!group || group.length === 0) return;

    const rec =
      group.find(
        (row) =>
          row.Route ||
          row.PlanningDate ||
          row.Planning_Date ||
          row.ActualDelDate,
      ) || group[0];
    const asgn = this.state.sapAssignments[dispatchNumber];
    const detailsWarning = document.getElementById("sapDtlDataWarning");
    if (detailsWarning) {
      const loadError = this.state.sapDispatchDetailsErrors?.[dispatchNumber];
      const mismatch =
        this.state.sapDispatchDetailsMismatches?.[dispatchNumber];
      detailsWarning.hidden = !loadError && !mismatch;
      const warningText = detailsWarning.querySelector("span");
      if (warningText) {
        const requestId =
          this.state.sapDispatchDetailsErrors[this._currentDispatchKey]
            ?.requestId;
        if (mismatch) {
          warningText.textContent = `Some shipment details are missing. Only ${mismatch.receivedCount} of ${mismatch.expectedCount} expected detail rows loaded. Check the details before continuing; saved assignment and POD information are still available.`;
        } else {
          const loadError = this.state.sapDispatchDetailsErrors[this._currentDispatchKey];
          const guidance = this._sapFailureGuidance(loadError?.status, requestId);
          warningText.textContent = `Shipment details could not be loaded. ${guidance.title} ${guidance.action} Saved assignment and POD information are still available.${guidance.requestId ? ` Reference: ${guidance.requestId}` : ""}`;
        }
      }
      if (!detailsWarning.dataset.retryWired) {
        detailsWarning.dataset.retryWired = "1";
        detailsWarning.addEventListener("click", (event) => {
          const button = event.target.closest(
            '[data-action="sap-detail-retry"]',
          );
          if (!button) return;
          const key = this._currentDispatchKey;
          if (!key) return;
          setButtonBusy(button);
          this._sapDispatchDetailsRetryAfter.delete(key);
          this._loadSapDispatchDetails([key]).finally(() => {
            if (!button.isConnected) return;
            resetButton(button, "Retry details");
          });
        });
      }
    }

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set("sapDtlDispatchNum", rec.SAPDispatchNumber || dispatchNumber);
    set("sapDtlStatus", assignmentDisplayStatus(asgn, rec));
    set("sapDtlDelivery", rec.Delivery || "—");
    set("sapDtlPlanDate", SAPService.parseDate(rec.PlanningDate));
    set("sapDtlActualDate", this._formatDelDateDisplay(rec.ActualDelDate));
    set("sapDtlSONum", rec.SONumber || "—");
    set("sapDtlPONum", rec.PONumber || "—");
    set("sapDtlDocNum", rec.DocumentNumber || "—");
    set("sapDtlTruckType", rec.TruckType || "—");
    set("sapDtlRoute", rec.Route || "—");
    set("sapDtlPlate", rec.PlateNumber || "—");
    set("sapDtlDriver", rec.Driver || "—");
    set("sapDtlShipStart", this._parseSAPTime(rec.ShipmentStart));
    set("sapDtlRemarks", rec.PlanningRemarks || "—");

    //  Build grouped Ship-To summaries while retaining every source OBD in its expandable detail.

    let totalAmount = 0,
      totalVolume = 0,
      totalWeight = 0,
      totalQty = 0;
    const linesTbody = document.getElementById("sapDtlOBDLines");
    if (linesTbody) {
      if (!linesTbody.dataset.obdGroupToggleBound) {
        linesTbody.addEventListener("click", (event) => {
          const obdPreview = event.target.closest("[data-obd-number]");
          if (obdPreview && linesTbody.contains(obdPreview)) {
            let obdNumber;
            try {
              obdNumber = decodeURIComponent(obdPreview.dataset.obdNumber);
            } catch (_) {
              return;
            }
            this.openObdPodPreview(obdNumber);
            return;
          }
          const preview = event.target.closest("[data-obd-group-preview]");
          if (preview && linesTbody.contains(preview)) {
            const groupIndex = Number(preview.dataset.obdGroupPreview);
            if (Number.isInteger(groupIndex))
              this.openObdPodGroupPreview(groupIndex);
            return;
          }
          const button = event.target.closest("[data-obd-group-toggle]");
          if (!button || !linesTbody.contains(button)) return;
          const details = document.getElementById(
            button.getAttribute("aria-controls"),
          );
          if (!details) return;
          details.hidden = !details.hidden;
          button.setAttribute("aria-expanded", String(!details.hidden));
          const icon = button.querySelector('[aria-hidden="true"]');
          if (icon) icon.textContent = details.hidden ? "v" : "^";
        });
        linesTbody.dataset.obdGroupToggleBound = "true";
      }

      const metrics = (row) => ({
        amount: Number(row.Amount) || 0,
        volume: Number(row.Volume) || 0,
        weight: Number(row.Weight) || 0,
        quantity: Number(row.Quantity) || 0,
      });
      const formatAmount = (amount) =>
        amount > 0
          ? `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
          : "\u2014";
      const formatMeasure = (value) =>
        value > 0 ? value.toFixed(3) : "\u2014";
      const canPreviewObd = (r) => {
        const podMatch = asgn?.lineItems?.find(
          (li) => li.obdNumber === r.OBDNumber,
        );
        return (
          asgn &&
          ["in_transit", "completed", "returning_to_base"].includes(
            asgn.tripStatus?.toLowerCase(),
          ) &&
          (podMatch?.podImageUrl ||
            podMatch?.isPodCompleted ||
            podMatch?.guardSignatureBase64 ||
            asgn?.guardSignatureBase64)
        );
      };
      const renderObdRow = (r, showPreview = true) => {
        const amt = Number(r.Amount) || 0;
        //  Look up POD data from the assignment's SQL-backed lineItems, not from SAP records.

        const podMatch = asgn?.lineItems?.find(
          (li) => li.obdNumber === r.OBDNumber,
        );

        return `
                    <tr class="border-b border-db-border/50 hover:bg-db-item-hover/30 transition-colors">
                        <td data-label="OBD Number" class="py-2 px-1 font-mono text-db-text text-[10px] text-center break-words">${escapeHtml(r.OBDNumber || "\u2014")}</td>
                        <td data-label="Amount" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatAmount(amt)}</td>
                        <td data-label="Volume (m³)" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatMeasure(Number(r.Volume) || 0)}</td>
                        <td data-label="Weight (kg)" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatMeasure(Number(r.Weight) || 0)}</td>
                        <td data-label="Quantity" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatMeasure(Number(r.Quantity) || 0)}</td>
                        <td data-label="Ship-To" class="py-2 px-1 font-mono text-db-text text-[10px] text-center break-words">${escapeHtml(r.ShipToParty || "\u2014")}</td>
                        <td data-label="Customer Name" class="py-2 px-1 text-db-text text-[10px] text-center break-words leading-snug">${escapeHtml(r.ShipToPartyName || "\u2014")}</td>
                        <td data-label="Delivery Address" class="py-2 px-1 text-db-text text-[10px] text-center break-words leading-snug">${escapeHtml(r.Address || "\u2014")}</td>
                        <td data-label="Latitude" class="py-2 px-1 text-center font-mono text-db-text2 text-[10px] break-words tabular-nums">${formatCoordinate(r.Latitude)}</td>
                        <td data-label="Longitude" class="py-2 px-1 text-center font-mono text-db-text2 text-[10px] break-words tabular-nums">${formatCoordinate(r.Longitude)}</td>
                        <td data-label="POD Preview" class="py-2 px-1 text-center">
                          ${showPreview && canPreviewObd(r) ? `<button type="button" data-obd-number="${escapeHtml(encodeURIComponent(r.OBDNumber || "").replaceAll("'", "%27"))}" class="border border-sysu-gold/20 hover:border-sysu-gold/50 bg-sysu-gold/10 hover:bg-sysu-gold/20 text-sysu-gold px-2 py-1 rounded-md text-xs font-bold transition-colors" title="Preview POD">Preview</button>` : ""}
                        </td>
                        <td data-label="Delivery Status" class="py-2 px-1 text-center text-db-text text-[10px]" data-pod-status>${obdDeliveryStatus(podMatch)}</td>
                    </tr>`;
      };

      const rowGroups = groupObdRowsByShipTo(group);
      this._sapObdPreviewGroups = rowGroups;
      linesTbody.innerHTML = rowGroups
        .map((rows, groupIndex) => {
          for (const row of rows) {
            const values = metrics(row);
            totalAmount += values.amount;
            totalVolume += values.volume;
            totalWeight += values.weight;
            totalQty += values.quantity;
          }
          if (rows.length === 1) return renderObdRow(rows[0]);

          const total = rows.reduce(
            (sum, row) => {
              const values = metrics(row);
              return {
                amount: sum.amount + values.amount,
                volume: sum.volume + values.volume,
                weight: sum.weight + values.weight,
                quantity: sum.quantity + values.quantity,
              };
            },
            { amount: 0, volume: 0, weight: 0, quantity: 0 },
          );
          const representative = rows[0];
          const statuses = [
            ...new Set(
              rows.map((row) =>
                obdDeliveryStatus(
                  asgn?.lineItems?.find((li) => li.obdNumber === row.OBDNumber),
                ),
              ),
            ),
          ];
          const status = statuses.length === 1 ? statuses[0] : "Mixed";
          const detailsId = `sapObdGroupDetails-${groupIndex}`;
          return `
                    <tr class="border-b border-db-border/50 bg-db-panel/40">
                        <td data-label="OBD Number" class="py-2 px-1 text-center"><button type="button" data-obd-group-toggle aria-expanded="false" aria-controls="${detailsId}" class="text-sysu-gold hover:text-db-text text-[10px] font-bold" aria-label="Show ${rows.length} OBD records">${rows.length} OBDs <span aria-hidden="true">v</span></button></td>
                        <td data-label="Amount" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatAmount(total.amount)}</td>
                        <td data-label="Volume (m³)" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatMeasure(total.volume)}</td>
                        <td data-label="Weight (kg)" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatMeasure(total.weight)}</td>
                        <td data-label="Quantity" class="py-2 px-1 text-center font-mono text-db-text text-[10px] break-words tabular-nums">${formatMeasure(total.quantity)}</td>
                        <td data-label="Ship-To" class="py-2 px-1 font-mono text-db-text text-[10px] text-center break-words">${escapeHtml(representative.ShipToParty || "\u2014")}</td>
                        <td data-label="Customer Name" class="py-2 px-1 text-db-text text-[10px] text-center break-words leading-snug">${escapeHtml(representative.ShipToPartyName || "\u2014")}</td>
                        <td data-label="Delivery Address" class="py-2 px-1 text-db-text text-[10px] text-center break-words leading-snug">${escapeHtml(representative.Address || "\u2014")}</td>
                        <td data-label="Latitude" class="py-2 px-1 text-center font-mono text-db-text2 text-[10px] break-words tabular-nums">${formatCoordinate(representative.Latitude)}</td>
                        <td data-label="Longitude" class="py-2 px-1 text-center font-mono text-db-text2 text-[10px] break-words tabular-nums">${formatCoordinate(representative.Longitude)}</td>
                        <td data-label="POD Preview" class="py-2 px-1 text-center">${rows.some(canPreviewObd) ? `<button type="button" data-obd-group-preview="${groupIndex}" class="border border-sysu-gold/20 hover:border-sysu-gold/50 bg-sysu-gold/10 hover:bg-sysu-gold/20 text-sysu-gold px-2 py-1 rounded-md text-xs font-bold transition-colors" title="Preview POD for all ${rows.length} OBDs">Preview</button>` : '<span class="text-db-text3 text-[11px]">—</span>'}</td>
                        <td data-label="Delivery Status" class="py-2 px-1 text-center text-db-text text-[10px] break-words" data-pod-status>${status}</td>
                    </tr>
                    <tr id="${detailsId}" hidden data-obd-group-details><td colspan="12" class="p-0"><table class="sap-obd-table w-full min-w-0"><tbody>${rows.map((row) => renderObdRow(row, false)).join("")}</tbody></table></td></tr>`;
        })
        .join("");
    }

    set(
      "sapDtlTotalAmount",
      totalAmount > 0
        ? `PHP ${totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
        : "—",
    );
    set("sapDtlTotalVolume", totalVolume > 0 ? totalVolume.toFixed(3) : "—");
    set("sapDtlTotalWeight", totalWeight > 0 ? totalWeight.toFixed(3) : "—");
    set("sapDtlTotalQty", totalQty > 0 ? totalQty.toFixed(3) : "—");

    //  Cargo totals (alias to same fields)

    set(
      "sapDtlAmount",
      totalAmount > 0
        ? `PHP ${totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
        : "—",
    );
    set("sapDtlVolume", totalVolume > 0 ? totalVolume.toFixed(3) : "—");
    set("sapDtlWeight", totalWeight > 0 ? totalWeight.toFixed(3) : "—");
    set("sapDtlQty", totalQty > 0 ? totalQty.toFixed(3) : "—");

    const statusEl = document.getElementById("sapDtlStatus");
    if (statusEl) {
      const s = (rec.PgiStatus || rec.CheckStatus || "").toUpperCase();
      statusEl.className = `font-bold text-sm ${s === "DELIVERED" ? "text-green-500" : s === "IN TRANSIT" ? "text-blue-500" : "text-sysu-gold"}`;
    }

    document.getElementById("sapDispatchDetail").classList.remove("hidden");
    document.getElementById("sapDispatchDetail").classList.add("flex");
  }

  closeSapDispatchModal() {
    const el = document.getElementById("sapDispatchDetail");
    if (el) {
      el.classList.add("hidden");
      el.classList.remove("flex");
    }
  }

  async _loadObdPodPreviewData(key, asgn, obdNumber) {
    const match = asgn?.lineItems?.find((li) => li.obdNumber === obdNumber);
    let imageUrl = match?.podImageUrl;
    let podRecord = null;
    let podLoadFailed = false;
    let groupPodId = match?.podGroupId || null;
    if (!imageUrl || imageUrl === "saved_in_subcollection") {
      try {
        podRecord = await PodService.getPod(key, obdNumber);
        imageUrl =
          podRecord?.base64Image ||
          podRecord?.imageUrl ||
          podRecord?.podImageUrl ||
          "";
        groupPodId = podRecord?.groupPodId || groupPodId;
      } catch (err) {
        console.warn("Failed to fetch pod image from subcollection:", err);
        this._notifyFailure(
          "pod-preview",
          err,
          "Proof of delivery could not be loaded. Check your connection and try again.",
        );
        podLoadFailed = true;
      }
    }

    return {
      obdNumber,
      match,
      imageUrl,
      podLoadFailed,
      groupPodId,
      capturedAt:
        match?.podCapturedAt ||
        podRecord?.podCapturedAt ||
        podRecord?.capturedAtMillis ||
        null,
      guardSignatureBase64:
        match?.guardSignatureBase64 || asgn?.guardSignatureBase64 || "",
      deliveryStatus: obdDeliveryStatus(match),
    };
  }

  //  POD preview for a specific OBD item

  async openObdPodPreview(obdNumber, dispatchKey = this._currentDispatchKey) {
    const key = dispatchKey;
    if (!key) return;
    const asgn = this.state.sapAssignments[key];
    const preview = await this._loadObdPodPreviewData(key, asgn, obdNumber);
    const { match, imageUrl, podLoadFailed } = preview;
    if (podLoadFailed) return;

    const modal = document.getElementById("podPreviewModal");
    if (!modal) return;
    const gallery = modal.querySelector("#podPreviewGallery");
    const singleContent = modal.querySelector("#podPreviewSingleContent");
    if (gallery) {
      gallery.hidden = true;
      gallery.replaceChildren();
    }
    if (singleContent) singleContent.hidden = false;
    const title = modal.querySelector("#podPreviewTitle");
    if (title) title.textContent = "POD Preview";
    const imgEl = modal.querySelector("#podPreviewImg");
    const tsEl = modal.querySelector("#podTimestamp");
    const signatureContainer = modal.querySelector("#podPreviewSignature");

    if (
      !imageUrl &&
      !match?.guardSignatureBase64 &&
      !asgn?.guardSignatureBase64
    ) {
      this._showToast(
        "No proof of delivery has been submitted for this shipment yet.",
      );
      return;
    }

    //  Reset zoom and drag state when opening new POD

    this.state.podZoomLevel = 1;
    this.state.podIsDragging = false;
    this.state.podDragStartX = 0;
    this.state.podDragStartY = 0;
    this.state.podImageOffsetX = 0;
    this.state.podImageOffsetY = 0;
    this.state.podMaxOffsetX = 0;
    this.state.podMaxOffsetY = 0;
    this.state.podVelocityX = 0;
    this.state.podVelocityY = 0;
    //  Cancel any existing animations

    if (this.state.podMomentumAnimationFrame !== null) {
      cancelAnimationFrame(this.state.podMomentumAnimationFrame);
    }
    if (this.state.podResetAnimationFrame !== null) {
      cancelAnimationFrame(this.state.podResetAnimationFrame);
    }
    this.state.podMomentumAnimationFrame = null;
    this.state.podResetAnimationFrame = null;
    this.state._lastDragTime = 0;
    this.state._lastDragX = 0;
    this.state._lastDragY = 0;

    if (imgEl) {
      imgEl.src = imageUrl || "";
      imgEl.style.display = imageUrl ? "block" : "none";
      //  Reset transform and cursor

      imgEl.style.transform = `scale(${this.state.podZoomLevel})`;
      imgEl.style.cursor = "zoom-in";
      imgEl.style.transformOrigin = "center center";
      imgEl.style.position = "relative";

      //  Calculate max pan offsets after image loads

      imgEl.onload = () => {
        this._calculatePodMaxOffsets(imgEl);
      };
    }
    const captureTime = match?.podCapturedAt;
    const captureDate = captureTime?.toDate
      ? captureTime.toDate()
      : typeof captureTime?.seconds === "number"
        ? new Date(captureTime.seconds * 1000)
        : typeof captureTime === "number"
          ? new Date(captureTime)
          : null;
    const captureText =
      captureDate && Number.isFinite(captureDate.getTime())
        ? captureDate.toLocaleString()
        : "—";
    if (tsEl) tsEl.textContent = captureText;
    const verifiedEl = modal.querySelector("#podVerifiedTimestamp");
    if (verifiedEl) verifiedEl.textContent = captureText;
    //  Handle signature button

    if (signatureContainer) {
      const guardSignatureBase64 =
        match?.guardSignatureBase64 || asgn?.guardSignatureBase64;
      if (guardSignatureBase64 && guardSignatureBase64.length > 50) {
        //  Show signature button

        signatureContainer.innerHTML = `
                    <button onclick="window.dashboard.openGuardSigPreview('${encodeURIComponent(obdNumber)}')"
                            class="mt-2 block w-full px-3 py-2 bg-sysu-red/10 hover:bg-sysu-red/20 border border-sysu-red/20 text-sysu-red font-bold text-sm rounded"
                            title="Guard Signature Preview">
                        View Guard Signature
                    </button>
                `;
      } else {
        //  Hide signature button

        signatureContainer.innerHTML = "";
      }
    }
    modal.classList.remove("hidden");
    modal.classList.add("flex");

    //  Remove any existing global ESC listener to avoid duplicates

    if (this._globalEscapeListener) {
      document.removeEventListener("keydown", this._globalEscapeListener);
    }
    //  Add global ESC key listener to handle modal stack

    const handleEscapeKey = (e) => {
      if (e.key === "Escape") {
        const guardModal = document.getElementById("guardPreviewModal");
        const podModal = document.getElementById("podPreviewModal");
        if (guardModal && guardModal.classList.contains("flex")) {
          //  Guard signature modal is open -> close it, keep POD preview

          this.closeGuardSigPreview();
        } else if (podModal && podModal.classList.contains("flex")) {
          //  POD preview is open -> close it (go back to dispatch)

          this.closePodPreview();
        }
      }
    };
    document.addEventListener("keydown", handleEscapeKey);
    this._globalEscapeListener = handleEscapeKey;

    //  Add event listeners for enhanced zoom functionality

    this._addPodPreviewEventListeners(imgEl, modal);
  }

  async openObdPodGroupPreview(groupIndex) {
    const key = this._currentDispatchKey;
    const group = this._sapObdPreviewGroups[groupIndex];
    const asgn = key && this.state.sapAssignments[key];
    if (!key || !asgn || !Array.isArray(group) || !group.length) return;

    const previews = await Promise.all(
      group.map((row) => this._loadObdPodPreviewData(key, asgn, row.OBDNumber)),
    );
    const modal = document.getElementById("podPreviewModal");
    const gallery = modal?.querySelector("#podPreviewGallery");
    const singleContent = modal?.querySelector("#podPreviewSingleContent");
    if (!modal || !gallery || !singleContent) {
      return this.openObdPodPreview(group[0].OBDNumber);
    }

    const groupedCaptures = [];
    const captureIndexes = new Map();
    for (const preview of previews) {
      const captureKey = preview.groupPodId
        ? `group:${preview.groupPodId}`
        : preview.imageUrl
          ? `image:${preview.imageUrl}`
          : `obd:${preview.obdNumber}`;
      let capture = captureIndexes.has(captureKey)
        ? groupedCaptures[captureIndexes.get(captureKey)]
        : null;
      if (!capture) {
        capture = { ...preview, obdNumbers: [] };
        captureIndexes.set(captureKey, groupedCaptures.length);
        groupedCaptures.push(capture);
      }
      capture.obdNumbers.push(preview.obdNumber);
      if (!capture.imageUrl && preview.imageUrl)
        capture.imageUrl = preview.imageUrl;
      if (!capture.capturedAt && preview.capturedAt)
        capture.capturedAt = preview.capturedAt;
      if (preview.guardSignatureBase64 && !capture.guardSignatureBase64)
        capture.guardSignatureBase64 = preview.guardSignatureBase64;
    }

    const captureTime = (capture) => {
      const value = capture.capturedAt;
      if (typeof value?.toMillis === "function") return value.toMillis();
      if (typeof value?.seconds === "number") return value.seconds * 1000;
      const timestamp = typeof value === "number" ? value : Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    //  Prefer a shared group capture; otherwise use the latest available legacy OBD capture.

    const selectedCapture =
      groupedCaptures
        .filter((capture) => capture.imageUrl)
        .sort(
          (left, right) =>
            right.obdNumbers.length - left.obdNumbers.length ||
            captureTime(right) - captureTime(left),
        )[0] || null;

    this._removePodPreviewEventListeners();
    singleContent.hidden = true;
    gallery.hidden = false;
    gallery.replaceChildren();
    const summary = document.createElement("p");
    summary.className = "mb-3 text-sm text-db-text2";
    summary.textContent = `One delivery point · ${group.length} OBDs · ${selectedCapture ? "1 POD photo" : "POD photo unavailable"}`;
    gallery.append(summary);

    const card = document.createElement("section");
    card.className = "rounded-lg border border-db-border bg-db-panel p-3";
    const heading = document.createElement("h3");
    heading.className = "mb-2 text-sm font-bold text-db-text";
    heading.textContent = `POD for delivery point · ${group.length} OBDs`;
    card.append(heading);

    const obdList = document.createElement("p");
    obdList.className = "mb-3 text-xs text-db-text2 break-words";
    obdList.textContent = previews
      .map((item) => `${item.obdNumber} · ${item.deliveryStatus}`)
      .join(" | ");
    card.append(obdList);

    if (selectedCapture) {
      const image = document.createElement("img");
      image.src = selectedCapture.imageUrl;
      image.alt = `POD for delivery point covering ${group.length} OBDs`;
      image.className = "mx-auto max-h-[60vh] w-auto rounded object-contain";
      card.append(image);

      if (selectedCapture.capturedAt) {
        const timestamp = selectedCapture.capturedAt?.toDate
          ? selectedCapture.capturedAt.toDate()
          : typeof selectedCapture.capturedAt?.seconds === "number"
            ? new Date(selectedCapture.capturedAt.seconds * 1000)
            : new Date(selectedCapture.capturedAt);
        const timestampText = document.createElement("p");
        timestampText.className = "mt-2 text-xs text-db-text3";
        timestampText.textContent = `Captured at: ${Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString() : "—"}`;
        card.append(timestampText);
      }
    }

    const signatureRows = previews.filter(
      (item) => item.guardSignatureBase64?.length > 50,
    );
    for (const item of signatureRows) {
      const signatureButton = document.createElement("button");
      signatureButton.type = "button";
      signatureButton.className =
        "mt-2 mr-2 rounded border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-600";
      signatureButton.textContent = `View ${item.obdNumber} Guard Signature`;
      signatureButton.addEventListener("click", () =>
        this.openGuardSigPreview(item.obdNumber),
      );
      card.append(signatureButton);
    }
    gallery.append(card);

    const title = modal.querySelector("#podPreviewTitle");
    if (title) title.textContent = `POD Preview · ${group.length} OBDs`;
    modal.classList.remove("hidden");
    modal.classList.add("flex");

    if (this._globalEscapeListener)
      document.removeEventListener("keydown", this._globalEscapeListener);
    this._globalEscapeListener = (event) => {
      if (event.key === "Escape") {
        const guardModal = document.getElementById("guardPreviewModal");
        if (guardModal?.classList.contains("flex")) this.closeGuardSigPreview();
        else this.closePodPreview();
      }
    };
    document.addEventListener("keydown", this._globalEscapeListener);
  }

  closePodPreview() {
    const modal = document.getElementById("podPreviewModal");
    if (modal) {
      //  Remove global ESC key listener

      if (this._globalEscapeListener) {
        document.removeEventListener("keydown", this._globalEscapeListener);
        this._globalEscapeListener = null;
      }
      modal.classList.add("hidden");
      modal.classList.remove("flex");
      const gallery = modal.querySelector("#podPreviewGallery");
      const singleContent = modal.querySelector("#podPreviewSingleContent");
      if (gallery) {
        gallery.hidden = true;
        gallery.replaceChildren();
      }
      if (singleContent) singleContent.hidden = false;
      const title = modal.querySelector("#podPreviewTitle");
      if (title) title.textContent = "POD Preview";
      //  Remove event listeners when closing modal

      this._removePodPreviewEventListeners();
      //  Cancel any ongoing animations

      if (this.state.podMomentumAnimationFrame !== null) {
        cancelAnimationFrame(this.state.podMomentumAnimationFrame);
        this.state.podMomentumAnimationFrame = null;
      }
      if (this.state.podResetAnimationFrame !== null) {
        cancelAnimationFrame(this.state.podResetAnimationFrame);
        this.state.podResetAnimationFrame = null;
      }
    }
  }

  //  Add event listeners for enhanced POD preview functionality

  _addPodPreviewEventListeners(imgEl, modal) {
    //  Mouse wheel zoom with Ctrl key

    imgEl.addEventListener("wheel", (e) => this._handlePodWheelZoom(e, imgEl));

    //  Drag functionality when zoomed in

    imgEl.addEventListener("mousedown", (e) =>
      this._handlePodDragStart(e, imgEl),
    );
    imgEl.addEventListener("mousemove", (e) =>
      this._handlePodDragMove(e, imgEl),
    );
    imgEl.addEventListener("mouseup", () => this._handlePodDragEnd(imgEl));
    imgEl.addEventListener("mouseleave", () => this._handlePodDragEnd(imgEl));

    //  Prevent image drag default behavior

    imgEl.addEventListener("dragstart", (e) => e.preventDefault());

    //  Double-click to toggle zoom

    imgEl.addEventListener("dblclick", () => this._handlePodDoubleClick(imgEl));
  }

  //  Remove event listeners for POD preview

  _removePodPreviewEventListeners() {
    const imgEl = document.getElementById("podPreviewImg");
    if (!imgEl) return;

    imgEl.removeEventListener("wheel", this._handlePodWheelZoom);
    imgEl.removeEventListener("mousedown", this._handlePodDragStart);
    imgEl.removeEventListener("mousemove", this._handlePodDragMove);
    imgEl.removeEventListener("mouseup", this._handlePodDragEnd);
    imgEl.removeEventListener("mouseleave", this._handlePodDragEnd);
    imgEl.removeEventListener("dragstart", this._handlePodDragStart); // Actually dragstart listener
    imgEl.removeEventListener("dblclick", this._handlePodDoubleClick);
  }

  //  Handle mouse wheel zoom with Ctrl key

  _handlePodWheelZoom(event, imgEl) {
    //  Only zoom when Ctrl key is pressed

    if (!event.ctrlKey) return;

    event.preventDefault(); // Prevent page scroll

    const zoomDelta = event.deltaY < 0 ? 0.1 : -0.1; // Zoom in/out based on scroll direction
    let newZoomLevel = this.state.podZoomLevel + zoomDelta;

    //  Clamp zoom level between 1 (original) and 3 (300%)

    newZoomLevel = Math.max(1, Math.min(3, newZoomLevel));

    //  Update zoom level state

    this.state.podZoomLevel = newZoomLevel;

    //  If zooming out to 1x, reset pan offsets to center the image

    if (this.state.podZoomLevel === 1) {
      this.state.podImageOffsetX = 0;
      this.state.podImageOffsetY = 0;
    }

    //  Apply transform with zoom and current offset

    imgEl.style.transform = `translate(${this.state.podImageOffsetX}px, ${this.state.podImageOffsetY}px) scale(${this.state.podZoomLevel})`;

    //  Recalculate max offsets after zoom change

    if (imgEl.complete) {
      this._calculatePodMaxOffsets(imgEl);
    }

    //  Update cursor based on zoom level

    if (this.state.podZoomLevel > 1) {
      imgEl.style.cursor = "grabbing"; // Will change to grab when not dragging
    } else {
      imgEl.style.cursor = "zoom-in";
    }
  }

  //  Handle drag start

  _handlePodDragStart(event, imgEl) {
    //  Only allow dragging when zoomed in

    if (this.state.podZoomLevel <= 1) return;

    this.state.podIsDragging = true;
    this.state.podDragStartX = event.clientX - this.state.podImageOffsetX;
    this.state.podDragStartY = event.clientY - this.state.podImageOffsetY;
    //  Reset velocity tracking

    this.state.podVelocityX = 0;
    this.state.podVelocityY = 0;
    this.state._lastDragTime = 0;
    this.state._lastDragX = 0;
    this.state._lastDragY = 0;
    //  Cancel any existing reset animation

    if (this.state.podResetAnimationFrame !== null) {
      cancelAnimationFrame(this.state.podResetAnimationFrame);
      this.state.podResetAnimationFrame = null;
    }
    //  Cancel any momentum animation

    if (this.state.podMomentumAnimationFrame !== null) {
      cancelAnimationFrame(this.state.podMomentumAnimationFrame);
      this.state.podMomentumAnimationFrame = null;
    }
    imgEl.style.cursor = "grabbing";
  }

  //  Handle drag move

  _handlePodDragMove(event, imgEl) {
    if (!this.state.podIsDragging) return;

    event.preventDefault();

    //  Calculate new offset based on drag movement

    let newOffsetX = event.clientX - this.state.podDragStartX;
    let newOffsetY = event.clientY - this.state.podDragStartY;

    //  Calculate velocity (pixels per millisecond)

    const now = performance.now();
    if (
      this.state._lastDragTime &&
      this.state._lastDragX !== undefined &&
      this.state._lastDragY !== undefined
    ) {
      const timeDelta = now - this.state._lastDragTime;
      if (timeDelta > 0) {
        this.state.podVelocityX =
          (event.clientX - this.state._lastDragX) / timeDelta;
        this.state.podVelocityY =
          (event.clientY - this.state._lastDragY) / timeDelta;
      }
    }
    this.state._lastDragTime = now;
    this.state._lastDragX = event.clientX;
    this.state._lastDragY = event.clientY;

    //  Apply boundary constraints if we have calculated them

    if (
      this.state.podMaxOffsetX !== undefined &&
      this.state.podMaxOffsetY !== undefined
    ) {
      newOffsetX = Math.max(
        -this.state.podMaxOffsetX,
        Math.min(this.state.podMaxOffsetX, newOffsetX),
      );
      newOffsetY = Math.max(
        -this.state.podMaxOffsetY,
        Math.min(this.state.podMaxOffsetY, newOffsetY),
      );
    }

    this.state.podImageOffsetX = newOffsetX;
    this.state.podImageOffsetY = newOffsetY;

    //  Apply transform with current offset and zoom

    imgEl.style.transform = `translate(${this.state.podImageOffsetX}px, ${this.state.podImageOffsetY}px) scale(${this.state.podZoomLevel})`;
  }

  //  Handle drag end

  _handlePodDragEnd(imgEl) {
    if (this.state.podIsDragging) {
      this.state.podIsDragging = false;
      //  Update cursor based on zoom level when not dragging

      if (this.state.podZoomLevel > 1) {
        imgEl.style.cursor = "grab";
      } else {
        imgEl.style.cursor = "zoom-in";
      }

      //  Start spring-back animation to center

      this._startPodResetAnimation(imgEl);
    }
  }

  //  Start spring-back animation for POD image

  _startPodResetAnimation(imgEl) {
    //  Cancel any existing reset animation

    if (this.state.podResetAnimationFrame !== null) {
      cancelAnimationFrame(this.state.podResetAnimationFrame);
    }
    //  Also cancel any momentum animation (if any) - though we removed momentum functions

    if (this.state.podMomentumAnimationFrame !== null) {
      cancelAnimationFrame(this.state.podMomentumAnimationFrame);
      this.state.podMomentumAnimationFrame = null;
    }

    //  Start the reset animation

    this.state.podResetAnimationFrame = requestAnimationFrame((timestamp) => {
      this._runPodResetAnimation(timestamp, imgEl);
    });
  }

  //  Run spring-back animation for POD image dragging

  _runPodResetAnimation(timestamp, imgEl) {
    if (!this.state.podIsDragging) {
      const targetX = 0;
      const targetY = 0;
      const currentX = this.state.podImageOffsetX;
      const currentY = this.state.podImageOffsetY;

      //  Spring damping ratio

      const damping = 0.2; // adjust for feel (0.1-0.3)
      const stiffness = 0.1; // adjust for speed (0.05-0.2)

      //  Calculate spring force

      const forceX = stiffness * (targetX - currentX);
      const forceY = stiffness * (targetY - currentY);

      //  Apply force to velocity (simple integration)

      this.state.podVelocityX += forceX;
      this.state.podVelocityY += forceY;

      //  Apply damping

      this.state.podVelocityX *= damping;
      this.state.podVelocityY *= damping;

      //  Update position

      let newOffsetX = currentX + this.state.podVelocityX;
      let newOffsetY = currentY + this.state.podVelocityY;

      //  Apply boundary constraints (optional while settling)

      if (
        this.state.podMaxOffsetX !== undefined &&
        this.state.podMaxOffsetY !== undefined
      ) {
        newOffsetX = Math.max(
          -this.state.podMaxOffsetX,
          Math.min(this.state.podMaxOffsetX, newOffsetX),
        );
        newOffsetY = Math.max(
          -this.state.podMaxOffsetY,
          Math.min(this.state.podMaxOffsetY, newOffsetY),
        );
      }

      this.state.podImageOffsetX = newOffsetX;
      this.state.podImageOffsetY = newOffsetY;

      //  Apply transform with current offset and zoom

      imgEl.style.transform = `translate(${this.state.podImageOffsetX}px, ${this.state.podImageOffsetY}px) scale(${this.state.podZoomLevel})`;

      //  Check if settled (small velocity and close to target)

      const distanceFromTarget = Math.sqrt(
        (newOffsetX - targetX) ** 2 + (newOffsetY - targetY) ** 2,
      );
      const speed = Math.sqrt(
        this.state.podVelocityX ** 2 + this.state.podVelocityY ** 2,
      );
      if (distanceFromTarget < 0.5 && speed < 0.1) {
        //  Snap exactly to target and end animation

        this.state.podImageOffsetX = targetX;
        this.state.podImageOffsetY = targetY;
        imgEl.style.transform = `translate(${targetX}px, ${targetY}px) scale(${this.state.podZoomLevel})`;
        this.state.podResetAnimationFrame = null;
      } else {
        //  Continue animation

        this.state.podResetAnimationFrame = requestAnimationFrame(
          (timestamp) => {
            this._runPodResetAnimation(timestamp, imgEl);
          },
        );
      }
    }
  }

  //  Handle double-click to toggle zoom

  _handlePodDoubleClick(imgEl) {
    //  Toggle between zoom level 1 and 2

    if (this.state.podZoomLevel === 1) {
      this.state.podZoomLevel = 2;
      imgEl.style.cursor = "grab";
    } else {
      this.state.podZoomLevel = 1;
      this.state.podImageOffsetX = 0;
      this.state.podImageOffsetY = 0;
      imgEl.style.cursor = "zoom-in";
    }

    //  Apply transform with zoom and current offset

    imgEl.style.transform = `translate(${this.state.podImageOffsetX}px, ${this.state.podImageOffsetY}px) scale(${this.state.podZoomLevel})`;

    //  Recalculate max offsets after zoom change

    if (imgEl.complete) {
      this._calculatePodMaxOffsets(imgEl);
    }
  }

  //  Calculate maximum pan offsets for the POD image based on current zoom level

  _calculatePodMaxOffsets(imgEl) {
    if (!imgEl || !imgEl.parentElement) return;

    const imgWidth = imgEl.naturalWidth;
    const imgHeight = imgEl.naturalHeight;
    const containerWidth = imgEl.parentElement.clientWidth;
    const containerHeight = imgEl.parentElement.clientHeight;

    //  Calculate max offset where image edge aligns with container edge

    //  Formula: maxOffset = (imageSize * zoomLevel - containerSize) / 2

    const maxOffsetX =
      (imgWidth * this.state.podZoomLevel - containerWidth) / 2;
    const maxOffsetY =
      (imgHeight * this.state.podZoomLevel - containerHeight) / 2;

    //  Ensure we don't have negative offsets (when image is smaller than container)

    this.state.podMaxOffsetX = Math.max(0, maxOffsetX);
    this.state.podMaxOffsetY = Math.max(0, maxOffsetY);
  }

  //  Toggle zoom on POD image (maintained for backward compatibility)

  togglePodZoom() {
    const img = document.getElementById("podPreviewImg");
    if (!img) return;

    //  Toggle between zoom level 1 and 2

    if (this.state.podZoomLevel === 1) {
      this.state.podZoomLevel = 2;
      img.style.cursor = "grab";
    } else {
      this.state.podZoomLevel = 1;
      this.state.podImageOffsetX = 0;
      this.state.podImageOffsetY = 0;
      img.style.cursor = "zoom-in";
    }

    //  Apply transform with zoom and current offset

    img.style.transform = `translate(${this.state.podImageOffsetX}px, ${this.state.podImageOffsetY}px) scale(${this.state.podZoomLevel})`;

    //  Recalculate max offsets after zoom change

    if (img.complete) {
      this._calculatePodMaxOffsets(img);
    }
  }

  //  Guard Signature Preview

  openGuardSigPreview(obdNumber) {
    const key = this._currentDispatchKey;
    if (!key) {
      return;
    }
    const asgn = this.state.sapAssignments[key];
    const match = asgn?.lineItems?.find((li) => li.obdNumber === obdNumber);
    const guardSignatureBase64 =
      match?.guardSignatureBase64 || asgn?.guardSignatureBase64;
    const guardSignatureTimestamp =
      match?.guardSignatureTimestamp ||
      asgn?.guardSignatureTimestamp ||
      match?.updatedAt ||
      asgn?.updatedAt;

    if (!guardSignatureBase64 || guardSignatureBase64.length < 50) {
      return;
    }

    let modal = document.getElementById("guardPreviewModal");
    if (modal) {
      //  Ensure existing modal has correct z-index

      if (modal.className && !modal.className.includes("z-[99999]")) {
        modal.className = modal.className.replace(/z-\[[0-9]+\]/, "z-[99999]");
        if (!modal.className.includes("z-[99999]")) {
          modal.className += " z-[99999]";
        }
      }
    } else {
      //  Create new modal

      modal = document.createElement("div");
      modal.id = "guardPreviewModal";
      modal.className =
        "fixed inset-0 bg-black/80 flex items-center justify-center z-[99999] hidden";
      modal.innerHTML = `
                <div class="bg-db-panel text-db-text border border-db-border rounded-xl shadow-2xl w-[95vw] sm:w-[90vw] max-w-2xl mx-4 p-4 relative">
                    <button onclick="window.dashboard.closeGuardSigPreview()" class="absolute top-2 right-3 text-db-text3 hover:text-db-text text-2xl font-bold">&times;</button>
                    <h2 class="text-lg font-bold text-db-text mb-3">Guard Signature <span class="text-xs text-db-text3">(OBD: ${obdNumber})</span></h2>
                    <div class="text-sm text-db-text2 mb-1">Security Guard: <span id="guardSignatureGuardName" class="text-db-text font-medium">&mdash;</span></div>
                    <div class="text-sm text-db-text2 mb-1">Captured at: <span id="guardSignatureCapturedTimestamp">&mdash;</span></div>
                    <div class="text-sm text-db-text2 mb-2">Verified at: <span id="guardSignatureTimestamp">&mdash;</span></div>
                    <div id="guardPreviewContainer" class="bg-white rounded-lg p-4 min-h-[300px] flex items-center justify-center"></div>
                </div>
            `;
      document.body.appendChild(modal);
    }
    //  Hide POD modal when opening guard signature

    const podModal = document.getElementById("podPreviewModal");
    if (podModal) {
      podModal.classList.add("hidden");
      podModal.classList.remove("flex");
    }

    //  Set guard name

    const guardNameSpan = document.getElementById("guardSignatureGuardName");
    if (guardNameSpan) {
      const guardFn = (
        match?.guardFirstName ||
        asgn?.guardFirstName ||
        ""
      ).trim();
      const guardLn = (
        match?.guardLastName ||
        asgn?.guardLastName ||
        ""
      ).trim();
      const guardMi = (match?.guardMI || asgn?.guardMI || "").trim();
      const fullGuardName =
        `${guardFn}${guardMi ? " " + guardMi : ""} ${guardLn}`
          .replace(/\s+/g, " ")
          .trim();
      guardNameSpan.textContent =
        fullGuardName || asgn?.guardName || match?.guardName || "—";
    }

    //  Determine timestamps

    const capturedTimestamp = match?.podCapturedAt ?? guardSignatureTimestamp;
    const verifiedTimestamp = guardSignatureTimestamp ?? match?.podCapturedAt;

    //  Set captured timestamp

    const capturedSpan = document.getElementById(
      "guardSignatureCapturedTimestamp",
    );
    if (capturedSpan) {
      if (capturedTimestamp) {
        let date;
        if (capturedTimestamp?.toDate) {
          date = capturedTimestamp.toDate();
        } else if (
          typeof capturedTimestamp === "object" &&
          capturedTimestamp !== null &&
          Object.prototype.hasOwnProperty.call(capturedTimestamp, "seconds")
        ) {
          //  Legacy serialized timestamp shape.

          date = new Date(
            capturedTimestamp.seconds * 1000 +
              capturedTimestamp.nanoseconds / 1000000,
          );
        } else {
          date = new Date(capturedTimestamp);
        }
        capturedSpan.textContent = date.toLocaleString();
      } else {
        capturedSpan.textContent = "—";
      }
    }

    //  Set guard signature timestamp

    const timestampSpan = document.getElementById("guardSignatureTimestamp");
    if (timestampSpan) {
      if (verifiedTimestamp) {
        let date;
        if (verifiedTimestamp?.toDate) {
          date = verifiedTimestamp.toDate();
        } else if (
          typeof verifiedTimestamp === "object" &&
          verifiedTimestamp !== null &&
          Object.prototype.hasOwnProperty.call(verifiedTimestamp, "seconds")
        ) {
          //  Legacy serialized timestamp shape.

          date = new Date(
            verifiedTimestamp.seconds * 1000 +
              verifiedTimestamp.nanoseconds / 1000000,
          );
        } else {
          date = new Date(verifiedTimestamp);
        }
        timestampSpan.textContent = date.toLocaleString();
      } else {
        timestampSpan.textContent = "—";
      }
    }

    const container = document.getElementById("guardPreviewContainer");
    container.innerHTML = "";

    const img = document.createElement("img");
    img.src = "data:image/png;base64," + guardSignatureBase64;
    img.className = "max-w-full max-h-[500px] rounded";
    img.style.objectFit = "contain";

    img.onload = () => {
      container.appendChild(img);
    };

    img.onerror = (error) => {
      container.innerHTML =
        '<div class="text-red-400 p-4">Failed to load guard signature image</div>';
    };

    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  closeGuardSigPreview() {
    const modal = document.getElementById("guardPreviewModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
    //  Show POD modal after closing guard

    const podModal = document.getElementById("podPreviewModal");
    if (podModal) {
      podModal.classList.remove("hidden");
      podModal.classList.add("flex");
    }
  }

  _parseSAPTime(pt) {
    if (!pt || !pt.startsWith("PT")) return "—";
    const h = parseInt(pt.match(/(\d+)H/)?.[1] || 0);
    const m = parseInt(pt.match(/(\d+)M/)?.[1] || 0);
    if (!h && !m) return "—";
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  //  getAvailableDrivers: fetches queue + assigned drivers, merges and sorts by FIFO

  //  Supports multiple shipments: drivers with active assignments can still receive more.

  _getAssignedDriverIds() {
    const assignedIds = new Set();
    const assignments = this.state.sapAssignments;
    for (const asgn of Object.values(assignments)) {
      if (asgn.driverId) assignedIds.add(asgn.driverId);
    }
    return assignedIds;
  }

  _getDriverEntryTime(d) {
    if (d && d.entryTime && typeof d.entryTime.toDate === "function")
      return d.entryTime.toDate();
    if (d && d.joinedAt && typeof d.joinedAt.toDate === "function")
      return d.joinedAt.toDate();
    if (d && d.updatedAt) return new Date(d.updatedAt);
    return new Date(0);
  }

  //  Format SAP delivery date string into human-readable display

  //  Handles TWO SAP OData formats:

  //  /Date(1781481600000)/ —" SAP OData milliseconds format

  //  2026-05-18T00:00:00 —" ISO 8601 date+time string

  //  Output: "Jul 10, 2026 12:00 AM" —" always shows time (even 00:00:00 †’ 12:00 AM)

  //  Uses local PH time (en-PH locale = Asia/Manila UTC+8).

  _formatDelDateDisplay(sapDate) {
    if (!sapDate) return "—";
    const s = sapDate + "";

    let d;
    if (s.includes("/Date(")) {
      //  /Date(1781481600000)/ —" SAP OData milliseconds, always UTC

      const msStr = s.replace("/Date(", "").replace(")/", "");
      const ms = parseInt(msStr);
      if (isNaN(ms)) return "—";
      d = new Date(ms);
    } else if (s.includes("T")) {
      //  2026-05-18T00:00:00 —" SAP OData ISO 8601 string.

      //  new Date() parses T00:00:00 as UTC midnight.

      //  toLocaleString("en-PH") then converts to PH local time (UTC+8) = 08:00 AM.

      //  This is correct: SAP UTC midnight †’ 8:00 AM PH displayed.

      d = new Date(s);
      if (isNaN(d.getTime())) return "—";
    } else {
      return "—";
    }

    const dateStr = d.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const timeStr = d.toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return `${dateStr} ${timeStr}`;
  }

  //  Normalize SAP delivery dates to the format expected by SAP OData.

  //  Handles: /Date(1781481600000)/ —" already in milliseconds format, passes through

  //  2026-05-18T00:00:00 —" ISO 8601, converted to milliseconds

  //  Returns null if value is null, undefined, or unparseable.

  _normalizeDelDate(sapDate) {
    if (!sapDate) return null;
    const s = sapDate + "";
    if (s.includes("/Date(")) {
      //  Already /Date(MS)/ format —" validate and return as-is

      const msStr = s.replace("/Date(", "").replace(")/", "");
      const ms = parseInt(msStr);
      return isNaN(ms) ? null : s;
    }
    if (s.includes("T")) {
      //  ISO 8601 string —" parse and convert to milliseconds

      const d = new Date(s);
      if (isNaN(d.getTime())) return null;
      return `/Date(${d.getTime()})/`;
    }
    return null;
  }

  //  Backward alias

  _parseDelDateTime(sapDate) {
    return this._formatDelDateDisplay(sapDate);
  }

  _getAvailableDrivers(requiredTruckType) {
 //  Normalize truck-type strings for comparison

    //  Examples that should all match:

    //  "AUV", "auv", "Auv." †’ "auv"

    //  "6-Wheel Tractor" †’ "6wheeltractor"

    //  "Closed Van" †’ "closedvan"

    const norm = (s) =>
      (s || "")
        .replace(/\./g, "") // drop periods (e.g., "Tractor.")
        .replace(/-/g, "") // drop dashes (e.g., "6-Wheel")
        .replace(/\s+/g, " ") // collapse whitespace
        .toLowerCase()
        .trim();

    //  The dispatch requires a specific truck type. A driver row is

    //  shown only when their truck type — if known — matches that

    //  requirement. Unknown / empty truck type is REJECTED (we used

    //  to let it pass through, which caused the server to later

    //  reject the assignment with "Driver is no longer in the queue"

    //  because the driver wasn't actually eligible). The only

    //  exception is when no truck type is required on the dispatch.

    const required = (requiredTruckType || "").trim();
    const truckMatch = (d) => {
      if (!required) return true;
      const dt = (d.truckType || "").trim();
      if (!dt) return false; // unknown truck type †’ reject
      return norm(dt) === norm(required);
    };

    //  1. Queue drivers eligible for FIRST assignment (not yet assigned)

    //  Eligibility is scoped to the current QR queue session. A prior

    //  completed session must not hide a newly scanned waiting driver.

    //  queue entries carry BOTH a doc id (`d.id`) and an Auth UID

    //  (`d.driverId`). The driverId is the canonical key the rest of the

    //  system uses to refer to a driver (see commit 8472e4d).

    const assignments = this.state.sapAssignments;
    const PRE_TRANSIT_ASSIGNABLE_STATUSES = new Set([
      "assigned",
      "loading",
      "loaded",
      "fully_loaded",
    ]);
    const ACTIVE_TRIP_STATUSES = new Set(["in_transit", "returning_to_base"]);
    const COMPLETED_TRIP_STATUSES = new Set(["completed", "complete"]);
    const assignmentsByDriver = new Map();
    const activeDriverIds = new Set();
    for (const asgn of Object.values(assignments)) {
      if (!asgn || !asgn.driverId) continue;
      const status = (asgn.tripStatus || "").toLowerCase().trim();
      const driverAssignments = assignmentsByDriver.get(asgn.driverId) || [];
      driverAssignments.push({ ...asgn, _status: status });
      assignmentsByDriver.set(asgn.driverId, driverAssignments);
      if (ACTIVE_TRIP_STATUSES.has(status)) activeDriverIds.add(asgn.driverId);
    }
    const queueStatus = (d) => (d.status || "").toLowerCase().trim();
    const queueHasDispatch = (queueEntry, dispatchKey) =>
      queueEntry.assignedShipment === dispatchKey ||
      (Array.isArray(queueEntry.assignedShipments) &&
        queueEntry.assignedShipments.some(
          (item) =>
            (typeof item === "string" ? item : item?.dispatchKey) ===
            dispatchKey,
        ));
    const queueDrivers = this.state.queue.filter((d) => {
      const status = queueStatus(d);
      const driverId = d.driverId || d.id;
      const driverHistory = assignmentsByDriver.get(driverId) || [];
      const currentSession = driverHistory.filter(
        (asgn) => asgn.queueId === d.id,
      );
      const anotherOpenSession = driverHistory.some(
        (asgn) =>
          asgn.queueId !== d.id &&
          (PRE_TRANSIT_ASSIGNABLE_STATUSES.has(asgn._status) ||
            ACTIVE_TRIP_STATUSES.has(asgn._status)),
      );

      return (
        !d.isAssigned &&
        d.registrationComplete !== false &&
        ["waiting", "available"].includes(status) &&
        currentSession.length === 0 &&
        !activeDriverIds.has(driverId) &&
        !anotherOpenSession &&
        truckMatch(d)
      );
    });

    //  2. Build assigned-driver records from sap_assignments —"

    //  One record per driverId, tied to its eligible QR queue session.

    //  Completed history cannot create an Assigned row by itself.

    //  FIFO uses the current queue entry's check-in time.

    //  Fullness: a driver with driverDeclaredFull: true in ANY assignment is flagged full.

    //  (Reuses `assignments` declared above for the queue-invalidation set.)

    const driverAssignments = {}; // driverId †’ merged driver record

    for (const [dispatchKey, asgn] of Object.entries(assignments)) {
      const dId = asgn?.driverId;
      if (!dId) continue;
      const assignmentStatus = (asgn.tripStatus || "").toLowerCase().trim();
      if (!PRE_TRANSIT_ASSIGNABLE_STATUSES.has(assignmentStatus)) continue;
      const queueEntry = this.state.queue.find(
        (q) =>
          (q.driverId || q.id) === dId &&
          q.registrationComplete !== false &&
          [
            "waiting",
            "available",
            "assigned",
            "loading",
            "loaded",
            "fully_loaded",
          ].includes(queueStatus(q)) &&
          (asgn.queueId === q.id ||
            (!asgn.queueId &&
              q.isAssigned === true &&
              queueHasDispatch(q, dispatchKey))),
      );
      if (!queueEntry) continue;
      const driver = this.state.drivers.find((drv) => drv.id === dId) || {};
      //  Truck type can live on the queue entry, the drivers doc,

      //  OR the most recent sap_assignments doc (which the server

      //  writes when a driver is assigned — see controller line

      //  `truckType,`). All three are valid sources; pick the first

      //  one that's actually populated so an already-assigned driver

      //  still resolves when their queue entry was wiped or their

      //  drivers doc never had a truckType.

      const driverTruckType =
        queueEntry?.truckType || driver?.truckType || asgn?.truckType || "";
      if (window.__SYSU_DEBUG_TRUCKTYPE__) {
        const source = queueEntry?.truckType
          ? "queue"
          : driver?.truckType
            ? "drivers"
            : asgn?.truckType
              ? "asgn"
              : "none";
      }

      if (!driverAssignments[dId]) {
        //  First time —" initialise with queue check-in time (primary FIFO key)

        driverAssignments[dId] = {
          id: dId,
          driverName:
            asgn.driverName || queueEntry?.driverName || driver?.name || "—",
          plateNumber:
            asgn.truckPlate ||
            queueEntry?.plateNumber ||
            driver?.plateNumber ||
            "—",
          truckType: driverTruckType,
          truckCompany:
            asgn.truckCompany ||
            queueEntry?.truckCompany ||
            driver?.truckingCompany ||
            driver?.company ||
            "—",
          entryTime: queueEntry?.entryTime || asgn.assignedAt || null,
          driverId: dId,
          isFull: queueEntry.isFull === true,
          _queueId: queueEntry.id,
          _queueIds: new Set([queueEntry.id]),
          _fromAssignment: true,
          _latestAssignment: dispatchKey,
          _driverDeclaredFull: !!asgn.driverDeclaredFull,
        };
      } else {
        driverAssignments[dId]._queueIds.add(queueEntry.id);
        //  Already seen —" update FIFO key to whichever is earlier

        if (!queueEntry?.entryTime && asgn.assignedAt) {
          const existingTime = driverAssignments[dId].entryTime;
          const existingDate = existingTime?.toDate
            ? existingTime.toDate()
            : existingTime;
          const newDate = asgn.assignedAt?.toDate
            ? asgn.assignedAt.toDate()
            : asgn.assignedAt;
          if (!existingDate || (newDate && newDate < existingDate)) {
            driverAssignments[dId].entryTime = asgn.assignedAt;
          }
        }
        //  Prefer queue entry if it now exists (trumps any asgn.assignedAt)

        if (queueEntry?.entryTime) {
          driverAssignments[dId].entryTime = queueEntry.entryTime;
        }
        //  Propagate FULL flag if any assignment says full

        if (asgn.driverDeclaredFull === true) {
          driverAssignments[dId]._driverDeclaredFull = true;
        }
        if (queueEntry.isFull === true) driverAssignments[dId].isFull = true;
      }
    }

    //  A driver may take multiple dispatches in the same queue session until

    //  the first shipment starts in_transit. Returning to base remains busy.

    //  A new QR scan creates a new queue session; completed history from an

    //  older session must not turn that new queue entry into an Assigned row.

    //

    //  Pre-transit states stay eligible for more dispatches in this session.

    //  The active set contains only in_transit and returning_to_base.

    //

    //  We reuse the precomputed `activeDriverIds` Set (built above for the

    //  queue-invalidation filter). O(1) lookup per assigned driver.

    const assignedDrivers = Object.values(driverAssignments)
      .filter((d) => d._queueIds.size === 1 && truckMatch(d))
      .map((d) => {
        //  Collect every tripStatus this driver currently has across

        //  their assignments.

        const queueEntry = this.state.queue.find((q) => q.id === d._queueId);
        const queueTripStatus = queueStatus(queueEntry || {});
        const hasActiveLoad =
          activeDriverIds.has(d.id) ||
          ACTIVE_TRIP_STATUSES.has(queueTripStatus);
        const currentSessionAssignments = Object.entries(assignments)
          .filter(
            ([dispatchKey, asgn]) =>
              asgn?.driverId === d.id &&
              (asgn.queueId === queueEntry.id ||
                (!asgn.queueId &&
                  queueEntry.isAssigned === true &&
                  queueHasDispatch(queueEntry, dispatchKey))),
          )
          .map(([, asgn]) => asgn);
        const hasSelectableAssignment = currentSessionAssignments.some((asgn) =>
          PRE_TRANSIT_ASSIGNABLE_STATUSES.has(
            (asgn.tripStatus || "").toLowerCase().trim(),
          ),
        );
        const sessionCompleted =
          currentSessionAssignments.length > 0 &&
          currentSessionAssignments.every((asgn) =>
            COMPLETED_TRIP_STATUSES.has(
              (asgn.tripStatus || "").toLowerCase().trim(),
            ),
          );
        return {
          ...d,
          _hasActiveLoad: hasActiveLoad,
          _sessionCompleted: sessionCompleted,
          _hasSelectableAssignment: hasSelectableAssignment,
        };
      });

    //  Pre-transit assignments in the current queue session remain selectable.

    const availableAssigned = assignedDrivers.filter((d) => {
      const queueEntry = this.state.queue.find((q) => q.id === d._queueId);
      const queueEntryIsUnassigned =
        queueEntry &&
        !queueEntry.isAssigned &&
        ["waiting", "available"].includes(queueStatus(queueEntry));
      return (
        !d._hasActiveLoad &&
        !d._sessionCompleted &&
        d._hasSelectableAssignment &&
        !queueEntryIsUnassigned
      );
    });

    //  3. Merge —" queue first, then assigned-only drivers

 //  3. Merge — queue first, then assigned drivers (busy drivers DROPPED)

    //  Once a driver is in transit or returning to base, they are removed

    //  from the modal. The server enforces the same DRIVER_ON_ACTIVE_LOAD

    //  gate, so the modal must mirror that to keep UI and server in sync.

    const queuedIds = new Set(queueDrivers.map((d) => d.id));
    const extraAssigned = availableAssigned.filter((d) => !queuedIds.has(d.id));
    const allDrivers = [...queueDrivers, ...extraAssigned];

    //  4. FIFO sort —" earliest check-in first

    allDrivers.sort((a, b) => {
      const ta = this._getDriverEntryTime(a);
      const tb = this._getDriverEntryTime(b);
      return ta - tb;
    });

    //  5. Derive display fields and return

    return allDrivers.map((d) => {
      let phone = d.phone || d.driverPhone || "";
      if (!phone) {
        const match = this.state.drivers.find(
          (x) =>
            x.name &&
            (x.name + "").toLowerCase().trim() ===
              (d.driverName || "").toLowerCase().trim(),
        );
        if (match) phone = match.phone || "";
      }
      //  Look up isFull from driver doc —" queue entries don't have it directly

      const drv =
        this.state.drivers.find((x) => x.id === (d.driverId || d.id)) ||
        this.state.drivers.find(
          (x) =>
            (x.name || "").toLowerCase().trim() ===
            (d.driverName || "").toLowerCase().trim(),
        );
      const isFull =
        drv?.isFull === true ||
        d.isFull === true ||
        d._driverDeclaredFull === true;
      return {
        ...d,
        id: d._queueId || d.id,
        driverName: queueDriverDisplayName(d, this.state.drivers),
        _lookupPhone: phone,
        _isFull: isFull,
        _fromAssignment: !!d._queueId,
      };
    });
  }

  openAssignModal(dispatchKey, truckType) {
    dispatchKey = decodeURIComponent(dispatchKey);
    truckType = decodeURIComponent(truckType || "");
    this.state.assignTarget = dispatchKey;
    this.state.requiredTruckType = truckType;
    this.state.selectedQueueDriverId = null;

    const modal = document.getElementById("assignDriverModal");
    const dispatchNumEl = document.getElementById("assignModalDispatchNum");
    const truckTypeEl = document.getElementById("assignModalTruckType");
    const listEl = document.getElementById("assignModalDriverList");
    const confirmBtn = document.getElementById("assignConfirmBtn");
    if (!modal) return;

 //  Resume override state after page refresh

    //  If the dispatcher submitted an override, refreshed, then came back,

    //  the in-memory state is gone. We query the authenticated SQL-backed

    //  dispatch API and restore an unexpired

    //  approved token so the modal opens already unlocked.

    this._resumeApprovedOverride(dispatchKey).catch((err) =>
      console.error("[bypass] resumeApprovedOverride failed:", err),
    );
    //  Also ensure the admin-queue snapshot is live so that an approval

    //  landing while the modal is open drives the unlock immediately,

    //  without waiting for the Documents tab to be visited.

    this._ensureAdminQueueSubscriptions();

    dispatchNumEl.textContent = dispatchKey;
    truckTypeEl.textContent = truckType || "ANY";
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Select a driver";
      confirmBtn.classList.add("opacity-50", "cursor-not-allowed");
    }

    const submitBtn = document.getElementById("requestOverrideSubmit");
    if (submitBtn) submitBtn.onclick = () => this._submitBypass();
    const cancelBtn = document.getElementById("requestOverrideCancel");
    if (cancelBtn) cancelBtn.onclick = () => this._cancelBypassPanel();
    const overridePanel = document.getElementById("requestOverridePanel");
    if (overridePanel) overridePanel.classList.add("hidden");
    const overrideSelect = document.getElementById("requestOverrideReason");
    if (overrideSelect) overrideSelect.value = "";

    //  Multiple shipment: include both queued and already-assigned drivers

    //  Drivers with active assignments can still receive more shipments.

    //  Sort all by FIFO entryTime so earliest driver appears first.

    const availableDrivers = this._getAvailableDrivers(truckType);
    this.state._modalAvailableDrivers = availableDrivers;

    //  Separate into Queue vs Assigned groups (FIFO already sort-applied)

    const queueDrivers = availableDrivers.filter((d) => !d._fromAssignment);
    const assignedDrivers = availableDrivers.filter((d) => d._fromAssignment);
    this.state._modalQueueCount = queueDrivers.length;
    this.state._modalAssignedCount = assignedDrivers.length;
    this.state._modalQueueEarliestId = queueDrivers[0]?.id || null;
    this.state._modalAssignedEarliestId = assignedDrivers[0]?.id || null;

    if (availableDrivers.length === 0) {
      const unavailable =
        this.state.queueLoadError || this.state.assignmentsLoadError;
      const stillLoading =
        this.state.queueLoading || this.state.assignmentsLoading;
      listEl.innerHTML = unavailable
        ? `<div role="alert" class="p-8 text-center"><p class="text-sm font-semibold text-db-text2">Driver availability could not be loaded.</p><p class="mt-2 text-xs text-db-text3">Check your connection, then close and reopen assignment.</p></div>`
        : stillLoading
          ? `<div role="status" class="p-8 text-center text-sm text-db-text3">Driver availability is still loading. Please try again shortly.</div>`
          : `<div role="status" class="p-8 text-center"><p class="text-sm font-semibold text-db-text2">No available drivers for this shipment.</p><p class="mt-2 text-xs text-db-text3">No queued or eligible assigned drivers match the ${escapeHtml(truckType || "required")} truck type.</p></div>`;
    } else {
      //  Tab bar

      //  Default to 'queue' tab; each tab filters rows by data-group

      const tabBar = `
                <div class="flex gap-2 px-4 pt-3 pb-2 border-b border-db-border shrink-0">
                    <button class="tab-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all border"
                            data-tab="queue"
                            style="background:#dc2626;color:#fff;border-color:#dc2626;">
                        Queue
                        <span class="bg-white/20 text-white text-[10px] font-mono px-1.5 py-0.5 rounded-full">${queueDrivers.length}</span>
                    </button>
                    <button class="tab-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all border bg-db-bg/60 text-db-text3 border-db-border hover:bg-db-item-hover"
                            data-tab="assigned">
                        Assigned
                        <span class="bg-db-border text-db-text3 text-[10px] font-mono px-1.5 py-0.5 rounded-full">${assignedDrivers.length}</span>
                    </button>
                </div>`;

      //  Pre-map each group with its own per-group position number

      const queueRows = queueDrivers.map((d, i) => ({
        ...d,
        _groupPos: i + 1,
        _groupTotal: queueDrivers.length,
      }));
      const assignedRows = assignedDrivers.map((d, i) => ({
        ...d,
        _groupPos: i + 1,
        _groupTotal: assignedDrivers.length,
      }));

      //  FIFO lock applies ONLY to the Queue tab. Each tab has its own

      //  "earliest" driver — queue-earliest for Queue rows (locked),

      //  and assigned-earliest for Assigned rows (visual cue only).

      //  Per updated product rule: Assigned rows are NOT FIFO-locked;

      //  the dispatcher may pick any assigned driver directly because

      //  they are already past the queue gate.

      const queueEarliestId = queueDrivers[0]?.id;
      const assignedEarliestId = assignedDrivers[0]?.id;
      //  Helper: classes for the earliest (FIFO-next) row.

      //  The css keyframe + halo style are already defined in src/style/main.css

      //  (.driver-row.fifo-next).

      const fifoNextExtras = "fifo-next";
      listEl.innerHTML =
        tabBar +
        queueRows
          .map((d) => {
            const isQueueEarliest = d.id === queueEarliestId;
            return `
                <div class="driver-row p-4 border-b border-db-border ${isQueueEarliest ? "cursor-pointer hover:bg-db-item-hover" : "opacity-50 cursor-not-allowed"} transition-colors flex items-center justify-between ${isQueueEarliest ? fifoNextExtras : ""}"
                     data-id="${d.id}" data-group="queue" data-locked="${isQueueEarliest ? "0" : "1"}" data-earliest="${isQueueEarliest ? "1" : "0"}">
                    <div class="flex items-center gap-4">
                        <span class="text-[10px] font-mono text-db-text3">#${String(d._groupPos).padStart(2, "0")} / ${d._groupTotal}</span>
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-bold text-db-text">${escapeHtml(d.driverName || d.user?.name || "Unknown Driver")}</span>
                                ${isQueueEarliest ? '<span class="fifo-next-tag">Next</span>' : ""}
                                ${
                                  d._isFull
                                    ? `<span class="bg-red-600 text-white border border-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide inline-flex items-center gap-1">
                                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                    LOCKED
                                </span>`
                                    : ""
                                }
                            </div>
                            <span class="text-[11px] text-db-text3 font-mono">${escapeHtml(d.plateNumber || d.user?.plateNumber || "---")}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-[10px] text-db-text3 font-mono text-right">
                            ${d.entryTime ? new Date(d.entryTime.toDate()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "---"}
                        </div>
                        ${!isQueueEarliest ? `<button data-action="request-override" data-driver-id="${d.id}" class="row-override-btn text-[9px] font-bold uppercase tracking-wider text-sysu-gold border border-sysu-gold/40 bg-sysu-gold/10 hover:bg-sysu-gold/20 px-2 py-1 rounded transition-colors">Override</button>` : ""}
                    </div>
                </div>
            `;
          })
          .join("") +
        assignedRows
          .map((d) => {
            //  Active-route drivers are filtered out before this list is rendered.

            const isAssignedEarliest = d.id === assignedEarliestId;
            return `
                <div class="driver-row p-4 border-b border-db-border cursor-pointer hover:bg-db-item-hover transition-colors flex items-center justify-between"
                     data-id="${d.id}" data-group="assigned" data-locked="0" data-earliest="${isAssignedEarliest ? "1" : "0"}">
                    <div class="flex items-center gap-4">
                        <span class="text-[10px] font-mono text-db-text3">#${String(d._groupPos).padStart(2, "0")} / ${d._groupTotal}</span>
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-bold text-db-text">${escapeHtml(d.driverName || d.user?.name || "Unknown Driver")}</span>
                                ${isAssignedEarliest ? '<span class="bg-db-accent/15 text-db-accent border border-db-accent/40 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Earliest</span>' : ""}
                                ${
                                  d._isFull
                                    ? `<span class="bg-red-600 text-white border border-red-700 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide inline-flex items-center gap-1">
                                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                    LOCKED
                                </span>`
                                    : ""
                                }
                            </div>
                            <span class="text-[11px] text-db-text3 font-mono">${escapeHtml(d.plateNumber || d.user?.plateNumber || "---")}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-[10px] text-db-text3 font-mono text-right">
                            ${d.entryTime ? new Date(d.entryTime.toDate()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "---"}
                        </div>
                        <span class="text-[9px] text-db-accent opacity-60 font-mono">Assigned</span>
                    </div>
                </div>
                `;
          })
          .join("");

      //  Attach tab click handlers

      listEl.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.tab;
          //  Update button styles

          listEl.querySelectorAll(".tab-btn").forEach((b) => {
            if (b.dataset.tab === tab) {
              b.style.background = "#dc2626";
              b.style.color = "#fff";
              b.style.borderColor = "#dc2626";
              b.querySelector("span").className =
                "bg-white/20 text-white text-[10px] font-mono px-1.5 py-0.5 rounded-full";
            } else {
              b.style.background = "";
              b.style.color = "";
              b.style.borderColor = "";
              b.querySelector("span").className =
                "bg-db-border text-db-text3 text-[10px] font-mono px-1.5 py-0.5 rounded-full";
            }
          });
          //  Show / hide rows

          listEl.querySelectorAll(".driver-row").forEach((row) => {
            row.style.display = row.dataset.group === tab ? "" : "none";
          });
        });
      });

      //  Apply default: show queue tab

      listEl.querySelectorAll(".driver-row").forEach((row) => {
        row.style.display = row.dataset.group === "queue" ? "" : "none";
      });

      //  Click on driver row. Per updated product rule:

      //  Assigned rows are always selectable (no FIFO lock) — the

      //  driver is already past the queue gate, the only gate is

      //  the server's DRIVER_ON_ACTIVE_LOAD check.

      //  Queue rows: only the queue-earliest is clickable without

      //  an approved override token. Per-row "Override" button

      //  still starts the admin-approval flow.

      //  The server is the final gate for all of these.

      listEl.querySelectorAll(".driver-row").forEach((row) => {
        row.addEventListener("click", (evt) => {
          const target = evt.target.closest("[data-action]");
          if (target && target.dataset.action === "request-override") {
            evt.stopPropagation();
            this.selectDriver(row.dataset.id);
            this._requestBypass();
            return;
          }
          //  Assigned rows bypass FIFO — always selectable.

          if (row.dataset.group === "assigned") {
            this.selectDriver(row.dataset.id);
            return;
          }
          //  Queue rows: gated by queue-earliest + override token.

          if (
            row.dataset.id !== this.state._modalQueueEarliestId &&
            !this.state.overrideTokenId
          )
            return;
          this.selectDriver(row.dataset.id);
        });
      });
    }

    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  selectDriver(driverId) {
    this.state.selectedQueueDriverId = driverId;

    //  Check if selected driver is full †’ lock confirm button

    const drv = this.state._modalAvailableDrivers?.find(
      (d) => d.id === driverId,
    );
    const isFull = drv?._isFull === true;

    //  FIFO enforcement: only the queue-earliest driver may be confirmed

    //  without an approved override token. Per updated product rule,

    //  Assigned-tab drivers are NOT FIFO-gated — they may be picked

    //  directly because they are already past the queue gate.

    const queueEarliestId = this.state._modalQueueEarliestId;
    const isAssignedDriver = !!drv?._fromAssignment;
    const hasOverrideToken = !!this.state.overrideTokenId;
    const isQueueEarliest = !isAssignedDriver && driverId === queueEarliestId;
    const canConfirm =
      !isFull && (isAssignedDriver || isQueueEarliest || hasOverrideToken);

    const confirmBtn = document.getElementById("assignConfirmBtn");

    if (isFull) {
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Driver is at capacity";
        confirmBtn.classList.add("opacity-50", "cursor-not-allowed");
      }
    } else if (!canConfirm) {
      //  Non-earliest and no override token: lock confirm, show bypass.

      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Select the first driver";
        confirmBtn.classList.add("opacity-50", "cursor-not-allowed");
      }
    } else {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm Assignment";
        confirmBtn.classList.remove("opacity-50", "cursor-not-allowed");
      }
    }

    document.querySelectorAll(".driver-row").forEach((row) => {
      if (row.dataset.id === driverId) {
        row.classList.add("bg-sysu-red/10", "border-l-4", "border-l-sysu-red");
      } else {
        row.classList.remove(
          "bg-sysu-red/10",
          "border-l-4",
          "border-l-sysu-red",
        );
      }
    });
  }

  /**
   * Dispatcher-initiated cancel now requires admin approval. Mirrors the
   * override request flow: write a cancelRequests doc, lock the row,
   * poll until the admin approves or denies, then re-render.
   */
  async _cancelAssignment(dispatchKey, reason, selectEl, bodyEl) {
    //  bodyEl is whichever container the row lives in (ordersBody for the

    //  Confirmed Assignments card view, sapBody for the SAP table row).

    //  Defaults to ordersBody for backward compatibility.

    const containerEl = bodyEl || document.getElementById("ordersBody");
    //  Confirm before sending the request — once an admin approves, the

    //  assignment is gone.

    const ok = window.confirm(
      `Request cancellation of dispatch ${dispatchKey}?\n\n` +
        `An admin must approve before the assignment is rolled back.\n\n` +
        `Reason: ${reason}`,
    );
    if (!ok) {
      if (selectEl) selectEl.value = "";
      return;
    }
    try {
      if (selectEl) {
        selectEl.disabled = true;
        selectEl.classList.add("opacity-50", "cursor-not-allowed");
      }
      const result = await SAPAssignmentService.requestCancel({
        dispatchKey,
        reason,
      });
      const requestId = result && result.requestId;
      if (!requestId) {
        throw new Error("requestCancel returned no requestId");
      }
      //  Track per-row so re-renders don't lose the lock. The pending

      //  flag is stashed on whichever container the row lives in.

      if (containerEl) {
        containerEl.dataset["pendingCancel" + dispatchKey] = requestId;
      }
      this._showAssignBanner(
        "Cancel request sent — awaiting admin approval.",
        "info",
      );
      this._pollCancelRequest(dispatchKey, requestId);
    } catch (err) {
      console.error(
        "[cancelAssignment] request error:",
        err.code,
        err.message,
        err,
      );
      if (selectEl) {
        selectEl.disabled = false;
        selectEl.classList.remove("opacity-50", "cursor-not-allowed");
        selectEl.value = "";
      }
      this._notifyFailure(
        "assignment-cancel",
        err,
        "The cancellation request could not be sent. Check your connection and try again.",
      );
    }
  }

  _pollCancelRequest(dispatchKey, requestId) {
    const fetchOnce = async () => {
      try {
        const data = await SAPAssignmentService.getCancelRequest(requestId);
        this._cancelPollErrorNotified = false;
        if (!data) {
          //  The doc is gone — treat as terminal, re-render and stop.

          this._clearPendingCancel(dispatchKey);
          this._refreshBothViews();
          return;
        }
        if (data.status === "approved") {
          this._clearPendingCancel(dispatchKey);
          this._showAssignBanner(
            `Cancel for ${dispatchKey} approved — assignment rolled back.`,
            "success",
          );
          this._refreshBothViews();
          return;
        }
        if (data.status === "denied") {
          this._clearPendingCancel(dispatchKey);
          this._showAssignBanner(
            `Cancel for ${dispatchKey} denied by admin. Assignment stands.`,
            "error",
          );
          //  Re-enable the select so the dispatcher can re-pick.

          this._resetCancelSelect(dispatchKey);
          return;
        }
        if (data.status === "revoked") {
          this._clearPendingCancel(dispatchKey);
          this._showAssignBanner("Cancel request cancelled.", "info");
          this._resetCancelSelect(dispatchKey);
          return;
        }
        //  Still pending — poll again.

        setTimeout(fetchOnce, 3000);
      } catch (err) {
        console.error("[cancelAssignment] poll error:", err);
        if (err?.status === 404 || err?.code === "HTTP_404") {
          this._clearPendingCancel(dispatchKey);
          this._resetCancelSelect(dispatchKey);
          this._showAssignBanner(
            "Cancel request is no longer available.",
            "info",
          );
          this._refreshBothViews();
          return;
        }
        if (!this._cancelPollErrorNotified) {
          this._cancelPollErrorNotified = true;
          this._notifyFailure(
            "cancel-request-poll",
            err,
            "The approval status could not be refreshed. The system will keep retrying.",
          );
        }
        setTimeout(fetchOnce, 5000);
      }
    };
    fetchOnce();
  }

  _clearPendingCancel(dispatchKey) {
    //  Clear from both possible containers — the cancel row could live in

    //  either view.

    const ids = ["ordersBody", "sapBody"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) delete el.dataset["pendingCancel" + dispatchKey];
    }
  }

  /**
   * Re-render whichever view is currently visible. The cancel flow can
   * originate from either the Confirmed Assignments card view or the
   * SAP table row; the assignment subscription will refresh both, but
   * the visible table needs an explicit re-render so the user sees the
   * change immediately.
   */
  _refreshBothViews() {
    try {
      this.renderOrders();
    } catch (err) {
      console.warn("[refresh] renderOrders failed:", err);
      this._notifyFailure(
        "orders-refresh",
        err,
        "Shipment assignments could not be refreshed. Try again.",
      );
    }
    try {
      this._renderSapTable();
    } catch (err) {
      console.warn("[refresh] _renderSapTable failed:", err);
      this._notifyFailure(
        "sap-view-refresh",
        err,
        "SAP shipment details could not be refreshed. Try again.",
      );
    }
  }

  _resetCancelSelect(dispatchKey) {
    //  Re-enable the dropdown that initiated this cancel request,

    //  regardless of which view it lives in.

    const ids = ["ordersBody", "sapBody"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const sel = el.querySelector(
        `[data-action="cancel-reason"][data-dispatch="${CSS.escape(dispatchKey)}"], ` +
          `[data-action="row-action"][data-dispatch="${CSS.escape(dispatchKey)}"]`,
      );
      if (sel) {
        sel.disabled = false;
        sel.classList.remove("opacity-50", "cursor-not-allowed");
        sel.value = "";
      }
    }
  }

  async confirmAssignment() {
    const driverId = this.state.selectedQueueDriverId;
    const dispatchKey = this.state.assignTarget;
    if (!driverId || !dispatchKey) {
      console.warn("[assignTrace] missing driverId or dispatchKey, aborting");
      return;
    }

    //  FIFO enforcement lives on the server now (POST /api/sap/assign).

    //  The client-side alert has been intentionally removed so it cannot

    //  be disabled from DevTools. The server transaction is the gate.

    const confirmBtn = document.getElementById("assignConfirmBtn");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "ASSIGNING...";
    }

    try {
      //  Look up the driver from the same merged list the modal renders.

      //  `state.queue` only has fresh queue entries — if the dispatcher

      //  picked an already-Assigned driver (who is on the FIFO-earliest

      //  line), the lookup would fail. _modalAvailableDrivers is the

      //  union of queue + assigned, scoped to the dispatch's truck type.

      const mergedDrivers =
        this.state._modalAvailableDrivers || this.state.queue;
      let driver = mergedDrivers.find((q) => q.id === driverId);

      //  Override fallback: if the driver isn't in the modal list

      //  (e.g., they were filtered out for truck type, or the queue

      //  subscription hasn't refreshed since the override was issued),

      //  look them up from the broader queue/drivers collections and

      //  build a minimal record so the assign call can succeed.

      if (!driver) {
        const queueHit = (this.state.queue || []).find(
          (q) => q.id === driverId,
        );
        const driverHit = (this.state.drivers || []).find(
          (d) => d.id === driverId,
        );
        if (queueHit || driverHit) {
          driver = {
            id: driverId,
            driverName:
              queueHit?.driverName ||
              driverHit?.name ||
              driverHit?.driverName ||
              "Unknown Driver",
            plateNumber:
              queueHit?.plateNumber || driverHit?.plateNumber || "---",
            truckCompany:
              queueHit?.truckCompany ||
              driverHit?.truckingCompany ||
              driverHit?.company ||
              "—",
          };
          console.warn(
            "[assign] driver not in modal list, fell back to queue/drivers",
            {
              driverId,
              source: queueHit ? "queue" : "drivers",
            },
          );
        }
      }
      if (!driver) throw new Error("Driver not found in available list.");

      const driverName =
        driver.driverName || driver.user?.name || "Unknown Driver";
      const truckPlate =
        driver.plateNumber || driver.user?.plateNumber || "---";

      //  Derive OBD line items from the receiving records grouped by dispatch

      const receivingRecords =
        this.state.sapGroupedByDispatch[dispatchKey] || [];
      const lineItems = receivingRecords
        .filter((r) => r.OBDNumber && r.OBDNumber.trim() !== "")
        .map((r) => {
          const rawQty = r.Quantity;
          const qtyStr =
            typeof rawQty === "string"
              ? rawQty
              : typeof rawQty === "number"
                ? rawQty.toFixed(3)
                : "0.000";
          return {
            obdNumber: r.OBDNumber,
            quantity: qtyStr,
            quantityNumeric: parseFloat(qtyStr) || 0,
            customerName: r.ShipToPartyName || r.ShipToParty || "",
            ...driverAssignmentFields(r),
            actualDelDate: this._normalizeDelDate(r.ActualDelDate),
          };
        });

      await SAPAssignmentService.assignDriver({
        dispatchKey,
        requestedDriverId: driverId,
        truckType: this.state.requiredTruckType,
        lineItems,
        driverSnapshot: {
          driverName,
          truckPlate,
          truckCompany: driver.truckCompany || driver.company || "—",
        },
        overrideTokenId: this.state.overrideTokenId || null,
      });

      //  Reset override state - token was consumed server-side.

      this.state.overrideRequestId = null;
      this.state.overrideTokenId = null;
      this.state.overrideRequestStatus = null;
      this.state.resumedOverrideTargetId = null;
      //  Strip the override-approved highlight so a future modal

      //  reopen doesn't briefly show stale styling from the consumed

      //  token.

      this._clearOverrideApprovedMark();
      this._applyConfirmLockState();
      if (this._overridePollTimer) {
        clearTimeout(this._overridePollTimer);
        this._overridePollTimer = null;
      }

      this._showToast(
        `Successfully assigned ${driverName} to dispatch #${dispatchKey}`,
      );
      this.closeAssignModal();
      this._renderAll();
    } catch (err) {
      //  Map structured server errors to user-visible messages.

      const map = {
        NOT_EARLIEST: () => {
          const earliestId = err.meta && err.meta.earliestDriverId;
          const earliestRow = this.state._modalAvailableDrivers?.find(
            (d) => d.id === earliestId,
          );
          const name = earliestRow?.driverName || "the next driver in line";
          this._showAssignBanner(
            `${name} is next in line. Pick them or request a bypass.`,
          );
        },
        TOKEN_REQUIRED: () => {
          this._showAssignBanner(
            "A bypass approval is required to assign this driver.",
          );
        },
        TOKEN_EXPIRED: () => {
          this.state.overrideTokenId = null;
          this._showAssignBanner("Bypass expired — request a new one.");
        },
        TOKEN_CONSUMED: () => {
          this.state.overrideTokenId = null;
          this._showAssignBanner("This bypass was already used.");
        },
        TOKEN_DRIVER_MISMATCH: () => {
          this.state.overrideTokenId = null;
          this._showAssignBanner("This bypass doesn't apply to that driver.");
        },
        TOKEN_DISPATCH_MISMATCH: () => {
          this.state.overrideTokenId = null;
          this._showAssignBanner("This bypass doesn't apply to this dispatch.");
        },
        DRIVER_INACTIVE: () => {
          this._showAssignBanner(
            "Driver is no longer in the queue. Refresh and try again.",
          );
        },
        DRIVER_ON_ACTIVE_LOAD: () => {
          this._showAssignBanner(
            "Driver is in transit or returning to base and cannot take another dispatch.",
          );
        },
        DRIVER_SESSION_AMBIGUOUS: () => {
          this._showAssignBanner(
            "This driver has multiple active QR sessions. Refresh the queue and select the correct entry.",
          );
        },
        DISPATCH_TAKEN: () => {
          this._showAssignBanner(
            "Another dispatcher assigned this dispatch. The list will refresh.",
          );
          setTimeout(() => {
            this.closeAssignModal();
            this._renderAll();
          }, 1500);
        },
        VALIDATION: () => {
          this._showAssignBanner(
            "Check that all required shipment and driver details are complete.",
          );
        },
        HTTP_401: () => {
          this._showAssignBanner("Session expired. Please sign in again.");
        },
      };

      const handler =
        map[err.code] ||
        (() =>
          this._showAssignBanner(
            "The driver could not be assigned. Check your connection and try again.",
          ));
      handler();
      SystemErrorService.report("frontend_operation_failure", {
        operation: "shipment-assignment",
        errorName: err.name,
      });
      console.error("[confirmAssignment] server error:", {
        code: err.code || null,
        requestId: err.requestId || null,
      });
      if (!map[err.code])
        this._showErrorToast(
          "The driver could not be assigned. Check your connection and try again.",
        );
    } finally {
      //  Re-apply the override-aware lock state so an error doesn't

      //  accidentally re-enable Confirm while a bypass request is still

      //  pending admin approval.

      this._applyConfirmLockState();
    }
  }

  //  Closes modal and resets assignment state

  closeAssignModal() {
    const modal = document.getElementById("assignDriverModal");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
    this.state.assignTarget = null;
    this.state.selectedQueueDriverId = null;
    this.state.requiredTruckType = null;
    //  Reset override state on close; the token (if any) is single-use

    //  and may have already been consumed server-side.

    this.state.overrideRequestId = null;
    this.state.overrideTokenId = null;
    this.state.overrideRequestStatus = null;
    this.state.resumedOverrideTargetId = null;
    if (this._overridePollTimer) {
      clearTimeout(this._overridePollTimer);
      this._overridePollTimer = null;
    }
    //  Strip the override-approved highlight so a future modal open

    //  for a different dispatch doesn't show stale pulse on a row.

    this._clearOverrideApprovedMark();
    //  Hide the reason dropdown panel; restore the trigger button.

    const panel = document.getElementById("requestOverridePanel");
    const select = document.getElementById("requestOverrideReason");
    if (panel) panel.classList.add("hidden");
    if (select) select.value = "";
  }

  //  Shared queue-update helper

  //  Guards against overwriting a driver's active status when assigning multiple shipments.

  //  Drivers already on a job (status === 'loading') can receive more dispatches.

  /**
   * Show a banner inside the modal with the error from /api/sap/assign and
   * keep the modal open so the dispatcher can try again or request a bypass.
   */
  _showAssignBanner(message, kind = "error") {
    const banner = document.getElementById("assignModalOverrideBanner");
    if (!banner) return;
    const cls =
      kind === "info"
        ? "bg-blue-500/10 border-blue-500/30 text-blue-200"
        : "bg-red-500/10 border-red-500/40 text-red-200";
    banner.className = `mx-4 mt-2 px-3 py-2 text-xs rounded border ${cls}`;
    banner.textContent = message;
  }

  /**
   * Dispatcher wants to break FIFO. Records the requested driver, prompts
   * for a reason, and creates a pending overrideRequests doc.
   */
  async _requestBypass() {
    const dispatchKey = this.state.assignTarget;
    const driverId = this.state.selectedQueueDriverId;
    if (!dispatchKey || !driverId) {
      this._showAssignBanner("Select a driver first, then request the bypass.");
      return;
    }

    //  Reveal the reason dropdown. Submission happens in _submitBypass().

    const panel = document.getElementById("requestOverridePanel");
    const select = document.getElementById("requestOverrideReason");
    if (panel) panel.classList.remove("hidden");
    if (select) {
      select.value = "";
      select.focus();
    }
  }

  _applyConfirmLockState() {
    const btn = document.getElementById("assignConfirmBtn");
    if (!btn) return;
    const isPending = this.state.overrideRequestStatus === "pending";
    if (isPending) {
      btn.disabled = true;
      btn.textContent = "Waiting for admin approval";
    } else {
      //  Restore default state. _selectFleetDispatch / _confirmFleetAssignment

      //  will re-disable it as needed.

      btn.disabled = false;
      btn.textContent = "Confirm Assignment";
    }
    //  Per-row override buttons mirror the same gate. While a request is

    //  pending we do not allow starting a SECOND one — revoke the first

    //  or wait for an admin decision first.

    document.querySelectorAll(".row-override-btn").forEach((rowBtn) => {
      if (isPending) {
        rowBtn.setAttribute("data-locked", "1");
        rowBtn.classList.add(
          "opacity-40",
          "cursor-not-allowed",
          "pointer-events-none",
        );
      } else {
        rowBtn.removeAttribute("data-locked");
        rowBtn.classList.remove(
          "opacity-40",
          "cursor-not-allowed",
          "pointer-events-none",
        );
      }
    });
  }

 //  UNIFIED ADMIN QUEUE (_renderDocsView)

  //

  //  Reads overrideRequests + cancelRequests via onSnapshot, merges

  //  them into a single sorted list, and renders a unified pending /

  //  approved / rejected view gated by the existing docs sub-tab

  //  buttons (pending / approved / rejected). The "action" filter

  //  chips at the top of the panel narrow by override | cancel |

  //  change. Approve / Deny buttons are gated by the dispatcher's

  //  admin role — non-admins still see the queue (read-only) so the

  //  status of their own requests is visible.

  _ensureAdminQueueSubscriptions() {
    if (this._adminQueueSubs) return;
    if (!this.state._adminActionRequests) {
      this.state._adminActionRequests = [];
    }
    if (!this.state._adminActionFilter) {
      this.state._adminActionFilter = "all";
    }
    //  Use the top-level imports — dashboard.js is an ES module and the

    //  bundler re-binds module instances per import. A dynamic require()

    //  here would resolve to a different onSnapshot reference and the

    //  snapshot would never deliver updates to this dashboard instance.

    this._adminQueueSubs = {};
    this._adminQueueSubs.override = subscribeRealtime(
      "overrideRequests",
      {},
      (rows) => {
        const snap = asCollectionSnapshot(rows);
        this._mergeAdminRequests("override", snap);
        this._syncOverrideApprovalFromSnapshot(snap);
      },
      (err) => {
        console.error("[adminQueue] overrideRequests:", err);
        this._notifyFailure(
          "admin-queue-subscription",
          err,
          "Approval requests are temporarily unavailable. Check your connection and retry.",
        );
      },
    );
    this._adminQueueSubs.cancel = subscribeRealtime(
      "cancelRequests",
      {},
      (rows) => {
        const snap = asCollectionSnapshot(rows);
        this._mergeAdminRequests("cancel", snap);
      },
      (err) => {
        console.error("[adminQueue] cancelRequests:", err);
        this._notifyFailure(
          "admin-queue-subscription",
          err,
          "Approval requests are temporarily unavailable. Check your connection and retry.",
        );
      },
    );
  }

  _mergeAdminRequests(kind, snap) {
    const items = [];
    snap.forEach((doc) => {
      const data = doc.data();
      items.push({
        id: doc.id,
        kind,
        ...data,
      });
    });
    const merged = (this.state._adminActionRequests || []).filter(
      (r) => r.kind !== kind,
    );
    merged.push(...items);
    merged.sort((a, b) => {
      const ta =
        a.requestedAt?.toMillis?.() ||
        (a.requestedAt?.seconds ? a.requestedAt.seconds * 1000 : 0);
      const tb =
        b.requestedAt?.toMillis?.() ||
        (b.requestedAt?.seconds ? b.requestedAt.seconds * 1000 : 0);
      return tb - ta;
    });
    this.state._adminActionRequests = merged;
    this._updatePendingBadge();
    const tab = this.state._activeDocsTab || "pending";
    if (
      tab !== "guards" &&
      tab !== "truck-companies" &&
      tab !== "warehouse" &&
      tab !== "role-requests"
    ) {
      this._renderDocsView();
    }
  }

  /**
   * Drive the assign modal unlock from the admin-queue snapshot, not
   * just from the polling fallback.
   *
   * The admin queue subscription (`_ensureAdminQueueSubscriptions`)
   * already listens to `overrideRequests` for the Documents tab. We
   * piggy-back on its snapshots: if any doc matches the dispatcher's
   * currently-open assign modal request and its status flipped to
   * approved, adopt the token and unlock the rows. This works
   * regardless of whether the modal was opened BEFORE or AFTER the
   * admin's decision — the snapshot fires on the next write.
   */
  _syncOverrideApprovalFromSnapshot(snap) {
    const me =
      (this.state.user && this.state.user.uid) ||
      (AuthService.getUserProfile() && AuthService.getUserProfile().id) ||
      (AuthService.getUserProfile() && AuthService.getUserProfile().id);
    if (!me) {
      return;
    }
    const openDispatchKey = this.state.assignTarget;
    if (!openDispatchKey) {
      return;
    }

    //  Don't downgrade an already-unlocked state if the dispatcher is

    //  looking at a different request. We only adopt a token if EITHER

    //  (a) our live state points at this same request id, OR

    //  (b) we have no live override yet but there's an approved token

    //  for this dispatch from this dispatcher.

    const liveId = this.state.overrideRequestId;
    const liveToken = this.state.overrideTokenId;
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.requestedBy !== me) return;
      if (data.dispatchKey !== openDispatchKey) return;
      if (data.status !== "approved") return;
      const expiresAt = data.tokenExpiresAt
        ? new Date(data.tokenExpiresAt)
        : null;
      if (!data.tokenId || !expiresAt || expiresAt.getTime() <= Date.now()) {
        return;
      }
      //  Already have this token, nothing to do.

      if (liveId === docSnap.id && liveToken === data.tokenId) {
        return;
      }
      this.state.overrideRequestId = docSnap.id;
      this.state.overrideTokenId = data.tokenId;
      this.state.overrideRequestStatus = "approved";
      this.state.resumedOverrideTargetId = data.requestedDriverId;
      if (this._overridePollTimer) {
        clearTimeout(this._overridePollTimer);
        this._overridePollTimer = null;
      }
      this._unlockDriverRows(data.requestedDriverId);
      //  Repeat briefly in case the rows re-render right after.

      let attempt = 0;
      const retry = () => {
        if (attempt++ >= 10) return;
        this._unlockDriverRows(data.requestedDriverId);
        setTimeout(retry, 200);
      };
      setTimeout(retry, 50);
      this._showAssignBanner(
        "Bypass approved — you can now confirm the assignment.",
        "info",
      );
    });
  }

  _updatePendingBadge() {
    const badge = document.getElementById("docsBadgePending");
    if (!badge) return;
    const count = (this.state._adminActionRequests || []).filter(
      (r) => r.status === "pending",
    ).length;
    badge.textContent = count > 0 ? String(count) : "";
  }

  _renderDocsView() {
    const container = document.getElementById("docsListContainer");
    if (container) {
      if (this.state._activeDocsTab === "system-errors") {
        this._renderSystemErrorsView(container);
        return;
      }
      this._renderAdminPortalContent(container);
    }
  }

  async _loadSystemErrors() {
    this.state.systemErrorLogsLoading = true;
    this.state.systemErrorLogsError = null;
    this._renderDocsView();
    try {
      const [logs, runs] = await Promise.allSettled([
        SystemErrorService.list(),
        SystemErrorService.listDiagnosticRuns({ limit: 50, offset: 0 }),
      ]);
      if (logs.status === "rejected") throw logs.reason;
      this.state.systemErrorLogs = logs.value;
      this.state.mobileDiagnosticRuns =
        runs.status === "fulfilled"
          ? this._mergeMobileDiagnosticRuns(
              runs.value.items,
              this.state.mobileDiagnosticRuns || [],
            )
          : [];
      this.state.mobileDiagnosticRunsHasMore =
        runs.status === "fulfilled" && runs.value.hasMore;
      this.state.mobileDiagnosticRunsOffset =
        runs.status === "fulfilled" ? runs.value.items.length : 0;
      this.state.mobileDiagnosticRunsExpanded = null;
      this.state.mobileDiagnosticRunHistories = {};
      this.state.mobileDiagnosticRunsError =
        runs.status === "rejected"
          ? runs.reason?.requestId ||
            "Mobile diagnostic runs could not be loaded."
          : null;
    } catch (error) {
      this.state.systemErrorLogsError =
        error.requestId || "System logs could not be loaded.";
      console.error("[diagnostics] admin log list unavailable", {
        requestId: error.requestId || null,
      });
      this._showErrorToast(
        error.requestId
          ? `System logs could not be loaded. Reference: ${error.requestId}`
          : "System logs could not be loaded. Check your connection and retry.",
      );
    } finally {
      this.state.systemErrorLogsLoading = false;
      this.state.systemErrorLogsLoaded = true;
      this._renderDocsView();
    }
  }

  _mergeMobileDiagnosticRuns(incoming, current) {
    const byActor = new Map();
    for (const run of [...incoming, ...current]) {
      if (!run?.actorId) continue;
      const existing = byActor.get(run.actorId);
      if (
        !existing ||
        timestampMillis(run.createdAt) > timestampMillis(existing.createdAt)
      )
        byActor.set(run.actorId, run);
    }
    return [...byActor.values()].sort(
      (a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt),
    );
  }

  async _refreshMobileDiagnosticRun(payload) {
    const actorId = payload?.actorId;
    if (
      typeof actorId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(actorId)
    )
      return;
    try {
      const result = await SystemErrorService.listDiagnosticRuns({
        actorId,
        limit: 1,
        offset: 0,
      });
      const latest = result.items?.[0];
      if (!latest) return;
      this.state.mobileDiagnosticRuns = this._mergeMobileDiagnosticRuns(
        [latest],
        this.state.mobileDiagnosticRuns || [],
      );
      if (this.state.mobileDiagnosticRunsExpanded === actorId) {
        delete this.state.mobileDiagnosticRunHistories[actorId];
        await this._loadMobileDiagnosticHistory(actorId);
      } else if (this.state._activeDocsTab === "system-errors") {
        this._renderSystemErrorsView();
      }
    } catch (error) {
      this.state.mobileDiagnosticRunsError =
        error.requestId || "Mobile diagnostic runs could not be refreshed.";
      if (this.state._activeDocsTab === "system-errors")
        this._renderSystemErrorsView();
    }
  }

  async _loadMoreMobileDiagnosticRuns() {
    if (
      this.state.mobileDiagnosticRunsLoadingMore ||
      !this.state.mobileDiagnosticRunsHasMore
    )
      return;
    this.state.mobileDiagnosticRunsLoadingMore = true;
    this._renderSystemErrorsView();
    try {
      const result = await SystemErrorService.listDiagnosticRuns({
        offset: this.state.mobileDiagnosticRunsOffset,
        limit: 50,
      });
      const knownAccounts = new Set(
        this.state.mobileDiagnosticRuns.map((run) => run.actorId),
      );
      this.state.mobileDiagnosticRuns.push(
        ...result.items.filter((run) => !knownAccounts.has(run.actorId)),
      );
      this.state.mobileDiagnosticRunsOffset += result.items.length;
      this.state.mobileDiagnosticRunsHasMore = result.hasMore;
    } catch (error) {
      this.state.mobileDiagnosticRunsError =
        error.requestId || "Mobile diagnostic runs could not be loaded.";
    } finally {
      this.state.mobileDiagnosticRunsLoadingMore = false;
      this._renderSystemErrorsView();
    }
  }

  async _loadMobileDiagnosticHistory(actorId, { append = false } = {}) {
    const previous = this.state.mobileDiagnosticRunHistories[actorId] || {
      items: [],
      hasMore: true,
    };
    if (
      previous.loading ||
      (!append && previous.loaded) ||
      (append && !previous.hasMore)
    )
      return;
    const offset = append ? previous.offset : 1;
    this.state.mobileDiagnosticRunHistories[actorId] = {
      ...previous,
      loading: true,
    };
    this._renderSystemErrorsView();
    try {
      const result = await SystemErrorService.listDiagnosticRuns({
        actorId,
        limit: 20,
        offset,
      });
      const current = this.state.mobileDiagnosticRunHistories[actorId] || {};
      this.state.mobileDiagnosticRunHistories[actorId] = {
        items: [...(append ? current.items || [] : []), ...result.items],
        offset: offset + result.items.length,
        hasMore: result.hasMore,
        loaded: true,
        loading: false,
        error: null,
      };
    } catch (error) {
      this.state.mobileDiagnosticRunHistories[actorId] = {
        ...previous,
        loading: false,
        error: error.requestId || "Run history could not be loaded.",
      };
    }
    this._renderSystemErrorsView();
  }

  _renderSystemErrorsView(
    container = document.getElementById("docsListContainer"),
  ) {
    if (!container) return;
    if (!container.dataset.systemErrorsWired) {
      container.dataset.systemErrorsWired = "1";
      container.addEventListener("click", async (event) => {
        const target = event.target.closest("[data-system-error-action]");
        if (!target) return;
        if (target.dataset.systemErrorAction === "run-diagnostics") {
          this.state.systemDiagnosticsRun = { running: true };
          this._renderSystemErrorsView(container);
          try {
            this.state.systemDiagnosticsRun =
              await SystemErrorService.runDiagnostics();
          } catch {
            this.state.systemDiagnosticsRun = {
              error:
                "Diagnostics could not be completed. Check the connection and try again.",
            };
          }
          this._renderSystemErrorsView(container);
          return;
        }
        if (target.dataset.systemErrorAction === "download-diagnostics") {
          const run = this.state.systemDiagnosticsRun;
          if (!run || run.running) return;
          const blob = new Blob([JSON.stringify(run, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `sysu-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.json`;
          link.click();
          URL.revokeObjectURL(url);
          return;
        }
        if (target.dataset.systemErrorAction === "refresh") {
          await this._loadSystemErrors();
          return;
        }
        if (target.dataset.systemErrorAction === "mobile-runs-more") {
          await this._loadMoreMobileDiagnosticRuns();
          return;
        }
        if (target.dataset.systemErrorAction === "mobile-run-history") {
          const actorId = target.dataset.actorId;
          if (this.state.mobileDiagnosticRunsExpanded === actorId) {
            this.state.mobileDiagnosticRunsExpanded = null;
            this._renderSystemErrorsView(container);
            return;
          }
          this.state.mobileDiagnosticRunsExpanded = actorId;
          this._renderSystemErrorsView(container);
          await this._loadMobileDiagnosticHistory(actorId);
          return;
        }
        if (target.dataset.systemErrorAction === "mobile-history-more") {
          await this._loadMobileDiagnosticHistory(target.dataset.actorId, {
            append: true,
          });
          return;
        }
        if (target.dataset.systemErrorAction === "mobile-run-delete") {
          const id = target.dataset.id;
          if (
            !/^\d{1,20}$/.test(id || "") ||
            !window.confirm(
              "Permanently delete this SYSU Go diagnostic run? This cannot be undone.",
            )
          )
            return;
          target.disabled = true;
          try {
            await SystemErrorService.deleteDiagnosticRun(id);
            this.state.mobileDiagnosticRuns = (
              this.state.mobileDiagnosticRuns || []
            ).filter((run) => run.id !== id);
            for (const [actorId, history] of Object.entries(
              this.state.mobileDiagnosticRunHistories || {},
            )) {
              this.state.mobileDiagnosticRunHistories[actorId] = {
                ...history,
                items: (history.items || []).filter((run) => run.id !== id),
              };
            }
            await this._loadSystemErrors();
          } catch (error) {
            target.disabled = false;
            this._showToast(
              error.requestId
                ? `Could not delete this mobile diagnostic run. Reference: ${error.requestId}`
                : "Could not delete this mobile diagnostic run. Please retry.",
            );
          }
          return;
        }
        if (target.dataset.systemErrorAction === "filter") {
          this.state.systemErrorFilter = target.dataset.filter || "open";
          this._renderDocsView();
          return;
        }
        if (target.dataset.systemErrorAction === "resolve") {
          target.disabled = true;
          try {
            await SystemErrorService.resolve(target.dataset.id);
            const row = this.state.systemErrorLogs.find(
              (item) => item.id === target.dataset.id,
            );
            if (row) row.resolvedAt = new Date();
            this._renderDocsView();
          } catch (error) {
            target.disabled = false;
            this._showToast(
              error.requestId
                ? `Could not update this log. Reference: ${error.requestId}`
                : "Could not update this log. Please retry.",
            );
          }
          return;
        }
        if (target.dataset.systemErrorAction === "delete") {
          const row = this.state.systemErrorLogs.find(
            (item) => item.id === target.dataset.id,
          );
          if (!row?.resolvedAt) return;
          const confirmed = window.confirm(
            [
              "Permanently delete this resolved diagnostic row? This cannot be undone.",
              `Operation: ${row.operation || "unknown"}`,
              `Reference: ${row.requestId || "unavailable"}`,
            ].join("\n"),
          );
          if (!confirmed) return;
          target.disabled = true;
          try {
            await SystemErrorService.deleteResolved(row.id);
            this.state.systemErrorLogs = this.state.systemErrorLogs.filter(
              (item) => item.id !== row.id,
            );
            this._renderDocsView();
          } catch (error) {
            target.disabled = false;
            this._showToast(
              error.requestId
                ? `Could not delete this resolved log. Reference: ${error.requestId}`
                : "Could not delete this resolved log. Please retry.",
            );
          }
        }
      });
      const filterMobileRuns = () =>
        this._filterMobileDiagnosticRunCards(container);
      container.addEventListener("input", (event) => {
        if (event.target.matches("[data-mobile-runs-search]")) {
          this.state.mobileDiagnosticRunsSearch = event.target.value;
          filterMobileRuns();
        }
      });
      container.addEventListener("change", (event) => {
        if (event.target.matches("[data-mobile-runs-filter]")) {
          this.state.mobileDiagnosticRunsFilter = event.target.value;
          filterMobileRuns();
        }
      });
    }
    if (!this._systemErrorSocketWired) {
      this._systemErrorSocketWired = true;
      const refresh = () => {
        if (this.state._activeDocsTab === "system-errors")
          void this._loadSystemErrors();
      };
      socket.on("system_error_created", refresh);
      socket.on("system_error_updated", refresh);
      socket.on("system_error_resolved", refresh);
      socket.on("system_error_deleted", refresh);
    }

    const filter = this.state.systemErrorFilter || "open";
    const canViewSystemManagerGuidance = ["admin", "super_admin"].includes(
      this.state.user?.role,
    );
    const entries = this.state.systemErrorLogs.filter(
      (entry) =>
        filter === "all" ||
        (filter === "open" ? !entry.resolvedAt : Boolean(entry.resolvedAt)),
    );
    const dateLabel = (value) => {
      const date =
        value?.toDate?.() ||
        (typeof value?.$timestamp === "number"
          ? new Date(value.$timestamp)
          : null) ||
        (typeof value?.seconds === "number"
          ? new Date(value.seconds * 1000)
          : new Date(value));
      return Number.isNaN(date.getTime())
        ? "Time unavailable"
        : date.toLocaleString();
    };
    const filters = [
      ["open", "Open"],
      ["resolved", "Resolved"],
      ["all", "All"],
    ]
      .map(
        ([key, label]) =>
          `<button type="button" data-system-error-action="filter" data-filter="${key}" aria-pressed="${filter === key}" class="rounded-md border px-3 py-1.5 text-xs font-semibold ${filter === key ? "border-sysu-red/40 bg-sysu-red/10 text-sysu-red" : "border-db-border bg-db-panel text-db-text2"}">${label}</button>`,
      )
      .join("");
    const body = this.state.systemErrorLogsLoading
      ? '<div role="status" class="animate-pulse space-y-3"><div class="h-24 rounded-lg bg-db-item-hover"></div><div class="h-24 rounded-lg bg-db-item-hover"></div></div>'
      : this.state.systemErrorLogsError
        ? `<div role="alert" class="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-db-text2">Could not load system logs.${this.state.systemErrorLogsError === "System logs could not be loaded." ? "" : ` Request reference: ${escapeHtml(this.state.systemErrorLogsError)}`}</div>`
        : entries.length === 0
          ? '<div role="status" class="flex min-h-40 items-center justify-center text-sm text-db-text3">No system errors in this view.</div>'
          : entries
              .map((entry) => {
                const resolved = Boolean(entry.resolvedAt);
                const details = entry.details || {};
                const guidance = systemDiagnosticsGuidance(entry);
                const counts = Number.isInteger(details.missingCount)
                  ? `<div class="mt-2 text-xs text-db-text2">SAP rows: ${escapeHtml(String(details.receivedCount ?? "—"))} of ${escapeHtml(String(details.expectedCount ?? "—"))}; missing ${escapeHtml(String(details.missingCount))}.</div>`
                  : "";
                const diagnosticHttpStatus =
                  details.statusCode ?? details.httpStatus;
                const httpStatus = Number.isInteger(diagnosticHttpStatus)
                  ? `<span>HTTP ${escapeHtml(String(diagnosticHttpStatus))}</span>`
                  : "";
                const supportDetails = canViewSystemManagerGuidance
                  ? [
                      entry.eventCode
                        ? `Event code: ${escapeHtml(entry.eventCode)}`
                        : "",
                      entry.operation
                        ? `Operation: ${escapeHtml(entry.operation)}`
                        : "",
                      entry.errorName
                        ? `Error type: ${escapeHtml(entry.errorName)}`
                        : "",
                      httpStatus ? `Response: ${httpStatus}` : "",
                      entry.route ? `Route: ${escapeHtml(entry.route)}` : "",
                      details.failureCode
                        ? `Failure code: ${escapeHtml(details.failureCode)}`
                        : "",
                      details.stage
                        ? `Stage: ${escapeHtml(details.stage)}`
                        : "",
                      details.sourceFrame
                        ? `Code location: ${escapeHtml(details.sourceFrame)}`
                        : "",
                      details.appVersion
                        ? `App version: ${escapeHtml(details.appVersion)}`
                        : "",
                      details.clientRequestId
                        ? `Client reference: ${escapeHtml(details.clientRequestId)}`
                        : "",
                      counts ? counts.replace(/<[^>]*>/g, "") : "",
                    ].filter(Boolean)
                  : [];
                const troubleshootingSteps = guidance.steps
                  .map((step) => `<li>${escapeHtml(step)}</li>`)
                  .join("");
                return `<article class="mb-3 rounded-lg border border-db-border bg-db-panel p-4">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${entry.severity === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-700" : "border-red-500/30 bg-red-500/10 text-red-700"}">${entry.severity === "warning" ? "Check" : "Error"}</span>
                                        <span class="rounded border border-db-border px-2 py-0.5 text-[10px] text-db-text3">${escapeHtml(systemDiagnosticsSource(entry))}</span>
                                        <span class="rounded border border-db-border px-2 py-0.5 text-[10px] uppercase text-db-text3">${resolved ? "Resolved" : "Open"}</span>
                                    </div>
                                    <p class="mt-2 text-sm text-db-text">${escapeHtml(systemDiagnosticsSummary(entry))}</p>
                                    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-db-text3">
                                        <span>${escapeHtml(dateLabel(entry.createdAt))}</span>
                                        ${systemDiagnosticsOperation(entry) ? `<span>${escapeHtml(systemDiagnosticsOperation(entry))}</span>` : ""}
                                        ${entry.requestId ? `<span>Reference: ${escapeHtml(entry.requestId)}</span>` : ""}
                                        ${entry.actorId ? `<span>Account: ${escapeHtml(entry.actorId)}</span>` : ""}
                                    </div>
                                    ${Number.isInteger(details.occurrenceCount) && details.occurrenceCount > 1 ? `<p class="mt-1 text-xs text-db-text3">Happened ${escapeHtml(String(details.occurrenceCount))} times. Most recent: ${escapeHtml(dateLabel(details.lastSeenAtMs))}</p>` : ""}
                                    <div class="mt-3 rounded-md border border-db-border bg-db-item-hover/30 p-3 text-xs text-db-text2">
                                        <div><span class="font-semibold text-db-text">What happened:</span> ${escapeHtml(guidance.meaning)}</div>
                                        <div class="mt-2 font-semibold text-db-text">What to do:</div>
                                        <ol class="mt-1 list-decimal space-y-1 pl-5">${troubleshootingSteps}</ol>
                                        <div class="mt-2"><span class="font-semibold text-db-text">Still not fixed?</span> ${escapeHtml(guidance.ifStillFails)}</div>
                                        ${canViewSystemManagerGuidance ? `<div class="mt-2 border-t border-db-border pt-2"><span class="font-semibold text-db-text">System manager:</span> ${escapeHtml(guidance.systemManager)}</div>` : ""}
                                    </div>
                                    ${supportDetails.length ? `<details class="mt-3 text-xs text-db-text3"><summary class="cursor-pointer">Technical details</summary><div class="mt-2 grid gap-1">${supportDetails.map((item) => `<div>${item}</div>`).join("")}</div></details>` : ""}
                                </div>
                                <div class="flex shrink-0 flex-wrap gap-2">
                                    ${resolved ? `<button type="button" data-system-error-action="delete" data-id="${escapeHtml(entry.id)}" class="rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-500/10">Delete row</button>` : `<button type="button" data-system-error-action="resolve" data-id="${escapeHtml(entry.id)}" class="rounded-md border border-db-border px-3 py-1.5 text-xs font-semibold text-db-text2 hover:border-green-600 hover:text-green-700">Mark resolved</button>`}
                                </div>
                            </div>
                        </article>`;
              })
              .join("");

    const diagnosticRun = this.state.systemDiagnosticsRun;
    const mobileRuns = this.state.mobileDiagnosticRuns || [];
    const mobileRunStatus = (run) => {
      const checks = Array.isArray(run.details?.checks)
        ? run.details.checks
        : [];
      if (checks.some((check) => check.status === "fail")) return "issues";
      if (checks.some((check) => check.status === "warning")) return "review";
      return "healthy";
    };
    const mobileStatusLabel = (status) =>
      status === "issues"
        ? "Needs attention"
        : status === "review"
          ? "Review"
          : "Healthy";
    const mobileStatusClass = (status) =>
      status === "issues"
        ? "border-red-600/30 bg-red-500/5 text-red-700"
        : status === "review"
          ? "border-amber-600/30 bg-amber-500/5 text-amber-700"
          : "border-green-600/30 bg-green-500/5 text-green-700";
    const renderMobileCheck = (check) =>
      `<span class="rounded border px-2 py-1 text-xs ${check.status === "pass" ? "border-green-600/30 text-green-700" : check.status === "fail" ? "border-red-600/30 text-red-700" : "border-amber-600/30 text-amber-700"}">${escapeHtml(check.name)}: ${escapeHtml(check.status)}${check.state ? ` · ${escapeHtml(check.state)}` : ""}${Number.isFinite(check.httpStatus) ? ` · HTTP ${escapeHtml(String(check.httpStatus))}` : ""}${Number.isFinite(check.durationMs) ? ` · ${escapeHtml(String(check.durationMs))} ms` : ""}${check.failureCode ? ` · ${escapeHtml(check.failureCode)}` : ""}</span>`;
    const mobileRunsOutput = `<section class="mb-4 rounded-lg border border-db-border bg-db-panel p-4">
            <h3 class="text-sm font-semibold text-db-text">SYSU Go mobile diagnostic runs</h3>
            <p class="mt-1 text-xs text-db-text3">Latest saved run per account. Expand an account to inspect its run history.</p>
            <div class="mt-3 flex flex-wrap items-center gap-2">
                <input type="search" data-mobile-runs-search aria-label="Search account ID" placeholder="Search account ID" value="${escapeHtml(this.state.mobileDiagnosticRunsSearch || "")}" class="min-w-56 rounded-md border border-db-border bg-db-panel px-3 py-2 text-xs text-db-text placeholder:text-db-text3" />
                <select data-mobile-runs-filter aria-label="Filter mobile diagnostic accounts" class="rounded-md border border-db-border bg-db-panel px-3 py-2 text-xs text-db-text"><option value="all" ${(this.state.mobileDiagnosticRunsFilter || "all") === "all" ? "selected" : ""}>All accounts</option><option value="issues" ${this.state.mobileDiagnosticRunsFilter === "issues" ? "selected" : ""}>Needs attention or review</option></select>
                <span data-mobile-runs-count class="text-[11px] text-db-text3">Showing ${mobileRuns.length} loaded accounts</span>
            </div>
            ${this.state.mobileDiagnosticRunsError ? `<p role="alert" class="mt-2 text-xs text-red-600">Mobile runs are unavailable${this.state.mobileDiagnosticRunsError === "Mobile diagnostic runs could not be loaded." ? "." : ` · Reference: ${escapeHtml(this.state.mobileDiagnosticRunsError)}`}</p>` : ""}
            ${
              mobileRuns.length
                ? mobileRuns
                    .map((run) => {
                      const details = run.details || {};
                      const checks = Array.isArray(details.checks)
                        ? details.checks
                        : [];
                      const actorId = String(run.actorId || "unknown");
                      const status = mobileRunStatus(run);
                      const history =
                        this.state.mobileDiagnosticRunHistories?.[actorId];
                      const expanded =
                        this.state.mobileDiagnosticRunsExpanded === actorId;
                      const historyOutput = expanded
                        ? `<div class="mt-3 border-t border-db-border pt-3">
                    <h4 class="text-xs font-semibold text-db-text">Earlier runs</h4>
                    ${history?.error ? `<p role="alert" class="mt-2 text-xs text-red-600">${escapeHtml(history.error)}</p>` : ""}
                    ${history?.loading && !history.items?.length ? '<p role="status" class="mt-2 text-xs text-db-text3">Loading history…</p>' : ""}
                    ${
                      history?.items?.length
                        ? history.items
                            .map((previousRun) => {
                              const previousDetails = previousRun.details || {};
                              const previousChecks = Array.isArray(
                                previousDetails.checks,
                              )
                                ? previousDetails.checks
                                : [];
                              const previousStatus =
                                mobileRunStatus(previousRun);
                              return `<div class="mt-2 rounded-md border border-db-border p-3">
                            <div class="flex flex-wrap items-center justify-between gap-2"><span class="rounded border px-2 py-0.5 text-[10px] font-bold ${mobileStatusClass(previousStatus)}">${mobileStatusLabel(previousStatus)}</span><span class="text-[11px] text-db-text3">${escapeHtml(dateLabel(previousRun.createdAt))}</span></div>
                            <div class="mt-2 flex flex-wrap gap-2">${previousChecks.map(renderMobileCheck).join("")}</div>
                            <div class="mt-2 flex items-center justify-between gap-2"><p class="text-[11px] text-db-text3">Run: ${escapeHtml(previousDetails.runId || previousRun.requestId || "unavailable")} · SYSU Go ${escapeHtml(previousDetails.appVersion || "version unavailable")}</p><button type="button" data-system-error-action="mobile-run-delete" data-id="${escapeHtml(previousRun.id)}" class="rounded-md border border-red-500/30 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-500/10">Delete run</button></div>
                        </div>`;
                            })
                            .join("")
                        : history?.loaded && !history.error
                          ? '<p class="mt-2 text-xs text-db-text3">No earlier runs for this account.</p>'
                          : ""
                    }
                    ${history?.hasMore ? `<button type="button" data-system-error-action="mobile-history-more" data-actor-id="${escapeHtml(actorId)}" ${history.loading ? "disabled" : ""} class="mt-2 rounded-md border border-db-border px-3 py-1.5 text-xs font-semibold text-db-text2 disabled:opacity-50">${history.loading ? "Loading…" : "Load older runs"}</button>` : ""}
                </div>`
                        : "";
                      return `<article data-mobile-run-account data-search-text="${escapeHtml(`${actorId} ${status} ${checks.map((check) => `${check.name} ${check.status} ${check.failureCode || ""}`).join(" ")}`.toLowerCase())}" data-run-status="${status}" class="mt-3 rounded-md border border-db-border p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex flex-wrap items-center gap-2"><span class="font-mono text-xs font-semibold text-db-text">Account: ${escapeHtml(actorId)}</span><span class="rounded border px-2 py-0.5 text-[10px] font-bold ${mobileStatusClass(status)}">${mobileStatusLabel(status)}</span></div>
                        <span class="text-[11px] text-db-text3">Latest · ${escapeHtml(dateLabel(run.createdAt))}</span>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">${checks.map(renderMobileCheck).join("")}</div>
                    <div class="mt-2 flex flex-wrap items-center justify-between gap-2"><span class="text-[11px] text-db-text3">Run: ${escapeHtml(details.runId || run.requestId || "unavailable")} · SYSU Go ${escapeHtml(details.appVersion || "version unavailable")}</span>
                        <div class="flex gap-2"><button type="button" data-system-error-action="mobile-run-delete" data-id="${escapeHtml(run.id)}" class="rounded-md border border-red-500/30 px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-500/10">Delete run</button><button type="button" data-system-error-action="mobile-run-history" data-actor-id="${escapeHtml(actorId)}" aria-expanded="${expanded}" class="rounded-md border border-db-border px-3 py-1.5 text-xs font-semibold text-db-text2">${expanded ? "Hide history" : "View run history"}</button></div>
                    </div>
                    ${historyOutput}
                </article>`;
                    })
                    .join("")
                : !this.state.mobileDiagnosticRunsError
                  ? '<p class="mt-3 text-xs text-db-text3">No mobile diagnostic runs have been saved yet.</p>'
                  : ""
            }
            ${mobileRuns.length ? '<p data-mobile-runs-no-match hidden class="mt-3 text-xs text-db-text3">No accounts match these filters.</p>' : ""}
            ${this.state.mobileDiagnosticRunsHasMore ? `<button type="button" data-system-error-action="mobile-runs-more" ${this.state.mobileDiagnosticRunsLoadingMore ? "disabled" : ""} class="mt-3 rounded-md border border-db-border px-3 py-1.5 text-xs font-semibold text-db-text2 disabled:opacity-50">${this.state.mobileDiagnosticRunsLoadingMore ? "Loading…" : "Load more accounts"}</button>` : ""}
        </section>`;
    const diagnosticOutput = diagnosticRun
      ? `<section class="mb-4 rounded-lg border border-db-border bg-db-panel p-4" aria-live="polite">
            <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm font-semibold text-db-text">${diagnosticRun.running ? "Diagnostics running…" : "Latest diagnostics run"}</h3>
            ${diagnosticRun.running ? "" : '<button type="button" data-system-error-action="download-diagnostics" class="rounded-md border border-db-border px-3 py-1.5 text-xs font-semibold text-db-text2">Download report</button>'}</div>
            ${diagnosticRun.error ? `<p role="alert" class="mt-2 text-xs text-red-600">${escapeHtml(diagnosticRun.error)}</p>` : ""}
            ${diagnosticRun.checks ? `<p class="mt-2 text-[11px] text-db-text3">Run ${escapeHtml(diagnosticRun.runId)} · ${escapeHtml(diagnosticRun.startedAt)}</p><div class="mt-2 flex flex-wrap gap-2">${diagnosticRun.checks.map((check) => `<span class="rounded border px-2 py-1 text-xs ${check.status === "pass" ? "border-green-600/30 text-green-700" : check.status === "fail" ? "border-red-600/30 text-red-700" : "border-amber-600/30 text-amber-700"}">${escapeHtml(check.name)}: ${escapeHtml(check.status)}${check.connection ? ` · ${escapeHtml(check.connection)}` : ""}${check.httpStatus ? ` · HTTP ${escapeHtml(String(check.httpStatus))}` : ""}${Number.isFinite(check.durationMs) ? ` · ${escapeHtml(String(check.durationMs))} ms` : ""}${check.failureCode ? ` · ${escapeHtml(check.failureCode)}` : ""}</span>`).join("")}</div>` : ""}
            <p class="mt-2 text-[11px] text-db-text3">Checks App and Go API liveness, each service's sysu_fleet_app MySQL readiness, and current App/Go socket states. Does not change trips, assignments, or location settings.</p>
        </section>`
      : "";
    container.innerHTML = `<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 class="text-sm font-bold text-db-text">System diagnostics</h2><p class="mt-1 text-xs text-db-text3">Sanitized operational events from web, mobile, backend, and SAP. Request payloads and exception messages are not stored.</p></div>
            <div class="flex flex-wrap gap-2"><button type="button" data-system-error-action="run-diagnostics" ${diagnosticRun?.running ? "disabled" : ""} class="rounded-md border border-sysu-red/40 bg-sysu-red/10 px-3 py-1.5 text-xs font-semibold text-sysu-red disabled:opacity-50">${diagnosticRun?.running ? "Checking…" : "Start diagnostics"}</button>
            <button type="button" data-system-error-action="refresh" class="rounded-md border border-db-border px-3 py-1.5 text-xs font-semibold text-db-text2 hover:text-db-text">Refresh</button></div>
        </div>${diagnosticOutput}${mobileRunsOutput}<div class="mb-4 flex flex-wrap gap-2">${filters}</div>${body}`;
    this._filterMobileDiagnosticRunCards(container);
    if (
      !this.state.systemErrorLogsLoaded &&
      !this.state.systemErrorLogsLoading &&
      !this.state.systemErrorLogsError
    ) {
      void this._loadSystemErrors();
    }
  }

  _filterMobileDiagnosticRunCards(container) {
    const query = (this.state.mobileDiagnosticRunsSearch || "")
      .trim()
      .toLowerCase();
    const filter = this.state.mobileDiagnosticRunsFilter || "all";
    container.querySelectorAll("[data-mobile-run-account]").forEach((card) => {
      const matchesQuery = card.dataset.searchText.includes(query);
      const matchesFilter =
        filter !== "issues" || card.dataset.runStatus !== "healthy";
      card.hidden = !matchesQuery || !matchesFilter;
    });
    const cards = [...container.querySelectorAll("[data-mobile-run-account]")];
    const visibleCount = cards.filter((card) => !card.hidden).length;
    const count = container.querySelector("[data-mobile-runs-count]");
    if (count)
      count.textContent = `Showing ${visibleCount} of ${cards.length} loaded accounts`;
    const empty = container.querySelector("[data-mobile-runs-no-match]");
    if (empty) empty.hidden = visibleCount > 0 || cards.length === 0;
  }

  _renderCombinedView() {
    const container =
      document.getElementById("combinedViewContent") ||
      document.getElementById("docsListContainer");
    if (!container) return;

    if (this.state._activeCombinedTab === "admin") {
      //  Render admin portal UI

      this._renderAdminPortalContent(container);
    } else {
      //  Render documents UI (default)

      this._renderAdminPortalContent(container);
    }
  }

  _renderAdminPortalContent(container) {
    //  Replicate the loadAdminPortal() functionality but render into given container

    this._ensureAdminQueueSubscriptions();
    if (!container) return;

    const tab = this.state._activeDocsTab || "pending";
    const filter = this.state._adminActionFilter || "all";
    const me = (this.state.user && this.state.user.uid) || null;
    const myRole = (this.state.user && this.state.user.role) || "";
    const isAdmin = myRole === "admin" || myRole === "super_admin";

    const rows = (this.state._adminActionRequests || []).filter((r) => {
      const isConsumed =
        r.consumedAt || r.status === "consumed" || r.status === "completed";
      const isExpired =
        r.status === "expired" ||
        (r.status === "approved" &&
          r.tokenExpiresAt &&
          new Date(r.tokenExpiresAt).getTime() < Date.now() &&
          !isConsumed);

      if (tab === "pending" && r.status !== "pending") return false;
      if (
        tab === "approved" &&
        (r.status !== "approved" || isExpired || isConsumed)
      )
        return false;
      if (
        tab === "rejected" &&
        !(
          r.status === "denied" ||
          r.status === "revoked" ||
          r.status === "rejected"
        )
      )
        return false;
      if (tab === "expired" && !isExpired) return false;
      if (tab === "completed" && !isConsumed) return false;
      if (filter !== "all" && r.kind !== filter) return false;
      return true;
    });

    const filterChip = (key, label) => {
      const active = filter === key;
      return (
        '<button data-action="admin-filter" data-filter="' +
        key +
        '" class="px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ' +
        (active
          ? "bg-sysu-red/15 border border-sysu-red/40 text-sysu-red"
          : "bg-db-item border border-db-border text-db-text3 hover:text-db-text") +
        '">' +
        escapeHtml(label) +
        "</button>"
      );
    };

    let html = "";
    html += '<div class="flex items-center gap-2 mb-4">';
    html += filterChip("all", "All");
    html += filterChip("override", "Override");
    html += filterChip("cancel", "Cancel");
    html += filterChip("change", "Change");
    html += "</div>";

    if (rows.length === 0) {
      html +=
        '<div class="flex items-center justify-center min-h-[200px] text-db-text3 italic text-sm">No ' +
        escapeHtml(tab) +
        " admin requests.</div>";
    } else {
      for (const r of rows) {
        const ts =
          r.requestedAt?.toDate?.() ||
          (r.requestedAt?.seconds
            ? new Date(r.requestedAt.seconds * 1000)
            : null);
        const tsLabel = ts ? ts.toLocaleString() : "—";
        const kindLabel =
          r.kind === "override"
            ? "FIFO OVERRIDE"
            : r.kind === "cancel"
              ? "CANCEL"
              : "CHANGE";
        const kindClass =
          r.kind === "override"
            ? "bg-sysu-gold/15 border-sysu-gold/40 text-sysu-gold"
            : "bg-sysu-red/15 border-sysu-red/40 text-sysu-red";
        const statusLabel = (r.status || "pending").toUpperCase();
        const statusClass =
          r.status === "approved"
            ? "bg-green-500/15 border-green-500/40 text-green-400"
            : r.status === "denied" || r.status === "revoked"
              ? "bg-db-text3/15 border-db-text3/30 text-db-text3"
              : "bg-yellow-500/15 border-yellow-500/40 text-yellow-400";
        const isMine = r.requestedBy === me;
        const canDecide = isAdmin && r.status === "pending";

        html +=
          '<div class="rounded-lg border border-db-border bg-db-item p-4 mb-2">';
        html += '<div class="flex items-start justify-between gap-3">';
        html += '<div class="min-w-0 flex-1">';
        html += '<div class="flex items-center gap-2 mb-2 flex-wrap">';
        html +=
          '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ' +
          kindClass +
          '">' +
          escapeHtml(kindLabel) +
          "</span>";
        html +=
          '<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ' +
          statusClass +
          '">' +
          escapeHtml(statusLabel) +
          "</span>";
        if (isMine) {
          html +=
            '<span class="text-[9px] font-bold uppercase tracking-wider text-sysu-red opacity-70">YOURS</span>';
        }
        html += "</div>";
        html +=
          '<div class="text-[12px] font-mono text-db-text mb-1">Dispatch ' +
          escapeHtml(r.dispatchKey || "—") +
          "</div>";
        html +=
          '<div class="text-[11px] text-db-text2 mb-1"><span class="text-db-text3 opacity-60">Reason:</span> ' +
          escapeHtml(r.reason || "—") +
          "</div>";
        if (r.requestedDriverId) {
          html +=
            '<div class="text-[10px] font-mono text-db-text3 opacity-70 mb-1">Driver: ' +
            escapeHtml(r.requestedDriverId) +
            "</div>";
        }
        html +=
          '<div class="text-[10px] text-db-text3 opacity-60">Requested ' +
          escapeHtml(tsLabel) +
          "</div>";
        html += "</div>";

        if (canDecide) {
          html += '<div class="flex flex-col gap-1.5 shrink-0">';
          html +=
            '<button data-action="admin-approve" data-kind="' +
            escapeHtml(r.kind) +
            '" data-id="' +
            escapeHtml(r.id) +
            '" class="px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-green-600 hover:bg-green-500 text-white transition-colors">Approve</button>';
          html +=
            '<button data-action="admin-deny" data-kind="' +
            escapeHtml(r.kind) +
            '" data-id="' +
            escapeHtml(r.id) +
            '" class="px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-db-bg border border-db-border hover:border-sysu-red/50 text-db-text2 hover:text-sysu-red transition-colors">Deny</button>';
          html += "</div>";
        } else if (r.status === "pending" && !isAdmin) {
          html +=
            '<div class="text-[9px] font-bold uppercase tracking-wider text-db-text3 opacity-50 shrink-0">Admin only</div>';
        }
        html += "</div>";
        html += "</div>";
      }
    }

    container.innerHTML = html;

    if (!container.dataset.adminWired) {
      container.dataset.adminWired = "1";
      container.addEventListener("click", (evt) => {
        const t = evt.target.closest("[data-action]");
        if (!t) return;
        const action = t.dataset.action;
        if (action === "admin-filter") {
          this.state._adminActionFilter = t.dataset.filter || "all";
          this._renderDocsView();
        } else if (action === "admin-approve" || action === "admin-deny") {
          this._adminDecide(
            t.dataset.kind,
            t.dataset.id,
            action === "admin-approve" ? "approved" : "denied",
          );
        }
      });
    }
  }

  async _adminDecide(kind, requestId, decision) {
    const reason =
      decision === "denied"
        ? window.prompt("Deny reason (optional):") || undefined
        : undefined;
    try {
      if (kind === "override") {
        await SAPAssignmentService.decideOverride({
          requestId,
          decision,
          reason,
        });
      } else if (kind === "cancel") {
        await SAPAssignmentService.decideCancel({
          requestId,
          decision,
          reason,
        });
      } else {
        console.warn("[adminDecide] unknown kind:", kind);
        return;
      }
      this._showAssignBanner(
        kind +
          " request " +
          (decision === "approved" ? "approved" : "denied") +
          ".",
        decision === "approved" ? "success" : "info",
      );
    } catch (err) {
      console.error("[adminDecide] error:", err);
      this._notifyFailure(
        "admin-decision",
        err,
        "The request could not be updated. Refresh the list and try again.",
      );
    }
  }

  async _submitBypass() {
    const dispatchKey = this.state.assignTarget;
    const driverId = this.state.selectedQueueDriverId;
    const select = document.getElementById("requestOverrideReason");
    const reason = ((select && select.value) || "").trim();
    if (!reason) {
      this._showAssignBanner(
        "Pick a reason before submitting the bypass request.",
      );
      if (select) select.focus();
      return;
    }

    let panel = null;
    try {
      panel = document.getElementById("requestOverridePanel");
      if (panel) panel.classList.add("hidden");
      const result = await SAPAssignmentService.requestOverride({
        dispatchKey,
        requestedDriverId: driverId,
        reason,
      });
      const requestId = result && result.requestId;
      if (!requestId) {
        throw new Error("requestOverride returned no requestId");
      }
      this.state.overrideRequestId = requestId;
      this.state.overrideRequestStatus = "pending";
      this._applyConfirmLockState();
      this._pollOverrideRequest();
      this._showAssignBanner("Waiting for admin approval", "info");
    } catch (err) {
      console.error("[bypass] request failed:", err.code, err.message, err);
      this._notifyFailure(
        "bypass-request",
        err,
        "The bypass request could not be submitted. Check your connection and try again.",
      );
      this._showAssignBanner(
        "The bypass request could not be submitted. Check your connection and try again.",
      );
      if (panel) panel.classList.remove("hidden");
    }
  }

  _cancelBypassPanel() {
    const panel = document.getElementById("requestOverridePanel");
    const select = document.getElementById("requestOverrideReason");
    if (panel) panel.classList.add("hidden");
    if (select) select.value = "";
  }

  _pollOverrideRequest() {
    if (this._overridePollTimer) {
      clearTimeout(this._overridePollTimer);
      this._overridePollTimer = null;
    }
    const requestId = this.state.overrideRequestId;
    if (!requestId) return;

    const fetchOnce = async () => {
      try {
        const data = await SAPAssignmentService.getOverrideRequest(requestId);
        if (!data) {
          this._overridePollTimer = setTimeout(fetchOnce, 3000);
          return;
        }
        this.state.overrideRequestStatus = data.status;
        this._applyConfirmLockState();
        if (data.status === "approved" && data.tokenId) {
          this.state.overrideTokenId = data.tokenId;
          this._showAssignBanner(
            "Bypass approved — you can now confirm the assignment.",
            "info",
          );
          //  Visually unlock all driver rows in the open modal.

          //  _unlockDriverRows handles the cosmetic opacity-50 +

          //  cursor-not-allowed removal AND paints the

          //  approved-target row with the blue override-approved

          //  pulse so the dispatcher can see which row to click.

          this._unlockDriverRows(data.requestedDriverId);
        } else if (data.status === "denied") {
          this._showAssignBanner(
            "Bypass denied by admin. Pick the FIFO driver or try again.",
            "error",
          );
          this.state.overrideRequestId = null;
          this.state.overrideTokenId = null;
        } else if (data.status === "revoked") {
          this._showAssignBanner("Bypass request cancelled.", "info");
          this.state.overrideRequestId = null;
          this.state.overrideTokenId = null;
        } else {
          this._overridePollTimer = setTimeout(fetchOnce, 3000);
        }
      } catch (err) {
        console.error("[bypass] poll error:", err);
        if (err?.status === 404 || err?.code === "HTTP_404") {
          this.state.overrideRequestId = null;
          this.state.overrideTokenId = null;
          this.state.overrideRequestStatus = null;
          this.state.resumedOverrideTargetId = null;
          this._applyConfirmLockState();
          this._showAssignBanner(
            "Bypass request is no longer available. Submit a new request.",
            "error",
          );
          return;
        }
        this._overridePollTimer = setTimeout(fetchOnce, 5000);
      }
    };
    fetchOnce();
  }

  /**
   * Fallback for override state after a page refresh.
   *
   * Polling depends on `state.overrideRequestId` surviving across polls,
   * which it does during a normal session. But if the dispatcher refreshes
   * the page after submitting the request, in-memory state is wiped. By
   * the time they reopen the assign modal the admin may already have
   * approved, but the modal would render with the FIFO lock still active
   * and nothing to poll.
   *
   * This helper runs once on modal open. It looks up the most recent
   * approved override request from the current dispatcher through the
   * authenticated dispatch API and restores an unexpired token.
   */
  async _resumeApprovedOverride(dispatchKey) {
    const me =
      (this.state.user && (this.state.user.id || this.state.user.uid)) ||
      (AuthService.getUserProfile() && AuthService.getUserProfile().id);
    if (!me) {
      return;
    }
    //  Always check — even if we already have a live request, the page

    //  may have been reloaded mid-flight, polling may have been cancelled

    //  when the modal closed, and the server-side request may already

    //  be approved. The function is idempotent: if our in-memory state

    //  already matches the resumed doc we bail below.


    try {
      const requests =
        await SAPAssignmentService.listOverrideRequests(dispatchKey);
      if (!Array.isArray(requests) || requests.length === 0) return;
      const now = Date.now();
      //  Pick the most recent approved, unexpired request from this

      //  dispatcher.

      let best = null;
      requests.forEach((data) => {
        const requestId = data.requestId || data.id;
        if (data.requestedBy !== me) return;
        if (data.status !== "approved") return;
        const expiresAt = data.tokenExpiresAt
          ? new Date(data.tokenExpiresAt)
          : null;
        if (!data.tokenId || !expiresAt || expiresAt.getTime() <= now) {
          return;
        }
        const decidedAt =
          timestampMillis(data.decidedAt) || timestampMillis(data.requestedAt);
        if (!best || decidedAt > best.decidedAtMs) {
          best = { requestId, data, decidedAtMs: decidedAt };
        }
      });
      if (!best) return;

      //  Idempotency: if our in-memory state already matches this

      //  exact approved token, skip the rest to avoid banner churn.

      if (
        this.state.overrideRequestId === best.requestId &&
        this.state.overrideTokenId === best.data.tokenId
      ) {
        return;
      }

      this.state.overrideRequestId = best.requestId;
      this.state.overrideTokenId = best.data.tokenId;
      this.state.overrideRequestStatus = "approved";
      //  Keep the resume context so confirmAssignment can find the

      //  driver even if the row isn't currently in the modal's

      //  _modalAvailableDrivers list (e.g., the driver was filtered out

      //  because they were marked complete or no longer match the truck

      //  type after a previous assignment).

      this.state.resumedOverrideTargetId = best.data.requestedDriverId;
      //  Stop any stale poll (it may have been looking up a different

      //  request id, or polling may have been cancelled by close).

      if (this._overridePollTimer) {
        clearTimeout(this._overridePollTimer);
        this._overridePollTimer = null;
      }

      //  Unlock the driver rows visually. openAssignModal renders

      //  the rows synchronously after this call site, but if the

      //  modal was already open (re-open) the rows are already in

      //  the DOM. Run the unlock now AND a few retries so we win

      //  any race against row re-renders.

      this._unlockDriverRows(best.data.requestedDriverId);
      const targetId = best.data.requestedDriverId;
      let attempt = 0;
      const retry = () => {
        if (attempt++ >= 10) return;
        this._unlockDriverRows(targetId);
        setTimeout(retry, 200);
      };
      setTimeout(retry, 50);

      this._showAssignBanner(
        "Bypass approved (restored after refresh) — you can now confirm the assignment.",
        "info",
      );
    } catch (err) {
      //  The modal remains usable; live requests continue through polling.

      console.warn("[bypass] resumeApprovedOverride query failed:", err);
    }
  }

  /**
   * Visually unlock all driver rows in the assign modal and highlight the
   * row the token applies to. Mirrors the unlock block inside
   * `_pollOverrideRequest`'s approved branch.
   */
  _unlockDriverRows(requestedDriverId) {
    const listEl = document.getElementById("assignModalDriverList");
    if (listEl) {
      const rowCount = listEl.querySelectorAll(".driver-row").length;
      //  Strip the lock styling and any prior override-approved marker

      //  from every row so we always start clean before re-applying the

      //  marker to whichever row the token now applies to.

      listEl.querySelectorAll(".driver-row").forEach((row) => {
        row.dataset.locked = "0";
        row.classList.remove(
          "opacity-50",
          "cursor-not-allowed",
          "pointer-events-none",
          "override-approved",
          "bg-sysu-red/10",
          "border-l-4",
          "border-l-sysu-red",
        );
        row.classList.add("cursor-pointer", "hover:bg-db-item-hover");
        //  Remove the approved tag if it was previously injected.

        const oldTag = row.querySelector(".override-approved-tag");
        if (oldTag) oldTag.remove();
      });
      if (requestedDriverId) {
        const target = listEl.querySelector(
          `.driver-row[data-id="${requestedDriverId}"]`,
        );
        if (target) {
          target.classList.add("override-approved");
          //  Inject a small "Bypass approved" tag next to the

          //  driver name so it's visually obvious which row the

          //  token applies to, even on the Assigned tab where

          //  the dispatcher might not expect it. We anchor it

          //  on the same flex container that holds the driver

          //  name so it sits inline like the "Next" tag.

          const tag = document.createElement("span");
          tag.className = "override-approved-tag";
          tag.textContent = "Bypass approved";
          //  The name row structure is:

          //  <div class="flex flex-col">

          //  <div class="flex items-center gap-2"> † insert here

          //  <span ...>Driver Name</span>

          //  <span ...>Next</span> (if FIFO)

          //  </div>

          //  <span ...>Plate</span>

          //  </div>

          const nameRow = target.querySelector(".flex.items-center.gap-2");
          const anchor = nameRow || target;
          if (!anchor.querySelector(".override-approved-tag")) {
            anchor.appendChild(tag);
          }
        }
      }
    }
    //  Always set selectedQueueDriverId so confirmAssignment has a target

    //  even when the row wasn't rendered (e.g., the driver was filtered

    //  out of _modalAvailableDrivers for the current truck type). The

    //  confirm path has its own driver lookup fallback for this case.

    if (requestedDriverId) {
      this.state.selectedQueueDriverId = requestedDriverId;
    }
    this._applyConfirmLockState();
  }

  /**
   * Strip the override-approved highlight from every driver row.
   * Called after the token is consumed (successful assign) or when
   * the modal closes — prevents the blue pulse from lingering on a
   * stale row when the dispatcher reopens the modal for a different
   * dispatch.
   */
  _clearOverrideApprovedMark() {
    const listEl = document.getElementById("assignModalDriverList");
    if (!listEl) return;
    listEl.querySelectorAll(".driver-row.override-approved").forEach((row) => {
      row.classList.remove("override-approved");
    });
    listEl
      .querySelectorAll(".override-approved-tag")
      .forEach((tag) => tag.remove());
  }

  //  CONFIRMED ASSIGNMENTS / ORDERS VIEW

  renderOrders() {
    const body = document.getElementById("ordersBody");
    if (!body) return;
    if (this.state.assignmentsLoading) {
      body.innerHTML = this._loadingCards("Loading assignments");
      return;
    }
    if (this.state.assignmentsLoadError) {
      body.innerHTML =
        '<p class="text-sm text-sysu-red">Assignments unavailable.</p>';
      return;
    }

    const assignments = this.state.sapAssignments;
    const grouped = this.state.sapGroupedByDispatch;

    //  Merge assignment records with SAP shipment data

    const orders = Object.entries(assignments)
      .map(([key, asgn]) => {
        const records = grouped[key] || [];
        const rec = records[0] || {};
        return {
          dispatchKey: key,
          dispatchNum: key.replace(/^0+/, "") || key,
          driverName: asgn.driverName || "—",
          truckPlate: asgn.truckPlate || "—",
          assignedAt:
            asgn.assignedAt?.toDate?.() ||
            (asgn.assignedAt?.seconds
              ? new Date(asgn.assignedAt.seconds * 1000)
              : null),
          truckType: rec.TruckType || "—",
          route: (rec.Route || "").split("-->").pop()?.trim() || "—",
          planningDate: SAPService.parseDate(
            rec.PlanningDate || rec.Planning_Date,
          ),
          status: rec.PgiStatus || rec.CheckStatus || "Pending",
          delivery: rec.Delivery || "—",
          obdCount: records.length,
        };
      })
      .sort((a, b) => {
        const ta = a.assignedAt?.getTime() || 0;
        const tb = b.assignedAt?.getTime() || 0;
        return tb - ta; // newest first
      });

    if (orders.length === 0) {
      body.innerHTML = `
                <div class="flex-1 flex flex-col items-center justify-center gap-3 pb-20">
                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" class="text-db-text3 opacity-30">
                        <rect x="2" y="2" width="20" height="8" rx="2"/>
                        <rect x="2" y="14" width="20" height="8" rx="2"/>
                        <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
                    </svg>
                    <div class="text-center">
                        <p class="text-db-text3 font-semibold text-sm">No confirmed assignments yet</p>
                        <p class="text-db-text3/60 text-xs mt-1">Assignments from the Fleet Manager or SAP table will appear here.</p>
                    </div>
                </div>`;
      this._updateOrdersStats(0, 0);
      return;
    }

    //  Apply search filter †’ exclude DELIVERED †’ then truck-type filter

    const q = (
      document.getElementById("ordersSearch")?.value || ""
    ).toLowerCase();
    const searched = q
      ? orders.filter(
          (o) =>
            (o.driverName || "").toLowerCase().includes(q) ||
            (o.truckPlate || "").toLowerCase().includes(q) ||
            (o.dispatchKey || "").toLowerCase().includes(q) ||
            (o.route || "").toLowerCase().includes(q),
        )
      : orders;

    //  Exclude DELIVERED —" already fulfilled, no longer needs tracking in orders panel

    const withoutDelivered = searched.filter(
      (o) => (o.delivery || "").toUpperCase() !== "DELIVERED",
    );

    const activeType = this.state.ordersTruckTypeFilter;
    const filtered =
      activeType === "all"
        ? withoutDelivered
        : withoutDelivered.filter((o) => o.truckType === activeType);

    //  Stats (based on ALL orders, not filtered)

    const today = new Date().setHours(0, 0, 0, 0);
    const todayCount = withoutDelivered.filter(
      (o) => o.assignedAt && o.assignedAt.setHours(0, 0, 0, 0) === today,
    ).length;
    this._updateOrdersStats(withoutDelivered.length, todayCount);

    //  Truck type filter chips

    this._renderOrdersTruckTypeChips(withoutDelivered);

    //  Group orders by truck type

    const sc = (s) =>
      s.toUpperCase() === "DELIVERED"
        ? "text-green-400 bg-green-400/10 border-green-400/20"
        : s.toUpperCase() === "IN TRANSIT"
          ? "text-blue-400  bg-blue-400/10  border-blue-400/20"
          : "text-sysu-gold bg-sysu-gold/10 border-sysu-gold/20";

    const gc = (t) => {
      const u = (t || "—").toUpperCase();
      if (u.includes("AUV"))
        return "text-amber-400  bg-amber-500/10  border-amber-500/25";
      if (u.includes("TRUCK"))
        return "text-blue-400   bg-blue-500/10   border-blue-500/25";
      if (u.includes("WING") || u.includes("VAN"))
        return "text-purple-400 bg-purple-500/10 border-purple-500/25";
      if (u.includes("MINI"))
        return "text-green-400  bg-green-500/10  border-green-500/25";
      if (u.includes("FLAT"))
        return "text-orange-400 bg-orange-500/10 border-orange-500/25";
      return "text-db-text3 bg-db-text3/10 border-db-text3/25";
    };

    const gl = (t) => {
      if (!t || t === "—") return "Others";
      const u = t.toUpperCase();
      if (u.includes("AUV")) return "AUV";
      if (u.includes("TRUCK")) return "Truck";
      if (u.includes("WING") || u.includes("VAN")) return "Wing / Van";
      if (u.includes("MINI")) return "Mini";
      if (u.includes("FLAT")) return "Flat Bed";
      return t;
    };

    const ordersByType = {};
    filtered.forEach((o) => {
      const k = o.truckType || "—";
      if (!ordersByType[k]) ordersByType[k] = [];
      ordersByType[k].push(o);
    });

    //  Canonical truck types from the system: AUV, 4W, 6W, 10W, 20F, 40F

    const allTypes = [
      { key: "auv", label: "AUV" },
      { key: "4w", label: "4W" },
      { key: "6w", label: "6W" },
      { key: "10w", label: "10W" },
      { key: "20f", label: "20F" },
      { key: "40f", label: "40F" },
    ];

    const cc = (t) => {
      //  column header + dot color class

      const u = (t || "").toUpperCase();
      if (u === "AUV")
        return {
          bg: "bg-amber-500/15",
          text: "text-amber-400",
          border: "border-amber-500/30",
        };
      if (u === "4W")
        return {
          bg: "bg-sky-500/15",
          text: "text-sky-400",
          border: "border-sky-500/30",
        };
      if (u === "6W")
        return {
          bg: "bg-blue-500/15",
          text: "text-blue-400",
          border: "border-blue-500/30",
        };
      if (u === "10W")
        return {
          bg: "bg-indigo-500/15",
          text: "text-indigo-400",
          border: "border-indigo-500/30",
        };
      if (u === "20F")
        return {
          bg: "bg-purple-500/15",
          text: "text-purple-400",
          border: "border-purple-500/30",
        };
      if (u === "40F")
        return {
          bg: "bg-pink-500/15",
          text: "text-pink-400",
          border: "border-pink-500/30",
        };
      return {
        bg: "bg-db-text3/10",
        text: "text-db-text3",
        border: "border-db-text3/20",
      };
    };
    const dot = (t) => {
      //  dot color only

      const u = (t || "").toUpperCase();
      if (u === "AUV") return "bg-amber-400";
      if (u === "4W") return "bg-sky-400";
      if (u === "6W") return "bg-blue-400";
      if (u === "10W") return "bg-indigo-400";
      if (u === "20F") return "bg-purple-400";
      if (u === "40F") return "bg-pink-400";
      return "bg-db-text3";
    };

    let html = "";
    html +=
      '<div class="flex flex-wrap gap-5 w-full" style="padding:4px 2px 12px;">';

    allTypes.forEach(({ key, label }) => {
      const cards = ordersByType[key] || [];
      const num = cards.length;
      const c = cc(label);
      html +=
        '<div class="flex flex-col gap-3" style="flex:1 0 280px;min-width:280px;">';
      //  Column header

      html += '<div class="flex items-center gap-2 mb-1 px-1">';
      html +=
        '<div class="w-2.5 h-2.5 rounded-full ' +
        dot(label) +
        ' shrink-0"></div>';
      html +=
        '<span class="text-[13px] font-bold uppercase tracking-widest ' +
        c.text +
        '">' +
        escapeHtml(label) +
        "</span>";
      html +=
        '<div class="flex-1 h-px ' +
        c.border.replace("border-", "bg-") +
        ' opacity-30"></div>';
      html +=
        '<span class="text-[11px] font-mono ' +
        c.text +
        ' opacity-70">' +
        num +
        " " +
        (num === 1 ? "order" : "orders") +
        "</span>";
      html += "</div>";
      //  Cards

      if (num === 0) {
        html +=
          '<div class="flex flex-col items-center justify-center py-12 rounded-xl border border-db-border bg-db-panel">';
        html +=
          '<div class="text-db-text3 opacity-30 mb-2"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></div>';
        html +=
          '<span class="text-[11px] text-db-text3 opacity-40">No orders</span>';
        html += "</div>";
      } else {
        cards.forEach((o) => {
          const assignedLabel = o.assignedAt
            ? o.assignedAt.toLocaleString("en-PH", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              })
            : "—";
          const elapsedLabel = o.assignedAt
            ? this._formatElapsed(o.assignedAt)
            : "—";
          const badge =
            o.obdCount > 1
              ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">' +
                o.obdCount +
                " OBDs</span>"
              : "";
          html +=
            '<div class="order-card rounded-xl border border-db-border bg-db-panel cursor-pointer overflow-hidden transition-all hover:border-blue-500/50 hover:shadow-lg" onclick="window.dashboard._openOrderDetail(\'' +
            encodeURIComponent(o.dispatchKey) +
            "')\">";
          html += '<div class="flex items-start gap-4 px-5 pt-4 pb-3">';
          html += '<div class="flex flex-col gap-1 min-w-0">';
          html +=
            '<span class="text-[9px] font-mono uppercase tracking-widest text-db-text3 opacity-50">Dispatch</span>';
          html +=
            '<span class="text-[17px] font-bold font-mono text-db-text leading-none">#' +
            escapeHtml(o.dispatchNum) +
            "</span>" +
            badge;
          html += "</div>";
          html += '<div class="flex-1 min-w-0 pt-0.5">';
          html +=
            '<div class="text-[11px] font-semibold text-db-text2 mb-1 truncate leading-tight">' +
            escapeHtml(o.route) +
            "</div>";
          html +=
            '<span class="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ' +
            sc(o.status) +
            '">' +
            escapeHtml(o.status) +
            "</span>";
          html += "</div>";
          html += '<div class="flex flex-col items-end gap-0.5 shrink-0">';
          html +=
            '<span class="text-[8px] font-bold uppercase tracking-widest text-db-text3 opacity-40">Assigned</span>';
          html +=
            '<span class="text-[10px] font-mono font-semibold text-blue-400">' +
            assignedLabel +
            "</span>";
          html +=
            '<span class="text-[9px] text-db-text3 opacity-50">' +
            elapsedLabel +
            "</span>";
          html += "</div>";
          html += "</div>";
          html +=
            '<div class="flex items-center gap-3 px-5 pb-4 border-t border-db-border pt-2.5 mt-0.5">';
          html +=
            '<div class="flex items-center gap-2.5 rounded-lg px-3 py-2 flex-1 min-w-0 bg-db-bg border border-db-border">';
          html +=
            '<div class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 bg-blue-500/10 text-blue-400">' +
            escapeHtml((o.driverName || "?").charAt(0).toUpperCase()) +
            "</div>";
          html += '<div class="min-w-0">';
          html +=
            '<div class="text-[12px] font-bold text-db-text truncate">' +
            escapeHtml(o.driverName) +
            "</div>";
          html +=
            '<div class="text-[9px] font-mono text-db-text3 opacity-60">' +
            escapeHtml(o.truckPlate) +
            "</div>";
          html += "</div>";
          html += "</div>";
          html +=
            '<div class="flex items-center gap-1.5 text-[9px] text-db-text3 shrink-0 opacity-50">';
          html +=
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>';
          html += escapeHtml(o.planningDate);
          html += "</div>";
          //  Cancel row — dispatcher can roll back this assignment.

          //  If a cancel request is already pending for this

          //  dispatchKey, show a status strip instead of the

          //  dropdown so the dispatcher can't double-submit.

          const isCancelPending = !!(
            document.getElementById("ordersBody") &&
            document.getElementById("ordersBody").dataset[
              "pendingCancel" + o.dispatchKey
            ]
          );
          html +=
            '<div class="flex items-center gap-2 px-5 pb-3 border-t border-db-border pt-2 mt-0.5">';
          if (isCancelPending) {
            html +=
              '<div class="flex-1 h-7 flex items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wider">';
            html +=
              '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="mr-1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
            html += "Cancel pending admin approval</div>";
          } else {
            html +=
              '<select data-action="cancel-reason" data-dispatch="' +
              escapeHtml(o.dispatchKey) +
              '" class="flex-1 h-7 bg-db-bg border border-db-border rounded-md px-2 text-[10px] text-db-text focus:outline-none focus:border-sysu-red/50 cursor-pointer">';
            html +=
              '<option value="" disabled selected>Cancel &mdash; pick a reason</option>';
            html +=
              '<option value="Wrong driver assigned">Wrong driver assigned</option>';
            html +=
              '<option value="Driver unavailable (no-show / offline)">Driver unavailable (no-show / offline)</option>';
            html +=
              '<option value="Customer changed requirements">Customer changed requirements</option>';
            html +=
              '<option value="Dispatch re-routed to another dispatch">Dispatch re-routed to another dispatch</option>';
            html +=
              '<option value="Duplicate assignment (created twice)">Duplicate assignment (created twice)</option>';
            html +=
              '<option value="Other (see dispatcher notes)">Other (see dispatcher notes)</option>';
            html += "</select>";
          }
          html += "</div>";
          html += "</div>";
          html += "</div>";
        });
      }
      html += "</div>";
    });
    html += "</div>";
    body.innerHTML = html;

    //  Wire cancel-reason selects to the rollback flow. We attach via the

    //  parent body (event delegation) so a re-render does not lose the

    //  listener, and so we don't have to bind per-card.

    if (!body.dataset.cancelWired) {
      body.dataset.cancelWired = "1";
      body.addEventListener("change", (evt) => {
        const sel = evt.target.closest('[data-action="cancel-reason"]');
        if (!sel) return;
        const dispatchKey = sel.dataset.dispatch;
        const reason = sel.value;
        if (!dispatchKey || !reason) return;
        this._cancelAssignment(dispatchKey, reason, sel, body);
      });
    }
  }

  _renderOrdersTruckTypeChips(orders) {
    const container = document.getElementById("ordersTruckTypeFilter");
    if (!container) return;

    const types = [
      ...new Set(orders.map((o) => o.truckType).filter(Boolean)),
    ].sort();
    const active = this.state.ordersTruckTypeFilter;

    const typeColor = (t) => {
      if (!t || t === "—")
        return "bg-db-text3/10 text-db-text3 border-db-text3/20";
      const u = t.toUpperCase();
      if (u.includes("AUV"))
        return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      if (u.includes("TRUCK"))
        return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      if (u.includes("WING") || u.includes("VAN"))
        return "bg-purple-500/15 text-purple-400 border-purple-500/30";
      if (u.includes("MINI"))
        return "bg-green-500/15 text-green-400 border-green-500/30";
      if (u.includes("FLAT"))
        return "bg-orange-500/15 text-orange-400 border-orange-500/30";
      return "bg-db-text3/10 text-db-text3 border-db-text3/20";
    };

    const chips = [
      `<button onclick="window.dashboard._setOrdersTruckTypeFilter('all')"
                class="px-3 py-1 rounded-lg text-[10px] font-bold border transition-all shrink-0 ${
                  active === "all"
                    ? "bg-db-text text-[#0e0e18] border-transparent"
                    : "bg-transparent text-db-text3 border-[rgba(255,255,255,0.07)] hover:border-[rgba(255,255,255,0.15)]"
                }">ALL</button>`,
      ...types.map(
        (t) =>
          `<button onclick="window.dashboard._setOrdersTruckTypeFilter(${JSON.stringify(t)})"
                    class="px-3 py-1 rounded-lg text-[10px] font-bold border transition-all shrink-0 ${typeColor(t)} ${
                      active === t
                        ? "ring-1 ring-white/30"
                        : "opacity-70 hover:opacity-100"
                    }">${escapeHtml(t)}</button>`,
      ),
    ];

    container.innerHTML = chips.join("");
  }

  _setOrdersTruckTypeFilter(type) {
    this.state.ordersTruckTypeFilter = type;
    this.renderOrders();
  }

  _updateOrdersStats(total, today) {
    const e = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    e("ordersStatTotal", total);
    e("ordersStatToday", today);
  }

  _openOrderDetail(dispatchKey) {
    //  Reuse SAP dispatch detail modal for now —" shows OBD line items + route info

    if (window.dashboard.openSapDispatchDetail) {
      window.dashboard.openSapDispatchDetail(decodeURIComponent(dispatchKey));
    }
  }

  async exportOrdersExcel() {
    const assignments = this.state.sapAssignments;
    const grouped = this.state.sapGroupedByDispatch;

    //  DISPATCHER NAME = the account owner who is exporting

    const profile = AuthService.getUserProfile();
    const dispatcherName = profile?.displayName || "—";

    //  Build data rows from ASSIGNED dispatches only

    const rows = [];
    Object.entries(assignments).forEach(([key, asgn]) => {
      const records = grouped[key] || [];

      if (records.length === 0) {
        //  Has assignment but no SAP record —" still export with driver data, SAP fields blank

        rows.push({
          "DISPATCHER NAME": dispatcherName,
          "DISPATCH #": key,
          "DRIVER NAME": asgn.driverName || "—",
          "TRUCK TYPE": "—",
          "PLATE #": asgn.truckPlate || "—",
          "TRUCK COMPANY NAME": asgn.truckCompany || "—",
        });
        return;
      }

      //  Skip LCL truck types (matching SAP table filter)

      const firstRec = records[0];
      if ((firstRec.TruckType || "").toUpperCase().trim() === "LCL") {
        return;
      }

      records.forEach((rec) => {
        const row = {
          "DISPATCHER NAME": dispatcherName,
          "DISPATCH #": key,
          "DRIVER NAME": asgn.driverName || "—",
          "TRUCK TYPE": rec.TruckType || "—",
          "PLATE #": asgn.truckPlate || "—",
          "TRUCK COMPANY NAME": asgn.truckCompany || "—",
          QUANTITY: parseFloat(rec.Quantity) || 0,
          "VOLUME (m‚³)": parseFloat(rec.Volume) || 0,
        };
        rows.push(row);
      });
    });

    if (rows.length === 0) {
      this._showToast("There are no assignments to export yet.");
      return;
    }

    const COL_KEYS = [
      "DISPATCHER NAME",
      "DISPATCH #",
      "DRIVER NAME",
      "TRUCK TYPE",
      "PLATE #",
      "TRUCK COMPANY NAME",
      "QUANTITY",
      "VOLUME (m‚³)",
    ];
    const EMPTY_CELL = "—";
    const sheetData = [
      ["SYSU Logistics — Confirmed Assignments"],
      COL_KEYS,
      ...rows.map((r) =>
        COL_KEYS.map((k) => {
          const v = r[k];
          return v === null || v === undefined || v === "" ? EMPTY_CELL : v;
        }),
      ),
    ];

    try {
      const mod = await import("xlsx");
      const XLSX = mod.default || mod;

      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Confirmed Assignments");

      //  Define constants

      const HEADER_FILL = "1B4F72"; // deep navy blue
      const HEADER_FONT = "FFFFFF"; // white
      const HEADER_ALIGN = "center";
      const ROW_STRIPE = "EBF5FB"; // light blue (zebra)
      const ROW_PLAIN = "FFFFFF";
      const BORDER_COLOR = "A9CCE3";
      const STATUS_OK = "117A65";
      const STATUS_ERR = "C0392B";

      const COL_WIDTHS = [24, 14, 22, 14, 14, 20];
      ws["!cols"] = COL_KEYS.map((_, i) => ({ wch: COL_WIDTHS[i] || 12 }));

      //  Title row (row 1)

      const titleCell = (ws["A1"] ||= {});
      titleCell.v = "SYSU Logistics — Confirmed Assignments";
      titleCell.t = "s";
      titleCell.s = {
        font: { bold: true, color: HEADER_FONT, sz: 14 },
        fill: { fgColor: "154360" },
        align: { horizontal: "center", vertical: "center" },
      };

      //  Merge title across all columns

      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: COL_KEYS.length - 1 } },
      ];

      //  Header row (row 2)

      COL_KEYS.forEach((key, ci) => {
        const ref = XLSX.utils.encode_cell({ r: 1, c: ci });
        const cell = (ws[ref] ||= {});
        cell.v = key;
        cell.t = "s";
        cell.s = {
          font: { bold: true, color: HEADER_FONT, sz: 11 },
          fill: { fgColor: HEADER_FILL },
          align: {
            horizontal: HEADER_ALIGN,
            vertical: "center",
            wrapText: true,
          },
          border: {
            top: { style: "thin", color: BORDER_COLOR },
            bottom: { style: "medium", color: BORDER_COLOR },
            left: { style: "thin", color: BORDER_COLOR },
            right: { style: "thin", color: BORDER_COLOR },
          },
        };
      });

      //  Data rows (starting from row 3)

      rows.forEach((row, ri) => {
        const dataRi = ri + 2; // +2: title + header
        const isEven = ri % 2 === 0;
        let rowFill = isEven ? ROW_STRIPE : ROW_PLAIN;
        const status =
          row["Status"] && typeof row["Status"].toLowerCase === "function"
            ? row["Status"].toLowerCase()
            : "";

        COL_KEYS.forEach((key, ci) => {
          const ref = XLSX.utils.encode_cell({ r: dataRi, c: ci });
          const val = row[key];
          const cell = ws[ref] || {};

          //  Set value

          if (val !== "—" && val !== "" && val !== null && val !== undefined) {
            if (typeof val === "number") {
              cell.v = val;
              cell.t = "n";
              //  Apply number format to numeric columns

              if (key === "Amount") cell.z = "#,##0.00";
              else if (key === "Volume (m‚³)") cell.z = "#,##0.000";
              else if (key === "Weight (kg)") cell.z = "#,##0.00";
              else if (key === "Quantity") cell.z = "#,##0.000";
              else if (key === "Latitude" || key === "Longitude")
                cell.z = "0.000000";
            } else {
              cell.v = val;
              cell.t = "s"; // treat as number string so Excel can display with format
              //  If the string is the QUANTITY column, mark as number type with format

              if (key === "Quantity" && !isNaN(Number(val))) {
                cell.v = Number(val);
                cell.t = "n";
                cell.z = "#,##0.000";
              }
            }
          } else {
            cell.v = "—";
            cell.t = "s";
          }

          //  Status cell colouring

          let textColor = "1B2631";
          if (key === "Status" && status) {
            rowFill = status.includes("delivered")
              ? "D5F5E3"
              : status.includes("pending")
                ? "FDEBD0"
                : status.includes("cancelled")
                  ? "FADBD8"
                  : status.includes("transit")
                    ? "D6EAF8"
                    : rowFill;
            textColor = status.includes("delivered")
              ? STATUS_OK
              : status.includes("cancelled")
                ? STATUS_ERR
                : "1B2631";
          }

          cell.s = {
            fill: { fgColor: rowFill },
            font: { color: textColor, sz: 10 },
            align: { vertical: "center" },
            border: {
              top: { style: "thin", color: BORDER_COLOR },
              bottom: { style: "thin", color: BORDER_COLOR },
              left: { style: "thin", color: BORDER_COLOR },
              right: { style: "thin", color: BORDER_COLOR },
            },
          };
        });

        //  Alternating row heights (taller for readability)

        const rowRef = (ws["!rows"] ||= []);
        rowRef[dataRi] = { hpt: 18 };
      });

      //  Auto-filter on header row

      ws["!autofilter"] = {
        ref: `A2:${XLSX.utils.encode_cell({ r: 1, c: COL_KEYS.length - 1 })}`,
      };

      //  Freeze top 2 rows

      ws["!freeze"] = { xSplit: 0, ySplit: 2, topLeftCell: "A3" };

      //  Page setup

      ws["!pageSetup"] = {
        paperSize: 9, // A4
        orientation: "landscape",
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalDpi: 300,
        verticalDpi: 300,
      };
      ws["!margins"] = {
        left: 0.5,
        right: 0.5,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3,
      };

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `SYSU_Assignments_${today}.xlsx`);
    } catch (e) {
      console.error("Excel export error:", e);
      this._notifyFailure(
        "assignment-export",
        e,
        "The spreadsheet could not be exported. Please try again.",
      );
    }
  }

  _formatAssignedAt(ts) {
    if (!ts) return "—";
    const date = ts.toDate
      ? ts.toDate()
      : ts.seconds
        ? new Date(ts.seconds * 1000)
        : null;
    if (!date) return "—";
    return date.toLocaleString("en-PH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  _formatElapsed(date) {
    if (!date) return "just now";
    if (typeof date.toDate === "function") date = date.toDate();
    else if (typeof date.seconds === "number")
      date = new Date(date.seconds * 1000);
    else if (!(date instanceof Date)) date = new Date(date);
    if (!Number.isFinite(date.getTime())) return "just now";
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h < 24) return `${h}h ${m}m ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.dashboard = new Dashboard();
  window.dashboard.init();
});
