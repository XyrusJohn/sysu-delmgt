const EVENT_CODES = new Set([
  "api_request_failure",
  "frontend_uncaught",
  "frontend_unhandled_rejection",
  "frontend_operation_failure",
  "mobile_uncaught_exception",
  "mobile_operation_failure",
  "sap_unavailable",
  "sap_detail_mismatch",
]);

const MESSAGES = Object.freeze({
  api_request_failure: "A server request failed.",
  frontend_uncaught: "A browser operation failed unexpectedly.",
  frontend_unhandled_rejection: "A browser background operation failed.",
  frontend_operation_failure: "A browser workflow operation failed.",
  mobile_uncaught_exception: "The mobile app terminated unexpectedly.",
  mobile_operation_failure: "A mobile workflow operation failed.",
  sap_unavailable: "The SAP integration could not complete a request.",
  sap_detail_mismatch:
    "SAP returned fewer dispatch details than the assigned records require.",
});

const AUTO_RECOVERY = Object.freeze({
  frontend_operation_failure: new Set([
    "realtime-connection",
    "sap-sync",
    "sap-detail-enrichment",
    "sysu-app-api-health",
    "sysu-app-database-health",
    "sysu-go-api-health",
    "sysu-go-database-health",
  ]),
  sap_unavailable: new Set(["sap-shipments", "sap-dispatch-details"]),
  sap_detail_mismatch: new Set(["sap-dispatch-details"]),
});

function safeReport(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !EVENT_CODES.has(input.eventCode)
  )
    return null;
  const operation =
    typeof input.operation === "string" &&
    /^[a-z][a-z0-9_-]{0,47}$/.test(input.operation)
      ? input.operation
      : null;
  const errorName =
    typeof input.errorName === "string" &&
    /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(input.errorName)
      ? input.errorName
      : null;
  const requestId =
    typeof input.requestId === "string" &&
    /^[A-Za-z0-9-]{8,80}$/.test(input.requestId)
      ? input.requestId
      : null;
  const route =
    typeof input.route === "string" &&
    input.route.startsWith("/") &&
    input.route.length <= 120 &&
    !/[?#]/.test(input.route)
      ? input.route
      : null;
  const actorId =
    typeof input.actorId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(input.actorId)
      ? input.actorId
      : null;
  const details = {};
  if (
    input.details &&
    typeof input.details === "object" &&
    !Array.isArray(input.details)
  ) {
    for (const key of ["expectedCount", "receivedCount", "missingCount"]) {
      if (Number.isInteger(input.details[key]) && input.details[key] >= 0)
        details[key] = Math.min(input.details[key], 100000);
    }
    for (const key of ["statusCode", "httpStatus"]) {
      if (
        Number.isInteger(input.details[key]) &&
        input.details[key] >= 100 &&
        input.details[key] <= 599
      )
        details[key] = input.details[key];
    }
    const stringFields = {
      failureCode: /^[A-Z][A-Z0-9_]{0,63}$/,
      stage: /^[a-z][a-z0-9_-]{0,47}$/,
      sourceFrame: /^[A-Za-z0-9_.$<>-]{1,100}(?::[A-Za-z0-9_.-]{1,100}){0,2}$/,
      appVersion: /^[A-Za-z0-9.+_-]{1,32}$/,
      clientEventId: /^[A-Fa-f0-9-]{36}$/,
      clientRequestId: /^[A-Za-z0-9-]{8,80}$/,
      networkType: /^(online|offline|wifi|cellular|ethernet|unknown)$/,
      socketState: /^(connected|disconnected|not_initialized|unknown)$/,
      platform: /^(web|android|ios)$/,
    };
    for (const [key, pattern] of Object.entries(stringFields)) {
      if (
        typeof input.details[key] === "string" &&
        pattern.test(input.details[key])
      )
        details[key] = input.details[key];
    }
    if (
      Number.isSafeInteger(input.details.clientTimestampMs) &&
      input.details.clientTimestampMs >= 946684800000 &&
      input.details.clientTimestampMs <= Date.now() + 300000
    ) {
      details.clientTimestampMs = input.details.clientTimestampMs;
    }
    if (
      Number.isInteger(input.details.line) &&
      input.details.line > 0 &&
      input.details.line <= 10000000
    )
      details.line = input.details.line;
    if (
      Number.isInteger(input.details.column) &&
      input.details.column > 0 &&
      input.details.column <= 100000
    )
      details.column = input.details.column;
  }
  return {
    eventCode: input.eventCode,
    source: input.eventCode.startsWith("frontend_")
      ? "web"
      : input.eventCode.startsWith("mobile_")
        ? "mobile"
        : input.eventCode.startsWith("sap_")
          ? "sap"
          : "backend",
    severity: input.eventCode === "sap_detail_mismatch" ? "warning" : "error",
    message: MESSAGES[input.eventCode],
    operation,
    errorName,
    requestId,
    route,
    actorId,
    details,
  };
}

