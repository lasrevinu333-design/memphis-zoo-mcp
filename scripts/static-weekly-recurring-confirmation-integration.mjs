import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';
import {testRecurringDelivery} from './static-weekly-recurring-delivery-integration.mjs';
import {prepareScheduleReminderProjectionProof} from './schedule-bound-reminder-integration.mjs';

// Called only by the validated network-none disposable-database harness.
// Exercise the actual production JS owner and stored procedures, including a
// deliberately lost COMMIT response. This does not impersonate a live device.
export async function testRecurringConfirmation({pool,week,originalManagerId,check}) {
 const manager={manager_id:'10000000-0000-4000-8000-000000000273',manager_display_name:'Second synthetic recurring manager',
  auth_mode:'trusted_device',trusted_device:true,read_only:false};
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,$2,array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[manager.manager_id,manager.manager_display_name]);
 let connections=0,loseCommit=false,active=0,maxActive=0;
 const database={async connect(){connections++;active++;maxActive=Math.max(maxActive,active);const client=await pool.connect();
  return{on:client.on.bind(client),removeListener:client.removeListener.bind(client),
   async query(sql,args){const started=performance.now(),result=await client.query(sql,args);
    const phase=sql.match(/public\.(static_weekly_v(?:13_begin_recurring_confirmation|14_admit_recurring_source|3_create_draft|3_publish_draft|18_bind_recurring_publication|3_materialize_projection|23_finalize_recurring_confirmation))\(/)?.[1];
    if(phase)console.log('ACTUAL_RECURRING_RPC_COMPLETE',phase,Math.round(performance.now()-started));
    if(sql==='commit'&&loseCommit){loseCommit=false;throw Object.assign(new Error('synthetic lost COMMIT response AFTER database acceptance'),{code:'08006'});}
    return result;},release(error){active--;client.release(error);}};},async end(){}};
 const plane=createStaticWeeklyControlPlane({database,shutdownCompiler:async()=>{}});
 const q=async(sql,args=[])=>(await pool.query(sql,args)).rows[0]?.result;
 const counts=()=>q(`select jsonb_build_object('parents',(select count(*) from public.static_weekly_recurring_confirmations),
  'sources',(select count(*) from public.static_weekly_authority_source_documents),
  'publications',(select count(*) from public.weekly_schedule_publications),
  'proofs',(select count(*) from public.static_weekly_recurring_acceptance_proofs),
  'targets',(select count(*) from public.static_weekly_recurring_application_intents)) as result`);
 try{
  const finishReminderProof=process.env.STATIC_WEEKLY_TEST_REMINDER_PROJECTION==='1'
   ?await prepareScheduleReminderProjectionProof({pool,week,check}):null;
  const revision=await q('select current_revision::integer as result from public.static_weekly_schedule_control where singleton');
  console.log('ACTUAL_RECURRING_CONFIRM_SECOND_MANAGER_PREVIEW_BEGIN');
  const preview=await plane.previewRecurringStaffing({manager,effectiveStart:week,expectedRevision:revision});
  const request={manager,effectiveStart:week,expectedRevision:revision,
   confirmationKey:'30000000-0000-4000-8000-000000000273',previewDigest:preview.previewDigest};
  const before=connections;loseCommit=true;
  console.log('ACTUAL_RECURRING_SINGLE_CLIENT_CONFIRM_BEGIN');
  await assert.rejects(()=>plane.confirmRecurringStaffing(request),error=>error.code==='static_weekly_control_plane_database_unavailable');
  check('lost COMMIT response uses exactly one checked-out client',connections-before,1);
  check('confirmation never creates nested client ownership',maxActive,1);
  const status=await plane.getRecurringConfirmationStatus({manager,confirmationKey:request.confirmationKey});
  check('exact status resolves real lost COMMIT response',status.state,'ACCEPTED');
  const receipt=status.receipt;
  check('second named manager owns actual acceptance',receipt.managerId,manager.manager_id);
  check('actual acceptance binds displayed decision',receipt.previewDigest,preview.previewDigest);
  check('actual acceptance keeps phone evidence pending',[receipt.accepted,receipt.phoneDeliveryState,receipt.affectedPhonesUpdated],[true,'PENDING',false]);
  const bound=await q('select decision_json as result from public.static_weekly_recurring_publication_bindings where publication_id=$1',[receipt.publicationId]);
  check('stored complete decision equals second manager preview',bound,preview.decision);
  const admitted=await q('select canonical_source as result from public.static_weekly_authority_source_documents where source_id=$1',[receipt.sourceId]);
  check('accepted source exact preview hash',digest(admitted),preview.candidateSourceDigest);
  const proof=await q('select to_jsonb(p) as result from public.static_weekly_recurring_acceptance_proofs p where operation_id=$1',[receipt.operationId]);
  check('actual committed parent has seven-date durable target manifest',new Set(proof.target_manifest.map(x=>x.serviceDate)).size,7);
  for(let day=0;day<7;day++){
   const date=new Date(Date.parse(week+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
   const authority=await q('select to_jsonb(a) as result from public.static_weekly_v6_schedule_authority_state($1) a',[date]);
   check(date+' actual committed exact current pair',[authority.projection_status,authority.publication_id,authority.projection_id],['current',receipt.publicationId,receipt.projectionId]);
  }
  const after=await counts();
  const retries=await Promise.all([plane.confirmRecurringStaffing(request),plane.confirmRecurringStaffing(request)]);
  for(const retry of retries)check('concurrent original request returns exact original receipt',retry.receipt,receipt);
  check('concurrent accepted retries append nothing',await counts(),after);
  await assert.rejects(()=>plane.confirmRecurringStaffing({...request,previewDigest:'0'.repeat(64)}),/idempotency conflict/);
  check('changed same-key request creates no new state',await counts(),after);
  const unrelated=await plane.getRecurringConfirmationStatus({manager:{...manager,manager_id:originalManagerId},confirmationKey:request.confirmationKey});
  check('different manager cannot resolve another manager key',unrelated.state,'NOT_FOUND');
  const confirmationProof={status:'PASS',scope:'actual SQL and production JS single-client confirmation COMMIT, second manager, lost response, exact recovery, concurrent retry and seven-date targets; not HTTP or phone proof',
   operationId:receipt.operationId,receipt,targetCount:proof.target_manifest.length,production:false,independentAudit:false};
  // Preserve a completed owning proof even if the following independent
  // delivery component fails. This never relabels the combined run PASS.
  if(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE+'.confirmation.json',JSON.stringify(confirmationProof)+'\n',{flag:'wx'});
  const delivery=process.env.STATIC_WEEKLY_TEST_RECURRING_DELIVERY==='1'
   ?await testRecurringDelivery({pool,week,managerId:manager.manager_id,receipt,check}):null;
  const reminderProjection=finishReminderProof?await finishReminderProof(receipt):null;
  return{...confirmationProof,delivery,reminderProjection};
 }finally{await plane.close();}
}
