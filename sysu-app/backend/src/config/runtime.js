const { isIP } = require("node:net");

function integer(env, name, fallback, maximum) {
  const raw = env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} is out of range`);
  return value;
}
function proxy(value = "0") {
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops <= 16) return hops;
  }
  const [address, prefix, extra] = value.split("/");
  const version = isIP(address);
  if (
    version &&
    extra === undefined &&
    (prefix === undefined ||
      (/^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128)))
  )
    return value;
  throw new Error("TRUST_PROXY must be 0-16 hops or an explicit IP/CIDR");
}
/** Validate deployment settings before opening listeners or initializing external services. */
function loadRuntimeConfig(env) {
  const production = env.NODE_ENV === "production";
  const rawOrigins =
    env.ALLOWED_ORIGINS || (production ? "" : "http://localhost:5173");
  if (!rawOrigins) throw new Error("ALLOWED_ORIGINS is required in production");
  const allowedOrigins = [
    ...new Set(rawOrigins.split(",").map((value) => value.trim())),
  ];
  for (const origin of allowedOrigins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("Invalid allowed origin");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      (production &&
        (url.protocol !== "https:" ||
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    ) {
      throw new Error(
        "Allowed origins must be exact origins; production requires public HTTPS origins",
      );
    }
  }
  return Object.freeze({
    port: integer(env, "PORT", 3000, 65535),
    trustProxy: proxy(env.TRUST_PROXY),
    allowedOrigins: Object.freeze(allowedOrigins),
    globalLimit: integer(env, "RATE_LIMIT_MAX", 200, 1000000),
    authLimit: integer(env, "AUTH_RATE_LIMIT_MAX", 20, 1000000),
    adminLimit: integer(env, "ADMIN_RATE_LIMIT_MAX", 300, 1000000),
    rateWindowMs: integer(env, "RATE_LIMIT_WINDOW_MS", 900000, 86400000),
    readinessTimeoutMs: integer(env, "READINESS_TIMEOUT_MS", 3000, 10000),
  });
}
module.exports = { loadRuntimeConfig };
