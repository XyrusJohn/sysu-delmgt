const { isIP } = require("node:net");
const rateLimit = require("express-rate-limit");

function positiveInteger(env, name, fallback, maximum) {
  const raw = env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} is out of range`);
  }
  return value;
}

function loadTrustedProxy(value = "0") {
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
  ) {
    return value;
  }
  throw new Error("TRUST_PROXY must be 0-16 hops or an explicit IP/CIDR");
}

function loadApiRateLimitConfig(env = process.env) {
  return Object.freeze({
    windowMs: positiveInteger(
      env,
      "API_RATE_LIMIT_WINDOW_MS",
      900000,
      86400000,
    ),
    max: positiveInteger(env, "API_RATE_LIMIT_MAX", 1200, 1000000),
  });
}

function createApiRateLimiter(options = loadApiRateLimitConfig()) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait and try again.",
    },
  });
}

module.exports = {
  createApiRateLimiter,
  loadApiRateLimitConfig,
  loadTrustedProxy,
};
