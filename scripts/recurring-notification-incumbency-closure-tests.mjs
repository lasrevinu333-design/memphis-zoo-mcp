// Corrected53 qualifier specificity repair only. No original52 race claim.
// Synthetic isolated prerequisites feed actual accepted-exception/digest/v6 readers; no manager staffing acceptance.
// Test-only fixed complete source identities. This is independent expected DATA,
// never collected from installed triggers or the migration's own arrays.
// B1: closures -> effective incumbency ranges -> accepted exceptions -> v6
// projection digest. Synthetic closure prerequisites below are NOT a supported
// manager staffing acceptance, receipt, or real employee/device mutation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export const EXPECTED_NOTIFICATION_PLAN_SOURCE_RELATIONS=Object.freeze([
 "public.completion_responses",
 "public.coverage_templates",
 "public.custodial_dated_activations",
 "public.custodial_dated_occurrences",
 "public.custodial_dated_publications",
 "public.custodial_employee_device_assignment_history",
 "public.custodial_offline_actor_contexts",
 "public.custodial_offline_reconciliation_records",
 "public.custodial_offline_scan_event_evidence",
 "public.custodial_offline_submission_proofs",
 "public.daily_group_assignments",
 "public.daily_schedule_assignments",
 "public.daily_work_roster",
 "public.device_auth_credentials",
 "public.device_notification_acknowledgements",
 "public.devices",
 "public.employee_native_lunch_dispatch_attempts",
 "public.employee_native_push_delivery_receipts",
 "public.employee_native_push_generations",
 "public.employee_push_registrations",
 "public.employee_shift_templates",
 "public.employees",
 "public.location_group_memberships",
 "public.location_group_workload_settings",
 "public.location_groups",
 "public.locations",
 "public.msg_device_assignments",
 "public.msg_users",
 "public.operating_hours",
 "public.operational_notification_jobs",
 "public.sessions",
 "public.static_weekly_authority_source_documents",
 "public.static_weekly_contractor_capacity_registrations",
 "public.static_weekly_recurring_application_intents",
 "public.static_weekly_recurring_application_receipts",
 "public.static_weekly_recurring_invalidations",
 "public.static_weekly_recurring_publication_bindings",
 "public.static_weekly_recurring_terminal_intents",
 "public.static_weekly_recurring_terminal_receipts",
 "public.static_weekly_staffing_absence_cancellations",
 "public.static_weekly_staffing_absences",
 "public.system_settings",
 "public.weekly_roster_slot_incumbencies",
 "public.weekly_roster_slot_incumbency_closures",
 "public.weekly_roster_slot_staffing_states",
 "public.weekly_roster_slots",
 "public.weekly_schedule_command_receipts",
 "public.weekly_schedule_compiled_projections",
 "public.weekly_schedule_exception_commands",
 "public.weekly_schedule_lunch_documents",
 "public.weekly_schedule_occurrences",
 "public.weekly_schedule_publications",
 "public.weekly_schedule_versions"
]);

