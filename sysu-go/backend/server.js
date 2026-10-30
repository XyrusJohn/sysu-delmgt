const path = require("node:path");
const dotenv = require("dotenv");
dotenv.config({path: path.join(__dirname, ".env")});

const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const compression = require("compression");
const http = require("http");
const { Server } = require("socket.io");
const {createApiRateLimiter, loadApiRateLimitConfig, loadTrustedProxy} = require("./config/runtimeSecurity");
const { startHeartbeat } = require("./utils/heartbeatMonitor");
const { startPresenceWatcher } = require("./utils/presenceWatcher");

// ─── Log helper with timestamp ────────────────────────────────────────────────
const ts = () => new Date().toISOString().replace("T", " ").substring(0, 19);

// ─── CORS origins ────────────────────────────────────────────────────────────
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || "http://localhost:5173";
const rawOrigins = process.env.ALLOWED_ORIGINS || FRONTEND_ORIGIN;
const allowedOrigins = rawOrigins.split(",").map((s) => s.trim()).filter(Boolean);
const isAllowedOrigin = (origin, cb) => {
  if (!origin) return cb(null, true);           // mobile apps / Socket.IO have no origin
  if (allowedOrigins.includes(origin)) return cb(null, true);
  if (process.env.NODE_ENV !== "production") return cb(null, true); // dev: allow all
  cb(new Error(`CORS: origin ${origin} not allowed`));
};

const app = express();
const server = http.createServer(app);
const apiRateLimitConfig = loadApiRateLimitConfig(process.env);
app.set("trust proxy", loadTrustedProxy(process.env.TRUST_PROXY));

// ─── CORS ─────────────────────────────────────────────────────────────────
app.use(cors({
  origin: isAllowedOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
}));

// Bound every HTTP API route before parsing request bodies or doing database work.
app.use("/api", createApiRateLimiter(apiRateLimitConfig));

if (process.env.AUTH_BACKEND !== "mysql") throw new Error("AUTH_BACKEND=mysql is required");
const mysqlConfig = require("./config/mysql");
const pool = mysqlConfig.createMySqlPool();
const mysqlLiveLocations = require("./services/mysqlLiveLocations").createMysqlLiveLocations({pool});
const mysqlMasterData = require("./services/mysqlMasterData").createMysqlMasterData({pool});
const mysqlDriverProfiles = require("./services/mysqlDriverProfiles").getMysqlDriverProfiles({pool});
const mysqlQrService = require("./services/mysqlQrService").getMysqlQrService({pool});
const mysqlAssignments = require("./services/mysqlAssignments").getMysqlAssignments({pool});
require("./services/mysqlTripReturn").getMysqlTripReturn({pool});
const mysqlDriverActionAudit = require("./services/mysqlDriverActionAudit").createMysqlDriverActionAudit({pool});
const mysqlSettings = require("./services/mysqlSettings").createMysqlSettings({pool});
const mysqlAuthService = require("./services/mysqlAuthSingleton").getMysqlAuthService({pool});
const systemDiagnostics = require('./services/mysqlSystemDiagnostics').createMysqlSystemDiagnostics({pool});
const mysqlAuthRouter = require("./routes/mysqlAuthRoute").createMysqlAuthRouter({service: mysqlAuthService});
app.use("/api/auth/mysql", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.method === "GET" && req.path === "/session",
}));
app.use("/api/auth/mysql/session", rateLimit({windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false}));
app.use("/api/auth/mysql", express.json({limit: "10kb"}));

app.use(compression());

app.use((req, res, next) => {
  req.requestId = require('node:crypto').randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});
app.use(require('./middleware/systemErrorResponseLogger').createSystemErrorResponseLogger({
  diagnosticsFactory: () => systemDiagnostics,
}));
app.use('/api/system-errors/report', express.json({limit: '10kb'}));
app.use(express.json({ limit: "10mb" }));
app.use('/api', require('./middleware/httpIdempotency').createHttpIdempotencyMiddleware({
  pool,
  serviceName: 'sysu-go',
  authenticateSession: token => mysqlAuthService.authenticate(token),
}));
app.use("/api/auth/mysql", mysqlAuthRouter);

