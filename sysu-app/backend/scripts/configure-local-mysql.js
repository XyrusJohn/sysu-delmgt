const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const {seedTruckCompanies} = require("./seedTruckCompanies");

const backendDir = path.resolve(__dirname, "..");
const appRoot = path.resolve(backendDir, "..");
const goBackendDir = path.resolve(backendDir, "../../sysu-go/backend");
const backendEnvPath = path.join(backendDir, ".env");
const frontendEnvPath = path.join(appRoot, "frontend/.env");
const goEnvPath = path.join(goBackendDir, ".env");
const localDir = path.join(backendDir, ".local-mysql");
const lockPath = path.join(localDir, "configure-target.lock");
const localAdminAccessPath = path.join(localDir, "local-admin-access.txt");
const schemaPath = path.join(
  backendDir,
  "src/migrations/mysql/001_auth_identity_schema.sql",
);
const usernameMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/002_username_identity.sql",
);
const accountIdMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/003_public_account_id.sql",
);
const driverLocationsMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/004_driver_live_locations.sql",
);
const masterDataMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/005_master_data.sql",
);
const roleGovernanceMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/006_role_governance.sql",
);
const driverQueueMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/007_driver_queue.sql",
);
const qrAdmissionMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/008_qr_admission.sql",
);
const assignmentsMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/009_assignments.sql",
);
const podMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/010_pod_storage.sql",
);
const auditMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/011_driver_action_audit.sql",
);
const dispatchGovernanceMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/012_dispatch_governance.sql",
);
const settingsMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/013_app_settings.sql",
);
const driverRequirementsMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/014_driver_requirements.sql",
);
const systemErrorsMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/015_system_error_logs.sql",
);
const usernameOnlyAuthMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/016_username_only_auth.sql",
);
const driverActionShipmentSearchMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/017_driver_action_shipment_search.sql",
);
const driverActionShipmentSuffixSearchMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/018_driver_action_shipment_suffix_search.sql",
);
const driverActionManualRetentionMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/019_driver_action_manual_retention.sql",
);
const driverActionManualDeletionMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/020_driver_action_manual_deletion.sql",
);
const apiIdempotencyMigrationPath = path.join(
  backendDir,
  "src/migrations/mysql/021_api_idempotency.sql",
);
function fail(message) {
  throw new Error(message);
}

function readEnv(filePath) {
  return fs.existsSync(filePath) ? dotenv.parse(fs.readFileSync(filePath)) : {};
}

function writeManagedEnv(filePath, values, { managed = true } = {}) {
  const lines = [
    ...(managed ? ["# Managed by local MySQL setup"] : []),
    ...Object.entries(values).map(([key, value]) => `${key}=${String(value)}`),
    "",
  ];
  const contents = lines.join("\n");
  if (
    fs.existsSync(filePath) &&
    managed &&
    !fs.readFileSync(filePath, "utf8").startsWith("# Managed by ")
  ) {
    fail(
      `Refusing to overwrite a user-managed local environment file: ${path.relative(appRoot, filePath)}`,
    );
  }
  fs.writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o600 });
}

function localPassword() {
  return crypto.randomBytes(36).toString("base64url");
}

