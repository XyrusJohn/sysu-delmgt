const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlTripReturn} = require('../services/mysqlTripReturn');

function fixture({location = {latitude: 14.6349, longitude: 121.0392, sampled_at_ms: 100_000}, failQueueUpdate = false,
  tripStatus = 'completed', lineItems = []} = {}) {
  const state = {
    user: {public_id: 'driver-a'},
    assignments: ['dispatch-a', 'dispatch-b'].map(dispatch_key => ({dispatch_key, driver_id: 'driver-a', queue_id: 'queue-a',
      trip_status: tripStatus, line_items: JSON.stringify(lineItems),
      data: JSON.stringify({completedAt: {$timestamp: 90_000}})})),
    queue: {id: 'queue-a', driver_id: 'driver-a', status: 'loading', is_assigned: true,
      data: JSON.stringify({assignedShipments: [{dispatchKey: 'dispatch-a'}, {dispatchKey: 'dispatch-b'}]})},
    location, warehouse: {lat: 14.6349, lng: 121.0392, radiusMeters: 500}, profileStatus: 'online',
    commits: 0, rollbacks: 0, now: 100_000,
  };
  let snapshot;
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() { state.commits++; snapshot = null; },
    async rollback() { const rollbacks = state.rollbacks + 1; for (const key of Object.keys(snapshot)) state[key] = snapshot[key]; state.rollbacks = rollbacks; snapshot = null; },
    release() {},
    async execute(sql, params = []) {
      if (sql.startsWith('INSERT INTO app_driver_profiles')) {
        state.profileStatus = params[0];
        return [{affectedRows: 1}];
      }
      if (sql.includes('FROM app_auth_users')) return [[state.user].filter(Boolean)];
      if (sql.includes('FROM app_sap_assignments WHERE driver_id = ?')) {
        const keys = params.slice(1);
        return [state.assignments.filter(row => row.driver_id === params[0] && keys.includes(row.dispatch_key))];
      }
      if (sql.includes('FROM app_sap_assignments WHERE queue_id = ?')) {
        return [state.assignments.filter(row => row.queue_id === params[0] && row.driver_id === params[1])];
      }
      if (sql.includes('FROM app_queue_entries')) return [[state.queue].filter(row => row.id === params[0] && row.driver_id === params[1])];
      if (sql.startsWith('DELETE FROM app_driver_live_locations')) {
        state.location = null;
        return [{affectedRows: 1}];
      }
      if (sql.includes('FROM app_driver_live_locations')) return [[state.location].filter(Boolean)];
      if (sql.includes('FROM app_settings')) return [[{setting_data: JSON.stringify(state.warehouse)}]];
      if (sql.startsWith('UPDATE app_sap_assignments SET trip_status = ?, data = ?')) {
        const row = state.assignments.find(item => item.dispatch_key === params[2]);
        row.trip_status = params[0]; row.data = params[1];
        return [{affectedRows: 1}];
      }
      if (sql.startsWith('UPDATE app_sap_assignments SET data')) {
        const row = state.assignments.find(item => item.dispatch_key === params[1]);
        row.data = params[0];
        return [{affectedRows: 1}];
      }
      if (sql.startsWith('UPDATE app_queue_entries SET data')) {
        state.queue.data = params[0];
        return [{affectedRows: 1}];
      }
      if (sql.startsWith("UPDATE app_queue_entries SET status = 'completed'")) {
        if (failQueueUpdate) throw new Error('synthetic queue write failure');
        state.queue.status = 'completed'; state.queue.is_assigned = false; state.queue.data = params[0];
        return [{affectedRows: 1}];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return {state, service: createMysqlTripReturn({pool: {getConnection: async () => connection}, now: () => state.now})};
}

const keys = ['dispatch-a', 'dispatch-b'];

test('return flow persists start, validates arrival geofence, then atomically completes queue and profile', async () => {
  const f = fixture();
  const start = await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  assert.equal(start.status, 200);
  assert.equal(f.state.profileStatus, 'returning_to_base');
  assert.equal(JSON.parse(f.state.assignments[0].data).returnStatus, 'returning_to_base');

  const arrived = await f.service.transition({action: 'arrived', driverId: 'driver-a', dispatchKeys: keys, queueId: 'queue-a'});
  assert.equal(arrived.status, 200);
  assert.equal(JSON.parse(f.state.assignments[1].data).returnStatus, 'arrived_at_base');

  const completed = await f.service.transition({action: 'complete', driverId: 'driver-a', dispatchKeys: keys, queueId: 'queue-a'});
  assert.equal(completed.status, 200);
  assert.equal(f.state.queue.status, 'completed');
  assert.equal(f.state.queue.is_assigned, false);
  assert.equal(f.state.profileStatus, 'online');
  assert.equal(f.state.location, null);
  assert.equal(JSON.parse(f.state.assignments[0].data).returnStatus, 'completed');
});

test('return rejects incomplete assignment sets without writes', async () => {
  const f = fixture();
  const response = await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: ['dispatch-a']});
  assert.equal(response.code, 'ASSIGNMENT_SET_CHANGED');
  assert.equal(f.state.profileStatus, 'online');
  assert.equal(JSON.parse(f.state.assignments[0].data).returnStatus, undefined);
});

