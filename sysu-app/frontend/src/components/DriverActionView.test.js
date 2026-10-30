import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const result = {
    getSessions: vi.fn(),
    getEvents: vi.fn(),
    searchShipmentDrivers: vi.fn(),
    requestDeletion: vi.fn(),
    getDeletionRequests: vi.fn(),
    decideDeletion: vi.fn(),
    subscribeUpdated: vi.fn(() => () => {}),
    markers: [],
    circles: [],
    polylines: [],
    layers: [],
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    mapEvents: {},
  };
  result.map = {
    on: vi.fn((name, handler) => {
      result.mapEvents[name] = handler;
    }),
    off: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    invalidateSize: vi.fn(),
    setView: vi.fn(),
    flyTo: result.flyTo,
    fitBounds: result.fitBounds,
  };
  return result;
});

vi.mock("../api/driverActionService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DriverActionService: {
      getSessions: mocks.getSessions,
      getEvents: mocks.getEvents,
      searchShipmentDrivers: mocks.searchShipmentDrivers,
      requestDeletion: mocks.requestDeletion,
      getDeletionRequests: mocks.getDeletionRequests,
      decideDeletion: mocks.decideDeletion,
      subscribeUpdated: mocks.subscribeUpdated,
    },
  };
});
vi.mock("./MapManager.js", () => ({
  initLeafletMap: vi.fn(() => mocks.map),
  disposeLeafletMap: vi.fn(),
}));
vi.mock("leaflet", () => {
  const makeLayer = (kind, location, options = {}) => {
    const layer = {
      kind,
      location,
      options,
      style: {},
      handlers: {},
      ...(kind === "polyline" ? { points: location } : {}),
      addTo: vi.fn(() => {
        mocks.layers.push(layer);
        return layer;
      }),
      bindPopup: vi.fn((value) => {
        layer.popup = value;
        return layer;
      }),
      bindTooltip: vi.fn((value) => {
        layer.tooltip = { text: value };
        return layer;
      }),
      on: vi.fn((name, handler) => {
        layer.handlers[name] = handler;
        return layer;
      }),
      setStyle: vi.fn((value) => {
        Object.assign(layer.options, value);
        Object.assign(layer.style, value);
        return layer;
      }),
      openPopup: vi.fn(() => {
        layer.popupOpened = true;
      }),
      getElement: vi.fn(() => ({ setAttribute: vi.fn() })),
    };
    if (kind === "marker") mocks.markers.push(layer);
    if (kind === "circle") mocks.circles.push(layer);
    if (kind === "polyline") mocks.polylines.push(layer);
    return layer;
  };
  return {
    default: {
      marker: (location, options) => makeLayer("marker", location, options),
      circleMarker: (location, options) =>
        makeLayer("circle", location, options),
      polyline: (points, options) => makeLayer("polyline", points, options),
      divIcon: (options) => options,
      latLngBounds: (points) => ({ points }),
    },
  };
});

