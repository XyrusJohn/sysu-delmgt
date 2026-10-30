const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createSystemErrorResponseLogger} = require('../../src/middleware/systemErrorResponseLogger');

test('captures 5xx responses with a request reference and no raw URL', async () => {
    let report;
    const response = new EventEmitter();
    response.statusCode = 503;
    response.locals = {};
    const logger = createSystemErrorResponseLogger({diagnosticsFactory: () => ({record: async item => { report = item; }})});
    const req = {requestId: 'request-12345678', path: '/api/driver/private-id', route: {path: '/:id'}, baseUrl: '/api/driver', user: {uid: 'driver-1'}};
    let nextCalled = false;
    logger(req, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    response.emit('finish');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(report, {
        eventCode: 'api_request_failure', requestId: 'request-12345678', errorName: 'HttpServerError',
        route: '/api/driver/:id', actorId: 'driver-1', details: {statusCode: 503},
    });
    assert.equal(req._systemErrorLogged, true);
});

test('does not record successful responses or duplicate centralized-handler reports', () => {
    let calls = 0;
    const logger = createSystemErrorResponseLogger({diagnosticsFactory: () => ({record: async () => { calls++; }})});
    for (const statusCode of [200, 500]) {
        const response = new EventEmitter();
        response.statusCode = statusCode;
        logger({requestId: 'request-12345678', _systemErrorLogged: statusCode === 500}, response, () => {});
        response.emit('finish');
    }
    assert.equal(calls, 0);
});
