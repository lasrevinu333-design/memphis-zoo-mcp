import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {buildEventStaticAuthoritySource} from './event-static-authority-fixture.mjs';
import {createStaticWeeklyControlPlane} from '../../src/static-weekly-control-plane.js';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../../src/static-weekly-lunch-publication.js';
import {compileStaticWeeklySchedule} from '../../src/static-weekly-schedule-compiler.js';
import {createStaticWeeklyDraftRpcInput,createStaticWeeklyProjectionRpcInput} from '../../src/static-weekly-schedule-database-adapter.js';
import {shutdownStaticWeeklyCompiler} from '../../src/static-weekly-schedule-compiler-runtime.js';

export function ownerWorkdaysSyntheticSource({week,people,locationId,vacancies,rule}) {
 const source=buildEventStaticAuthoritySource({weekStart:week,employees:people,locationId,label:'owner-midweek-proof'});
 const version=source.versions[0];version.vacancyCapableSlotIds=[rule.slotId,...vacancies];version.vacantSlotIds=[...vacancies];
 for(const row of version.slotAvailability){row.lunch={start:'12:00',end:'13:00'};if(row.slotId===rule.slotId&&!rule.workDays.includes(row.dayOfWeek))row.status='unavailable';}
 version.assignments=version.assignments.filter(row=>row.ownerSlotId!==rule.slotId||rule.workDays.includes(row.dayOfWeek));
 for(const [index,slotId] of vacancies.entries()){
  source.slots.push({id:slotId,label:'Synthetic opening '+index,incumbencies:[]});
  for(let day=0;day<7;day++){
   version.slotAvailability.push({...structuredClone(version.slotAvailability.find(x=>x.slotId===people[1].slotId&&x.dayOfWeek===day)),slotId,status:'vacant_unfilled'});
   version.assignments.push({...structuredClone(version.assignments.find(x=>x.ownerSlotId===people[1].slotId&&x.dayOfWeek===day)),workId:'opening-'+index+'-'+day,ownerSlotId:slotId});
  }
 }
 // Distinct accepted time windows avoid inventing simultaneous duplicate
 // cleaning duties at the one synthetic location.
 for(const row of version.assignments){
  const position=source.slots.findIndex(s=>s.id===row.ownerSlotId),start=480+position*15;
  const time=minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  row.window={start:time(start),end:time(start+15)};
  row.requiredQualifications=['synthetic-position-'+position];
 }
 version.slotAvailability=version.slotAvailability.map(row=>row.status==='unavailable'
  ? {slotId:row.slotId,dayOfWeek:row.dayOfWeek,status:'unavailable'}
  : {...row,qualifications:['synthetic-position-'+source.slots.findIndex(s=>s.id===row.slotId)]});
 return source;
}

