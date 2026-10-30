const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlDriverProfiles} = require('./mysqlDriverProfiles');

function setup() {
    let state = {
        users: new Map([
            ['staff', {public_id: 'staff', role: 'admin', status: 'active'}],
            ['driver-a', {public_id: 'driver-a', role: 'driver', status: 'active'}],
        ]),
        profiles: new Map([['driver-a', {driver_id: 'driver-a', name: 'Old', requirements: '{"license":true}', is_full: 1}]]),
        queues: [
            {driver_id: 'driver-a', status: 'waiting', registration_complete: 0, is_full: 1},
            {driver_id: 'driver-a', status: 'loaded', registration_complete: 0, is_full: 1},
            {driver_id: 'driver-a', status: 'completed', registration_complete: 0, is_full: 1},
            {driver_id: 'driver-b', status: 'waiting', registration_complete: 0, is_full: 0},
        ],
        audits: [],
    };

    async function execute(sql, params = []) {
        if (sql.includes('FROM app_auth_users WHERE public_id')) {
            const user = state.users.get(params[0]);
            return [[...(user ? [{role: user.role, status: user.status}] : [])]];
        }
        if (sql.includes('SELECT requirements FROM app_driver_profiles')) {
            const row = state.profiles.get(params[0]);
            return [[...(row ? [{requirements: row.requirements}] : [])]];
        }
        if (sql.includes('INSERT INTO app_driver_profiles')) {
            const [driverId, name, phone, license, truckType, plateNumber, truckingCompany, helper, notes, requirements] = params;
            state.profiles.set(driverId, {...state.profiles.get(driverId), driver_id: driverId, name, phone, license,
                truck_type: truckType, plate_number: plateNumber, trucking_company: truckingCompany, helper, notes,
                requirements, status: 'active'});
            return [{affectedRows: 1}];
        }
        if (sql.includes('UPDATE app_queue_entries SET registration_complete')) {
            const [driverId, ...statuses] = params;
            for (const queue of state.queues) {
                if (queue.driver_id === driverId && !queue.registration_complete && statuses.includes(queue.status)) {
                    queue.registration_complete = 1;
                }
            }
            return [{affectedRows: 1}];
        }
        if (sql.includes('INSERT INTO app_driver_profile_audit')) {
            state.audits.push(params);
            return [{affectedRows: 1}];
        }
        if (sql.includes('SELECT * FROM app_driver_profiles WHERE driver_id')) {
            const row = state.profiles.get(params[0]);
            return [[...(row ? [{...row}] : [])]];
        }
        if (sql.startsWith('UPDATE app_driver_profiles SET is_full')) {
            const row = state.profiles.get(params[1]);
            if (!row) return [{affectedRows: 0}];
            row.is_full = params[0] ? 1 : 0;
            return [{affectedRows: 1}];
        }
        if (sql.startsWith('UPDATE app_queue_entries SET is_full')) {
            const [isFull, driverId, ...statuses] = params;
            for (const queue of state.queues) {
                if (queue.driver_id === driverId && statuses.includes(queue.status)) queue.is_full = isFull ? 1 : 0;
            }
            return [{affectedRows: 1}];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    }

    let snapshot;
    const connection = {
        execute,
        beginTransaction: async () => { snapshot = structuredClone(state); },
        commit: async () => { snapshot = null; },
        rollback: async () => { state = snapshot; },
        release: () => {},
    };
    const pool = {execute, getConnection: async () => connection};
    return {profiles: createMysqlDriverProfiles({pool}), state: () => state};
}

const input = {name: 'New Name', phone: '09000000000', license: 'L1', truckType: '4W', plateNumber: 'TEST',
    truckingCompany: 'Synthetic', helper: '', notes: ''};

test('MySQL driver profile save preserves capacity and updates only active queue records', async () => {
    const context = setup();
    const saved = await context.profiles.save({actorId: 'staff', driverId: 'driver-a', input});
    const state = context.state();
    assert.equal(saved.name, input.name);
    assert.equal(saved.isFull, true);
    assert.deepEqual(saved.requirements, {license: true});
    assert.equal(state.queues[0].registration_complete, 1);
    assert.equal(state.queues[1].registration_complete, 1);
    assert.equal(state.queues[2].registration_complete, 0);
    assert.equal(state.queues[3].registration_complete, 0);
    assert.equal(state.audits.length, 1);
});

test('MySQL driver profile save rejects stale staff and inactive driver accounts', async () => {
    const demoted = setup();
    demoted.state().users.set('staff', {public_id: 'staff', role: 'driver', status: 'active'});
    await assert.rejects(demoted.profiles.save({actorId: 'staff', driverId: 'driver-a', input}), error => error.statusCode === 403);

    const inactive = setup();
    inactive.state().users.set('driver-a', {public_id: 'driver-a', role: 'driver', status: 'disabled'});
    await assert.rejects(inactive.profiles.save({actorId: 'staff', driverId: 'driver-a', input}), error => error.statusCode === 409);
});

test('MySQL capacity update synchronizes active queues and refuses missing profiles', async () => {
    const context = setup();
    await context.profiles.setCapacity('driver-a', false);
    const state = context.state();
    assert.equal(state.profiles.get('driver-a').is_full, 0);
    assert.equal(state.queues[0].is_full, 0);
    assert.equal(state.queues[1].is_full, 0);
    assert.equal(state.queues[2].is_full, 1);
    assert.equal(state.queues[3].is_full, 0);
    await assert.rejects(context.profiles.setCapacity('missing', true), error => error.statusCode === 404);
});
