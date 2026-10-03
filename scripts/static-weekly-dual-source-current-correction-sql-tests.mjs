import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {createDualSourceRegisteredCorrectionSqlSource} from './fixtures/dual-source-registered-correction-sql-source.mjs';
import {assertCurrentManager217MigrationSet} from './fixtures/current-manager-publication-source.mjs';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {createRecurringCorrectionBinding,RECURRING_CORRECTION_BINDING_SCHEMA} from '../src/static-weekly-recurring-correction-binding.js';

// Invoked only by run-isolated-shift-end-tests.mjs dual-source-217, after its
// complete ordered no-auto-grants replay. No production registry/source ID is
// created. This stage is distinct from current-manager-217 and does not change
// its historical 216/217 fixture or assertions.
assert.equal(process.env.STATIC_WEEKLY_TEST_DUAL_SOURCE_217,'1');
assertCurrentManager217MigrationSet();
const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
assert.ok(inspection.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const fixture=createDualSourceRegisteredCorrectionSqlSource();
assert.equal(fixture.historical.compilerInput.version.assignments.length,313);
assert.equal(fixture.correction.compilerInput.version.assignments.length,323);
assert.equal(fixture.original.compilerInput.version.assignments.length,314);
assert.equal(fixture.former.length,3);
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:5000});
pool.on('error',error=>console.error('SYNTHETIC_DUAL_SOURCE_POOL_ERROR',error.code));
const binding=createRecurringCorrectionBinding({schema:RECURRING_CORRECTION_BINDING_SCHEMA,
 sourceId:fixture.correction.sourceId,canonicalDigest:fixture.correction.sourceDigest});
