function createMysqlLiveLocations({ pool }) {
  if (!pool || typeof pool.execute !== "function")
    throw new TypeError("A MySQL pool is required");

  async function save({
    driverId,
    sapAssignmentId = null,
    name,
    lat,
    lng,
    status,
    sampledAt,
    receivedAt,
    offlineSince = null,
  }) {
    await pool.execute(
      `INSERT INTO app_driver_live_locations
                (driver_id, sap_assignment_id, display_name, latitude, longitude, status, sampled_at_ms, received_at_ms, offline_since_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                sap_assignment_id = IF(VALUES(sampled_at_ms) >= sampled_at_ms, VALUES(sap_assignment_id), sap_assignment_id),
                display_name = IF(VALUES(sampled_at_ms) >= sampled_at_ms, VALUES(display_name), display_name),
                latitude = IF(VALUES(sampled_at_ms) >= sampled_at_ms, VALUES(latitude), latitude),
                longitude = IF(VALUES(sampled_at_ms) >= sampled_at_ms, VALUES(longitude), longitude),
                status = IF(VALUES(sampled_at_ms) >= sampled_at_ms, VALUES(status), status),
                received_at_ms = IF(VALUES(sampled_at_ms) >= sampled_at_ms, VALUES(received_at_ms), received_at_ms),
                offline_since_ms = IF(VALUES(sampled_at_ms) >= sampled_at_ms, VALUES(offline_since_ms), offline_since_ms),
                sampled_at_ms = GREATEST(sampled_at_ms, VALUES(sampled_at_ms))`,
      [
        driverId,
        sapAssignmentId,
        name,
        lat,
        lng,
        status,
        sampledAt,
        receivedAt,
        offlineSince,
      ],
    );
  }

  function project(row) {
    return {
      id: row.driver_id,
      driverId: row.driver_id,
      sapDocId: row.sap_assignment_id,
      name: row.display_name,
      lat: row.latitude == null ? null : Number(row.latitude),
      lng: row.longitude == null ? null : Number(row.longitude),
      status: row.status,
      timestamp: Number(row.sampled_at_ms),
      receivedAt: Number(row.received_at_ms),
      offlineSince:
        row.offline_since_ms == null ? null : Number(row.offline_since_ms),
    };
  }

  async function list() {
    const [rows] = await pool.execute(
      `SELECT driver_id, sap_assignment_id, display_name, latitude, longitude, status,
                    sampled_at_ms, received_at_ms, offline_since_ms
               FROM app_driver_live_locations ORDER BY received_at_ms DESC LIMIT 1000`,
    );
    return rows.map(project);
  }

  async function get(driverId) {
    const [rows] = await pool.execute(
      `SELECT driver_id, sap_assignment_id, display_name, latitude, longitude, status,
                    sampled_at_ms, received_at_ms, offline_since_ms
               FROM app_driver_live_locations WHERE driver_id = ? LIMIT 1`,
      [driverId],
    );
    return rows.length ? project(rows[0]) : null;
  }

  return Object.freeze({ save, list, get });
}

let singleton;
function getMysqlLiveLocations({ pool } = {}) {
  if (!singleton)
    singleton = createMysqlLiveLocations({
      pool: pool || require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}

module.exports = { createMysqlLiveLocations, getMysqlLiveLocations };
