const test = require('node:test');
const assert = require('node:assert/strict');
const {createVerifyToken} = require('../../middleware/auth');
const {createSocketAuth} = require('../../middleware/socketAuth');

function response() {
  return {code: null, status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}};
}

test('MySQL HTTP guard accepts only an active approved role', async () => {
  let user = {id: 'public-uuid', role: 'driver', status: 'active'};
  const guard = createVerifyToken({authenticateSession: async token => token === 'session-token' ? user : null});
  const request = {headers: {authorization: 'Bearer session-token'}};
  let nextCalls = 0;
  const ok = response();
  await guard(request, ok, () => nextCalls++);
  assert.equal(nextCalls, 1);
  assert.equal(request.user.uid, 'public-uuid');
  assert.deepEqual(request.userProfile, {role: 'driver', status: 'active'});
  user = {...user, status: 'inactive'};
  const pending = response();
  await guard({headers: {authorization: 'Bearer session-token'}}, pending, () => nextCalls++);
  assert.equal(pending.code, 403);
  user = {...user, status: 'active', role: 'unknown'};
  const invalid = response();
  await guard({headers: {authorization: 'Bearer session-token'}}, invalid, () => nextCalls++);
  assert.equal(invalid.code, 403);
  assert.equal(nextCalls, 1);
});

test('MySQL socket guard rechecks revocation and role on each driver event', async () => {
  let user = {id: 'public-uuid', role: 'driver', status: 'active'};
  let disconnected = false;
  const socket = {handshake: {auth: {token: 'x'.repeat(43)}}, data: {},
    use(handler) {this.packetGuard = handler;}, disconnect() {disconnected = true;}};
  const guard = createSocketAuth({authenticateSession: async () => user});
  assert.equal(await new Promise(resolve => guard(socket, resolve)), undefined);
  assert.equal(socket.data.uid, 'public-uuid');
  assert.equal(await new Promise(resolve => socket.packetGuard(['heartbeat', {}], resolve)), undefined);
  user = null;
  assert.ok(await new Promise(resolve => socket.packetGuard(['heartbeat', {}], resolve)));
  assert.equal(disconnected, true);
});
