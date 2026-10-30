const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlTripService} = require('../services/mysqlTripService');

function makeService({company = 'Registered Hauling'} = {}) {
  const state = {writes: [], committed: false, rolledBack: false};
  const connection = {
    async beginTransaction() {},
    async commit() {state.committed = true;},
    async rollback() {state.rolledBack = true;},
    release() {},
    async execute(sql, params) {
      if (sql.includes('FROM app_auth_users')) {
        return [[{role: 'driver', status: 'active', trucking_company: company}], []];
      }
      if (sql.includes('FROM app_queue_entries')) {
        return [[{id: params[0], driver_id: 'driver-a', registration_complete: false,
          status: 'waiting', data: '{}'}], []];
      }
      state.writes.push({sql, params});
      return [{affectedRows: 1}, []];
    },
  };
  const pool = {async getConnection() {return connection;}};
  return {state, trips: createMysqlTripService({pool})};
}

const registration = {driverId: 'driver-a', queueId: 'queue-a', helperFN: 'Sam', helperMI: '',
  helperLN: 'Helper', company: 'Driver supplied company', truckType: 'AUV', plateNumber: 'ABC-123'};

test('trip registration stores the company from the authenticated driver profile', async () => {
  const {state, trips} = makeService();
  await trips.register(registration);
  const queueUpdate = state.writes.find(write => write.sql.includes('UPDATE app_queue_entries'));
  const profileUpdate = state.writes.find(write => write.sql.includes('INSERT INTO app_driver_profiles'));
  assert.equal(queueUpdate.params[1], 'Registered Hauling');
  assert.equal(profileUpdate.params[2], 'Registered Hauling');
  assert.equal(state.committed, true);
});

test('trip registration cannot proceed without a company set on the driver profile', async () => {
  const {state, trips} = makeService({company: ''});
  await assert.rejects(() => trips.register(registration), error => error.status === 409);
  assert.equal(state.writes.length, 0);
  assert.equal(state.rolledBack, true);
});
