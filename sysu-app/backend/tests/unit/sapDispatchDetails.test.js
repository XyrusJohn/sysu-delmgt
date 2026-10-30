const test=require('node:test');
const assert=require('node:assert/strict');

const assignmentsPath=require.resolve('../../src/services/mysqlAssignments');
const sapSourcePath=require.resolve('../../src/services/sapSource');
const controllerPath=require.resolve('../../src/controllers/sapController');
const assignment={lineItems:[{obdNumber:'obd-allowed'}]};
require.cache[assignmentsPath]={id:assignmentsPath,filename:assignmentsPath,loaded:true,exports:{getMysqlAssignments:()=>({
  get:async key=>key==='dispatch-a'?assignment:null,
})}};
require.cache[sapSourcePath]={id:sapSourcePath,filename:sapSourcePath,loaded:true,exports:{
  read:async()=>({rows:[],detailRows:[]}),
  readDispatchDetails:async keys=>Object.fromEntries(keys.map(key=>[key,[
    {OBDNumber:'obd-allowed',Amount:100},
    {OBDNumber:'obd-not-on-assignment',Amount:999},
  ]]))},
};
delete require.cache[controllerPath];
const {getAssignedDispatchDetails}=require('../../src/controllers/sapController');

function invoke(body) {
  return new Promise((resolve,reject)=>{
    const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this;},set(name,value){this.headers[name]=value;return this;},json(payload){resolve({status:this.statusCode,headers:this.headers,body:payload});}};
    Promise.resolve(getAssignedDispatchDetails({body},res)).catch(reject);
  });
}

test('dispatch detail projection only returns OBD rows belonging to existing assignments',async()=>{
  const result=await invoke({dispatchKeys:['dispatch-a','missing','dispatch-a']});
  assert.equal(result.status,200);
  assert.equal(result.headers['Cache-Control'],'no-store');
  assert.deepEqual(result.body.data['dispatch-a'],[{OBDNumber:'obd-allowed',Amount:100}]);
  assert.equal(Object.hasOwn(result.body.data,'missing'),false);
});

test('dispatch detail projection bounds and validates the requested dispatch list',async()=>{
  assert.equal((await invoke({dispatchKeys:[]})).status,400);
  assert.equal((await invoke({dispatchKeys:Array.from({length:101},(_,index)=>`dispatch-${index}`)})).status,400);
  assert.equal((await invoke({dispatchKeys:['../other']})).status,400);
});
test.after(()=>{delete require.cache[assignmentsPath];delete require.cache[sapSourcePath];delete require.cache[controllerPath];});
