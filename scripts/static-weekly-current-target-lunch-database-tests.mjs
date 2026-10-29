import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';

const container=process.env.LUNCH_PUBLICATION_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_rebuild_roster_fullhour_[0-9]+$/);
const packet=JSON.parse(readFileSync(process.argv[2])),planBytes=readFileSync(process.argv[3]),plan=JSON.parse(planBytes);
assert.equal(digest(packet.compilerInput),packet.sourceDigest);
assert.equal(packet.compilerInput.version.lunchCoveragePolicy.sourceDigest,createHash('sha256').update(planBytes).digest('hex'));
assert.equal(plan.status,'CURRENT_PROGRAM_TARGET_PUBLICATION_PENDING');
const sql=s=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
 {input:(process.env.LUNCH_PUBLICATION_DIAGNOSTICS==='1'&&(/static_weekly_v3_(?:create_draft|publish_draft|materialize_projection)/.test(s))
   ?"set log_min_messages=debug1;set client_min_messages=warning;load 'auto_explain';set auto_explain.log_min_duration=1;set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;set auto_explain.log_timing=off;set auto_explain.log_verbose=off;\n":'')+s,
  encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
const q=s=>`'${String(s).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const query=s=>sql(s).trim().split('\n').at(-1),parsed=s=>JSON.parse(query(s));
const input=structuredClone(packet.compilerInput);input.versions=[input.version];delete input.version;
const date=input.serviceDate,manager=randomUUID();
sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Synthetic current-target manager');`);
const people=new Map(input.slots.flatMap(s=>s.incumbencies.map(p=>[p.personId,p])));
for(const [id,p]of people)sql(`insert into public.employees(id,display_name,role) values(${q(id)},${q(p.displayName)},'staff');`);
const locations=new Map(),families=new Map(),familyByLocation=new Map();
for(const row of input.versions[0].assignments){
 const family=row.locationCodeSnapshot;
 if(!families.has(family))families.set(family,{id:randomUUID(),name:row.locationNameSnapshot,locations:new Set()});
 for(const loc of row.includedLocations||[]){locations.set(loc.locationId,loc);families.get(family).locations.add(loc.locationId);familyByLocation.set(loc.locationId,family);}
 if(!locations.has(row.locationId))locations.set(row.locationId,{locationId:row.locationId,locationNameSnapshot:row.locationNameSnapshot});
}
for(const [id,l]of locations)sql(`insert into public.locations(id,location_code,location_name,location_type,form_type)
 values(${q(id)},${q('SYNTHETIC-'+id)},${q(l.locationNameSnapshot)},'restroom','restroom');`);
for(const [code,g]of families){
 sql(`insert into public.location_groups(id,group_code,group_name)values(${q(g.id)},${q(code)},${q(g.name)});`);
 for(const loc of g.locations)sql(`insert into public.location_group_memberships(location_group_id,location_id)values(${q(g.id)},${q(loc)});`);
}
const dates=Array.from({length:7},(_,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10));
// Normal source, roster, draft, publish and projection entrypoints recompile
// the actual SQL-returned source. The supplied packet is data, never a cached
// compiler/result/attestation substitute for these owning operations.
const fixture=await seedCompiledEventAuthority({sql,container,managerId:manager,dates,source:input,label:'current-target-full-lunch',mode:'official'});
const projectionId=fixture.projectionIds[date],result=fixture.compiledByWeek[date];
let closingRefusals=0;
for(const mutate of [
 p=>{p.plannedClosingOwnership['1'][0].end='14:15';},
 p=>{p.plannedClosingOwnership['1'][0].owners.TETON=input.versions[0].vacantSlotIds[0];},
]){
 const a=structuredClone(result.canonicalAuthority),policy=a.compilerInput.version.shiftEndContinuityPolicy;mutate(policy);
 const {policyDigest,...body}=policy;policy.policyDigest=digest(body);
 a.overlayCompilerInput.version.shiftEndContinuityPolicy=structuredClone(policy);
 a.overlayCompilerInput.version.shiftEndDerivationApplied=policy.policyDigest;
 a.shiftEndDerivation.policyDigest=policy.policyDigest;a.shiftEndDerivation.templateDigest=digest(a.compilerInput);
 const effective=structuredClone(a.overlayCompilerInput);effective.exceptions=[];
 a.shiftEndDerivation.derivedBaselineDigest=digest(effective);a.derivedBaselineDigest=digest(effective);
 let error;try{query(`select public.static_weekly_v9_assert_shift_end_derivation(${j(a)});`);}catch(e){error=String(e.stderr);}
 assert.match(error??'',/planned closing stages must cover every family without gaps|planned closing recipient is absent, off duty, restricted or unqualified/);
 closingRefusals++;
}
{
 const a=structuredClone(result.canonicalAuthority);
 const targetIds=new Set(a.compilerInput.version.assignments.find(w=>w.dayOfWeek===1&&w.locationCodeSnapshot==='TETON').includedLocations.map(l=>l.locationId));
 a.compilerInput.proximity=a.compilerInput.proximity.filter(e=>!targetIds.has(e.toLocationId));
 a.overlayCompilerInput.proximity=structuredClone(a.compilerInput.proximity);
 a.shiftEndDerivation.templateDigest=digest(a.compilerInput);
 const effective=structuredClone(a.overlayCompilerInput);effective.exceptions=[];
 a.shiftEndDerivation.derivedBaselineDigest=digest(effective);a.derivedBaselineDigest=digest(effective);
 let error;try{query(`select public.static_weekly_v9_assert_shift_end_derivation(${j(a)});`);}catch(e){error=String(e.stderr);}
 assert.match(error??'',/planned closing lacks verified directed source proximity/);
 closingRefusals++;
}
const prepared=createStaticWeeklyProjectionWithLunchRpcInput({result,publicationId:fixture.publicationId,expectedRevision:0,
 actor:{managerId:manager,managerName:'Synthetic current-target manager',idempotencyKey:'current-target-full-lunch-document'}});
