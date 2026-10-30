const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlDriverProfiles} = require('../services/mysqlDriverProfiles');
const {isValidRegistrationProfile} = require('../routes/driverStatusRoutes');

test('registration profile API accepts only bounded fields and boolean requirements', () => {
  const valid = {queueId: 'queue-a', name: 'River Driver', truckType: '6W', plateNumber: 'ABC-1234',
    truckingCompany: 'Example Haulers', helper: 'Sam Helper', requirements: {safetyShoes: true}};
  assert.equal(isValidRegistrationProfile(valid), true);
  for (const invalid of [
    {...valid, driverId: 'driver-b'},
    {...valid, queueId: '../foreign'},
    {...valid, truckType: 'spaceship'},
    {...valid, requirements: {safetyShoes: 'yes'}},
    {...valid, requirements: {'bad key': true}},
    {...valid, name: 'x'.repeat(101)},
  ]) assert.equal(isValidRegistrationProfile(invalid), false);
});

function fixture() {
  const state = {
    user: {public_id: 'driver-a', display_name: 'Old Name', username: 'drivera', role: 'driver', status: 'active'},
    queue: {id: 'queue-a', driver_id: 'driver-a', status: 'waiting', registration_complete: false, is_assigned: false,
      driver_name: '', truck_type: '', plate_number: '', truck_company: '', helper_name: ''},
    profile: null,
    commits: 0,
    rollbacks: 0,
  };
  async function execute(sql, values = []) {
    if (sql.includes('FROM app_auth_users') && sql.includes('FOR UPDATE')) {
      const [driverId] = values;
      return [state.user.public_id === driverId && state.user.role === 'driver' && state.user.status === 'active'
        ? [{public_id: driverId}] : [], []];
    }
    if (sql.includes('FROM app_queue_entries') && sql.includes('FOR UPDATE')) {
      const [queueId, driverId] = values;
      const queue = state.queue;
      return [queue.id === queueId && queue.driver_id === driverId && ['waiting', 'called'].includes(queue.status)
        && !queue.registration_complete && !queue.is_assigned ? [{id: queueId}] : [], []];
    }
    if (sql.includes('INSERT INTO app_driver_profiles')) {
      const [driverId, name, truckType, plateNumber, truckingCompany, helper, requirements] = values;
      state.profile = {driver_id: driverId, name, truck_type: truckType, plate_number: plateNumber,
        trucking_company: truckingCompany, helper, requirements};
      return [{affectedRows: 1}, []];
    }
    if (sql.includes('UPDATE app_queue_entries SET driver_name')) {
      const [name, truckType, plateNumber, truckingCompany, helper, queueId, driverId] = values;
      if (state.queue.id === queueId && state.queue.driver_id === driverId) {
        Object.assign(state.queue, {driver_name: name, truck_type: truckType, plate_number: plateNumber,
          truck_company: truckingCompany, helper_name: helper});
      }
      return [{affectedRows: 1}, []];
    }
    if (sql.includes('LEFT JOIN app_driver_profiles')) {
      const row = state.profile;
      return [[{...state.user, ...(row || {}), driver_id: 'driver-a', account_status: 'active',
        requirements: row?.requirements || '{}', status: row?.status || 'offline'}], []];
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  }
  const pool = {
    execute,
    async getConnection() {
      return {
        execute,
        async beginTransaction() {},
        async commit() { state.commits += 1; },
        async rollback() { state.rollbacks += 1; },
        release() {},
        destroy() {},
      };
    },
  };
  return {state, profiles: createMysqlDriverProfiles({pool})};
}

test('profile registration update persists driver profile and owned incomplete queue fields atomically', async () => {
  const {state, profiles} = fixture();
  const result = await profiles.updateRegistration({
    driverId: 'driver-a', queueId: 'queue-a', name: 'River Driver', truckType: '6W', plateNumber: 'ABC-1234',
    truckingCompany: 'Example Haulers', helper: 'Sam Helper', requirements: {safetyShoes: true},
  });
  assert.equal(result.name, 'River Driver');
  assert.equal(result.requirements.safetyShoes, true);
  assert.equal(state.queue.driver_name, 'River Driver');
  assert.equal(state.queue.truck_type, '6W');
  assert.equal(state.queue.plate_number, 'ABC-1234');
  assert.equal(state.queue.truck_company, 'Example Haulers');
  assert.equal(state.queue.helper_name, 'Sam Helper');
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 0);
});

test('profile registration update rejects foreign or closed queue ids without writing', async () => {
  const {state, profiles} = fixture();
  assert.equal(await profiles.updateRegistration({
    driverId: 'driver-b', queueId: 'queue-a', name: 'Forged', truckType: '6W', plateNumber: 'ABC-1234',
    truckingCompany: 'Example Haulers', helper: '', requirements: {},
  }), null);
  assert.equal(state.profile, null);
  assert.equal(state.queue.driver_name, '');
  assert.equal(state.rollbacks, 1);

  state.queue.registration_complete = true;
  assert.equal(await profiles.updateRegistration({
    driverId: 'driver-a', queueId: 'queue-a', name: 'River Driver', truckType: '6W', plateNumber: 'ABC-1234',
    truckingCompany: 'Example Haulers', helper: '', requirements: {},
  }), null);
  assert.equal(state.profile, null);
  assert.equal(state.rollbacks, 2);
});
