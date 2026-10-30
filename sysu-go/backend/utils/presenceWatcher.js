/**
 * Presence watcher — authoritative server-side driver online/offline detector.
 *
 * Why this exists:
 *   Socket.IO's EVENT_DISCONNECT doesn't always fire promptly when a driver's
 *   network goes down (especially DNS-broken / captive-portal scenarios on
 *   Android). The driver's TCP socket can hang in the kernel without ever
 *   raising a FIN, so the server thinks the driver is still "online" until
 *   pingTimeout fires (default 30s in our config — sometimes much longer).
 *
 *   The fix: the client emits a `heartbeat` event every ~15s while online.
 *   We track `lastSeen` per driver. If lastSeen is older than HEARTBEAT_TIMEOUT_MS,
 *   we persist offline state through MySQL profile/location services and broadcast
 *   driver_status_change to room driver:{uid} and staff tracking.
 *
 * This is the same model Slack / Discord / WhatsApp use for online presence:
 *   "online" is a function of recent activity, not a state the client announces.
 *
 * Implementation:
 *   - Runs on a setInterval (every CHECK_INTERVAL_MS)
 *   - Iterates onlineDriver Map (defined in server.js)
 *   - For each stale driver: removes from map or retains the last active-trip position,
 *     persists to MySQL, and broadcasts
 *
 * Tuning:
 *   - HEARTBEAT_INTERVAL_MS (client): how often the client pings (15s)
 *   - HEARTBEAT_TIMEOUT_MS (server): how long until we declare offline (45s = 3× interval)
 *   - CHECK_INTERVAL_MS (this file): how often we scan for stale drivers (15s)
 */

// 45s = 3× the 15s client heartbeat interval. Three missed pings → offline.
// Generous enough to ride out brief network blips without false positives.
const HEARTBEAT_TIMEOUT_MS = 45_000;
// Scan every 15s — same cadence as the client heartbeat.
const CHECK_INTERVAL_MS = 15_000;

let intervalId = null;

/**
 * Log helper with timestamp — matches server.js convention.
 */
const ts = () => new Date().toISOString().replace("T", " ").substring(0, 19);

/**
 * Scan onlineDriver for stale entries and mark them OFFLINE.
 *
 * @param {Map} onlineDriver — driverId → { name, lat, lng, socketIds, status, lastSeen }
 * @param {object} io — Socket.IO server instance (for broadcasts)
 */
