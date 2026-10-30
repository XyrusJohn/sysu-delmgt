const { asyncWrapper } = require("../middleware/asyncWrapper.js");
const { z } = require("zod");

const ROLES = [
  "admin",
  "driver",
  "fleet_manager",
  "pending",
  "super_admin",
  "qr_generator",
];
const uidSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("/"));
const updateRoleSchema = z.object({ uid: uidSchema, role: z.enum(ROLES) });
const governance = () =>
  require("../services/mysqlRoleGovernance").getMysqlRoleGovernance();

function notify(uid, event, data) {
  global._io?.to(`user:${uid}`).emit(event, data);
}

exports.updateUserRole = asyncWrapper(async (req, res) => {
  const { uid, role } = updateRoleSchema.parse(req.body);
  await governance().updateRole({ actorId: req.user.uid, targetId: uid, role });
  notify(uid, "user_role_changed", { uid, role });
  return res.json({ success: true, message: "User role updated successfully" });
});

exports.deleteUser = asyncWrapper(async (req, res) => {
  const { uid } = z.object({ uid: uidSchema }).parse(req.body);
  await governance().disableUser({ actorId: req.user.uid, targetId: uid });
  notify(uid, "account_deleted", { uid });
  return res.json({ success: true, message: "User deleted successfully" });
});
