import {beforeEach, expect, test, vi} from "vitest";
import {readTruckCompanyCache, writeTruckCompanyCache} from "./truckCompanyOfflineCache.js";

const state = vi.hoisted(() => ({user: {id: "account-a"}, next: null, error: null}));
vi.mock("./authService.js", () => ({AuthService: {getUserProfile: () => state.user}}));
vi.mock("./realtimeService.js", () => ({
    asCollectionSnapshot: rows => ({forEach: callback => rows.forEach(row => callback({id: row.id, data: () => row}))}),
    subscribeRealtime: (_topic, _params, next, error) => {
        state.next = next;
        state.error = error;
        return () => {};
    },
}));

import {TruckCompanyService} from "./truckCompanyService.js";

const oldRows = [{id: "tc-old", companyCode: "tc-old", forwarderCode: "fwd", name: "Old Company", active: true}];
const liveRows = [{id: "tc-live", companyCode: "tc-live", forwarderCode: "fwd", name: "Live Company", active: true}];

beforeEach(() => {
    localStorage.clear();
    state.user = {id: "account-a"};
    state.next = null;
    state.error = null;
});

test("emits a labeled cached snapshot first, then replaces it with a valid live snapshot", async () => {
    writeTruckCompanyCache("account-a", oldRows, Date.now() - 1000);
    const callback = vi.fn();
    const stop = await TruckCompanyService.subscribe(callback);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({"tc-old": expect.any(Object)}),
        expect.objectContaining({source: "cache", stale: true}));

    state.next(liveRows);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({"tc-live": expect.any(Object)}),
        expect.objectContaining({source: "server", stale: false}));
    expect(readTruckCompanyCache("account-a").rows).toEqual(liveRows);
    stop();
});

test("keeps the previous valid snapshot when the realtime source fails or returns malformed data", async () => {
    writeTruckCompanyCache("account-a", oldRows, Date.now() - 1000);
    const callback = vi.fn();
    const onError = vi.fn();
    await TruckCompanyService.subscribe(callback, onError);

    state.next([{id: "bad", companyCode: "bad"}]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {cached: true});
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({"tc-old": expect.any(Object)}),
        expect.objectContaining({source: "cache", stale: true}));
    expect(readTruckCompanyCache("account-a").rows).toEqual(oldRows);
});

test("does not read or write browser snapshots without an authenticated account", async () => {
    state.user = null;
    const callback = vi.fn();
    await TruckCompanyService.subscribe(callback);
    state.next(liveRows);
    expect(readTruckCompanyCache("account-a")).toBeNull();
});
