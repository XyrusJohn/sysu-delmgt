const express = require("express");
const { verifyToken } = require("../middleware/auth.js");
const router = express.Router();

// Retired: this legacy writer bypassed canonical assignment ownership/state,
// confused driver UID with queue ID, and broadcast private operational data.
// Android uses owned assignment progress; its remaining contract is G-16.
router.post("/status", verifyToken, (_req, res) =>
  res.status(410).json({ success: false, message: "Legacy dispatch status endpoint retired. Use the canonical owned assignment workflow." })
);
module.exports = router;
