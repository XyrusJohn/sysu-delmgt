function createMysqlDriverProfiles({pool}) {
  if (!pool?.execute) throw new TypeError('A MySQL pool is required');

  async function get(driverId) {
    const [rows] = await pool.execute(
      `SELECT u.public_id, u.display_name, u.username, u.role, u.status AS account_status,
              p.name, p.phone, p.license, p.truck_type, p.plate_number,
              COALESCE(NULLIF(p.trucking_company, ''),
                JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.truckingCompany')), '') AS trucking_company,
              p.helper, p.notes, p.requirements, p.is_full, p.status, p.updated_at
       FROM app_auth_users u LEFT JOIN app_driver_profiles p ON p.driver_id = u.public_id
       WHERE u.public_id = ? LIMIT 1`, [driverId]);
    const row = rows[0];
    if (!row || row.role !== 'driver' || row.account_status !== 'active') return null;
    const name = row.name || row.display_name || row.username || 'Driver';
    return {id: driverId, driverId, name, driverName: name, phone: row.phone || '',
      license: row.license || '', truckType: row.truck_type || '', plateNumber: row.plate_number || '',
      truckingCompany: row.trucking_company || '', truckCompany: row.trucking_company || '',
      helper: row.helper || '', helperName: row.helper || '', notes: row.notes || '',
      requirements: typeof row.requirements === 'string' ? JSON.parse(row.requirements) : row.requirements || {},
      isFull: Boolean(row.is_full), status: row.status || 'offline', isReturning: row.status === 'returning_to_base',
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at || null};
  }

  async function setStatus(driverId, status) {
    const [result] = await pool.execute(
      `INSERT INTO app_driver_profiles (driver_id, name, status)
       SELECT public_id, COALESCE(NULLIF(display_name, ''), username, 'Driver'), ?
       FROM app_auth_users WHERE public_id = ? AND role = 'driver' AND status = 'active'
       ON DUPLICATE KEY UPDATE status = VALUES(status)`, [status, driverId]);
    if (!result.affectedRows) return null;
    return get(driverId);
  }

  async function setRequirements(driverId, requirements) {
    const [result] = await pool.execute(
      `INSERT INTO app_driver_profiles (driver_id, name, requirements)
       SELECT public_id, COALESCE(NULLIF(display_name, ''), username, 'Driver'), ?
       FROM app_auth_users WHERE public_id = ? AND role = 'driver' AND status = 'active'
       ON DUPLICATE KEY UPDATE requirements = VALUES(requirements)`,
      [JSON.stringify(requirements), driverId]);
    if (!result.affectedRows) return null;
    await pool.execute("INSERT INTO app_driver_profile_audit (actor_id, driver_id, action) VALUES (?, ?, 'requirements')",
      [driverId, driverId]);
    return get(driverId);
  }

  async function updateRegistration({driverId, queueId, name, truckType, plateNumber, truckingCompany, helper, requirements}) {
    const connection = await pool.getConnection();
    let started = false;
    let discard = false;
    try {
      await connection.beginTransaction();
      started = true;
      const [users] = await connection.execute(
        `SELECT public_id FROM app_auth_users
         WHERE public_id = ? AND role = 'driver' AND status = 'active' FOR UPDATE`, [driverId]);
      if (!users[0]) {
        await connection.rollback();
        started = false;
        return null;
      }
      const [queues] = await connection.execute(
        `SELECT id FROM app_queue_entries
         WHERE id = ? AND driver_id = ? AND status IN ('waiting', 'called')
           AND registration_complete = FALSE AND is_assigned = FALSE FOR UPDATE`, [queueId, driverId]);
      if (!queues[0]) {
        await connection.rollback();
        started = false;
        return null;
      }
      await connection.execute(
        `INSERT INTO app_driver_profiles
           (driver_id, name, truck_type, plate_number, trucking_company, helper, requirements)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), truck_type = VALUES(truck_type),
           plate_number = VALUES(plate_number), trucking_company = VALUES(trucking_company),
           helper = VALUES(helper), requirements = VALUES(requirements)`,
        [driverId, name, truckType, plateNumber, truckingCompany, helper, JSON.stringify(requirements)]);
      await connection.execute(
        `UPDATE app_queue_entries SET driver_name = ?, truck_type = ?, plate_number = ?,
           truck_company = ?, helper_name = ?
         WHERE id = ? AND driver_id = ? AND status IN ('waiting', 'called')
           AND registration_complete = FALSE AND is_assigned = FALSE`,
        [name, truckType, plateNumber, truckingCompany, helper, queueId, driverId]);
      await connection.commit();
      started = false;
    } catch (error) {
      if (started) {
        try { await connection.rollback(); } catch { discard = true; }
      }
      throw error;
    } finally {
      if (discard) connection.destroy();
      else connection.release();
    }
    return get(driverId);
  }

  return Object.freeze({get, setStatus, setRequirements, updateRegistration});
}

let singleton;
function getMysqlDriverProfiles({pool} = {}) {
  if (!singleton) singleton = createMysqlDriverProfiles({pool: pool || require('../config/mysql').createMySqlPool()});
  return singleton;
}

module.exports = {createMysqlDriverProfiles, getMysqlDriverProfiles};
