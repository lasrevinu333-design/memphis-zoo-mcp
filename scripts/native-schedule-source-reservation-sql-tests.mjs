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
assert.equal(manifest.length,238);assert.equal(manifest.at(-1).file,'20261008075109_native_schedule_source_reservation.sql');
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

 current='actual-source-reservation';
 const ctx=registered.get(link.coverer_id),at=dates.date+' 09:46:00 America/Chicago';
 const operation=randomUUID(),sourceCall=when=>"select public.custodial_native_schedule_window_source_at("+q(link.normal_occurrence_id)+","+q(link.coverer_id)+","+q(ctx.generation)+","+q(when)+"::timestamptz) as v";
 const window=(await one(sourceCall(at))).window;assert.ok(window);
 const reserve=(op=operation,digest=window.server_source_sha256,when=at,person=link.coverer_id,generation=ctx.generation)=>
  "select public.custodial_native_schedule_source_reserve_at("+[link.normal_occurrence_id,person,generation,digest,op].map(q).join(',')+","+q(when)+"::timestamptz) as v";
 const status=(when=at,op=operation,person=link.coverer_id,generation=ctx.generation)=>
  "select public.custodial_native_schedule_source_status_at("+[op,person,generation].map(q).join(',')+","+q(when)+"::timestamptz) as v";
 const count=()=>one('select count(*)::int as v from public.employee_native_schedule_source_reservations');
 eq('initial source originals empty',await count(),0);
 const publicReserve="select public.custodial_native_schedule_source_reserve("+[link.normal_occurrence_id,link.coverer_id,ctx.generation,window.server_source_sha256,operation].map(q).join(',')+") as v";
 eq('public wrapper uses actual clock, not caller future time',(await one('set role service_role;'+publicReserve+';reset role;')).status,'WINDOW_NOT_STARTED');
 eq('early public request creates no original',await count(),0);
 const first=await one(reserve());
 eq('first persisted source status',first.status,'SOURCE_RESERVED_NATIVE_UNQUALIFIED');eq('first original exists',first.reserved,true);eq('first is not replay',first.replayed,false);
 eq('no source reservation delivery/send/clock/retention authority',[first.dispatch_authorized,first.delivery_admitted,first.clock_effect_authority,first.retention_authority],[false,false,null,null]);
 eq('exact accepted source window persisted',first.reservation.window,window);
 eq('original caller operation persisted',first.reservation.operation_id,operation);
 eq('one original per employee/day',await count(),1);
 const replay=await one(reserve(operation,window.server_source_sha256,dates.date+' 09:47:00 America/Chicago'));
 eq('repeat original source is replay',replay.replayed,true);eq('exact original bytes/timestamp on replay',replay.reservation,first.reservation);
 const alias=await one(reserve(randomUUID()));eq('new operation cannot create second episode',alias.reservation,first.reservation);eq('original operation retained, alias not invented',alias.replayed,true);
 // Two real independent PostgreSQL sessions race under unchanged publication
 // lock order; neither gets a send permission or a second source original.
 const peer=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:1000,query_timeout:5000});
 try{await peer.connect();const values=await Promise.all([one(reserve(randomUUID())),peer.query(reserve(randomUUID())).then(r=>r.rows[0].v)]);
  eq('concurrent attempts converge to original record',values.map(v=>v.reservation),[first.reservation,first.reservation]);
 }finally{await peer.end().catch(()=>{});}
 eq('race creates no duplicate',await count(),1);
 eq('wrong expected source digest refused',(await one(reserve(randomUUID(),'f'.repeat(64)))).status,'SOURCE_CHANGED');
 eq('digest refusal leaves original bytes',(await one(status())).reservation,first.reservation);
 eq('current original status truthful',(await one(status())).source_current,true);
 eq('source cutoff refuses a new reservation',(await one(reserve(randomUUID(),window.server_source_sha256,window.valid_until))).status,'SOURCE_WINDOW_EXPIRED');
 const expired=await one(status(window.valid_until));eq('expired original retained exactly',expired.reservation,first.reservation);eq('expired not current/deliverable',[expired.source_current,expired.dispatch_authorized,expired.delivery_admitted],[false,false,false]);
 eq('wrong original principal not readable',(await one(status(at,operation,randomUUID()))).status,'ORIGINAL_NOT_FOUND');
 await sql('begin');try{
  await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(ctx.credential));
  eq('revocation blocks new source reservation',(await one(reserve(randomUUID()))).status,'TARGET_STALE');
  const retired=await one(status());eq('revoked original not current',retired.source_current,false);eq('revocation preserves exact original',retired.reservation,first.reservation);
 }finally{await sql('rollback');}
 await sql('begin');try{
  await sql('update public.device_auth_credentials set expires_at='+q(dates.date+' 09:55:00 America/Chicago')+'::timestamptz where credential_id='+q(ctx.credential));
  const changed=await one(sourceCall(at));assert.notEqual(changed.window.server_source_sha256,window.server_source_sha256);
  eq('changed accepted source cannot overwrite earlier episode',(await one(reserve(randomUUID(),changed.window.server_source_sha256))).status,'ORIGINAL_SOURCE_CONFLICT');
  eq('changed source original status not current',(await one(status())).source_current,false);
  eq('changed source retains original bytes',(await one(status())).reservation,first.reservation);
 }finally{await sql('rollback');}
 for(const [label,statement] of [['update','update public.employee_native_schedule_source_reservations set source_window=source_window'],['delete','delete from public.employee_native_schedule_source_reservations']]){
  await sql('begin');let error;try{await sql(statement);}catch(e){error=e;}finally{await sql('rollback');}
  eq('original refuses '+label,error?.code,'23514');
 }
 const roles=['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'];
 for(const role of roles){
  await deny('private timed reserve denied '+role,'set role '+role+';'+reserve());
  await deny('private timed status denied '+role,'set role '+role+';'+status());
  await deny('direct table read denied '+role,'set role '+role+';select * from public.employee_native_schedule_source_reservations');
 }
 for(const role of roles.filter(x=>x!=='service_role')){
  await deny('public reserve denied '+role,'set role '+role+';'+publicReserve);
  await deny('public status denied '+role,'set role '+role+';select public.custodial_native_schedule_source_status('+[operation,link.coverer_id,ctx.generation].map(q).join(',')+')');
 }
 eq('public service status current clock preserves expired/future original',(await one('set role service_role;select public.custodial_native_schedule_source_status('+[operation,link.coverer_id,ctx.generation].map(q).join(',')+') as v;reset role;')).reservation,first.reservation);
 eq('FORCE RLS and no runtime policies',await one("select jsonb_build_array(c.relrowsecurity,c.relforcerowsecurity,(select count(*) from pg_policy where polrelid=c.oid)) as v from pg_class c where c.oid='public.employee_native_schedule_source_reservations'::regclass"),[true,true,0]);
 eq('immutable ALWAYS guard',await one("select tgenabled::text as v from pg_trigger where tgrelid='public.employee_native_schedule_source_reservations'::regclass and tgname='trg_native_schedule_source_immutable'"),'A');
 const recovery=(await sql("select object_kind,object_identity,definition_sql,definition_sha256 from public.custodial_release_authority_restore_inventory where object_identity like '%employee_native_schedule_source_reservations%' or object_identity like '%custodial_native_schedule_source_%' order by restore_order")).rows;
 eq('complete recovery closure recorded',recovery.length>=30,true);
 eq('all recovery definitions have exact digest',await one("select bool_and(definition_sha256=public.static_weekly_digest_text(definition_sql)) as v from public.custodial_release_authority_restore_inventory where object_identity like '%employee_native_schedule_source_reservations%' or object_identity like '%custodial_native_schedule_source_%'"),true);
 for(const name of ['custodial_native_schedule_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamptz)','custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)','custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamptz)','custodial_native_schedule_source_status(uuid,uuid,uuid)'])
  eq('current function recovery '+name,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)="+q('public.'+name)+"::regprocedure and definition_sql=pg_get_functiondef("+q('public.'+name)+"::regprocedure)"),1);
 await sql('begin');try{
  const entry=recovery.find(x=>x.object_kind==='function'&&x.object_identity.includes('custodial_native_schedule_source_status_at('));assert.ok(entry);
  await sql('drop function public.custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamptz)');
  await sql(entry.definition_sql);
  const grant=recovery.find(x=>x.object_kind==='grant'&&x.object_identity===entry.object_identity);assert.ok(grant);await sql(grant.definition_sql);
  eq('actual private status function recovery preserves original',(await one(status())).reservation,first.reservation);
  let denied;try{await sql('set role service_role;'+status());}catch(e){denied=e;}
  eq('recovered private status remains service-denied',denied?.code,'42501');
 }finally{await sql('rollback');}
 eq('no jobs/receipts or provider attempts created',[await one('select count(*)::int as v from public.operational_notification_jobs'),await one('select count(*)::int as v from public.employee_native_push_delivery_receipts'),await one('select count(*)::int as v from public.employee_native_lunch_dispatch_attempts')],[0,0,0]);
 eq('accepted schedule/lunch document unchanged',await one('select document_json as v from public.weekly_schedule_lunch_documents where projection_id='+q(projection)),document);
 eq('one source original still present after refusals/recovery',await count(),1);
 eq('no auto table/sequence grants',await one(absent),0);
 put('SOURCE_RESERVATION_READBACK.json',{first,replay,expired,recovery_inventory:recovery.map(({definition_sql,...r})=>r),production:false,dispatch:false,clock_effect:false,phone:false});
 put('SQL_RECEIPT.json',{status:'PASS',checks,migrations:manifest.length,fixture:'Official accepted synthetic publication, actualSQL and two-session concurrency; notlive six',source_only:true,delivery_or_retention_admission:false,production:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,sql_executed:true,source_only:true}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
