const test=require('node:test'),assert=require('node:assert/strict');
const {createSocketAuth}=require('../../middleware/socketAuth.js');
const {DRIVER_ACTION_EVENT_TYPES: EVENT_TYPES}=require('../../constants/driverActionEvents.js');

function harness({token='synthetic-valid-token-0001',role='driver',status='active',readError,identity={id:'uid-a'}}={}){
 const calls=[];let disconnects=0;let current={...identity,role,status};let rejectToken=false;
 const socket={id:'synthetic',handshake:{auth:token?{token}:{},headers:{}},data:{},use(fn){this.packetGuard=fn;},disconnect(){disconnects++;}};
 const middleware=createSocketAuth({authenticateSession:async value=>{calls.push(['authenticate',value]);if(rejectToken||readError)throw Error('private session failure');return current;}});
 return {socket,middleware,calls,setProfile:p=>current=p,revoke:()=>{rejectToken=true;},get disconnects(){return disconnects;}};
}
function connect(h){return new Promise(resolve=>h.middleware(h.socket,error=>resolve(error)));}
function packet(h,event,payload={}){return new Promise(resolve=>h.socket.packetGuard([event,payload],error=>resolve(error)));}

test('G13 rejects missing token before a socket is accepted',async()=>{const h=harness({token:''});const error=await connect(h);assert.ok(error);assert.equal(h.socket.data.uid,undefined);});
test('G13 authenticates a MySQL session and records only canonical actor identity',async()=>{const h=harness();assert.equal(await connect(h),undefined);assert.deepEqual(h.calls,[['authenticate','synthetic-valid-token-0001']]);assert.equal(h.socket.data.uid,'uid-a');assert.equal(h.socket.data.role,'driver');});
for(const [label,options] of [['disabled',{status:'disabled'}],['pending',{role:'pending',status:'inactive'}],['unknown role',{role:'attacker'}],['profile outage',{readError:Error('private db outage')} ]])test('G13 denies '+label+' without leaking details',async()=>{const h=harness(options);const error=await connect(h);assert.ok(error);assert.doesNotMatch(error.message,/private/);});
test('G13 rejects role changes and revoked sessions on the next event',async()=>{const h=harness();assert.equal(await connect(h),undefined);h.setProfile({id:'uid-a',role:'admin',status:'active'});const error=await packet(h,'heartbeat');assert.ok(error);assert.equal(h.disconnects,1);const revoked=harness();assert.equal(await connect(revoked),undefined);revoked.revoke();assert.ok(await packet(revoked,'heartbeat'));assert.equal(revoked.disconnects,1);});
test('G13 driver cannot emit unapproved event names',async()=>{const h=harness();assert.equal(await connect(h),undefined);const error=await packet(h,'make_admin',{uid:'victim'});assert.ok(error);assert.equal(h.disconnects,1);});
test('G13 driver events must remain self scoped and bounded',async()=>{const h=harness();assert.equal(await connect(h),undefined);const foreign=await packet(h,'driver_stopped',{driverId:'victim'});assert.ok(foreign);const other=harness();assert.equal(await connect(other),undefined);const oversized=await packet(other,'driver_stopped',{driverId:'uid-a',data:'x'.repeat(9000)});assert.ok(oversized);});
test('G13 legitimate stationary and truck-full events remain supported',async()=>{const h=harness();assert.equal(await connect(h),undefined);assert.equal(await packet(h,'driver_stopped',{driverId:'uid-a',lat:14.5,lng:121,name:'Synthetic',status:'stopped',stoppedAt:1}),undefined);assert.equal(await packet(h,'update_status',{driverId:'uid-a',status:'stopped',name:'Synthetic'}),undefined);assert.equal(await packet(h,'driver_is_full',{driverId:'uid-a',isFull:true}),undefined);});
test('G13 only authenticated drivers may subscribe to approved master-data streams',async()=>{
 for(const topic of ['securityGuards','truckCompanies']){const driver=harness();assert.equal(await connect(driver),undefined);assert.equal(await packet(driver,'realtime:subscribe',{id:`sub-${topic}`,topic,params:{}}),undefined);const staff=harness({role:'admin'});assert.equal(await connect(staff),undefined);assert.ok(await packet(staff,'realtime:subscribe',{id:`sub-${topic}`,topic,params:{}}));assert.equal(staff.disconnects,1);}
});
test('G13 POD event requires a bounded assignment identifier',async()=>{const h=harness();assert.equal(await connect(h),undefined);assert.equal(await packet(h,'pod_updated',{shipmentDocId:'dispatch-123',source:'driver_app'}),undefined);assert.ok(await packet(h,'pod_updated',{shipmentDocId:'../foreign',source:'driver_app'}));});

