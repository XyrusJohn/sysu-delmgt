const EVENT_CODES = new Set(['api_request_failure', 'mobile_uncaught_exception', 'mobile_operation_failure']);
const DIAGNOSTIC_CHECKS = new Set(['network', 'sysu-go-api', 'sysu-go-database', 'sysu-go-socket', 'session-token']);
const RECOVERABLE_MOBILE_OPERATIONS = new Set([
  'realtime-connection', 'queue-subscription', 'assignment-subscription', 'guard-subscription', 'profile-subscription',
  'trip-start', 'shipment-state-transition', 'shipment-completion', 'driver-profile', 'pod-preview', 'location-fetch',
  'camera-status-sheet', 'pod-save', 'pod-processing', 'qr-camera-start', 'guard-verification', 'queue-load',
]);

function safeDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  const patterns = {
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
  for (const [key, pattern] of Object.entries(patterns)) {
    if (typeof input[key] === 'string' && pattern.test(input[key])) output[key] = input[key];
  }
  for (const key of ['httpStatus', 'line', 'column']) {
    const value = input[key];
    const valid = key === 'httpStatus' ? Number.isInteger(value) && value >= 100 && value <= 599
      : Number.isInteger(value) && value > 0 && value <= (key === 'line' ? 10000000 : 100000);
    if (valid) output[key] = value;
  }
  if (Number.isSafeInteger(input.clientTimestampMs) && input.clientTimestampMs >= 946684800000
    && input.clientTimestampMs <= Date.now() + 300000) output.clientTimestampMs = input.clientTimestampMs;
  return output;
}

