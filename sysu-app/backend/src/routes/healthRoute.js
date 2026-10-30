const express = require("express");

/** Coalesce dependency checks; a timeout does not spawn another still-running probe. */
module.exports = function healthRoute({ probe, version, timeoutMs }) {
  const router = express.Router();
  let pending;
  router.get("/live", (_req, res) =>
    res.set("Cache-Control", "no-store").json({ status: "live", version }),
  );
  router.get("/ready", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!pending)
      pending = Promise.resolve()
        .then(probe)
        .finally(() => {
          pending = null;
        });
    let timer;
    try {
      await Promise.race([
        pending,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Dependency timeout")),
            timeoutMs,
          );
        }),
      ]);
      return res.json({ status: "ready", version });
    } catch {
      return res.status(503).json({ status: "not_ready", version });
    } finally {
      clearTimeout(timer);
    }
  });
  return router;
};
