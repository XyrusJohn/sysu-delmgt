const express = require("express");
const { verifyToken } = require("../middleware/auth.js");
const { generateQR, verifyQR, scanQR, getQueue, updateQueueStatus, cancelQueue, getOwnPosition } = require("../controller/qrController.js");
const router = express.Router();
const roles = (...allowed) => (req, res, next) => {
  if (req.userProfile?.status !== "active" || !allowed.includes(req.userProfile?.role)) {
    return res.status(403).json({ success: false, message: "Account not authorized" });
  }
  return next();
};
router.post("/generate", verifyToken, roles("qr_generator", "admin", "super_admin"), generateQR);
router.get("/verify", verifyQR);
router.post("/scan", verifyToken, roles("driver"), scanQR);
router.get("/queue", verifyToken, roles("fleet_manager", "admin", "super_admin"), getQueue);
router.get("/own-position", verifyToken, roles("driver"), getOwnPosition);
router.post("/queue/:queueId/cancel", verifyToken, roles("driver"), cancelQueue);
router.patch("/queue-status", verifyToken, roles("fleet_manager", "admin", "super_admin"), updateQueueStatus);
module.exports = router;
