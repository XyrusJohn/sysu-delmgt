const { asyncWrapper } = require("../../middleware/asyncWrapper.js");
const { z } = require("zod");
const { parseCompanyCode } = require("../../utils/idGenerator.js");

const companySchema = z.object({
  forwarderCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(
      /^[A-Za-z0-9-]+$/,
      "forwarderCode may only contain letters, digits, and hyphens",
    ),
  name: z.string().trim().min(1).max(200),
});

function store() {
  return require("../../services/mysqlMasterData").getMysqlMasterData();
}

exports.createTruckCompany = asyncWrapper(async (req, res) => {
  const { forwarderCode, name } = companySchema.parse(req.body);
  const record = await store().createCompany({ forwarderCode, name });
  return res.status(201).json(record);
});

exports.updateTruckCompany = asyncWrapper(async (req, res) => {
  const { code } = req.params;
  if (!parseCompanyCode(code))
    return res
      .status(400)
      .json({ errors: [{ field: "code", message: "Invalid companyCode" }] });

  const masterData = store();
  const existing = await masterData.getCompany(code);
  if (!existing)
    return res.status(404).json({ message: "Truck company not found" });
  const normalized = companySchema.parse({
    forwarderCode:
      req.body.forwarderCode !== undefined
        ? req.body.forwarderCode
        : existing.forwarderCode,
    name: req.body.name !== undefined ? req.body.name : existing.name,
  });
  const record = await masterData.updateCompany(code, normalized);
  return record
    ? res.status(200).json(record)
    : res.status(404).json({ message: "Truck company not found" });
});

exports.setTruckCompanyActive = asyncWrapper(async (req, res) => {
  const { code } = req.params;
  if (!parseCompanyCode(code))
    return res
      .status(400)
      .json({ errors: [{ field: "code", message: "Invalid companyCode" }] });
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const record = await store().setCompanyActive(code, active);
  return record
    ? res.status(200).json(record)
    : res.status(404).json({ message: "Truck company not found" });
});

exports.deleteTruckCompany = asyncWrapper(async (req, res) => {
  const { code } = req.params;
  if (!parseCompanyCode(code))
    return res
      .status(400)
      .json({ errors: [{ field: "code", message: "Invalid companyCode" }] });
  const deleted = await store().deleteCompany(code);
  return deleted
    ? res.status(200).json({ success: true, id: code })
    : res.status(404).json({ message: "Truck company not found" });
});
