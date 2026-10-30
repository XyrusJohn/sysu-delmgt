import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { Server } = require("../backend/node_modules/socket.io");

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    ),
  );
}

function run(origins) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "scripts/deployment-smoke.mjs",
      ...origins,
      "--allow-http-local",
    ]);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

test("deployment smoke checks both public WebSocket paths and fails on App database readiness", async (t) => {
  let appReady = true;
  let goReady = true;
  const webServer = createServer((_req, res) =>
    res.writeHead(200, { "Content-Type": "text/html" }).end("<html></html>"),
  );
  const appServer = createServer((req, res) => {
    if (req.url === "/health/ready") {
      res
        .writeHead(appReady ? 200 : 503, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: appReady ? "ready" : "not_ready" }));
    } else res.writeHead(404).end();
  });
  const goServer = createServer((req, res) => {
    if (req.url === "/api/health")
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "ok" }));
    else if (req.url === "/api/health/ready")
      res
        .writeHead(goReady ? 200 : 503, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: goReady ? "ready" : "not_ready" }));
    else res.writeHead(404).end();
  });
  const appSocket = new Server(appServer);
  const goSocket = new Server(goServer);
  t.after(async () => {
    await Promise.all(
      [appSocket, goSocket].map(
        (io) => new Promise((resolve) => io.close(resolve)),
      ),
    );
    await new Promise((resolve) => webServer.close(resolve));
  });
  const origins = await Promise.all(
    [webServer, appServer, goServer].map(listen),
  );

  const healthy = await run(origins);
  assert.equal(healthy.code, 0, healthy.output);
  assert.equal(
    (healthy.output.match(/PASS /g) || []).length,
    6,
    healthy.output,
  );

  appReady = false;
  const unavailable = await run(origins);
  assert.equal(unavailable.code, 1, unavailable.output);
  assert.match(
    unavailable.output,
    /FAIL SYSU App API and MySQL readiness: HTTP 503/,
  );
  assert.match(unavailable.output, /PASS SYSU Go WebSocket upgrade/);

  appReady = true;
  goReady = false;
  const goDatabaseUnavailable = await run(origins);
  assert.equal(goDatabaseUnavailable.code, 1, goDatabaseUnavailable.output);
  assert.match(
    goDatabaseUnavailable.output,
    /FAIL SYSU Go API and MySQL readiness: HTTP 503/,
  );
  goReady = true;

  const unsafe = await run(["http://example.test", origins[1], origins[2]]);
  assert.equal(unsafe.code, 2, unsafe.output);
  assert.match(unsafe.output, /HTTPS service origin/);
});
