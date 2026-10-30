const TYPES = ["AUV", "4W", "6W", "10W", "20F", "40F"];
const KEYS = new Set(["token", "driverId", "driverName", "driverFN", "driverMI", "driverLN", "driverPhone", "truckType", "truckCompany", "plateNumber", "helperName"]);
const safeText = (value, max, optional = false) => typeof value === "string" && value.length <= max
  && !/[\x00-\x1f]/.test(value) && (optional || value.trim().length > 0);
const safeToken = token => typeof token === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(token);
const clean = value => (value || "").replace(/[<>]/g, "").trim();
const qrService = () => require("../services/mysqlQrService").getMysqlQrService();
const errorResponse = (res, error) => {
  const status = [400, 401, 403, 404, 409, 410].includes(error.statusCode || error.status)
    ? (error.statusCode || error.status) : 500;
  return res.status(status).json({success: false,
    message: status === 500 ? "QR service unavailable" : error.message});
};

const generateQR = async (req, res) => {
  if (!req.user?.uid) return res.status(401).json({success: false, message: "Unauthorized"});
  try {
    const url = new URL(process.env.FRONTEND_URL);
    const localFrontend = ["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:";
    if ((!localFrontend && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
      return res.status(409).json({success: false, message: "QR frontend is not configured safely"});
    }
    const generated = await qrService().generate(5 * 60 * 1000);
    return res.status(200).json({success: true, token: generated.token,
      expiresAt: new Date(generated.expiresAtMs).toISOString(),
      scanUrl: url.origin + "/scan?token=" + encodeURIComponent(generated.token)});
  } catch (error) { return errorResponse(res, error); }
};

const verifyQR = async (req, res) => {
  const token = req.query?.token;
  if (!safeToken(token)) return res.status(400).json({success: false, message: "Invalid QR token"});
  try {
    await qrService().verify(token);
    return res.status(200).json({success: true, message: "Token verified", token});
  } catch (error) { return errorResponse(res, error); }
};

const scanQR = async (req, res) => {
  if (!req.user?.uid) return res.status(401).json({success: false, message: "Unauthorized"});
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !KEYS.has(key))
      || !safeToken(body.token) || !safeText(body.driverId, 128) || !safeText(body.driverName, 100)
      || !safeText(body.truckType, 10) || !safeText(body.plateNumber, 20)
      || ["driverFN", "driverMI", "driverLN", "driverPhone", "truckCompany", "helperName"]
        .some(key => body[key] != null && !safeText(body[key], key === "driverPhone" ? 20 : 100, true))) {
    return res.status(400).json({success: false, message: "Invalid QR registration fields"});
  }
  if (body.driverId !== req.user.uid) return res.status(403).json({success: false, message: "Cannot scan for another driver"});
  const truckType = body.truckType.trim().toUpperCase();
  if (!TYPES.includes(truckType)) return res.status(400).json({success: false, message: "Invalid truck type"});
  try {
    const result = await qrService().scan({...body, driverId: req.user.uid, truckType});
    req.app.get("io")?.to("driver:" + req.user.uid).emit("queue_admitted", {queueId: result.queueId});
    return res.status(200).json({success: true, message: "Successfully joined the queue",
      queueId: result.queueId, queuePosition: null});
  } catch (error) { return errorResponse(res, error); }
};

const getQueue = async (req, res) => {
  try {
    const rows = await qrService().listQueue({registeredOnly: req.query.all !== "1"});
    const queue = Object.fromEntries(TYPES.map(type => [type, []]));
    for (const row of rows.slice(0, 100)) {
      if (!TYPES.includes(row.truckType)) continue;
      queue[row.truckType].push({id: row.id, driverId: row.driverId, driverName: row.driverName,
        truckType: row.truckType, plateNumber: row.plateNumber, status: row.status,
        registrationComplete: row.registrationComplete});
    }
    return res.status(200).json({success: true, queue, truncated: rows.length > 100});
  } catch (_) { return res.status(503).json({success: false, message: "Queue unavailable"}); }
};

const updateQueueStatus = (_req, res) => res.status(410).json({success: false, message: "Use the SYSU web queue workflow"});

const cancelQueue = async (req, res) => {
  if (!req.user?.uid) return res.status(401).json({success: false, message: "Unauthorized"});
  const queueId = req.params?.queueId;
  if (typeof queueId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(queueId)
      || (req.body != null && (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length))) {
    return res.status(400).json({success: false, message: "Invalid queue cancellation request"});
  }
  try {
    const result = await qrService().cancelOwn({queueId, driverId: req.user.uid});
    const io = req.app.get("io");
    if (io) {
      const event = {queueId, driverId: req.user.uid, status: result.status};
      io.to("driver:" + req.user.uid).emit("queue_cancelled", event);
      io.to("staff:tracking").emit("queue_cancelled", event);
    }
    return res.status(200).json({success: true, ...result});
  } catch (error) { return errorResponse(res, error); }
};

const positionRequests = new Map();
const getOwnPosition = async (req, res) => {
  const queueId = req.query?.queueId;
  if (typeof queueId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(queueId)) {
    return res.status(400).json({success: false, message: "Invalid queue reference"});
  }
  const now = Date.now();
  let budget = positionRequests.get(req.user.uid);
  if (!budget || now - budget.started >= 60000) {
    budget = {started: now, count: 0};
    positionRequests.delete(req.user.uid);
    positionRequests.set(req.user.uid, budget);
    if (positionRequests.size > 1000) positionRequests.delete(positionRequests.keys().next().value);
  }
  if (++budget.count > 120) return res.status(429).json({success: false, message: "Queue temporarily unavailable"});
  try {
    const result = await qrService().ownPosition(req.user.uid, queueId);
    return res.json({success: true, ...result});
  } catch (error) {
    return res.status(error.statusCode === 404 ? 404 : 503).json({success: false, message: "Queue unavailable"});
  }
};

module.exports = {generateQR, verifyQR, scanQR, getQueue, updateQueueStatus, cancelQueue, getOwnPosition};
