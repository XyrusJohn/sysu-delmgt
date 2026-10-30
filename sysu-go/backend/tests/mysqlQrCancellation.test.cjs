const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlQrService} = require('../services/mysqlQrService');

function serviceWith({row = {id: 'queue-a', driver_id: 'driver-a', status: 'waiting', is_assigned: 0}, assignments = []} = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
    async execute(sql, params) {
      calls.push({sql, params});
      if (sql.includes('FROM app_queue_entries') && sql.includes('FOR UPDATE')) return [[row].filter(Boolean)];
      if (sql.includes('FROM app_sap_assignments')) return [assignments];
      if (sql.includes("SET status = 'cancelled'")) return [{affectedRows: 1}];
      throw new Error('Unexpected SQL: ' + sql);
    },
  };
  const pool = {getConnection: async () => connection, execute: async () => { throw new Error('Unexpected pool query'); }};
  return {service: createMysqlQrService({pool}), calls, committed: () => committed, rolledBack: () => rolledBack};
}

test('queue cancellation locks own waiting row and changes status without deleting history', async () => {
  const fixture = serviceWith();
  assert.deepEqual(await fixture.service.cancelOwn({queueId: 'queue-a', driverId: 'driver-a'}),
    {queueId: 'queue-a', status: 'cancelled'});
  assert.equal(fixture.committed(), true);
  assert.equal(fixture.rolledBack(), false);
  assert.match(fixture.calls[1].sql, /FOR UPDATE/);
  assert.ok(fixture.calls.some(call => typeof call === 'object' && call.sql.includes('app_sap_assignments')));
  assert.ok(fixture.calls.some(call => typeof call === 'object' && call.sql.includes("SET status = 'cancelled'")));
  assert.ok(fixture.calls.every(call => typeof call !== 'object' || !/^\s*DELETE/i.test(call.sql)));
});

test('queue cancellation hides entries owned by another driver', async () => {
  const fixture = serviceWith({row: {id: 'queue-a', driver_id: 'driver-b', status: 'waiting', is_assigned: 0}});
  await assert.rejects(fixture.service.cancelOwn({queueId: 'queue-a', driverId: 'driver-a'}), {status: 404});
  assert.equal(fixture.rolledBack(), true);
  assert.equal(fixture.calls.some(call => typeof call === 'object' && call.sql.includes('app_sap_assignments')), false);
});

test('queue cancellation rejects called, assigned, or linked queue entries', async t => {
  for (const options of [
    {row: {id: 'queue-a', driver_id: 'driver-a', status: 'called', is_assigned: 0}},
    {row: {id: 'queue-a', driver_id: 'driver-a', status: 'waiting', is_assigned: 1}},
    {assignments: [{dispatch_key: 'shipment-a'}]},
  ]) {
    await t.test(JSON.stringify(options), async () => {
      const fixture = serviceWith(options);
      await assert.rejects(fixture.service.cancelOwn({queueId: 'queue-a', driverId: 'driver-a'}), {status: 409});
      assert.equal(fixture.rolledBack(), true);
      assert.equal(fixture.calls.some(call => typeof call === 'object' && call.sql.includes("SET status = 'cancelled'")), false);
    });
  }
});
