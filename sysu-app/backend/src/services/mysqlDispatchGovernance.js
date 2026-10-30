const { randomUUID } = require("node:crypto");
const PRE_TRANSIT = new Set(["assigned", "loading", "loaded", "fully_loaded"]);
const TTL = 15 * 60 * 1000;
const json = (value) =>
  typeof value === "string" ? JSON.parse(value) : value || {};
const fail = (status, message) => ({ status, message });
const project = (row) => ({
  id: row.request_id,
  ...json(row.request_data),
  requestId: row.request_id,
  requestKind: row.request_kind,
  dispatchKey: row.dispatch_key,
  requestedDriverId:
    json(row.request_data).requestedQueueId || row.requested_driver_id,
  reason: row.reason,
  requestedBy: row.requested_by,
  requestedAt: { $timestamp: Number(row.requested_at_ms) },
  status: row.status,
  decidedBy: row.decided_by,
  decidedAt:
    row.decided_at_ms == null
      ? null
      : { $timestamp: Number(row.decided_at_ms) },
  decision: row.decision,
  denyReason: row.deny_reason,
  tokenId: row.token_id,
  tokenExpiresAt:
    row.token_expires_at_ms == null
      ? null
      : new Date(Number(row.token_expires_at_ms)).toISOString(),
});

