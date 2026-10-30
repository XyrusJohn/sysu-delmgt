const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const updateRole = async input => { calls.push(['updateRole', input]); };
const disableUser = async input => { calls.push(['disableUser', input]); };
const service = {updateRole, disableUser};
const servicePath = require.resolve('../../src/services/mysqlRoleGovernance');
require.cache[servicePath] = {id: servicePath, filename: servicePath, loaded: true,
  exports: {getMysqlRoleGovernance: () => service}};
const originalBackend = process.env.AUTH_BACKEND;
process.env.AUTH_BACKEND = 'mysql';
const events = [];
global._io = {to: room => ({emit: (event, data) => events.push({room, event, data})})};
const users = require('../../src/controllers/userController');

function invoke(handler, actor, body) {
  return new Promise((resolve, reject) => {
    const response = {json(value) { resolve({status: 200, body: value}); }};
    handler({body, user: {uid: actor}}, response, reject);
  });
}

test.beforeEach(() => { calls.length = 0; events.length = 0; service.updateRole = updateRole; service.disableUser = disableUser; });
test.after(() => {
  if (originalBackend === undefined) delete process.env.AUTH_BACKEND;
  else process.env.AUTH_BACKEND = originalBackend;
  delete global._io;
  delete require.cache[servicePath];
});

test('direct role changes delegate authorization and persistence to MySQL, then notify the user', async () => {
  const result = await invoke(users.updateUserRole, 'owner', {uid: 'driver', role: 'admin'});
  assert.deepEqual(result.body, {success: true, message: 'User role updated successfully'});
  assert.deepEqual(calls, [['updateRole', {actorId: 'owner', targetId: 'driver', role: 'admin'}]]);
  assert.deepEqual(events, [{room: 'user:driver', event: 'user_role_changed', data: {uid: 'driver', role: 'admin'}}]);
});

test('role change validates role and user identifier before database writes', async () => {
  await assert.rejects(invoke(users.updateUserRole, 'owner', {uid: 'driver', role: 'unknown'}), error => error.name === 'ZodError');
  await assert.rejects(invoke(users.updateUserRole, 'owner', {uid: 'bad/id', role: 'admin'}), error => error.name === 'ZodError');
  assert.deepEqual(calls, []);
});

test('account disable delegates to MySQL and emits the account-deleted notification', async () => {
  const result = await invoke(users.deleteUser, 'super-admin', {uid: 'driver'});
  assert.deepEqual(result.body, {success: true, message: 'User deleted successfully'});
  assert.deepEqual(calls, [['disableUser', {actorId: 'super-admin', targetId: 'driver'}]]);
  assert.deepEqual(events, [{room: 'user:driver', event: 'account_deleted', data: {uid: 'driver'}}]);
});

test('failed MySQL administration does not emit success notifications', async () => {
  service.disableUser = async () => { throw Object.assign(new Error('Super-admin privileges required'), {statusCode: 403}); };
  await assert.rejects(invoke(users.deleteUser, 'admin', {uid: 'driver'}), error => error.statusCode === 403);
  assert.deepEqual(events, []);
});
