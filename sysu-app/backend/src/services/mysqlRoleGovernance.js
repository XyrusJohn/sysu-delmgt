const { randomUUID } = require("node:crypto");

const ROLES = new Set([
  "pending",
  "driver",
  "fleet_manager",
  "qr_generator",
  "admin",
  "super_admin",
]);
const POSITIONS = {
  pending: "Pending Approval",
  driver: "Driver",
  fleet_manager: "Fleet Manager",
  qr_generator: "QR Generator",
  admin: "Admin",
  super_admin: "Super Admin",
};
const fail = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });
const jsonProfile = (value) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) || {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
};
const publicProfile = (value) => {
  const parsed = jsonProfile(value);
  const profile =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...parsed }
      : {};
  delete profile.email;
  delete profile.emailVerified;
  return profile;
};
const profileDisplayName = (profile) => {
  const firstName = (profile.firstName || profile.fn || "").trim();
  const middleName = (profile.middleName || profile.mi || "").trim();
  const lastName = (profile.lastName || profile.ln || "").trim();
  if (firstName && lastName)
    return [firstName, middleName, lastName].filter(Boolean).join(" ");
  return typeof profile.name === "string" ? profile.name.trim() : "";
};
const iso = (value) =>
  value instanceof Date ? value.toISOString() : value || null;

function requestRecord(row) {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    currentRole: row.current_role,
    requestedRole: row.requested_role,
    status: row.status,
    reviewerId: row.reviewer_id || null,
    rejectionReason: row.rejection_reason || null,
    createdAt: iso(row.created_at),
    reviewedAt: iso(row.reviewed_at),
  };
}

