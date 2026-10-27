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
assert.equal(manifest.length,244);assert.equal(manifest.at(-1).file,'20261008122247_native_schedule_attempt_outcome.sql');
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



 current='actual-single-attempt';
 const sourceId=first.reservation.reservation_id,recipient=sourceReport.window.recipient;
 const actor={assignment_epoch:String(recipient.assignment_epoch),credential_id:recipient.credential_id,device_id:recipient.device_identifier,
  employee_id:recipient.employee_id,generation_id:recipient.generation_id,principal_digest:recipient.principal_digest,
  registration_id:await one('select registration_id::text as v from public.employee_native_push_generations where generation_id='+q(ctx.generation)),token_digest:recipient.token_digest};
 const job=await one('select public.custodial_native_schedule_job_prepare_at('+q(sourceId)+','+q(actor)+'::jsonb,'+q(randomUUID())+','+q(at)+'::timestamptz) as v'),jobId=job.job.job_id,lease=randomUUID();
 await sql('update public.operational_notification_jobs set status=\'leased\',lease_token='+q(lease)+',leased_until='+q(dates.date+' 12:00 America/Chicago')+'::timestamptz where job_id='+q(jobId));
 const fcall='select public.custodial_native_schedule_finalize_at('+[jobId,lease,sourceId].map(q).join(',')+','+q(actor)+'::jsonb,'+q(at)+'::timestamptz) as v';
 await one(fcall);
 const later=dates.date+' 09:47:00.999999 America/Chicago';
 const call=(when=later,want=actor,wlease=lease,sid=sourceId)=>'select public.custodial_native_schedule_dispatch_prepare_at('+[jobId,wlease,sid].map(q).join(',')+','+q(want)+'::jsonb,'+q(when)+'::timestamptz) as v';
 const publicPrepare='select public.custodial_native_schedule_dispatch_prepare('+[jobId,lease,sourceId].map(q).join(',')+','+q(actor)+'::jsonb) as v';
 eq('public clock cannot use tomorrow original',[...(Object.values(await one('set role service_role;'+publicPrepare+';reset role;')).filter(x=>typeof x==='boolean'))],[false,false,false]);
 eq('wrong actor refuses',(await one(call(later,{...actor,assignment_epoch:'2'}))).dispatch_authorized,false);
 eq('wrong lease refuses',(await one(call(later,actor,randomUUID()))).dispatch_authorized,false);
 eq('wrong source refuses',(await one(call(later,actor,lease,randomUUID()))).dispatch_authorized,false);
 eq('expired source refuses',(await one(call(sourceReport.window.valid_until))).dispatch_authorized,false);
 eq('refusals leave zero attempts',await one('select count(*)::int as v from public.employee_native_schedule_dispatch_attempts'),0);
 const c2=new pg.Client({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',connectionTimeoutMillis:500,query_timeout:5000});await c2.connect();
 let pair;try{pair=await Promise.all([one(call()),c2.query(call()).then(x=>x.rows[0].v)]);}finally{await c2.end();}
 const fresh=pair.find(x=>x.dispatch_authorized),replay=pair.find(x=>!x.dispatch_authorized);assert.ok(fresh&&replay);
 eq('competing sessions produce one attempt',await one('select count(*)::int as v from public.employee_native_schedule_dispatch_attempts'),1);
 eq('competing retry read-only',[replay.replayed,replay.reason,replay.attempt],[true,'ORIGINAL_ATTEMPT_RETAINED',null]);
 eq('native admission is still false',fresh.delivery_admitted,false);
 const permit=validateNativeScheduleDispatch(fresh,{jobId,leaseToken:lease,sourceReservationId:sourceId,expected:actor,sourceCandidate:expected});
 const a=permit.attempt,b=a.binding;
 const remaining=Number((Date.parse(a.payload.valid_until)-Date.parse(a.attempt_reserved_at))/1000);
 eq('TTL uses fresh attempted instant',a.ttl_seconds,Math.floor(remaining));
 eq('attempt uses distinct original operation',a.attempt_id===a.outcome_operation_id,false);
 eq('expiry retry cannot send',(await one(call(sourceReport.window.valid_until))).reason,'ORIGINAL_ATTEMPT_RETAINED');
 const statusCall='select public.custodial_native_schedule_dispatch_status('+q(jobId)+') as v';
 const db={rpc:async(name,args)=>{
  if(name==='custodial_native_schedule_dispatch_status')return{data:await one('set role service_role;'+statusCall+';reset role;')};
  if(name==='custodial_native_schedule_dispatch_prepare')return{data:await one(publicPrepare)};
  throw Error('unexpected RPC');}};
 const originalStatus=await readNativeScheduleAttempt({db,jobId});eq('actual adapter status prepared not accepted',originalStatus.attempt.provider_outcome,'prepared');
 eq('actual public replay no second permission',(await prepareNativeScheduleAttempt({db,jobId,leaseToken:lease,sourceReservationId:sourceId,expected:actor,sourceCandidate:expected})).dispatch_authorized,false);
 async function rejects(name,text,code){await sql('begin');let error;try{await sql(text);}catch(e){error=e;}finally{await sql('rollback');}eq(name,error?.code,code);}
 const ev=outcome=>({operation_id:a.outcome_operation_id,outcome,provider_message_id:outcome==='provider_accepted'?'projects/synthetic/messages/original':null,error_code:outcome==='provider_accepted'?null:'synthetic_unknown'});
 const record=(e=ev('delivery_outcome_unknown'),binding=b,when=sourceReport.window.valid_until)=>'select public.custodial_native_schedule_outcome_at('+q(binding)+'::jsonb,'+q(e)+'::jsonb,'+q(when)+'::timestamptz) as v';
 for(const outcome of ['provider_accepted','known_nonacceptance']){
  await sql('begin');try{
   const receipt=await one(record(ev(outcome)));eq('exact synthetic outcome '+outcome,receipt.evidence,ev(outcome));
   eq('outcome never authorizes dispatch/delivery',[receipt.dispatch_authorized,receipt.delivery_admitted],[false,false]);
   eq('status follows distinct outcome',(await one(statusCall)).attempt.provider_outcome,outcome);
  }finally{await sql('rollback');}
 }
 await rejects('foreign attempt operation denied',record({...ev('delivery_outcome_unknown'),operation_id:randomUUID()}),'42501');
 await rejects('crossed actor binding denied',record(ev('delivery_outcome_unknown'),{...b,receipt_employee_id:randomUUID()}),'42501');
 await rejects('extended evidence rejected',record({...ev('delivery_outcome_unknown'),delivered:true}),'22023');
 await rejects('accepted missing provider receipt rejected',record({...ev('provider_accepted'),provider_message_id:null}),'22023');
 await rejects('outcome before attempt rejected',record(ev('delivery_outcome_unknown'),b,at),'22023');
 await rejects('generic LOCATION owner remains closed','select public.custodial_native_location_outcome_at('+q({...b,source_reservation_id:undefined})+'::jsonb,'+q(ev('delivery_outcome_unknown'))+'::jsonb,'+q(later)+'::timestamptz)','42501');
 await sql('update public.device_auth_credentials set revoked_at=now() where credential_id='+q(actor.credential_id));
 // Credential revocation legitimately deactivates its registration. Compare
 // the outcome against the post-revocation baseline, not the earlier actor.
 const health=await one('select md5(row_to_json(r)::text) as v from public.employee_push_registrations r where registration_id='+q(actor.registration_id));
 const receipt=await one(record());eq('late revoked source settles original unknown',receipt.evidence,ev('delivery_outcome_unknown'));
 eq('exact replay returns original time/evidence',{...(await one(record(ev('delivery_outcome_unknown'),b,dates.date+' 13:00 America/Chicago'))),replayed:false},receipt);
 eq('old outcome cannot update successor/registration health',await one('select md5(row_to_json(r)::text) as v from public.employee_push_registrations r where registration_id='+q(actor.registration_id)),health);
 await rejects('unknown cannot be relabeled accepted',record(ev('provider_accepted')),'23505');
 await rejects('attempt update denied','update public.employee_native_schedule_dispatch_attempts set attempt_reserved_at=attempt_reserved_at','23514');
 await rejects('attempt delete denied','delete from public.employee_native_schedule_dispatch_attempts','23514');
 await rejects('outcome update denied','update public.employee_native_schedule_outcomes set evidence=evidence','23514');
 await rejects('outcome delete denied','delete from public.employee_native_schedule_outcomes','23514');
 const late=await readNativeScheduleAttempt({db,jobId});eq('readback after expiry/revoke is original unknown',late.attempt.provider_outcome,'delivery_outcome_unknown');
 const reconciled=await recordNativeScheduleOutcome({binding:b,evidence:ev('delivery_outcome_unknown'),db:{rpc:async(name)=>{
  if(name==='custodial_native_schedule_outcome')throw Error('synthetic response loss');return{data:await one(statusCall)};}}});
 eq('actual persisted readback reconciles ambiguous response',reconciled.status,'ORIGINAL_OUTCOME_RECONCILED');
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  await deny('private attempted clock denied '+role,'set role '+role+';'+call());
  await deny('private outcome clock denied '+role,'set role '+role+';'+record());
  for(const rel of ['employee_native_schedule_dispatch_attempts','employee_native_schedule_outcomes'])await deny('direct private ledger denied '+role+' '+rel,'set role '+role+';select * from public.'+rel);
 }
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  await deny('public dispatch denied '+role,'set role '+role+';'+publicPrepare);
  await deny('public readback denied '+role,'set role '+role+';'+statusCall);
 }
 for(const rel of ['employee_native_schedule_dispatch_attempts','employee_native_schedule_outcomes']){
  eq('FORCE RLS/no policy '+rel,await one("select jsonb_build_array(relrowsecurity,relforcerowsecurity,(select count(*) from pg_policy where polrelid=c.oid)) as v from pg_class c where oid="+q('public.'+rel)+"::regclass"),[true,true,0]);
  eq('ALWAYS immutable/restore fence '+rel,await one("select jsonb_agg(tgenabled::text order by tgenabled::text) as v from pg_trigger where tgrelid="+q('public.'+rel)+"::regclass and not tgisinternal"),['A','O']);
  eq('exact recovery relation '+rel,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='relation' and object_identity="+q('public.'+rel)+" and definition_sql=public.custodial_release_authority_current_relation_definition(object_identity) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),1);
 }
 for(const fn of ['custodial_native_schedule_dispatch_prepare_at(uuid,uuid,uuid,jsonb,timestamp with time zone)','custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)',
  'custodial_native_schedule_dispatch_status(uuid)','custodial_native_schedule_outcome_at(jsonb,jsonb,timestamp with time zone)','custodial_native_schedule_outcome(jsonb,jsonb)'])eq('exact function recovery '+fn,await one("select count(*)::int as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)="+q('public.'+fn)+"::regprocedure and definition_sql=pg_get_functiondef("+q('public.'+fn)+"::regprocedure) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),1);
 eq('old outcome and handset ledgers untouched',[await one('select count(*)::int as v from public.employee_native_location_outcomes'),await one('select count(*)::int as v from public.employee_native_provider_events')],[0,0]);
 put('ATTEMPT_READBACK.json',{first,actor,job,fresh,replay,originalStatus,receipt,late,reconciled,execution:'Actual isolated244SQL; synthetic source/timing/actor/provider evidence; two SQL sessions; modeled RPC loss. No provider send, native qualification or phone.',production:false,phone:false});
 put('SQL_RECEIPT.json',{status:'PASS',checks,migrations:manifest.length,actual_SQL:true,provider_dispatch:false,native_qualified:false,phone:false});
 console.log(JSON.stringify({status:'PASS',checks,actual_SQL:true,provider_dispatch:false}));
}catch(error){put('SQL_FAILURE.json',{stage:current,code:error.code||null,message:String(error.message).slice(0,700),checks});throw error;}
finally{await c?.end().catch(()=>{});await shutdownStaticWeeklyCompiler();}
