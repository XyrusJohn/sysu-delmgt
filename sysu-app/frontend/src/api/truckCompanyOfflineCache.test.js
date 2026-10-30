import {beforeEach, expect, test, vi} from "vitest";
import {clearTruckCompanyCache, readTruckCompanyCache, writeTruckCompanyCache} from "./truckCompanyOfflineCache.js";

const rows = [{id: "tc-1", companyCode: "tc-1", forwarderCode: "fwd-1", name: "Example Logistics", active: true}];

beforeEach(() => localStorage.clear());

test("stores a complete snapshot with its timestamp under the account key", () => {
    expect(writeTruckCompanyCache("account-a", rows, 1000)).toBe(true);
    expect(readTruckCompanyCache("account-a", 2000)).toEqual({rows, fetchedAt: 1000});
});

test("isolates accounts and expires snapshots after 24 hours", () => {
    writeTruckCompanyCache("account-a", rows, 1000);
    expect(readTruckCompanyCache("account-b", 2000)).toBeNull();
    expect(readTruckCompanyCache("account-a", 1000 + 24 * 60 * 60 * 1000 + 1)).toBeNull();
});

test("rejects malformed snapshots and preserves a valid entry after failed writes", () => {
    writeTruckCompanyCache("account-a", rows, 1000);
    expect(writeTruckCompanyCache("account-a", [{...rows[0], active: "yes"}], 2000)).toBe(false);
    expect(readTruckCompanyCache("account-a", 3000)).toEqual({rows, fetchedAt: 1000});
});

test("clears only the signed-out account cache", () => {
    writeTruckCompanyCache("account-a", rows, 1000);
    writeTruckCompanyCache("account-b", rows, 1000);
    clearTruckCompanyCache("account-a");
    expect(readTruckCompanyCache("account-a", 2000)).toBeNull();
    expect(readTruckCompanyCache("account-b", 2000)).not.toBeNull();
});

test("does not fail the application when browser storage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readTruckCompanyCache("account-a")).toBeNull();
    getItem.mockRestore();
});
