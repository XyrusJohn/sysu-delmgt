const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/sapAssignmentController.js");
const { protectRoute } = require("../middleware/protectRoute.js");
const { authorize } = require("../middleware/authorize.js");
const { idempotency } = require("../middleware/idempotency.js");

router.use(protectRoute);
router.use(authorize(["fleet_manager", "admin", "super_admin"]));
router.use(idempotency);

// Peek the earliest eligible driver for a dispatch (used by the modal to
// render hard-locked rows).
router.get("/peek", ctrl.peekEarliest);
router.get("/assignments/:dispatchKey", ctrl.getAssignment);
router.get("/overrides/:requestId", ctrl.getDispatchRequest);
router.get("/overrides", ctrl.getDispatchRequest);
router.get("/cancel/requests/:requestId", ctrl.getDispatchRequest);
router.get("/cancel/requests", ctrl.getDispatchRequest);

// Authoritative assignment write — runs the FIFO transaction.
router.post("/assign", ctrl.assignDriver);

// Dispatcher requests a FIFO bypass (admin approval required).
router.post("/overrides/request", ctrl.requestOverride);

// Admin approves / denies a bypass request (issues a single-use token on approval).
router.post(
  "/overrides/decide",
  authorize(["admin", "super_admin"]),
  ctrl.decideOverride,
);

// Dispatcher cancels their own pending bypass request.
router.post("/overrides/revoke", ctrl.revokeOverride);

// Dispatcher requests admin approval to cancel an already-confirmed assignment.
router.post("/cancel/request", ctrl.requestCancelAssignment);

// Admin approves / denies a cancel request.
router.post(
  "/cancel/decide",
  authorize(["admin", "super_admin"]),
  ctrl.decideCancelAssignment,
);

// Dispatcher revokes their own pending cancel request.
router.post("/cancel/revoke", ctrl.revokeCancelAssignment);

// Last-known locations for every in-flight dispatch (loading / loaded / in_transit).
router.get("/locations", ctrl.getActiveDriverLocations);

module.exports = router;
