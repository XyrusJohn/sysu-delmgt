process.env.DB_HOST = "localhost";
process.env.DB_NAME = "idempotency_test";
process.env.DB_USER = "test";

const assert = require("node:assert/strict");
const test = require("node:test");
const {createIdempotencyMiddleware, requestFingerprint, operationName} = require("./idempotency.js");

function request(overrides = {}) {
  const headers = new Map(Object.entries(overrides.headers || {}));
  return {
    method: "POST",
    baseUrl: "/api/actions",
    path: "/confirm",
    originalUrl: "/api/actions/confirm?source=web",
    body: {action: "confirm"},
    user: {uid: "account-test"},
    get: (name) => headers.get(name) || headers.get(name.toLowerCase()),
    ...overrides,
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    sent: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.sent = {status: this.statusCode, body}; return this; },
  };
}

function keyHeaders(key = "stable-request-key-0001") {
  return {headers: {"Idempotency-Key": key}};
}

test("a first request reserves a key and persists its JSON response before sending", async () => {
  const calls = [];
  const database = {execute: async (sql, params) => {
    calls.push({sql, params});
    return [{affectedRows: 1}, []];
  }};
  const res = response();
  let invoked = false;
  const middleware = createIdempotencyMiddleware({database, now: () => 123});

  await middleware(request(keyHeaders()), res, () => { invoked = true; });
  assert.equal(invoked, true);
  assert.equal(calls[0].params[4], "POST /api/actions/confirm");
  assert.match(calls[0].sql, /operation_name/);
  assert.equal(res.sent, null);
  res.status(201).json({success: true, id: "result-1"});
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls.length, 2);
  assert.equal(calls[1].params[0], 201);
  assert.equal(calls[1].params[1], JSON.stringify({success: true, id: "result-1"}));
  assert.deepEqual(res.sent, {status: 201, body: {success: true, id: "result-1"}});
});

test("a completed identical request replays the saved status and body without running the handler", async () => {
  const req = request(keyHeaders());
  const row = {
    request_hash: requestFingerprint(req),
    state: "completed",
    response_status: 201,
    response_body: JSON.stringify({success: true, id: "result-1"}),
  };
  let invoked = false;
  const database = {execute: async sql => sql.includes("INSERT IGNORE")
    ? [{affectedRows: 0}, []] : [[row], []]};
  const res = response();

  await createIdempotencyMiddleware({database})(req, res, () => { invoked = true; });

  assert.equal(invoked, false);
  assert.deepEqual(res.sent, {status: 201, body: {success: true, id: "result-1"}});
});

test("server error JSON is saved as completed so a retry replays instead of rerunning", async () => {
  const calls = [];
  const database = {execute: async (sql, params) => {
    calls.push({sql, params});
    return [{affectedRows: 1}, []];
  }};
  const res = response();
  await createIdempotencyMiddleware({database})(request(keyHeaders()), res, () => {});
  res.status(500).json({success: false, code: "ACTION_OUTCOME_UNKNOWN"});
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls[1].params[0], 500);
  assert.equal(calls[1].params[1], JSON.stringify({success: false, code: "ACTION_OUTCOME_UNKNOWN"}));
  assert.match(calls[1].sql, /state = 'completed'/);
});

for (const path of [
  "/api/system-errors/report",
  "/api/system-errors/logs/recover-operation",
]) {
  test(`${path} removes a failed reservation so the same key can retry`, async () => {
    const rows = new Map();
    const database = {execute: async (sql, params) => {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      if (sql.includes("INSERT IGNORE")) {
        if (rows.has(key)) return [{affectedRows: 0}, []];
        rows.set(key, {request_hash: params[3], state: "processing"});
        return [{affectedRows: 1}, []];
      }
      if (sql.includes("SELECT request_hash")) return [[rows.get(key)], []];
      if (sql.includes("DELETE FROM app_api_idempotency")) {
        rows.delete(`${params[0]}:${params[1]}:${params[2]}`);
        return [{affectedRows: 1}, []];
      }
      if (sql.includes("UPDATE app_api_idempotency")) {
        const updateKey = `${params[3]}:${params[4]}:${params[5]}`;
        rows.set(updateKey, {...rows.get(updateKey), state: "completed"});
        return [{affectedRows: 1}, []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }};
    const middleware = createIdempotencyMiddleware({database});
    const makeRequest = () => request({
      ...keyHeaders(),
      baseUrl: path.startsWith("/api/system-errors/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "/api/system-errors",
      path: path.slice(path.lastIndexOf("/")),
      originalUrl: path,
      body: {eventCode: "frontend_operation_failure", operation: "sap-sync"},
    });

    const firstResponse = response();
    let handlerRuns = 0;
    await middleware(makeRequest(), firstResponse, () => {
      handlerRuns += 1;
    });
    firstResponse.status(503).json({success: false, error: "Temporary storage failure"});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rows.size, 0);

    const retryResponse = response();
    await middleware(makeRequest(), retryResponse, () => {
      handlerRuns += 1;
      retryResponse.status(200).json({success: true});
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(handlerRuns, 2);
    assert.deepEqual(retryResponse.sent, {status: 200, body: {success: true}});
  });
}

test("a key reused with a different fingerprint returns conflict", async () => {
  const req = request({...keyHeaders(), body: {action: "different"}});
  const database = {execute: async sql => sql.includes("INSERT IGNORE")
    ? [{affectedRows: 0}, []]
    : [[{request_hash: "0".repeat(64), state: "processing"}], []]};
  let invoked = false;
  const res = response();

  await createIdempotencyMiddleware({database})(req, res, () => { invoked = true; });

  assert.equal(invoked, false);
  assert.deepEqual(res.sent, {status: 409, body: {success: false, code: "IDEMPOTENCY_KEY_REUSED"}});
});

test("a concurrent request with a reserved key gets an in-progress response and retry delay", async () => {
  const req = request(keyHeaders());
  const database = {execute: async sql => sql.includes("INSERT IGNORE")
    ? [{affectedRows: 0}, []]
    : [[{request_hash: requestFingerprint(req), state: "processing"}], []]};
  const res = response();

  await createIdempotencyMiddleware({database})(req, res, () => assert.fail("handler must not run"));

  assert.equal(res.sent.status, 409);
  assert.equal(res.sent.body.code, "IDEMPOTENCY_IN_PROGRESS");
  assert.equal(res.headers["Retry-After"], "2");
});

test("database failure fails closed without invoking the handler", async () => {
  const res = response();
  let invoked = false;

  await createIdempotencyMiddleware({database: {execute: async () => { throw new Error("db unavailable"); }}})(
    request(keyHeaders()), res, () => { invoked = true; },
  );

  assert.equal(invoked, false);
  assert.deepEqual(res.sent, {status: 503, body: {success: false, code: "IDEMPOTENCY_STORE_UNAVAILABLE"}});
});

test("safe HTTP methods bypass idempotency storage", async () => {
  let invoked = false;
  await createIdempotencyMiddleware({database: {execute: async () => assert.fail("should not query storage")}})(
    request({method: "GET"}), response(), () => { invoked = true; },
  );
  assert.equal(invoked, true);
});

test("the fingerprint includes query parameters while stored operation names omit them", () => {
  const base = request();
  assert.notEqual(requestFingerprint(base), requestFingerprint({...base, originalUrl: "/api/actions/confirm?source=mobile"}));
  assert.equal(operationName(base), "POST /api/actions/confirm");
});
