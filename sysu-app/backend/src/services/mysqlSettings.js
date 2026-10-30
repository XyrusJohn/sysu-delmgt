function parse(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function createMysqlSettings({ pool, now = () => Date.now() }) {
  if (!pool?.execute) throw new TypeError("A MySQL pool is required");

  return Object.freeze({
    async get(key, fallback) {
      const [rows] = await pool.execute(
        "SELECT setting_data, updated_by, updated_at_ms FROM app_settings WHERE setting_key = ? LIMIT 1",
        [key],
      );
      const row = rows[0];
      return row
        ? {
            ...parse(row.setting_data),
            id: key,
            updatedByUid: row.updated_by,
            updatedAt: new Date(Number(row.updated_at_ms)).toISOString(),
          }
        : { ...fallback };
    },
    async set(key, value, updatedByUid) {
      const updatedAt = now();
      await pool.execute(
        `INSERT INTO app_settings (setting_key, setting_data, updated_by, updated_at_ms)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE setting_data = VALUES(setting_data), updated_by = VALUES(updated_by), updated_at_ms = VALUES(updated_at_ms)`,
        [key, JSON.stringify(value), updatedByUid || null, updatedAt],
      );
      return {
        ...value,
        id: key,
        updatedByUid: updatedByUid || null,
        updatedAt: new Date(updatedAt).toISOString(),
      };
    },
  });
}

let singleton;
function getMysqlSettings() {
  if (!singleton)
    singleton = createMysqlSettings({
      pool: require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}

module.exports = { createMysqlSettings, getMysqlSettings };
