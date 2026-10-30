import { connectDriverSocket, EVENTS, getDriverSocket } from './socket.js';

const unwrap = (response) => {
    if (response?.success === false) {
        const error = new Error(response.message || 'Driver action data is unavailable.');
        error.code = response.errorCode || 'DRIVER_ACTION_REQUEST_FAILED';
        throw error;
    }
    return response?.data ?? response;
};

const diagnostic = (level, stage, event, details = {}) => {
    if (level === 'error') console.error(`[driver-action] ${stage}`, {event, ...details});
};

const waitForConnection = (target) => {
    if (target?.connected) return Promise.resolve();
    if (!target?.once) return Promise.reject(new Error('Driver action service is disconnected.'));
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            target.off?.('connect', onConnect);
            target.off?.('connect_error', onError);
            target.off?.('disconnect', onDisconnect);
        };
        const onConnect = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); const error = new Error('Driver action service could not connect.'); error.code = 'SOCKET_CONNECT_FAILED'; reject(error); };
        const onDisconnect = () => { cleanup(); const error = new Error('Driver action service disconnected.'); error.code = 'SOCKET_DISCONNECTED'; reject(error); };
        const timer = setTimeout(() => { cleanup(); const error = new Error('Driver action service connection timed out.'); error.code = 'SOCKET_CONNECT_TIMEOUT'; reject(error); }, 12000);
        target.once('connect', onConnect);
        target.once('connect_error', onError);
        target.once('disconnect', onDisconnect);
    });
};

const request = async (event, payload) => {
    diagnostic('info', 'request_started', event);
    try {
        await connectDriverSocket();
        const target = getDriverSocket();
        await waitForConnection(target);
        return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const error = new Error('Driver action request timed out.');
                error.code = 'SOCKET_ACK_TIMEOUT';
                diagnostic('error', 'request_failed', event, {
                    errorCode: error.code,
                    errorMessage: error.message,
                });
                reject(error);
            }, 12000);
            target.emit(event, payload, (response) => {
                clearTimeout(timeout);
                const rows = response?.items || response?.sessions || response?.events || response?.data?.items || response?.data?.sessions || response?.data?.events;
                diagnostic(response?.success === false ? 'error' : 'info', 'acknowledgement_received', event, {
                    success: response?.success !== false,
                    errorCode: response?.errorCode || null,
                    errorMessage: response?.success === false && typeof response?.message === 'string'
                        ? response.message.slice(0, 160)
                        : null,
                    itemCount: Array.isArray(rows) ? rows.length : null,
                });
                try { resolve(unwrap(response)); } catch (error) { reject(error); }
            });
        });
    } catch (error) {
        diagnostic('error', 'request_failed', event, {
            errorCode: error?.code || error?.name || 'UNKNOWN',
            errorMessage: typeof error?.message === 'string' ? error.message.slice(0, 160) : null,
        });
        throw error;
    }
};

const rowsFrom = (value) => Array.isArray(value) ? value : (value?.items || value?.sessions || value?.events || value?.requests || []);

export const DriverActionService = {
    async getSessions(driverId, limit = 30, cursor) {
        const result = unwrap(await request(EVENTS.DRIVER_ACTIONS_GET_SESSIONS, {driverId, limit, ...(cursor ? {cursor} : {})}));
        return {items: newestFirst(rowsFrom(result)), nextCursor: result?.nextCursor ?? null};
    },
    async getEvents(driverId, sessionId, limit = 200, cursor) {
        const result = unwrap(await request(EVENTS.DRIVER_ACTIONS_GET_EVENTS, {driverId, sessionId, limit, ...(cursor ? {cursor} : {})}));
        return {items: newestFirst(rowsFrom(result)), nextCursor: result?.nextCursor ?? null};
    },
    async searchShipmentDrivers(query) {
        const result = unwrap(await request(EVENTS.DRIVER_ACTIONS_SEARCH_SHIPMENT, {query}));
        return {drivers: Array.isArray(result?.drivers) ? result.drivers : [], truncated: result?.truncated === true};
    },
    async requestDeletion(driverId, sessionId, reason) {
        return unwrap(await request(EVENTS.DRIVER_ACTIONS_REQUEST_DELETE, {driverId, sessionId, reason}));
    },
    async getDeletionRequests() {
        const result = unwrap(await request(EVENTS.DRIVER_ACTIONS_GET_DELETE_REQUESTS, {}));
        return rowsFrom(result);
    },
    async decideDeletion(requestId, decision, reason = "") {
        return unwrap(await request(EVENTS.DRIVER_ACTIONS_DECIDE_DELETE, {requestId, decision, ...(reason ? {reason} : {})}));
    },
    subscribeUpdated(handler) {
        const target = getDriverSocket();
        target?.on(EVENTS.DRIVER_ACTIONS_UPDATED, handler);
        return () => target?.off(EVENTS.DRIVER_ACTIONS_UPDATED, handler);
    },
};

