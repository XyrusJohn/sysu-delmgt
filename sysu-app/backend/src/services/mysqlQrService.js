const { randomBytes, randomUUID } = require("node:crypto");

const TRUCK_TYPES = ["AUV", "4W", "6W", "10W", "20F", "40F"];
const ACTIVE = [
  "waiting",
  "called",
  "available",
  "assigned",
  "loading",
  "loaded",
  "fully_loaded",
  "in_transit",
  "unloading",
  "returning_to_base",
];
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const QR_CLEANUP_LOCK = "sysu-app-qr-token-cleanup";
const QR_USED_TOKEN_GRACE_MS = 24 * 60 * 60 * 1000;
const fail = (status, message) =>
  Object.assign(new Error(message), { status, statusCode: status });
const clean = (value, max) =>
  String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
const json = (value) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) || {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
};

function queueRecord(row) {
  const extra = json(row.data);
  return {
    ...extra,
    id: row.id,
    driverId: row.driver_id,
    driverName: row.driver_name,
    token: row.token,
    truckType: row.truck_type,
    plateNumber: row.plate_number,
    truckCompany: row.truck_company,
    helperName: row.helper_name,
    status: row.status,
    entryTime: { $timestamp: Number(row.entry_time_ms) },
    joinedAt: { $timestamp: Number(row.entry_time_ms) },
    registrationComplete: Boolean(row.registration_complete),
    isAssigned: Boolean(row.is_assigned),
    isFull: Boolean(row.is_full),
  };
}

