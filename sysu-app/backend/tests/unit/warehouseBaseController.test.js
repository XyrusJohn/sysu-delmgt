const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const settings = {
  async get(key, fallback) { calls.push(['get', key, fallback]); return {id: key, lat: 14.5}; },
  async set(key, value, uid) { calls.push(['set', key, value, uid]); return {...value, id: key, updatedByUid: uid}; },
};
const servicePath = require.resolve('../../src/services/mysqlSettings');
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {getMysqlSettings: () => settings},
};
const originalBackend = process.env.AUTH_BACKEND;
process.env.AUTH_BACKEND = 'mysql';
const events = [];
global._io = {emit: (event, payload) => events.push({event, payload})};
const controller = require('../../src/controllers/admin/warehouseBaseController');

function invoke(handler, request = {}) {
  return new Promise((resolve, reject) => {
    const response = {status(code) { this.statusCode = code; return this; }, json(value) { resolve({status: this.statusCode, body: value}); }};
    handler(request, response, reject);
  });
}

test.beforeEach(() => { calls.length = 0; events.length = 0; });
test.after(() => {
  if (originalBackend === undefined) delete process.env.AUTH_BACKEND;
  else process.env.AUTH_BACKEND = originalBackend;
  delete global._io;
  delete require.cache[servicePath];
});

test('warehouse base reads through MySQL settings', async () => {
  const response = await invoke(controller.getWarehouseBase, {});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {success: true, data: {id: 'warehouse_base', lat: 14.5}});
  assert.equal(calls[0][0], 'get');
  assert.equal(calls[0][1], 'warehouse_base');
});

test('only an active super-admin may update warehouse base and the update broadcasts', async () => {
  const denied = await invoke(controller.updateWarehouseBase, {
    body: {lat: 14.5, lng: 121, radiusMeters: 200}, user: {uid: 'admin'},
    mysqlUser: {role: 'admin', status: 'active'},
  });
  assert.equal(denied.status, 403);
  assert.equal(calls.length, 0);

  const accepted = await invoke(controller.updateWarehouseBase, {
    body: {lat: '14.5', lng: '121', radiusMeters: '200', name: ' Main ', address: ' Depot '},
    user: {uid: 'root'}, mysqlUser: {role: 'super_admin', status: 'active', displayName: 'Root Admin'},
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(calls[0].slice(0, 2), ['set', 'warehouse_base']);
  assert.equal(calls[0][2].name, 'Main');
  assert.equal(calls[0][2].address, 'Depot');
  assert.equal(calls[0][2].updatedBy, 'Root Admin');
  assert.equal(calls[0][3], 'root');
  assert.equal(events[0].event, 'warehouse_base_updated');
});