// Invoked only in the existing network-none owned DB after all original89
// SQL/HTTP/native-binding checks. Three already-owned separate clients, one
// original90 phase deadline. No guard disable/row deletion/clock override.
export async function testIncumbencyClosureSourceBoundary({client,writer,reader,fixture:f,check,deadlineAt}){
 assert.ok(Number.isFinite(deadlineAt));
 const remaining=()=>assert.ok(performance.now()<deadlineAt,'original SQL phase deadline; no renewal');
 const guard=()=>reader.query('select public.static_weekly_v27_lock_notification_plan_sources()');
 const row=async c=>(await c.query('select effective_end::text value from public.v_weekly_roster_slot_incumbency_ranges where incumbency_id=$1',[prior.incumbency_id])).rows[0].value;
 remaining();
 const candidates=(await client.query(`select i.incumbency_id,i.slot_id,i.person_id,i.person_name_snapshot,i.effective_start::text
  from public.v_weekly_roster_slot_incumbency_ranges i where person_id=$1 and effective_start<$2::date
  and (effective_end is null or $2::date<effective_end)
  and not exists(select 1 from public.weekly_roster_slot_incumbency_closures c where c.closed_incumbency_id=i.incumbency_id)
  order by i.incumbency_id limit 2`,[f.employee,f.serviceDate])).rows;
 assert.equal(candidates.length,1,'ONE genuine fixture incumbent required, no arbitrary adopted row');const prior=candidates[0];
 const revision=(await client.query(`select r.authority_revision from public.weekly_schedule_authority_revisions r
  where not exists(select 1 from public.weekly_roster_slot_incumbency_closures c where c.authority_revision=r.authority_revision)
  order by r.authority_revision desc limit 1`)).rows[0]?.authority_revision;
 assert.ok(revision,'existing genuine official fixture revision required');const replacement=randomUUID(),closure=randomUUID();
 const beforeEnd=await row(client);
 const replacementPerson=f.slots.find(slot=>slot.person!==prior.person_id);
 assert.ok(replacementPerson&&replacementPerson.person!==prior.person_id,'actual separate existing fixture person required');
 const absenceId=f.datedOperation,absenceEntry=absenceId+':'+f.serviceDate;
 const semantic=async c=>(await c.query(`select
  public.static_weekly_accepted_exception_set($1::uuid,date_trunc('week',$2::date)::date) body,
  public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set($1::uuid,date_trunc('week',$2::date)::date)) digest,
  (select to_jsonb(a) from public.static_weekly_v6_schedule_authority_state($2::date) a) authority`,
  [f.delivery.target.publicationId,f.serviceDate])).rows[0];
 const initialSemantic=await semantic(client);
 const absenceCount=x=>x.body.filter(e=>e.id===absenceEntry).length;
 check([initialSemantic.authority.projection_status,initialSemantic.authority.projection_id,absenceCount(initialSemantic)],
  ['current',f.projectionId,0],'actual original projection current before synthetic semantic prerequisites');
 // Only prerequisite same-slot/DIFFERENT-existing-person replacement DATA and
 // explicitly synthetic absence boundary DATA are committed here.
 // A future/current boundary closure itself is the raced statement; no source
 // or authority write from prerequisite setup remains open during either race.
 await client.query('begin');try{
  await client.query("set local statement_timeout='3000ms'");
  const inserted=await client.query(`insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,
   effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
   values($1,$2,$3,$4,$5,$6,'Synthetic closure-boundary DATA',repeat('b',64))`,
   [replacement,prior.slot_id,replacementPerson.person,replacementPerson.name,f.serviceDate,f.manager]);
  assert.equal(inserted.rowCount,1);
  // Use the exact existing synthetic ACCEPTED dated fixture tuple, not a new
  // manager operation or invented public acceptance. No guard is disabled.
  const absence=await client.query(`insert into public.static_weekly_staffing_absences
   (absence_id,employee_id,absence_kind,start_date,end_date,accepted_operation_id,accepted_revision,accepted_by_manager_id)
   select operation_id,employee_id,absence_kind,start_date,end_date,operation_id,accepted_revision,confirmed_by_manager_id
   from public.static_weekly_staffing_commands where operation_id=$1 and employee_id=$2
    and start_date=$3::date and end_date=$3::date and state='ACCEPTED' and command_kind='absence'`,
   [absenceId,f.employee,f.serviceDate]);
  assert.equal(absence.rowCount,1,'one exact synthetic dated-boundary tuple required');
  remaining();await client.query('commit');
 }catch(error){await client.query('rollback');throw error;}
 assert.equal(await row(client),beforeEnd,'prerequisite alone does not close prior range');
 const pendingSemantic=await semantic(client);
 check([absenceCount(pendingSemantic),pendingSemantic.digest!==initialSemantic.digest,pendingSemantic.authority.projection_status],
  [1,true,'missing_projection'],'actual accepted-exception/digest/v6 change from explicit synthetic absence prerequisite');
 const insert=()=>writer.query(`insert into public.weekly_roster_slot_incumbency_closures(incumbency_closure_id,closed_incumbency_id,
  replacement_incumbency_id,closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest)
  values($1,$2,$3,$4,$5,$6,'Synthetic closure-boundary DATA',repeat('c',64))`,
  [closure,prior.incumbency_id,replacement,f.serviceDate,revision,f.manager]);
 const begin=async()=>{remaining();await writer.query('begin');await reader.query('begin');
  await writer.query("set local statement_timeout='3000ms';set local lock_timeout='250ms'");
  await reader.query("set local statement_timeout='3000ms';set local lock_timeout='250ms'");};
 const settle=async()=>{try{await reader.query('rollback');}finally{await writer.query('rollback');}};
 // Pre-existing closure INSERT must retain the shared source fence, even
 // though no other selected source/authority writer ran in that transaction.
 await begin();try{
  await insert();assert.equal(await row(writer),f.serviceDate,'actual closure changes effective range inside writer');
  const closedSemantic=await semantic(writer);
  check([absenceCount(closedSemantic),closedSemantic.digest,closedSemantic.authority.projection_status,closedSemantic.authority.projection_id],
   [0,initialSemantic.digest,'current',f.projectionId],'actual closure removes former-person absence and restores original accepted-exception digest/v6 projection');
  let refusal;try{await guard();}catch(error){refusal=error;}
  check([refusal?.code,refusal?.message],['40001','normal notification plan source busy'],'specific new source-fence reader refusal, never authority-busy substitution');
  remaining();
 }finally{await settle();}
 assert.equal(await row(client),beforeEnd,'first closure race rolled back actual boundary');
 // Corrected53 only: require refusal from the actual new writer source-fence
 // function. A generic55P03 from an older authority/table path is insufficient.
 await begin();try{
  await guard();let refusal;try{await insert();}catch(error){refusal=error;}
  check([refusal?.code,typeof refusal?.where==='string'&&refusal.where.includes('static_weekly_v27_notification_plan_source_write_fence()')],['55P03',true],'specific new writer source-fence refusal, never generic authority/table substitution');
  await writer.query('rollback');
  check(await row(reader),beforeEnd,'refused closure leaves actual effective range unchanged');
  assert.deepEqual(await semantic(reader),pendingSemantic,'specific source-fence refusal preserves actual exception/digest/v6 result');
  remaining();
 }finally{await settle();}
 return{scope:'SOURCE53_SPECIFIC_SOURCE_FENCE_AND_ACTUAL_ACCEPTED_EXCEPTION_V6_SEMANTIC_CHANGE',
  actualAcceptedExceptionDigestChanged:true,actualV6ProjectionChanged:true,syntheticAbsencePrerequisite:true,
  actualClosureInsertReached:true,syntheticBoundaryPrerequisites:true,managerAcceptance:false};
}
