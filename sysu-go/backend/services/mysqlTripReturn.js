const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_KEYS = 100;
const LOCATION_MAX_AGE_MS = 60_000;
const FUTURE_TOLERANCE_MS = 5_000;
const DEFAULT_WAREHOUSE = {lat: 14.6349, lng: 121.0392, radiusMeters: 500};

const failure = (status, code, message) => ({status, code, message});
const parse = value => {
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value && typeof value === 'object' ? value : {};
};

function distanceMeters(lat1, lng1, lat2, lng2) {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1), dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createMysqlTripReturn({pool, now = () => Date.now()}) {
  if (!pool?.getConnection) throw new TypeError('A MySQL pool is required');

  async function transition({action, driverId, dispatchKeys, queueId = null}) {
    if (!['start', 'arrived', 'complete'].includes(action)
        || typeof driverId !== 'string' || !driverId
        || !Array.isArray(dispatchKeys) || dispatchKeys.length < 1 || dispatchKeys.length > MAX_KEYS
        || dispatchKeys.some(key => typeof key !== 'string' || !TOKEN.test(key))
        || new Set(dispatchKeys).size !== dispatchKeys.length
        || (queueId != null && (typeof queueId !== 'string' || !TOKEN.test(queueId)))) {
      return failure(400, 'INVALID_RETURN', 'Invalid return request.');
    }

    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const currentTime = now();
      const [users] = await connection.execute(
        "SELECT public_id FROM app_auth_users WHERE public_id = ? AND role = 'driver' AND status = 'active' FOR UPDATE",
        [driverId]);
      if (!users[0]) return failure(403, 'DRIVER_UNAVAILABLE', 'Active driver required.');

      const [requestedRows] = await connection.execute(
        `SELECT * FROM app_sap_assignments WHERE driver_id = ?
           AND dispatch_key IN (${dispatchKeys.map(() => '?').join(',')}) FOR UPDATE`,
        [driverId, ...dispatchKeys]);
      if (requestedRows.length !== dispatchKeys.length) return failure(404, 'ASSIGNMENT_UNAVAILABLE', 'Assignment unavailable.');
      const resolvedQueueId = requestedRows[0].queue_id;
      if (!resolvedQueueId || requestedRows.some(row => row.queue_id !== resolvedQueueId)
          || (queueId && queueId !== resolvedQueueId)) {
        return failure(409, 'QUEUE_MISMATCH', 'Assignments do not belong to the same queue session.');
      }

      const [allRows] = await connection.execute(
        'SELECT * FROM app_sap_assignments WHERE queue_id = ? AND driver_id = ? FOR UPDATE',
        [resolvedQueueId, driverId]);
      const requestedSet = new Set(dispatchKeys);
      if (allRows.length !== dispatchKeys.length || allRows.some(row => !requestedSet.has(row.dispatch_key))) {
        return failure(409, 'ASSIGNMENT_SET_CHANGED', 'Refresh the trip before continuing.');
      }

      const [queues] = await connection.execute(
        'SELECT * FROM app_queue_entries WHERE id = ? AND driver_id = ? FOR UPDATE', [resolvedQueueId, driverId]);
      const queue = queues[0];
      if (!queue) return failure(404, 'QUEUE_UNAVAILABLE', 'Queue session unavailable.');

      const queueData = parse(queue.data);
      const assignmentData = new Map(allRows.map(row => [row.dispatch_key, parse(row.data)]));
      const alreadyComplete = queue.status === 'completed' && !Boolean(queue.is_assigned)
        && allRows.every(row => assignmentData.get(row.dispatch_key)?.returnStatus === 'completed');
      if (action === 'complete' && alreadyComplete) {
        await connection.commit();
        begun = false;
        return {status: 200, data: {action, queueId: resolvedQueueId, status: 'completed', driverStatus: 'online'}};
      }
      if (!Boolean(queue.is_assigned) || ['completed', 'cancelled'].includes(queue.status)) {
        return failure(409, 'QUEUE_NOT_ACTIVE', 'Queue session is no longer active.');
      }
      const states = allRows.map(row => assignmentData.get(row.dispatch_key)?.returnStatus || null);
      if (action === 'start') {
        const allPodsComplete = allRows.every(row => {
          const lineItems = parse(row.line_items);
          return Array.isArray(lineItems) && lineItems.length > 0
            && lineItems.every(item => item && typeof item === 'object' && item.isPodCompleted === true);
        });
        if (allRows.some(row => !['completed', 'delivered', 'returning_to_base'].includes(row.trip_status)
              && !(['in_transit', 'unloading'].includes(row.trip_status) && allPodsComplete))
            || states.some(state => state !== null && state !== 'returning_to_base')) {
          return failure(409, 'INVALID_RETURN_TRANSITION', 'Return journey cannot be started from the current state.');
        }
        if (states.every(state => state === 'returning_to_base')) {
          await connection.commit();
          begun = false;
          return {status: 200, data: {action, queueId: resolvedQueueId, status: 'returning_to_base', driverStatus: 'returning_to_base'}};
        }
        for (const row of allRows) {
          const data = assignmentData.get(row.dispatch_key);
          await connection.execute('UPDATE app_sap_assignments SET trip_status = ?, data = ? WHERE dispatch_key = ?',
            ['returning_to_base', JSON.stringify({...data, tripStatus: 'returning_to_base', returnStatus: 'returning_to_base', returnStartedAt: {$timestamp: currentTime}}), row.dispatch_key]);
        }
        const assignedShipments = (Array.isArray(queueData.assignedShipments) ? queueData.assignedShipments : [])
          .map(item => requestedSet.has(item?.dispatchKey) ? {...item, tripStatus: 'returning_to_base'} : item);
        await connection.execute('UPDATE app_queue_entries SET data = ? WHERE id = ?',
          [JSON.stringify({...queueData, assignedShipments, overallTripStatus: 'returning_to_base'}), resolvedQueueId]);
        await setDriverStatus(connection, driverId, 'returning_to_base');
        await connection.commit();
        begun = false;
        return {status: 200, data: {action, queueId: resolvedQueueId, status: 'returning_to_base', driverStatus: 'returning_to_base'}};
      }

      if (action === 'arrived') {
        if (allRows.some(row => row.trip_status !== 'returning_to_base')
            || states.some(state => state !== 'returning_to_base' && state !== 'arrived_at_base')) {
          return failure(409, 'INVALID_RETURN_TRANSITION', 'Arrival cannot be confirmed from the current state.');
        }
        if (states.some(state => state !== 'arrived_at_base')) {
          const [locations] = await connection.execute(
            `SELECT latitude, longitude, sampled_at_ms FROM app_driver_live_locations
             WHERE driver_id = ? LIMIT 1 FOR UPDATE`, [driverId]);
          const location = locations[0];
          const sampledAt = Number(location?.sampled_at_ms);
          if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))
              || Math.abs(Number(location.latitude)) > 90 || Math.abs(Number(location.longitude)) > 180
              || !Number.isFinite(sampledAt) || currentTime - sampledAt > LOCATION_MAX_AGE_MS
              || sampledAt - currentTime > FUTURE_TOLERANCE_MS) {
            return failure(409, 'LOCATION_STALE', 'A recent location fix is required to confirm arrival.');
          }
          const [settingsRows] = await connection.execute(
            "SELECT setting_data FROM app_settings WHERE setting_key = 'warehouse_base' LIMIT 1");
          const warehouse = {...DEFAULT_WAREHOUSE, ...parse(settingsRows[0]?.setting_data)};
          const lat = Number(warehouse.lat), lng = Number(warehouse.lng), radius = Number(warehouse.radiusMeters);
          if (![lat, lng, radius].every(Number.isFinite) || radius <= 0
              || distanceMeters(Number(location.latitude), Number(location.longitude), lat, lng) > radius) {
            return failure(409, 'OUTSIDE_GEOFENCE', 'The latest location is outside the warehouse arrival area.');
          }
        }
        for (const row of allRows) {
          const data = assignmentData.get(row.dispatch_key);
          if (data.returnStatus === 'arrived_at_base') continue;
          await connection.execute('UPDATE app_sap_assignments SET data = ? WHERE dispatch_key = ?',
            [JSON.stringify({...data, returnStatus: 'arrived_at_base', arrivedAtBaseAt: {$timestamp: currentTime}}), row.dispatch_key]);
        }
        await connection.commit();
        begun = false;
        return {status: 200, data: {action, queueId: resolvedQueueId, status: 'arrived_at_base'}};
      }

      if (allRows.some(row => row.trip_status !== 'returning_to_base')
          || states.some(state => state !== 'arrived_at_base')) {
        return failure(409, 'INVALID_RETURN_TRANSITION', 'Arrival must be validated before completing the return.');
      }
      for (const row of allRows) {
        const data = assignmentData.get(row.dispatch_key);
        if (data.returnStatus === 'completed') continue;
        await connection.execute('UPDATE app_sap_assignments SET trip_status = ?, data = ? WHERE dispatch_key = ?',
          ['completed', JSON.stringify({...data, tripStatus: 'completed', returnStatus: 'completed', completedAt: data.completedAt || {$timestamp: currentTime}, returnedToBaseAt: {$timestamp: currentTime}}), row.dispatch_key]);
      }

      const assignedShipments = (Array.isArray(queueData.assignedShipments) ? queueData.assignedShipments : [])
        .map(item => requestedSet.has(item?.dispatchKey)
          ? {...item, tripStatus: 'completed', returnStatus: 'completed', returnedToBaseAt: {$timestamp: currentTime}}
          : item);
      await connection.execute(
        "UPDATE app_queue_entries SET status = 'completed', is_assigned = FALSE, data = ? WHERE id = ? AND driver_id = ?",
        [JSON.stringify({...queueData, assignedShipments, overallTripStatus: 'completed', activeShipmentsCount: 0, completedAt: {$timestamp: currentTime}}), resolvedQueueId, driverId]);
      await setDriverStatus(connection, driverId, 'online');
      await connection.execute('DELETE FROM app_driver_live_locations WHERE driver_id = ?', [driverId]);
      await connection.commit();
      begun = false;
      return {status: 200, data: {action, queueId: resolvedQueueId, status: 'completed', driverStatus: 'online'}};
    } finally {
      if (begun) await connection.rollback();
      connection.release();
    }
  }

  return Object.freeze({transition});
}

async function setDriverStatus(connection, driverId, status) {
  await connection.execute(
    `INSERT INTO app_driver_profiles (driver_id, name, status)
     SELECT public_id, COALESCE(NULLIF(display_name, ''), username, 'Driver'), ?
       FROM app_auth_users WHERE public_id = ? AND role = 'driver' AND status = 'active'
     ON DUPLICATE KEY UPDATE status = VALUES(status)`, [status, driverId]);
}

module.exports = {createMysqlTripReturn, distanceMeters, LOCATION_MAX_AGE_MS};
let singleton;
module.exports.getMysqlTripReturn = ({pool} = {}) => {
  if (!singleton) singleton = createMysqlTripReturn({pool: pool || require('../config/mysql').createMySqlPool()});
  return singleton;
};
