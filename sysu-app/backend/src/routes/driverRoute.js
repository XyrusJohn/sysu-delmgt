const express = require("express");
const router = express.Router();
const { protectRoute } = require("../middleware/protectRoute.js");
const { authorize } = require("../middleware/authorize.js");
const { idempotency } = require("../middleware/idempotency.js");
const {
  getDriver,
  updateDriverFull,
  saveDriverProfile,
  deleteDriverProfile,
} = require("../controllers/driverController.js");

// Authenticated driver sync; drivers may read only their own profile.
router.get(
  "/:driverId",
  protectRoute,
  authorize(["driver", "fleet_manager", "admin", "super_admin"]),
  getDriver,
);

// Declare truck full / available again — authenticated (driver only)
router.patch(
  "/:driverId/full",
  protectRoute,
  authorize(["driver", "admin", "super_admin"]),
  idempotency,
  updateDriverFull,
);
router.put(
  "/:driverId/profile",
  protectRoute,
  authorize(["fleet_manager", "admin", "super_admin"]),
  idempotency,
  saveDriverProfile,
);
router.delete(
  "/:driverId/profile",
  protectRoute,
  authorize(["admin", "super_admin"]),
  idempotency,
  deleteDriverProfile,
);

module.exports = router;
