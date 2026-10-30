const test = require('node:test');
const assert = require('node:assert/strict');
const {AuthError, createMysqlAuthService} = require('../../src/services/mysqlAuthService');

function createPool({failSessionInsert = false} = {}) {
    const state = {users: [], identities: [], sessions: [], nextId: 1};
    async function execute(sql, values = []) {
        if (sql.includes('INSERT INTO app_auth_users')) {
            const publicId = values[0];
            const username = values[1];
            const usernameNormalized = values[2];
            if (state.users.some(user => user.username_normalized === usernameNormalized)) throw Object.assign(new Error('duplicate'), {code: 'ER_DUP_ENTRY'});
            const user = {id: state.nextId++, public_id: publicId, username, username_normalized: usernameNormalized,
                display_name: values[3], role: 'pending', status: 'inactive', profile: values[4]};
            state.users.push(user);
            return [{insertId: user.id}, []];
        }
        if (sql.includes('INSERT INTO app_auth_identities')) {
            const inlineUsername = sql.includes("'username'");
            const provider = inlineUsername ? 'username' : values[1];
            const subject = inlineUsername ? values[1] : values[2];
            const passwordHash = inlineUsername ? values[2] : values[3];
            if (state.identities.some(item => item.provider === provider && item.provider_subject === subject)) {
                throw Object.assign(new Error('duplicate'), {code: 'ER_DUP_ENTRY'});
            }
            state.identities.push({user_id: values[0], provider, provider_subject: subject, password_hash: passwordHash});
            return [{insertId: state.identities.length}, []];
        }
        if (sql.includes('INSERT INTO app_auth_sessions')) {
            if (failSessionInsert) throw new Error('session insert failed');
            state.sessions.push({token_hash: Buffer.from(values[0]), user_id: values[1], expires_at: values[2], revoked_at: null});
            return [{affectedRows: 1}, []];
        }
        if (sql.includes('UPDATE app_auth_users SET username =')) {
            const user = state.users.find(item => item.id === Number(values[2]));
            if (user) Object.assign(user, {username: values[0], username_normalized: values[1]});
            return [{affectedRows: user ? 1 : 0}, []];
        }
        if (sql.includes('UPDATE app_auth_users SET display_name =')) {
            const user = state.users.find(item => item.id === Number(values[2]));
            if (user) Object.assign(user, {display_name: values[0], profile: values[1]});
            return [{affectedRows: user ? 1 : 0}, []];
        }
        if (sql.includes('UPDATE app_auth_sessions')) {
            const session = state.sessions.find(item => item.token_hash.equals(values[0]) && !item.revoked_at);
            if (session) session.revoked_at = new Date();
            return [{affectedRows: session ? 1 : 0}, []];
        }
        if (sql.includes('FROM app_auth_sessions s JOIN app_auth_users')) {
            const session = state.sessions.find(item => item.token_hash.equals(values[0]) && !item.revoked_at && item.expires_at > new Date());
            return [session ? [{...state.users.find(user => user.id === session.user_id)}] : [], []];
        }
        if (sql.includes("WHERE i.provider = 'username'")) {
            const identity = state.identities.find(item => item.provider === 'username' && item.provider_subject === values[0]);
            const user = identity && state.users.find(item => item.id === identity.user_id);
            return [user ? [{...user, password_hash: identity.password_hash}] : [], []];
        }
        if (sql.includes('WHERE id = ?')) {
            const user = state.users.find(item => item.id === Number(values[0]));
            return [user ? [{...user}] : [], []];
        }
        throw new Error(`Unhandled test SQL: ${sql}`);
    }
    return {state, execute, async getConnection() {
        let snapshot;
        return {execute, async beginTransaction() {
            snapshot = {users: state.users.map(item => ({...item})), identities: state.identities.map(item => ({...item})),
                sessions: state.sessions.map(item => ({...item, token_hash: Buffer.from(item.token_hash)})), nextId: state.nextId};
        }, async commit() {}, async rollback() {
            state.users.splice(0, state.users.length, ...snapshot.users);
            state.identities.splice(0, state.identities.length, ...snapshot.identities);
            state.sessions.splice(0, state.sessions.length, ...snapshot.sessions);
            state.nextId = snapshot.nextId;
        }, release() {}, destroy() {}};
    }};
}

