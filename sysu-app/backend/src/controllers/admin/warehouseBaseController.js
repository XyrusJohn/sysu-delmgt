const { asyncWrapper } = require("../../middleware/asyncWrapper.js");
const { z } = require("zod");

const WAREHOUSE_DOC_ID = "warehouse_base";
const DEFAULT_BASE = {
  name: "SYSU Main Warehouse",
  address: "SYSU International, Quezon City, Metro Manila",
  lat: 14.6349,
  lng: 121.0392,
  radiusMeters: 500,
  updatedAt: new Date().toISOString(),
  updatedBy: "system",
};

const warehouseSchema = z.object({
  lat: z.preprocess((val) => parseFloat(val), z.number().min(-90).max(90)),
  lng: z.preprocess((val) => parseFloat(val), z.number().min(-180).max(180)),
  radiusMeters: z.preprocess(
    (val) => parseFloat(val),
    z.number().min(10).max(50000),
  ),
  name: z.string().trim().max(100).default("SYSU Main Warehouse"),
  address: z.string().trim().max(250).default(""),
});

async function getWarehouseBaseConfig() {
  return require("../../services/mysqlSettings")
    .getMysqlSettings()
    .get(WAREHOUSE_DOC_ID, DEFAULT_BASE);
}

async function saveWarehouseBaseConfig(payload, userUid, displayName) {
  const validated = warehouseSchema.parse(payload);
  const dataToSave = {
    ...validated,
    updatedAt: new Date().toISOString(),
    updatedBy: displayName || userUid || "admin",
    updatedByUid: userUid || null,
  };
  return require("../../services/mysqlSettings")
    .getMysqlSettings()
    .set(WAREHOUSE_DOC_ID, dataToSave, userUid);
}

exports.getWarehouseBaseConfig = getWarehouseBaseConfig;
exports.saveWarehouseBaseConfig = saveWarehouseBaseConfig;

exports.getWarehouseBase = asyncWrapper(async (_req, res) => {
  const data = await getWarehouseBaseConfig();
  return res.status(200).json({ success: true, data });
});

exports.updateWarehouseBase = asyncWrapper(async (req, res) => {
  if (
    !req.mysqlUser ||
    req.mysqlUser.role !== "super_admin" ||
    req.mysqlUser.status !== "active"
  ) {
    return res
      .status(403)
      .json({
        success: false,
        message: "Forbidden: Super Admin access required",
      });
  }
  const saved = await saveWarehouseBaseConfig(
    req.body,
    req.user.uid,
    req.mysqlUser.displayName,
  );
  global._io?.emit("warehouse_base_updated", saved);
  return res.status(200).json({ success: true, data: saved });
});
