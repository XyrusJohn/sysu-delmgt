const crypto = require('node:crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const MAX_RESPONSE_BYTES = 256 * 1024;
const RETRYABLE_DIAGNOSTICS_PATHS = new Set([
  '/system-errors/report',
]);
const IDEMPOTENT_POST_PATHS = new Set(['/system-errors/recover-operation']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

function requestFingerprint(req) {
  // originalUrl includes the query string; only its digest is stored.
  return crypto.createHash('sha256')
    .update(`${String(req.method).toUpperCase()}\n${req.originalUrl || req.path || ''}\n${req.userProfile?.role || ''}\n${stableJson(req.body ?? null)}`)
    .digest('hex');
}

function jsonError(res, status, code, message) {
  return res.status(status).json({success: false, code, message});
}

function serializeResponse(chunk, contentType) {
  let bytes;
  if (chunk == null) bytes = Buffer.alloc(0);
  else if (Buffer.isBuffer(chunk)) bytes = chunk;
  else if (ArrayBuffer.isView(chunk)) bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  else bytes = Buffer.from(String(chunk), 'utf8');
  if (bytes.length > MAX_RESPONSE_BYTES) return null;
  return JSON.stringify({version: 1, contentType: contentType || '', body: bytes.toString('base64')});
}

function decodeResponse(value) {
  try {
    const saved = JSON.parse(value);
    if (saved?.version !== 1 || typeof saved.body !== 'string' || typeof saved.contentType !== 'string') return null;
    const body = Buffer.from(saved.body, 'base64');
    if (body.length > MAX_RESPONSE_BYTES) return null;
    return {body, contentType: saved.contentType};
  } catch (_) {
    return null;
  }
}

function createHttpIdempotencyMiddleware({pool, serviceName, authenticateSession, now = () => Date.now()} = {}) {
  if (!pool?.execute) throw new TypeError('A MySQL pool is required');
  if (typeof authenticateSession !== 'function') throw new TypeError('A MySQL session authenticator is required');
  if (typeof serviceName !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(serviceName)) {
    throw new TypeError('A valid idempotency service name is required');
  }

  return async function httpIdempotency(req, res, next) {
    if (SAFE_METHODS.has(String(req.method).toUpperCase())) return next();
    // Credential and session lifecycle responses must never be persisted for replay.
    const path = req.path || '';
    if (/^\/(?:api\/)?auth(?:\/mysql)?\/(?:username\/(?:register|login)|(?:register|login|refresh|logout))(?:\/|$)/.test(path)) return next();
    // Recovery only marks matching open rows resolved, so duplicate calls are safe.
    if (String(req.method).toUpperCase() === 'POST' && IDEMPOTENT_POST_PATHS.has(path)) return next();
    // QR generation returns a short-lived bearer-like code, so it cannot be stored for replay.
    if (/^\/(?:api\/)?qr\/generate\/?$/.test(path)) return next();

    if (!req.user?.uid) {
      const header = req.headers?.authorization;
      if (typeof header !== 'string' || !/^Bearer [^\s]+$/.test(header)) {
        return jsonError(res, 401, 'AUTHENTICATION_REQUIRED', 'Sign in before sending this request.');
      }
      try {
        const user = await authenticateSession(header.slice(7));
        if (!user || typeof user.id !== 'string' || !user.id || user.status !== 'active') {
          return jsonError(res, 401, 'AUTHENTICATION_REQUIRED', 'Sign in before sending this request.');
        }
        req.user = {uid: user.id};
        req.userProfile = {role: user.role, status: user.status};
      } catch (_) {
        return jsonError(res, 503, 'AUTHENTICATION_UNAVAILABLE', 'The sign-in service is temporarily unavailable. Try again shortly.');
      }
    }

    const actorId = req.user?.uid;
    const requestKey = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
    if (typeof actorId !== 'string' || !actorId) {
      return jsonError(res, 401, 'IDEMPOTENCY_ACTOR_REQUIRED', 'Sign in before sending this request.');
    }
    if (typeof requestKey !== 'string' || !KEY_PATTERN.test(requestKey)) {
      return jsonError(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'This request needs a valid retry key. Update the app and try again.');
    }

    const fingerprint = requestFingerprint(req);
    const identity = [serviceName, actorId, requestKey];
    try {
      await pool.execute(
        `INSERT INTO app_api_idempotency
           (service_name, actor_id, request_key, operation_name, request_hash, state, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)`,
        [...identity, `${String(req.method).toUpperCase()} ${String(req.path || '').slice(0, 220)}`, fingerprint, now(), now()],
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        try {
          const [rows] = await pool.execute(
            `SELECT request_hash, state, response_status, response_body
               FROM app_api_idempotency
              WHERE service_name = ? AND actor_id = ? AND request_key = ? LIMIT 1`, identity,
          );
          const row = rows?.[0];
          if (!row) return jsonError(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The request could not be checked safely. Try again shortly.');
          if (row.request_hash !== fingerprint) {
            return jsonError(res, 409, 'IDEMPOTENCY_KEY_REUSED', 'This retry key was already used for a different request. Refresh and try again.');
          }
          if (row.state !== 'completed') {
            res.set('Retry-After', '2');
            return jsonError(res, 409, 'IDEMPOTENCY_IN_PROGRESS', 'This request is still being processed. Wait a moment and try again.');
          }
          const response = decodeResponse(row.response_body);
          if (!Number.isInteger(Number(row.response_status)) || !response) {
            return jsonError(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The saved result is unavailable. Contact the system manager before repeating this action.');
          }
          res.status(Number(row.response_status));
          if (response.contentType) res.set('Content-Type', response.contentType);
          res.set('Idempotency-Replayed', 'true');
          res.set('Idempotency-Completed', 'true');
          return res.end(response.body);
        } catch (lookupError) {
          return handleStorageError(lookupError, res);
        }
      }
      return handleStorageError(error, res);
    }

    const originalEnd = res.end.bind(res);
    let responseSaving = false;
    res.end = (...args) => {
      if (responseSaving) return res;
      responseSaving = true;
      const [chunk] = args;
      const contentType = res.getHeader('Content-Type');
      const responseBody = serializeResponse(chunk, contentType == null ? '' : String(contentType));
      const responseStatus = res.statusCode;
      if (isRetryableDiagnosticsFailure(req, responseStatus)) {
        releaseReservation(pool, identity, fingerprint)
          .then(released => {
            if (!released) return sendUnsavedResult(res, originalEnd);
            originalEnd(...args);
          })
          .catch(() => sendUnsavedResult(res, originalEnd));
        return res;
      }
      if (!responseBody) {
        // An oversized result is uncertain; save a small terminal response to prevent replaying the mutation.
        const fallback = JSON.stringify({success: false, code: 'IDEMPOTENCY_RESPONSE_TOO_LARGE',
          message: 'The action result could not be saved. Do not repeat it; contact the system manager.'});
        const fallbackRecord = serializeResponse(fallback, 'application/json; charset=utf-8');
        persistResult(pool, identity, fingerprint, 503, fallbackRecord, now)
          .then(saved => {
            if (!saved) return sendUnsavedResult(res, originalEnd);
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Idempotency-Completed', 'true');
            originalEnd(Buffer.from(fallback, 'utf8'));
          })
          .catch(() => sendUnsavedResult(res, originalEnd));
        return res;
      }
      persistResult(pool, identity, fingerprint, responseStatus, responseBody, now)
        .then(saved => {
          if (!saved) return sendUnsavedResult(res, originalEnd);
          res.setHeader('Idempotency-Completed', 'true');
          originalEnd(...args);
        })
        .catch(() => sendUnsavedResult(res, originalEnd));
      return res;
    };
    return next();
  };
}

function isRetryableDiagnosticsFailure(req, status) {
  if (String(req.method).toUpperCase() !== 'POST' || status < 500 || status > 599) return false;
  const path = String(req.path || req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, '');
  return RETRYABLE_DIAGNOSTICS_PATHS.has(path);
}

async function releaseReservation(pool, identity, fingerprint) {
  const [result] = await pool.execute(
    `DELETE FROM app_api_idempotency
      WHERE service_name = ? AND actor_id = ? AND request_key = ?
        AND request_hash = ? AND state = 'processing'`,
    [...identity, fingerprint],
  );
  return result?.affectedRows === 1;
}

async function persistResult(pool, identity, fingerprint, responseStatus, responseBody, now) {
  const [result] = await pool.execute(
    `UPDATE app_api_idempotency
        SET state = 'completed', response_status = ?, response_body = ?, updated_at_ms = ?
      WHERE service_name = ? AND actor_id = ? AND request_key = ? AND request_hash = ? AND state = 'processing'`,
    [responseStatus, responseBody, now(), ...identity, fingerprint],
  );
  return result?.affectedRows === 1;
}

function sendUnsavedResult(res, originalEnd) {
  if (res.headersSent) return originalEnd();
  const body = JSON.stringify({success: false, code: 'IDEMPOTENCY_RESULT_UNSAVED',
    message: 'The action may have completed, but its result was not saved. Do not repeat it; contact the system manager.'});
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  originalEnd(Buffer.from(body, 'utf8'));
}

function handleStorageError(error, res) {
  if (error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR') {
    return jsonError(res, 503, 'IDEMPOTENCY_SCHEMA_NOT_READY', 'The server update is not complete yet. Contact the system manager before retrying this action.');
  }
  return jsonError(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The server could not safely check this request. Try again shortly.');
}

module.exports = {createHttpIdempotencyMiddleware, requestFingerprint, stableJson, decodeResponse, serializeResponse};
