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
    return `${API_CONFIG.BASE_URL}/api/admin/guards${path}`;
}

export const SecurityGuardService = {
    /**
     * Subscribe to MySQL-backed security guard records. The callback receives
     * a map keyed by guard ID and returns the unsubscribe function.
     */
    async subscribe(callback, onError) {
        const {subscribeRealtime, asCollectionSnapshot} = await import("./realtimeService.js");
        return subscribeRealtime("securityGuards", {}, (rows) => {
                const map = {};
                asCollectionSnapshot(rows).forEach((docSnap) => {
                    map[docSnap.id] = {
                        id: docSnap.id,
                        ...docSnap.data(),
                    };
                });
                callback(map);
            }, (error) => {
                console.error("SecurityGuardService subscribe error:", error);
                if (onError) onError(error);
                else callback({});
            });
    },

    /**
     * Create a new guard. Server returns the created record (including
     * generated guardId).
     */
    async create({firstName, lastName, middleInitial}) {
        const url = await adminUrl();
        return authedFetch(url, {
            method: "POST",
            body: JSON.stringify({firstName, lastName, middleInitial}),
        });
    },

    /**
     * Update editable guard fields (firstName, lastName, middleInitial).
     * Server recomputes fullName.
     */
    async update(guardId, {firstName, lastName, middleInitial}) {
        const url = await adminUrl(`/${encodeURIComponent(guardId)}`);
        return authedFetch(url, {
            method: "PATCH",
            body: JSON.stringify({firstName, lastName, middleInitial}),
        });
    },

    /**
     * Soft-delete (or reactivate) a guard by flipping the active flag.
     */
    async setActive(guardId, active) {
        const url = await adminUrl(`/${encodeURIComponent(guardId)}/active`);
        return authedFetch(url, {
            method: "PATCH",
            body: JSON.stringify({active}),
        });
    },

    async delete(guardId) {
        const url = await adminUrl(`/${encodeURIComponent(guardId)}`);
        return authedFetch(url, {method: "DELETE"});
    },

    /**
     * Pure client-side search. Case-insensitive substring match across
     * guardId, firstName, lastName, and fullName. Empty/whitespace query
     * returns docs unchanged.
     */
    search(query, docs) {
        if (query == null) return docs;
        const trimmed = String(query).trim();
        if (trimmed === "") return docs;
        const needle = trimmed.toLowerCase();
        return docs.filter((doc) => {
            const fields = [
                doc && doc.guardId,
                doc && doc.firstName,
                doc && doc.lastName,
                doc && doc.fullName,
            ];
            return fields.some(
                (value) =>
                    typeof value === "string" &&
                    value.toLowerCase().includes(needle),
            );
        });
    },
};