function emitDiagnosticsUpdate(io, event, payload) {
  try {
    io?.to("ops-admins").emit(event, payload);
  } catch {
    // Database persistence is authoritative; live admin updates are best-effort.
  }
}

function createMysqlSystemDiagnostics({ pool, io, clock = () => Date.now() }) {
  if (!pool?.execute) throw new TypeError("A MySQL pool is required");

  async function record(input) {
    const report = safeReport(input);
    if (!report) return null;
    const createdAt = clock();
    const [updated] = await pool.execute(
      `UPDATE app_system_error_logs
             SET details = JSON_SET(details,
                 '$.occurrenceCount', LAST_INSERT_ID(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(details, '$.occurrenceCount')), '1') AS UNSIGNED) + 1),
                 '$.lastSeenAtMs', ?)
             WHERE event_code = ? AND source = ? AND operation <=> ? AND actor_id <=> ? AND route <=> ?
               AND resolved_at_ms IS NULL
             ORDER BY created_at_ms DESC LIMIT 1`,
      [
        createdAt,
        report.eventCode,
        report.source,
        report.operation,
        report.actorId,
        report.route,
      ],
    );
    if (updated.affectedRows === 1) {
      emitDiagnosticsUpdate(io, "system_error_updated", {
        eventCode: report.eventCode,
        operation: report.operation,
      });
      return {
        id: null,
        ...report,
        createdAt: { $timestamp: createdAt },
        resolvedAt: null,
        resolvedBy: null,
        details: {
          ...report.details,
          occurrenceCount: Number(updated.insertId) || 2,
          lastSeenAtMs: createdAt,
        },
      };
    }
    const [result] = await pool.execute(
      `INSERT INTO app_system_error_logs
             (event_code, source, severity, message, operation, error_name, request_id, route, actor_id, details, created_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        report.eventCode,
        report.source,
        report.severity,
        report.message,
        report.operation,
        report.errorName,
        report.requestId,
        report.route,
        report.actorId,
        JSON.stringify(report.details),
        createdAt,
      ],
    );
    const data = {
      id: String(result.insertId),
      ...report,
      createdAt: { $timestamp: createdAt },
      resolvedAt: null,
      resolvedBy: null,
    };
    emitDiagnosticsUpdate(io, "system_error_created", data);
    return data;
  }

  async function list({ limit = 50, openOnly = true } = {}) {
    const size = Number.isInteger(limit)
      ? Math.min(100, Math.max(1, limit))
      : 50;
    const [rows] = await pool.execute(
      `SELECT id, event_code, source, severity, message, operation, error_name, request_id, route,
                    actor_id, details, created_at_ms, resolved_at_ms, resolved_by
             FROM app_system_error_logs WHERE event_code <> 'mobile_diagnostic_run'
               ${openOnly ? "AND resolved_at_ms IS NULL" : ""}
             ORDER BY created_at_ms DESC LIMIT ?`,
      [size],
    );
    return rows.map((row) => ({
      id: String(row.id),
      eventCode: row.event_code,
      source: row.source,
      severity: row.severity,
      message: row.message,
      operation: row.operation,
      errorName: row.error_name,
      requestId: row.request_id,
      route: row.route,
      actorId: row.actor_id,
      details:
        typeof row.details === "string" ? JSON.parse(row.details) : row.details,
      createdAt: { $timestamp: Number(row.created_at_ms) },
      resolvedAt:
        row.resolved_at_ms == null
          ? null
          : { $timestamp: Number(row.resolved_at_ms) },
      resolvedBy: row.resolved_by,
    }));
  }

  async function listDiagnosticRuns({ limit = 50, offset = 0, actorId } = {}) {
    const size = Number.isInteger(limit)
      ? Math.min(100, Math.max(1, limit))
      : 50;
    const start = Number.isInteger(offset)
      ? Math.min(1000000, Math.max(0, offset))
      : 0;
    const isActorId =
      typeof actorId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        actorId,
      );
    if (actorId !== undefined && !isActorId)
      return { items: [], hasMore: false };
    const query = isActorId
      ? `SELECT id, event_code, source, severity, message, operation, error_name, request_id, route,
                      actor_id, details, created_at_ms
               FROM app_system_error_logs
               WHERE event_code = 'mobile_diagnostic_run' AND actor_id = ?
               ORDER BY created_at_ms DESC, id DESC LIMIT ? OFFSET ?`
      : `SELECT id, event_code, source, severity, message, operation, error_name, request_id, route,
                      actor_id, details, created_at_ms
               FROM (
                 SELECT id, event_code, source, severity, message, operation, error_name, request_id, route,
                        actor_id, details, created_at_ms,
                        ROW_NUMBER() OVER (PARTITION BY actor_id ORDER BY created_at_ms DESC, id DESC) AS account_rank
                 FROM app_system_error_logs
                 WHERE event_code = 'mobile_diagnostic_run' AND actor_id IS NOT NULL
               ) latest_runs
               WHERE account_rank = 1
               ORDER BY created_at_ms DESC, id DESC LIMIT ? OFFSET ?`;
    const params = isActorId ? [actorId, size + 1, start] : [size + 1, start];
    const [rows] = await pool.execute(query, params);
    const hasMore = rows.length > size;
    const items = rows
      .slice(0, size)
      .map((row) => ({
        id: String(row.id),
        eventCode: row.event_code,
        source: row.source,
        severity: row.severity,
        message: row.message,
        operation: row.operation,
        errorName: row.error_name,
        requestId: row.request_id,
        route: row.route,
        actorId: row.actor_id,
        details:
          typeof row.details === "string"
            ? JSON.parse(row.details)
            : row.details,
        createdAt: { $timestamp: Number(row.created_at_ms) },
      }));
    return { items, hasMore };
  }

  async function resolve(id, actorId) {
    if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) return false;
    const resolvedAt = clock();
    const [result] = await pool.execute(
      "UPDATE app_system_error_logs SET resolved_at_ms = ?, resolved_by = ? WHERE id = ? AND resolved_at_ms IS NULL",
      [resolvedAt, actorId, id],
    );
    if (result.affectedRows !== 1) return false;
    emitDiagnosticsUpdate(io, "system_error_resolved", {
      id,
      resolvedAt: { $timestamp: resolvedAt },
    });
    return true;
  }

  async function deleteDiagnosticRun(id) {
    if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) return false;
    const [result] = await pool.execute(
      "DELETE FROM app_system_error_logs WHERE id = ? AND event_code = 'mobile_diagnostic_run'",
      [id],
    );
    if (result.affectedRows !== 1) return false;
    emitDiagnosticsUpdate(io, "system_error_deleted", {
      id,
      eventCode: "mobile_diagnostic_run",
    });
    return true;
  }

  async function resolveOperation(eventCode, operation, actorId) {
    if (
      !AUTO_RECOVERY[eventCode]?.has(operation) ||
      typeof actorId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(actorId)
    )
      return 0;
    const resolvedAt = clock();
    const [result] = await pool.execute(
      `UPDATE app_system_error_logs SET resolved_at_ms = ?, resolved_by = ?
             WHERE event_code = ? AND operation = ? AND actor_id = ? AND resolved_at_ms IS NULL`,
      [resolvedAt, actorId, eventCode, operation, actorId],
    );
    if (result.affectedRows > 0)
      emitDiagnosticsUpdate(io, "system_error_resolved", {
        eventCode,
        operation,
        resolvedAt: { $timestamp: resolvedAt },
      });
    return result.affectedRows;
  }

  async function deleteResolved(id) {
    if (typeof id !== "string" || !/^\d{1,20}$/.test(id)) return false;
    const [result] = await pool.execute(
      "DELETE FROM app_system_error_logs WHERE id = ? AND resolved_at_ms IS NOT NULL",
      [id],
    );
    if (result.affectedRows !== 1) return false;
    emitDiagnosticsUpdate(io, "system_error_deleted", { id });
    return true;
  }

  return {
    record,
    list,
    listDiagnosticRuns,
    deleteDiagnosticRun,
    resolve,
    resolveOperation,
    deleteResolved,
  };
}

let mysqlDiagnostics;
function createRuntimeSystemDiagnostics({ io }) {
  if (!mysqlDiagnostics)
    mysqlDiagnostics = createMysqlSystemDiagnostics({
      pool: require("../config/mysql").createMySqlPool(),
      io,
    });
  return mysqlDiagnostics;
}

module.exports = {
  EVENT_CODES,
  safeReport,
  createMysqlSystemDiagnostics,
  createRuntimeSystemDiagnostics,
};
