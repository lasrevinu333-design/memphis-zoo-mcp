import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import pg from 'pg';
import {PDFDocument} from 'pdf-lib';
import {seedCompiledEventAuthority} from './event-static-authority-fixture.mjs';
import {createStaticWeeklyControlPlane} from '../../src/static-weekly-control-plane.js';
import {compileStaticWeeklySchedule} from '../../src/static-weekly-schedule-compiler.js';
import {renderCoverAllPdfPair} from '../../src/static-weekly-coverall-print.js';
import {createStaticWeeklyLunchCoverageCandidate} from '../../src/static-weekly-lunch-coverage.js';
import {shutdownStaticWeeklyCompiler} from '../../src/static-weekly-schedule-compiler-runtime.js';

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
  check('PDF recorder remains unspecified',doc.contractorCompletionRecorder,'NOT_SPECIFIED');
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
