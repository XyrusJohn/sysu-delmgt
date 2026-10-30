const https = require("https");

const PRIMARY_HOST = "1.1.1.1";   // Cloudflare DNS
const FALLBACK_HOST = "8.8.8.8";  // Google DNS
const CHECK_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

let intervalId = null;
let lastStatus = null; // null = unknown, true = online, false = offline

// NB: function name is checkInternetReachability (no space)
function checkInternetReachability(host) {
  return new Promise((resolve) => {
    const req = https.request(
      `https://${host}`,
      { method: "HEAD", timeout: REQUEST_TIMEOUT_MS },
      () => resolve(true)
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function formatTimestamp() {
  return new Date().toISOString();
}

async function tick() {
  const isOnline = await checkInternetReachability(PRIMARY_HOST);
  let online = isOnline;

  // Fallback: if primary fails, try secondary
  if (!online) {
    online = await checkInternetReachability(FALLBACK_HOST);
  }

  // Avoid duplicate logs on same status
  if (online !== lastStatus) {
    const prev = lastStatus === null ? "UNKNOWN" : lastStatus ? "ONLINE" : "OFFLINE";
    const curr = online ? "ONLINE" : "OFFLINE";

    if (!online) {
      console.warn(`[HEARTBEAT] ⚠️  Internet: OFFLINE — will retry in 15s`);
    } else {
      console.log(`[HEARTBEAT] 🌐 Internet: ONLINE  (${formatTimestamp()})`);
    }

    if (lastStatus !== null) {
      console.log(`[HEARTBEAT] 🔄 Internet status changed: ${prev} → ${curr}`);
    }
    lastStatus = online;
  }
}

function startHeartbeat() {
  tick();
  intervalId = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[HEARTBEAT] Started — checking every ${CHECK_INTERVAL_MS / 1000}s (target: ${PRIMARY_HOST})`);
}

function stopHeartbeat() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[HEARTBEAT] Stopped");
  }
}

module.exports = { startHeartbeat, stopHeartbeat };