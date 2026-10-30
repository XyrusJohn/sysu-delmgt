const SESSION_KEY = "sysu.mysql.session";
const listeners = new Set();
let initialized = false;
let token = null;
let accountId = null;

function readStoredToken() {
    try {
        return localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || null;
    } catch {
        return null;
    }
}

function notify() {
    for (const listener of listeners) listener(token);
}

export function getSessionToken() {
    if (!initialized) {
        token = readStoredToken();
        initialized = true;
    }
    return token;
}

export function getSessionAccountId() {
    return accountId;
}

export function setSessionAccountId(value) {
    accountId = typeof value === "string" && value.length ? value : null;
}

export function setSessionToken(value, {remember = true} = {}) {
    const previous = getSessionToken();
    token = typeof value === "string" && value.length ? value : null;
    if (!token || token !== previous) accountId = null;
    initialized = true;
    try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        if (token) (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, token);
    } catch {
        //  Keep the active session in memory when browser storage is unavailable.
    }
    if (token !== previous) notify();
}

export function clearSessionToken() {
    setSessionToken(null);
}

export function onSessionChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
    window.addEventListener("storage", event => {
        if (event.key !== SESSION_KEY) return;
        token = readStoredToken();
        accountId = null;
        initialized = true;
        notify();
    });
}
