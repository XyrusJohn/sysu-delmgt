const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlSettings} = require('./mysqlSettings');

test('MySQL settings read the stored JSON or a copy of the fallback', async () => {
    const pool = {execute: async (_sql, [key]) => [key === 'saved' ? [{setting_data: '{"lat":12}', updated_by: 'actor', updated_at_ms: 1000}] : []]};
    const settings = createMysqlSettings({pool});
    assert.deepEqual(await settings.get('saved', {}), {lat: 12, id: 'saved', updatedByUid: 'actor', updatedAt: new Date(1000).toISOString()});
    const fallback = {lat: 14};
    assert.deepEqual(await settings.get('missing', fallback), fallback);
    assert.notEqual(await settings.get('missing', fallback), fallback);
});

test('MySQL settings writes parameterized JSON and projects the stored value', async () => {
    let call;
    const settings = createMysqlSettings({pool: {execute: async (...args) => {call = args; return [{affectedRows: 1}];}}, now: () => 1234});
    const result = await settings.set('warehouse_base', {lat: 14}, 'actor-1');
    assert.match(call[0], /ON DUPLICATE KEY UPDATE/);
    assert.deepEqual(call[1], ['warehouse_base', '{"lat":14}', 'actor-1', 1234]);
    assert.deepEqual(result, {lat: 14, id: 'warehouse_base', updatedByUid: 'actor-1', updatedAt: new Date(1234).toISOString()});
});
