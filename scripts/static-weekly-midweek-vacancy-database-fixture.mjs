import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {seedCompiledEventAuthority,buildEventStaticAuthoritySource} from './fixtures/event-static-authority-fixture.mjs';
import {compileStaticWeeklySchedule,postgresJsonbContentDigest} from '../src/static-weekly-schedule-compiler.js';
import {createStaticWeeklyDraftRpcInput} from '../src/static-weekly-schedule-database-adapter.js';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {createVacancyManagerPreview,workerCandidateDigest} from '../src/static-weekly-vacancy-preview.js';
import {canonicalJson} from '../src/static-weekly-schedule-model.js';
// Importing a current callable must not launch the retained legacy fixture.
export async function legacyMidweekVacancyDatabaseProof(){
const container=process.env.ROSTER_PUBLICATION_TEST_CONTAINER;
assert.match(container||'',/^mz_schema_rebuild_roster_[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const raw=statement=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:statement,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
const sql=statement=>raw(statement).trim().split('\n').at(-1), parsed=statement=>JSON.parse(sql(statement));
const revision=()=>Number(sql('select current_revision from public.static_weekly_schedule_control where singleton'));
const manager=randomUUID(),a=randomUUID(),b=randomUUID(),slotA=randomUUID(),slotB=randomUUID(),location=randomUUID();
const week='2026-09-21',today='2026-09-23';let passed=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);passed++;};
const originalClock=raw("select pg_get_functiondef('public.sch_service_date(timestamptz)'::regprocedure)");
try {
 raw("create or replace function public.sch_service_date(p_at timestamptz default now()) returns date language sql stable as $$select date '2026-09-23'$$");
 raw(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic Published Vacancy Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active) values(${q(a)},'EMP902','Synthetic Midweek Former','staff',true),(${q(b)},'EMP903','Synthetic Unaffected','staff',true);
 insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(location)},'MIDWEEK_TEST','Synthetic midweek place','restroom','restroom',true);
 insert into public.location_groups(id,group_code,group_name,active) values(${q(location)},'MIDWEEK_TEST','Synthetic midweek place',true);
 insert into public.location_group_memberships(location_id,location_group_id,active) values(${q(location)},${q(location)},true);`);
 const source=buildEventStaticAuthoritySource({weekStart:week,locationId:location,locationCode:'MIDWEEK_TEST',locationName:'Synthetic midweek place',label:'midweek-vacancy',employees:[{id:a,slotId:slotA,displayName:'Synthetic Midweek Former'},{id:b,slotId:slotB,displayName:'Synthetic Unaffected'}]});
 source.versions[0].vacancyCapableSlotIds=[slotA];source.versions[0].vacantSlotIds=[];
 for(const row of source.versions[0].slotAvailability)row.lunch={start:'12:00',end:'13:00'};
 const authority=await seedCompiledEventAuthority({sql:raw,container,managerId:manager,dates:[week],source});
 const initialLunch=createStaticWeeklyProjectionWithLunchRpcInput({result:authority.compiledByWeek[week],publicationId:authority.publicationId,expectedRevision:revision(),actor:{managerId:manager,managerName:'Synthetic Published Vacancy Manager',idempotencyKey:'initial-midweek-lunch'}}).lunchDocument;
 raw(`set role static_weekly_control_plane; select public.static_weekly_v8_materialize_lunch_document(${q(authority.projectionIds[week])},${j(initialLunch)},${q(manager)});`);
 const reader=()=>parsed(`set role service_role; select public.static_weekly_v5_read_employee_day(${q(today)},${q(b)},now())::text`);
 check(reader().projection_status,'current','initial publication is readable');
 assert.ok(reader().all_items.length>0);passed++;
 const before=parsed(`set role static_weekly_control_plane; select public.static_weekly_v3_read_publication_source(${q(authority.publicationId)},${q(week)})::text`);
 const expected=structuredClone(before.compiler_input);
 expected.slots.find(x=>x.id===slotA).incumbencies.forEach(x=>{x.effectiveEnd=today;});
 for(const row of expected.version.slotAvailability)if(row.slotId===slotA&&![1,2].includes(row.dayOfWeek))row.status='vacant_unfilled';
 const vacantSource=structuredClone(expected);vacantSource.version.vacantSlotIds=[slotA];
 const sourceId=randomUUID();raw(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${q(sourceId)},${j(vacantSource)},'synthetic midweek vacancy');`);
 const {version,...facts}=expected;
 const compiled=await compileStaticWeeklySchedule({...facts,versions:[version],exceptions:before.exceptions});
 check(compiled.status,'FEASIBLE','real populated current week compiles');check(compiled.verifier.ok,true);
 const startRevision=revision(),key='published-vacate-'+slotA,actor={managerId:manager,managerName:'Synthetic Published Vacancy Manager',idempotencyKey:key+'-projection'};
 const p=createStaticWeeklyProjectionWithLunchRpcInput({result:compiled,publicationId:authority.publicationId,expectedRevision:startRevision+1,actor});
 const vacate=`select public.static_weekly_v8_vacate_roster_slot(${q(sourceId)},${q(slotA)},${q(a)},${q(today)},'Synthetic vacancy',${startRevision},${q(manager)},${q(key)})`;
 const projection=`select public.static_weekly_v3_materialize_projection(${q(p.publicationId)},${q(p.serviceDate)},${q(p.exceptionSetDigest)},${q(p.compilerVersion)},${j(p.objective)},${j(p.metrics)},${q(p.replayDigest)},${j(p.envelope)},${p.expectedRevision},${q(manager)},${q(p.idempotencyKey)}) as response`;
 const transaction=`begin; set local role static_weekly_control_plane; ${vacate}; with projection as materialized (${projection}) select public.static_weekly_v8_materialize_lunch_document((response#>>'{data,projection_id}')::uuid,${j(p.lunchDocument)},${q(manager)}) from projection;`;
 const history=sql(`select to_jsonb(i)::text from public.weekly_roster_slot_incumbencies i where slot_id=${q(slotA)}`);
 assert.throws(()=>raw(transaction+' select 1/0; commit;'),/division by zero/);passed++;
 check(revision(),startRevision,'downstream failure rolls back staffing and projection revisions');
 check(sql(`select active::text from public.employees where id=${q(a)}`),'true','deactivation rolls back');
 check(reader().projection_status,'current','other employee remains current after rollback');
 raw(transaction+' commit;');
 check(reader().projection_status,'current','vacancy and replacement projection committed together');
 assert.ok(reader().all_items.length>0);passed++;
 check(sql(`select to_jsonb(i)::text from public.weekly_roster_slot_incumbencies i where slot_id=${q(slotA)}`),history,'original history row unchanged');
 const hydrated=parsed(`set role static_weekly_control_plane; select public.static_weekly_v3_read_publication_source(${q(authority.publicationId)},${q(week)})::text`);
 const availability=hydrated.compiler_input.version.slotAvailability.filter(x=>x.slotId===slotA);
 check(availability.filter(x=>x.status==='working').map(x=>x.dayOfWeek).sort(),[1,2],'earlier occupied days retained');
 check(availability.filter(x=>x.status==='vacant_unfilled').length,5,'dated openings have no employee');
 const draftFacts=structuredClone(expected);draftFacts.version.id=randomUUID();draftFacts.version.publicationId=randomUUID();
 const {version:draftVersion,...draftInput}=draftFacts;
 const draftResult=await compileStaticWeeklySchedule({...draftInput,versions:[draftVersion],exceptions:before.exceptions});
 check(draftResult.verifier.ok,true,'new immutable draft has independent identity');
 const draftSourceId=randomUUID();raw(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${q(draftSourceId)},${j(draftResult.canonicalAuthority.compilerInput)},'synthetic corrected draft');`);
 const draft=createStaticWeeklyDraftRpcInput({result:draftResult,expectedRevision:revision(),actor:{...actor,idempotencyKey:key+'-draft'}});
 // The validator is an internal definer dependency, not a control-plane RPC.
 // Create through the real caller role, then inspect it as the fixture owner.
 raw(`begin; set local role static_weekly_control_plane; with created as materialized(select public.static_weekly_v3_create_draft(${q(draft.effectiveStart)},${q(draft.objectiveVersion)},${j(draft.objective)},${j(draft.inputProvenance)},${j(draft.document)},${draft.expectedRevision},${q(manager)},${q(draft.idempotencyKey)},${q(draftSourceId)}) as response) select set_config('test.midweek_draft',response#>>'{data,version_id}',true) from created; reset role; select public.static_weekly_v3_assert_draft_incumbency(current_setting('test.midweek_draft')::uuid); rollback;`);passed++;
 console.log(JSON.stringify({passed,failed:0,populatedCurrentWeek:true,realPublication:true,atomicRollback:true,otherEmployeeReadable:true,productionWritten:false}));
} finally { raw(originalClock); }
}