async function configure() {
  const files = [backendEnvPath, frontendEnvPath, goEnvPath];
  for (const filePath of files) {
    if (
      fs.existsSync(filePath) &&
      !fs.readFileSync(filePath, "utf8").startsWith("# Managed by ")
    ) {
      fail(
        `Refusing to overwrite a user-managed local environment file: ${path.relative(appRoot, filePath)}`,
      );
    }
  }
  const env = { ...readEnv(backendEnvPath), ...process.env };
  const host = env.DB_HOST || env.MYSQL_HOST || "localhost";
  const port = Number(env.DB_PORT || env.MYSQL_PORT || 3306);
  const database = (env.DB_NAME || env.MYSQL_DATABASE || "").trim();
  const adminUser = env.DB_ADMIN_USER || env.DB_USER || env.MYSQL_USER;
  const adminPassword =
    env.DB_ADMIN_PASSWORD || env.DB_PASSWORD || env.MYSQL_PASSWORD;
  if (!["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase()))
    fail("DB_HOST must be a loopback address for local migration testing.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail("DB_PORT must be a valid TCP port.");
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database))
    fail("DB_NAME must be a valid database identifier.");
  if (!adminUser || !adminPassword)
    fail(
      "Local DB admin credentials are required in the backend .env file.",
    );
  if (
    ![
      schemaPath,
      usernameMigrationPath,
      accountIdMigrationPath,
      driverLocationsMigrationPath,
      masterDataMigrationPath,
      roleGovernanceMigrationPath,
      driverQueueMigrationPath,
      qrAdmissionMigrationPath,
      assignmentsMigrationPath,
      podMigrationPath,
      auditMigrationPath,
      dispatchGovernanceMigrationPath,
      settingsMigrationPath,
      driverRequirementsMigrationPath,
      systemErrorsMigrationPath,
      usernameOnlyAuthMigrationPath,
      driverActionShipmentSearchMigrationPath,
      driverActionShipmentSuffixSearchMigrationPath,
      driverActionManualRetentionMigrationPath,
      driverActionManualDeletionMigrationPath,
      apiIdempotencyMigrationPath,
      path.join(backendDir, "scripts/seedTruckCompanies.js"),
    ].every(fs.existsSync)
  )
    fail("A required MySQL schema migration file is missing.");

  const mysql = require(path.join(backendDir, "node_modules/mysql2/promise"));
  const admin = await mysql.createConnection({
    host,
    port,
    user: adminUser,
    password: adminPassword,
    connectTimeout: 5000,
    multipleStatements: true,
  });
  try {
    const [[found]] = await admin.execute(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [database],
    );
    if (!found)
      await admin.query(
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    const [existingTables] = await admin.execute(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
      [database],
    );
    const unexpected = existingTables
      .map((row) => row.TABLE_NAME)
      .filter((name) => !name.startsWith("app_"));
    if (unexpected.length)
      fail(
        "The target database contains non-app tables; refusing to mix application schemas.",
      );

    const schema = await mysql.createConnection({
      host,
      port,
      user: adminUser,
      password: adminPassword,
      database,
      connectTimeout: 5000,
      multipleStatements: true,
    });
    try {
      const [authTables] = await schema.execute(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users'",
      );
      if (!authTables.length)
        await schema.query(fs.readFileSync(schemaPath, "utf8"));

      const [usernameColumns] = await schema.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users' AND COLUMN_NAME IN ('username', 'username_normalized')",
      );
      const usernameFields = new Set(
        usernameColumns.map((row) => row.COLUMN_NAME),
      );
      if (usernameFields.size === 0)
        await schema.query(fs.readFileSync(usernameMigrationPath, "utf8"));
      else if (usernameFields.size !== 2)
        fail(
          "The username schema migration is partial; refusing to repair it automatically.",
        );

      const [publicIdColumns] = await schema.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users' AND COLUMN_NAME = 'public_id'",
      );
      if (!publicIdColumns.length)
        await schema.query(fs.readFileSync(accountIdMigrationPath, "utf8"));
      const [publicIdIndexes] = await schema.execute(
        "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users' AND INDEX_NAME = 'uq_app_auth_users_public_id'",
      );
      if (!publicIdIndexes.length)
        fail("The public account ID unique index is missing.");
      await schema.query(fs.readFileSync(driverLocationsMigrationPath, "utf8"));
      await schema.query(fs.readFileSync(masterDataMigrationPath, "utf8"));
      const companySeed = await seedTruckCompanies(schema);
      if (companySeed.inserted) {
        console.log(`Seeded ${companySeed.inserted} local truck companies; ${companySeed.alreadyPresent} already existed.`);
      }
      await schema.query(fs.readFileSync(roleGovernanceMigrationPath, "utf8"));
      await schema.query(fs.readFileSync(driverQueueMigrationPath, "utf8"));
      const [[activeDriver]] = await schema.execute(
        "SELECT GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_queue_entries' AND COLUMN_NAME = 'active_driver_id'",
      );
      if (
        !activeDriver ||
        !String(activeDriver.GENERATION_EXPRESSION).includes("unloading")
      ) {
        await schema.query(`ALTER TABLE app_queue_entries MODIFY COLUMN active_driver_id CHAR(36)
                    GENERATED ALWAYS AS (CASE WHEN status IN
                    ('waiting', 'called', 'available', 'assigned', 'loading', 'loaded', 'fully_loaded', 'in_transit', 'unloading', 'returning_to_base')
                    THEN driver_id ELSE NULL END) STORED`);
      }
      await schema.query(fs.readFileSync(qrAdmissionMigrationPath, "utf8"));
      await schema.query(fs.readFileSync(assignmentsMigrationPath, "utf8"));
      await schema.query(fs.readFileSync(podMigrationPath, "utf8"));
      await schema.query(fs.readFileSync(auditMigrationPath, "utf8"));
      await schema.query(
        fs.readFileSync(dispatchGovernanceMigrationPath, "utf8"),
      );
      await schema.query(fs.readFileSync(settingsMigrationPath, "utf8"));
      const [[requirementsColumn]] = await schema.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_driver_profiles' AND COLUMN_NAME = 'requirements'",
      );
      if (!requirementsColumn)
        await schema.query(
          fs.readFileSync(driverRequirementsMigrationPath, "utf8"),
        );
      await schema.query(fs.readFileSync(systemErrorsMigrationPath, "utf8"));
      const [[shipmentRefColumn]] = await schema.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_driver_action_events' AND COLUMN_NAME = 'shipment_ref'",
      );
      if (!shipmentRefColumn)
        await schema.query(
          fs.readFileSync(driverActionShipmentSearchMigrationPath, "utf8"),
        );
      const [[shipmentSearchIndex]] = await schema.execute(
        "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_driver_action_events' AND INDEX_NAME = 'idx_app_driver_action_events_shipment_search'",
      );
      if (!shipmentSearchIndex)
        fail("The driver action shipment search index is missing.");
      const [[shipmentRefReversedColumn]] = await schema.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_driver_action_events' AND COLUMN_NAME = 'shipment_ref_reversed'",
      );
      if (!shipmentRefReversedColumn)
        await schema.query(
          fs.readFileSync(driverActionShipmentSuffixSearchMigrationPath, "utf8"),
        );
      const [[shipmentSuffixSearchIndex]] = await schema.execute(
        "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_driver_action_events' AND INDEX_NAME = 'idx_app_driver_action_events_shipment_suffix'",
      );
      if (!shipmentSuffixSearchIndex)
        fail("The driver action shipment suffix search index is missing.");
      await schema.query(fs.readFileSync(driverActionManualRetentionMigrationPath, "utf8"));
      await schema.query(fs.readFileSync(driverActionManualDeletionMigrationPath, "utf8"));
      await schema.query(fs.readFileSync(apiIdempotencyMigrationPath, "utf8"));
      const [[firebaseUidColumn]] = await schema.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_auth_users' AND COLUMN_NAME = 'firebase_uid'",
      );
      if (firebaseUidColumn) {
        const [[incompatibleIdentity]] = await schema.execute(
          "SELECT (SELECT COUNT(*) FROM app_auth_identities WHERE provider <> 'username' OR password_hash IS NULL) AS incompatible_identities, (SELECT COUNT(*) FROM app_auth_users WHERE firebase_uid IS NOT NULL) AS firebase_accounts",
        );
        if (
          Number(incompatibleIdentity.incompatible_identities) > 0 ||
          Number(incompatibleIdentity.firebase_accounts) > 0
        )
          fail(
            "Username-only auth migration found non-username identities or Firebase UIDs; resolve these accounts explicitly before retrying.",
          );
        await schema.query(
          fs.readFileSync(usernameOnlyAuthMigrationPath, "utf8"),
        );
      }
    } finally {
      await schema.end();
    }

    const appPassword =
      env.MYSQL_APP_PASSWORD ||
      (env.DB_USER === "sysu_app_local" ? env.DB_PASSWORD : localPassword());
    const priorGoUser = readEnv(goEnvPath);
    const goPassword =
      env.MYSQL_GO_PASSWORD ||
      (priorGoUser.DB_USER === "sysu_go_local"
        ? priorGoUser.DB_PASSWORD
        : localPassword());
    for (const [user, password] of [
      ["sysu_app_local", appPassword],
      ["sysu_go_local", goPassword],
    ]) {
      for (const accountHost of ["localhost", "127.0.0.1"]) {
        await admin.query(
          `CREATE USER IF NOT EXISTS '${user}'@'${accountHost}' IDENTIFIED BY '${password}'`,
        );
        await admin.query(
          `ALTER USER '${user}'@'${accountHost}' IDENTIFIED BY '${password}'`,
        );
        await admin.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${user}'@'${accountHost}'`,
        );
      }
    }

    const priorApp = readEnv(backendEnvPath);
    const appValues = Object.fromEntries(
      Object.entries(priorApp).filter(
        ([key]) =>
          !key.startsWith("MYSQL_") &&
          !key.startsWith("DB_") &&
          !key.startsWith("FIREBASE_") &&
          !key.startsWith("FIRESTORE_") &&
          !key.startsWith("GOOGLE_"),
      ),
    );
    Object.assign(appValues, {
      DB_HOST: host,
      DB_PORT: String(port),
      DB_NAME: database,
      DB_USER: "sysu_app_local",
      DB_PASSWORD: appPassword,
      DB_ADMIN_HOST: host,
      DB_ADMIN_PORT: String(port),
      DB_ADMIN_USER: adminUser,
      DB_ADMIN_PASSWORD: adminPassword,
      AUTH_BACKEND: "mysql",
      PORT: env.APP_PORT || "3000",
      ALLOWED_ORIGINS: env.ALLOWED_ORIGINS || "http://localhost:5173",
    });
    writeManagedEnv(backendEnvPath, appValues);

    const priorGo = readEnv(goEnvPath);
    const goValues = Object.fromEntries(
      Object.entries(priorGo).filter(
        ([key]) =>
          !key.startsWith("MYSQL_") &&
          !key.startsWith("DB_") &&
          !key.startsWith("FIREBASE_") &&
          !key.startsWith("FIRESTORE_") &&
          !key.startsWith("GOOGLE_"),
      ),
    );
    Object.assign(goValues, {
      DB_HOST: host,
      DB_PORT: String(port),
      DB_NAME: database,
      DB_USER: "sysu_go_local",
      DB_PASSWORD: goPassword,
      AUTH_BACKEND: "mysql",
      PORT: "3001",
      FRONTEND_URL: "http://localhost:5173",
      SYSU_ENV: "local",
    });
    writeManagedEnv(goEnvPath, goValues);

    const priorFrontend = readEnv(frontendEnvPath);
    const frontendValues = Object.fromEntries(
      Object.entries(priorFrontend).filter(
        ([key]) =>
          !key.startsWith("DB_") &&
          !key.startsWith("MYSQL_") &&
          !key.startsWith("VITE_FIREBASE_") &&
          !key.startsWith("VITE_FIRESTORE_") &&
          !key.startsWith("VITE_AUTH_EMULATOR_") &&
          !(key.startsWith("VITE_GOOGLE_") && key !== "VITE_GOOGLE_MAPS_API_KEY"),
      ),
    );
    Object.assign(frontendValues, {
      VITE_RELEASE_TARGET: "local",
      VITE_API_URL: "http://localhost:3000",
      VITE_SOCKET_URL: "http://localhost:3000",
      VITE_DRIVER_TRACKING_URL: "http://localhost:3001",
      VITE_SYSU_GO_API_URL: "http://localhost:3001",
    });
    writeManagedEnv(frontendEnvPath, frontendValues);
  } finally {
    await admin.end();
  }

  const appPool = mysql.createPool({
    host,
    port,
    user: "sysu_app_local",
    password: env.MYSQL_APP_PASSWORD || readEnv(backendEnvPath).DB_PASSWORD,
    database,
    connectTimeout: 5000,
  });
  const goPool = mysql.createPool({
    host,
    port,
    user: "sysu_go_local",
    password: env.MYSQL_GO_PASSWORD || readEnv(goEnvPath).DB_PASSWORD,
    database,
    connectTimeout: 5000,
  });
  try {
    await Promise.all([appPool.query("SELECT 1"), goPool.query("SELECT 1")]);
    const [[activeAdmin]] = await appPool.execute(
      "SELECT public_id FROM app_auth_users WHERE role = 'super_admin' AND status = 'active' LIMIT 1",
    );
    if (!activeAdmin) {
      const [[reservedName]] = await appPool.execute(
        "SELECT public_id FROM app_auth_users WHERE username_normalized = 'local_admin' LIMIT 1",
      );
      if (reservedName)
        fail(
          "The local_admin account exists but is not an active super-admin; review it before bootstrapping.",
        );
      const password = localPassword();
      const auth = require(
        path.join(backendDir, "src/services/mysqlAuthService"),
      ).createMysqlAuthService({
        pool: appPool,
      });
      const created = await auth.registerWithUsername({
        username: "local_admin",
        password,
        displayName: "Local Super Admin",
      });
      await appPool.execute(
        "UPDATE app_auth_users SET role = 'super_admin', status = 'active' WHERE public_id = ?",
        [created.user.id],
      );
      fs.writeFileSync(
        localAdminAccessPath,
        `username=local_admin\npassword=${password}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    }
  } finally {
    await Promise.all([appPool.end(), goPool.end()]);
  }
  process.stdout.write(
    `Local MySQL is ready at ${host}:${port}/${database}; separate limited app users are verified.\n`,
  );
}

async function main() {
  fs.mkdirSync(localDir, { recursive: true });
  let lock;
  try {
    lock = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const deadline = Date.now() + 120000;
    while (fs.existsSync(lockPath) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 500));
    if (fs.existsSync(lockPath))
      fail("Another local database setup is still running.");
    return main();
  }
  try {
    await configure();
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

main().catch((error) => {
  process.stderr.write(
    `Local MySQL setup failed: ${error.code || error.message}\n`,
  );
  process.exitCode = 1;
});
