const APPROVED_ROLES = new Set(["driver", "fleet_manager", "admin", "super_admin", "qr_generator"]);

function createVerifyToken({authenticateSession} = {}) {
  if (typeof authenticateSession !== "function") throw new TypeError("A MySQL session authenticator is required");
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !/^Bearer [^\s]+$/.test(header)) {
      return res.status(401).json({success: false, message: "Unauthorized"});
    }
    try {
      const user = await authenticateSession(header.slice(7));
      if (!user || typeof user.id !== "string" || !user.id) return res.status(401).json({success: false, message: "Unauthorized"});
      if (user.status !== "active" || !APPROVED_ROLES.has(user.role)) {
        return res.status(403).json({success: false, message: "Account not authorized"});
      }
      req.user = {uid: user.id};
      req.userProfile = {role: user.role, status: user.status};
      return next();
    } catch (_) {
      return res.status(503).json({success: false, message: "Authentication unavailable"});
    }
  };
}

const verifyToken = createVerifyToken({
  authenticateSession: token => require("../services/mysqlAuthSingleton").getMysqlAuthService().authenticate(token),
});

module.exports = {verifyToken, createVerifyToken};
