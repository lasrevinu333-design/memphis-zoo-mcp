import {validateNativeScheduleSourceRequests,readNativeScheduleSourceRequests} from '../src/native-schedule-source-discovery.js';
// Actual isolated PostgreSQL source eligibility, no provider/job/phone effect.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import pg from 'pg';
import {deriveNativeScheduleOccurrence} from '../src/native-schedule-occurrence.js';
import {deriveNativeScheduleValiditySource} from '../src/native-schedule-validity-source.js';
import {nativeScheduleSnapshotSql} from '../src/native-schedule-preparation.js';
import {migrationReplayNames} from './migration-replay-order.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {shutdownStaticWeeklyCompiler} from '../src/static-weekly-schedule-compiler-runtime.js';
const [socket,out,container]=process.argv.slice(2),q=x=>`'${String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")}'`;
assert.match(socket,/^\/tmp\/mz-msg-[A-Za-z0-9_-]+\/socket$/);assert.match(container,/^mz_schema_rebuild_lunch_[a-z0-9]+$/);
const sha=x=>createHash('sha256').update(x).digest('hex');
const put=(name,x)=>writeFileSync(out+'/'+name,JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});
let c,checks=0,current='startup';
const step=(name,detail={})=>{const row={at:new Date().toISOString(),name,...detail};appendFileSync(out+'/PROGRESS.jsonl',JSON.stringify(row)+'\n',{mode:0o600});console.log(JSON.stringify(row));};
const eq=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;step('CHECK',{test:name,checks});};
const sql=async text=>{const r=await c.query(text);return Array.isArray(r)?r.findLast(x=>x.rows?.length)||r.at(-1):r;};
const one=async text=>(await sql(text)).rows[0]?.v;
async function deny(name,text){await sql('begin');let error;try{await sql(text);}catch(e){error=e;}finally{await sql('rollback');}
 assert.equal(error?.code,'42501',name);checks++;step('CHECK',{test:name,checks});}
