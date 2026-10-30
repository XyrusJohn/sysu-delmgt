const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const dotenv = require("dotenv");
const path = require("node:path");
const cron = require("node-cron");
dotenv.config({ path: path.resolve(__dirname, "../.env") });
for (const key of [
  "DB_ADMIN_HOST",
  "DB_ADMIN_PORT",
  "DB_ADMIN_USER",
  "DB_ADMIN_PASSWORD",
]) {
  delete process.env[key];
}
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const runtimeConfig = require("./config/runtime").loadRuntimeConfig(
  process.env,
);
const port = runtimeConfig.port;

if (process.env.AUTH_BACKEND !== "mysql")
  throw new Error("AUTH_BACKEND=mysql is required");

const authRoutes = require("./routes/authRoute.js");
const sapRoutes = require("./routes/sapRoute.js");
const sapAssignmentRoutes = require("./routes/sapAssignmentRoute.js");
const userRoutes = require("./routes/userRoute.js");
const qrRoutes = require("./routes/qrRoute.js");
const driverRoutes = require("./routes/driverRoute.js");
const adminRoutes = require("./routes/adminRoute.js");
const systemDiagnosticsRoutes = require("./routes/systemDiagnosticsRoute.js");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use((req, res, next) => {
  req.requestId = require("node:crypto").randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
});
app.use(
  require("./middleware/systemErrorResponseLogger").systemErrorResponseLogger,
);
const allowedOrigins = runtimeConfig.allowedOrigins;
app.use(require("./middleware/corsPolicy")(allowedOrigins));
// Health probes bypass office/API traffic quotas and never disclose credentials.
const mysqlConfig = require("./config/mysql");
const readinessPool = mysqlConfig.createMySqlPool();
app.use(
  "/health",
  require("./routes/healthRoute")({
    probe: async () => {
      if (mysqlConfig.loadMySqlConfig().database !== "sysu_fleet_app")
        throw new Error("Central database is not configured");
      await readinessPool.query(
        "SELECT 1 FROM app_api_idempotency, app_system_error_logs LIMIT 0",
      );
    },
    version: (
      process.env.RELEASE_VERSION || require("../package.json").version
    ).slice(0, 128),
    timeoutMs: runtimeConfig.readinessTimeoutMs,
  }),
);

// ── Global Middleware ──
const { errorHandler } = require("./middleware/errorHandler");

// ── Rate limiting ──
app.set("trust proxy", runtimeConfig.trustProxy);

const globalLimiter = rateLimit({
  windowMs: runtimeConfig.rateWindowMs,
  max: runtimeConfig.globalLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET" && req.path === "/api/auth/mysql/session",
});
const authLimiter = rateLimit({
  windowMs: runtimeConfig.rateWindowMs,
  max: runtimeConfig.authLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET" && req.path === "/mysql/session",
});
const sessionReadLimiter = rateLimit({
  windowMs: runtimeConfig.rateWindowMs,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: runtimeConfig.rateWindowMs,
  max: runtimeConfig.adminLimit,
  standardHeaders: true,
  legacyHeaders: false,
});

// Frequent kiosk reads share a bounded quota without exhausting other API requests.
const queueReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use((req, res, next) => {
  const isQueueRead =
    req.method === "GET" &&
    ["/api/qr/queue-display", "/api/qr/queue-cards"].includes(req.path);
  return (isQueueRead ? queueReadLimiter : globalLimiter)(req, res, next);
});
app.use("/api/auth", authLimiter);
app.use("/api/auth/mysql/session", sessionReadLimiter);
app.use("/api/users", adminLimiter);

app.use(express.json({ limit: "10kb" }));
app.use("/api/auth", authRoutes);
const pool = require("./config/mysql").createMySqlPool();
const service = require("./services/mysqlAuthSingleton").getMysqlAuthService({
  pool,
});
app.use(
  "/api/auth/mysql",
  require("./routes/mysqlAuthRoute").createMysqlAuthRouter({ service }),
);
app.use("/api/sap", sapRoutes);
app.use("/api/sap", sapAssignmentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/qr", qrRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/system-errors", systemDiagnosticsRoutes);

app.use(errorHandler);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Idempotency-Key"],
    credentials: true,
  },
});

/* ── Public QR namespace — no auth required ── */
const qrNs = io.of("/qr");
qrNs.on("connection", () => {
  // Public — no auth needed. qr-generator.html listens here for qr_token_used events.
});

// Profiles use a separate namespace so pending users can read only their own
// profile without weakening the active-role checks on the application socket.
const profileNs = io.of("/profile");
if (typeof profileNs.use === "function")
  profileNs.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string") return next(new Error("Unauthorized"));
      const user = await require("./services/mysqlAuthSingleton")
        .getMysqlAuthService()
        .authenticate(token);
      if (!user) return next(new Error("Unauthorized"));
      socket.data.uid = user.id;
      socket.data.role = user.role;
      return next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });
