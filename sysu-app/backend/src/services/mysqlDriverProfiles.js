const ACTIVE_QUEUE_STATUSES = [
  "waiting",
  "called",
  "available",
  "assigned",
  "loading",
  "loaded",
  "fully_loaded",
];
const fail = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });
const iso = (value) => (value instanceof Date ? value.toISOString() : value);

function driverRecord(row) {
  if (!row) return null;
  return {
    id: row.driver_id,
    driverId: row.driver_id,
    name: row.name,
    driverName: row.name,
    phone: row.phone,
    license: row.license,
    truckType: row.truck_type,
    plateNumber: row.plate_number,
    truckingCompany: row.trucking_company,
    truckCompany: row.trucking_company,
    helper: row.helper,
    helperName: row.helper,
    notes: row.notes,
    requirements:
      typeof row.requirements === "string"
        ? JSON.parse(row.requirements)
        : row.requirements || {},
    isFull: Boolean(row.is_full),
    status: row.status,
    isReturning: row.status === "returning_to_base",
    updatedAt: iso(row.updated_at),
  };
}

function createMysqlDriverProfiles({ pool }) {
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
      throw error;
    } finally {
      connection.release();
    }
  }

  async function get(driverId) {
    const [rows] = await pool.execute(
      "SELECT * FROM app_driver_profiles WHERE driver_id = ? LIMIT 1",
      [driverId],
    );
    return driverRecord(rows[0]);
  }

  async function list() {
    const [rows] = await pool.execute(
      "SELECT * FROM app_driver_profiles ORDER BY updated_at DESC LIMIT 2000",
    );
    return rows.map(driverRecord);
  }

  async function save({ actorId, driverId, input }) {
    await transaction(async (connection) => {
      const [actors] = await connection.execute(
        "SELECT role, status FROM app_auth_users WHERE public_id = ? FOR UPDATE",
        [actorId],
      );
      if (
        actors[0]?.status !== "active" ||
        !["fleet_manager", "admin", "super_admin"].includes(actors[0]?.role)
      ) {
        throw fail(403, "Staff authorization required");
      }
      const [users] = await connection.execute(
        "SELECT role, status FROM app_auth_users WHERE public_id = ? FOR UPDATE",
        [driverId],
      );
      if (users[0]?.role !== "driver" || users[0]?.status !== "active") {
        throw fail(409, "Select an active registered driver account");
      }
      const [existing] = await connection.execute(
        "SELECT requirements FROM app_driver_profiles WHERE driver_id = ? FOR UPDATE",
        [driverId],
      );
      const storedRequirements =
        typeof existing[0]?.requirements === "string"
          ? JSON.parse(existing[0].requirements)
          : existing[0]?.requirements || {};
      const requirements = input.requirements ?? storedRequirements;
      await connection.execute(
        `INSERT INTO app_driver_profiles
                 (driver_id, name, phone, license, truck_type, plate_number, trucking_company, helper, notes, requirements)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone), license = VALUES(license),
                 truck_type = VALUES(truck_type), plate_number = VALUES(plate_number),
                 trucking_company = VALUES(trucking_company), helper = VALUES(helper), notes = VALUES(notes), requirements = VALUES(requirements)`,
        [
          driverId,
          input.name,
          input.phone,
          input.license,
          input.truckType,
          input.plateNumber,
          input.truckingCompany,
          input.helper,
          input.notes,
          JSON.stringify(requirements),
        ],
      );
      const placeholders = ACTIVE_QUEUE_STATUSES.map(() => "?").join(", ");
      await connection.execute(
        `UPDATE app_queue_entries SET registration_complete = TRUE
                 WHERE driver_id = ? AND registration_complete = FALSE AND status IN (${placeholders})`,
        [driverId, ...ACTIVE_QUEUE_STATUSES],
      );
      await connection.execute(
        "INSERT INTO app_driver_profile_audit (actor_id, driver_id, action) VALUES (?, ?, 'save')",
        [actorId, driverId],
      );
    });
    return get(driverId);
  }

  async function setCapacity(driverId, isFull) {
    await transaction(async (connection) => {
      const [result] = await connection.execute(
        "UPDATE app_driver_profiles SET is_full = ? WHERE driver_id = ?",
        [isFull, driverId],
      );
      if (!result.affectedRows) throw fail(404, "Driver not found");
      const placeholders = ACTIVE_QUEUE_STATUSES.map(() => "?").join(", ");
      await connection.execute(
        `UPDATE app_queue_entries SET is_full = ? WHERE driver_id = ? AND status IN (${placeholders})`,
        [isFull, driverId, ...ACTIVE_QUEUE_STATUSES],
      );
    });
  }

  async function setStatus(driverId, status) {
    const [result] = await pool.execute(
      "UPDATE app_driver_profiles SET status = ? WHERE driver_id = ?",
      [status, driverId],
    );
    if (!result.affectedRows) throw fail(404, "Driver profile unavailable");
    return get(driverId);
  }

  return Object.freeze({ get, list, save, setCapacity, setStatus });
}

let singleton;
function getMysqlDriverProfiles() {
  if (!singleton)
    singleton = createMysqlDriverProfiles({
      pool: require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}

module.exports = { createMysqlDriverProfiles, getMysqlDriverProfiles };
