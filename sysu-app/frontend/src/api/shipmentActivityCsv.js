import { driverActionCoordinates, driverActionTimestamp } from "./driverActionService.js";

export const SHIPMENT_ACTIVITY_CSV_HEADERS = [
  "Shipment #",
  "Driver",
  "Activity",
  "Date",
  "Time",
  "Lat",
  "Long",
  "Remarks",
  "TMS",
];

export const SHIPMENT_ACTIVITY_TIME_ZONE = "Asia/Manila";

const activityLabels = Object.freeze({
  app_open: "App Opened",
  qr_scan_opened: "QR Scanner Opened",
  qr_scan: "QR Scanned",
  registration_opened: "Trip Registration Opened",
  trip_registration: "Trip Registration",
  queue_joined: "Joined Queue",
  trip_confirmation: "Trip Confirmation",
  shipment_assigned: "Assigned Shipment",
  active_shipment_selected: "Active Shipment Selected",
  loading_started: "Start Loading",
  loading_cancelled: "Loading Cancelled",
  fully_loaded: "Done Loading",
  verification_cancelled: "Verification Cancelled",
  guard_verified: "Guard Verification",
  transit_started: "Trip Started",
  route_point: "Route Location",
  unloading_started: "Unloading Started",
  pod_captured: "POD Captured",
  all_deliveries_completed: "All Deliveries Completed",
  return_to_base_requested: "Return to Base Requested",
  returning_to_base: "Returning to Base",
  return_prompt_opened: "Return-to-Base Prompt Opened",
  arrival_confirmation_opened: "Arrival Confirmation Opened",
  arrived_at_warehouse: "Arrived at Warehouse",
  warehouse_arrival_confirmed: "Warehouse Arrival Confirmed",
  session_completed: "Driver Session Completed",
});

const shipmentReferenceEvents = new Set([
  "shipment_assigned", "active_shipment_selected", "loading_started", "loading_cancelled",
  "fully_loaded", "verification_cancelled", "guard_verified", "transit_started", "route_point",
  "unloading_started", "pod_captured", "all_deliveries_completed", "return_to_base_requested",
  "returning_to_base", "arrived_at_warehouse", "warehouse_arrival_confirmed",
]);

const preAssignmentEvents = new Set([
  "qr_scan_opened", "qr_scan", "registration_opened", "trip_registration", "queue_joined", "trip_confirmation",
]);

export const shipmentActivityShipmentIds = (events) => [...new Set(
  chronological(events)
    .filter((event) => shipmentReferenceEvents.has(event.eventType))
    .map((event) => event.subjectId)
    .filter((shipmentId) => typeof shipmentId === "string" && shipmentId.trim()),
)];

const businessDate = (timestamp) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHIPMENT_ACTIVITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const dateLabel = (timestamp) => new Intl.DateTimeFormat("en-US", {
  timeZone: SHIPMENT_ACTIVITY_TIME_ZONE,
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
}).format(new Date(timestamp));

const timeLabel = (timestamp) => new Intl.DateTimeFormat("en-US", {
  timeZone: SHIPMENT_ACTIVITY_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
}).format(new Date(timestamp));

const validateDate = (value, label) => {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || businessDate(Date.parse(`${value}T04:00:00Z`)) !== value) {
    throw new TypeError(`${label} must be a valid date.`);
  }
};

