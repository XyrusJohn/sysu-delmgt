/**
 * Centralized Error Handler Middleware
 * Captures all thrown errors from routes and returns a standardized JSON response.
 */
const errorHandler = (err, req, res, _next) => {
  const statusCode =
    err.name === "ZodError" ? 400 : err.statusCode || err.status || 500;
  const requestId = req.requestId || require("node:crypto").randomUUID();
  req.requestId = requestId;
  if (!res.headersSent && typeof res.setHeader === "function")
    res.setHeader("X-Request-ID", requestId);
  const route = req.route?.path
    ? `${req.baseUrl || ""}${req.route.path}`
    : null;
  const event = {
    event: "request_error",
    requestId,
    statusCode,
    category:
      err.name === "ZodError"
        ? "validation"
        : statusCode >= 500
          ? "internal"
          : "client",
    errorName: /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(err.name || "")
      ? err.name
      : "Error",
    errorCode:
      typeof err.code === "string" && /^[A-Z0-9_-]{1,48}$/i.test(err.code)
        ? err.code
        : undefined,
    route,
  };
  console.error(JSON.stringify(event));
  if (statusCode >= 500) {
    req._systemErrorLogged = true;
    try {
      const {
        createRuntimeSystemDiagnostics,
      } = require("../services/systemDiagnostics");
      void createRuntimeSystemDiagnostics({ io: global._io })
        .record({
          eventCode: "api_request_failure",
          requestId,
          errorName: event.errorName,
          route,
          actorId: req.user?.uid,
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
  }
  const message =
    statusCode >= 500
      ? "Internal Server Error"
      : err.name === "ZodError"
        ? "Invalid request data"
        : err.message || "Request failed";

  res.status(statusCode).json({
    success: false,
    requestId,
    error: message,
    // Only include stack trace in development
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

module.exports = { errorHandler };
