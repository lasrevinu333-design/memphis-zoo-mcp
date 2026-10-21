import assert from 'node:assert/strict';
import {prepareRecurringCandidateIsolated} from '../src/static-weekly-schedule-compiler-runtime.js';
import {assertRecurringManagerDecision} from '../src/static-weekly-recurring-preview.js';
import {recurringPatternAuthority,assertRecurringRepairCandidate} from '../src/static-weekly-recurring-repair-basis.js';

// Runs within the real compiler/publication fixture's still-uncommittable
// parent. These are real SQL target primitives, not live phone acceptance or
// proof that automatic mutation hooks / HTTP consumers have been integrated.
export async function testRecurringTerminalTargets({client,managerId,publicationId,oldPublicationId,week,check}){
 const id=n=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const q=async(sql,args=[])=>(await client.query(sql,args)).rows[0]?.result;
 const rpc=(name,args)=>q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
 const revision=()=>q('select current_revision::int as result from public.static_weekly_schedule_control where singleton');
 const addDate=n=>new Date(Date.parse(week+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const rejected=async(label,action,pattern)=>{
  await client.query('savepoint hostile_terminal');
  try{await assert.rejects(action,pattern,label);check(label,true,true);}
  finally{await client.query('rollback to savepoint hostile_terminal');}
 };
 await client.query('savepoint terminal_primitives');
 const initialRevision=await revision();
 const initialCounts=await q("select jsonb_build_array((select count(*) from public.static_weekly_recurring_invalidations),(select count(*) from public.static_weekly_recurring_terminal_intents),(select count(*) from public.static_weekly_recurring_terminal_receipts)) as result");
 let evidence;
 try{
  const args=[managerId,id(1),publicationId,week,null,'ROSTER_DEPENDENCY_CHANGED','c'.repeat(64),initialRevision];
  const invalidate=(a=args)=>rpc('static_weekly_v19_invalidate_recurring_range',a);
  const reconcile=date=>rpc('static_weekly_v19_reconcile_terminal_date',[date]);
  const range=date=>q('select to_jsonb(public.static_weekly_v19_current_terminal_range($1)) as result',[date]);
  const tables=['static_weekly_recurring_invalidations','static_weekly_recurring_invalidated_principals',
   'static_weekly_recurring_terminal_intents','static_weekly_recurring_terminal_receipts'];
  for(const table of tables){
   check('terminal table FORCE RLS '+table,await q('select relrowsecurity and relforcerowsecurity as result from pg_class where oid=$1::regclass',['public.'+table]),true);
   for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
    await rejected('terminal table denied '+role+' '+table,async()=>{await client.query('set local role '+role);await client.query('select * from public.'+table);},/permission denied/);
  }
  for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'])
   await rejected('terminal invalidator private '+role,async()=>{await client.query('set local role '+role);await invalidate();},/permission denied/);
  const today=await q('select public.sch_service_date(statement_timestamp())::text as result');
  await rejected('cannot invalidate today as a future recurring change',()=>invalidate([...args.slice(0,3),today,...args.slice(4)]),/affected future range/);
  await rejected('cannot invalidate old same-Monday predecessor',()=>invalidate([managerId,id(1),oldPublicationId,...args.slice(3)]),/affected future range/);
  const blocked=await invalidate();
  check('terminal invalidation advances global revision',await revision(),initialRevision+1);
  check('terminal does not claim phone update',blocked.affectedPhonesUpdated,false);
  check('terminal range is durable without a materialized target',blocked.state,'BLOCKED_RECURRING_AUTHORITY');
  if(process.env.STATIC_WEEKLY_TEST_RECURRING_REPAIR==='1'){
   const authority=await q('select to_jsonb(s) as result from public.static_weekly_v6_schedule_authority_state($1) s',[week]);
   check('ordinary schedule authority reports durable blocked state',authority.projection_status,'blocked_recurring_authority');
   check('blocked authority retains invalidated winner identity',authority.publication_id,publicationId);
   check('blocked authority exposes no projection',authority.projection_id,null);
   check('blocked authority revision is invalidation revision',Number(authority.projection_authority_revision),blocked.authorityRevision);
   check('ordinary schedule segments cannot return older publication',await q('select count(*)::int as result from public.static_weekly_v6_read_schedule_segments($1)',[week]),0);
   await rejected('ordinary source reader cannot revive blocked publication',async()=>{
    await client.query('set local role static_weekly_control_plane');
    await rpc('static_weekly_v3_read_publication_source',[publicationId,week]);
   },/blocked pending explicit manager repair/);
   await rejected('ordinary projection writer rejects blocked publication before attestation',async()=>{
    await client.query('set local role static_weekly_control_plane');
    await rpc('static_weekly_v3_materialize_projection',[publicationId,week,'a'.repeat(64),'synthetic',{}, {},'a'.repeat(64),{},blocked.authorityRevision,managerId,'cannot-revive']);
   },/blocked pending explicit manager repair/);
   for(const role of ['anon','authenticated','service_role','static_weekly_release_operator','custodial_application_reader'])
    await rejected('repair basis caller denied '+role,async()=>{
     await client.query('set local role '+role);await rpc('static_weekly_v20_read_recurring_preview_basis',[managerId,week]);
    },/permission denied/);
   await client.query('set local role static_weekly_control_plane');
   const repair=await rpc('static_weekly_v20_read_recurring_preview_basis',[managerId,week]);
   await client.query('reset role');
   check('repair uses preceding source pattern explicitly',repair.publication_id,oldPublicationId);
   check('repair still CAS-binds invalidated current winner',repair.repair_context.effectivePublicationId,publicationId);
   check('repair cannot claim old publication is current',repair.repair_context.state,'REPLACING_INVALID_FUTURE');
   check('repair is not publication',[repair.repair_context.published,repair.repair_context.managerConfirmationRequired],[false,true]);
   check('repair context digest matches exact database body',repair.repair_context_digest,await q('select public.static_weekly_digest_jsonb($1) as result',[repair.repair_context]));
   check('repair source uses current requested week',repair.compiler_input.serviceDate,week);
   check('repair never imports predecessor dated exceptions',repair.exceptions,[]);
   check('repair read leaves global authority unchanged',await revision(),blocked.authorityRevision);
   check('repair read cannot select predecessor as effective',await q('select publication_id as result from public.weekly_schedule_publications where version_id=public.static_weekly_effective_version($1)',[week]),publicationId);
   await rejected('inactive or unknown manager cannot get repair basis',async()=>{
    await client.query('set local role static_weekly_control_plane');await rpc('static_weekly_v20_read_recurring_preview_basis',[id(99),week]);
   },/manager/);
   const secondManager=id(12);
   await client.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,'Synthetic second repair manager',array['CUSTODIAL_MANAGER'],true,false)",[secondManager]);
   await client.query('set local role static_weekly_control_plane');
   const secondRepair=await rpc('static_weekly_v20_read_recurring_preview_basis',[secondManager,week]);
   await client.query('reset role');
   check('different authorized manager can obtain same explicit repair basis',secondRepair,repair);
   if(process.env.STATIC_WEEKLY_TEST_RECURRING_REPAIR_WORKER==='1'){
    await client.query('set local role static_weekly_control_plane');
    const snapshot=await rpc('static_weekly_v3_read_manager_snapshot',[week]);
    await client.query('reset role');
    const basis={publishedSource:secondRepair,managerSnapshot:snapshot,effectiveDate:week,expectedRevision:blocked.authorityRevision};
    const authority=recurringPatternAuthority(basis);
    console.log('ACTUAL_SQL_REPAIR_ISOLATED_WORKER_BEGIN');
    const candidate=await prepareRecurringCandidateIsolated(basis);
    assertRecurringManagerDecision(candidate);assertRecurringRepairCandidate(candidate,authority);
    check('real SQL repair worker is explicitly candidate only',candidate.status,'CANDIDATE_ONLY');
    check('real SQL repair worker binds invalidated current winner',candidate.publicationId,publicationId);
    check('real SQL repair worker retains distinct old pattern',candidate.patternPublicationId,oldPublicationId);
    check('real SQL repair worker retains exact invalidation evidence',candidate.repairContext,repair.repair_context);
    check('real SQL repair worker feasible',[candidate.compilerStatus,candidate.publicationAuthority,candidate.verifierOk,candidate.reviewWorkCount],['FEASIBLE','ACCEPTABLE',true,0]);
    check('repair compile cannot change authority revision',await revision(),blocked.authorityRevision);
    check('repair compile cannot reactivate blocked schedule',(await q('select to_jsonb(s) as result from public.static_weekly_v6_schedule_authority_state($1) s',[week])).projection_status,'blocked_recurring_authority');
   }
  }
  check('infinite future range has no guessed end',(await range(addDate(70))).effective_end,null);
  const people=(await client.query('select employee_id from public.static_weekly_recurring_invalidated_principals where invalidation_id=$1 order by employee_id',[blocked.invalidationId])).rows.map(r=>r.employee_id);
  assert.ok(people.length>=6);check('all original employee dependencies persist without phones',people.length>=6,true);
  const replay=await invalidate();check('exact invalidation retry before stale CAS',replay.replayed,true);
  check('retry preserves original invalidation',replay.invalidationId,blocked.invalidationId);
  await rejected('changed same-key request conflicts before stale check',()=>invalidate([...args.slice(0,5),'SOURCE_RETIRED',...args.slice(6)]),/different request/);
  check('first materialization creates explicit no-device targets',await reconcile(week),people.length);
  check('same materialization retry creates no duplicate',await reconcile(week),0);
  check('all no-device records are honest pending targets',await q('select count(*)::int as result from public.static_weekly_recurring_terminal_intents where invalidation_id=$1 and service_date=$2 and device_id is null',[blocked.invalidationId,week]),people.length);
  const employee=people[0],device=id(2),credential=id(3),rotated=id(4);
  await client.query("insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values($1,'RECURRING-TERMINAL-TEST','Synthetic terminal phone',true,$2,1)",[device,employee]);
  const addCredential=(c,hash)=>client.query("insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at) values($1,$2,$3,'Synthetic terminal phone',statement_timestamp(),statement_timestamp()+interval '1 day')",[c,device,hash]);
  await addCredential(credential,'d'.repeat(64));
  const read=(date=week,cred=credential,emp=employee,epoch=1)=>rpc('static_weekly_v19_read_terminal_target',[date,device,cred,emp,epoch]);
  check('new phone cannot read usable authority before reconciliation',(await read()).applicationStatus,'PENDING_TARGET_RECONCILIATION');
  check('new phone gets exact existing blocked state',await reconcile(week),1);
  const target=await read();
  check('new target pending until exact ACK',target.applicationStatus,'PENDING');
  check('terminal type exact',target.target.targetType,'BLOCKED_RECURRING_AUTHORITY');
  check('terminal target binds original employee',target.target.employeeId,employee);
  check('terminal target digest PostgreSQL bytes',target.targetDigest,await q('select public.static_weekly_digest_jsonb($1) as result',[target.target]));
  for(const [label,cred,emp,epoch] of [['credential',id(9),employee,1],['employee',credential,people[1],1],['epoch',credential,employee,2]])
   await rejected('terminal read rejects wrong '+label,()=>read(week,cred,emp,epoch),/exact current terminal schedule principal/);
  const applied=await q('select clock_timestamp()::text as result');
  const ackArgs=[target.intentId,device,credential,employee,1,target.target.authorityRevision,target.targetDigest,applied];
  const ack=(args=ackArgs)=>rpc('static_weekly_v19_ack_terminal_target',args);
  await rejected('terminal ACK rejects wrong rendered digest',()=>ack([...ackArgs.slice(0,6),'f'.repeat(64),applied]),/exact principal target revision digest and time/);
  await rejected('terminal ACK rejects wrong revision',()=>ack([...ackArgs.slice(0,5),initialRevision,...ackArgs.slice(6)]),/exact principal target revision digest and time/);
  await rejected('terminal ACK rejects pre-target time',()=>ack([...ackArgs.slice(0,7),'2000-01-01T00:00:00Z']),/exact principal target revision digest and time/);
  const receipt=await ack();check('terminal ACK is not replacement coverage acceptance',receipt.replacementCoverageReady,false);
  check('terminal ACK repeat exact',await ack(),receipt);
  check('terminal application readback exact',(await read()).applicationStatus,'DEVICE_REPORTED_BLOCKED');
  await client.query("update public.device_auth_credentials set revoked_at=statement_timestamp(),revoked_reason='Synthetic rotation' where credential_id=$1",[credential]);
  await addCredential(rotated,'e'.repeat(64));
  await rejected('revoked credential cannot ACK successor state',()=>ack(),/exact current terminal schedule principal/);
  check('rotated credential cannot inherit predecessor ACK',(await read(week,rotated)).applicationStatus,'PENDING_TARGET_RECONCILIATION');
  check('rotation creates one exact new target',await reconcile(week),1);
  check('rotated target remains pending',(await read(week,rotated)).applicationStatus,'PENDING');
  check('rotation preserves assignment epoch',(await read(week,rotated)).target.assignmentEpoch,1);
  check('later unmaterialized week remains blocked',(await read(addDate(14),rotated)).applicationStatus,'PENDING_TARGET_RECONCILIATION');
  check('later-week reconciliation covers every principal',await reconcile(addDate(14)),people.length);
  check('later-week target retains exact invalidation',(await read(addDate(14),rotated)).target.invalidationId,blocked.invalidationId);
  // A higher global dated revision alone must not clear the terminal range.
  const datedRevision=await rpc('static_weekly_advance_authority',[await revision(),'apply_exception',managerId,'Synthetic Full Source Manager',id(5),'f'.repeat(64)]);
  assert.ok(datedRevision>blocked.authorityRevision);check('higher global revision does not clear invalid range',(await read(week,rotated)).target.invalidationId,blocked.invalidationId);
  const newer=await invalidate([managerId,id(6),publicationId,week,null,'SOURCE_RETIRED','d'.repeat(64),await revision()]);
  await reconcile(week);
  const next=await read(week,rotated);
  check('highest terminal revision wins',next.target.invalidationId,newer.invalidationId);
  check('old ACK cannot satisfy new terminal target',next.applicationStatus,'PENDING');
  for(const table of tables)await rejected('terminal history immutable '+table,
   ()=>client.query('delete from public.'+table),/immutable|append-only/);
  const signature='public.static_weekly_v19_current_terminal_range(date)';
  const recovery=(await client.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
  check('terminal selector and ACL recovery present',recovery.map(r=>r.object_kind),['function','grant']);
  await client.query('drop function '+signature);for(const entry of recovery)await client.query(entry.definition_sql);
  check('recovered terminal selector preserves latest winner',(await range(week)).invalidation_id,newer.invalidationId);
  check('recovery preserves private terminal selector',await q("select has_function_privilege('service_role',$1,'EXECUTE') as result",[signature]),false);
  evidence={status:'PASS',scope:'actual SQL private terminal range/principal/reconcile/ACK primitives in rolled-back real publication transaction',
   invalidationId:blocked.invalidationId,firstRevision:blocked.authorityRevision,newerRevision:newer.authorityRevision,
   employeeCount:people.length,phoneRuntime:'NOT_RUN',automaticMutationIntegration:'NOT_IMPLEMENTED',mergedHttpSelector:'NOT_IMPLEMENTED'};
 }finally{await client.query('rollback to savepoint terminal_primitives');}
 check('terminal transaction rollback restores exact global revision',await revision(),initialRevision);
 check('terminal transaction rollback removes range targets receipts',await q("select jsonb_build_array((select count(*) from public.static_weekly_recurring_invalidations),(select count(*) from public.static_weekly_recurring_terminal_intents),(select count(*) from public.static_weekly_recurring_terminal_receipts)) as result"),initialCounts);
 return evidence;
}
