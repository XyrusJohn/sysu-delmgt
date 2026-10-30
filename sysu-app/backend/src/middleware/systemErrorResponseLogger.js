const {
  createRuntimeSystemDiagnostics,
} = require("../services/systemDiagnostics");

function createSystemErrorResponseLogger({ diagnosticsFactory } = {}) {
  return function systemErrorResponseLogger(req, res, next) {
    res.once("finish", () => {
      if (req._systemErrorLogged || res.statusCode < 500) return;
      req._systemErrorLogged = true;
      const route = req.route?.path
        ? `${req.baseUrl || ""}${req.route.path}`
        : null;
      const requestId = req.requestId || null;
      const errorName =
        typeof res.locals?.errorName === "string"
          ? res.locals.errorName
          : "HttpServerError";
      try {
        const diagnostics = diagnosticsFactory
          ? diagnosticsFactory()
          : createRuntimeSystemDiagnostics({ io: global._io });
        void diagnostics
          .record({
            eventCode: "api_request_failure",
            requestId,
            errorName,
            route,
            actorId: req.user?.uid,
            details: { statusCode: res.statusCode },
          })
          .catch(() =>
            console.error(
              JSON.stringify({
                event: "system_error_log_persist_failed",
                requestId,
              }),
            ),
          );
      } catch {
        console.error(
          JSON.stringify({
            event: "system_error_logging_unavailable",
            requestId,
          }),
        );
      }
    });
    next();
  };
}

const systemErrorResponseLogger = createSystemErrorResponseLogger();

module.exports = { createSystemErrorResponseLogger, systemErrorResponseLogger };
