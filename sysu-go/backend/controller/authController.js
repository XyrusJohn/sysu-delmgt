// DEPRECATED — This module is no longer used.
// Authentication is handled by mysqlAuthService; this legacy controller is unused.
module.exports = {
  signup: async (req, res) => res.status(410).json({ success: false, message: "Deprecated" }),
  login: async (req, res) => res.status(410).json({ success: false, message: "Deprecated" }),
  logout: async (req, res) => res.status(410).json({ success: false, message: "Deprecated" }),
};
