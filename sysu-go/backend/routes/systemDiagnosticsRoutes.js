const express = require('express');
const rateLimit = require('express-rate-limit');
const {verifyToken} = require('../middleware/auth');
const {safeDetails} = require('../services/mysqlSystemDiagnostics');

const REPORT_ROLES = new Set(['driver', 'fleet_manager', 'admin', 'super_admin']);
const EVENT_CODES = new Set(['mobile_uncaught_exception', 'mobile_operation_failure']);
const OPERATION = /^[a-z][a-z0-9_-]{0,47}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;

function createSystemDiagnosticsRouter({authenticate = verifyToken, service}) {
  if (!service?.record) throw new TypeError('A system diagnostics service is required');
  const router = express.Router();
  const limiter = rateLimit({windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false});
  const recoveryLimiter = rateLimit({windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false});
  router.post('/report', limiter, authenticate, async (req, res) => {
    if (!REPORT_ROLES.has(req.userProfile?.role)) return res.status(403).json({success: false, message: 'Account not authorized'});
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some(key => !['eventCode', 'operation', 'errorName', 'details'].includes(key))) {
      return res.status(400).json({success: false, error: 'Invalid diagnostic report'});
    }
    const {eventCode, operation, errorName, details} = req.body;
    if (!EVENT_CODES.has(eventCode) || (operation !== undefined && !OPERATION.test(operation))
      || (errorName !== undefined && !ERROR_NAME.test(errorName))
      || (details !== undefined && (!details || typeof details !== 'object' || Array.isArray(details)))) {
      return res.status(400).json({success: false, error: 'Invalid diagnostic report'});
    }
    try {
      const record = await service.record({eventCode, operation, errorName: errorName || 'Error',
        actorId: req.user.uid, requestId: req.requestId, details: safeDetails(details)});
      if (!record) return res.status(400).json({success: false, error: 'Invalid diagnostic report'});
      return res.status(202).json({success: true, id: record.id, requestId: req.requestId});
    } catch {
      return res.status(503).json({success: false, error: 'Diagnostic report could not be saved', requestId: req.requestId});
    }
  });
  router.post('/diagnostic-runs', limiter, authenticate, async (req, res) => {
    if (!REPORT_ROLES.has(req.userProfile?.role)) return res.status(403).json({success: false, message: 'Account not authorized'});
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['runId', 'appVersion', 'checks'].includes(key))
      || typeof body.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.runId)
      || typeof body.appVersion !== 'string' || !/^[A-Za-z0-9.+_-]{1,32}$/.test(body.appVersion)
      || !Array.isArray(body.checks)) {
      return res.status(400).json({success: false, error: 'Invalid diagnostics run'});
    }
    try {
      const record = await service.recordDiagnosticRun({...body, actorId: req.user.uid});
      if (!record) return res.status(400).json({success: false, error: 'Invalid diagnostics run'});
      req.app.get('io')?.to('staff:system-diagnostics').emit('mobile_diagnostic_run_created', {
        actorId: req.user.uid,
        runId: body.runId,
        createdAt: Date.now(),
        needsAttention: body.checks.some(check => check.status !== 'pass'),
      });
      return res.status(202).json({success: true, id: record.id, requestId: req.requestId});
    } catch {
      return res.status(503).json({success: false, error: 'Diagnostics run could not be saved', requestId: req.requestId});
    }
  });
  router.post('/recover-operation', recoveryLimiter, authenticate, async (req, res) => {
    if (!REPORT_ROLES.has(req.userProfile?.role)) return res.status(403).json({success: false, message: 'Account not authorized'});
    const {eventCode, operation} = req.body || {};
    if (Object.keys(req.body || {}).some(key => !['eventCode', 'operation'].includes(key))
      || eventCode !== 'mobile_operation_failure' || typeof operation !== 'string' || !OPERATION.test(operation)) {
      return res.status(400).json({success: false, error: 'Invalid recovery signal'});
    }
    try {
      const resolved = await service.resolveOperation(eventCode, operation, req.user.uid);
      return res.json({success: true, resolved});
    } catch {
      return res.status(503).json({success: false, error: 'System log recovery could not be recorded', requestId: req.requestId});
    }
  });
  return router;
}

module.exports = createSystemDiagnosticsRouter;
module.exports.createSystemDiagnosticsRouter = createSystemDiagnosticsRouter;
