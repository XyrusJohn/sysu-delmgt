const crypto = require("node:crypto");

const SERVICE_NAME = "sysu-app";
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const MAX_RESPONSE_BYTES = 256 * 1024;
const RETRYABLE_5XX_OPERATIONS = new Set([
  "POST /api/system-errors/report",
  "POST /api/system-errors/logs/recover-operation",
]);
const pool = require("../config/mysql").createMySqlPool();

function requestFingerprint(req) {
  const body = JSON.stringify(req.body ?? null);
  return crypto
    .createHash("sha256")
    .update(`${req.method}\n${req.originalUrl || `${req.baseUrl}${req.path}`}\n${body}`)
    .digest("hex");
}

function operationName(req) {
  return `${req.method} ${req.baseUrl}${req.path}`.slice(0, 255);
}

function reply(res, status, body) {
  return res.status(status).json(body);
}

function createIdempotencyMiddleware({
  database = pool,
  serviceName = SERVICE_NAME,
  now = () => Date.now(),
} = {}) {
  return async function idempotency(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

    const actorId = req.user?.uid;
    const requestKey = req.get("Idempotency-Key");
    if (typeof actorId !== "string" || !actorId) {
      return reply(res, 401, {success: false, code: "AUTHENTICATION_REQUIRED"});
    }
    if (typeof requestKey !== "string" || !KEY_PATTERN.test(requestKey)) {
      return reply(res, 428, {success: false, code: "IDEMPOTENCY_KEY_REQUIRED"});
    }

    const fingerprint = requestFingerprint(req);
    try {
      const [insert] = await database.execute(
        `INSERT IGNORE INTO app_api_idempotency
           (service_name, actor_id, request_key, request_hash, operation_name, state, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)`,
        [serviceName, actorId, requestKey, fingerprint, operationName(req), now(), now()],
      );

      if (!insert.affectedRows) {
        const [rows] = await database.execute(
          `SELECT request_hash, state, response_status, response_body
             FROM app_api_idempotency
            WHERE service_name = ? AND actor_id = ? AND request_key = ? LIMIT 1`,
          [serviceName, actorId, requestKey],
        );
        const prior = rows[0];
        if (!prior) throw new Error("Idempotency record could not be read");
        if (prior.request_hash !== fingerprint) {
          return reply(res, 409, {success: false, code: "IDEMPOTENCY_KEY_REUSED"});
        }
        if (prior.state !== "completed") {
          res.setHeader("Retry-After", "2");
          return reply(res, 409, {success: false, code: "IDEMPOTENCY_IN_PROGRESS"});
        }
        let body;
        try {
          body = JSON.parse(prior.response_body);
        } catch {
          throw new Error("Stored idempotency response is invalid");
        }
        return reply(res, Number(prior.response_status), body);
      }

      const sendJson = res.json.bind(res);
      let responseStarted = false;
      res.json = (body) => {
        if (responseStarted) return res;
        responseStarted = true;
        let serialized;
        try {
          serialized = JSON.stringify(body);
        } catch {
          serialized = null;
        }
        if (serialized == null || Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) {
          res.status(503);
          return sendJson({success: false, code: "IDEMPOTENCY_RESPONSE_UNAVAILABLE"});
        }
        const status = res.statusCode;
        if (status >= 500 && RETRYABLE_5XX_OPERATIONS.has(operationName(req))) {
          void database.execute(
            `DELETE FROM app_api_idempotency
              WHERE service_name = ? AND actor_id = ? AND request_key = ?
                AND request_hash = ? AND state = 'processing'`,
            [serviceName, actorId, requestKey, fingerprint],
          ).then(([result]) => {
            if (result.affectedRows !== 1) throw new Error("Idempotency reservation was not released");
            sendJson(body);
          }).catch(() => {
            if (res.headersSent) return;
            res.status(503);
            sendJson({success: false, code: "IDEMPOTENCY_RESPONSE_UNAVAILABLE"});
          });
          return res;
        }
        void database.execute(
          `UPDATE app_api_idempotency
              SET state = 'completed', response_status = ?, response_body = ?, updated_at_ms = ?
            WHERE service_name = ? AND actor_id = ? AND request_key = ? AND request_hash = ? AND state = 'processing'`,
          [status, serialized, now(), serviceName, actorId, requestKey, fingerprint],
        ).then(([result]) => {
          if (result.affectedRows !== 1) throw new Error("Idempotency response was not saved");
          sendJson(body);
        }).catch(() => {
          if (res.headersSent) return;
          res.status(503);
          sendJson({success: false, code: "IDEMPOTENCY_RESPONSE_UNAVAILABLE"});
        });
        return res;
      };
      return next();
    } catch {
      return reply(res, 503, {success: false, code: "IDEMPOTENCY_STORE_UNAVAILABLE"});
    }
  };
}

const idempotency = createIdempotencyMiddleware();

module.exports = {createIdempotencyMiddleware, idempotency, operationName, requestFingerprint};
