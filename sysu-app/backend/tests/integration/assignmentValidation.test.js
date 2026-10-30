const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
let databaseCalls = 0;
const assignmentPath = require.resolve("../../src/services/mysqlAssignments");
require.cache[assignmentPath] = {
  id: assignmentPath,
  filename: assignmentPath,
  loaded: true,
  exports: {
    getMysqlAssignments: () => ({
      async assign() {
        databaseCalls++;
        return { status: 200, data: {} };
      },
    }),
  },
};
const governancePath =
  require.resolve("../../src/services/mysqlDispatchGovernance");
require.cache[governancePath] = {
  id: governancePath,
  filename: governancePath,
  loaded: true,
  exports: {
    getMysqlDispatchGovernance: () => ({
      async requestOverride() {
        databaseCalls++;
        return { status: 200, data: {} };
      },
      async decideCancellation() {
        databaseCalls++;
        return { status: 200, data: {} };
      },
    }),
  },
};
const controller = require("../../src/controllers/sapAssignmentController");
const { errorHandler } = require("../../src/middleware/errorHandler");
const app = express();
app.use(express.json({ limit: "10kb" }));
app.use((req, _res, next) => {
  req.user = { uid: "synthetic-staff" };
  next();
});
app.post("/assign", controller.assignDriver);
app.post("/override-request", controller.requestOverride);
app.post("/cancel-decision", controller.decideCancelAssignment);
app.use(errorHandler);
let server, url;
test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete require.cache[assignmentPath];
  delete require.cache[governancePath];
});
const valid = {
  dispatchKey: "dispatch-a",
  requestedDriverId: "driver-a",
  truckType: "4W",
  overrideTokenId: null,
  driverSnapshot: null,
  lineItems: [
    { obdNumber: "000001", quantity: "10.5", customerName: "Synthetic" },
  ],
};
for (const [name, patch] of [
  ["nested document path", { dispatchKey: "parent/child" }],
  ["overlong dispatch ID", { dispatchKey: "a".repeat(129) }],
  ["control characters in driver ID", { requestedDriverId: "driver\u0000a" }],
  ["blank truck type", { truckType: "   " }],
  ["overlong truck type", { truckType: "a".repeat(65) }],
  [
    "overlong customer",
    { lineItems: [{ ...valid.lineItems[0], customerName: "a".repeat(501) }] },
  ],
  [
    "blank customer",
    { lineItems: [{ ...valid.lineItems[0], customerName: "  " }] },
  ],
  [
    "oversized array",
    {
      lineItems: Array.from({ length: 501 }, () => ({
        obdNumber: "1",
        quantity: 1,
        customerName: "s",
      })),
    },
  ],
]) {
  test(`R15/R21 invalid ${name} is rejected before database work`, async () => {
    databaseCalls = 0;
    const response = await fetch(url + "/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...valid, ...patch }),
    });
    assert.ok([400, 413].includes(response.status), `${response.status}`);
    assert.equal(databaseCalls, 0);
  });
}
test("R15 override reasons have a bounded length before persistence", async () => {
  databaseCalls = 0;
  const response = await fetch(url + "/override-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dispatchKey: "dispatch-a",
      requestedDriverId: "driver-a",
      reason: "a".repeat(2001),
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(databaseCalls, 0);
});
test("R15 cancellation decision IDs cannot select nested document paths", async () => {
  databaseCalls = 0;
  const response = await fetch(url + "/cancel-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "parent/child", decision: "approved" }),
  });
  assert.equal(response.status, 400);
  assert.equal(databaseCalls, 0);
});
