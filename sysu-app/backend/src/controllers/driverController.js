const { asyncWrapper } = require("../middleware/asyncWrapper.js");
const { z } = require("zod");

const updateFullSchema = z.object({ isFull: z.boolean() });
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (value) =>
      !value.includes("/") &&
      ![...value].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) &&
      ![".", ".."].includes(value),
  );
const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(32),
    license: z.string().trim().max(128),
    truckType: z.string().trim().min(1).max(64),
    plateNumber: z.string().trim().min(1).max(64),
    truckingCompany: z.string().trim().max(200),
    helper: z.string().trim().max(200),
    notes: z.string().trim().max(2000),
    requirements: z
      .record(z.boolean())
      .optional()
      .refine(
        (value) =>
          value === undefined ||
          (Object.keys(value).length <= 64 &&
            Object.keys(value).every((key) =>
              /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key),
            )),
        "Invalid requirements",
      ),
  })
  .strict();

const profiles = () =>
  require("../services/mysqlDriverProfiles").getMysqlDriverProfiles();

exports.getDriver = asyncWrapper(async (req, res) => {
  const { driverId } = req.params;
  if (!driverId)
    return res
      .status(400)
      .json({ success: false, message: "driverId is required" });
  if (req.userData?.role === "driver" && req.user.uid !== driverId) {
    return res
      .status(403)
      .json({ success: false, message: "Cannot read another driver profile" });
  }
  const record = await profiles().get(driverId);
  if (!record)
    return res
      .status(404)
      .json({ success: false, message: "Driver not found" });
  return res.json({ success: true, data: record });
});

exports.updateDriverFull = asyncWrapper(async (req, res) => {
  const { driverId } = req.params;
  if (req.userData?.role === "driver" && req.user.uid !== driverId) {
    return res
      .status(403)
      .json({
        success: false,
        message: "Cannot change another driver capacity",
      });
  }
  const { isFull } = updateFullSchema.parse(req.body);
  await profiles().setCapacity(driverId, isFull);
  global._io
    ?.to("dispatchers")
    .emit("driver_capacity_updated", { driverId, isFull });
  return res.json({ success: true, driverId, isFull });
});

exports.saveDriverProfile = asyncWrapper(async (req, res) => {
  const id = identifier.parse(req.params.driverId);
  const input = profileSchema.parse(req.body);
  await profiles().save({ actorId: req.user.uid, driverId: id, input });
  return res.json({ success: true, driverId: id });
});

exports.deleteDriverProfile = asyncWrapper(async (req, res) => {
  const id = identifier.parse(req.params.driverId);
  const profile = await profiles().get(id);
  if (profile)
    throw Object.assign(
      new Error(
        "Linked driver profile retained; use account administration or reconciliation",
      ),
      { statusCode: 409 },
    );
  return res.json({ success: true, driverId: id });
});
