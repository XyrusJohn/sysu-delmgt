import {clearTruckCompanyCache, readTruckCompanyCache, writeTruckCompanyCache} from "./truckCompanyOfflineCache.js";
import {fetchWithTimeout} from "./fetchWithTimeout.js";

async function authedFetch(url, options = {}) {
    const {AuthService} = await import("./authService.js");
    const token = await AuthService.getToken();
    const response = await fetchWithTimeout(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
    });

    let body;
    try {
        body = await response.json();
    } catch (e) {
        body = null;
    }

    if (!response.ok) {
        const error = new Error(
            (body && body.message) || `HTTP ${response.status}`,
        );
        error.status = response.status;
        error.body = body;
        throw error;
    }

    return body;
}

async function adminUrl(path = "") {
    const {API_CONFIG} = await import("./config.js");
    return `${API_CONFIG.BASE_URL}/api/admin/truck-companies${path}`;
}

export const TruckCompanyService = {
    /**
     * Subscribe to MySQL-backed truck company records. The callback receives
     * a map keyed by company code and returns the unsubscribe function.
     */
    async subscribe(callback, onError) {
        const {AuthService} = await import("./authService.js");
        const accountId = AuthService.getUserProfile()?.id;
        let cached = accountId ? readTruckCompanyCache(accountId) : null;
        let currentSource = null;
        const mapFromRows = async rows => {
            const {asCollectionSnapshot} = await import("./realtimeService.js");
            return rowsToMap(rows, asCollectionSnapshot);
        };
        if (cached) {
            currentSource = "cache";
            callback(await mapFromRows(cached.rows), {source: "cache", stale: true, fetchedAt: cached.fetchedAt});
        }
        const handleError = error => {
            console.error("TruckCompanyService subscribe error:", error);
            if (cached && currentSource !== "cache") {
                currentSource = "cache";
                void mapFromRows(cached.rows).then(map => callback(map, {
                    source: "cache", stale: true, fetchedAt: cached.fetchedAt,
                }));
            }
            if (onError) onError(error, {cached: Boolean(cached)});
            else if (!cached) callback({}, {source: "error", stale: false, fetchedAt: null});
        };
        const {subscribeRealtime, asCollectionSnapshot} = await import("./realtimeService.js");
        return subscribeRealtime("truckCompanies", {}, (rows) => {
            if (!truckCompanyRowsAreValid(rows)) {
                handleError(new Error("Invalid truck-company snapshot"));
                return;
            }
            const map = rowsToMap(rows, asCollectionSnapshot);
            const fetchedAt = Date.now();
            if (accountId && writeTruckCompanyCache(accountId, rows, fetchedAt)) {
                cached = {rows, fetchedAt};
            }
            currentSource = "server";
            callback(map, {source: "server", stale: false, fetchedAt});
        }, handleError);
    },

    clearCacheForAccount(accountId) {
        clearTruckCompanyCache(accountId);
    },

    /**
     * Create a new truck company. Server returns the created record
     * (including generated companyCode).
     */
    async create({forwarderCode, name}) {
        const url = await adminUrl();
        return authedFetch(url, {
            method: "POST",
            body: JSON.stringify({forwarderCode, name}),
        });
    },

    /**
     * Update editable truck company fields (forwarderCode, name).
     */
    async update(code, {forwarderCode, name}) {
        const url = await adminUrl(`/${encodeURIComponent(code)}`);
        return authedFetch(url, {
            method: "PATCH",
            body: JSON.stringify({forwarderCode, name}),
        });
    },

    /**
     * Soft-delete (or reactivate) a truck company by flipping the
     * active flag.
     */
    async setActive(code, active) {
        const url = await adminUrl(`/${encodeURIComponent(code)}/active`);
        return authedFetch(url, {
            method: "PATCH",
            body: JSON.stringify({active}),
        });
    },

    async delete(code) {
        const url = await adminUrl(`/${encodeURIComponent(code)}`);
        return authedFetch(url, {method: "DELETE"});
    },

    /**
     * Pure client-side search. Case-insensitive substring match across
     * companyCode, name, and forwarderCode. Empty/whitespace query
     * returns docs unchanged.
     */
    search(query, docs) {
        if (query == null) return docs;
        const trimmed = String(query).trim();
        if (trimmed === "") return docs;
        const needle = trimmed.toLowerCase();
        return docs.filter((doc) => {
            const fields = [
                doc && doc.companyCode,
                doc && doc.name,
                doc && doc.forwarderCode,
            ];
            return fields.some(
                (value) =>
                    typeof value === "string" &&
                    value.toLowerCase().includes(needle),
            );
        });
    },
};

function truckCompanyRowsAreValid(rows) {
    return Array.isArray(rows) && rows.length <= 2000 && rows.every(row =>
        row && typeof row === "object" && !Array.isArray(row)
        && typeof row.id === "string" && typeof row.companyCode === "string"
        && typeof row.name === "string" && (row.forwarderCode == null || typeof row.forwarderCode === "string")
        && typeof row.active === "boolean");
}

function rowsToMap(rows, asCollectionSnapshot) {
    const map = {};
    asCollectionSnapshot(rows).forEach((docSnap) => {
        map[docSnap.id] = {id: docSnap.id, ...docSnap.data()};
    });
    return map;
}
