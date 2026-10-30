const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {randomUUID} = require('node:crypto');
process.env.AUTH_BACKEND = 'mysql';
const profiles = {
  driver: {role: 'driver', status: 'active'}, pending: {role: 'pending', status: 'inactive'},
  inactive: {role: 'fleet_manager', status: 'inactive'}, staff: {role: 'fleet_manager', status: 'active'},
  admin: {role: 'admin', status: 'active'}, superadmin: {role: 'super_admin', status: 'active'},
};
let capacityWrites = 0;
const authPath = require.resolve('../../src/services/mysqlAuthSingleton');
require.cache[authPath] = {id:authPath,filename:authPath,loaded:true,exports:{getMysqlAuthService:()=>({
  authenticate: async token => profiles[token] ? {id:token, username:token, displayName:'Synthetic', ...profiles[token]} : null,
})}};
const qrServicePath = require.resolve('../../src/services/mysqlQrService');
require.cache[qrServicePath] = {id:qrServicePath,filename:qrServicePath,loaded:true,exports:{getMysqlQrService:()=>({
  scan: async () => ({queueId:'synthetic-queue'}),
})}};
const driverProfilesPath = require.resolve('../../src/services/mysqlDriverProfiles');
require.cache[driverProfilesPath] = {id:driverProfilesPath,filename:driverProfilesPath,loaded:true,exports:{
  getMysqlDriverProfiles: () => ({
    get: async driverId => ({id:driverId,driverId,name:'Synthetic',phone:'',license:'',truckType:'truck',plateNumber:'TEST',
      truckingCompany:'Synthetic',helper:'',notes:'',requirements:{},isFull:false,status:'active'}),
    setCapacity: async () => {capacityWrites++;},
  }),
}};
const mysqlQrPath = require.resolve('../../src/services/mysqlQrService');
require.cache[mysqlQrPath] = {id:mysqlQrPath,filename:mysqlQrPath,loaded:true,exports:{
  getMysqlQrService: () => ({scan: async () => ({queueId:'synthetic-queue'})}),
}};
const diagnosticsControllerPath = require.resolve('../../src/controllers/systemDiagnosticsController');
const diagnosticDeletionReached = [];
const diagnosticRecoveryReached = [];
const mobileRunDeletionReached = [];
require.cache[diagnosticsControllerPath] = {id:diagnosticsControllerPath,filename:diagnosticsControllerPath,loaded:true,exports:{
  reportClientError: (req,res) => res.json({reachedBusinessHandler:true}),
  listSystemErrors: (req,res) => res.json({reachedBusinessHandler:true}),
  listMobileDiagnosticRuns: (req,res) => res.json({reachedBusinessHandler:true}),
  deleteMobileDiagnosticRun: (req,res) => {mobileRunDeletionReached.push(req.user.role); res.json({reachedBusinessHandler:true});},
  resolveSystemError: (req,res) => res.json({reachedBusinessHandler:true}),
  recoverSystemError: (req,res) => {diagnosticRecoveryReached.push([req.user.uid, req.body]); res.json({success:true,resolved:1});},
  deleteResolvedSystemError: (req,res) => {diagnosticDeletionReached.push(req.user.role); res.json({reachedBusinessHandler:true});},
}};
// Isolate business handlers: this test proves the real route/middleware boundary,
// independent of unrelated assignment and SAP I/O failures.
const ctrlPath = require.resolve('../../src/controllers/sapAssignmentController');
const handler = (req, res) => res.json({ reachedBusinessHandler: true });
require.cache[ctrlPath] = { id: ctrlPath, filename: ctrlPath, loaded: true, exports: Object.fromEntries([
  'peekEarliest','getAssignment','getDispatchRequest','assignDriver','requestOverride','decideOverride','revokeOverride',
  'requestCancelAssignment','decideCancelAssignment','revokeCancelAssignment','getActiveDriverLocations',
].map(name => [name, handler])) };
const sapControllerPath = require.resolve('../../src/controllers/sapController');
require.cache[sapControllerPath] = {id:sapControllerPath,filename:sapControllerPath,loaded:true,exports:{getSapData:handler,getAssignedDispatchDetails:handler}};
const app = express();
app.use(express.json());
const idempotencyPath = require.resolve('../../src/middleware/idempotency');
require.cache[idempotencyPath] = {
  id: idempotencyPath,
  filename: idempotencyPath,
  loaded: true,
  exports: {idempotency: (req, res, next) => {
    if (req.path === '/logs/recover-operation')
      return res.status(503).json({success: false, code: 'IDEMPOTENCY_STORE_UNAVAILABLE'});
    return next();
  }},
};
app.use('/api/sap', require('../../src/routes/sapAssignmentRoute'));
app.use('/api/sap', require('../../src/routes/sapRoute'));
app.use('/api/drivers', require('../../src/routes/driverRoute'));
app.use('/api/qr', require('../../src/routes/qrRoute'));
app.use('/api/system-errors', require('../../src/routes/systemDiagnosticsRoute'));
const deletionReached = [];
const guardControllerPath = require.resolve('../../src/controllers/admin/guardController');
const truckCompanyControllerPath = require.resolve('../../src/controllers/admin/truckCompanyController');
const deleteHandler = kind => (req, res) => { deletionReached.push(kind); res.json({reachedBusinessHandler:true}); };
require.cache[guardControllerPath] = {id:guardControllerPath,filename:guardControllerPath,loaded:true,exports:{
  createGuard: deleteHandler('createGuard'), updateGuard: deleteHandler('updateGuard'), setGuardActive: deleteHandler('setGuardActive'), deleteGuard: deleteHandler('guard'),
}};
require.cache[truckCompanyControllerPath] = {id:truckCompanyControllerPath,filename:truckCompanyControllerPath,loaded:true,exports:{
  createTruckCompany: deleteHandler('createTruckCompany'), updateTruckCompany: deleteHandler('updateTruckCompany'), setTruckCompanyActive: deleteHandler('setTruckCompanyActive'), deleteTruckCompany: deleteHandler('truckCompany'),
}};
app.use('/api/admin', require('../../src/routes/adminRoute'));
let server, url;
function apiFetch(input, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return fetch(input, options);
  const headers = new Headers(options.headers || {});
  headers.set('Idempotency-Key', randomUUID());
  return fetch(input, {...options, headers});
}
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
for (const actor of ['driver', 'pending', 'inactive']) {
  test(`R09: ${actor} cannot access dispatch operations`, async () => {
    for (const [method, route, body] of [['GET','peek'], ['POST','assign'], ['GET','locations'], ['POST','overrides/request'], ['POST','cancel/request'], ['GET','shipments'], ['POST','dispatch-details',JSON.stringify({dispatchKeys:['dispatch-a']})]]) {
      const response = await apiFetch(`${url}/api/sap/${route}`, { method, headers: { Authorization: `Bearer ${actor}`, ...(body ? {'Content-Type':'application/json'} : {}) }, body });
      assert.equal(response.status, 403, `${actor}: ${method} ${route}`);
    }
  });
}
test('R09: active staff can access the dispatch boundary', async () => {
  const response = await apiFetch(`${url}/api/sap/peek`, { headers: { Authorization: 'Bearer staff' } });
  assert.equal(response.status, 200);
  const details = await apiFetch(`${url}/api/sap/dispatch-details`, {method:'POST',headers:{Authorization:'Bearer staff','Content-Type':'application/json'},body:JSON.stringify({dispatchKeys:['dispatch-a']})});
  assert.equal(details.status,200);
});
test('R02: driver document endpoint requires authentication', async () => {
  const response = await fetch(`${url}/api/drivers/driver`);
  assert.equal(response.status, 401);
});
test('R02: own driver response excludes unapproved fields', async () => {
  const response = await fetch(`${url}/api/drivers/driver`, {headers:{Authorization:'Bearer driver'}});
  assert.equal(response.status,200);
  assert.equal((await response.json()).data.privateNote,undefined);
});
test('R02: driver cannot read another driver document', async () => {
  const response = await fetch(`${url}/api/drivers/staff`, {headers:{Authorization:'Bearer driver'}});
  assert.equal(response.status,403);
});

