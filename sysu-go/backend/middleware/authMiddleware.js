// DEPRECATED — This module is no longer used.
// Active routes use the MySQL session middleware; this legacy middleware is unused.
module.exports = {
  verifyToken: async (req, res, next) => {
    // Safe pass-through — authRoutes are no longer mounted
    return res.status(401).json({ success: false, message: "Auth routes deprecated." });
  },
};
