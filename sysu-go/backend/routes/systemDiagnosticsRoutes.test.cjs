const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const {createSystemDiagnosticsRouter} = require('./systemDiagnosticsRoutes');

async function withServer(role, run) {
  const app = express();
  app.use(express.json({limit: '10kb'}));
  const savedRuns = [];
  const emitted = [];
  app.set('io', {to: room => ({emit: (event, payload) => emitted.push({room, event, payload})})});
  app.use('/api/system-errors', createSystemDiagnosticsRouter({
    authenticate: (req, _res, next) => {
      req.user = {uid: 'driver-a'};
      req.userProfile = {role};
      req.requestId = 'request-12345678';
      next();
    },
    service: {record: async value => ({id: '9', ...value}),
      recordDiagnosticRun: async value => {savedRuns.push(value); return {id: '10'};},
      resolveOperation: async (_eventCode, operation) => operation === 'realtime-connection' ? 1 : 0},
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/system-errors`, savedRuns, emitted); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('authenticated mobile reporters can submit allowlisted diagnostic metadata', async () => {
  await withServer('driver', async base => {
    const response = await fetch(`${base}/report`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({eventCode: 'mobile_operation_failure', operation: 'pod-save', errorName: 'IOException',
        details: {stage: 'save', sourceFrame: 'PodApiService.save:84', secret: 'excluded'}})});
    assert.equal(response.status, 202);
  });
});

test('authenticated mobile reporters can auto-resolve only their own successful operation', async () => {
  await withServer('driver', async base => {
    const response = await fetch(`${base}/recover-operation`, {method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({eventCode: 'mobile_operation_failure', operation: 'realtime-connection'})});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {success: true, resolved: 1});
  });
  await withServer('qr_generator', async base => {
    const response = await fetch(`${base}/recover-operation`, {method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({eventCode: 'mobile_operation_failure', operation: 'realtime-connection'})});
    assert.equal(response.status, 403);
  });
  await withServer('driver', async base => {
    const response = await fetch(`${base}/recover-operation`, {method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({eventCode: 'mobile_operation_failure', operation: 'not-allowed'})});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {success: true, resolved: 0});
  });
});

test('diagnostic ingestion rejects unapproved roles and malformed fields', async () => {
  await withServer('qr_generator', async base => {
    const response = await fetch(`${base}/report`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({eventCode: 'mobile_operation_failure', operation: 'pod-save'})});
    assert.equal(response.status, 403);
  });
  await withServer('driver', async base => {
    const response = await fetch(`${base}/report`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({eventCode: 'mobile_operation_failure', operation: 'Bad Operation'})});
    assert.equal(response.status, 400);
  });
});

test('mobile diagnostic run requires the complete bounded allowlist and derives account identity from auth', async () => {
  const checks = [
    {name: 'network', status: 'pass', durationMs: 0, state: 'wifi'},
    {name: 'sysu-go-api', status: 'pass', durationMs: 17, httpStatus: 200},
    {name: 'sysu-go-database', status: 'pass', durationMs: 9, httpStatus: 200},
    {name: 'sysu-go-socket', status: 'warning', durationMs: 0, state: 'disconnected'},
    {name: 'session-token', status: 'pass', durationMs: 0, state: 'present'},
  ];
  await withServer('driver', async (base, savedRuns) => {
    const response = await fetch(`${base}/diagnostic-runs`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({runId: '123e4567-e89b-12d3-a456-426614174000', appVersion: '1.2.3', checks,
        actorId: 'attacker', gps: {lat: 1, lng: 2}})});
    assert.equal(response.status, 400);
    assert.equal(savedRuns.length, 0);
  });
  await withServer('driver', async (base, savedRuns, emitted) => {
    const response = await fetch(`${base}/diagnostic-runs`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({runId: '123e4567-e89b-12d3-a456-426614174000', appVersion: '1.2.3', checks})});
    assert.equal(response.status, 202);
    assert.equal(savedRuns[0].actorId, 'driver-a');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].room, 'staff:system-diagnostics');
    assert.equal(emitted[0].event, 'mobile_diagnostic_run_created');
    assert.deepEqual({...emitted[0].payload, createdAt: undefined}, {
      actorId: 'driver-a', runId: '123e4567-e89b-12d3-a456-426614174000',
      needsAttention: true, createdAt: undefined,
    });
    assert.equal(Number.isFinite(emitted[0].payload.createdAt), true);
  });
});
