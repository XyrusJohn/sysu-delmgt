const test = require('node:test');
const assert = require('node:assert/strict');
const {createDatabaseReadinessHandler} = require('./healthReadyRoute');

function response() {
  return {
    headers: {},
    statusCode: 200,
    set(name, value) {this.headers[name] = value; return this;},
    status(value) {this.statusCode = value; return this;},
    json(value) {this.body = value; return this;},
  };
}

test('central database readiness reports connected without exposing configuration', async () => {
  let probes = 0;
  const handler = createDatabaseReadinessHandler({databaseName: 'sysu_fleet_app', probe: async () => {probes++;}});
  const res = response();
  await handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {status: 'ready', database: 'connected'});
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(probes, 1);
});


test('wrong database and failed connections return a generic not-ready response', async () => {
  let probes = 0;
  const wrongDatabase = createDatabaseReadinessHandler({databaseName: 'other_schema', probe: async () => {probes++;}});
  const wrong = response();
  await wrongDatabase({}, wrong);
  assert.equal(wrong.statusCode, 503);
  assert.deepEqual(wrong.body, {status: 'not_ready', database: 'unavailable'});
  assert.equal(probes, 0);

  const disconnected = createDatabaseReadinessHandler({databaseName: 'sysu_fleet_app', probe: async () => {
    throw new Error('synthetic-private-db-detail');
  }});
  const failed = response();
  await disconnected({}, failed);
  assert.equal(failed.statusCode, 503);
  assert.equal(JSON.stringify(failed.body).includes('synthetic-private-db-detail'), false);
});

test('database readiness times out without overlapping probes', async () => {
  let probes = 0;
  const handler = createDatabaseReadinessHandler({databaseName: 'sysu_fleet_app', timeoutMs: 1,
    probe: () => {probes++; return new Promise(() => {});}});
  const results = await Promise.all([response(), response()].map(res => handler({}, res).then(() => res)));
  assert.deepEqual(results.map(res => res.statusCode), [503, 503]);
  assert.equal(probes, 1);
});
