import {beforeEach, expect, test, vi} from "vitest";

const sockets = vi.hoisted(() => {
    const makeSocket = () => ({
        connected: false,
        handlers: new Map(),
        emitted: [],
        on(event, callback) { this.handlers.set(event, callback); },
        emit(event, payload, acknowledge) {
            const entry = {event, payload};
            if (typeof acknowledge === "function") entry.acknowledge = acknowledge;
            this.emitted.push(entry);
        },
        fire(event, payload) { this.handlers.get(event)?.(payload); },
    });
    return {main: makeSocket()};
});
const session = vi.hoisted(() => ({listeners: []}));

vi.mock("./socket.js", () => ({socket: sockets.main}));
vi.mock("./sessionStore.js", () => ({onSessionChange: listener => {
    session.listeners.push(listener);
    return () => { session.listeners = session.listeners.filter(item => item !== listener); };
}}));

beforeEach(() => {
    vi.resetModules();
    session.listeners = [];
    sockets.main.connected = false;
    sockets.main.emitted.length = 0;
    sockets.main.handlers.clear();
});

test("subscriptions clear at MySQL session boundaries", async () => {
    const {subscribeRealtime} = await import("./realtimeService.js");
    subscribeRealtime("assignments", {}, vi.fn());
    sockets.main.connected = true;
    sockets.main.fire("connect");
    expect(sockets.main.emitted.filter(item => item.event === "realtime:subscribe")).toHaveLength(1);

    session.listeners[0](null);
    sockets.main.fire("connect");
    expect(sockets.main.emitted.filter(item => item.event === "realtime:subscribe")).toHaveLength(1);
});

test("subscriptions restore on reconnect and unsubscribe from the main socket", async () => {
    const {subscribeRealtime} = await import("./realtimeService.js");
    const receive = vi.fn();
    const stop = subscribeRealtime("assignments", {}, receive);
    expect(sockets.main.emitted).toHaveLength(0);
    sockets.main.connected = true;
    sockets.main.fire("connect");
    const request = sockets.main.emitted[0].payload;
    expect(request.topic).toBe("assignments");
    sockets.main.fire("realtime:state", {id: request.id, topic: "assignments", data: [{id: "a1"}]});
    expect(receive).toHaveBeenCalledWith([{id: "a1"}]);
    sockets.main.fire("connect");
    expect(sockets.main.emitted).toHaveLength(2);
    stop();
    expect(sockets.main.emitted.at(-1)).toEqual({event: "realtime:unsubscribe", payload: {id: request.id}});
});

test("profile subscriptions are sent through the authenticated main socket", async () => {
    const {asDocumentSnapshot, subscribeRealtime} = await import("./realtimeService.js");
    const receive = vi.fn();
    const stop = subscribeRealtime("profile", {}, receive);
    sockets.main.connected = true;
    sockets.main.fire("connect");
    const request = sockets.main.emitted[0].payload;
    sockets.main.fire("realtime:state", {id: request.id, topic: "profile", data: {id: "u1", role: "pending"}});
    const snapshot = asDocumentSnapshot(receive.mock.calls[0][0], "u1");
    expect(snapshot.exists()).toBe(true);
    expect(snapshot.data().role).toBe("pending");
    stop();
    expect(sockets.main.emitted.at(-1).event).toBe("realtime:unsubscribe");
});

test("subscription errors are forwarded and server revocation fails closed", async () => {
    const {subscribeRealtime} = await import("./realtimeService.js");
    const error = vi.fn();
    subscribeRealtime("profile", {}, vi.fn(), error);
    sockets.main.connected = true;
    sockets.main.fire("connect");
    sockets.main.emitted.at(-1).acknowledge({success: false, message: "Subscription unavailable"});
    expect(error).toHaveBeenCalledWith(new Error("Subscription unavailable"));

    sockets.main.fire("disconnect", "io server disconnect");
    expect(error).toHaveBeenLastCalledWith(new Error("Session authorization ended"));
});

test("collection snapshots retain timestamp and iteration compatibility", async () => {
    const {asCollectionSnapshot} = await import("./realtimeService.js");
    const snapshot = asCollectionSnapshot([{id: "q1", entryTime: {$timestamp: 1000}}]);
    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data().entryTime.toDate().getTime()).toBe(1000);
    expect(snapshot.empty).toBe(false);
});
