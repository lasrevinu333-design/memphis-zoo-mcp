import {resolveNativeScheduleTarget} from '../src/native-schedule-dispatch.js';
import {validateNativeLocationInventoryResponse} from '../src/native-location-lifecycle.js';
import {validateNativeScheduleDispatch,prepareNativeScheduleAttempt,readNativeScheduleAttempt,recordNativeScheduleOutcome} from '../src/native-schedule-attempt-lifecycle.js';
import {prepareNativeScheduleJob} from '../src/native-schedule-job-preparation.js';
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
assert.equal(manifest.length,245);assert.equal(manifest.at(-1).file,'20261008124644_native_schedule_sender_inventory.sql');
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




 current='actual-target-inventory';
 const sourceId=first.reservation.reservation_id,recipient=sourceReport.window.recipient;
 const actor={assignment_epoch:String(recipient.assignment_epoch),credential_id:recipient.credential_id,device_id:recipient.device_identifier,
  employee_id:recipient.employee_id,generation_id:recipient.generation_id,principal_digest:recipient.principal_digest,
  registration_id:await one('select registration_id::text as v from public.employee_native_push_generations where generation_id='+q(ctx.generation)),token_digest:recipient.token_digest};
 const job=await one('select public.custodial_native_schedule_job_prepare_at('+q(sourceId)+','+q(actor)+'::jsonb,'+q(randomUUID())+','+q(at)+'::timestamptz) as v'),jobId=job.job.job_id,lease=randomUUID();
 await sql('update public.operational_notification_jobs set status=\'leased\',lease_token='+q(lease)+',leased_until='+q(dates.date+' 12:00 America/Chicago')+'::timestamptz where job_id='+q(jobId));
 const targetCall=(when=at,wlease=lease,jid=jobId)=>'select public.custodial_native_schedule_target_at('+[jid,wlease].map(q).join(',')+','+q(when)+'::timestamptz) as v';
 const publicTarget='select public.custodial_native_schedule_target('+[jobId,lease].map(q).join(',')+') as v';
 eq('public target clock cannot use future source',(await one('set role service_role;'+publicTarget+';reset role;')).current,false);
 eq('missing owned job marker unavailable',(await one(targetCall(at,lease,randomUUID()))).current,false);
 eq('wrong lease unavailable',(await one(targetCall(at,randomUUID()))).current,false);
 eq('expired source unavailable',(await one(targetCall(sourceReport.window.valid_until))).current,false);
 const target=await one(targetCall());eq('fresh actual target current',target.current,true);eq('native qualification not created',target.delivery_admitted,false);
 eq('actual bound actor',target.expected,actor);eq('actual target source candidate',target.source_candidate,expected);
 eq('actual registered token digest bound',sha(target.token),actor.token_digest);
 const resolved=await resolveNativeScheduleTarget({jobId,leaseToken:lease,sourceReservationId:sourceId,db:{rpc:async(name,args)=>{
  assert.equal(name,'custodial_native_schedule_target');assert.deepEqual(args,{p_job:jobId,p_lease:lease});return{data:await one(targetCall())};}}});
 eq('actual SQL-backed target adapter',{...resolved,token:'REDACTED_SYNTHETIC'},{current:true,delivery_admitted:false,expected:actor,token:'REDACTED_SYNTHETIC',sourceCandidate:expected});
 for(const [name,mutation] of [
  ['credential revoked','update public.device_auth_credentials set revoked_at=now() where credential_id='+q(actor.credential_id)],
  ['generation retired','update public.employee_native_push_generations set dispatch_retired_at=now() where generation_id='+q(actor.generation_id)],
  ['registration inactive','update public.employee_push_registrations set active=false where registration_id='+q(actor.registration_id)],
  ['job body override','update public.operational_notification_jobs set payload_json=payload_json||'+q({body:'caller override'})+'::jsonb where job_id='+q(jobId)]]){
  await sql('begin');try{await sql(mutation);eq('withdrawn target '+name,(await one(targetCall())).current,false);}finally{await sql('rollback');}
 }
 const finalize='select public.custodial_native_schedule_finalize_at('+[jobId,lease,sourceId].map(q).join(',')+','+q(actor)+'::jsonb,'+q(at)+'::timestamptz) as v';
 const finalized=await one(finalize),payload=finalized.payload;
 const dispatch='select public.custodial_native_schedule_dispatch_prepare_at('+[jobId,lease,sourceId].map(q).join(',')+','+q(actor)+'::jsonb,'+q(at)+'::timestamptz) as v';
 const permit=await one(dispatch),a=permit.attempt;eq('attempt consumes target lookup',(await one(targetCall())).current,false);
 const rows=(when=at,principal=actor.principal_digest,credential=actor.credential_id)=>'select coalesce(jsonb_agg(jsonb_build_object(\'payload\',payload,\'provider_outcome\',provider_outcome)),\'[]\'::jsonb) as v from public.custodial_native_location_inventory_rows('+q(credential)+','+q(principal)+','+q([ctx.generation])+'::jsonb,'+q(when)+'::timestamptz)';
 eq('original prepared inventory truthful',await one(rows()),[{payload,provider_outcome:'prepared'}]);
 const ev=outcome=>({operation_id:a.outcome_operation_id,outcome,provider_message_id:outcome==='provider_accepted'?'projects/synthetic/messages/original':null,error_code:outcome==='provider_accepted'?null:'synthetic_unknown'});
 const record=outcome=>'select public.custodial_native_schedule_outcome_at('+q(a.binding)+'::jsonb,'+q(ev(outcome))+'::jsonb,'+q(at)+'::timestamptz) as v';
 const hash=await one('select token_hash as v from public.device_auth_credentials where credential_id='+q(actor.credential_id));
 const request={schema:'custodial.native-provider-inventory-request.v1',scan_id:randomUUID(),principal_digest:actor.principal_digest,device_id:actor.device_id,
  credential_id:actor.credential_id,employee_id:actor.employee_id,assignment_epoch:Number(actor.assignment_epoch),generation_ids:[ctx.generation],limit:32,cursor:null,ceiling:null,server_now:null};
 const inventory=()=>one('select public.custodial_native_provider_inventory_clock_at('+[actor.credential_id,hash,randomUUID(),'d'.repeat(64)].map(q).join(',')+','+q(request)+'::jsonb,'+q(at)+'::timestamptz,'+q(at)+'::timestamptz) as v');
 for(const outcome of ['provider_accepted','delivery_outcome_unknown','known_nonacceptance']){
  await sql('begin');try{
   const receipt=await one(record(outcome));eq('original outcome records without delivery '+outcome,receipt.delivery_admitted,false);
   const want=outcome==='known_nonacceptance'?[]:[{payload,provider_outcome:outcome}];eq('typed inventory actual outcome '+outcome,await one(rows()),want);
   const result=await inventory();eq('actual bounded RPC outcome '+outcome,result.data.rows,want);
   eq('actual SQL matches integrated response parser '+outcome,validateNativeLocationInventoryResponse({ok:result.ok,data:result.data},request),{ok:result.ok,data:result.data});
   eq('original immutable outcome survives inventory omission '+outcome,(await one('select public.custodial_native_schedule_dispatch_status('+q(jobId)+') as v')).attempt.evidence,ev(outcome));
  }finally{await sql('rollback');}
 }
 await one(record('delivery_outcome_unknown'));
 eq('wrong principal sees no original',await one(rows(at,'e'.repeat(64))),[]);eq('wrong credential sees no original',await one(rows(at,actor.principal_digest,randomUUID())),[]);
 await sql('begin');try{
  await sql("update public.operational_notification_jobs set status='completed',lease_token=null,leased_until=null,completed_at=now() where job_id="+q(jobId));
  eq('transport terminal does not retire current business source',await one(rows()),[{payload,provider_outcome:'delivery_outcome_unknown'}]);
 }finally{await sql('rollback');}
 eq('source expiry removes active inventory',await one(rows(payload.valid_until)),[]);
 eq('source expiry retains original outcome',(await one('select public.custodial_native_schedule_dispatch_status('+q(jobId)+') as v')).attempt.evidence,ev('delivery_outcome_unknown'));
 await sql('begin');try{await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(actor.credential_id));
  eq('revoked actor absent from active inventory',await one(rows()),[]);eq('revocation retains original outcome',(await one('select public.custodial_native_schedule_dispatch_status('+q(jobId)+') as v')).attempt.evidence,ev('delivery_outcome_unknown'));
 }finally{await sql('rollback');}
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('private target clock denied '+role,'set role '+role+';'+targetCall());
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])await deny('public token target denied '+role,'set role '+role+';'+publicTarget);
 eq('service original consumed target stays unavailable',(await one('set role service_role;'+publicTarget+';reset role;')).current,false);
 for(const fn of ['custodial_native_schedule_target_at(uuid,uuid,timestamp with time zone)','custodial_native_schedule_target(uuid,uuid)',
  'custodial_native_location_inventory_rows(uuid,text,jsonb,timestamp with time zone)'])eq('exact function recovery '+fn,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)="+q('public.'+fn)+"::regprocedure and definition_sql=pg_get_functiondef("+q('public.'+fn)+"::regprocedure) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),1);
 eq('no actual handset or other provider outcomes',[await one('select count(*)::int as v from public.employee_native_provider_events'),await one('select count(*)::int as v from public.employee_native_location_outcomes')],[0,0]);
 put('SENDER_INVENTORY_READBACK.json',{actor,job,finalized,permit,target:{...target,token:'REDACTED_SYNTHETIC'},execution:'Actual isolated245SQL; private synthetic source/clock/token/outcome evidence. Actual source-backed target and bounded inventory JS validators. No send/clock/audio/native/phone qualification.',production:false,phone:false});
 put('SQL_RECEIPT.json',{status:'PASS',checks,migrations:manifest.length,actual_SQL:true,provider_delivery:false,native_qualified:false,phone:false});console.log(JSON.stringify({status:'PASS',checks,actual_SQL:true,provider_delivery:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
