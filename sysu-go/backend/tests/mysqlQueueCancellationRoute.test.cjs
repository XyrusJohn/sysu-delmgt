const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const filename = path.resolve(__dirname, '../controller/qrController.js');
let serviceResult = {queueId: 'queue-a', status: 'cancelled'};
let serviceError = null;
const calls = [];
const controllerModule = new Module(filename);
controllerModule.filename = filename;
controllerModule.require = name => {
  if (name === 'node:crypto') return require('node:crypto');
  if (name === '../services/mysqlQrService') return {getMysqlQrService: () => ({
    cancelOwn: async input => {
      calls.push(input);
      if (serviceError) throw serviceError;
      return serviceResult;
    },
  })};
  throw new Error('Unexpected dependency: ' + name);
};
controllerModule._compile(fs.readFileSync(filename, 'utf8'), filename);
const {cancelQueue} = controllerModule.exports;

function response() {
  return {statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }};
}
function request({uid = 'driver-a', queueId = 'queue-a', body = {}} = {}) {
  const emitted = [];
  return {
    req: {user: uid ? {uid} : null, params: {queueId}, body,
      app: {get: () => ({to: room => ({emit: (event, payload) => emitted.push({room, event, payload})})})}},
    emitted,
  };
}

test('queue cancellation is scoped to the authenticated driver and emits updates after commit', async () => {
  process.env.AUTH_BACKEND = 'mysql';
  calls.length = 0;
  serviceError = null;
  serviceResult = {queueId: 'queue-a', status: 'cancelled'};
  const fixture = request();
  const res = response();
  await cancelQueue(fixture.req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1), {queueId: 'queue-a', driverId: 'driver-a'});
  assert.deepEqual(fixture.emitted.map(item => item.room), ['driver:driver-a', 'staff:tracking']);
  assert.ok(fixture.emitted.every(item => item.event === 'queue_cancelled'));
});

test('queue cancellation maps service conflicts and emits no event on failure', async () => {
  process.env.AUTH_BACKEND = 'mysql';
  serviceError = Object.assign(new Error('Queue already assigned'), {status: 409});
  const fixture = request();
  const res = response();
  await cancelQueue(fixture.req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(fixture.emitted.length, 0);
  serviceError = null;
});

test('queue cancellation rejects invalid IDs, request fields, and anonymous callers', async () => {
  process.env.AUTH_BACKEND = 'mysql';
  calls.length = 0;
  for (const input of [
    request({queueId: '../foreign'}),
    request({body: {driverId: 'driver-b'}}),
    request({uid: null}),
  ]) {
    const res = response();
    await cancelQueue(input.req, res);
    assert.ok([400, 401].includes(res.statusCode));
  }
  assert.equal(calls.length, 0);
});
