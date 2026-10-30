const test = require('node:test');
const assert = require('node:assert/strict');
const {z} = require('zod');

let expired = false;
let writes = [];
const service = {
  async generate(ttl) { writes.push(['generate', ttl]); return {token: 'SYS-SYNTHETIC'}; },
  async verify(token) {
    writes.push(['verify', token]);
    if (expired) throw Object.assign(new Error('QR token expired or already used'), {status: 410});
    return {token};
  },
  async scan(input) { writes.push(['scan', input]); return {queueId: 'queue-1'}; },
  async updateStatus(...args) { writes.push(['updateStatus', ...args]); },
  async listQueue() { return [{id: 'q1', truckType: '4W', status: 'waiting', registrationComplete: true,
    driverName: 'Private driver', plateNumber: 'TEST-1', token: 'PRIVATE-TOKEN'}]; },
};
const servicePath = require.resolve('../../src/services/mysqlQrService');
require.cache[servicePath] = {id: servicePath, filename: servicePath, loaded: true,
  exports: {getMysqlQrService: () => service}};
const qr = require('../../src/controllers/qrController');
const {errorHandler} = require('../../src/middleware/errorHandler');
const events = [];
global._qrNs = {emit: (event, data) => events.push({event, data})};

function invoke(handler, req = {}) {
  return new Promise((resolve, reject) => {
    const res = {statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({status: this.statusCode, body}); }};
    handler(req, res, reject);
  });
}

test.beforeEach(() => { writes = []; expired = false; events.length = 0; });
test.after(() => { delete global._qrNs; delete require.cache[servicePath]; });

test('R11 public QR verification does not consume or mutate the token', async () => {
  const response = await invoke(qr.verifyToken, {query: {token: 'SYS-SYNTHETIC'}});
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [['verify', 'SYS-SYNTHETIC']]);
});

test('R11 expired QR verification returns the service status', async () => {
  expired = true;
  const response = await invoke(qr.verifyToken, {query: {token: 'SYS-SYNTHETIC'}});
  assert.equal(response.status, 410);
  assert.equal(response.body.success, false);
});

test('R11 unauthenticated or mismatched scan does not reach MySQL', async () => {
  const body = {token: 'SYS-SYNTHETIC', driverId: 'driver-b', truckType: '4W', plateNumber: 'TEST'};
  const mismatch = await invoke(qr.scanToken, {user: {uid: 'driver-a'}, userData: {role: 'driver', status: 'active'}, body});
  assert.equal(mismatch.status, 403);
  const inactive = await invoke(qr.scanToken, {user: {uid: 'driver-b'}, userData: {role: 'pending', status: 'inactive'}, body});
  assert.equal(inactive.status, 403);
  assert.deepEqual(writes, []);
});

test('R11 active driver scan persists through MySQL and emits token-used only after success', async () => {
  const body = {token: 'SYS-SYNTHETIC', driverId: 'driver-a', driverName: 'Driver A', truckType: '4W', plateNumber: 'TEST', truckCompany: 'Company'};
  const response = await invoke(qr.scanToken, {user: {uid: 'driver-a'}, userData: {role: 'driver', status: 'active'}, body});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {success: true, message: 'Successfully joined the queue', queueId: 'queue-1'});
  assert.equal(writes[0][0], 'scan');
  assert.deepEqual(events, [{event: 'qr_token_used', data: {token: 'SYS-SYNTHETIC'}}]);
});

test('R11 public QR generation and queue-status updates use MySQL services', async () => {
  const generated = await invoke(qr.generateToken);
  assert.deepEqual(generated.body, {success: true, token: 'SYS-SYNTHETIC'});
  const updated = await invoke(qr.updateQueueStatus, {body: {queueId: 'queue-1', status: 'loading'}});
  assert.equal(updated.status, 200);
  assert.deepEqual(writes.map(([name]) => name), ['generate', 'updateStatus']);
});

test('R21 validation errors are client errors', async () => {
  const error = z.string().safeParse(1).error;
  const response = await invoke((req, res) => errorHandler(error, req, res), {});
  assert.equal(response.status, 400);
});

test('R21 production server error does not expose internal paths', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = await invoke((req, res) => errorHandler(new Error('private internal SAP password path'), req, res), {});
    assert.equal(response.body.error, 'Internal Server Error');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('R27 error logs exclude exception secrets and correlate the response', async () => {
  const logs = [];
  const prior = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  let response;
  try { response = await invoke((req, res) => errorHandler(new Error('SYNTHETIC-PRIVATE-TOKEN'), req, res), {}); }
  finally { console.error = prior; }
  assert.equal(logs.join('\n').includes('SYNTHETIC-PRIVATE-TOKEN'), false);
  assert.match(response.body.requestId, /^[a-f0-9-]{36}$/);
  assert.ok(logs.join('\n').includes(response.body.requestId));
});

test('R02 public kiosk projection omits queue identity and token data', async () => {
  const response = await invoke(qr.getPublicQueue);
  assert.deepEqual(response.body.data.queues['4W'], [{position: 1}]);
  const payload = JSON.stringify(response.body);
  assert.equal(payload.includes('Private driver'), false);
  assert.equal(payload.includes('PRIVATE-TOKEN'), false);
});