test('driver activity sync accepts only bounded self-authenticated batches and valid zero coordinates', async () => {
  const sessionId = '0d3a8588-8c60-4e3f-97c9-c373148234c5';
  const validEvent = {
    eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd414', sessionId, sequence: 1,
    eventType: 'app_open', occurredAtMs: Date.now(), locationState: 'available',
    lat: 0, lng: 0, accuracy: 20, outcome: 'success', metadata: {},
  };
  const h = harness(); assert.equal(await connect(h), undefined);
  assert.equal(await packet(h, 'driver_actions:sync', {sessionId, events: [validEvent]}), undefined);
  for (const payload of [
    {sessionId, driverId: 'victim', events: [validEvent]},
    {sessionId, events: [{...validEvent, sequence: 0}]},
    {sessionId, events: [{...validEvent, eventType: 'unapproved'}]},
    {sessionId, events: [{...validEvent, lat: 91}]},
    {sessionId, events: Array(51).fill(validEvent)},
  ]) {
    const other = harness(); assert.equal(await connect(other), undefined);
    assert.ok(await packet(other, 'driver_actions:sync', payload));
  }
});

test('socket authorization accepts every activity event supported by the persistence service', async () => {
  let sequence = 0;
  for (const eventType of EVENT_TYPES) {
    sequence += 1;
    const sessionId = '0d3a8588-8c60-4e3f-97c9-c373148234c5';
    const event = {
      eventId: `6a1bb782-9c6f-447e-8a23-${sequence.toString(16).padStart(12, '0')}`,
      sessionId, sequence, eventType, occurredAtMs: Date.now(),
      locationState: 'unavailable', outcome: 'success', metadata: {},
    };
    const h = harness(); assert.equal(await connect(h), undefined);
    assert.equal(await packet(h, 'driver_actions:sync', {sessionId, events: [event]}), undefined, eventType);
  }
});

test('driver action history reads are staff-only and bounded', async () => {
  const sessionId = '0d3a8588-8c60-4e3f-97c9-c373148234c5';
  for (const role of ['fleet_manager', 'admin', 'super_admin']) {
    const staff = harness({role}); assert.equal(await connect(staff), undefined);
    assert.equal(await packet(staff, 'driver_actions:get_events', {driverId: 'uid-a', sessionId, limit: 100, cursor: 0}), undefined);
    assert.ok(await packet(staff, 'driver_actions:get_sessions', {driverId: 'uid-a', limit: 501}));
  }
  for (const role of ['driver', 'qr_generator']) {
    const denied = harness({role}); assert.equal(await connect(denied), undefined);
    assert.ok(await packet(denied, 'driver_actions:get_sessions', {driverId: 'uid-a', limit: 20}));
  }
});

test('shipment-number action search is staff-only and accepts bounded safe prefixes', async () => {
  for (const role of ['fleet_manager', 'admin', 'super_admin']) {
    const staff = harness({role}); assert.equal(await connect(staff), undefined);
    assert.equal(await packet(staff, 'driver_actions:search_shipment', {query:'101405'}), undefined);
    for (const query of ['12', '../private', 'x'.repeat(129)]) {
      const invalid = harness({role}); assert.equal(await connect(invalid), undefined);
      assert.ok(await packet(invalid, 'driver_actions:search_shipment', {query}));
      assert.equal(invalid.disconnects, 1);
    }
  }
  for (const role of ['driver', 'qr_generator']) {
    const denied = harness({role}); assert.equal(await connect(denied), undefined);
    assert.ok(await packet(denied, 'driver_actions:search_shipment', {query:'101405'}));
  }
});


