const {test} = require('node:test');
const assert = require('node:assert/strict');
const {tick, HEARTBEAT_TIMEOUT_MS} = require('../utils/presenceWatcher');

function fixture({active = false, location = true, failActiveLookup = false} = {}) {
  const uid = 'driver-a';
  const entry = {
    name: 'Synthetic Driver', status: 'in_transit', sapDocId: 'dispatch-a',
    lat: location ? 14.6 : null, lng: location ? 121.0 : null,
    locationTimestamp: Date.now() - HEARTBEAT_TIMEOUT_MS - 1000,
    lastSeen: Date.now() - HEARTBEAT_TIMEOUT_MS - 1000,
    socketIds: new Set(['socket-a']),
  };
  const onlineDriver = new Map([[uid, entry]]);
  const profileStatuses = [];
  const locations = [];
  const events = [];
  const dependencies = {
    mysqlAssignments: {
      hasActiveShipment: async () => {
        if (failActiveLookup) throw new Error('synthetic DB failure');
        return active;
      },
    },
    mysqlDriverProfiles: {setStatus: async (id, status) => profileStatuses.push({id, status})},
    mysqlLiveLocations: {save: async value => locations.push(value)},
  };
  const io = {to: room => ({emit: (event, payload) => events.push({room, event, payload})})};
  return {uid, entry, onlineDriver, profileStatuses, locations, events, dependencies, io};
}

test('stale driver with active SQL assignment retains last position and broadcasts offline state', async () => {
  const f = fixture({active: true});
  await tick(f.onlineDriver, f.io, f.dependencies);
  assert.equal(f.onlineDriver.get(f.uid), f.entry);
  assert.equal(f.entry.isOffline, true);
  assert.equal(f.entry.socketIds.size, 0);
  assert.deepEqual(f.profileStatuses, [{id: f.uid, status: 'offline'}]);
  assert.equal(f.locations.length, 1);
  assert.equal(f.locations[0].status, 'offline_in_transit');
  assert.equal(f.locations[0].lat, 14.6);
  assert.equal(f.events.filter(item => item.event === 'driver_status_change').length, 2);
  assert.equal(f.events.find(item => item.event === 'vendor_status_update').payload.status, 'offline_in_transit');

  await tick(f.onlineDriver, f.io, f.dependencies);
  assert.equal(f.profileStatuses.length, 1, 'already-offline entries are not repeatedly persisted');
});

test('stale driver without active assignment is removed and broadcasts offline', async () => {
  const f = fixture({active: false, location: false});
  await tick(f.onlineDriver, f.io, f.dependencies);
  assert.equal(f.onlineDriver.has(f.uid), false);
  assert.deepEqual(f.profileStatuses, [{id: f.uid, status: 'offline'}]);
  assert.equal(f.locations.length, 0);
  assert.equal(f.events.filter(item => item.event === 'driver_status_change').length, 2);
  assert.equal(f.events.find(item => item.event === 'vendor_status_update').payload.status, 'offline');
});

test('assignment lookup failure safely retains the last known location as offline in transit', async () => {
  const f = fixture({failActiveLookup: true});
  await tick(f.onlineDriver, f.io, f.dependencies);
  assert.equal(f.entry.isOffline, true);
  assert.equal(f.onlineDriver.get(f.uid), f.entry);
  assert.equal(f.locations[0].status, 'offline_in_transit');
});

test('a heartbeat received during the assignment lookup prevents stale-offline persistence', async () => {
  const f = fixture({active: true});
  let release;
  let started;
  const waiting = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  f.dependencies.mysqlAssignments.hasActiveShipment = async () => { started(); await waiting; return true; };
  const pending = tick(f.onlineDriver, f.io, f.dependencies);
  await entered;
  f.entry.lastSeen = Date.now();
  release();
  await pending;
  assert.equal(f.entry.isOffline, undefined);
  assert.deepEqual(f.profileStatuses, []);
  assert.deepEqual(f.locations, []);
  assert.deepEqual(f.events, []);
});

test('missing MySQL services skip processing without a legacy database fallback', async () => {
  const f = fixture({active: true});
  await tick(f.onlineDriver, f.io, {});
  assert.deepEqual(f.profileStatuses, []);
  assert.deepEqual(f.locations, []);
  assert.deepEqual(f.events, []);
});