test('R10: driver cannot change another driver capacity', async () => {
  capacityWrites = 0;
  const response = await apiFetch(`${url}/api/drivers/staff/full`, {
    method: 'PATCH', headers: {Authorization: 'Bearer driver', 'Content-Type': 'application/json'},
    body: JSON.stringify({isFull: true}),
  });
  assert.equal(response.status, 403);
  assert.equal(capacityWrites, 0);
});

test('R12: only admin and super_admin can reach master-record deletion routes',async()=>{
  deletionReached.length=0;
  for (const role of ['driver','pending','inactive','staff']) {
    for (const path of ['/api/admin/guards/SG-001','/api/admin/truck-companies/01']) {
      const response=await apiFetch(`${url}${path}`,{method:'DELETE',headers:{Authorization:`Bearer ${role}`}});
      assert.equal(response.status,403,`${role} ${path}`);
    }
  }
  assert.equal(deletionReached.length,0);
  for (const role of ['admin','superadmin']) {
    for (const path of ['/api/admin/guards/SG-001','/api/admin/truck-companies/01']) {
      const response=await apiFetch(`${url}${path}`,{method:'DELETE',headers:{Authorization:`Bearer ${role}`}});
      assert.equal(response.status,200,`${role} ${path}`);
    }
  }
  assert.deepEqual(deletionReached,['guard','truckCompany','guard','truckCompany']);
});
test('system diagnostics deletion is admin-only', async () => {
  diagnosticDeletionReached.length = 0;
  for (const role of ['driver','pending','inactive','staff']) {
    const response = await apiFetch(`${url}/api/system-errors/logs/17`, {method:'DELETE',headers:{Authorization:`Bearer ${role}`}});
    assert.equal(response.status,403,role);
  }
  assert.deepEqual(diagnosticDeletionReached,[]);
  for (const role of ['admin','superadmin']) {
    const response = await apiFetch(`${url}/api/system-errors/logs/17`, {method:'DELETE',headers:{Authorization:`Bearer ${role}`}});
    assert.equal(response.status,200,role);
  }
  assert.deepEqual(diagnosticDeletionReached,['admin','super_admin']);
});
test('mobile diagnostic run deletion is admin-only', async () => {
  mobileRunDeletionReached.length = 0;
  for (const role of ['driver','pending','inactive','staff']) {
    const response = await apiFetch(`${url}/api/system-errors/diagnostic-runs/22`, {method:'DELETE',headers:{Authorization:`Bearer ${role}`}});
    assert.equal(response.status,403,role);
  }
  assert.deepEqual(mobileRunDeletionReached,[]);
  for (const role of ['admin','superadmin']) {
    const response = await apiFetch(`${url}/api/system-errors/diagnostic-runs/22`, {method:'DELETE',headers:{Authorization:`Bearer ${role}`}});
    assert.equal(response.status,200,role);
  }
  assert.deepEqual(mobileRunDeletionReached,['admin','super_admin']);
});
test('diagnostic auto-recovery requires an active reporter account', async () => {
  diagnosticRecoveryReached.length = 0;
  for (const role of ['pending','inactive']) {
    const response = await apiFetch(`${url}/api/system-errors/logs/recover-operation`, {method:'POST',
      headers:{Authorization:`Bearer ${role}`,'Content-Type':'application/json'},
      body:JSON.stringify({eventCode:'frontend_operation_failure',operation:'sap-sync'})});
    assert.equal(response.status,403,role);
  }
  assert.deepEqual(diagnosticRecoveryReached,[]);
  const response = await apiFetch(`${url}/api/system-errors/logs/recover-operation`, {method:'POST',
    headers:{Authorization:'Bearer driver','Content-Type':'application/json'},
    body:JSON.stringify({eventCode:'frontend_operation_failure',operation:'sap-sync'})});
  assert.equal(response.status,200);
  assert.deepEqual(diagnosticRecoveryReached,[['driver',{eventCode:'frontend_operation_failure',operation:'sap-sync'}]]);
});
test('R11 regression: active driver HTTP scan receives its authorized profile',async()=>{
  const response=await apiFetch(`${url}/api/qr/scan`,{method:'POST',headers:{Authorization:'Bearer driver','Content-Type':'application/json'},
    body:JSON.stringify({token:'synthetic',driverId:'driver',truckType:'truck',plateNumber:'TEST'})});
  assert.equal(response.status,200);
});
test('R22: revoked HTTP token is rejected even when profile remains active',async()=>{
  const response=await fetch(`${url}/api/drivers/staff`,{headers:{Authorization:'Bearer revoked'}});
  assert.equal(response.status,401);
});
