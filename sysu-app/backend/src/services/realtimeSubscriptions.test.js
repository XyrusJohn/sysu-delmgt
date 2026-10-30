const test = require('node:test');
const assert = require('node:assert/strict');
const {createRealtimeSubscriptions, createMysqlProfileRealtimeSubscriptions, serialize} = require('./realtimeSubscriptions');

function fixture(role = 'admin', uid = 'staff-1', overrides = {}) {
    const handlers = new Map();
    const emitted = [];
    const eventCalls = [];
    const socket = {
        data: {role, uid},
        on: (event, callback) => handlers.set(event, callback),
        once: (event, callback) => handlers.set(`${event}:once`, callback),
        emit: (event, payload) => emitted.push({event, payload}),
    };
    const rows = [
        {id: 'row-1', driverId: uid, driverName: 'Synthetic Driver', plateNumber: 'ABC-123', truckType: '4W', status: 'waiting', entryTime: 1, secret: 'private'},
    ];
    const services = {
        mysqlMasterData: {listGuards: async () => [{id: 'guard-1', guardId: 'G-1', firstName: 'Sam', signature: 'private'}],
            listCompanies: async () => [{id: 'company-1', companyCode: 'TC-1', name: 'Example', bankDetails: 'private'}]},
        masterDataEvents: {on: (...args) => eventCalls.push(['on', ...args]), off: (...args) => eventCalls.push(['off', ...args])},
        mysqlRoleGovernance: {listUsers: async () => [{id: uid, role}]},
        mysqlDriverProfiles: {get: async id => ({id}), list: async () => [{id: uid}]},
        mysqlQrService: {listAll: async () => rows},
        mysqlLiveLocations: {get: async id => ({id, latitude: 1}), list: async () => [{id: uid, latitude: 1}]},
        mysqlAssignments: {list: async filters => [{dispatchKey: 'dispatch-1', ...filters}]},
        mysqlDispatchGovernance: {listRequests: async kind => [{requestKind: kind}]},
    };
    createRealtimeSubscriptions({...services, ...overrides})(socket);
    return {handlers, emitted, eventCalls, socket};
}

async function subscribe(f, topic, id = 'sub-1', params) {
    let ack;
    f.handlers.get('realtime:subscribe')({id, topic, ...(params ? {params} : {})}, value => {ack = value;});
    await new Promise(resolve => setImmediate(resolve));
    return ack;
}

function unsubscribe(f, id = 'sub-1') {
    f.handlers.get('realtime:unsubscribe')({id}, () => {});
}

test('MySQL queue subscriptions return safe QR-generator projections and stop polling on unsubscribe', async () => {
    const f = fixture('qr_generator', 'qr-1');
    assert.deepEqual(await subscribe(f, 'queue', 'queue-1'), {success: true, id: 'queue-1', topic: 'queue'});
    assert.deepEqual(f.emitted.at(-1).payload.data, [{id: 'row-1', driverId: 'qr-1', driverName: 'Synthetic Driver',
        plateNumber: 'ABC-123', truckType: '4W', status: 'waiting', entryTime: 1}]);
    unsubscribe(f, 'queue-1');
});

test('MySQL location, assignment, and dispatch subscriptions scope driver data and select request kinds', async () => {
    const f = fixture('driver', 'driver-1');
    assert.equal((await subscribe(f, 'locations')).success, true);
    assert.deepEqual(f.emitted.at(-1).payload.data, {id: 'driver-1', latitude: 1});
    unsubscribe(f);
    assert.equal((await subscribe(f, 'assignments')).success, true);
    assert.deepEqual(f.emitted.at(-1).payload.data, [{dispatchKey: 'dispatch-1', driverId: 'driver-1'}]);
    unsubscribe(f);
    assert.deepEqual(await subscribe(f, 'overrideRequests'), {success: false, message: 'Subscription not authorized'});
});

