const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlQrService} = require('../../services/mysqlQrService');

function service(options = {}) {
  const state = {role: 'driver', accountStatus: 'active', truckingCompany: 'Registered Hauling', used: false,
    usedBy: null, tokenQueueId: null, activeQueue: null,
    writes: [], rolledBack: false, committed: false, ...options};
  const pool = {
    async execute() {return [[], []];},
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {state.committed = true;},
        async rollback() {state.rolledBack = true; state.writes.length = 0;},
        release() {},
        async execute(sql, params) {
          if (sql.includes('FROM app_auth_users')) return [[{role: state.role, status: state.accountStatus,
            trucking_company: state.truckingCompany}], []];
          if (sql.includes('FROM app_qr_tokens')) return [[{token: params[0], used: state.used,
            used_by: state.usedBy, queue_id: state.tokenQueueId, expires_at_ms: Date.now() + 60000}], []];
          if (sql.includes('FROM app_queue_entries WHERE id = ?')) {
            return [[state.activeQueue === params[0] && params[1] === 'driver-a' ? {id: params[0]} : null].filter(Boolean), []];
          }
          if (sql.includes('FROM app_queue_entries WHERE driver_id')) return [state.activeQueue ? [{id: state.activeQueue}] : [], []];
          if (sql.includes('INSERT INTO app_queue_entries')) {
            if (state.failAt === 'queue') throw new Error('private database error');
            state.writes.push({queueId: params[0], driverId: params[1], company: params[6]});
            state.activeQueue = params[0];
            return [{affectedRows: 1}, []];
          }
          if (sql.includes('INSERT INTO app_qr_admissions')) {
            if (state.failAt === 'admission') throw new Error('private database error');
            state.writes.push({admission: params[0]});
            return [{affectedRows: 1}, []];
          }
          if (sql.includes('UPDATE app_qr_tokens')) {
            state.writes.push({tokenUsedBy: params[0]});
            state.used = true;
            state.usedBy = params[0];
            state.tokenQueueId = params[2];
            return [{affectedRows: 1}, []];
          }
          throw new Error('Unexpected SQL statement');
        },
      };
    },
  };
  return {state, qr: createMysqlQrService({pool})};
}

const input = (token = 'SYS-TEST', driverId = 'driver-a') => ({token, driverId,
  driverName: 'Synthetic Driver', truckType: 'AUV', plateNumber: 'ABC-123'});

test('SQL QR admission consumes one token and atomically creates one owned queue entry', async () => {
  const {state, qr} = service();
  const result = await qr.scan(input());
  assert.match(result.queueId, /^[0-9a-f-]{36}$/i);
  assert.equal(state.used, true);
  assert.equal(state.writes.length, 3);
  assert.equal(state.writes[0].driverId, 'driver-a');
  assert.equal(state.writes[0].company, 'Registered Hauling');
  assert.equal(state.committed, true);
  assert.equal(state.rolledBack, false);
});

test('QR admission always uses the driver profile company instead of the submitted company', async () => {
  const {state, qr} = service();
  await qr.scan({...input(), truckCompany: 'Unregistered Company'});
  assert.equal(state.writes[0].company, 'Registered Hauling');
});

test('used token and competing active queue are denied before a second admission', async () => {
  const sameToken = service({used: true});
  await assert.rejects(() => sameToken.qr.scan(input()), error => error.status === 410);
  assert.equal(sameToken.state.writes.length, 0);
  const competing = service({activeQueue: 'prior-queue'});
  await assert.rejects(() => competing.qr.scan(input('SYS-OTHER')), error => error.status === 409);
  assert.equal(competing.state.writes.length, 0);
});

test('retrying a QR admission after its response was lost returns the already-created queue', async () => {
  const {state, qr} = service({used: true, usedBy: 'driver-a', tokenQueueId: 'existing-queue', activeQueue: 'existing-queue'});
  const result = await qr.scan(input());
  assert.deepEqual(result, {queueId: 'existing-queue', replayed: true});
  assert.equal(state.writes.length, 0);
  assert.equal(state.committed, true);
});

test('QR admission requires an active driver and rolls back every write on storage failure', async () => {
  const inactive = service({accountStatus: 'disabled'});
  await assert.rejects(() => inactive.qr.scan(input()), error => error.status === 403);
  assert.equal(inactive.state.writes.length, 0);
  const failure = service({failAt: 'admission'});
  await assert.rejects(() => failure.qr.scan(input()), error => error.message === 'private database error');
  assert.equal(failure.state.rolledBack, true);
  assert.equal(failure.state.committed, false);
  assert.equal(failure.state.writes.length, 0);
});
