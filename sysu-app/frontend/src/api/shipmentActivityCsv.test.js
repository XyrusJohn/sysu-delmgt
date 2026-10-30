import { describe, expect, it } from "vitest";
import {
  buildShipmentActivityCsv,
  formatShipmentActivityDuration,
  shipmentActivityFileName,
} from "./shipmentActivityCsv.js";

const event = (id, eventType, occurredAtMs, extra = {}) => ({
  eventId: id,
  eventType,
  occurredAtMs,
  subjectId: "dispatch-10136969",
  locationState: "unavailable",
  outcome: "success",
  ...extra,
});

describe("shipment activity CSV", () => {
  it("exports scanner and queue actions against the linked shipment in the required Excel column order", () => {
    const assignedAt = Date.parse("2026-10-20T11:28:00Z");
    const loadingAt = assignedAt + 38_000;
    const { csv, rows } = buildShipmentActivityCsv({
      driverName: "M. Pasagui",
      events: [
        event("load", "loading_started", loadingAt, { lat: 14.6, lng: 121.0 }),
        event("assign", "shipment_assigned", assignedAt),
        event("queue", "trip_registration", assignedAt - 1000, { subjectId: "queue-1" }),
        event("unlinked-qr", "qr_scan", assignedAt - 2000, { subjectId: null }),
      ],
    });

    expect(rows).toHaveLength(4);
    expect(csv.startsWith("\uFEFF\"Shipment #\",\"Driver\",\"Activity\",\"Date\",\"Time\",\"Lat\",\"Long\",\"Remarks\",\"TMS\"\r\n")).toBe(true);
    expect(csv).toContain('"dispatch-10136969","M. Pasagui","QR Scanned","10/20/2026","7:27:58 PM"');
    expect(csv).toContain('"dispatch-10136969","M. Pasagui","Trip Registration","10/20/2026","7:27:59 PM"');
    expect(csv).toContain('"dispatch-10136969","M. Pasagui","Assigned Shipment","10/20/2026","7:28:00 PM"');
    expect(csv).toContain('"dispatch-10136969","M. Pasagui","Start Loading","10/20/2026","7:28:38 PM","14.6","121","Waiting time before Loading","00:38.0"');
    expect(csv).not.toContain("queue-1");
  });

  it("uses the recorded scan-detection duration and leaves automated GPS points out of action timing", () => {
    const result = buildShipmentActivityCsv({
      driverName: "Driver",
      events: [
        event("scan-open", "qr_scan_opened", 1000, {subjectId: null}),
        event("route", "route_point", 2000, {subjectId: "shipment-1", lat: 14.6, lng: 121.0}),
        event("scan", "qr_scan", 7000, {
          subjectId: null,
          durationMs: 5000,
          metadata: {durationBasis: "scan_detected"},
        }),
        event("registration-open", "registration_opened", 7500, {subjectId: null}),
        event("registration", "trip_registration", 8000, {subjectId: "queue-1"}),
        event("queue", "queue_joined", 8000, {subjectId: "queue-1"}),
        event("confirmation", "trip_confirmation", 8100, {subjectId: "queue-1", outcome: "requested"}),
        event("assigned", "shipment_assigned", 9000, {subjectId: "shipment-1"}),
      ],
    });

    const byActivity = new Map(result.rows.map((row) => [row[2], row]));
    expect(result.rows).toHaveLength(8);
    expect(byActivity.get('"QR Scanner Opened"')[8]).toBe('""');
    expect(byActivity.get('"QR Scanned"')[8]).toBe('"00:05.0"');
    expect(byActivity.get('"Joined Queue"')[0]).toBe('"shipment-1"');
    expect(byActivity.get('"Trip Confirmation"')[8]).toBe('"00:00.1"');
    expect(byActivity.get('"Route Location"')[8]).toBe('""');
  });

  it("exports every supported mobile event, including app opens and actions without shipment context", () => {
    const eventTypes = [
      "app_open", "qr_scan", "trip_registration", "queue_joined", "shipment_assigned",
      "loading_started", "fully_loaded", "guard_verified", "transit_started", "route_point",
      "unloading_started", "pod_captured", "returning_to_base", "arrived_at_warehouse",
      "qr_scan_opened", "registration_opened", "loading_cancelled", "verification_cancelled",
      "trip_confirmation", "active_shipment_selected", "warehouse_arrival_confirmed",
      "all_deliveries_completed", "return_prompt_opened", "return_to_base_requested",
      "arrival_confirmation_opened", "session_completed",
    ];
    const events = eventTypes.map((type, index) => event(`all-${index}`, type, 1000 + index * 1000, {
      subjectId: type === "shipment_assigned" ? "shipment-1" : null,
      sessionId: "session-1",
    }));
    const result = buildShipmentActivityCsv({events, driverName: "Driver"});

    expect(result.rows).toHaveLength(eventTypes.length);
    expect(result.rows.map((row) => row[2])).toContain('"App Opened"');
    expect(result.rows.every((row) => row[7] !== '""')).toBe(true);
    expect(result.rows[0][0]).toBe('"shipment-1"');
    expect(result.rows.at(-1)[0]).toBe('"shipment-1"');
  });

  it("keeps session-only actions in an unfiltered export when no shipment can be linked", () => {
    const result = buildShipmentActivityCsv({
      driverName: "Driver",
      events: [event("open", "app_open", 1000, {subjectId: null, sessionId: "session-unlinked"})],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0][0]).toBe('""');
    expect(result.rows[0][2]).toBe('"App Opened"');
  });

  it("applies shipment and inclusive Asia/Manila date filters", () => {
    const events = [
      event("same", "shipment_assigned", Date.parse("2026-10-20T16:30:00Z")),
      event("other", "shipment_assigned", Date.parse("2026-10-20T16:30:00Z"), { subjectId: "dispatch-other" }),
      event("next-day", "shipment_assigned", Date.parse("2026-10-20T16:30:00Z") + 86_400_000),
    ];
    const result = buildShipmentActivityCsv({
      events,
      driverName: "Driver",
      shipmentId: "dispatch-10136969",
      dateFrom: "2026-10-21",
      dateTo: "2026-10-21",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.csv).toContain('"10/21/2026"');
  });

  it("leaves TMS blank when the same shipment has no prior assignment event", () => {
    const result = buildShipmentActivityCsv({
      driverName: "Driver",
      events: [event("load", "loading_started", Date.parse("2026-10-20T11:28:38Z"))],
    });
    expect(result.csv).toContain('"Loading started; prior assignment timestamp unavailable",""');
    expect(result.csv).not.toContain("Waiting time before Loading");
  });

  it("adds a factual non-empty remark to every exported driver action", () => {
    const result = buildShipmentActivityCsv({
      driverName: "Driver",
      events: [
        event("assigned", "shipment_assigned", 1000),
        event("loading", "loading_started", 2000),
        event("loaded", "fully_loaded", 3000),
        event("guard", "guard_verified", 4000),
        event("deliveries", "all_deliveries_completed", 5000, { metadata: { shipmentCount: 2 } }),
        event("returning", "returning_to_base", 6000),
        event("pod", "pod_captured", 7000, { metadata: { obdRef: "OBD-42" } }),
      ],
    });

    expect(result.rows.every((row) => row[7] !== '""')).toBe(true);
    expect(result.csv).toContain("Shipment assignment recorded");
    expect(result.csv).toContain("Loading marked complete by driver");
    expect(result.csv).toContain("Guard verification completed");
    expect(result.csv).toContain("All deliveries completed (2 shipments)");
    expect(result.csv).toContain("Return-to-base trip started");
    expect(result.csv).toContain("Proof of delivery captured · OBD OBD-42");
  });

  it("calculates TMS for every shipment event and includes the confirmed unlinked session end", () => {
    const start = Date.parse("2026-10-27T10:05:58Z");
    const result = buildShipmentActivityCsv({
      driverName: "Erwin Centeno",
      events: [
        event("assigned", "shipment_assigned", start, {subjectId: "10140501"}),
        event("route-sample", "route_point", start + 5_000, {subjectId: "10140501", lat: 14.67, lng: 121.01}),
        event("loading", "loading_started", start + 15_000, {subjectId: "10140501"}),
        event("loaded", "fully_loaded", start + 22_000, {subjectId: "10140501"}),
        event("guard", "guard_verified", start + 27_000, {subjectId: "10140501"}),
        event("deliveries", "all_deliveries_completed", start + 859_000, {subjectId: "10140501", metadata: {shipmentCount: 1}}),
        event("returning", "returning_to_base", start + 867_000, {subjectId: "10140501"}),
        event("end", "session_completed", start + 1_659_000, {subjectId: null, lat: 14.6951, lng: 121.0493}),
      ],
    });

    expect(result.rows).toHaveLength(8);
    expect(result.rows.map((row) => row[8])).toEqual([
      '""', '""', '"00:15.0"', '"00:07.0"', '"00:05.0"',
      '"13:52.0"', '"00:08.0"', '"13:12.0"',
    ]);
    expect(result.rows.at(-1).slice(0, 3)).toEqual([
      '"10140501"', '"Erwin Centeno"', '"Driver Session Completed"',
    ]);
    expect(result.rows.at(-1)[7]).toBe('"Driver session completed"');
    expect(result.rows.at(-1)[4]).toBe('"6:33:37 PM"');
    expect(result.rows.at(-1).slice(5, 7)).toEqual(['"14.6951"', '"121.0493"']);
  });

  it("exports guard verification without inventing the unresolved guard-sign duration", () => {
    const result = buildShipmentActivityCsv({
      driverName: "Driver",
      events: [event("guard", "guard_verified", Date.parse("2026-10-20T11:30:00Z"))],
    });
    expect(result.csv).toContain('"Guard Verification"');
    expect(result.csv).not.toContain("Waiting time before Guard Sign");
    expect(result.rows[0].at(-1)).toBe('""');
  });

  it("preserves CSV quoting and protects untrusted text from formula injection", () => {
    const result = buildShipmentActivityCsv({
      driverName: '=HYPERLINK("https://example.invalid","open")',
      events: [event("one", "shipment_assigned", Date.parse("2026-10-20T11:28:00Z"), {
        subjectId: 'dispatch,"101"',
      })],
    });
    expect(result.csv).toContain('"dispatch,""101""","\'=HYPERLINK(""https://example.invalid"",""open"")"');
  });

  it("keeps event timestamps across midnight in Manila and preserves long elapsed durations", () => {
    const result = buildShipmentActivityCsv({
      driverName: "Driver",
      events: [
        event("assign", "shipment_assigned", Date.parse("2026-10-20T15:59:50Z")),
        event("load", "loading_started", Date.parse("2026-10-20T16:00:10Z")),
      ],
    });
    expect(result.csv).toContain('"10/20/2026","11:59:50 PM"');
    expect(result.csv).toContain('"10/21/2026","12:00:10 AM"');
    expect(formatShipmentActivityDuration(73_000)).toBe("01:13.0");
    expect(formatShipmentActivityDuration(3_600_000)).toBe("1:00:00.0");
    const filtered = buildShipmentActivityCsv({
      driverName: "Driver",
      dateFrom: "2026-10-21",
      dateTo: "2026-10-21",
      events: [
        event("prior-day-assign", "shipment_assigned", Date.parse("2026-10-20T15:59:50Z")),
        event("selected-day-load", "loading_started", Date.parse("2026-10-20T16:00:10Z")),
      ],
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.csv).toContain('"Waiting time before Loading","00:20.0"');
  });

  it("deduplicates the same persisted event and validates date ranges", () => {
    const assigned = event("same-id", "shipment_assigned", Date.parse("2026-10-20T11:28:00Z"));
    expect(buildShipmentActivityCsv({ events: [assigned, assigned], driverName: "Driver" }).rows).toHaveLength(1);
    expect(() => buildShipmentActivityCsv({ events: [], dateFrom: "2026-10-22", dateTo: "2026-10-21" })).toThrow("on or before");
    expect(() => buildShipmentActivityCsv({ events: [], dateFrom: "2026-02-31" })).toThrow("valid date");
    expect(buildShipmentActivityCsv({ events: [], driverName: "Driver" }).csv).toBe("");
  });

  it("names downloads using the Asia/Manila business date", () => {
    expect(shipmentActivityFileName(Date.parse("2026-10-20T16:30:00Z"))).toBe("shipment_activity_2026-10-21.csv");
  });
});
