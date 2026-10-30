const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
let profile = {id: 'driver-a', driverId: 'driver-a', name: 'Existing', isFull: true};
const service = {
  async get(id) { calls.push(['get', id]); return profile && id === profile.driverId ? profile : null; },
  async setCapacity(id, isFull) { calls.push(['setCapacity', id, isFull]); profile = {...profile, isFull}; },
  async save(input) { calls.push(['save', input]); },
};
const servicePath = require.resolve('../../src/services/mysqlDriverProfiles');
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {getMysqlDriverProfiles: () => service},
};
const originalBackend = process.env.AUTH_BACKEND;
process.env.AUTH_BACKEND = 'mysql';
const events = [];
global._io = {to: room => ({emit: (event, payload) => events.push({room, event, payload})})};
const controller = require('../../src/controllers/driverController');

function invoke(handler, {body = {}, driverId = 'driver-a', actor = 'staff', role = 'admin'} = {}) {
  return new Promise((resolve, reject) => {
    const response = {status(code) { this.statusCode = code; return this; }, json(value) { resolve({status: this.statusCode || 200, body: value}); }};
    handler({params: {driverId}, body, user: {uid: actor}, userData: {role}}, response, reject);
  });
}

const data = {name: 'Synthetic Driver', phone: '09000000000', license: 'L1', truckType: '4W',
  plateNumber: 'TEST', truckingCompany: 'Synthetic', helper: '', notes: ''};

test.beforeEach(() => { calls.length = 0; events.length = 0; profile = {id: 'driver-a', driverId: 'driver-a', name: 'Existing', isFull: true}; });
test.after(() => {
  if (originalBackend === undefined) delete process.env.AUTH_BACKEND;
  else process.env.AUTH_BACKEND = originalBackend;
  delete global._io;
  delete require.cache[servicePath];
});

test('driver profile read uses MySQL and prevents drivers reading another profile', async () => {
  const response = await invoke(controller.getDriver, {role: 'driver', actor: 'driver-a'});
  assert.deepEqual(response.body, {success: true, data: profile});
  assert.deepEqual(calls, [['get', 'driver-a']]);
  const denied = await invoke(controller.getDriver, {role: 'driver', actor: 'driver-a', driverId: 'driver-b'});
  assert.equal(denied.status, 403);
  assert.equal(calls.length, 1);
});

test('capacity updates use MySQL and notify dispatchers', async () => {
  const response = await invoke(controller.updateDriverFull, {body: {isFull: false}});
  assert.deepEqual(response.body, {success: true, driverId: 'driver-a', isFull: false});
  assert.deepEqual(calls, [['setCapacity', 'driver-a', false]]);
  assert.deepEqual(events, [{room: 'dispatchers', event: 'driver_capacity_updated', payload: {driverId: 'driver-a', isFull: false}}]);
  const denied = await invoke(controller.updateDriverFull, {body: {isFull: true}, role: 'driver', driverId: 'driver-b'});
  assert.equal(denied.status, 403);
});

test('staff profile updates validate input and delegate actor identity to MySQL', async () => {
  const response = await invoke(controller.saveDriverProfile, {body: data, actor: 'manager-1'});
  assert.deepEqual(response.body, {success: true, driverId: 'driver-a'});
  assert.deepEqual(calls, [['save', {actorId: 'manager-1', driverId: 'driver-a', input: data}]]);
  await assert.rejects(invoke(controller.saveDriverProfile, {body: {...data, isFull: false}}), error => error.name === 'ZodError');
});

test('profile deletion retains linked drivers and accepts only absent SQL profiles', async () => {
  await assert.rejects(invoke(controller.deleteDriverProfile), error => error.statusCode === 409);
  profile = null;
  assert.deepEqual((await invoke(controller.deleteDriverProfile)).body, {success: true, driverId: 'driver-a'});
});