const plane=createStaticWeeklyControlPlane({database:pool,recurringCorrectionSourceBinding:binding});
let checks=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const first=async(text,args=[])=>(await pool.query(text,args)).rows[0]?.result;
const revision=()=>first('select current_revision::integer as result from public.static_weekly_schedule_control where singleton');
async function rpc(role,name,args=[]){
 const client=await pool.connect();
 try{await client.query('begin');await client.query('set local role '+role);
  const value=(await client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
  await client.query('commit');return value;
 }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
const release=(name,args)=>rpc('static_weekly_release_operator',name,args);
const control=(name,args)=>rpc('static_weekly_control_plane',name,args);
const manager={manager_id:'10000000-0000-4000-8000-000000000281',manager_display_name:'Synthetic original nine manager',
 auth_mode:'trusted_device',trusted_device:true,read_only:false};
const second={manager_id:'10000000-0000-4000-8000-000000000282',manager_display_name:'Synthetic current correction manager',
 auth_mode:'trusted_device',trusted_device:true,read_only:false};
const closeClock=async(original)=>{
 await pool.query(original);
 check('synthetic service clock restored byte-exact',await first("select pg_get_functiondef('public.sch_service_date(timestamptz)'::regprocedure) as result"),original);
};
try{
 const week=fixture.week,history=fixture.historical.compilerInput,current=fixture.correction.compilerInput;
 for(const actor of [manager,second])await pool.query(
  "insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,$2,array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",
  [actor.manager_id,actor.manager_display_name]);
 const seedEmployees=new Map();
 for(const slot of history.slots.filter(row=>!row.contractorCapacity))for(const person of slot.incumbencies){
  if(person.effectiveStart<=week&&(!person.effectiveEnd||week<person.effectiveEnd))seedEmployees.set(person.personId,person);
 }
 check('nine historical incumbents before official vacancy',seedEmployees.size,9);
 let ordinal=900;
 for(const [id,person]of seedEmployees){
  await pool.query("insert into public.employees(id,employee_code,display_name,role,active) values($1,$2,$3,'staff',true)",
   [id,'EMP'+ordinal++,person.displayName]);
  await pool.query("insert into public.msg_users(employee_id,display_name,role,is_active) values($1,$2,'employee',true)",
   [id,person.displayName]);
 }
 const families=new Map(),places=new Set();
 for(const row of [...history.version.assignments,...current.version.assignments]){
  const existing=families.get(row.locationCodeSnapshot);
  const family=existing||{id:row.locationId,name:row.locationNameSnapshot,locations:new Map()};
  if(existing)assert.equal(family.id,row.locationId,'same group code never changes UUID across sources');
  for(const place of row.includedLocations||[])family.locations.set(place.locationId,place.locationNameSnapshot);
  families.set(row.locationCodeSnapshot,family);
 }
 for(const [code,family]of families){
  await pool.query('insert into public.location_groups(id,group_code,group_name,active) values($1,$2,$3,true)',[family.id,code,family.name]);
  for(const [id,name]of family.locations){
   if(!places.has(id)){
    const type=/restroom/i.test(name)?'restroom':'exhibit';
    await pool.query('insert into public.locations(id,location_code,location_name,location_type,form_type,active) values($1,$2,$3,$4,$4,true)',
     [id,'SYNTH_'+id,name,type]);places.add(id);
   }
   await pool.query('insert into public.location_group_memberships(location_group_id,location_id,active) values($1,$2,true)',[family.id,id]);
  }
 }
 await release('static_weekly_v3_configure_initial_authority_key',[
  'static-weekly-authority-hmac-v2','synthetic-dual-source-not-production-0123456789','Synthetic dual-source proof']);
 for(const source of [fixture.original,fixture.historical]){
  await release('static_weekly_v3_register_authority_source',[source.sourceId,source.compilerInput,'Synthetic immutable source; no person import']);
  check('registered immutable raw source digest '+source.sourceId,
   await first('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[source.sourceId]),source.sourceDigest);
 }
 await release('static_weekly_v6_initialize_registered_roster',[fixture.historical.sourceId,manager.manager_id,'Synthetic valid full-nine roster']);
 const historicalDraft=await plane.createInitialDraft({manager,sourceId:fixture.historical.sourceId,effectiveStart:week,
  expectedRevision:await revision(),idempotencyKey:'synthetic-historical-nine-draft'});
 const historicalPublication=await plane.publishDraft({manager,draftVersionId:historicalDraft.data.version_id,
  expectedDraftRevision:1,expectedRevision:historicalDraft.revision,
  idempotencyKey:'synthetic-historical-nine-publish',projectionWeekStart:week});
 const acceptedHistory=await first('select to_jsonb(p) as result from public.weekly_schedule_publications p where publication_id=$1',
  [historicalPublication.data.publication_id]);
 check('accepted historical full-nine version source ID',await first(
  'select authority_source_id as result from public.weekly_schedule_versions where version_id=$1',
  [historicalDraft.data.version_id]),fixture.historical.sourceId);
 check('accepted historical future-week winner',await first('select public.static_weekly_effective_version($1::date) as result',[week]),
  historicalDraft.data.version_id);
 await release('static_weekly_v3_register_authority_source',[fixture.correction.sourceId,current,
  'Distinct synthetic current correction; never production registration']);
 check('registered distinct raw correction digest',await first(
  'select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[fixture.correction.sourceId]),
  fixture.correction.sourceDigest);
 const originalClock=await first("select pg_get_functiondef('public.sch_service_date(timestamptz)'::regprocedure) as result");
 try{
  // The official v8 writer accepts an immediate service-date closure only.
  // Override this one disposable database's operational clock, then restore
  // the exact original definition; never rewrite a historical publication.
  await pool.query("create or replace function public.sch_service_date(p_at timestamptz default now()) returns date language sql stable as $$select date '2026-10-02'$$");
  check('synthetic immediate date',await first('select public.sch_service_date(statement_timestamp())::text as result'),
   fixture.syntheticServiceDate);
  for(const former of fixture.former){
   const before=await revision(),key='dual-source-official-vacancy-'+former.key;
   const receipt=await control('static_weekly_v8_vacate_roster_slot',[fixture.correction.sourceId,
    former.slotId,former.personId,fixture.syntheticServiceDate,'Synthetic actual vacancy',before,manager.manager_id,key]);
   check('official vacancy advances exact authority revision '+former.key,receipt.revision,before+1);
   check('official vacancy preserves original person '+former.key,receipt.data.former_employee_id,former.personId);
   check('official vacancy replay is byte-identical '+former.key,await control('static_weekly_v8_vacate_roster_slot',[
    fixture.correction.sourceId,former.slotId,former.personId,fixture.syntheticServiceDate,
    'Synthetic actual vacancy',before,manager.manager_id,key]),receipt);
   check('former employee deactivated '+former.key,await first('select active as result from public.employees where id=$1',[former.personId]),false);
  }
 }finally{await closeClock(originalClock);}
 const currentRoster=await first('select coalesce(jsonb_agg(to_jsonb(r)),\'[]\'::jsonb) as result from public.static_weekly_v6_read_roster($1::date) r',
  [week]);
 check('dated current roster has exactly six filled positions',currentRoster.filter(row=>row.employee_id).length,6);
 for(const former of fixture.former)check('former position remains vacant on future week '+former.key,
  currentRoster.find(row=>row.slot_id===former.slotId)?.employee_id,null);
 check('original publication/history retained byte-exact after official closures',await first(
  'select to_jsonb(p) as result from public.weekly_schedule_publications p where publication_id=$1',
  [historicalPublication.data.publication_id]),acceptedHistory);
 for(const source of [fixture.original,fixture.historical,fixture.correction])check('immutable source remains '+source.sourceId,
  await first('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[source.sourceId]),
  source.sourceDigest);
 const beforePreview=await revision();
 const preview=await plane.previewRecurringStaffing({manager:second,effectiveStart:week,expectedRevision:beforePreview});
 check('second manager preview is nonpublication',
  [preview.status,preview.admitted,preview.published,preview.affectedPhonesUpdated],
  ['CANDIDATE_ONLY',false,false,false]);
 check('preview binds historical publication',preview.publicationId,historicalPublication.data.publication_id);
 assert.match(preview.correctionWitnessDigest??'',/^[a-f0-9]{64}$/);
 checks++;console.log('PASS preview binds complete distinct correction witness digest');
 check('preview changes no authority revision',await revision(),beforePreview);
 const confirmationKey='30000000-0000-4000-8000-000000000282',request={manager:second,
  effectiveStart:week,expectedRevision:beforePreview,confirmationKey,previewDigest:preview.previewDigest};
 const receipt=await plane.confirmRecurringStaffing(request);
 check('second manager accepted exact displayed digest',receipt.receipt?.previewDigest,preview.previewDigest);
 check('accepted actor bound to named second manager',receipt.receipt?.managerId,second.manager_id);
 check('phone delivery remains pending',
  [receipt.receipt?.accepted,receipt.receipt?.phoneDeliveryState,receipt.receipt?.affectedPhonesUpdated],
  [true,'PENDING',false]);
 const status=await plane.getRecurringConfirmationStatus({manager:second,confirmationKey});
 check('exact manager status recovers accepted receipt',status.receipt,receipt.receipt);
 const after=await first(`select jsonb_build_object('parents',(select count(*) from public.static_weekly_recurring_confirmations),
  'sources',(select count(*) from public.static_weekly_authority_source_documents),
  'publications',(select count(*) from public.weekly_schedule_publications),
  'proofs',(select count(*) from public.static_weekly_recurring_acceptance_proofs)) as result`);
 check('same original request replays exact receipt',(await plane.confirmRecurringStaffing(request)).receipt,receipt.receipt);
 await assert.rejects(()=>plane.confirmRecurringStaffing({...request,previewDigest:'0'.repeat(64)}),/idempotency conflict/);
 checks++;
 check('changed request cannot append accepted state',await first(`select jsonb_build_object('parents',(select count(*) from public.static_weekly_recurring_confirmations),
  'sources',(select count(*) from public.static_weekly_authority_source_documents),
  'publications',(select count(*) from public.weekly_schedule_publications),
  'proofs',(select count(*) from public.static_weekly_recurring_acceptance_proofs)) as result`),after);
 check('historical publication remains byte-exact after new acceptance',await first(
  'select to_jsonb(p) as result from public.weekly_schedule_publications p where publication_id=$1',
  [historicalPublication.data.publication_id]),acceptedHistory);
 check('other manager cannot read second manager operation',(await plane.getRecurringConfirmationStatus({manager,confirmationKey})).state,'NOT_FOUND');
 for(const role of ['anon','authenticated','service_role'])check('direct role denied official vacancy '+role,
  await first("select has_function_privilege($1,'public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)','execute') as result",[role]),false);
 console.log(JSON.stringify({status:'PASS_DUAL_SOURCE_217_SYNTHETIC_SQL',checks,week,
  historicalSourceId:fixture.historical.sourceId,correctionSourceId:fixture.correction.sourceId,
  historicalPublicationId:historicalPublication.data.publication_id,operationId:receipt.receipt?.operationId,
  sourceDigests:[fixture.historical.sourceDigest,fixture.correction.sourceDigest],
  scope:'original valid historical313 publication, three official immediate vacancies, distinct registered current323 correction, second named manager preview-confirm-replay; no missing-day availability SQL claim',
  phone:'PENDING',production:false,independentAudit:false}));
}finally{await plane.close();await pool.end();}
