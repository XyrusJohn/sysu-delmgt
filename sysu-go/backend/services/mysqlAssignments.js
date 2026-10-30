function createMysqlAssignments({pool}) {
  if (!pool || typeof pool.execute !== 'function') throw new TypeError('A MySQL pool is required');

  async function transaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function get(dispatchKey) {
    const [rows] = await pool.execute('SELECT * FROM app_sap_assignments WHERE dispatch_key = ?', [dispatchKey]);
    return rows[0] ? project(rows[0]) : null;
  }

  function project(row) {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {};
    return {...data, id: row.dispatch_key, dispatchKey: row.dispatch_key,
      driverId: row.driver_id, queueId: row.queue_id, driverName: row.driver_name,
      truckPlate: row.truck_plate, truckCompany: row.truck_company, truckType: row.truck_type,
      lineItems: typeof row.line_items === 'string' ? JSON.parse(row.line_items) : row.line_items,
      assignedAt: {$timestamp: Number(row.assigned_at_ms)}, assignedBy: row.assigned_by,
      sapSourceFetchedAt: {$timestamp: Number(row.sap_source_fetched_at_ms)},
      tripStatus: row.trip_status};
  }

  async function listOwn(driverId) {
    const [rows] = await pool.execute(
      'SELECT * FROM app_sap_assignments WHERE driver_id = ? ORDER BY assigned_at_ms DESC LIMIT 1000', [driverId]);
    return rows.map(project);
  }

  async function hasActiveShipment(driverId) {
    const [rows] = await pool.execute(
      `SELECT 1 FROM app_sap_assignments WHERE driver_id = ?
         AND trip_status IN ('assigned', 'loading', 'loaded', 'fully_loaded', 'in_transit', 'unloading', 'returning_to_base')
       LIMIT 1`, [driverId]);
    return rows.length > 0;
  }

  async function confirmMany({dispatchKeys, driverId}) {
    return transaction(async connection => {
      const keys = [...new Set(dispatchKeys)];
      const [rows] = await connection.execute(
        `SELECT dispatch_key, data FROM app_sap_assignments
         WHERE driver_id = ? AND dispatch_key IN (${keys.map(() => '?').join(',')}) FOR UPDATE`,
        [driverId, ...keys]);
      if (rows.length !== keys.length) return {status: 404, code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment unavailable.'};
      for (const row of rows) {
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {};
        await connection.execute('UPDATE app_sap_assignments SET data = ? WHERE dispatch_key = ?',
          [JSON.stringify({...data, driverConfirmed: true}), row.dispatch_key]);
      }
      const assignments = [];
      for (const key of keys) {
        const [updated] = await connection.execute('SELECT * FROM app_sap_assignments WHERE dispatch_key = ?', [key]);
        assignments.push(project(updated[0]));
      }
      return {status: 200, data: assignments};
    });
  }

  async function updateOwn({dispatchKey, driverId, patch}) {
    const transitions = {
      assigned: new Set(['loading', 'fully_loaded', 'loaded', 'in_transit']),
      loading: new Set(['fully_loaded', 'loaded']),
      fully_loaded: new Set(['loading', 'loaded']),
      loaded: new Set(['in_transit', 'loading']),
      in_transit: new Set(['unloading', 'returning_to_base', 'completed']),
      unloading: new Set(['in_transit', 'completed']),
      returning_to_base: new Set(['completed']), completed: new Set(),
    };
    return transaction(async connection => {
      const [rows] = await connection.execute(
        'SELECT * FROM app_sap_assignments WHERE dispatch_key = ? FOR UPDATE', [dispatchKey]);
      const row = rows[0];
      if (!row) return {status: 404, code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment unavailable.'};
      if (row.driver_id !== driverId) return {status: 403, code: 'FORBIDDEN', message: 'Assignment unavailable.'};
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {};
      const status = patch.status === null ? 'assigned' : patch.status === undefined ? row.trip_status : patch.status;
      if (patch.status !== undefined && status !== row.trip_status && !transitions[row.trip_status]?.has(status)
          && !(patch.status === null && ['loading', 'fully_loaded'].includes(row.trip_status))) {
        return {status: 409, code: 'INVALID_TRANSITION', message: 'Assignment state cannot move to the requested state.'};
      }
      const updatedData = {...data};
      for (const field of ['driverConfirmed', 'guardVerified', 'guardFirstName', 'guardLastName', 'guardMI', 'guardSignatureBase64']) {
        if (patch[field] !== undefined) updatedData[field] = patch[field];
      }
      if (patch.status === 'in_transit') updatedData.startedAt = {$timestamp: Date.now()};
      if (patch.status === 'completed') updatedData.completedAt = {$timestamp: Date.now()};
      await connection.execute('UPDATE app_sap_assignments SET trip_status = ?, data = ? WHERE dispatch_key = ?',
        [status, JSON.stringify(updatedData), dispatchKey]);
      const [updated] = await connection.execute('SELECT * FROM app_sap_assignments WHERE dispatch_key = ?', [dispatchKey]);
      return {status: 200, data: project(updated[0])};
    });
  }

  async function startTrip({driverId, previousDispatchKey, nextDispatchKey}) {
    return transaction(async connection => {
      const keys = [...new Set([previousDispatchKey, nextDispatchKey].filter(Boolean))];
      const [rows] = await connection.execute(
        `SELECT * FROM app_sap_assignments WHERE driver_id = ? AND dispatch_key IN (${keys.map(() => '?').join(',')}) FOR UPDATE`,
        [driverId, ...keys]);
      const assignments = new Map(rows.map(row => [row.dispatch_key, row]));
      const next = assignments.get(nextDispatchKey);
      if (!next) return {status: 404, code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment unavailable.'};

      const [activeRows] = await connection.execute(
        "SELECT dispatch_key FROM app_sap_assignments WHERE driver_id = ? AND trip_status = 'in_transit' FOR UPDATE",
        [driverId]);
      const activeKeys = activeRows.map(row => row.dispatch_key);
      if (activeKeys.length > 1 || (activeKeys.length === 1 && activeKeys[0] !== previousDispatchKey)) {
        return {status: 409, code: 'ACTIVE_SHIPMENT_CHANGED', message: 'Active shipment changed. Refresh and retry.'};
      }
      if (previousDispatchKey && activeKeys[0] !== previousDispatchKey) {
        return {status: 409, code: 'ACTIVE_SHIPMENT_CHANGED', message: 'Active shipment changed. Refresh and retry.'};
      }
      if (next.trip_status !== 'loaded' && next.trip_status !== 'fully_loaded') {
        return {status: 409, code: 'INVALID_TRANSITION', message: 'Selected shipment is not ready to start.'};
      }
      const nextData = typeof next.data === 'string' ? JSON.parse(next.data) : next.data || {};
      if (nextData.driverConfirmed !== true) return {status: 409, code: 'SHIPMENT_NOT_CONFIRMED', message: 'Confirm the shipment before starting.'};
      if (previousDispatchKey && previousDispatchKey !== nextDispatchKey) {
        const previous = assignments.get(previousDispatchKey);
        if (!previous || previous.trip_status !== 'in_transit') {
          return {status: 409, code: 'ACTIVE_SHIPMENT_CHANGED', message: 'Active shipment changed. Refresh and retry.'};
        }
        const previousData = typeof previous.data === 'string' ? JSON.parse(previous.data) : previous.data || {};
        await connection.execute('UPDATE app_sap_assignments SET trip_status = \'completed\', data = ? WHERE dispatch_key = ?',
          [JSON.stringify({...previousData, tripStatus: 'completed', completedAt: {$timestamp: Date.now()}}), previousDispatchKey]);
      }
      await connection.execute('UPDATE app_sap_assignments SET trip_status = \'in_transit\', data = ? WHERE dispatch_key = ?',
        [JSON.stringify({...nextData, tripStatus: 'in_transit', startedAt: {$timestamp: Date.now()}}), nextDispatchKey]);
      const [updated] = await connection.execute('SELECT * FROM app_sap_assignments WHERE dispatch_key = ?', [nextDispatchKey]);
      return {status: 200, data: project(updated[0])};
    });
  }

  return Object.freeze({get, listOwn, hasActiveShipment, confirmMany, updateOwn, startTrip});
}

let singleton;
function getMysqlAssignments({pool} = {}) {
  if (!singleton) singleton = createMysqlAssignments({pool: pool || require('../config/mysql').createMySqlPool()});
  return singleton;
}

module.exports = {createMysqlAssignments, getMysqlAssignments};