// ─── Routes ─────────────────────────────────────────────────────────────────
const qrRoutes = require("./routes/qrRoutes.js");
const sapRoutes = require("./routes/sapRoutes.js");

// ─── Socket.IO ─────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: isAllowedOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 30000,
  pingInterval: 10000,
});
app.set("io", io);

// ─── Health routes ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).json({ success: true, message: "SYSU Go API is running." });
});

app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/api/health/ready", require('./routes/healthReadyRoute').createDatabaseReadinessHandler({
  databaseName: mysqlConfig.loadMySqlConfig().database,
  probe: () => pool.query('SELECT 1 FROM app_api_idempotency, app_system_error_logs LIMIT 0'),
}));

// ─── API routes ─────────────────────────────────────────────────────────────
app.use("/api/qr", qrRoutes);
app.use("/api/sap", sapRoutes);
app.use("/api/users", require("./routes/userRoutes.js"));
app.use("/api/dispatch", require("./routes/dispatchRoutes.js"));
app.use("/api/trip", require("./routes/tripRoute.js"));
app.use("/api/driver", require("./routes/driverStatusRoutes.js"));
app.use("/api/pod", require("./routes/podRoutes.js"));
if (mysqlSettings) app.use("/api/warehouse", require("./routes/warehouseRoutes").createWarehouseRouter({service: mysqlSettings}));
app.use('/api/system-errors', require('./routes/systemDiagnosticsRoutes')({service: systemDiagnostics}));

app.use((err, req, res, next) => {
  const status = err.type === "entity.parse.failed" ? 400 : err.type === "entity.too.large" ? 413 : 500;
  console.error("[SERVER ERROR]", status);
  res.status(status).json({ success: false, message: status === 400 ? "Invalid request body" : status === 413 ? "Request too large" : "Internal Server Error" });
});

app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: `API Route ${req.method} ${req.originalUrl} not found` });
});

// ─── API routes ─────────────────────────────────────────────────────────────


// ─── Socket.IO handshake logic ──────────────────────────────────────────────
// onlineDriver tracks ALL live sockets per driver using a Set.
// Driver is OFFLINE only when Set is EMPTY. This handles dual-socket connections
// (Railway + sysu-app) correctly — Ctrl+Shift+R / reconnect / WiFi-kill on one
// socket must NOT mark driver offline if another socket is still alive.
//
// `lastSeen` is the timestamp of the most recent client→server emit (heartbeat,
// driver_moving, update_status, driver_status_change). The presence watcher
// (utils/presenceWatcher.js) uses this to detect drivers whose network has died
// silently — Socket.IO doesn't always fire EVENT_DISCONNECT fast enough on
// DNS-broken / captive-portal scenarios, so a heartbeat timeout is the
// authoritative "this driver is gone" signal.
const onlineDriver = new Map();
const locationSamples = new Map();
const closedTracking = new Map();
const activeLocationStatuses = new Set(['assigned', 'loading', 'loaded', 'fully_loaded', 'in_transit', 'returning_to_base']);
function locationPayload(uid, entry) {
  return {driverId: uid, lat: entry.lat, lng: entry.lng, name: entry.name,
    sapDocId: entry.sapDocId || null, status: entry.isOffline ? 'offline' : entry.status,
    timestamp: entry.locationTimestamp || 0};
}

const { createSocketAuth } = require("./middleware/socketAuth.js");
const TRACKING_ROLES = new Set(["fleet_manager", "admin", "super_admin"]);
io.use(createSocketAuth({authenticateSession: token => mysqlAuthService.authenticate(token)}));

/**
 * Touch the driver's lastSeen timestamp to "now". Called from every client
 * event handler so an idle driver (no GPS movement) still keeps their
 * online flag alive as long as they're sending heartbeats.
 */
function touchLastSeen(uid) {
  const entry = onlineDriver.get(uid);
  if (entry) entry.lastSeen = Date.now();
}

