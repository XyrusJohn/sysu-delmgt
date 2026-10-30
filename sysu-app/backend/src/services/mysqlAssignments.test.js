const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlAssignments} = require('./mysqlAssignments');

function createFixture({queue = [], assignments = [], tokens = []} = {}) {
    let state = {queue, assignments, tokens};
    let now = 1000;
    async function execute(sql, params = []) {
        if (sql.includes('SELECT dispatch_key FROM app_sap_assignments WHERE dispatch_key')) {
            return [[...state.assignments.filter(row => row.dispatch_key === params[0]).map(row => ({dispatch_key: row.dispatch_key}))]];
        }
        if (sql.includes('FROM app_queue_entries WHERE LOWER(truck_type)')) return [state.queue.map(row => ({...row}))];
        if (sql.includes('SELECT dispatch_key, queue_id, trip_status FROM app_sap_assignments WHERE driver_id')) {
            return [state.assignments.filter(row => row.driver_id === params[0]).map(({dispatch_key, queue_id, trip_status}) => ({dispatch_key, queue_id, trip_status}))];
        }
        if (sql.includes('SELECT * FROM app_override_tokens WHERE token_id')) {
            const token = state.tokens.find(row => row.token_id === params[0]);
            return [[...(token ? [{...token}] : [])]];
        }
        if (sql.includes('UPDATE app_override_tokens SET consumed_at_ms')) {
            const token = state.tokens.find(row => row.token_id === params[3]);
            if (token) Object.assign(token, {consumed_at_ms: params[0], consumed_by: params[1], consumed_for_assignment: params[2]});
            return [{affectedRows: token ? 1 : 0}];
        }
        if (sql.includes('INSERT INTO app_sap_assignments')) {
            const [dispatch_key, driver_id, queue_id, driver_name, truck_plate, truck_company, truck_type,
                line_items, assigned_at_ms, assigned_by, sap_source_fetched_at_ms, data] = params;
            state.assignments.push({dispatch_key, driver_id, queue_id, driver_name, truck_plate, truck_company, truck_type,
                line_items, assigned_at_ms, assigned_by, sap_source_fetched_at_ms, trip_status: 'assigned', data});
            return [{affectedRows: 1}];
        }
        if (sql.includes('UPDATE app_queue_entries SET is_assigned')) {
            const row = state.queue.find(item => item.id === params[1]);
            if (row) { row.is_assigned = 1; row.status = 'loading'; row.data = params[0]; }
            return [{affectedRows: row ? 1 : 0}];
        }
        if (sql.includes('SELECT * FROM app_sap_assignments WHERE dispatch_key')) {
            return [state.assignments.filter(row => row.dispatch_key === params[0]).map(row => ({...row}))];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    }
    let snapshot;
    const connection = {
        execute,
        beginTransaction: async () => { snapshot = structuredClone(state); },
        commit: async () => { snapshot = null; },
        rollback: async () => { if (snapshot) state = snapshot; },
        release: () => {},
    };
    const pool = {execute, getConnection: async () => connection};
    return {assignments: createMysqlAssignments({pool, now: () => ++now}), state: () => state};
}

const queueEntry = (id, driverId, entryTime, overrides = {}) => ({
    id, driver_id: driverId, driver_name: `Driver ${driverId}`, plate_number: `PLATE-${driverId}`,
    truck_company: 'Synthetic', truck_type: '4W', status: 'waiting', entry_time_ms: entryTime,
    registration_complete: 1, is_assigned: 0, is_full: 0, data: '{}', ...overrides,
});
const body = (dispatchKey, requestedDriverId, extra = {}) => ({dispatchKey, requestedDriverId,
    truckType: '4W', overrideTokenId: null, ...extra});
const lineItems = [{obdNumber: 'OBD-1', quantity: '10.5', customerName: 'Synthetic'}];

test('MySQL FIFO assignment persists authoritative queue identity and shipment data', async () => {
    const context = createFixture({queue: [queueEntry('q-a', 'driver-a', 100), queueEntry('q-b', 'driver-b', 200)]});
    const result = await context.assignments.assign({body: body('dispatch-1', 'driver-a'), assignedBy: 'staff', lineItems, sapFetchedAt: 900});
    assert.equal(result.status, 200);
    assert.equal(result.data.usedOverride, false);
    const state = context.state();
    assert.equal(state.assignments.length, 1);
    assert.equal(state.assignments[0].driver_id, 'driver-a');
    assert.equal(state.assignments[0].truck_plate, 'PLATE-driver-a');
    assert.deepEqual(JSON.parse(state.assignments[0].line_items).map(item => item.quantity), [10.5]);
    assert.equal(state.queue[0].status, 'loading');
    assert.equal(JSON.parse(state.queue[0].data).activeShipmentsCount, 1);
});

test('MySQL assignment denies a non-earliest driver and duplicate dispatch keys', async () => {
    const context = createFixture({queue: [queueEntry('q-a', 'driver-a', 100), queueEntry('q-b', 'driver-b', 200)],
        assignments: [{dispatch_key: 'used', driver_id: 'driver-a', queue_id: 'q-a', trip_status: 'assigned'}]});
    const notEarliest = await context.assignments.assign({body: body('dispatch-2', 'driver-b'), assignedBy: 'staff', lineItems, sapFetchedAt: 900});
    assert.equal(notEarliest.code, 'NOT_EARLIEST');
    const duplicate = await context.assignments.assign({body: body('used', 'driver-a'), assignedBy: 'staff', lineItems, sapFetchedAt: 900});
    assert.equal(duplicate.code, 'DISPATCH_TAKEN');
    assert.equal(context.state().assignments.length, 1);
});

test('MySQL assignment blocks drivers on active trips and rejects completed queue sessions', async () => {
    const active = createFixture({queue: [queueEntry('q-a', 'driver-a', 100)],
        assignments: [{dispatch_key: 'trip', driver_id: 'driver-a', queue_id: 'old', trip_status: 'in_transit'}]});
    assert.equal((await active.assignments.assign({body: body('dispatch-1', 'driver-a'), assignedBy: 'staff', lineItems, sapFetchedAt: 900})).code,
        'DRIVER_ON_ACTIVE_LOAD');

    const completed = createFixture({queue: [queueEntry('q-a', 'driver-a', 100)],
        assignments: [{dispatch_key: 'done', driver_id: 'driver-a', queue_id: 'q-a', trip_status: 'completed'}]});
    assert.equal((await completed.assignments.assign({body: body('dispatch-2', 'driver-a'), assignedBy: 'staff', lineItems, sapFetchedAt: 900})).code,
        'DRIVER_SESSION_COMPLETED');
});

test('MySQL override token is validated, consumed once, and assignment remains atomic', async () => {
    const context = createFixture({queue: [queueEntry('q-a', 'driver-a', 100), queueEntry('q-b', 'driver-b', 200)],
        tokens: [{token_id: 'token-1', dispatch_key: 'dispatch-1', requested_driver_id: 'q-b', expires_at_ms: 9000, consumed_at_ms: null}]});
    const request = {body: body('dispatch-1', 'driver-b', {overrideTokenId: 'token-1'}), assignedBy: 'staff', lineItems, sapFetchedAt: 900};
    const result = await context.assignments.assign(request);
    assert.equal(result.status, 200);
    assert.equal(context.state().tokens[0].consumed_for_assignment, 'dispatch-1');
    const second = await context.assignments.assign({...request, body: body('dispatch-2', 'driver-b', {overrideTokenId: 'token-1'})});
    assert.equal(second.code, 'OVERRIDE_TOKEN_INVALID');
    assert.equal(context.state().assignments.length, 1);
});