function createMysqlRoleGovernance({ pool }) {
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
      return result;
    } catch (error) {
      if (begun) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function loadUser(connection, publicId, lock = false) {
    const [rows] = await connection.execute(
      `SELECT id, public_id, username, display_name, role, status, profile
             FROM app_auth_users WHERE public_id = ? ${lock ? "FOR UPDATE" : ""}`,
      [publicId],
    );
    return rows[0] || null;
  }

  function requireReviewer(user) {
    if (
      !user ||
      user.status !== "active" ||
      !["admin", "super_admin"].includes(user.role)
    ) {
      throw fail(403, "Admin privileges required");
    }
  }

  async function audit(connection, actorId, targetId, action, details = {}) {
    await connection.execute(
      "INSERT INTO app_user_admin_audit (actor_id, target_id, action, details) VALUES (?, ?, ?, ?)",
      [actorId, targetId, action, JSON.stringify(details)],
    );
  }

  async function listRequests(status = "pending", reviewerId) {
    if (!["all", "pending", "approved", "rejected"].includes(status))
      throw fail(400, "Invalid request status");
    const reviewer = await loadUser(pool, reviewerId);
    requireReviewer(reviewer);
    const [rows] =
      status === "all"
        ? await pool.execute(
            "SELECT id, requester_id, requester_name, current_role, requested_role, status, reviewer_id, rejection_reason, created_at, reviewed_at FROM app_role_requests ORDER BY created_at DESC LIMIT 200",
          )
        : await pool.execute(
            "SELECT id, requester_id, requester_name, current_role, requested_role, status, reviewer_id, rejection_reason, created_at, reviewed_at FROM app_role_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200",
            [status],
          );
    return rows.map(requestRecord);
  }

  async function listUsers() {
    const [rows] = await pool.execute(
      `SELECT public_id, username, display_name, role, status, profile
             FROM app_auth_users ORDER BY created_at DESC LIMIT 2000`,
    );
    return rows.map((row) => {
      const profile = publicProfile(row.profile);
      const storedName =
        typeof row.display_name === "string" ? row.display_name.trim() : "";
      const profileName = profileDisplayName(profile);
      const displayName =
        storedName && storedName.toLowerCase() !== row.username?.toLowerCase()
          ? storedName
          : profileName || storedName;
      return {
        ...profile,
        id: row.public_id,
        uid: row.public_id,
        username: row.username,
        displayName,
        role: row.role,
        status: row.status,
      };
    });
  }

  async function createRequest({ requesterId, requestedRole }) {
    if (!ROLES.has(requestedRole)) throw fail(400, "Invalid requested role");
    return transaction(async (connection) => {
      const user = await loadUser(connection, requesterId, true);
      if (!user || user.status === "disabled")
        throw fail(403, "Profile required");
      const profile = jsonProfile(user.profile);
      if (profile.pendingRoleChange)
        throw fail(409, "A role request is already pending");
      const id = randomUUID();
      try {
        await connection.execute(
          `INSERT INTO app_role_requests
                     (id, requester_id, requester_name, current_role, requested_role)
                     VALUES (?, ?, ?, ?, ?)`,
          [
            id,
            requesterId,
            user.display_name || profile.name || user.username || "User",
            user.role,
            requestedRole,
          ],
        );
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY")
          throw fail(409, "A role request is already pending");
        throw error;
      }
      await connection.execute(
        "UPDATE app_auth_users SET profile = ? WHERE public_id = ?",
        [
          JSON.stringify({ ...profile, pendingRoleChange: requestedRole }),
          requesterId,
        ],
      );
      const [rows] = await connection.execute(
        "SELECT id, requester_id, requester_name, current_role, requested_role, status, reviewer_id, rejection_reason, created_at, reviewed_at FROM app_role_requests WHERE id = ?",
        [id],
      );
      return requestRecord(rows[0]);
    });
  }

  async function decide({ requestId, reviewerId, approved, reason = "" }) {
    if (typeof requestId !== "string" || requestId.length > 128 || !requestId)
      throw fail(400, "Invalid request");
    if (typeof reason !== "string" || reason.length > 1000)
      throw fail(400, "Invalid reason");
    return transaction(async (connection) => {
      const reviewer = await loadUser(connection, reviewerId, true);
      requireReviewer(reviewer);
      const [requests] = await connection.execute(
        "SELECT id, requester_id, requester_name, current_role, requested_role, status, reviewer_id, rejection_reason, created_at, reviewed_at FROM app_role_requests WHERE id = ? FOR UPDATE",
        [requestId],
      );
      const request = requests[0];
      if (!request) throw fail(404, "Role request not found");
      if (request.requester_id === reviewerId)
        throw fail(403, "Cannot review your own request");
      if (request.status !== "pending")
        throw fail(409, "Request already decided");
      const user = await loadUser(connection, request.requester_id, true);
      if (!user) throw fail(404, "Requester not found");
      const profile = jsonProfile(user.profile);
      if (profile.pendingRoleChange !== request.requested_role)
        throw fail(409, "Role request was superseded");
      if (
        (request.requested_role === "super_admin" ||
          user.role === "super_admin") &&
        reviewer.role !== "super_admin"
      ) {
        throw fail(403, "Only super-admins may change a super-admin role");
      }
      if (approved && profile.deletionState)
        throw fail(409, "Account deletion is in progress");
      const nextProfile = { ...profile, pendingRoleChange: null };
      if (approved) nextProfile.position = POSITIONS[request.requested_role];
      await connection.execute(
        "UPDATE app_auth_users SET role = ?, status = ?, profile = ? WHERE public_id = ?",
        [
          approved ? request.requested_role : user.role,
          approved
            ? request.requested_role === "pending"
              ? "inactive"
              : "active"
            : user.status,
          JSON.stringify(nextProfile),
          user.public_id,
        ],
      );
      if (approved && request.requested_role === "driver") {
        await connection.execute(
          `INSERT IGNORE INTO app_driver_profiles (driver_id, name, phone, trucking_company)
                     VALUES (?, ?, ?, ?)`,
          [
            user.public_id,
            nextProfile.name || user.display_name || "",
            nextProfile.phone || "",
            nextProfile.truckingCompany || "",
          ],
        );
      }
      await connection.execute(
        "UPDATE app_role_requests SET status = ?, reviewer_id = ?, reviewed_at = UTC_TIMESTAMP(3), rejection_reason = ? WHERE id = ?",
        [
          approved ? "approved" : "rejected",
          reviewerId,
          approved ? null : reason,
          requestId,
        ],
      );
      await audit(
        connection,
        reviewerId,
        user.public_id,
        approved ? "role_request_approved" : "role_request_rejected",
        { requestId, requestedRole: request.requested_role },
      );
      return {
        id: requestId,
        requesterId: user.public_id,
        requestedRole: request.requested_role,
        status: approved ? "approved" : "rejected",
      };
    });
  }

  async function updateRole({ actorId, targetId, role }) {
    if (!ROLES.has(role)) throw fail(400, "Invalid role");
    return transaction(async (connection) => {
      const actor = await loadUser(connection, actorId, true);
      requireReviewer(actor);
      if (actorId === targetId) throw fail(403, "Cannot change your own role");
      const target = await loadUser(connection, targetId, true);
      if (!target) throw fail(404, "User not found");
      if (
        (role === "super_admin" || target.role === "super_admin") &&
        actor.role !== "super_admin"
      ) {
        throw fail(403, "Only super-admins may change a super-admin role");
      }
      const profile = jsonProfile(target.profile);
      if (profile.deletionState)
        throw fail(409, "Account deletion is in progress");
      await connection.execute(
        "UPDATE app_auth_users SET role = ?, status = ?, profile = ? WHERE public_id = ?",
        [
          role,
          role === "pending" ? "inactive" : "active",
          JSON.stringify({
            ...profile,
            position: POSITIONS[role],
            pendingRoleChange: null,
          }),
          targetId,
        ],
      );
      if (role === "driver") {
        await connection.execute(
          `INSERT IGNORE INTO app_driver_profiles (driver_id, name, phone, trucking_company)
                     VALUES (?, ?, ?, ?)`,
          [
            targetId,
            profile.name || target.display_name || "",
            profile.phone || "",
            profile.truckingCompany || "",
          ],
        );
      }
      await connection.execute(
        "UPDATE app_role_requests SET status = 'rejected', reviewer_id = ?, reviewed_at = UTC_TIMESTAMP(3), rejection_reason = 'Direct admin role change' WHERE requester_id = ? AND status = 'pending'",
        [actorId, targetId],
      );
      await audit(connection, actorId, targetId, "role_changed", {
        fromRole: target.role,
        toRole: role,
      });
      return { uid: targetId, role };
    });
  }

  async function disableUser({ actorId, targetId }) {
    return transaction(async (connection) => {
      const actor = await loadUser(connection, actorId, true);
      if (!actor || actor.role !== "super_admin" || actor.status !== "active")
        throw fail(403, "Super-admin privileges required");
      if (actorId === targetId)
        throw fail(403, "Cannot delete your own account");
      const target = await loadUser(connection, targetId, true);
      if (!target) throw fail(404, "User not found");
      const profile = jsonProfile(target.profile);
      await connection.execute(
        "UPDATE app_auth_users SET role = 'pending', status = 'disabled', profile = ? WHERE public_id = ?",
        [
          JSON.stringify({
            ...profile,
            deletionState: "complete",
            pendingRoleChange: null,
          }),
          targetId,
        ],
      );
      await connection.execute(
        "UPDATE app_auth_sessions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL",
        [target.id],
      );
      await connection.execute(
        "UPDATE app_role_requests SET status = 'rejected', reviewer_id = ?, reviewed_at = UTC_TIMESTAMP(3), rejection_reason = 'Account disabled' WHERE requester_id = ? AND status = 'pending'",
        [actorId, targetId],
      );
      await audit(connection, actorId, targetId, "deletion_completed");
      return { uid: targetId };
    });
  }

  return Object.freeze({
    listRequests,
    listUsers,
    createRequest,
    decide,
    updateRole,
    disableUser,
  });
}

let singleton;
function getMysqlRoleGovernance() {
  if (!singleton)
    singleton = createMysqlRoleGovernance({
      pool: require("../config/mysql").createMySqlPool(),
    });
  return singleton;
}

module.exports = { createMysqlRoleGovernance, getMysqlRoleGovernance };
