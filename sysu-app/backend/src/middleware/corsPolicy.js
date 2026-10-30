/** Exact origin policy; authentication is still required on protected routes. */
module.exports = function corsPolicy(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    res.vary("Origin");
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin))
      return res
        .status(403)
        .json({ success: false, message: "Origin not allowed" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS, PUT, DELETE, PATCH",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization, Idempotency-Key",
      );
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  };
};
