const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlAssignments} = require('./mysqlAssignments');

function fixture() {
  const rows = new Map([
    ['previous', {dispatch_key: 'previous', driver_id: 'driver-1', queue_id: 'queue-1', trip_status: 'in_transit', data: {driverConfirmed: true}}],
    ['next', {dispatch_key: 'next', driver_id: 'driver-1', queue_id: 'queue-1', trip_status: 'loaded', data: {driverConfirmed: true}}],
    ['foreign', {dispatch_key: 'foreign', driver_id: 'driver-2', queue_id: 'queue-2', trip_status: 'loaded', data: {}}],
  ]);
  let snapshot;
  const execute = async (sql, params = []) => {
    if (sql.startsWith('SELECT * FROM app_sap_assignments WHERE driver_id')) {
      const driverId = params[0], keys = new Set(params.slice(1));
      return [[...rows.values()].filter(row => row.driver_id === driverId && keys.has(row.dispatch_key)).map(copy)];
    }
    if (sql.startsWith('SELECT dispatch_key, data FROM app_sap_assignments')) {
      const driverId = params[0], keys = new Set(params.slice(1));
      return [[...rows.values()].filter(row => row.driver_id === driverId && keys.has(row.dispatch_key)).map(copy)];
    }
    if (sql.startsWith('SELECT dispatch_key FROM app_sap_assignments WHERE driver_id')) {
      return [[...rows.values()].filter(row => row.driver_id === params[0] && row.trip_status === 'in_transit')
        .map(row => ({dispatch_key: row.dispatch_key}))];
    }
    if (sql.startsWith('SELECT * FROM app_sap_assignments WHERE dispatch_key')) {
      const row = rows.get(params[0]);
      return [row ? [copy(row)] : []];
    }
    if (sql.startsWith('UPDATE app_sap_assignments SET trip_status')) {
      if (params.length === 2) {
        const [data, key] = params;
        rows.get(key).trip_status = sql.includes("trip_status = 'completed'") ? 'completed' : 'in_transit';
        rows.get(key).data = JSON.parse(data);
        return [{affectedRows: 1}];
      }
      const [status, data, key] = params;
      Object.assign(rows.get(key), {trip_status: status, data: JSON.parse(data)});
      return [{affectedRows: 1}];
    }
    if (sql.startsWith('UPDATE app_sap_assignments SET data')) {
      const [data, key] = params;
      rows.get(key).data = JSON.parse(data);
      return [{affectedRows: 1}];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = {execute, async beginTransaction() { snapshot = structuredClone([...rows]); },
    async commit() {}, async rollback() { rows.clear(); for (const [key, row] of snapshot) rows.set(key, row); }, release() {}};
  const pool = {execute, async getConnection() { return connection; }};
  const service = createMysqlAssignments({pool});
  return {rows, service};
}

const copy = row => ({...row});

test('SQL assignment confirmation scopes all writes to the authenticated driver', async () => {
  const {rows, service} = fixture();
  const result = await service.confirmMany({dispatchKeys: ['next'], driverId: 'driver-1'});
  assert.equal(result.status, 200);
  assert.equal(result.data[0].driverConfirmed, true);
  const denied = await service.confirmMany({dispatchKeys: ['foreign'], driverId: 'driver-1'});
  assert.equal(denied.status, 404);
  assert.deepEqual(rows.get('foreign').data, {});
});

test('SQL assignment update enforces ownership and valid status transitions', async () => {
  const {service} = fixture();
  assert.equal((await service.updateOwn({dispatchKey: 'foreign', driverId: 'driver-1', patch: {status: 'in_transit'}})).status, 403);
  assert.equal((await service.updateOwn({dispatchKey: 'next', driverId: 'driver-1', patch: {status: 'completed'}})).status, 409);
  const updated = await service.updateOwn({dispatchKey: 'next', driverId: 'driver-1', patch: {status: 'in_transit'}});
  assert.equal(updated.status, 200);
  assert.equal(updated.data.tripStatus, 'in_transit');
});

test('starting a shipment atomically completes the previous active shipment', async () => {
  const {rows, service} = fixture();
  const missingAnchor = await service.startTrip({driverId: 'driver-1', nextDispatchKey: 'next'});
  assert.equal(missingAnchor.status, 409);
  assert.equal(rows.get('previous').trip_status, 'in_transit');
  const result = await service.startTrip({driverId: 'driver-1', previousDispatchKey: 'previous', nextDispatchKey: 'next'});
  assert.equal(result.status, 200);
  assert.equal(rows.get('previous').trip_status, 'completed');
  assert.equal(rows.get('next').trip_status, 'in_transit');
  assert.ok(rows.get('previous').data.completedAt.$timestamp);
  assert.ok(rows.get('next').data.startedAt.$timestamp);
});

test('starting a shipment rejects another driver and unconfirmed cargo', async () => {
  const {rows, service} = fixture();
  assert.equal((await service.startTrip({driverId: 'driver-1', nextDispatchKey: 'foreign'})).status, 404);
  rows.get('next').data.driverConfirmed = false;
  assert.equal((await service.startTrip({driverId: 'driver-1', nextDispatchKey: 'next'})).status, 409);
  assert.equal(rows.get('next').trip_status, 'loaded');
});
