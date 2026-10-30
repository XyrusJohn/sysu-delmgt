import {API_CONFIG} from "./config.js";
import {AuthService} from "./authService.js";
import {subscribeRealtime, asCollectionSnapshot} from "./realtimeService.js";
import {fetchWithTimeout} from "./fetchWithTimeout.js";

const SAP_API_URL = `${API_CONFIG.BASE_URL}/api/sap/shipments`;

export const SAPService = {
    state: {
        shipments: [],
        assignments: {},
        lastUpdated: null,
        lastError: null,
        lastErrorStatus: null,
        lastRequestId: null,
    },

    async fetchShipments() {
        try {
            const token = await AuthService.getToken();
            const response = await fetchWithTimeout(SAP_API_URL, {
                headers: {
                    "Authorization": `Bearer ${token}`,
                },
            }, 30_000);
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                const error = new Error(payload.error || `HTTP ${response.status}`);
                error.status = response.status;
                error.requestId = payload.requestId || response.headers?.get?.("X-Request-ID") || null;
                throw error;
            }

            const json = await response.json();
            this.state.lastError = null;
            this.state.lastErrorStatus = null;
            this.state.lastRequestId = null;
            const sapData = json.data || json;
            this.state.shipments =
                sapData && sapData.d && sapData.d.results
                    ? sapData.d.results
                    : sapData.results || sapData;
            this.state.lastUpdated = new Date();
            return this.state.shipments;
        } catch (error) {
            console.error("Shipment fetch error:", error);
            this.state.lastError = error.message;
            this.state.lastErrorStatus = Number(error.status) || null;
            this.state.lastRequestId = error.requestId || null;
            return [];
        }
    },

    async fetchDispatchDetails(dispatchKeys) {
        const timeoutSignal = AbortSignal.timeout(30_000);
        let rejectOnTimeout;
        const timeoutPromise = new Promise((_, reject) => {
            rejectOnTimeout = () => reject(timeoutSignal.reason || new Error("Dispatch details request timed out"));
            timeoutSignal.addEventListener("abort", rejectOnTimeout, {once: true});
        });
        try {
            const token = await Promise.race([AuthService.getToken(), timeoutPromise]);
            if (timeoutSignal.aborted) throw timeoutSignal.reason;
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/sap/dispatch-details`, {
                method: "POST",
                signal: timeoutSignal,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({dispatchKeys}),
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok || json.success === false) {
                const error = new Error("Dispatch details are unavailable");
                error.requestId = json.requestId || response.headers.get("X-Request-ID") || null;
                error.status = response.status;
                throw error;
            }
            return {
                data: json.data || {},
                warnings: Array.isArray(json.warnings) ? json.warnings : [],
                requestId: json.requestId || null,
            };
        } finally {
            timeoutSignal.removeEventListener("abort", rejectOnTimeout);
        }
    },

    subscribeToAssignments(callback, onError) {
        return subscribeRealtime("assignments", {}, (rows) => {
            const data = {};
            asCollectionSnapshot(rows).forEach((doc) => {
                data[doc.id] = doc.data();
            });
            this.state.assignments = data;
            if (callback) callback(data);
        }, onError);
    },

    parseDate(sapDate) {
        if (!sapDate) return "—";
        //  Handle SAP /Date(XXX)/ format: /Date(1751587200000)/
        const msStr = (sapDate + "").replace("/Date(", "").replace(")/", "");
        const ms = parseInt(msStr);
        if (!isNaN(ms)) {
            return new Date(ms).toLocaleDateString("en-PH", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        }
        //  Handle ISO 8601 format: "2025-05-26T00:00:00"
        const isoDate = new Date(sapDate);
        if (!isNaN(isoDate.getTime())) {
            return isoDate.toLocaleDateString("en-PH", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        }
        return "—";
    },
};
