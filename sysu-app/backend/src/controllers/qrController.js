const { asyncWrapper } = require("../middleware/asyncWrapper.js");
const { z } = require("zod");

const TOKEN_EXPIRY_HOURS = 48;
const PUBLIC_TRUCK_TYPES = ["AUV", "4W", "6W", "10W", "20F", "40F"];
const qrService = () =>
  require("../services/mysqlQrService").getMysqlQrService();

const scanTokenSchema = z.object({
  token: z.string().min(1),
  driverId: z.string().min(1),
  driverName: z.string().optional(),
  truckType: z.string().min(1),
  plateNumber: z.string().min(1),
  truckCompany: z.string().optional(),
  helperName: z.string().optional(),
});
const updateStatusSchema = z.object({
  queueId: z.string().min(1),
  status: z.enum(["waiting", "loading", "complete"]),
});

async function getRegisteredQueue() {
  const rows = await qrService().listQueue();
  const queues = Object.fromEntries(
    PUBLIC_TRUCK_TYPES.map((type) => [type, []]),
  );
  const text = (value, max) =>
    typeof value === "string" ? value.slice(0, max) : "";
  for (const row of rows.slice(0, 100)) {
    const type = text(row.truckType, 10).toUpperCase();
    if (!PUBLIC_TRUCK_TYPES.includes(type) || row.isAssigned) continue;
    queues[type].push({
      position: queues[type].length + 1,
      driverName: text(row.driverName, 100),
      plateNumber: text(row.plateNumber, 20),
      status: row.status === "called" ? "called" : "waiting",
    });
  }
  return {
    queues,
    truncated: rows.length > 100,
    asOf: new Date().toISOString(),
  };
}

module.exports = {
  getPublicQueue: asyncWrapper(async (_req, res) => {
    const data = await getRegisteredQueue();
    const queues = Object.fromEntries(
      Object.entries(data.queues).map(([type, rows]) => [
        type,
        rows.map(({ position }) => ({ position })),
      ]),
    );
    return res.json({ success: true, data: { ...data, queues } });
  }),

  getQueueCards: asyncWrapper(async (req, res) => {
    if (
      !req.userData ||
      (req.userData.status !== undefined && req.userData.status !== "active")
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Active staff account required" });
    }
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: await getRegisteredQueue() });
  }),

  generateToken: asyncWrapper(async (_req, res) => {
    const result = await qrService().generate(
      TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
    );
    return res.status(200).json({ success: true, token: result.token });
  }),

  verifyToken: asyncWrapper(async (req, res) => {
    const { token } = req.query;
    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "Token is required" });
    try {
      await qrService().verify(token);
      return res
        .status(200)
        .json({ success: true, message: "Token verified", token });
    } catch (error) {
      const status = [400, 404, 410].includes(error.status)
        ? error.status
        : 503;
      return res
        .status(status)
        .json({
          success: false,
          message: status === 503 ? "QR service unavailable" : error.message,
        });
    }
  }),

  scanToken: asyncWrapper(async (req, res) => {
    if (req.userData?.role !== "driver" || req.userData?.status !== "active") {
      return res
        .status(403)
        .json({ success: false, message: "Active driver account required" });
    }
    const {
      token,
      driverId,
      driverName,
      truckType,
      plateNumber,
      truckCompany,
      helperName,
    } = scanTokenSchema.parse(req.body);
    if (driverId !== req.user.uid)
      return res
        .status(403)
        .json({ success: false, message: "Cannot scan for another driver" });
    try {
      const result = await qrService().scan({
        token,
        driverId,
        driverName,
        truckType,
        plateNumber,
        truckCompany,
        helperName,
      });
      global._qrNs?.emit("qr_token_used", { token });
      return res
        .status(200)
        .json({
          success: true,
          message: "Successfully joined the queue",
          queueId: result.queueId,
        });
    } catch (error) {
      const status = [400, 401, 403, 404, 409, 410].includes(error.status)
        ? error.status
        : 503;
      return res
        .status(status)
        .json({
          success: false,
          message: status === 503 ? "QR service unavailable" : error.message,
        });
    }
  }),

  updateQueueStatus: asyncWrapper(async (req, res) => {
    const { queueId, status } = updateStatusSchema.parse(req.body);
    await qrService().updateStatus(queueId, status);
    return res.status(200).json({ success: true, message: "Status updated" });
  }),
};
