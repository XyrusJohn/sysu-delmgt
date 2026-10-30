const test = require('node:test');
const assert = require('node:assert/strict');
const {authorize} = require('../../src/middleware/authorize');

test('HTTP authorization requires an explicitly active MySQL account and allowed role', async () => {
  for (const mysqlUser of [null, {role: 'driver'}, {role: 'driver', status: null},
    {role: 'driver', status: 'pending'}, {role: 'driver', status: 'inactive'},
    {role: 'driver', status: 'disabled'}, {role: 'viewer', status: 'active'}]) {
    let status;
    let allowed = false;
    const req = {user: {uid: 'synthetic-driver'}, mysqlUser};
    const res = {status(code) {status = code; return this;}, json() {return this;}};
    await authorize(['driver'])(req, res, () => {allowed = true;});
    assert.equal(allowed, false);
    assert.equal(status, 403);
  }
  let allowed = false;
  const req = {user: {uid: 'synthetic-driver'}, mysqlUser: {id: 'synthetic-driver', role: 'driver', status: 'active'}};
  await authorize(['driver'])(req, {status() {return this;}, json() {return this;}}, () => {allowed = true;});
  assert.equal(allowed, true);
  assert.equal(req.userData, req.mysqlUser);
});

test('HTTP authorization rejects a missing user context before checking its MySQL profile', async () => {
  let status;
  const res = {status(code) {status = code; return this;}, json() {return this;}};
  await authorize(['driver'])({mysqlUser: {role: 'driver', status: 'active'}}, res, () => assert.fail('must not authorize'));
  assert.equal(status, 401);
});