test('MySQL dispatch requests and administrator master data remain available with restricted fields', async () => {
    const f = fixture('admin');
    assert.equal((await subscribe(f, 'cancelRequests')).success, true);
    assert.deepEqual(f.emitted.at(-1).payload.data, [{requestKind: 'cancel'}]);
    unsubscribe(f);
    assert.equal((await subscribe(f, 'securityGuards')).success, true);
    assert.deepEqual(f.emitted.at(-1).payload.data, [{id: 'guard-1', guardId: 'G-1', firstName: 'Sam', middleInitial: undefined,
        lastName: undefined, fullName: undefined, active: undefined}]);
    unsubscribe(f);
    assert.deepEqual(f.eventCalls.map(call => call[0]), ['on', 'off']);
});

test('unsupported realtime topics are unavailable and never fall back to a database listener', async () => {
    const f = fixture();
    for (const topic of ['incidents', 'legacyOverrideRequests', 'profile']) {
        const ack = await subscribe(f, topic, `unsupported-${topic}`);
        assert.deepEqual(ack, {success: false, message: 'Realtime topic is unavailable'});
    }
    assert.equal(f.emitted.length, 0);
});

test('invalid subscriptions and excessive fanout are rejected', async () => {
    const f = fixture();
    assert.deepEqual(await subscribe(f, 'users', 'bad/id'), {success: false, message: 'Invalid subscription'});
    for (let i = 0; i < 20; i++) assert.equal((await subscribe(f, 'users', `sub-${i}`)).success, true);
    assert.deepEqual(await subscribe(f, 'users', 'sub-20'), {success: false, message: 'Invalid or excessive subscription'});
    for (let i = 0; i < 20; i++) unsubscribe(f, `sub-${i}`);
});

test('realtime polling reports one outage and emits a fresh snapshot after recovery', async () => {
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const callbacks = [];
    global.setInterval = callback => {
        callbacks.push(callback);
        return {unref() {}};
    };
    global.clearInterval = () => {};
    let unavailable = true;
    try {
        const f = fixture('admin', 'staff-1', {mysqlQrService: {listAll: async () => {
            if (unavailable) throw new Error('database offline');
            return [{id: 'queue-1'}];
        }}});
        assert.equal((await subscribe(f, 'queue')).success, true);
        const poll = callbacks[0];
        const errors = () => f.emitted.filter(item => item.event === 'realtime:error');
        const states = () => f.emitted.filter(item => item.event === 'realtime:state');
        assert.equal(errors().length, 1);

        await poll();
        assert.equal(errors().length, 1);

        unavailable = false;
        await poll();
        assert.equal(states().length, 1);

        unavailable = true;
        await poll();
        assert.equal(errors().length, 2);
        unsubscribe(f);
    } finally {
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    }
});

test('timestamp serializer handles nested arrays and leaves primitives intact', () => {
    assert.deepEqual(serialize({created: {toMillis: () => 50}, rows: [{count: 2}]}), {
        created: {$timestamp: 50}, rows: [{count: 2}],
    });
});

test('MySQL profile subscription emits only the own canonical account state', async () => {
    const handlers = new Map();
    const emitted = [];
    let disconnected = false;
    const socket = {data: {uid: 'public-account'}, handshake: {auth: {token: 'session-token'}},
        on: (event, callback) => handlers.set(event, callback),
        once: (event, callback) => handlers.set(`${event}:once`, callback),
        emit: (event, payload) => emitted.push({event, payload}),
        disconnect: () => {disconnected = true;}};
    let user = {id: 'public-account', username: 'driver.one', role: 'driver', status: 'active',
        profile: {role: 'super_admin', id: 'forged'}};
    createMysqlProfileRealtimeSubscriptions({authenticateSession: async () => user})(socket);
    let ack;
    handlers.get('realtime:subscribe')({id: 'own-profile', topic: 'profile'}, value => {ack = value;});
    assert.equal(ack.success, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(emitted.at(-1).payload.data.id, 'public-account');
    assert.equal(emitted.at(-1).payload.data.role, 'driver');
    handlers.get('realtime:unsubscribe')({id: 'own-profile'}, () => {});
    user = null;
    handlers.get('realtime:subscribe')({id: 'own-profile-2', topic: 'profile'}, () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disconnected, true);
});
