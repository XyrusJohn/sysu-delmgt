const express = require("express");
const { verifyToken } = require("../middleware/auth.js");
const router = express.Router();

// Administration is owned by sysu-app's guarded, audited workflow.
// These legacy duplicates cannot safely perform role changes or deletion.
const retired = (_req, res) => res.status(410).json({
  success: false,
  message: "Use the SYSU web administration workflow",
});
router.post("/update-role", verifyToken, retired);
router.post("/delete", verifyToken, retired);
module.exports = router;
