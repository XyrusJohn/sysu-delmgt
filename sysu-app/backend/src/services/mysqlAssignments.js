const { resolveEarliest } = require("./queueOrdering");

const ACTIVE = new Set([
  "assigned",
  "loading",
  "loaded",
  "fully_loaded",
  "in_transit",
  "unloading",
  "returning_to_base",
]);
const BLOCKING = new Set(["in_transit", "unloading", "returning_to_base"]);
const error = (status, code, message, meta) => ({
  status,
  code,
  message,
  meta,
});
const parse = (value) =>
  typeof value === "string" ? JSON.parse(value) : value || {};

function queueRecord(row) {
  return {
    ...parse(row.data),
    rawData: parse(row.data),
    id: row.id,
    driverId: row.driver_id,
    driverName: row.driver_name,
    plateNumber: row.plate_number,
    truckCompany: row.truck_company,
    truckType: row.truck_type,
    status: row.status,
    entryTime: Number(row.entry_time_ms),
    registrationComplete: Boolean(row.registration_complete),
    isAssigned: Boolean(row.is_assigned),
    isFull: Boolean(row.is_full),
  };
}

function assignmentRecord(row) {
  return {
    ...parse(row.data),
    id: row.dispatch_key,
    dispatchKey: row.dispatch_key,
    driverId: row.driver_id,
    queueId: row.queue_id,
    driverName: row.driver_name,
    truckPlate: row.truck_plate,
    truckCompany: row.truck_company,
    truckType: row.truck_type,
    lineItems: parse(row.line_items),
    assignedAt: { $timestamp: Number(row.assigned_at_ms) },
    assignedBy: row.assigned_by,
    sapSourceFetchedAt: { $timestamp: Number(row.sap_source_fetched_at_ms) },
    tripStatus: row.trip_status,
  };
}

