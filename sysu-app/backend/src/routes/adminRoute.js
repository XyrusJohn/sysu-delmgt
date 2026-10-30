const express = require("express");
const router = express.Router();
const { protectRoute } = require("../middleware/protectRoute.js");
const { requireAdmin } = require("../middleware/requireAdmin.js");
const { idempotency } = require("../middleware/idempotency.js");
const {
  createGuard,
  updateGuard,
  setGuardActive,
  deleteGuard,
} = require("../controllers/admin/guardController.js");
const {
  createTruckCompany,
  updateTruckCompany,
  setTruckCompanyActive,
  deleteTruckCompany,
} = require("../controllers/admin/truckCompanyController.js");
const {
  getWarehouseBase,
  updateWarehouseBase,
} = require("../controllers/admin/warehouseBaseController.js");

router.post("/guards", protectRoute, requireAdmin, idempotency, createGuard);
router.patch("/guards/:id", protectRoute, requireAdmin, idempotency, updateGuard);
router.patch("/guards/:id/active", protectRoute, requireAdmin, idempotency, setGuardActive);
router.delete("/guards/:id", protectRoute, requireAdmin, idempotency, deleteGuard);
router.post("/truck-companies", protectRoute, requireAdmin, idempotency, createTruckCompany);
router.patch(
  "/truck-companies/:code",
  protectRoute,
  requireAdmin,
  idempotency,
  updateTruckCompany,
);
router.patch(
  "/truck-companies/:code/active",
  protectRoute,
  requireAdmin,
  idempotency,
  setTruckCompanyActive,
);
router.delete(
  "/truck-companies/:code",
  protectRoute,
  requireAdmin,
  idempotency,
  deleteTruckCompany,
);
router.get("/warehouse-base", protectRoute, getWarehouseBase);
router.put("/warehouse-base", protectRoute, requireAdmin, idempotency, updateWarehouseBase);

module.exports = router;
