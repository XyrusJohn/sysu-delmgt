const express = require("express");
const rateLimit = require("express-rate-limit");
const { protectRoute } = require("../middleware/protectRoute");
const { authorize } = require("../middleware/authorize");
const controller = require("../controllers/systemDiagnosticsController");
const { idempotency } = require("../middleware/idempotency.js");

const router = express.Router();
const reporters = ["driver", "fleet_manager", "admin", "super_admin"];
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  "/report",
  reportLimiter,
  protectRoute,
  authorize(reporters),
  idempotency,
  controller.reportClientError,
);
router.get(
  "/logs",
  protectRoute,
  authorize(["admin", "super_admin"]),
  controller.listSystemErrors,
);
router.get(
  "/diagnostic-runs",
  protectRoute,
  authorize(["admin", "super_admin"]),
  controller.listMobileDiagnosticRuns,
);
router.delete(
  "/diagnostic-runs/:id",
  protectRoute,
  authorize(["admin", "super_admin"]),
  idempotency,
  controller.deleteMobileDiagnosticRun,
);
router.patch(
  "/logs/:id/resolve",
  protectRoute,
  authorize(["admin", "super_admin"]),
  idempotency,
  controller.resolveSystemError,
);
router.post(
  "/logs/recover-operation",
  recoveryLimiter,
  protectRoute,
  authorize(reporters),
  controller.recoverSystemError,
);
router.delete(
  "/logs/:id",
  protectRoute,
  authorize(["admin", "super_admin"]),
  idempotency,
  controller.deleteResolvedSystemError,
);

module.exports = router;