export const formatShipmentActivityDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "";
  const tenths = Math.round(durationMs / 100);
  const totalSeconds = Math.floor(tenths / 10);
  const tenth = tenths % 10;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenth}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenth}`;
};

const csvText = (value) => {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const activityRemarks = (event, hasAssignmentTime) => {
  const descriptions = {
    app_open: "Driver opened SYSU Go",
    qr_scan_opened: "QR scanner opened",
    qr_scan: "QR scanned",
    registration_opened: "Trip registration opened",
    trip_registration: "Trip registration submitted",
    queue_joined: "Driver joined the queue",
    trip_confirmation: "Trip confirmation requested",
    shipment_assigned: "Shipment assignment recorded",
    active_shipment_selected: "Shipment selected by driver",
    loading_started: hasAssignmentTime
      ? "Waiting time before Loading"
      : "Loading started; prior assignment timestamp unavailable",
    loading_cancelled: "Loading cancelled by driver",
    fully_loaded: "Loading marked complete by driver",
    verification_cancelled: "Guard verification cancelled",
    guard_verified: "Guard verification completed",
    transit_started: "Driver started the trip",
    route_point: "Driver GPS location recorded",
    unloading_started: "Driver started unloading",
    pod_captured: "Proof of delivery captured",
    all_deliveries_completed: "All deliveries completed",
    return_to_base_requested: "Driver confirmed return to base",
    returning_to_base: "Return-to-base trip started",
    return_prompt_opened: "Return-to-base options opened",
    arrival_confirmation_opened: "Arrival confirmation opened",
    arrived_at_warehouse: "Driver arrived at the warehouse",
    warehouse_arrival_confirmed: "Warehouse arrival confirmed",
    session_completed: "Driver session completed",
  };
  let description = descriptions[event.eventType] || activityLabels[event.eventType];
  const shipmentCount = Number(event.metadata?.shipmentCount);
  if (event.eventType === "all_deliveries_completed" && Number.isSafeInteger(shipmentCount) && shipmentCount > 0) {
    description += ` (${shipmentCount} shipments)`;
  }
  const obdRef = event.eventType === "pod_captured" ? event.metadata?.obdRef : null;
  if (typeof obdRef === "string" && obdRef.trim() && obdRef !== "unknown") {
    description += ` · OBD ${obdRef.trim()}`;
  }
  if (event.outcome && !["success", "completed"].includes(String(event.outcome).toLowerCase())) {
    description += ` · ${event.outcome}`;
  }
  return description;
};

const chronological = (events) => [...new Map((events || [])
  .filter((event) => event && (event.eventId || event.id))
  .map((event) => [`${event.sessionId || "legacy-session"}:${event.eventId || event.id}`, event])).values()]
  .filter((event) => activityLabels[event.eventType])
  .map((event) => ({ ...event, timestampMs: driverActionTimestamp(event.occurredAtMs) }))
  .filter((event) => Number.isFinite(event.timestampMs) && event.timestampMs > 0)
  .sort((a, b) => a.timestampMs - b.timestampMs
    || Number(a.sequence || 0) - Number(b.sequence || 0));

const attachShipmentContext = (events) => {
  const sessions = new Map();
  events.forEach((event) => {
    const session = event.sessionId || "legacy-session";
    if (!sessions.has(session)) sessions.set(session, []);
    sessions.get(session).push(event);
  });
  return [...sessions.values()].flatMap((sessionEvents) => attachSessionShipmentContext(sessionEvents))
    .sort((a, b) => a.timestampMs - b.timestampMs
      || Number(a.sequence || 0) - Number(b.sequence || 0));
};

const attachSessionShipmentContext = (events) => {
  const shipmentIds = [...new Set(events
    .filter((event) => shipmentReferenceEvents.has(event.eventType))
    .map((event) => event.subjectId)
    .filter((id) => typeof id === "string" && id.trim()))];
  const assignments = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.eventType === "shipment_assigned"
      && shipmentReferenceEvents.has(event.eventType)
      && typeof event.subjectId === "string" && event.subjectId.trim());
  const soleShipment = shipmentIds.length === 1 ? shipmentIds[0] : "";
  let activeShipment = "";

  return events.map((event, index) => {
    if (shipmentReferenceEvents.has(event.eventType)
      && typeof event.subjectId === "string" && event.subjectId.trim()) {
      activeShipment = event.subjectId;
      return { ...event, shipmentId: event.subjectId };
    }

    if (event.eventType === "app_open") {
      const nextAssignment = assignments.find(({ index: assignmentIndex }) => assignmentIndex >= index)?.event;
      return { ...event, shipmentId: activeShipment || nextAssignment?.subjectId || soleShipment };
    }

    if (preAssignmentEvents.has(event.eventType)) {
      const nextAssignment = assignments.find(({ index: assignmentIndex }) => assignmentIndex >= index)?.event;
      return { ...event, shipmentId: nextAssignment?.subjectId || activeShipment || soleShipment };
    }

    return { ...event, shipmentId: activeShipment || soleShipment };
  });
};

export const buildShipmentActivityCsv = ({
  events,
  driverName,
  shipmentId = "",
  dateFrom = "",
  dateTo = "",
}) => {
  validateDate(dateFrom, "Start date");
  validateDate(dateTo, "End date");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new TypeError("Start date must be on or before end date.");
  }

  const linkedEvents = attachShipmentContext(chronological(events));
  const shipmentEvents = linkedEvents
    .filter((event) => !shipmentId || event.shipmentId === shipmentId)
    .map((event) => ({ ...event, subjectId: event.shipmentId }));
  const previousTimestampByShipment = new Map();
  const durationByEvent = new Map();
  shipmentEvents.forEach((event) => {
    //  Automated GPS samples do not reset elapsed time between business actions.
    if (event.eventType === "route_point") return;
    const shipment = event.shipmentId;
    const session = event.sessionId || "legacy-session";
    const groupKey = `${session}:${shipment || "unlinked"}`;
    const eventKey = `${event.eventId || event.id}:${groupKey}`;
    const previousAt = previousTimestampByShipment.get(groupKey);
    if (previousAt != null && event.timestampMs >= previousAt) {
      durationByEvent.set(eventKey, event.timestampMs - previousAt);
    }
    previousTimestampByShipment.set(groupKey, event.timestampMs);
  });
  const scoped = shipmentEvents.filter((event) => {
    if (shipmentId && event.shipmentId !== shipmentId) return false;
    const date = businessDate(event.timestampMs);
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  });
  const assignmentTimeByShipment = new Map();
  linkedEvents.forEach((event) => {
    const shipment = event.shipmentId;
    if (event.eventType === "shipment_assigned") {
      assignmentTimeByShipment.set(`${event.sessionId || "legacy-session"}:${shipment}`, event.timestampMs);
    }
  });
  const rows = scoped.map((event) => {
    const shipment = event.shipmentId;
    const groupKey = `${event.sessionId || "legacy-session"}:${shipment || "unlinked"}`;
    const eventKey = `${event.eventId || event.id}:${groupKey}`;
    const assignmentTime = assignmentTimeByShipment.get(`${event.sessionId || "legacy-session"}:${shipment}`);
    const hasAssignmentTime = event.eventType === "loading_started"
      && assignmentTime != null
      && event.timestampMs >= assignmentTime;
    const recordedQrDuration = event.eventType === "qr_scan"
      && event.metadata?.durationBasis === "scan_detected"
      && Number.isFinite(Number(event.durationMs))
      && Number(event.durationMs) >= 0
      ? Number(event.durationMs)
      : null;
    const elapsedMs = recordedQrDuration ?? durationByEvent.get(eventKey);
    const tms = elapsedMs == null ? "" : formatShipmentActivityDuration(elapsedMs);
    const remarks = activityRemarks(event, hasAssignmentTime);
    const [lat, lng] = driverActionCoordinates(event) || ["", ""];
    return [
      csvText(shipment),
      csvText(driverName),
      csvText(activityLabels[event.eventType]),
      csvCell(dateLabel(event.timestampMs)),
      csvCell(timeLabel(event.timestampMs)),
      csvCell(lat),
      csvCell(lng),
      csvText(remarks),
      csvCell(tms),
    ];
  });

  if (!rows.length) return { rows: [], csv: "" };
  const header = SHIPMENT_ACTIVITY_CSV_HEADERS.map(csvCell);
  const body = rows.map((row) => row.join(","));
  return { rows, csv: `\uFEFF${[header.join(","), ...body].join("\r\n")}\r\n` };
};

export const shipmentActivityBusinessDate = businessDate;

export const shipmentActivityFileName = (now = Date.now()) =>
  `shipment_activity_${businessDate(now)}.csv`;
