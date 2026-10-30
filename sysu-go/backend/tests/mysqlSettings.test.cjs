const test = require('node:test');
const assert = require('node:assert/strict');
const {createMysqlSettings, DEFAULT_WAREHOUSE} = require('../services/mysqlSettings');

test('warehouse settings return SQL JSON when present and shared defaults when absent', async () => {
  const pool = {execute: async () => [[{setting_data: JSON.stringify({name: 'Depot', lat: 15})}]]};
  assert.deepEqual(await createMysqlSettings({pool}).getWarehouseBase(), {...DEFAULT_WAREHOUSE, name: 'Depot', lat: 15});
  assert.deepEqual(await createMysqlSettings({pool: {execute: async () => [[]]}}).getWarehouseBase(), {...DEFAULT_WAREHOUSE});
});
