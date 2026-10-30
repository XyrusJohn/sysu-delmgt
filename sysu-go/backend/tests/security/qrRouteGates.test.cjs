const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const routes=new Map();let protectedCalls=0;
const auth=(req,res,next)=>{protectedCalls++;if(!req.user)return res.status(401).json({success:false});return next();};
const result=res=>res.status(200).json({success:true});
const filename=path.resolve(__dirname,'../../routes/qrRoutes.js'),mod=new Module(filename);mod.filename=filename;mod.require=name=>{if(name==='express')return {Router:()=>({post:(url,...handlers)=>routes.set('POST '+url,handlers),get:(url,...handlers)=>routes.set('GET '+url,handlers),patch:(url,...handlers)=>routes.set('PATCH '+url,handlers)})};if(name==='../middleware/auth.js')return {verifyToken:auth};if(name==='../controller/qrController.js')return {generateQR:(_req,res)=>result(res),scanQR:(_req,res)=>result(res),getQueue:(_req,res)=>result(res),verifyQR:(_req,res)=>result(res),updateQueueStatus:(_req,res)=>result(res),cancelQueue:(_req,res)=>result(res)};throw Error('Unexpected import '+name);};mod._compile(fs.readFileSync(filename,'utf8'),filename);
async function run(route,role){const req={user:role?{uid:'synthetic'}:undefined,userProfile:role?{role,status:'active'}:undefined},res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};let i=0;const handlers=routes.get(route);const next=()=>i<handlers.length?handlers[i++](req,res,next):undefined;await next();return res;}
for(const route of ['POST /generate','POST /scan','POST /queue/:queueId/cancel','GET /queue','PATCH /queue-status'])test(route+' always rejects anonymous requests',async()=>assert.equal((await run(route)).code,401));
for(const route of ['POST /generate','GET /queue','PATCH /queue-status'])test(route+' driver cannot use staff operation',async()=>assert.equal((await run(route,'driver')).code,403));
test('active driver scan allowed',async()=>assert.equal((await run('POST /scan','driver')).code,200));
test('active driver may request own-queue cancellation',async()=>assert.equal((await run('POST /queue/:queueId/cancel','driver')).code,200));
test('staff cannot scan as driver',async()=>assert.equal((await run('POST /scan','fleet_manager')).code,403));
test('QR generator can mint',async()=>assert.equal((await run('POST /generate','qr_generator')).code,200));
test('read-only token verification remains accessible',async()=>assert.equal((await run('GET /verify')).code,200));
