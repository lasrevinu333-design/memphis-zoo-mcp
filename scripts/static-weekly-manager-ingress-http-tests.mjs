import assert from 'node:assert/strict';
import http from 'node:http';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';

const env={NODE_ENV:'test',SUPABASE_URL:'https://manager-ingress-test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-role',
 OPS_MANAGER_SESSION_SECRET:'manager-ingress-test-only-secret-0123456789'};
const manager={manager_id:'10000000-0000-4000-8000-000000000091',display_name:'Synthetic Manager',roles:['OPS_MANAGER'],active:true};
const credentialId='ingress-credential',deviceId='ingress-device';
const token=createOpsManagerSession({credentialId,deviceId,manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env}).token;
const trustedRow=()=>({credential_id:credentialId,device_id:deviceId,max_access_level:'full_access',manager_id:manager.manager_id,manager,
 created_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60_000).toISOString(),revoked_at:null});
const body=JSON.stringify({effective_start:'2026-10-05',expected_revision:1});
let checks=0;
const same=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
function clock(){let now=1,timer=null,starts=0;return{now:()=>now,setTimer:(callback,delay)=>{starts++;timer={callback,delay};return timer;},
 clearTimer:candidate=>{if(timer===candidate)timer=null;},get timer(){return timer;},elapse:milliseconds=>{now+=milliseconds;},
 get starts(){return starts;},
 expire(){assert.ok(timer,'request timer must have started');now+=55_000;timer.callback();}};}
