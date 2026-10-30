const { z } = require("zod");
const {
  createRuntimeSystemDiagnostics,
} = require("../services/systemDiagnostics");

const recoverSchema = z
  .object({
    eventCode: z.enum([
      "frontend_operation_failure",
      "sap_unavailable",
      "sap_detail_mismatch",
    ]),
    operation: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
  })
  .strict();

const reportSchema = z
  .object({
    eventCode: z.enum([
      "frontend_uncaught",
      "frontend_unhandled_rejection",
      "frontend_operation_failure",
      "mobile_uncaught_exception",
      "mobile_operation_failure",
    ]),
    operation: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,47}$/)
      .optional(),
    errorName: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.]{0,79}$/)
      .optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function service() {
  return createRuntimeSystemDiagnostics({
    io: global._io,
  });
}

async function reportClientError(req, res) {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ success: false, error: "Invalid diagnostic report" });
  try {
    const record = await service().record({
      ...parsed.data,
      requestId: req.requestId,
      actorId: req.user.uid,
    });
    return res.status(202).json({ success: true, id: record.id });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagnostic_report_persist_failed",
        requestId: req.requestId,
      }),
    );
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "Diagnostic report could not be saved",
      });
  }
}

async function listSystemErrors(req, res) {
  try {
    const limit = Number(req.query.limit || 50);
    const openOnly = req.query.openOnly !== "false";
    const items = await service().list({ limit, openOnly });
    return res.json({ success: true, items });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagnostic_report_list_failed",
        requestId: req.requestId,
      }),
    );
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "System logs are temporarily unavailable",
      });
  }
}

async function listMobileDiagnosticRuns(req, res) {
  try {
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);
    const actorId = req.query.actorId;
    if (
      !Number.isInteger(limit) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      (actorId !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          actorId,
        ))
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid mobile diagnostics query" });
    }
    const result = await service().listDiagnosticRuns({
      limit,
      offset,
      actorId,
    });
    return res.json({ success: true, ...result });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagnostic_run_list_failed",
        requestId: req.requestId,
      }),
    );
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "Mobile diagnostic runs are temporarily unavailable",
      });
  }
}

async function deleteMobileDiagnosticRun(req, res) {
  try {
    const deleted = await service().deleteDiagnosticRun(req.params.id);
    if (!deleted)
      return res
        .status(404)
        .json({ success: false, error: "Mobile diagnostic run not found" });
    return res.json({ success: true });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagnostic_run_delete_failed",
        requestId: req.requestId,
      }),
    );
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "Mobile diagnostic run could not be deleted",
      });
  }
}

async function resolveSystemError(req, res) {
  try {
    const found = await service().resolve(req.params.id, req.user.uid);
    if (!found)
      return res
        .status(404)
        .json({ success: false, error: "System log not found" });
    return res.json({ success: true });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagnostic_report_resolve_failed",
        requestId: req.requestId,
      }),
    );
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "System log could not be updated",
      });
  }
}

async function recoverSystemError(req, res) {
  const parsed = recoverSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ success: false, error: "Invalid recovery signal" });
  try {
    const resolved = await service().resolveOperation(
      parsed.data.eventCode,
      parsed.data.operation,
      req.user.uid,
    );
    return res.json({ success: true, resolved });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagnostic_recovery_failed",
        requestId: req.requestId,
      }),
    );
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "System log recovery could not be recorded",
      });
  }
}

async function deleteResolvedSystemError(req, res) {
  try {
    const deleted = await service().deleteResolved(req.params.id);
    if (!deleted)
      return res
        .status(404)
        .json({ success: false, error: "Resolved system log not found" });
    return res.json({ success: true });
  } catch {
    console.error(
      JSON.stringify({
        event: "diagnostic_report_delete_failed",
        requestId: req.requestId,
      }),
    );
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "Resolved system log could not be deleted",
      });
  }
}

module.exports = {
  reportClientError,
  listSystemErrors,
  listMobileDiagnosticRuns,
  deleteMobileDiagnosticRun,
  resolveSystemError,
  recoverSystemError,
  deleteResolvedSystemError,
};
