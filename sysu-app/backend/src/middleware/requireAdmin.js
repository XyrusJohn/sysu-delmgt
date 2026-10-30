const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return res
        .status(401)
        .json({ message: "Not authorized, no authenticated user" });
    }

    const userData = req.mysqlUser;

    if (
      !userData ||
      userData.status !== "active" ||
      (userData.role !== "admin" && userData.role !== "super_admin")
    ) {
      return res
        .status(403)
        .json({ message: "Forbidden: Admin access required" });
    }

    next();
  } catch (error) {
    console.error("requireAdmin error:", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = { requireAdmin };