async function tick(onlineDriver, io, {mysqlAssignments, mysqlDriverProfiles, mysqlLiveLocations} = {}) {
  if (!onlineDriver || onlineDriver.size === 0) return;

  if (!mysqlAssignments || !mysqlDriverProfiles || !mysqlLiveLocations) {
    console.error(`[${ts()}] [PRESENCE] MySQL presence services are unavailable; watcher tick skipped`);
    return;
  }

  const now = Date.now();
  const staleDrivers = [];

  for (const [uid, entry] of onlineDriver.entries()) {
    if (entry.isOffline) continue;
    if (!entry.lastSeen) {
      // Defensive — entry without lastSeen (shouldn't happen with new code, but
      // covers pre-existing map entries from before this watcher landed).
      entry.lastSeen = now;
      continue;
    }
    const ageMs = now - entry.lastSeen;
    if (ageMs > HEARTBEAT_TIMEOUT_MS) {
      staleDrivers.push({ uid, entry, ageMs, lastSeen: entry.lastSeen });
    }
  }

  if (staleDrivers.length === 0) return;

  console.log(`[${ts()}] [PRESENCE] Found ${staleDrivers.length} stale driver(s) (lastSeen > ${HEARTBEAT_TIMEOUT_MS / 1000}s ago)`);

  for (const { uid, entry, ageMs, lastSeen } of staleDrivers) {
    const ageSec = Math.round(ageMs / 1000);
    console.log(`[${ts()}] [PRESENCE] ⚠️  Driver ${entry.name} (${uid}) stale: lastSeen ${ageSec}s ago — marking OFFLINE`);

    // Keep the final offline decision based on persisted assignment state.
    let active = false;
    try {
      active = await mysqlAssignments.hasActiveShipment(uid);
    } catch (err) {
      console.error(`[${ts()}] [PRESENCE] MySQL error checking active shipment for ${uid}:`, err.message);
      active = true; // Safe fallback
    }

    // A heartbeat or replacement socket may have arrived while the DB check was in flight.
    if (onlineDriver.get(uid) !== entry || entry.isOffline || entry.lastSeen !== lastSeen
        || Date.now() - entry.lastSeen <= HEARTBEAT_TIMEOUT_MS) continue;

    if (active && entry.lat != null && entry.lng != null) {
      // Mark offline in-place — keep lat/lng for web frontend
      const offlineSince = Date.now();
      try {
        await mysqlDriverProfiles.setStatus(uid, 'offline');
        await mysqlLiveLocations.save({driverId: uid, sapAssignmentId: entry.sapDocId || null,
          name: entry.name || 'Driver', lat: entry.lat, lng: entry.lng, status: 'offline_in_transit',
          sampledAt: entry.locationTimestamp || now, receivedAt: now, offlineSince});
        console.log(`[${ts()}] [PRESENCE] MySQL persisted offline_in_transit for ${uid} (last position retained)`);
      } catch (err) {
        console.error(`[${ts()}] [PRESENCE] MySQL write failed for ${uid}:`, err.message);
      }

      if (onlineDriver.get(uid) !== entry || entry.lastSeen !== lastSeen
          || Date.now() - entry.lastSeen <= HEARTBEAT_TIMEOUT_MS) {
        entry.isOffline = false;
        entry.offlineSince = null;
        await Promise.allSettled([
          mysqlDriverProfiles.setStatus(uid, entry.status || 'online'),
          mysqlLiveLocations.save({driverId: uid, sapAssignmentId: entry.sapDocId || null,
            name: entry.name || 'Driver', lat: entry.lat, lng: entry.lng, status: entry.status || 'online',
            sampledAt: entry.locationTimestamp || now, receivedAt: Date.now(), offlineSince: null}),
        ]);
        continue;
      }
      entry.isOffline = true;
      entry.offlineSince = offlineSince;
      entry.socketIds?.clear();

      // Broadcast offline_in_transit so sysu-web shows grey marker at last known position
      if (io) {
        const payload = {
          driverId: uid,
          status: "offline_in_transit",
          name: entry.name,
          lat: entry.lat,
          lng: entry.lng,
          offlineSince: entry.offlineSince,
          timestamp: Date.now(),
          source: "presence_watcher",
          staleAgeMs: ageMs,
        };
        io.to(`driver:${uid}`).emit("driver_status_change", { ...payload, status: "offline" });
        io.to("staff:tracking").emit("driver_status_change", { ...payload, status: "offline" });
        io.to("staff:tracking").emit("vendor_status_update", payload);
        console.log(`[${ts()}] [PRESENCE] ✓ Broadcast offline_in_transit for ${entry.name} — last pos [${entry.lat}, ${entry.lng}] retained`);
      }
    } else {
      // No active shipment — persist offline, then remove only if this entry stayed stale.
      // Persist OFFLINE to the MySQL driver profile.
      try {
        await mysqlDriverProfiles.setStatus(uid, 'offline');
        if (onlineDriver.get(uid) !== entry || entry.lastSeen !== lastSeen
            || Date.now() - entry.lastSeen <= HEARTBEAT_TIMEOUT_MS) {
          const replacement = onlineDriver.get(uid);
          if (replacement) await mysqlDriverProfiles.setStatus(uid, replacement.status || 'online');
          continue;
        }
        console.log(`[${ts()}] [PRESENCE] MySQL persisted offline for ${uid}`);
      } catch (err) {
        console.error(`[${ts()}] [PRESENCE] MySQL write failed for ${uid}:`, err.message);
        if (onlineDriver.get(uid) !== entry || entry.lastSeen !== lastSeen
            || Date.now() - entry.lastSeen <= HEARTBEAT_TIMEOUT_MS) continue;
      }

      if (onlineDriver.get(uid) !== entry || entry.lastSeen !== lastSeen
          || Date.now() - entry.lastSeen <= HEARTBEAT_TIMEOUT_MS) continue;
      onlineDriver.delete(uid);

      if (io) {
        const payload = {
          driverId: uid,
          status: "offline",
          name: entry.name,
          timestamp: Date.now(),
          source: "presence_watcher",
          staleAgeMs: ageMs,
        };
        io.to(`driver:${uid}`).emit("driver_status_change", payload);
        io.to("staff:tracking").emit("driver_status_change", payload);
        io.to("staff:tracking").emit("vendor_status_update", {
          driverId: uid,
          name: entry.name,
          status: "offline",
          lat: entry.lat,
          lng: entry.lng,
          source: "presence_watcher",
        });
        console.log(`[${ts()}] [PRESENCE] ✓ Broadcast driver_status_change:offline to room driver:${uid} + global`);
      }
    }
  }
}

/**
 * Start the presence watcher.
 *
 * @param {Map} onlineDriver — shared with server.js's io.on("connection")
 * @param {object} io — Socket.IO server instance
 */
function startPresenceWatcher(onlineDriver, io, dependencies) {
  if (intervalId !== null) {
    console.warn(`[${ts()}] [PRESENCE] Already running — ignoring start`);
    return;
  }
  if (!dependencies?.mysqlAssignments || !dependencies?.mysqlDriverProfiles || !dependencies?.mysqlLiveLocations) {
    console.error(`[${ts()}] [PRESENCE] MySQL presence services are unavailable; watcher not started`);
    return;
  }
  intervalId = setInterval(() => tick(onlineDriver, io, dependencies), CHECK_INTERVAL_MS);
  console.log(`[${ts()}] [PRESENCE] ✓ Started — scanning every ${CHECK_INTERVAL_MS / 1000}s, timeout=${HEARTBEAT_TIMEOUT_MS / 1000}s`);
}

function stopPresenceWatcher() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log(`[${ts()}] [PRESENCE] Stopped`);
  }
}

module.exports = {
  startPresenceWatcher,
  stopPresenceWatcher,
  HEARTBEAT_TIMEOUT_MS,
  CHECK_INTERVAL_MS,
  tick,
};