test('G13 idle authorization monitor rechecks MySQL session role/revocation and clears itself on disconnect', async () => {
  const originalSet = global.setInterval, originalClear = global.clearInterval;
  let tick, cleared = 0, detached = 0, disconnect;
  global.setInterval = (callback, interval) => { assert.equal(interval, 30000); tick = callback; return {unref(){detached++;}}; };
  global.clearInterval = () => {cleared++;};
  try {
    const h = harness(); h.socket.once = (event, callback) => {assert.equal(event, 'disconnect'); disconnect = callback;};
    assert.equal(await connect(h), undefined); assert.equal(detached, 1);
    await tick(); assert.equal(h.disconnects, 0);
    h.setProfile({role:'admin',status:'active'}); await tick(); assert.equal(h.disconnects, 1);
    h.revoke(); await tick(); assert.equal(h.disconnects, 2);
    disconnect(); assert.equal(cleared, 1);
  } finally {global.setInterval = originalSet; global.clearInterval = originalClear;}
});

test('G13 malformed/missing canonical identity never reaches socket handlers', async () => {
  for (const options of [{token:12},{token:'short'},{token:'x'.repeat(8193)},{identity:{id:''}},{identity:{id:99}}]) {
    const h=harness(options); assert.ok(await connect(h)); assert.equal(h.socket.packetGuard,undefined);
  }
  const h=harness(); h.setProfile(null); assert.ok(await connect(h));
});

test('G13 event boundaries reject malformed values and staff cannot act as drivers', async () => {
  for (const [event,payload] of [
    ['heartbeat','invalid'], ['heartbeat',[]], ['driver_moving',{driverId:'uid-a',lat:91,lng:121}],
    ['driver_moving',{lat:14,lng:121}], ['driver_stopped',{lat:14,lng:0}],
    ['update_status',{status:'online',lat:14,lng:999}], ['update_status',{status:'in_transit'}],
    ['driver_status_change',{status:'completed'}], ['driver_status_change',{status:'online',name:123}],
    ['driver_stopped',{lat:14,lng:121,sapDocId:'../foreign'}], ['driver_is_full',{isFull:'true'}],
    ['pod_updated',{shipmentDocId:'dispatch-1',source:'untrusted'}],
    ['pod_updated',{shipmentDocId:'x'.repeat(129),source:'driver_app'}],
  ]) {const h=harness(); assert.equal(await connect(h),undefined); assert.ok(await packet(h,event,payload)); assert.equal(h.disconnects,1);}
  const staff=harness({role:'admin'}); assert.equal(await connect(staff),undefined); assert.ok(await packet(staff,'heartbeat'));
  const valid=harness(); assert.equal(await connect(valid),undefined);
  for (const [event,payload] of [['driver_moving',{driverId:'uid-a',lat:14,lng:121,sapDocId:'own-1',name:'Synthetic'}],['update_status',{status:'online',lat:14,lng:121}],['driver_status_change',{status:'returning_to_base'}],['request_driver_status',null]]) assert.equal(await packet(valid,event,payload),undefined);
});

test('driver session removal requests are staff-only and final decisions are admin-only',async()=>{
 const sessionId='0d3a8588-8c60-4e3f-97c9-c373148234c5';
 const request={driverId:'uid-a',sessionId,reason:'Duplicate session'};
 for(const role of ['fleet_manager','admin','super_admin']){
  const staff=harness({role});assert.equal(await connect(staff),undefined);
  assert.equal(await packet(staff,'driver_actions:request_delete',request),undefined);
  const queueResult=await packet(staff,'driver_actions:get_delete_requests',{});
  if(role==='fleet_manager')assert.ok(queueResult);else assert.equal(queueResult,undefined);
 }
 for(const role of ['driver','qr_generator']){
  const denied=harness({role});assert.equal(await connect(denied),undefined);
  assert.ok(await packet(denied,'driver_actions:request_delete',request));
  assert.ok(await packet(denied,'driver_actions:get_delete_requests',{}));
 }
 const fleet=harness({role:'fleet_manager'});assert.equal(await connect(fleet),undefined);
 assert.ok(await packet(fleet,'driver_actions:decide_delete',{requestId:'request-1',decision:'approved'}));
 const fleetQueue=harness({role:'fleet_manager'});assert.equal(await connect(fleetQueue),undefined);
 assert.ok(await packet(fleetQueue,'driver_actions:get_delete_requests',{}));
 const admin=harness({role:'admin'});assert.equal(await connect(admin),undefined);
 assert.equal(await packet(admin,'driver_actions:decide_delete',{requestId:'request-1',decision:'approved'}),undefined);
 assert.ok(await packet(admin,'driver_actions:decide_delete',{requestId:'request-1',decision:'remove'}));
});
