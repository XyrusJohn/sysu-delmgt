const test = require('node:test');
const assert = require('node:assert/strict');
const {createVerifyToken} = require('../../middleware/auth');

function response() {
  return {code: 200, body: null, status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}};
}

test('MySQL HTTP guard accepts only active approved sessions', async () => {
  let user = {id: 'driver-a', role: 'driver', status: 'active'};
  const guard = createVerifyToken({authenticateSession: async token => token === 'session-token' ? user : null});
  const req = {headers: {authorization: 'Bearer session-token'}};
  const res = response();
  let nextCalls = 0;
  await guard(req, res, () => nextCalls++);
  assert.equal(nextCalls, 1);
  assert.equal(req.user.uid, 'driver-a');
  for (const invalid of [{...user, status: 'disabled'}, {...user, status: 'inactive'},
    {...user, role: 'unknown'}, null]) {
    user = invalid;
    const denied = response();
    await guard({headers: {authorization: 'Bearer session-token'}}, denied, () => nextCalls++);
    assert.equal(denied.code, invalid ? 403 : 401);
  }
  const missing = response();
  await guard({headers: {}}, missing, () => nextCalls++);
  assert.equal(missing.code, 401);
  assert.equal(nextCalls, 1);
});

test('authentication storage failures fail closed without exposing internals', async () => {
  const guard = createVerifyToken({authenticateSession: async () => {throw Error('private SQL details');}});
  const res = response();
  await guard({headers: {authorization: 'Bearer session-token'}}, res, () => assert.fail('must not continue'));
  assert.equal(res.code, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /private SQL details/);
});

test('retired user mutations return 410 after an authenticated MySQL session', async () => {
  const routes = new Map();
  const Router = () => ({post(path, ...handlers) {routes.set(path, handlers);}});
  const expressMock = {Router};
  const Module = require('node:module');
  const path = require('node:path');
  const fs = require('node:fs');
  const filename = require.resolve('../../routes/userRoutes');
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = name => name === 'express' ? expressMock : name === '../middleware/auth.js'
    ? {verifyToken: (req, _res, next) => next()} : Module.createRequire(filename)(name);
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  for (const endpoint of ['/update-role', '/delete']) {
    const handlers = routes.get(endpoint);
    assert.ok(handlers);
    const res = response();
    await handlers.at(-1)({body: {uid: 'victim'}}, res);
    assert.equal(res.code, 410);
    assert.equal(res.body.success, false);
  }
});
