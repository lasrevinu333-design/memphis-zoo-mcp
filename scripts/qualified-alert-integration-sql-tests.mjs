// Exact-source isolated PostgreSQL proof. No provider/network/phone delivery.
import assert from 'node:assert/strict';
import {migrationReplayNames} from './migration-replay-order.mjs';
import {readFileSync,readdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {deliverNativeMessageJob} from '../src/native-message-dispatch.js';
import {buildNativeAlertCandidate} from '../src/native-alert-two-stage.js';
import {proveQualifiedEventSql} from './fixtures/qualified-event-sql-proof.mjs';
const [socket,donor,out,eventContainer]=process.argv.slice(2);
assert.match(socket,/^\/tmp\/mz-msg-[A-Za-z0-9_-]+\/socket$/);
const {Client}=createRequire(donor+'/package.json')('pg');
const sha=x=>createHash('sha256').update(x).digest('hex');
const q=x=>`'${String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")}'`;
const checkpoint=(phase,extra={})=>{const value={at:new Date().toISOString(),phase,...extra};appendFileSync(out+'/progress.jsonl',JSON.stringify(value)+'\n',{mode:0o600});console.log(JSON.stringify(value));};
const config={host:socket,user:'supabase_admin',database:'postgres',password:'postgres',connectionTimeoutMillis:500,query_timeout:30000};
let c=null,checks=0,current='startup';
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;checkpoint('CHECK',{name,checks});};
const sql=async text=>{const result=await c.query(text);return Array.isArray(result)?result.at(-1):result;};
const one=async text=>(await sql(text)).rows[0]?.v;
const call=async(name,args,role='service_role')=>{
 assert.match(name,/^[a-z_]+$/);assert.ok(['service_role','supabase_admin','anon','authenticated','custodial_application_reader'].includes(role));
 await sql('reset role');await sql('set role '+role);
 try{return await one(`select public.${name}(${Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z][a-z0-9_]*$/);return k+'=>'+(v===null?'null':q(v));}).join(',')}) as v`);}
 finally{await sql('reset role');}
};
const absent=`select count(*)::int as v from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)`;
const remove=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].flatMap(scope=>['tables','sequences'].map(kind=>`alter default privileges for role ${owner}${scope} revoke all on ${kind} from public,anon,authenticated,service_role;`))).join('\n');
const exceptions=new Set(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql']);
const manifest=migrationReplayNames().map(file=>({file,sha256:sha(readFileSync('supabase/migrations/'+file))}));
for(const row of manifest.filter(x=>x.file.startsWith('202610041')))assert.doesNotMatch(readFileSync('supabase/migrations/'+row.file,'utf8'),/is distinct from case\b/i,'PL/pgSQL IF must parenthesize CASE expression');
writeFileSync(out+'/MIGRATIONS.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
try{
 let ready=0;
 for(let n=0;n<40;n++){
  const next=new Client(config);next.on('error',()=>{});
  try{await next.connect();const probe=await next.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin')");assert.equal(probe.rows[0].n,4);ready++;if(ready===4){c=next;break;}await next.end();}
  catch{ready=0;await next.end().catch(()=>{});}
  await new Promise(r=>setTimeout(r,500));
 }
 assert.ok(c,'isolated database startup');checkpoint('READY');
 const originalCase="do $probe$ declare kind text:='MESSAGE';job_type text:='employee_native_push';begin if job_type is distinct from case kind when 'EVENT' then 'employee_event_push' else 'employee_native_push' end then raise exception 'wrong branch';end if;end $probe$;";
 await assert.rejects(()=>sql(originalCase),error=>error.code==='42601');checks++;checkpoint('CHECK',{name:'original unparenthesized CASE reproduces compiler error 42601',checks});
 await sql(originalCase.replace('from case','from (case').replace('end then','end) then'));checks++;checkpoint('CHECK',{name:'parenthesized identical CASE compiles and preserves branch',checks});
 await sql(remove);assert.equal(await one(absent),0);
 for(const [index,row] of manifest.entries()){
  current=row.file;assert.equal(await one(absent),0,'before '+current);
  const source=readFileSync('supabase/migrations/'+current);assert.equal(sha(source),row.sha256);
  await sql(source.toString());
  if(await one(absent)){assert.ok(exceptions.has(current));assert.doesNotMatch(source.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);await sql(remove);}
  assert.equal(await one(absent),0,'after '+current);
  if(index%25===24||index===manifest.length-1)checkpoint('REPLAY',{completed:index+1,file:current});
 }
 current='messenger-qualified-fixture';checkpoint('SQL_FIXTURE_BEGIN');
 const employee=randomUUID(),device=randomUUID(),credential=randomUUID(),recipient=randomUUID(),sender=randomUUID(),thread=randomUUID();
 const credentialHash=sha('synthetic-credential'),token='SYNTHETIC-NOT-A-PROVIDER-TOKEN-'+randomUUID();
 await sql(`insert into public.employees(id,employee_code,display_name,role,active) values(${q(employee)},'EMP997','Synthetic Message recipient','staff',true);
 insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values(${q(device)},'KIOSK_08','Synthetic Messenger',true,${q(employee)},1);
 insert into public.device_auth_credentials(credential_id,device_id,token_hash,created_at,confirmed_at,expires_at) values(${q(credential)},${q(device)},${q(credentialHash)},now()-interval '2 days',now()-interval '1 day',now()+interval '1 day');`);
 const register={schema:'custodial.native-provider-register.v1',operation_id:randomUUID(),generation_id:randomUUID(),credential_id:credential,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:1,principal_digest:sha('synthetic-principal'),token_digest:sha(token),token,
  native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
 const reg=await call('custodial_native_provider_registration',{p_credential:credential,p_credential_hash:credentialHash,p_native_request:randomUUID(),p_attestation_digest:'b'.repeat(64),p_body:register,p_status:false});
 assert.ok(reg.registration_id);checkpoint('REGISTERED');
 await sql(`insert into public.msg_users(id,employee_id,display_name,role,is_active) values(${q(recipient)},${q(employee)},'Synthetic recipient','employee',true),(${q(sender)},null,'Synthetic sender','employee',true);
 insert into public.msg_threads(id,thread_type,created_by_user_id,is_active) values(${q(thread)},'direct',${q(sender)},true);
 insert into public.msg_thread_participants(thread_id,user_id) values(${q(thread)},${q(recipient)}),(${q(thread)},${q(sender)});`);
 async function job(){
  const message=randomUUID();await sql(`insert into public.msg_messages(id,thread_id,sender_user_id,body,sent_at,created_at) values(${q(message)},${q(thread)},${q(sender)},'Exact original synthetic message',now()-interval '2 seconds',now()-interval '2 seconds');
   insert into public.msg_receipts(message_id,user_id) values(${q(message)},${q(recipient)}) on conflict(message_id,user_id) do nothing;`);
  const result=await one(`select to_jsonb(j) as v from public.claim_operational_notification_job_by_key(${q('employee-message-push:'+message+':'+credential)},'synthetic-message-proof',120) j`);
  assert.equal(result.source_id,message);return result;
 }
 const db={async rpc(name,args){try{return {data:await call(name,args)};}catch(error){checkpoint('RPC_ERROR',{name,code:error.code,message:error.message});return{error};}}};
 let sends=0,wire=null;
 const pushRuntime={async prepareNativeMessageSender(){return async({permit})=>{sends++;wire=permit.reservation.payload;return{outcome:'provider_accepted',provider_message_id:'projects/synthetic-zoo/messages/original',error_code:null};};}};
 const first=await job();const result=await deliverNativeMessageJob({db,pushRuntime,job:first});
 check('qualified SQL plus production JS sends once to synthetic provider',sends,1);
 check('new delivery result',result.replayed,false);
 check('MESSAGE native schema',wire.schema,'custodial.native-message-payload.v1');
 check('original message identity',wire.message_id,first.source_id);
 const replay=await deliverNativeMessageJob({db,pushRuntime,job:first});check('accepted replay never resends',[replay.replayed,sends],[true,1]);
 const request={schema:'custodial.native-provider-inventory-request.v1',scan_id:randomUUID(),device_id:'KIOSK_08',credential_id:credential,employee_id:employee,assignment_epoch:1,principal_digest:register.principal_digest,generation_ids:[register.generation_id],limit:32,cursor:null,ceiling:null,server_now:null};
 const inventory=async body=>call('custodial_native_provider_inventory_clock',{p_credential:credential,p_credential_hash:credentialHash,p_native_request:randomUUID(),p_attestation_digest:'b'.repeat(64),p_body:body});
 const page=await inventory(request);writeFileSync(out+'/SYNTHETIC_INVENTORY.json',JSON.stringify(page,null,2)+'\n',{flag:'wx',mode:0o600});
 check('finalized message in inventory',JSON.stringify(page).includes(wire.content_sha256),true);
 check('same scan replay freezes rows',(await inventory(request)).data,page.data);
 const observation={earliest_at:wire.reservation_at,latest_at:wire.reservation_at,clock_profile_id:'SYNTHETIC_ONLY_NOT_QUALIFIED',elapsed_realtime_ms:1,boot_count:1};
 const received={schema:'custodial.native-provider-event.v2',event_id:randomUUID(),record_id:sha(wire.generation_id+'\n'+wire.receipt_job_id+'\n'+wire.notification_key),action:'received',
  ...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id','principal_digest','token_digest'].map(k=>[k,wire[k]])),
  receipt_assignment_epoch:1,admission_bounds:observation,original_observation:observation};
 const eventCall=events=>call('custodial_native_provider_events',{p_credential:credential,p_credential_hash:credentialHash,p_native_request:randomUUID(),p_attestation_digest:'b'.repeat(64),p_body:{schema:'custodial.native-provider-events.v2',events}});
 const admitted=await eventCall([received]);check('actual MESSAGE receive observation binds original finalization',admitted.data.results[0].admitted_state,'ACCEPTED');
 const requester={credential_id:credential,current_generation_id:register.generation_id,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:1,principal_digest:register.principal_digest,token_digest:register.token_digest};
 const decisions=async events=>call('custodial_native_provider_event_decisions',{p_credential:credential,p_credential_hash:credentialHash,p_native_request:randomUUID(),p_attestation_digest:'b'.repeat(64),p_raw_body_sha256:'c'.repeat(64),p_body:{schema:'custodial.native-provider-event-decision-query.v1',requester,events}});
 // Execute the exact historical function in a rolled-back isolated transaction
 // to reproduce its Message omission, without adopting drift as authority.
 const historical=readFileSync('supabase/migrations/20261004000000_native_provider_event_decision_lookup.sql','utf8');
 const originalFunction=historical.slice(historical.indexOf('create function public.custodial_native_provider_event_decisions('),historical.indexOf('end $fn$;')+'end $fn$;'.length);
 await sql('begin');try{
  await sql(originalFunction.replace('create function','create or replace function'));
  check('historical original decision misses actual accepted MESSAGE',(await decisions([received])).data.results[0].decision,'UNRESOLVED');
 }finally{await sql('rollback');}
 const originalDecision=(await decisions([received])).data.results[0];
 check('MESSAGE original accepted readback',originalDecision.decision,'ORIGINAL_ACCEPTED');
 check('MESSAGE readback returns exact original observation',originalDecision.receipt.original_observation,received.original_observation);
 check('unseen Message event stays unresolved',(await decisions([{...received,event_id:randomUUID()}])).data.results[0].decision,'UNRESOLVED');
 check('crossed Message content stays unresolved',(await decisions([{...received,content_sha256:'f'.repeat(64)}])).data.results[0].decision,'UNRESOLVED');
 await sql('begin');try{
  await sql(`update public.device_auth_credentials set expires_at=now()-interval '1 second' where credential_id=${q(credential)}`);
  check('expired current credential cannot disclose original',(await decisions([received])).data.results[0].decision,'UNRESOLVED');
 }finally{await sql('rollback');}
 check('same original receive replays',(await eventCall([received])).data.results[0].replayed,true);
 const crossed=await eventCall([{...received,event_id:randomUUID(),content_sha256:'f'.repeat(64)}]);check('crossed content cannot settle original',crossed.data.results[0].admitted_state,'REJECTED');
 const before=await one(`select to_jsonb(r) as v from public.employee_native_alert_finalizations r where job_id=${q(first.job_id)}`);
 // A stale/deleted business source is filtered without reopening provider send.
 await sql(`update public.msg_messages set is_deleted=true,deleted_at=now(),purge_after=now()+interval '14 days' where id=${q(first.source_id)}`);
 check('deleted source absent from fresh inventory',JSON.stringify(await inventory({...request,scan_id:randomUUID()})).includes(wire.content_sha256),false);
 check('deletion preserves original immutable finalization',await one(`select to_jsonb(r) as v from public.employee_native_alert_finalizations r where job_id=${q(first.job_id)}`),before);
 check('deleted business source preserves accepted original readback',(await decisions([received])).data.results[0].decision,'ORIGINAL_ACCEPTED');
 const second=await job();const target=await call('custodial_native_alert_target',{p_job:second.job_id,p_lease:second.lease_token});
 const prep=await call('custodial_native_alert_prepare',{p_job:second.job_id,p_lease:second.lease_token,p_expected:target.expected});
 check('preparation grants no dispatch',prep.dispatch_authorized,false);
 check('preparation alone absent from inventory',JSON.stringify(await inventory({...request,scan_id:randomUUID()})).includes(second.job_id),false);
 await sql(`update public.msg_receipts set acknowledged_at=now() where message_id=${q(second.source_id)} and user_id=${q(recipient)}`);
 const finalized=await call('custodial_native_alert_finalize',{p_job:second.job_id,p_lease:second.lease_token,p_prepared:prep.prepared_id,p_expected:target.expected,p_candidate:buildNativeAlertCandidate(prep,{})});
 check('ACK between prepare and finalize refuses send',finalized.dispatch_authorized,false);
 check('refused finalize creates no receipt',await one(`select count(*)::int as v from public.employee_native_alert_finalizations where job_id=${q(second.job_id)}`),0);
 for(const role of ['anon','authenticated','custodial_application_reader']){
  await assert.rejects(()=>call('custodial_native_alert_target',{p_job:first.job_id,p_lease:first.lease_token},role),/permission denied/);checks++;checkpoint('CHECK',{name:role+' denied target',checks});
 }
 for(const table of ['employee_native_alert_preparations','employee_native_alert_finalizations','employee_native_alert_outcomes']){
  check(table+' forced RLS',await one(`select relrowsecurity and relforcerowsecurity as v from pg_class where oid=${q('public.'+table)}::regclass`),true);
  for(const role of ['anon','authenticated','service_role']){
   await sql('set role '+role);try{await assert.rejects(()=>sql('select * from public.'+table),/permission denied/);checks++;}finally{await sql('reset role');}
  }
  for(const [kind,helper] of [['relation','relation'],['column_set','column_set'],['relation_state','relation_state'],['grant','grant']]){
   check(table+' exact '+kind+' recovery',await one(`select count(*)::int as v from public.custodial_release_authority_restore_inventory i where object_kind=${q(kind)} and object_identity=${q('public.'+table)} and definition_sql=public.custodial_release_authority_current_${helper}_definition(object_identity) and definition_sha256=public.static_weekly_digest_text(definition_sql)`),1);
   check(table+' '+kind+' canary membership',await one(`select count(*)::int as v from public.custodial_release_canary_authority_surface() where object_kind=${q(kind)} and object_identity=${q('public.'+table)}`),1);
  }
  check(table+' every column captured',await one(`select count(*)::int as v from pg_attribute a where attrelid=${q('public.'+table)}::regclass and attnum>0 and not attisdropped and not exists(select 1 from public.custodial_release_authority_restore_inventory i where object_kind='column' and object_identity=${q('public.'+table+':')}||a.attname and definition_sql=public.custodial_release_authority_current_column_definition(object_identity))`),0);
  check(table+' every constraint captured',await one(`select count(*)::int as v from pg_constraint c where conrelid=${q('public.'+table)}::regclass and not exists(select 1 from public.custodial_release_authority_restore_inventory i where object_kind='constraint' and object_identity=${q('public.'+table+':')}||c.conname and definition_sql=public.custodial_release_authority_current_constraint_definition(object_identity))`),0);
  check(table+' every explicit trigger captured',await one(`select count(*)::int as v from pg_trigger t where tgrelid=${q('public.'+table)}::regclass and not tgisinternal and not exists(select 1 from public.custodial_release_authority_restore_inventory i where object_kind='trigger' and object_identity=${q('public.'+table+'.')}||t.tgname)`),0);
 }
 const functions=['custodial_native_alert_target','custodial_native_alert_target_at','custodial_native_alert_prepare','custodial_native_alert_prepare_at','custodial_native_alert_message_current','custodial_native_alert_finalize','custodial_native_alert_finalize_at','custodial_native_alert_record_outcome','custodial_native_alert_dispatch_status','custodial_native_alert_source_live','custodial_native_provider_event_decisions','custodial_native_alert_event_binding','custodial_native_provider_original_tuple'];
 for(const name of functions)for(const kind of ['function','grant'])check('recovery '+kind+' '+name,await one(`select count(*)::int as v from pg_proc p join public.custodial_release_authority_restore_inventory i on i.object_kind=${q(kind)} and position('(' in i.object_identity)>0 and to_regprocedure(i.object_identity)=p.oid where p.pronamespace='public'::regnamespace and p.proname=${q(name)} and i.definition_sha256=public.static_weekly_digest_text(case when i.object_kind='function' then pg_get_functiondef(p.oid) else public.custodial_release_authority_current_grant_definition(i.object_identity) end)`),1);
 const saved=await one("select jsonb_object_agg(i.object_kind,i.definition_sql) as v from public.custodial_release_authority_restore_inventory i where i.object_kind in ('function','grant') and i.object_identity='custodial_native_alert_source_live(uuid,timestamp with time zone)'");
 assert.ok(saved?.function&&saved?.grant,'exact original recovery captured');
 const protectedRows=()=>one("select jsonb_build_object('preparations',(select jsonb_agg(to_jsonb(r) order by job_id) from public.employee_native_alert_preparations r),'finalizations',(select jsonb_agg(to_jsonb(r) order by job_id) from public.employee_native_alert_finalizations r),'outcomes',(select jsonb_agg(to_jsonb(r) order by job_id) from public.employee_native_alert_outcomes r),'events',(select jsonb_agg(to_jsonb(r) order by event_id) from public.employee_native_provider_events r)) as v");
 const protectedBefore=await protectedRows();
 await sql('begin');try{
  await sql(saved.function.replace('return false','return true'));
  check('synthetic function fault established',await one("select pg_get_functiondef('public.custodial_native_alert_source_live(uuid,timestamptz)'::regprocedure) as v")===saved.function,false);
  await sql('grant execute on function public.custodial_native_alert_source_live(uuid,timestamptz) to anon');
  check('synthetic grant fault established',await one("select has_function_privilege('anon','public.custodial_native_alert_source_live(uuid,timestamptz)','execute') as v"),true);
  await sql(saved.function);await sql(saved.grant);
  check('exact function restored',await one("select pg_get_functiondef('public.custodial_native_alert_source_live(uuid,timestamptz)'::regprocedure) as v"),saved.function);
  check('denied helper privilege restored',await one("select has_function_privilege('anon','public.custodial_native_alert_source_live(uuid,timestamptz)','execute') as v"),false);
  check('recovery preserves original Message records',await protectedRows(),protectedBefore);
 }finally{await sql('rollback');}
 check('automatic grants remain absent',await one(absent),0);
 // Execute the actual candidate function body with explicit synthetic
 // dependency rows. This is SQL policy proof, not physical NFC acceptance.
 // No production relation/function or cleaning history is replaced.
 const body=await one("select prosrc as v from pg_proc where oid='public.mz_location_reminder_candidates(date,timestamptz)'::regprocedure");
 const legacyText=readFileSync('supabase/migrations/20260922090000_verified_visit_reminder_state.sql','utf8').split('create or replace function public.mz_location_reminder_candidates(')[1];
 const legacyBody=legacyText.split('as $function$')[1].split('$function$;')[0]
  .replace('public.mz_verified_visit_reminder_cycle(','public.mz_verified_location_reminder_cycle(status.location_id,');
 const place=randomUUID(),otherPlace=randomUUID();
 async function reminderProjection(fn,minutes,work=null){
  assert.equal(fn.split('public.v_location_dashboard_status').length,2);
  let query=fn.replace('public.v_location_dashboard_status','fixture_status');
  if(query.includes('public.custodial_open_work()')){
   assert.equal(query.split('public.custodial_open_work()').length,2);
   query=query.replace('public.custodial_open_work()','fixture_work');
  }
  query=query.replaceAll('p_service_date',"'2026-10-05'::date").replaceAll('p_now',`('2026-10-05T14:00:00Z'::timestamptz+interval '${minutes} minutes')`);
  const workRow=work?`select ${q(work.location||place)}::uuid location_id,${q(work.status||'active')}::text status,'2026-10-05T14:00:00Z'::timestamptz+interval '${work.minute} minutes' started_at`:"select null::uuid location_id,null::text status,null::timestamptz started_at where false";
  // Preserve the public SQL function's declared output names; evaluating its
  // body directly would otherwise label the concatenated key "?column?".
  const rows=await sql(`with fixture_status as(select ${q(place)}::uuid location_id,'restroom'::text form_type,'2026-10-05T14:00:00Z'::timestamptz latest_completed_at,'2026-10-05T09:00:00Z'::timestamptz operational_day_start),fixture_work as(${workRow}),fixture_result(location_id,notification_key,status_code,cycle_base_at,cycle_base_evidence,cleaned_at,due_soon_at,overdue_at) as(${query.trim().replace(/;$/,'')}) select * from fixture_result`);
  return rows.rows;
 }
 check('old overdue policy reproduced after accepted Start',(await reminderProjection(legacyBody,96,{minute:95})).length,1);
 const firstOverdue=await reminderProjection(body,90),repeatOverdue=await reminderProjection(body,95);
 check('five-minute overdue buckets remain distinct',[firstOverdue[0].notification_key.endsWith(':0'),repeatOverdue[0].notification_key.endsWith(':1')],[true,true]);
 check('dismissal does not enter reminder authority',/dismiss|acknowledg|msg_messages|msg_threads/.test(body),false);
 check('accepted Start stops overdue at its first instant',(await reminderProjection(body,95,{minute:95})).length,0);
 check('accepted Start stops next overdue repeat',(await reminderProjection(body,100,{minute:95})).length,0);
 check('pending submission is not re-alerted',(await reminderProjection(body,100,{minute:95,status:'pending_submit'})).length,0);
 for(const work of [{minute:101},{minute:-1},{minute:95,status:'cancelled'},{minute:95,location:otherPlace}])
  check('unrelated stale future or cancelled work cannot suppress overdue',(await reminderProjection(body,100,work)).length,1);
 check('due-soon timing unchanged',(await reminderProjection(body,80,{minute:79}))[0].status_code,'due_soon');
 check('Start never resets completed-cleaning cycle',(await one("select to_jsonb(c) as v from public.mz_verified_visit_reminder_cycle('restroom','2026-10-05T14:00:00Z',null,'2026-10-05T15:40:00Z') c")).repeat_index,2);
 check('overdue source recovery aliases rebound exactly',await one("select array_agg(object_identity order by object_identity) as v from public.custodial_release_authority_restore_inventory where object_kind='function' and to_regprocedure(object_identity)='public.mz_location_reminder_candidates(date,timestamptz)'::regprocedure and definition_sql=pg_get_functiondef(to_regprocedure(object_identity)) and definition_sha256=public.static_weekly_digest_text(definition_sql)"),[
  'mz_location_reminder_candidates(date,timestamp with time zone)',
  'public.mz_location_reminder_candidates(date,timestamp with time zone)']);
 if(eventContainer)await proveQualifiedEventSql({sql,one,call,db,check,checkpoint,inventory,decisions,eventCall,register,employee,device,credential,container:eventContainer});
 checkpoint('PASS',{checks,migrations:manifest.length,actual_sql:true,provider_delivery:false,physical:false});
}catch(error){checkpoint('FAIL',{current,checks,code:error.code??null,message:error.message,position:error.position??null,internalPosition:error.internalPosition??null,where:error.where??null,stack:error.stack?.split('\n').slice(0,5)});process.exitCode=1;}
finally{if(c)await c.end();}
