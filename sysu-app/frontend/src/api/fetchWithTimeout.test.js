import {afterEach, describe, expect, it, vi} from "vitest";
import {fetchWithTimeout} from "./fetchWithTimeout.js";
import {setSessionAccountId} from "./sessionStore.js";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setSessionAccountId(null);
});

function jsonResponse(body, status = 200) {
    return {
        status,
        ok: status >= 200 && status < 300,
        clone: () => ({text: async () => JSON.stringify(body)}),
        json: async () => body,
    };
}

describe("fetchWithTimeout", () => {
    it("aborts a stalled read and gives a retry instruction", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("fetch", vi.fn((_url, {signal}) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        })));

        const request = fetchWithTimeout("/api/data", {}, 100);
        const rejection = expect(request).rejects.toMatchObject({
            code: "REQUEST_TIMEOUT",
            outcomeUnknown: false,
            message: "This request took too long. Check the connection and try again.",
        });
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
    });

    it("warns that a timed-out write may already have completed and never retries it", async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn((_url, {signal}) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        }));
        vi.stubGlobal("fetch", fetchMock);

        const request = fetchWithTimeout("/api/action", {method: "POST"}, 100);
        const rejection = expect(request).rejects.toMatchObject({code: "REQUEST_TIMEOUT", outcomeUnknown: true});
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("keeps the timeout active while reading the response body", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => new Promise((_resolve, reject) => {
                const signal = fetch.mock.calls[0][1].signal;
                signal.addEventListener("abort", () => reject(signal.reason), {once: true});
            }),
        }));

        const response = await fetchWithTimeout("/api/data", {}, 100);
        const body = response.json();
        const rejection = expect(body).rejects.toMatchObject({code: "REQUEST_TIMEOUT"});
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
    });

    it("reuses a request key after an ambiguous network failure and clears it after success", async () => {
        setSessionAccountId("account-idempotency-retry");
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError("network lost"))
            .mockResolvedValueOnce(jsonResponse({success: true}))
            .mockResolvedValueOnce(jsonResponse({success: true}));
        vi.stubGlobal("fetch", fetchMock);
        const request = {
            method: "POST",
            headers: {Authorization: "Bearer secret-token", "Content-Type": "application/json"},
            body: JSON.stringify({shipment: "synthetic-1"}),
        };

        await expect(fetchWithTimeout("/api/test/idempotency", request)).rejects.toThrow("network lost");
        await (await fetchWithTimeout("/api/test/idempotency", request)).json();
        await (await fetchWithTimeout("/api/test/idempotency", request)).json();

        const firstKey = fetchMock.mock.calls[0][1].headers.get("Idempotency-Key");
        expect(firstKey).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
        expect(fetchMock.mock.calls[1][1].headers.get("Idempotency-Key")).toBe(firstKey);
        expect(fetchMock.mock.calls[2][1].headers.get("Idempotency-Key")).not.toBe(firstKey);
        const stored = Array.from({length: localStorage.length}, (_, index) => {
            const key = localStorage.key(index);
            return `${key}=${localStorage.getItem(key)}`;
        }).join("\n");
        expect(stored).not.toContain("secret-token");
        expect(stored).not.toContain("synthetic-1");
    });

    it("retains the same key after a server error for a safe retry", async () => {
        setSessionAccountId("account-idempotency-5xx");
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({success: false}, 503))
            .mockResolvedValueOnce(jsonResponse({success: true}));
        vi.stubGlobal("fetch", fetchMock);
        const request = {method: "DELETE", body: "{}"};

        await (await fetchWithTimeout("/api/test/idempotency/503", request)).json();
        await (await fetchWithTimeout("/api/test/idempotency/503", request)).json();

        expect(fetchMock.mock.calls[1][1].headers.get("Idempotency-Key"))
            .toBe(fetchMock.mock.calls[0][1].headers.get("Idempotency-Key"));
    });

    it("retains the key while the server reports that the original request is processing", async () => {
        setSessionAccountId("account-idempotency-processing");
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({code: "IDEMPOTENCY_IN_PROGRESS"}, 409))
            .mockResolvedValueOnce(jsonResponse({success: true}));
        vi.stubGlobal("fetch", fetchMock);
        const request = {method: "PATCH", body: "{\"active\":true}"};

        await (await fetchWithTimeout("/api/test/idempotency/processing", request)).json();
        await (await fetchWithTimeout("/api/test/idempotency/processing", request)).json();

        expect(fetchMock.mock.calls[1][1].headers.get("Idempotency-Key"))
            .toBe(fetchMock.mock.calls[0][1].headers.get("Idempotency-Key"));
    });

    it("keeps the original key after a key mismatch so an ambiguous action is never retried with a new key", async () => {
        setSessionAccountId("account-idempotency-mismatch");
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({code: "IDEMPOTENCY_KEY_REUSED"}, 409))
            .mockResolvedValueOnce(jsonResponse({code: "IDEMPOTENCY_KEY_REUSED"}, 409));
        vi.stubGlobal("fetch", fetchMock);
        const request = {method: "POST", body: "{\"action\":\"confirm\"}"};

        await (await fetchWithTimeout("/api/test/idempotency/mismatch", request)).json();
        await (await fetchWithTimeout("/api/test/idempotency/mismatch", request)).json();

        expect(fetchMock.mock.calls[1][1].headers.get("Idempotency-Key"))
            .toBe(fetchMock.mock.calls[0][1].headers.get("Idempotency-Key"));
    });

    it("keeps separate local keys for separate signed-in accounts", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({success: true}));
        vi.stubGlobal("fetch", fetchMock);
        const request = {method: "POST", body: "{}"};

        setSessionAccountId("account-one");
        await (await fetchWithTimeout("/api/test/idempotency/accounts", request)).json();
        setSessionAccountId("account-two");
        await (await fetchWithTimeout("/api/test/idempotency/accounts", request)).json();

        expect(fetchMock.mock.calls[0][1].headers.get("Idempotency-Key"))
            .not.toBe(fetchMock.mock.calls[1][1].headers.get("Idempotency-Key"));
    });
});
