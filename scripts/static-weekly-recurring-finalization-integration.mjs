import assert from 'node:assert/strict';

// Called after real pending-parent projection/lunch creation. Savepoints keep
// the outer uncompleted-parent rollback proof independent of these checks.
export async function testRecurringFinalization({client,managerId,confirmationKey,publicationId,projectionId,week,check}) {
 const q=async(sql,args=[])=>(await client.query(sql,args)).rows[0]?.result;
 const roles=['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'];
 const signature='public.static_weekly_v23_finalize_recurring_confirmation(uuid,uuid)';
 const finalize=async(manager=managerId)=>{
  await client.query('set local role static_weekly_control_plane');
  await client.query("set local statement_timeout='120000ms'");
  const started=performance.now();
  const receipt=await q('select public.static_weekly_v23_finalize_recurring_confirmation($1,$2) as result',[manager,confirmationKey]);
  console.log('RECURRING_FINALIZER_DURATION_MS',Math.round(performance.now()-started));
  await client.query('reset role');return receipt;
 };
 const counts=()=>q(`select jsonb_build_array((select count(*) from public.static_weekly_recurring_application_intents),
  (select count(*) from public.static_weekly_recurring_acceptance_proofs),
  (select count(*) from public.static_weekly_recurring_confirmation_receipts)) as result`);
 const rejected=async(label,work,pattern)=>{await client.query('savepoint finalization_reject');
  try{await assert.rejects(work,pattern,label);check(label,true,true);}finally{await client.query('rollback to savepoint finalization_reject');}};
 for(const role of roles)check('finalizer precise runtime privilege '+role,
  await q('select has_function_privilege($1,$2,\'EXECUTE\') as result',[role,signature]),role==='static_weekly_control_plane');
 for(const role of roles)await rejected('acceptance proof direct access denied '+role,async()=>{
  await client.query('set local role '+role);await client.query('select * from public.static_weekly_recurring_acceptance_proofs');},/permission denied/);
 check('acceptance proof FORCE RLS',await q("select relrowsecurity and relforcerowsecurity as result from pg_class where oid='public.static_weekly_recurring_acceptance_proofs'::regclass"),true);
 await rejected('finalizer rejects unknown manager',()=>finalize('92000000-0000-4000-8000-000000000099'),/manager/);
 const originalCounts=await counts();
 for(const table of ['static_weekly_recurring_acceptance_proofs','static_weekly_recurring_confirmation_receipts']){
  await client.query('savepoint finalization_injected_failure');
  try{
   await client.query(`create function public.test_recurring_finalization_fail() returns trigger language plpgsql as $$begin raise exception 'injected finalization write failure';end$$;
    create trigger test_recurring_finalization_fail before insert on public.${table} for each row execute function public.test_recurring_finalization_fail()`);
   await rejected('failure at '+table+' rejects whole acceptance',()=>finalize(),/injected finalization write failure/);
   check('failure at '+table+' rolls back new targets and receipt',await counts(),originalCounts);
  }finally{await client.query('rollback to savepoint finalization_injected_failure');}
 }
 await client.query('savepoint complete_finalization');let evidence;
 try{
  const receipt=await finalize();
  check('final receipt exact accepted source projection',[receipt.accepted,receipt.publicationId,receipt.projectionId,receipt.effectiveStart],
   [true,publicationId,projectionId,week]);
  check('acceptance never asserts phones updated',[receipt.phoneDeliveryState,receipt.affectedPhonesUpdated],['PENDING',false]);
  const proof=await q('select to_jsonb(p) as result from public.static_weekly_recurring_acceptance_proofs p where operation_id=$1',[receipt.operationId]);
  check('acceptance proof binds receipt revision',Number(proof.accepted_revision),receipt.authorityRevision);
  check('manifest hashes exact target set',proof.target_manifest_digest,
   await q('select public.static_weekly_digest_jsonb(target_manifest) as result from public.static_weekly_recurring_acceptance_proofs where operation_id=$1',[receipt.operationId]));
  check('all seven dates in durable initial target set',new Set(proof.target_manifest.map(x=>x.serviceDate)).size,7);
  const actual=await q(`select jsonb_agg(jsonb_build_object('intentId',i.intent_id,'serviceDate',i.service_date,
   'employeeId',i.employee_id,'deviceId',i.device_id,'credentialId',i.credential_id,'assignmentEpoch',i.assignment_epoch,
   'targetDigest',i.target_digest,'viewDigest',i.view_digest) order by i.service_date,i.employee_id,i.device_id nulls first,i.credential_id nulls first,i.intent_id) as result
   from public.static_weekly_recurring_application_intents i where i.operation_id=$1 and i.projection_id=$2`,[receipt.operationId,projectionId]);
  check('manifest names every exact durable target',proof.target_manifest,actual);
  const after=await counts();
  check('successful parent finalizer exact replay',await finalize(),receipt);
  check('replay appends nothing',await counts(),after);
  await client.query('set constraints trg_recurring_confirmation_complete immediate');
  check('deferred parent guard accepts completed exact receipt',true,true);
  await client.query('set constraints trg_recurring_confirmation_complete deferred');
  await client.query('set local role static_weekly_control_plane');
  const status=await q('select public.static_weekly_v13_read_recurring_confirmation($1,$2) as result',[managerId,confirmationKey]);
  await client.query('reset role');check('exact parent status returns original accepted receipt',status.receipt,receipt);
  await rejected('proof remains immutable',()=>client.query('delete from public.static_weekly_recurring_acceptance_proofs'),/immutable|append-only/);
  const recovery=(await client.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[signature])).rows;
  check('finalizer recovery inventory',recovery.map(x=>x.object_kind),['function','grant']);
  await client.query('drop function '+signature);for(const row of recovery)await client.query(row.definition_sql);
  check('restored finalizer exact replay',await finalize(),receipt);
  check('restored finalizer retains minimal grant',await q("select has_function_privilege('service_role',$1,'EXECUTE') as result",[signature]),false);
  evidence={status:'PASS',scope:'real SQL constrained finalizer, initial-week targets, injected failure rollback, deferred guard, receipt replay and recovery inside rolled-back parent; not HTTP or phone proof',
   targetCount:proof.target_manifest.length,production:false,independentAudit:false};
 }finally{await client.query('rollback to savepoint complete_finalization');}
 check('finalization proof rollback leaves outer parent incomplete',await counts(),originalCounts);
 return evidence;
}
