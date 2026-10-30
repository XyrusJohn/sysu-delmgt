const test = require('node:test');
const assert = require('node:assert/strict');

let records;
const servicePath = require.resolve('../../src/services/mysqlQrService');
require.cache[servicePath] = {id: servicePath, filename: servicePath, loaded: true,
  exports: {getMysqlQrService: () => ({listQueue: async () => records
    .filter(row => row.registrationComplete && ['waiting', 'called'].includes(row.status))
    .sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id))})}};
const qr = require('../../src/controllers/qrController');

function invoke(handler, req = {}) {
  return new Promise((resolve, reject) => {
    const response = {headers: {}, statusCode: 200, status(code) { this.statusCode = code; return this; },
      set(name, value) { this.headers[name] = value; return this; }, json(body) { resolve({status: this.statusCode, body, headers: this.headers}); }};
    handler(req, response, reject);
  });
}

test.beforeEach(() => {
  records = [
    {id: 'unfinished', status: 'waiting', registrationComplete: false, truckType: '4W', entryTime: 1},
    {id: 'called', status: 'called', registrationComplete: true, truckType: '4w', entryTime: 2, driverName: 'Called Driver', plateNumber: 'TEST-1'},
    {id: 'waiting', status: 'waiting', registrationComplete: true, truckType: '4W', entryTime: 3,
      driverName: '<img onerror=alert(1)>', plateNumber: 'TEST-2', token: 'PRIVATE-TOKEN', driverPhone: 'PRIVATE-PHONE'},
    {id: 'assigned', status: 'waiting', registrationComplete: true, isAssigned: true, truckType: '4W', entryTime: 4},
    {id: 'finished', status: 'completed', registrationComplete: true, truckType: '4W', entryTime: 0},
    {id: 'private-type', status: 'waiting', registrationComplete: true, truckType: 'UNKNOWN', entryTime: 5},
  ];
});
test.after(() => { delete require.cache[servicePath]; });

test('R02 public kiosk reveals positions only for registered unassigned queue entries', async () => {
  const response = await invoke(qr.getPublicQueue);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.queues['4W'], [{position: 1}, {position: 2}]);
  const json = JSON.stringify(response.body);
  for (const value of ['Called Driver', 'PRIVATE-TOKEN', 'PRIVATE-PHONE', 'private-type']) assert.equal(json.includes(value), false);
});

test('queue cards require an explicitly active user and return only public truck categories', async () => {
  const missing = await invoke(qr.getQueueCards, {userData: null});
  assert.equal(missing.status, 403);
  const inactive = await invoke(qr.getQueueCards, {userData: {role: 'admin', status: 'inactive'}});
  assert.equal(inactive.status, 403);
  const response = await invoke(qr.getQueueCards, {userData: {role: 'admin', status: 'active'}});
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body.data.queues['4W'].map(row => [row.driverName, row.position]), [
    ['Called Driver', 1], ['<img onerror=alert(1)>', 2],
  ]);
  assert.equal(JSON.stringify(response.body).includes('PRIVATE-TOKEN'), false);
});

test('public queue reports truncation when the MySQL projection exceeds the public limit', async () => {
  records = Array.from({length: 101}, (_, index) => ({id: `q-${index}`, status: 'waiting', truckType: 'AUV',
    driverName: `Driver ${index}`, plateNumber: `P${index}`, registrationComplete: true}));
  const response = await invoke(qr.getQueueCards, {userData: {role: 'qr_generator', status: 'active'}});
  assert.equal(response.body.data.queues.AUV.length, 100);
  assert.equal(response.body.data.truncated, true);
});
