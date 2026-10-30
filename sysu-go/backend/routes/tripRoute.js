const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth.js");
const { registerTrip } = require("../controller/tripController.js");
const mysqlAssignments = () => require("../services/mysqlAssignments").getMysqlAssignments();
const mysqlTripReturn = () => require("../services/mysqlTripReturn").getMysqlTripReturn();

router.post("/return", verifyToken, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["action", "dispatchKeys", "queueId"].includes(key))
      || !["start", "arrived", "complete"].includes(body.action)
      || !Array.isArray(body.dispatchKeys) || body.dispatchKeys.length < 1 || body.dispatchKeys.length > 100
      || body.dispatchKeys.some(key => typeof key !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(key))
      || new Set(body.dispatchKeys).size !== body.dispatchKeys.length
      || (body.queueId != null && (typeof body.queueId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.queueId)))) {
    return res.status(400).json({success: false, message: "Invalid return request"});
  }
  try {
    const result = await mysqlTripReturn().transition({action: body.action, driverId: req.user.uid,
      dispatchKeys: body.dispatchKeys, queueId: body.queueId || null});
    if (result.status !== 200) return res.status(result.status).json({success: false, code: result.code, message: result.message});
    if (result.data.driverStatus) {
      const payload = {driverId: req.user.uid, status: result.data.driverStatus,
        name: req.userProfile?.displayName || "Driver", timestamp: Date.now(), source: "backend_proxy"};
      const io = req.app.get("io");
      io?.to(`driver:${req.user.uid}`).emit("driver_status_change", payload);
      io?.to("staff:tracking").emit("driver_status_change", payload);
    }
    return res.json({success: true, data: result.data});
  } catch (_) {
    return res.status(503).json({success: false, message: "Return status unavailable"});
  }
});

router.post("/assignments/start", verifyToken, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["previousDispatchKey", "nextDispatchKey"].includes(key))
      || typeof body.nextDispatchKey !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.nextDispatchKey)
      || (body.previousDispatchKey != null && (typeof body.previousDispatchKey !== "string"
        || !/^[A-Za-z0-9_-]{1,128}$/.test(body.previousDispatchKey)))) {
    return res.status(400).json({success: false, message: "Invalid active shipment selection"});
  }
  try {
    if (process.env.AUTH_BACKEND !== "mysql") return res.status(503).json({success: false, message: "Assignment API unavailable"});
    const result = await mysqlAssignments().startTrip({driverId: req.user.uid,
      previousDispatchKey: body.previousDispatchKey || null, nextDispatchKey: body.nextDispatchKey});
    return res.status(result.status).json(result.status === 200
      ? {success: true, assignment: result.data}
      : {success: false, code: result.code, message: result.message});
  } catch (_) {
    return res.status(503).json({success: false, message: "Assignment update unavailable"});
  }
});

router.post("/assignments/confirm", verifyToken, async (req, res) => {
  const keys = req.body?.dispatchKeys;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some(key => key !== 'dispatchKeys')
    || !Array.isArray(keys) || keys.length < 1 || keys.length > 100
    || keys.some(key => typeof key !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(key))) {
    return res.status(400).json({success: false, message: "Invalid assignments"});
  }
  try {
    if (process.env.AUTH_BACKEND !== "mysql") return res.status(503).json({success: false, message: "Assignment API unavailable"});
    const result = await mysqlAssignments().confirmMany({dispatchKeys: keys, driverId: req.user.uid});
    return res.status(result.status).json(result.status === 200
      ? {success: true, assignments: result.data}
      : {success: false, code: result.code, message: result.message});
  } catch (_) {
    return res.status(503).json({success: false, message: "Assignment update unavailable"});
  }
});

router.post("/register", verifyToken, registerTrip);

router.post("/assignments/:dispatchKey/update", verifyToken, async (req, res) => {
  const {dispatchKey} = req.params;
  const body = req.body;
  const validStatus = body?.status === null || ["assigned", "loading", "fully_loaded", "loaded", "in_transit", "unloading", "returning_to_base", "completed"].includes(body?.status);
  const allowed = new Set(["status", "driverConfirmed", "guardVerified", "guardFirstName", "guardLastName", "guardMI", "guardSignatureBase64"]);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(dispatchKey) || !body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length === 0 || Object.keys(body).some(key => !allowed.has(key))
    || (body.status !== undefined && !validStatus)
    || ["driverConfirmed", "guardVerified"].some(key => body[key] !== undefined && typeof body[key] !== "boolean")
    || ["guardFirstName", "guardLastName", "guardMI"].some(key => body[key] !== undefined
      && (typeof body[key] !== "string" || body[key].length > 100 || /[\x00-\x1f]/.test(body[key])))
    || (body.guardSignatureBase64 !== undefined && (typeof body.guardSignatureBase64 !== "string"
      || body.guardSignatureBase64.length > 100000 || !/^(data:image\/(png|jpeg);base64,)?[A-Za-z0-9+/]*={0,2}$/.test(body.guardSignatureBase64)))) {
    return res.status(400).json({success: false, message: "Invalid assignment update"});
  }
  try {
    if (process.env.AUTH_BACKEND !== "mysql") return res.status(503).json({success: false, message: "Assignment API unavailable"});
    const result = await mysqlAssignments()
      .updateOwn({dispatchKey, driverId: req.user.uid, patch: body});
    return res.status(result.status).json(result.status === 200
      ? {success: true, assignment: result.data}
      : {success: false, code: result.code, message: result.message});
  } catch (_) {
    return res.status(503).json({success: false, message: "Assignment update unavailable"});
  }
});

module.exports = router;
