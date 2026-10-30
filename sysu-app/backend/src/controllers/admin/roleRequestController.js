const { z } = require("zod");

const ROLES = [
  "admin",
  "driver",
  "fleet_manager",
  "pending",
  "super_admin",
  "qr_generator",
];

function notify(event, result, uid) {
  if (!global._io) return;
  global._io.to("role-reviewers").emit(event, result);
  if (uid) global._io.to("user:" + uid).emit(event, result);
}

function governance() {
  return require("../../services/mysqlRoleGovernance").getMysqlRoleGovernance();
}

async function getRoleRequests(status = "pending", reviewerId) {
  return governance().listRequests(status, reviewerId);
}

async function createRoleRequest({ requesterId, requestedRole }) {
  const role = z.enum(ROLES).parse(requestedRole);
  const result = await governance().createRequest({
    requesterId,
    requestedRole: role,
  });
  notify("role_request_created", result, requesterId);
  return result;
}

async function decide(requestId, reviewerId, approved, reason = "") {
  z.string().min(1).max(128).parse(requestId);
  const result = await governance().decide({
    requestId,
    reviewerId,
    approved,
    reason,
  });
  notify("role_request_updated", result, result.requesterId);
  if (approved && global._io) {
    global._io
      .to("user:" + result.requesterId)
      .emit("user_role_changed", {
        uid: result.requesterId,
        role: result.requestedRole,
      });
  }
  return result;
}

const approveRoleRequest = (id, reviewer) => decide(id, reviewer, true);
const rejectRoleRequest = (id, reviewer, reason) =>
  decide(id, reviewer, false, reason);

module.exports = {
  getRoleRequests,
  createRoleRequest,
  approveRoleRequest,
  rejectRoleRequest,
};
