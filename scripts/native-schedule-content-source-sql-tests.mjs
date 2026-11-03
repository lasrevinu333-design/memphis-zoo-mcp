import {buildNativeScheduleContentCandidate,prepareNativeScheduleContent} from '../src/native-schedule-delivery-preparation.js';
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
assert.equal(manifest.length,239);assert.equal(manifest.at(-1).file,'20261008083139_native_schedule_content_source.sql');
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

 current='actual-content-source';
 const ctx=registered.get(link.coverer_id),at=dates.date+' 09:46:00 America/Chicago',operation=randomUUID();
 const sourceReport=await one("select public.custodial_native_schedule_window_source_at("+[link.normal_occurrence_id,link.coverer_id,ctx.generation].map(q).join(',')+","+q(at)+"::timestamptz) as v");
 const context={sourceKey:link.normal_occurrence_id,employeeId:link.coverer_id,generationId:ctx.generation,expectedSourceSha256:sourceReport.window.server_source_sha256,operationId:operation};
 const reserve="select public.custodial_native_schedule_source_reserve_at("+[context.sourceKey,context.employeeId,context.generationId,context.expectedSourceSha256,operation].map(q).join(',')+","+q(at)+"::timestamptz) as v";
 const first=await one(reserve),contentCall=(when=at,person=link.coverer_id,generation=ctx.generation)=>"select public.custodial_native_schedule_content_source_at("+[operation,person,generation].map(q).join(',')+","+q(when)+"::timestamptz) as v";
 const content=await one(contentCall()),expected=buildNativeScheduleContentCandidate(first,context);
 eq('actual SQL content is current source only',content.status,'CONTENT_CURRENT_SOURCE_ONLY');
 eq('actual SQL original content exactly matches JavaScript candidate',content.candidate,expected);
 eq('personalized name from accepted availability',content.candidate.body.startsWith(sourceReport.window.employee_name+', '),true);
 eq('distinct SCHEDULE kind/notification/channel',[content.candidate.kind,content.candidate.notification_type,content.candidate.channel_id],['employee_schedule_ownership','schedule_ownership','employee-schedule-ownership']);
 eq('existing Schedule route',content.candidate.route,'employee-schedule.html?hub=employee');
 eq('no provider/native clock/token data invented',Object.hasOwn(content.candidate,'content_sha256')||Object.hasOwn(content.candidate,'receipt_job_id')||Object.hasOwn(content.candidate,'valid_until')||Object.hasOwn(content.candidate,'token'),false);
 eq('actual SQL delivery/send stay closed',[content.dispatch_authorized,content.delivery_admitted],[false,false]);
 const calls=[];
 const prepared=await prepareNativeScheduleContent({db:{rpc:async(name,args)=>{
  calls.push(name);
  if(name==='custodial_native_schedule_source_reserve'){eq('actual source operation bound',args.p_operation_id,operation);return{data:await one(reserve)};}
  assert.equal(name,'custodial_native_schedule_content_source');eq('actual content actor bound',[args.p_operation_id,args.p_employee_id,args.p_generation_id],[operation,context.employeeId,context.generationId]);
  return{data:await one(contentCall())};
 }},...context});
 eq('actual SQL-backed preparation follows exact two stages',calls,['custodial_native_schedule_source_reserve','custodial_native_schedule_content_source']);
 eq('SQL-backed prepared content byte/value agreement',prepared.candidate,expected);
 eq('SQL-backed preparation still unqualified',[prepared.status,prepared.dispatch_authorized,prepared.delivery_admitted,prepared.clock_effect_authority,prepared.retention_authority],['CONTENT_PREPARED_NATIVE_UNQUALIFIED',false,false,null,null]);
 const expired=await one(contentCall(sourceReport.window.valid_until));eq('expiry suppresses candidate',[expired.status,expired.candidate,expired.source_status.source_current],['CONTENT_SOURCE_UNAVAILABLE',null,false]);
 eq('expired original retained',expired.source_status.reservation,first.reservation);
 await sql('begin');try{
  await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(ctx.credential));
  eq('revocation suppresses content',(await one(contentCall())).candidate,null);
 }finally{await sql('rollback');}
 eq('wrong original actor does not produce content',(await one(contentCall(at,randomUUID()))).candidate,null);
 const publicCall="select public.custodial_native_schedule_content_source("+[operation,link.coverer_id,ctx.generation].map(q).join(',')+") as v";
 eq('service wrapper uses actual server time not fixture clock',(await one('set role service_role;'+publicCall+';reset role;')).candidate,null);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('timed content core denied '+role,'set role '+role+';'+contentCall());
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('content wrapper denied '+role,'set role '+role+';'+publicCall);
 for(const identity of ['custodial_native_schedule_content_source(uuid,uuid,uuid)','custodial_native_schedule_content_source_at(uuid,uuid,uuid,timestamptz)']){
  eq('exact content function recovery '+identity,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)="+q('public.'+identity)+"::regprocedure and definition_sql=pg_get_functiondef("+q('public.'+identity)+"::regprocedure)"),1);
 }
 eq('content canary bound',await one("select count(*)::int as v from public.custodial_release_canary_authority_surface() where object_identity='custodial_native_schedule_content_source(uuid,uuid,uuid)' and object_kind in ('function','grant')"),2);
 eq('inventory ALWAYS guard preserved',await one("select tgenabled::text as v from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'"),'A');
 eq('no provider jobs or delivery receipts created',[await one('select count(*)::int as v from public.operational_notification_jobs'),await one('select count(*)::int as v from public.employee_native_push_delivery_receipts')],[0,0]);
 eq('accepted schedule/lunch source unchanged',await one('select document_json as v from public.weekly_schedule_lunch_documents where projection_id='+q(projection)),document);
 put('CONTENT_SOURCE_READBACK.json',{first,content,prepared,expired,execution:'Actual isolated239SQL/private time seam through a modeled RPC transport, not public HTTP/live provider/native wire',production:false,phone:false});
 put('SQL_RECEIPT.json',{status:'PASS',checks,migrations:manifest.length,actual_sql:true,actual_JS_SQL_match:true,transport_simulated:true,dispatch_authorized:false,native_wire_admitted:false,production:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,sql_executed:true,delivery_admitted:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
