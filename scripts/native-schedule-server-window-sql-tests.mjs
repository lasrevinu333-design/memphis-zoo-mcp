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
assert.equal(manifest.length,237);assert.equal(manifest.at(-1).file,'20261008064748_native_schedule_server_source_window.sql');
try{
 let ready=0;
 for(let n=0;n<40;n++){
  const next=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:500,query_timeout:30000});next.on('error',()=>{});
  try{await next.connect();assert.equal((await next.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin')")).rows[0].n,4);
   if(++ready===4){c=next;break;}await next.end();}catch{ready=0;await next.end().catch(()=>{});}await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(c);step('READY');await sql(remove);
 for(const [i,row] of manifest.entries()){
  current=row.file;assert.equal(await one(absent),0,'before '+current);const bytes=readFileSync('supabase/migrations/'+current);assert.equal(sha(bytes),row.sha256);await sql(bytes.toString());
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

 const ctx=registered.get(link.coverer_id),at=dates.date+' 09:46:00 America/Chicago';
 const call=(when=at,person=link.coverer_id,key=link.normal_occurrence_id)=>
  "select public.custodial_native_schedule_window_source_at("+q(key)+","+q(person)+","+q(registered.get(person).generation)+","+q(when)+"::timestamptz) as v";
 const canonical=async time=>one("select replace(to_char(("+q(dates.date+" "+time)+"::timestamp at time zone 'America/Chicago') at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US'),' ','T')||'Z' as v");
 const target=await one("select public.custodial_native_target_source_at('SCHEDULE',"+q(link.normal_occurrence_id)+","+q(link.coverer_id)+","+q(ctx.generation)+","+q(at)+"::timestamptz) as v");
 const snapshot=await one(nativeScheduleSnapshotSql(dates.date).replace(/ as data$/,' as v'));
 const input={request:{sourceKey:link.normal_occurrence_id,employeeId:link.coverer_id,generationId:ctx.generation,serviceDate:dates.date},snapshot,targetBefore:target,targetAfter:structuredClone(target)};
 const sourceReport=deriveNativeScheduleOccurrence(input),candidate=deriveNativeScheduleValiditySource(input);
 const from=await canonical('09:45:00'),until=await canonical(candidate.source_window.valid_until_local);
 const reply=await one(call());
 eq('actual in-window source state',reply.status,'CURRENT_WINDOW_SOURCE_ONLY');
 eq('SQL-derived start equals exact Chicago boundary',reply.window.valid_from,from);
 eq('SQL-derived accepted next recipient source edge',reply.window.valid_until,until);
 eq('exact accepted recipient',reply.window.employee_id,link.coverer_id);
 eq('exact accepted recipient name',reply.window.employee_name,slots.find(s=>s.person===link.coverer_id).name);
 eq('source clock is never native effect admission',reply.clock_effect_authority,null);
 eq('retention not inferred',reply.retention_authority,null);
 eq('delivery not inferred',reply.delivery_admitted,false);eq('dispatch not inferred',reply.dispatch_authorized,false);
 eq('stable one-episode key',reply.window.logical_key,'schedule-ownership:'+dates.date+':'+link.coverer_id+':09:45');
 eq('exact lower boundary accepted',(await one(call(dates.date+' 09:45:00 America/Chicago'))).status,'CURRENT_WINDOW_SOURCE_ONLY');
 eq('just before lower bound is not current',(await one(call(dates.date+' 09:44:59.999999 America/Chicago'))).status,'WINDOW_NOT_STARTED');
 eq('exact upper boundary expires',(await one(call(until))).status,'SOURCE_WINDOW_EXPIRED');
 eq('source identity stable across read clock',(await one(call(dates.date+' 09:47:00 America/Chicago'))).window.server_source_sha256,reply.window.server_source_sha256);
 const publicCall="select public.custodial_native_schedule_window_source("+q(link.normal_occurrence_id)+","+q(link.coverer_id)+","+q(ctx.generation)+") as v";
 eq('public wrapper owns actual server time',(await one('set role service_role;'+publicCall+';reset role;')).status,'WINDOW_NOT_STARTED');
 eq('JS source and real SQL agree before',sourceReport.occurrence.before_units,reply.window.before_units);
 eq('JS source and real SQL agree after',sourceReport.occurrence.after_units,reply.window.after_units);
 eq('actual source supplies a bounded future edge',candidate.source_window.valid_until_local>'09:45:00.000000',true);
 eq('private current projection',reply.window.projection_id,projection);
 for(const [day,expected] of [['2027-03-14','2027-03-14T14:45:00.000000Z'],['2027-11-07','2027-11-07T15:45:00.000000Z']])
  eq('actual PostgreSQL Chicago calendar conversion '+day,await one("select replace(to_char(((date "+q(day)+"+time '09:45') at time zone 'America/Chicago') at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US'),' ','T')||'Z' as v"),expected);
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('window wrapper denied '+role,'set role '+role+';'+publicCall);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('clock-parametric window core private '+role,'set role '+role+';'+call());
 eq('unknown anchor unavailable',(await one(call(at,link.coverer_id,randomUUID()))).status,'SOURCE_STALE');
 eq('revoked credential refuses source window',(await one('begin;update public.device_auth_credentials set revoked_at=now() where credential_id='+q(ctx.credential)+';'+call()+';rollback;')).status,'TARGET_STALE');
 eq('short credential caps absolute window',(await one('begin;update public.device_auth_credentials set expires_at='+q(dates.date+' 09:55:00 America/Chicago')+'::timestamptz where credential_id='+q(ctx.credential)+';'+call()+';rollback;')).window.valid_until,await canonical('09:55:00'));
 for(const identity of ['custodial_native_schedule_window_source(uuid,uuid,uuid)','custodial_native_schedule_window_source_at(uuid,uuid,uuid,timestamptz)']){
  eq('exact window function recovery '+identity,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)="+q('public.'+identity)+"::regprocedure and definition_sql=pg_get_functiondef("+q('public.'+identity)+"::regprocedure) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),1);
  eq('exact window grant recovery '+identity,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='grant' and case when object_identity like 'custodial_native_schedule_window_source%' or object_identity like 'public.custodial_native_schedule_window_source%' then to_regprocedure(object_identity) else null end="+q('public.'+identity)+"::regprocedure and definition_sql=public.custodial_release_authority_current_grant_definition(object_identity)"),1);
 }
 eq('new wrapper in canary',await one("select count(*)::int as v from public.custodial_release_canary_authority_surface() where object_kind='function' and object_identity='custodial_native_schedule_window_source(uuid,uuid,uuid)'"),1);
 eq('ALWAYS guard preserved',await one("select tgenabled::text as v from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'"),'A');
 eq('no automatic table/sequence grants after fixture',await one(absent),0);
 put('SQL_RECEIPT.json',{status:'PASS',checks,migration_count:237,migration_sha256:manifest.at(-1).sha256,
  source_state:reply.status,valid_from:reply.window.valid_from,valid_until:reply.window.valid_until,
  server_source_sha256:reply.window.server_source_sha256,actual_JS_and_SQL_agree:true,calendar_conversion_executed:true,
  fixture:'Official accepted synthetic publication/lunch/person/generation; actual PostgreSQL and source JS, not live six or phone',
  delivery_admitted:false,clock_effect_admitted:false,retention_or_reservation:false,production:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,sql_executed:true,migration_count:237,delivery_admitted:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