function createMysqlQrService({ pool, now = () => Date.now() }) {
  if (!pool?.getConnection || !pool?.execute)
    throw new TypeError("A MySQL pool is required");

  async function transaction(work) {
    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      if (begun) await connection.rollback();
      if (error.code === "ER_DUP_ENTRY")
        throw fail(409, "Driver already has an active queue entry");
      throw error;
    } finally {
      connection.release();
    }
  }

  async function generate(ttlMs) {
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 60000 ||
      ttlMs > 48 * 60 * 60 * 1000
    )
      throw fail(400, "Invalid token lifetime");
    const token = "SYS-" + randomBytes(16).toString("hex").toUpperCase();
    const expiresAtMs = now() + ttlMs;
    await pool.execute(
      "INSERT INTO app_qr_tokens (token, expires_at_ms) VALUES (?, ?)",
      [token, expiresAtMs],
    );
    return { token, expiresAtMs };
  }

  async function cleanupExpiredTokens({ batchSize = 500, maxBatches = 10 } = {}) {
    const boundedBatchSize = Number.isInteger(batchSize)
      ? Math.min(1000, Math.max(1, batchSize))
      : 500;
    const boundedMaxBatches = Number.isInteger(maxBatches)
      ? Math.min(20, Math.max(1, maxBatches))
      : 10;
    const connection = await pool.getConnection();
    let lockAcquired = false;
    let connectionDestroyed = false;
    try {
      const [locks] = await connection.execute(
        "SELECT GET_LOCK(?, 0) AS acquired",
        [QR_CLEANUP_LOCK],
      );
      if (Number(locks[0]?.acquired) !== 1)
        return { deleted: 0, batches: 0, skipped: true };
      lockAcquired = true;

      let deleted = 0;
      let batches = 0;
      for (; batches < boundedMaxBatches; batches += 1) {
        const [result] = await connection.execute(
          `DELETE FROM app_qr_tokens
            WHERE expires_at_ms <= ?
              AND (used = FALSE OR (used = TRUE AND COALESCE(used_at_ms, expires_at_ms) <= ?))
            ORDER BY expires_at_ms ASC
            LIMIT ?`,
          [now(), now() - QR_USED_TOKEN_GRACE_MS, boundedBatchSize],
        );
        deleted += Number(result.affectedRows) || 0;
        if (Number(result.affectedRows) < boundedBatchSize) {
          batches += 1;
          break;
        }
      }
      return { deleted, batches, skipped: false };
    } finally {
      if (lockAcquired) {
        try {
          await connection.execute("SELECT RELEASE_LOCK(?)", [QR_CLEANUP_LOCK]);
        } catch (error) {
          connection.destroy?.();
          connectionDestroyed = true;
          throw error;
        }
      }
      if (!connectionDestroyed) connection.release();
    }
  }

  async function verify(token) {
    if (!TOKEN.test(token || "")) throw fail(400, "Invalid QR token");
    const [rows] = await pool.execute(
      "SELECT token, expires_at_ms, used FROM app_qr_tokens WHERE token = ?",
      [token],
    );
    if (!rows[0]) throw fail(404, "Invalid QR token");
    if (rows[0].used || Number(rows[0].expires_at_ms) <= now())
      throw fail(410, "QR token expired or already used");
    return { token, expiresAtMs: Number(rows[0].expires_at_ms) };
  }

  async function scan({
    token,
    driverId,
    driverName,
    truckType,
    plateNumber,
    truckCompany,
    helperName,
    driverFN,
    driverMI,
    driverLN,
    driverPhone,
  }) {
    if (
      !TOKEN.test(token || "") ||
      typeof driverId !== "string" ||
      !driverId ||
      !TRUCK_TYPES.includes(String(truckType || "").toUpperCase())
    )
      throw fail(400, "Invalid QR registration fields");
    return transaction(async (connection) => {
      const [users] = await connection.execute(
        "SELECT role, status FROM app_auth_users WHERE public_id = ? FOR UPDATE",
        [driverId],
      );
      if (users[0]?.role !== "driver" || users[0]?.status !== "active")
        throw fail(403, "Active driver required");
      const [tokens] = await connection.execute(
        "SELECT token, expires_at_ms, used FROM app_qr_tokens WHERE token = ? FOR UPDATE",
        [token],
      );
      if (!tokens[0]) throw fail(404, "Invalid QR token");
      if (tokens[0].used || Number(tokens[0].expires_at_ms) <= now())
        throw fail(410, "QR token expired or already used");
      const placeholders = ACTIVE.map(() => "?").join(", ");
      const [active] = await connection.execute(
        `SELECT id FROM app_queue_entries WHERE driver_id = ? AND status IN (${placeholders}) LIMIT 1`,
        [driverId, ...ACTIVE],
      );
      if (active.length)
        throw fail(409, "Driver already has an active queue entry");
      const queueId = randomUUID();
      const timestamp = now();
      const extra = {
        driverFN: clean(driverFN, 100),
        driverMI: clean(driverMI, 100),
        driverLN: clean(driverLN, 100),
        driverPhone: clean(driverPhone, 20),
      };
      await connection.execute(
        `INSERT INTO app_queue_entries
                 (id, driver_id, driver_name, token, truck_type, plate_number, truck_company, helper_name,
                  status, entry_time_ms, registration_complete, is_assigned, is_full, data)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, FALSE, FALSE, FALSE, ?)`,
        [
          queueId,
          driverId,
          clean(driverName, 100),
          token,
          String(truckType).toUpperCase(),
          clean(plateNumber, 20),
          clean(truckCompany, 100),
          clean(helperName, 100),
          timestamp,
          JSON.stringify(extra),
        ],
      );
      await connection.execute(
        `INSERT INTO app_qr_admissions (driver_id, queue_id, updated_at_ms) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE queue_id = VALUES(queue_id), updated_at_ms = VALUES(updated_at_ms)`,
        [driverId, queueId, timestamp],
      );
      await connection.execute(
        "UPDATE app_qr_tokens SET used = TRUE, used_by = ?, used_at_ms = ?, queue_id = ? WHERE token = ?",
        [driverId, timestamp, queueId, token],
      );
      return { queueId };
    });
  }

  async function listQueue({ registeredOnly = true, limit = 101 } = {}) {
    const [rows] = registeredOnly
      ? await pool.execute(
          `SELECT * FROM app_queue_entries WHERE status IN ('waiting', 'called')
                 AND registration_complete = TRUE ORDER BY entry_time_ms ASC, id ASC LIMIT ?`,
          [limit],
        )
      : await pool.execute(
          `SELECT * FROM app_queue_entries WHERE status IN ('waiting', 'called')
                 ORDER BY entry_time_ms ASC, id ASC LIMIT ?`,
          [limit],
        );
    return rows.map(queueRecord);
  }

  async function listAll({ limit = 100, order = "asc" } = {}) {
    const boundedLimit = Number.isInteger(limit)
      ? Math.min(100, Math.max(1, limit))
      : 100;
    const direction = order === "desc" ? "DESC" : "ASC";
    const [rows] = await pool.execute(
      `SELECT * FROM app_queue_entries ORDER BY entry_time_ms ${direction}, id ${direction} LIMIT ?`,
      [boundedLimit],
    );
    return rows.map(queueRecord);
  }

  async function get(queueId) {
    const [rows] = await pool.execute(
      "SELECT * FROM app_queue_entries WHERE id = ? LIMIT 1",
      [queueId],
    );
    return rows[0] ? queueRecord(rows[0]) : null;
  }

  async function listOwn(driverId) {
    const [rows] = await pool.execute(
      "SELECT * FROM app_queue_entries WHERE driver_id = ? ORDER BY entry_time_ms DESC LIMIT 100",
      [driverId],
    );
    return rows.map(queueRecord);
  }

  async function ownPosition(driverId, queueId) {
    const own = await get(queueId);
    if (!own || own.driverId !== driverId) throw fail(404, "Queue unavailable");
    if (
      !own.registrationComplete ||
      own.isAssigned ||
      !["waiting", "called"].includes(own.status) ||
      !TRUCK_TYPES.includes(own.truckType)
    )
      return { queueId, position: null };
    const [count] = await pool.execute(
      `SELECT COUNT(*) AS total FROM app_queue_entries
             WHERE status IN ('waiting', 'called')`,
      [],
    );
    if (Number(count[0].total) > 2000) throw fail(503, "Queue unavailable");
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS position FROM app_queue_entries
             WHERE registration_complete = TRUE AND is_assigned = FALSE
               AND status IN ('waiting', 'called') AND truck_type = ?
               AND (entry_time_ms < ? OR (entry_time_ms = ? AND id <= ?))`,
      [
        own.truckType,
        own.entryTime.$timestamp,
        own.entryTime.$timestamp,
        queueId,
      ],
    );
    return { queueId, position: Number(rows[0].position) || null };
  }

  async function updateStatus(queueId, status) {
    const [result] = await pool.execute(
      "UPDATE app_queue_entries SET status = ? WHERE id = ?",
      [status, queueId],
    );
    if (!result.affectedRows) throw fail(404, "Queue entry not found");
    return { queueId, status };
  }

  return Object.freeze({
    generate,
    cleanupExpiredTokens,
    verify,
    scan,
    listQueue,
    listAll,
    get,
    listOwn,
    ownPosition,
    updateStatus,
  });
}

let singleton;
function getMysqlQrService({ pool } = {}) {
  if (!singleton)
    singleton = createMysqlQrService({
      pool: pool || require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}

module.exports = { createMysqlQrService, getMysqlQrService, TRUCK_TYPES };
