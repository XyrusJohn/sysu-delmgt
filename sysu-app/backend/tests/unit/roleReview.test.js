const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../src/services/mysqlRoleGovernance');
const calls = [];
const requests = [{id: 'request-1', requesterId: 'driver-1', requestedRole: 'driver', status: 'pending'}];
const service = {
  listRequests: async (...args) => { calls.push(['listRequests', ...args]); return requests; },
  createRequest: async (...args) => { calls.push(['createRequest', ...args]); return requests[0]; },
  decide: async (...args) => { calls.push(['decide', ...args]); return requests[0]; },
};
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {getMysqlRoleGovernance: () => service},
};

const events = [];
global._io = {to: room => ({emit: (event, payload) => events.push({room, event, payload})})};
const roles = require('../../src/controllers/admin/roleRequestController');
const originalBackend = process.env.AUTH_BACKEND;
process.env.AUTH_BACKEND = 'mysql';

test.after(() => {
  if (originalBackend === undefined) delete process.env.AUTH_BACKEND;
  else process.env.AUTH_BACKEND = originalBackend;
  delete global._io;
  delete require.cache[servicePath];
});

test.beforeEach(() => { calls.length = 0; events.length = 0; });

test('role request listing always uses MySQL governance', async () => {
  assert.deepEqual(await roles.getRoleRequests('pending', 'admin-1'), requests);
  assert.deepEqual(calls, [['listRequests', 'pending', 'admin-1']]);
});

test('role request creation validates the role and emits Socket.IO updates', async () => {
  const result = await roles.createRoleRequest({requesterId: 'driver-1', requestedRole: 'driver'});
  assert.equal(result, requests[0]);
  assert.deepEqual(calls, [['createRequest', {requesterId: 'driver-1', requestedRole: 'driver'}]]);
  assert.deepEqual(events.map(({room, event}) => [room, event]), [
    ['role-reviewers', 'role_request_created'], ['user:driver-1', 'role_request_created'],
  ]);
  await assert.rejects(roles.createRoleRequest({requesterId: 'driver-1', requestedRole: 'invalid'}));
  assert.equal(calls.length, 1);
});

test('role approval persists through MySQL and emits the role-change event', async () => {
  await roles.approveRoleRequest('request-1', 'admin-1');
  assert.deepEqual(calls, [['decide', {requestId: 'request-1', reviewerId: 'admin-1', approved: true, reason: ''}]]);
  assert.deepEqual(events.map(({room, event}) => [room, event]), [
    ['role-reviewers', 'role_request_updated'], ['user:driver-1', 'role_request_updated'],
    ['user:driver-1', 'user_role_changed'],
  ]);
});

test('role rejection persists through MySQL without emitting a role-change event', async () => {
  await roles.rejectRoleRequest('request-1', 'admin-1', 'Needs clarification');
  assert.deepEqual(calls, [['decide', {
    requestId: 'request-1', reviewerId: 'admin-1', approved: false, reason: 'Needs clarification',
  }]]);
  assert.deepEqual(events.map(({event}) => event), ['role_request_updated', 'role_request_updated']);
});
