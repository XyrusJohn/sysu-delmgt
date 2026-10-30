function createSystemErrorResponseLogger({diagnosticsFactory}) {
  return function systemErrorResponseLogger(req, res, next) {
    res.once('finish', () => {
      if (req._systemErrorLogged || res.statusCode < 500) return;
      req._systemErrorLogged = true;
      const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : null;
      try {
        void diagnosticsFactory().record({eventCode: 'api_request_failure', operation: 'api-server',
          errorName: 'HttpServerError', requestId: req.requestId, route, actorId: req.user?.uid,
          details: {httpStatus: res.statusCode}})
          .catch(() => console.error(JSON.stringify({event: 'system_error_log_persist_failed', requestId: req.requestId || null})));
      } catch {
        console.error(JSON.stringify({event: 'system_error_logging_unavailable', requestId: req.requestId || null}));
      }
    });
    next();
  };
}

module.exports = {createSystemErrorResponseLogger};
