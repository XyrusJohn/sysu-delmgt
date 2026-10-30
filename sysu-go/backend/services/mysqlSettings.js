const DEFAULT_WAREHOUSE = Object.freeze({
  name: "SYSU Main Warehouse",
  address: "SYSU International, Quezon City, Metro Manila",
  lat: 14.6349,
  lng: 121.0392,
  radiusMeters: 500,
});

function createMysqlSettings({pool}) {
  if (!pool?.execute) throw new TypeError("A MySQL pool is required");
  return Object.freeze({
    async getWarehouseBase() {
      const [rows] = await pool.execute(
        "SELECT setting_data FROM app_settings WHERE setting_key = 'warehouse_base' LIMIT 1");
      if (!rows[0]) return {...DEFAULT_WAREHOUSE};
      const data = typeof rows[0].setting_data === "string"
        ? JSON.parse(rows[0].setting_data) : rows[0].setting_data;
      return {...DEFAULT_WAREHOUSE, ...data};
    },
  });
}

module.exports = {createMysqlSettings, DEFAULT_WAREHOUSE};
