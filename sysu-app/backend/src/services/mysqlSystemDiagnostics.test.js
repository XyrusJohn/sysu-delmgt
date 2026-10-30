const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlSystemDiagnostics} = require('./systemDiagnostics');

test('MySQL system diagnostics persist safe reports and stream them to admins', async () => {
    const calls = [];
    const events = [];
    const pool = {execute: async (...args) => {calls.push(args); return [{insertId: 17}];}};
    const diagnostics = createMysqlSystemDiagnostics({pool, io: {to: room => ({emit: (...args) => events.push([room, ...args])})}, clock: () => 1234});
    const result = await diagnostics.record({eventCode: 'api_request_failure', requestId: 'request-12345678', actorId: '123e4567-e89b-12d3-a456-426614174000', details: {statusCode: 503, secret: 'excluded'}});
    assert.equal(calls.length, 2);
    assert.match(calls[0][0], /JSON_SET/);
    assert.equal(calls[1][1][0], 'api_request_failure');
    assert.equal(calls[1][1][9], '{"statusCode":503}');
    assert.equal(result.id, '17');
    assert.equal(events[0][0], 'ops-admins');
    assert.equal(events[0][1], 'system_error_created');
});

test('matching open reports are counted rather than inserted as duplicate rows', async () => {
    const calls = [];
    const events = [];
    const pool = {execute: async (...args) => {
        calls.push(args);
        return calls.length === 1 ? [{affectedRows: 1, insertId: 4}] : [{insertId: 18}];
    }};
    const diagnostics = createMysqlSystemDiagnostics({pool, io: {to: room => ({emit: (...args) => events.push([room, ...args])})}, clock: () => 1234});
    const record = await diagnostics.record({eventCode: 'frontend_operation_failure', operation: 'sap-sync',
        actorId: 'account-1', details: {failureCode: 'NETWORK_UNREACHABLE'}});
    assert.equal(calls.length, 1);
    assert.equal(record.details.occurrenceCount, 4);
    assert.equal(events[0][1], 'system_error_updated');
});

test('a live notification failure does not turn a saved diagnostic report into a failed request', async () => {
    let writes = 0;
    const diagnostics = createMysqlSystemDiagnostics({pool: {execute: async () => {
        writes += 1;
        return [{insertId: 19}];
    }}, io: {to: () => ({emit: () => {throw new Error('socket unavailable');}})}});

    await assert.doesNotReject(diagnostics.record({eventCode: 'frontend_operation_failure', operation: 'sap-sync',
        actorId: 'account-1', details: {clientEventId: '123e4567-e89b-12d3-a456-426614174000'}}));
    assert.equal(writes, 2);
});

test('MySQL system diagnostics scope resolve IDs and report lists', async () => {
    const calls = [];
    const pool = {execute: async (...args) => {calls.push(args); return [args[0].startsWith('SELECT') ? [] : {affectedRows: 1}];}};
    const diagnostics = createMysqlSystemDiagnostics({pool, clock: () => 1234});
    assert.equal(await diagnostics.resolve('not-an-id', 'actor'), false);
    assert.equal(calls.length, 0);
    assert.equal(await diagnostics.resolve('17', 'actor'), true);
    assert.match(calls[0][0], /resolved_at_ms IS NULL/);
    await diagnostics.list({limit: 200, openOnly: true});
    assert.match(calls[1][0], /event_code <> 'mobile_diagnostic_run'/);
    assert.match(calls[1][0], /resolved_at_ms IS NULL/);
    assert.deepEqual(calls[1][1], [100]);
});

