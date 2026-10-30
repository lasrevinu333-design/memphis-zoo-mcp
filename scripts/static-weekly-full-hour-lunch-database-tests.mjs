import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fullHourLunchFixture} from './fixtures/full-hour-lunch-source.mjs';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';

const container=process.env.LUNCH_PUBLICATION_TEST_CONTAINER;
assert.match(container??'',/^mz_schema_rebuild_(?:lunch_|roster_fullhour_)[0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
const sql=s=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
  {input:s,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
const q=s=>`'${String(s).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const query=s=>sql(s).trim().split('\n').at(-1),parsed=s=>JSON.parse(query(s));
const singleCoverer=process.env.LUNCH_SINGLE_NAMED_COVERER==='1';
assert.ok(process.env.LUNCH_SINGLE_NAMED_COVERER===undefined||singleCoverer,'Explicit single-coverer SQL fixture flag required');
const {input,people,locations}=fullHourLunchFixture({singleCovererLoan:singleCoverer}),manager=randomUUID(),date=input.serviceDate;
sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Synthetic full-hour lunch manager');`);
for(const [key,p]of Object.entries(people))sql(`insert into public.employees(id,display_name,role) values(${q(p.personId)},${q('Synthetic '+key)},'staff');`);
for(const [family,id]of Object.entries(locations)){
  sql(`insert into public.locations(id,location_code,location_name,location_type,form_type) values(${q(id)},${q(family)},${q('Synthetic '+family)},'restroom','restroom');
   insert into public.location_groups(id,group_code,group_name) values(${q(id)},${q(family)},${q('Synthetic '+family)});
   insert into public.location_group_memberships(location_group_id,location_id) values(${q(id)},${q(id)});`);
}
const fixture=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[date],source:input,label:'full-hour-lunch',mode:'official'});
const projectionId=fixture.projectionIds[date],result=fixture.compiledByWeek[date];
const prepared=createStaticWeeklyProjectionWithLunchRpcInput({result,publicationId:fixture.publicationId,expectedRevision:0,
  actor:{managerId:manager,managerName:'Synthetic full-hour lunch manager',idempotencyKey:'full-hour-lunch-document'}});
const doc=prepared.lunchDocument;
if(singleCoverer){const loan=doc.loans.find(l=>l.normal_owner_slot_id===people.a.slotId);
 assert.deepEqual(loan.helper_slot_ids,[people.b.slotId]);assert.equal(loan.fallback,null);}
const before=query('select md5(jsonb_agg(to_jsonb(o) order by occurrence_id)::text) from public.weekly_schedule_occurrences o;');
const accepted=parsed(`set role static_weekly_control_plane;select public.static_weekly_v8_materialize_lunch_document(${q(projectionId)}::uuid,${j(doc)},${q(manager)}::uuid)::text;`);
assert.equal(accepted.persistence_status,'PERSISTED');assert.equal(accepted.replayed,false);
const read=parsed(`set role custodial_application_reader;select public.static_weekly_v8_read_lunch_document(${q(date)}::date)::text;`);
assert.equal(read.document_identity,doc.document_identity);
const segments=parsed(`set role custodial_application_reader;select coalesce(jsonb_agg(to_jsonb(r)),'[]')::text from public.static_weekly_v8_read_lunch_segments(${q(date)}::date) r;`);
const west=segments.find(s=>s.normal_owner_id===people.a.personId&&s.group_code==='W');assert.ok(west);
assert.equal(west.coverer_id,people.b.personId);assert.equal(west.coverage_start,'09:30:00');assert.equal(west.coverage_end,'10:30:00');
assert.equal(query(`select coverage_end::text from public.weekly_schedule_occurrences where occurrence_id=${q(west.normal_occurrence_id)}::uuid;`),'09:45:00');
assert.equal(query('select md5(jsonb_agg(to_jsonb(o) order by occurrence_id)::text) from public.weekly_schedule_occurrences o;'),before);
const rehash=d=>{d.semantic_snapshot={schema:'memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',loans_digest:digest(d.loans),
  responsibilities_digest:digest(d.responsibilities),notification_intents_digest:digest(d.notification_intents)};
  const {document_identity,...body}=d;d.document_identity=digest(body);return d;};
let refused=0;
for(const [name,mutate,pattern]of [
  ['clipped coverage',d=>{d.responsibilities[0].segments[0].window.end='09:45';},/entire accepted lunch/],
  ['lost original anchor',d=>{delete d.responsibilities[0].segments[0].normalWindow;},/lunch segment/],
  ['changed original anchor',d=>{d.responsibilities[0].segments[0].normalWindow.start='09:31';},/exact normal-duty and lunch intersection/],
  ['wrong original work',d=>{d.responsibilities[0].segments[0].workId='not-the-original';},/original assignment/],
  ['omitted original area',d=>{d.responsibilities[0].segments.pop();},/source areas|every eligible original area|recipient mismatch/],
]){
  const bad=structuredClone(doc);mutate(bad);let error;
  try{query(`set role static_weekly_control_plane;select public.static_weekly_v8_assert_lunch_document(${q(projectionId)}::uuid,${j(rehash(bad))});`);}catch(e){error=String(e.stderr);}
  assert.ok(error,`${name} must refuse`);assert.match(error,pattern,name);refused++;
}
if(singleCoverer){
 const bad=structuredClone(doc),loan=bad.loans.find(l=>l.normal_owner_slot_id===people.a.slotId);
 loan.helper_slot_ids=[people.b.slotId,people.c.slotId].sort();let error;
 try{query(`set role static_weekly_control_plane;select public.static_weekly_v8_assert_lunch_document(${q(projectionId)}::uuid,${j(rehash(bad))});`);}catch(e){error=String(e.stderr);}
 assert.match(error??'',/full lunch source coverer set changed/);refused++;
}
for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']){
  assert.equal(query(`select has_function_privilege(${q(role)},'public.static_weekly_v8_assert_lunch_document(uuid,jsonb)','EXECUTE')::text;`),'false');
}
assert.equal(query("select count(*)::text from public.custodial_release_authority_restore_inventory i where i.object_kind='function' and to_regprocedure(i.object_identity) in ('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)'::regprocedure,'public.static_weekly_v8_read_lunch_segments_dated_base(date)'::regprocedure) and i.definition_sql=pg_get_functiondef(to_regprocedure(i.object_identity));"),'2');
assert.equal(query("select (relrowsecurity and relforcerowsecurity)::text from pg_class where oid='public.weekly_schedule_lunch_documents'::regclass;"),'true');
assert.equal(query('select count(*)::text from public.weekly_schedule_lunch_documents;'),'1');
console.log(JSON.stringify({status:'PASS',actualPostgres:true,officialSyntheticSourcePublication:true,documentId:doc.document_identity,
  sourceNamedSingleCoverer:singleCoverer,
  fullWindowReadback:true,originalOccurrenceWindowRetained:true,deniedTampering:refused,deniedValidatorRoles:5,
  exactRecoveryFunctions:2,forcedRLS:true,production:false,namedManagerBrowser:false,physical:false}));
