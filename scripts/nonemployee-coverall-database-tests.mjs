import {migrationReplayNames} from './migration-replay-order.mjs';
// Exact disposable replay, absent client defaults and official fresh-source
// admission. Never production and never historical fake-incumbent conversion.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {renderCoverAllPdfPair} from '../src/static-weekly-coverall-print.js';
import {PDFDocument} from 'pdf-lib';
import {nonemployeeCoverAllSource} from './fixtures/nonemployee-coverall-source.mjs';
import {verifyCoverAllEventBriefSqlFixture} from './fixtures/coverall-event-brief-sql-fixture.mjs';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
const container=`mz_schema_rebuild_nonemployee_capacity_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
let owned=false,checks=0,employeeChecks,pool;
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','supabase_admin','-d','postgres'],{input:'set client_min_messages=warning;'+text}).trim();
const q=v=>v==null?'null':`'${String(v).replaceAll("'","''")}'`,j=v=>`${q(JSON.stringify(v))}::jsonb`;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const reject=(name,text,pattern)=>{let error;try{sql(text);}catch(e){error=e;}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;console.log('PASS',name);};
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in(0,'public'::regnamespace) and d.defaclrole in('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in('r','S') and a.grantee in(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['',' in schema public'])sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
const employeeConstraintSql="select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where contype='c' and conrelid in('public.weekly_schedule_slot_assignments'::regclass,'public.weekly_schedule_occurrences'::regclass,'public.weekly_schedule_projection_assignments'::regclass) and pg_get_constraintdef(oid) like '%owner_person_id_snapshot%'";
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{if(owned)docker(['rm','-f',container]);}finally{process.exit(143);}});
try{
 docker(['image','inspect',image]);docker(['run','--rm','-d','--name',container,'-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,size=1g','-e','POSTGRES_PASSWORD=postgres',image,'-c','listen_addresses=*','-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','-c','cron.database_name=postgres']);owned=true;console.log('OWNED_CONTAINER',container);
 let ready=0;for(let i=0;i<100&&ready<5;i++){try{sql('select 1');ready++;}catch{ready=0;}await new Promise(r=>setTimeout(r,500));}assert.equal(ready,5);removeDefaults();
 const files=migrationReplayNames(process.cwd());
 for(const file of files){assert.equal(sql(defaults),'0','absent defaults before '+file);checks++;
  if(file==='20261003140000_static_weekly_nonemployee_contractor_capacity.sql')employeeChecks=sql(employeeConstraintSql);
  const bytes=readFileSync('supabase/migrations/'+file,'utf8');try{sql(bytes);}catch(e){console.error('FAILED_MIGRATION',file,String(e.stderr));throw e;}
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes,/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults();}
  assert.equal(sql(defaults),'0','absent defaults after '+file);checks++;
  if(files.indexOf(file)%25===0)console.log('REPLAY_PROGRESS',file);await new Promise(r=>setImmediate(r));
 }
 console.log('EXACT_REPLAY_COMPLETE',files.length);
 const oldChecks=JSON.parse(employeeChecks),newChecks=JSON.parse(sql(employeeConstraintSql));
 const normalize=x=>x.replace(/[()\s]/g,'');
 for(const old of oldChecks){const current=newChecks.find(c=>c.table===old.table&&c.name===old.name);assert.ok(current);check('original employee predicate remains literal branch '+old.table,normalize(current.definition).includes(normalize(old.definition).slice(5)),true);}
 check('new capacity registry forced RLS',sql("select relrowsecurity and relforcerowsecurity from pg_class where oid='public.static_weekly_contractor_capacity_registrations'::regclass"),'t');
 const manager=randomUUID();sql(`insert into public.ops_manager_managers(manager_id,display_name,roles) values(${q(manager)},'Synthetic capacity manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'])`);
 const week=sql("select date_trunc('week',clock_timestamp() at time zone 'America/Chicago')::date::text");
 const {source,employees,capacities,areas}=nonemployeeCoverAllSource(week);
 for(const [i,p] of employees.entries())sql(`insert into public.employees(id,employee_code,display_name,role) values(${q(p.id)},'CAPACITY_REAL_${i}',${q(p.name)},'staff')`);
 for(const a of areas)sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,nfc_url,scan_router_url) values(${q(a.physical)},${q(a.code)},${q(a.name)},'restroom','restroom','synthetic-original-tag','synthetic-original-router');insert into public.location_groups(id,group_code,group_name) values(${q(a.group)},${q(a.code)},${q(a.name)});insert into public.location_group_memberships(location_group_id,location_id) values(${q(a.group)},${q(a.physical)});`);
 const peopleBefore=sql('select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.employees e');
 const authority=await seedCompiledEventAuthority({sql,container,database:'postgres',managerId:manager,dates:[week],source,label:'fresh-nonemployee-capacity'});
 check('official compiler/source/draft/publication/projection accepted',authority.mode,'official');
 check('nine actual employees unchanged by capacity registration',sql('select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.employees e'),peopleBefore);
 check('exact nine real incumbencies only',sql('select count(*) from public.weekly_roster_slot_incumbencies'),'9');
 check('eight capacity registrations and no fabricated incumbencies',sql('select count(*) from public.static_weekly_contractor_capacity_registrations'),'8');
 check('stable roster has nine employee and eight capacity slots',sql('select count(*) from public.weekly_roster_slots'),'17');
 check('unrequested capacities do not receive baseline assignments',sql(`select count(*) from public.weekly_schedule_projection_assignments a join public.static_weekly_contractor_capacity_registrations c on c.capacity_slot_id=a.owner_slot_id`),'0');
 const replay=JSON.parse(sql(`set role static_weekly_release_operator;select public.static_weekly_v6_initialize_registered_roster(${q(authority.sourceId)},${q(manager)},'fresh-nonemployee-capacity')`));
 check('exact initializer replay recovers original fresh source',replay.already_initialized,true);
 check('exact initializer replay retains nine actual incumbencies',replay.incumbency_count,9);
 const port=Number(docker(['port',container,'5432/tcp']).trim().split(':').at(-1));
 sql("create role nonemployee_capacity_runtime login password 'synthetic-disposable-capacity';grant static_weekly_control_plane to nonemployee_capacity_runtime");
 pool=new Pool({connectionString:`postgresql://nonemployee_capacity_runtime:synthetic-disposable-capacity@127.0.0.1:${port}/postgres`,ssl:false});
 const cp=createStaticWeeklyControlPlane({database:pool});
 const managerActor={manager_id:manager,manager_display_name:'Synthetic capacity manager'};
 const args={manager:managerActor,serviceDate:week,baseVersionId:authority.versionId,publicationId:authority.publicationId,slotId:capacities[0].slot,
  shift:{start:'07:00',end:'15:00'},lunch:{start:'11:00',end:'12:00'},reason:'Synthetic explicit manager add, no absence',expectedRevision:Number(sql('select current_revision from public.static_weekly_schedule_control where singleton')),idempotencyKey:'nonemployee-manual-exact',projectionWeekStart:week};
 let manual;try{manual=await cp.applyContractorCapacity(args);}catch(e){console.error('MANUAL_CAPACITY_FAILED',e.code,e.message,e.detail);throw e;}
 console.log('MANUAL_RECEIPT',JSON.stringify({operation:manual.operation,revision:manual.revision,request_digest:manual.request_digest,output_digest:manual.output_digest,projection_id:manual.data.projection_id}));
 check('manual command receipt exact replay',await cp.applyContractorCapacity(args),manual);
 check('manual command changes zero employee rows',sql('select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.employees e'),peopleBefore);
 check('manual command preserves all nine actual incumbencies',sql('select count(*) from public.weekly_roster_slot_incumbencies'),'9');
 check('typed contractor owns actual dated work',Number(sql(`select count(*) from public.weekly_schedule_occurrences where owner_capacity_id=${q(capacities[0].slot)} and state='created'`))>0,true);
 check('typed dated ownership has no fake person/name',sql(`select count(*) from public.weekly_schedule_occurrences where owner_kind='CONTRACTOR_CAPACITY' and (owner_person_id_snapshot is not null or owner_name_snapshot is not null or owner_slot_id is distinct from owner_capacity_id)`),'0');
 check('actual schedule reader uses COVERALL not OPEN/EMPLOYEE',Number(sql(`set role custodial_application_reader;select count(*) from public.static_weekly_v6_read_schedule_segments(${q(week)}) where owner_type='COVERALL' and status='ASSIGNED' and assigned_employee_id is null and assigned_employee_name is null`))>0,true);
 const current=JSON.parse(sql(`select row_to_json(s) from public.static_weekly_v6_schedule_authority_state(${q(week)}) s`));
 const lunch=JSON.parse(sql(`set role static_weekly_control_plane;select public.static_weekly_v8_read_lunch_document(${q(week)})`));
 check('actual lunch document persisted same projection',lunch.projection_id,current.projection_id);
 check('typed lunch carries original capacity, null person',lunch.loans.some(l=>l.normal_owner_capacity_id===capacities[0].slot&&l.normal_owner_person_id===null),true);
 const print=await cp.getCoverAllPrintDocument({manager:managerActor,weekStart:week,serviceDate:week,expectedRevision:Number(sql('select current_revision from public.static_weekly_schedule_control where singleton')),projectionId:current.projection_id});
 check('accepted print exact same projection',print.projectionId,current.projection_id);
 check('print stable nonemployee label',print.contractors[0].name,'CoverAll01');
 check('print keeps Eric personal verification',print.contractorCompletionRecorder,'ERIC_OPERLE_PERSONAL_VERIFICATION');
 check('print has actual areas',print.contractors[0].periods.some(p=>p.areas.length>0),true);
 const eventBrief=verifyCoverAllEventBriefSqlFixture({sql,managerId:manager,printDocument:print,
  areas,capacitySlotId:capacities[0].slot});
 check('private CoverAll Event candidate uses actual accepted owner and same-day area',eventBrief.status,'PASS');
 const pair=await renderCoverAllPdfPair(print);mkdirSync('output/pdf',{recursive:true});mkdirSync('tmp/pdfs',{recursive:true});
 for(const file of pair.files){const bytes=Buffer.from(file.base64,'base64'),pdf=await PDFDocument.load(bytes);
  check(file.language+' PDF exact projection/revision/document subject',pdf.getSubject(),`projection=${print.projectionId}; revision=${print.authorityRevision}; document=${print.documentDigest}`);
  check(file.language+' actual PDF has pages',pdf.getPageCount()>0,true);
  const path='output/pdf/'+file.filename;writeFileSync(path,bytes);execFileSync('pdftoppm',['-scale-to','1200','-png',path,'tmp/pdfs/'+file.language],{timeout:60000});console.log('GENERATED_PDF',path);
 }
 const activeEnvelope=JSON.parse(sql(`select projection_envelope from public.weekly_schedule_compiled_projections where projection_id=${q(current.projection_id)}`));
 const capacityRow=activeEnvelope.assignments.find(r=>r.capacity_id===capacities[0].slot);assert.ok(capacityRow);
 reject('forged capacity mismatch denied by actual private writer validator',`select public.static_weekly_capacity_assert_projection_owner(${j(activeEnvelope)},${q(authority.publicationId)},${j({...capacityRow,capacity_id:capacities[1].slot})})`,/23514.*mismatched capacity/s);
 reject('inactive registered capacity cannot acquire dated ownership',`select public.static_weekly_capacity_accepted_slot(${q(authority.publicationId)},${q(week)},${q(capacities[1].slot)})`,/23514.*exact accepted dated manual command/s);
 reject('foreign publication cannot adopt capacity source',`select public.static_weekly_capacity_accepted_slot(${q(randomUUID())},${q(week)},${q(capacities[0].slot)})`,/23514.*immutable publication source/s);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  reject(role+' direct registry read denied',`set role ${role};select * from public.static_weekly_contractor_capacity_registrations`,/42501.*permission denied/s);
  reject(role+' private registration lookup denied',`set role ${role};select public.static_weekly_capacity_registered(${j(source.slots[9])})`,/42501.*permission denied/s);
  reject(role+' private dated writer validator denied',`set role ${role};select public.static_weekly_capacity_assert_projection_owner(${j(activeEnvelope)},${q(authority.publicationId)},${j(capacityRow)})`,/42501.*permission denied/s);
  if(role!=='static_weekly_release_operator')reject(role+' initializer execution denied',`set role ${role};select public.static_weekly_v6_initialize_registered_roster(${q(authority.sourceId)},${q(manager)},'not-release')`,/42501.*permission denied/s);
 }
 reject('registration update rejected even by owner',`update public.static_weekly_contractor_capacity_registrations set capacity_code='CoverAll01' where capacity_slot_id=${q(capacities[0].slot)}`,/55000|23514/);
 const forged=structuredClone(source);forged.slots[9].capacityId=randomUUID();
 reject('crafted typed slot cannot bypass immutable registration',`select public.static_weekly_v4_hydrate_compiler_source(${j(forged)},${q(week)})`,/23514.*nonemployee capacity requires/s);
 const unregistered=structuredClone(source);unregistered.slots[9].id=randomUUID();unregistered.slots[9].capacityId=unregistered.slots[9].id;
 reject('well-shaped unregistered contractor denied',`select public.static_weekly_v4_hydrate_compiler_source(${j(unregistered)},${q(week)})`,/23514.*immutable registration/s);
 const hiddenActivation=structuredClone(source);hiddenActivation.versions[0].slotAvailability.find(s=>s.slotId===capacities[0].slot).status='working';
 reject('recurring source cannot automatically activate registered capacity',`select public.static_weekly_v4_hydrate_compiler_source(${j(hiddenActivation)},${q(week)})`,/23514.*cannot be activated/s);
 check('registry recovery relation/grant/column-set captured',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_identity='public.static_weekly_contractor_capacity_registrations' and object_kind in('relation','column_set','relation_state','grant')"),'4');
 check('private helper recovery exact ACL captured',sql("select count(*) from public.custodial_release_authority_restore_inventory where object_identity='static_weekly_capacity_registered(jsonb)' and object_kind in('function','grant')"),'2');
 console.log(JSON.stringify({status:'PASS',checks,migrations:files.length,scope:'fresh official nine-employee/eight-capacity plus manual named-manager transaction, projection/lunch/reader/bilingual PDF bytes; rendered pages require separate visual review; no current-source transition/live release proof'}));
}finally{await shutdownStaticWeeklyCompiler();if(pool)await pool.end();if(owned)docker(['rm','-f',container]);}
