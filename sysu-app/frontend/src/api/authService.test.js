import {beforeEach, expect, test, vi} from "vitest";

const session = vi.hoisted(() => ({token: null, accountId: null, listeners: []}));
vi.mock("./config.js", () => ({API_CONFIG: {BASE_URL: "http://localhost:3000"}}));
vi.mock("./sessionStore.js", () => ({
    getSessionToken: () => session.token,
    getSessionAccountId: () => session.accountId,
    setSessionAccountId: accountId => { session.accountId = accountId; },
    setSessionToken: (token, options) => {
        session.token = token;
        session.options = options;
        session.listeners.forEach(listener => listener(token));
    },
    clearSessionToken: () => {
        if (session.token === null) return;
        session.token = null;
        session.listeners.forEach(listener => listener(null));
    },
    onSessionChange: listener => {
        session.listeners.push(listener);
        return () => { session.listeners = session.listeners.filter(item => item !== listener); };
    },
}));

import {AuthService} from "./authService.js";
import {readTruckCompanyCache, writeTruckCompanyCache} from "./truckCompanyOfflineCache.js";

const user = {id: "public-id", username: "river.driver", displayName: "River Driver",
    role: "pending", status: "inactive", profile: {phone: "555-0100"}};
const response = (body, status = 200) => ({ok: status >= 200 && status < 300, status,
    clone: () => ({text: async () => JSON.stringify(body)}), json: async () => body});

beforeEach(() => {
    session.token = null;
    session.accountId = null;
    session.listeners = [];
    vi.restoreAllMocks();
});

test("username login creates a MySQL session and returns the pending profile", async () => {
    const fetch = vi.fn().mockResolvedValue(response({success: true, user, token: "mysql-session-token"}));
    vi.stubGlobal("fetch", fetch);

    const profile = await AuthService.login("river.driver", "long-enough-password", {remember: false});

    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/auth/mysql/username/login", expect.objectContaining({
        method: "POST", body: JSON.stringify({username: "river.driver", password: "long-enough-password"}),
    }));
    expect(session.token).toBe("mysql-session-token");
    expect(session.options).toEqual({remember: false});
    expect(profile).toMatchObject({uid: "public-id", id: "public-id", username: "river.driver", role: "pending", status: "inactive", name: "River Driver", phone: "555-0100"});
});

test("registration sends username and profile data to MySQL", async () => {
    const fetch = vi.fn().mockResolvedValue(response({success: true, user, token: "registered-session"}));
    vi.stubGlobal("fetch", fetch);
    const profile = {name: "River Driver", phone: "555-0100", position: "Fleet Manager"};

    await AuthService.register({username: "river.driver", password: "long-enough-password", displayName: "River Driver", profile});

    expect(fetch.mock.calls[0][0]).toBe("http://localhost:3000/api/auth/mysql/username/register");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({username: "river.driver", password: "long-enough-password", displayName: "River Driver", profile});
    expect(session.token).toBe("registered-session");
});

test("session check validates the bearer token and normalizes the returned account", async () => {
    session.token = "mysql-session-token";
    const fetch = vi.fn().mockResolvedValue(response({success: true, user}));
    vi.stubGlobal("fetch", fetch);

    const result = await AuthService.check();

    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/auth/mysql/session", expect.objectContaining({
        headers: {Authorization: "Bearer mysql-session-token"},
    }));
    expect(result.data).toMatchObject({id: "public-id", uid: "public-id", role: "pending", status: "inactive"});
});

test("session subscriptions refresh when the shared session changes and clean up", async () => {
    session.token = "mysql-session-token";
    const fetch = vi.fn().mockResolvedValue(response({success: true, user}));
    vi.stubGlobal("fetch", fetch);
    const callback = vi.fn();
    const stop = AuthService.subscribe(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(expect.objectContaining({username: "river.driver"})));

    const listener = session.listeners[0];
    listener("rotated-session");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    stop();
    expect(session.listeners).not.toContain(listener);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
});

test("invalid sessions are cleared and published as unauthorized", async () => {
    session.token = "expired-session";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({success: false, code: "SESSION_INVALID"}, 401)));
    const callback = vi.fn();
    const stop = AuthService.subscribe(callback);

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({message: "Unauthorized"})));
    expect(session.token).toBeNull();
    stop();
});

test("logout revokes the bearer session and clears it locally", async () => {
    const fetch = vi.fn()
        .mockResolvedValueOnce(response({success: true, user, token: "mysql-session-token"}))
        .mockResolvedValueOnce(response({success: true}));
    vi.stubGlobal("fetch", fetch);
    await AuthService.login("river.driver", "long-enough-password");
    writeTruckCompanyCache("public-id", [{id: "tc-1", companyCode: "tc-1", forwarderCode: "fwd", name: "Example", active: true}]);

    await AuthService.logout({redirect: false});

    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/auth/mysql/logout", expect.objectContaining({
        method: "POST", headers: {Authorization: "Bearer mysql-session-token", "Content-Type": "application/json"},
    }));
    expect(session.token).toBeNull();
    expect(readTruckCompanyCache("public-id")).toBeNull();
});

test("account switching clears the previous account's browser snapshot", async () => {
    const otherUser = {...user, id: "other-account", username: "other.driver"};
    const fetch = vi.fn()
        .mockResolvedValueOnce(response({success: true, user, token: "first-session"}))
        .mockResolvedValueOnce(response({success: true, user: otherUser, token: "second-session"}));
    vi.stubGlobal("fetch", fetch);

    await AuthService.login("river.driver", "long-enough-password");
    writeTruckCompanyCache("public-id", [{id: "tc-1", companyCode: "tc-1", forwarderCode: "fwd", name: "Example", active: true}]);
    await AuthService.login("other.driver", "long-enough-password");

    expect(readTruckCompanyCache("public-id")).toBeNull();
});

test("profile updates use the MySQL session and exclude role and status", async () => {
    session.token = "mysql-session-token";
    const updatedUser = {...user, displayName: "River Updated", profile: {phone: "555-0111", photoURL: "https://example.test/photo.png"}};
    const fetch = vi.fn().mockResolvedValue(response({success: true, user: updatedUser}));
    vi.stubGlobal("fetch", fetch);

    const result = await AuthService.saveProfile({displayName: "River Updated", photoURL: "https://example.test/photo.png"});

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/auth/mysql/profile");
    expect(options.method).toBe("PATCH");
    expect(options.headers.get("Authorization")).toBe("Bearer mysql-session-token");
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(options.headers.get("Idempotency-Key")).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    expect(options.body).toBe(JSON.stringify({displayName: "River Updated", photoURL: "https://example.test/photo.png", profile: {}}));
    expect(result).toMatchObject({displayName: "River Updated", photoURL: "https://example.test/photo.png", role: "pending", status: "inactive"});
});
