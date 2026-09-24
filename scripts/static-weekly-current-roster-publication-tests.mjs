import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated} from '../src/static-weekly-schedule-compiler-runtime.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';

const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
assert.ok(inspection.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
assert.ok(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE,'explicit immutable local source');
const bytes=readFileSync(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE),packet=JSON.parse(bytes),source=packet.compilerInput;
assert.equal(digest(source),packet.sourceDigest);assert.equal(source.version.assignments.length,313);
assert.equal(source.version.vacantSlotIds.length,3);
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:5000});
pool.on('error',e=>console.error('SYNTHETIC_POOL_ERROR',e.code));
const preparations=[];
const plane=createStaticWeeklyControlPlane({database:pool,compilerPreparer:async(...args)=>{
 const result=await compileAndPrepareStaticWeeklyScheduleIsolated(...args);preparations.push(result);return result;
}});
const query=async(sql,args=[])=>{const r=await pool.query(sql,args);return r.rows[0]?.result;};
async function rpc(role,name,args=[]){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);
 const r=await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);await c.query('commit');return r.rows[0].result;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}}
const cp=(name,args)=>rpc('static_weekly_control_plane',name,args),release=(name,args)=>rpc('static_weekly_release_operator',name,args);
const revision=()=>query('select current_revision::integer as result from public.static_weekly_schedule_control where singleton');
let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
try{
 const initialEmployees=await query('select count(*)::integer as result from public.employees');
 const week=source.serviceDate,managerId='10000000-0000-4000-8000-000000000131';
 const manager={manager_id:managerId,manager_display_name:'Synthetic Full Source Manager',auth_mode:'trusted_device',trusted_device:true,read_only:false};
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,$2,array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[managerId,manager.manager_display_name]);
 let number=820;
 for(const s of source.slots.filter(s=>!s.contractorCapacity))for(const p of s.incumbencies.filter(p=>p.effectiveStart<=week&&(!p.effectiveEnd||week<p.effectiveEnd))){
  await pool.query("insert into public.employees(id,employee_code,display_name,role,active) values($1,$2,$3,'staff',true)",[p.personId,'EMP'+number++,p.displayName]);
  await pool.query("insert into public.msg_users(employee_id,display_name,role,is_active) values($1,$2,'employee',true)",[p.personId,p.displayName]);
 }
 const families=new Map(),places=new Set();
 for(const row of source.version.assignments){const f=families.get(row.locationCodeSnapshot)||{id:row.locationId,name:row.locationNameSnapshot,locations:new Map()};
  for(const l of row.includedLocations||[])f.locations.set(l.locationId,l.locationNameSnapshot);families.set(row.locationCodeSnapshot,f);}
 for(const [code,f] of families){
  await pool.query('insert into public.location_groups(id,group_code,group_name,active) values($1,$2,$3,true)',[f.id,code,f.name]);
  for(const [id,name] of f.locations){if(!places.has(id)){
   const type=/restroom/i.test(name)?'restroom':'exhibit';
   await pool.query('insert into public.locations(id,location_code,location_name,location_type,form_type,active) values($1,$2,$3,$4,$4,true)',[id,'SYNTH_'+id,name,type]);places.add(id);}
   await pool.query('insert into public.location_group_memberships(location_group_id,location_id,active) values($1,$2,true)',[f.id,id]);
  }
 }
 await release('static_weekly_v3_configure_initial_authority_key',['static-weekly-authority-hmac-v2','synthetic-current-roster-not-production-0123456789','Synthetic full-source proof']);
 const bootstrap=structuredClone(source),vacancies=new Set(source.version.vacantSlotIds),initial='50000000-0000-4000-8000-000000000131';
 bootstrap.slots=bootstrap.slots.filter(s=>!vacancies.has(s.id));
 bootstrap.version.vacantSlotIds=[];bootstrap.version.vacancyCapableSlotIds=[];
 bootstrap.version.slotAvailability=bootstrap.version.slotAvailability.filter(a=>!vacancies.has(a.slotId));
 bootstrap.version.assignments=bootstrap.version.assignments.filter(a=>!vacancies.has(a.ownerSlotId));
 await release('static_weekly_v3_register_authority_source',[initial,bootstrap,'Synthetic occupied initialization only']);
 await release('static_weekly_v6_initialize_registered_roster',[initial,managerId,'Synthetic initialization']);
 for(const id of vacancies)await cp('static_weekly_v7_create_vacant_roster_slot',[id,source.slots.find(s=>s.id===id).label,await revision(),managerId,'synthetic-vacancy-'+id]);
 await release('static_weekly_v3_register_authority_source',[packet.sourceId,source,'Exact corrected full recurring source; isolated only']);
 check('registered exact immutable source digest',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.sourceId]),packet.sourceDigest);
 check('exactly six employees added; existing migration-seeded contractor rows unchanged',await query('select count(*)::integer as result from public.employees'),initialEmployees+6);
 console.log('ACTUAL_FULL_SOURCE_INITIAL_DRAFT_BEGIN');
 const draft=await plane.createInitialDraft({manager,sourceId:packet.sourceId,effectiveStart:week,expectedRevision:await revision(),idempotencyKey:'synthetic-full-source-draft'});
 const published=await plane.publishDraft({manager,draftVersionId:draft.data.version_id,expectedDraftRevision:1,expectedRevision:draft.revision,idempotencyKey:'synthetic-full-source-publish',projectionWeekStart:week});
 const projection=await query('select projection_envelope as result from public.weekly_schedule_compiled_projections where projection_id=$1',[published.data.projection_id]);
 check('published source retains all313 recurring assignments',projection.authority.compilerInput.version.assignments.length,313);
 check('current dated derivation has458 responsibility segments',projection.authority.overlayCompilerInput.version.assignments.length,458);
 // The approved v2 adapter stores the exception-free DERIVED baseline in
 // relational rows; the separately registered compilerInput stays313 rows.
 check('SQL accepted relational baseline matches458 derived segments',await query('select count(*)::integer as result from public.weekly_schedule_slot_assignments where version_id=$1',[published.data.version_id]),458);
 const relationalDigest=await query('select md5(jsonb_agg(to_jsonb(a) order by assignment_id)::text) as result from public.weekly_schedule_slot_assignments a where version_id=$1',[published.data.version_id]);
 const lunch=await query('select document_json as result from public.weekly_schedule_lunch_documents where projection_id=$1',[published.data.projection_id]);
 check('actual persisted current-six lunch count',lunch.loans.length,30);
 check('actual persisted current-six no unresolved lunch',lunch.loans.filter(l=>l.status==='REVIEW_REQUIRED').length,0);
 for(let offset=0;offset<7;offset++){
  const day=new Date(Date.parse(week+'T12:00:00Z')+offset*86400000),date=day.toISOString().slice(0,10),dow=day.getUTCDay();
  const roster=await query('select coalesce(jsonb_agg(to_jsonb(r)),\'[]\') as result from public.static_weekly_v6_read_roster($1::date) r',[date]);
  const slots=packet.rosterSlots.filter(s=>s.days.includes(dow)),staff=slots.filter(s=>s.personId);
  check(date+' exact positions including vacancies',roster.length,slots.length);
  check(date+' no vacancy employee invented',roster.filter(s=>s.employee_id).length,staff.length);
  check(date+' Karen fixed workdays',roster.some(s=>s.employee_id==='3da709bb-2223-4e15-8e3a-db02e3f32e97'),[1,2,3,5,6].includes(dow));
  const doc=await cp('static_weekly_v8_read_lunch_document',[date]);
  check(date+' official lunch bound to accepted projection',doc.projection_id,published.data.projection_id);
  check(date+' fixed employee lunches only',doc.loans.length,staff.length);
  check(date+' current database authority',await query('select projection_status as result from public.static_weekly_v6_schedule_authority_state($1::date)',[date]),'current');
 }
 const registered=await cp('static_weekly_v3_read_publication_source',[published.data.publication_id,week]);
 const {version,...rest}=registered.compiler_input,input={...rest,versions:[version],exceptions:registered.exceptions};
 const args={kind:'projection',publicationId:published.data.publication_id,expectedRevision:await revision(),actor:{managerId,managerName:manager.manager_display_name,idempotencyKey:'synthetic-deterministic-replay'}};
 console.log('ACTUAL_FULL_SOURCE_DETERMINISTIC_REPLAY_BEGIN');
 const replay=await compileAndPrepareStaticWeeklyScheduleIsolated(input,args);
 check('same actual hydrated input deterministic replay digest',replay.replayDigest,projection.replay_digest??preparations.at(-1).replayDigest);
 check('same actual hydrated input deterministic lunch identity',replay.lunchDocument.document_identity,lunch.document_identity);
 const c=await pool.connect();try{
  await c.query('begin');await c.query('alter table public.weekly_schedule_lunch_documents disable trigger trg_weekly_schedule_lunch_documents_immutable');
  await c.query("update public.weekly_schedule_lunch_documents set document_json=jsonb_set(document_json,'{loans,0,status}','\"REVIEW_REQUIRED\"') where projection_id=$1",[published.data.projection_id]);
  await assert.rejects(()=>c.query('select public.static_weekly_v8_read_lunch_document($1::date)',[week]),e=>
   e.code==='P0001'&&e.message==='lunch document is not bound to the exact verified projection'
    &&e.where.includes('static_weekly_v8_assert_lunch_document'));checks++;
 }finally{await c.query('rollback');c.release();}
 check('failed tamper leaves exact accepted lunch', (await cp('static_weekly_v8_read_lunch_document',[week])).document_identity,lunch.document_identity);
 check('full source remains unchanged in database',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.sourceId]),packet.sourceDigest);
 check('accepted relational baseline remains byte-identical',await query('select md5(jsonb_agg(to_jsonb(a) order by assignment_id)::text) as result from public.weekly_schedule_slot_assignments a where version_id=$1',[published.data.version_id]),relationalDigest);
 assert.deepEqual(readFileSync(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE),bytes);
 const evidence={classification:'SYNTHETIC_LOCAL_NOT_ADMITTED',sourcePacketSha256:createHash('sha256').update(bytes).digest('hex'),source,projection,lunch,replay,checks,production:false,independentAudit:false};
 if(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE,JSON.stringify(evidence)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',checks,sourceDigest:packet.sourceDigest,loans:30,immutableRows:313,derivedRows:458,production:false,independentAudit:false}));
}finally{await plane.close();}
