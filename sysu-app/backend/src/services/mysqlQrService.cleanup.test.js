const test = require("node:test");
const assert = require("node:assert/strict");
const { createMysqlQrService } = require("./mysqlQrService");

function cleanupFixture({ batches = [], lock = 1 } = {}) {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push([sql, params]);
      if (sql.includes("GET_LOCK")) return [[{ acquired: lock }]];
      if (sql.startsWith("DELETE FROM app_qr_tokens")) {
        const affectedRows = batches.shift() ?? 0;
        return [{ affectedRows }];
      }
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const pool = {
    getConnection: async () => connection,
    execute: async () => { throw new Error("Cleanup must use one connection"); },
  };
  return { service: createMysqlQrService({ pool, now: () => 1_000_000 }), calls };
}

test("QR cleanup deletes expired unused tokens in bounded batches and keeps recent redemptions", async () => {
  const { service, calls } = cleanupFixture({ batches: [500, 17] });

  const result = await service.cleanupExpiredTokens({ batchSize: 500, maxBatches: 4 });

  assert.deepEqual(result, { deleted: 517, batches: 2, skipped: false });
  const deletes = calls.filter(([sql]) => sql.startsWith("DELETE FROM app_qr_tokens"));
  assert.equal(deletes.length, 2);
  assert.match(deletes[0][0], /expires_at_ms <= \?/);
  assert.match(deletes[0][0], /used = FALSE OR \(used = TRUE AND COALESCE\(used_at_ms, expires_at_ms\) <= \?\)/);
  assert.match(deletes[0][0], /ORDER BY expires_at_ms ASC\s+LIMIT \?/);
  assert.deepEqual(deletes[0][1], [1_000_000, 1_000_000 - 24 * 60 * 60 * 1000, 500]);
  assert.ok(calls.some(([sql]) => sql.includes("RELEASE_LOCK")));
});

test("QR cleanup skips when another server instance holds the cleanup lock", async () => {
  const { service, calls } = cleanupFixture({ lock: 0 });

  const result = await service.cleanupExpiredTokens();

  assert.deepEqual(result, { deleted: 0, batches: 0, skipped: true });
  assert.equal(calls.some(([sql]) => sql.startsWith("DELETE FROM app_qr_tokens")), false);
});

test("QR cleanup clamps caller-supplied batch limits", async () => {
  const { service, calls } = cleanupFixture({ batches: [0] });

  await service.cleanupExpiredTokens({ batchSize: 100_000, maxBatches: 100_000 });

  const [deleteCall] = calls.filter(([sql]) => sql.startsWith("DELETE FROM app_qr_tokens"));
  assert.deepEqual(deleteCall[1], [1_000_000, 1_000_000 - 24 * 60 * 60 * 1000, 1000]);
});
