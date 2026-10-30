// Explicit review command using the shipped Socket.IO server and synthetic SQL-backed records.
const assert = require('node:assert/strict');
const {io: clientIo} = require('socket.io-client');
const {serverFixture} = require('../helpers/serverFixture.cjs');
const results = [];
async function connect(f, uid, onMap) {
  const socket = clientIo(f.url, {autoConnect: false, transports: ['websocket'], reconnection: false,
    auth: {token: f.token(uid)}});
  if (onMap) socket.on('update_admin_map', onMap);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Synthetic connection timed out')), 3000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
  return socket;
}
function nextEvent(socket, event, emit) {
  return new Promise((resolve, reject) => {
    const handler = payload => { clearTimeout(timer); resolve(payload); };
    const timer = setTimeout(() => { socket.off(event, handler); reject(Error('Synthetic event timed out')); }, 3000);
    socket.once(event, handler); emit();
  });
}
const nextMap = (socket, emit) => nextEvent(socket, 'update_admin_map', emit);
async function check(id, description, run) {
  try { await run(); results.push({id, description, passed: true}); }
  catch (error) { results.push({id, description, passed: false, reason: error.message.split('\n')[0]}); }
}
(async () => {
  const log = console.log, warn = console.warn, error = console.error;
  console.log = console.warn = console.error = () => {};
  const sockets = []; let f;
  try {
    f = await serverFixture();
    const driver = await connect(f, 'driver-a'), staff = await connect(f, 'staff-a');
    sockets.push(driver, staff);
    const replay = event => {
      const late = clientIo(f.url, {autoConnect: false, transports: ['websocket'], reconnection: false,
        auth: {token: f.token('staff-a')}}); sockets.push(late);
      return nextEvent(late, event, () => late.connect());
    };
    const now = Date.now();
    const emit = extra => driver.emit('driver_moving', {driverId: 'driver-a', lat: 14.5, lng: 121,
      sapDocId: 'own-a', timestamp: now, ...extra});
    await check('L15', 'Map event supplies an authoritative location timestamp', async () => {
      const payload = await nextMap(staff, () => emit()); assert.ok(Number.isFinite(payload.timestamp));
    });
    await check('L16', 'Older supplied fix cannot rewind the staff marker stream', async () => {
      await nextMap(staff, () => emit({lat: 14.6, timestamp: now}));
      const events = []; const listener = payload => events.push(payload); staff.on('update_admin_map', listener);
      try { emit({lat: 14.4, timestamp: now - 60000}); await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(events.some(payload => payload.lat === 14.4), false);
      } finally { staff.off('update_admin_map', listener); }
    });
    await check('L17', 'Late staff subscription preserves the current assignment link', async () => {
      await nextMap(staff, () => emit());
      assert.equal((await replay('update_admin_map')).sapDocId, 'own-a');
    });
    await check('L18', 'Late staff subscription retains a stopped driver state', async () => {
      await nextEvent(staff, 'vendor_status_update', () => driver.emit('driver_stopped', {driverId: 'driver-a', lat: 14.5, lng: 121}));
      assert.equal((await replay('vendor_status_update')).status, 'stopped');
    });
    await check('L19', 'Completed assignment is excluded from live location linkage', async () => {
      f.records.set('sap_assignments/own-a', {driverId: 'driver-a', tripStatus: 'completed'});
      const payload = await nextMap(staff, () => emit()); assert.equal(payload.sapDocId, null);
    });
  } finally {
    sockets.forEach(socket => socket.close()); if (f) await f.close();
    console.log = log; console.warn = warn; console.error = error;
  }
  console.log(JSON.stringify({scope: 'Real local Socket.IO protocol; synthetic MySQL session/record fixtures; no phone or production writes',
    total: results.length, passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length, results}, null, 2));
  process.exitCode = results.some(result => !result.passed) ? 1 : 0;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
