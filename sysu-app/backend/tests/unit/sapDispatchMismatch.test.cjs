const test = require('node:test');
const assert = require('node:assert/strict');
const {compareDispatchObds} = require('../../src/controllers/sapController');

test('detects SAP OBD omissions without exposing OBD values in the summary', () => {
    const result = compareDispatchObds(new Set(['OBD-A', 'OBD-B', 'OBD-C']), [
        {OBDNumber: 'OBD-A'}, {OBDNumber: 'OBD-C'}, {OBDNumber: 'UNASSIGNED'},
    ]);
    assert.deepEqual(result, {expectedCount: 3, receivedCount: 2, missingCount: 1});
});

test('treats an empty SAP result as all expected lines missing', () => {
    assert.deepEqual(compareDispatchObds(new Set(['OBD-A']), []), {
        expectedCount: 1, receivedCount: 0, missingCount: 1,
    });
});