/**
 * Centralised offline-protection gate.
 *
 * Returns true if the driver has at least one sap_assignment that is NOT
 * yet completed — i.e. they still have active work (assigned / loading /
 * loaded / fully_loaded / in_transit).
 *
 * This is the AUTHORITATIVE source of truth for "should we retain this
 * driver's last-known position on the admin map when they go offline?"
 * Using the SQL assignment table (not socket-derived state) guarantees correctness across:
 *   - Server restarts (in-memory Map is wiped)
 *   - Driver force-kills (socket state was never fully hydrated)
 *   - Race conditions between disconnect and status events
 *
 * Reads the indexed SQL assignment state for each offline event.
 *
 * @param {string} uid  authenticated driver ID
 * @returns {Promise<boolean>}
 */
async function hasActiveShipment(uid) {
  try {
    return await mysqlAssignments.hasActiveShipment(uid);
  } catch (_) {
    console.error(`[${ts()}] [hasActiveShipment] MySQL unavailable; retaining last known location`);
    return true;
  }
}

/**
 * Valid driver lifecycle statuses broadcast via driver_status_change.
 * Anything outside this set is rejected by the server.
 */
const DRIVER_LIFECYCLE_STATUSES = new Set([
  "online",
  "offline",
  "in_transit",
  "returning_to_base",
]);