test('return can start after every POD is saved even if the assignment completion status is stale', async () => {
  const f = fixture({tripStatus: 'in_transit', lineItems: [{obdNumber: 'OBD-1', isPodCompleted: true}]});
  const response = await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  assert.equal(response.status, 200);
  assert.equal(f.state.assignments.every(row => row.trip_status === 'returning_to_base'), true);
  assert.equal(f.state.profileStatus, 'returning_to_base');
});

test('replaying a successful return-start request preserves its original timestamp', async () => {
  const f = fixture();
  const first = await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  const originalStartedAt = JSON.parse(f.state.assignments[0].data).returnStartedAt.$timestamp;
  f.state.now = 200_000;

  const replay = await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});

  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(JSON.parse(f.state.assignments[0].data).returnStartedAt.$timestamp, originalStartedAt);
  assert.equal(JSON.parse(f.state.assignments[1].data).returnStartedAt.$timestamp, originalStartedAt);
});

test('return still rejects an in-transit shipment when any POD is incomplete', async () => {
  const f = fixture({tripStatus: 'in_transit', lineItems: [{obdNumber: 'OBD-1', isPodCompleted: false}]});
  const response = await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  assert.equal(response.status, 409);
  assert.equal(response.code, 'INVALID_RETURN_TRANSITION');
  assert.equal(f.state.assignments.every(row => row.trip_status === 'in_transit'), true);
  assert.equal(f.state.profileStatus, 'online');
});

test('return rejects an assignment owned by another driver', async () => {
  const f = fixture();
  f.state.assignments[1].driver_id = 'driver-b';
  const response = await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  assert.equal(response.code, 'ASSIGNMENT_UNAVAILABLE');
  assert.equal(f.state.profileStatus, 'online');
});

test('arrival rejects stale and outside-geofence SQL locations', async () => {
  const stale = fixture({location: {latitude: 14.6349, longitude: 121.0392, sampled_at_ms: 1}});
  await stale.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  const staleResult = await stale.service.transition({action: 'arrived', driverId: 'driver-a', dispatchKeys: keys});
  assert.equal(staleResult.code, 'LOCATION_STALE');
  assert.equal(JSON.parse(stale.state.assignments[0].data).returnStatus, 'returning_to_base');

  const outside = fixture({location: {latitude: 14.7, longitude: 121.1, sampled_at_ms: 100_000}});
  await outside.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  const outsideResult = await outside.service.transition({action: 'arrived', driverId: 'driver-a', dispatchKeys: keys});
  assert.equal(outsideResult.code, 'OUTSIDE_GEOFENCE');
});

test('completion before validated arrival is rejected', async () => {
  const f = fixture();
  await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  const response = await f.service.transition({action: 'complete', driverId: 'driver-a', dispatchKeys: keys});
  assert.equal(response.code, 'INVALID_RETURN_TRANSITION');
  assert.equal(f.state.queue.status, 'loading');
});

test('completion rolls back all writes if queue release fails', async () => {
  const f = fixture({failQueueUpdate: true});
  await f.service.transition({action: 'start', driverId: 'driver-a', dispatchKeys: keys});
  await f.service.transition({action: 'arrived', driverId: 'driver-a', dispatchKeys: keys});
  f.state.commits = 0;
  await assert.rejects(() => f.service.transition({action: 'complete', driverId: 'driver-a', dispatchKeys: keys}), /synthetic queue write failure/);
  assert.equal(f.state.queue.status, 'loading');
  assert.equal(f.state.profileStatus, 'returning_to_base');
  assert.equal(f.state.location.sampled_at_ms, 100_000);
  assert.equal(JSON.parse(f.state.assignments[0].data).returnStatus, 'arrived_at_base');
  assert.equal(f.state.rollbacks, 1);
});
