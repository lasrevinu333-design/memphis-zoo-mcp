import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import pg from 'pg';
import {PDFDocument} from 'pdf-lib';
import {eventAuthorityWeekStart,seedCompiledEventAuthority} from './event-static-authority-fixture.mjs';
import {nonemployeeCoverAllSource} from './nonemployee-coverall-source.mjs';
import {createStaticWeeklyControlPlane} from '../../src/static-weekly-control-plane.js';
import {compileStaticWeeklySchedule} from '../../src/static-weekly-schedule-compiler.js';
import {renderCoverAllPdfPair} from '../../src/static-weekly-coverall-print.js';
import {canonicalJson} from '../../src/static-weekly-schedule-model.js';
import {createStaffingWeekPreviewInput} from '../../src/static-weekly-staffing-preview.js';
import {STAFFING_PREPARATION_LIMITS,enumerateStaffingServiceWindow} from '../../src/static-weekly-staffing-preparation.js';
import {createStaticWeeklyLunchCoverageCandidate} from '../../src/static-weekly-lunch-coverage.js';
import {MANAGER_OPERATION_MILLISECONDS} from '../../src/static-weekly-manager-operation.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated,compileStaticWeeklyScheduleIsolated,shutdownStaticWeeklyCompiler} from '../../src/static-weekly-schedule-compiler-runtime.js';

