const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../src/server.js'), 'utf8');

function socketHandler(event, nextEvent, context = {}) {
    const handlers = {};
    const socket = {
        data: context.socketData || {uid: 'driver-1', role: 'driver'},
        handshake: {auth: {token: 'test-session-token'}},
        on: (name, handler) => { handlers[name] = handler; },
        emit: (...args) => context.socketEmissions?.push(args),
    };
    const start = source.indexOf(`socket.on("${event}"`);
    const end = source.indexOf(`socket.on("${nextEvent}"`, start);
    assert.ok(start >= 0 && end > start, `server event ${event} exists`);
    vm.runInNewContext(source.slice(start, end), {
        socket,
        sessionService: context.sessionService || {authenticate: async () => ({role: 'super_admin', status: 'active', name: 'Test Admin'})},
        io: context.io || {emit: (...args) => context.broadcasts?.push(args), to: () => ({emit: (...args) => context.broadcasts?.push(args)})},
        mysqlAuth: true,
        admin: context.admin || {firestore: () => { throw new Error('Legacy data store must not be used in MySQL mode'); }},
        getWarehouseBaseConfig: context.getWarehouseBaseConfig || (() => { throw new Error('Legacy warehouse read must not run'); }),
        saveWarehouseBaseConfig: context.saveWarehouseBaseConfig || (() => { throw new Error('Legacy warehouse save must not run'); }),
        require: context.require || (() => { throw new Error('Unexpected module load'); }),
        console: {log() {}, warn() {}, error() {}},
    });
    return {run: handlers[event], socket, handlers};
}

test('MySQL driver_is_full updates SQL capacity and notifies dispatchers', async () => {
    const writes = [];
    const broadcasts = [];
    const handler = socketHandler('driver_is_full', 'driver_moving', {
        broadcasts,
        io: {to: room => ({emit: (...args) => broadcasts.push({room, args})})},
        require: name => {
            assert.equal(name, './services/mysqlDriverProfiles');
            return {getMysqlDriverProfiles: () => ({setCapacity: async (...args) => writes.push(args)})};
        },
    });

    await handler.run({isFull: true});

    assert.deepEqual(writes, [['driver-1', true]]);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].room, 'dispatchers');
    assert.equal(broadcasts[0].args[0], 'driver_capacity_updated');
    assert.equal(broadcasts[0].args[1].driverId, 'driver-1');
    assert.equal(broadcasts[0].args[1].isFull, true);
});

test('MySQL driver_is_full ignores impersonation before writing or notifying', async () => {
    let writes = 0;
    const broadcasts = [];
    const handler = socketHandler('driver_is_full', 'driver_moving', {
        broadcasts,
        io: {to: () => ({emit: (...args) => broadcasts.push(args)})},
        require: () => ({getMysqlDriverProfiles: () => ({setCapacity: async () => { writes++; }})}),
    });

    await handler.run({driverId: 'driver-2', isFull: true});

    assert.equal(writes, 0);
    assert.deepEqual(broadcasts, []);
});

test('MySQL warehouse reads use SQL settings without calling a legacy service', async () => {
    const config = {name: 'Local base', lat: 14, lng: 121, radiusMeters: 500};
    const {run} = socketHandler('get_warehouse_base', 'save_warehouse_base', {getWarehouseBaseConfig: async () => config});
    let result;
    await run(value => { result = value; });
    assert.equal(result.success, true);
    assert.deepEqual(result.data, config);
});

test('MySQL warehouse saves enforce the session role and persist validated SQL settings', async () => {
    let saved;
    let actorRole = 'super_admin';
    const {run, socket} = socketHandler('save_warehouse_base', 'get_role_requests', {
        socketData: {uid: 'admin-1', role: 'super_admin'},
        saveWarehouseBaseConfig: async (data, uid, name) => { saved = {data, uid, name}; return data; },
        sessionService: {authenticate: async () => ({role: actorRole, status: 'active', name: 'Test Admin'})},
    });
    let result;
    await run({lat: 14, lng: 121, radiusMeters: 500}, value => { result = value; });
    assert.equal(result.success, true);
    assert.deepEqual(saved, {data: {lat: 14, lng: 121, radiusMeters: 500}, uid: 'admin-1', name: 'Test Admin'});
    actorRole = 'admin';
    socket.data.role = 'admin';
    await run({lat: 14, lng: 121, radiusMeters: 500}, value => { result = value; });
    assert.equal(result.success, false);
    assert.match(result.message, /Only super_admin/);
});
