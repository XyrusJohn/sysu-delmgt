const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const rateLimit=require('express-rate-limit');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {once}=require('node:events');
const serverPath=require.resolve('../../src/server');
const source=fs.readFileSync(serverPath,'utf8');
const corsRegistration = 'app.use(require("./middleware/corsPolicy")(allowedOrigins));';
const corsSource = source.slice(source.indexOf('const allowedOrigins ='), source.indexOf(corsRegistration) + corsRegistration.length);
const middleware=source.slice(source.indexOf('app.set("trust proxy"'),source.indexOf('app.use(express.json'));
const origin='https://staging.example.invalid';

async function fixture(t){
  const app=express();
  vm.runInNewContext(corsSource,{app,require:createRequire(serverPath),runtimeConfig:{allowedOrigins:[origin]}});
  vm.runInNewContext(middleware,{app,rateLimit,require:createRequire(serverPath),runtimeConfig:{
    trustProxy:0,rateWindowMs:900000,globalLimit:1,authLimit:1,adminLimit:1,allowedOrigins:[origin]
  }});
  app.get('/api/test-budget',(req,res)=>res.json({success:true}));
  app.get('/api/qr/generate',(req,res)=>res.json({success:true}));
  app.get('/api/qr/queue-display',(req,res)=>res.json({success:true,data:{queues:{AUV:[]}}}));
  app.get('/api/qr/queue-cards',(req,res)=>res.status(401).json({message:'Authentication required'}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return async(path,method='GET')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{
    method,headers:{Origin:origin,...(method==='OPTIONS'?{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}:{})}
  });
}

test('W-07 allowed preflights do not spend the business API quota',async t=>{
  const request=await fixture(t);
  for(let n=0;n<3;n++){
    const response=await request('/api/qr/queue-cards','OPTIONS');
    assert.equal(response.status,204);
    assert.equal(response.headers.get('access-control-allow-origin'),origin);
  }
  assert.equal((await request('/api/qr/generate')).status,200);
});

test('W-07 rate-limit rejections retain exact-origin CORS headers',async t=>{
  const request=await fixture(t);
  assert.equal((await request('/api/test-budget')).status,200);
  const limited=await request('/api/test-budget');
  assert.equal(limited.status,429);
  assert.equal(limited.headers.get('access-control-allow-origin'),origin);
  assert.ok(limited.headers.get('retry-after'));
});

test('W-07 exhausted business quota does not break queue polling or remove authentication',async t=>{
  const request=await fixture(t);
  assert.equal((await request('/api/test-budget')).status,200);
  for(let n=0;n<3;n++)assert.equal((await request('/api/qr/queue-display')).status,200);
  const privateCards=await request('/api/qr/queue-cards');
  assert.equal(privateCards.status,401);
  assert.equal(privateCards.headers.get('access-control-allow-origin'),origin);
  assert.equal((await request('/api/test-budget')).status,429);
});

test('W-07 queue polling remains bounded without spending the QR generation quota',async t=>{
  const request=await fixture(t);
  for(let n=0;n<120;n++){
    const response=await request('/api/qr/queue-display');
    assert.equal(response.status,200);
    await response.text();
  }
  const limited=await request('/api/qr/queue-display');
  assert.equal(limited.status,429);
  assert.equal(limited.headers.get('access-control-allow-origin'),origin);
  assert.equal((await request('/api/qr/generate')).status,200);
  const preflight=await request('/api/qr/queue-cards','OPTIONS');
  assert.equal(preflight.status,204);
});
