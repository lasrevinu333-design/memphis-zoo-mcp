import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer,request as httpRequest} from 'node:http';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const b=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const root=new URL('../..',import.meta.url).pathname.replace(/\/$/,'');
const {createOpsManagerSession}=await import(pathToFileURL(b+'/src/auth/shared-access-auth.js'));
const {createStaticWeeklyControlPlane,STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS}=await import(pathToFileURL(b+'/src/static-weekly-control-plane.js'));
const {createStaticWeeklyControlPlaneRuntime}=await import(pathToFileURL(b+'/src/static-weekly-control-plane-runtime.js'));
const env={NODE_ENV:'test',SUPABASE_URL:'https://audit.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-not-a-key',OPS_MANAGER_SESSION_SECRET:'synthetic-scheduler-audit-key-at-least32bytes'};
const owner={manager_id:'10000000-0000-4000-8000-000000000001',display_name:'Synthetic Owner',system_key:'eric_custodial_manager',is_system_principal:false,roles:['CUSTODIAL_MANAGER'],active:true,revoked_at:null};
const delegate={...owner,manager_id:'10000000-0000-4000-8000-000000000002',display_name:'Synthetic Delegate',system_key:'audit_delegate',roles:['OPS_MANAGER']};
const results=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(options={}){
 const rows=new Map(),sessions=[];
 for(const [i,manager]of[owner,delegate].entries()){
  const credential='20000000-0000-4000-8000-00000000000'+(i+1),device='audit-device-'+i;
  rows.set(credential,{credential_id:credential,device_id:device,max_access_level:'full_access',created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),manager_id:manager.manager_id,manager:{...manager},revoked_at:null});
  sessions.push(createOpsManagerSession({credentialId:credential,deviceId:device,manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env}));
 }
 const queries=[],leases={begun:0,released:0,release_failed:0},state={written:0,committed:0,store_reads:0};
 const db={connect:async()=>{const client=new EventEmitter();client.release=()=>{};client.query=async(q,args=[])=>{
  queries.push({q,args});
  if(q==='commit'){state.committed=state.written;if(options.commitAckLost)throw Object.assign(Error('connection terminated after commit'),{code:'ECONNRESET'});return{rows:[]};}
  if(q==='rollback'){state.written=state.committed;return{rows:[]};}
  if(q.includes('custodial_begin_application_mutation()')){if(options.revokeAfterIngress)rows.get(sessions[0].credential_id).revoked_at=new Date().toISOString();return{rows:[]};}
  if(q.includes('custodial_action_actor_v1')){const current=rows.get(args[1]);if(!current||current.revoked_at||current.manager_id!==args[0]||current.device_id!==args[2])throw Object.assign(Error('Current credential rejected at write boundary'),{code:'42501'});return{rows:[{result:{manager_id:args[0],owner:true,credential_id:args[1],device_id:args[2]}}]};}
  if(q.includes('static_weekly_v7_create_vacant_roster_slot')){if(options.beforeWrite)await options.beforeWrite();state.written++;return{rows:[{result:{revision:1,data:{slot_id:args[0]}}}]};}
  if(q.includes('static_weekly_v21_reconcile_dependency_changes'))return{rows:[{result:{authorityRevision:Math.max(1,state.written),processedChangeCount:0,invalidations:[],blockedPublications:[],affectedPhonesUpdated:false}}]};
  if(q.includes('read_manager_snapshot'))return{rows:[{result:{schema:'memphis-zoo.static-weekly-manager-snapshot.v1',week_start:'2026-10-05'}}]};
  return{rows:[]};};return client;},end:async()=>{}};
 const plane=createStaticWeeklyControlPlane({database:db,initializeSolver:async()=>{},getSolverReadiness:()=>({available:true}),shutdownCompiler:async()=>{}});
 const supabase={rpc:async(name)=>{
  if(name==='custodial_begin_application_mutation_lease'){leases.begun++;return{data:{mutations_paused:false,authority_generation:1},error:null};}
  if(name==='custodial_release_application_mutation_lease'){if(options.releaseFails){leases.release_failed++;return{data:null,error:Error('Synthetic lease-release outage')};}leases.released++;return{data:true,error:null};}
  return{data:true,error:null};}};
 const runtime=createStaticWeeklyControlPlaneRuntime({env,database:db,controlPlane:plane,datedTransitionController:null,supabase,trustedDeviceStore:{find:async id=>{state.store_reads++;return structuredClone(rows.get(id)||null);}}});
 const server=createServer(runtime.app);const sockets=new Set();server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const call=async(path,session=sessions[0],body)=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}: {})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});return{status:response.status,body:await response.json().catch(()=>null)};};
 const close=async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await plane.close();};
 return{call,close,origin,rows,sessions,state,leases,queries};
}
const body={slot_id:'30000000-0000-4000-8000-000000000001',slot_label:'Synthetic position',expected_revision:0,idempotency_key:'audit-only'};
async function check(id,description,options,fn){const f=await fixture(options);try{results.push({id,description,...await fn(f)});}catch(e){results.push({id,description,harness_error:String(e.stack||e)});}finally{await f.close();}}
await check('HTTP-01','Owner reads the schedule',{},async f=>{const r=await f.call('/static-weekly/manager-snapshot?week_start=2026-10-05');return{pass:r.status===200,status:r.status};});
await check('HTTP-02','Delegate reads without gaining general write',{},async f=>{const read=await f.call('/static-weekly/manager-snapshot?week_start=2026-10-05',f.sessions[1]);const write=await f.call('/static-weekly/roster/vacant-slots',f.sessions[1],body);return{pass:read.status===200&&write.status===403&&f.state.written===0,read:read.status,write:write.status};});
await check('HTTP-03','Anonymous request denied before scheduler write',{},async f=>{const r=await f.call('/static-weekly/roster/vacant-slots',null,body);return{pass:r.status===401&&f.state.written===0,status:r.status};});
await check('HTTP-04','Revoked credential denied at ingress',{},async f=>{f.rows.get(f.sessions[0].credential_id).revoked_at=new Date().toISOString();const r=await f.call('/static-weekly/roster/vacant-slots',f.sessions[0],body);return{pass:r.status===401&&f.state.written===0,status:r.status};});
await check('HTTP-05','Approved fixed-baseline preview is mounted in integrated candidate',{},async f=>{const r=await f.call('/static-weekly/approved-initial/preview',f.sessions[0],{source_id:'synthetic',effective_start:'2026-10-05',expected_revision:0});return{pass:r.status!==404,status:r.status};});
await check('HTTP-06','Ordinary successful write confirms actual transaction commit',{},async f=>{const r=await f.call('/static-weekly/roster/vacant-slots',f.sessions[0],body);await delay(5);return{pass:r.status===200&&f.state.committed===1&&f.leases.released===1,status:r.status,committed:f.state.committed,lease_released:f.leases.released};});
await check('HTTP-07','Lease-release failure cannot be reported as fully settled success',{releaseFails:true},async f=>{const r=await f.call('/static-weekly/roster/vacant-slots',f.sessions[0],body);await delay(10);return{pass:f.state.committed===1&&r.status!==200,status:r.status,committed:f.state.committed,release_failed:f.leases.release_failed,body:r.body};});
await check('HTTP-08','Lost COMMIT acknowledgment is not falsely reported as no accepted change',{commitAckLost:true},async f=>{const r=await f.call('/static-weekly/roster/vacant-slots',f.sessions[0],body);return{pass:f.state.committed===1&&!r.body?.error?.includes('No schedule change was accepted'),status:r.status,simulated_database_committed:f.state.committed,error:r.body?.error,scope:'Actual transaction/error handling with simulated durable commit followed by connection loss; not a real PostgreSQL wire interruption'};});
await check('HTTP-09','General write checks current credential after admission',{revokeAfterIngress:true},async f=>{const r=await f.call('/static-weekly/roster/vacant-slots',f.sessions[0],body);return{pass:f.state.committed===0&&f.queries.some(x=>x.q.includes('custodial_action_actor_v1')),status:r.status,store_reads:f.state.store_reads,credential_revoked:f.rows.get(f.sessions[0].credential_id).revoked_at!==null,simulated_commits:f.state.committed,db_validator_called:f.queries.some(x=>x.q.includes('custodial_action_actor_v1')),scope:'Actual HTTP and control-plane path with simulated SQL; assess installed writer before claiming exploitable production behavior'};});
results.push({id:'TIME-01',description:'DB statement ceiling remains no longer than original whole-operation budget',pass:STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS<=60000,statement_timeout_ms:STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS,scope:'Actual exported limit, not a deliberately overlong test'});
const result={basis:'Scheduler audit HTTP-01 through HTTP-09 rerun against current source; synthetic SQL now models actual current-credential validator result and denial.',scope:'Actual Express authentication, scheduler runtime, restore gate and control-plane transaction code. Signed synthetic identities; stub credential/SQL/restore RPC transports. All network loopback. No production credentials, writes or signing.',cases:results.length,passed:results.filter(x=>x.pass===true).length,failed:results.filter(x=>x.pass===false).length,harness_errors:results.filter(x=>x.harness_error).length,results};
fs.writeFileSync(root+'/scheduler-current-boundary-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.harness_errors?2:result.failed?1:0;
