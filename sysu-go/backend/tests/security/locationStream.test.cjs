const test = require('node:test'), assert = require('node:assert/strict');
const {once} = require('node:events');
const {io} = require('socket.io-client');
const {serverFixture} = require('../helpers/serverFixture.cjs');
const delay = () => new Promise(resolve => setTimeout(resolve, 150));
async function withStream(run) {
  const f = await serverFixture(), sockets = [];
  async function connect(uid) {
    const socket = io(f.url, {autoConnect:false, transports:['websocket'], reconnection:false, auth:{token:f.token(uid)}});
    sockets.push(socket); const ready = once(socket, 'connect'); socket.connect(); await ready; return socket;
  }
  try { await run(f, await connect('driver-a'), await connect('staff-a'), connect); }
  finally { sockets.forEach(socket => socket.close()); await f.close(); }
}
const fix = extra => ({driverId:'driver-a',lat:14.5,lng:121,sapDocId:'own-a',timestamp:Date.now(),...extra});
async function nextFix(driver, staff, data = fix()) {
  const received = once(staff, 'update_admin_map'); driver.emit('driver_moving', data); return (await received)[0];
}

test('GPS stream rejects old, future, malformed and inaccurate fixes', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  const events = []; staff.on('update_admin_map', payload => events.push(payload));
  for (const extra of [{timestamp:Date.now()-16000},{timestamp:Date.now()+60000},{timestamp:'invalid'},
    {accuracyMeters:51}]) driver.emit('driver_moving', fix(extra));
  await delay(); assert.deepEqual(events, []);
  assert.ok(Number.isFinite((await nextFix(driver,staff)).timestamp));
}));
test('driver receives acknowledgment only after GPS is persisted and broadcast', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  const received = once(staff, 'update_admin_map');
  const response = await new Promise((resolve, reject) => {
    driver.timeout(3000).emit('driver_moving', fix(), (error, result) => error ? reject(error) : resolve(result));
  });
  assert.equal(response.ok, true);
  assert.equal(response.trackingRecipients, 1);
  assert.equal(Number.isFinite(response.timestamp), true);
  assert.equal((await received)[0].lat, 14.5);
}));
test('monotonic GPS fix age is used when the phone wall clock is skewed', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  const received = once(staff, 'update_admin_map');
  const response = await new Promise((resolve, reject) => {
    driver.timeout(3000).emit('driver_moving', fix({timestamp: Date.now() - 120000, fixAgeMs: 2500}),
      (error, result) => error ? reject(error) : resolve(result));
  });
  assert.equal(response.ok, true);
  assert.ok(Math.abs(Date.now() - response.timestamp - 2500) < 500);
  assert.equal((await received)[0].timestamp, response.timestamp);
}));
test('monotonic fix age beyond the freshness limit is rejected', {timeout:10000}, () => withStream(async(f,driver) => {
  const response = await new Promise((resolve, reject) => {
    driver.timeout(3000).emit('driver_moving', fix({fixAgeMs: 15001}),
      (error, result) => error ? reject(error) : resolve(result));
  });
  assert.deepEqual(response, {ok: false, code: 'STALE_LOCATION'});
}));
test('GPS persistence failure is reported and not broadcast as an accepted fix', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  f.state.locationSaveError = true;
  const events = []; staff.on('update_admin_map', payload => events.push(payload));
  const response = await new Promise((resolve, reject) => {
    driver.timeout(3000).emit('driver_moving', fix(), (error, result) => error ? reject(error) : resolve(result));
  });
  assert.deepEqual(response, {ok: false, code: 'LOCATION_UNAVAILABLE'});
  await delay();
  assert.deepEqual(events, []);
}));
test('stale GPS rejection is acknowledged with a retryable reason', {timeout:10000}, () => withStream(async(f,driver) => {
  const response = await new Promise((resolve, reject) => {
    driver.timeout(3000).emit('driver_moving', fix({timestamp: Date.now() - 16000}), (error, result) => error ? reject(error) : resolve(result));
  });
  assert.deepEqual(response, {ok: false, code: 'STALE_LOCATION'});
}));
test('Malformed GPS remains denied by the existing socket authorization boundary', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  const events=[]; staff.on('update_admin_map', payload=>events.push(payload));
  const disconnected=once(driver,'disconnect'); driver.emit('driver_moving',fix({lat:91}));
  await disconnected; assert.deepEqual(events,[]);
}));
test('Legacy driver without new GPS metadata still works', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  const data = fix(); delete data.timestamp;
  assert.equal((await nextFix(driver,staff,data)).sapDocId, 'own-a');
}));
test('Slow older lookup cannot overwrite a newer GPS fix', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  let release, entered;
  const blocked = new Promise(resolve => entered = resolve);
  f.state.beforeDocRead = async(collection,id) => {
    if(collection === 'sap_assignments' && id === 'own-a' && !release) {
      await new Promise(resolve => { release=resolve; entered(); });
    }
  };
  const events=[]; staff.on('update_admin_map', payload=>events.push(payload));
  const old=fix(); driver.emit('driver_moving',old); await blocked;
  const newer=await nextFix(driver,staff,{...old,lat:14.6,timestamp:old.timestamp+1});
  assert.equal(newer.lat,14.6); release(); await delay();
  assert.deepEqual(events.map(payload=>payload.lat),[14.6]);
}));
test('Closure blocks late GPS and a newer owned trip can restart', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  await nextFix(driver,staff);
  const completed=once(staff,'update_status');
  driver.emit('update_status',{driverId:'driver-a',status:'completed'}); await completed;
  f.records.set('sap_assignments/own-a',{driverId:'driver-a',tripStatus:'completed'});
  const events=[]; staff.on('update_admin_map', payload=>events.push(payload));
  driver.emit('driver_moving',fix()); await delay(); assert.deepEqual(events,[]);
  f.records.set('sap_assignments/next-a',{driverId:'driver-a',tripStatus:'in_transit'});
  assert.equal((await nextFix(driver,staff,fix({sapDocId:'next-a'}))).sapDocId,'next-a');
}));
test('Returning GPS retains lifecycle state and the next trip resets it', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  f.records.set('sap_assignments/own-a',{driverId:'driver-a',tripStatus:'returning_to_base'});
  assert.equal((await nextFix(driver,staff)).status,'returning_to_base');
  f.records.set('sap_assignments/next-a',{driverId:'driver-a',tripStatus:'in_transit'});
  assert.equal((await nextFix(driver,staff,fix({sapDocId:'next-a'}))).status,'online');
}));
test('Assignment read failure excludes unverified links and recovers on retry', {timeout:10000}, () => withStream(async(f,driver,staff) => {
  f.state.readCollectionError='sap_assignments';
  assert.equal((await nextFix(driver,staff)).sapDocId,null);
  delete f.state.readCollectionError;
  assert.equal((await nextFix(driver,staff)).sapDocId,'own-a');
}));
test('Transient disconnect and reconnect never emit a stale offline status', {timeout:10000}, () => withStream(async(f,driver,staff,connect) => {
  await nextFix(driver,staff);
  const events=[];staff.on('vendor_status_update',payload=>events.push(payload));
  driver.disconnect(); await delay();
  const replacement=await connect('driver-a');
  replacement.emit('update_status',{driverId:'driver-a',status:'online',lat:14.5,lng:121});
  await nextFix(replacement,staff,fix({lat:14.7}));
  assert.equal(events.some(payload=>payload.status==='offline_in_transit'||payload.status==='offline'),false);
}));
test('transient socket disconnect keeps active-trip marker online until heartbeat grace expires', {timeout:10000}, () => withStream(async(f,driver,staff,connect) => {
  await nextFix(driver,staff);
  const events=[]; staff.on('vendor_status_update',payload=>events.push(payload));
  driver.disconnect(); await delay();
  assert.deepEqual(events,[]);
  const replacement=await connect('driver-a');
  replacement.emit('update_status',{driverId:'driver-a',status:'online',lat:14.5,lng:121});
  const update=await nextFix(replacement,staff,fix({lat:14.7}));
  assert.equal(update.status,'online');
  assert.equal(update.lat,14.7);
  assert.equal(events.some(payload=>payload.status==='offline_in_transit'||payload.status==='offline'),false);
}));
