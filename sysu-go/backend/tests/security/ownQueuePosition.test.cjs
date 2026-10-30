const {test} = require('node:test');
const assert = require('node:assert/strict');
const {serverFixture} = require('../helpers/serverFixture.cjs');
const stamp = value => ({toMillis: () => value});
async function setup() {
  const fixture = await serverFixture();
  for (const [id,driverId,time,extra] of [
    ['ahead-one','driver-b',1,{}],['ahead-two','driver-b',2,{}],['own','driver-a',3,{}],
    ['unregistered','driver-b',0,{registrationComplete:false}],
    ['already-assigned','driver-b',0,{isAssigned:true}],['other-truck','driver-b',0,{truckType:'6W'}],
  ]) fixture.records.set('queue/'+id,{driverId,truckType:'AUV',status:'waiting',registrationComplete:true,
    isAssigned:false,entryTime:stamp(time),...extra});
  return fixture;
}
async function request(fixture, uid='driver-a', queue='own') {
  return fetch(fixture.url+'/api/qr/own-position?queueId='+queue,
    {headers:uid?{Authorization:'Bearer '+fixture.token(uid)}:{}});
}
test('Own position advances 3 to 2 to 1 and excludes unregistered/assigned/other groups',async()=>{
  const fixture=await setup();try {
    for(const [expected,advance] of [[3,null],[2,'ahead-one'],[1,'ahead-two']]){
      if(advance)fixture.records.set('queue/'+advance,{...fixture.records.get('queue/'+advance),status:'assigned',isAssigned:true});
      let body;const deadline=Date.now()+2500;
      do {
        const response=await request(fixture);assert.equal(response.status,200);body=await response.json();
        if(body.position===expected)break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }while(Date.now()<deadline);
      assert.deepEqual(body,{success:true,queueId:'own',position:expected});
    }
  }finally{await fixture.close();}
});
test('Own position coalesces concurrent group reads without sharing private response data',async()=>{
  const fixture=await setup();try{
    let reads=0;fixture.state.beforeQueryRead=async collection=>{if(collection==='queue')reads++;};
    const responses=await Promise.all(Array.from({length:12},()=>request(fixture)));
    for(const response of responses){assert.equal(response.status,200);assert.equal((await response.json()).position,3);}
    assert.equal(reads,1);
  }finally{await fixture.close();}
});
test('Own position validates references and uses canonical document IDs',async()=>{
  const fixture=await setup();try{
    fixture.records.get('queue/own').id='forged';
    assert.equal((await (await request(fixture)).json()).position,3);
    for(const id of ['','..','a%2Fb','own&queueId=a'])assert.equal((await request(fixture,'driver-a',id)).status,400);
    assert.equal((await request(fixture,'driver-a','missing')).status,404);
  }finally{await fixture.close();}
});
test('Own position limits repeated authenticated reads without removing normal polling',async()=>{
  const fixture=await setup();try{
    for(let batch=0;batch<10;batch++){
      const responses=await Promise.all(Array.from({length:12},()=>request(fixture)));
      assert.ok(responses.every(response=>response.status===200));
      await Promise.all(responses.map(response=>response.arrayBuffer()));
    }
    assert.equal((await request(fixture)).status,429);
  }finally{await fixture.close();}
});
test('Own position does not disclose another drivers identifiers/details',async()=>{
  const fixture=await setup();try {
    const response=await request(fixture);assert.equal(response.status,200);
    const body=await response.text();assert.ok(!body.includes('driver-b'));assert.ok(!body.includes('ahead-one'));
    assert.equal((await request(fixture,'driver-a','ahead-one')).status,404);
  }finally{await fixture.close();}
});
test('Own position rejects anonymous, staff, pending and revoked identities',async()=>{
  const fixture=await setup();try{
    assert.equal((await request(fixture,null)).status,401);
    assert.equal((await request(fixture,'staff-a')).status,403);
    fixture.profiles.get('driver-a').status='pending';assert.equal((await request(fixture)).status,403);
    fixture.profiles.get('driver-a').status='active';fixture.revoked.add(fixture.token('driver-a'));
    assert.equal((await request(fixture)).status,401);
  }finally{await fixture.close();}
});
test('Own position unavailable state never invents number one or exposes read failures',async()=>{
  const fixture=await setup();try{
    fixture.records.get('queue/own').registrationComplete=false;
    const response=await request(fixture);assert.equal(response.status,200);assert.equal((await response.json()).position,null);
    fixture.state.readError=true;const failed=await request(fixture);assert.ok([401,403,500,503].includes(failed.status));
    assert.ok(!(await failed.text()).includes('private synthetic'));
  }finally{await fixture.close();}
});
test('Own position fails closed on truncated queues instead of reporting a wrong rank',async()=>{
  const fixture=await setup();try{
    for(let number=0;number<2001;number++)fixture.records.set('queue/extra-'+number,
      {driverId:'driver-b',truckType:'AUV',status:'waiting',registrationComplete:true,entryTime:stamp(number+5)});
    const response=await request(fixture);assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{success:false,message:'Queue unavailable'});
  }finally{await fixture.close();}
});
test('Own position retries a failed coalesced read without caching a fabricated result',async()=>{
  const fixture=await setup();try{
    let reads=0;fixture.state.beforeQueryRead=async collection=>{if(collection==='queue'&&reads++===0)throw Error('private failed read');};
    assert.equal((await request(fixture)).status,503);
    const recovered=await request(fixture);assert.equal(recovered.status,200);assert.equal((await recovered.json()).position,3);
    assert.equal(reads,2);
  }finally{await fixture.close();}
});
