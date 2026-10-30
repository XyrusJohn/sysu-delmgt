const test=require('node:test');const assert=require('node:assert/strict');
function session(verify) {
  const timers=new Map();let next=0;let disconnects=0;let cleanup;
  const clock={setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
  const socket={data:{uid:'driver-a'},once(event,fn){assert.equal(event,'disconnect');cleanup=fn;},disconnect(){disconnects++;cleanup?.();}};
  require('../../src/services/socketSession').watchSocketSession(socket,'synthetic-token',verify,clock);
  return {timers,get disconnects(){return disconnects;},cleanup:()=>cleanup(),async tick(delay){const [id,timer]=[...timers].find(([,t])=>t.delay===delay)||[];assert.ok(timer,`Missing ${delay}ms timer`);timers.delete(id);await timer.fn();await new Promise(r=>setImmediate(r));}};
}
for(const reason of ['auth/id-token-revoked','auth/user-disabled','auth/user-not-found','auth/internal-error'])test(`R22 established socket disconnects on ${reason} without profile change`,async()=>{
  const s=session(async()=>{throw Object.assign(new Error('Synthetic auth failure'),{code:reason});});await s.tick(30000);assert.equal(s.disconnects,1);assert.equal(s.timers.size,0);
});
test('R22 valid session rechecks revocation and cleans timers on disconnect',async()=>{let calls=0;const s=session(async token=>{assert.equal(token,'synthetic-token');calls++;return {uid:'driver-a',exp:Math.floor(Date.now()/1000)+3600};});await s.tick(30000);assert.equal(calls,1);assert.equal(s.disconnects,0);assert.equal(s.timers.size,1);s.cleanup();assert.equal(s.timers.size,0);});
test('R22 expired or changed token identity disconnects',async()=>{for(const decoded of [{uid:'driver-b',exp:Date.now()/1000+3600},{uid:'driver-a',exp:0}]){const s=session(async()=>decoded);await s.tick(30000);assert.equal(s.disconnects,1);}});
test('R22 hung Auth verification fails closed within five seconds',async()=>{const s=session(()=>new Promise(()=>{}));await s.tick(30000);await s.tick(5000);assert.equal(s.disconnects,1);assert.equal(s.timers.size,0);});
test('R22 resolved verification after disconnect cannot create another timer',async()=>{let resolve;const s=session(()=>new Promise(r=>{resolve=r;}));await s.tick(30000);s.cleanup();resolve({uid:'driver-a',exp:Date.now()/1000+3600});await new Promise(r=>setImmediate(r));assert.equal(s.timers.size,0);});
