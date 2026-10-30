import {API_CONFIG} from './config.js';
import {AuthService} from './authService.js';
import {getExistingDriverSocket, socket} from './socket.js';
import {fetchWithTimeout} from './fetchWithTimeout.js';
import {getSessionAccountId} from './sessionStore.js';

const API = `${API_CONFIG.BASE_URL}/api/system-errors`;
const pendingReports = [];
const recentReports = new Map();
let flushing = false;
let reportRetryAt = 0;
let reportRetryDelayMs = 60_000;
let installed = false;
const recentUserNotifications = new Map();
const recentRecoveries = new Map();
const RECOVERY_RETRY_DELAY_MS = 60_000;
const MAX_RECOVERY_RETRY_DELAY_MS = 5 * 60_000;

function notifyUser(onError, key, message) {
    if (typeof onError !== 'function') return;
    const now = Date.now();
    if (now - (recentUserNotifications.get(key) || 0) < 30_000) return;
    recentUserNotifications.set(key, now);
    onError(message);
}

async function request(path, options = {}) {
    const token = await AuthService.getToken();
    const response = await fetchWithTimeout(`${API}${path}`, {
        ...options,
        headers: {Authorization: `Bearer ${token}`, ...(options.headers || {})},
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error || 'System logs are temporarily unavailable.');
        error.requestId = payload.requestId || null;
        throw error;
    }
    return payload;
}

