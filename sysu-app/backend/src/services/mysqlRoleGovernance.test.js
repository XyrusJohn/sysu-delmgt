const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlRoleGovernance} = require('./mysqlRoleGovernance');

function setup({reviewer, requester, request}) {
    const writes = [];
    const findUser = id => id === reviewer.public_id ? reviewer : id === requester.public_id ? requester : null;
    const execute = async (sql, params = []) => {
        if (sql.includes('FROM app_auth_users WHERE public_id')) {
            const user = findUser(params[0]);
            return [[...(user ? [{...user}] : [])]];
        }
        if (sql.includes('FROM app_role_requests WHERE id')) {
            return [[request.id === params[0] ? {...request} : undefined].filter(Boolean)];
        }
        writes.push({sql, params});
        return [{affectedRows: 1}];
    };
    const connection = {
        execute,
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
    };
    const pool = {execute, getConnection: async () => connection};
    return {governance: createMysqlRoleGovernance({pool}), writes};
}

const base = () => ({
    reviewer: {id: 1, public_id: 'admin', role: 'admin', status: 'active', profile: '{}'},
    requester: {id: 2, public_id: 'requester', role: 'driver', status: 'active', profile: '{"pendingRoleChange":"super_admin"}'},
    request: {id: 'request-1', requester_id: 'requester', requested_role: 'super_admin', status: 'pending'},
});

test('user lists prefer the profile display name when the stored name repeats the login username', async () => {
    const pool = {getConnection: async () => ({}), execute: async () => [[{
        public_id: 'account-1', username: 'web_developer_account', display_name: 'web_developer_account',
        role: 'admin', status: 'active', profile: JSON.stringify({name: 'Web Developer'}),
    }]]};
    const users = await createMysqlRoleGovernance({pool}).listUsers();
    assert.equal(users[0].username, 'web_developer_account');
    assert.equal(users[0].displayName, 'Web Developer');
});

test('user lists compose structured first, middle, and last names for dispatchers', async () => {
    const pool = {getConnection: async () => ({}), execute: async () => [[{
        public_id: 'account-2', username: 'river.driver', display_name: 'river.driver',
        role: 'driver', status: 'active', profile: JSON.stringify({firstName: 'River', middleName: 'Morgan', lastName: 'Driver'}),
    }]]};
    const users = await createMysqlRoleGovernance({pool}).listUsers();
    assert.equal(users[0].displayName, 'River Morgan Driver');
});

test('MySQL role governance restricts super-admin changes to super-admin reviewers', async () => {
    const {governance, writes} = setup(base());
    await assert.rejects(governance.decide({requestId: 'request-1', reviewerId: 'admin', approved: true}),
        error => error.statusCode === 403 && /super-admin/i.test(error.message));
    assert.deepEqual(writes, []);
});

test('MySQL role governance prevents reviewers from reviewing their own request', async () => {
    const data = base();
    data.requester.public_id = data.reviewer.public_id;
    data.request.requester_id = data.reviewer.public_id;
    const {governance, writes} = setup(data);
    await assert.rejects(governance.decide({requestId: 'request-1', reviewerId: 'admin', approved: true}),
        error => error.statusCode === 403 && /own request/i.test(error.message));
    assert.deepEqual(writes, []);
});

test('MySQL role governance cannot approve an account pending deletion', async () => {
    const data = base();
    data.request.requested_role = 'driver';
    data.requester.profile = '{"pendingRoleChange":"driver","deletionState":"pending"}';
    const {governance, writes} = setup(data);
    await assert.rejects(governance.decide({requestId: 'request-1', reviewerId: 'admin', approved: true}),
        error => error.statusCode === 409 && /deletion/i.test(error.message));
    assert.deepEqual(writes, []);
});

test('MySQL role governance rejects superseded role requests', async () => {
    const data = base();
    data.requester.profile = '{}';
    const {governance, writes} = setup(data);
    await assert.rejects(governance.decide({requestId: 'request-1', reviewerId: 'admin', approved: true}),
        error => error.statusCode === 409 && /superseded/i.test(error.message));
    assert.deepEqual(writes, []);
});

test('MySQL direct role changes prevent self changes and non-super-admin control of super-admin roles', async () => {
    const self = setup(base());
    await assert.rejects(self.governance.updateRole({actorId: 'admin', targetId: 'admin', role: 'driver'}),
        error => error.statusCode === 403 && /own role/i.test(error.message));
    assert.deepEqual(self.writes, []);

    const promotion = setup(base());
    await assert.rejects(promotion.governance.updateRole({actorId: 'admin', targetId: 'requester', role: 'super_admin'}),
        error => error.statusCode === 403 && /super-admin/i.test(error.message));
    assert.deepEqual(promotion.writes, []);

    const demotionData = base();
    demotionData.requester.role = 'super_admin';
    const demotion = setup(demotionData);
    await assert.rejects(demotion.governance.updateRole({actorId: 'admin', targetId: 'requester', role: 'driver'}),
        error => error.statusCode === 403 && /super-admin/i.test(error.message));
    assert.deepEqual(demotion.writes, []);
});

test('MySQL direct role change persists and audits through the SQL transaction', async () => {
    const context = setup(base());
    const result = await context.governance.updateRole({actorId: 'admin', targetId: 'requester', role: 'fleet_manager'});
    assert.deepEqual(result, {uid: 'requester', role: 'fleet_manager'});
    assert.ok(context.writes.some(({sql}) => sql.includes('UPDATE app_auth_users SET role')));
    assert.ok(context.writes.some(({sql}) => sql.includes('INSERT INTO app_user_admin_audit')));
});

test('MySQL account disable is super-admin-only, blocks self-delete, and revokes sessions', async () => {
    const denied = setup(base());
    await assert.rejects(denied.governance.disableUser({actorId: 'admin', targetId: 'requester'}),
        error => error.statusCode === 403 && /super-admin/i.test(error.message));
    assert.deepEqual(denied.writes, []);

    const self = setup(base());
    await assert.rejects(self.governance.disableUser({actorId: 'admin', targetId: 'admin'}),
        error => error.statusCode === 403);

    const data = base();
    data.reviewer.role = 'super_admin';
    const allowed = setup(data);
    assert.deepEqual(await allowed.governance.disableUser({actorId: 'admin', targetId: 'requester'}), {uid: 'requester'});
    assert.ok(allowed.writes.some(({sql}) => sql.includes('UPDATE app_auth_sessions SET revoked_at')));
    assert.ok(allowed.writes.some(({sql}) => sql.includes('INSERT INTO app_user_admin_audit')));
});
