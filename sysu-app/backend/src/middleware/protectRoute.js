const protectRoute = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : req.cookies?.token;

    if (!token) {
      return res
        .status(401)
        .json({ message: "Not authorized, no token provided" });
    }

    const user = await require("../services/mysqlAuthSingleton")
      .getMysqlAuthService()
      .authenticate(token);
    if (!user)
      return res
        .status(401)
        .json({ message: "Not authorized, invalid or expired token" });
    req.user = { uid: user.id, role: user.role, status: user.status };
    req.mysqlUser = user;
    return next();
  } catch (error) {
    console.error("Authentication unavailable:", error.message);
    return res.status(503).json({ message: "Authentication unavailable" });
  }
};

module.exports = { protectRoute };
