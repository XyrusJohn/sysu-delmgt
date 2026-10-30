const test = require('node:test');
const assert = require('node:assert/strict');
const {createHttpIdempotencyMiddleware, requestFingerprint, decodeResponse} = require('./httpIdempotency');

function fakePool() {
  const rows = new Map();
  return {
    rows,
    async execute(sql, values) {
      if (/INSERT INTO app_api_idempotency/.test(sql)) {
        const [service, actor, key, operation, hash, created, updated] = values;
        const id = `${service}:${actor}:${key}`;
        if (rows.has(id)) throw Object.assign(new Error('duplicate'), {code: 'ER_DUP_ENTRY'});
        rows.set(id, {service_name: service, actor_id: actor, request_key: key, operation_name: operation,
          request_hash: hash, state: 'processing', response_status: null, response_body: null,
          created_at_ms: created, updated_at_ms: updated});
        return [{affectedRows: 1}];
      }
      if (/SELECT request_hash/.test(sql)) {
        const id = `${values[0]}:${values[1]}:${values[2]}`;
        return [[rows.get(id)].filter(Boolean)];
      }
      if (/UPDATE app_api_idempotency/.test(sql)) {
        const [status, body, updated, service, actor, key, hash] = values;
        const row = rows.get(`${service}:${actor}:${key}`);
        if (!row || row.request_hash !== hash || row.state !== 'processing') return [{affectedRows: 0}];
        Object.assign(row, {state: 'completed', response_status: status, response_body: body, updated_at_ms: updated});
        return [{affectedRows: 1}];
      }
      if (/DELETE FROM app_api_idempotency/.test(sql)) {
        const [service, actor, key, hash] = values;
        const id = `${service}:${actor}:${key}`;
        const row = rows.get(id);
        if (!row || row.request_hash !== hash || row.state !== 'processing') return [{affectedRows: 0}];
        rows.delete(id);
        return [{affectedRows: 1}];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function fakeRequest(overrides = {}) {
  return {method: 'POST', path: '/trip/return', originalUrl: '/api/trip/return?source=mobile',
    headers: {'idempotency-key': 'retry-key-123', authorization: 'Bearer session-secret'},
    user: {uid: 'driver-1'}, userProfile: {role: 'driver'}, body: {action: 'start'},
    get(name) { return this.headers[name.toLowerCase()]; }, ...overrides};
}

function fakeResponse() {
  const headers = {};
  let resolveEnd;
  const ended = new Promise(resolve => { resolveEnd = resolve; });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { headers[name.toLowerCase()] = String(value); return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
    getHeader(name) { return headers[name.toLowerCase()]; },
    get headers() { return headers; },
    json(body) { this.setHeader('Content-Type', 'application/json; charset=utf-8'); return this.end(Buffer.from(JSON.stringify(body))); },
    end(chunk) { resolveEnd({status: this.statusCode, headers: {...headers}, body: chunk == null ? Buffer.alloc(0) : Buffer.from(chunk)}); return this; },
  };
  return {res, ended};
}

async function run(middleware, req, handler) {
  const {res, ended} = fakeResponse();
  await middleware(req, res, () => handler(res));
  return ended;
}

test('stores only a request digest and replays the same completed HTTP result', async () => {
  const pool = fakePool();
  const middleware = createHttpIdempotencyMiddleware({pool, serviceName: 'sysu-go', authenticateSession: async () => null, now: () => 123});
  const request = fakeRequest();
  const first = await run(middleware, request, res => res.status(201).json({success: true, id: 'created'}));
  assert.equal(first.status, 201);
  assert.equal(first.headers['idempotency-completed'], 'true');

  const saved = [...pool.rows.values()][0];
  assert.equal(saved.operation_name, 'POST /trip/return');
  assert.equal(saved.request_hash, requestFingerprint(request));
  assert.equal(JSON.stringify(saved).includes('session-secret'), false);
  assert.equal(JSON.stringify(saved).includes('"action":"start"'), false);
  const decoded = decodeResponse(saved.response_body);
  assert.equal(decoded.contentType, 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(decoded.body.toString('utf8')), {success: true, id: 'created'});

  const replay = await run(middleware, fakeRequest(), res => res.status(500).json({unexpected: true}));
  assert.equal(replay.status, 201);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  assert.deepEqual(JSON.parse(replay.body.toString('utf8')), {success: true, id: 'created'});
});

test('rejects key reuse with a different query or body and signals in-progress requests', async () => {
  const pool = fakePool();
  const middleware = createHttpIdempotencyMiddleware({pool, serviceName: 'sysu-go', authenticateSession: async () => null});
  await run(middleware, fakeRequest(), res => res.json({success: true}));

  const reused = await run(middleware, fakeRequest({body: {action: 'arrived'}}), res => res.json({unexpected: true}));
  assert.equal(reused.status, 409);
  assert.equal(JSON.parse(reused.body.toString('utf8')).code, 'IDEMPOTENCY_KEY_REUSED');

  const pending = fakeRequest();
  const row = [...pool.rows.values()][0];
  row.state = 'processing';
  const inProgress = await run(middleware, pending, res => res.json({unexpected: true}));
  assert.equal(inProgress.status, 409);
  assert.equal(inProgress.headers['retry-after'], '2');
  assert.equal(JSON.parse(inProgress.body.toString('utf8')).code, 'IDEMPOTENCY_IN_PROGRESS');
});

test('stores terminal error and empty 204 responses so a retry does not rerun the route', async () => {
  const pool = fakePool();
  const middleware = createHttpIdempotencyMiddleware({pool, serviceName: 'sysu-go', authenticateSession: async () => null});
  const failed = await run(middleware, fakeRequest(), res => res.status(503).json({success: false, message: 'temporarily unavailable'}));
  assert.equal(failed.status, 503);
  assert.equal(failed.headers['idempotency-completed'], 'true');
  const replay = await run(middleware, fakeRequest(), res => res.status(201).json({unexpected: true}));
  assert.equal(replay.status, 503);

  const secondRequest = fakeRequest({'headers': {'idempotency-key': 'another-key-123', authorization: 'Bearer session-secret'}});
  const noContent = await run(middleware, secondRequest, res => { res.statusCode = 204; return res.end(); });
  assert.equal(noContent.status, 204);
  const replayNoContent = await run(middleware, fakeRequest({'headers': {'idempotency-key': 'another-key-123', authorization: 'Bearer session-secret'}}),
    res => res.status(200).json({unexpected: true}));
  assert.equal(replayNoContent.status, 204);
  assert.equal(replayNoContent.body.length, 0);

  const plainRequest = fakeRequest({'headers': {'idempotency-key': 'plain-key-123', authorization: 'Bearer session-secret'}});
  const plain = await run(middleware, plainRequest, res => {
    res.status(202).setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('accepted');
  });
  assert.equal(plain.status, 202);
  const plainReplay = await run(middleware, fakeRequest({'headers': {'idempotency-key': 'plain-key-123', authorization: 'Bearer session-secret'}}),
    res => res.end('unexpected'));
  assert.equal(plainReplay.status, 202);
  assert.equal(plainReplay.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(plainReplay.body.toString('utf8'), 'accepted');
});

test('releases a diagnostics report reservation after 5xx so the same key can retry', async () => {
  for (const path of ['/system-errors/report']) {
    const pool = fakePool();
    const middleware = createHttpIdempotencyMiddleware({pool, serviceName: 'sysu-go', authenticateSession: async () => null});
    const request = fakeRequest({path, originalUrl: `/api${path}`});
    let attempts = 0;
    const first = await run(middleware, request, res => {
      attempts += 1;
      return res.status(503).json({success: false, message: 'temporary failure'});
    });
    assert.equal(first.status, 503);
    assert.equal(pool.rows.size, 0, `${path} reservation should be removed after 503`);

    const retry = await run(middleware, fakeRequest({path, originalUrl: `/api${path}`}), res => {
      attempts += 1;
      return res.status(200).json({success: true});
    });
    assert.equal(retry.status, 200);
    assert.equal(attempts, 2, `${path} handler should run again with the same key`);
    assert.equal(pool.rows.size, 1);
    assert.equal([...pool.rows.values()][0].response_status, 200);
  }
});

test('requires a key only for authenticated writes and fails closed without the shared table', async () => {
  const middleware = createHttpIdempotencyMiddleware({pool: {execute: async () => { throw Object.assign(new Error('missing'), {code: 'ER_NO_SUCH_TABLE'}); }},
    serviceName: 'sysu-go', authenticateSession: async token => ({id: 'driver-1', role: 'driver', status: token === 'valid' ? 'active' : 'disabled'})});
  const missingKey = await run(middleware, fakeRequest({headers: {authorization: 'Bearer valid'}}), res => res.json({unexpected: true}));
  assert.equal(missingKey.status, 400);
  assert.equal(JSON.parse(missingKey.body.toString('utf8')).code, 'IDEMPOTENCY_KEY_REQUIRED');

  const schemaMissing = await run(middleware, fakeRequest({headers: {'idempotency-key': 'retry-key-123', authorization: 'Bearer valid'}, user: undefined}),
    res => res.json({unexpected: true}));
  assert.equal(schemaMissing.status, 503);
  assert.equal(JSON.parse(schemaMissing.body.toString('utf8')).code, 'IDEMPOTENCY_SCHEMA_NOT_READY');

  let called = false;
  await middleware(fakeRequest({method: 'GET'}), fakeResponse().res, () => { called = true; });
  assert.equal(called, true);
});

test('lets the idempotent diagnostics recovery route run without the optional replay table', async () => {
  const middleware = createHttpIdempotencyMiddleware({pool: {execute: async () => {
    throw Object.assign(new Error('missing table'), {code: 'ER_NO_SUCH_TABLE'});
  }}, serviceName: 'sysu-go', authenticateSession: async () => null});
  const result = await run(middleware, fakeRequest({path: '/system-errors/recover-operation'}), res =>
    res.json({success: true, resolved: 0}));
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body.toString('utf8')), {success: true, resolved: 0});
});

test('skips credential lifecycle routes without touching the idempotency table', async () => {
  let called = false;
  const middleware = createHttpIdempotencyMiddleware({pool: {execute: async () => { throw new Error('should not query'); }},
    serviceName: 'sysu-go', authenticateSession: async () => null});
  await middleware(fakeRequest({path: '/auth/mysql/username/login'}), fakeResponse().res, () => { called = true; });
  assert.equal(called, true);
});
