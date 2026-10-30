import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({socket:{connected:true, emit:vi.fn(), on:vi.fn(), off:vi.fn(), once:vi.fn()}, connect:vi.fn()}));
vi.mock('./socket.js', () => ({
    connectDriverSocket:mocks.connect,
    getDriverSocket:() => mocks.socket,
    EVENTS:{DRIVER_ACTIONS_GET_SESSIONS:'driver_actions:get_sessions', DRIVER_ACTIONS_GET_EVENTS:'driver_actions:get_events', DRIVER_ACTIONS_SEARCH_SHIPMENT:'driver_actions:search_shipment', DRIVER_ACTIONS_REQUEST_DELETE:'driver_actions:request_delete', DRIVER_ACTIONS_GET_DELETE_REQUESTS:'driver_actions:get_delete_requests', DRIVER_ACTIONS_DECIDE_DELETE:'driver_actions:decide_delete', DRIVER_ACTIONS_UPDATED:'driver_actions:updated'},
}));

describe('DriverActionService socket contract', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.socket.connected = true; });
    afterEach(() => { vi.restoreAllMocks(); });

    it('requests newest-first sessions and unwraps the socket acknowledgement', async () => {
        mocks.socket.emit.mockImplementation((_event, payload, ack) => {
            expect(payload).toEqual({driverId:'driver-1', limit:30});
            ack({success:true, data:{sessions:[{sessionId:'older', startedAtMs:10},{sessionId:'newer', startedAtMs:30}]}});
        });
        const {DriverActionService, driverActionCoordinates} = await import('./driverActionService.js');
        const result = await DriverActionService.getSessions('driver-1');
        expect(mocks.socket.emit).toHaveBeenCalledWith('driver_actions:get_sessions', expect.anything(), expect.any(Function));
        expect(result.items.map(item => item.sessionId)).toEqual(['newer','older']);
        expect(driverActionCoordinates({lat:null,lng:null})).toBeNull();
        expect(driverActionCoordinates({lat:0,lng:0})).toEqual([0,0]);
    });

    it('parses the timestamp wrapper returned by the MySQL driver action API', async () => {
        const {driverActionTimestamp} = await import('./driverActionService.js');
        expect(driverActionTimestamp({$timestamp: 1_735_689_600_000})).toBe(1_735_689_600_000);
    });

    it('requests events with the selected session and exposes updated subscriptions', async () => {
        mocks.socket.emit.mockImplementation((_event, payload, ack) => ack({success:true, events:[{eventId:'e1'}]}));
        const {DriverActionService} = await import('./driverActionService.js');
        await expect(DriverActionService.getEvents('driver-2','session-3')).resolves.toEqual({items:[{eventId:'e1'}], nextCursor:null});
        expect(mocks.socket.emit).toHaveBeenCalledWith('driver_actions:get_events', {driverId:'driver-2',sessionId:'session-3',limit:200}, expect.any(Function));
        const handler = vi.fn();
        const unsubscribe = DriverActionService.subscribeUpdated(handler);
        expect(mocks.socket.on).toHaveBeenCalledWith('driver_actions:updated', handler);
        unsubscribe();
        expect(mocks.socket.off).toHaveBeenCalledWith('driver_actions:updated', handler);
    });

    it('searches shipment references through the authenticated Go socket', async () => {
        mocks.socket.emit.mockImplementation((_event, payload, ack) => {
            expect(payload).toEqual({query:'311'});
            ack({success:true,drivers:[{driverId:'driver-1',shipmentIds:['0010136311']}],truncated:false});
        });
        const {DriverActionService} = await import('./driverActionService.js');
        await expect(DriverActionService.searchShipmentDrivers('311')).resolves.toEqual({
            drivers:[{driverId:'driver-1',shipmentIds:['0010136311']}],truncated:false,
        });
        expect(mocks.socket.emit).toHaveBeenCalledWith('driver_actions:search_shipment',{query:'311'},expect.any(Function));
    });

    it('sends session removal requests and administrator decisions through the authenticated driver socket', async () => {
        mocks.socket.emit.mockImplementation((event, payload, ack) => {
            if (event === 'driver_actions:request_delete') ack({success:true, requestId:'request-1', status:'pending'});
            else if (event === 'driver_actions:get_delete_requests') ack({success:true, requests:[{id:'request-1'}]});
            else ack({success:true, status:payload.decision});
        });
        const {DriverActionService} = await import('./driverActionService.js');
        await expect(DriverActionService.requestDeletion('driver-1','session-1','Duplicate record')).resolves.toMatchObject({requestId:'request-1',status:'pending'});
        await expect(DriverActionService.getDeletionRequests()).resolves.toEqual([{id:'request-1'}]);
        await expect(DriverActionService.decideDeletion('request-1','approved')).resolves.toMatchObject({status:'approved'});
        expect(mocks.socket.emit).toHaveBeenNthCalledWith(1,'driver_actions:request_delete',{driverId:'driver-1',sessionId:'session-1',reason:'Duplicate record'},expect.any(Function));
        expect(mocks.socket.emit).toHaveBeenNthCalledWith(2,'driver_actions:get_delete_requests',{},expect.any(Function));
        expect(mocks.socket.emit).toHaveBeenNthCalledWith(3,'driver_actions:decide_delete',{requestId:'request-1',decision:'approved'},expect.any(Function));
    });

    it('waits for the authenticated socket to connect before requesting history', async () => {
        mocks.socket.connected = false;
        mocks.socket.once.mockImplementation((event, handler) => {
            if (event === 'connect') queueMicrotask(() => { mocks.socket.connected = true; handler(); });
        });
        mocks.socket.emit.mockImplementation((_event, _payload, ack) => ack({success:true,sessions:[]}));
        const {DriverActionService} = await import('./driverActionService.js');
        await expect(DriverActionService.getSessions('driver-1')).resolves.toEqual({items:[],nextCursor:null});
        expect(mocks.socket.once).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mocks.socket.emit).toHaveBeenCalledWith('driver_actions:get_sessions', expect.anything(), expect.any(Function));
    });

    it('orders audit actions by their persisted sequence rather than device clock', async () => {
        mocks.socket.emit.mockImplementation((_event, _payload, ack) => ack({success:true,events:[
            {sequence:2,occurredAtMs:10},{sequence:1,occurredAtMs:20},
        ]}));
        const {DriverActionService, eventsNewestFirst} = await import('./driverActionService.js');
        const response = await DriverActionService.getEvents('driver-1','session-1');
        expect(eventsNewestFirst(response.items).map(item => item.sequence)).toEqual([2,1]);
    });

    it('reports a safe diagnostic code when the backend read fails', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.socket.emit.mockImplementation((_event, _payload, ack) => ack({success:false,errorCode:'DRIVER_ACTION_SESSIONS_READ_FAILED',message:'Activity history is temporarily unavailable'}));
        const {DriverActionService} = await import('./driverActionService.js');
        await expect(DriverActionService.getSessions('driver-1')).rejects.toMatchObject({code:'DRIVER_ACTION_SESSIONS_READ_FAILED'});
        expect(log).toHaveBeenCalledWith('[driver-action] acknowledgement_received', expect.objectContaining({event:'driver_actions:get_sessions',success:false,errorCode:'DRIVER_ACTION_SESSIONS_READ_FAILED',errorMessage:'Activity history is temporarily unavailable'}));
        expect(log.mock.calls.flat().join(' ')).not.toContain('driver-1');
    });

    it('plots only in-transit route samples while preserving other action locations', async () => {
        const {driverActionCoordinates, driverActionRouteCoordinates} = await import('./driverActionService.js');
        const events = [
            {eventType:'app_open', lat:14.6, lng:121.0},
            {eventType:'route_point', sequence:4, lat:14.7, lng:121.1},
            {eventType:'pod_captured', lat:14.8, lng:121.2},
            {eventType:'route_point', sequence:8, lat:14.9, lng:121.3},
            {eventType:'route_point', lat:null, lng:null},
        ];
        expect(events.map(driverActionCoordinates).filter(Boolean)).toHaveLength(4);
        expect(driverActionRouteCoordinates([...events].reverse())).toEqual([[14.7,121.1],[14.9,121.3]]);
    });

    it('splits GPS route colors at the confirmed return-to-base action', async () => {
        const {driverActionRouteSegments} = await import('./driverActionService.js');
        const segments = driverActionRouteSegments([
            {eventType:'route_point', sequence:2, lat:14.61, lng:121.01},
            {eventType:'returning_to_base', sequence:4, lat:14.70, lng:121.10},
            {eventType:'route_point', sequence:5, lat:14.71, lng:121.11},
            {eventType:'route_point', sequence:1, lat:14.60, lng:121.00},
            {eventType:'route_point', sequence:3, lat:14.69, lng:121.09},
        ]);
        expect(segments).toEqual([
            {phase:'outbound',points:[[14.60,121.00],[14.61,121.01],[14.69,121.09]]},
            {phase:'returning',points:[[14.70,121.10],[14.71,121.11]]},
        ]);
    });

    it('calculates fallback action durations without treating route samples as lifecycle steps', async () => {
        const {driverActionDurations} = await import('./driverActionService.js');
        const events = [
            {eventId:'open', eventType:'app_open', sequence:1, occurredAtMs:1000},
            {eventId:'scan-open', eventType:'qr_scan_opened', sequence:2, occurredAtMs:2000},
            {eventId:'route', eventType:'route_point', sequence:3, occurredAtMs:5000},
            {eventId:'scan', eventType:'qr_scan', sequence:4, occurredAtMs:10000, durationMs:8000, metadata:{durationBasis:'since_previous_action'}},
            {eventId:'completed', eventType:'session_completed', sequence:5, occurredAtMs:12000, durationMs:11000, metadata:{durationBasis:'session_total'}},
        ];
        const durations = driverActionDurations(events);
        expect(durations.get('scan-open')).toEqual({durationMs:8000,basis:'until_next_action'});
        expect(durations.get('scan')).toEqual({durationMs:8000,basis:'since_previous_action'});
        expect(durations.get('completed')).toEqual({durationMs:11000,basis:'session_total'});
        expect(durations.has('route')).toBe(false);
    });
});
