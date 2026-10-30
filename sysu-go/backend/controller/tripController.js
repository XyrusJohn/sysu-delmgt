const TYPES = new Set(["AUV", "4W", "6W", "10W", "20F", "40F"]);
const KEYS = new Set(["queueId", "driverId", "helperFN", "helperMI", "helperLN", "company", "truckType", "platePrefix", "plateSuffix", "driverPhone"]);
const text = (value, max, optional = false) => typeof value === "string" && value.length <= max
  && !/[\x00-\x1f]/.test(value) && (optional || value.trim().length > 0);
const clean = value => value.trim().replace(/[<>$&"|;'\\/]/g, "").replace(/\s+/g, " ");

const registerTrip = async (req, res) => {
  if (!req.user?.uid) return res.status(401).json({success: false, message: "Unauthorized"});
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !KEYS.has(key))
      || !text(body.queueId, 128) || /[/\\]/.test(body.queueId) || [".", ".."].includes(body.queueId)
      || !text(body.helperFN, 50) || !text(body.helperLN, 50) || !text(body.company, 100)
      || !text(body.truckType, 10) || !text(body.platePrefix, 4) || !text(body.plateSuffix, 4)
      || (body.helperMI != null && !text(body.helperMI, 5, true))
      || (body.driverPhone != null && !text(body.driverPhone, 20, true))) {
    return res.status(400).json({success: false, message: "Invalid trip registration fields"});
  }
  if (body.driverId != null && body.driverId !== req.user.uid) {
    return res.status(403).json({success: false, message: "Driver identity mismatch"});
  }
  const truckType = body.truckType.trim().toUpperCase();
  const platePrefix = body.platePrefix.trim().toUpperCase();
  const plateSuffix = body.plateSuffix.trim();
  const helperFN = clean(body.helperFN), helperLN = clean(body.helperLN);
  const helperMI = clean(body.helperMI || "").replace(/[^a-z]/gi, "").slice(0, 1).toUpperCase();
  const company = clean(body.company);
  if (!TYPES.has(truckType) || !/^[A-Z0-9-]{2,4}$/.test(platePrefix) || !/^\d{3,4}$/.test(plateSuffix)
      || !helperFN || !helperLN || !company) {
    return res.status(400).json({success: false, message: "Invalid trip registration fields"});
  }
  try {
    const plateNumber = `${platePrefix}-${plateSuffix}`;
    const result = await require("../services/mysqlTripService").getMysqlTripService().register({
      driverId: req.user.uid, queueId: body.queueId, helperFN, helperMI, helperLN, company, truckType,
      plateNumber, driverPhone: body.driverPhone == null ? null : clean(body.driverPhone),
    });
    req.app.get("io")?.to(`driver:${req.user.uid}`).emit("queue_registration_complete", {queueId: result.queueId});
    return res.status(200).json({success: true, message: "Trip registered successfully", ...result});
  } catch (error) {
    const status = [403, 404, 409].includes(error.status) ? error.status : 503;
    return res.status(status).json({success: false,
      message: status === 503 ? "Unable to register trip" : ({
        403: "Trip registration is not authorized",
        404: "Queue entry not found",
        409: "Queue entry cannot be registered",
      })[status]});
  }
};

module.exports = {registerTrip};