// Declarative SYNTHETIC input only, authored before any publication. The caller
// supplies real disposable employee/place rows; no actor, key or roster seed is
// fabricated here. This is not the approved six/nine production pattern.
export function buildCurrentVacancyFixtureSource({weekStart,employees,locationId,locationCode,locationName,slotId}){
 assert.equal(employees.length,2,'one bounded newly changed two-person source');
 assert.ok(employees.some(row=>row.slotId===slotId));
 const source=buildEventStaticAuthoritySource({weekStart,employees,locationId,locationCode,locationName,label:'current263-vacancy'});
 source.versions[0].vacancyCapableSlotIds=[slotId];source.versions[0].vacantSlotIds=[];
 for(const row of source.versions[0].slotAvailability)row.lunch={start:'12:00',end:'13:00'};
 // Fixed, disjoint synthetic work windows leave actual capacity for the
 // remaining person. No invented FEASIBLE result or physical opening claim.
 for(const row of source.versions[0].assignments){const index=employees.findIndex(e=>e.slotId===row.ownerSlotId);
  row.window=index===0?{start:'08:00',end:'08:15'}:{start:'08:30',end:'08:45'};}
 return source;
}

// Caller owns current263 reconstruction, authenticated normal HTTP runtime,
// actual SQL/socket/container, pool/compiler limits, capture and cleanup. This
// member never creates a server/container/session or retries confirmation.
export async function currentVacancyPreviewConfirmOriginalReadbackProof({sql,container,plane,manager,source,
 slotId,employeeId,vacancySourceId,idempotencyKey,reason,compiler,request,capture,deniedRequest=null,
 getPreparationRecords,recreateLifecycle=null}){
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const HASH=/^[a-f0-9]{64}$/,q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
 for(const name of [slotId,employeeId,vacancySourceId,manager?.manager_id])assert.match(name,UUID);
 assert.match(manager?.credential_id,UUID);assert.equal(typeof manager.device_id,'string');assert.ok(manager.device_id);
 assert.equal(typeof manager.access_level,'string');assert.ok(manager.access_level);
 assert.match(container,/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
 for(const fn of [sql,compiler,request,capture,getPreparationRecords])assert.equal(typeof fn,'function');
 assert.equal(typeof plane?.getManagerSnapshot,'function');assert.equal(typeof plane?.getRosterSourceDetails,'function');
 assert.ok(deniedRequest===null||typeof deniedRequest==='function');
 assert.ok(recreateLifecycle===null||typeof recreateLifecycle==='function');
 assert.equal(typeof reason,'string');assert.ok(reason===reason.trim()&&reason.length>0&&reason.length<=500&&!/[\x00-\x1f\x7f]/.test(reason));
 assert.equal(typeof idempotencyKey,'string');assert.ok(idempotencyKey.length>0&&idempotencyKey.length<=150);
 const read=async statement=>JSON.parse(String(await sql(statement)).trim().split('\n').at(-1));
 const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 let phase='INPUT',checks=0,confirmationCalls=0,registration=null,baseline=null,body=null,preview=null,lifecycleRecreated=false;
 const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
 const save=async(name,value)=>{await capture(name,value);console.log('TASK8_VACANCY',JSON.stringify({phase,checks,file:name,sha256:digest(value),bytes:Buffer.byteLength(JSON.stringify(value))}));};
 const call=async(method,path,payload=null,transport=request)=>{
  const result=await transport({method,path,...(payload===null?{}:{body:JSON.stringify(payload)})});
  assert.ok(Number.isInteger(result?.status),'caller must return actual HTTP status/body, not map routes to a mock plane');
  return result;
 };
 const success=result=>{assert.equal(result.status,200);assert.equal(result.body?.ok,true);return result.body.data;};
 const preparations=async()=>{const records=await getPreparationRecords();assert.ok(Array.isArray(records),'actual existing normal compilerPreparer capture array required');
  for(const record of records)assert.ok(record?.input&&record.preparation&&record.projection,'complete actual input/options/full projection required');
  return structuredClone(records);};
 // The ONLY private preparation read is the settled normal CP RPC. No direct
 // table read/grant, synthetic descriptor or public raw-candidate endpoint.
 const retained=async()=>{const value=await read(`set role static_weekly_control_plane; select public.static_weekly_read_vacancy_reviewed_preparation(
  ${q(manager.manager_id)}::uuid,${q(manager.credential_id)}::uuid,${q(manager.device_id)}::text,
  ${q(manager.access_level)}::text,${q(idempotencyKey)}::text)::text;`);
  if(value?.found===false){check(value,{found:false},'closed missing original preparation');return value;}
  check(Object.keys(value).sort(),['found','state','current','replayed','preview_digest','worker_candidate_digest','generation','staged_at','packet_utf8','payload_sha256'].sort(),'closed typed retained descriptor');
  assert.equal(value.found,true);assert.ok(['UNSUBMITTED','CONSUMED'].includes(value.state));
  assert.equal(typeof value.current,'boolean');assert.equal(typeof value.replayed,'boolean');
  assert.ok(Number.isSafeInteger(value.generation)&&value.generation>=0);assert.equal(typeof value.staged_at,'string');assert.ok(Number.isFinite(Date.parse(value.staged_at)));
  for(const field of ['preview_digest','worker_candidate_digest','payload_sha256'])assert.match(value[field],HASH);
  assert.equal(typeof value.packet_utf8,'string');check(value.payload_sha256,createHash('sha256').update(value.packet_utf8,'utf8').digest('hex'),'complete original UTF8 packet checksum');
  return value;
 };
 const unchangedPreparation=(now,original,label)=>{check(now.found,true,label+' found');
  for(const field of ['preview_digest','worker_candidate_digest','generation','staged_at','packet_utf8','payload_sha256'])check(now[field],original[field],label+' immutable '+field);};
 const week=source.serviceDate;assert.equal(new Date(week+'T00:00:00Z').getUTCDay(),1);
 assert.equal(source.versions.length,1);check(source.versions[0].vacancyCapableSlotIds,[slotId],'vacancy capability declared before publication');
 check(source.versions[0].vacantSlotIds,[],'initial baseline remains occupied');
 assert.ok(source.slots.find(s=>s.id===slotId)?.incumbencies.some(i=>i.personId===employeeId));
 const people=[...new Set(source.slots.flatMap(s=>s.incumbencies.map(i=>i.personId)))];assert.equal(people.length,2);
 for(const id of people)assert.match(id,UUID);
 const observeState=()=>read(`select jsonb_build_object(
  'revision',(select current_revision from public.static_weekly_schedule_control where singleton),
  'ledger',(select count(*) from public.weekly_schedule_authority_revisions),
  'receipts',(select count(*) from public.weekly_schedule_command_receipts),
  'projections',(select count(*) from public.weekly_schedule_compiled_projections),
  'lunchDocuments',(select count(*) from public.weekly_schedule_lunch_documents),
  'people',(select jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'active',active) order by id) from public.employees where id in (${people.map(id=>q(id)+'::uuid').join(',')})),
  'incumbencies',(select coalesce(jsonb_agg(to_jsonb(i) order by i.incumbency_id),'[]') from public.weekly_roster_slot_incumbencies i),
  'closures',(select coalesce(jsonb_agg(to_jsonb(c) order by c.closed_incumbency_id),'[]') from public.weekly_roster_slot_incumbency_closures c),
  'staffingStates',(select coalesce(jsonb_agg(to_jsonb(s) order by s.slot_id,s.effective_start,s.authority_revision),'[]') from public.weekly_roster_slot_staffing_states s),
  'versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.version_id),'[]') from public.weekly_schedule_versions v),
  'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.publication_id),'[]') from public.weekly_schedule_publications p),
  'sources',(select coalesce(jsonb_agg(jsonb_build_object('source_id',source_id,'source_digest',source_digest,'canonical_source',canonical_source) order by source_id),'[]') from public.static_weekly_authority_source_documents)
 )::text`);
 try{
  const serverDay=String(await sql('select public.sch_service_date(statement_timestamp())::text')).trim().split('\n').at(-1);
  assert.equal(new Date(serverDay+'T00:00:00Z').toISOString().slice(0,10),serverDay);
  assert.ok(serverDay>=week&&serverDay<=new Date(Date.parse(week+'T00:00:00Z')+6*86400000).toISOString().slice(0,10),'current server week only, no date override');
  await save('task8-vacancy-authored-source.json',{source,slotId,employeeId,vacancySourceId,serverDay,managerId:manager.manager_id});
  phase='NEW_OFFICIAL_BASELINE';let calls=0;
  const compile=async(input,options)=>{calls++;const result=await compiler(input,options);await save(`task8-vacancy-baseline-compiler-${calls}.json`,{input,result});
   if(!registration){assert.equal(result.status,'FEASIBLE');assert.equal(result.verifier?.ok,true);
    // Author the distinct prospective source before seed publishes anything.
    // Only declared vacancy membership differs; no old accepted source edits.
    const prospective=structuredClone(result.canonicalAuthority.compilerInput);prospective.version.vacantSlotIds=[slotId];
    const count=await read('select count(*)::int n from public.weekly_schedule_publications');assert.equal(count,0);
    registration=await read(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${q(vacancySourceId)}::uuid,${j(prospective)},'current263 SYNTHETIC prepublication vacancy declaration')::text;`);
    assert.equal(registration.source_id,vacancySourceId);assert.match(registration.source_digest,HASH);
    await save('task8-vacancy-prepublication-registration.json',{publicationCount:count,prospective,registration});
   }return result;};
  baseline=await seedCompiledEventAuthority({sql,container,managerId:manager.manager_id,dates:[week],source,
   label:'task8-new-current263-vacancy',mode:'official',compiler:compile});
  const initial=await plane.getManagerSnapshot({manager,weekStart:week});assert.equal(initial.projection_status,'current');
  // Normal verified companion writer, not an INSERT or guessed lunch document.
  const companion=createStaticWeeklyProjectionWithLunchRpcInput({result:baseline.compiledByWeek[week],publicationId:baseline.publicationId,
   expectedRevision:initial.authority_revision,actor:{managerId:manager.manager_id,managerName:manager.manager_display_name,idempotencyKey:'vacancy-baseline-companion-'+idempotencyKey}}).lunchDocument;
  await sql(`set role static_weekly_control_plane; select public.static_weekly_v8_materialize_lunch_document(${q(initial.latest_projection.projection_id)}::uuid,${j(companion)},${q(manager.manager_id)}::uuid);`);
  phase='CURRENT_SOURCE';const before=success(await call('GET','/static-weekly/manager-snapshot?week_start='+week));
  check(before.current_service_date,serverDay,'actual current civil day');check(before.projection_status,'current','normal published current plan');
  check(before.current_publication.publication_id,baseline.publicationId,'same actual published baseline');
  const incumbent=before.roster.find(r=>r.slot_id===slotId)?.week_staffing.find(r=>r.service_date===serverDay);
  check(incumbent?.person_id,employeeId,'current target from actual dated roster');
  body={source_id:vacancySourceId,employee_id:employeeId,effective_start:serverDay,reason,expected_revision:before.authority_revision,idempotency_key:idempotencyKey};
  const details=success(await call('GET','/static-weekly/staffing/source-details?'+new URLSearchParams({source_id:vacancySourceId,effective_start:serverDay,expected_revision:String(body.expected_revision)})));
  check(details.manager_id,manager.manager_id,'normal authenticated source details');check(details.registered_source_digest,registration.source_digest,'prepublication registered source');
  await save('task8-vacancy-current-before.json',{snapshot:before,details,body,state:await observeState()});
  const originalState=await observeState(),path='/static-weekly/roster/'+slotId+'/vacate',beforePreparations=await preparations();
  check(await retained(),{found:false},'no original private candidate before first preview');
  const publicationSource=await read(`set role static_weekly_control_plane; select public.static_weekly_v3_read_publication_source(${q(baseline.publicationId)}::uuid,${q(week)}::date)::text;`);
  const preFacts=publicationSource.compiler_input;
  // Exact existing compilerInputFromPublishedSource field composition; actual
  // fixed source read, not browser-selected roster or guessed elapsed times.
  const originalPreInput={serviceDate:week,timezone:preFacts.timezone||'America/Chicago',slots:preFacts.slots,proximity:preFacts.proximity,
   exceptions:publicationSource.exceptions||[],versions:[preFacts.version]};
  phase='STALE_REVISION_REFUSED';const stale=await call('POST',path+'/preview',{...body,expected_revision:body.expected_revision-1});
  assert.ok(stale.status>=400&&stale.status<500);check(await observeState(),originalState,'stale preview no accepted prefix');
  check(await preparations(),beforePreparations,'stale request does not prepare a candidate');
  await save('task8-vacancy-stale-refusal.json',stale);
  if(deniedRequest){phase='CURRENT_PERMISSION_REFUSED';const denied=await call('POST',path+'/preview',body,deniedRequest);assert.ok([401,403].includes(denied.status));
   check(await observeState(),originalState,'denied manager no accepted prefix');await save('task8-vacancy-permission-refusal.json',denied);}
  phase='RETAINED_UNACCEPTED_PREVIEW';preview=success(await call('POST',path+'/preview',body));
  const reviewedRecords=await preparations();check(reviewedRecords.length,beforePreparations.length+1,'one actual preparation at first private preview');
  check(reviewedRecords.slice(0,-1),beforePreparations,'earlier compiler evidence unchanged');
  const reviewed=reviewedRecords.at(-1),purePreview=createVacancyManagerPreview({managerId:manager.manager_id,sourceId:vacancySourceId,
   slotId,employeeId,effectiveStart:serverDay,weekStart:week,expectedRevision:body.expected_revision,idempotencyKey,
   reasonDigest:createHash('sha256').update(reason,'utf8').digest('hex'),registeredSourceDigest:details.registered_source_digest,
   currentSourceDigest:details.current_source_digest,publicationId:baseline.publicationId,projection:reviewed.projection});
  for(const key of Object.keys(purePreview))check(preview[key],purePreview[key],'same original full-candidate public '+key);
  check(Object.keys(preview).sort(),[...Object.keys(purePreview),'preview_retained','published'].sort(),'only two retention fields outside original hash-bound DTO');
  check(preview.preview_retained,true,'private candidate retained, not accepted');check(preview.published,false,'no vacancy publication from preview');
  check(preview.workerCandidateDigest,workerCandidateDigest(reviewed.projection),'full original worker evidence binds preview');
  const originalRetained=await retained();check(originalRetained.state,'UNSUBMITTED','durable private candidate is not an accepted roster/work command');
  check(originalRetained.current,true,'normal actor/source/day/revision/generation still current');
  check(originalRetained.preview_digest,purePreview.previewDigest,'same complete reviewed binder');check(originalRetained.worker_candidate_digest,purePreview.workerCandidateDigest,'same twelve-field worker candidate');
  const packet=JSON.parse(originalRetained.packet_utf8);
  check(Object.keys(packet).sort(),['schema','reason','preInputUtf8','postInputUtf8','preparedProjectionUtf8','previewUtf8','previewCanonicalUtf8'].sort(),'closed seven-field original private packet');
  check(packet.schema,'custodial.vacancy-reviewed-preparation.v1','fixed private packet schema');check(packet.reason,reason,'original semantic reason');
  for(const field of ['preInputUtf8','postInputUtf8','preparedProjectionUtf8','previewUtf8','previewCanonicalUtf8'])assert.equal(typeof packet[field],'string');
  check(JSON.parse(packet.preInputUtf8),originalPreInput,'complete actual pre-vacancy source');
  check(packet.postInputUtf8,JSON.stringify(reviewed.input),'exact originally prepared post-input UTF8');
  check(packet.preparedProjectionUtf8,JSON.stringify(reviewed.projection),'exact full original projection UTF8 including ALL worker proof/timing/terminal receipts');
  check(packet.previewUtf8,JSON.stringify(purePreview),'original pure preview UTF8 excludes added retention markers');
  const fullBinding={managerId:manager.manager_id,sourceId:vacancySourceId,slotId,employeeId,effectiveStart:serverDay,weekStart:week,
   expectedRevision:body.expected_revision,idempotencyKey,reasonDigest:purePreview.reasonDigest,registeredSourceDigest:details.registered_source_digest,
   currentSourceDigest:details.current_source_digest,publicationId:baseline.publicationId};
  check(packet.previewCanonicalUtf8,canonicalJson({schema:purePreview.schema,binding:fullBinding,projection:reviewed.projection}),'complete original canonical preview binder, no proof field stripped');
  check(createHash('sha256').update(packet.previewCanonicalUtf8,'utf8').digest('hex'),purePreview.previewDigest,'original full preview checksum unchanged');
  await save('task8-vacancy-original-retained-preparation.json',originalRetained);
  await save('task8-vacancy-reviewed-compiler-record.json',reviewed);
  check(preview.schema,'custodial.stable-vacancy-preview.v1','actual public candidate');check(preview.expectedRevision,body.expected_revision,'original revision');
  check(preview.projectionExpectedRevision,body.expected_revision+1,'vacancy intermediate revision');check(preview.resultingRevision,body.expected_revision+2,'final paired revision');
  for(const [field,value] of Object.entries({managerId:manager.manager_id,sourceId:vacancySourceId,slotId,employeeId,effectiveStart:serverDay,weekStart:week,
   publicationId:baseline.publicationId,idempotencyKey,registeredSourceDigest:details.registered_source_digest,currentSourceDigest:details.current_source_digest,accepted:false,persisted:false,phoneUpdated:false}))check(preview[field],value,field);
  for(const field of ['previewDigest','workerCandidateDigest'])assert.match(preview[field],HASH);
  check(await observeState(),originalState,'returned preview fully rolled back staffing/revision/history/receipt/projection/lunch');
  check(success(await call('GET','/static-weekly/manager-snapshot?week_start='+week)),before,'cancel review by no confirmation preserves accepted plan');
  const pending=success(await call('GET','/static-weekly/staffing/operations/'+encodeURIComponent(idempotencyKey)+'?operation=vacate_roster_slot'));
  check(pending.state,'OUTCOME_UNCONFIRMED','preview alone creates no accepted original');check(pending.retry_safe,false,'missing outcome never authorizes a resend');
  await save('task8-vacancy-rollback-preview.json',{preview,pending,unchangedState:await observeState(),reviewedRecords});
  phase='SOURCE_GETTER_RETAINED_REUSE';check(success(await call('GET','/static-weekly/staffing/source-details?'+new URLSearchParams({source_id:vacancySourceId,
   effective_start:serverDay,expected_revision:String(body.expected_revision)}))),details,'source getter preserves current original bindings');
  check(success(await call('POST',path+'/preview',body)),preview,'same original preview returned, not a newly computed equivalent');
  check(await preparations(),reviewedRecords,'source read and retained-preview reuse do not solve');
  const afterSourceRead=await retained();check(afterSourceRead.state,'UNSUBMITTED','source getter never consumes review');check(afterSourceRead.current,true,'source getter retains current original');
  unchangedPreparation(afterSourceRead,originalRetained,'source getter and same-key reuse');
  check(await observeState(),originalState,'retained-preview reuse still accepts no roster/work effect');
  if(recreateLifecycle){phase='NORMAL_LIFECYCLE_RECREATION';const recreated=await recreateLifecycle();
   assert.equal(typeof recreated?.plane?.getManagerSnapshot,'function');assert.equal(typeof recreated?.request,'function');
   plane=recreated.plane;request=recreated.request;lifecycleRecreated=true;
   check(success(await call('GET','/static-weekly/manager-snapshot?week_start='+week)),before,'new normal server/plane reads same current plan');
   check(success(await call('POST',path+'/preview',body)),preview,'exact original reviewed candidate survives normal lifecycle recreation');
   check(await preparations(),reviewedRecords,'new normal plane/server never re-prepares retained candidate');
   const afterLifecycle=await retained();check(afterLifecycle.state,'UNSUBMITTED','new server never submits candidate');check(afterLifecycle.current,true,'same authorized original still current after recreation');
   unchangedPreparation(afterLifecycle,originalRetained,'normal server/plane lifecycle');await save('task8-vacancy-retained-after-lifecycle.json',afterLifecycle);
   check(await observeState(),originalState,'lifecycle recreation never accepts roster/work');
  }
  phase='ONE_CONFIRMATION';const confirmed={...body,preview_digest:preview.previewDigest};await save('task8-vacancy-single-confirmation-input.json',confirmed);
  confirmationCalls++;const reply=await call('POST',path,confirmed);await save('task8-vacancy-confirmation-transport.json',reply);
  check(await preparations(),reviewedRecords,'ONE confirmation uses retained full candidate with NO second solve');
  // Treat the transport reply as unavailable to the consumer: no acceptance
  // assertion uses it. One immutable GET must establish the original result.
  phase='GET_ONLY_ORIGINAL_READBACK';const outcomePath='/static-weekly/staffing/operations/'+encodeURIComponent(idempotencyKey)+'?operation=vacate_roster_slot';
  const outcome=success(await call('GET',outcomePath));await save('task8-vacancy-original-outcome.json',outcome);
  check(outcome.schema,'custodial.original-staffing-outcome.v1','fixed current263 original reader');check(outcome.state,'ACCEPTED_ORIGINAL','accepted original only');
  check(outcome.manager_id,manager.manager_id,'original manager');check(outcome.idempotency_key,idempotencyKey,'original key');check(outcome.operation,'vacate_roster_slot','original operation');
  check(outcome.original_request,{operation:'vacate_roster_slot',source_id:vacancySourceId,slot_id:slotId,employee_id:employeeId,
   effective_start:serverDay,reason,expected_revision:body.expected_revision,actor_manager_id:manager.manager_id},'closed original semantic fields, no invented preview echo');
  check(outcome.retry_safe,false,'GET-only original recovery');check(outcome.phone_released,false,'no phone proof');
  check(outcome.receipt.revision,body.expected_revision+2,'actual final revision');const data=outcome.receipt.data;
  check(data.completion_mode,'projection_required','actual paired projection required');check(data.original_publication_id,baseline.publicationId,'original publication');
  check(data.worker_candidate_digest,preview.workerCandidateDigest,'same complete worker candidate, not full persisted blob');
  assert.match(data.persisted_projection_digest,HASH);assert.notEqual(data.persisted_projection_digest,data.worker_candidate_digest,'server attestation changes persisted identity');checks++;
  check(data.paired_lunch_document_identity,preview.preview.lunchDocument.documentIdentity,'same accepted lunch');check(data.projection_authority_digest,preview.preview.authorityDigest,'same actual authority');
  const current=success(await call('GET','/static-weekly/manager-snapshot?week_start='+week));
  check(current.projection_status,'current','persisted current plan');check(current.authority_revision,preview.resultingRevision,'exact r+2 readback');
  check(current.current_publication,before.current_publication,'same accepted publication/version, no historical substitution');
  check(current.latest_projection.projection_id,data.current_projection.projection_id,'same actual original projection');
  check(current.latest_projection.replay_digest,preview.preview.replayDigest,'same prepared replay');
  const currentSlot=current.roster.find(r=>r.slot_id===slotId);assert.ok(currentSlot);
  for(const row of currentSlot.week_staffing.filter(r=>r.service_date>=serverDay)){check(row.person_id,null,'remaining vacancy no guessed person');check(row.availability_state,'vacant_unfilled','stable vacancy not departure');}
  const finalState=await observeState();check(finalState.revision,originalState.revision+2,'two actual atomic authority effects');
  check(finalState.projections,originalState.projections+1,'one new projection');check(finalState.lunchDocuments,originalState.lunchDocuments+1,'one paired lunch');
  for(const field of ['incumbencies','versions','publications','sources'])check(finalState[field],originalState[field],'immutable '+field+' preserved');
  check(finalState.people.find(r=>r.id===employeeId).active,false,'original deactivated without deletion');
  check(finalState.people.filter(r=>r.id!==employeeId),originalState.people.filter(r=>r.id!==employeeId),'other current people unchanged');
  check(finalState.closures.length,originalState.closures.length+1,'append-only dated closure');
  const lunch=await read(`set role static_weekly_control_plane; select public.static_weekly_v8_read_lunch_document(${q(week)}::date)::text;`);
  check(lunch.projection_id,current.latest_projection.projection_id,'persisted companion belongs to current projection');check(lunch.document_identity,data.paired_lunch_document_identity,'fixed reader current lunch identity');
  check(success(await call('GET',outcomePath)),outcome,'second recovery GET retains exact original immutable outcome');
  check(await observeState(),finalState,'GET-only recovery no additional mutation');
  check(confirmationCalls,1,'ONE confirmation; no automatic resend/new key');
  const consumed=await retained();check(consumed.state,'CONSUMED','private candidate consumed ONLY by persisted original outcome');
  check(consumed.current,false,'accepted r+2 no longer satisfies the original unsubmitted revision fence');
  unchangedPreparation(consumed,originalRetained,'accepted consumption and GET-only recovery');
  check(await preparations(),reviewedRecords,'retained read/consume/recovery do not recompile');await save('task8-vacancy-consumed-original-preparation.json',consumed);
  phase='COMPLETE';const result={scope:'new private retained exact vacancy preparation -> ONE no-solve confirmation -> persisted current plan/lunch -> fixed original GET; SYNTHETIC normal fixture',
   checks,confirmationCalls,managerId:manager.manager_id,weekStart:week,serviceDate:serverDay,sourceId:vacancySourceId,slotId,employeeId,idempotencyKey,
   publicationId:baseline.publicationId,projectionId:current.latest_projection.projection_id,revision:current.authority_revision,
   previewDigest:preview.previewDigest,workerCandidateDigest:preview.workerCandidateDigest,persistedProjectionDigest:data.persisted_projection_digest,
   lunchDocumentIdentity:lunch.document_identity,authorityDigest:data.projection_authority_digest,actualSQL:true,actualHTTP:true,
   realNamedManagerBrowser:false,physical:false,production:false,deniedManagerHTTP:!!deniedRequest,lifecycleRecreated,
   preparationCalls:reviewedRecords.length-beforePreparations.length,confirmationPreparationCalls:0,
   cleanup:'caller-owned pool/compiler/HTTP/socket/container lease remains caller responsibility'};
  await save('task8-vacancy-result.json',{result,current,lunch,finalState});return result;
 }catch(error){try{await save('task8-vacancy-failure.json',{phase,checks,confirmationCalls,body,preview,
   error:{code:error.code??null,message:String(error.message),stack:error.stack},recovery:'preserve original key and body; no POST retry/new key; caller closes exact leased resources'});}catch(captureError){error.captureFailure=captureError;}throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await legacyMidweekVacancyDatabaseProof();
