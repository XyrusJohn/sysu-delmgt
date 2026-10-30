const { asyncWrapper } = require("../../middleware/asyncWrapper.js");
const { z } = require("zod");
const { parseGuardId } = require("../../utils/idGenerator.js");

const guardSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  middleInitial: z.string().trim().max(5).optional().or(z.literal("")),
});

function buildFullName(firstName, lastName, middleInitial) {
  const safeFirst = (firstName || "").trim().replace(/\s+/g, " ");
  const safeLast = (lastName || "").trim().replace(/\s+/g, " ");
  const safeMiddle = (middleInitial || "").trim().replace(/\s+/g, " ");
  return `${safeFirst} ${safeMiddle ? `${safeMiddle} ` : ""}${safeLast}`
    .replace(/\s+/g, " ")
    .trim();
}

function store() {
  return require("../../services/mysqlMasterData").getMysqlMasterData();
}

exports.createGuard = asyncWrapper(async (req, res) => {
  const { firstName, lastName, middleInitial } = guardSchema.parse(req.body);
  const record = await store().createGuard({
    firstName,
    lastName,
    middleInitial: middleInitial || "",
    fullName: buildFullName(firstName, lastName, middleInitial),
  });
  return res.status(201).json(record);
});

exports.updateGuard = asyncWrapper(async (req, res) => {
  const { id } = req.params;
  if (!parseGuardId(id))
    return res
      .status(400)
      .json({ errors: [{ field: "id", message: "Invalid guardId" }] });

  const masterData = store();
  const existing = await masterData.getGuard(id);
  if (!existing) return res.status(404).json({ message: "Guard not found" });
  const normalized = guardSchema.parse({
    firstName:
      req.body.firstName !== undefined
        ? req.body.firstName
        : existing.firstName,
    lastName:
      req.body.lastName !== undefined ? req.body.lastName : existing.lastName,
    middleInitial:
      req.body.middleInitial !== undefined
        ? req.body.middleInitial
        : existing.middleInitial,
  });
  const record = await masterData.updateGuard(id, {
    ...normalized,
    middleInitial: normalized.middleInitial || "",
    fullName: buildFullName(
      normalized.firstName,
      normalized.lastName,
      normalized.middleInitial,
    ),
  });
  return record
    ? res.status(200).json(record)
    : res.status(404).json({ message: "Guard not found" });
});

exports.setGuardActive = asyncWrapper(async (req, res) => {
  const { id } = req.params;
  if (!parseGuardId(id))
    return res
      .status(400)
      .json({ errors: [{ field: "id", message: "Invalid guardId" }] });
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const record = await store().setGuardActive(id, active);
  return record
    ? res.status(200).json(record)
    : res.status(404).json({ message: "Guard not found" });
});

exports.deleteGuard = asyncWrapper(async (req, res) => {
  const { id } = req.params;
  if (!parseGuardId(id))
    return res
      .status(400)
      .json({ errors: [{ field: "id", message: "Invalid guardId" }] });
  const deleted = await store().deleteGuard(id);
  return deleted
    ? res.status(200).json({ success: true, id })
    : res.status(404).json({ message: "Guard not found" });
});
