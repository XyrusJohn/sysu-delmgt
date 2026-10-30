import {getSessionAccountId, getSessionToken} from "./sessionStore.js";

const BODY_READERS = new Set(["arrayBuffer", "blob", "formData", "json", "text"]);
const IDEMPOTENCY_PREFIX = "sysu:idempotency:v1:";
const pendingWrites = new Map();

function makeRequestId() {
    return globalThis.crypto?.randomUUID?.()
        || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function safeFallbackHash(value) {
    //  Hash only for a local lookup key; never persist request data or bearer tokens.
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(value)) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, "0");
}

function storage() {
    try { return globalThis.localStorage; } catch { return null; }
}

function hashRequest(accountScope, method, url, body) {
    return safeFallbackHash(`${accountScope}\n${method}\n${url}\n${body}`);
}

function requestSignature(input, options) {
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = typeof input === "string" ? input : input?.url || String(input);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(options.headers || {}).forEach((value, name) => headers.set(name, value));
    const accountScope = getSessionAccountId()
        || `session-${safeFallbackHash(getSessionToken() || "anonymous")}`;
    let body = typeof options.body === "string" ? options.body : "";
    if (!body && input instanceof Request && input.body) {
        try {
            return input.clone().text().then(requestBody => hashRequest(accountScope, method, url, requestBody));
        } catch { /* A body stream may not be cloneable. */ }
    }
    return hashRequest(accountScope, method, url, body);
}

function beginIdempotentWrite(input, options, headers) {
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
    const supplied = headers.get("Idempotency-Key");
    if (supplied) return {key: supplied, externallyManaged: true};

    const begin = signature => {
        let entry = pendingWrites.get(signature);
        if (!entry) {
            const store = storage();
            let key;
            try { key = store?.getItem(IDEMPOTENCY_PREFIX + signature); } catch { /* storage can be unavailable */ }
            entry = {key: key || makeRequestId(), inFlight: 0, retain: false};
            pendingWrites.set(signature, entry);
            if (!key && store) {
                try { store.setItem(IDEMPOTENCY_PREFIX + signature, entry.key); } catch { /* Keep the key in memory. */ }
            }
        }
        if (entry.inFlight === 0) entry.retain = false;
        entry.inFlight += 1;
        headers.set("Idempotency-Key", entry.key);
        return {signature, entry, key: entry.key, externallyManaged: false};
    };
    const signature = requestSignature(input, options);
    return signature instanceof Promise ? signature.then(begin) : begin(signature);
}

function finishIdempotentWrite(write, {ambiguous = false} = {}) {
    if (!write || write.externallyManaged) return;
    const {signature, entry} = write;
    if (ambiguous) entry.retain = true;
    entry.inFlight = Math.max(0, entry.inFlight - 1);
    if (entry.inFlight !== 0 || entry.retain) return;
    try { storage()?.removeItem(IDEMPOTENCY_PREFIX + signature); } catch { /* best-effort browser storage cleanup */ }
    if (pendingWrites.get(signature) === entry) pendingWrites.delete(signature);
}

function isRequestStillProcessing(body) {
    return body?.code === "IDEMPOTENCY_IN_PROGRESS"
        || body?.code === "IDEMPOTENCY_STORE_UNAVAILABLE"
        || body?.code === "IDEMPOTENCY_KEY_REUSED";
}

function timeoutError(method) {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
    const error = new Error(mutating
        ? "This request took too long. The server may have completed the action; check its status before trying again."
        : "This request took too long. Check the connection and try again.");
    error.name = "RequestTimeoutError";
    error.code = "REQUEST_TIMEOUT";
    error.outcomeUnknown = mutating;
    return error;
}

export async function fetchWithTimeout(input, options = {}, timeoutMs = 15_000) {
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(options.headers || {}).forEach((value, name) => requestHeaders.set(name, value));
    const controller = new AbortController();
    let write = null;
    let timedOut = false;
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abortFromCaller);
    };
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener("abort", abortFromCaller, {once: true});

    try {
        const pendingWrite = beginIdempotentWrite(input, options, requestHeaders);
        write = pendingWrite instanceof Promise ? await pendingWrite : pendingWrite;
        if (controller.signal.aborted) throw controller.signal.reason || new Error("Request aborted");
        const response = await fetch(input, {...options, headers: requestHeaders, signal: controller.signal});
        if (write && !write.externallyManaged) {
            try {
                let ambiguous = response.status >= 500;
                if (typeof response.clone === "function") {
                    const bodyText = await response.clone().text();
                    let body;
                    try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = null; }
                    ambiguous ||= isRequestStillProcessing(body);
                } else if (response.status === 409) {
                    ambiguous = true;
                }
                finishIdempotentWrite(write, {
                    ambiguous,
                });
                cleanup();
            } catch (error) {
                finishIdempotentWrite(write, {ambiguous: true});
                if (timedOut) throw timeoutError(method);
                throw error;
            }
        }
        return new Proxy(response, {
            get(target, property) {
                const value = Reflect.get(target, property, target);
                if (BODY_READERS.has(property) && typeof value === "function") {
                    return (...args) => Promise.resolve(value.apply(target, args)).then(body => body).catch(error => {
                        if (timedOut) throw timeoutError(method);
                        throw error;
                    }).finally(cleanup);
                }
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    } catch (error) {
        cleanup();
        if (write && !write.externallyManaged) finishIdempotentWrite(write, {ambiguous: true});
        if (timedOut) throw timeoutError(method);
        throw error;
    }
}
