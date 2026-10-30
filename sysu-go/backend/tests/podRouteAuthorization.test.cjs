const test = require('node:test');
const assert = require('node:assert/strict');
const {createPodRouter} = require('../routes/podRoutes');
const {createMysqlPodService} = require('../services/mysqlPodService');

function getHandler(router) {
  const layer = router.stack.find(item => item.route?.path === '/:shipmentId/:obdNumber' && item.route.methods.get);
  return layer.route.stack.at(-1).handle;
}

function postHandler(router) {
  const layer = router.stack.find(item => item.route?.path === '/:shipmentId/:obdNumber' && item.route.methods.post);
  return layer.route.stack.at(-1).handle;
}

function response() {
  return {
    code: 200,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('driver POD reads remain scoped to the authenticated driver', async () => {
  const calls = [];
  const router = createPodRouter({
    authenticate: (_req, _res, next) => next(),
    getPodService: () => ({
      async get(...args) { calls.push(['driver', ...args]); return {base64Image: 'driver-image'}; },
      async getForStaff(...args) { calls.push(['staff', ...args]); return {}; },
    }),
  });
  const res = response();
  await getHandler(router)({params: {shipmentId: 'dispatch-a', obdNumber: 'obd-a'},
    user: {uid: 'driver-a'}, userProfile: {role: 'driver'}}, res);
  assert.equal(res.code, 200);
  assert.deepEqual(calls, [['driver', 'dispatch-a', 'obd-a', 'driver-a']]);
});

test('staff roles can read POD previews without weakening driver write access', async () => {
  const calls = [];
  const router = createPodRouter({
    authenticate: (_req, _res, next) => next(),
    getPodService: () => ({
      async getForStaff(...args) { calls.push(args); return {base64Image: 'staff-image'}; },
    }),
  });
  const res = response();
  await getHandler(router)({params: {shipmentId: 'dispatch-a', obdNumber: 'obd-a'},
    user: {uid: 'staff-a'}, userProfile: {role: 'admin'}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.data.base64Image, 'staff-image');
  assert.deepEqual(calls, [['dispatch-a', 'obd-a']]);
});

test('unapproved roles cannot read POD previews', async () => {
  const router = createPodRouter({
    authenticate: (_req, _res, next) => next(),
    getPodService: () => { throw new Error('POD service must not be called'); },
  });
  const res = response();
  await getHandler(router)({params: {shipmentId: 'dispatch-a', obdNumber: 'obd-a'},
    user: {uid: 'qr-a'}, userProfile: {role: 'qr_generator'}}, res);
  assert.equal(res.code, 403);
  assert.equal(res.body.success, false);
});

test('staff roles remain unable to submit driver POD writes', async () => {
  const router = createPodRouter({authenticate: (_req, _res, next) => next()});
  const res = response();
  await postHandler(router)({params: {shipmentId: 'dispatch-a', obdNumber: 'obd-a'},
    user: {uid: 'admin-a'}, userProfile: {role: 'admin'}}, res);
  assert.equal(res.code, 403);
  assert.equal(res.body.message, 'Driver account required');
});

test('staff POD reads return the stored single or grouped image payload', async () => {
  const row = {obd_number: 'obd-a', group_pod_id: 'group-a', driver_id: 'driver-a',
    image_data: null, group_image: 'group-image', captured_at_ms: 120, group_captured_at_ms: 100,
    recorded_at_ms: 130, delivery_status: 'All Delivered'};
  const service = createMysqlPodService({pool: {
    getConnection: async () => { throw new Error('write path must not be called'); },
    execute: async () => [[row]],
  }});
  assert.deepEqual(await service.getForStaff('dispatch-a', 'obd-a'), {
    obdNumber: 'obd-a', groupPodId: 'group-a', base64Image: 'group-image',
    capturedAtMillis: 120, recordedAtMillis: 130, deliveryStatus: 'All Delivered',
  });
  await assert.rejects(() => service.get('dispatch-a', 'obd-a', 'other-driver'), {status: 404});
});