export const SystemErrorService = {
    list() {
        return request('/logs?limit=100&openOnly=false').then(result => result.items || []);
    },
    listDiagnosticRuns({limit = 50, offset = 0, actorId} = {}) {
        const query = new URLSearchParams({limit: String(limit), offset: String(offset)});
        if (actorId) query.set('actorId', actorId);
        return request(`/diagnostic-runs?${query}`).then(result => ({items: result.items || [], hasMore: Boolean(result.hasMore)}));
    },
    deleteDiagnosticRun(id) {
        return request(`/diagnostic-runs/${encodeURIComponent(id)}`, {method: 'DELETE'});
    },
    resolve(id) {
        return request(`/logs/${encodeURIComponent(id)}/resolve`, {method: 'PATCH'});
    },
    deleteResolved(id) {
        return request(`/logs/${encodeURIComponent(id)}`, {method: 'DELETE'});
    },
    resolveOperation(eventCode, operation) {
        const key = `${getSessionAccountId() || 'unknown-account'}:${eventCode}:${operation}`;
        const now = Date.now();
        const previous = recentRecoveries.get(key);
        if (previous?.inFlight) return previous.promise;
        if (previous && now < previous.retryAt) return Promise.resolve({success: true, skipped: true});
        const state = {
            inFlight: true,
            retryAt: now + 10_000,
            retryDelayMs: previous?.retryDelayMs || RECOVERY_RETRY_DELAY_MS,
            promise: null,
        };
        state.promise = request('/logs/recover-operation', {method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({eventCode, operation})}).then(result => {
            state.inFlight = false;
            state.retryAt = Date.now() + 10_000;
            state.retryDelayMs = RECOVERY_RETRY_DELAY_MS;
            return result;
        }).catch(error => {
            state.inFlight = false;
            state.retryAt = Date.now() + state.retryDelayMs;
            state.retryDelayMs = Math.min(state.retryDelayMs * 2, MAX_RECOVERY_RETRY_DELAY_MS);
            throw error;
        });
        recentRecoveries.set(key, state);
        return state.promise;
    },
    report(eventCode, {operation, errorName, details} = {}) {
        if (!['frontend_uncaught', 'frontend_unhandled_rejection', 'frontend_operation_failure'].includes(eventCode)) return;
        const now = Date.now();
        const key = `${eventCode}:${operation || ''}:${errorName || ''}`;
        if (now - (recentReports.get(key) || 0) < 60_000) return;
        recentReports.set(key, now);
        pendingReports.push({eventCode, operation, errorName, details: {...details,
            clientEventId: globalThis.crypto?.randomUUID?.() || `event-${now}`}});
        if (pendingReports.length > 20) pendingReports.shift();
        void this.flushReports();
    },
    async runDiagnostics() {
        const requestCheck = async (name, url) => {
            const startedAt = performance.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetchWithTimeout(url, {cache: 'no-store', signal: controller.signal}, 5000);
                const check = {name, status: response.ok ? 'pass' : 'fail', httpStatus: response.status,
                    requestId: response.headers?.get?.('x-request-id') || null,
                    durationMs: Math.round(performance.now() - startedAt)};
                if (!response.ok) check.failureCode = name.endsWith('-database') && response.status === 503
                    ? 'DATABASE_UNAVAILABLE' : 'HEALTH_CHECK_FAILED';
                if (response.ok) void this.resolveOperation('frontend_operation_failure', `${name}-health`).catch(() => {});
                if (!response.ok) this.report('frontend_operation_failure', {operation: `${name}-health`,
                    errorName: 'HealthCheckError', details: {stage: 'diagnostic-check', httpStatus: response.status,
                        failureCode: check.failureCode, platform: 'web', clientTimestampMs: Date.now()}});
                return check;
            } catch (error) {
                const timedOut = error?.name === 'AbortError';
                this.report('frontend_operation_failure', {operation: `${name}-health`,
                    errorName: timedOut ? 'TimeoutError' : 'NetworkError', details: {stage: 'diagnostic-check',
                        failureCode: timedOut ? 'HEALTH_CHECK_TIMEOUT' : 'NETWORK_UNREACHABLE',
                        networkType: navigator.onLine ? 'online' : 'offline', platform: 'web', clientTimestampMs: Date.now()}});
                return {name, status: 'fail', failureCode: timedOut ? 'HEALTH_CHECK_TIMEOUT' : 'NETWORK_UNREACHABLE',
                    durationMs: Math.round(performance.now() - startedAt)};
            } finally {
                clearTimeout(timeout);
            }
        };
        const [appApi, appDatabase, goApi, goDatabase] = await Promise.all([
            requestCheck('sysu-app-api', `${API_CONFIG.BASE_URL}/health/live`),
            requestCheck('sysu-app-database', `${API_CONFIG.BASE_URL}/health/ready`),
            requestCheck('sysu-go-api', `${API_CONFIG.DRIVER_TRACKING_URL}/api/health`),
            requestCheck('sysu-go-database', `${API_CONFIG.DRIVER_TRACKING_URL}/api/health/ready`),
        ]);
        const driverSocket = typeof getExistingDriverSocket === 'function' ? getExistingDriverSocket() : null;
        return {runId: globalThis.crypto?.randomUUID?.() || `diag-${Date.now()}`,
            startedAt: new Date().toISOString(), networkType: navigator.onLine ? 'online' : 'offline',
            checks: [appApi, appDatabase, goApi, goDatabase, {name: 'sysu-app-socket', status: socket.connected ? 'pass' : 'warning',
                connection: socket.connected ? 'connected' : 'disconnected'},
            {name: 'sysu-go-socket', status: driverSocket?.connected ? 'pass' : 'warning',
                connection: driverSocket ? (driverSocket.connected ? 'connected' : 'disconnected') : 'not_initialized'}]};
    },
    async flushReports() {
        if (flushing || pendingReports.length === 0 || Date.now() < reportRetryAt) return;
        flushing = true;
        try {
            while (pendingReports.length) {
                const report = pendingReports[0];
                await request('/report', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(report),
                });
                pendingReports.shift();
            }
            reportRetryAt = 0;
            reportRetryDelayMs = 60_000;
        } catch {
            reportRetryAt = Date.now() + reportRetryDelayMs;
            reportRetryDelayMs = Math.min(reportRetryDelayMs * 2, MAX_RECOVERY_RETRY_DELAY_MS);
        } finally {
            flushing = false;
        }
    },
    installGlobalHandlers(onError) {
        if (installed || typeof window === 'undefined') return;
        installed = true;
        window.addEventListener('error', event => {
            this.report('frontend_uncaught', {
                operation: 'dashboard-runtime',
                errorName: event.error?.name || 'Error',
                details: {stage: 'browser-runtime', sourceFrame: safeBrowserFrame(event.filename, event.lineno, event.colno),
                    line: Number(event.lineno) || undefined, column: Number(event.colno) || undefined,
                    platform: 'web', clientTimestampMs: Date.now()},
            });
            notifyUser(onError, 'runtime', 'May hindi inaasahang nangyari. Subukan muli; kung magpatuloy, makipag-ugnayan sa administrator.');
        });
        window.addEventListener('unhandledrejection', event => {
            this.report('frontend_unhandled_rejection', {
                operation: 'dashboard-async',
                errorName: event.reason?.name || 'Error',
                details: {stage: 'unhandled-rejection', platform: 'web', clientTimestampMs: Date.now()},
            });
            notifyUser(onError, 'async', 'Hindi nakumpleto ang isang proseso. Suriin ang koneksyon at subukan muli.');
        });
        socket.on('connect_error', error => {
            this.report('frontend_operation_failure', {
                operation: 'realtime-connection',
                errorName: error?.name || 'Error',
            });
            notifyUser(onError, 'realtime', 'Nawala ang live connection. Awtomatikong susubukan itong ikonekta muli.');
        });
        socket.on('connect', () => {
            void this.flushReports();
            const driverSocket = typeof getExistingDriverSocket === 'function' ? getExistingDriverSocket() : null;
            if (!driverSocket || driverSocket.connected) {
                void this.resolveOperation('frontend_operation_failure', 'realtime-connection').catch(() => {});
            }
        });
    },
};

function safeBrowserFrame(filename, line, column) {
    try {
        const basename = new URL(filename, window.location.origin).pathname.split('/').filter(Boolean).pop() || 'unknown';
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(basename)) return undefined;
        const suffix = [Number(line), Number(column)].every(value => Number.isInteger(value) && value > 0)
            ? `:${Number(line)}:${Number(column)}` : '';
        return `${basename}${suffix}`;
    } catch {
        return undefined;
    }
}
