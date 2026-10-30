import {beforeEach, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({token: null, listeners: [], sockets: []}));
vi.mock("./sessionStore.js", () => ({
    getSessionToken: () => state.token,
    onSessionChange: listener => {
        state.listeners.push(listener);
        return () => { state.listeners = state.listeners.filter(item => item !== listener); };
    },
}));
vi.mock("./config.js", () => ({API_CONFIG: {SOCKET_URL: "http://127.0.0.1:3000", DRIVER_TRACKING_URL: "http://127.0.0.1:3001"}}));
vi.mock("socket.io-client", () => ({io: (_url, options) => {
    const socket = {...options, connected: false, active: false, on: vi.fn()};
    socket.connect = vi.fn(() => {socket.connected = true; socket.active = true;});
    socket.disconnect = vi.fn(() => {socket.connected = false; socket.active = false;});
    state.sockets.push(socket);
    return socket;
}}));

beforeEach(() => {
    vi.resetModules();
    state.token = null;
    state.listeners = [];
    state.sockets = [];
});

test("Socket.IO handshakes use the current MySQL session token", async () => {
    const module = await import("./socket.js");
    const driver = module.getDriverSocket();
    state.token = "mysql-session-one";
    expect(await new Promise(resolve => module.socket.auth(resolve))).toEqual({token: "mysql-session-one"});
    expect(await new Promise(resolve => driver.auth(resolve))).toEqual({token: "mysql-session-one"});
});

test("login and token rotation reconnect app and already-requested tracking sockets", async () => {
    const module = await import("./socket.js");
    const driver = module.getDriverSocket();
    module.connectDriverSocket();
    expect(driver.connect).not.toHaveBeenCalled();

    state.token = "mysql-session-one";
    state.listeners[0](state.token);
    expect(module.socket.connect).toHaveBeenCalledOnce();
    expect(driver.connect).toHaveBeenCalledOnce();

    state.token = "mysql-session-two";
    state.listeners[0](state.token);
    expect(module.socket.disconnect).toHaveBeenCalledTimes(2);
    expect(driver.disconnect).toHaveBeenCalledTimes(3);
    expect(module.socket.connect).toHaveBeenCalledTimes(2);
    expect(driver.connect).toHaveBeenCalledTimes(2);
    expect(await new Promise(resolve => driver.auth(resolve))).toEqual({token: "mysql-session-two"});
});

test("logout disconnects both sockets and a stale token cannot reconnect them", async () => {
    const module = await import("./socket.js");
    const driver = module.getDriverSocket();
    state.token = "mysql-session-one";
    state.listeners[0](state.token);
    module.connectDriverSocket();
    state.token = null;
    state.listeners[0](null);

    expect(module.socket.connected).toBe(false);
    expect(driver.connected).toBe(false);
    expect(await new Promise(resolve => module.socket.auth(resolve))).toEqual({});
    expect(await new Promise(resolve => driver.auth(resolve))).toEqual({});
});

test("a stored session automatically connects the primary socket on app load", async () => {
    state.token = "stored-session";
    await import("./socket.js");
    expect(state.sockets[0].connect).toHaveBeenCalledOnce();
});
