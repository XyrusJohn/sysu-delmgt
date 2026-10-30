const test = require('node:test');
const assert = require('node:assert/strict');
const {loadMySqlConfig} = require('../config/mysql');

const local = {MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '3306', MYSQL_DATABASE: 'sysu_local', MYSQL_USER: 'sysu_local'};

test('local MySQL config accepts loopback and returns immutable normalized settings', () => {
  const config = loadMySqlConfig(local);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3306);
  assert.equal(config.database, 'sysu_local');
  assert.equal(config.password, '');
  assert.equal(Object.isFrozen(config), true);
});

test('local MySQL config rejects remote hosts', () => {
  assert.throws(() => loadMySqlConfig({...local, MYSQL_HOST: 'db.example.test'}), /loopback/);
});

test('DB_* local environment variables take precedence over legacy MYSQL_* keys', () => {
  const config = loadMySqlConfig({...local, DB_HOST: 'localhost', DB_PORT: '3306', DB_NAME: 'sysu_fleet_app',
    DB_USER: 'sysu_go_local', DB_PASSWORD: 'synthetic-local-password'});
  assert.deepEqual({host: config.host, port: config.port, database: config.database, user: config.user, password: config.password},
    {host: 'localhost', port: 3306, database: 'sysu_fleet_app', user: 'sysu_go_local', password: 'synthetic-local-password'});
});

test('local MySQL config validates database identifiers, users, and ports', () => {
  assert.throws(() => loadMySqlConfig({...local, MYSQL_DATABASE: 'sysu-local; DROP DATABASE'}), /identifier/);
  assert.throws(() => loadMySqlConfig({...local, MYSQL_USER: ' '}), /MYSQL_USER/);
  for (const MYSQL_PORT of ['0', '65536', '3306x']) {
    assert.throws(() => loadMySqlConfig({...local, MYSQL_PORT}), /MYSQL_PORT/);
  }
});