const doc=prepared.lunchDocument;assert.equal(doc.loans.length,40);
const before=query('select md5(jsonb_agg(to_jsonb(o)order by occurrence_id)::text)from public.weekly_schedule_occurrences o;');
const accepted=parsed(`set role static_weekly_control_plane;select public.static_weekly_v8_materialize_lunch_document(${q(projectionId)}::uuid,${j(doc)},${q(manager)}::uuid)::text;`);
assert.equal(accepted.persistence_status,'PERSISTED');assert.equal(accepted.replayed,false);
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
let dateReads=0,intervals=0,physicalChecks=0;
for(const serviceDate of dates){
 const day=new Date(serviceDate+'T12:00:00Z').getUTCDay(),target=plan.days[String(day)];
 const rows=parsed(`set role custodial_application_reader;select coalesce(jsonb_agg(to_jsonb(r)),'[]')::text from public.custodial_operational_location_assignments(${q(serviceDate)}::date)r;`);
 const lunch=parsed(`set role custodial_application_reader;select public.static_weekly_v8_read_lunch_document(${q(serviceDate)}::date)::text;`);
 assert.equal(lunch.persistence_status,'PERSISTED');assert.equal(lunch.loans.length,target.fullHourLunchLoans.length);dateReads++;
 const start=Math.max(...target.staff.map(k=>minute(plan.positions[k].shift[0])));
 for(const segment of target.segments){
  if(segment.start<start)continue;
  const at=segment.start,active=rows.filter(r=>minute(r.coverage_start)<=at&&at<minute(r.coverage_end));intervals++;
  for(const [locationId,family]of familyByLocation){
   const source=input.versions[0].assignments.find(a=>a.dayOfWeek===day&&a.locationCodeSnapshot===family);
   if(!source||source.serviceMode!=='scan_tracked')continue;
   const expected=plan.positions[segment.owners[family]].personId;
   assert.ok(expected,`no invented employee ${serviceDate}/${family}`);
   assert.deepEqual(active.filter(r=>r.location_id===locationId).map(r=>r.assigned_employee_id),[expected],
    `${serviceDate}/${at}/${family}/${locationId}: exact single physical owner must match handout`);physicalChecks++;
  }
 }
}
assert.equal(dateReads,7);assert.ok(intervals>=7);assert.ok(physicalChecks>0);
assert.equal(query('select md5(jsonb_agg(to_jsonb(o)order by occurrence_id)::text)from public.weekly_schedule_occurrences o;'),before);
assert.equal(query("select count(*)::text from public.custodial_release_authority_restore_inventory i where i.object_kind='function' and to_regprocedure(i.object_identity)in('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)'::regprocedure,'public.static_weekly_v8_read_lunch_segments_dated_base(date)'::regprocedure,'public.custodial_operational_location_assignments(date)'::regprocedure,'public.static_weekly_v9_assert_shift_end_derivation(jsonb)'::regprocedure,'public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)'::regprocedure,'public.static_weekly_version_guard()'::regprocedure,'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)'::regprocedure,'public.static_weekly_v3_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text)'::regprocedure,'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)'::regprocedure,'public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text)'::regprocedure)and i.definition_sql=pg_get_functiondef(to_regprocedure(i.object_identity));"),'10');
assert.equal(query("select count(*)::text from pg_proc where oid in('public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)'::regprocedure,'public.static_weekly_v9_assert_shift_end_derivation(jsonb)'::regprocedure)and proconfig @> array['plan_cache_mode=force_generic_plan'];"),'2');
// Exercise the real immutable-row trigger separately from authority admission.
// This deliberately incomplete synthetic guard row is rolled back; the actual
// eight-person publication above still uses only the complete owning RPCs.
const guardResult=parsed(`begin;
 set local app.static_weekly_draft_write='off';
 set local app.static_weekly_publish_write='off';
 set local app.static_weekly_source_bind='on';
 do $guard$ declare target uuid:=gen_random_uuid();change record;refused integer:=0;
 begin
  insert into public.weekly_schedule_versions(version_id,lifecycle_state,effective_start,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot)
   values(target,'draft',${q(date)}::date,'synthetic-guard-only','{}','{}','{}',repeat('0',64),${q(manager)}::uuid,'Synthetic trigger-only manager');
  for change in select * from (values
   ('version_id','gen_random_uuid()'),('version_number','1'),('lifecycle_state',quote_literal('published')),
   ('publication_kind',quote_literal('supersede')),('draft_of_version_id',quote_literal(${q(fixture.versionId)})||'::uuid'),
   ('rollback_of_version_id',quote_literal(${q(fixture.versionId)})||'::uuid'),('effective_start','effective_start+7'),
   ('revision','revision+1'),('objective_version',quote_literal('changed')),('objective_json',quote_literal('{"changed":true}')||'::jsonb'),
   ('input_provenance_json',quote_literal('{"changed":true}')||'::jsonb'),('draft_document',quote_literal('{"changed":true}')||'::jsonb'),
   ('content_digest','repeat(''f'',64)'),('created_by_manager_id','gen_random_uuid()'),
   ('created_by_manager_name_snapshot',quote_literal('changed')),('created_at','created_at+interval ''1 second'''),
   ('published_by_manager_id','gen_random_uuid()'),('published_by_manager_name_snapshot',quote_literal('changed')),
   ('published_at','statement_timestamp()')
  ) changes(column_name,expression) loop
   begin
    execute format('update public.weekly_schedule_versions set authority_source_id=$1,%I=%s where version_id=$2',change.column_name,change.expression)
     using ${q(fixture.sourceId)}::uuid,target;
    raise exception 'source binding accepted a second changed column: %',change.column_name;
   exception when check_violation then
    if sqlerrm<>'draft versions require a revision-checked v2 command' then raise;end if;
    refused:=refused+1;
   end;
  end loop;
  if refused<>19 then raise exception 'incomplete guarded column coverage';end if;
  update public.weekly_schedule_versions set authority_source_id=${q(fixture.sourceId)}::uuid where version_id=target;
  if not exists(select 1 from public.weekly_schedule_versions where version_id=target and authority_source_id=${q(fixture.sourceId)}::uuid)
   then raise exception 'unchanged source-only binding failed';end if;
  perform set_config('app.current_target_guard_result',jsonb_build_object('changedColumnsRefused',refused,'exactBindingAccepted',true)::text,true);
 end $guard$;
 select current_setting('app.current_target_guard_result');
 rollback;`);
assert.deepEqual(guardResult,{changedColumnsRefused:19,exactBindingAccepted:true});
console.log(JSON.stringify({status:'PASS',actualCurrentEightSource:true,sourceInputDigest:packet.sourceDigest,normalPublicationAndSQLReadback:true,
 scheduledLunches:doc.loans.length,dateReads,intervals,locationOwnershipComparisons:physicalChecks,closingRefusals,originalOccurrencesUnchanged:true,
 exactPrintedTarget:true,sourceBindingGuard:guardResult,disposableSyntheticNamedManager:true,production:false,genuineManagerBrowser:false,physicalNFC:false}));