if (typeof profileNs.on === "function")
  profileNs.on("connection", (socket) => {
    const sessionService =
      require("./services/mysqlAuthSingleton").getMysqlAuthService();
    const subscriptions = require("./services/realtimeSubscriptions");
    subscriptions.createMysqlProfileRealtimeSubscriptions({
      authenticateSession: (token) => sessionService.authenticate(token),
    })(socket);
    require("./services/socketSession").watchSocketSession(
      socket,
      socket.handshake.auth.token,
      async (token) => {
        const user = await sessionService.authenticate(token);
        return user
          ? { uid: user.id, exp: Math.floor(Date.now() / 1000) + 60 }
          : null;
      },
      { setTimeout, clearTimeout },
    );
  });

/* ── io exported so controllers can emit events ── */
global._io = io;
global._qrNs = qrNs;

const {
  getWarehouseBaseConfig,
  saveWarehouseBaseConfig,
} = require("./controllers/admin/warehouseBaseController.js");

const {
  getRoleRequests,
  createRoleRequest,
  approveRoleRequest,
  rejectRoleRequest,
} = require("./controllers/admin/roleRequestController.js");

// Driver locations are validated and persisted in MySQL.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token || typeof token !== "string")
      return next(new Error("Unauthorized"));
    const user = await require("./services/mysqlAuthSingleton")
      .getMysqlAuthService()
      .authenticate(token);
    if (
      !user ||
      user.status !== "active" ||
      ![
        "driver",
        "fleet_manager",
        "admin",
        "super_admin",
        "viewer",
        "qr_generator",
      ].includes(user.role)
    ) {
      return next(new Error("Unauthorized"));
    }
    socket.data.uid = user.id;
    socket.data.role = user.role;
    return next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", async (socket) => {
  const sessionService =
    require("./services/mysqlAuthSingleton").getMysqlAuthService();
  const masterData = require("./services/mysqlMasterData");
  require("./services/realtimeSubscriptions").createRealtimeSubscriptions({
    db: null,
    mysqlMasterData: masterData.getMysqlMasterData(),
    masterDataEvents: masterData.masterDataEvents,
    mysqlRoleGovernance:
      require("./services/mysqlRoleGovernance").getMysqlRoleGovernance(),
    mysqlDriverProfiles:
      require("./services/mysqlDriverProfiles").getMysqlDriverProfiles(),
    mysqlQrService: require("./services/mysqlQrService").getMysqlQrService(),
    mysqlLiveLocations:
      require("./services/mysqlLiveLocations").getMysqlLiveLocations(),
    mysqlAssignments:
      require("./services/mysqlAssignments").getMysqlAssignments(),
    mysqlDispatchGovernance:
      require("./services/mysqlDispatchGovernance").getMysqlDispatchGovernance(),
  })(socket);
  require("./services/socketSession").watchSocketSession(
    socket,
    socket.handshake.auth.token,
    async (token) => {
      const user = await sessionService.authenticate(token);
      if (!user || user.status !== "active" || user.role !== socket.data.role)
        return null;
      return { uid: user.id, exp: Math.floor(Date.now() / 1000) + 60 };
    },
    { setTimeout, clearTimeout },
  );
  socket.join(`user:${socket.data.uid}`);
  if (["fleet_manager", "admin", "super_admin"].includes(socket.data.role))
    socket.join("dispatchers");
  if (["admin", "super_admin"].includes(socket.data.role))
    socket.join("role-reviewers");
  if (["admin", "super_admin"].includes(socket.data.role))
    socket.join("ops-admins");
  socket.once("disconnect", () => {
    // Session revocation is checked by the socket session watcher.
  });

  // ── Get current warehouse base setting ──
  socket.on("get_warehouse_base", async (ack) => {
    try {
      const baseConfig = await getWarehouseBaseConfig();
      if (typeof ack === "function") {
        ack({ success: true, data: baseConfig });
      } else {
        socket.emit("warehouse_base_data", baseConfig);
      }
    } catch (err) {
      console.error("[get_warehouse_base] error:", err.message);
      if (typeof ack === "function")
        ack({ success: false, message: err.message });
    }
  });

  // ── Save warehouse base location & radius (super_admin only) ──
  socket.on("save_warehouse_base", async (data, ack) => {
    try {
      console.log(
        "[save_warehouse_base] Received request from uid:",
        socket.data.uid,
        data,
      );
      const userData = await sessionService.authenticate(
        socket.handshake.auth.token,
      );

      if (!userData || userData.role !== "super_admin") {
        console.warn(
          "[save_warehouse_base] Forbidden attempt by non-super_admin:",
          socket.data.uid,
          userData?.role,
        );
        const res = {
          success: false,
          message:
            "Forbidden: Only super_admin can configure warehouse base location.",
        };
        if (typeof ack === "function") ack(res);
        return socket.emit("warehouse_base_error", res);
      }

      const saved = await saveWarehouseBaseConfig(
        data,
        socket.data.uid,
        userData.displayName || userData.name || socket.data.uid,
      );
      console.log(
        "[save_warehouse_base] Successfully saved warehouse base:",
        saved,
      );

      // Broadcast to all connected clients
      io.emit("warehouse_base_updated", saved);

      if (typeof ack === "function") {
        ack({ success: true, data: saved });
      }
    } catch (err) {
      console.error("[save_warehouse_base] error:", err.message);
      const res = {
        success: false,
        message: err.message || "Failed to save warehouse base.",
      };
      if (typeof ack === "function") ack(res);
      socket.emit("warehouse_base_error", res);
    }
  });

  // ── Get role change requests via Socket.IO ──
  socket.on("get_role_requests", async (params, ack) => {
    try {
      const status =
        (typeof params === "string" ? params : params?.status) || "all";
      const requests = await getRoleRequests(status, socket.data.uid);
      if (typeof ack === "function") ack({ success: true, data: requests });
      else socket.emit("role_requests_data", requests);
    } catch (err) {
      console.error("[get_role_requests] error:", err.message);
      if (typeof ack === "function")
        ack({ success: false, message: err.message });
    }
  });

  // ── Submit a role change request via Socket.IO ──
  socket.on("create_role_request", async (data, ack) => {
    try {
      const userData = await sessionService.authenticate(
        socket.handshake.auth.token,
      );
      if (!userData) throw new Error("Unauthorized");
      const created = await createRoleRequest({
        requesterId: socket.data.uid,
        requesterName: userData?.displayName || userData?.name || "User",
        currentRole: userData?.role || "viewer",
        requestedRole: data.requestedRole,
      });
      if (typeof ack === "function") ack({ success: true, data: created });
    } catch (err) {
      console.error("[create_role_request] error:", err.message);
      if (typeof ack === "function")
        ack({ success: false, message: err.message });
    }
  });

  // ── Approve role request via Socket.IO (admin/super_admin only) ──
  socket.on("approve_role_request", async (data, ack) => {
    try {
      const userData = await sessionService.authenticate(
        socket.handshake.auth.token,
      );
      if (
        !userData ||
        (userData.role !== "super_admin" && userData.role !== "admin")
      ) {
        const res = {
          success: false,
          message: "Forbidden: Admin privileges required.",
        };
        if (typeof ack === "function") ack(res);
        return;
      }
      const approved = await approveRoleRequest(
        data.requestId,
        socket.data.uid,
      );
      if (typeof ack === "function") ack({ success: true, data: approved });
    } catch (err) {
      console.error("[approve_role_request] error:", err.message);
      if (typeof ack === "function")
        ack({ success: false, message: err.message });
    }
  });

  // ── Reject role request via Socket.IO (admin/super_admin only) ──
  socket.on("reject_role_request", async (data, ack) => {
    try {
      const userData = await sessionService.authenticate(
        socket.handshake.auth.token,
      );
      if (
        !userData ||
        (userData.role !== "super_admin" && userData.role !== "admin")
      ) {
        const res = {
          success: false,
          message: "Forbidden: Admin privileges required.",
        };
        if (typeof ack === "function") ack(res);
        return;
      }
      const rejected = await rejectRoleRequest(
        data.requestId,
        socket.data.uid,
        data.reason,
      );
      if (typeof ack === "function") ack({ success: true, data: rejected });
    } catch (err) {
      console.error("[reject_role_request] error:", err.message);
      if (typeof ack === "function")
        ack({ success: false, message: err.message });
    }
  });

  // ── Driver Full Capacity Toggle via Socket.IO ──
  socket.on("driver_is_full", async (data) => {
    try {
      if (
        socket.data.role !== "driver" ||
        !data ||
        typeof data.isFull !== "boolean" ||
        (data.driverId && data.driverId !== socket.data.uid)
      )
        return;
      const driverId = data?.driverId || socket.data.uid;
      const isFull = Boolean(data?.isFull);
      await require("./services/mysqlDriverProfiles")
        .getMysqlDriverProfiles()
        .setCapacity(driverId, isFull);

      // Broadcast to dispatchers
      io.to("dispatchers").emit("driver_capacity_updated", {
        driverId,
        isFull,
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "capacity_update_failed",
          statusCode: err.statusCode || 500,
        }),
      );
    }
  });

  socket.on("driver_moving", async (data) => {
    if (
      socket.data.role !== "driver" ||
      !data ||
      data.driverId !== socket.data.uid ||
      !Number.isFinite(data.lat) ||
      !Number.isFinite(data.lng) ||
      Math.abs(data.lat) > 90 ||
      Math.abs(data.lng) > 180
    )
      return;
    try {
      const now = Date.now();
      const sampledAt =
        Number.isFinite(data.timestamp) && data.timestamp <= now + 30000
          ? Math.max(0, Math.floor(data.timestamp))
          : now;
      let sapAssignmentId = null;
      if (
        typeof data.sapDocId === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(data.sapDocId)
      ) {
        const assignment = await require("./services/mysqlAssignments")
          .getMysqlAssignments()
          .get(data.sapDocId);
        if (
          assignment?.driverId === socket.data.uid &&
          [
            "assigned",
            "loading",
            "loaded",
            "fully_loaded",
            "in_transit",
          ].includes(assignment.tripStatus)
        ) {
          sapAssignmentId = data.sapDocId;
        }
      }
      const profile = await require("./services/mysqlDriverProfiles")
        .getMysqlDriverProfiles()
        .get(socket.data.uid);
      await require("./services/mysqlLiveLocations")
        .getMysqlLiveLocations()
        .save({
          driverId: socket.data.uid,
          sapAssignmentId,
          name: profile?.name || "Driver",
          lat: data.lat,
          lng: data.lng,
          status: data.status === "stopped" ? "stopped" : "online",
          sampledAt,
          receivedAt: now,
        });
      io.to("dispatchers").emit("update_admin_map", {
        driverId: socket.data.uid,
        sapDocId: sapAssignmentId,
        lat: data.lat,
        lng: data.lng,
        status: data.status === "stopped" ? "stopped" : "online",
        timestamp: sampledAt,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "mysql_location_save_failed",
          statusCode: error.statusCode || 500,
        }),
      );
    }
  });

  socket.on("update_status", (data) => {
    try {
      if (
        socket.data.role !== "driver" ||
        !data ||
        (data.driverId && data.driverId !== socket.data.uid) ||
        !["stopped", "offline", "online"].includes(data.status)
      )
        return;
      const driverId = data?.driverId || socket.data.uid;
      const status = data?.status;
      if (!driverId || !status) return;

      // Broadcast to dispatchers / admin map for immediate UI reaction
      io.to("dispatchers").emit("update_status", {
        driverId,
        status,
        timestamp: Date.now(),
      });

      if (status === "stopped") {
        io.to("dispatchers").emit("driver_stopped", { driverId });
      }
    } catch (err) {
      console.error("[update_status] error:", err.message);
    }
  });

  // ── Driver Stopped (traffic signal / idle) ──
  socket.on("driver_stopped", (data) => {
    try {
      if (
        socket.data.role !== "driver" ||
        !data ||
        (data.driverId && data.driverId !== socket.data.uid)
      )
        return;
      const driverId = data?.driverId || socket.data.uid;
      io.to("dispatchers").emit("driver_stopped", { driverId });
      io.to("dispatchers").emit("update_status", {
        driverId,
        status: "stopped",
      });
    } catch (err) {
      console.error("[driver_stopped] error:", err.message);
    }
  });

  // ── Driver POD Updated (photo / signature uploaded) ──
  socket.on("pod_updated", async (data) => {
    try {
      if (
        socket.data.role !== "driver" ||
        !data ||
        typeof data.shipmentDocId !== "string" ||
        !data.shipmentDocId.length ||
        data.shipmentDocId.length > 128 ||
        data.shipmentDocId.includes("/")
      )
        return;
      const assignment = await require("./services/mysqlAssignments")
        .getMysqlAssignments()
        .get(data.shipmentDocId);
      if (!assignment || assignment.driverId !== socket.data.uid) return;
      io.to("dispatchers").to(`user:${socket.data.uid}`).emit("pod_updated", {
        shipmentDocId: data.shipmentDocId,
        driverId: socket.data.uid,
        source: "driver_app",
      });
    } catch (err) {
      console.error("[pod_updated] error:", err.message);
    }
  });
});

const qrTokenCleanupJob = cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      const result = await require("./services/mysqlQrService")
        .getMysqlQrService()
        .cleanupExpiredTokens();
      if (result.deleted > 0)
        console.log(JSON.stringify({ event: "qr_token_cleanup_completed", deleted: result.deleted }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "qr_token_cleanup_failed",
        errorCode: typeof error.code === "string" ? error.code : "UNKNOWN",
      }));
    }
  },
  { scheduled: false },
);

server.listen(port, "0.0.0.0", () => {
  qrTokenCleanupJob.start();
  console.log(`🚀 SYSU SERVER RUNNING ON PORT ${port}`);
  console.log(
    "MySQL-backed authentication, realtime subscriptions, and tracking are enabled",
  );
});
