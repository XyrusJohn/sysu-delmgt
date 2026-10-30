export const GPS_STALE_MS = 45_000;

export function locationTime(value) {
  const time = value?.toMillis ? value.toMillis() : value;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

export function validLocation(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function savedLocationStatus(tripStatus) {
  return tripStatus === "returning_to_base" ? "returning_to_base" : "pending";
}

//  Persisted snapshots describe a saved position; only socket fixes establish live GPS.
export function acceptLocationUpdate(
  previous,
  data,
  { source = "socket", kind = "location", now = Date.now(), closedAt = 0 } = {},
) {
  if (
    !data ||
    typeof data.driverId !== "string" ||
    !data.driverId ||
    data.driverId.length > 128
  )
    return null;
  const rawTime = data.timestamp ?? data.updatedAt ?? data.at;
  if (
    rawTime != null &&
    !Number.isFinite(rawTime?.toMillis ? rawTime.toMillis() : rawTime)
  )
    return null;
  const time =
    rawTime == null ? (source === "socket" ? now : 0) : locationTime(rawTime);
  if (time > now + 5000 || time < (previous?.timestamp || 0)) return null;
  if (data.status === "completed")
    return { driverId: data.driverId, removed: true, timestamp: time };
  //  Only a fresh GPS fix tied to a newly verified active shipment can reopen a completed trip.
  if (closedAt && (time <= closedAt || kind === "status")) return null;
  if (
    source === "mysql" &&
    previous?.source === "socket" &&
    now - previous.lastSeen <= GPS_STALE_MS
  )
    return null;
  const hasCoords = validLocation(data.lat, data.lng);
  if ((data.lat != null || data.lng != null) && !hasCoords) return null;
  if (!hasCoords && !validLocation(previous?.lat, previous?.lng)) return null;
  const lastSeen =
    kind === "location" && hasCoords
      ? time
      : previous?.lastSeen || locationTime(data.locationTimestamp);
  const rawStatus =
    data.status ||
    (kind === "location" && source === "socket"
      ? "online"
      : previous?.status) ||
    "online";
  let status = rawStatus;
  if (
    ![
      "online",
      "in_transit",
      "returning_to_base",
      "stopped",
      "offline",
      "offline_in_transit",
      "pending",
      "stale",
    ].includes(status)
  )
    return null;
  let tripStatus = Object.hasOwn(data, "tripStatus")
    ? data.tripStatus
    : (previous?.tripStatus ?? null);
  if (!Object.hasOwn(data, "tripStatus") && kind === "status") {
    if (rawStatus === "in_transit" || rawStatus === "offline_in_transit")
      tripStatus = "in_transit";
    else if (rawStatus === "online" || rawStatus === "returning_to_base")
      tripStatus = null;
  }
  if (status === "in_transit") status = "online";
  if (status === "offline_in_transit") status = "offline";
  if (source === "mysql" && status === "online") status = "pending";
  if (status === "online" && previous?.status === "returning_to_base")
    status = "returning_to_base";
  if (status === "online" && (!lastSeen || now - lastSeen > GPS_STALE_MS))
    status = "stale";
  return {
    ...previous,
    ...data,
    lat: hasCoords ? data.lat : previous.lat,
    lng: hasCoords ? data.lng : previous.lng,
    name: data.name || previous?.name || "Driver",
    tripStatus,
    status,
    timestamp: time,
    lastSeen,
    source,
    sapDocId: Object.hasOwn(data, "sapDocId")
      ? data.sapDocId
      : (data.shipmentId ?? previous?.sapDocId ?? null),
  };
}
