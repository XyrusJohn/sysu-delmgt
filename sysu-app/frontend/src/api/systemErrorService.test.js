import {beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('./config.js', () => ({API_CONFIG: {BASE_URL: 'https://api.example.test', DRIVER_TRACKING_URL: 'https://go.example.test'}}));
vi.mock('./authService.js', () => ({AuthService: {getToken: vi.fn().mockResolvedValue('test-token')}}));
vi.mock('./socket.js', () => ({socket: {on: vi.fn(), connected: false}, getExistingDriverSocket: vi.fn(() => null)}));

import {SystemErrorService} from './systemErrorService.js';
import {AuthService} from './authService.js';
import {socket} from './socket.js';
import {setSessionAccountId} from './sessionStore.js';

describe('SystemErrorService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        setSessionAccountId(null);
    });

    test('loads admin diagnostics with bearer authentication', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({items: [{id: 'log-1'}]})});
        await expect(SystemErrorService.list()).resolves.toEqual([{id: 'log-1'}]);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/system-errors/logs?limit=100&openOnly=false',
            expect.objectContaining({headers: expect.any(Headers)}),
        );
        expect(globalThis.fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-token');
    });

    test('loads a paginated SYSU Go latest-per-account run list through the admin API', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({items: [{id: 'run-1'}]})});
        await expect(SystemErrorService.listDiagnosticRuns({limit: 50, offset: 0})).resolves.toEqual({items: [{id: 'run-1'}], hasMore: false});
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/system-errors/diagnostic-runs?limit=50&offset=0',
            expect.objectContaining({headers: expect.any(Headers)}),
        );
        expect(globalThis.fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-token');
    });

    test('loads one account history page with an encoded actor ID', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({items: [], hasMore: false})});
        await SystemErrorService.listDiagnosticRuns({actorId: 'account/id', limit: 20, offset: 1});
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/system-errors/diagnostic-runs?limit=20&offset=1&actorId=account%2Fid',
            expect.any(Object),
        );
    });

    test('deletes an individual mobile diagnostic run through the admin API', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({success: true})});
        await expect(SystemErrorService.deleteDiagnosticRun('22')).resolves.toEqual({success: true});
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/system-errors/diagnostic-runs/22',
            expect.objectContaining({method: 'DELETE', headers: expect.any(Headers)}),
        );
        expect(globalThis.fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-token');
    });

    test('surfaces a safe request reference when list loading fails', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ok: false, json: async () => ({error: 'Unavailable', requestId: 'req-1'})});
        await expect(SystemErrorService.list()).rejects.toMatchObject({message: 'Unavailable', requestId: 'req-1'});
    });

    test('permanently deletes one resolved diagnostic row through the admin API', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({success: true})});
        await expect(SystemErrorService.deleteResolved('17')).resolves.toEqual({success: true});
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/system-errors/logs/17',
            expect.objectContaining({method: 'DELETE', headers: expect.any(Headers)}),
        );
        expect(globalThis.fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-token');
    });

    test('sends a scoped auto-recovery signal after an operation succeeds', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({success: true, resolved: 2})});
        await expect(SystemErrorService.resolveOperation('frontend_operation_failure', 'sap-sync'))
            .resolves.toEqual({success: true, resolved: 2});
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/system-errors/logs/recover-operation',
            expect.objectContaining({method: 'POST', body: JSON.stringify({eventCode: 'frontend_operation_failure', operation: 'sap-sync'})}),
        );
    });

    test('backs off repeated recovery requests after a server error and retries later', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({ok: false, status: 503, json: async () => ({error: 'unavailable'})})
            .mockResolvedValueOnce({ok: true, json: async () => ({success: true, resolved: 1})});

        await expect(SystemErrorService.resolveOperation('frontend_operation_failure', 'recovery-backoff-test'))
            .rejects.toThrow('unavailable');
        await expect(SystemErrorService.resolveOperation('frontend_operation_failure', 'recovery-backoff-test'))
            .resolves.toEqual({success: true, skipped: true});
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        now += 60_000;
        await expect(SystemErrorService.resolveOperation('frontend_operation_failure', 'recovery-backoff-test'))
            .resolves.toEqual({success: true, resolved: 1});
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    test('does not let one account recovery cooldown suppress another account', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({ok: false, status: 503, json: async () => ({error: 'unavailable'})})
            .mockResolvedValueOnce({ok: true, json: async () => ({success: true, resolved: 1})});

        setSessionAccountId('account-one');
        await expect(SystemErrorService.resolveOperation('frontend_operation_failure', 'account-scope-test'))
            .rejects.toThrow('unavailable');
        setSessionAccountId('account-two');
        await expect(SystemErrorService.resolveOperation('frontend_operation_failure', 'account-scope-test'))
            .resolves.toEqual({success: true, resolved: 1});
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        setSessionAccountId(null);
    });

    test('checks App and Go API liveness and central MySQL readiness separately', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({ok: true, status: 200, headers: new Headers({'x-request-id': 'app-ref'})})
            .mockResolvedValueOnce({ok: true, status: 200, headers: new Headers({'x-request-id': 'app-db-ref'})})
            .mockResolvedValueOnce({ok: true, status: 200, headers: new Headers({'x-request-id': 'go-ref'})})
            .mockResolvedValueOnce({ok: false, status: 503, headers: new Headers({'x-request-id': 'go-db-ref'})});
        const report = await SystemErrorService.runDiagnostics();
        expect(globalThis.fetch).toHaveBeenNthCalledWith(1, 'https://api.example.test/health/live', expect.objectContaining({cache: 'no-store'}));
        expect(globalThis.fetch).toHaveBeenNthCalledWith(2, 'https://api.example.test/health/ready', expect.objectContaining({cache: 'no-store'}));
        expect(globalThis.fetch).toHaveBeenNthCalledWith(3, 'https://go.example.test/api/health', expect.objectContaining({cache: 'no-store'}));
        expect(globalThis.fetch).toHaveBeenNthCalledWith(4, 'https://go.example.test/api/health/ready', expect.objectContaining({cache: 'no-store'}));
        expect(report.checks).toEqual([
            expect.objectContaining({name: 'sysu-app-api', status: 'pass', requestId: 'app-ref'}),
            expect.objectContaining({name: 'sysu-app-database', status: 'pass', requestId: 'app-db-ref'}),
            expect.objectContaining({name: 'sysu-go-api', status: 'pass', requestId: 'go-ref'}),
            expect.objectContaining({name: 'sysu-go-database', status: 'fail', httpStatus: 503, requestId: 'go-db-ref'}),
            expect.objectContaining({name: 'sysu-app-socket', status: 'warning'}),
            expect.objectContaining({name: 'sysu-go-socket', status: 'warning', connection: 'not_initialized'}),
        ]);
    });

    test('installs browser handlers only once and retries queued reports on socket reconnect', () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const notify = vi.fn();
        SystemErrorService.installGlobalHandlers(notify);
        SystemErrorService.installGlobalHandlers(notify);
        expect(addEventListener).toHaveBeenCalledTimes(2);
        expect(socket.on).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(socket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
        expect(AuthService.getToken).not.toHaveBeenCalled();
        const errorHandler = addEventListener.mock.calls.find(([event]) => event === 'error')?.[1];
        errorHandler?.({error: {name: 'TypeError'}});
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('May hindi'));
    });
});
