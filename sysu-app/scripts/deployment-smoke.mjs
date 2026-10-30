#!/usr/bin/env node

const usage =
  "Usage: node scripts/deployment-smoke.mjs <frontend-origin> <app-api-origin> <go-api-origin> [--allow-http-local]";
const [frontendArg, appArg, goArg, option] = process.argv.slice(2);
const allowHttpLocal = option === "--allow-http-local";

if (!frontendArg || !appArg || !goArg || (option && !allowHttpLocal)) {
  console.error(usage);
  process.exitCode = 2;
} else {
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  function origin(value) {
    const url = new URL(value);
    const localHttp =
      allowHttpLocal &&
      url.protocol === "http:" &&
      localHosts.has(url.hostname);
    if (
      (!localHttp && url.protocol !== "https:") ||
      url.origin !== value.replace(/\/$/, "") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error(
        "Each endpoint must be an HTTPS service origin (local HTTP needs --allow-http-local)",
      );
    }
    return url.origin;
  }

  async function get(url, expectedStatus, expectedType, expectedValue) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (response.status !== expectedStatus)
      throw new Error(`HTTP ${response.status}`);
    if (expectedType === "html") {
      if (!response.headers.get("content-type")?.includes("text/html"))
        throw new Error("Expected HTML response");
    } else {
      const body = await response.json();
      if (body.status !== expectedValue)
        throw new Error(`Expected status ${expectedValue}`);
    }
  }

  function websocket(base) {
    const url = new URL("/socket.io/?EIO=4&transport=websocket", base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const close = () => {
        try {
          socket.close();
        } catch {
          /* The handshake may still be pending. */
        }
      };
      const timer = setTimeout(() => {
        close();
        reject(new Error("WebSocket handshake timed out"));
      }, 5000);
      socket.addEventListener(
        "message",
        (event) => {
          if (!String(event.data).startsWith("0{")) {
            clearTimeout(timer);
            close();
            reject(new Error("Expected Engine.IO open packet"));
            return;
          }
          clearTimeout(timer);
          close();
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("WebSocket upgrade failed"));
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          reject(new Error("WebSocket closed before Engine.IO opened"));
        },
        { once: true },
      );
    });
  }

  try {
    const frontend = origin(frontendArg);
    const app = origin(appArg);
    const go = origin(goArg);
    const checks = [
      ["frontend HTML", () => get(frontend, 200, "html")],
      [
        "SYSU App API and MySQL readiness",
        () => get(`${app}/health/ready`, 200, "json", "ready"),
      ],
      [
        "SYSU Go API liveness",
        () => get(`${go}/api/health`, 200, "json", "ok"),
      ],
      [
        "SYSU Go API and MySQL readiness",
        () => get(`${go}/api/health/ready`, 200, "json", "ready"),
      ],
      ["SYSU App WebSocket upgrade", () => websocket(app)],
      ["SYSU Go WebSocket upgrade", () => websocket(go)],
    ];
    let failed = false;
    for (const [name, run] of checks) {
      try {
        await run();
        console.log(`PASS ${name}`);
      } catch (error) {
        failed = true;
        console.error(`FAIL ${name}: ${error.message}`);
      }
    }
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