const absent="select count(*)::int as v from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const remove=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].flatMap(scope=>['tables','sequences'].map(kind=>`alter default privileges for role ${owner}${scope} revoke all on ${kind} from public,anon,authenticated,service_role;`))).join('\n');
const exceptions=new Set(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql']);
const manifest=migrationReplayNames().map(file=>({file,sha256:sha(readFileSync('supabase/migrations/'+file))}));put('MIGRATIONS.json',manifest);
assert.equal(manifest.length,246);assert.equal(manifest.at(-1).file,'20261008135429_native_schedule_source_discovery.sql');
try{
 let ready=0;
 for(let n=0;n<40;n++){
  const next=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:500,query_timeout:30000});next.on('error',()=>{});
  try{await next.connect();assert.equal((await next.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin')")).rows[0].n,4);
   if(++ready===4){c=next;break;}await next.end();}catch{ready=0;await next.end().catch(()=>{});}await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(c);step('READY');await sql(remove);
 for(const [i,row] of manifest.entries()){
  current=row.file;assert.equal(await one(absent),0,'before '+current);const bytes=readFileSync('supabase/migrations/'+current);assert.equal(sha(bytes),row.sha256);if(current==='20261008135429_native_schedule_source_discovery.sql')eq('before: discovery wrapper is genuinely absent',await one("select to_regprocedure('public.custodial_native_schedule_source_requests()') is null as v"),true);await sql(bytes.toString());
  if(await one(absent)){assert.ok(exceptions.has(current));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);await sql(remove);}
  assert.equal(await one(absent),0,'after '+current);if(i%25===24||i===manifest.length-1)step('REPLAY',{completed:i+1,file:current});
 }
 current='accepted-source-fixture';
 const dates=await one("select jsonb_build_object('date',public.sch_service_date(now())+1,'week',date_trunc('week',(public.sch_service_date(now())+1)::timestamp)::date) as v");
 const day=new Date(dates.date+'T12:00:00Z').getUTCDay(),manager=randomUUID();
 const {source,slots,places}=nativeLocationAuthoritySource(dates.week,day);
 // Fixture-only lunch at09:45. No incumbent schedule or live data is changed.
 source.versions[0].slotAvailability[0].lunch={start:'09:45',end:'10:45'};
 source.versions[0].assignments.forEach(x=>x.window.start='08:00');
 await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${q(manager)},'Synthetic09:45manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false);
 insert into public.employees(id,employee_code,display_name,role,active) values ${slots.map((s,i)=>`(${q(s.person)},'EMP${960+i}',${q(s.name)},'staff',true)`).join(',')};`);
 for(const p of Object.values(places))await sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${q(p.id)},${q(p.code)},${q(p.name)},'restroom','restroom',true);
 insert into public.location_groups(id,group_code,group_name,active) values(${q(p.group)},${q(p.code)},${q(p.name)},true);
 insert into public.location_group_memberships(location_id,location_group_id,active) values(${q(p.id)},${q(p.group)},true);`);
 const scalarSql=async text=>{await sql('reset role');const r=await sql(text),v=r.rows[0]&&Object.values(r.rows[0])[0];return v==null?'':typeof v==='object'?JSON.stringify(v):String(v);};
 step('OFFICIAL_FIXTURE_BEGIN');
 const authority=await seedCompiledEventAuthority({sql:scalarSql,container,managerId:manager,dates:[dates.date],source,label:'ownership0945-source',mode:'official'});
 const projection=authority.projectionIds[dates.week];await sql('reset role');
 const document=createStaticWeeklyProjectionWithLunchRpcInput({result:authority.compiledByWeek[dates.week],publicationId:authority.publicationId,expectedRevision:0,
 actor:{managerId:manager,managerName:'Synthetic09:45manager',idempotencyKey:'ownership0945-source-document'}}).lunchDocument;
 await sql(`set role static_weekly_control_plane;select public.static_weekly_v8_materialize_lunch_document(${q(projection)},${q(document)}::jsonb,${q(manager)});reset role;`);
 const links=(await sql(`select normal_occurrence_id,normal_owner_id,coverer_id,coverage_start::text,coverage_end::text from public.static_weekly_v8_read_lunch_segments(${q(dates.date)}::date)
 where projection_id=${q(projection)} and normal_owner_id=${q(slots[0].person)} and coverage_start<=time '09:45' and coverage_end>=time '09:45' order by normal_occurrence_id,coverer_id`)).rows;
 assert.ok(links.length>0&&links.every(x=>x.coverer_id));const link=links[0];assert.notEqual(link.coverer_id,link.normal_owner_id);
 const registered=new Map();
 for(const [index,person] of [...new Set([link.normal_owner_id,link.coverer_id,...slots.map(s=>s.person)])].entries()){
  const device=randomUUID(),credential=randomUUID(),generation=randomUUID(),token='synthetic-0945-source-token-'+index,tokenHash=sha(token),identifier='KIOSK_'+String(index+2).padStart(2,'0');
  await sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},${q(identifier)},'Synthetic source phone',true,${q(person)},1);
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at) values(${q(credential)},${q(device)},${q(sha('synthetic-0945-source-credential-'+index))},now()-interval '1 day',${q(dates.date)}::date+interval '2 days');
  set role service_role;select public.mz_register_employee_push(${q(credential)},${q(token)},${q(tokenHash)},'android','synthetic-only','synthetic.custodial.df36d32368b6');reset role;`);
  const registration=await one(`select registration_id::text as v from public.employee_push_registrations where credential_id=${q(credential)} and active`);assert.ok(registration);
  const app={package_name:'org.memphiszoo.custodial',version_name:'synthetic-only',version_code:53,build_id:'synthetic.custodial.df36d32368b6'};
  await sql(`insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,device_identifier,credential_id,employee_id,assignment_epoch,
   principal_digest,token_digest,native_app,request_fingerprint,first_native_request_id,first_attestation_digest,activated_at)
   values(${q(generation)},${q(randomUUID())},${q(registration)},${q(device)},${q(identifier)},${q(credential)},${q(person)},1,repeat('a',64),${q(tokenHash)},${q(app)}::jsonb,repeat('b',64),${q(randomUUID())},repeat('c',64),now()-interval '1 hour');`);
  registered.set(person,{device,credential,generation});
 }

 const call=when=>"select public.custodial_native_schedule_source_requests_at("+q(when)+"::timestamptz) as v";
 const at=dates.date+' 09:46:00 America/Chicago';
 const counts=()=>one("select jsonb_build_object('jobs',(select count(*) from public.operational_notification_jobs),'sources',(select count(*) from public.employee_native_schedule_source_reservations),'generations',(select count(*) from public.employee_native_push_generations),'attempts',(select count(*) from public.employee_native_schedule_dispatch_attempts),'outcomes',(select count(*) from public.employee_native_schedule_outcomes),'revision',(select current_revision from public.static_weekly_schedule_control where singleton)) as v");
 const before=await counts(),response=await one(call(at)),typed=validateNativeScheduleSourceRequests(response);
 eq('actual source-only status',typed.status,'SOURCE_CANDIDATES_ONLY');
 eq('all four actual working fixture employees discovered',typed.requests.map(r=>r.employee_id),slots.map(s=>s.person).sort());
 eq('actual compiled projection binding',typed.authority.projection_id,projection);
 eq('source date is SQL-owned',typed.service_date,dates.date);
 eq('no provider or native permission',[typed.dispatch_authorized,typed.delivery_admitted,typed.clock_effect_authority,typed.retention_authority],[false,false,null,null]);
 for(const request of typed.requests){
  const expected=registered.get(request.employee_id);assert.ok(expected);
  eq('exact generation '+request.employee_id,request.generation_id,expected.generation);
  const target=await one("select public.custodial_native_target_source_at('SCHEDULE',"+q(request.source_key)+","+q(request.employee_id)+","+q(request.generation_id)+","+q(at)+"::timestamptz) as v");
  eq('actual target admits source-only '+request.employee_id,target.status,'SOURCE_ONLY_POLICY_MISSING');
  eq('actual target same projection '+request.employee_id,target.source.source_id,typed.authority.projection_id);
 }
 eq('actual adapter is same SQL DTO',await readNativeScheduleSourceRequests({db:{rpc:async(fn,args)=>{
  eq('adapter calls only protected service read',fn,'custodial_native_schedule_source_requests');eq('no caller clock/date injection',args,{});return{data:await one(call(at))};}}}),typed);
 eq('discovery is actually read-only',await counts(),before);
 eq('same inputs select stable canonical anchors',(await one(call(at))).requests,typed.requests);
 const covererRequest=typed.requests.find(r=>r.employee_id===link.coverer_id);
 eq('lunch coverer remains a current source recipient',Boolean(covererRequest),true);
 const normal=registered.get(link.normal_owner_id);
 const withdrawn=await one('begin;update public.device_auth_credentials set revoked_at=now() where credential_id='+q(normal.credential)+';'+call(at)+';rollback;');
 eq('revoked actor removed without replacement',withdrawn.requests.map(r=>r.employee_id),typed.requests.filter(r=>r.employee_id!==link.normal_owner_id).map(r=>r.employee_id));
 eq('rollback restores protected actor source',(await one(call(at))).requests,typed.requests);
 const tomorrow=await one("select ((date "+q(dates.date)+"+1)+time '09:46') at time zone 'America/Chicago' as v");
 const off=await one(call(tomorrow.toISOString()));
 eq('off day has no invented recipients',off.requests,[]);
 const publicCall='select public.custodial_native_schedule_source_requests() as v';
 const publicReply=await one('set role service_role;'+publicCall+';reset role;');
 eq('normal wrapper never accepts caller fixture time',publicReply.service_date,await one('select public.sch_service_date(statement_timestamp())::text as v'));
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])await deny('source wrapper denied '+role,'set role '+role+';'+publicCall);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])await deny('time-parametric core denied '+role,'set role '+role+';'+call(at));
 for(const identity of ['custodial_native_schedule_source_requests()','custodial_native_schedule_source_requests_at(timestamp with time zone)']){
  for(const kind of ['function','grant']){
   const rows=(await sql("select object_identity,definition_sql,definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind="+q(kind)+" and (object_identity like 'custodial_native_schedule_source_requests(%' or object_identity like 'custodial_native_schedule_source_requests_at(%' or object_identity like 'public.custodial_native_schedule_source_requests(%' or object_identity like 'public.custodial_native_schedule_source_requests_at(%') and to_regprocedure(object_identity)="+q('public.'+identity)+"::regprocedure")).rows;
   eq('one exact recovery '+kind+'/'+identity,rows.length,1);
   const row=rows[0],live=await one('select '+(kind==='function'?'pg_get_functiondef('+q('public.'+identity)+'::regprocedure)':'public.custodial_release_authority_current_grant_definition('+q(row.object_identity)+')')+' as v');
   eq('exact saved definition '+kind+'/'+identity,row.definition_sql,live);eq('exact saved digest '+kind+'/'+identity,row.definition_sha256,sha(live));
  }
 }
 eq('ALWAYS recovery guard retained',await one("select tgenabled::text as v from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'"),'A');
 eq('all read-only calls preserve job/source/attempt/outcome totals',await counts(),before);
 put('SQL_RECEIPT.json',{status:'PASS',checks,migration_count:246,source_requests:typed.requests,authority:typed.authority,
  schema:typed.schema,source_only:true,fixture:'Official accepted synthetic four-person publication and09:45lunch; actual SQL and actual JS adapter, not live six or phone.',
  exact_clock_audio_qualification:false,producer_or_worker_activated:false,provider_dispatch:false,production:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,actual_SQL:true,migration_count:246,source_only:true,provider_dispatch:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
