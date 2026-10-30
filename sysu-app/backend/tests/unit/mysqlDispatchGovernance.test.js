const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlDispatchGovernance} = require('../../src/services/mysqlDispatchGovernance');

function setup(token, now = 1000) {
  const calls = [];
  const connection = {execute: async (sql, values) => {
    calls.push({sql, values});
    if (sql.startsWith('SELECT * FROM app_override_tokens')) return [[token].filter(Boolean)];
    return [{affectedRows: 1}];
  }};
  const pool = {getConnection: async () => connection, execute: async () => [[]]};
  return {service: createMysqlDispatchGovernance({pool, now: () => now}), calls};
}

test('MySQL override token consumption validates binding and records the actor', async () => {
  const token = {token_id: 't1', dispatch_key: 'd1', requested_driver_id: 'driver1', expires_at_ms: 2000, consumed_at_ms: null};
  const {service, calls} = setup(token);
  const result = await service.consumeToken({execute: async (sql, values) => {
    calls.push({sql, values});
    return sql.startsWith('SELECT') ? [[token]] : [{affectedRows: 1}];
  }}, 't1', {dispatchKey: 'd1', requestedDriverId: 'driver1', assignedBy: 'dispatcher'});

  assert.deepEqual(result, {ok: true});
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /UPDATE app_override_tokens/);
  assert.deepEqual(calls[1].values.slice(1), ['dispatcher', 'd1', 't1']);
});

test('MySQL override token consumption rejects expired, consumed, or mismatched tokens without a write', async () => {
  const cases = [
    {token: {expires_at_ms: 1000}, input: {dispatchKey: 'd1', requestedDriverId: 'driver1'}, code: 'TOKEN_EXPIRED'},
    {token: {expires_at_ms: 2000, consumed_at_ms: 42}, input: {dispatchKey: 'd1', requestedDriverId: 'driver1'}, code: 'TOKEN_EXPIRED'},
    {token: {expires_at_ms: 2000}, input: {dispatchKey: 'other', requestedDriverId: 'driver1'}, code: 'TOKEN_DISPATCH_MISMATCH'},
    {token: {expires_at_ms: 2000}, input: {dispatchKey: 'd1', requestedDriverId: 'other'}, code: 'TOKEN_DRIVER_MISMATCH'},
  ];
  for (const {token, input, code} of cases) {
    Object.assign(token, {token_id: 't1', dispatch_key: 'd1', requested_driver_id: 'driver1', consumed_at_ms: token.consumed_at_ms ?? null});
    const {service, calls} = setup(token);
    const result = await service.consumeToken({execute: async (sql) => {
      calls.push({sql});
      return sql.startsWith('SELECT') ? [[token]] : [{affectedRows: 1}];
    }}, 't1', {...input, assignedBy: 'dispatcher'});
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(calls.length, 1);
  }
});
