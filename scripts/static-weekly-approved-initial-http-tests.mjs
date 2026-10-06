import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
const env={NODE_ENV:'test',SUPABASE_URL:'https://initial-scheduler-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-only',OPS_MANAGER_SESSION_SECRET:'synthetic-approved-initial-session-secret-0123456789'};
const manager={manager_id:'10000000-0000-4000-8000-000000000051',display_name:'Synthetic Initial Owner',roles:['OPS_MANAGER','CUSTODIAL_MANAGER'],active:true,is_system_principal:false,system_key:'eric_custodial_manager'};
const credentialId='synthetic-initial-credential',deviceId='synthetic-initial-device';
const issue=level=>createOpsManagerSession({credentialId,deviceId,manager,authMode:'trusted_device',accessLevel:level,maximumAccessLevel:'full_access',env});
const session=issue('full_access'),readonly=issue('read_only'),timerCallbacks=new Map(),timers=new Set(),leases=new Set(),calls=[],results=[];
let revoked=false,storeBroken=false,mode='normal',releasedBeforeResult=false,authPending=null,authEntered=false;
const store={async find(){authEntered=true;if(authPending)await authPending;if(storeBroken)throw Error('fixture store unavailable');return {credential_id:credentialId,device_id:deviceId,max_access_level:'full_access',created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:revoked?new Date().toISOString():null,manager_id:manager.manager_id,manager:{...manager}};}};
const clock={now:()=>performance.now(),setTimer:(fn,ms)=>{assert.equal(ms,55000);const timer=setTimeout(fn,ms);timers.add(timer);timerCallbacks.set(timer,fn);return timer;},clearTimer:t=>{clearTimeout(t);timers.delete(t);timerCallbacks.delete(t);}};
const controlPlane={
 async previewApprovedInitialBaseline(request){calls.push({kind:'preview',request});if(mode==='missing_pattern')throw Object.assign(Error('No admitted fixed pattern'),{code:'static_template_missing_approved_pattern'});if(mode==='db_unavailable')throw Object.assign(Error('Database unavailable'),{code:'static_weekly_control_plane_database_unavailable'});return {schema:'custodial.approved-static-initial-preview.v1',status:'PREVIEW_ONLY',previewDigest:'a'.repeat(64),published:false,solverInvoked:false};},
 async publishApprovedInitialBaseline(request){calls.push({kind:'confirm',request});if(mode==='stale')throw Object.assign(Error('Current source changed'),{code:'static_template_preview_changed'});return {schema:'custodial.approved-static-initial-confirmation.v1',status:'PERSISTED_CURRENT',revision:43,solverInvoked:false};},
 async close(){},async health(){return {ready:true};},
 async createInitialDraft(){throw Error('Forbidden legacy optimizer fallback');},
};
const supabase={async rpc(name,args){if(name==='custodial_begin_application_mutation_lease'){leases.add(args.p_request_id);return {data:{mutations_paused:false,authority_generation:1},error:null};}
 if(name==='custodial_release_application_mutation_lease'){leases.delete(args.p_request_id);releasedBeforeResult=true;return {data:true,error:mode==='release_error'?Error('synthetic release outcome unknown'):null};}
 if(name==='custodial_heartbeat_application_mutation_lease')return {data:true,error:null};throw Error('Unexpected fixture RPC '+name);}};
