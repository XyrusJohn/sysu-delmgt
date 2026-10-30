import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('./config.js', () => ({API_CONFIG: {BASE_URL: 'http://localhost:3000'}}));
vi.mock('./authService.js', () => ({AuthService: {getToken: vi.fn().mockResolvedValue('mysql-session')}}));

import {SAPAssignmentService} from './sapAssignmentService.js';

const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

describe('SAP assignment request API response contract', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('unwraps the MySQL override request record returned in data', async () => {
        const request = {
            requestId: 'override-1',
            requestedBy: 'public-user-1',
            requestedDriverId: 'queue-entry-1',
            status: 'approved',
            tokenId: 'token-1',
            tokenExpiresAt: '2026-10-26T12:15:00.000Z',
            decidedAt: {$timestamp: 1_798_000_000_000},
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({success: true, data: request})));

        await expect(SAPAssignmentService.getOverrideRequest('override-1')).resolves.toEqual(request);
        expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/sap/overrides/override-1', expect.objectContaining({
            method: 'GET',
            headers: expect.any(Headers),
        }));
        expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer mysql-session');
        expect(fetch.mock.calls[0][1].headers.get('Content-Type')).toBe('application/json');
    });

    it('unwraps the MySQL cancel request status response', async () => {
        const request = {requestId: 'cancel-1', status: 'approved', decidedAt: {$timestamp: 1_798_000_000_000}};
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({success: true, data: request})));

        await expect(SAPAssignmentService.getCancelRequest('cancel-1')).resolves.toEqual(request);
        expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/sap/cancel/requests/cancel-1', expect.any(Object));
    });

    it('preserves HTTP 404 status so polling can stop for a missing request', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({success: false, message: 'Request not found'}, 404)));

        await expect(SAPAssignmentService.getCancelRequest('missing'))
            .rejects.toMatchObject({status: 404, code: 'HTTP_404'});
    });
});
