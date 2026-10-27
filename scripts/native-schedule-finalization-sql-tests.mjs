import {validateNativeSchedulePayload,nativeScheduleRecordId,NATIVE_SCHEDULE_PAYLOAD_KEYS} from '../src/native-schedule-payload.js';
import {canonicalNativeLocation} from '../src/native-location-reservation.js';
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
assert.equal(manifest.length,240);assert.equal(manifest.at(-1).file,'20261008095837_native_schedule_server_finalization.sql');
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

 current='actual-finalization';
 const job=randomUUID(),lease=randomUUID(),sourceId=first.reservation.reservation_id;
 const recipient=sourceReport.window.recipient;
 const actor={assignment_epoch:String(recipient.assignment_epoch),credential_id:recipient.credential_id,device_id:recipient.device_identifier,
  employee_id:recipient.employee_id,generation_id:recipient.generation_id,principal_digest:recipient.principal_digest,
  registration_id:await one('select registration_id::text as v from public.employee_native_push_generations where generation_id='+q(ctx.generation)),token_digest:recipient.token_digest};
 const jobPayload={credential_id:actor.credential_id,device_id:recipient.device_id,device_identifier:actor.device_id,employee_id:actor.employee_id,
  assignment_epoch:actor.assignment_epoch,data_json:{kind:'employee_schedule_ownership',source_reservation_id:sourceId}};
 const jobKey='employee-schedule-push:'+sourceId+':'+actor.credential_id;
 await sql('insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,status,lease_token,leased_until,payload_json) values('
  +[job,jobKey,'employee_native_push',sourceId,'leased',lease].map(q).join(',')+','+q(dates.date+' 12:00 America/Chicago')+'::timestamptz,'+q(jobPayload)+'::jsonb)');
 const finalizeCall=(when=at,want=actor,id=job,token=lease,sid=sourceId)=>'select public.custodial_native_schedule_finalize_at('
  +[id,token,sid].map(q).join(',')+','+q(want)+'::jsonb,'+q(when)+'::timestamptz) as v';
 const publicFinalize='select public.custodial_native_schedule_finalize('+[job,lease,sourceId].map(q).join(',')+','+q(actor)+'::jsonb) as v';
 const stateCount=()=>one('select count(*)::int as v from public.employee_native_schedule_finalizations');
 eq('fresh public wrapper uses actual server time', (await one('set role service_role;'+publicFinalize+';reset role;')).finalized,false);
 eq('missing original source refuses without receipt',(await one(finalizeCall(at,actor,job,lease,randomUUID()))).finalized,false);
 for(const [field,value] of [['token_digest','d'.repeat(64)],['principal_digest','d'.repeat(64)],['assignment_epoch','2'],['registration_id',randomUUID()],['employee_id',randomUUID()]])
  eq('current actor mismatch refuses '+field,(await one(finalizeCall(at,{...actor,[field]:value}))).finalized,false);
 eq('wrong lease refuses',(await one(finalizeCall(at,actor,job,randomUUID()))).finalized,false);
 eq('expired original source refuses',(await one(finalizeCall(sourceReport.window.valid_until))).finalized,false);
 for(const [name,mutation] of [
  ['job key','update public.operational_notification_jobs set job_key='+q(jobKey+':incorrect')+' where job_id='+q(job)],
  ['extra data','update public.operational_notification_jobs set payload_json=payload_json||'+q({body:'caller override'})+'::jsonb where job_id='+q(job)],
  ['lease expired','update public.operational_notification_jobs set leased_until='+q(at)+'::timestamptz where job_id='+q(job)],
  ['credential revoked','update public.device_auth_credentials set revoked_at=now() where credential_id='+q(ctx.credential)],
  ['generation retired','update public.employee_native_push_generations set dispatch_retired_at=now() where generation_id='+q(ctx.generation)]]){
  await sql('begin');try{await sql(mutation);eq('fresh '+name+' refuses',(await one(finalizeCall())).finalized,false);}finally{await sql('rollback');}
 }
 eq('all rejected requests created no receipt',await stateCount(),0);
 // Two real PostgreSQL sessions contend for the same source/job. Neither
 // caller owns provider permission; exactly one final receipt survives.
 const c2=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:500,query_timeout:5000});
 await c2.connect();let reports;try{reports=await Promise.all([one(finalizeCall()),c2.query(finalizeCall(at.replace('09:46:00','09:46:01'))).then(x=>x.rows[0].v)]);}finally{await c2.end();}
 const finalized=reports.find(x=>x.replayed===false),replayed=reports.find(x=>x.replayed===true);assert.ok(finalized&&replayed);
 eq('two-session race stores one finalization',await stateCount(),1);
 eq('race retains original exact payload',finalized.payload,replayed.payload);
 eq('first finalization still unqualified',[finalized.status,finalized.dispatch_authorized,finalized.delivery_admitted],['FINALIZED_NATIVE_UNQUALIFIED',false,false]);
 const validated=validateNativeSchedulePayload(finalized.payload,{jobId:job,expected:actor,sourceCandidate:expected});
 eq('actual SQL wire validates through paired JavaScript parser',validated,finalized.payload);
 eq('actual SQL and JavaScript canonical wire exact',finalized.wire,canonicalNativeLocation(validated));
 eq('closed wire has exact32 fields',Object.keys(validated).sort(),NATIVE_SCHEDULE_PAYLOAD_KEYS);
 eq('original valid-until not reduced to transport lease',validated.valid_until,first.reservation.window.valid_until);
 eq('stable native identity uses original source',nativeScheduleRecordId(validated),sha(ctx.generation+'\n'+sourceId+'\n'+validated.notification_key));
 eq('repeat original does not send',(await one(finalizeCall())).dispatch_authorized,false);
 eq('expired original readback preserved',(await one(finalizeCall(sourceReport.window.valid_until))).payload,finalized.payload);
 eq('second job cannot consume original source',(await one(finalizeCall(at,actor,randomUUID()))).status,'ORIGINAL_FINALIZATION_CONFLICT');
 eq('different retry lease cannot rebind original',(await one(finalizeCall(at,actor,job,randomUUID()))).status,'ORIGINAL_FINALIZATION_CONFLICT');
 const statusCall=(person=actor.employee_id)=>'select public.custodial_native_schedule_finalization_status('+[sourceId,person,ctx.generation].map(q).join(',')+') as v';
 eq('service original status exact',(await one('set role service_role;'+statusCall()+';reset role;')).payload,finalized.payload);
 eq('wrong original status actor hidden',(await one(statusCall(randomUUID()))).payload,null);
 await sql('begin');try{
  await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(ctx.credential));
  eq('original stays readable after revocation',(await one(finalizeCall())).payload,finalized.payload);
  eq('readable original still no send',(await one(finalizeCall())).dispatch_authorized,false);
 }finally{await sql('rollback');}
 const bindingCall=(p=validated,until=validated.valid_until)=>'select public.custodial_native_schedule_receipt_binding('+q(p)+'::jsonb,'
  +[job,sourceId,actor.credential_id].map(q).join(',')+',1,'+[ctx.generation,actor.token_digest,validated.reservation_at,until,p.content_sha256].map(q).join(',')+') as v';
 eq('SQL closed receipt guard accepts actual wire',await one(bindingCall()),true);
 for(const [name,change] of [
  ['extra field',{debug:'no'}],['missing field',{body:undefined}],['wrong route',{route:'messages.html?hub=employee'}],
  ['wrong kind',{kind:'employee_message'}],['wrong employee',{receipt_employee_id:randomUUID()}],
  ['wrong source',{source_reservation_id:randomUUID()}],['wrong boundary',{source_valid_from:validated.source_valid_from.replace('45:00','44:00')}],
  ['non-string',{source_revision:3}],['bad calendar',{source_valid_from:'2026-02-30T15:45:00.000000Z'}]]){
  const mutant={...validated,...change};for(const [k,v] of Object.entries(mutant))if(v===undefined)delete mutant[k];
  if(Object.values(mutant).every(x=>typeof x==='string'))mutant.content_sha256=sha(canonicalNativeLocation(mutant,{excludeHash:true}));
  const result=await one(bindingCall(mutant));
  eq('SQL closed guard '+name,result,false);
 }
 async function rejects(name,text,code){await sql('begin');let error;try{await sql(text);}catch(e){error=e;}finally{await sql('rollback');}
  eq(name,error?.code,code);}
 await rejects('immutable finalization update','update public.employee_native_schedule_finalizations set content_sha256=repeat(\'d\',64)', '23514');
 await rejects('immutable finalization delete','delete from public.employee_native_schedule_finalizations','23514');
 await rejects('native wire receipt immutable','update public.employee_native_push_delivery_receipts set native_payload=native_payload||'+q({body:'rewritten'})+'::jsonb','23514');
 const binding={receipt_job_id:job,lease_token:lease,registration_id:actor.registration_id,generation_id:ctx.generation,
  reservation_at:validated.reservation_at,content_sha256:validated.content_sha256,token_digest:actor.token_digest,principal_digest:actor.principal_digest,
  receipt_credential_id:actor.credential_id,receipt_assignment_epoch:actor.assignment_epoch,receipt_employee_id:actor.employee_id,receipt_device_id:actor.device_id};
 const fabricated={operation_id:randomUUID(),outcome:'provider_accepted',provider_message_id:'not-a-real-provider-receipt',error_code:null};
 await deny('unqualified SCHEDULE cannot record provider acceptance','set role service_role;select public.custodial_native_location_outcome('+q(binding)+'::jsonb,'+q(fabricated)+'::jsonb)');
 eq('no provider outcomes or attempts fabricated',await one('select count(*)::int as v from public.employee_native_location_outcomes'),0);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  await deny('private time seam denied '+role,'set role '+role+';'+finalizeCall());
  await deny('direct finalization SELECT denied '+role,'set role '+role+';select * from public.employee_native_schedule_finalizations');
  await deny('direct finalization INSERT denied '+role,'set role '+role+';insert into public.employee_native_schedule_finalizations select * from public.employee_native_schedule_finalizations where false');
 }
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  await deny('public finalize denied '+role,'set role '+role+';'+publicFinalize);
  await deny('original status denied '+role,'set role '+role+';'+statusCall());
 }
 eq('one original wire persisted',await one('select count(*)::int as v from public.employee_native_push_delivery_receipts'),1);
 const functions=['custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone,timestamp with time zone,text)',
  'custodial_native_schedule_finalization_guard()','custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamp with time zone)',
  'custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)','custodial_native_schedule_finalization_status(uuid,uuid,uuid)',
  'custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)'];
 for(const f of functions)eq('exact function/recovery '+f,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)="+q('public.'+f)+"::regprocedure and definition_sql=pg_get_functiondef("+q('public.'+f)+"::regprocedure) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),1);
 eq('exact shared constraint recovery',await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='constraint' and object_identity='public.employee_native_push_delivery_receipts:native_location_payload_binding' and definition_sql=public.custodial_release_authority_current_constraint_definition(object_identity)"),1);
 eq('new table FORCE RLS no policies',await one("select jsonb_build_array(relrowsecurity,relforcerowsecurity,(select count(*) from pg_policy where polrelid=c.oid)) as v from pg_class c where oid='public.employee_native_schedule_finalizations'::regclass"),[true,true,0]);
 eq('ALWAYS finalization guard and restore fence',await one("select jsonb_object_agg(tgname,tgenabled::text) as v from pg_trigger where tgrelid='public.employee_native_schedule_finalizations'::regclass and not tgisinternal"),{trg_native_schedule_finalization_guard:'A',custodial_disaster_restore_mutation_fence:'O'});
 eq('unrelated accepted lunch unchanged',await one('select document_json as v from public.weekly_schedule_lunch_documents where projection_id='+q(projection)),document);
 put('FINALIZATION_READBACK.json',{first,content,actor,job,lease,finalized,replayed,validated,native_record_id:nativeScheduleRecordId(validated),execution:'Actual isolated240SQL with synthetic accepted source/current recipient/job. No provider or native qualification.',production:false,phone:false});
 put('SQL_RECEIPT.json',{status:'PASS',checks,migrations:manifest.length,actual_sql:true,actual_JS_SQL_wire_match:true,provider_dispatch:false,native_wire_admitted:false,production:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,sql_executed:true,delivery_admitted:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
