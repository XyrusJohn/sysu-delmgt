const mysql = require("mysql2/promise");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function loadMySqlConfig(env = process.env) {
  const host = (env.DB_HOST || env.MYSQL_HOST || "").trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host))
    throw new Error(
      "MYSQL_HOST must be a loopback host for local migration testing",
    );
  const port = Number(env.DB_PORT || env.MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("MYSQL_PORT must be a valid TCP port");
  const database = (env.DB_NAME || env.MYSQL_DATABASE || "").trim();
  const user = (env.DB_USER || env.MYSQL_USER || "").trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database))
    throw new Error("MYSQL_DATABASE must be a valid database identifier");
  if (!user) throw new Error("MYSQL_USER is required");
  return Object.freeze({
    host,
    port,
    database,
    user,
    password: env.DB_PASSWORD || env.MYSQL_PASSWORD || "",
  });
}

function createMySqlPool(env = process.env) {
  return mysql.createPool({
    ...loadMySqlConfig(env),
    charset: "utf8mb4",
    connectionLimit: 5,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000,
    connectTimeout: 5000,
    queueLimit: 20,
    timezone: "Z",
    waitForConnections: true,
  });
}

module.exports = { createMySqlPool, loadMySqlConfig };
