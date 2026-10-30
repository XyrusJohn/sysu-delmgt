const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlLiveLocations} = require('./mysqlLiveLocations');

test('MySQL live locations preserve parameterized GPS writes and project saved state', async () => {
    const calls = [];
    const pool = {execute: async (sql, params) => {
        calls.push({sql, params});
        if (sql.startsWith('SELECT')) return [[{
            driver_id: 'driver-1', sap_assignment_id: null, display_name: 'Driver',
            latitude: '14.5000000', longitude: '121.0000000', status: 'online',
            sampled_at_ms: 100, received_at_ms: 110, offline_since_ms: null,
        }]];
        return [{affectedRows: 1}];
    }};
    const locations = createMysqlLiveLocations({pool});
    await locations.save({driverId: 'driver-1', name: 'Driver', lat: 14.5, lng: 121,
        status: 'online', sampledAt: 100, receivedAt: 110});
    assert.equal(calls[0].params[0], 'driver-1');
    assert.equal(calls[0].params[3], 14.5);
    assert.match(calls[0].sql, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)/);
    assert.deepEqual(await locations.get('driver-1'), {
        id: 'driver-1', driverId: 'driver-1', sapDocId: null, name: 'Driver',
        lat: 14.5, lng: 121, status: 'online', timestamp: 100, receivedAt: 110,
        offlineSince: null,
    });
    assert.deepEqual(calls.at(-1).params, ['driver-1']);
});
