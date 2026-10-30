const { z } = require("zod");
const { asyncWrapper } = require("../middleware/asyncWrapper.js");
const sapSource = require("../services/sapSource");
const { validateAssignment } = require("../services/sapAssignmentPolicy");

const documentIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      value === value.trim() &&
      !value.includes("/") &&
      value !== "." &&
      value !== ".." &&
      !/^__.*__$/.test(value) &&
      [...value].every(
        (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
      ),
    "Invalid document identifier",
  );
const reasonSchema = z.string().trim().min(1).max(2000);
const quantitySchema = z
  .number()
  .finite()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const nonnegativeSapNumberSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .optional();

const lineItemSchema = z.object({
  obdNumber: documentIdSchema,
  quantity: z.union([
    quantitySchema,
    z
      .string()
      .max(32)
      .regex(/^\d+(\.\d+)?$/)
      .transform(Number)
      .pipe(quantitySchema),
  ]),
  customerName: z.string().trim().min(1).max(500),
  shipTo: z.string().trim().max(128).optional(),
  deliveryAddress: z.string().trim().max(1000).optional(),
  volume: nonnegativeSapNumberSchema,
  weight: nonnegativeSapNumberSchema,
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  amount: z.undefined().optional(),
});

const assignDriverSchema = z.object({
  dispatchKey: documentIdSchema,
  requestedDriverId: documentIdSchema,
  truckType: z.string().trim().min(1).max(64),
  overrideTokenId: documentIdSchema.nullish(),
  driverSnapshot: z.any().optional(),
  lineItems: z.array(lineItemSchema).min(1).max(500),
});
const overrideRequestSchema = z.object({
  dispatchKey: documentIdSchema,
  requestedDriverId: documentIdSchema,
  reason: reasonSchema,
});
const overrideDecisionSchema = z.object({
  requestId: documentIdSchema,
  decision: z.enum(["approved", "denied"]),
  reason: reasonSchema.optional(),
});
const cancelRequestSchema = z.object({
  dispatchKey: documentIdSchema,
  reason: reasonSchema,
});
const cancelDecisionSchema = z.object({
  requestId: documentIdSchema,
  decision: z.enum(["approved", "denied"]),
  reason: reasonSchema.optional(),
});
const revokeSchema = z.object({ requestId: documentIdSchema });

const assignments = () =>
  require("../services/mysqlAssignments").getMysqlAssignments();
const dispatchGovernance = () =>
  require("../services/mysqlDispatchGovernance").getMysqlDispatchGovernance();

exports.peekEarliest = asyncWrapper(async (req, res) => {
  const dispatchKey = (req.query.dispatchKey || "").toString().trim();
  const truckType = (req.query.truckType || "").toString().trim();
  if (!dispatchKey)
    return res
      .status(400)
      .json({ success: false, message: "dispatchKey is required" });
  const data = await assignments().peek(dispatchKey, truckType);
  return res.json({ success: true, data });
});

exports.getAssignment = asyncWrapper(async (req, res) => {
  const assignment = await assignments().get(req.params.dispatchKey);
  return assignment
    ? res.json({ success: true, data: assignment })
    : res.status(404).json({ success: false, message: "Assignment not found" });
});

exports.assignDriver = asyncWrapper(async (req, res) => {
  const body = assignDriverSchema.parse(req.body);
  const sapSnapshot = await sapSource.read({ maxAge: 5000 });
  const sapCheck = validateAssignment(sapSnapshot.rows, body);
  if (sapCheck.status !== 200) {
    return res
      .status(sapCheck.status)
      .json({ success: false, code: sapCheck.code, message: sapCheck.message });
  }
  const result = await assignments().assign({
    body,
    assignedBy: req.user?.uid,
    lineItems: sapCheck.lineItems,
    sapFetchedAt: sapSnapshot.fetchedAt,
  });
  return res
    .status(result.status)
    .json(
      result.status === 200
        ? { success: true, data: result.data }
        : {
            success: false,
            code: result.code,
            message: result.message,
            meta: result.meta,
          },
    );
});

function sendDecision(res, result) {
  return res
    .status(result.status)
    .json(
      result.status === 200
        ? { success: true, data: result.data }
        : { success: false, message: result.message },
    );
}

exports.requestOverride = asyncWrapper(async (req, res) => {
  const input = overrideRequestSchema.parse(req.body);
  return sendDecision(
    res,
    await dispatchGovernance().requestOverride({
      ...input,
      requestedBy: req.user?.uid,
    }),
  );
});

exports.decideOverride = asyncWrapper(async (req, res) => {
  const input = overrideDecisionSchema.parse(req.body);
  return sendDecision(
    res,
    await dispatchGovernance().decideOverride({
      ...input,
      decidedBy: req.user.uid,
    }),
  );
});

exports.revokeOverride = asyncWrapper(async (req, res) => {
  const input = revokeSchema.parse(req.body);
  return sendDecision(
    res,
    await dispatchGovernance().revoke("override", {
      ...input,
      uid: req.user.uid,
    }),
  );
});

exports.requestCancelAssignment = asyncWrapper(async (req, res) => {
  const input = cancelRequestSchema.parse(req.body);
  return sendDecision(
    res,
    await dispatchGovernance().requestCancellation({
      ...input,
      requestedBy: req.user.uid,
    }),
  );
});

exports.decideCancelAssignment = asyncWrapper(async (req, res) => {
  const input = cancelDecisionSchema.parse(req.body);
  return sendDecision(
    res,
    await dispatchGovernance().decideCancellation({
      ...input,
      decidedBy: req.user.uid,
    }),
  );
});

exports.revokeCancelAssignment = asyncWrapper(async (req, res) => {
  const input = revokeSchema.parse(req.body);
  return sendDecision(
    res,
    await dispatchGovernance().revoke("cancel", {
      ...input,
      uid: req.user.uid,
    }),
  );
});

exports.getDispatchRequest = asyncWrapper(async (req, res) => {
  const kind = req.path.startsWith("/cancel/") ? "cancel" : "override";
  const staff = ["admin", "super_admin"].includes(req.user.role);
  const service = dispatchGovernance();
  if (req.params.requestId) {
    const request = await service.getRequest(
      req.params.requestId,
      kind,
      staff ? null : req.user.uid,
    );
    return request
      ? res.json({ success: true, data: request })
      : res.status(404).json({ success: false, message: "Request not found" });
  }
  const dispatchKey =
    typeof req.query.dispatchKey === "string" ? req.query.dispatchKey : "";
  if (!dispatchKey || dispatchKey.length > 128)
    return res
      .status(400)
      .json({ success: false, message: "dispatchKey is required" });
  const data = await service.listRequests(kind, {
    dispatchKey,
    requestedBy: staff ? null : req.user.uid,
  });
  return res.json({ success: true, data });
});

exports.getActiveDriverLocations = asyncWrapper(async (_req, res) => {
  const locations = await assignments().activeLocations();
  return res.json({ success: true, locations });
});
