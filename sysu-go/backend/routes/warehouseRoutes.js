const express = require("express");
const {verifyToken} = require("../middleware/auth");

function createWarehouseRouter({service, useMysql = () => process.env.AUTH_BACKEND === "mysql"}) {
  if (!service) throw new TypeError("Warehouse settings service is required");
  const router = express.Router();
  router.get("/base", verifyToken, async (_req, res) => {
    if (!useMysql()) return res.status(503).json({success: false, message: "Warehouse settings unavailable"});
    try {
      return res.json({success: true, data: await service.getWarehouseBase()});
    } catch {
      return res.status(503).json({success: false, message: "Warehouse settings unavailable"});
    }
  });
  return router;
}

module.exports = {createWarehouseRouter};
