const test = require('node:test');
const assert = require('node:assert/strict');
const {safeDetails, createMysqlSystemDiagnostics} = require('./mysqlSystemDiagnostics');

test('diagnostic details retain only bounded troubleshooting metadata', () => {
  assert.deepEqual(safeDetails({stage: 'pod-save', httpStatus: 503, failureCode: 'NETWORK_TIMEOUT',
    sourceFrame: 'PodApiService.save:84', appVersion: '1.2.3', platform: 'android', secret: 'private'}),
  {stage: 'pod-save', httpStatus: 503, failureCode: 'NETWORK_TIMEOUT', sourceFrame: 'PodApiService.save:84',
    appVersion: '1.2.3', platform: 'android'});
});

test('mobile diagnostics persist using the existing shared MySQL system log table', async () => {
  const queries = [];
  const service = createMysqlSystemDiagnostics({pool: {execute: async (...args) => {
    queries.push(args);
    return [{insertId: 12}];
  }}, clock: () => 1234});
  const record = await service.record({eventCode: 'mobile_operation_failure', operation: 'pod-save', errorName: 'IOException',
    actorId: 'driver-a', requestId: 'request-12345678', details: {sourceFrame: 'PodApiService.save:84', secret: 'excluded'}});
  assert.equal(record.id, '12');
  assert.equal(record.source, 'mobile');
  assert.equal(queries[0][0].includes('JSON_SET'), true);
  assert.equal(queries[1][0].includes('app_system_error_logs'), true);
  assert.deepEqual(JSON.parse(queries[1][1][8]), {sourceFrame: 'PodApiService.save:84'});
});

test('diagnostic runs store only the fixed check fields in the existing shared table', async () => {
  const calls = [];
  const service = createMysqlSystemDiagnostics({pool: {execute: async (...args) => {
    calls.push(args);
    return [{insertId: 44}];
  }}, clock: () => 1234});
  const checks = [
    {name: 'network', status: 'pass', durationMs: 0, state: 'wifi'},
    {name: 'sysu-go-api', status: 'pass', durationMs: 18, httpStatus: 200},
    {name: 'sysu-go-database', status: 'pass', durationMs: 8, httpStatus: 200},
    {name: 'sysu-go-socket', status: 'warning', durationMs: 0, state: 'disconnected'},
    {name: 'session-token', status: 'pass', durationMs: 0, state: 'present'},
  ];
  const run = await service.recordDiagnosticRun({runId: '123e4567-e89b-12d3-a456-426614174000',
    actorId: 'driver-a', appVersion: '1.2.3', checks});
  assert.equal(run.id, '44');
  assert.match(calls[0][0], /app_system_error_logs/);
  assert.equal(calls[0][1][0], '123e4567-e89b-12d3-a456-426614174000');
  assert.deepEqual(JSON.parse(calls[0][1][2]), {runId: '123e4567-e89b-12d3-a456-426614174000', appVersion: '1.2.3',
    platform: 'android', checks});
  assert.equal(await service.recordDiagnosticRun({runId: 'bad', actorId: 'driver-a', appVersion: '1.2.3', checks}), null);
});

test('mobile recovery resolves only the authenticated driver operation', async () => {
  const queries = [];
  const service = createMysqlSystemDiagnostics({pool: {execute: async (...args) => {
    queries.push(args);
    return [{affectedRows: 2}];
  }}, clock: () => 1234});
  assert.equal(await service.resolveOperation('mobile_operation_failure', 'unknown-operation', 'driver-a'), 0);
  assert.equal(queries.length, 0);
  assert.equal(await service.resolveOperation('mobile_operation_failure', 'realtime-connection', 'driver-a'), 2);
  assert.match(queries[0][0], /actor_id = \?/);
  assert.deepEqual(queries[0][1], [1234, 'driver-a', 'mobile_operation_failure', 'realtime-connection', 'driver-a']);
});
