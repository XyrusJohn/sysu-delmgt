const CACHE_PREFIX = "sysu.offline.truck-companies.v1.";
const CACHE_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 2000;
const MAX_BYTES = 256 * 1024;

function storage() {
    try {
        return globalThis.localStorage;
    } catch {
        try { store.removeItem(key); } catch { /* A blocked storage API stays a cache miss. */ }
        return null;
    }
}

function keyFor(accountId) {
    if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(accountId)) return null;
    return `${CACHE_PREFIX}${accountId}`;
}

function validRows(rows) {
    return Array.isArray(rows) && rows.length <= MAX_ROWS && rows.every(row =>
        row && typeof row === "object" && !Array.isArray(row)
        && typeof row.id === "string" && row.id.length > 0 && row.id.length <= 80
        && typeof row.companyCode === "string" && row.companyCode.length > 0 && row.companyCode.length <= 80
        && typeof row.name === "string" && row.name.length > 0 && row.name.length <= 200
        && (row.forwarderCode == null || (typeof row.forwarderCode === "string" && row.forwarderCode.length <= 80))
        && typeof row.active === "boolean");
}

export function readTruckCompanyCache(accountId, now = Date.now()) {
    const key = keyFor(accountId);
    const store = storage();
    if (!key || !store) return null;
    try {
        const raw = store.getItem(key);
        if (!raw) return null;
        if (new Blob([raw]).size > MAX_BYTES) {
            store.removeItem(key);
            return null;
        }
        const entry = JSON.parse(raw);
        if (entry.version !== CACHE_VERSION || !Number.isSafeInteger(entry.fetchedAt)
            || entry.fetchedAt > now || now - entry.fetchedAt > MAX_AGE_MS || !validRows(entry.rows)) {
            store.removeItem(key);
            return null;
        }
        return {rows: entry.rows, fetchedAt: entry.fetchedAt};
    } catch {
        return null;
    }
}

export function writeTruckCompanyCache(accountId, rows, fetchedAt = Date.now()) {
    const key = keyFor(accountId);
    const store = storage();
    if (!key || !store || !Number.isSafeInteger(fetchedAt) || !validRows(rows)) return false;
    try {
        const value = JSON.stringify({version: CACHE_VERSION, fetchedAt, rows});
        if (new Blob([value]).size > MAX_BYTES) return false;
        store.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

export function clearTruckCompanyCache(accountId) {
    const key = keyFor(accountId);
    const store = storage();
    if (key && store) {
        try { store.removeItem(key); } catch { /* Storage cleanup must not block sign-out. */ }
    }
}

export const TRUCK_COMPANY_CACHE_MAX_AGE_MS = MAX_AGE_MS;
