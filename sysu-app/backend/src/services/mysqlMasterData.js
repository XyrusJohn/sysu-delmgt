const { formatGuardId, formatCompanyCode } = require("../utils/idGenerator");
const { randomBytes } = require("node:crypto");
const { EventEmitter } = require("node:events");
const masterDataEvents = new EventEmitter();
masterDataEvents.setMaxListeners(0);

function asIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function guardRecord(row) {
  if (!row) return null;
  const guardId = row.guard_code;
  return {
    id: guardId,
    guardId,
    firstName: row.first_name,
    lastName: row.last_name,
    middleInitial: row.middle_initial,
    fullName: row.full_name,
    active: Boolean(row.active),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function companyRecord(row) {
  if (!row) return null;
  const companyCode = row.company_code;
  return {
    id: companyCode,
    companyCode,
    forwarderCode: row.forwarder_code,
    name: row.name,
    active: Boolean(row.active),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function createMysqlMasterData({ pool }) {
  if (!pool?.execute) throw new TypeError("A MySQL pool is required");
  const getGuard = async (code) => {
    const [rows] = await pool.execute(
      "SELECT * FROM app_security_guards WHERE guard_code = ? LIMIT 1",
      [code],
    );
    return guardRecord(rows[0]);
  };
  const getCompany = async (code) => {
    const [rows] = await pool.execute(
      "SELECT * FROM app_truck_companies WHERE company_code = ? LIMIT 1",
      [code],
    );
    return companyRecord(rows[0]);
  };
  return Object.freeze({
    async listGuards() {
      const [rows] = await pool.execute(
        "SELECT * FROM app_security_guards ORDER BY id ASC LIMIT 2000",
      );
      return rows.map(guardRecord);
    },
    async listCompanies() {
      const [rows] = await pool.execute(
        "SELECT * FROM app_truck_companies ORDER BY id ASC LIMIT 2000",
      );
      return rows.map(companyRecord);
    },
    getGuard,
    getCompany,
    async createGuard({ firstName, lastName, middleInitial, fullName }) {
      const connection = await pool.getConnection();
      let code;
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
          "INSERT INTO app_security_guards (guard_code, first_name, last_name, middle_initial, full_name) VALUES (?, ?, ?, ?, ?)",
          [
            `p-${randomBytes(12).toString("hex")}`,
            firstName,
            lastName,
            middleInitial,
            fullName,
          ],
        );
        code = formatGuardId(result.insertId);
        await connection.execute(
          "UPDATE app_security_guards SET guard_code = ? WHERE id = ?",
          [code, result.insertId],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      masterDataEvents.emit("securityGuards");
      return getGuard(code);
    },
    async updateGuard(code, { firstName, lastName, middleInitial, fullName }) {
      const [result] = await pool.execute(
        "UPDATE app_security_guards SET first_name = ?, last_name = ?, middle_initial = ?, full_name = ? WHERE guard_code = ?",
        [firstName, lastName, middleInitial, fullName, code],
      );
      if (result.affectedRows) masterDataEvents.emit("securityGuards");
      return result.affectedRows ? getGuard(code) : null;
    },
    async setGuardActive(code, active) {
      const [result] = await pool.execute(
        "UPDATE app_security_guards SET active = ? WHERE guard_code = ?",
        [active, code],
      );
      if (result.affectedRows) masterDataEvents.emit("securityGuards");
      return result.affectedRows ? getGuard(code) : null;
    },
    async deleteGuard(code) {
      const [result] = await pool.execute(
        "DELETE FROM app_security_guards WHERE guard_code = ?",
        [code],
      );
      if (result.affectedRows) masterDataEvents.emit("securityGuards");
      return result.affectedRows === 1;
    },
    async createCompany({ forwarderCode, name }) {
      const connection = await pool.getConnection();
      let code;
      try {
        await connection.beginTransaction();
        const [result] = await connection.execute(
          "INSERT INTO app_truck_companies (company_code, forwarder_code, name) VALUES (?, ?, ?)",
          [`p-${randomBytes(12).toString("hex")}`, forwarderCode, name],
        );
        code = formatCompanyCode(result.insertId);
        await connection.execute(
          "UPDATE app_truck_companies SET company_code = ? WHERE id = ?",
          [code, result.insertId],
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      masterDataEvents.emit("truckCompanies");
      return getCompany(code);
    },
    async updateCompany(code, { forwarderCode, name }) {
      const [result] = await pool.execute(
        "UPDATE app_truck_companies SET forwarder_code = ?, name = ? WHERE company_code = ?",
        [forwarderCode, name, code],
      );
      if (result.affectedRows) masterDataEvents.emit("truckCompanies");
      return result.affectedRows ? getCompany(code) : null;
    },
    async setCompanyActive(code, active) {
      const [result] = await pool.execute(
        "UPDATE app_truck_companies SET active = ? WHERE company_code = ?",
        [active, code],
      );
      if (result.affectedRows) masterDataEvents.emit("truckCompanies");
      return result.affectedRows ? getCompany(code) : null;
    },
    async deleteCompany(code) {
      const [result] = await pool.execute(
        "DELETE FROM app_truck_companies WHERE company_code = ?",
        [code],
      );
      if (result.affectedRows) masterDataEvents.emit("truckCompanies");
      return result.affectedRows === 1;
    },
  });
}

let singleton;
function getMysqlMasterData() {
  if (!singleton)
    singleton = createMysqlMasterData({
      pool: require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}

module.exports = {
  createMysqlMasterData,
  getMysqlMasterData,
  masterDataEvents,
};
