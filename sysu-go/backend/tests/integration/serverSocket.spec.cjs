const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events'),{io:clientIo}=require('socket.io-client');
const {serverFixture}=require('../helpers/serverFixture.cjs');
const delay=()=>new Promise(resolve=>setTimeout(resolve,100));
async function connect(f,uid) {
  const socket=clientIo(f.url,{autoConnect:false,transports:['websocket'],reconnection:false,auth:{token:f.token(uid)}});
  const connected=once(socket,'connect'); socket.connect(); await connected; return socket;
}
test('G13 shipped MySQL server keeps locations and reconnect snapshots private to tracking staff',{timeout:20000},async()=>{
  const f=await serverFixture(),sockets=[];
  try {
    const [driver,other,qr,staff]=await Promise.all(['driver-a','driver-b','qr-a','staff-a'].map(async uid=>{const socket=await connect(f,uid); sockets.push(socket); return socket;}));
    const leaked=[]; other.on('update_admin_map',p=>leaked.push(p)); qr.on('update_admin_map',p=>leaked.push(p)); driver.on('update_admin_map',p=>leaked.push(p));
    const received=once(staff,'update_admin_map'); driver.emit('driver_moving',{driverId:'driver-a',lat:14.6,lng:121,sapDocId:'foreign-b',name:'Forged'});
    const [payload]=await received; assert.equal(payload.driverId,'driver-a'); assert.equal(payload.name,'Canonical A'); assert.equal(payload.sapDocId,null);
    await delay(); assert.deepEqual(leaked,[]);
    const reconnect=clientIo(f.url,{autoConnect:false,transports:['websocket'],reconnection:false,auth:{token:f.token('staff-a')}}); sockets.push(reconnect);
    const snapshot=once(reconnect,'update_admin_map'); reconnect.connect(); assert.equal((await snapshot)[0].driverId,'driver-a');
  } finally {for(const s of sockets)s.close(); await f.close();}
});
test('only admin and super-admin sockets join the mobile diagnostics notification room',{timeout:5000},async()=>{
  const f=await serverFixture(),sockets=[];
  try {
    const [admin,superAdmin,staff,driver]=await Promise.all(['admin-a','super-a','staff-a','driver-a'].map(async uid=>{
      const socket=await connect(f,uid); sockets.push(socket); return socket;
    }));
    await delay();
    const room=f.io.sockets.adapter.rooms.get('staff:system-diagnostics');
    assert.equal(room?.has(admin.id),true);
    assert.equal(room?.has(superAdmin.id),true);
    assert.equal(room?.has(staff.id),false);
    assert.equal(room?.has(driver.id),false);
    const adminEvent=once(admin,'mobile_diagnostic_run_created');
    const superEvent=once(superAdmin,'mobile_diagnostic_run_created');
    const staffEvents=[]; staff.on('mobile_diagnostic_run_created',payload=>staffEvents.push(payload));
    f.io.to('staff:system-diagnostics').emit('mobile_diagnostic_run_created',{actorId:'synthetic-account',runId:'synthetic-run'});
    assert.equal((await adminEvent)[0].actorId,'synthetic-account');
    assert.equal((await superEvent)[0].actorId,'synthetic-account');
    await delay(); assert.deepEqual(staffEvents,[]);
  } finally {for(const socket of sockets)socket.close(); await f.close();}
});
test('G13 shipped server rejects cross-driver mutation before persistence or staff emission',{timeout:5000},async()=>{
  const f=await serverFixture(),driver=await connect(f,'driver-a'),staff=await connect(f,'staff-a');
  try {const leaked=[];staff.on('driver_status_change',p=>leaked.push(p));const disconnected=once(driver,'disconnect');driver.emit('driver_status_change',{driverId:'driver-b',status:'offline'});await disconnected;await delay();assert.deepEqual(f.writes,[]);assert.deepEqual(leaked,[]);}
  finally {driver.close();staff.close();await f.close();}
});
test('G13 shipped lifecycle event uses stored name and server timestamp',{timeout:5000},async()=>{
  const f=await serverFixture(),driver=await connect(f,'driver-a'),staff=await connect(f,'staff-a');
  try {const delivered=once(staff,'driver_status_change');const before=Date.now();driver.emit('driver_status_change',{driverId:'driver-a',status:'online',name:'Forged driver',timestamp:'forged'});const [payload]=await delivered;assert.equal(payload.name,'Canonical A');assert.equal(typeof payload.timestamp,'number');assert.ok(payload.timestamp>=before);assert.equal(f.records.get('drivers/driver-a').status,'online');}
  finally {driver.close();staff.close();await f.close();}
});
test('G13 failed status persistence cannot broadcast success',{timeout:5000},async()=>{
  const f=await serverFixture(),driver=await connect(f,'driver-a'),staff=await connect(f,'staff-a');
  try {f.state.writeError=true;const events=[];staff.on('driver_status_change',p=>events.push(p));driver.emit('driver_status_change',{driverId:'driver-a',status:'offline'});await delay();assert.deepEqual(events,[]);assert.deepEqual(f.writes,[]);assert.equal(f.records.get('drivers/driver-a').status,'online');}
  finally {driver.close();staff.close();await f.close();}
});
test('G13 shipped POD notification requires canonical assignment owner',{timeout:5000},async()=>{
  const f=await serverFixture(),driver=await connect(f,'driver-a'),other=await connect(f,'driver-b'),staff=await connect(f,'staff-a');
  try {const events=[],leaks=[];staff.on('pod_updated',p=>events.push(p));other.on('pod_updated',p=>leaks.push(p));driver.emit('pod_updated',{shipmentDocId:'foreign-b',source:'driver_app'});await delay();assert.deepEqual(events,[]);const delivered=once(staff,'pod_updated');driver.emit('pod_updated',{shipmentDocId:'own-a',source:'driver_app'});assert.deepEqual((await delivered)[0],{shipmentDocId:'own-a',driverId:'driver-a',source:'driver_app'});await delay();assert.deepEqual(leaks,[]);}
  finally {driver.close();other.close();staff.close();await f.close();}
});
test('G13 shipped server disconnects revoked sessions and supports fresh authenticated reconnect',{timeout:5000},async()=>{
  const f=await serverFixture(),driver=await connect(f,'driver-a');let replacement;
  try {f.revoked.add(f.token('driver-a'));const disconnected=once(driver,'disconnect');driver.emit('heartbeat');await disconnected;const fresh='synthetic-driver-a-refreshed-token';f.tokens.set(fresh,'driver-a');replacement=clientIo(f.url,{autoConnect:false,transports:['websocket'],reconnection:false,auth:{token:fresh}});const connected=once(replacement,'connect');replacement.connect();await connected;const status=once(replacement,'driver_status_change');replacement.emit('request_driver_status',{driverId:'driver-a'});assert.equal((await status)[0].driverId,'driver-a');}
  finally {driver.close();replacement?.close();await f.close();}
});
