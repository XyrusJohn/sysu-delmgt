const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const {createRequire} = require('node:module');
const serverPath = require.resolve('../../src/server');
const actualRequire = createRequire(serverPath);
let probe = async () => ({}), app;
const fakeIo = {of: () => ({on() {}}), use() {}, on() {}};
function boot() {
  const source = fs.readFileSync(serverPath, 'utf8');
  vm.runInNewContext(source, {require(name) {
    if (name === './config/mysql') return {
      createMySqlPool: () => ({query: (...args) => probe(...args)}),
      loadMySqlConfig: () => ({database: 'sysu_fleet_app'}),
    };
    if (name === './services/mysqlAuthSingleton') return {getMysqlAuthService: () => ({})};
    if (name === './routes/mysqlAuthRoute') return {createMysqlAuthRouter: () => express.Router()};
    if (name === 'socket.io') return {Server: class {constructor() {return fakeIo;}}};
    if (name === 'http') return {createServer(value) {app = value; return {listen() {}};}};
    if (name === 'dotenv') return {config() {}};
    if (name.startsWith('./routes/') && !name.includes('healthRoute')) return express.Router();
    if (name.startsWith('./utils/')) return {};
    return actualRequire(name);
  }, __dirname: require('node:path').dirname(serverPath), process: {env: {NODE_ENV: 'test', AUTH_BACKEND: 'mysql', PORT: '8080', ALLOWED_ORIGINS: 'http://localhost:5173',
    RELEASE_VERSION: 'synthetic-release', READINESS_TIMEOUT_MS: '100'}}, global: {}, console,
    setTimeout, clearTimeout});
}
async function request(path, origin) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: origin ? {Origin: origin} : {},
  });
    const body = await response.text();
    return {status: response.status, body: response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(body) : {message: body}, cache: response.headers.get('cache-control'),
      allowOrigin: response.headers.get('access-control-allow-origin')};}
  finally {await new Promise(resolve => server.close(resolve));}
}
test.before(() => boot());
test('R18 liveness exposes release version without a dependency request', async () => {
  let calls = 0; probe = async () => {calls++; return {};};
  const response = await request('/health/live');
  assert.equal(response.status, 200);
  assert.equal(response.body.version, 'synthetic-release');
  assert.equal(response.cache, 'no-store');
  assert.equal(calls, 0);
});
test('R18 readiness fails safely on dependency failure and recovers', async () => {
  probe = async () => {throw new Error('SYNTHETIC-PRIVATE-CREDENTIAL');};
  const failure = await request('/health/ready');
  assert.equal(failure.status, 503);
  assert.equal(JSON.stringify(failure.body).includes('SYNTHETIC-PRIVATE-CREDENTIAL'), false);
  probe = async () => ({});
  assert.equal((await request('/health/ready')).status, 200);
});
test('readiness verifies the diagnostics and idempotency tables required by API writes', async () => {
  let query;
  probe = async (sql) => {query = sql; return [{}];};
  assert.equal((await request('/health/ready')).status, 200);
  assert.match(query, /app_api_idempotency/);
  assert.match(query, /app_system_error_logs/);
});
test('R18 readiness is readable by an allowlisted browser origin', async () => {
  probe = async () => ({});
  const response = await request('/health/ready', 'http://localhost:5173');
  assert.equal(response.status, 200);
  assert.equal(response.allowOrigin, 'http://localhost:5173');
});
test('R18 readiness still rejects an unapproved browser origin', async () => {
  const response = await request('/health/ready', 'https://unapproved.example');
  assert.equal(response.status, 403);
  assert.equal(response.allowOrigin, null);
});
test('R18 hung probes time out and overlapping readiness checks coalesce', async () => {
  let finish, calls = 0;
  probe = () => {calls++; return new Promise(resolve => {finish = resolve;});};
  const results = await Promise.all([request('/health/ready'), request('/health/ready')]);
  assert.deepEqual(results.map(result => result.status), [503, 503]);
  assert.equal(calls, 1);
  finish({});
  await new Promise(resolve => setImmediate(resolve));
  probe = async () => ({});
  assert.equal((await request('/health/ready')).status, 200);
});