const runtime=createStaticWeeklyControlPlaneRuntime({env,database:{},controlPlane,datedTransitionController:null,supabase,trustedDeviceStore:store,managerOperationClock:clock});
const server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,body={source_id:'50000000-0000-4000-8000-000000000051',effective_start:'2026-10-05',template_id:'owner-corrected-six-initial',expected_revision:42};
const confirm={...body,preview_digest:'a'.repeat(64),idempotency_key:'initial-owner-confirm-1'};
async function request(path,value=body,{token=session.token,method='POST'}={}){releasedBeforeResult=false;const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(method==='GET'?{}:{body:JSON.stringify(value)}),signal:AbortSignal.timeout(4000)});const raw=await response.text();let payload;try{payload=JSON.parse(raw);}catch{payload={raw:raw.slice(0,120)};}return {status:response.status,payload,releasedBeforeResult};}
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}}
const previewPath='/static-weekly/approved-initial/preview',confirmPath='/static-weekly/approved-initial/confirm';
try{
 await test('authenticated fixed-baseline preview is reachable',async()=>{const r=await request(previewPath);assert.equal(r.status,200);assert.equal(r.payload.data.status,'PREVIEW_ONLY');assert.equal(r.payload.data.solverInvoked,false);assert.equal(r.payload.data.published,false);assert.equal(r.releasedBeforeResult,true);});
 await test('only authenticated source selectors enter preview',()=>{const r=calls.find(x=>x.kind==='preview')?.request;assert.ok(r);assert.equal(r.manager.manager_id,manager.manager_id);assert.equal(r.sourceId,body.source_id);assert.equal(r.effectiveStart,body.effective_start);assert.equal(r.templateId,body.template_id);assert.equal(r.expectedRevision,42);assert.ok(r.signal instanceof AbortSignal);assert.equal(r.signal.aborted,true);assert.ok(Number.isFinite(r.deadlineAt)&&r.deadlineAt<=performance.now()+60000);});
 await test('authenticated exact confirmation is reachable',async()=>{const r=await request(confirmPath,confirm);assert.equal(r.status,200);assert.equal(r.payload.data.status,'PERSISTED_CURRENT');assert.equal(r.releasedBeforeResult,true);const call=calls.at(-1);assert.equal(call.kind,'confirm');assert.equal(call.request.previewDigest,confirm.preview_digest);assert.equal(call.request.idempotencyKey,confirm.idempotency_key);});
 for(const path of[previewPath,confirmPath]){
  const value=path===previewPath?body:confirm;
  await test(path+' anonymous denied',async()=>{const before=calls.length;const r=await request(path,value,{token:null});assert.equal(r.status,401);assert.equal(calls.length,before);});
  await test(path+' read-only publication denied',async()=>{const before=calls.length;const r=await request(path,value,{token:readonly.token});assert.equal(r.status,403);assert.equal(calls.length,before);});
  await test(path+' revoked session denied',async()=>{revoked=true;try{const before=calls.length,r=await request(path,value);assert.equal(r.status,401);assert.equal(calls.length,before);}finally{revoked=false;}});
 }
 for(const patch of[{manager_id:manager.manager_id},{assignments:[]},{owner_config:{}},{available_person_ids:[]},{source:{forged:true}},{full_nine_source_id:body.source_id},{deadline_at:1}]){
  await test('untrusted supplied authority rejected '+Object.keys(patch)[0],async()=>{const before=calls.length,r=await request(previewPath,{...body,...patch});assert.equal(r.status,422);assert.equal(calls.length,before);});
 }
 for(const [key,value]of[['expected_revision','42'],['expected_revision',-1],['expected_revision',1.5],['source_id','fake'],['effective_start','2026-10-06'],['effective_start','2026-02-30'],['template_id','']]){
  await test('invalid selector '+key+' '+value,async()=>{const before=calls.length,r=await request(previewPath,{...body,[key]:value});assert.equal(r.status,422);assert.equal(calls.length,before);});
 }
 for(const patch of[{preview_digest:'bad'},{idempotency_key:''},{idempotency_key:'x'.repeat(201)}]){
  await test('invalid confirmation identity '+Object.keys(patch)[0],async()=>{const before=calls.length,r=await request(confirmPath,{...confirm,...patch});assert.equal(r.status,422);assert.equal(calls.length,before);});
 }
 await test('JSON array request rejected',async()=>assert.equal((await request(previewPath,[])).status,422));
 await test('missing required selector rejected',async()=>{const v={...body};delete v.template_id;assert.equal((await request(previewPath,v)).status,422);});
 await test('old preview identity fails without claimed publish',async()=>{mode='stale';try{const r=await request(confirmPath,confirm);assert.equal(r.status,409);assert.equal(r.payload.ok,false);}finally{mode='normal';}});
 await test('missing approved pattern does not invoke optimizer',async()=>{mode='missing_pattern';try{const r=await request(previewPath);assert.equal(r.status,409);assert.equal(r.payload.code,'static_template_missing_approved_pattern');}finally{mode='normal';}});
 await test('database outage is unavailable, not conflict or empty',async()=>{mode='db_unavailable';try{const r=await request(previewPath);assert.equal(r.status,503);}finally{mode='normal';}});
 await test('case and trailing slash keep the ingress deadline',async()=>{const r=await request('/STATIC-WEEKLY/APPROVED-INITIAL/PREVIEW/');assert.equal(r.status,200);assert.ok(calls.at(-1).request.deadlineAt<=performance.now()+60000);});
 await test('GET cannot trigger publication',async()=>{const before=calls.length,r=await request(confirmPath,null,{method:'GET'});assert.equal(r.status,404);assert.equal(calls.length,before);});
 await test('unconfirmed restore-lease release never reports success',async()=>{mode='release_error';try{const r=await request(confirmPath,confirm);assert.equal(r.status,503);assert.equal(r.payload.code,'static_weekly_recurring_mutation_lease_release_unknown');assert.equal(r.payload.ok,false);}finally{mode='normal';}});
 await test('deadline includes waiting for current-credential authentication',async()=>{let release;authEntered=false;authPending=new Promise(r=>{release=r;});const before=calls.length,pending=request(previewPath);try{for(let i=0;i<100&&!authEntered;i++)await new Promise(r=>setTimeout(r,2));assert.equal(authEntered,true);assert.equal(timerCallbacks.size,1);for(const fn of [...timerCallbacks.values()])fn();const r=await pending;assert.equal(r.status,503);assert.equal(calls.length,before);}finally{release();authPending=null;await pending.catch(()=>{});}});
 await test('missing method fails closed instead of using legacy optimizer',async()=>{const method=controlPlane.publishApprovedInitialBaseline;delete controlPlane.publishApprovedInitialBaseline;try{const r=await request(confirmPath,confirm);assert.equal(r.status,503);assert.equal(r.payload.ok,false);}finally{controlPlane.publishApprovedInitialBaseline=method;}});
 await test('all requests release leases and deadline timers',async()=>{await new Promise(r=>setTimeout(r,20));assert.equal(timers.size,0);assert.equal(leases.size,0);});
}finally{server.closeAllConnections();await new Promise((r,j)=>server.close(e=>e?j(e):r()));for(const timer of timers)clearTimeout(timer);}
console.log(JSON.stringify({status:results.every(r=>r.pass)?'PASS':'FAIL',checks:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass),scope:'Actual runtime, signed synthetic manager sessions, real loopback HTTP; synthetic current store, restore RPC and application methods. No production I/O or SQL acceptance claim.'},null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
