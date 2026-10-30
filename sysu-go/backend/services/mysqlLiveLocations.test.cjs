const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlLiveLocations} = require('./mysqlLiveLocations');

test('live locations are written with parameterized values and mapped to socket payloads', async () => {
  const calls = [];
  const pool = {execute: async (sql, values) => {
    calls.push({sql, values});
    return [[{driver_id: 'driver-1', sap_assignment_id: 'assignment-1', display_name: 'Driver One',
      latitude: '14.5', longitude: '121.0', status: 'in_transit', sampled_at_ms: '123', received_at_ms: '124', offline_since_ms: null}], []];
  }};
  const locations = createMysqlLiveLocations({pool});
  await locations.save({driverId: 'driver-1', sapAssignmentId: 'assignment-1', name: 'Driver One',
    lat: 14.5, lng: 121, status: 'in_transit', sampledAt: 123, receivedAt: 124});
  assert.deepEqual(calls[0].values, ['driver-1', 'assignment-1', 'Driver One', 14.5, 121, 'in_transit', 123, 124, null]);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.deepEqual(await locations.list(), [{driverId: 'driver-1', sapDocId: 'assignment-1', name: 'Driver One',
    lat: 14.5, lng: 121, status: 'in_transit', timestamp: 123, receivedAt: 124, offlineSince: null}]);
});

test('live location repository rejects a missing pool', () => {
  assert.throws(() => createMysqlLiveLocations({pool: null}), /MySQL pool is required/);
});
