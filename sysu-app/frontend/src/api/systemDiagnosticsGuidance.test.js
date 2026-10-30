import {describe, expect, test} from 'vitest';
import {systemDiagnosticsGuidance} from './systemDiagnosticsGuidance.js';

describe('system diagnostics operator guidance', () => {
    test('explains connection problems in plain language and avoids duplicate actions', () => {
        const guidance = systemDiagnosticsGuidance({
            operation: 'sysu-app-api-health',
            details: {failureCode: 'NETWORK_UNREACHABLE', stage: 'diagnostic-check'},
        });
        expect(guidance.meaning).toContain('could not be reached');
        expect(guidance.action).toContain('Do not repeat a trip or assignment');
    });

    test('gives SAP-specific dispatcher steps', () => {
        const guidance = systemDiagnosticsGuidance({operation: 'sap-sync'});
        expect(guidance.action).toContain('Try the update once more');
        expect(guidance.action).toContain('Check the shipment in SAP');
    });

    test('explains when a backend cannot reach the central MySQL database', () => {
        const guidance = systemDiagnosticsGuidance({
            operation: 'sysu-go-database-health',
            details: {failureCode: 'DATABASE_UNAVAILABLE', httpStatus: 503},
        });
        expect(guidance.meaning).toContain('system database');
        expect(guidance.action).toContain('database connection');
    });

    test('gives driver profile timeouts safe, operation-specific guidance', () => {
        const guidance = systemDiagnosticsGuidance({
            eventCode: 'mobile_operation_failure',
            operation: 'driver-profile',
            errorName: 'SocketTimeoutException',
        });
        expect(guidance.meaning).toContain('could not load the driver’s profile in time');
        expect(guidance.meaning).toContain('does not mean a trip or assignment failed');
        expect(guidance.action).toContain('tries once more automatically');
    });

    test('does not expose exception details in guidance', () => {
        const guidance = systemDiagnosticsGuidance({
            eventCode: 'frontend_uncaught',
            errorName: 'PrivateError',
            message: 'sensitive exception text',
        });
        expect(JSON.stringify(guidance)).not.toContain('sensitive exception text');
    });
});
