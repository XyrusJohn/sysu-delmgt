const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../src/server.js'), 'utf8');
function handler(event, nextEvent, options = {}) {
  const handlers = {};
  const emitted = [];
  const socket = {data: {uid: 'owner', role: options.role || 'super_admin'}, handshake: {auth: {token: 'session'}},
    on: (name, callback) => {handlers[name] = callback;}, emit: (...args) => emitted.push(args)};
  const start = source.indexOf(`socket.on("${event}"`);
  const end = source.indexOf(`socket.on("${nextEvent}"`, start);
  assert.ok(start >= 0 && end > start, `production ${event} handler exists`);
  const broadcasts = [];
  vm.runInNewContext(source.slice(start, end), {socket,
    sessionService: {authenticate: async () => options.user || {role: options.role || 'super_admin', status: 'active', name: 'Test Admin'}},
    getWarehouseBaseConfig: options.get || (async () => ({name: 'SYSU Main Warehouse'})),
    saveWarehouseBaseConfig: options.save || (async data => data),
    io: {emit: (...args) => broadcasts.push(args)}, console: {log() {}, warn() {}, error() {}}});
  return {run: handlers[event], emitted, broadcasts};
}

test('warehouse socket reads the current SQL-backed settings helper', async () => {
  const config = {name: 'Local base', lat: 14.5, lng: 121, radiusMeters: 700};
  const socket = handler('get_warehouse_base', 'save_warehouse_base', {get: async () => config});
  let result;
  await socket.run(value => {result = value;});
  assert.equal(result.success, true);
  assert.equal(result.data.name, config.name);
  assert.equal(result.data.radiusMeters, config.radiusMeters);
});

test('warehouse socket save revalidates MySQL session role and broadcasts persisted settings', async () => {
  let saved;
  const socket = handler('save_warehouse_base', 'get_role_requests', {save: async (...args) => {saved = args; return args[0];}});
  let result;
  await socket.run({lat: 14.5, lng: 121, radiusMeters: 700}, value => {result = value;});
  assert.equal(result.success, true);
  assert.equal(saved[1], 'owner');
  assert.equal(socket.broadcasts[0][0], 'warehouse_base_updated');

  const denied = handler('save_warehouse_base', 'get_role_requests', {user: {role: 'admin', status: 'active'}});
  await denied.run({lat: 14.5, lng: 121, radiusMeters: 700}, value => {result = value;});
  assert.equal(result.success, false);
  assert.equal(denied.broadcasts.length, 0);
});

test('warehouse socket reports persistence errors and does not announce success', async () => {
  const socket = handler('get_warehouse_base', 'save_warehouse_base', {get: async () => {throw new Error('database unavailable');}});
  let result;
  await socket.run(value => {result = value;});
  assert.equal(result.success, false);
  assert.match(result.message, /database unavailable/);
});

test('production warehouse helper and role request exports remain available', () => {
  const roles = require('../../src/controllers/admin/roleRequestController');
  const warehouse = require('../../src/controllers/admin/warehouseBaseController');
  for (const name of ['getRoleRequests', 'createRoleRequest', 'approveRoleRequest', 'rejectRoleRequest']) assert.equal(typeof roles[name], 'function');
  assert.equal(typeof warehouse.getWarehouseBaseConfig, 'function');
  assert.equal(typeof warehouse.saveWarehouseBaseConfig, 'function');
});
