const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const assignmentStore = {
    async peek(...args) { calls.push(['peek', ...args]); return {dispatchKey: args[0], earliest: null, alternates: []}; },
    async get(...args) { calls.push(['get', ...args]); return {dispatchKey: args[0]}; },
    async assign(input) { calls.push(['assign', input]); return {status: 200, data: {dispatchKey: input.body.dispatchKey}}; },
    async activeLocations() { calls.push(['activeLocations']); return [{dispatchKey: 'd1', lat: 14, lng: 121}]; },
};
const dispatchStore = {
    async requestOverride(...args) { calls.push(['requestOverride', ...args]); return {status: 200, data: {requestId: 'r1'}}; },
    async decideOverride(...args) { calls.push(['decideOverride', ...args]); return {status: 200, data: {requestId: 'r1', status: 'approved'}}; },
    async revoke(...args) { calls.push(['revoke', ...args]); return {status: 200, data: {requestId: 'r1', status: 'revoked'}}; },
    async requestCancellation(...args) { calls.push(['requestCancellation', ...args]); return {status: 409, message: 'Not cancellable'}; },
    async decideCancellation(...args) { calls.push(['decideCancellation', ...args]); return {status: 200, data: {requestId: 'c1', status: 'approved'}}; },
    async getRequest(...args) { calls.push(['getRequest', ...args]); return {requestId: args[0]}; },
    async listRequests(...args) { calls.push(['listRequests', ...args]); return [{requestId: 'r1'}]; },
};
const assignmentsPath = require.resolve('../../src/services/mysqlAssignments');
const dispatchPath = require.resolve('../../src/services/mysqlDispatchGovernance');
require.cache[assignmentsPath] = {id: assignmentsPath, filename: assignmentsPath, loaded: true,
    exports: {getMysqlAssignments: () => assignmentStore}};
require.cache[dispatchPath] = {id: dispatchPath, filename: dispatchPath, loaded: true,
    exports: {getMysqlDispatchGovernance: () => dispatchStore}};
const originalBackend = process.env.AUTH_BACKEND;
process.env.AUTH_BACKEND = 'mysql';
const controller = require('../../src/controllers/sapAssignmentController');

function invoke(handler, {body = {}, params = {}, query = {}, path = '', user = {uid: 'staff', role: 'fleet_manager'}} = {}) {
    return new Promise((resolve, reject) => {
        const response = {statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({status: this.statusCode, body: value}); }};
        handler({body, params, query, path, user}, response, reject);
    });
}

test.beforeEach(() => { calls.length = 0; });
test.after(() => {
    if (originalBackend === undefined) delete process.env.AUTH_BACKEND;
    else process.env.AUTH_BACKEND = originalBackend;
    delete require.cache[assignmentsPath];
    delete require.cache[dispatchPath];
});

test('assignment lookups and location reads always use MySQL services', async () => {
    assert.equal((await invoke(controller.peekEarliest, {query: {dispatchKey: 'd1', truckType: '4W'}})).status, 200);
    assert.equal((await invoke(controller.getAssignment, {params: {dispatchKey: 'd1'}})).body.data.dispatchKey, 'd1');
    assert.equal((await invoke(controller.getActiveDriverLocations)).body.locations.length, 1);
    assert.deepEqual(calls.map(([name]) => name), ['peek', 'get', 'activeLocations']);
});

test('override and cancellation writes preserve actor identity and MySQL results', async () => {
    const request = await invoke(controller.requestOverride, {user: {uid: 'dispatcher'}, body: {
        dispatchKey: 'd1', requestedDriverId: 'driver-a', reason: 'FIFO exception',
    }});
    assert.deepEqual(request.body, {success: true, data: {requestId: 'r1'}});
    assert.deepEqual(calls[0], ['requestOverride', {dispatchKey: 'd1', requestedDriverId: 'driver-a', reason: 'FIFO exception', requestedBy: 'dispatcher'}]);

    const denied = await invoke(controller.requestCancelAssignment, {user: {uid: 'dispatcher'}, body: {dispatchKey: 'd1', reason: 'Changed route'}});
    assert.equal(denied.status, 409);
    assert.deepEqual(denied.body, {success: false, message: 'Not cancellable'});
    assert.equal(calls[1][0], 'requestCancellation');
    assert.equal(calls[1][1].requestedBy, 'dispatcher');
});

test('review and revoke routes select the correct SQL dispatch-request kind', async () => {
    await invoke(controller.decideOverride, {user: {uid: 'admin'}, body: {requestId: 'r1', decision: 'approved'}});
    await invoke(controller.revokeOverride, {user: {uid: 'dispatcher'}, body: {requestId: 'r1'}});
    await invoke(controller.decideCancelAssignment, {user: {uid: 'admin'}, body: {requestId: 'c1', decision: 'approved'}});
    assert.equal(calls[0][0], 'decideOverride');
    assert.equal(calls[0][1].decidedBy, 'admin');
    assert.deepEqual(calls[1], ['revoke', 'override', {requestId: 'r1', uid: 'dispatcher'}]);
    assert.equal(calls[2][0], 'decideCancellation');
    assert.equal(calls[2][1].decidedBy, 'admin');
});

test('dispatch request reads limit non-admin users to their own requests', async () => {
    await invoke(controller.getDispatchRequest, {params: {}, query: {dispatchKey: 'd1'}, path: '/overrides', user: {uid: 'fleet-1', role: 'fleet_manager'}});
    assert.deepEqual(calls[0], ['listRequests', 'override', {dispatchKey: 'd1', requestedBy: 'fleet-1'}]);
    await invoke(controller.getDispatchRequest, {params: {}, query: {dispatchKey: 'd1'}, path: '/cancel/requests', user: {uid: 'admin', role: 'admin'}});
    assert.deepEqual(calls[1], ['listRequests', 'cancel', {dispatchKey: 'd1', requestedBy: null}]);
});
