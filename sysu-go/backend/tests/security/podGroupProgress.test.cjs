const {test} = require('node:test');
const assert = require('node:assert/strict');
const {applyPodGroupProgress, validatePodGroupRequest} = require('../../services/podProgress.js');

const image = 'data:image/jpeg;base64,/9j/AA==';
const destination = {shipTo: '0010002870', customerName: 'Synthetic Market', deliveryAddress: 'Synthetic address', latitude: 14.6628, longitude: 120.9578};
const item = (obdNumber, patch = {}) => ({...destination, obdNumber, quantity: 7, volume: 0.045, weight: 21.36, ...patch});
const rows = [item('OBD-A', {unloadStatus: 'UNLOADING'}), item('OBD-B', {unloadStatus: 'UNLOADING'}),
    item('OBD-C', {deliveryAddress: 'Another synthetic address', unloadStatus: 'UNLOADING'})];
const assignment = {driverId: 'driver-a', tripStatus: 'in_transit', lineItems: rows};
const unload = {action: 'unload', obdNumbers: ['OBD-A', 'OBD-B'], unloadStatus: 'UNLOADING'};
const complete = {action: 'complete', obdNumbers: ['OBD-A', 'OBD-B'], captureId: 'capture-1234567890',
    base64Image: image, deliveryStatus: 'All Delivered', capturedAtMillis: 1000};

test('group unload and POD update every OBD at one verified destination only', () => {
    const unloading = applyPodGroupProgress({...assignment, lineItems: rows.map(row => ({...row, unloadStatus: null}))}, 'driver-a', unload, 'group-id', 1000);
    assert.equal(unloading[0].unloadStatus, 'UNLOADING');
    assert.equal(unloading[1].unloadStatus, 'UNLOADING');
    assert.equal(unloading[2].unloadStatus, null);

    const completed = applyPodGroupProgress(assignment, 'driver-a', complete, 'group-id', 1000);
    assert.equal(completed[0].isPodCompleted, true);
    assert.equal(completed[1].isPodCompleted, true);
    assert.equal(completed[0].podGroupId, 'group-id');
    assert.deepEqual(completed[2], rows[2]);
    assert.equal(completed[0].quantity, 7);
});

test('group endpoint rejects omitted same-destination pending OBDs', () => {
    assert.throws(() => applyPodGroupProgress(assignment, 'driver-a', {...complete, obdNumbers: ['OBD-A']}, 'group-id', 1000),
        error => error.status === 409);
});

test('group endpoint rejects differing or missing destination identity', () => {
    assert.throws(() => applyPodGroupProgress(assignment, 'driver-a', {...complete, obdNumbers: ['OBD-A', 'OBD-C']}, 'group-id', 1000),
        error => error.status === 409);
    const incomplete = {...assignment, lineItems: [item('OBD-A', {shipTo: undefined}), item('OBD-B', {shipTo: undefined})]};
    assert.throws(() => applyPodGroupProgress(incomplete, 'driver-a', {...complete, obdNumbers: ['OBD-A', 'OBD-B']}, 'group-id', 1000),
        error => error.status === 409);
});

test('pending group capture preserves completed OBDs at the same destination', () => {
    const existing = {...item('OBD-A', {isPodCompleted: true, deliveryStatus: 'Rejected', podCapturedAt: 900, podGroupId: 'old-group'}),
        unloadStatus: null};
    const pending = item('OBD-B', {unloadStatus: 'UNLOADING'});
    const next = applyPodGroupProgress({...assignment, lineItems: [existing, pending]}, 'driver-a',
        {...complete, obdNumbers: ['OBD-B']}, 'new-group', 1000);
    assert.deepEqual(next[0], existing);
    assert.equal(next[1].podGroupId, 'new-group');
    assert.equal(next[1].isPodCompleted, true);
});

test('group retry with the same capture ID is idempotent', () => {
    const done = applyPodGroupProgress(assignment, 'driver-a', complete, 'group-id', 1000);
    assert.deepEqual(applyPodGroupProgress({...assignment, lineItems: done}, 'driver-a', complete, 'group-id', 1000), done);
});

test('foreign driver, inactive trip, and inconsistent duplicate OBD rows fail closed', () => {
    assert.throws(() => applyPodGroupProgress(assignment, 'driver-b', complete, 'group-id', 1000), error => error.status === 403);
    assert.throws(() => applyPodGroupProgress({...assignment, tripStatus: 'assigned'}, 'driver-a', complete, 'group-id', 1000), error => error.status === 409);
    const inconsistent = {...assignment, lineItems: [item('OBD-A', {isPodCompleted: true}), item('OBD-A')]};
    assert.throws(() => applyPodGroupProgress(inconsistent, 'driver-a', {...complete, obdNumbers: ['OBD-A']}, 'group-id', 1000), error => error.status === 409);
});

test('group request is bounded and rejects extra or invalid data', () => {
    assert.throws(() => validatePodGroupRequest({...complete, unexpected: true}, 1000), error => error.status === 400);
    assert.throws(() => validatePodGroupRequest({...complete, obdNumbers: ['OBD-A', 'OBD-A']}, 1000), error => error.status === 400);
    assert.throws(() => validatePodGroupRequest({...complete, captureId: 'short'}, 1000), error => error.status === 400);
    assert.throws(() => validatePodGroupRequest({...complete, obdNumbers: Array(499).fill(0).map((_, i) => `OBD-${i}`)}, 1000), error => error.status === 400);
});
