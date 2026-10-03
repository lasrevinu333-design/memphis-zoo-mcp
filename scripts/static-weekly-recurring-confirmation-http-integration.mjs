import assert from 'node:assert/strict';
import {writeFileSync,writeSync} from 'node:fs';
import {createServer} from 'node:http';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated} from '../src/static-weekly-schedule-compiler-runtime.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {recurringHttpSqlBoundary,captureRecurringHttpTransportFailure,
 rethrowOriginalTransportError,recurringHttpCompilerProbe} from './static-weekly-recurring-http-boundary.mjs';

// Invoked only after the explicit current-manager-218/219 fixture has published its exact
// baseline in the network-none, no-auto-grants disposable database. This is
// the alternate writer to the direct confirmation integration, never a second
// confirmation against the same revision. No real trusted device or phone is
// represented by the synthetic credential below.
export async function testRecurringConfirmationHttp({pool,week,originalManagerId,check,requestAdapterFactory=null}) {
 const secondManager={manager_id:'10000000-0000-4000-8000-000000000273',
  display_name:'Second synthetic recurring HTTP manager',roles:['OPS_MANAGER','CUSTODIAL_MANAGER'],active:true};
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,$2,array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",
  [secondManager.manager_id,secondManager.display_name]);
 const env={NODE_ENV:'test',SUPABASE_URL:'https://scheduler-http-synthetic.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'scheduler-http-synthetic-not-production',
  OPS_MANAGER_SESSION_SECRET:'scheduler-http-synthetic-session-secret-0123456789'};
 const credentialId='synthetic-recurring-http-credential',deviceId='synthetic-recurring-http-device';
 const enrolled=(manager,credential,device,access='full_access')=>({credential_id:credential,
  device_id:device,max_access_level:access,created_at:new Date(Date.now()-60_000).toISOString(),
  expires_at:new Date(Date.now()+60*60_000).toISOString(),manager_id:manager.manager_id,manager});
 const enrolledRows=new Map([[credentialId,enrolled(secondManager,credentialId,deviceId)]]);
 const trustedDeviceStore={async find(id){return enrolledRows.get(id)??null;}};
 const token=(manager,credential=credentialId,device=deviceId,access='full_access')=>createOpsManagerSession({
  credentialId:credential,deviceId:device,manager,authMode:'trusted_device',
  accessLevel:access,maximumAccessLevel:access,env}).token;
 const managerToken=token(secondManager),readOnlyToken=token(secondManager,credentialId,deviceId,'read_only');
 const q=async(sql,args=[])=>(await pool.query(sql,args)).rows[0]?.result;
 const counts=()=>q(`select jsonb_build_object('parents',(select count(*) from public.static_weekly_recurring_confirmations),
  'sources',(select count(*) from public.static_weekly_authority_source_documents),
  'publications',(select count(*) from public.weekly_schedule_publications),
  'proofs',(select count(*) from public.static_weekly_recurring_acceptance_proofs),
  'targets',(select count(*) from public.static_weekly_recurring_application_intents)) as result`);
 let checkedOut=0,maxCheckedOut=0,loseCommit=false,traceConfirm=false,confirmStart=0;
 const trace=(phase)=>{if(traceConfirm)console.log('ACTUAL_RECURRING_HTTP_CONFIRM_BOUNDARY',phase,Math.round(performance.now()-confirmStart));};
 const transportFailure=(phase,error)=>{
  if(!traceConfirm)return;
  // Synchronous, bounded, nonsecret output survives even if cleanup waits for
  // an in-flight transaction. The sidecar is optional and never overwritten.
  captureRecurringHttpTransportFailure(error,{phase,elapsedMilliseconds:Math.round(performance.now()-confirmStart),
   emit:fact=>writeSync(1,`ACTUAL_RECURRING_HTTP_TRANSPORT_FAILURE ${JSON.stringify(fact)}\n`),
   persist:fact=>{if(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE)writeFileSync(
    process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE+'.first-confirm-transport.json',JSON.stringify(fact)+'\n',{flag:'wx',mode:0o600});}});
 };
 const onProcessExit=(code)=>{
  if(traceConfirm)try{writeSync(1,`ACTUAL_RECURRING_HTTP_CONFIRM_BOUNDARY process_exit_code:${Number.isSafeInteger(code)?code:'OTHER'} ${Math.round(performance.now()-confirmStart)}\n`);}catch{}
 };
 const database={async connect(){trace('sql_connect_start');checkedOut++;maxCheckedOut=Math.max(maxCheckedOut,checkedOut);
  const client=await pool.connect();trace('sql_connect_acquired');return{on:client.on.bind(client),removeListener:client.removeListener.bind(client),
   async query(sql,args){const boundary=recurringHttpSqlBoundary(sql);
    if(boundary)trace(`sql_start:${boundary}`);
    let result;
    try{result=await client.query(sql,args);}catch(error){if(boundary)trace(`sql_rejected:${boundary}`);throw error;}
    if(boundary)trace(`sql_complete:${boundary}`);
    if(sql==='commit'&&loseCommit){loseCommit=false;trace('synthetic_commit_response_lost');throw Object.assign(new Error('synthetic lost COMMIT response after acceptance'),{code:'08006'});}
    return result;},release(error){trace('sql_client_release');checkedOut--;client.release(error);}};},async end(){}};
 const plane=createStaticWeeklyControlPlane({database,shutdownCompiler:async()=>{},
  compilerPreparer:recurringHttpCompilerProbe(compileAndPrepareStaticWeeklyScheduleIsolated,trace)});
 const leaseCalls=[];
 const supabase={async rpc(name,args){
  leaseCalls.push({name,args});
  if(name==='custodial_begin_application_mutation_lease')trace('restore_lease_begin');
  if(name==='custodial_release_application_mutation_lease')trace('restore_lease_release');
  if(name==='custodial_heartbeat_application_mutation_lease')trace('restore_lease_heartbeat');
  if(name==='custodial_begin_application_mutation_lease')return{data:{mutations_paused:false,state:'READY',authority_generation:0,restore_id:null},error:null};
  if(name==='custodial_release_application_mutation_lease'||name==='custodial_heartbeat_application_mutation_lease')return{data:true,error:null};
  throw new Error(`Unexpected synthetic restore lease call: ${name}`);
 }};
 let server=null,requestAdapter=null;
 try{
  const runtime=createStaticWeeklyControlPlaneRuntime({env,database,controlPlane:plane,supabase,trustedDeviceStore});
  server=createServer(runtime.app);await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  server.prependListener('request',(req,res)=>{
   if(!traceConfirm||req.method!=='POST'||req.url!=='/static-weekly/recurring-adaptation/confirm')return;
   trace('http_server_request_received');
   res.once('finish',()=>{trace(`http_server_response_finished:${res.statusCode}`);
    queueMicrotask(()=>trace(`restore_gate_signal_after_finish:${req.restoreMutationLease?.signal?.aborted===true?'ABORTED':'NOT_OBSERVED'}`));});
   res.once('close',()=>{trace(`http_server_response_closed:${res.writableFinished?'FINISHED':'UNFINISHED'}`);
    // The gate's own close listener is registered later in middleware; inspect
    // only after every synchronous close listener has run.
    queueMicrotask(()=>trace(`restore_gate_signal_after_close:${req.restoreMutationLease?.signal?.aborted===true?'ABORTED':req.restoreMutationLease?'LIVE':'MISSING'}`));});
  });
  const origin=`http://127.0.0.1:${server.address().port}`;
  if(requestAdapterFactory){
   requestAdapter=await requestAdapterFactory({origin});
   assert.equal(typeof requestAdapter?.request,'function','browser request adapter must expose request');
  }
  const request=async(method,route,body,authorization=managerToken)=>{
   if(traceConfirm)trace('http_client_request_start');
   if(requestAdapter){
    try{
     const reply=await requestAdapter.request({origin,method,route,body,authorization});
     assert.ok(Number.isInteger(reply?.status)&&reply.status>=100&&reply.status<=599,'browser HTTP status');
     assert.ok(reply.body&&typeof reply.body==='object'&&!Array.isArray(reply.body),'browser JSON envelope');
     if(traceConfirm)trace(`http_client_response_headers:${reply.status}`);
     if(traceConfirm)trace('http_client_response_body_complete');
     return reply;
    }catch(error){rethrowOriginalTransportError(error,()=>transportFailure('browser_adapter',error));}
   }
   let response;
   try{response=await fetch(origin+route,{method,headers:{...(authorization?{Authorization:`Bearer ${authorization}`}:{ }),
    ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
   catch(error){rethrowOriginalTransportError(error,()=>transportFailure('headers',error));}
   if(traceConfirm)trace(`http_client_response_headers:${response.status}`);
   let reply;
   try{reply=await response.json();}catch(error){rethrowOriginalTransportError(error,()=>transportFailure('body',error));}
   if(traceConfirm)trace('http_client_response_body_complete');
   return {status:response.status,body:reply};
  };
  const previewRoute='/static-weekly/recurring-adaptation/preview',confirmRoute='/static-weekly/recurring-adaptation/confirm';
  const revision=await q('select current_revision::integer as result from public.static_weekly_schedule_control where singleton');
  const previewBody={effective_start:week,expected_revision:revision};
  check('HTTP recurring preview requires authenticated manager',(await request('POST',previewRoute,previewBody,null)).status,401);
  const previewResponse=await request('POST',previewRoute,previewBody);
  check('HTTP authenticated preview status',previewResponse.status,200);
  const preview=previewResponse.body.data;
  check('HTTP preview remains candidate only',preview.status,'CANDIDATE_ONLY');
  check('HTTP preview changes no accepted revision',await q('select current_revision::integer as result from public.static_weekly_schedule_control where singleton'),revision);
  assert.match(preview.previewDigest,/^[a-f0-9]{64}$/);
  const confirmationKey='30000000-0000-4000-8000-000000000273';
  const confirmBody={confirmation_key:confirmationKey,effective_start:week,expected_revision:revision,preview_digest:preview.previewDigest};
  check('HTTP confirmation requires authenticated manager',(await request('POST',confirmRoute,confirmBody,null)).status,401);
  check('HTTP confirmation refuses read-only manager',(await request('POST',confirmRoute,confirmBody,readOnlyToken)).status,403);
  for(const extra of [{manager_id:originalManagerId},{candidate_source:{forged:true}},{decision:{forged:true}}])
   check('HTTP confirmation rejects caller-supplied authority',(await request('POST',confirmRoute,{...confirmBody,...extra})).status,422);
  const before=await counts();loseCommit=true;confirmStart=performance.now();traceConfirm=true;
  process.once('exit',onProcessExit);
  const uncertain=await request('POST',confirmRoute,confirmBody);
  trace('http_first_confirm_returned');traceConfirm=false;process.removeListener('exit',onProcessExit);
  check('lost COMMIT HTTP response is unavailable, not accepted',uncertain.status,503);
  check('lost COMMIT mapped to exact unavailable code',uncertain.body.code,'static_weekly_control_plane_database_unavailable');
  check('one SQL client per confirmation transaction',maxCheckedOut,1);
  const statusRoute=`/static-weekly/recurring-adaptation/confirmations/${confirmationKey}`;
  check('HTTP status denies anonymous caller',(await request('GET',statusRoute,undefined,null)).status,401);
  const status=await request('GET',statusRoute);
  check('HTTP exact-key status route',status.status,200);
  check('HTTP exact-key SQL recovery',status.body.data.state,'ACCEPTED');
  const receipt=status.body.data.receipt;
  check('accepted actor is authenticated second manager',receipt.managerId,secondManager.manager_id);
  check('accepted digest is displayed preview',receipt.previewDigest,preview.previewDigest);
  check('accepted phone evidence remains pending',[receipt.accepted,receipt.phoneDeliveryState,receipt.affectedPhonesUpdated],[true,'PENDING',false]);
  const bound=await q('select decision_json as result from public.static_weekly_recurring_publication_bindings where publication_id=$1',[receipt.publicationId]);
  check('HTTP stored complete decision equals preview',bound,preview.decision);
  const admitted=await q('select canonical_source as result from public.static_weekly_authority_source_documents where source_id=$1',[receipt.sourceId]);
  check('HTTP saved source digest equals preview',digest(admitted),preview.candidateSourceDigest);
  const proof=await q('select to_jsonb(p) as result from public.static_weekly_recurring_acceptance_proofs p where operation_id=$1',[receipt.operationId]);
  check('HTTP durable target manifest covers seven dates',new Set(proof.target_manifest.map(x=>x.serviceDate)).size,7);
  for(let day=0;day<7;day++){
   const date=new Date(Date.parse(week+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
   const authority=await q('select to_jsonb(a) as result from public.static_weekly_v6_schedule_authority_state($1) a',[date]);
   check(date+' HTTP acceptance bound current pair',[authority.projection_status,authority.publication_id,authority.projection_id],
    ['current',receipt.publicationId,receipt.projectionId]);
  }
  const after=await counts();assert.notDeepEqual(after,before);
  const retried=await Promise.all([request('POST',confirmRoute,confirmBody),request('POST',confirmRoute,confirmBody)]);
  for(const retry of retried){check('HTTP same-key retry status',retry.status,200);check('HTTP retry returns exact saved receipt',retry.body.data.receipt,receipt);}
  check('HTTP concurrent retries append nothing',await counts(),after);
  const conflict=await request('POST',confirmRoute,{...confirmBody,preview_digest:'0'.repeat(64)});
  check('HTTP changed same-key command conflicts',conflict.status,409);
  check('HTTP conflicting retry appends nothing',await counts(),after);
  const otherManager={manager_id:originalManagerId,display_name:'Synthetic Full Source Manager',roles:['OPS_MANAGER','CUSTODIAL_MANAGER'],active:true};
  const otherCredential='synthetic-other-manager-http-credential',otherDevice='synthetic-other-manager-http-device';
  enrolledRows.set(otherCredential,enrolled(otherManager,otherCredential,otherDevice));
  const otherStatus=await request('GET',statusRoute,undefined,token(otherManager,otherCredential,otherDevice));
  check('different authenticated manager status route',otherStatus.status,200);
  check('different manager sees no private operation',otherStatus.body.data.state,'NOT_FOUND');
  enrolledRows.get(credentialId).revoked_at=new Date().toISOString();
  check('revoked current credential cannot read status',(await request('GET',statusRoute)).status,401);
  enrolledRows.get(credentialId).revoked_at=null;
  check('changed device cannot use same credential',(await request('GET',statusRoute,undefined,token(secondManager,credentialId,'different-synthetic-device'))).status,401);
  const deliveryRoute=`/static-weekly/recurring-adaptation/delivery?service_date=${week}`;
  const delivery=await request('GET',deliveryRoute);
  check('HTTP delivery read authenticated',delivery.status,200);
  check('no phone is claimed updated',delivery.body.data.affectedPhonesUpdated,false);
  check('HTTP delivery readback is not provider acceptance',delivery.body.data.reportedCount,0);
  check('HTTP delivery read appends nothing',await counts(),after);
  assert.ok(leaseCalls.some(x=>x.name==='custodial_begin_application_mutation_lease'));
  assert.ok(leaseCalls.some(x=>x.name==='custodial_release_application_mutation_lease'));
  const confirmationProof={status:'PASS',scope:'authenticated Express to real manager control plane and SQL; synthetic trusted store and restore lease; no provider or phone',
   receipt,targetCount:proof.target_manifest.length,routePortScope:'loopback_ephemeral_only',production:false,independentAudit:false};
  if(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE+'.confirmation-http.json',
   JSON.stringify(confirmationProof)+'\n',{flag:'wx'});
  return confirmationProof;
 }finally{
  try{if(requestAdapter?.close)await requestAdapter.close();}
  finally{
   try{if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
   finally{
    await plane.close();
    assert.equal(checkedOut,0,'all SQL clients released');
   }
  }
 }
}
