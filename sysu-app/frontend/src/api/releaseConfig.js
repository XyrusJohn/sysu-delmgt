const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LIVE_HOSTS = new Set([
  "sysu-app.onrender.com",
  "sysu-go.onrender.com",
]);

/** Keep an emulator-backed test artifact from being mistaken for a public release build. */
export function assertProductionBuildTarget(command, mode, env) {
  if (
    command === "build" &&
    mode === "production" &&
    env.VITE_RELEASE_TARGET !== "production"
  ) {
    throw new Error(
      "Production frontend builds require VITE_RELEASE_TARGET=production; use npm run build:e2e for emulator tests",
    );
  }
}

/** Shared browser/build validation; endpoints never default to a live service. */
export function resolveReleaseConfig(env) {
  const target = env.VITE_RELEASE_TARGET;
  const workstation =
    target === "production" &&
    env.DEV === true &&
    env.VITE_USE_LOCAL_BACKEND === "true";
  if (!["local", "staging", "production"].includes(target))
    throw new Error(
      "VITE_RELEASE_TARGET must explicitly be local, staging or production",
    );
  function endpoint(name) {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be a valid URL`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(`${name} must be a service origin`);
    if (target === "local" && !LOCAL_HOSTS.has(url.hostname))
      throw new Error("Local endpoints must use loopback hosts");
    if (target !== "production" && LIVE_HOSTS.has(url.hostname))
      throw new Error(
        "Non-production configuration cannot target live production endpoints",
      );
    const localTestEndpoint = workstation && LOCAL_HOSTS.has(url.hostname);
    if (
      target !== "local" &&
      !localTestEndpoint &&
      (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname))
    )
      throw new Error(`${name} requires a public HTTPS origin`);
    return url.origin;
  }
  return Object.freeze({
    BASE_URL: endpoint("VITE_API_URL"),
    SOCKET_URL: endpoint("VITE_SOCKET_URL"),
    DRIVER_TRACKING_URL: endpoint("VITE_DRIVER_TRACKING_URL"),
  });
}
