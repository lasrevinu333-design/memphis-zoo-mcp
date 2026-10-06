import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {projectManagerSession,hasManagerPermission} from '../src/auth/manager-permissions.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
const env={NODE_ENV:'test',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only-service-key',OPS_MANAGER_SESSION_SECRET:'fixture-manager-permissions-secret-0123456789012'};
const owner={manager_id:'11000000-0000-4000-8000-000000000001',display_name:'Synthetic Owner',system_key:'eric_custodial_manager',roles:['CUSTODIAL_MANAGER'],active:true,is_system_principal:false};
const delegate={manager_id:'11000000-0000-4000-8000-000000000002',display_name:'Synthetic Delegate',system_key:'jennifer_sheffield_director_operations',roles:['DIRECTOR'],active:true,is_system_principal:false};
const cid='12000000-0000-4000-8000-000000000001',did='synthetic-device';let current=delegate,revoked=false,reassigned=false,mode='normal';
const calls=[],leases=new Set(),results=[];
const store={async find(id){return id===cid?{credential_id:cid,device_id:did,manager_id:reassigned?owner.manager_id:current.manager_id,manager:{...current},max_access_level:'full_access',created_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),revoked_at:revoked?new Date().toISOString():null}:null;}};
const sign=manager=>createOpsManagerSession({manager,credentialId:cid,deviceId:did,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
const dsession=sign(delegate),osession=sign(owner);
const methods=['applyException','applyContractorCapacity','applyDayChanges','materializeProjection','rebuildCurrentProjection','createInitialDraft','createVacantRosterSlot','markEmployeeDeparted','replaceEmployee','fillVacantRosterSlot','publishDraft','getManagerSnapshot'];
const controlPlane=Object.fromEntries(methods.map(name=>[name,async request=>{calls.push({name,request});if(mode==='reject')throw Object.assign(Error('Synthetic SQL permission rejection'),{code:'42501'});return{operation:name,revision:43,data:{projection_id:'13000000-0000-4000-8000-000000000001'}};} ]));
controlPlane.health=async()=>({ready:true});controlPlane.close=async()=>{};
const supabase={async rpc(name,args){if(name==='custodial_begin_application_mutation_lease'){leases.add(args.p_request_id);return{data:{mutations_paused:false,authority_generation:1}};}if(name==='custodial_release_application_mutation_lease'){leases.delete(args.p_request_id);return{data:true};}if(name==='custodial_heartbeat_application_mutation_lease')return{data:true};throw Error('Unexpected RPC');}};
const runtime=createStaticWeeklyControlPlaneRuntime({env,database:{},controlPlane,datedTransitionController:null,supabase,trustedDeviceStore:store});
const server=createServer(runtime.app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
async function request(path,token=dsession.token,body={}){const r=await fetch(base+'/static-weekly'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});return{status:r.status,payload:await r.json().catch(()=>null)};}
async function test(label,fn){try{await fn();results.push({label,pass:true});}catch(e){results.push({label,pass:false,error:e.message});}}
try{
 await test('owner stays full; delegate stays read-only with exactly dated exceptions',()=>{assert.equal(osession.read_only,false);assert.equal(dsession.read_only,true);assert.equal(dsession.permissions.absence_coverage_required,false);for(const action of ['manage_absences','manage_coverall','regenerate_routes','close_scan_tickets'])assert.equal(hasManagerPermission(dsession,action),true);for(const action of ['write','hire','manage_settings','edit_events'])assert.equal(hasManagerPermission(dsession,action),false);});
 const allowed=[['/exceptions','applyException'],['/contractor-capacity','applyContractorCapacity'],['/day-changes/batch','applyDayChanges'],['/projections','materializeProjection'],['/rebuild-current-projection','rebuildCurrentProjection']];
 for(const[path,method]of allowed){
  await test('delegate permitted '+path,async()=>{const before=calls.length,r=await request(path,dsession.token,{service_date:'2026-10-06',week_start:'2026-10-05',expected_revision:42,idempotency_key:'fixture-operation'});assert.equal(r.status,200);assert.equal(calls.length,before+1);const c=calls.at(-1);assert.equal(c.name,method);assert.equal(c.request.manager.read_only,true);assert.equal(c.request.manager.manager_id,delegate.manager_id);if(c.request.signal){assert.equal(c.request.signal.aborted,true);assert.ok(Number.isFinite(c.request.deadlineAt));}});
  await test('anonymous blocked '+path,async()=>{const before=calls.length;assert.equal((await request(path,null)).status,401);assert.equal(calls.length,before);});
  await test('revoked blocked '+path,async()=>{revoked=true;try{const n=calls.length;assert.equal((await request(path)).status,401);assert.equal(calls.length,n);}finally{revoked=false;}});
 }
 for(const path of ['/drafts/initial','/drafts/replacement','/drafts/13000000-0000-4000-8000-000000000001/publish','/approved-initial/confirm','/recurring-adaptation/confirm','/employees/departed','/employees/replacements','/roster/vacant-slots','/roster/vacant-slots/13000000-0000-4000-8000-000000000001/fill','/staffing-commands','/places/confirm','/coverall/source-confirm']){
  await test('delegate denied general/permanent '+path,async()=>{const n=calls.length;assert.equal((await request(path)).status,403);assert.equal(calls.length,n);});
 }
 await test('browser-supplied manager and permission fields never replace current identity',async()=>{const r=await request('/day-changes/batch',dsession.token,{manager_id:owner.manager_id,manager:osession,read_only:false,permissions:{owner:true},operations:[]});assert.equal(r.status,200);assert.equal(calls.at(-1).request.manager.manager_id,delegate.manager_id);assert.equal(calls.at(-1).request.manager.permissions.owner,false);});
 await test('reassigned manager credential denied',async()=>{reassigned=true;try{const n=calls.length;assert.equal((await request('/exceptions')).status,403);assert.equal(calls.length,n);}finally{reassigned=false;}});
 await test('inactive manager denied',async()=>{current={...delegate,active:false};try{assert.equal((await request('/exceptions')).status,403);}finally{current=delegate;}});
 await test('system principal denied',async()=>{current={...delegate,is_system_principal:true};try{assert.equal((await request('/exceptions')).status,403);}finally{current=delegate;}});
 await test('backend SQL denial remains forbidden, not a success',async()=>{mode='reject';try{assert.equal((await request('/day-changes/batch')).status,403);}finally{mode='normal';}});
 await test('legitimate owner retains roster writes',async()=>{current=owner;try{assert.equal((await request('/roster/vacant-slots',osession.token)).status,200);assert.equal(calls.at(-1).request.manager.permissions.owner,true);}finally{current=delegate;}});
 await test('old full-access delegate credential is not full owner authority',()=>{const p=projectManagerSession({...dsession,access_level:'full_access',read_only:false,permissions:{owner:true}},delegate,{maximumAccessLevel:'full_access',credentialBound:true});assert.equal(p.read_only,true);assert.equal(p.permissions.owner,false);assert.equal(hasManagerPermission(p,'manage_coverall'),true);});
 await test('all operation leases settle',async()=>{await new Promise(r=>setTimeout(r,10));assert.equal(leases.size,0);});
}finally{server.closeAllConnections();await new Promise((r,j)=>server.close(e=>e?j(e):r()));}
console.log(JSON.stringify({result:results.every(r=>r.pass)?'MANAGER_SCHEDULER_HTTP_PASS':'FAIL',cases:results.length,results,scope:'Exact runtime and current-registry auth with signed synthetic sessions, real loopback HTTP, synthetic application/restore adapters; SQL permission and compiler tests are separate.'},null,2));if(results.some(r=>!r.pass))process.exitCode=1;
