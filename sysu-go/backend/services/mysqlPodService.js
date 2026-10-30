const crypto = require('node:crypto');
const {applyPodGroupProgress, applyPodProgress} = require('./podProgress');

const json = value => typeof value === 'string' ? JSON.parse(value) : value;
function assignment(row) {
  const data = json(row.data) || {};
  return {...data, id: row.dispatch_key, dispatchKey: row.dispatch_key, driverId: row.driver_id,
    queueId: row.queue_id, lineItems: json(row.line_items), tripStatus: row.trip_status};
}

function createMysqlPodService({pool, now = () => Date.now()}) {
  if (!pool?.getConnection || !pool?.execute) throw new TypeError('A MySQL pool is required');

  async function transaction(work) {
    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const value = await work(connection);
      await connection.commit();
      begun = false;
      return value;
    } catch (error) {
      if (begun) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function lockAssignment(connection, dispatchKey, driverId) {
    const [rows] = await connection.execute('SELECT * FROM app_sap_assignments WHERE dispatch_key = ? FOR UPDATE', [dispatchKey]);
    if (!rows[0]) throw Object.assign(new Error('Shipment not found'), {status: 404});
    const value = assignment(rows[0]);
    if (value.driverId !== driverId) throw Object.assign(new Error('Shipment not authorized'), {status: 403});
    return value;
  }

  async function saveLineItems(connection, dispatchKey, rows) {
    await connection.execute('UPDATE app_sap_assignments SET line_items = ? WHERE dispatch_key = ?',
      [JSON.stringify(rows), dispatchKey]);
  }

  async function saveGroup({dispatchKey, driverId, input}) {
    const capturedAt = input.action === 'complete' ? input.capturedAtMillis : null;
    const groupId = input.action === 'complete'
      ? crypto.createHash('sha256').update(`${driverId}\u0000${dispatchKey}\u0000${input.captureId}`).digest('hex') : null;
    return transaction(async connection => {
      const existing = await lockAssignment(connection, dispatchKey, driverId);
      const rows = applyPodGroupProgress(existing, driverId, input, groupId, now());
      if (input.action === 'complete') {
        const [groups] = await connection.execute('SELECT * FROM app_pod_groups WHERE id = ? FOR UPDATE', [groupId]);
        if (groups[0] && (groups[0].capture_id !== input.captureId || groups[0].driver_id !== driverId
          || Number(groups[0].captured_at_ms) !== capturedAt || groups[0].delivery_status !== input.deliveryStatus)) {
          throw Object.assign(new Error('Capture ID has already been used'), {status: 409});
        }
        if (!groups[0]) await connection.execute(
          `INSERT INTO app_pod_groups
             (id, dispatch_key, capture_id, driver_id, image_data, captured_at_ms, recorded_at_ms, delivery_status, obd_numbers)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [groupId, dispatchKey, input.captureId, driverId, input.base64Image, capturedAt, now(), input.deliveryStatus,
            JSON.stringify(input.obdNumbers)]);
        for (const obdNumber of input.obdNumbers) await connection.execute(
          `INSERT INTO app_pod_images
             (dispatch_key, obd_number, group_pod_id, driver_id, captured_at_ms, recorded_at_ms, delivery_status)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE group_pod_id = VALUES(group_pod_id), driver_id = VALUES(driver_id),
             image_data = NULL, captured_at_ms = VALUES(captured_at_ms), recorded_at_ms = VALUES(recorded_at_ms),
             delivery_status = VALUES(delivery_status)`,
          [dispatchKey, obdNumber, groupId, driverId, capturedAt, now(), input.deliveryStatus]);
      }
      await saveLineItems(connection, dispatchKey, rows);
      return {obdNumbers: input.obdNumbers, podGroupId: groupId, capturedAtMillis: capturedAt};
    });
  }

  async function saveSingle({dispatchKey, obdNumber, driverId, input}) {
    return transaction(async connection => {
      const existing = await lockAssignment(connection, dispatchKey, driverId);
      const rows = applyPodProgress(existing, driverId, obdNumber, input, now());
      const [previous] = input.action === 'unload' ? [[]] : await connection.execute(
        'SELECT group_pod_id FROM app_pod_images WHERE dispatch_key = ? AND obd_number = ? FOR UPDATE', [dispatchKey, obdNumber]);
      const previousGroupId = previous[0]?.group_pod_id;
      if (input.action === 'complete') await connection.execute(
        `INSERT INTO app_pod_images
           (dispatch_key, obd_number, group_pod_id, driver_id, image_data, captured_at_ms, recorded_at_ms, delivery_status)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE group_pod_id = NULL, driver_id = VALUES(driver_id), image_data = VALUES(image_data),
           captured_at_ms = VALUES(captured_at_ms), recorded_at_ms = VALUES(recorded_at_ms), delivery_status = VALUES(delivery_status)`,
        [dispatchKey, obdNumber, driverId, input.base64Image, input.capturedAtMillis, now(), input.deliveryStatus]);
      if (input.action === 'retake') await connection.execute(
        'DELETE FROM app_pod_images WHERE dispatch_key = ? AND obd_number = ?', [dispatchKey, obdNumber]);
      if (previousGroupId && input.action === 'retake') {
        const [remaining] = await connection.execute('SELECT COUNT(*) AS total FROM app_pod_images WHERE group_pod_id = ?', [previousGroupId]);
        if (!Number(remaining[0].total)) await connection.execute('DELETE FROM app_pod_groups WHERE id = ?', [previousGroupId]);
      }
      await saveLineItems(connection, dispatchKey, rows);
      return {obdNumber, capturedAtMillis: input.capturedAtMillis ?? null};
    });
  }

  async function readPodRow(dispatchKey, obdNumber) {
    const [rows] = await pool.execute(
      `SELECT i.obd_number, i.group_pod_id, i.driver_id, i.image_data, i.captured_at_ms,
              i.recorded_at_ms, i.delivery_status, g.image_data AS group_image, g.captured_at_ms AS group_captured_at_ms
         FROM app_pod_images i LEFT JOIN app_pod_groups g ON g.id = i.group_pod_id
        WHERE i.dispatch_key = ? AND i.obd_number = ? LIMIT 1`, [dispatchKey, obdNumber]);
    if (!rows[0]) throw Object.assign(new Error('POD unavailable'), {status: 404});
    return rows[0];
  }

  function projectPod(row) {
    return {obdNumber: row.obd_number, groupPodId: row.group_pod_id,
      base64Image: row.image_data || row.group_image || null,
      capturedAtMillis: Number(row.captured_at_ms || row.group_captured_at_ms),
      recordedAtMillis: Number(row.recorded_at_ms), deliveryStatus: row.delivery_status};
  }

  async function get(dispatchKey, obdNumber, driverId) {
    const row = await readPodRow(dispatchKey, obdNumber);
    if (row.driver_id !== driverId) throw Object.assign(new Error('POD unavailable'), {status: 404});
    return projectPod(row);
  }

  async function getForStaff(dispatchKey, obdNumber) {
    return projectPod(await readPodRow(dispatchKey, obdNumber));
  }

  return Object.freeze({saveGroup, saveSingle, get, getForStaff});
}

let singleton;
function getMysqlPodService({pool} = {}) {
  if (!singleton) singleton = createMysqlPodService({pool: pool || require('../config/mysql').createMySqlPool()});
  return singleton;
}

module.exports = {createMysqlPodService, getMysqlPodService};