io.on("connection", async (socket) => {
  require("./services/realtimeSubscriptions").bindRealtimeSubscriptions(socket,
    {mysqlMasterData, mysqlDriverProfiles, mysqlAuthService, mysqlQrService, mysqlAssignments, mysqlLiveLocations});
  mysqlDriverActionAudit.bind(socket, {io});
  const verifiedUid = socket.data.uid;
  const role = socket.data.role;
  console.log("[" + ts() + "] Authenticated socket connected: " + socket.id + " (" + role + ")");

  if (role === "driver") {
    socket.join("driver:" + verifiedUid);
    const entry = onlineDriver.get(verifiedUid);
    if (entry) { entry.socketIds.add(socket.id); entry.lastSeen = Date.now(); }
  } else if (TRACKING_ROLES.has(role)) {
    socket.join("staff:tracking");
    if (role === "admin" || role === "super_admin") socket.join("staff:system-diagnostics");
    if (mysqlLiveLocations) {
      try {
        const savedLocations = await mysqlLiveLocations.list();
        for (const saved of savedLocations) {
          if (!activeLocationStatuses.has(saved.status) || saved.lat == null || saved.lng == null) continue;
          if (!(await hasActiveShipment(saved.driverId))) continue;
          const payload = {...saved, status: saved.status, timestamp: saved.timestamp};
          socket.emit("vendor_status_update", payload);
          socket.emit("update_admin_map", payload);
        }
      } catch (_) {
        console.error(`[${ts()}] [Socket] MySQL tracking replay unavailable`);
      }
    }
    for (const [otherId, entry] of onlineDriver.entries()) {
      const hasLiveSocket = Array.from(entry.socketIds).some(sid => io.sockets.sockets.get(sid));
      if (!hasLiveSocket || entry.status === "completed" || entry.lat == null || entry.lng == null || entry.lat === 0 || entry.lng === 0) continue;
      if (!(await hasActiveShipment(otherId))) continue;
      const payload = locationPayload(otherId, entry);
      socket.emit("vendor_status_update", payload);
      socket.emit("update_admin_map", payload);
    }
  }

  socket.on("update_status", async (data) => {
    try {
      if (!data) data = {};
      const targetDriverId = data.driverId || verifiedUid;
      if (!verifiedUid || (data.driverId && data.driverId !== verifiedUid)) {
        console.warn(`[${ts()}] [Socket] update_status rejected: unauthorized (socket ${socket.id})`);
        return;
      }

      const { status, lat, lng } = data;

      let fullName = "Unknown Driver";
      try {
        const driverInfo = await mysqlDriverProfiles.get(verifiedUid);
        if (driverInfo?.name) fullName = driverInfo.name;
      } catch (err) {
        console.error(`[${ts()}] DB Error in Socket:`, err);
      }

      if (status === "online") {
        const hasActive = await hasActiveShipment(verifiedUid);
        const validCoords = (typeof lat === "number" && typeof lng === "number" && lat !== 0 && lng !== 0);
        const entry = onlineDriver.get(verifiedUid);
        if (entry) {
          entry.socketIds.add(socket.id);
          entry.name = fullName;
          if (!['stopped', 'returning_to_base'].includes(entry.status)) entry.status = "online";
          entry.isOffline = false;
          entry.offlineSince = null;
          entry.lastSeen = Date.now();
          if (validCoords && entry.locationTimestamp == null) {
            entry.lat = lat;
            entry.lng = lng;
            entry.locationTimestamp = 0;
          }
          if (hasActive && validCoords) {
            io.to("staff:tracking").emit("vendor_status_update", {...locationPayload(verifiedUid, entry), timestamp: Date.now(), locationTimestamp: entry.locationTimestamp});
          }
          console.log(`[${ts()}] Driver ${fullName} back ONLINE (${entry.socketIds.size} active sockets, hasActive=${hasActive})`);
        } else {
          onlineDriver.set(verifiedUid, {
            name: fullName,
            lat: validCoords ? lat : null,
            lng: validCoords ? lng : null,
            socketIds: new Set([socket.id]),
            status: "online",
            isOffline: false,
            tripStatus: null,
            locationTimestamp: 0,
            lastSeen: Date.now(),
          });
          console.log(`[${ts()}] Driver ${fullName} is now ONLINE (hasActive=${hasActive})`);
          if (hasActive && validCoords) {
            io.to("staff:tracking").emit("vendor_status_update", {driverId: verifiedUid, status: 'online', name: fullName,
              lat, lng, timestamp: Date.now(), locationTimestamp: 0});
          }
        }
      } else if (status === "completed") {
        closedTracking.set(verifiedUid, Date.now());
        locationSamples.delete(verifiedUid);
        if (closedTracking.size > 1000) closedTracking.delete(closedTracking.keys().next().value);
        onlineDriver.delete(verifiedUid);
        io.to("staff:tracking").emit("update_status", { driverId: verifiedUid, status: "completed", name: fullName, timestamp: Date.now() });
        io.to("staff:tracking").emit("vendor_status_update", { driverId: verifiedUid, status: "completed", name: fullName, lat: null, lng: null, timestamp: Date.now() });
        console.log(`[${ts()}] Driver ${fullName} COMPLETED trip [marker removed from map]`);
      } else if (status === "stopped") {
        const entry = onlineDriver.get(verifiedUid);
        if (!entry) return;
        entry.status = "stopped";
        entry.lastSeen = Date.now();
        io.to("staff:tracking").emit("vendor_status_update", {...locationPayload(verifiedUid, entry), timestamp: Date.now(), locationTimestamp: entry.locationTimestamp});
      } else {
        const entry = onlineDriver.get(verifiedUid);
        const offlineLat = entry ? entry.lat : null;
        const offlineLng = entry ? entry.lng : null;

        const active = await hasActiveShipment(verifiedUid);
        if (active && offlineLat != null && offlineLng != null) {
          if (entry) {
            entry.isOffline = true;
            entry.offlineSince = Date.now();
            entry.socketIds.clear();
          }
          io.to("staff:tracking").emit("update_status", { driverId: verifiedUid, status: "offline_in_transit", name: fullName });
          io.to("staff:tracking").emit("vendor_status_update", {
            driverId: verifiedUid,
            status: "offline_in_transit",
            name: fullName,
            lat: offlineLat,
            lng: offlineLng,
            offlineSince: entry ? entry.offlineSince : Date.now(),
          });
          console.log(`[${ts()}] Driver ${fullName} OFFLINE — has active shipment, retaining last position [${offlineLat}, ${offlineLng}]`);
        } else {
          onlineDriver.delete(verifiedUid);
          io.to("staff:tracking").emit("update_status", { driverId: verifiedUid, status: "offline", name: fullName });
          io.to("staff:tracking").emit("vendor_status_update", { driverId: verifiedUid, status: "offline", name: fullName, lat: offlineLat, lng: offlineLng });
          console.log(`[${ts()}] Driver ${fullName} is now OFFLINE — no active shipment, marker removed`);
        }
      }
    } catch (err) {
      console.error(`[${ts()}] Error in update_status:`, err);
    }
  });

  /**
   * Real-time GPS movement events from mobile app.
   * Auth required: driverId must match verifiedUid from the authenticated session.
   */
  socket.on("driver_moving", async (data, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
    const reject = code => reply({ok: false, code});
    try {
      if (!data || data.driverId !== verifiedUid) return reject('DRIVER_MISMATCH');
      const {lat, lng, sapDocId} = data;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)
        || Math.abs(lat) > 90 || Math.abs(lng) > 180) return reject('INVALID_COORDINATES');
      const receivedAt = Date.now();
      let sampledAt;
      if (data.fixAgeMs != null) {
        if (!Number.isFinite(data.fixAgeMs) || data.fixAgeMs < 0 || data.fixAgeMs > 15000) return reject('STALE_LOCATION');
        sampledAt = receivedAt - data.fixAgeMs;
      } else {
        sampledAt = data.timestamp == null ? receivedAt : data.timestamp;
        if (!Number.isFinite(sampledAt) || sampledAt > receivedAt + 5000 || receivedAt - sampledAt > 15000) return reject('STALE_LOCATION');
      }
      if (data.accuracyMeters != null && (!Number.isFinite(data.accuracyMeters) || data.accuracyMeters < 0 || data.accuracyMeters > 50)) return reject('GPS_ACCURACY_TOO_LOW');
      const prior = locationSamples.get(verifiedUid);
      if (prior && sampledAt < prior.sampledAt) return reject('OUT_OF_ORDER_LOCATION');
      const sample = {sampledAt};
      locationSamples.set(verifiedUid, sample);
      if (locationSamples.size > 1000) locationSamples.delete(locationSamples.keys().next().value);
      let ownedSapDocId = null;
      let assignmentStatus = null;
      if (typeof sapDocId === 'string' && sapDocId) {
        try {
          const record = await mysqlAssignments.get(sapDocId);
          if (record && record.driverId === verifiedUid && activeLocationStatuses.has(record.tripStatus)) {
            ownedSapDocId = sapDocId;
            assignmentStatus = record.tripStatus;
          }
        } catch (_) { /* Unverified shipment links are excluded from tracking. */ }
      }
      if (locationSamples.get(verifiedUid) !== sample || !socket.connected) return reject('SUPERSEDED_LOCATION');
      if (closedTracking.has(verifiedUid) && (!ownedSapDocId || sampledAt <= closedTracking.get(verifiedUid))) return reject('TRIP_CLOSED');
      if (ownedSapDocId) closedTracking.delete(verifiedUid);
      let entry = onlineDriver.get(verifiedUid);
      if (!entry) {
        const driver = await mysqlDriverProfiles.get(verifiedUid);
        if (locationSamples.get(verifiedUid) !== sample || !socket.connected) return reject('SUPERSEDED_LOCATION');
        entry = {name: driver?.name || 'Driver', socketIds: new Set()};
        onlineDriver.set(verifiedUid, entry);
      }
      const status = assignmentStatus === 'returning_to_base' || (!assignmentStatus && entry.status === 'returning_to_base')
        ? 'returning_to_base' : data.status === 'stopped' ? 'stopped' : 'online';
      Object.assign(entry, {lat, lng, status, sapDocId: ownedSapDocId, tripStatus: assignmentStatus || entry.tripStatus,
        locationTimestamp: sampledAt, lastSeen: receivedAt, isOffline: false, offlineSince: null});
      entry.socketIds.add(socket.id);
      const payload = locationPayload(verifiedUid, entry);
      if (mysqlLiveLocations) {
        await mysqlLiveLocations.save({driverId: verifiedUid, sapAssignmentId: ownedSapDocId, name: entry.name,
          lat, lng, status: assignmentStatus || status, sampledAt, receivedAt});
      } else return reject('LOCATION_STORAGE_UNAVAILABLE');
      const trackingRecipients = io.sockets.adapter.rooms.get('staff:tracking')?.size || 0;
      io.to('staff:tracking').emit('update_admin_map', payload);
      io.to('staff:tracking').emit('vendor_status_update', payload);
      reply({ok: true, timestamp: sampledAt, trackingRecipients});
    } catch (error) {
      console.error(`[${ts()}] [Socket] Location update unavailable (${error.code || error.name || 'unknown'})`);
      reject('LOCATION_UNAVAILABLE');
    }
  });

  /**
   * Stationary stopped event from mobile app
   */
  socket.on("driver_stopped", async (data) => {
    if (!data) return;
    const entry = onlineDriver.get(verifiedUid);
    if (!entry) return;
    if (Number.isFinite(data.timestamp) && data.timestamp < (entry.locationTimestamp || 0)) return;
    entry.status = entry.status === 'returning_to_base' ? entry.status : 'stopped';
    touchLastSeen(verifiedUid);
    io.to('staff:tracking').emit('vendor_status_update', {...locationPayload(verifiedUid, entry), timestamp: Date.now(), locationTimestamp: entry.locationTimestamp});
  });

  /**
   * Lifecycle status changes for the driver
   */
  socket.on("driver_status_change", async (data) => {
    try {
      if (!data) data = {};
      const targetDriverId = data.driverId || verifiedUid;
      if (!verifiedUid || (data.driverId && data.driverId !== verifiedUid)) {
        console.warn(`[${ts()}] [Socket] driver_status_change rejected: unauthorized (socket ${socket.id})`);
        return;
      }

      const { status, name, timestamp } = data;
      const VALID_STATUSES = new Set(["online", "offline", "in_transit", "returning_to_base"]);
      if (!status || !VALID_STATUSES.has(status)) {
        console.warn(`[${ts()}] [Socket] driver_status_change rejected: invalid status '${status}'`);
        return;
      }

      const canonicalDriver = await mysqlDriverProfiles.get(verifiedUid);
      if (!canonicalDriver) return;
      const fullName = canonicalDriver.name || "Driver";
      const driverName = fullName;

      try {
        await mysqlDriverProfiles.setStatus(verifiedUid, status);
      } catch (err) {
        console.error("[Socket] driver_status_change persistence failed");
        return;
      }

      const entry = onlineDriver.get(verifiedUid);
      if (entry) {
        entry.status = status;
        entry.name = fullName;
        if (status === "in_transit") entry.tripStatus = "in_transit";
        else if (status === "online") { entry.tripStatus = null; entry.isOffline = false; }
        else if (status === "returning_to_base") entry.tripStatus = null;
        touchLastSeen(verifiedUid);
      } else if (status !== "offline") {
        onlineDriver.set(verifiedUid, {
          name: fullName,
          lat: null,
          lng: null,
          socketIds: new Set([socket.id]),
          status,
          tripStatus: status === "in_transit" ? "in_transit" : null,
          isOffline: false,
          lastSeen: Date.now(),
        });
      }

      const payload = {
        driverId: verifiedUid,
        status,
        name: driverName,
        timestamp: Date.now(),
      };
      io.to(`driver:${verifiedUid}`).emit("driver_status_change", payload);
      io.to("staff:tracking").emit("driver_status_change", payload);
      console.log(`[${ts()}] [Socket] driver_status_change → ${status} for ${driverName} (${verifiedUid})`);
    } catch (err) {
      console.error(`[${ts()}] Error in driver_status_change:`, err);
    }
  });

  socket.on("request_driver_status", async (data) => {
    try {
      if (!data) data = {};
      if (!verifiedUid || (data.driverId && data.driverId !== verifiedUid)) {
        console.warn(`[${ts()}] [Socket] request_driver_status rejected: unauthorized (socket ${socket.id})`);
        return;
      }
      let currentStatus = "online";
      let fullName = "Driver";
      try {
        const driver = await mysqlDriverProfiles.get(verifiedUid);
        if (driver) {
          currentStatus = driver.status || currentStatus;
          fullName = driver.name || fullName;
        }
      } catch (_) {
        console.error(`[${ts()}] [Socket] request_driver_status MySQL read unavailable`);
      }
      const payload = {
        driverId: verifiedUid,
        status: currentStatus,
        name: fullName,
        timestamp: Date.now(),
      };
      socket.emit("driver_status_change", payload);
      console.log(`[${ts()}] [Socket] request_driver_status → ${currentStatus} for ${fullName}`);
    } catch (err) {
      console.error(`[${ts()}] Error in request_driver_status:`, err);
    }
  });

  socket.on("pod_updated", async (data) => {
    try {
      if (role !== "driver" || typeof data?.shipmentDocId !== "string") return;
      const assignment = await mysqlAssignments.get(data.shipmentDocId);
      if (!assignment || assignment.driverId !== verifiedUid) return;
      io.to("staff:tracking").emit("pod_updated", { shipmentDocId: data.shipmentDocId, driverId: verifiedUid, source: "driver_app" });
    } catch (_) { /* Do not expose assignment details to socket clients. */ }
  });

  socket.on("disconnect", async (reason) => {
    console.log(`[${ts()}] System Disconnected: ${socket.id} (Reason: ${reason})`);

    for (const [id, entry] of onlineDriver.entries()) {
      if (!entry.socketIds.has(socket.id)) continue;
      entry.socketIds.delete(socket.id);

      if (entry.socketIds.size === 0) {
        // Treat a transport disconnect as transient until the heartbeat timeout expires.
        // The presence watcher then marks a genuinely unreachable driver offline.
        console.log(`[${ts()}] Driver ${entry.name} socket disconnected; retaining presence during heartbeat grace period`);
      } else {
        // Other socket(s) still alive — driver stays online, just lost one socket
        console.log(`[${ts()}] Driver ${entry.name} still online via ${entry.socketIds.size} other socket(s)`);
      }
      break;
    }
  });

  /**
   * Heartbeat ping from the client. The client emits this every ~15s while
   * online so an idle driver (no GPS movement, no lifecycle changes) still
   * refreshes their lastSeen timestamp. The presence watcher
   * (utils/presenceWatcher.js) uses lastSeen to detect drivers whose
   * network has died silently — no EVENT_DISCONNECT fired, just silent loss.
   *
   * Auth required: same as other driver events.
   */
  socket.on("heartbeat", () => {
    if (!verifiedUid) return;
    const entry = onlineDriver.get(verifiedUid);
    if (entry) {
      entry.lastSeen = Date.now();
      // No need to broadcast or persist — heartbeats are silent keep-alives.
      // Just log at debug level so we can verify the cadence in prod.
      console.log(`[${ts()}] [Heartbeat] ${entry.name} (${verifiedUid})`);
    }
  });
});

// ─── Start server ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "8080", 10);

// Destroy sockets idle for > 30s (avoids holding connections indefinitely)
server.on("timeout", (socket) => {
  socket.destroy();
  console.warn(`[${ts()}] [SERVER] Idle socket destroyed: ${socket.remoteAddress}`);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[${ts()}] [ENV] PORT=${process.env.PORT}`);
  console.log(`[${ts()}] 🚀 Server + Socket.IO running on port ${PORT}`);
  // Start internet connectivity heartbeat monitor
  startHeartbeat();
  // Start presence watcher — scans onlineDriver Map every 15s and marks
  // drivers OFFLINE if their lastSeen is older than HEARTBEAT_TIMEOUT_MS.
  // This is the authoritative "this driver is offline" detector — fires
  // even when Socket.IO EVENT_DISCONNECT doesn't (DNS-broken / captive
  // portal scenarios where the TCP socket hangs without a FIN).
  startPresenceWatcher(onlineDriver, io, {mysqlAssignments, mysqlDriverProfiles, mysqlLiveLocations});
});
