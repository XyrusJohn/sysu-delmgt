const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(file, user) {
    const context = {module: {exports: {}}, process: {env: {AUTH_BACKEND: 'mysql'}}, console,
        require: request => request.includes('mysqlAuthSingleton')
            ? {getMysqlAuthService: () => ({authenticate: async () => user.current})}
            : {admin: {auth: () => {throw new Error('Legacy identity provider must not be used');},
                firestore: () => {throw new Error('Legacy document store must not be used');}}}};
    vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), context);
    return context.module.exports;
}

function response() {
    return {code: null, status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}};
}

test('MySQL HTTP session populates the canonical user and enforces active role', async () => {
    const user = {current: {id: 'public-uuid', role: 'driver', status: 'active'}};
    const {protectRoute} = load('../../src/middleware/protectRoute.js', user);
    const {authorize} = load('../../src/middleware/authorize.js', user);
    const req = {headers: {authorization: 'Bearer synthetic-session'}};
    let nextCalls = 0;
    await protectRoute(req, response(), () => nextCalls++);
    assert.equal(req.user.uid, 'public-uuid');
    assert.equal(nextCalls, 1);
    await authorize(['driver'])(req, response(), () => nextCalls++);
    assert.equal(nextCalls, 2);
    user.current = {...user.current, status: 'inactive'};
    const pending = {headers: {authorization: 'Bearer synthetic-session'}};
    await protectRoute(pending, response(), () => nextCalls++);
    const denied = response();
    await authorize(['driver'])(pending, denied, () => nextCalls++);
    assert.equal(denied.code, 403);
    user.current = null;
    const revoked = response();
    await protectRoute({headers: {authorization: 'Bearer synthetic-session'}}, revoked, () => nextCalls++);
    assert.equal(revoked.code, 401);
});