function createMysqlSystemDiagnostics({pool, clock = () => Date.now()}) {
  if (!pool?.execute) throw new TypeError('A MySQL pool is required');
  return Object.freeze({
    async recordDiagnosticRun({runId, actorId, appVersion, checks}) {
      if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)
        || typeof actorId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(actorId)
        || typeof appVersion !== 'string' || !/^[A-Za-z0-9.+_-]{1,32}$/.test(appVersion)
        || !Array.isArray(checks) || checks.length !== DIAGNOSTIC_CHECKS.size) return null;
      const seen = new Set();
      const cleanChecks = [];
      for (const check of checks) {
        if (!check || typeof check !== 'object' || Array.isArray(check)
          || Object.keys(check).some(key => !['name', 'status', 'durationMs', 'httpStatus', 'failureCode', 'state'].includes(key))
          || !DIAGNOSTIC_CHECKS.has(check.name) || seen.has(check.name)
          || !['pass', 'fail', 'warning'].includes(check.status)
          || !Number.isInteger(check.durationMs) || check.durationMs < 0 || check.durationMs > 60000) return null;
        const clean = {name: check.name, status: check.status, durationMs: check.durationMs};
        if (check.httpStatus !== undefined) {
          if (!Number.isInteger(check.httpStatus) || check.httpStatus < 100 || check.httpStatus > 599) return null;
          clean.httpStatus = check.httpStatus;
        }
        if (check.failureCode !== undefined) {
          if (typeof check.failureCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(check.failureCode)) return null;
          clean.failureCode = check.failureCode;
        }
        if (check.state !== undefined) {
          if (typeof check.state !== 'string' || !/^(online|offline|wifi|cellular|ethernet|unknown|connected|disconnected|not_initialized|present|missing)$/.test(check.state)) return null;
          clean.state = check.state;
        }
        seen.add(check.name);
        cleanChecks.push(clean);
      }
      if (seen.size !== DIAGNOSTIC_CHECKS.size) return null;
      const timestamp = clock();
      const details = {runId, appVersion, platform: 'android', checks: cleanChecks};
      const [result] = await pool.execute(
        `INSERT INTO app_system_error_logs
         (event_code, source, severity, message, operation, error_name, request_id, route, actor_id, details, created_at_ms)
         VALUES ('mobile_diagnostic_run', 'mobile', 'info', 'SYSU Go diagnostics run completed.', 'mobile-diagnostics', NULL, ?, '/api/system-errors/diagnostic-runs', ?, ?, ?)`,
        [runId, actorId, JSON.stringify(details), timestamp]);
      return {id: String(result.insertId), eventCode: 'mobile_diagnostic_run', source: 'mobile', severity: 'info',
        message: 'SYSU Go diagnostics run completed.', operation: 'mobile-diagnostics', requestId: runId,
        actorId, details, createdAt: {$timestamp: timestamp}};
    },
    async record({eventCode, operation, errorName, actorId, requestId, route, details}) {
      if (!EVENT_CODES.has(eventCode) || (actorId != null && !/^[A-Za-z0-9_-]{1,128}$/.test(actorId))
        || !/^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(errorName || '')) return null;
      const safeOperation = typeof operation === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(operation) ? operation : null;
      const safeRequestId = typeof requestId === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(requestId) ? requestId : null;
      const safeRoute = typeof route === 'string' && /^\/[A-Za-z0-9_/:.-]{1,119}$/.test(route) ? route : null;
      const timestamp = clock();
      const source = eventCode === 'api_request_failure' ? 'backend' : 'mobile';
      const message = eventCode === 'mobile_uncaught_exception' ? 'The mobile app terminated unexpectedly.'
        : eventCode === 'api_request_failure' ? 'A server request failed.' : 'A mobile workflow operation failed.';
      const cleanDetails = safeDetails(details);
      const [updated] = await pool.execute(
        `UPDATE app_system_error_logs
         SET details = JSON_SET(details,
             '$.occurrenceCount', LAST_INSERT_ID(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(details, '$.occurrenceCount')), '1') AS UNSIGNED) + 1),
             '$.lastSeenAtMs', ?)
         WHERE event_code = ? AND source = ? AND operation <=> ? AND actor_id <=> ? AND route <=> ?
           AND resolved_at_ms IS NULL
         ORDER BY created_at_ms DESC LIMIT 1`,
        [timestamp, eventCode, source, safeOperation, actorId || null, safeRoute]);
      if (updated.affectedRows === 1) return {id: null, eventCode, source, severity: 'error', message,
        operation: safeOperation, errorName, requestId: safeRequestId, route: safeRoute, actorId: actorId || null,
        details: {...cleanDetails, occurrenceCount: Number(updated.insertId) || 2, lastSeenAtMs: timestamp},
        createdAt: {$timestamp: timestamp}, resolvedAt: null, resolvedBy: null};
      const [result] = await pool.execute(
        `INSERT INTO app_system_error_logs
         (event_code, source, severity, message, operation, error_name, request_id, route, actor_id, details, created_at_ms)
         VALUES (?, ?, 'error', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventCode, source, message, safeOperation, errorName, safeRequestId, safeRoute, actorId || null,
          JSON.stringify(cleanDetails), timestamp]);
      return {id: String(result.insertId), eventCode, source, severity: 'error', message,
        operation: safeOperation, errorName, requestId: safeRequestId, route: safeRoute, actorId: actorId || null, details: cleanDetails,
        createdAt: {$timestamp: timestamp}, resolvedAt: null, resolvedBy: null};
    },
    async resolveOperation(eventCode, operation, actorId) {
      if (eventCode !== 'mobile_operation_failure' || !RECOVERABLE_MOBILE_OPERATIONS.has(operation)
        || typeof actorId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(actorId)) return 0;
      const [result] = await pool.execute(
        `UPDATE app_system_error_logs SET resolved_at_ms = ?, resolved_by = ?
         WHERE event_code = ? AND operation = ? AND actor_id = ? AND resolved_at_ms IS NULL`,
        [clock(), actorId, eventCode, operation, actorId]);
      return result.affectedRows;
    },
  });
}

module.exports = {safeDetails, createMysqlSystemDiagnostics};
