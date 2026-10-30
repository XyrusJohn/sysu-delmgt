import * as socketApi from "./socket.js";
import {onSessionChange} from "./sessionStore.js";
const {socket} = socketApi;

let nextId = 0;
const subscriptions = new Map();
onSessionChange(() => {
    for (const subscription of subscriptions.values()) {
        if (socket.connected) socket.emit("realtime:unsubscribe", {id: subscription.id});
    }
    subscriptions.clear();
});

const applyState = ({id, topic, data} = {}) => {
    const subscription = subscriptions.get(id);
    if (subscription && subscription.topic === topic) subscription.next(data);
};

const applyError = ({id, message} = {}) => {
    const subscription = subscriptions.get(id);
    if (subscription) {
        if (subscription.topic === "profile") {
            console.error("[realtime] profile subscription error", {message: message || "Realtime data unavailable"});
        }
        subscription.error(new Error(message || "Realtime data unavailable"));
    }
};

function socketFor(topic) {
    return socket;
}

function restoreSubscriptions(target) {
    for (const subscription of subscriptions.values()) {
        if (socketFor(subscription.topic) === target) emitSubscription(target, subscription);
    }
}

function emitSubscription(target, subscription) {
    if (subscription.topic !== "profile") {
        target.emit("realtime:subscribe", subscription.request);
        return;
    }
    target.emit("realtime:subscribe", subscription.request, (result) => {
        if (result?.success === false) {
            applyError({id: subscription.id, message: result.message});
        }
    });
}

for (const target of [socket]) {
    if (!target?.on) continue;
    target.on("realtime:state", applyState);
    target.on("realtime:error", applyError);
    target.on("connect", () => {
        restoreSubscriptions(target);
    });
    target.on("disconnect", reason => {
        if (reason === "io server disconnect") {
            for (const subscription of subscriptions.values()) {
                applyError({id: subscription.id, topic: subscription.topic, message: "Session authorization ended"});
            }
        }
    });
}

function timestamp(value) {
    return value && typeof value === "object" && Number.isFinite(value.$timestamp)
        ? {toMillis: () => value.$timestamp, toDate: () => new Date(value.$timestamp)}
        : value;
}

function decode(value) {
    if (Array.isArray(value)) return value.map(decode);
    if (!value || typeof value !== "object") return value;
    if (Number.isFinite(value.$timestamp)) return timestamp(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
}

export function asCollectionSnapshot(rows = []) {
    const docs = rows.map(row => ({id: row.id, data: () => decode(row)}));
    return {docs, empty: docs.length === 0, size: docs.length, forEach: callback => docs.forEach(callback)};
}

export function asDocumentSnapshot(value, id) {
    return {id, exists: () => value != null, data: () => value == null ? undefined : decode(value)};
}

export function subscribeRealtime(topic, params, next, error = () => {}) {
    const id = `web-${++nextId}`;
    const request = {id, topic, params: params || {}};
    subscriptions.set(id, {id, topic, request, next, error});
    const target = socketFor(topic);
    if (target?.connected) emitSubscription(target, subscriptions.get(id));
    return () => {
        subscriptions.delete(id);
        if (target?.connected) target.emit("realtime:unsubscribe", {id});
    };
}
