const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const {createApiRateLimiter, loadApiRateLimitConfig, loadTrustedProxy} = require('../config/runtimeSecurity');

test('rate-limit configuration validates bounds and defaults conservatively', () => {
  assert.deepEqual(loadApiRateLimitConfig({}), {windowMs: 900000, max: 1200});
  assert.throws(() => loadApiRateLimitConfig({API_RATE_LIMIT_MAX: '0'}), /out of range/);
  assert.throws(() => loadApiRateLimitConfig({API_RATE_LIMIT_WINDOW_MS: 'not-a-number'}), /positive integer/);
});

test('proxy trust accepts only bounded hops or explicit IP ranges', () => {
  assert.equal(loadTrustedProxy('0'), 0);
  assert.equal(loadTrustedProxy('2'), 2);
  assert.equal(loadTrustedProxy('10.0.0.0/8'), '10.0.0.0/8');
  assert.throws(() => loadTrustedProxy('true'), /TRUST_PROXY/);
  assert.throws(() => loadTrustedProxy('17'), /TRUST_PROXY/);
});

test('global API limiter returns 429 after its request budget is exhausted', async t => {
  const app = express();
  app.use('/api', createApiRateLimiter({windowMs: 60000, max: 2}));
  app.get('/api/health', (_req, res) => res.json({success: true}));
  app.get('/api/example', (_req, res) => res.json({success: true}));
  app.get('/status', (_req, res) => res.json({success: true}));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/example`)).status, 200);
  const limited = await fetch(`${origin}/api/example`);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
  assert.equal((await fetch(`${origin}/status`)).status, 200);
});
