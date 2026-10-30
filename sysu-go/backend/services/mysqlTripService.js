const RETRY_STATUSES = new Set(['waiting', 'called', 'assigned', 'loading', 'fully_loaded', 'in_transit']);
const fail = (status, message) => Object.assign(new Error(message), {status});

function createMysqlTripService({pool}) {
  if (!pool?.getConnection) throw new TypeError('A MySQL pool is required');

  async function register({driverId, queueId, helperFN, helperMI, helperLN, company,
    truckType, plateNumber, driverPhone}) {
    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const [users] = await connection.execute(
        `SELECT u.role, u.status,
                COALESCE(NULLIF(p.trucking_company, ''),
                  JSON_UNQUOTE(JSON_EXTRACT(u.profile, '$.truckingCompany')), '') AS trucking_company
           FROM app_auth_users u
           LEFT JOIN app_driver_profiles p ON p.driver_id = u.public_id
          WHERE u.public_id = ? FOR UPDATE`, [driverId]);
      if (users[0]?.role !== 'driver' || users[0]?.status !== 'active') throw fail(403, 'Account not authorized');
      const registeredCompany = String(users[0].trucking_company || '').trim().replace(/\s+/g, ' ');
      if (!registeredCompany) throw fail(409, 'Driver company is not set');
      const [queues] = await connection.execute(
        'SELECT * FROM app_queue_entries WHERE id = ? FOR UPDATE', [queueId]);
      const row = queues[0];
      if (!row) throw fail(404, 'Queue entry not found');
      if (row.driver_id !== driverId) throw fail(403, 'Queue entry not owned by this driver');
      const prior = typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {};
      const helper = [helperFN, helperMI ? helperMI + '.' : '', helperLN].filter(Boolean).join(' ');
      if (row.registration_complete) {
        const identical = RETRY_STATUSES.has(row.status)
          && prior.helperFN === helperFN && prior.helperMI === helperMI && prior.helperLN === helperLN
          && row.truck_company === registeredCompany && row.truck_type === truckType
          && row.plate_number === plateNumber && (driverPhone == null || prior.driverPhone === driverPhone);
        if (!identical) throw fail(409, 'Queue entry cannot be registered');
      } else {
        if (row.status !== 'waiting') throw fail(409, 'Queue entry cannot be registered');
        const data = {...prior, helperFN, helperMI, helperLN, helper,
          company: registeredCompany, truckCompany: registeredCompany, truckType, plateNumber,
          ...(driverPhone != null ? {driverPhone} : {})};
        await connection.execute(
          `UPDATE app_queue_entries SET helper_name = ?, truck_company = ?, truck_type = ?,
           plate_number = ?, registration_complete = TRUE, data = ? WHERE id = ?`,
          [helper, registeredCompany, truckType, plateNumber, JSON.stringify(data), queueId]);
      }
      await connection.execute(
        `INSERT INTO app_driver_profiles (driver_id, name, trucking_company)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE trucking_company = VALUES(trucking_company)`,
        [driverId, row.driver_name || '', registeredCompany]);
      await connection.commit();
      return {queueId, tripId: queueId, registrationComplete: true, helper, plateNumber};
    } catch (error) {
      if (begun) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return Object.freeze({register});
}

let singleton;
function getMysqlTripService() {
  if (!singleton) singleton = createMysqlTripService({pool: require('../config/mysql').createMySqlPool()});
  return singleton;
}

module.exports = {createMysqlTripService, getMysqlTripService};
