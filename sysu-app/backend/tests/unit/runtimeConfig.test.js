const test = require('node:test');
const assert = require('node:assert/strict');
const {loadRuntimeConfig} = require('../../src/config/runtime');

function load(overrides = {}) {
  return loadRuntimeConfig({TRUST_PROXY: '0', NODE_ENV: 'development',
    ALLOWED_ORIGINS: 'http://localhost:5173', ...overrides});
}

test('local backend defaults to port 3000', () => {
  assert.equal(load().port, 3000);
});

test('R19 malformed ports fail startup instead of silently changing the destination', () => {
  for (const PORT of ['abc', '8080x', '-1', '1.5']) assert.throws(() => load({PORT}), /PORT/i);
});
test('R19 ports must be in the valid TCP range', () => {
  for (const PORT of ['0', '65536', '99999999999999999']) assert.throws(() => load({PORT}), /PORT/i);
  assert.equal(load({PORT: '3030'}).port, 3030);
});
test('R19 explicit trusted proxy addresses retain their IP/CIDR semantics', () => {
  assert.equal(load({TRUST_PROXY: '10.0.0.1'}).trustProxy, '10.0.0.1');
  assert.equal(load({TRUST_PROXY: '10.0.0.0/24'}).trustProxy, '10.0.0.0/24');
  assert.equal(load({TRUST_PROXY: '1'}).trustProxy, 1);
});
test('R19 invalid proxy settings fail rather than changing security semantics', () => {
  for (const TRUST_PROXY of ['true', '999.1.1.1', '10.0.0.1/99', '-1']) assert.throws(() => load({TRUST_PROXY}), /TRUST_PROXY/i);
});
test('R20 explicit origins and rate overrides are consumed by startup config', () => {
  const config = load({ALLOWED_ORIGINS: 'https://staging.example.invalid', RATE_LIMIT_MAX: '1234'});
  assert.deepEqual(config.allowedOrigins, ['https://staging.example.invalid']);
  assert.equal(config.globalLimit, 1234);
});
test('R20 production cannot accidentally allow local development origins', () => {
  assert.throws(() => load({NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://localhost:5173'}), /origin/i);
});
test('R20 origins are exact origins and limits are bounded positive integers', () => {
  assert.throws(() => load({ALLOWED_ORIGINS: 'https://example.invalid/private'}), /origin/i);
  for (const RATE_LIMIT_MAX of ['0', '-1', 'foo', '1.5']) assert.throws(() => load({RATE_LIMIT_MAX}), /RATE_LIMIT_MAX/i);
});
