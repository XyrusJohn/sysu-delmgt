const sapSource = require("../services/sapSource");
const {
  createRuntimeSystemDiagnostics,
} = require("../services/systemDiagnostics");
const { z } = require("zod");

function compareDispatchObds(expectedObds, rows) {
  const returned = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.OBDNumber || ""))
      .filter(Boolean),
  );
  const missingCount = [...expectedObds].filter(
    (obd) => !returned.has(obd),
  ).length;
  return {
    expectedCount: expectedObds.size,
    receivedCount: expectedObds.size - missingCount,
    missingCount,
  };
}
exports.compareDispatchObds = compareDispatchObds;

const dispatchDetailsRequest = z.object({
  dispatchKeys: z
    .array(
      z
        .string()
        .min(1)
        .max(64)
        .refine(
          (value) =>
            value === value.trim() &&
            !value.includes("/") &&
            value !== "." &&
            value !== ".." &&
            [...value].every(
              (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
            ),
          "Invalid dispatch identifier",
        ),
    )
    .min(1)
    .max(100),
});

function recordSapFailure(req, operation, error) {
  req._systemErrorLogged = true;
  const requestId = req.requestId || "request-id-unavailable";
  const errorName =
    typeof error?.name === "string" &&
    /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(error.name)
      ? error.name
      : "Error";
  const errorCode =
    typeof error?.code === "string" && /^[A-Z0-9_-]{1,48}$/i.test(error.code)
      ? error.code
      : undefined;
  console.error(
    JSON.stringify({
      event: "sap_unavailable",
      operation,
      requestId,
      errorName,
      errorCode,
    }),
  );
  try {
    void createRuntimeSystemDiagnostics({ io: global._io })
      .record({
        eventCode: "sap_unavailable",
        operation,
        requestId,
        errorName,
        actorId: req.user?.uid,
      })
      .catch(() =>
        console.error(
          JSON.stringify({ event: "sap_error_log_persist_failed", requestId }),
        ),
      );
  } catch {
    console.error(
      JSON.stringify({ event: "sap_error_logging_unavailable", requestId }),
    );
  }
}

function resolveRecoveredSapOperation(req, eventCode, operation) {
  try {
    void createRuntimeSystemDiagnostics({ io: global._io })
      .resolveOperation(eventCode, operation, req.user?.uid)
      .catch(() => {});
  } catch {
    /* Recovery bookkeeping must not fail a successful SAP response. */
  }
}

exports.getSapData = async (req, res) => {
  try {
    const snapshot = await sapSource.read();
    resolveRecoveredSapOperation(req, "sap_unavailable", "sap-shipments");
    return res.json({
      success: true,
      data: { d: { results: snapshot.rows } },
      cached: snapshot.cached,
      fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
    });
  } catch (error) {
    recordSapFailure(req, "sap-shipments", error);
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "SAP temporarily unavailable",
      });
  }
};

exports.getAssignedDispatchDetails = async (req, res) => {
  const parsed = dispatchDetailsRequest.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ success: false, error: "Invalid dispatch details request" });
  res.set("Cache-Control", "no-store");

  try {
    const keys = [...new Set(parsed.data.dispatchKeys)];
    const assignments = await Promise.all(
      keys.map((key) =>
        require("../services/mysqlAssignments").getMysqlAssignments().get(key),
      ),
    );
    const allowedObds = new Map();
    assignments.forEach((assignment, index) => {
      if (!assignment) return;
      const lineItems = assignment.lineItems;
      const obds = Array.isArray(lineItems)
        ? lineItems
            .map((line) => line?.obdNumber)
            .filter((value) => typeof value === "string" && value.length > 0)
        : [];
      if (obds.length) allowedObds.set(keys[index], new Set(obds));
    });
    if (!allowedObds.size) return res.json({ success: true, data: {} });

    const sapDetails = await sapSource.readDispatchDetails([
      ...allowedObds.keys(),
    ]);
    const data = Object.create(null);
    const warnings = [];
    let expectedCount = 0;
    let receivedCount = 0;
    let missingCount = 0;
    for (const [key, obds] of allowedObds) {
      const rows = sapDetails[key] || [];
      const mismatch = compareDispatchObds(obds, rows);
      expectedCount += mismatch.expectedCount;
      receivedCount += mismatch.receivedCount;
      missingCount += mismatch.missingCount;
      if (mismatch.missingCount)
        warnings.push({
          dispatchKey: key,
          code: "SAP_DETAIL_MISMATCH",
          ...mismatch,
        });
      data[key] = rows.filter((row) => obds.has(String(row.OBDNumber || "")));
    }
    if (missingCount) {
      console.warn(
        JSON.stringify({
          event: "sap_dispatch_details_mismatch",
          requestId: req.requestId,
          affectedDispatchCount: warnings.length,
          expectedCount,
          receivedCount,
          missingCount,
        }),
      );
      try {
        void createRuntimeSystemDiagnostics({ io: global._io })
          .record({
            eventCode: "sap_detail_mismatch",
            requestId: req.requestId,
            actorId: req.user?.uid,
            operation: "sap-dispatch-details",
            details: { expectedCount, receivedCount, missingCount },
          })
          .catch(() =>
            console.error(
              JSON.stringify({
                event: "sap_error_log_persist_failed",
                requestId: req.requestId,
              }),
            ),
          );
      } catch {
        console.error(
          JSON.stringify({
            event: "sap_error_logging_unavailable",
            requestId: req.requestId,
          }),
        );
      }
    } else {
      resolveRecoveredSapOperation(
        req,
        "sap_detail_mismatch",
        "sap-dispatch-details",
      );
    }
    resolveRecoveredSapOperation(
      req,
      "sap_unavailable",
      "sap-dispatch-details",
    );
    return res.json({
      success: true,
      requestId: req.requestId,
      data,
      warnings,
    });
  } catch (error) {
    recordSapFailure(req, "sap-dispatch-details", error);
    return res
      .status(503)
      .json({
        success: false,
        requestId: req.requestId,
        error: "SAP temporarily unavailable",
      });
  }
};
