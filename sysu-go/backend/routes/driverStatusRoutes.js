const express = require("express");
const { verifyToken } = require("../middleware/auth.js");
const router = express.Router();
const VALID_STATUSES = new Set(["online", "offline", "in_transit", "returning_to_base"]);
const REGISTRATION_PROFILE_FIELDS = new Set(["queueId", "name", "truckType", "plateNumber", "truckingCompany", "helper", "requirements"]);
const driverOnly = (req, res, next) => req.userProfile?.role === "driver"
  ? next() : res.status(403).json({ success: false, message: "Account not authorized" });

function isValidRegistrationProfile(body) {
  const validString = (value, max) => typeof value === "string" && value.length <= max && !/[\x00-\x1f]/.test(value);
  return Boolean(body && typeof body === "object" && !Array.isArray(body)
    && !Object.keys(body).some(key => !REGISTRATION_PROFILE_FIELDS.has(key))
    && typeof body.queueId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.queueId)
    && validString(body.name, 100)
    && ["AUV", "4W", "6W", "10W", "20F", "40F"].includes(body.truckType)
    && validString(body.plateNumber, 64)
    && validString(body.truckingCompany, 200)
    && validString(body.helper, 200)
    && body.requirements && typeof body.requirements === "object" && !Array.isArray(body.requirements)
    && Object.keys(body.requirements).length <= 64
    && !Object.entries(body.requirements).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof value !== "boolean"));
}

router.post("/status", verifyToken, driverOnly, async (req, res) => {
  const uid = req.user.uid, body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || !VALID_STATUSES.has(body.status)
      || (body.name != null && (typeof body.name !== "string" || body.name.length > 100))
      || Object.keys(body).some(key => !["status", "name", "driverId"].includes(key))) {
    return res.status(400).json({ success: false, message: "Invalid driver status request" });
  }
  if (body.driverId != null && body.driverId !== uid) {
    return res.status(403).json({ success: false, message: "Cannot act for another driver" });
  }
  try {
    const driver = await require('../services/mysqlDriverProfiles').getMysqlDriverProfiles().setStatus(uid, body.status);
    if (!driver) return res.status(404).json({success: false, message: 'Driver profile unavailable'});
    const payload = {driverId: uid, status: body.status, name: driver.name,
      timestamp: Date.now(), source: 'backend_proxy'};
    const io = req.app.get("io");
    if (io) {
      io.to(`driver:${uid}`).emit("driver_status_change", payload);
      io.to("staff:tracking").emit("driver_status_change", payload);
    }
    return res.status(200).json({success: true, status: body.status, source: 'backend_proxy'});
  } catch (_) {
    console.error("[DriverStatusRoutes] status persistence unavailable");
    return res.status(503).json({ success: false, message: "Driver status temporarily unavailable" });
  }
});

router.get("/status" , verifyToken, driverOnly, async (req, res) => {
  try {
    const driver = await require('../services/mysqlDriverProfiles').getMysqlDriverProfiles().get(req.user.uid);
    if (!driver) return res.status(404).json({success: false, message: 'Driver profile unavailable'});
    if (!VALID_STATUSES.has(driver.status)) return res.status(503).json({success: false, message: 'Driver status unavailable'});
    return res.status(200).json({success: true, status: driver.status, name: driver.name});
  } catch (_) {
    console.error("[DriverStatusRoutes] status read unavailable");
    return res.status(503).json({ success: false, message: "Driver status temporarily unavailable" });
  }
});

router.get("/profile", verifyToken, driverOnly, async (req, res) => {
  try {
    const profile = await require('../services/mysqlDriverProfiles').getMysqlDriverProfiles().get(req.user.uid);
    return profile
      ? res.json({success: true, data: profile})
      : res.status(404).json({success: false, message: 'Driver profile unavailable'});
  } catch {
    return res.status(503).json({success: false, message: 'Driver profile unavailable'});
  }
});

router.put("/profile", verifyToken, driverOnly, async (req, res) => {
  const body = req.body;
  if (!isValidRegistrationProfile(body)) {
    return res.status(400).json({success: false, message: "Invalid driver registration profile"});
  }
  try {
    const profile = await require("../services/mysqlDriverProfiles").getMysqlDriverProfiles().updateRegistration({
      driverId: req.user.uid,
      queueId: body.queueId,
      name: body.name.trim(),
      truckType: body.truckType,
      plateNumber: body.plateNumber.trim(),
      truckingCompany: body.truckingCompany.trim(),
      helper: body.helper.trim(),
      requirements: body.requirements,
    });
    return profile
      ? res.json({success: true, data: profile})
      : res.status(404).json({success: false, message: "Driver registration unavailable"});
  } catch {
    return res.status(503).json({success: false, message: "Driver registration profile unavailable"});
  }
});

router.put("/profile/requirements", verifyToken, driverOnly, async (req, res) => {
  const requirements = req.body?.requirements;
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)
      || Object.keys(requirements).length > 64
      || Object.entries(requirements).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof value !== 'boolean')
      || Object.keys(req.body).some(key => key !== 'requirements')) {
    return res.status(400).json({success: false, message: 'Invalid driver requirements'});
  }
  try {
    const profile = await require('../services/mysqlDriverProfiles').getMysqlDriverProfiles()
      .setRequirements(req.user.uid, requirements);
    return profile
      ? res.json({success: true, data: profile})
      : res.status(404).json({success: false, message: 'Driver profile unavailable'});
  } catch {
    return res.status(503).json({success: false, message: 'Driver requirements unavailable'});
  }
});
module.exports = router;
module.exports.isValidRegistrationProfile = isValidRegistrationProfile;