// Synthetic six-person/nine-position shape. Exact policy IDs select the REAL
// guard; no production rows are read or copied. Other identities are synthetic.
export async function ownerWorkdaysDatabaseProof({socketDir,sql,container}) {
 const rule=JSON.parse(readFileSync(new URL('../../config/custodial-owner-workdays.json',import.meta.url))).rules[0];
 const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
 const scalar=s=>sql(s).trim().split('\n').at(-1),json=s=>JSON.parse(scalar(s));
 const revision=()=>Number(scalar('select current_revision from public.static_weekly_schedule_control where singleton'));
 const week='2026-09-28',today='2026-09-30',managerId=randomUUID(),locationId=randomUUID();
 const people=Array.from({length:6},(_,i)=>({id:i===0?rule.employeeId:randomUUID(),slotId:i===0?rule.slotId:randomUUID(),displayName:'Synthetic policy fixture '+i}));
 const vacancies=Array.from({length:3},()=>randomUUID());
 const pool=new pg.Pool({host:socketDir,user:'supabase_admin',password:'postgres',database:'postgres',max:4,connectionTimeoutMillis:5000});
 let checks=0;const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
 const clock=sql("select pg_get_functiondef('public.sch_service_date(timestamptz)'::regprocedure)");
 try {
  sql(`create or replace function public.sch_service_date(p_at timestamptz default now()) returns date language sql stable as $$select date '${today}'$$`);
  const schemaSeedPeople=Number(scalar('select count(*)::text from public.employees'));
  sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(managerId)},'Synthetic Owner Test Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
  insert into public.employees(id,employee_code,display_name,role,active) values ${people.map((p,i)=>`(${q(p.id)},'EMP${920+i}',${q(p.displayName)},'staff',true)`).join(',')};
  insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(locationId)},'OWNER_TEST','Synthetic place','restroom','restroom',true);
  insert into public.location_groups(id,group_code,group_name,active) values(${q(locationId)},'OWNER_TEST','Synthetic place',true);
  insert into public.location_group_memberships(location_id,location_group_id,active) values(${q(locationId)},${q(locationId)},true);`);
  const source=ownerWorkdaysSyntheticSource({week,people,locationId,vacancies,rule});
  const baseline=JSON.stringify(source),policyBytes=readFileSync(new URL('../../config/custodial-owner-workdays.json',import.meta.url),'utf8');
  const actor={managerId,managerName:'Synthetic Owner Test Manager',idempotencyKey:'owner-initial-lunch'};
  console.log('OWNER_FIXTURE_REAL_BASELINE_COMPILE');
  const compile=async input=>{const result=await compileStaticWeeklySchedule(input);assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal));assert.equal(result.verifier.ok,true);return result;};
  const release=(name,args)=>json(`set role static_weekly_release_operator; select public.${name}(${args})::text`);
  const cp=(name,args)=>json(`set role static_weekly_control_plane; select public.${name}(${args})::text`);
  const baselineCompiled=await compile(source),fullSource=baselineCompiled.canonicalAuthority.compilerInput;
  // The legacy bootstrap requires a real incumbent for every initial slot.
  // Bootstrap only the six people, then create THREE ACTUAL EMPTY positions
  // through the existing vacancy RPC before publishing the full nine-slot source.
  // Never invent future hires merely to make initialization pass.
  const occupiedSource=structuredClone(fullSource),occupiedSourceId=randomUUID();
  occupiedSource.slots=occupiedSource.slots.filter(s=>!vacancies.includes(s.id));
  occupiedSource.version.vacancyCapableSlotIds=[rule.slotId];occupiedSource.version.vacantSlotIds=[];
  occupiedSource.version.slotAvailability=occupiedSource.version.slotAvailability.filter(x=>!vacancies.includes(x.slotId));
  occupiedSource.version.assignments=occupiedSource.version.assignments.filter(x=>!vacancies.includes(x.ownerSlotId));
  release('static_weekly_v3_configure_initial_authority_key',`${q('static-weekly-authority-hmac-v2')},${q('disposable-fixture-'+randomUUID()+'-never-production')},'synthetic owner fixture'`);
  release('static_weekly_v3_register_authority_source',`${q(occupiedSourceId)},${j(occupiedSource)},'synthetic occupied bootstrap'`);
  release('static_weekly_v6_initialize_registered_roster',`${q(occupiedSourceId)},${q(managerId)},'synthetic occupied bootstrap'`);
  for(const slotId of vacancies)cp('static_weekly_v7_create_vacant_roster_slot',`${q(slotId)},'Synthetic real opening',${revision()},${q(managerId)},${q('create-'+slotId)}`);
  check(Number(scalar('select count(*)::text from public.employees')),schemaSeedPeople+6,'only six fixture people added; no fake hires');
  check(scalar(`select count(*)::text from public.employees where id in (${people.map(p=>q(p.id)).join(',')})`),'6','exact six fixture identities retained');
  check(scalar('select count(*)::text from public.weekly_roster_slots'),'9','nine real fixture positions');
  const fullSourceId=randomUUID();release('static_weekly_v3_register_authority_source',`${q(fullSourceId)},${j(fullSource)},'synthetic full source'`);
  const draft=createStaticWeeklyDraftRpcInput({result:baselineCompiled,expectedRevision:revision(),actor:{...actor,idempotencyKey:'owner-baseline-draft'}});
  console.log('OWNER_FIXTURE_REAL_DRAFT_PUBLICATION');
  const created=cp('static_weekly_v3_create_draft',`${q(draft.effectiveStart)},${q(draft.objectiveVersion)},${j(draft.objective)},${j(draft.inputProvenance)},${j(draft.document)},${draft.expectedRevision},${q(managerId)},'owner-baseline-draft',${q(fullSourceId)}`);
  const published=cp('static_weekly_v3_publish_draft',`${q(created.data.version_id)},1,${created.revision},${q(managerId)},'owner-baseline-publish','publish',null`);
  const publicationId=published.data.publication_id;
  const sourceReply=cp('static_weekly_v3_read_publication_source',`${q(publicationId)},${q(week)}`);
  const {version:hydratedVersion,...hydratedFacts}=sourceReply.compiler_input;
  const compiled=await compile({...hydratedFacts,versions:[hydratedVersion],exceptions:sourceReply.exceptions});
  const prepared=createStaticWeeklyProjectionRpcInput({result:compiled,publicationId,expectedRevision:revision(),actor:{...actor,idempotencyKey:'owner-baseline-projection'}});
  const projection=cp('static_weekly_v3_materialize_projection',`${q(prepared.publicationId)},${q(prepared.serviceDate)},${q(prepared.exceptionSetDigest)},${q(prepared.compilerVersion)},${j(prepared.objective)},${j(prepared.metrics)},${q(prepared.replayDigest)},${j(prepared.envelope)},${prepared.expectedRevision},${q(managerId)},${q(prepared.idempotencyKey)}`);
  const authority={publicationId,compiledByWeek:{[week]:compiled},projectionIds:{[week]:projection.data.projection_id}};
  const initialLunch=createStaticWeeklyProjectionWithLunchRpcInput({result:authority.compiledByWeek[week],publicationId:authority.publicationId,expectedRevision:revision(),actor}).lunchDocument;
  sql(`set role static_weekly_control_plane; select public.static_weekly_v8_materialize_lunch_document(${q(authority.projectionIds[week])},${j(initialLunch)},${q(managerId)});`);
  const employeeDay=(person,date=today)=>json(`set role service_role; select public.static_weekly_v5_read_employee_day(${q(date)},${q(person.id)},now())::text`);
  const beforeReads=people.slice(1).map(person=>employeeDay(person));
  console.log('OWNER_FIXTURE_REAL_PUBLICATION_READS',beforeReads.length);
  for(const read of beforeReads){check(read.projection_status,'current','all five other employees initially readable');assert.ok(read.all_items.length);}
  const readSource=()=>json(`set role static_weekly_control_plane; select public.static_weekly_v3_read_publication_source(${q(authority.publicationId)},${q(week)})::text`);
  const beforeSource=readSource(),vacancySource=structuredClone(beforeSource.compiler_input);
  vacancySource.version.vacantSlotIds.push(rule.slotId);
  const vacancySourceId=randomUUID();sql(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${q(vacancySourceId)},${j(vacancySource)},'synthetic vacancy capability source');`);
  const history=scalar(`select jsonb_agg(to_jsonb(i) order by incumbency_id)::text from public.weekly_roster_slot_incumbencies i`);
  const startRevision=revision();
  const manager={manager_id:managerId,manager_display_name:actor.managerName,auth_mode:'trusted_device',trusted_device:true,read_only:false};
  const request={manager,sourceId:vacancySourceId,slotId:rule.slotId,employeeId:rule.employeeId,effectiveStart:today,reason:'Synthetic VCC-01 departure',expectedRevision:startRevision,idempotencyKey:'owner-midweek-vacancy'};
  let lunchPersisted=false;
  const faultDatabase={async connect(){const client=await pool.connect();return {
   async query(statement,values){
    if(lunchPersisted&&statement.includes('static_weekly_v3_read_manager_snapshot'))throw Error('EXPECTED_AFTER_LUNCH_FAILURE');
    const result=await client.query(statement,values);if(statement.includes('static_weekly_v8_materialize_lunch_document'))lunchPersisted=true;return result;
   },release:client.release.bind(client),on:client.on.bind(client),removeListener:client.removeListener.bind(client)
  };}};
  console.log('OWNER_FIXTURE_REAL_TRANSACTION_ROLLBACK_TEST');
  await assert.rejects(createStaticWeeklyControlPlane({database:faultDatabase}).vacateRosterSlot(request),/EXPECTED_AFTER_LUNCH_FAILURE/);checks++;
  check(lunchPersisted,true,'real compiler and SQL lunch persistence reached before injected fault');
  check(revision(),startRevision,'real database rollback restores revision');
  check(scalar(`select active::text from public.employees where id=${q(rule.employeeId)}`),'true','rollback retains employee activation');
  check(scalar('select count(*)::text from public.weekly_roster_slot_incumbency_closures'),'0','rollback retains incumbency');
  check(readSource(),beforeSource,'rollback preserves actual source');
  check(people.slice(1).map(person=>employeeDay(person)),beforeReads,'rollback preserves all five reads');
  const plane=createStaticWeeklyControlPlane({database:pool});
  console.log('OWNER_FIXTURE_REAL_TRANSACTION_COMMIT_TEST');
  const result=await plane.vacateRosterSlot(request);
  assert.ok(result.data.current_projection.projection_id);checks++;
  check(scalar(`select active::text from public.employees where id=${q(rule.employeeId)}`),'false','real departure committed');
  check(scalar('select jsonb_agg(to_jsonb(i) order by incumbency_id)::text from public.weekly_roster_slot_incumbencies i'),history,'immutable incumbency rows unchanged');
  const after=readSource();
  check(after.compiler_input.version.assignments,beforeSource.compiler_input.version.assignments,'recurring work remains byte-equivalent');
  const availability=after.compiler_input.version.slotAvailability.filter(x=>x.slotId===rule.slotId);
  check(availability.filter(x=>x.status==='working').map(x=>x.dayOfWeek).sort(),[1,2],'prior Monday Tuesday retained');
  check(availability.filter(x=>x.status==='vacant_unfilled').length,5,'Wednesday through Sunday genuinely vacant');
  for(const person of people.slice(1)){
   const read=employeeDay(person);check(read.projection_status,'current','other employee has current projection');
   assert.ok(read.all_items.length);checks++;
  }
  check(JSON.stringify(source),baseline,'synthetic immutable baseline unchanged');
  check(readFileSync(new URL('../../config/custodial-owner-workdays.json',import.meta.url),'utf8'),policyBytes,'actual policy file unchanged');
  const lunch=json(`set role static_weekly_control_plane; select public.static_weekly_v8_read_lunch_document(${q(today)})::text`);
  assert.ok(lunch);checks++;
  const repeated=await plane.vacateRosterSlot(request);
  check(repeated,result,'complete response is byte-equivalent on semantic retry');
  const replayRevision=revision();
  const concurrent=await Promise.all([plane.vacateRosterSlot(request),plane.vacateRosterSlot(request)]);
  check(concurrent,[result,result],'concurrent identical full actions replay exact original response');
  check(revision(),replayRevision,'completed retries never add a revision or recompile');
  await assert.rejects(plane.vacateRosterSlot({...request,reason:'different reason'}),/different semantic inputs/);checks++;
  for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']){
   check(scalar(`select has_function_privilege(${q(role)},'public.static_weekly_v8_read_completed_vacancy(uuid,text)','EXECUTE')::text`),'false',role+' cannot read completed manager action');
   assert.throws(()=>sql(`set role ${role}; select public.static_weekly_v8_read_completed_vacancy(${q(managerId)},${q(request.idempotencyKey)});`),/permission denied/);checks++;
  }
  const helperIdentity='public.static_weekly_v8_read_completed_vacancy(uuid,text)';
  sql(`drop function ${helperIdentity}; do $$ declare definition text; begin select definition_sql into strict definition from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity=${q(helperIdentity)}; execute definition; select definition_sql into strict definition from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity=${q(helperIdentity)}; execute definition; end $$;`);
  check(await plane.vacateRosterSlot(request),result,'exact complete replay survives function/grant recovery');
  assert.throws(()=>sql(`begin; alter table public.weekly_schedule_lunch_documents disable trigger trg_weekly_schedule_lunch_documents_immutable; delete from public.weekly_schedule_lunch_documents where projection_id=${q(result.data.projection_id)}; set local role static_weekly_control_plane; select public.static_weekly_v8_read_completed_vacancy(${q(managerId)},${q(request.idempotencyKey)}); rollback;`),/accepted lunch binding/);checks++;
  check(await plane.vacateRosterSlot(request),result,'rolled-back missing-lunch fault leaves original full replay intact');
  sql("create or replace function public.sch_service_date(p_at timestamptz default now()) returns date language sql stable as $$select date '2026-10-07'$$");
  check(await plane.vacateRosterSlot(request),result,'completed vacancy retries survive a later service week');
  console.log(JSON.stringify({passed:checks,failed:0,realPg:true,realControlPlane:true,realIsolatedCompiler:true,realPublicationAndLunch:true,sixSyntheticPeople:true,nineStablePositions:true,realPolicyGuard:true,rollbackAfterLunch:true,productionWritten:false}));
 }finally{await shutdownStaticWeeklyCompiler();await pool.end();sql(clock);}
}