const defaultSessions = () => ({
  items: [
    { id: "session-one", startedAtMs: 2000, status: "active" },
    { id: "session-two", startedAtMs: 1000, status: "completed" },
  ],
  nextCursor: null,
});
beforeEach(() => {
  mocks.getSessions
    .mockReset()
    .mockImplementation(async () => defaultSessions());
  mocks.searchShipmentDrivers
    .mockReset()
    .mockResolvedValue({ drivers: [], truncated: false });
  mocks.getEvents.mockReset().mockResolvedValue({
    items: [
      {
        eventId: "route-a",
        eventType: "route_point",
        sequence: 1,
        lat: 14.6,
        lng: 121.0,
        accuracy: 5,
        occurredAtMs: 1000,
      },
      {
        eventId: "route-b",
        eventType: "route_point",
        sequence: 2,
        lat: 14.7,
        lng: 121.1,
        occurredAtMs: 2000,
      },
      {
        eventId: "pod-default",
        eventType: "pod_captured",
        sequence: 3,
        lat: 14.8,
        lng: 121.2,
        accuracy: 5,
        occurredAtMs: 3000,
      },
    ],
    nextCursor: null,
  });
  mocks.requestDeletion
    .mockReset()
    .mockResolvedValue({ requestId: "request-1", status: "pending" });
  mocks.getDeletionRequests.mockReset().mockResolvedValue([]);
  mocks.decideDeletion.mockReset();
  mocks.subscribeUpdated.mockClear();
  mocks.markers.length = 0;
  mocks.circles.length = 0;
  mocks.polylines.length = 0;
  mocks.layers.length = 0;
  mocks.fitBounds.mockClear();
  mocks.flyTo.mockClear();
  mocks.mapEvents = {};
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const openDriver = async ({ isAdmin = false, onViewPod } = {}) => {
  const { DriverActionView } = await import("./DriverActionView.js");
  const container = document.createElement("div");
  document.body.append(container);
  const view = new DriverActionView({
    container,
    drivers: [
      { id: "driver-one", name: "Synthetic Driver", company: "Test fleet" },
    ],
    liveTracking: {},
    canView: true,
    isAdmin,
    onViewPod,
  });
  view.mount();
  container.querySelector('[data-driver-id="driver-one"]').click();
  await vi.waitFor(() =>
    expect(container.querySelector("details[data-session-id]")).not.toBeNull(),
  );
  return { container, view };
};

describe("DriverActionView session controls", () => {
  it("requires explicit confirmation before an administrator permanently removes a session", async () => {
    mocks.getDeletionRequests.mockResolvedValue([
      {
        id: "request-delete-one",
        driverId: "driver-one",
        sessionId: "session-one",
        requestedByRole: "fleet_manager",
        reason: "Duplicate session record",
        requestedAt: Date.now(),
      },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container, view } = await openDriver({ isAdmin: true });
    container.querySelector("#driverActionReviewRequests").click();
    await vi.waitFor(() =>
      expect(container.querySelector('[data-request-id="request-delete-one"]')).not.toBeNull(),
    );
    container.querySelector('[data-request-id="request-delete-one"] [data-decide="approved"]').click();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("permanent deletion"));
    expect(mocks.decideDeletion).not.toHaveBeenCalled();
    confirm.mockRestore();
    view.destroy();
    container.remove();
  });

  it("renders driver action details in labeled columns with readable contrast", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const view = Object.create(DriverActionView.prototype);
    const detail = document.createElement("div");
    detail.innerHTML = '<div class="session-events text-db-text"></div>';
    view._renderTimeline(detail, {
      items: [
        {
          eventId: "qr-scan",
          eventType: "qr_scan",
          occurredAtMs: Date.parse("2026-10-27T03:20:24Z"),
          outcome: "success",
          locationState: "unavailable",
        },
      ],
      nextCursor: null,
    });

    const event = detail.querySelector(".session-events > ol > li");
    expect(event.className).toContain("text-db-text");
    expect(event.querySelector("h4").textContent).toBe("QR scanned");
    expect(event.querySelector("dl").className).toContain("grid-cols-");
    expect(
      [...event.querySelectorAll("dt")].map((cell) => cell.textContent),
    ).toEqual(["Time", "Result", "Location"]);
    expect(
      [...event.querySelectorAll("dd")].map((cell) => cell.textContent),
    ).toEqual(["10/27/2026, 11:20:24 AM", "success", "Unavailable"]);
    expect(detail.querySelector(".session-events").className).toContain(
      "text-db-text",
    );
  });

  it("uses readable export controls and explains the unfiltered session list", async () => {
    const { container, view } = await openDriver();
    const drawer = container.querySelector("#driverActionDrawer");
    const exportPanel = drawer.querySelector("[data-export-panel]");
    expect(drawer.className).toContain("w-[460px]");
    expect(drawer.querySelector("h2").className).toContain("text-base");
    expect(exportPanel.open).toBe(false);
    expect(
      exportPanel.querySelector("[data-export-shipment]").className,
    ).toContain("text-[13px]");
    expect(exportPanel.querySelector("[data-export-from]").className).toContain(
      "h-10",
    );
    expect(
      exportPanel.querySelector("[data-session-filter-status]").textContent,
    ).toContain("Showing all 2 saved sessions");
    expect(drawer.querySelector("#driverActionSessions h3").textContent).toBe(
      "Action sessions",
    );
    expect(
      drawer.querySelector("details[data-session-id] summary").className,
    ).toContain("p-4");
    view.destroy();
    container.remove();
  });

  it("keeps export filters collapsible inside the session drawer", async () => {
    const { container, view } = await openDriver();
    const drawer = container.querySelector("#driverActionDrawer");
    const exportPanel = drawer.querySelector("[data-export-panel]");
    expect(container.querySelector("#driverActionExportModal")).toBeNull();
    expect(exportPanel.open).toBe(false);
    exportPanel.querySelector("summary").click();
    expect(exportPanel.open).toBe(true);
    expect(drawer.getAttribute("aria-hidden")).toBe("false");
    expect(exportPanel.querySelector("[data-export-csv]")).not.toBeNull();
    view.destroy();
    container.remove();
  });

  it("opens a driver export directly from the directory in one click", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const container = document.createElement("div");
    document.body.append(container);
    const view = new DriverActionView({
      container,
      drivers: [
        { id: "driver-one", name: "Synthetic Driver", company: "Test fleet" },
      ],
      liveTracking: {},
      canView: true,
    });
    view.mount();

    container.querySelector("[data-driver-export]").click();
    const exportPanel = container.querySelector("#driverActionDrawer [data-export-panel]");
    expect(exportPanel.open).toBe(true);
    expect(exportPanel.querySelector("[data-export-driver]").textContent).toBe(
      "Synthetic Driver",
    );
    await vi.waitFor(() =>
      expect(exportPanel.querySelector("[data-export-csv]").disabled).toBe(
        false,
      ),
    );
    view.destroy();
    container.remove();
  });

  it("lets a dispatcher request removal while keeping the review queue hidden", async () => {
    const { container, view } = await openDriver();
    const session = container.querySelector("details[data-session-id]");
    session.open = true;
    expect(session.querySelector("[data-open-delete-form]")).not.toBeNull();
    expect(container.querySelector("#driverActionReviewRequests")).toBeNull();
    view.destroy();
    container.remove();
  });

  it("finds a driver by shipment number and opens that shipment filter", async () => {
    mocks.searchShipmentDrivers.mockResolvedValueOnce({
      drivers: [{ driverId: "driver-one", shipmentIds: ["0010136311"] }],
      truncated: false,
    });
    mocks.getSessions.mockResolvedValueOnce({
      items: [
        { id: "matching-session", startedAtMs: 2000, status: "completed" },
        { id: "other-session", startedAtMs: 1000, status: "completed" },
      ],
      nextCursor: null,
    });
    mocks.getEvents.mockImplementation(async (_driverId, sessionId) => ({
      items:
        sessionId === "matching-session"
          ? [
              {
                eventId: "shipment-event",
                eventType: "shipment_assigned",
                sequence: 1,
                subjectId: "0010136311",
                occurredAtMs: 2000,
              },
            ]
          : [
              {
                eventId: "different-shipment",
                eventType: "shipment_assigned",
                sequence: 1,
                subjectId: "99999999",
                occurredAtMs: 1000,
              },
            ],
      nextCursor: null,
    }));
    const { DriverActionView } = await import("./DriverActionView.js");
    const container = document.createElement("div");
    document.body.append(container);
    const view = new DriverActionView({
      container,
      drivers: [
        { id: "driver-one", name: "Synthetic Driver", company: "Test fleet" },
      ],
      liveTracking: {},
      canView: true,
    });
    view.mount();
    const search = container.querySelector("#driverActionSearch");
    search.value = "311";
    search.dispatchEvent(new Event("input"));
    await vi.waitFor(() =>
      expect(mocks.searchShipmentDrivers).toHaveBeenCalledWith("311"),
    );
    const driverButton = await vi.waitFor(() => {
      const button = container.querySelector('[data-driver-id="driver-one"]');
      expect(button?.dataset.shipmentId).toBe("0010136311");
      return button;
    });
    expect(
      container.querySelector("#driverActionSearchStatus").textContent,
    ).toContain("1 driver found");
    driverButton.click();
    await vi.waitFor(() =>
      expect(container.querySelector("[data-export-shipment]").value).toBe(
        "0010136311",
      ),
    );
    await vi.waitFor(() => {
      const sessionIds = [
        ...container.querySelectorAll("details[data-session-id]"),
      ].map((row) => row.dataset.sessionId);
      expect(sessionIds).toEqual(["matching-session"]);
    });
    view.destroy();
    container.remove();
  });

  it("provides an accessible driver-directory toggle for narrow map layouts", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const container = document.createElement("div");
    document.body.append(container);
    const view = new DriverActionView({
      container,
      drivers: [],
      liveTracking: {},
      canView: true,
    });
    view.mount();
    const toggle = container.querySelector("#driverActionDirectoryToggle");
    const panel = container.querySelector("#driverActionDirectoryPanel");
    expect(toggle.getAttribute("aria-controls")).toBe(
      "driverActionDirectoryPanel",
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(panel.classList.contains("is-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Hide drivers");
    view.destroy();
    container.remove();
  });

  it("uses queue join and confirmed arrival for the session total in Manila time", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const container = document.createElement("div");
    container.innerHTML = '<div id="driverActionSessions"></div>';
    const view = Object.create(DriverActionView.prototype);
    view.container = container;
    view.sessions = [
      {
        id: "completed-session",
        status: "completed",
        startedAt: { $timestamp: 1000 },
        completedAt: { $timestamp: 3601000 },
        tripStartedAt: { $timestamp: Date.parse("2026-10-27T10:05:52Z") },
        tripCompletedAt: { $timestamp: Date.parse("2026-10-27T10:33:37Z") },
        shipments: ["0010140501", "0010140502"],
      },
    ];
    view._eventLoads = new Map();
    view._renderSessions();
    const cardText = container.querySelector("[data-session-id]").textContent;
    expect(cardText).toContain("Driver Trip Session");
    expect(cardText).toContain("Session started 10/27/2026, 6:05:52 PM");
    expect(cardText).toContain("Session total 27 min 45 sec");
    expect(cardText).toContain("Assigned shipments");
    expect(cardText).toContain("0010140501");
    expect(cardText).toContain("0010140502");
    expect(cardText).not.toContain("53 min");
    view.destroy();
  });

  it("shows an unconfirmed end when a completed legacy record has no completion time", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const container = document.createElement("div");
    container.innerHTML = '<div id="driverActionSessions"></div>';
    const view = Object.create(DriverActionView.prototype);
    view.container = container;
    view.sessions = [
      {
        id: "unknown-trip",
        status: "completed",
        startedAtMs: 1000,
        completedAtMs: 900000,
        tripStartedAt: { $timestamp: 0 },
        tripCompletedAt: { $timestamp: 0 },
      },
    ];
    view._eventLoads = new Map();
    view._renderSessions();
    const cardText = container.querySelector("[data-session-id]").textContent;
    expect(cardText).toContain("App Activity Session");
    expect(cardText).toContain("Completed status · final end unconfirmed");
    expect(cardText).toContain("Session end unconfirmed");
    view.destroy();
  });

  it("names an app-only active record as app activity", async () => {
    const { container, view } = await openDriver();
    const row = container.querySelector('[data-session-id="session-one"]');
    expect(row.querySelector("summary").textContent).toContain(
      "App Activity Session",
    );
    expect(row.querySelector("summary").textContent).not.toContain(
      "unavailable",
    );
    view.destroy();
    container.remove();
  });
  it("names a queued record as a driver trip session", async () => {
    mocks.getSessions.mockResolvedValueOnce({
      items: [
        {
          id: "queued-session",
          status: "completed",
          tripStartedAt: { $timestamp: 1000 },
          tripCompletedAt: { $timestamp: 61000 },
        },
      ],
      nextCursor: null,
    });
    const { container, view } = await openDriver();
    const row = container.querySelector('[data-session-id="queued-session"]');
    expect(row.querySelector("summary").textContent).toContain(
      "Driver Trip Session",
    );
    view.destroy();
    container.remove();
  });
  it("does not use broad audit-session bounds as trip duration but still shows the confirmed end", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const container = document.createElement("div");
    container.innerHTML = '<div id="driverActionSessions"></div>';
    const view = Object.create(DriverActionView.prototype);
    view.container = container;
    view.sessions = [
      {
        id: "session-bounds",
        status: "completed",
        startedAt: { $timestamp: Date.parse("2026-10-27T10:05:58Z") },
        completedAt: { $timestamp: Date.parse("2026-10-27T10:20:17Z") },
        tripStartedAt: { $timestamp: 0 },
        tripCompletedAt: { $timestamp: Date.parse("2026-10-27T10:20:25Z") },
      },
    ];
    view._eventLoads = new Map();

    view._renderSessions();

    const cardText = container.querySelector("[data-session-id]").textContent;
    expect(cardText).not.toContain("unavailable");
    expect(cardText).not.toContain("Session total");
    expect(cardText).toContain("Session ended 10/27/2026, 6:20:25 PM");
  });

  it("does not treat returning-to-base as proof that the session ended", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const container = document.createElement("div");
    container.innerHTML = '<div id="driverActionSessions"></div>';
    const view = Object.create(DriverActionView.prototype);
    view.container = container;
    view.sessions = [
      {
        id: "returning-session",
        status: "active",
        startedAt: { $timestamp: Date.parse("2026-10-27T10:05:58Z") },
        completedAt: null,
        tripStartedAt: { $timestamp: 0 },
        tripCompletedAt: { $timestamp: 0 },
      },
    ];
    view._eventLoads = new Map();

    view._renderSessions();

    const cardText = container.querySelector("[data-session-id]").textContent;
    expect(cardText).not.toContain("unavailable");
    expect(cardText).not.toContain("Session ended");
  });

  it("loads and plots each session only on its own button click, with independent progress", async () => {
    let finishFirst;
    mocks.getEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const { container, view } = await openDriver();
    const rows = [...container.querySelectorAll("details[data-session-id]")];
    expect(rows.every((row) => !row.open)).toBe(true);
    expect(mocks.getEvents).not.toHaveBeenCalled();

    rows[0].querySelector("[data-load-plot]").click();
    await vi.waitFor(() =>
      expect(rows[0].querySelector("[data-load-plot]").textContent).toBe(
        "Loading plots…",
      ),
    );
    expect(rows[1].querySelector("[data-load-plot]").textContent).toBe(
      "Load plots",
    );
    finishFirst({
      items: [
        {
          eventId: "route-1",
          eventType: "route_point",
          sequence: 1,
          lat: 14.6,
          lng: 121.0,
          accuracy: 5,
        },
        {
          eventId: "route-2",
          eventType: "route_point",
          sequence: 2,
          lat: 14.7,
          lng: 121.1,
        },
        {
          eventId: "pod-1",
          eventType: "pod_captured",
          sequence: 3,
          lat: 14.8,
          lng: 121.2,
          accuracy: 5,
        },
      ],
      nextCursor: null,
    });
    await vi.waitFor(() =>
      expect(rows[0].querySelector("[data-plot-state]").textContent).toContain(
        "3 mapped locations",
      ),
    );
    const routeGroup = rows[0].querySelector("[data-route-location-group]");
    expect(routeGroup).not.toBeNull();
    expect(routeGroup.open).toBe(false);
    expect(routeGroup.querySelector("summary").textContent).toContain(
      "Route locations (2 loaded)",
    );
    expect(routeGroup.querySelectorAll("ol > li")).toHaveLength(2);
    expect(routeGroup.textContent).toContain("GPS accuracy5 m");
    routeGroup.open = true;
    routeGroup.querySelector('[data-route-point-index="0"]').click();
    expect(mocks.flyTo).toHaveBeenCalledWith([14.7, 121.1], 17, {
      duration: 0.45,
    });
    expect(mocks.circles[1].style).toMatchObject({
      radius: 9,
      fillColor: "#c8102e",
    });
    expect(mocks.circles[1].popupOpened).toBe(true);
    expect(mocks.circles[1].popup).toContain("Recorded at:");
    expect(mocks.circles[1].tooltip.text).toBe("Time unavailable");
    expect(mocks.fitBounds).toHaveBeenCalledTimes(1);
    expect(mocks.markers).toHaveLength(1);
    expect(mocks.circles).toHaveLength(2);
    expect(mocks.markers[0].options.title).toContain("Driver took POD here");
    expect(mocks.markers[0].options.icon.iconSize).toEqual([50, 50]);
    expect(mocks.markers[0].options.icon.iconAnchor).toEqual([25, 47]);
    expect(mocks.markers[0].popup).toContain("GPS accuracy");
    expect(mocks.polylines).toHaveLength(2);
    expect(mocks.polylines[0].options).toMatchObject({
      color: "#fff",
      weight: 8,
      interactive: false,
    });
    expect(mocks.polylines[1].options).toMatchObject({
      color: "#16a34a",
      weight: 4,
      interactive: true,
      bubblingMouseEvents: false,
    });

    rows[1].querySelector("[data-load-plot]").click();
    await vi.waitFor(() => expect(mocks.getEvents).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(rows[1].querySelector("[data-plot-state]").textContent).toContain(
        "3 mapped locations",
      ),
    );
    expect(mocks.fitBounds).toHaveBeenCalledTimes(2);
    expect(mocks.getEvents).toHaveBeenNthCalledWith(
      1,
      "driver-one",
      "session-one",
      200,
    );
    expect(mocks.getEvents).toHaveBeenNthCalledWith(
      2,
      "driver-one",
      "session-two",
      200,
    );
    view.destroy();
    container.remove();
  });

  it("paginates route-location details so 1,000 points never render as one long list", async () => {
    const { DriverActionView } = await import("./DriverActionView.js");
    const view = Object.create(DriverActionView.prototype);
    const detail = document.createElement("div");
    detail.innerHTML = '<div class="session-events"></div>';
    const page = {
      items: Array.from({ length: 1000 }, (_, index) => ({
        eventId: `route-${index}`,
        eventType: "route_point",
        sequence: index,
        lat: 14 + index / 100000,
        lng: 121 + index / 100000,
        occurredAtMs: index + 1,
        accuracy: 5,
      })),
      nextCursor: null,
    };

    view._renderTimeline(detail, page);

    const routeGroup = detail.querySelector("[data-route-location-group]");
    expect(routeGroup.querySelector("summary").textContent).toContain(
      "Route locations (1000 loaded)",
    );
    expect(routeGroup.querySelectorAll("ol > li")).toHaveLength(50);
    expect(routeGroup.textContent).toContain("Points 1–50 of 1000");
    routeGroup.querySelector('[data-route-page="older"]').click();
    expect(
      detail.querySelectorAll("[data-route-location-group] ol > li"),
    ).toHaveLength(50);
    expect(
      detail.querySelector("[data-route-location-group]").textContent,
    ).toContain("Points 51–100 of 1000");
    detail.querySelector('[data-route-page="newer"]').click();
    expect(
      detail.querySelector("[data-route-location-group]").textContent,
    ).toContain("Points 1–50 of 1000");
  });

  it("keeps lifecycle markers on their exact GPS point and exposes co-located actions in a clickable cluster", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      items: [
        {
          eventId: "open",
          eventType: "app_open",
          sequence: 1,
          lat: 14.6,
          lng: 121.0,
        },
        {
          eventId: "load",
          eventType: "loading_started",
          sequence: 2,
          lat: 14.6,
          lng: 121.0,
        },
        {
          eventId: "route",
          eventType: "route_point",
          sequence: 3,
          lat: 14.6,
          lng: 121.0,
        },
      ],
      nextCursor: null,
    });
    const { container, view } = await openDriver();
    const row = container.querySelector(
      'details[data-session-id="session-one"]',
    );
    row.querySelector("[data-load-plot]").click();
    await vi.waitFor(() =>
      expect(row.querySelector("[data-plot-state]").textContent).toContain(
        "3 mapped locations",
      ),
    );
    expect(mocks.markers).toHaveLength(1);
    expect(mocks.markers[0].options.title).toContain(
      "2 driver actions at this GPS point",
    );
    expect(mocks.markers[0].options.icon.html).toContain(
      "driver-action-marker__count",
    );
    expect(mocks.markers[0].options.icon.html).toContain(">2</span>");
    expect(mocks.markers[0].options.icon.html).not.toContain(
      "driver-action-marker--screen",
    );
    expect(mocks.markers[0].options.icon.html).not.toContain(
      "driver-action-marker--loading",
    );
    expect(mocks.markers[0].location).toEqual([14.6, 121.0]);
    expect(mocks.markers[0].popup).toContain("App opened");
    expect(mocks.markers[0].popup).toContain("Loading started");
    expect(mocks.markers[0].popup).toContain(
      "Recorded GPS: 14.60000, 121.00000",
    );
    expect(mocks.circles).toHaveLength(1);
    expect(mocks.polylines).toHaveLength(0);
    expect(mocks.layers).toHaveLength(2);
    view.destroy();
    container.remove();
  });

  it("shows PODs on separate orange markers with their shipment and OBD references", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      items: [
        {
          eventId: "open",
          eventType: "app_open",
          sequence: 1,
          lat: 14.6,
          lng: 121.0,
          occurredAtMs: 1000,
        },
        {
          eventId: "pod-a",
          eventType: "pod_captured",
          sequence: 2,
          subjectId: "0010140501",
          metadata: { obdRef: "OBD-1" },
          lat: 14.6,
          lng: 121.0,
          occurredAtMs: 2000,
        },
        {
          eventId: "pod-b",
          eventType: "pod_captured",
          sequence: 3,
          subjectId: "0010140501",
          metadata: { obdRef: "OBD-2" },
          lat: 14.7,
          lng: 121.1,
          occurredAtMs: 3000,
        },
      ],
      nextCursor: null,
    });
    const onViewPod = vi.fn();
    const { container, view } = await openDriver({ onViewPod });
    const row = container.querySelector(
      'details[data-session-id="session-one"]',
    );
    row.querySelector("[data-load-plot]").click();
    await vi.waitFor(() =>
      expect(row.querySelector("[data-plot-state]").textContent).toContain(
        "3 mapped locations",
      ),
    );

    const podMarkers = mocks.markers.filter((marker) =>
      marker.options.icon.html.includes("driver-action-marker--pod"),
    );
    expect(podMarkers).toHaveLength(2);
    expect(podMarkers.map((marker) => marker.location)).toEqual([
      [14.6, 121.0],
      [14.7, 121.1],
    ]);
    expect(podMarkers.every((marker) => marker.options.zIndexOffset === 1000)).toBe(true);
    expect(podMarkers[0].options.icon.html).toContain('stroke="currentColor"');
    expect(podMarkers[0].options.icon.html).toContain("M12 16C13.6569 16");
    expect(podMarkers[0].options.title).toContain("OBD OBD-1");
    expect(podMarkers[0].options.title).toContain("shipment 0010140501");
    expect(podMarkers[0].options.title).toContain("Driver took POD here");
    expect(podMarkers[0].popup).toContain("Driver took POD here");
    expect(podMarkers[0].popup).toContain("Shipment #: 0010140501");
    expect(podMarkers[0].popup).toContain("OBD #: OBD-1");
    expect(podMarkers[0].popup).toContain('data-view-pod');
    expect(podMarkers[1].popup).toContain("OBD #: OBD-2");
    const popupElement = document.createElement("div");
    popupElement.innerHTML = podMarkers[0].popup;
    mocks.mapEvents.popupopen({ popup: { getElement: () => popupElement } });
    popupElement.querySelector("[data-view-pod]").click();
    expect(onViewPod).toHaveBeenCalledWith("0010140501", "OBD-1");
    const actionMarker = mocks.markers.find(
      (marker) => !marker.options.icon.html.includes("driver-action-marker--pod"),
    );
    expect(actionMarker.options.zIndexOffset).toBe(0);
    expect(actionMarker.popup).toContain("App opened");
    view.destroy();
    container.remove();
  });

  it("offers the saved POD from its driver action when shipment and OBD are linked", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      items: [{
        eventId: "pod-view",
        eventType: "pod_captured",
        sequence: 1,
        subjectId: "0010138488",
        metadata: { obdRef: "6801008015" },
        lat: 14.69422,
        lng: 121.04513,
        occurredAtMs: 1000,
        outcome: "success",
      }],
      nextCursor: null,
    });
    const onViewPod = vi.fn();
    const { container, view } = await openDriver({ onViewPod });
    const row = container.querySelector('details[data-session-id="session-one"]');
    row.querySelector("[data-load-plot]").click();

    const button = await vi.waitFor(() => {
      const result = row.querySelector("[data-view-pod]");
      expect(result).not.toBeNull();
      return result;
    });
    expect(button.textContent).toBe("View POD");
    expect(button.dataset.shipment).toBe("0010138488");
    expect(button.dataset.obd).toBe("6801008015");
    button.click();
    expect(onViewPod).toHaveBeenCalledWith("0010138488", "6801008015");
    view.destroy();
    container.remove();
  });

  it("provides a simple map key for actions, GPS points, and route colors", async () => {
    const { container, view } = await openDriver();
    const key = container.querySelector("#driverActionMapKey");
    expect(key?.querySelector("summary")?.textContent).toBe("Map key");
    expect(key?.textContent).toContain("Action");
    expect(key?.textContent).toContain("POD");
    expect(key?.textContent).toContain("GPS");
    expect(key?.textContent).toContain("Outbound");
    expect(key?.textContent).toContain("Return");
    expect(key?.querySelector("p")).toBeNull();
    view.destroy();
    container.remove();
  });
  it("renders outbound route green and return-to-base route blue", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      items: [
        {
          eventId: "trip-start",
          eventType: "transit_started",
          sequence: 1,
          occurredAtMs: 1000,
        },
        {
          eventId: "out-1",
          eventType: "route_point",
          sequence: 2,
          lat: 14.6,
          lng: 121.0,
          occurredAtMs: 2000,
        },
        {
          eventId: "out-2",
          eventType: "route_point",
          sequence: 3,
          lat: 14.7,
          lng: 121.1,
          occurredAtMs: 3000,
        },
        {
          eventId: "return",
          eventType: "returning_to_base",
          sequence: 4,
          lat: 14.8,
          lng: 121.2,
          occurredAtMs: 4000,
        },
        {
          eventId: "back-1",
          eventType: "route_point",
          sequence: 5,
          lat: 14.9,
          lng: 121.3,
          occurredAtMs: 5000,
        },
      ],
      nextCursor: null,
    });
    const { container, view } = await openDriver();
    const row = container.querySelector(
      'details[data-session-id="session-one"]',
    );
    row.querySelector("[data-load-plot]").click();
    await vi.waitFor(() =>
      expect(row.querySelector("[data-plot-state]").textContent).toContain(
        "4 mapped locations",
      ),
    );
    expect(mocks.polylines).toHaveLength(4);
    expect(mocks.polylines[1].options).toMatchObject({ color: "#16a34a" });
    expect(mocks.polylines[1].points).toEqual([
      [14.6, 121.0],
      [14.7, 121.1],
    ]);
    expect(mocks.polylines[3].options).toMatchObject({ color: "#2563eb" });
    expect(mocks.polylines[3].points).toEqual([
      [14.8, 121.2],
      [14.9, 121.3],
    ]);
    expect(mocks.fitBounds).toHaveBeenCalledWith(
      expect.objectContaining({
        points: [
          [14.6, 121.0],
          [14.7, 121.1],
          [14.8, 121.2],
          [14.9, 121.3],
        ],
      }),
      { padding: [48, 48], maxZoom: 14 },
    );
    mocks.polylines[1].handlers.click();
    expect(mocks.polylines[0].options.opacity).toBe(0.88);
    expect(mocks.polylines[1].options.opacity).toBe(0.96);
    expect(mocks.polylines[2].options.opacity).toBe(0);
    expect(mocks.polylines[3].options.opacity).toBe(0);
    mocks.polylines[3].handlers.click();
    expect(
      mocks.polylines.slice(0, 2).map((layer) => layer.options.opacity),
    ).toEqual([0, 0]);
    expect(mocks.polylines[2].options.opacity).toBe(0.88);
    expect(mocks.polylines[3].options.opacity).toBe(0.96);
    mocks.mapEvents.click({ layer: mocks.polylines[3] });
    expect(
      mocks.polylines.slice(0, 2).map((layer) => layer.options.opacity),
    ).toEqual([0, 0]);
    mocks.mapEvents.click();
    expect(mocks.polylines.map((layer) => layer.options.opacity)).toEqual([
      0.88, 0.96, 0.88, 0.96,
    ]);
    expect(mocks.markers.length + mocks.circles.length).toBeGreaterThan(0);
    view.destroy();
    container.remove();
  });
  it("exports saved actions across all driver sessions from the separate export modal", async () => {
    let exportedBlob;
    const createObjectURL = vi.fn((blob) => {
      exportedBlob = blob;
      return "blob:shipment-report";
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function () {});
    mocks.getSessions
      .mockReset()
      .mockResolvedValueOnce({
        items: [{ id: "session-one", startedAtMs: 2000, status: "active" }],
        nextCursor: "sessions-next",
      })
      .mockResolvedValueOnce({
        items: [{ id: "session-two", startedAtMs: 1000, status: "completed" }],
        nextCursor: null,
      });
    mocks.getEvents
      .mockReset()
      .mockResolvedValueOnce({
        items: [
          {
            eventId: "same-id",
            eventType: "shipment_assigned",
            sequence: 1,
            subjectId: "shipment-1",
            occurredAtMs: Date.parse("2026-10-27T00:00:01Z"),
          },
        ],
        nextCursor: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            eventId: "load",
            eventType: "loading_started",
            sequence: 2,
            subjectId: "shipment-1",
            occurredAtMs: Date.parse("2026-10-27T00:00:02Z"),
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [
          {
            eventId: "same-id",
            eventType: "app_open",
            sequence: 1,
            occurredAtMs: Date.parse("2026-10-27T00:00:01.500Z"),
          },
        ],
        nextCursor: null,
      });
    const { container, view } = await openDriver();
    const drawer = container.querySelector("#driverActionDrawer");
    const exportPanel = drawer.querySelector("[data-export-panel]");
    exportPanel.open = true;
    expect(exportPanel.querySelectorAll("[data-export-csv]")).toHaveLength(1);
    expect(
      container.querySelectorAll("details[data-session-id] [data-export-csv]"),
    ).toHaveLength(0);
    exportPanel.querySelector("[data-export-from]").value = "2026-10-27";
    exportPanel.querySelector("[data-export-to]").value = "2026-10-27";
    exportPanel.querySelector("[data-export-csv]").click();

    await vi.waitFor(() =>
      expect(
        exportPanel.querySelector("[data-export-status]").textContent,
      ).toContain("Downloaded 3 chronological"),
    );
    expect(mocks.getSessions).toHaveBeenNthCalledWith(
      2,
      "driver-one",
      500,
      "sessions-next",
    );
    expect(mocks.getEvents).toHaveBeenNthCalledWith(
      2,
      "driver-one",
      "session-one",
      500,
      1,
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const csv = await exportedBlob.text();
    expect(
      Array.from(new Uint8Array(await exportedBlob.arrayBuffer()).slice(0, 3)),
    ).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.match(/"same-id"/g)).toBeNull();
    expect(csv).toContain('"","Synthetic Driver","App Opened"');
    expect(csv).toContain('"shipment-1","Synthetic Driver","Start Loading"');
    expect(csv).toContain("00:01.0");
    expect(click).toHaveBeenCalledTimes(1);
    expect(
      exportPanel.querySelector("[data-export-csv]").getAttribute("aria-busy"),
    ).toBe("false");
    click.mockRestore();
    vi.unstubAllGlobals();
    view.destroy();
    container.remove();
  });
  it("filters the visible session rows by a partial shipment number and restores them when cleared", async () => {
    mocks.getSessions.mockReset().mockResolvedValueOnce({
      items: [
        { id: "session-one", startedAtMs: 3, status: "active" },
        { id: "session-two", startedAtMs: 2, status: "completed" },
        { id: "session-three", startedAtMs: 1, status: "completed" },
      ],
      nextCursor: null,
    });
    const shipmentBySession = new Map([
      ["session-one", "10140501"],
      ["session-two", "10140601"],
      ["session-three", "10140701"],
    ]);
    mocks.getEvents
      .mockReset()
      .mockImplementation(async (_driverId, sessionId) => ({
        items: [
          {
            eventId: `assigned-${sessionId}`,
            eventType: "shipment_assigned",
            sequence: 1,
            subjectId: shipmentBySession.get(sessionId),
            occurredAtMs: Date.parse("2026-10-27T00:00:00Z"),
          },
        ],
        nextCursor: null,
      }));
    const { container, view } = await openDriver();
    const drawer = container.querySelector("#driverActionDrawer");
    const exportPanel = drawer.querySelector("[data-export-panel]");
    exportPanel.open = true;
    const shipmentSearch = exportPanel.querySelector("[data-export-shipment]");
    shipmentSearch.value = "101406";
    shipmentSearch.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(
          "#driverActionSessions details[data-session-id]",
        ),
      ).toHaveLength(1);
      expect(
        container.querySelector(
          "#driverActionSessions details[data-session-id]",
        ).dataset.sessionId,
      ).toBe("session-two");
    });
    expect(
      exportPanel.querySelector("[data-session-filter-status]").textContent,
    ).toContain("1 of 3 sessions match");
    shipmentSearch.value = "";
    shipmentSearch.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() =>
      expect(
        container.querySelectorAll(
          "#driverActionSessions details[data-session-id]",
        ),
      ).toHaveLength(3),
    );
    view.destroy();
    container.remove();
  });
  it("allows exporting saved actions even when none can be linked to a shipment", async () => {
    let exportedBlob;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob) => {
        exportedBlob = blob;
        return "blob:session-actions";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    mocks.getEvents
      .mockReset()
      .mockImplementation(async (_driverId, sessionId) => ({
        items: [
          {
            eventId: `app-open-${sessionId}`,
            eventType: "app_open",
            sessionId,
            sequence: 1,
            occurredAtMs: 1000,
          },
        ],
        nextCursor: null,
      }));
    const { container, view } = await openDriver();
    const drawer = container.querySelector("#driverActionDrawer");
    const exportPanel = drawer.querySelector("[data-export-panel]");
    exportPanel.open = true;
    exportPanel.querySelector("[data-export-csv]").click();
    await vi.waitFor(() =>
      expect(
        exportPanel.querySelector("[data-export-status]").textContent,
      ).toContain("Downloaded 2 chronological"),
    );
    const csv = await exportedBlob.text();
    expect(csv).toContain('"","Synthetic Driver","App Opened"');
    click.mockRestore();
    vi.unstubAllGlobals();
    view.destroy();
    container.remove();
  });
  it("submits session removal as a reasoned request and does not delete from the client", async () => {
    const { container, view } = await openDriver();
    const row = container.querySelector(
      'details[data-session-id="session-one"]',
    );
    row.querySelector("[data-open-delete-form]").click();
    row.querySelector("[data-delete-reason]").value = "Duplicate audit session";
    row.querySelector("[data-submit-delete]").click();
    await vi.waitFor(() =>
      expect(row.querySelector("[data-delete-request]").textContent).toContain(
        "sent for admin approval",
      ),
    );
    expect(mocks.requestDeletion).toHaveBeenCalledWith(
      "driver-one",
      "session-one",
      "Duplicate audit session",
    );
    expect(row.querySelector("[data-delete-request] button")).toBeNull();
    expect(
      container.querySelector("[data-driver-action-request-overlay]"),
    ).toBeNull();
    expect(
      container.querySelector("#driverActionScreen").hasAttribute("inert"),
    ).toBe(false);
    view.destroy();
    container.remove();
  });
  it("blurs and blocks the screen while sending, then restores focus and controls", async () => {
    let finishRequest;
    mocks.requestDeletion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    const { container, view } = await openDriver();
    const row = container.querySelector(
      'details[data-session-id="session-one"]',
    );
    row.querySelector("[data-open-delete-form]").click();
    row.querySelector("[data-delete-reason]").value = "Duplicate audit session";
    const submit = row.querySelector("[data-submit-delete]");
    submit.click();

    const overlay = container.querySelector(
      "[data-driver-action-request-overlay]",
    );
    expect(
      overlay?.querySelector('[role="dialog"]')?.getAttribute("aria-modal"),
    ).toBe("true");
    expect(
      container.querySelector("#driverActionScreen").hasAttribute("inert"),
    ).toBe(true);
    expect(submit.disabled).toBe(true);
    submit.click();
    expect(mocks.requestDeletion).toHaveBeenCalledTimes(1);

    finishRequest({ requestId: "request-2", status: "pending" });
    await vi.waitFor(() =>
      expect(
        container.querySelector("[data-driver-action-request-overlay]"),
      ).toBeNull(),
    );
    expect(
      container.querySelector("#driverActionScreen").hasAttribute("inert"),
    ).toBe(false);
    expect(document.activeElement.textContent).toContain(
      "sent for admin approval",
    );
    view.destroy();
    container.remove();
  });
  it("explains a missing backend acknowledgement and re-enables retry", async () => {
    const timeout = Object.assign(
      new Error("Driver action request timed out."),
      { code: "SOCKET_ACK_TIMEOUT" },
    );
    mocks.requestDeletion.mockRejectedValueOnce(timeout);
    const { container, view } = await openDriver();
    const row = container.querySelector(
      'details[data-session-id="session-one"]',
    );
    row.querySelector("[data-open-delete-form]").click();
    row.querySelector("[data-delete-reason]").value = "Duplicate audit session";
    row.querySelector("[data-submit-delete]").click();

    await vi.waitFor(() =>
      expect(row.querySelector("[data-delete-status]").textContent).toContain(
        "SYSU Go did not acknowledge",
      ),
    );
    expect(row.querySelector("[data-delete-status]").getAttribute("role")).toBe(
      "alert",
    );
    expect(row.querySelector("[data-submit-delete]").disabled).toBe(false);
    expect(
      container.querySelector("[data-driver-action-request-overlay]"),
    ).toBeNull();
    expect(
      container.querySelector("#driverActionScreen").hasAttribute("inert"),
    ).toBe(false);
    view.destroy();
    container.remove();
  });
});
