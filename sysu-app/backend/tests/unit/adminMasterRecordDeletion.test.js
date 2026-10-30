const test = require("node:test");
const assert = require("node:assert/strict");

const records = { guards: new Map(), companies: new Map() };
let nextGuardId = 1;
let nextCompanyId = 1;
function createStore() {
  return {
    async createGuard(input) {
      const id = `SG-${String(nextGuardId++).padStart(3, "0")}`;
      const record = { id, guardId: id, ...input, active: true };
      records.guards.set(id, record);
      return record;
    },
    async getGuard(id) {
      return records.guards.get(id) || null;
    },
    async updateGuard(id, input) {
      const record = records.guards.get(id);
      if (!record) return null;
      Object.assign(record, input);
      return record;
    },
    async setGuardActive(id, active) {
      const record = records.guards.get(id);
      if (!record) return null;
      record.active = active;
      return record;
    },
    async deleteGuard(id) {
      return records.guards.delete(id);
    },
    async createCompany(input) {
      const id = String(nextCompanyId++).padStart(2, "0");
      const record = { id, companyCode: id, ...input, active: true };
      records.companies.set(id, record);
      return record;
    },
    async getCompany(id) {
      return records.companies.get(id) || null;
    },
    async updateCompany(id, input) {
      const record = records.companies.get(id);
      if (!record) return null;
      Object.assign(record, input);
      return record;
    },
    async setCompanyActive(id, active) {
      const record = records.companies.get(id);
      if (!record) return null;
      record.active = active;
      return record;
    },
    async deleteCompany(id) {
      return records.companies.delete(id);
    },
  };
}
const servicePath = require.resolve("../../src/services/mysqlMasterData");
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: { getMysqlMasterData: createStore },
};

const originalBackend = process.env.AUTH_BACKEND;
process.env.AUTH_BACKEND = "mysql";
const guards = require("../../src/controllers/admin/guardController");
const companies = require("../../src/controllers/admin/truckCompanyController");
function invoke(handler, params = {}, body = {}) {
  return new Promise((resolve, reject) => {
    const response = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        resolve({ status: this.statusCode, body: value });
      },
    };
    handler({ params, body }, response, reject);
  });
}

test.beforeEach(() => {
  records.guards.clear();
  records.companies.clear();
  nextGuardId = 1;
  nextCompanyId = 1;
});
test.after(() => {
  if (originalBackend === undefined) delete process.env.AUTH_BACKEND;
  else process.env.AUTH_BACKEND = originalBackend;
  delete require.cache[servicePath];
});

for (const { label, controller, createBody, idParam, create, remove, rows } of [
  {
    label: "guard",
    controller: guards,
    createBody: { firstName: "Synthetic", lastName: "Guard" },
    idParam: "id",
    create: "createGuard",
    remove: "deleteGuard",
    rows: records.guards,
  },
  {
    label: "truck company",
    controller: companies,
    createBody: { forwarderCode: "TEST-DELETE", name: "Synthetic Company" },
    idParam: "code",
    create: "createTruckCompany",
    remove: "deleteTruckCompany",
    rows: records.companies,
  },
]) {
  test(`delete ${label} preserves the SQL ID high-water mark`, async () => {
    const created = await invoke(controller[create], {}, createBody);
    const removed = await invoke(controller[remove], {
      [idParam]: created.body.id,
    });
    assert.equal(removed.status, 200);
    assert.equal(rows.has(created.body.id), false);
    const next = await invoke(
      controller[create],
      {},
      { ...createBody, firstName: "Next", forwarderCode: "TEST-NEXT" },
    );
    assert.notEqual(next.body.id, created.body.id);
  });

  test(`delete ${label} returns 404 for missing records`, async () => {
    const removed = await invoke(controller[remove], {
      [idParam]: label === "guard" ? "SG-999" : "999",
    });
    assert.equal(removed.status, 404);
  });
}

test("master record controllers reject malformed IDs", async () => {
  assert.equal(
    (await invoke(guards.deleteGuard, { id: "bad-id" })).status,
    400,
  );
  assert.equal(
    (await invoke(companies.deleteTruckCompany, { code: "bad-code" })).status,
    400,
  );
});

test("master record controllers validate input and preserve normalized fields", async () => {
  const guard = await invoke(
    guards.createGuard,
    {},
    {
      firstName: "  Ana   Maria ",
      lastName: " Dela Cruz ",
      middleInitial: " B ",
    },
  );
  assert.equal(guard.body.fullName, "Ana Maria B Dela Cruz");
  const company = await invoke(
    companies.createTruckCompany,
    {},
    { forwarderCode: "ABC-123", name: "  Haulers " },
  );
  assert.equal(company.body.name, "Haulers");
  await assert.rejects(
    invoke(
      companies.createTruckCompany,
      {},
      { forwarderCode: "BAD CODE", name: "Bad" },
    ),
  );
});
