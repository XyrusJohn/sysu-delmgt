/**
 * Pure helpers for generating sequential IDs used by guard/company management.
 *
 * - parseGuardId(id)            → integer N for "SG-NNN", else null
 * - parseCompanyCode(code)      → integer N for numeric "NN" string, else null
 * - formatGuardId(n)            → pads to 3 digits, returns "SG-NNN"
 * - formatCompanyCode(n, w=2)   → pads to max(w, ceil(log10(n+1))) digits
 * - pickNextIdFromList(ids, format, parse) → max(N) + 1, formatted
 */

function parseGuardId(id) {
  if (typeof id !== "string") return null;
  if (!id.startsWith("SG-")) return null;
  const tail = id.slice(3);
  if (!/^\d+$/.test(tail)) return null;
  const n = Number(tail);
  if (!Number.isInteger(n)) return null;
  return n;
}

function parseCompanyCode(code) {
  if (typeof code !== "string") return null;
  if (!/^\d+$/.test(code)) return null;
  const n = Number(code);
  if (!Number.isInteger(n)) return null;
  return n;
}

function formatGuardId(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`formatGuardId requires a non-negative integer, got ${n}`);
  }
  return "SG-" + String(n).padStart(3, "0");
}

function formatCompanyCode(n, minWidth = 2) {
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`formatCompanyCode requires a non-negative integer, got ${n}`);
  }
  const width = Math.max(minWidth, Math.ceil(Math.log10(n + 1)));
  return String(n).padStart(width, "0");
}

function pickNextIdFromList(existingIds, format, parse) {
  let maxN = 0;
  for (const id of existingIds) {
    const n = parse(id);
    if (n !== null && n > maxN) maxN = n;
  }
  return format(maxN + 1);
}

module.exports = {
  parseGuardId,
  parseCompanyCode,
  formatGuardId,
  formatCompanyCode,
  pickNextIdFromList,
};