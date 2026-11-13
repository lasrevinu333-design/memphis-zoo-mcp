import {prepareNativeScheduleSourceJobs} from '../src/native-schedule-source-producer.js';
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
assert.equal(manifest.length,247);assert.equal(manifest.at(-1).file,'20261008142316_native_schedule_preparation_source.sql');
try{
 let ready=0;
 for(let n=0;n<40;n++){
  const next=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:500,query_timeout:30000});next.on('error',()=>{});
  try{await next.connect();assert.equal((await next.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin')")).rows[0].n,4);
   if(++ready===4){c=next;break;}await next.end();}catch{ready=0;await next.end().catch(()=>{});}await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(c);step('READY');await sql(remove);
 for(const [i,row] of manifest.entries()){
  current=row.file;assert.equal(await one(absent),0,'before '+current);const bytes=readFileSync('supabase/migrations/'+current);assert.equal(sha(bytes),row.sha256);if(current==='20261008142316_native_schedule_preparation_source.sql')eq('before: preparation source projection genuinely absent',await one("select to_regprocedure('public.custodial_native_schedule_preparation_source(uuid,uuid,uuid)') is null as v"),true);await sql(bytes.toString());
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

 let at=dates.date+' 09:46:00 America/Chicago',revokeOnDiscovery=false;const controls=[],calls=[];
 const counts=()=>one("select jsonb_build_object('sources',(select count(*) from public.employee_native_schedule_source_reservations),'markers',(select count(*) from public.employee_native_schedule_jobs),'jobs',(select count(*) from public.operational_notification_jobs),'attempts',(select count(*) from public.employee_native_schedule_dispatch_attempts),'outcomes',(select count(*) from public.employee_native_schedule_outcomes),'health',public.static_weekly_digest_text((select jsonb_agg(r order by registration_id)::text from public.employee_push_registrations r))) as v");
 const db={rpc(fn,a){let signal;return{retry(value){controls.push(value);return this;},abortSignal(v){signal=v;return this;},async then(resolve,reject){
  try{
   assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);calls.push(fn);let expression;
   if(fn==='custodial_native_schedule_source_requests')expression='public.custodial_native_schedule_source_requests_at('+q(at)+'::timestamptz)';
   else if(fn==='custodial_native_schedule_preparation_source')expression='public.custodial_native_schedule_preparation_source_at('+q(a.p_source)+','+q(a.p_employee)+','+q(a.p_generation)+','+q(at)+'::timestamptz)';
   else if(fn==='custodial_native_schedule_source_reserve')expression='public.custodial_native_schedule_source_reserve_at('+q(a.p_source_key)+','+q(a.p_employee_id)+','+q(a.p_generation_id)+','+q(a.p_expected_source_sha256)+','+q(a.p_operation_id)+','+q(at)+'::timestamptz)';
   else if(fn==='custodial_native_schedule_content_source')expression='public.custodial_native_schedule_content_source_at('+q(a.p_operation_id)+','+q(a.p_employee_id)+','+q(a.p_generation_id)+','+q(at)+'::timestamptz)';
   else if(fn==='custodial_native_schedule_job_prepare')expression='public.custodial_native_schedule_job_prepare_at('+q(a.p_source)+','+q(a.p_expected)+'::jsonb,'+q(a.p_operation)+','+q(at)+'::timestamptz)';
   else throw Error('unowned producer RPC');
   const data=await one('select '+expression+' as v');
   if(revokeOnDiscovery&&fn==='custodial_native_schedule_source_requests')await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(registered.get(link.normal_owner_id).credential));
   resolve({data});
  }catch(e){reject(e);}
 }};}};
 const before=await counts(),first=await prepareNativeScheduleSourceJobs({db});
 eq('real batch prepares only changed ownership',[first.requested,first.prepared,first.replayed,first.pending,first.skipped],[4,3,0,0,1]);
 eq('unchanged ownership disposition retained',first.reasons,['NO_OWNERSHIP_CHANGE']);
 eq('batch has no native effect permit',[first.dispatch_authorized,first.delivery_admitted,first.native_qualified,first.clock_effect_authority,first.retention_authority],[false,false,false,null,null]);
 eq('every source RPC explicitly no-auto-retry',controls.every(v=>v===false),true);
 const after=await counts();eq('three exact original source/job markers/pending jobs',[after.sources-before.sources,after.markers-before.markers,after.jobs-before.jobs],[3,3,3]);
 eq('producer has no provider attempt/outcome/health side effect',[after.attempts,after.outcomes,after.health],[before.attempts,before.outcomes,before.health]);
 const second=await prepareNativeScheduleSourceJobs({db});eq('next sweep uses original jobs',second.jobs.map(j=>j.job_id).sort(),first.jobs.map(j=>j.job_id).sort());
 eq('next sweep marks all three original replays',second.replayed,3);eq('next sweep adds no duplicate rows',await counts(),after);
 at=dates.date+' 09:44:59 America/Chicago';const early=await prepareNativeScheduleSourceJobs({db});
 eq('before boundary truth, no invented cue',[early.prepared,early.pending,early.skipped],[0,3,1]);eq('before boundary preserves all originals',await counts(),after);
 at=dates.date+' 17:01:00 America/Chicago';const expired=await prepareNativeScheduleSourceJobs({db});
 eq('expired opportunity not invented pending work',[expired.prepared,expired.pending,expired.skipped],[0,0,4]);
 eq('expired and unchanged reasons remain distinct',[...expired.reasons].sort(),['NO_OWNERSHIP_CHANGE','SOURCE_WINDOW_EXPIRED','SOURCE_WINDOW_EXPIRED','SOURCE_WINDOW_EXPIRED'].sort());
 eq('expired batch does not rewrite history',await counts(),after);
 at=dates.date+' 09:46:00 America/Chicago';revokeOnDiscovery=true;await sql('begin');let retired;
 try{retired=await prepareNativeScheduleSourceJobs({db});}finally{revokeOnDiscovery=false;await sql('rollback');}
 eq('source changed after discovery is pending',[retired.prepared,retired.replayed,retired.pending,retired.skipped],[2,2,1,1]);
 eq('real actor revocation reason retained',retired.reasons.includes('TARGET_STALE'),true);eq('race rollback retains original rows and health',await counts(),after);
 const sourceKey=await one('select source_key::text as v from public.employee_native_schedule_source_reservations where employee_id='+q(link.normal_owner_id));
 const wrapper='select public.custodial_native_schedule_preparation_source('+q(sourceKey)+','+q(link.normal_owner_id)+','+q(registered.get(link.normal_owner_id).generation)+') as v';
 eq('service wrapper retains actual SQL clock and source reason',(await one('set role service_role;'+wrapper+';reset role;')).source_status,'WINDOW_NOT_STARTED');
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])await deny('current preparation wrapper denied '+role,'set role '+role+';'+wrapper);
 for(const identity of ['custodial_native_schedule_preparation_source(uuid,uuid,uuid)','custodial_native_schedule_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)'])for(const kind of ['function','grant']){
  const rows=(await sql("select object_identity,definition_sql,definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind="+q(kind)+" and object_identity like '%custodial_native_schedule_preparation_source%' and to_regprocedure(object_identity)="+q('public.'+identity)+"::regprocedure")).rows;
  eq('one source-status recovery '+kind+'/'+identity,rows.length,1);
  const live=await one('select '+(kind==='function'?'pg_get_functiondef('+q('public.'+identity)+'::regprocedure)':'public.custodial_release_authority_current_grant_definition('+q(rows[0].object_identity)+')')+' as v');
  eq('exact source-status recovery '+kind+'/'+identity,rows[0].definition_sql,live);eq('exact source-status digest '+kind+'/'+identity,rows[0].definition_sha256,sha(live));
 }
 put('SQL_RECEIPT.json',{status:'PASS',checks,migration_count:247,actual_source_producer_SQL:true,SDK_transport_simulated:true,first,second,early,expired,retired,
  actual_original_replay_no_duplicates:true,source_only:true,fixture:'Official synthetic four-person/lunch/current-generation publication; private time-parametric cores model source time. Not live six/native clock/device proof.',
  provider_dispatch:false,native_transport_activated:false,production:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,actual_SQL:true,source_only:true,provider_dispatch:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