test('mobile diagnostic account list returns only the latest run per account and paginates', async () => {
    const calls = [];
    const diagnostics = createMysqlSystemDiagnostics({pool: {execute: async (...args) => {
        calls.push(args);
        return [[{id: 22, event_code: 'mobile_diagnostic_run', source: 'mobile', severity: 'info',
            message: 'SYSU Go diagnostics run completed.', operation: 'mobile-diagnostics', request_id: 'run-ref',
            actor_id: 'account-1', details: JSON.stringify({runId: 'run-ref', checks: []}), created_at_ms: 1234}]];
    }}});
    const result = await diagnostics.listDiagnosticRuns({limit: 50});
    assert.match(calls[0][0], /event_code = 'mobile_diagnostic_run'/);
    assert.match(calls[0][0], /ROW_NUMBER\(\) OVER \(PARTITION BY actor_id/);
    assert.deepEqual(calls[0][1], [51, 0]);
    assert.equal(result.items[0].id, '22');
    assert.equal(result.hasMore, false);
    assert.deepEqual(result.items[0].details.checks, []);
});

test('mobile diagnostic history is scoped to a validated account ID', async () => {
    const calls = [];
    const diagnostics = createMysqlSystemDiagnostics({pool: {execute: async (...args) => {
        calls.push(args);
        return [[]];
    }}});
    const actorId = 'af9ae40b-9602-4dbd-b1ff-41d697022798';
    await diagnostics.listDiagnosticRuns({actorId, limit: 20, offset: 1});
    assert.match(calls[0][0], /actor_id = \?/);
    assert.deepEqual(calls[0][1], [actorId, 21, 1]);
    assert.deepEqual(await diagnostics.listDiagnosticRuns({actorId: 'invalid'}), {items: [], hasMore: false});
    assert.equal(calls.length, 1);
});

test('auto-recovery resolves only allowlisted operation failures for the authenticated actor', async () => {
    const calls = [];
    const events = [];
    const diagnostics = createMysqlSystemDiagnostics({pool: {execute: async (...args) => {
        calls.push(args);
        return [{affectedRows: 3}];
    }}, io: {to: room => ({emit: (...args) => events.push([room, ...args])})}, clock: () => 1234});
    assert.equal(await diagnostics.resolveOperation('frontend_operation_failure', 'not-allowlisted', 'account-1'), 0);
    assert.equal(calls.length, 0);
    assert.equal(await diagnostics.resolveOperation('frontend_operation_failure', 'sap-sync', 'account-1'), 3);
    assert.match(calls[0][0], /actor_id = \?/);
    assert.deepEqual(calls[0][1], [1234, 'account-1', 'frontend_operation_failure', 'sap-sync', 'account-1']);
    assert.equal(events[0][1], 'system_error_resolved');
});

test('only resolved diagnostic rows can be individually deleted and admins receive an update', async () => {
    const calls = [];
    const events = [];
    const pool = {execute: async (...args) => {calls.push(args); return [{affectedRows: 1}];}};
    const diagnostics = createMysqlSystemDiagnostics({pool, io: {to: room => ({emit: (...args) => events.push([room, ...args])})}});
    assert.equal(await diagnostics.deleteResolved('not-an-id'), false);
    assert.equal(calls.length, 0);
    assert.equal(await diagnostics.deleteResolved('17'), true);
    assert.match(calls[0][0], /DELETE FROM app_system_error_logs/);
    assert.match(calls[0][0], /resolved_at_ms IS NOT NULL/);
    assert.deepEqual(calls[0][1], ['17']);
    assert.deepEqual(events, [['ops-admins', 'system_error_deleted', {id: '17'}]]);
});

test('mobile diagnostic deletion only targets a validated diagnostic run row', async () => {
    const calls = [];
    const diagnostics = createMysqlSystemDiagnostics({pool: {execute: async (...args) => {
        calls.push(args);
        return [{affectedRows: 1}];
    }}});
    assert.equal(await diagnostics.deleteDiagnosticRun('bad'), false);
    assert.equal(calls.length, 0);
    assert.equal(await diagnostics.deleteDiagnosticRun('22'), true);
    assert.match(calls[0][0], /event_code = 'mobile_diagnostic_run'/);
    assert.deepEqual(calls[0][1], ['22']);
});
