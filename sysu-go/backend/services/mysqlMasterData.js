function createMysqlMasterData({pool}) {
  if (!pool?.execute) throw new TypeError('A MySQL pool is required');
  return Object.freeze({
    async listGuards() {
      const [rows] = await pool.execute(
        'SELECT guard_code, first_name, middle_initial, last_name, full_name FROM app_security_guards WHERE active = TRUE ORDER BY id ASC LIMIT 2000');
      return rows.map(row => ({id: row.guard_code, guardId: row.guard_code,
        firstName: row.first_name, middleInitial: row.middle_initial, lastName: row.last_name,
        fullName: row.full_name, active: true}));
    },
    async listCompanies() {
      const [rows] = await pool.execute(
        'SELECT company_code, forwarder_code, name FROM app_truck_companies WHERE active = TRUE ORDER BY id ASC LIMIT 2000');
      return rows.map(row => ({id: row.company_code, companyCode: row.company_code,
        forwarderCode: row.forwarder_code, name: row.name, active: true}));
    },
  });
}

module.exports = {createMysqlMasterData};
