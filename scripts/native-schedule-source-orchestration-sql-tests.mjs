import {prepareDiscoveredNativeScheduleJob} from '../src/native-schedule-source-orchestration.js';
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

 const at=dates.date+' 09:46:00 America/Chicago',calls=[];
 const discovery=await one("select public.custodial_native_schedule_source_requests_at("+q(at)+"::timestamptz) as v");
 const request=discovery.requests.find(r=>r.employee_id===link.coverer_id);assert.ok(request);
 const projected=await one("select public.custodial_native_schedule_preparation_source_at("+q(request.source_key)+","+q(request.employee_id)+","+q(request.generation_id)+","+q(at)+"::timestamptz) as v");
 eq('actual trusted source projection status',projected.status,'CURRENT_PREPARATION_SOURCE_ONLY');
 eq('actual registration identity, not guessed window field',projected.preparation.expected.registration_id,await one("select registration_id::text as v from public.employee_push_registrations where credential_id="+q(registered.get(request.employee_id).credential)+" and active"));
 eq('normal source registration projection is read-only',projected.dispatch_authorized,false);eq('normal source has no native delivery authority',projected.delivery_admitted,false);
 const counts=()=>one("select jsonb_build_object('sources',(select count(*) from public.employee_native_schedule_source_reservations),'markers',(select count(*) from public.employee_native_schedule_jobs),'jobs',(select count(*) from public.operational_notification_jobs),'attempts',(select count(*) from public.employee_native_schedule_dispatch_attempts),'outcomes',(select count(*) from public.employee_native_schedule_outcomes),'health',public.static_weekly_digest_text((select jsonb_agg(r order by registration_id)::text from public.employee_push_registrations r))) as v");
 const before=await counts();let race=false;
 const db={rpc:async(fn,a)=>{
  calls.push(fn);let expression;
  if(fn==='custodial_native_schedule_preparation_source')expression='public.custodial_native_schedule_preparation_source_at('+q(a.p_source)+','+q(a.p_employee)+','+q(a.p_generation)+','+q(at)+'::timestamptz)';
  else if(fn==='custodial_native_schedule_source_reserve')expression='public.custodial_native_schedule_source_reserve_at('+q(a.p_source_key)+','+q(a.p_employee_id)+','+q(a.p_generation_id)+','+q(a.p_expected_source_sha256)+','+q(a.p_operation_id)+','+q(at)+'::timestamptz)';
  else if(fn==='custodial_native_schedule_content_source')expression='public.custodial_native_schedule_content_source_at('+q(a.p_operation_id)+','+q(a.p_employee_id)+','+q(a.p_generation_id)+','+q(at)+'::timestamptz)';
  else if(fn==='custodial_native_schedule_job_prepare')expression='public.custodial_native_schedule_job_prepare_at('+q(a.p_source)+','+q(a.p_expected)+'::jsonb,'+q(a.p_operation)+','+q(at)+'::timestamptz)';
  else throw Error('unowned fixture RPC');
  const data=await one('select '+expression+' as v');
  if(race&&fn==='custodial_native_schedule_preparation_source')await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(registered.get(request.employee_id).credential));
  return{data};
 }};
 const sourceOperationId=randomUUID(),jobOperationId=randomUUID();
 const first=await prepareDiscoveredNativeScheduleJob({db,discovery,request,sourceOperationId,jobOperationId});
 eq('actual helper/SQL chain creates unqualified source job',first.status,'SOURCE_JOB_PREPARED_NATIVE_UNQUALIFIED');
 eq('typed private preparation calls',calls,['custodial_native_schedule_preparation_source','custodial_native_schedule_source_reserve','custodial_native_schedule_content_source','custodial_native_schedule_job_prepare']);
 eq('actual source operation retained',first.source_operation_id,sourceOperationId);eq('actual job operation retained',first.job.operation_id,jobOperationId);
 eq('prepared source/job never means sent',[first.dispatch_authorized,first.delivery_admitted,first.clock_effect_authority,first.retention_authority],[false,false,null,null]);
 const after=await counts();eq('exactly one original source/job marker and pending job',[after.sources-before.sources,after.markers-before.markers,after.jobs-before.jobs],[1,1,1]);
 eq('preparation creates no attempt/outcome/registration health',[after.attempts,after.outcomes,after.health],[before.attempts,before.outcomes,before.health]);
 calls.length=0;
 const repeat=await prepareDiscoveredNativeScheduleJob({db,discovery,request,sourceOperationId:randomUUID(),jobOperationId:randomUUID()});
 eq('new caller nonce retains original source operation',repeat.source_operation_id,sourceOperationId);eq('new caller nonce retains original job',repeat.job,first.job);eq('job replay explicitly marked',repeat.replayed,true);
 eq('retry creates no duplicate data',await counts(),after);
 calls.length=0;await sql('begin');race=true;
 let retired;try{retired=await prepareDiscoveredNativeScheduleJob({db,discovery,request,sourceOperationId:randomUUID(),jobOperationId:randomUUID()});}
 finally{race=false;await sql('rollback');}
 eq('revoke between read and write remains pending',retired.status,'SOURCE_JOB_PENDING');eq('actual stale cause',retired.reason,'TARGET_STALE');
 eq('stale race never proceeds to content/job',calls,['custodial_native_schedule_preparation_source','custodial_native_schedule_source_reserve']);
 eq('revocation-race transaction preserves all original source/job/health',await counts(),after);
 const wrapper='select public.custodial_native_schedule_preparation_source('+q(request.source_key)+','+q(request.employee_id)+','+q(request.generation_id)+') as v';
 const wrapperReply=await one('set role service_role;'+wrapper+';reset role;');eq('normal wrapper does not inherit fixture future clock',wrapperReply.status,'SOURCE_NOT_CURRENT');
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])await deny('projection wrapper denied '+role,'set role '+role+';'+wrapper);
 const privateCall='select public.custodial_native_schedule_preparation_source_at('+q(request.source_key)+','+q(request.employee_id)+','+q(request.generation_id)+','+q(at)+'::timestamptz) as v';
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823'])await deny('private fixture-time core denied '+role,'set role '+role+';'+privateCall);
 for(const identity of ['custodial_native_schedule_preparation_source(uuid,uuid,uuid)','custodial_native_schedule_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)'])for(const kind of ['function','grant']){
  const row=(await sql("select object_identity,definition_sql,definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind="+q(kind)+" and object_identity like '%custodial_native_schedule_preparation_source%' and to_regprocedure(object_identity)="+q('public.'+identity)+"::regprocedure")).rows;
  eq('one exact recovery '+kind+'/'+identity,row.length,1);
  const live=await one('select '+(kind==='function'?'pg_get_functiondef('+q('public.'+identity)+'::regprocedure)':'public.custodial_release_authority_current_grant_definition('+q(row[0].object_identity)+')')+' as v');
  eq('exact recovery definition '+kind+'/'+identity,row[0].definition_sql,live);eq('exact recovery hash '+kind+'/'+identity,row[0].definition_sha256,sha(live));
 }
 eq('no indirect send/job-finalization during role/read checks',await counts(),after);
 put('SQL_RECEIPT.json',{status:'PASS',checks,migration_count:247,actual_SQL_JS_helper_chain:true,source_operation_id:first.source_operation_id,job:first.job,
  original_retry_retained:true,actual_read_to_write_revocation_refused:true,source_only:true,fixture:'Official synthetic four-person recurring/lunch/native-generation fixture, private time-parametric SQL cores for controlled source time; not live staff/native clock qualification.',
  provider_dispatch:false,normal_producer_worker_activated:false,native_qualified:false,production:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,actual_SQL:true,migration_count:247,source_only:true,provider_dispatch:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
