import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('./authService.js', () => ({
    AuthService: {getToken: vi.fn().mockResolvedValue('test-token')},
}));

import {SAPService} from './sapService.js';
import {AuthService} from './authService.js';

describe('SAPService.fetchShipments failure context', () => {
    beforeEach(() => {
        SAPService.state = {shipments: [], assignments: {}, lastUpdated: null, lastError: null};
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('preserves an SAP HTTP failure status and request reference for inline guidance', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            status: 503,
            json: vi.fn().mockResolvedValue({error: 'Upstream unavailable', requestId: 'request-123'}),
            headers: {get: vi.fn().mockReturnValue(null)},
        });

        await expect(SAPService.fetchShipments()).resolves.toEqual([]);

        expect(SAPService.state.lastErrorStatus).toBe(503);
        expect(SAPService.state.lastRequestId).toBe('request-123');
    });

    it('records a network failure without mislabeling it as an SAP HTTP response', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(SAPService.fetchShipments()).resolves.toEqual([]);

        expect(SAPService.state.lastErrorStatus).toBeNull();
        expect(SAPService.state.lastRequestId).toBeNull();
    });
});

describe('SAPService.fetchDispatchDetails', () => {
    let fetchSpy;
    let timeoutSpy;

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({success: true, data: {}}),
            headers: {get: vi.fn().mockReturnValue(null)},
        });
        timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('bounds the dispatch details request so the UI retry can settle', async () => {
        await SAPService.fetchDispatchDetails(['dispatch-1']);

        expect(timeoutSpy).toHaveBeenCalledWith(30_000);
        expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('also bounds token acquisition before the request is sent', async () => {
        const controller = new AbortController();
        timeoutSpy.mockReturnValueOnce(controller.signal);
        AuthService.getToken.mockReturnValueOnce(new Promise(() => {}));

        const request = SAPService.fetchDispatchDetails(['dispatch-1']);
        controller.abort();

        await expect(request).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