function createMysqlAssignments({ pool, now = () => Date.now() }) {
  if (!pool?.getConnection || !pool?.execute)
    throw new TypeError("A MySQL pool is required");

  async function peek(dispatchKey, truckType) {
    const [rows] = await pool.execute(
      `SELECT id, driver_id, driver_name, plate_number, truck_company, truck_type, status,
                    entry_time_ms, registration_complete, is_assigned, is_full, data
               FROM app_queue_entries WHERE LOWER(truck_type) = LOWER(?)
                 AND status IN ('waiting', 'called', 'available', 'assigned', 'loading', 'loaded', 'fully_loaded')
               ORDER BY entry_time_ms, id LIMIT 2000`,
      [truckType],
    );
    const { earliest, alternates } = resolveEarliest(
      rows.map(queueRecord),
      truckType,
    );
    const project = (row) =>
      row && {
        id: row.id,
        driverName: row.driverName || null,
        plateNumber: row.plateNumber || null,
        truckCompany: row.truckCompany || null,
        entryTime: row.entryTime,
      };
    return {
      dispatchKey,
      requiredTruckType: truckType,
      earliest: project(earliest),
      alternates: alternates.map(project),
    };
  }

  async function assign({ body, assignedBy, lineItems, sapFetchedAt }) {
    const { dispatchKey, requestedDriverId, truckType, overrideTokenId } = body;
    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const [existing] = await connection.execute(
        "SELECT dispatch_key FROM app_sap_assignments WHERE dispatch_key = ? FOR UPDATE",
        [dispatchKey],
      );
      if (existing.length)
        return error(
          409,
          "DISPATCH_TAKEN",
          "This dispatch is already assigned.",
        );
      const [rows] = await connection.execute(
        `SELECT id, driver_id, driver_name, plate_number, truck_company, truck_type, status,
                        entry_time_ms, registration_complete, is_assigned, is_full, data
                   FROM app_queue_entries WHERE LOWER(truck_type) = LOWER(?)
                     AND status IN ('waiting', 'called', 'available', 'assigned', 'loading', 'loaded', 'fully_loaded')
                   ORDER BY entry_time_ms, id FOR UPDATE`,
        [truckType],
      );
      const queue = rows.map(queueRecord);
      const requested =
        queue.find((item) => item.id === requestedDriverId) ||
        queue.find((item) => item.driverId === requestedDriverId);
      if (!requested)
        return error(
          409,
          "DRIVER_INACTIVE",
          "Requested driver is no longer in the queue.",
        );
      if (
        !requested.registrationComplete ||
        requested.isFull ||
        requested.truckType.trim().toLowerCase() !==
          truckType.trim().toLowerCase()
      ) {
        return error(
          409,
          "DRIVER_INELIGIBLE",
          "Queue entry is inactive or truck type does not match.",
        );
      }
      const [driverAssignments] = await connection.execute(
        "SELECT dispatch_key, queue_id, trip_status FROM app_sap_assignments WHERE driver_id = ? FOR UPDATE",
        [requested.driverId],
      );
      const blocking = driverAssignments.filter(
        (item) =>
          BLOCKING.has(item.trip_status) ||
          (item.queue_id !== requested.id && ACTIVE.has(item.trip_status)),
      );
      if (blocking.length)
        return error(
          409,
          "DRIVER_ON_ACTIVE_LOAD",
          "Requested driver has an active dispatch.",
          { activeDispatchKeys: blocking.map((item) => item.dispatch_key) },
        );
      const current = driverAssignments.filter(
        (item) => item.queue_id === requested.id,
      );
      if (
        current.length &&
        current.every((item) =>
          ["complete", "completed"].includes(item.trip_status),
        )
      ) {
        return error(
          409,
          "DRIVER_SESSION_COMPLETED",
          "This queue session is complete.",
        );
      }
      if (
        current.some(
          (item) =>
            !["assigned", "loading", "loaded", "fully_loaded"].includes(
              item.trip_status,
            ),
        )
      ) {
        return error(
          409,
          "DRIVER_SESSION_NOT_ASSIGNABLE",
          "This queue session cannot receive another dispatch.",
        );
      }
      if (!current.length) {
        const { earliest } = resolveEarliest(queue, truckType);
        if ((!earliest || earliest.id !== requested.id) && !overrideTokenId)
          return error(
            409,
            "NOT_EARLIEST",
            "Requested driver is not earliest in queue.",
            { earliestDriverId: earliest?.id || null },
          );
      }
      if (overrideTokenId) {
        const [tokens] = await connection.execute(
          "SELECT * FROM app_override_tokens WHERE token_id = ? FOR UPDATE",
          [overrideTokenId],
        );
        const token = tokens[0];
        if (
          !token ||
          token.consumed_at_ms != null ||
          Number(token.expires_at_ms) <= now() ||
          token.dispatch_key !== dispatchKey ||
          ![requested.id, requested.driverId, requestedDriverId].includes(
            token.requested_driver_id,
          )
        ) {
          return error(
            403,
            "OVERRIDE_TOKEN_INVALID",
            "Override token is invalid, expired, or already used.",
          );
        }
        await connection.execute(
          `UPDATE app_override_tokens SET consumed_at_ms = ?, consumed_by = ?, consumed_for_assignment = ?
                      WHERE token_id = ?`,
          [now(), assignedBy, dispatchKey, overrideTokenId],
        );
      }
      const assignedAt = now();
      const normalizedLineItems = lineItems.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
      }));
      const newShipment = {
        dispatchKey,
        obdNumber: normalizedLineItems[0]?.obdNumber || dispatchKey,
        customerName: normalizedLineItems[0]?.customerName || "Customer",
        tripStatus: "assigned",
        assignedAt: new Date(assignedAt).toISOString(),
      };
      const queueData = requested.rawData;
      const assignedShipments = [
        ...(Array.isArray(queueData.assignedShipments)
          ? queueData.assignedShipments
          : []),
        newShipment,
      ];
      const updatedQueue = {
        ...queueData,
        assignedShipment: dispatchKey,
        assignedShipments,
        activeShipmentsCount: assignedShipments.length,
        overallTripStatus: "loading",
      };
      await connection.execute(
        `INSERT INTO app_sap_assignments
                    (dispatch_key, driver_id, queue_id, driver_name, truck_plate, truck_company, truck_type,
                     line_items, assigned_at_ms, assigned_by, sap_source_fetched_at_ms, trip_status, data)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'assigned', ?)`,
        [
          dispatchKey,
          requested.driverId,
          requested.id,
          requested.driverName || "",
          requested.plateNumber || "",
          requested.truckCompany || "",
          truckType,
          JSON.stringify(normalizedLineItems),
          assignedAt,
          assignedBy,
          sapFetchedAt,
          JSON.stringify({
            sapContractVersion: "unassigned-v1",
            overrideTokenId: overrideTokenId || null,
          }),
        ],
      );
      await connection.execute(
        `UPDATE app_queue_entries SET is_assigned = TRUE, status = 'loading', data = ? WHERE id = ?`,
        [JSON.stringify(updatedQueue), requested.id],
      );
      await connection.commit();
      begun = false;
      return {
        status: 200,
        data: {
          dispatchKey,
          driverId: requestedDriverId,
          usedOverride: Boolean(overrideTokenId),
        },
      };
    } catch (cause) {
      if (cause.code === "ER_DUP_ENTRY")
        return error(
          409,
          "DISPATCH_TAKEN",
          "This dispatch is already assigned.",
        );
      throw cause;
    } finally {
      if (begun) await connection.rollback();
      connection.release();
    }
  }

  async function list({ driverId } = {}) {
    const [rows] = driverId
      ? await pool.execute(
          "SELECT * FROM app_sap_assignments WHERE driver_id = ? ORDER BY assigned_at_ms DESC LIMIT 1000",
          [driverId],
        )
      : await pool.execute(
          "SELECT * FROM app_sap_assignments ORDER BY assigned_at_ms DESC LIMIT 1000",
        );
    return rows.map(assignmentRecord);
  }

  async function get(dispatchKey) {
    const [rows] = await pool.execute(
      "SELECT * FROM app_sap_assignments WHERE dispatch_key = ?",
      [dispatchKey],
    );
    return rows.length ? assignmentRecord(rows[0]) : null;
  }

  async function updateOwn({ dispatchKey, driverId, patch }) {
    const allowed = new Set([
      "assigned",
      "loading",
      "fully_loaded",
      "loaded",
      "in_transit",
      "unloading",
      "returning_to_base",
      "completed",
    ]);
    if (
      patch.status !== undefined &&
      patch.status !== null &&
      !allowed.has(patch.status)
    ) {
      return error(400, "INVALID_STATUS", "Invalid assignment status.");
    }
    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const [rows] = await connection.execute(
        "SELECT dispatch_key, driver_id, queue_id, trip_status FROM app_sap_assignments WHERE dispatch_key = ? FOR UPDATE",
        [dispatchKey],
      );
      const assignment = rows[0];
      if (!assignment)
        return error(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
      if (assignment.driver_id !== driverId)
        return error(403, "FORBIDDEN", "Assignment belongs to another driver.");
      const status =
        patch.status === null
          ? "assigned"
          : patch.status === undefined
            ? assignment.trip_status
            : patch.status;
      const transitions = {
        assigned: new Set(["loading", "fully_loaded", "loaded", "in_transit"]),
        loading: new Set(["fully_loaded", "loaded"]),
        fully_loaded: new Set(["loading", "loaded"]),
        loaded: new Set(["in_transit", "loading"]),
        in_transit: new Set(["unloading", "returning_to_base", "completed"]),
        unloading: new Set(["in_transit", "completed"]),
        returning_to_base: new Set(["completed"]),
        completed: new Set(),
      };
      if (
        patch.status !== undefined &&
        assignment.trip_status !== status &&
        !transitions[assignment.trip_status]?.has(status) &&
        !(
          patch.status === null &&
          ["loading", "fully_loaded"].includes(assignment.trip_status)
        )
      ) {
        return error(
          409,
          "INVALID_TRANSITION",
          "Assignment status cannot move to the requested state.",
        );
      }
      const [currentRows] = await connection.execute(
        "SELECT data FROM app_sap_assignments WHERE dispatch_key = ? FOR UPDATE",
        [dispatchKey],
      );
      const data = parse(currentRows[0]?.data);
      const updatedData = { ...data };
      for (const field of [
        "driverConfirmed",
        "guardVerified",
        "guardFirstName",
        "guardLastName",
        "guardMI",
        "guardSignatureBase64",
      ]) {
        if (patch[field] !== undefined) updatedData[field] = patch[field];
      }
      if (patch.status === null) delete updatedData.loadingStartedAt;
      if (patch.status === "loading")
        updatedData.loadingStartedAt = { $timestamp: now() };
      if (patch.status === "fully_loaded")
        updatedData.fullyLoadedAt = { $timestamp: now() };
      if (patch.guardVerified === true)
        updatedData.guardVerifiedAt = { $timestamp: now() };
      if (patch.driverConfirmed === true)
        updatedData.driverConfirmedAt = { $timestamp: now() };
      await connection.execute(
        "UPDATE app_sap_assignments SET trip_status = ?, data = ? WHERE dispatch_key = ?",
        [status, JSON.stringify(updatedData), dispatchKey],
      );
      const [queues] = await connection.execute(
        "SELECT data FROM app_queue_entries WHERE id = ? FOR UPDATE",
        [assignment.queue_id],
      );
      if (queues[0]) {
        const queueData = parse(queues[0].data);
        const shipments = Array.isArray(queueData.assignedShipments)
          ? queueData.assignedShipments
          : [];
        const updated = shipments.map((item) =>
          item.dispatchKey === dispatchKey
            ? { ...item, tripStatus: status }
            : item,
        );
        const activeStatuses = updated
          .map((item) => item.tripStatus)
          .filter((value) => !["completed", "complete"].includes(value));
        const overallTripStatus =
          activeStatuses.length === 0
            ? "completed"
            : [
                "in_transit",
                "unloading",
                "returning_to_base",
                "loaded",
                "fully_loaded",
                "loading",
                "assigned",
              ].find((candidate) => activeStatuses.includes(candidate)) ||
              status;
        await connection.execute(
          "UPDATE app_queue_entries SET data = ? WHERE id = ?",
          [
            JSON.stringify({
              ...queueData,
              assignedShipments: updated,
              overallTripStatus,
              activeShipmentsCount: activeStatuses.length,
            }),
            assignment.queue_id,
          ],
        );
      }
      await connection.commit();
      begun = false;
      return { status: 200, data: await get(dispatchKey) };
    } finally {
      if (begun) await connection.rollback();
      connection.release();
    }
  }

  async function confirmMany({ dispatchKeys, driverId }) {
    if (
      !Array.isArray(dispatchKeys) ||
      dispatchKeys.length < 1 ||
      dispatchKeys.length > 100 ||
      dispatchKeys.some((key) => typeof key !== "string") ||
      new Set(dispatchKeys).size !== dispatchKeys.length
    ) {
      return error(400, "INVALID_ASSIGNMENTS", "Invalid assignments.");
    }
    const connection = await pool.getConnection();
    let begun = false;
    try {
      await connection.beginTransaction();
      begun = true;
      const placeholders = dispatchKeys.map(() => "?").join(", ");
      const [rows] = await connection.execute(
        `SELECT dispatch_key, driver_id, trip_status, data FROM app_sap_assignments
                  WHERE dispatch_key IN (${placeholders}) ORDER BY dispatch_key FOR UPDATE`,
        dispatchKeys,
      );
      if (rows.length !== dispatchKeys.length)
        return error(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "One or more assignments were not found.",
        );
      if (rows.some((row) => row.driver_id !== driverId))
        return error(
          403,
          "FORBIDDEN",
          "An assignment belongs to another driver.",
        );
      for (const row of rows) {
        const data = parse(row.data);
        await connection.execute(
          "UPDATE app_sap_assignments SET data = ? WHERE dispatch_key = ?",
          [
            JSON.stringify({
              ...data,
              driverConfirmed: true,
              driverConfirmedAt: { $timestamp: now() },
            }),
            row.dispatch_key,
          ],
        );
      }
      await connection.commit();
      begun = false;
      return {
        status: 200,
        data: await Promise.all(rows.map((row) => get(row.dispatch_key))),
      };
    } finally {
      if (begun) await connection.rollback();
      connection.release();
    }
  }

  async function hasActiveShipment(driverId) {
    const [rows] = await pool.execute(
      `SELECT 1 FROM app_sap_assignments WHERE driver_id = ?
                AND trip_status IN ('assigned', 'loading', 'loaded', 'fully_loaded', 'in_transit', 'unloading', 'returning_to_base')
              LIMIT 1`,
      [driverId],
    );
    return rows.length > 0;
  }

  async function activeLocations() {
    const [rows] = await pool.execute(
      `SELECT a.dispatch_key, a.driver_id, a.driver_name, a.truck_plate, a.trip_status,
                    l.latitude, l.longitude, l.sampled_at_ms
               FROM app_sap_assignments a JOIN app_driver_live_locations l ON l.driver_id = a.driver_id
              WHERE a.trip_status IN ('assigned', 'loading', 'loaded', 'fully_loaded', 'in_transit', 'returning_to_base')
                AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL AND l.latitude <> 0 AND l.longitude <> 0`,
    );
    return rows.map((row) => ({
      dispatchKey: row.dispatch_key,
      driverId: row.driver_id,
      driverName: row.driver_name,
      truckPlate: row.truck_plate,
      tripStatus: row.trip_status,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      at: Number(row.sampled_at_ms),
    }));
  }

  return Object.freeze({
    peek,
    assign,
    list,
    get,
    updateOwn,
    confirmMany,
    hasActiveShipment,
    activeLocations,
  });
}

let singleton;
function getMysqlAssignments({ pool } = {}) {
  if (!singleton)
    singleton = createMysqlAssignments({
      pool: pool || require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}

module.exports = { createMysqlAssignments, getMysqlAssignments };
