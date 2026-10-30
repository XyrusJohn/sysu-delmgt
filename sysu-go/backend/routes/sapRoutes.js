const express = require("express");
const { verifyToken } = require("../middleware/auth.js");
const router = express.Router();

// SAP is owned by sysu-app's authenticated, validated service. No shipped
// Android caller uses this duplicate proxy; it must never fetch/return raw SAP.
router.get("/shipments", verifyToken, (req, res) => {
  if (!["fleet_manager", "admin", "super_admin"].includes(req.userProfile?.role)) {
    return res.status(403).json({ success: false, message: "Account not authorized" });
  }
  return res.status(410).json({ success: false, message: "Use the authorized SYSU App SAP service" });
});
module.exports = router;