export const driverActionTimestamp = (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : Date.parse(value);
    }
    if (value?.toMillis) return value.toMillis();
    if (Number.isFinite(value?.$timestamp)) return value.$timestamp;
    if (Number.isFinite(value?._seconds)) return value._seconds * 1000;
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
    return 0;
};

export const driverActionCoordinates = (item) => {
    if (item?.lat == null || item?.lng == null) return null;
    const lat = Number(item.lat), lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lat, lng];
};

export const newestFirst = (rows) => [...(rows || [])].sort((a, b) => {
    const at = driverActionTimestamp(a?.startedAtMs ?? a?.occurredAtMs ?? a?.createdAt);
    const bt = driverActionTimestamp(b?.startedAtMs ?? b?.occurredAtMs ?? b?.createdAt);
    return bt - at;
});

export const eventsNewestFirst = (rows) => [...(rows || [])].sort((a, b) => {
    if (Number.isSafeInteger(a?.sequence) && Number.isSafeInteger(b?.sequence)) return b.sequence - a.sequence;
    return driverActionTimestamp(b?.occurredAtMs) - driverActionTimestamp(a?.occurredAtMs);
});

export const driverActionRouteCoordinates = (events) => [...(events || [])]
    .filter(item => item?.eventType === 'route_point')
    .sort((a, b) => Number.isSafeInteger(a.sequence) && Number.isSafeInteger(b.sequence)
        ? a.sequence - b.sequence
        : driverActionTimestamp(a.occurredAtMs) - driverActionTimestamp(b.occurredAtMs))
    .map(driverActionCoordinates)
    .filter(Boolean);

export const driverActionRouteSegments = (events) => {
    const chronological = [...(events || [])].sort((a, b) =>
        Number.isSafeInteger(a?.sequence) && Number.isSafeInteger(b?.sequence)
            ? a.sequence - b.sequence
            : driverActionTimestamp(a?.occurredAtMs) - driverActionTimestamp(b?.occurredAtMs));
    const segments = [];
    let phase = 'outbound';
    let points = [];
    const flush = () => {
        if (points.length) segments.push({phase, points});
        points = [];
    };
    const setPhase = (nextPhase) => {
        if (phase === nextPhase) return;
        flush();
        phase = nextPhase;
    };
    const addPoint = (location) => {
        if (!location) return;
        const previous = points[points.length - 1];
        if (!previous || previous[0] !== location[0] || previous[1] !== location[1]) points.push(location);
    };

    chronological.forEach((item) => {
        if (item?.eventType === 'transit_started') setPhase('outbound');
        if (item?.eventType === 'returning_to_base') {
            setPhase('returning');
            addPoint(driverActionCoordinates(item));
            return;
        }
        if (item?.eventType !== 'route_point') return;
        const recordedPhase = String(item?.metadata?.phase || '').toLowerCase();
        const nextPhase = ['returning', 'returning_to_base'].includes(recordedPhase) ? 'returning' : phase;
        setPhase(nextPhase);
        addPoint(driverActionCoordinates(item));
    });
    flush();
    return segments;
};

export const driverActionDurations = (events) => {
    const chronological = [...(events || [])].sort((a, b) => {
        if (Number.isSafeInteger(a?.sequence) && Number.isSafeInteger(b?.sequence)) return a.sequence - b.sequence;
        return driverActionTimestamp(a?.occurredAtMs) - driverActionTimestamp(b?.occurredAtMs);
    });
    const result = new Map();
    let previousAction = null;
    chronological.forEach((item, index) => {
        if (item?.eventType === 'route_point') return;
        const key = item?.eventId || item?.id || item?.sequence || `${item?.eventType}:${index}`;
        const explicit = Number(item?.durationMs);
        if (previousAction) {
            const previousKey = previousAction?.eventId || previousAction?.id || previousAction?.sequence;
            const start = driverActionTimestamp(previousAction?.occurredAtMs);
            const end = driverActionTimestamp(item?.occurredAtMs);
            if (previousKey != null && !result.has(String(previousKey)) && end >= start) {
                result.set(String(previousKey), {durationMs: end - start, basis: 'until_next_action'});
            }
        }
        if (item?.durationMs != null && Number.isFinite(explicit) && explicit >= 0) {
            result.set(String(key), {durationMs: explicit, basis: item?.metadata?.durationBasis || 'recorded'});
        }
        previousAction = item;
    });
    return result;
};
