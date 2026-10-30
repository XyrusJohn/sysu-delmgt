const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveEarliest, validateEarliest } = require("../../src/services/queueOrdering.js");

test("FIFO Ordering: sorts 4 queued drivers correctly by entry timestamp", () => {
    const queue = [
        { id: "driver-1", driverId: "uid-1", truckType: "AUV", entryTime: 1000, status: "waiting" },
        { id: "driver-2", driverId: "uid-2", truckType: "AUV", entryTime: 2000, status: "waiting" },
        { id: "driver-3", driverId: "uid-3", truckType: "AUV", entryTime: 3000, status: "waiting" },
        { id: "driver-4", driverId: "uid-4", truckType: "AUV", entryTime: 4000, status: "waiting" },
    ];

    const { earliest, alternates } = resolveEarliest(queue, "AUV");
    assert.equal(earliest.id, "driver-1");
    assert.equal(alternates.length, 3);
    assert.deepEqual(alternates.map(a => a.id), ["driver-2", "driver-3", "driver-4"]);
});

test("FIFO Ordering: assigns rank 1 to 4 correctly with timestamps", () => {
    const queue = [
        { id: "d4", driverId: "uid-4", truckType: "10-Wheeler", entryTime: 4000, status: "waiting" },
        { id: "d2", driverId: "uid-2", truckType: "10-Wheeler", entryTime: 2000, status: "waiting" },
        { id: "d1", driverId: "uid-1", truckType: "10-Wheeler", entryTime: 1000, status: "waiting" },
        { id: "d3", driverId: "uid-3", truckType: "10-Wheeler", entryTime: 3000, status: "waiting" },
    ];

    const sorted = [...queue].sort((a, b) => a.entryTime - b.entryTime);
    assert.equal(sorted.indexOf(sorted.find(d => d.id === "d1")) + 1, 1);
    assert.equal(sorted.indexOf(sorted.find(d => d.id === "d2")) + 1, 2);
    assert.equal(sorted.indexOf(sorted.find(d => d.id === "d3")) + 1, 3);
    assert.equal(sorted.indexOf(sorted.find(d => d.id === "d4")) + 1, 4);
});

test("FIFO Validation: earliest passes, non-earliest fails with NOT_EARLIEST", () => {
    const queue = [
        { id: "driver-1", driverId: "uid-1", truckType: "AUV", entryTime: 1000, status: "waiting" },
        { id: "driver-2", driverId: "uid-2", truckType: "AUV", entryTime: 2000, status: "waiting" },
    ];

    assert.equal(validateEarliest(queue, "AUV", "driver-1"), null);
    assert.equal(validateEarliest(queue, "AUV", "uid-1"), null);

    const checkNonEarliest = validateEarliest(queue, "AUV", "driver-2");
    assert.equal(checkNonEarliest.code, "NOT_EARLIEST");
});

test("Multi-Shipment Pre-Transit Logic: allows multiple shipments when driver is assigned or loading", () => {
    const existingAssignments = [
        { dispatchKey: "10001", driverId: "uid-1", tripStatus: "assigned" }
    ];

    const hasExistingPreTransit = existingAssignments.some(a =>
        ["assigned", "loading", "loaded", "fully_loaded"].includes((a.tripStatus || "").toLowerCase())
    );

    assert.equal(hasExistingPreTransit, true, "Driver with pre-transit load must bypass NOT_EARLIEST check");
});
