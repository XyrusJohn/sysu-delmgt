const test = require('node:test');
const assert = require('node:assert/strict');
const servicePath = require.resolve('../../services/mysqlTripService');
const originalService = require.cache[servicePath];
let service;
require.cache[servicePath] = {id: servicePath, filename: servicePath, loaded: true,
  exports: {getMysqlTripService: () => service}};
const {registerTrip} = require('../../controller/tripController');

function request(body = {}) {
  const response = {code: 200, status(code) {this.code = code; return this;}, json(value) {this.body = value; return this;}};
  return {req: {user: {uid: 'driver-a'}, body: {queueId: 'queue-a', helperFN: 'Juan', helperMI: 'M',
    helperLN: 'Cruz', company: 'Company', truckType: 'auv', platePrefix: 'abc', plateSuffix: '123', ...body},
    app: {get: () => null}}, res: response};
}

test.beforeEach(() => {service = {register: async input => ({queueId: input.queueId, registrationComplete: true,
  helper: 'Juan M. Cruz', plateNumber: input.plateNumber})};});
test.after(() => {
  if (originalService) require.cache[servicePath] = originalService;
  else delete require.cache[servicePath];
});

test('valid trip registration is scoped to the authenticated driver and normalized before SQL write', async () => {
  let saved;
  service.register = async input => {saved = input; return {queueId: input.queueId, registrationComplete: true};};
  const {req, res} = request();
  await registerTrip(req, res);
  assert.equal(res.code, 200);
  assert.equal(saved.driverId, 'driver-a');
  assert.equal(saved.truckType, 'AUV');
  assert.equal(saved.plateNumber, 'ABC-123');
  assert.equal(saved.helperMI, 'M');
});

test('malformed and cross-driver trip registrations fail before the SQL transaction', async () => {
  let calls = 0;
  service.register = async () => {calls++;};
  for (const body of [{truckType: []}, {queueId: '../another'}, {driverId: 'driver-b'}]) {
    const {req, res} = request(body);
    await registerTrip(req, res);
    assert.ok([400, 403].includes(res.code));
  }
  assert.equal(calls, 0);
});

test('SQL ownership and transition failures retain safe status responses', async () => {
  for (const [status, expected] of [[403, 403], [404, 404], [409, 409]]) {
    service.register = async () => {throw Object.assign(Error('private database detail'), {status});};
    const {req, res} = request();
    await registerTrip(req, res);
    assert.equal(res.code, expected);
    assert.doesNotMatch(JSON.stringify(res.body), /private database detail/);
  }
  service.register = async () => {throw Error('private database detail');};
  const {req, res} = request();
  await registerTrip(req, res);
  assert.equal(res.code, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /private database detail/);
});
