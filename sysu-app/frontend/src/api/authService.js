import {API_CONFIG} from "./config.js";
import {clearSessionToken, getSessionToken, onSessionChange, setSessionAccountId, setSessionToken} from "./sessionStore.js";
import {clearTruckCompanyCache} from "./truckCompanyOfflineCache.js";
import {fetchWithTimeout} from "./fetchWithTimeout.js";

const AUTH_API = `${API_CONFIG.BASE_URL}/api/auth/mysql`;
const SESSION_REFRESH_MS = 30_000;
let currentUserProfile = null;

function authError(code, status = 0, message = code) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function normalizeUser(user) {
    if (!user || typeof user !== "object" || typeof user.id !== "string"
        || typeof user.role !== "string" || typeof user.status !== "string") {
        throw authError("INVALID_SESSION", 401, "Your session could not be verified.");
    }
    const profile = user.profile && typeof user.profile === "object" && !Array.isArray(user.profile)
        ? user.profile : {};
    return {
        ...profile,
        ...user,
        uid: user.id,
        name: user.displayName || profile.name || user.username || "User",
    };
}

async function post(path, data) {
    const response = await fetch(`${AUTH_API}${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
        const code = result.code || "AUTH_SERVICE_UNAVAILABLE";
        const messages = {
            ACCOUNT_EXISTS: "That username is already registered.",
            ACCOUNT_DISABLED: "This account is disabled. Contact your administrator.",
            INVALID_CREDENTIALS: "Invalid username or password.",
            INVALID_PASSWORD: "Password must be at least 8 characters.",
            INVALID_USERNAME: "Use 3–32 letters, numbers, dots, dashes, or underscores.",
        };
        throw authError(code, response.status, messages[code] || "Sign-in is temporarily unavailable. Please try again.");
    }
    return result;
}

async function fetchSession() {
    const token = getSessionToken();
    if (!token) throw authError("Unauthorized", 401, "Unauthorized");
    const previousAccountId = currentUserProfile?.id;
    const response = await fetch(`${AUTH_API}/session`, {
        headers: {Authorization: `Bearer ${token}`},
        signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
        if (response.status === 401 || response.status === 403) {
            clearTruckCompanyCache(previousAccountId);
            clearSessionToken();
        }
        throw authError(result.code || "SESSION_INVALID", response.status,
            response.status === 401 ? "Unauthorized" : "Your session could not be verified.");
    }
    currentUserProfile = normalizeUser(result.user);
    setSessionAccountId(currentUserProfile.id);
    if (previousAccountId && previousAccountId !== currentUserProfile.id) clearTruckCompanyCache(previousAccountId);
    if (currentUserProfile.status === "disabled"
        || (currentUserProfile.status === "inactive" && currentUserProfile.role !== "pending")) {
        clearTruckCompanyCache(currentUserProfile.id);
        clearSessionToken();
        currentUserProfile = null;
        throw authError("ACCOUNT_DISABLED", 403, "This account is disabled. Contact your administrator.");
    }
    return currentUserProfile;
}

function storeAuthResult(result, remember) {
    if (typeof result.token !== "string" || !result.token) {
        throw authError("INVALID_SESSION", 500, "The server did not return a valid session.");
    }
    const previousAccountId = currentUserProfile?.id;
    currentUserProfile = normalizeUser(result.user);
    if (previousAccountId && previousAccountId !== currentUserProfile.id) clearTruckCompanyCache(previousAccountId);
    setSessionToken(result.token, {remember});
    setSessionAccountId(currentUserProfile.id);
    return currentUserProfile;
}

export const AuthService = {
    async login(username, password, {remember = true} = {}) {
        const result = await post("/username/login", {username, password});
        return storeAuthResult(result, remember);
    },

    async register({username, password, displayName = "", profile = {}}, {remember = true} = {}) {
        const result = await post("/username/register", {username, password, displayName, profile});
        return storeAuthResult(result, remember);
    },

    async check() {
        return {data: await fetchSession()};
    },

    subscribe(callback) {
        let closed = false;
        let generation = 0;
        let lastSignature = "";
        const refresh = async () => {
            const activeGeneration = ++generation;
            try {
                const user = await fetchSession();
                if (closed || activeGeneration !== generation) return;
                const signature = JSON.stringify(user);
                if (signature !== lastSignature) {
                    lastSignature = signature;
                    callback(user);
                }
            } catch (error) {
                if (closed || activeGeneration !== generation) return;
                const signature = `${error.status || 0}:${error.code || error.message}`;
                if (signature === lastSignature) return;
                lastSignature = signature;
                if (error.status === 401 || error.status === 403) {
                    clearTruckCompanyCache(currentUserProfile?.id);
                    currentUserProfile = null;
                    clearSessionToken();
                    callback(null, new Error("Unauthorized"));
                } else {
                    currentUserProfile = null;
                    callback(null, error);
                }
            }
        };
        const stopSession = onSessionChange(() => {
            lastSignature = "";
            void refresh();
        });
        void refresh();
        const timer = setInterval(refresh, SESSION_REFRESH_MS);
        return () => {
            closed = true;
            generation++;
            clearInterval(timer);
            stopSession();
        };
    },

    async logout({redirect = true} = {}) {
        const token = getSessionToken();
        let requestError;
        try {
            if (token) {
                const response = await fetch(`${AUTH_API}/logout`, {
                    method: "POST",
                    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
                    body: "{}",
                    signal: AbortSignal.timeout(10_000),
                });
                if (!response.ok) requestError = authError("LOGOUT_FAILED", response.status,
                    "The server could not revoke your session. Try signing out again when connected.");
            }
        } catch (error) {
            requestError = error;
        } finally {
            clearTruckCompanyCache(currentUserProfile?.id);
            currentUserProfile = null;
            clearSessionToken();
            localStorage.removeItem("userData");
            if (redirect) window.location.href = "/";
        }
        if (requestError) throw requestError;
    },

    getUserProfile() {
        return currentUserProfile;
    },

    updateProfile(updates) {
        currentUserProfile = {...currentUserProfile, ...updates};
    },

    async saveProfile({displayName, photoURL = null, profile = {}} = {}) {
        const token = getSessionToken();
        if (!token) throw authError("Unauthorized", 401, "No authenticated user found.");
        const response = await fetchWithTimeout(`${AUTH_API}/profile`, {
            method: "PATCH",
            headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
            body: JSON.stringify({displayName, photoURL, profile}),
            signal: AbortSignal.timeout(15_000),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success !== true || !result.user) {
            throw authError(result.code || "PROFILE_UPDATE_FAILED", response.status,
                "Profile changes could not be saved. Check your connection and try again.");
        }
        currentUserProfile = normalizeUser(result.user);
        setSessionAccountId(currentUserProfile.id);
        return currentUserProfile;
    },

    async getToken() {
        const token = getSessionToken();
        if (!token) throw authError("Unauthorized", 401, "No authenticated user found.");
        return token;
    },
};
