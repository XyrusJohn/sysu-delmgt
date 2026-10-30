"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseGuardId,
  parseCompanyCode,
  formatGuardId,
  formatCompanyCode,
  pickNextIdFromList,
} = require("../src/utils/idGenerator.js");

// 1. parseGuardId("SG-001") -> 1
test("parseGuardId returns 1 for SG-001", () => {
  assert.equal(parseGuardId("SG-001"), 1);
});

// 2. parseGuardId("01") -> null
test("parseGuardId returns null for bare numeric strings", () => {
  assert.equal(parseGuardId("01"), null);
});

// 3. parseGuardId("SG-XX") -> null
test("parseGuardId returns null for non-numeric tails", () => {
  assert.equal(parseGuardId("SG-XX"), null);
});

// 4. parseCompanyCode("51") -> 51
test("parseCompanyCode returns 51 for '51'", () => {
  assert.equal(parseCompanyCode("51"), 51);
});

// 5. parseCompanyCode("LALAMOVE") -> null
test("parseCompanyCode returns null for non-numeric strings", () => {
  assert.equal(parseCompanyCode("LALAMOVE"), null);
});

// 6. formatGuardId pads to 3 digits
test("formatGuardId pads to 3 digits", () => {
  assert.equal(formatGuardId(1), "SG-001");
  assert.equal(formatGuardId(42), "SG-042");
  assert.equal(formatGuardId(123), "SG-123");
});

// 7. formatCompanyCode pads to min 2 digits
test("formatCompanyCode pads to min 2 digits", () => {
  assert.equal(formatCompanyCode(1), "01");
  assert.equal(formatCompanyCode(51), "51");
});

// 8. formatCompanyCode grows width past minWidth
test("formatCompanyCode widens beyond minWidth when needed", () => {
  assert.equal(formatCompanyCode(100), "100");
  assert.equal(formatCompanyCode(999), "999");
});

// 9. pickNextIdFromList empty -> SG-001
test("pickNextIdFromList returns SG-001 for empty list (guard)", () => {
  assert.equal(pickNextIdFromList([], formatGuardId, parseGuardId), "SG-001");
});

// 10. pickNextIdFromList SG-001/002/010 -> SG-011
test("pickNextIdFromList picks max+1 across sparse ids (guard)", () => {
  assert.equal(
    pickNextIdFromList(["SG-001", "SG-002", "SG-010"], formatGuardId, parseGuardId),
    "SG-011"
  );
});

// 11. pickNextIdFromList skips non-matching entries
test("pickNextIdFromList ignores non-matching entries", () => {
  assert.equal(
    pickNextIdFromList(["SG-001", "BAD"], formatGuardId, parseGuardId),
    "SG-002"
  );
});

// 12. pickNextIdFromList widens when crossing width boundary
test("pickNextIdFromList widens to new digit count", () => {
  assert.equal(
    pickNextIdFromList(["SG-099"], formatGuardId, parseGuardId),
    "SG-100"
  );
});

// 13. pickNextIdFromList works for company codes too
test("pickNextIdFromList works for company codes", () => {
  assert.equal(pickNextIdFromList([], formatCompanyCode, parseCompanyCode), "01");
  assert.equal(
    pickNextIdFromList(["01", "02", "51"], formatCompanyCode, parseCompanyCode),
    "52"
  );
});