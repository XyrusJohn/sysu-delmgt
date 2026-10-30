// Loads the shipped server/routes with synthetic MySQL repositories and no
// outbound monitors. Only the test starts its HTTP listener, on loopback.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const http = require('node:http');
async function serverFixture() {
  const root = path.resolve(__dirname, '../..'), modules = new Map(), writes = [];
  const previousAuthBackend = process.env.AUTH_BACKEND;
  process.env.AUTH_BACKEND = 'mysql';
  const revoked = new Set(), profiles = new Map();
  const tokens = new Map();
  for (const [uid, role] of [['driver-a','driver'],['driver-b','driver'],['staff-a','fleet_manager'],['admin-a','admin'],['super-a','super_admin'],['qr-a','qr_generator']]) {
    const token = 'synthetic-' + uid + '-token-0001'; tokens.set(token,uid); profiles.set(uid,{role,status:'active'});
  }
  const records = new Map([
    ['drivers/driver-a',{name:'Canonical A',status:'online'}], ['drivers/driver-b',{name:'Canonical B',status:'online'}],
    ['sap_assignments/own-a',{driverId:'driver-a',tripStatus:'in_transit'}],
    ['sap_assignments/foreign-b',{driverId:'driver-b',tripStatus:'in_transit'}],
  ]);
  const state = {writeError:false, readError:false, locationSaveError:false};
  const authService = {authenticate: async token => {
    const uid = tokens.get(token);
    if (!uid || revoked.has(token)) return null;
    const profile = profiles.get(uid);
    return profile ? {id: uid, ...profile} : null;
  }};
  const idempotencyRows = new Map();
  const mysqlPool = {execute: async (sql, values = []) => {
    if (/INSERT INTO app_api_idempotency/.test(sql)) {
      const [service, actor, key, operation, hash, created, updated] = values;
      const id = `${service}:${actor}:${key}`;
      if (idempotencyRows.has(id)) throw Object.assign(new Error('duplicate'), {code: 'ER_DUP_ENTRY'});
      idempotencyRows.set(id, {service_name: service, actor_id: actor, request_key: key, operation_name: operation,
        request_hash: hash, state: 'processing', response_status: null, response_body: null, created_at_ms: created, updated_at_ms: updated});
      return [{affectedRows: 1}, []];
    }
    if (/SELECT request_hash/.test(sql)) {
      const row = idempotencyRows.get(`${values[0]}:${values[1]}:${values[2]}`);
      return [[row || null].filter(Boolean), []];
    }
    if (/UPDATE app_api_idempotency/.test(sql)) {
      const [status, body, updated, service, actor, key, hash] = values;
      const row = idempotencyRows.get(`${service}:${actor}:${key}`);
      if (!row || row.request_hash !== hash || row.state !== 'processing') return [{affectedRows: 0}, []];
      Object.assign(row, {state: 'completed', response_status: status, response_body: body, updated_at_ms: updated});
      return [{affectedRows: 1}, []];
    }
    return [[], []];
  }, query: async () => [[{ok: 1}], []], getConnection: async () => ({execute: async () => [[], []],
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}})};
  const assignmentService = {
    get: async id => {
      if (state.beforeDocRead) await state.beforeDocRead('sap_assignments', id);
      if (state.readError || state.readCollectionError === 'sap_assignments') throw Error('private synthetic read failure');
      return records.get(`sap_assignments/${id}`) || null;
    },
    hasActiveShipment: async uid => {
      if (state.beforeQueryRead) await state.beforeQueryRead('sap_assignments');
      if (state.readError) throw Error('private synthetic query failure');
      return [...records].some(([key, value]) => key.startsWith('sap_assignments/') && value.driverId === uid
        && value.tripStatus !== 'completed');
    },
  };
  const profileService = {
    get: async uid => {
      if (state.beforeDocRead) await state.beforeDocRead('drivers', uid);
      if (state.readError || state.readCollectionError === 'drivers') throw Error('private synthetic read failure');
      const value = records.get(`drivers/${uid}`);
      return value ? {id: uid, ...value} : null;
    },
    setStatus: async (uid, status) => {
      if (state.writeError) throw Error('private synthetic write failure');
      const value = records.get(`drivers/${uid}`);
      if (!value) return null;
      records.set(`drivers/${uid}`, {...value, status, isReturning: status === 'returning_to_base'});
      writes.push({key: `drivers/${uid}`, payload: {status}});
      return {id: uid, ...records.get(`drivers/${uid}`), name: value.name || 'Driver'};
    },
    setCapacity: async () => {}, updateRegistration: async () => null, setRequirements: async () => null,
  };
  const qrPositionReads = new Map();
  const qrService = {
    ownPosition: async (uid, queueId) => {
      const key = `${uid}:${queueId}`;
      if (qrPositionReads.has(key)) return qrPositionReads.get(key);
      const pending = Promise.resolve().then(() => readOwnPosition(uid, queueId));
      qrPositionReads.set(key, pending);
      try { return await pending; }
      finally { if (qrPositionReads.get(key) === pending) qrPositionReads.delete(key); }
    },
    listQueue: async () => [], listAll: async () => [], listOwn: async () => [],
  };
  const readOwnPosition = async (uid, queueId) => {
      if (state.beforeDocRead) await state.beforeDocRead('queue', queueId);
      if (state.readError || state.readCollectionError === 'queue') throw Error('private synthetic read failure');
      const own = records.get(`queue/${queueId}`);
      if (!own || own.driverId !== uid) throw Object.assign(Error('Queue unavailable'), {statusCode: 404});
      const entryTime = value => value?.toMillis ? value.toMillis() : Number(value || 0);
      if (own.registrationComplete !== true || own.isAssigned === true || !['waiting', 'called'].includes(own.status)
        || !['AUV', '4W', '6W', '10W', '20F', '40F'].includes(String(own.truckType).toUpperCase())) return {queueId, position: null};
      await new Promise(resolve => setImmediate(resolve));
      if (state.beforeQueryRead) await state.beforeQueryRead('queue');
      if (state.readError || state.readCollectionError === 'queue') throw Error('private synthetic query failure');
      const rows = [...records].filter(([key, row]) => key.startsWith('queue/') && ['waiting', 'called'].includes(row.status));
      if (rows.length > 2000) throw Object.assign(Error('Queue unavailable'), {statusCode: 503});
      const position = rows.filter(([key, row]) => row.registrationComplete === true && row.isAssigned !== true
        && String(row.truckType).toUpperCase() === String(own.truckType).toUpperCase()
        && (entryTime(row.entryTime) < entryTime(own.entryTime)
          || (entryTime(row.entryTime) === entryTime(own.entryTime) && key.slice('queue/'.length) <= queueId))).length;
      return {queueId, position: position || null};
  };
  let listeningServer;
  const overrides = new Map([
    [path.join(root,'config/mysql.js'),{createMySqlPool:()=>mysqlPool,loadMySqlConfig:()=>({database:'sysu_fleet_app'})}],
    [path.join(root,'services/mysqlAuthSingleton.js'),{getMysqlAuthService:()=>authService}],
    [path.join(root,'services/mysqlAssignments.js'),{getMysqlAssignments:()=>assignmentService}],
    [path.join(root,'services/mysqlDriverProfiles.js'),{getMysqlDriverProfiles:()=>profileService}],
    [path.join(root,'services/mysqlQrService.js'),{getMysqlQrService:()=>qrService}],
    [path.join(root,'services/mysqlLiveLocations.js'),{createMysqlLiveLocations:()=>({list:async()=>[],save:async location=>{
      if (state.locationSaveError) throw Error('private synthetic location write failure');
      state.savedLocation = {...location};
    }})}],
    [path.join(root,'services/mysqlMasterData.js'),{createMysqlMasterData:()=>({}),getMysqlMasterData:()=>({}),masterDataEvents:{}}],
    [path.join(root,'services/mysqlDriverActionAudit.js'),{createMysqlDriverActionAudit:()=>({bind(){}})}],
    [path.join(root,'services/mysqlSettings.js'),{createMysqlSettings:()=>({get:async()=>null,set:async(_id,value)=>value})}],
    [path.join(root,'utils/heartbeatMonitor.js'),{startHeartbeat(){}}],
    [path.join(root,'utils/presenceWatcher.js'),{startPresenceWatcher(){}}],
  ]);
  function load(filename) {
    if(overrides.has(filename)) return overrides.get(filename);
    if(modules.has(filename)) return modules.get(filename).exports;
    const module = new Module(filename); module.filename=filename; modules.set(filename,module);
    const normalRequire=Module.createRequire(filename);
    module.require=specifier=>{
      if(specifier==='dotenv') return {config(){}};
      if(specifier==='http' && filename===path.join(root,'server.js')) return {...http,createServer:app=>{
        listeningServer=http.createServer(app); listeningServer.listen=()=>listeningServer; return listeningServer;
      }};
      if(specifier.startsWith('.')) return load(normalRequire.resolve(specifier));
      return normalRequire(specifier);
    };
    const extra = filename===path.join(root,'server.js')?'\nmodule.exports={app,server,io};':'';
    module._compile(fs.readFileSync(filename,'utf8')+extra,filename); return module.exports;
  }
  const {app,server,io}=load(path.join(root,'server.js'));
  server.listen=http.Server.prototype.listen;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {app,server,io,url:'http://127.0.0.1:'+server.address().port,records,profiles,revoked,tokens,writes,state,
    token:uid=>[...tokens].find(([,value])=>value===uid)[0],
    close:()=>new Promise(resolve=>io.close(() => {
      if (previousAuthBackend === undefined) delete process.env.AUTH_BACKEND;
      else process.env.AUTH_BACKEND = previousAuthBackend;
      resolve();
    }))};
}
module.exports={serverFixture};
