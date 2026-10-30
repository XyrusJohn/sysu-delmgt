const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {createMysqlAuthRouter} = require('../../src/routes/mysqlAuthRoute');
const {AuthError} = require('../../src/services/mysqlAuthService');

async function withServer(service, run) {
    const app = express();
    app.use(express.json({limit: '10kb'}));
    app.use('/auth', createMysqlAuthRouter({service}));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try { await run(`http://127.0.0.1:${server.address().port}/auth`); }
    finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('MySQL auth routes keep session tokens bearer-only and support revoke', async () => {
    let active = true;
    const service = {
        async registerWithUsername({username}) { return {token: 'x'.repeat(43), user: {id: '1', username, role: 'pending', status: 'inactive'}}; },
        async loginWithUsername({username}) { return {token: 'x'.repeat(43), user: {id: '1', username, role: 'pending', status: 'inactive'}}; },
        async authenticate(token) { return active && token === 'x'.repeat(43) ? {id: '1', role: 'pending', status: 'inactive'} : null; },
        async logout(token) { active = token === 'x'.repeat(43) ? false : active; return !active; },
    };
    await withServer(service, async base => {
        const usernameRegistration = await fetch(`${base}/username/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'river.driver'})});
        assert.equal(usernameRegistration.status, 201);
        assert.equal((await usernameRegistration.json()).user.username, 'river.driver');
        const usernameLogin = await fetch(`${base}/username/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'river.driver'})});
        assert.equal(usernameLogin.status, 200);
        const noToken = await fetch(`${base}/session`);
        assert.equal(noToken.status, 401);
        const nullBody = await fetch(`${base}/username/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '[]'});
        assert.equal(nullBody.status, 400);
        assert.equal((await nullBody.json()).code, 'INVALID_REQUEST');
        const session = await fetch(`${base}/session`, {headers: {authorization: `Bearer ${'x'.repeat(43)}`}});
        assert.equal(session.status, 200);
        assert.equal((await session.json()).user.status, 'inactive');
        const logout = await fetch(`${base}/logout`, {method: 'POST', headers: {authorization: `Bearer ${'x'.repeat(43)}`}});
        assert.equal(logout.status, 200);
        const revoked = await fetch(`${base}/session`, {headers: {authorization: `Bearer ${'x'.repeat(43)}`}});
        assert.equal(revoked.status, 401);
    });
});

test('MySQL auth routes return safe domain errors and hide internal failures', async () => {
    const service = {async loginWithUsername() { throw new AuthError('INVALID_CREDENTIALS', 401); }};
    await withServer(service, async base => {
        const badLogin = await fetch(`${base}/username/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
        assert.equal(badLogin.status, 401);
        assert.equal((await badLogin.json()).code, 'INVALID_CREDENTIALS');
        const outage = await fetch(`${base}/username/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
        assert.equal(outage.status, 500);
        assert.doesNotMatch(await outage.text(), /database password/);
    });
});
