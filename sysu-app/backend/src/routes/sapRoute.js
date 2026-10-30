const express = require("express");
const router = express.Router();
const {
  getSapData,
  getAssignedDispatchDetails,
} = require("../controllers/sapController.js");
const { protectRoute } = require("../middleware/protectRoute.js");
const { authorize } = require("../middleware/authorize.js");

router.get(
  "/shipments",
  protectRoute,
  authorize(["fleet_manager", "admin", "super_admin"]),
  getSapData,
);
router.post(
  "/dispatch-details",
  protectRoute,
  authorize(["fleet_manager", "admin", "super_admin"]),
  getAssignedDispatchDetails,
);

module.exports = router;
