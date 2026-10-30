const test=require('node:test');
const assert=require('node:assert/strict');
const base={SAPDispatchNumber:'dispatch-a',OBDNumber:'000001',OBDItem:'001',Quantity:'10.500',ShipToPartyName:'Synthetic',
  ShipToParty:'synthetic-customer',Address:'Synthetic address',TruckType:'4W',Driver:'',Delivery:'',PgiStatus:'X'};
function load(get) {
  const axiosPath=require.resolve('axios');
  require.cache[axiosPath]={id:axiosPath,filename:axiosPath,loaded:true,exports:{get}};
  for (const file of ['../../src/controllers/sapController','../../src/services/sapSource']) {
    try {delete require.cache[require.resolve(file)];} catch { /* Service does not exist in RED baseline. */ }
  }
  return require('../../src/controllers/sapController').getSapData;
}
function invoke(handler) {
  return new Promise((resolve,reject)=>{
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){resolve({status:this.statusCode,body});}};
    Promise.resolve(handler({},res,reject)).catch(reject);
  });
}
function rows(result) {return result.body.data?.d?.results || result.body.data?.results || result.body.data;}
let previousUrl;
test.before(()=>{previousUrl=process.env.SAP_URL;process.env.SAP_URL='https://sap.example.invalid';});
test.after(()=>{if(previousUrl===undefined)delete process.env.SAP_URL;else process.env.SAP_URL=previousUrl;});
test('SAP contract excludes assigned, delivered, unpicked, unsupported, missing dispatch and FOR RE-SO rows',async()=>{
  const excluded=[{Driver:'Real Driver'},{Delivery:'DELIVERED'},{PgiStatus:''},{TruckType:'LCL'},{SAPDispatchNumber:''},{Driver:'FOR RE-SO'}];
  const handler=load(async()=>({data:{d:{results:[base,...excluded.map(patch=>({...base,...patch}))]}}}));
  const result=await invoke(handler);
  assert.equal(result.status,200);assert.equal(rows(result).length,1);
});
test('SAP contract keeps allowed placeholders, six normalized truck types and all OBD rows within one dispatch',async()=>{
  const accepted=['AUV','4W','6W','10W','20F','40F'].map((TruckType,n)=>({...base,TruckType:` ${TruckType.toLowerCase()} `,Driver:['','-','*-*',' Driver ','','-'][n],OBDNumber:`00000${n}`}));
  const handler=load(async()=>({data:{d:{results:[...accepted,{...base,Driver:'FOR RE-SO'}]}}}));
  const result=await invoke(handler);
  assert.equal(rows(result).length,6);
  assert.deepEqual(rows(result).map(row=>row.OBDNumber),accepted.map(row=>row.OBDNumber));
  assert.ok(rows(result).every(row=>row.SAPDispatchNumber==='dispatch-a'));
});
test('assigned dispatch projection exposes only scoped OBD fields while shipment feed remains unassigned-only',async()=>{
  const assigned={...base,Driver:'Synthetic Driver',Delivery:'IN TRANSIT',Route:'Route A',PlanningDate:'2026-10-17',ActualDelDate:'2026-10-18',Amount:'123.45',Volume:'2.5',Weight:'12',Latitude:0,Longitude:'121.5',InternalNote:'not projected'};
  const handler=load(async()=>({data:{d:{results:[assigned,base]}}}));
  const feed=await invoke(handler);
  assert.equal(rows(feed).length,1);
  const service=require('../../src/services/sapSource');
  const details=await service.readDispatchDetails(['dispatch-a','missing']);
  assert.equal(details['dispatch-a'].length,2);
  assert.equal(details['dispatch-a'][0].Amount,'123.45');
  assert.equal(details['dispatch-a'][0].Latitude,0);
  assert.equal(details['dispatch-a'][0].InternalNote,undefined);
  assert.deepEqual(details.missing,[]);
});
test('temporary review dispatch is returned even when SAP has a driver and missing truck type',async()=>{
  const review={...base,SAPDispatchNumber:'0010139586',TruckType:'',Driver:'F. PAANO',PlateNumber:'NLC 1406',ShipmentStart:'PT11H41M00S'};
  const result=await invoke(load(async()=>({data:{d:{results:[review]}}})));
  assert.equal(result.status,200);
  assert.equal(rows(result).length,1);
  assert.equal(rows(result)[0].SAPDispatchNumber,'0010139586');
});
test('SAP cache miss coalesces concurrent requests into one bounded upstream fetch',async()=>{
  let calls=0,release,options;
  const pending=new Promise(resolve=>{release=resolve;});
  const handler=load(async(_url,config)=>{calls++;options=config;await pending;return {data:{d:{results:[base]}}};});
  const requests=Array.from({length:6},()=>invoke(handler));
  release();await Promise.all(requests);
  assert.equal(calls,1);
  assert.ok(options.timeout<=20000);assert.ok(options.maxContentLength<=50*1024*1024);
});
test('SAP malformed payload fails closed instead of returning assignable data',async()=>{
  const result=await invoke(load(async()=>({data:{unexpected:'not a shipment array'}})));
  assert.equal(result.status,503);assert.equal(result.body.success,false);
});
test('SAP failure logs do not disclose upstream URLs or credentials and a retry can recover',async()=>{
  let fail=true;
  const handler=load(async()=>{if(fail)throw new Error('https://private.example/secret?token=SENSITIVE');return {data:{d:{results:[base]}}};});
  const original=console.error,logs=[];console.error=(...args)=>logs.push(args.join(' '));
  try {
    assert.equal((await invoke(handler)).status,503);
    fail=false;assert.equal((await invoke(handler)).status,200);
  } finally {console.error=original;}
  assert.equal(logs.join(' ').includes('SENSITIVE'),false);
  assert.equal(logs.join(' ').includes('private.example'),false);
});