function createMysqlDispatchGovernance({ pool, now = () => Date.now() }) {
  if (!pool?.getConnection || !pool?.execute)
    throw new TypeError("A MySQL pool is required");
  async function transaction(work) {
    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const result = await work(connection);
      await connection.commit();
      begun = false;
      return result;
    } catch (error) {
      if (begun) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function requestOverride(input) {
    const requestId = randomUUID(),
      requestedAt = now();
    const [queueRows] = await pool.execute(
      `SELECT id, driver_id FROM app_queue_entries WHERE (id = ? OR driver_id = ?)
               AND status IN ('waiting','called','available','assigned','loading','loaded','fully_loaded') ORDER BY entry_time_ms LIMIT 2`,
      [input.requestedDriverId, input.requestedDriverId],
    );
    const target = queueRows.length === 1 ? queueRows[0] : null;
    if (!target)
      return fail(409, "Requested driver is no longer in the queue.");
    try {
      await pool.execute(
        `INSERT INTO app_dispatch_requests
                (request_id,request_kind,dispatch_key,requested_driver_id,reason,requested_by,requested_at_ms,status,request_data)
                VALUES (?,'override',?,?,?,?,?,'pending',?)`,
        [
          requestId,
          input.dispatchKey,
          target.driver_id,
          input.reason,
          input.requestedBy,
          requestedAt,
          JSON.stringify({
            requestedDriverName: input.requestedDriverName || null,
            requestedDriverPlate: input.requestedDriverPlate || null,
            fifoFirstDriverId: input.fifoFirstDriverId || null,
            fifoFirstDriverName: input.fifoFirstDriverName || null,
            requestedQueueId: target.id,
            note: input.note || null,
            submittedByName: input.submittedByName || null,
          }),
        ],
      );
      return { status: 200, data: { requestId } };
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY")
        return fail(
          409,
          "A pending override request already exists for this dispatch.",
        );
      throw error;
    }
  }

  async function requestCancellation({ dispatchKey, reason, requestedBy }) {
    return transaction(async (connection) => {
      const [assignments] = await connection.execute(
        "SELECT dispatch_key,driver_id,queue_id,assigned_at_ms,trip_status FROM app_sap_assignments WHERE dispatch_key=? FOR UPDATE",
        [dispatchKey],
      );
      const assignment = assignments[0];
      if (!assignment) return fail(404, "Assignment not found.");
      if (!PRE_TRANSIT.has(assignment.trip_status))
        return fail(409, "Only pre-transit assignments may be cancelled.");
      const requestId = randomUUID(),
        requestedAt = now();
      try {
        await connection.execute(
          `INSERT INTO app_dispatch_requests
                  (request_id,request_kind,dispatch_key,reason,requested_by,requested_at_ms,status,assignment_assigned_at_ms,request_data)
                  VALUES (?,'cancel',?,?,?,?, 'pending', ?, '{}')`,
          [
            requestId,
            dispatchKey,
            reason,
            requestedBy,
            requestedAt,
            Number(assignment.assigned_at_ms),
          ],
        );
        return { status: 200, data: { requestId } };
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY")
          return fail(409, "A cancellation request is already pending.");
        throw error;
      }
    });
  }

  async function getRequest(requestId, kind, requestedBy = null) {
    const conditions = ["request_id = ?", "request_kind = ?"];
    const params = [requestId, kind];
    if (requestedBy) {
      conditions.push("requested_by = ?");
      params.push(requestedBy);
    }
    const [rows] = await pool.execute(
      `SELECT * FROM app_dispatch_requests WHERE ${conditions.join(" AND ")} LIMIT 1`,
      params,
    );
    return rows[0] ? project(rows[0]) : null;
  }

  async function listRequests(kind, { dispatchKey, requestedBy } = {}) {
    const conditions = ["request_kind = ?"];
    const params = [kind];
    if (dispatchKey) {
      conditions.push("dispatch_key = ?");
      params.push(dispatchKey);
    }
    if (requestedBy) {
      conditions.push("requested_by = ?");
      params.push(requestedBy);
    }
    const [rows] = await pool.execute(
      `SELECT * FROM app_dispatch_requests WHERE ${conditions.join(" AND ")} ORDER BY requested_at_ms DESC LIMIT 200`,
      params,
    );
    return rows.map(project);
  }

  async function decideOverride({ requestId, decision, reason, decidedBy }) {
    return transaction(async (connection) => {
      const [rows] = await connection.execute(
        "SELECT * FROM app_dispatch_requests WHERE request_id=? AND request_kind='override' FOR UPDATE",
        [requestId],
      );
      const request = rows[0];
      if (!request) return fail(404, "Request not found.");
      if (request.status !== "pending")
        return fail(409, "Request already decided or revoked.");
      const decidedAt = now();
      let tokenId = null,
        tokenExpiresAt = null;
      if (decision === "approved") {
        tokenId = randomUUID();
        tokenExpiresAt = decidedAt + TTL;
        await connection.execute(
          `INSERT INTO app_override_tokens
                  (token_id,request_id,dispatch_key,requested_driver_id,reason,issued_by,issued_at_ms,expires_at_ms)
                  VALUES (?,?,?,?,?,?,?,?)`,
          [
            tokenId,
            requestId,
            request.dispatch_key,
            request.requested_driver_id,
            request.reason,
            decidedBy,
            decidedAt,
            tokenExpiresAt,
          ],
        );
      }
      await connection.execute(
        `UPDATE app_dispatch_requests SET status=?,decision=?,decided_by=?,decided_at_ms=?,deny_reason=?,token_id=?,token_expires_at_ms=? WHERE request_id=?`,
        [
          decision,
          decision,
          decidedBy,
          decidedAt,
          decision === "denied" ? reason || null : null,
          tokenId,
          tokenExpiresAt,
          requestId,
        ],
      );
      return {
        status: 200,
        data: {
          requestId,
          status: decision,
          tokenId,
          tokenExpiresAt:
            tokenExpiresAt == null
              ? null
              : new Date(tokenExpiresAt).toISOString(),
        },
      };
    });
  }

  async function revoke(kind, { requestId, uid }) {
    const [result] = await pool.execute(
      `UPDATE app_dispatch_requests SET status='revoked',decided_at_ms=?
            WHERE request_id=? AND request_kind=? AND requested_by=? AND status='pending'`,
      [now(), requestId, kind, uid],
    );
    if (result.affectedRows === 1)
      return { status: 200, data: { requestId, status: "revoked" } };
    const request = await getRequest(requestId, kind);
    if (!request) return fail(404, "Request not found.");
    return request.requestedBy !== uid
      ? fail(403, "Cannot revoke another user's request.")
      : fail(409, "Request already decided or revoked.");
  }

  async function decideCancellation({
    requestId,
    decision,
    reason,
    decidedBy,
  }) {
    return transaction(async (connection) => {
      const [requests] = await connection.execute(
        "SELECT * FROM app_dispatch_requests WHERE request_id=? AND request_kind='cancel' FOR UPDATE",
        [requestId],
      );
      const request = requests[0];
      if (!request) return fail(404, "Request not found.");
      if (request.status !== "pending")
        return fail(409, "Request already decided or revoked.");
      const decidedAt = now();
      if (decision === "approved") {
        const [assignments] = await connection.execute(
          "SELECT * FROM app_sap_assignments WHERE dispatch_key=? FOR UPDATE",
          [request.dispatch_key],
        );
        const assignment = assignments[0];
        if (
          !assignment ||
          Number(assignment.assigned_at_ms) !==
            Number(request.assignment_assigned_at_ms) ||
          !PRE_TRANSIT.has(assignment.trip_status)
        )
          return fail(
            409,
            "Cancellation request no longer matches an active pre-transit assignment.",
          );
        const [queues] = await connection.execute(
          "SELECT data,status FROM app_queue_entries WHERE id=? FOR UPDATE",
          [assignment.queue_id],
        );
        if (!queues[0])
          return fail(409, "Assignment queue entry is unavailable.");
        const queueData = json(queues[0].data);
        const remaining = (
          Array.isArray(queueData.assignedShipments)
            ? queueData.assignedShipments
            : []
        ).filter(
          (item) =>
            (item.dispatchKey || item.id || item.obdNumber) !==
            request.dispatch_key,
        );
        await connection.execute(
          `INSERT INTO app_sap_assignment_history
                  (request_id,dispatch_key,driver_id,cancelled_by,cancelled_at_ms,reason,assignment_data,line_items)
                  VALUES (?,?,?,?,?,?,?,?)`,
          [
            requestId,
            request.dispatch_key,
            assignment.driver_id,
            decidedBy,
            decidedAt,
            request.reason,
            assignment.data,
            assignment.line_items,
          ],
        );
        await connection.execute(
          "DELETE FROM app_sap_assignments WHERE dispatch_key=?",
          [request.dispatch_key],
        );
        const nextStatus = remaining.length ? queues[0].status : "waiting";
        const updated = {
          ...queueData,
          assignedShipments: remaining,
          activeShipmentsCount: remaining.length,
          isAssigned: remaining.length > 0,
          overallTripStatus: remaining.length
            ? queueData.overallTripStatus || "loading"
            : "waiting",
          assignedShipment: remaining[0]?.dispatchKey || null,
          cancelAudit: {
            reason: request.reason,
            cancelledBy: decidedBy,
            cancelledAt: { $timestamp: decidedAt },
            dispatchKey: request.dispatch_key,
          },
        };
        await connection.execute(
          "UPDATE app_queue_entries SET is_assigned=?,status=?,data=? WHERE id=?",
          [
            remaining.length > 0,
            nextStatus,
            JSON.stringify(updated),
            assignment.queue_id,
          ],
        );
      }
      await connection.execute(
        `UPDATE app_dispatch_requests SET status=?,decision=?,decided_by=?,decided_at_ms=?,deny_reason=? WHERE request_id=?`,
        [
          decision,
          decision,
          decidedBy,
          decidedAt,
          decision === "denied" ? reason || null : null,
          requestId,
        ],
      );
      return { status: 200, data: { requestId, status: decision } };
    });
  }

  async function consumeToken(
    connection,
    tokenId,
    { dispatchKey, requestedDriverId, assignedBy },
  ) {
    const [rows] = await connection.execute(
      "SELECT * FROM app_override_tokens WHERE token_id=? FOR UPDATE",
      [tokenId],
    );
    const token = rows[0];
    if (
      !token ||
      token.consumed_at_ms != null ||
      Number(token.expires_at_ms) <= now()
    )
      return {
        ok: false,
        code: "TOKEN_EXPIRED",
        message: "Override token is expired or already used.",
      };
    if (token.dispatch_key !== dispatchKey)
      return {
        ok: false,
        code: "TOKEN_DISPATCH_MISMATCH",
        message: "Override token is not for this dispatch.",
      };
    if (![requestedDriverId].includes(token.requested_driver_id))
      return {
        ok: false,
        code: "TOKEN_DRIVER_MISMATCH",
        message: "Override token is not for this driver.",
      };
    await connection.execute(
      "UPDATE app_override_tokens SET consumed_at_ms=?,consumed_by=?,consumed_for_assignment=? WHERE token_id=?",
      [now(), assignedBy, dispatchKey, tokenId],
    );
    return { ok: true };
  }

  return Object.freeze({
    requestOverride,
    requestCancellation,
    getRequest,
    listRequests,
    decideOverride,
    revoke,
    decideCancellation,
    consumeToken,
  });
}

let singleton;
function getMysqlDispatchGovernance({ pool } = {}) {
  if (!singleton)
    singleton = createMysqlDispatchGovernance({
      pool: pool || require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}
module.exports = { createMysqlDispatchGovernance, getMysqlDispatchGovernance };
