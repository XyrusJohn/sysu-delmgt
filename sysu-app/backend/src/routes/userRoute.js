const express = require("express");
const router = express.Router();
const { protectRoute } = require("../middleware/protectRoute.js");
const { authorize } = require("../middleware/authorize.js");
const { idempotency } = require("../middleware/idempotency.js");
const {
  updateUserRole,
  deleteUser,
} = require("../controllers/userController.js");

router.post(
  "/update-role",
  protectRoute,
  authorize(["admin", "super_admin"]),
  idempotency,
  updateUserRole,
);
router.post("/delete", protectRoute, authorize(["super_admin"]), idempotency, deleteUser);

module.exports = router;