// Real PostgreSQL and the real transaction owner. Synthetic people/places only;
// no production reads, hand-seeded projection, or guessed PDF authority.
export async function coverallPrintDatabaseProof({sql,container,socketDir}){
 assert.match(container,/^mz_schema_rebuild_oc24_\d+$/);
 const q=v=>`'${String(v).replaceAll("'","''")}'`;
 const parsed=s=>JSON.parse(sql(s).trim().split('\n').at(-1));
 const week='2026-09-28',managerId=randomUUID();
 const people=Array.from({length:5},(_,i)=>({id:randomUUID(),slot:randomUUID(),name:`Synthetic OC24 ${i===4?'CoverAll':i}`}));
 const locations=Array.from({length:16},(_,i)=>({id:randomUUID(),code:'OC24_AREA_'+i,name:'Synthetic OC24 area '+i}));
 const lunches=[['12:00','13:00'],['12:30','13:30'],['10:00','11:00'],['14:00','15:00']];
 const pool=new pg.Pool({host:socketDir,user:'supabase_admin',password:'postgres',database:'postgres',max:4,connectionTimeoutMillis:5000});
 const plane=createStaticWeeklyControlPlane({database:pool,compiler:async input=>{
  const result=await compileStaticWeeklySchedule(input);
  console.log('OC24_COMPILE_DIAGNOSTIC',JSON.stringify({status:result.status,publicationAuthority:result.publicationAuthority,fatal:result.fatal,reviewWork:result.reviewWork,verifier:result.verifier}));
  if(process.env.OC24_SYNTHETIC_COMPILER_INPUT)writeFileSync(process.env.OC24_SYNTHETIC_COMPILER_INPUT,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
  if(result.status==='FEASIBLE'){
   const candidate=createStaticWeeklyLunchCoverageCandidate(input,result);
   console.log('OC24_LUNCH_DIAGNOSTIC',JSON.stringify(candidate.lunches.map(l=>({owner:l.normalOwnerSlotId,status:l.status,reason:l.reason,helpers:l.helperSlotIds?.length,areas:l.responsibilities?.length}))));
  }
  return result;
 }});
 const manager={manager_id:managerId,manager_display_name:'Synthetic OC24 Manager'};
 let checks=0;const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
 try{
  sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(managerId)},${q(manager.manager_display_name)});
   insert into public.employees(id,display_name,role) values ${people.map(p=>`(${q(p.id)},${q(p.name)},'staff')`).join(',')};`);
  for(const l of locations)sql(`insert into public.locations(id,location_code,location_name,location_type,form_type) values(${q(l.id)},${q(l.code)},${q(l.name)},'restroom','restroom');
   insert into public.location_groups(id,group_code,group_name) values(${q(l.id)},${q(l.code)},${q(l.name)});
   insert into public.location_group_memberships(location_group_id,location_id) values(${q(l.id)},${q(l.id)});`);
  const availability=(p,i)=>({slotId:p.slot,dayOfWeek:1,status:'working',shift:{start:'07:00',end:i===4?'15:00':'17:00'},
   ...(i<4?{lunch:{start:lunches[i][0],end:lunches[i][1]}}:{}),productiveCapacityProvenance:'synthetic-shift',maxServiceEffortMinutes:300,
   maxServiceEffortProvenance:'synthetic-capacity',qualifications:['general'],qualificationProvenance:'synthetic-role',restrictions:[],restrictionProvenance:'synthetic-restrictions',
   acceptedRouteAnchorLocationId:locations[i<4?i*4:0].id,acceptedRouteProvenance:'synthetic-normal-area'});
  const {slotId:ignored,...contractorAvailability}=availability(people[4],4);
  const source={serviceDate:week,timezone:'America/Chicago',exceptions:[],
   slots:people.map((p,i)=>({id:p.slot,label:p.name,incumbencies:[{personId:p.id,displayName:p.name,effectiveStart:'2020-01-01',effectiveEnd:null}],
    ...(i===4?{contractorCapacity:true,contractorAvailability:[contractorAvailability]}:{})})),
   proximity:locations.flatMap(from=>locations.filter(to=>to.id!==from.id).map(to=>({from:from.id,to:to.id,minutes:1,verified:true,provenance:'synthetic fixture'}))),
   versions:[{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:week,effectiveEnd:null,
    objective:{requireVerifiedProximity:true},slotAvailability:people.map((p,i)=>i===4?{slotId:p.slot,dayOfWeek:1,status:'unavailable'}:availability(p,i)),
    assignments:locations.flatMap((l,i)=>[
     {workId:l.code+'-morning',window:{start:'07:00',end:'09:45'}},
     {workId:l.code+'-day',window:{start:'09:45',end:'15:00'}},
     {workId:l.code+'-closing',window:{start:'15:00',end:'16:00'}},
    ].map(w=>({...w,dayOfWeek:1,ownerSlotId:people[Math.floor(i/4)].slot,locationId:l.id,locationCodeSnapshot:l.code,locationNameSnapshot:l.name,
     includedLocations:[{locationId:l.id,locationNameSnapshot:l.name}],schedulingMode:'flexible_coverage_ownership',serviceEffortMinutes:5,serviceEffortProvenance:'synthetic-effort',
     priority:2,priorityProvenance:'synthetic-priority',requiredQualifications:['general'],qualificationProvenance:'synthetic-work-role',restrictions:[],restrictionProvenance:'synthetic-work-restrictions'})))}]};
  const seeded=await seedCompiledEventAuthority({sql,container,managerId,dates:[week],source,label:'oc24-print',mode:'official'});
  const before=await plane.getManagerSnapshot({manager,weekStart:week});
  check('baseline has no manual contractor',before.exceptions.some(e=>e.type==='cover_all'),false);
  const lunchProbe=(date,start='11:00',end='12:00')=>`select public.static_weekly_assert_exception_payload('lunch',${q(date)}::date,${q(start)}::time,${q(end)}::time,${q(seeded.versionId)}::uuid,${q(seeded.publicationId)}::uuid,jsonb_build_object('slotId',${q(people[4].slot)}),null)`;
  assert.throws(()=>sql(lunchProbe(week)),/working slot/);checks++;
  for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
   assert.throws(()=>sql(`set role ${role};${lunchProbe(week)}`),/permission denied/);checks++;
  }
  const history=sql('select md5(jsonb_agg(to_jsonb(p) order by projection_id)::text) from public.weekly_schedule_compiled_projections p').trim();
  console.log('OC24_REAL_MANUAL_CAPACITY_TRANSACTION');
  const request={manager,serviceDate:week,baseVersionId:seeded.versionId,publicationId:seeded.publicationId,
   slotId:people[4].slot,shift:{start:'07:00',end:'15:00'},reason:'Explicit synthetic manager addition, no absence trigger',
   expectedRevision:before.authority_revision,idempotencyKey:'oc24-manual-capacity',projectionWeekStart:week};
  // Explicit synthetic lunch fact. The UI must accept this with capacity in
  // one existing atomic batch; no default/inferred contractor lunch is used.
  const accepted=await plane.applyContractorCapacity({...request,lunch:{start:'11:00',end:'12:00'}});
  check('exact whole action retry',await plane.applyContractorCapacity({...request,lunch:{start:'11:00',end:'12:00'}}),accepted);
  await assert.rejects(()=>plane.applyContractorCapacity({...request,lunch:{start:'12:00',end:'13:00'}}),e=>e.code==='23505');checks++;
  check('changed lunch retry rolls back',(await plane.getManagerSnapshot({manager,weekStart:week})).authority_revision,accepted.revision);
  assert.throws(()=>sql(lunchProbe('2026-09-29')),/working slot/);checks++;
  for(const [start,end] of [['06:00','07:00'],['14:30','15:30'],['13:00','13:30']]){
   assert.throws(()=>sql(lunchProbe(week,start,end)),/working slot|duplicate semantic/);checks++;
  }
  // Replay the exact newly inventoried helper, preserving its private ACL.
  const identity='public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)';
  const defs=parsed(`select json_agg(definition_sql order by restore_order) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and object_identity like '%(%' and to_regprocedure(object_identity)=${q(identity)}::regprocedure`);
  check('helper definition and permissions inventoried',defs.length,2);
  sql(`drop function ${identity};`);
  for(const definition of defs)sql(definition);
  assert.throws(()=>sql(lunchProbe('2026-09-29')),/working slot/);checks++;
  assert.throws(()=>sql(`set role service_role;${lunchProbe(week)}`),/permission denied/);checks++;
  const snapshot=await plane.getManagerSnapshot({manager,weekStart:week});
  check('explicit capacity accepted without any absence',snapshot.exceptions.filter(e=>e.type==='cover_all').length,1);
  check('new projection current',snapshot.projection_status,'current');
  assert.notEqual(snapshot.latest_projection.projection_id,before.latest_projection.projection_id);checks++;
  check('old publication/projection preserved',sql(`select md5(jsonb_agg(to_jsonb(p) order by projection_id)::text) from public.weekly_schedule_compiled_projections p where projection_id=${q(before.latest_projection.projection_id)}`).trim(),history);
  const binding={manager,weekStart:week,serviceDate:week,expectedRevision:accepted.revision,projectionId:accepted.data.projection_id};
  const doc=await plane.getCoverAllPrintDocument(binding);
  check('PDF same accepted revision',doc.authorityRevision,snapshot.authority_revision);
  check('PDF same accepted projection',doc.projectionId,snapshot.latest_projection.projection_id);
  check('PDF actual contractor shift',doc.contractors[0].shift,{start:'07:00',end:'15:00'});
  check('PDF actual contractor lunch',doc.contractors[0].lunch,{start:'11:00',end:'12:00'});
  check('September27 owner personally verifies contractor completion',doc.contractorCompletionRecorder,'ERIC_OPERLE_PERSONAL_VERIFICATION');
  assert.ok(doc.contractors[0].periods.some(p=>p.areas.length),'real compiler assigned manual capacity');checks++;
  assert.ok(doc.contractors[0].shiftEndHandoffs.length>0,'actual handoff at contractor departure');checks++;
  check('shift-end coverage names actual remaining workers',doc.contractors[0].shiftEndHandoffs.every(h=>h.nextOwners.length>0&&h.nextOwners.every(n=>people.slice(0,4).some(p=>p.name===n))),true);
  const lunch=parsed(`select public.static_weekly_v8_read_lunch_document(${q(week)}::date)::text`);
  check('PDF same persisted lunch',doc.lunchDocumentIdentity,lunch.document_identity);
  for(const p of people){
   const day=parsed(`select public.static_weekly_v5_read_employee_day(${q(week)}::date,${q(p.id)}::uuid,${q(week+'T12:00:00-05:00')}::timestamptz)::text`);
   check('each schedule shares accepted projection '+p.name,day.projection_id,doc.projectionId);
   check('each schedule consumes persisted lunch '+p.name,day.lunch_coverage_status,'PERSISTED');
  }
  const pair=await renderCoverAllPdfPair(doc);check('two languages together',pair.files.map(f=>f.language),['en','es']);
  for(const f of pair.files){const pdf=await PDFDocument.load(Buffer.from(f.base64,'base64'));assert.ok(pdf.getSubject().includes(`projection=${doc.projectionId}; revision=${doc.authorityRevision}; document=${doc.documentDigest}`));checks++;}
  await assert.rejects(()=>plane.getCoverAllPrintDocument({...binding,expectedRevision:before.authority_revision,projectionId:before.latest_projection.projection_id}),/accepted_revision_required/);checks++;
  check('PDF retries do not mutate authority',(await plane.getManagerSnapshot({manager,weekStart:week})).authority_revision,accepted.revision);
  console.log(JSON.stringify({status:'PASS',checks,scope:'actual no-network PostgreSQL, official publication, real control-plane manual mutation and PDF reader, all employee readers, bilingual PDF parsing',production:false,independentAudit:false}));
 }finally{await plane.close();await shutdownStaticWeeklyCompiler();}
}

// NEW one-date staffing preview -> one confirmation -> accepted handout join.
// Caller owns the existing protected fixture, its current schema/seed and plane.
// No Docker, schema replay, roster seed, fake compiler, retry or cleanup here.
export async function staffingPreviewToCoverAllHandoutProof({sql,plane,manager,request,confirmationKey,weekStart,capture=null,includeHandout=true,
 authenticatedRequests=false}){
 const q=v=>`'${String(v).replaceAll("'","''")}'`;
 const read=async statement=>JSON.parse(String(await sql(statement)).trim().split('\n').at(-1));
 const hash=v=>createHash('sha256').update(canonicalJson(v)).digest('hex');
 let phase='INPUT',operationId=null,confirmationCalls=0;
 assert.ok(capture===null||typeof capture==='function');
 assert.equal(typeof includeHandout,'boolean');
 assert.equal(typeof authenticatedRequests,'boolean');
 const run=work=>authenticatedRequests?plane.runManagerOperation({manager,permission:'manage_absences',
  signal:new AbortController().signal,deadlineAt:performance.now()+MANAGER_OPERATION_MILLISECONDS},work):work();
 const save=async(name,value)=>{if(capture)await capture(name,value);const json=JSON.stringify(value);
  return{resultSha256:createHash('sha256').update(json).digest('hex'),bytes:Buffer.byteLength(json)};};
 const progress=value=>console.log('TASK8_STAFFING_HANDOUT_JOIN',JSON.stringify({phase,operationId,
  inputSha256:value.inputSha256??null,status:value.status??null,resultSha256:value.resultSha256??null,
  bytes:value.bytes??null,authorityRevision:value.authorityRevision??null}));
 assert.equal(typeof sql,'function');assert.ok(plane&&manager&&request);
 assert.equal(request.commandKind,'absence','this finite member is one new dated absence, not recurring replacement');
 const window=enumerateStaffingServiceWindow(request.startDate,request.endDate);
 assert.equal(window.weeks[0],weekStart);
 assert.ok(window.weeks.length===1||(!includeHandout&&window.weeks.length===2&&authenticatedRequests),
  'multiweek member requires normal authenticated requests and excludes the retained PDF matrix');
 if(includeHandout)assert.equal(request.startDate,request.endDate,'handout member remains one dated input');
 assert.match(confirmationKey,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
 const serviceDate=request.startDate;
 try{
  const before=await run(()=>plane.getManagerSnapshot({manager,weekStart}));
  assert.equal(before.authority_revision,request.expectedRevision);
  assert.equal(before.projection_status,'current');
  const manualSlots=before.exceptions.filter(row=>row.type==='cover_all'&&row.serviceDate===serviceDate)
   .map(row=>row.payload.availability.slotId).sort();
  assert.ok(manualSlots.length>0&&manualSlots.length<=8,'main must supply already accepted manual CoverAll on this actual date');
  const beforeWeeks=[];
  for(const week of window.weeks){
   const snapshot=week===weekStart?before:await run(()=>plane.getManagerSnapshot({manager,weekStart:week}));
   assert.equal(snapshot.projection_status,'current');assert.equal(snapshot.authority_revision,request.expectedRevision);
   assert.equal(snapshot.current_service_date,before.current_service_date);
   assert.ok(snapshot.exceptions.some(row=>row.type==='cover_all'&&row.serviceDate===week),
    'each affected working Monday needs its own explicit accepted manual capacity');
   beforeWeeks.push(snapshot);
  }
  phase='BEGIN';const begun=await run(()=>plane.beginStaffingCommand({manager,...request}));operationId=begun.operation_id;
  progress({status:'BEGIN_RETURNED',...await save('task8-join-begin.json',{begun,request,confirmationKey})});
  assert.equal(begun.state,'PREPARING','must be a genuinely new case, not replay of a completed operation');
  const command=await run(()=>plane.getStaffingCommand({manager,operationId}));
  assert.equal(command.prepared_by_manager_id,manager.manager_id);
  assert.equal(command.semantic_body.commandKind,'absence');
  assert.equal(command.semantic_body.employeeId,request.employeeId);
  assert.equal(command.semantic_body.startDate,request.startDate);assert.equal(command.semantic_body.endDate,request.endDate);
  const publicationId=before.current_publication.publication_id;
  // Normal source reader/signature and the exact owning overlay. This capture
  // identifies the changed input BEFORE main's one normal preparation/solve.
  const overlays=[];
  for(const snapshot of beforeWeeks){
   const week=snapshot.week_start,pub=snapshot.current_publication.publication_id;
   const source=await read(`set role static_weekly_control_plane;select public.static_weekly_v3_read_publication_source(${q(pub)}::uuid,${q(week)}::date)::text;reset role`);
   const overlay=createStaffingWeekPreviewInput({operationId,managerId:manager.manager_id,
    semanticBody:command.semantic_body,expectedRevision:command.expected_revision,weekStart:week,source,
    currentServiceDate:command.current_service_date});
   assert.equal(source.version_id,snapshot.display_version.version_id);
   overlays.push({weekStart:week,source,...overlay});
  }
  const overlay=overlays[0],source=overlay.source;
  const inputCapture={operationId,semanticDigest:command.semantic_digest,publicationId,
   versionId:source.version_id,expectedRevision:command.expected_revision,
   inputSha256:hash(overlays.length===1?overlay.input:overlays.map(row=>row.input)),input:overlay.input,
   weeks:overlays.map(row=>({weekStart:row.weekStart,publication:row.publication,input:row.input,inputSha256:hash(row.input)}))};
  phase='PREPARE';progress({inputSha256:inputCapture.inputSha256,status:'INPUT_CAPTURED',...await save('task8-join-input.json',inputCapture)});
  const stageReceipt=await run(()=>plane.prepareStaffingCommand({manager,operationId}));
  await save('task8-join-stage.json',stageReceipt);
  assert.equal(stageReceipt.state,'PREPARED');
  // Stage returns only its receipt. The existing private reader supplies the
  // actual preview/selector DTO; never fabricate it from a compiler return.
  const prepared=await run(()=>plane.getStaffingCommand({manager,operationId}));
  await save('task8-join-prepared.json',prepared);
  assert.equal(prepared.state,'PREPARED');assert.equal(prepared.expected_revision,request.expectedRevision);
  assert.equal(prepared.prepared_by_manager_id,manager.manager_id);
  assert.deepEqual(prepared.publication_vector,{expectedRevision:request.expectedRevision,weeks:overlays.map(row=>row.publication)});
  assert.match(prepared.preview_digest,/^[0-9a-f]{64}$/);
  assert.equal(prepared.preview.schema,'memphis-zoo.staffing-command-preview.v1');
  assert.deepEqual(prepared.preview.weeks.map(row=>row.week_start),window.weeks);
  const staged=await read(`select json_agg(json_build_object('kind',candidate_kind,'week_start',service_date::text,'payload',payload_json) order by service_date,candidate_kind) from public.static_weekly_staffing_staged_candidates where operation_id=${q(operationId)}::uuid and candidate_kind in ('projection','lunch')`);
  assert.equal(staged.length,2*window.weeks.length);const bound=[];
  for(const [index,week] of window.weeks.entries()){
   const rows=staged.filter(row=>row.week_start===week);assert.equal(rows.length,2);
   const projection=rows.find(row=>row.kind==='projection').payload,lunch=rows.find(row=>row.kind==='lunch').payload;
   const view=prepared.preview.weeks[index],prior=beforeWeeks[index];
   assert.equal(view.publicationId,prior.current_publication.publication_id);
   assert.equal(view.versionId,prior.display_version.version_id);
   assert.equal(projection.publicationId,view.publicationId);
   assert.equal(projection.envelope.authority.compilerInput.version.id,view.versionId);
   assert.equal(view.database_projection_identity,projection.envelope.database_projection_identity);
   assert.equal(view.replayDigest,projection.replayDigest);
   assert.deepEqual(view.assignments,projection.envelope.assignments);
   assert.deepEqual(view.lunch_loans,lunch.loans);assert.deepEqual(view.lunch_responsibilities,lunch.responsibilities);
   const current=await run(()=>plane.getManagerSnapshot({manager,weekStart:week}));
   assert.equal(current.authority_revision,request.expectedRevision,'private prepare advances no authority');
   assert.equal(current.latest_projection.projection_id,prior.latest_projection.projection_id);
   assert.deepEqual(current.exceptions,prior.exceptions);
   bound.push({weekStart:week,projection,lunch});
  }
  const {projection,lunch}=bound[0];
  phase='CONFIRM';progress({status:'CONFIRMING',...await save('task8-join-confirmation.json',{
   operationId,previewDigest:prepared.preview_digest,inputDigest:prepared.input_digest,
   candidateSetDigest:prepared.candidate_set_digest,confirmationKey,staged})});
  confirmationCalls++;
  const accepted=await run(()=>plane.acceptStaffingCommand({manager,operationId,previewDigest:prepared.preview_digest,confirmationKey}));
  // Never retry automatically on an exception: retain original operation/key.
  phase='ACCEPTED_READBACK';progress({status:'ACCEPTANCE_RETURNED',authorityRevision:accepted.authority_revision,
   ...await save('task8-join-accepted.json',accepted)});
  assert.equal(accepted.event,'ACCEPTED');assert.equal(accepted.operation_id,operationId);
  assert.equal(accepted.preview_digest,prepared.preview_digest);
  assert.equal(accepted.candidate_set_digest,prepared.candidate_set_digest);
  assert.equal(accepted.authority_revision,request.expectedRevision+1);
  // After the single reply, the original typed GET is the recovery source.
  const persistedCommand=await run(()=>plane.getStaffingCommand({manager,operationId}));
  assert.equal(persistedCommand.state,'ACCEPTED');assert.equal(persistedCommand.accepted_revision,accepted.authority_revision);
  assert.equal(persistedCommand.prepared_by_manager_id,manager.manager_id);
  assert.deepEqual(persistedCommand.semantic_body,command.semantic_body);
  const receipt=persistedCommand.accepted_receipt;
  assert.equal(receipt.preview_digest,prepared.preview_digest);assert.equal(receipt.manager_id,manager.manager_id);
  assert.equal(receipt.original_preparer_manager_id,manager.manager_id);
  // The normal accept RPC appends replayed only to its response, never the
  // immutable stored receipt. This new one-confirm member must not replay.
  assert.equal(Object.hasOwn(accepted,'replayed'),true);assert.equal(accepted.replayed,false);
  assert.equal(Object.hasOwn(receipt,'replayed'),false);
  const {replayed,...acceptedReceipt}=accepted;
  assert.deepEqual(receipt,acceptedReceipt);assert.deepEqual(Object.keys(receipt.projections).sort(),window.weeks);
  const after=[];
  for(const {weekStart:week,projection:expected,lunch:expectedLunch} of bound){
   const current=await run(()=>plane.getManagerSnapshot({manager,weekStart:week})),map=receipt.projections[week];
   const prior=beforeWeeks.find(row=>row.week_start===week);
   assert.equal(current.projection_status,'current');assert.equal(current.authority_revision,receipt.authority_revision);
   assert.equal(current.current_publication.publication_id,prior.current_publication.publication_id);
   assert.equal(current.display_version.version_id,prior.display_version.version_id);
   assert.equal(current.latest_projection.projection_id,map.projection_id);
   assert.equal(current.latest_projection.replay_digest,expected.replayDigest);
   assert.equal(map.projection_identity,expected.envelope.database_projection_identity);
   assert.equal(map.lunch_document_identity,expectedLunch.document_identity);
   assert.deepEqual(current.latest_projection.assignments,expected.envelope.assignments,'same reviewed candidate drives each persisted week');
   after.push(current);
  }
  const mapping=receipt.projections[weekStart];
  const persisted=await read(`select json_build_object('authorityRows',(select count(*) from public.weekly_schedule_authority_revisions where authority_revision=${accepted.authority_revision} and operation='apply_staffing_command' and command_id=${q(operationId)}::uuid),'receiptRows',(select count(*) from public.static_weekly_staffing_command_receipts where operation_id=${q(operationId)}::uuid and event_kind='ACCEPTED'),'pairedRows',(select count(*) from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id) where p.projection_id in (${Object.values(receipt.projections).map(row=>q(row.projection_id)+'::uuid').join(',')})))`);
  assert.deepEqual(persisted,{authorityRows:1,receiptRows:1,pairedRows:window.weeks.length});
  let doc=null,files=[];
  if(includeHandout){
  phase='HANDOUT';
  const binding={manager,weekStart,serviceDate,expectedRevision:accepted.authority_revision,projectionId:mapping.projection_id};
  doc=await plane.getCoverAllPrintDocument(binding);
  assert.equal(doc.serviceDate,serviceDate);assert.equal(doc.authorityRevision,accepted.authority_revision);
  assert.equal(doc.publicationId,publicationId);assert.equal(doc.projectionId,mapping.projection_id);
  assert.equal(doc.replayDigest,projection.replayDigest);assert.equal(doc.lunchDocumentIdentity,lunch.document_identity);
  assert.equal(doc.lunchDocumentIdentity,mapping.lunch_document_identity);
  assert.equal(doc.managerContact.managerId,manager.manager_id);
  assert.deepEqual(doc.contractors.map(row=>row.slotId).sort(),manualSlots,'no automatic contractor or historical substitution');
  assert.equal(doc.contractorCompletionRecorder,'ERIC_OPERLE_PERSONAL_VERIFICATION');
  const pair=await renderCoverAllPdfPair(doc);
  await save('task8-join-handout.json',pair);
  assert.deepEqual(pair.files.map(row=>row.language),['en','es']);assert.equal(pair.bilingualFile.language,'en-es');
  for(const text of pair.texts)assert.equal(text.documentDigest,doc.documentDigest);
  for(const file of [...pair.files,pair.bilingualFile]){
   assert.equal(file.filename,`CoverAll_${serviceDate}_r${accepted.authority_revision}_${file.language}.pdf`);
   const bytes=Buffer.from(file.base64,'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
   const pdf=await PDFDocument.load(bytes);
   assert.ok(pdf.getSubject().includes(`projection=${doc.projectionId}; revision=${doc.authorityRevision}; document=${doc.documentDigest}`));
  }
  assert.equal((await plane.getManagerSnapshot({manager,weekStart})).authority_revision,accepted.authority_revision,
   'handout read/render advances no authority');
  files=[...pair.files,pair.bilingualFile].map(({language,filename,sha256})=>({language,filename,sha256}));
  }
  assert.equal(confirmationCalls,1);
  phase='COMPLETE';const result={scope:includeHandout?'one actual staffing private preview/confirmation/persisted revision/current handout join; fixture only'
   :'new normal accepted absence prerequisite for original cancellation; no PDF rendering; fixture only',
   operationId,confirmationKey,inputCapture,prepared,accepted,persisted,persistedCommand,after,window,document:doc,
   files,
   confirmationCalls,phoneDeliveryProven:false,realManagerBrowserProven:false,production:false};
  progress({status:'COMPLETE',authorityRevision:accepted.authority_revision,...await save('task8-join-result.json',result)});return result;
 }catch(error){
  const failure={phase,operationId,confirmationKey,request,confirmationCalls,error:{...error,message:String(error.message),stack:error.stack},
   recovery:'read original operation outcome; do not create/resend or cancel automatically'};
  try{progress({status:'FAILED',...await save('task8-join-failure.json',failure)});}
  catch(captureError){progress({status:'FAILURE_CAPTURE_FAILED'});error.captureFailure=captureError;}
  throw error;
 }
}

// NEW continuation of a genuinely accepted original absence in the SAME
// protected fixture. Caller supplies that operation; never INSERT an accepted
// command/projection/receipt. All product mutations use the normal plane.
// No PDF/old solve suite, legacy exception reversal, SQL runner or child owner.
export async function staffingOriginalAbsenceCancellationProof({sql,plane,manager,originalOperationId,
 weekStart,clientPrepareKey,confirmationKey,capture,authenticatedRequests=false}){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const digest=/^[0-9a-f]{64}$/;
 assert.equal(typeof sql,'function');assert.equal(typeof capture,'function','complete owned-file capture is required');
 assert.ok(plane&&manager?.manager_id);assert.equal(eventAuthorityWeekStart(weekStart),weekStart);
 assert.equal(typeof authenticatedRequests,'boolean');
 const run=work=>authenticatedRequests?plane.runManagerOperation({manager,permission:'manage_absences',
  signal:new AbortController().signal,deadlineAt:performance.now()+MANAGER_OPERATION_MILLISECONDS},work):work();
 for(const id of [originalOperationId,clientPrepareKey,confirmationKey])assert.match(id,uuid);
 assert.equal(new Set([originalOperationId,clientPrepareKey,confirmationKey]).size,3);
 const q=value=>`'${String(value).replaceAll("'","''")}'`;
 const read=async statement=>JSON.parse(String(await sql(statement)).trim().split('\n').at(-1));
 const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
 let phase='ORIGINAL_READ',operationId=null,request=null,confirmationCalls=0;
 const save=async(name,value)=>{await capture(name,value);const bytes=Buffer.from(JSON.stringify(value));
  console.log('TASK8_ORIGINAL_CANCELLATION',JSON.stringify({phase,operationId,
   resultSha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}));};
 const targetFields=['staffingAbsenceId','staffingEmployeeId','staffingStartDate','staffingEndDate','staffingAcceptedOperationId'];
 const selectedTarget=row=>Object.fromEntries(targetFields.map(key=>[key,row[key]]));
 try{
  const original=await run(()=>plane.getStaffingCommand({manager,operationId:originalOperationId}));
  await save('task8-cancel-original.json',original);
  assert.equal(original?.state,'ACCEPTED','requires genuine normal accepted absence; not a seed INSERT');
  assert.equal(original.operation_id,originalOperationId);assert.equal(original.semantic_body.commandKind,'absence');
  assert.equal(original.accepted_receipt.operation_id,originalOperationId);
  assert.equal(original.accepted_receipt.event,'ACCEPTED');
  assert.equal(original.accepted_revision,original.accepted_receipt.authority_revision);
  const body=original.semantic_body;
  assert.match(body.employeeId,uuid);enumerateStaffingServiceWindow(body.startDate,body.endDate);
  const initial=await run(()=>plane.getManagerSnapshot({manager,weekStart}));
  await save('task8-cancel-snapshot-initial.json',initial);
  const serverDay=initial.current_service_date;
  enumerateStaffingServiceWindow(serverDay,serverDay); // strict server civil label; no local clock
  assert.equal(initial.projection_status,'current');
  assert.ok(Number.isSafeInteger(initial.authority_revision)&&initial.authority_revision>=original.accepted_revision);
  const startDate=body.startDate>serverDay?body.startDate:serverDay;
  assert.ok(startDate<=body.endDate,'elapsed original absence has no cancellable remaining window');
  const window=enumerateStaffingServiceWindow(startDate,body.endDate),before=[],overlays=[];
  const expectedTarget={staffingAbsenceId:originalOperationId,staffingEmployeeId:body.employeeId,
   staffingStartDate:body.startDate,staffingEndDate:body.endDate,staffingAcceptedOperationId:originalOperationId};
  // The independent original ledger list remains visible even if today's
  // compiler exceptions omit the replaced person. Never fabricate a dated
  // exception/slot to pass this check. Every remaining week must bind it.
  for(const week of window.weeks){
   const snapshot=week===weekStart?initial:await run(()=>plane.getManagerSnapshot({manager,weekStart:week}));
   assert.equal(snapshot.week_start,week);assert.equal(snapshot.projection_status,'current');
   assert.equal(snapshot.current_service_date,serverDay);assert.equal(snapshot.authority_revision,initial.authority_revision);
   assert.match(snapshot.current_publication?.publication_id,uuid);assert.match(snapshot.display_version?.version_id,uuid);
   const originals=snapshot.canonical_staffing_absences;
   assert.ok(Array.isArray(originals)&&originals.length<=100000,'current typed original target snapshot list required');
   assert.ok(Buffer.byteLength(JSON.stringify(originals))<=16777216);
   const sourceRows=originals.filter(row=>row.staffingAbsenceId===originalOperationId);
   assert.equal(sourceRows.length,1,'one original accepted source row, not an inferred current occupant');
   const sourceRow=sourceRows[0];assert.equal(Object.keys(sourceRow).length,9);
   assert.deepEqual(selectedTarget(sourceRow),expectedTarget);assert.equal(sourceRow.status,'accepted');
   assert.equal(sourceRow.sourceKind,'canonical_staffing_absence');assert.equal(sourceRow.absenceKind,body.absenceKind);
   assert.equal(sourceRow.actorId,original.accepted_receipt.manager_id);
   const dates=window.dates.filter(date=>eventAuthorityWeekStart(date)===week);
   for(const date of dates){
    const rows=snapshot.exceptions.filter(row=>row.staffingAbsenceId===originalOperationId&&row.serviceDate===date);
    assert.ok(rows.length<=1,'no duplicate original compiler exception');
    if(rows.length){const row=rows[0];assert.deepEqual(selectedTarget(row),expectedTarget);
     assert.equal(row.id,`${originalOperationId}:${date}`);assert.equal(row.status,'accepted');
     assert.equal(row.actorId,original.accepted_receipt.manager_id);}
   }
   before.push(snapshot);
  }
  request={commandKind:'cancel_absence',employeeId:expectedTarget.staffingEmployeeId,targetAbsenceId:expectedTarget.staffingAbsenceId,
   startDate,endDate:expectedTarget.staffingEndDate,clientPrepareKey,expectedRevision:initial.authority_revision};
  const originalFact=await read(`select to_jsonb(a) from public.static_weekly_staffing_absences a where absence_id=${q(originalOperationId)}::uuid`);
  assert.equal(originalFact.employee_id,body.employeeId);assert.equal(originalFact.start_date,body.startDate);
  assert.equal(originalFact.end_date,body.endDate);assert.equal(originalFact.accepted_operation_id,originalOperationId);
  const historyIds=[...new Set(before.map(row=>row.latest_projection.projection_id))];
  const historyQuery=`select json_agg(json_build_object('projection',to_jsonb(p),'lunch',to_jsonb(l)) order by p.projection_id) from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id) where p.projection_id in (${historyIds.map(id=>q(id)+'::uuid').join(',')})`;
  const historyBefore=await read(historyQuery);assert.equal(historyBefore.length,historyIds.length);
  await save('task8-cancel-input.json',{originalOperationId,originalFact,expectedTarget,request,confirmationKey,
   serverDay,window,before,historyBefore});
  phase='CANCEL_BEGIN';
  const begun=await run(()=>plane.beginStaffingCommand({manager,...request}));operationId=begun.operation_id;
  await save('task8-cancel-begin.json',begun);
  assert.match(operationId,uuid);assert.equal(begun.state,'PREPARING');assert.equal(begun.replayed,false);
  const command=await run(()=>plane.getStaffingCommand({manager,operationId}));
  assert.equal(command.prepared_by_manager_id,manager.manager_id);assert.equal(command.current_service_date,serverDay);
  assert.deepEqual(command.semantic_body,{absenceKind:null,commandKind:'cancel_absence',employeeId:body.employeeId,
   startDate,endDate:body.endDate,targetAbsenceId:originalOperationId});
  assert.deepEqual(command.original_cancellation_target,{absenceId:originalOperationId,employeeId:body.employeeId,
   startDate:body.startDate,endDate:body.endDate,acceptedOperationId:originalOperationId,status:'accepted'},
   'only authenticated typed command read supplies the private original target');
  // Actual CURRENT source for every publication. Cancellation removes only
  // the target in the remaining window; it is not a historical-plan restore.
  for(const snapshot of before){
   const week=snapshot.week_start,publicationId=snapshot.current_publication.publication_id;
   const source=await read(`set role static_weekly_control_plane;select public.static_weekly_v3_read_publication_source(${q(publicationId)}::uuid,${q(week)}::date)::text;reset role`);
   const overlay=createStaffingWeekPreviewInput({operationId,managerId:manager.manager_id,
    semanticBody:command.semantic_body,expectedRevision:request.expectedRevision,weekStart:week,source,currentServiceDate:serverDay,
    originalCancellationTarget:command.original_cancellation_target});
   assert.deepEqual(overlay.input.versions,[source.compiler_input.version]);
   assert.deepEqual(overlay.input.slots,source.compiler_input.slots);assert.deepEqual(overlay.input.proximity,source.compiler_input.proximity);
   const targetInRemaining=row=>(row.staffingAbsenceId===originalOperationId||String(row.id||'').startsWith(`${originalOperationId}:`))
    &&row.serviceDate>=startDate&&row.serviceDate<=body.endDate;
   // Empty current target is legitimate ONLY with the typed original ledger
   // fact above; the actual main CP must consume that same reader field.
   assert.deepEqual(overlay.input.exceptions,source.exceptions.filter(row=>!targetInRemaining(row)),
    'only original remaining absence is removed; current manual capacity/lunch/other facts survive');
   overlays.push({weekStart:week,source,publication:overlay.publication,input:overlay.input,inputSha256:hash(overlay.input)});
  }
  await save('task8-cancel-current-source-inputs.json',overlays);
  phase='CANCEL_PREPARE';
  const stage=await run(()=>plane.prepareStaffingCommand({manager,operationId}));await save('task8-cancel-stage.json',stage);
  assert.equal(stage.state,'PREPARED');
  const prepared=await run(()=>plane.getStaffingCommand({manager,operationId}));await save('task8-cancel-prepared.json',prepared);
  assert.equal(prepared.state,'PREPARED');assert.equal(prepared.operation_id,operationId);
  assert.deepEqual(prepared.original_cancellation_target,command.original_cancellation_target);
  assert.deepEqual(prepared.semantic_body,command.semantic_body);assert.equal(prepared.expected_revision,request.expectedRevision);
  for(const field of ['preview_digest','candidate_set_digest','input_digest'])assert.match(prepared[field],digest);
  assert.deepEqual(prepared.publication_vector,{expectedRevision:request.expectedRevision,weeks:overlays.map(row=>row.publication)});
  assert.equal(prepared.preview.schema,'memphis-zoo.staffing-command-preview.v1');
  assert.deepEqual(prepared.preview.weeks.map(row=>row.week_start),window.weeks);
  const staged=await read(`select json_agg(json_build_object('kind',candidate_kind,'week_start',service_date::text,'payload',payload_json) order by service_date,candidate_kind) from public.static_weekly_staffing_staged_candidates where operation_id=${q(operationId)}::uuid and candidate_kind in ('projection','lunch')`);
  await save('task8-cancel-staged.json',staged);assert.equal(staged.length,2*window.weeks.length);
  const bound=[];
  for(const [index,week] of window.weeks.entries()){
   const rows=staged.filter(row=>row.week_start===week);assert.equal(rows.length,2);
   const projection=rows.find(row=>row.kind==='projection')?.payload,lunch=rows.find(row=>row.kind==='lunch')?.payload;
   assert.ok(projection&&lunch);const view=prepared.preview.weeks[index],prior=before[index];
   assert.equal(projection.publicationId,prior.current_publication.publication_id);
   assert.equal(projection.envelope.authority.compilerInput.version.id,prior.display_version.version_id);
   assert.equal(view.publicationId,projection.publicationId);assert.equal(view.versionId,prior.display_version.version_id);
   assert.equal(view.database_projection_identity,projection.envelope.database_projection_identity);
   assert.equal(view.replayDigest,projection.replayDigest);assert.deepEqual(view.assignments,projection.envelope.assignments);
   assert.deepEqual(view.lunch_loans,lunch.loans);assert.deepEqual(view.lunch_responsibilities,lunch.responsibilities);
   const current=await run(()=>plane.getManagerSnapshot({manager,weekStart:week}));
   assert.equal(current.current_service_date,serverDay);assert.equal(current.authority_revision,request.expectedRevision);
   assert.equal(current.current_publication.publication_id,prior.current_publication.publication_id);
   assert.equal(current.display_version.version_id,prior.display_version.version_id);
   assert.equal(current.latest_projection.projection_id,prior.latest_projection.projection_id,'private prepare publishes nothing');
   assert.deepEqual(current.exceptions,prior.exceptions);
   bound.push({weekStart:week,projection,lunch});
  }
  phase='CANCEL_ONE_CONFIRM';
  await save('task8-cancel-confirmation.json',{operationId,request,confirmationKey,previewDigest:prepared.preview_digest,
   inputDigest:prepared.input_digest,candidateSetDigest:prepared.candidate_set_digest});
  confirmationCalls++;
  // Capture the single normal reply, then deliberately do not use it to drive
  // readback. Recovery is GET(original operation) only; never accept/begin again.
  await save('task8-cancel-confirmation-reply.json',await run(()=>plane.acceptStaffingCommand({manager,operationId,
   previewDigest:prepared.preview_digest,confirmationKey})));
  phase='CANCEL_GET_ONLY_RECOVERY';
  const recovered=await run(()=>plane.getStaffingCommand({manager,operationId}));await save('task8-cancel-recovered.json',recovered);
  assert.equal(recovered.state,'ACCEPTED');assert.equal(recovered.operation_id,operationId);
  assert.deepEqual(recovered.semantic_body,command.semantic_body);
  assert.equal(recovered.semantic_digest,command.semantic_digest);assert.equal(recovered.expected_revision,request.expectedRevision);
  assert.deepEqual(recovered.publication_vector,prepared.publication_vector);
  assert.equal(recovered.prepared_by_manager_id,manager.manager_id);assert.equal(recovered.preview_digest,prepared.preview_digest);
  assert.equal(recovered.input_digest,prepared.input_digest);assert.equal(recovered.candidate_set_digest,prepared.candidate_set_digest);
  const receipt=recovered.accepted_receipt;
  assert.equal(receipt.event,'ACCEPTED');assert.equal(receipt.operation_id,operationId);
  assert.equal(receipt.semantic_digest,command.semantic_digest);
  assert.equal(receipt.manager_id,manager.manager_id);assert.equal(receipt.original_preparer_manager_id,manager.manager_id);
  assert.equal(receipt.preview_digest,prepared.preview_digest);assert.equal(receipt.candidate_set_digest,prepared.candidate_set_digest);
  assert.equal(recovered.accepted_revision,request.expectedRevision+1);assert.equal(receipt.authority_revision,recovered.accepted_revision);
  assert.deepEqual(Object.keys(receipt.projections).sort(),[...window.weeks].sort());
  const after=[];
  for(const {weekStart:week,projection,lunch} of bound){
   const current=await run(()=>plane.getManagerSnapshot({manager,weekStart:week})),mapping=receipt.projections[week];
   assert.equal(current.projection_status,'current');assert.equal(current.authority_revision,recovered.accepted_revision);
   assert.equal(current.current_publication.publication_id,projection.publicationId);
   assert.equal(current.display_version.version_id,projection.envelope.authority.compilerInput.version.id);
   assert.equal(current.latest_projection.projection_id,mapping.projection_id);
   assert.equal(current.latest_projection.replay_digest,projection.replayDigest);
   assert.equal(mapping.publication_id,projection.publicationId);
   assert.equal(mapping.projection_identity,projection.envelope.database_projection_identity);
   assert.equal(mapping.lunch_document_identity,lunch.document_identity);
   assert.deepEqual(current.latest_projection.assignments,projection.envelope.assignments,'same current candidate, not old people/history');
   const prior=before.find(row=>row.week_start===week);
   assert.deepEqual(current.exceptions,prior.exceptions.filter(row=>!(row.staffingAbsenceId===originalOperationId
    &&row.serviceDate>=startDate&&row.serviceDate<=body.endDate)),'elapsed original rows and all other current facts survive');
   assert.ok(Array.isArray(current.canonical_staffing_absences));
   assert.equal(current.canonical_staffing_absences.some(row=>row.staffingAbsenceId===originalOperationId),false,
    'accepted original cancellation withdraws only that independent target');
   const paired=await read(`select json_build_object('rows',count(*),'identity',min(l.document_identity)) from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id) where p.projection_id=${q(mapping.projection_id)}::uuid`);
   assert.deepEqual(paired,{rows:1,identity:lunch.document_identity});after.push(current);
  }
  const originalAfter=await run(()=>plane.getStaffingCommand({manager,operationId:originalOperationId}));
  assert.equal(originalAfter.state,'ACCEPTED');assert.deepEqual(originalAfter.semantic_body,original.semantic_body);
  assert.deepEqual(originalAfter.accepted_receipt,original.accepted_receipt);
  assert.deepEqual(await read(`select to_jsonb(a) from public.static_weekly_staffing_absences a where absence_id=${q(originalOperationId)}::uuid`),originalFact);
  assert.deepEqual(await read(historyQuery),historyBefore,'original persisted projections/lunch/history are not rewritten');
  const persisted=await read(`select json_build_object('prepareKey',c.client_prepare_key,'confirmationKey',c.confirmation_key,'cancelRows',(select count(*) from public.static_weekly_staffing_absence_cancellations where absence_id=${q(originalOperationId)}::uuid and accepted_operation_id=c.operation_id and remaining_start_date=${q(startDate)}::date and remaining_end_date=${q(body.endDate)}::date and accepted_revision=c.accepted_revision),'authorityRows',(select count(*) from public.weekly_schedule_authority_revisions where command_id=c.operation_id and operation='apply_staffing_command' and authority_revision=c.accepted_revision),'acceptedReceiptRows',(select count(*) from public.static_weekly_staffing_command_receipts where operation_id=c.operation_id and event_kind='ACCEPTED')) from public.static_weekly_staffing_commands c where operation_id=${q(operationId)}::uuid`);
  assert.deepEqual(persisted,{prepareKey:clientPrepareKey,confirmationKey,cancelRows:1,authorityRows:1,acceptedReceiptRows:1});
  assert.equal(confirmationCalls,1);
  phase='COMPLETE';
  const result={scope:'original accepted absence -> current target/server civil day -> private remaining-window cancellation -> one confirm -> all-week current-plan GET-only recovery; actual fixture execution required',
   originalOperationId,operationId,request,confirmationKey,serverDay,window,prepared,recovered,persisted,after,
   confirmationCalls,weekCount:window.weeks.length,production:false,realManagerBrowserProven:false,phoneDeliveryProven:false,
   physicalOpeningProven:false,optimizedBalanceProven:false};
  await save('task8-cancel-result.json',result);return result;
 }catch(error){
  try{await save('task8-cancel-failure.json',{phase,originalOperationId,operationId,request,clientPrepareKey,confirmationKey,
   confirmationCalls,error:{...error,message:String(error.message),stack:error.stack},
   recovery:'retain original operation/body/keys; GET-only outcome inspection; no auto retry/new key/cancel/reset'});}
  catch(captureError){error.captureFailure=captureError;}
  throw error;
 }
}

// ONE new changed-person continuation: a real normal replacement, never a
// fake departed_named_absent vacancy or direct employee/ledger/projection DML.
// Caller must provide a genuinely accepted, still-uncancelled original from
// this same live fixture. Current262 SQL + trusted-target CP must be mounted.
export async function staffingReplacedOriginalCancellationProof({sql,plane,manager,originalOperationId,
 weekStart,slotId,replacementName,replacementKey,clientPrepareKey,confirmationKey,capture}){
 assert.equal(typeof sql,'function');assert.equal(typeof capture,'function');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 for(const id of [originalOperationId,slotId,replacementKey,clientPrepareKey,confirmationKey])assert.match(id,uuid);
 assert.equal(new Set([originalOperationId,replacementKey,clientPrepareKey,confirmationKey]).size,4);
 assert.equal(eventAuthorityWeekStart(weekStart),weekStart);
 assert.ok(typeof replacementName==='string'&&replacementName.trim().length>=2&&replacementName.length<=160);
 const q=value=>`'${String(value).replaceAll("'","''")}'`;
 const read=async statement=>JSON.parse(String(await sql(statement)).trim().split('\n').at(-1));
 const sourceFor=async(snapshot)=>read(`set role static_weekly_control_plane;select public.static_weekly_v3_read_publication_source(${q(snapshot.current_publication.publication_id)}::uuid,${q(weekStart)}::date)::text;reset role`);
 const currentIncumbents=(source,date)=>(source.compiler_input.slots.find(row=>row.id===slotId)?.incumbencies||[])
  .filter(row=>row.effectiveStart<=date&&(!row.effectiveEnd||date<row.effectiveEnd)).map(row=>row.personId);
 let phase='CHANGED_PERSON_INPUT',replacement=null,cancellation=null;
 const save=async(name,value)=>{await capture(name,value);const bytes=Buffer.from(JSON.stringify(value));
  console.log('TASK8_REPLACED_ORIGINAL',JSON.stringify({phase,originalOperationId,
   resultSha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}));};
 try{
  const original=await plane.getStaffingCommand({manager,operationId:originalOperationId});
  assert.equal(original?.state,'ACCEPTED');assert.equal(original.operation_id,originalOperationId);
  assert.equal(original.semantic_body.commandKind,'absence');
  const body=original.semantic_body;
  assert.equal(body.startDate,body.endDate,'one new changed-person scenario, not an optimizer/multiweek matrix');
  assert.equal(eventAuthorityWeekStart(body.startDate),weekStart,'keep the declared requested week, never roll over');
  const before=await plane.getManagerSnapshot({manager,weekStart});
  assert.equal(before.week_start,weekStart);assert.equal(before.projection_status,'current');
  enumerateStaffingServiceWindow(before.current_service_date,before.current_service_date);
  assert.ok(body.endDate>=before.current_service_date,'do not replace/cancel an elapsed original as a new case');
  assert.ok(Array.isArray(before.canonical_staffing_absences),'current original-target snapshot prerequisite is not mounted');
  const visible=before.canonical_staffing_absences.filter(row=>row.staffingAbsenceId===originalOperationId);
  assert.equal(visible.length,1);assert.equal(visible[0].staffingEmployeeId,body.employeeId);
  assert.equal(visible[0].staffingStartDate,body.startDate);assert.equal(visible[0].staffingEndDate,body.endDate);
  const beforeSource=await sourceFor(before);
  assert.deepEqual(currentIncumbents(beforeSource,body.startDate),[body.employeeId],
   'replacement must target the genuine original employee in the existing stable position');
  const oldHistoryQuery=`select json_build_object('projection',to_jsonb(p),'lunch',to_jsonb(l)) from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id) where p.projection_id=${q(before.latest_projection.projection_id)}::uuid`;
  const oldHistory=await read(oldHistoryQuery);
  const manualBefore=before.exceptions.filter(row=>row.type==='cover_all'||row.type==='lunch');
  assert.ok(manualBefore.some(row=>row.type==='cover_all'),'only already manual contractor capacity; no automatic contractor addition');
  await save('task8-changed-person-input.json',{originalOperationId,original,weekStart,slotId,replacementName,
   replacementKey,clientPrepareKey,confirmationKey,before,beforeSource,oldHistory,manualBefore});
  phase='NORMAL_REPLACEMENT';
  const replacementRequest={manager,slotId,newEmployeeName:replacementName,
   reason:'Explicit synthetic normal replacement before original absence cancellation; no historical restoration',
   expectedRevision:before.authority_revision,idempotencyKey:replacementKey,projectionWeekStart:weekStart};
  await save('task8-changed-person-replacement-request.json',{...replacementRequest,manager:{manager_id:manager.manager_id}});
  replacement=await plane.replaceEmployee(replacementRequest); // one normal authorized call, no retry
  await save('task8-changed-person-replacement.json',replacement);
  const mutation=replacement.data?.mutation;
  assert.equal(mutation?.former_employee_id,body.employeeId);assert.match(mutation?.new_employee_id,uuid);
  assert.notEqual(mutation.new_employee_id,body.employeeId);
  assert.equal(mutation.effective_start,before.current_service_date,'normal replacement is immediate server civil date, not a guessed week');
  const replaced=await plane.getManagerSnapshot({manager,weekStart});
  assert.equal(replaced.week_start,weekStart);assert.equal(replaced.projection_status,'current');
  assert.equal(replaced.authority_revision,replacement.revision);assert.ok(replaced.authority_revision>before.authority_revision);
  assert.equal(replaced.current_publication.publication_id,before.current_publication.publication_id);
  assert.equal(replaced.latest_projection.projection_id,replacement.data.projection_id);
  assert.equal(replaced.current_service_date,before.current_service_date,'date changes require explicit rebind, not body rewriting');
  const replacementSource=await sourceFor(replaced);
  assert.deepEqual(currentIncumbents(replacementSource,body.startDate),[mutation.new_employee_id]);
  assert.equal(replaced.exceptions.some(row=>row.staffingAbsenceId===originalOperationId),false,
   'original person fact must NOT transfer to replacement compiler exception');
  assert.deepEqual(replaced.exceptions.filter(row=>row.type==='cover_all'||row.type==='lunch'),manualBefore);
  const targetRows=replaced.canonical_staffing_absences.filter(row=>row.staffingAbsenceId===originalOperationId);
  assert.equal(targetRows.length,1,'independent original accepted target must remain visible after compiler row disappears');
  assert.deepEqual(targetRows[0],visible[0]);
  const peopleQuery=`select json_agg(json_build_object('id',id,'active',active) order by id) from public.employees where id in (${q(body.employeeId)}::uuid,${q(mutation.new_employee_id)}::uuid)`;
  const people=await read(peopleQuery);
  assert.equal(people.find(row=>row.id===body.employeeId)?.active,false);
  assert.equal(people.find(row=>row.id===mutation.new_employee_id)?.active,true);
  await save('task8-changed-person-current-plan.json',{replaced,replacementSource,target:targetRows[0],people});
  phase='ORIGINAL_CANCEL_CURRENT_PLAN';
  cancellation=await staffingOriginalAbsenceCancellationProof({sql,plane,manager,originalOperationId,weekStart,
   clientPrepareKey,confirmationKey,capture});
  const after=await plane.getManagerSnapshot({manager,weekStart}),afterSource=await sourceFor(after);
  assert.equal(after.authority_revision,cancellation.recovered.accepted_revision);
  assert.equal(after.current_publication.publication_id,replaced.current_publication.publication_id);
  assert.deepEqual(afterSource.compiler_input,replacementSource.compiler_input,
   'cancellation preserves current replacement/geometry/version; it does not restore original people');
  assert.deepEqual(currentIncumbents(afterSource,body.startDate),[mutation.new_employee_id]);
  assert.deepEqual(await read(peopleQuery),people,'cancellation must not reactivate the original employee');
  assert.deepEqual(await read(oldHistoryQuery),oldHistory,'original accepted projection and lunch remain immutable');
  assert.deepEqual(after.exceptions.filter(row=>row.type==='cover_all'||row.type==='lunch'),manualBefore);
  assert.equal(cancellation.confirmationCalls,1);
  phase='COMPLETE';
  const result={scope:'one real normal replacement then original-person cancellation against current plan; fixture execution required',
   originalOperationId,replacementKey,slotId,replacementName,replacementEmployeeId:mutation.new_employee_id,
   replacement,cancellation,after,afterSource,people,requestedWeek:weekStart,
   trueVacancyProven:false,approvedRecurringPatternPublicationProven:false,production:false,
   realManagerBrowserProven:false,phoneDeliveryProven:false};
  await save('task8-changed-person-result.json',result);return result;
 }catch(error){
  try{await save('task8-changed-person-failure.json',{phase,originalOperationId,weekStart,slotId,replacementName,replacementKey,
   clientPrepareKey,confirmationKey,replacement,error:{...error,message:String(error.message),stack:error.stack},
   recovery:'retain exact original/replacement/cancellation identities and captures; no automatic replay/new key/direct DML/restore/cleanup'});}
  catch(captureError){error.captureFailure=captureError;}throw error;
 }
}

// Setup ONLY for the new join above, using the existing official seed factory.
// Main owns the disposable database/schema, normal authority and trusted manager.
// No new Docker/runner/ACL/key-provisioning path, raw projection or PREPARED
// inserts. Official factory's existing disposable authority init is main-owned.
// Current A1 continuation. The two sessions MUST be supplied by Main's ordinary
// signed credential/registry stack. These assertions are input checks, not auth.
// SQL transaction actor revalidation is exercised by runManagerOperation for
// EACH product request; observation SQL cannot substitute for those mutations.
export async function staffingDelegateMultiweekWorkflowProof({sql,plane,owner,delegate,request,
 confirmationKey,weekStart,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey,capture}){
 assert.equal(typeof capture,'function');assert.equal(typeof sql,'function');
 assert.ok(plane&&owner&&delegate);assert.notEqual(owner.manager_id,delegate.manager_id);
 assert.notEqual(owner.credential_id,delegate.credential_id);
 assert.equal(owner.read_only,false);assert.equal(owner.permissions?.owner,true);
 assert.equal(delegate.read_only,true);assert.equal(delegate.permissions?.owner,false);
 assert.equal(delegate.permissions?.schema,'custodial.manager-permissions.v1');
 assert.equal(delegate.permissions?.read,true);assert.equal(delegate.permissions?.manage_absences,true);
 for(const session of [owner,delegate]){
  assert.match(session.manager_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.match(session.credential_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(typeof session.device_id,'string');assert.ok(session.device_id);
  assert.equal(typeof session.auth_mode,'string');
  assert.ok(!['operations_first','admin_api_key'].includes(session.auth_mode),
   'runner supplies its existing authenticated session, never operations_first/admin_api_key');
 }
 const window=enumerateStaffingServiceWindow(request.startDate,request.endDate);
 assert.equal(window.weeks.length,2);assert.equal(window.weeks[0],weekStart);
 assert.equal(request.endDate,window.weeks[1]);
 const keys=[request.clientPrepareKey,confirmationKey,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey];
 for(const key of keys)assert.match(key,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
 assert.equal(new Set(keys).size,keys.length);
 const run=(manager,permission,work)=>plane.runManagerOperation({manager,permission,
  signal:new AbortController().signal,deadlineAt:performance.now()+MANAGER_OPERATION_MILLISECONDS},work);
 const q=value=>`'${String(value).replaceAll("'","''")}'`;
 const read=async statement=>JSON.parse(String(await sql(statement)).trim().split('\n').at(-1));
 let phase='DELEGATE_OWNER_ONLY_DENIALS',probe=null,created=null;
 try{
  const before=await run(delegate,'read',()=>plane.getManagerSnapshot({manager:delegate,weekStart}));
  assert.equal(before.authority_revision,request.expectedRevision);
  // No valid IDs/new source is manufactured to force a mutation. The owner
  // gate must refuse BEFORE roster/recurring method inputs are consumed.
  await assert.rejects(run(delegate,'write',()=>plane.markEmployeeDeparted({manager:delegate})),
   error=>error.code==='static_weekly_named_manager_required');
  await assert.rejects(run(delegate,'write',()=>plane.previewRecurringStaffing({manager:delegate})),
   error=>error.code==='static_weekly_named_manager_required');
  assert.equal((await run(delegate,'read',()=>plane.getManagerSnapshot({manager:delegate,weekStart}))).authority_revision,
   request.expectedRevision);
  phase='ORIGINAL_PREPARER_DENIAL';
  // One real private PREPARING operation owned by the supplied owner, never a
  // forged command row. No compiler is invoked for this negative prerequisite.
  probe=await run(owner,'write',()=>plane.beginStaffingCommand({manager:owner,...request,clientPrepareKey:ownerProbeKey}));
  assert.equal(probe.state,'PREPARING');assert.equal(probe.replayed,false);
  await assert.rejects(run(delegate,'manage_absences',()=>plane.getStaffingCommand({manager:delegate,operationId:probe.operation_id})),
   error=>error.code==='staffing_original_preparer_required'||error.code==='42501');
  await run(owner,'write',()=>plane.cancelStaffingPreparation({manager:owner,operationId:probe.operation_id}));
  const retiredProbe=await run(owner,'write',()=>plane.getStaffingCommand({manager:owner,operationId:probe.operation_id}));
  assert.equal(retiredProbe.state,'CANCELLED');
  await capture('task8-a1-preparer-denial.json',{probe:retiredProbe,delegateManagerId:delegate.manager_id,
   note:'synthetic normally registered actors; no human/browser authority claim'});
  phase='DELEGATE_MULTI_WEEK_CREATION';
  created=await staffingPreviewToCoverAllHandoutProof({sql,plane,manager:delegate,request,confirmationKey,weekStart,
   capture,includeHandout:false,authenticatedRequests:true});
  assert.equal(created.confirmationCalls,1);assert.equal(created.window.weeks.length,2);
  const command=created.persistedCommand;
  assert.equal(command.semantic_body.commandKind,'absence');assert.equal(command.prepared_by_manager_id,delegate.manager_id);
  assert.equal(command.accepted_receipt.original_preparer_manager_id,delegate.manager_id);
  const persisted=await read(`select json_build_object('kind',semantic_body->>'commandKind','preparer',prepared_by_manager_id,
   'prepareKey',client_prepare_key,'confirmationKey',confirmation_key,'state',state,'revision',accepted_revision)
   from public.static_weekly_staffing_commands where operation_id=${q(created.operationId)}::uuid`);
  assert.deepEqual(persisted,{kind:'absence',preparer:delegate.manager_id,prepareKey:request.clientPrepareKey,
   confirmationKey,state:'ACCEPTED',revision:command.accepted_revision});
  await capture('task8-a1-persisted-delegate.json',persisted);
  phase='DELEGATE_REMAINING_ORIGINAL_RANGE_CANCELLATION';
  const cancelled=await staffingOriginalAbsenceCancellationProof({sql,plane,manager:delegate,
   originalOperationId:created.operationId,weekStart,clientPrepareKey:cancelPrepareKey,
   confirmationKey:cancelConfirmationKey,capture,authenticatedRequests:true});
  assert.equal(cancelled.confirmationCalls,1);assert.equal(cancelled.weekCount,2);
  assert.equal(cancelled.request.employeeId,request.employeeId);assert.equal(cancelled.request.endDate,request.endDate);
  assert.equal(cancelled.request.startDate,request.startDate>cancelled.serverDay?request.startDate:cancelled.serverDay);
  assert.equal(cancelled.recovered.prepared_by_manager_id,delegate.manager_id);
  phase='COMPLETE';
  const result={scope:'A1 normal synthetic delegate; two-week private preview -> one create confirmation -> all-week persisted readback -> one remaining-range cancel confirmation -> original GET recovery',
   ownerManagerId:owner.manager_id,delegateManagerId:delegate.manager_id,originalOperationId:created.operationId,
   cancellationOperationId:cancelled.operationId,creationRevision:command.accepted_revision,
   cancellationRevision:cancelled.recovered.accepted_revision,window,creationPersisted:persisted,
   createConfirmationCalls:created.confirmationCalls,cancelConfirmationCalls:cancelled.confirmationCalls,
   ownerOnlyDenials:2,originalPreparerDenials:1,syntheticActors:true,realManagerBrowserProven:false,
   phoneDeliveryProven:false,production:false};
  await capture('task8-a1-result.json',result);return result;
 }catch(error){
  try{await capture('task8-a1-failure.json',{phase,request,confirmationKey,cancelPrepareKey,cancelConfirmationKey,
   ownerProbeKey,probeOperationId:probe?.operation_id??null,originalOperationId:created?.operationId??null,
   error:{code:error.code??null,message:String(error.message),stack:error.stack},
   recovery:'retain original identities and complete captures; inspect original GET only, no automatic BEGIN/confirm/re-solve/rekey'});}
  catch(captureError){error.captureFailure=captureError;}throw error;
 }
}

// Second finite branch of the SAME normal workflow, not a copied acceptance
// result. Main supplies live normal sessions/SQL; no helper invokes it here.
export async function staffingDelegateTwoPublicationWorkflowProof({sql,plane,owner,delegate,request,
 confirmationKey,weekStart,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey,capture,publicationBoundary}){
 assert.equal(typeof capture,'function');assert.equal(typeof sql,'function');
 assert.ok(publicationBoundary);const window=enumerateStaffingServiceWindow(request.startDate,request.endDate);
 assert.equal(window.weeks.length,2);assert.equal(publicationBoundary.effectiveStart,window.weeks[1]);
 assert.notEqual(publicationBoundary.firstPublicationId,publicationBoundary.secondPublicationId);
 assert.notEqual(publicationBoundary.firstVersionId,publicationBoundary.secondVersionId);
 const read=async statement=>JSON.parse(String(await sql(statement)).trim().split('\n').at(-1));
 const run=work=>plane.runManagerOperation({manager:delegate,permission:'manage_absences',
  signal:new AbortController().signal,deadlineAt:performance.now()+MANAGER_OPERATION_MILLISECONDS},work);
 const expected=[{weekStart:window.weeks[0],publicationId:publicationBoundary.firstPublicationId,
  versionId:publicationBoundary.firstVersionId},{weekStart:window.weeks[1],
  publicationId:publicationBoundary.secondPublicationId,versionId:publicationBoundary.secondVersionId}];
 const before=[];
 for(const basis of expected){const snapshot=await run(()=>plane.getManagerSnapshot({manager:delegate,weekStart:basis.weekStart}));
  assert.equal(snapshot.authority_revision,request.expectedRevision);assert.equal(snapshot.projection_status,'current');
  assert.equal(snapshot.current_publication.publication_id,basis.publicationId);
  assert.equal(snapshot.display_version.version_id,basis.versionId);before.push(snapshot);}
 await capture('task8-a1-two-publication-input.json',{expected,request,publicationBoundary,before,
  actorScope:'ordinary registered synthetic fixture delegate; not real browser/named-person proof'});
 try{
  const result=await staffingDelegateMultiweekWorkflowProof({sql,plane,owner,delegate,request,confirmationKey,
   weekStart,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey,capture});
  const after=[];
  for(const basis of expected){const snapshot=await run(()=>plane.getManagerSnapshot({manager:delegate,weekStart:basis.weekStart}));
   assert.equal(snapshot.projection_status,'current');assert.equal(snapshot.authority_revision,result.cancellationRevision);
   assert.equal(snapshot.current_publication.publication_id,basis.publicationId);
   assert.equal(snapshot.display_version.version_id,basis.versionId);
   // Current respective publication assignments/lunch were already matched to
   // each real staged candidate by the underlying original cancellation member.
   // No old person/version restoration or one-week receipt substitution.
   after.push(snapshot);}
  assert.deepEqual(await read(publicationBoundary.historyQuery),publicationBoundary.historyBefore,
   'immutable first baseline document/projection/optional lunch survives both publications and original cancellation');
  const qualified={...result,scope:'A1 synthetic delegate crosses two genuine effective publications/versions; original remaining-range cancellation returns each CURRENT plan',
   effectivePublicationBindings:expected,after};
  await capture('task8-a1-two-publication-result.json',qualified);return qualified;
 }catch(error){await capture('task8-a1-two-publication-failure.json',{expected,request,confirmationKey,
  cancelPrepareKey,cancelConfirmationKey,ownerProbeKey,error:{code:error.code??null,message:String(error.message),stack:error.stack},
  recovery:'retain all original command/publication identities and captures; original GET only, no automatic retry or historical restore'});
  throw error;}
}

export async function setupStaffingHandoutJoinFixture({sql,container,databaseOptions,manager,weekStart,
 manualCapacityKey,clientPrepareKey,confirmationKey,capacityLunch,capture=null,endDate=weekStart,
 manualCapacityKeys=null,authenticatedRequests=false,secondPublicationKeys=null}){
 assert.ok(capture===null||typeof capture==='function');
 assert.match(container,/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
 assert.equal(typeof sql,'function');assert.equal(eventAuthorityWeekStart(weekStart),weekStart);
 assert.equal(typeof databaseOptions?.host,'string');assert.ok(databaseOptions.host.startsWith('/'),'main-owned Unix socket only');
 assert.equal(databaseOptions.database,'postgres');assert.ok(manager?.manager_id&&manager.manager_display_name);
 assert.equal(typeof authenticatedRequests,'boolean');
 const window=enumerateStaffingServiceWindow(weekStart,endDate);
 assert.ok(window.weeks.length===1||(authenticatedRequests&&window.weeks.length===2&&endDate===window.weeks[1]),
  'one changed two-Monday workflow only; no hidden full-week/solver matrix');
 if(window.weeks.length===1)assert.equal(endDate,weekStart,'retained setup remains one day');
 const capacityKeys=manualCapacityKeys??{[weekStart]:manualCapacityKey};
 assert.deepEqual(Object.keys(capacityKeys).sort(),window.weeks);
 assert.equal(capacityKeys[weekStart],manualCapacityKey);
 if(secondPublicationKeys!==null){
  assert.equal(authenticatedRequests,true);assert.equal(window.weeks.length,2);
  assert.deepEqual(Object.keys(secondPublicationKeys).sort(),['draft','publish']);
  assert.equal(typeof capture,'function','complete owning records required for boundary publication');
 }
 const setupKeys=[...Object.values(capacityKeys),clientPrepareKey,confirmationKey,
  ...Object.values(secondPublicationKeys??{})];
 for(const value of setupKeys)assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
 assert.equal(new Set(setupKeys).size,setupKeys.length);
 const q=v=>`'${String(v).replaceAll("'","''")}'`,hash=v=>createHash('sha256').update(canonicalJson(v)).digest('hex');
 const read=async statement=>JSON.parse(String(await sql(statement)).trim().split('\n').at(-1));
 const currentDate=String(await sql('select public.sch_service_date(statement_timestamp())::text')).trim().split('\n').at(-1);
 assert.ok(weekStart>=currentDate,'one new current/future Monday; no historical date substitution');
 const {source,employees,capacities,areas}=nonemployeeCoverAllSource(weekStart);
 const capacity=source.slots.find(row=>row.id===capacities[0].slot),template=capacity.contractorAvailability[0];
 assert.equal(capacity.kind,'CONTRACTOR_CAPACITY');assert.deepEqual(capacity.incumbencies,[]);
 // Explicit existing fixture fact, never an inferred real contractor break.
 assert.deepEqual(capacityLunch,template.lunch,'caller must explicitly choose the fixture-published lunch');
 const collisions=await read(`select json_build_object('employees',(select count(*) from public.employees where id in (${employees.map(row=>q(row.id)+'::uuid').join(',')})),'locations',(select count(*) from public.locations where id in (${areas.map(row=>q(row.physical)+'::uuid').join(',')})),'groups',(select count(*) from public.location_groups where id in (${areas.map(row=>q(row.group)+'::uuid').join(',')})))`);
 assert.deepEqual(collisions,{employees:0,locations:0,groups:0},'fresh namespace only; never overwrite prior facts');
 const save=async(name,value)=>{if(capture)await capture(name,value);const json=JSON.stringify(value);
  return{resultSha256:createHash('sha256').update(json).digest('hex'),bytes:Buffer.byteLength(json)};};
 const compilerRuns=[];let phase='IDENTITY_FACTS',plane=null,runsCaptured=false;
 const observeNormalPreparation=async(input,preparation,options)=>{
  const record={phase,inputSha256:hash(input),input:structuredClone(input),preparation:preparation??null};compilerRuns.push(record);
  const filePrefix=`task8-compiler-${String(compilerRuns.length).padStart(2,'0')}`;
  try{
   console.log('TASK8_JOIN_COMPILER_INPUT',JSON.stringify({phase,inputSha256:record.inputSha256,status:'INPUT_CAPTURED',
    ...await save(filePrefix+'-input.json',record)}));
   const bounded={...options,deadlineMilliseconds:Math.min(options?.deadlineMilliseconds??STAFFING_PREPARATION_LIMITS.prepareMilliseconds,STAFFING_PREPARATION_LIMITS.prepareMilliseconds)};
   const result=preparation?await compileAndPrepareStaticWeeklyScheduleIsolated(input,preparation,bounded)
    :await compileStaticWeeklyScheduleIsolated(input,bounded);
   record.result=result;
   console.log('TASK8_JOIN_COMPILER_RESULT',JSON.stringify({phase,inputSha256:record.inputSha256,
    status:typeof result.status==='string'?result.status.slice(0,64):'PREPARATION_RETURNED',
    ...await save(filePrefix+'-result.json',record)}));return result;
  }catch(error){record.error={code:error.code??null,message:String(error.message)};
   try{console.log('TASK8_JOIN_COMPILER_RESULT',JSON.stringify({phase,inputSha256:record.inputSha256,status:'FAILED',
    ...await save(filePrefix+'-failure.json',record)}));}
   catch(captureError){console.log('TASK8_JOIN_COMPILER_RESULT',JSON.stringify({phase,inputSha256:record.inputSha256,status:'FAILURE_CAPTURE_FAILED'}));error.captureFailure=captureError;}
   throw error;}
 };
 const normalCompiler=(input,options)=>observeNormalPreparation(input,null,options);
 try{
  // Input facts only. Capacities deliberately have no employee/person row.
  await sql(`insert into public.employees(id,display_name,role) values ${employees.map(row=>`(${q(row.id)},${q(row.name)},'staff')`).join(',')};`);
  for(const area of areas)await sql(`insert into public.locations(id,location_code,location_name,location_type,form_type) values(${q(area.physical)},${q(area.code)},${q(area.name)},'restroom','restroom');
   insert into public.location_groups(id,group_code,group_name) values(${q(area.group)},${q(area.code)},${q(area.name)});
   insert into public.location_group_memberships(location_group_id,location_id) values(${q(area.group)},${q(area.physical)});`);
  phase='OFFICIAL_BASELINE';
  const seeded=await seedCompiledEventAuthority({sql,container,managerId:manager.manager_id,
   dates:secondPublicationKeys===null?window.weeks:[weekStart],
   source,label:'task8-current-staffing-handout-join',mode:'official',compiler:normalCompiler});
  // Actual normal isolated compiler, original runtime initializer/limits.
  // Do not inject a fabricated readiness, adapter envelope or staged command.
  const pool=new pg.Pool({...databaseOptions,max:4});
  plane=createStaticWeeklyControlPlane({database:pool,compiler:normalCompiler,compilerPreparer:observeNormalPreparation});
  const ownerRun=work=>authenticatedRequests?plane.runManagerOperation({manager,permission:'write',
   signal:new AbortController().signal,deadlineAt:performance.now()+MANAGER_OPERATION_MILLISECONDS},work):work();
  let publicationBoundary=null;
  if(secondPublicationKeys!==null){
   phase='SECOND_EFFECTIVE_PUBLICATION';
   const effectiveStart=window.weeks[1];
   const original=await ownerRun(()=>plane.getManagerSnapshot({manager,weekStart}));
   assert.equal(original.projection_status,'current');assert.equal(original.current_publication.publication_id,seeded.publicationId);
   const historyQuery=`select json_build_object('document',v.draft_document,'contentDigest',v.content_digest,
    'projections',(select json_agg(json_build_object('projection',to_jsonb(p),'lunch',to_jsonb(l)) order by p.projection_id)
     from public.weekly_schedule_compiled_projections p left join public.weekly_schedule_lunch_documents l using(projection_id)
     where p.projection_id=${q(original.latest_projection.projection_id)}::uuid))
    from public.weekly_schedule_versions v where v.version_id=${q(seeded.versionId)}::uuid`;
   const historyBefore=await read(historyQuery);
   assert.ok(historyBefore.document&&historyBefore.projections?.length===1,
    'only the genuine first-week baseline exists; no disposable old second-week solve');
   // Existing source-derived owner method creates a new version from the
   // currently registered publication, preserving real roster/geography.
   // No draft document, source SKU, accepted flag or result is caller-stamped.
   const draftRequest={manager,sourcePublicationId:seeded.publicationId,effectiveStart,
    expectedRevision:original.authority_revision,idempotencyKey:secondPublicationKeys.draft};
   await save('task8-boundary-draft-request.json',{...draftRequest,manager:{manager_id:manager.manager_id}});
   const draft=await ownerRun(()=>plane.createReplacementDraft(draftRequest));
   await save('task8-boundary-draft.json',draft);
   assert.match(draft.data.version_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
   assert.notEqual(draft.data.version_id,seeded.versionId);
   const publishRequest={manager,draftVersionId:draft.data.version_id,expectedDraftRevision:1,
    expectedRevision:draft.revision,idempotencyKey:secondPublicationKeys.publish,
    projectionWeekStart:effectiveStart,publicationKind:'supersede'};
   await save('task8-boundary-publish-request.json',{...publishRequest,manager:{manager_id:manager.manager_id}});
   // ONE deliberately accepted source publication before any delegate work.
   const published=await ownerRun(()=>plane.publishDraft(publishRequest));
   await save('task8-boundary-published.json',published);
   const first=await ownerRun(()=>plane.getManagerSnapshot({manager,weekStart}));
   const second=await ownerRun(()=>plane.getManagerSnapshot({manager,weekStart:effectiveStart}));
   for(const snapshot of [first,second]){assert.equal(snapshot.projection_status,'current');
    assert.equal(snapshot.authority_revision,published.revision);}
   assert.equal(first.current_publication.publication_id,seeded.publicationId);
   assert.equal(first.display_version.version_id,seeded.versionId);
   assert.notEqual(second.current_publication.publication_id,seeded.publicationId);
   assert.equal(second.current_publication.publication_id,published.data.publication_id);
   assert.equal(second.display_version.version_id,draft.data.version_id);
   assert.equal(second.latest_projection.projection_id,published.data.projection_id);
   assert.deepEqual(await read(historyQuery),historyBefore,
    'second effective publication closes the range; never rewrites the original document/projection/lunch');
   publicationBoundary={effectiveStart,firstPublicationId:seeded.publicationId,firstVersionId:seeded.versionId,
    secondPublicationId:second.current_publication.publication_id,secondVersionId:second.display_version.version_id,
    draft,published,historyBefore,historyQuery};
   await save('task8-boundary-current-plans.json',{publicationBoundary,first,second});
  }
  const manualWeeks=[];
  for(const week of window.weeks){
  const before=await ownerRun(()=>plane.getManagerSnapshot({manager,weekStart:week}));
  assert.equal(before.projection_status,'current');
  const actualPublicationId=before.current_publication.publication_id,actualVersionId=before.display_version.version_id;
  assert.equal(actualPublicationId,publicationBoundary&&week===publicationBoundary.effectiveStart
   ?publicationBoundary.secondPublicationId:seeded.publicationId);
  assert.equal(before.exceptions.some(row=>row.type==='cover_all'&&row.serviceDate===week),false);
  phase='EXPLICIT_MANUAL_CAPACITY_LUNCH';
  const manualRequest={manager,serviceDate:week,baseVersionId:actualVersionId,publicationId:actualPublicationId,
   slotId:capacity.id,shift:structuredClone(template.shift),lunch:structuredClone(capacityLunch),
   reason:'Explicit synthetic fixture manager choice before absence; no automatic CoverAll',
   expectedRevision:before.authority_revision,idempotencyKey:capacityKeys[week],projectionWeekStart:week};
  const manualPrefix=window.weeks.length===1?'task8-manual':`task8-manual-${week}`;
  console.log('TASK8_JOIN_MANUAL_REQUEST',JSON.stringify({phase,status:'MANUAL_REQUEST_CAPTURED',
   ...await save(manualPrefix+'-request.json',{...manualRequest,manager:{manager_id:manager.manager_id}})}));
  const accepted=await ownerRun(()=>plane.applyContractorCapacity(manualRequest));
  await save(manualPrefix+'-accepted.json',accepted);
  const current=await ownerRun(()=>plane.getManagerSnapshot({manager,weekStart:week}));
  assert.equal(current.projection_status,'current');assert.equal(current.authority_revision,accepted.revision);
  assert.equal(current.current_publication.publication_id,actualPublicationId);
  assert.equal(current.display_version.version_id,actualVersionId);
  assert.equal(current.latest_projection.projection_id,accepted.data.projection_id);
  assert.deepEqual(current.exceptions.filter(row=>row.type==='cover_all'&&row.serviceDate===week)
   .map(row=>row.payload.availability.slotId),[capacity.id]);
  const document=await ownerRun(()=>plane.getCoverAllPrintDocument({manager,weekStart:week,serviceDate:week,
   expectedRevision:current.authority_revision,projectionId:current.latest_projection.projection_id}));
  assert.equal(document.contractors[0].slotId,capacity.id);assert.deepEqual(document.contractors[0].lunch,capacityLunch);
  assert.equal(document.contractors[0].shift.start,template.shift.start);assert.equal(document.contractors[0].shift.end,template.shift.end);
  assert.equal(document.contractorCompletionRecorder,'ERIC_OPERLE_PERSONAL_VERIFICATION');
  manualWeeks.push({weekStart:week,manualRequest:{...manualRequest,manager:{manager_id:manager.manager_id}},accepted,document});
  }
  const current=await ownerRun(()=>plane.getManagerSnapshot({manager,weekStart}));
  const {manualRequest,accepted,document}=manualWeeks[0];
  // This employee is the ordinary source's qualified owner. A new absence
  // creates a genuinely changed overlay, not a replay of the capacity action.
  const request={commandKind:'absence',absenceKind:'daily_absence',employeeId:employees[0].id,
   startDate:weekStart,endDate,clientPrepareKey,expectedRevision:current.authority_revision};
  phase='SETUP_READY';
  const baseline={sourceSha256:hash(source),source,sourceId:seeded.sourceId,versionId:seeded.versionId,
   publicationId:seeded.publicationId,projectionId:current.latest_projection.projection_id,
   authorityRevision:current.authority_revision,replayDigest:current.latest_projection.replay_digest,
   serviceDate:weekStart,lunchDocumentIdentity:document.lunchDocumentIdentity,manualRequest:{...manualRequest,manager:{manager_id:manager.manager_id}},
   manualAccepted:accepted,manualWeeks,publicationBoundary,employees,capacities,areas};
  console.log('TASK8_JOIN_SETUP_READY',JSON.stringify({phase,status:'SETUP_READY',authorityRevision:current.authority_revision,
   ...await save('task8-setup-ready.json',{baseline,request,confirmationKey,compilerRuns})}));
  phase=window.weeks.length===1?'ONE_WEEK_ABSENCE':'A1_DELEGATE_MULTI_WEEK_ABSENCE';
  return{sql,plane,manager,request,confirmationKey,weekStart,baseline,compilerRuns,capture,
   async continueDelegateMultiweek({delegate,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey}){
    assert.ok(!runsCaptured,'fixture already closed');assert.equal(typeof capture,'function');
    assert.equal(authenticatedRequests,true);assert.equal(window.weeks.length,2);
    const keys=[...setupKeys,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey];
    for(const key of keys)assert.match(key,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(new Set(keys).size,keys.length);
    return staffingDelegateMultiweekWorkflowProof({sql,plane,owner:manager,delegate,request,
     confirmationKey,weekStart,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey,capture});
   },
   async continueDelegateTwoPublication({delegate,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey}){
    assert.ok(!runsCaptured,'fixture already closed');assert.ok(publicationBoundary);
    const keys=[...setupKeys,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey];
    for(const key of keys)assert.match(key,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(new Set(keys).size,keys.length);
    return staffingDelegateTwoPublicationWorkflowProof({sql,plane,owner:manager,delegate,request,
     confirmationKey,weekStart,cancelPrepareKey,cancelConfirmationKey,ownerProbeKey,capture,publicationBoundary});
   },
   async continueOriginalCancellation({originalOperationId,clientPrepareKey:cancelPrepareKey,confirmationKey:cancelConfirmationKey}){
    assert.ok(!runsCaptured,'fixture already closed');
    assert.equal(typeof capture,'function','main-owned complete capture required before cancellation');
    for(const value of [cancelPrepareKey,cancelConfirmationKey])assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(new Set([manualCapacityKey,clientPrepareKey,confirmationKey,cancelPrepareKey,cancelConfirmationKey]).size,5,
     'new cancellation keeps distinct original preparation/confirmation identities');
    phase='ORIGINAL_CANCELLATION';
    return staffingOriginalAbsenceCancellationProof({sql,plane,manager,weekStart,originalOperationId,
     clientPrepareKey:cancelPrepareKey,confirmationKey:cancelConfirmationKey,capture});
   },
   async continueChangedPersonCancellation({originalOperationId,replacementName,replacementKey,
    clientPrepareKey:cancelPrepareKey,confirmationKey:cancelConfirmationKey}){
    assert.ok(!runsCaptured,'fixture already closed');assert.equal(typeof capture,'function');
    assert.equal(new Set([manualCapacityKey,clientPrepareKey,confirmationKey,replacementKey,cancelPrepareKey,cancelConfirmationKey]).size,6,
     'new replacement/cancellation preserve distinct original keys');
    phase='CHANGED_PERSON_CANCELLATION';
    return staffingReplacedOriginalCancellationProof({sql,plane,manager,originalOperationId,weekStart,
     slotId:employees[0].slot,replacementName,replacementKey,clientPrepareKey:cancelPrepareKey,
     confirmationKey:cancelConfirmationKey,capture});
   },
   async close(){try{if(!runsCaptured){runsCaptured=true;await save('task8-compiler-runs.json',{compilerRuns});}}
    finally{try{await plane.close();}finally{await shutdownStaticWeeklyCompiler();}}}};
 }catch(error){
  try{console.log('TASK8_JOIN_SETUP_FAILURE',JSON.stringify({phase,status:'FAILED',
   ...await save('task8-setup-failure.json',{phase,error:{...error,message:String(error.message),stack:error.stack},compilerRuns,
    manualCapacityKey,clientPrepareKey,confirmationKey,recovery:'retain normal receipts/facts in the owned fixture; no retry/reset/discard'})}));}
  catch(captureError){console.log('TASK8_JOIN_SETUP_FAILURE',JSON.stringify({phase,status:'FAILURE_CAPTURE_FAILED'}));error.captureFailure=captureError;}
  try{if(plane)await plane.close();}finally{await shutdownStaticWeeklyCompiler();}throw error;}
}