function fixture(options) {
    const pool = createPool(options);
    const service = createMysqlAuthService({pool});
    return {pool, service};
}

test('username registration is case-insensitive and authenticates by username', async () => {
    const {pool, service} = fixture();
    const registration = await service.registerWithUsername({username: 'River.Driver', password: 'correct horse battery'});
    assert.equal(registration.user.username, 'River.Driver');
    assert.deepEqual(Object.keys(registration.user).sort(), ['displayName', 'id', 'profile', 'role', 'status', 'username']);
    pool.state.users[0].profile = JSON.stringify({email: 'legacy@example.test', emailVerified: true, phone: '555-0100'});
    const sanitized = await service.authenticate(registration.token);
    assert.deepEqual(sanitized.profile, {phone: '555-0100'});
    assert.equal(registration.user.status, 'inactive');
    const login = await service.loginWithUsername({username: 'RIVER.DRIVER', password: 'correct horse battery'});
    assert.equal((await service.authenticate(login.token)).username, 'River.Driver');
    await assert.rejects(service.registerWithUsername({username: 'river.driver', password: 'correct horse battery'}), error => error.code === 'ACCOUNT_EXISTS');
    await assert.rejects(service.registerWithUsername({username: 'ab', password: 'correct horse battery'}), error => error.code === 'INVALID_USERNAME');
    assert.equal(pool.state.users.length, 1);
    assert.equal(pool.state.identities[0].provider, 'username');
});

test('username registration requires at least eight password characters', async () => {
    const {service} = fixture();
    await assert.rejects(service.registerWithUsername({username: 'short.pass', password: '1234567'}),
        error => error.code === 'INVALID_PASSWORD');
    const registration = await service.registerWithUsername({username: 'valid.pass', password: '12345678'});
    assert.equal(registration.user.username, 'valid.pass');
});

test('a profile name takes precedence when the saved display name duplicates the login username', async () => {
    const {service} = fixture();
    const registration = await service.registerWithUsername({username: 'web_developer_account', password: 'correct horse battery',
        displayName: 'web_developer_account', profile: {name: 'Web Developer'}});
    assert.equal(registration.user.username, 'web_developer_account');
    assert.equal(registration.user.displayName, 'Web Developer');
});

test('profile updates compose a public name from required first and last names and optional middle name', async () => {
    const {pool, service} = fixture();
    const registration = await service.registerWithUsername({username: 'river.driver', password: 'correct horse battery'});
    const updated = await service.updateProfile(registration.token, {profile: {
        firstName: 'River', middleName: 'Morgan', lastName: 'Driver',
    }});
    assert.equal(updated.user.displayName, 'River Morgan Driver');
    assert.deepEqual({firstName: updated.user.profile.firstName, middleName: updated.user.profile.middleName,
        lastName: updated.user.profile.lastName, fn: updated.user.profile.fn, mi: updated.user.profile.mi,
        ln: updated.user.profile.ln}, {
        firstName: 'River', middleName: 'Morgan', lastName: 'Driver', fn: 'River', mi: 'M.', ln: 'Driver',
    });
    assert.equal(pool.state.users[0].display_name, 'River Morgan Driver');
    await assert.rejects(service.updateProfile(registration.token, {profile: {firstName: 'River'}}),
        error => error.code === 'INVALID_PROFILE');
});

test('failed session creation rolls back username account and identity rows', async () => {
    const {pool, service} = fixture({failSessionInsert: true});
    await assert.rejects(service.registerWithUsername({username: 'river.driver', password: 'correct horse battery'}));
    assert.equal(pool.state.users.length, 0);
    assert.equal(pool.state.identities.length, 0);
});
test('username login uses generic credential failures and sessions can be revoked', async () => {
    const {service} = fixture();
    await service.registerWithUsername({username: 'river.driver', password: 'correct horse battery'});
    const login = await service.loginWithUsername({username: 'RIVER.DRIVER', password: 'correct horse battery'});
    assert.equal((await service.authenticate(login.token)).username, 'river.driver');
    await assert.rejects(service.loginWithUsername({username: 'river.driver', password: 'wrong password'}), error => error.code === 'INVALID_CREDENTIALS');
    assert.equal(await service.logout(login.token), true);
    assert.equal(await service.authenticate(login.token), null);
});
