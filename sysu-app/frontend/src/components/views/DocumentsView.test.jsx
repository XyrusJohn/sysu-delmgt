import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const subscriptions = vi.hoisted(() => ({guards: null, companies: null, stopGuard: vi.fn(), stopCompany: vi.fn()}));

vi.mock('../../api/securityGuardService', () => ({
    SecurityGuardService: {
        subscribe: vi.fn((next) => {
            subscriptions.guards = next;
            return Promise.resolve(subscriptions.stopGuard);
        }),
    },
}));
vi.mock('../../api/truckCompanyService', () => ({
    TruckCompanyService: {
        subscribe: vi.fn((next) => {
            subscriptions.companies = next;
            return Promise.resolve(subscriptions.stopCompany);
        }),
    },
}));
vi.mock('./WarehouseBaseEditor', () => ({default: () => <div>Warehouse settings</div>}));

import DocumentsView from './DocumentsView.jsx';

describe('DocumentsView realtime master data', () => {
    beforeEach(() => {
        subscriptions.guards = null;
        subscriptions.companies = null;
        subscriptions.stopGuard.mockClear();
        subscriptions.stopCompany.mockClear();
    });

    it('subscribes to the MySQL-backed guard and truck company topics and cleans up', async () => {
        const view = render(<DocumentsView />);

        await waitFor(() => expect(subscriptions.guards).toBeTypeOf('function'));
        act(() => subscriptions.guards({guard1: {id: 'SG-001', guardId: 'SG-001', fullName: 'Jordan Lee'}}));
        expect(await screen.findByText('Jordan Lee')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: 'Truck Companies'}));
        await waitFor(() => expect(subscriptions.companies).toBeTypeOf('function'));
        act(() => subscriptions.companies({company1: {id: 'TC-001', companyCode: 'TC-001', name: 'Northstar Freight'}}));
        expect(await screen.findByText('Northstar Freight')).toBeTruthy();

        view.unmount();
        expect(subscriptions.stopGuard).toHaveBeenCalledOnce();
        expect(subscriptions.stopCompany).toHaveBeenCalledOnce();
    });
});
