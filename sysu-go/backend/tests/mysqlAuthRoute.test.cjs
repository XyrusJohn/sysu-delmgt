const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {createMysqlAuthRouter} = require('../routes/mysqlAuthRoute');
const {AuthError} = require('../services/mysqlAuthService');

async function withServer(service, run) {
    const app = express();
    app.use(express.json({limit: '10kb'}));
    app.use('/auth', createMysqlAuthRouter({service}));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try { await run(`http://127.0.0.1:${server.address().port}/auth`); }
    finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('MySQL auth exposes username registration/login and bearer session revoke only', async () => {
    let active = true;
    const service = {
        async registerWithUsername({username}) { return {token: 'x'.repeat(43), user: {id: '1', username, role: 'pending', status: 'inactive'}}; },
        async loginWithUsername({username}) { return {token: 'x'.repeat(43), user: {id: '1', username, role: 'pending', status: 'inactive'}}; },
        async authenticate(token) { return active && token === 'x'.repeat(43) ? {id: '1', role: 'pending', status: 'inactive'} : null; },
        async logout(token) { active = token === 'x'.repeat(43) ? false : active; return !active; },
    };
    await withServer(service, async base => {
        const registration = await fetch(`${base}/username/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'river.driver'})});
        assert.equal(registration.status, 201);
        assert.equal((await registration.json()).user.username, 'river.driver');
        const usernameLogin = await fetch(`${base}/username/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'river.driver'})});
        assert.equal(usernameLogin.status, 200);
        const noToken = await fetch(`${base}/session`);
        assert.equal(noToken.status, 401);
        const invalidBody = await fetch(`${base}/username/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '[]'});
        assert.equal(invalidBody.status, 400);
        assert.equal((await invalidBody.json()).code, 'INVALID_REQUEST');
        const session = await fetch(`${base}/session`, {headers: {authorization: `Bearer ${'x'.repeat(43)}`}});
        assert.equal(session.status, 200);
        assert.equal((await session.json()).user.status, 'inactive');
        const logout = await fetch(`${base}/logout`, {method: 'POST', headers: {authorization: `Bearer ${'x'.repeat(43)}`}});
        assert.equal(logout.status, 200);
        const revoked = await fetch(`${base}/session`, {headers: {authorization: `Bearer ${'x'.repeat(43)}`}});
        assert.equal(revoked.status, 401);
    });
});

test('username auth routes return safe domain errors and hide internal failures', async () => {
    const service = {
        async loginWithUsername() { throw new AuthError('INVALID_CREDENTIALS', 401); },
        async registerWithUsername() { throw new Error('database password leaked'); },
    };
    await withServer(service, async base => {
        const badLogin = await fetch(`${base}/username/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
        assert.equal(badLogin.status, 401);
        assert.equal((await badLogin.json()).code, 'INVALID_CREDENTIALS');
        const outage = await fetch(`${base}/username/register`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
        assert.equal(outage.status, 500);
        assert.doesNotMatch(await outage.text(), /database password/);
    });
});

test('MySQL auth profile update accepts the PATCH API and Android PUT compatibility method', async () => {
    const service = {
        async updateProfile(token, input) { return {user: {id: 'driver-a', displayName: input.displayName, tokenSeen: token}}; },
    };
    await withServer(service, async base => {
        for (const method of ['PATCH', 'PUT']) {
            const response = await fetch(`${base}/profile`, {
                method,
                headers: {'content-type': 'application/json', authorization: `Bearer ${'x'.repeat(43)}`},
                body: JSON.stringify({displayName: 'River Driver', profile: {name: 'River Driver'}}),
            });
            assert.equal(response.status, 200);
            assert.deepEqual((await response.json()).user, {id: 'driver-a', displayName: 'River Driver', tokenSeen: 'x'.repeat(43)});
        }
    });
});
