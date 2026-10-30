import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCiFreshOnlyFixture} from './ci-fresh-only-replay.mjs';
import {runApprovedManualWeekDatabaseTest} from './approved-manual-week-database-tests.mjs';
import {prepareApprovedManualActivationPackage} from '../src/approved-manual-roster-transition.js';
import {previewApprovedManualDay} from '../src/approved-manual-week.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {captureSchemaCatalog,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';

const migration=new URL('../supabase/migrations/20261030155202_approved_manual_current_day_activation.sql',import.meta.url);
const sql=fs.readFileSync(migration,'utf8'),sha=createHash('sha256').update(sql).digest('hex');
// The optional constructor is a TEST capability, never a database URL. During
// development an exact owned Source300 fixture receives the exact appended SQL.
// Normal Source301 CI constructs the appended migration itself.
export async function runApprovedManualActivationDatabaseTest({out,constructFixture=createCiFreshOnlyFixture,constructorMigrationCount=301,sqlPhaseDiagnostic=false}){
 assert.ok(isAbsolute(out));
 const construct=async options=>{
  const fixture=await constructFixture(options);await fixture.assertOwned();
  fs.writeFileSync(resolve(out,'APPEND_FIXTURE.json'),JSON.stringify(fixture.receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  if(fixture.receipt.selected_replay.migrations===300){
   const db=new pg.Client({host:fixture.socketDirectory,database:'postgres',user:'supabase_admin',password:'postgres'});
   try{await db.connect();await db.query(sql);}catch(e){await db.query('rollback').catch(()=>{});await fixture.cleanup().catch(()=>{});throw e;}finally{await db.end();}
  }else assert.equal(fixture.receipt.selected_replay.migrations,301);
  const catalogDb=new pg.Client({host:fixture.socketDirectory,database:'postgres',user:'supabase_admin',password:'postgres'});
  try{await catalogDb.connect();await catalogDb.query('begin isolation level repeatable read read only');
   await fixture.assertOwned();const inventory=await captureSchemaCatalog(catalogDb),catalog=fingerprintSchemaCatalog(inventory);
   await catalogDb.query('rollback');
   fs.writeFileSync(resolve(out,'SOURCE301_SCHEMA_CATALOG.json'),JSON.stringify(catalog.normalized,null,2)+'\n',{flag:'wx',mode:0o600});
   fs.writeFileSync(resolve(out,'SOURCE301_SCHEMA_FINGERPRINT.json'),JSON.stringify({fingerprint:catalog.fingerprint,migrationSha256:sha,
    constructorMigrations:fixture.receipt.selected_replay.migrations,appendedMigration:301,production:false},null,2)+'\n',{flag:'wx',mode:0o600});
  }finally{await catalogDb.end();}
  return fixture;
 };
 const result=await runApprovedManualWeekDatabaseTest({out,constructFixture:construct,constructorMigrationCount,initialDate:'2026-10-19',seedFixturePeopleAt:'2020-01-01',fixturePoolMax:1,
  afterSqlQualified:async({fixture,pool,query,rpc,cp,release,week,draft,plane,managerId,manager,accepted,save})=>{
   const at=(await query('select public.sch_service_date(statement_timestamp())::text as date')).rows[0].date,
    previous=new Date(Date.parse(at+'T12:00:00Z')-86400000).toISOString().slice(0,10),
    historical=(await query('select public.static_weekly_digest_jsonb(to_jsonb(p)) as digest from public.weekly_schedule_compiled_projections p where projection_id=$1',[accepted.projection_id])).rows[0].digest;
   assert.ok(previous>'2026-10-25','Fixture predecessor must follow the independently checked historical week');
   const recorded=JSON.parse(fs.readFileSync(new URL('./fixtures/manual-live-roster-20261030.json',import.meta.url))).readback;
   // Populate the already-onboarded identities required by the new command.
   // The earlier source-only bootstrap intentionally did not need Messenger.
   // These writes are fixture setup before the no-new-identities comparison.
   for(const person of recorded.employees){
    await query('update public.employees set employee_code=$2 where id=$1',[person.employeeId,person.employeeCode]);
    await query("insert into public.msg_users(employee_id,display_name,role,is_active) select $1,$2,'employee',true where not exists(select 1 from public.msg_users where employee_id=$1)",[person.employeeId,person.displayName]);
   }
   for(const slot of recorded.rosterSlots){
    const exists=await query('select 1 from public.weekly_roster_slots where slot_id=$1',[slot.slotId]);
    if(!exists.rowCount)await query('insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,content_digest,created_by_manager_id,created_by_manager_name_snapshot) values($1,$2,$3,$4,$5,$6)',
     [slot.slotId,slot.slotCode,slot.label,'a'.repeat(64),managerId,'Manual activation fixture manager']);
   }
   // Construct the populated predecessor ONLY inside this nonnetworked owned
   // fixture. The temporary seed routine uses the real immutable-row/closure
   // guards under the control-plane role; no production safeguard is disabled.
   const setup=await pool.connect();
   try{
    await setup.query(`create function pg_temp.seed_manual_prior(p_manager uuid,p_slot uuid,p_person uuid,p_name text,p_date date,p_closed uuid,p_revision bigint)
     returns bigint language plpgsql security definer set search_path=pg_catalog,public as $f$
     declare revision bigint;incumbency uuid;content text:=public.static_weekly_digest_text(p_slot::text||p_date::text);command uuid:=gen_random_uuid();
     begin
      perform public.custodial_begin_application_mutation();
      revision:=public.static_weekly_advance_authority(p_revision,case when p_person is null then 'vacate_roster_slot' else 'replace_incumbency' end,
       p_manager,'Fixture prior roster setup',command,content);
      if p_person is not null then
       incumbency:=gen_random_uuid();
       insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
        values(incumbency,p_slot,p_person,p_name,p_date,p_manager,'Fixture prior roster setup',content);
      end if;
      insert into public.weekly_roster_slot_staffing_states(slot_id,employee_id,staffing_state,effective_start,authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
       values(p_slot,p_person,case when p_person is null then 'vacant_unfilled' else 'working' end,p_date,revision,p_manager,'Fixture prior roster setup','Populate the prior historical fixture only',content);
      insert into public.weekly_roster_slot_incumbency_closures(closed_incumbency_id,replacement_incumbency_id,closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest)
       values(p_closed,incumbency,p_date,revision,p_manager,'Fixture prior roster setup',content);
      return revision;
     end $f$`);
    const targets=week.referenceBindings.people.filter(p=>['Derrick Henderson','Jada Rawlings','Kiltra Horton','Xavier Green'].includes(p.approvedName));
    for(const target of targets){
     const old=recorded.rosterSlots.find(s=>s.slotId===target.slotId).incumbencies.find(r=>r.effectiveEnd===null),
      person=old?.personId??null,name=old?.displayName??null;
     if(person)await setup.query("insert into public.employees(id,display_name,role,active) values($1,$2,'staff',true) on conflict(id) do nothing",[person,name]);
     const live=(await setup.query('select incumbency_id from public.v_weekly_roster_slot_incumbency_ranges where slot_id=$1 and person_id=$2 and effective_end is null',[target.slotId,target.employeeId])).rows[0];assert.ok(live);
     const revision=Number((await setup.query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
     await setup.query('begin');await setup.query('set local role static_weekly_control_plane');
     try{await setup.query('select pg_temp.seed_manual_prior($1,$2,$3,$4,$5,$6,$7)',[managerId,target.slotId,person,name,previous,live.incumbency_id,revision]);await setup.query('commit');}
     catch(e){await setup.query('rollback');throw e;}
    }
   }finally{setup.release();}
   if(sqlPhaseDiagnostic){
    const instrument=async(signature,seams)=>{
     let definition=(await query('select pg_get_functiondef($1::regprocedure) as definition',[signature])).rows[0].definition;
     const before=createHash('sha256').update(definition).digest('hex');
     for(const [needle,label]of seams){assert.equal(definition.split(needle).length,2,label+' exact diagnostic seam');
      definition=definition.replace(needle,`raise log 'manual-diagnostic ${label} heap=%',(select sum(total_bytes) from pg_backend_memory_contexts);\n`+needle);}
     await query(definition);return{signature,before,after:createHash('sha256').update(definition).digest('hex')};
    };
    const changes=[];
    changes.push(await instrument('public.static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)',[
     [' for change in select value from jsonb_array_elements(packet.transfers) loop','transfers_begin'],
     [' perform public.static_weekly_manual_activation_store_baseline(p_packet);','store_baseline_begin'],
     [" initial_body:=public.static_weekly_manual_activation_initial_envelope(p_manager,p_packet,revision,p_key||':initial');",'prepare_compact_begin'],
     [' published:=public.static_weekly_materialize_approved_initial_baseline(','materialize_begin']]));
    changes.push(await instrument('public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)',[
     [' date:=(p_feasibility#>>','baseline_catalog_valid'],
     [" if p_feasibility->>'schema'",'baseline_source_hydrated'],
     [' -- Retain the existing independently implemented SQL derivation checker.','baseline_feasibility_valid'],
     [' select * into prior from public.static_weekly_approved_initial_baselines','baseline_geometry_valid'],
     ['  insert into public.static_weekly_approved_initial_baselines','baseline_insert_begin'],
     [" return jsonb_build_object('registered',true",'baseline_stored']]));
    changes.push(await instrument('public.static_weekly_manual_activation_initial_envelope(uuid,uuid,bigint,text)',[
     [' basis:=public.static_weekly_read_approved_initial_basis(','envelope_read_basis'],
     [' preview:=public.static_weekly_digest_jsonb(','envelope_hash_begin'],
     [' request:=jsonb_build_object(','envelope_hash_complete']]));
    save('DIAGNOSTIC_INSTRUMENTATION_NOT_QUALIFICATION.json',{scope:'OWNED_FIXTURE_ONLY',production:false,changes});
   }
   const snapshot=await plane.getApprovedManualActivationRoster({manager});assert.equal(snapshot.serviceDate,at);assert.equal(snapshot.rosterSlots.length,22);
   const before=await query(`select
    (select count(*)::integer from public.employees) as people,
    (select count(*)::integer from public.msg_users) as messengers,
    (select count(*)::integer from public.weekly_roster_slot_incumbencies) as incumbencies,
    (select count(*)::integer from public.weekly_roster_slot_incumbency_closures) as closures,
    (select count(*)::integer from public.weekly_roster_slots) as slots`);
   const pack=prepareApprovedManualActivationPackage({week,draft,snapshot,managerId,packetId:randomUUID(),sourceId:randomUUID(),
    versionId:randomUUID(),templatePublicationId:randomUUID(),templateId:'approved-manual-current-day-fixture'});
   assert.equal(pack.transition.transfers.length,4);assert.equal(pack.transition.transfers.filter(t=>t.closure).length,3);
   save('CURRENT_DAY_ACTIVATION_PACKAGE.json',pack);
   save('ACTIVATION_COMPONENT_SIZES.json',Object.fromEntries(Object.entries({source:pack.source,transition:pack.transition,
    feasibility:pack.feasibility,document:pack.feasibility.initialBaseline.document,projection:pack.feasibility.initialBaseline.projection})
    .map(([k,v])=>[k,Buffer.byteLength(JSON.stringify(v))])));
   console.log(JSON.stringify({activationPhase:'register_current_day_source',at:new Date().toISOString()}));
   await release('static_weekly_v3_register_authority_source',[pack.sourceId,JSON.stringify(pack.source),'Current-day fixture source']);
   console.log(JSON.stringify({activationPhase:'register_current_day_template',at:new Date().toISOString()}));
   await release('static_weekly_register_approved_template',[pack.sourceId,JSON.stringify(pack.template),JSON.stringify(pack.binding),JSON.stringify(pack.ownerConfig),JSON.stringify(pack.approvalEvidence)]);
   console.log(JSON.stringify({activationPhase:'register_current_day_packet',at:new Date().toISOString()}));
   await release('static_weekly_register_manual_activation_packet',[pack.packetId,pack.sourceId,pack.templateId,managerId,JSON.stringify(pack.transition),JSON.stringify(pack.feasibility)]);
   console.log(JSON.stringify({activationPhase:'preview_current_day_packet',at:new Date().toISOString()}));
   const input={manager,packetId:pack.packetId,expectedRevision:snapshot.authorityRevision},preview=await plane.previewApprovedManualActivation(input);
   assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.serviceDate,at);assert.equal(preview.windowEnd,pack.windowEnd);
   const key='current-day-atomic-manual-fixture',bad=await query('select current_revision from public.static_weekly_schedule_control where singleton');
   await assert.rejects(plane.activateApprovedManualSchedule({...input,previewDigest:'0'.repeat(64),idempotencyKey:key}));
   assert.equal((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision,bad.rows[0].current_revision);
   console.log(JSON.stringify({activationPhase:'confirm_atomic_current_day',at:new Date().toISOString()}));
   const result=await plane.activateApprovedManualSchedule({...input,previewDigest:preview.previewDigest,idempotencyKey:key});
   assert.equal(result.status,'PERSISTED_CURRENT');assert.equal(result.atomicRosterAndPublication,true);assert.equal(result.rosterTransfers,4);
   save('CURRENT_DAY_ACTIVATION_COMMAND_RESULT.json',result);
   const after=(await query(`select
    (select count(*)::integer from public.employees) as people,
    (select count(*)::integer from public.msg_users) as messengers,
    (select count(*)::integer from public.weekly_roster_slot_incumbencies) as incumbencies,
    (select count(*)::integer from public.weekly_roster_slot_incumbency_closures) as closures,
    (select count(*)::integer from public.weekly_roster_slots) as slots`)).rows[0],prior=before.rows[0];
   assert.equal(after.people,prior.people);assert.equal(after.messengers,prior.messengers);assert.equal(after.slots,prior.slots);
   assert.equal(after.incumbencies-prior.incumbencies,4);assert.equal(after.closures-prior.closures,3);
   assert.equal((await query('select public.static_weekly_digest_jsonb(to_jsonb(p)) as digest from public.weekly_schedule_compiled_projections p where projection_id=$1',[accepted.projection_id])).rows[0].digest,historical);
   const replay=await plane.activateApprovedManualSchedule({...input,previewDigest:preview.previewDigest,idempotencyKey:key});
   assert.equal(replay.status,'ACCEPTED_ORIGINAL_RECEIPT');assert.equal(replay.publication_id,result.publication_id);
   const recovered=await plane.getApprovedManualActivationOutcome({manager,idempotencyKey:key});assert.equal(recovered.state,'ACCEPTED');
   const referenceKey='manual-current-day-reference-refusal',referenceRevision=Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision),
    referenceBasis=await cp('static_weekly_read_approved_initial_basis',[managerId,pack.sourceId,at,referenceRevision,pack.templateId]),
    snapshotDigest=(await query('select snapshot_digest from public.static_weekly_approved_initial_baselines where source_id=$1',[pack.sourceId])).rows[0].snapshot_digest,
    referenceBody={schema:'custodial.approved-static-initial-materialization.reference.v1',managerId,sourceId:pack.sourceId,effectiveStart:at,
     expectedRevision:referenceRevision,generation:referenceBasis.generation,templateCatalogDigest:referenceBasis.templateCatalogDigest,
     feasibilityDigest:pack.feasibility.digest,baselineSnapshotDigest:snapshotDigest},referencePreview=digest(referenceBody),
    reference={...referenceBody,previewDigest:referencePreview,request:{sourceId:pack.sourceId,effectiveStart:at,templateId:pack.templateId,
     expectedRevision:referenceRevision,previewDigest:referencePreview,idempotencyKey:referenceKey}};
   // Private composition is callable only through the existing owner routine.
   await assert.rejects(cp('static_weekly_manual_activation_initial_envelope',[managerId,pack.packetId,referenceRevision,referenceKey]),e=>e.code==='42501');
   assert.equal(reference.schema,'custodial.approved-static-initial-materialization.reference.v1');
   let referenceTamperRefusals=0;
   for(const mutate of [
    body=>{body.baselineSnapshotDigest='0'.repeat(64);},
    body=>{body.feasibilityDigest='0'.repeat(64);},
    body=>{body.templateCatalogDigest='0'.repeat(64);},
    body=>{body.feasibility={};},
    body=>{body.previewDigest='0'.repeat(64);},
   ]){
    const body=structuredClone(reference);mutate(body);
    if(body.previewDigest===reference.previewDigest){const {request,previewDigest,...binding}=body;body.previewDigest=digest(binding);body.request.previewDigest=body.previewDigest;}
    await assert.rejects(cp('static_weekly_materialize_approved_initial_baseline',[managerId,pack.sourceId,at,referenceRevision,reference.generation,referenceKey,body]),e=>e.code==='23514');
    assert.equal(Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision),referenceRevision);referenceTamperRefusals++;
   }
   const readback=await plane.getApprovedManualActivationRoster({manager});
   for(const wanted of week.referenceBindings.people){const live=readback.rosterSlots.find(s=>s.slotId===wanted.slotId).incumbencies.filter(r=>r.effectiveStart<=at&&(r.effectiveEnd===null||r.effectiveEnd>at));assert.equal(live.length,1);assert.equal(live[0].personId,wanted.employeeId);}
   const weekStart=new Date(Date.parse(at+'T12:00:00Z')-((new Date(at+'T12:00Z').getUTCDay()+6)%7)*86400000).toISOString().slice(0,10),
    managerRead=await plane.getManagerSnapshot({manager,weekStart});
   assert.equal(managerRead.current_publication.publication_id,result.publication_id);assert.equal(managerRead.week_start,at);
   assert.equal(managerRead.approved_manual_schedule.days.length,7);
   let employeeDays=0,lunches=0,ownershipChecks=0;
   const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
   for(let offset=0;offset<7;offset++){
    const date=new Date(Date.parse(at+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10),day=new Date(date+'T12:00:00Z').getUTCDay(),
     lunch=await cp('static_weekly_v8_read_lunch_document',[date]);assert.equal(lunch.persistence_status,'PERSISTED');lunches+=lunch.loans.length;
    for(const person of week.days.find(d=>d.weekday===day).employees){
     const id=week.referenceBindings.people.find(p=>p.approvedName===person.name).employeeId,
      read=await rpc('custodial_application_reader','static_weekly_v5_read_employee_day',[date,id,date+'T15:00:00Z']);
     assert.equal(read.projection_status,'current');assert.equal(read.projection_id,result.projection_id);employeeDays++;
    }
    const reader=await pool.connect();let assignments;
    try{await reader.query('begin');await reader.query('set local role custodial_application_reader');
     assignments=(await reader.query('select * from public.custodial_operational_location_assignments($1::date)',[date])).rows;
     await reader.query('commit');}catch(e){await reader.query('rollback');throw e;}finally{reader.release();}
    const approved=week.days.find(d=>d.weekday===day);
    for(let atMinute=minute(approved.checkedWindow.start);atMinute<minute(approved.checkedWindow.end);atMinute++){
     const expected=previewApprovedManualDay(week,{day:approved.day,time:time(atMinute)});
     for(const owner of expected.owners){
      const group=week.referenceBindings.groups.find(g=>g.referenceCode===owner.locationCode);
      if(group.retainedServiceModes[0]!=='scan_tracked')continue;
      for(const member of group.includedLocations){
       const current=assignments.filter(r=>r.location_id===member.locationId&&minute(r.coverage_start)<=atMinute&&atMinute<minute(r.coverage_end));
       assert.deepEqual(current.map(r=>r.assigned_employee_id),[owner.employeeId]);ownershipChecks++;
      }
     }
    }
   }
   assert.equal(lunches,40);assert.equal(employeeDays,40);
   save('CURRENT_DAY_ACTIVATION_RECEIPT.json',result);
   save('CURRENT_DAY_MANAGER_READBACK.json',managerRead.approved_manual_schedule);
   if(sqlPhaseDiagnostic)throw Object.assign(Error('Instrumented fixture completed; exact-source qualification was not run'),{code:'DIAGNOSTIC_NOT_EXACT_SOURCE_QUALIFICATION'});
   return{status:'PASS',scope:'Owned populated fixture and normal manager control-plane activation; not production or a genuine signed-in browser',
    migration:{file:fileURLToPath(migration),sha256:sha},serviceDate:at,windowEnd:pack.windowEnd,
    nonMondayExercised:new Date(at+'T12:00Z').getUTCDay()!==1,atomicRosterTransfers:4,appendOnlyClosures:3,
    peopleAndMessengerCountsUnchanged:true,positionsPreserved:22,historicalProjectionUnchanged:true,
    currentManagerReadback:true,privateEnvelopeHelperDenied:true,referenceTamperRefusals,fullHourLunches:40,employeeDayReadbacks:40,ownershipChecks,originalReplayAndRecovery:true,wrongPreviewRefused:true,productionWritten:false};
  }});
 if(sqlPhaseDiagnostic&&result.status==='PASS')throw Error('Diagnostic instrumentation is not exact-source SQL qualification');
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert.equal(args.length,2);assert.equal(args[0],'--out');
 await runApprovedManualActivationDatabaseTest({out:resolve(args[1])});
}
