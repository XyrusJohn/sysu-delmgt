const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../src/server.js'), 'utf8');

test('Socket.IO middleware rejects invalid or inactive MySQL sessions before connection', async () => {
  const start = source.indexOf('io.use(async');
  const end = source.indexOf('\nio.on("connection"', start);
  assert.ok(start >= 0 && end > start);
  for (const user of [null, {id: 'u1', role: 'driver', status: 'disabled'},
    {id: 'u1', role: 'unknown', status: 'active'}]) {
    let middleware;
    const io = {use(fn) {middleware = fn;}};
    const context = {io, require: () => ({getMysqlAuthService: () => ({authenticate: async () => user})})};
    vm.runInNewContext(source.slice(start, end), context);
    const socket = {handshake: {auth: {token: 'opaque-session'}}, data: {}};
    const error = await new Promise(resolve => middleware(socket, resolve));
    assert.ok(error);
    assert.equal(socket.data.uid, undefined);
  }
});

async function runSocketHandler(event, nextEvent, {role = 'driver', uid = 'driver-a', mocks = {}, payload} = {}) {
  const start = source.indexOf(`socket.on("${event}"`);
  const end = nextEvent === null
    ? source.indexOf('\n  });\n});', start) + '\n  });'.length
    : source.indexOf(`socket.on("${nextEvent}"`, start);
  assert.ok(start >= 0 && end > start, `server has ${event} handler`);
  const handlers = {};
  const emitted = [];
  const rooms = [];
  const socket = {data: {uid, role}, on(name, callback) {handlers[name] = callback;},
    handshake: {auth: {token: 'opaque-session'}}, emit(...args) {emitted.push(args);}};
  const io = {to(room) {rooms.push(room); return this;}, emit(...args) {emitted.push(args);}};
  const serviceModules = {
    mysqlDriverProfiles: {getMysqlDriverProfiles: () => mocks.driverProfiles || {}},
    mysqlAssignments: {getMysqlAssignments: () => mocks.assignments || {}},
    mysqlLiveLocations: {getMysqlLiveLocations: () => mocks.locations || {}},
  };
  const logs = [];
  vm.runInNewContext(source.slice(start, end), {socket, io,
    require: name => serviceModules[name.split('/').at(-1)] || {},
    console: {log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args)},
    Date, Number, Math, JSON});
  const result = await handlers[event](payload);
  return {emitted, rooms, logs, result};
}

test('capacity updates use the authenticated driver identity and reject impersonation', async () => {
  let saved;
  const driverProfiles = {setCapacity: async (...args) => {saved = args;}};
  await runSocketHandler('driver_is_full', 'driver_moving', {mocks: {driverProfiles}, payload: {driverId: 'other', isFull: true}});
  assert.equal(saved, undefined);
  const own = await runSocketHandler('driver_is_full', 'driver_moving', {mocks: {driverProfiles}, payload: {driverId: 'driver-a', isFull: true}});
  assert.deepEqual(saved, ['driver-a', true]);
  assert.equal(own.emitted[0][0], 'driver_capacity_updated');
  assert.equal(own.emitted[0][1].driverId, 'driver-a');
  assert.equal(own.emitted[0][1].isFull, true);
});

test('location writes and broadcasts only validated coordinates for the signed-in driver', async () => {
  const saved = [];
  const assignments = {get: async id => ({id, driverId: 'driver-a', tripStatus: 'in_transit'})};
  const driverProfiles = {get: async () => ({name: 'Driver A'})};
  const locations = {save: async value => saved.push(value)};
  const mocks = {assignments, driverProfiles, locations};
  const invalid = await runSocketHandler('driver_moving', 'update_status', {mocks,
    payload: {driverId: 'other', lat: 14, lng: 121}});
  assert.equal(saved.length, 0);
  assert.equal(invalid.emitted.length, 0);
  await runSocketHandler('driver_moving', 'update_status', {mocks,
    payload: {driverId: 'driver-a', sapDocId: 'sap-1', lat: 0, lng: 0, status: 'online'}});
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sapAssignmentId, 'sap-1');
  assert.equal(saved[0].lat, 0);
  const malformed = await runSocketHandler('driver_moving', 'update_status', {mocks,
    payload: {driverId: 'driver-a', lat: 91, lng: 121}});
  assert.equal(saved.length, 1);
  assert.equal(malformed.emitted.length, 0);
});

test('location cannot link another driver assignment and database errors are contained', async () => {
  const saved = [];
  const mocks = {assignments: {get: async id => ({id, driverId: 'other', tripStatus: 'in_transit'})},
    driverProfiles: {get: async () => ({name: 'Driver A'})}, locations: {save: async value => saved.push(value)}};
  await runSocketHandler('driver_moving', 'update_status', {mocks,
    payload: {driverId: 'driver-a', sapDocId: 'sap-2', lat: 14, lng: 121}});
  assert.equal(saved[0].sapAssignmentId, null);
  mocks.locations.save = async () => {throw new Error('database failure');};
  const failed = await runSocketHandler('driver_moving', 'update_status', {mocks,
    payload: {driverId: 'driver-a', lat: 14, lng: 121}});
  assert.equal(failed.logs.length, 1);
  assert.equal(failed.logs.join(' ').includes('database failure'), false);
});

test('POD notification requires an owned assignment and emits only the safe event payload', async () => {
  let owner = 'other';
  const assignments = {get: async id => ({id, driverId: owner})};
  const mocks = {assignments};
  const denied = await runSocketHandler('pod_updated', null, {mocks,
    payload: {shipmentDocId: 'sap-1', podUrl: 'private'}});
  assert.equal(denied.emitted.length, 0);
  owner = 'driver-a';
  const allowed = await runSocketHandler('pod_updated', null, {mocks,
    payload: {shipmentDocId: 'sap-1', podUrl: 'private', token: 'secret'}});
  assert.equal(allowed.emitted[0][0], 'pod_updated');
  assert.equal(allowed.emitted[0][1].shipmentDocId, 'sap-1');
  assert.equal(allowed.emitted[0][1].driverId, 'driver-a');
  assert.equal(allowed.emitted[0][1].source, 'driver_app');
  assert.equal(allowed.emitted[0][1].podUrl, undefined);
});