async function until(predicate){for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(predicate(),'expected route stage was not reached');}
async function fixture({rpc,find,confirm}){
 const timer=clock(),calls=[],plane={async previewRecurringStaffing(input){calls.push({kind:'preview',input});return{status:'CANDIDATE_ONLY'};},
  async confirmRecurringStaffing(input){calls.push({kind:'confirm',input});return confirm?confirm(input):{status:'ACCEPTED'};},async health(){return{ready:true};}};
 const runtime=createStaticWeeklyControlPlaneRuntime({env,supabase:{rpc},trustedDeviceStore:{find},database:{},controlPlane:plane,
  managerOperationClock:{now:timer.now,setTimer:timer.setTimer,clearTimer:timer.clearTimer}});
 const server=http.createServer(runtime.app),incoming=[];
 server.prependListener('request',request=>incoming.push(request));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 return{timer,calls,incoming,origin,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function post(origin,path='/static-weekly/recurring-adaptation/preview',requestBody=body,method='POST'){
 const response=await fetch(`${origin}${path}`,{
 method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(method==='POST'?{body:requestBody}:{})});
 const raw=await response.text();return{status:response.status,data:raw.startsWith('{')?JSON.parse(raw):raw};}
{
 let releaseBegin;const begin=new Promise(resolve=>{releaseBegin=resolve;});const rpcCalls=[];
 const f=await fixture({rpc:async(name,args)=>{rpcCalls.push({name,args});
   if(name==='custodial_begin_application_mutation_lease')return begin;
   if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};
   throw Error(`unexpected ${name}`);},find:async()=>trustedRow()});
 try{
  const pending=post(f.origin);await until(()=>f.timer.timer&&rpcCalls.length===1);f.timer.expire();
  const result=await pending;same(result.status,503,'stalled lease begin fails before the original minute');
  same(result.data.code,'static_weekly_recurring_operation_deadline_exceeded','body remains typed and non-success');
  same(f.calls.length,0,'late lease cannot reach private compiler');
  releaseBegin({data:{mutations_paused:false,authority_generation:1},error:null});
  await until(()=>rpcCalls.length===2);
  same(rpcCalls[1].name,'custodial_release_application_mutation_lease','late lease success is released by exact ID');
  same(rpcCalls[1].args.p_request_id,rpcCalls[0].args.p_request_id,'late cleanup never touches another lease');
 }finally{await f.close();}
}
{
 let releaseFind;const find=new Promise(resolve=>{releaseFind=resolve;});let entered=false,releaseCount=0;
 const f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease'){releaseCount++;return{data:true,error:null};}
  throw Error(`unexpected ${name}`);},find:async()=>{entered=true;return find;}});
 try{
  const pending=post(f.origin);await until(()=>entered);f.timer.expire();const result=await pending;
  same(result.status,503,'stalled current-device lookup fails within original request');
  same(f.calls.length,0,'expired auth cannot reach product action');
  releaseFind(trustedRow());await until(()=>releaseCount===1);
  same(f.calls.length,0,'late valid manager lookup cannot resurrect a timed-out action');
  same(releaseCount,1,'timed-out auth response releases only its acquired restore lease');
 }finally{await f.close();}
}
{
 let leaseCalls=0,authCalls=0;
 const f=await fixture({rpc:async(name)=>{leaseCalls++;if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};throw Error(`unexpected ${name}`);},find:async()=>{authCalls++;return trustedRow();}});
 let request;
 try{
  let requestClosed=false;
  const response=new Promise((resolve,reject)=>{request=http.request(`${f.origin}/static-weekly/recurring-adaptation/preview`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Length':body.length+20}},res=>{
    let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));});
   request.on('close',()=>{requestClosed=true;});request.on('error',reject);request.write(body.slice(0,1));});
  await until(()=>f.timer.timer);f.timer.expire();const result=await response;
  same(result.status,503,'partial body expiry fails before restore or auth');
  await until(()=>requestClosed);
  same(request.destroyed,true,'timed-out partial-body connection closes after its 503 response');
  await until(()=>f.incoming.at(-1)?.destroyed);
  same(f.incoming.at(-1).complete,false,'server never treats the partial body as a complete request');
  same(f.incoming.at(-1).listenerCount('data'),0,'body parser has no pending data listener after owned abort');
  same(f.incoming.at(-1).listenerCount('aborted'),0,'body parser has no pending abort listener after owned abort');
  same(f.incoming.at(-1).listenerCount('close'),0,'body parser has no pending close listener after owned abort');
  same(f.incoming.at(-1).listeners('end').map(listener=>listener.name),['clearIncoming'],
   'only the Node incoming-message end finalizer remains, not the body parser');
  same(f.timer.timer,null,'timed-out partial-body timer is cleared after response');
  same(leaseCalls,0,'partial body never acquires mutation lease');
  same(authCalls,0,'partial body never authenticates into a write');
  same(f.calls.length,0,'partial body never reaches product handler');
 }finally{request?.destroy();await f.close();}
}
{
 let f;
 f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};
  throw Error(`unexpected ${name}`);},find:async()=>{f.timer.elapse(12_345);return trustedRow();}});
 try{
  const result=await post(f.origin);same(result.status,200,'current named manager still reaches the exact preview');
  same(f.calls.length,1,'successful admission invokes only one preview');
  same(f.calls[0].input.deadlineAt,60_001,'auth time does not reset the captured ingress deadline');
  same(f.timer.timer,null,'successful response clears its first-origin timer');
 }finally{await f.close();}
}
{
 let f;
 f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease')return{data:true,error:null};
  throw Error(`unexpected ${name}`);},find:async()=>trustedRow()});
 try{
  const confirmBody=JSON.stringify({confirmation_key:'10000000-0000-4000-8000-000000000099',effective_start:'2026-10-05',
   expected_revision:1,preview_digest:'a'.repeat(64)});
  for(const [path,kind,payload] of [
   ['/static-weekly/recurring-adaptation/PREVIEW','preview',body],
   ['/static-weekly/recurring-adaptation/preview/','preview',body],
   ['/static-weekly/recurring-adaptation/CONFIRM','confirm',confirmBody],
   ['/static-weekly/recurring-adaptation/confirm/','confirm',confirmBody],
  ]){
   const starts=f.timer.starts,calls=f.calls.length,result=await post(f.origin,path,payload);
   same(result.status,200,`Express-served ${path} remains admitted`);
   same(f.timer.starts,starts+1,`Express-served ${path} starts the first-origin clock`);
   same(f.calls.length,calls+1,`Express-served ${path} reaches one product handler`);
   same(f.calls.at(-1).kind,kind,`Express-served ${path} reaches its matching handler`);
  }
  for(const [path,method] of [
   ['/static-weekly/recurring-adaptation/preview//','POST'],
   ['/static-weekly/recurring-adaptation/preview-extra','POST'],
   ['/static-weekly/recurring-adaptation/other','POST'],
   ['/static-weekly/recurring-adaptation/preview','GET'],
  ]){
   const starts=f.timer.starts,calls=f.calls.length,result=await post(f.origin,path,body,method);
   same(result.status,404,`unrelated ${method} ${path} remains unmatched`);
   same(f.timer.starts,starts,`unrelated ${method} ${path} starts no manager clock`);
   same(f.calls.length,calls,`unrelated ${method} ${path} reaches no product handler`);
  }
 }finally{await f.close();}
}
{
 let finishRelease,releaseCalls=0,responseSettled=false;
 const releasePending=new Promise(resolve=>{finishRelease=resolve;});
 const f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease'){releaseCalls++;return releasePending;}
  throw Error(`unexpected ${name}`);},find:async()=>trustedRow()});
 try{
  const pending=post(f.origin).then(result=>{responseSettled=true;return result;});
  await until(()=>releaseCalls===1);
  await new Promise(resolve=>setImmediate(resolve));
  same(f.calls.length,1,'SQL-equivalent product promise settles before lease release begins');
  same(responseSettled,false,'recurring success bytes wait for exact lease release');
  finishRelease({data:true,error:null});
  const result=await pending;
  same(result.status,200,'confirmed release permits the successful preview envelope');
  same(result.data.ok,true,'success remains typed only after release settles');
  same(releaseCalls,1,'response end and finish do not release the lease twice');
 }finally{await f.close();}
}
{
 let releaseCalls=0;
 const f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease'){releaseCalls++;return{data:null,error:new Error('synthetic release failure')};}
  throw Error(`unexpected ${name}`);},find:async()=>trustedRow()});
 try{
  const result=await post(f.origin);
  same(result.status,503,'rejected exact release is never returned as success');
  same(result.data.code,'static_weekly_recurring_mutation_lease_release_unknown','release rejection is typed UNKNOWN');
  same(releaseCalls,1,'rejected release is not blindly replayed at response end');
 }finally{await f.close();}
}
{
 let releaseCalls=0;
 const f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease'){releaseCalls++;return{data:false,error:null};}
  throw Error(`unexpected ${name}`);},find:async()=>trustedRow()});
 try{
  const result=await post(f.origin);
  same(result.status,503,'release RPC false cannot be treated as exact successful deletion');
  same(result.data.code,'static_weekly_recurring_mutation_lease_release_unknown','false release result is typed UNKNOWN');
  same(releaseCalls,1,'false release is not blindly retried with a new identity');
 }finally{await f.close();}
}
{
 let finishRelease,releaseCalls=0;
 const releasePending=new Promise(resolve=>{finishRelease=resolve;});
 const f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease'){releaseCalls++;return releasePending;}
  throw Error(`unexpected ${name}`);},find:async()=>trustedRow()});
 try{
  const pending=post(f.origin);
  await until(()=>releaseCalls===1);f.timer.expire();
  const result=await pending;
  same(result.status,503,'never-settling release fails at the same original ingress timer');
  same(result.data.code,'static_weekly_recurring_mutation_lease_release_unknown','pending release is typed UNKNOWN');
  finishRelease({data:true,error:null});
  await new Promise(resolve=>setImmediate(resolve));
  same(result.data.ok,false,'late release cannot upgrade the already-failed response');
  same(releaseCalls,1,'late release does not trigger a second RPC');
 }finally{await f.close();}
}
{
 let releaseCalls=0;
 const f=await fixture({rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,authority_generation:1},error:null};
  if(name==='custodial_release_application_mutation_lease'){releaseCalls++;return{data:true,error:null};}
  throw Error(`unexpected ${name}`);},find:async()=>trustedRow(),confirm:async()=>{
   throw Object.assign(new Error('The COMMIT outcome is unknown; read the exact status.'),
    {code:'static_weekly_recurring_confirmation_outcome_unknown'});
  }});
 try{
  const result=await post(f.origin,'/static-weekly/recurring-adaptation/confirm',JSON.stringify({
   confirmation_key:'10000000-0000-4000-8000-000000000099',effective_start:'2026-10-05',
   expected_revision:1,preview_digest:'a'.repeat(64)}));
  same(result.status,503,'COMMIT-unknown remains unavailable, not 200');
  same(result.data.code,'static_weekly_recurring_confirmation_outcome_unknown','COMMIT-unknown identity is preserved');
  await until(()=>releaseCalls===1);
  same(releaseCalls,1,'unknown COMMIT still releases only its settled exact mutation lease');
 }finally{await f.close();}
}
console.log(JSON.stringify({status:'PASS',checks,scope:'loopback first-origin body/lease/auth expiration; synthetic store/lease and control plane, no SQL/solver/phone'}));
