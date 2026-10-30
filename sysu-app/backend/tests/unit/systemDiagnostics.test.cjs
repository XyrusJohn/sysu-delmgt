const test = require('node:test');
const assert = require('node:assert/strict');
const {safeReport, createMysqlSystemDiagnostics} = require('../../src/services/systemDiagnostics');

test('safeReport only retains allowlisted diagnostic metadata', () => {
    const result = safeReport({
        eventCode: 'mobile_operation_failure', operation: 'shipment-assignment', errorName: 'IOException',
        message: 'private customer data', stack: 'secret stack', details: {expectedCount: 4, secret: 'no'},
    });
    assert.equal(result.source, 'mobile');
    assert.equal(result.message, 'A mobile workflow operation failed.');
    assert.deepEqual(result.details, {expectedCount: 4});
    assert.equal('stack' in result, false);
    assert.equal('message' in result && result.message.includes('private'), false);
    assert.equal(safeReport({eventCode: 'unknown', stack: 'secret'}), null);
});

test('safeReport keeps useful bounded diagnostic context and rejects unsafe fields', () => {
    const result = safeReport({eventCode: 'mobile_operation_failure', operation: 'pod-save', errorName: 'IOException',
        details: {stage: 'upload', httpStatus: 503, failureCode: 'NETWORK_TIMEOUT', sourceFrame: 'PodApiService.save:84',
            appVersion: '1.2.3', platform: 'android', clientRequestId: 'request-12345678', secret: 'redacted'}});
    assert.deepEqual(result.details, {stage: 'upload', httpStatus: 503, failureCode: 'NETWORK_TIMEOUT',
        sourceFrame: 'PodApiService.save:84', appVersion: '1.2.3', platform: 'android', clientRequestId: 'request-12345678'});
});

test('MySQL diagnostics are persisted, emitted to admin room, listed, and resolved', async () => {
    const rows = [];
    const pool = {execute: async (sql, values = []) => {
        if (sql.startsWith('INSERT')) {
            const row = {id: String(rows.length + 1), eventCode: values[0], source: values[1], severity: values[2],
                message: values[3], operation: values[4], errorName: values[5], requestId: values[6], route: values[7],
                actorId: values[8], details: values[9], createdAt: values[10], resolvedAt: null, resolvedBy: null};
            rows.push(row);
            return [{insertId: Number(row.id)}];
        }
        if (sql.startsWith('SELECT')) return [rows.filter(row => !sql.includes('resolved_at_ms IS NULL') || row.resolvedAt == null)
            .map(row => ({id: Number(row.id), event_code: row.eventCode, source: row.source, severity: row.severity,
                message: row.message, operation: row.operation, error_name: row.errorName, request_id: row.requestId,
                route: row.route, actor_id: row.actorId, details: row.details, created_at_ms: row.createdAt,
                resolved_at_ms: row.resolvedAt, resolved_by: row.resolvedBy}))];
        if (sql.startsWith('UPDATE')) {
            const row = rows.find(item => item.id === String(values[2]) && item.resolvedAt == null);
            if (!row) return [{affectedRows: 0}];
            Object.assign(row, {resolvedAt: values[0], resolvedBy: values[1]});
            return [{affectedRows: 1}];
        }
        throw new Error('Unexpected diagnostics SQL');
    }};
    const emitted = [];
    const io = {to: room => ({emit: (event, payload) => emitted.push({room, event, payload})})};
    const diagnostics = createMysqlSystemDiagnostics({pool, io, clock: () => Date.parse('2026-10-21T00:00:00Z')});
    const created = await diagnostics.record({eventCode: 'sap_detail_mismatch', details: {expectedCount: 3, receivedCount: 2, missingCount: 1}});
    assert.equal(created.severity, 'warning');
    assert.equal((await diagnostics.list({openOnly: true})).length, 1);
    assert.equal(emitted[0].room, 'ops-admins');
    assert.equal(await diagnostics.resolve(created.id, 'admin-1'), true);
    assert.equal((await diagnostics.list({openOnly: true})).length, 0);
    assert.equal(emitted.at(-1).event, 'system_error_resolved');
});

test('successful central database health checks auto-resolve their matching account-scoped error', async () => {
    const updates = [];
    const pool = {execute: async (sql, values) => {
        if (!sql.startsWith('UPDATE app_system_error_logs')) throw new Error('Unexpected diagnostics SQL');
        updates.push(values);
        return [{affectedRows: 1}];
    }};
    const diagnostics = createMysqlSystemDiagnostics({pool, clock: () => 1000});
    assert.equal(await diagnostics.resolveOperation('frontend_operation_failure', 'sysu-go-database-health', 'driver-1'), 1);
    assert.deepEqual(updates[0].slice(2), ['frontend_operation_failure', 'sysu-go-database-health', 'driver-1']);
});
