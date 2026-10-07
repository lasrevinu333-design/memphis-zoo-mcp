import {migrationReplayNames} from './migration-replay-order.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';
import {validateNativeLunchDispatch} from '../src/native-lunch-dispatch.js';
import {validateNativeLocationInventoryResponse} from '../src/native-location-lifecycle.js';
import {writeNativeSqlFixture} from './fixtures/native-sql-fixture-output.mjs';

const container=`mz_schema_rebuild_native_target_source_${process.pid}`;
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const migration='20261003170000_native_target_source_projection.sql';
const docker=(args,extra={})=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe'],...extra});
const sql=text=>docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:'set statement_timeout=30000;'+text}).trim();
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const id=n=>`34000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const defaults="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
const removeDefaults=()=>{for(const owner of ['postgres','supabase_admin'])for(const scope of ['',' in schema public'])sql(`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`);};
let owned=false,checks=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const reject=(name,query,pattern=/ERROR/)=>{let error;try{sql(query)}catch(caught){error=caught}assert.ok(error,name);assert.match(String(error.stderr),pattern,name);checks++;console.log('PASS',name);};
const cleanup=()=>{if(owned){docker(['rm','-f',container]);owned=false;assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');console.log('OWNED_CONTAINER_REMOVED',container)}};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{cleanup()}finally{process.exit(143)}});
const files=migrationReplayNames(process.cwd()),manifest=[];
assert.ok(files.includes(migration),'owning source migration must be included');
try{
 docker(['image','inspect',image]);
 docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=1g',
  '-e','POSTGRES_PASSWORD=postgres','-e','PGPASSWORD=postgres',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements']);owned=true;
 console.log(JSON.stringify({owned:container,cleanup:'exact container in finally',image,network:'none',production:false}));
 let ready=0;for(let n=0;n<60&&ready<4;n++){try{sql('select 1');ready++}catch{ready=0}await new Promise(resolve=>setTimeout(resolve,500))}assert.equal(ready,4);
 removeDefaults();for(const file of files){
  assert.equal(sql(defaults),'0','before '+file);const bytes=readFileSync('supabase/migrations/'+file);
  try{sql(bytes.toString())}catch(error){console.error('FAILED_MIGRATION',file,String(error.stderr));throw error}
  if(Number(sql(defaults))){assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(file));assert.doesNotMatch(bytes.toString(),/create\s+(?:unlogged\s+)?table|create\s+sequence/i);removeDefaults()}
  assert.equal(sql(defaults),'0','after '+file);manifest.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  if(manifest.length%25===0)console.log('REPLAYED_EXACT_MIGRATIONS',manifest.length);
 }
 console.log('NO_AUTOMATIC_TABLE_OR_SEQUENCE_GRANTS_REPLAY_PASS',manifest.length);
 const fn='public.custodial_native_target_source(text,uuid,uuid,uuid)',call=(role='service_role',kind='MESSAGE')=>
  `set role ${role};select public.custodial_native_target_source(${q(kind)},${q(id(1))},${q(id(2))},${q(id(3))})::text`;
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
  reject('private source RPC denied '+role,call(role),/permission denied/);
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane'])
  reject('time-parametric source helper denied '+role,
   `set role ${role};select public.custodial_native_target_source_at('MESSAGE',${q(id(1))},${q(id(2))},${q(id(3))},now())`,/permission denied/);
 check('service-only execution',sql(`select has_function_privilege('service_role',${q(fn)},'execute')::text`),'true');
 check('unknown target is source-only denial',JSON.parse(sql(call())).status,'TARGET_STALE');
 reject('unknown kind rejected',call('service_role','EVENT'),/exact native source kind/);
 check('function and grant recovery registered',sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(object_identity)=${q(fn)}::regprocedure`),'2');
 check('canary includes source read',sql(`select count(*) from public.custodial_release_canary_authority_surface() where object_kind='function' and object_identity='custodial_native_target_source(text,uuid,uuid,uuid)'`),'1');
 const employee=id(10),device=id(11),credential=id(12),generation=id(13),recipient=id(14),sender=id(15),thread=id(16),oldMessage=id(17),newMessage=id(18);
 // Keep the accepted Friday schedule and every synthetic due time ahead of
 // the real immutable registration clock on any CI run day.
 const today=new Date(),daysUntilFriday=(5-today.getUTCDay()+7)%7||7;
 const serviceDate=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()+daysUntilFriday))
  .toISOString().slice(0,10);
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const token='synthetic-target-source-fcm-token-0001',tokenHash=hash(token);
 sql(`insert into public.employees(id,employee_code,display_name,role,active)
  values(${q(employee)},'EMP994','Synthetic target employee','staff',true);
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
  values(${q(device)},'KIOSK_08','Synthetic target phone',true,${q(employee)},1);
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,created_at,confirmed_at,expires_at)
  values(${q(credential)},${q(device)},repeat('c',64),${q(serviceDate)}::date-interval '1 day',${q(serviceDate)}::date-interval '1 day',greatest(now(),${q(serviceDate)}::date)+interval '2 days');
  set role service_role;
  select public.mz_register_employee_push(${q(credential)},${q(token)},${q(tokenHash)},'android','synthetic-only','synthetic.custodial.df36d32368b6');`);
 const registration=sql(`select registration_id from public.employee_push_registrations where credential_id=${q(credential)} and active`);
 assert.ok(registration);
 const app={package_name:'org.memphiszoo.custodial',version_name:'synthetic-only',version_code:53,build_id:'synthetic.custodial.df36d32368b6'};
 sql(`insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,device_identifier,
  credential_id,employee_id,assignment_epoch,principal_digest,token_digest,native_app,request_fingerprint,
  first_native_request_id,first_attestation_digest,activated_at)
  values(${q(generation)},${q(id(19))},${q(registration)},${q(device)},'KIOSK_08',${q(credential)},${q(employee)},1,
   repeat('a',64),${q(tokenHash)},${q(JSON.stringify(app))}::jsonb,repeat('b',64),${q(id(20))},repeat('c',64),now()-interval '1 hour');
  insert into public.msg_users(id,employee_id,display_name,role,is_active)
  values(${q(recipient)},${q(employee)},'Synthetic recipient','employee',true),
   (${q(sender)},null,'Synthetic sender','employee',true);
  insert into public.msg_threads(id,thread_type,created_by_user_id,is_active)
  values(${q(thread)},'direct',${q(sender)},true);
  insert into public.msg_thread_participants(thread_id,user_id) values(${q(thread)},${q(recipient)}),(${q(thread)},${q(sender)});
  insert into public.msg_messages(id,thread_id,sender_user_id,body,sent_at,created_at)
  values(${q(oldMessage)},${q(thread)},${q(sender)},'Original private message',now()-interval '2 seconds',now()-interval '2 seconds');
  insert into public.msg_receipts(message_id,user_id) values(${q(oldMessage)},${q(recipient)}) on conflict(message_id,user_id) do nothing;`);
 const source=(job,kind='MESSAGE',workerEmployee=employee,workerGeneration=generation)=>JSON.parse(sql(
  `set role service_role;select public.custodial_native_target_source(${q(kind)},${q(job)},${q(workerEmployee)},${q(workerGeneration)})::text`));
 const oldJob=sql(`select job_id from public.operational_notification_jobs where job_key=${q(`employee-message-push:${oldMessage}:${credential}`)}`);
 assert.ok(oldJob,'actual message trigger created a current job');
 let row=source(oldJob);
 check('message original source only',row.status,'SOURCE_ONLY_POLICY_MISSING');
 check('message no invented deadline',row.source.valid_until,null);
 check('message actual job occurrence',row.source.delivery_occurrence_id,oldJob);
 check('message exact recipient user',row.recipient.msg_user_id,recipient);
 check('message current generation tuple',row.recipient.generation_id,generation);
 check('message no delivery authority',row.delivery_admitted,false);
 check('foreign employee cannot receive original message',source(oldJob,'MESSAGE',id(90)).status,'TARGET_STALE');
 check('foreign generation cannot receive original message',source(oldJob,'MESSAGE',employee,id(91)).status,'TARGET_STALE');
 check('acknowledged original message cancels candidate',sql(`begin;update public.msg_receipts set acknowledged_at=now() where message_id=${q(oldMessage)} and user_id=${q(recipient)};
  set role service_role;select public.custodial_native_target_source('MESSAGE',${q(oldJob)},${q(employee)},${q(generation)})->>'status';rollback;`).split('\n')[0],'SOURCE_STALE');
 check('recipient message deletion cancels candidate',sql(`begin;insert into public.msg_message_deletions(message_id,user_id) values(${q(oldMessage)},${q(recipient)});
  set role service_role;select public.custodial_native_target_source('MESSAGE',${q(oldJob)},${q(employee)},${q(generation)})->>'status';rollback;`).split('\n')[0],'SOURCE_STALE');
 sql(`insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before)
  values(${q(thread)},${q(recipient)},null,now()-interval '1 second');`);
 check('user delete-through hides original message',source(oldJob).status,'SOURCE_STALE');
 sql(`insert into public.msg_messages(id,thread_id,sender_user_id,body,sent_at,created_at)
  values(${q(newMessage)},${q(thread)},${q(sender)},'Later message remains visible',now(),now());
  insert into public.msg_receipts(message_id,user_id) values(${q(newMessage)},${q(recipient)}) on conflict(message_id,user_id) do nothing;`);
 const newJob=sql(`select job_id from public.operational_notification_jobs where job_key=${q(`employee-message-push:${newMessage}:${credential}`)}`);
 assert.ok(newJob,'later message created a distinct job');
 check('later message after delete-through is not suppressed',source(newJob).status,'SOURCE_ONLY_POLICY_MISSING');
 check('wrong job payload is stale',sql(`begin;update public.operational_notification_jobs set payload_json=jsonb_set(payload_json,'{data_json,message_id}',to_jsonb(${q(oldMessage)}::text)) where job_id=${q(newJob)};
  set role service_role;select public.custodial_native_target_source('MESSAGE',${q(newJob)},${q(employee)},${q(generation)})->>'status';rollback;`).split('\n')[0],'SOURCE_STALE');
 check('changed assignment epoch rejects target',sql(`begin;update public.devices set assignment_epoch=2 where id=${q(device)};
  set role service_role;select public.custodial_native_target_source('MESSAGE',${q(newJob)},${q(employee)},${q(generation)})->>'status';rollback;`).split('\n')[0],'TARGET_STALE');
 check('revoked credential rejects target',sql(`begin;update public.device_auth_credentials set revoked_at=now() where credential_id=${q(credential)};
  set role service_role;select public.custodial_native_target_source('MESSAGE',${q(newJob)},${q(employee)},${q(generation)})->>'status';rollback;`).split('\n')[0],'TARGET_STALE');
 const week=eventAuthorityWeekStart(serviceDate),dayOfWeek=new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
 const {source:weeklySource,slots,places}=nativeLocationAuthoritySource(week,dayOfWeek);
 slots[0].person=employee;weeklySource.slots[0].incumbencies[0].personId=employee;
 const manager=id(70);
 sql(`insert into public.ops_manager_managers(manager_id,display_name) values(${q(manager)},'Synthetic target manager');`);
 for(const [index,slot] of slots.entries())if(index>0)
  sql(`insert into public.employees(id,employee_code,display_name,role,active)
   values(${q(slot.person)},${q(`EMP99${index}`)},${q(slot.name)},'staff',true);`);
 for(const place of Object.values(places))sql(`insert into public.locations(id,location_code,location_name,location_type,form_type)
  values(${q(place.id)},${q(place.code)},${q(place.name)},'restroom','restroom');
  insert into public.location_groups(id,group_code,group_name) values(${q(place.group)},${q(place.code)},${q(place.name)});
  insert into public.location_group_memberships(location_group_id,location_id) values(${q(place.group)},${q(place.id)});`);
 const authority=await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[serviceDate],
  source:weeklySource,mode:'official',label:'native-target-source'});
 const projection=authority.projectionIds[week];
 const scheduleOccurrence=sql(`select occurrence_id from public.weekly_schedule_occurrences
  where projection_id=${q(projection)} and service_date=${q(serviceDate)} and owner_person_id_snapshot=${q(employee)}
   and state='created' order by occurrence_id limit 1`);
 assert.ok(scheduleOccurrence,'accepted current projection has employee occurrence');
 row=source(scheduleOccurrence,'SCHEDULE');
 check('schedule uses current published projection',row.source.source_id,projection);
 check('schedule source has no invented delivery occurrence',row.source.delivery_occurrence_id,null);
 check('schedule source has no invented deadline',row.source.valid_until,null);
 check('schedule remains source-only',row.status,'SOURCE_ONLY_POLICY_MISSING');
 check('schedule missing occurrence denied',source(id(99),'SCHEDULE').status,'SOURCE_STALE');
 const lunchInput=createStaticWeeklyProjectionWithLunchRpcInput({result:authority.compiledByWeek[week],
  publicationId:authority.publicationId,expectedRevision:0,
  actor:{managerId:manager,managerName:'Synthetic target manager',idempotencyKey:'native-target-lunch'}});
 sql(`set role static_weekly_control_plane;
  select public.static_weekly_v8_materialize_lunch_document(${q(projection)},${q(JSON.stringify(lunchInput.lunchDocument))}::jsonb,${q(manager)});`);
 const lunchDocument=JSON.parse(sql(`select document_json from public.weekly_schedule_lunch_documents
  where projection_id=${q(projection)}`));
 const startIntent=lunchDocument.notification_intents.find(intent=>intent.service_date===serviceDate
  &&intent.event==='start'&&intent.delivery_state==='NOT_ENQUEUED');
 const endIntent=lunchDocument.notification_intents.find(intent=>intent.loan_id===startIntent?.loan_id
  &&intent.coverer_slot_id===startIntent?.coverer_slot_id&&intent.event==='end');
 const coverer=lunchDocument.responsibilities.find(item=>item.loan_id===startIntent?.loan_id
  &&item.coverer_slot_id===startIntent?.coverer_slot_id);
 assert.ok(startIntent&&endIntent&&coverer?.coverer_person_id,'actual accepted start/end coverer required');
 const lunchEmployee=coverer.coverer_person_id,lunchSlot=coverer.coverer_slot_id;
 const lunchDevice=lunchEmployee===employee?device:id(101);
 const lunchCredential=lunchEmployee===employee?credential:id(102);
 const lunchGeneration=lunchEmployee===employee?generation:id(103);
 const lunchDeviceIdentifier=lunchEmployee===employee?'KIOSK_08':'KIOSK_09';
 const lunchCredentialHash=(lunchEmployee===employee?'c':'d').repeat(64);
 const lunchToken=lunchEmployee===employee?token:'synthetic-target-source-fcm-token-lunch';
 const lunchTokenHash=hash(lunchToken);
 let lunchRegistration=registration;
 if(lunchEmployee!==employee){
  sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
   values(${q(lunchDevice)},${q(lunchDeviceIdentifier)},'Synthetic lunch coverer phone',true,${q(lunchEmployee)},1);
   insert into public.device_auth_credentials(credential_id,device_id,token_hash,created_at,confirmed_at,expires_at)
   values(${q(lunchCredential)},${q(lunchDevice)},${q(lunchCredentialHash)},${q(serviceDate)}::date-interval '1 day',${q(serviceDate)}::date-interval '1 day',
    greatest(now(),${q(serviceDate)}::date)+interval '2 days');
   set role service_role;select public.mz_register_employee_push(${q(lunchCredential)},${q(lunchToken)},
    ${q(lunchTokenHash)},'android','synthetic-only','synthetic.custodial.df36d32368b6');`);
  lunchRegistration=sql(`select registration_id from public.employee_push_registrations
   where credential_id=${q(lunchCredential)} and active`);
  assert.ok(lunchRegistration,'actual accepted coverer registration required');
  sql(`insert into public.employee_native_push_generations(generation_id,operation_id,registration_id,device_id,
   device_identifier,credential_id,employee_id,assignment_epoch,principal_digest,token_digest,native_app,
   request_fingerprint,first_native_request_id,first_attestation_digest,activated_at)
   values(${q(lunchGeneration)},${q(id(104))},${q(lunchRegistration)},${q(lunchDevice)},
    ${q(lunchDeviceIdentifier)},${q(lunchCredential)},${q(lunchEmployee)},1,repeat('a',64),${q(lunchTokenHash)},
    ${q(JSON.stringify(app))}::jsonb,repeat('b',64),${q(id(105))},repeat('c',64),now()-interval '1 hour');`);
 }
 const lunchProducer=JSON.parse(sql(`set role service_role;select public.mz_enqueue_employee_lunch_coverage_pushes(
  (${q(serviceDate+' 12:15:00')}::timestamp at time zone 'America/Chicago'));`));
 check('actual accepted lunch producer authority',lunchProducer.projection_id,projection);
 console.log('LUNCH_PRODUCER_RECEIPT',JSON.stringify(lunchProducer));
 const lunchJob=(event)=>sql(`select job_id from public.operational_notification_jobs
  where job_type='employee_native_push' and payload_json#>>'{data_json,kind}'='employee_lunch_coverage'
   and payload_json->>'employee_id'=${q(lunchEmployee)}
   and payload_json#>>'{data_json,notification_key}'=${q(event==='start'?startIntent.notification_key:endIntent.notification_key)}
   and payload_json#>>'{data_json,event}'=${q(event)}
   and status='pending' order by job_id limit 1`);
 const at=(job,date)=>JSON.parse(sql(`select public.custodial_native_target_source_at('LUNCH',${q(job)},
  ${q(lunchEmployee)},${q(lunchGeneration)},${q(date)}::timestamptz)::text`));
 const lunchCases=[];
 for(const event of ['start','end']){
  const job=lunchJob(event);
  if(!job)console.log('LUNCH_FIXTURE_DIAGNOSTIC',JSON.stringify({event,
   intents:JSON.parse(sql(`select document_json->'notification_intents' from public.weekly_schedule_lunch_documents where projection_id=${q(projection)}`)),
   responsibilities:JSON.parse(sql(`select document_json->'responsibilities' from public.weekly_schedule_lunch_documents where projection_id=${q(projection)}`)),
   jobs:JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('status',status,'employee_id',payload_json->>'employee_id',
    'event',payload_json#>>'{data_json,event}','recipient_status',payload_json#>>'{data_json,recipient_status}')),'[]'::jsonb)
    from public.operational_notification_jobs where source_id=${q(projection)} and payload_json#>>'{data_json,kind}'='employee_lunch_coverage'`))}));
  assert.ok(job,`real lunch producer created ${event} intent for current coverer`);
  const scheduled=sql(`select payload_json#>>'{data_json,scheduled_at}' from public.operational_notification_jobs where job_id=${q(job)}`);
  const atDue=new Date(Date.parse(scheduled)+60000).toISOString();
  row=at(job,atDue);
  check(`${event} accepted lunch source`,row.status,'CURRENT_SOURCE_ONLY');
  check(`${event} exact existing delivery occurrence`,row.source.delivery_occurrence_id,job);
  check(`${event} current projection source`,row.source.source_id,projection);
  check(`${event} private original notification key`,row.source.notification_key.length,64);
  check(`${event} no provider admission`,row.delivery_admitted,false);
  check(`${event} exact expiry boundary`,at(job,row.source.valid_until).status,'SOURCE_EXPIRED');
  lunchCases.push({event,job,atDue,row});
   check(`${event} stale document digest refused`,sql(`begin;update public.operational_notification_jobs
   set payload_json=jsonb_set(payload_json,'{data_json,document_identity}',to_jsonb(repeat('f',64))) where job_id=${q(job)};
   select public.custodial_native_target_source_at('LUNCH',${q(job)},${q(lunchEmployee)},${q(lunchGeneration)},${q(atDue)}::timestamptz)->>'status';rollback;`).split('\n')[0],'SOURCE_STALE');
 }
 const lunchExpected={assignment_epoch:'1',credential_id:lunchCredential,device_id:lunchDeviceIdentifier,
  employee_id:lunchEmployee,generation_id:lunchGeneration,principal_digest:'a'.repeat(64),
  registration_id:lunchRegistration,token_digest:lunchTokenHash};
 const lunchPrepared=[];
 for(const [index,{event,job,atDue,row:original}] of lunchCases.entries()){
  const lease=id(110+index);
  sql(`update public.operational_notification_jobs set status='leased',lease_token=${q(lease)},
   leased_until=${q(atDue)}::timestamptz+interval '2 hours' where job_id=${q(job)};`);
  const target=JSON.parse(sql(`select public.custodial_native_lunch_target_at(${q(job)},${q(lease)},${q(atDue)}::timestamptz)::text`));
  check(`${event} protected LUNCH target current`,target.current,true);
  check(`${event} protected LUNCH expected exact recipient`,target.expected,lunchExpected);
  const prepared=JSON.parse(sql(`select public.custodial_native_lunch_dispatch_prepare_at(${q(job)},${q(lease)},
   ${q(JSON.stringify(lunchExpected))}::jsonb,${q(atDue)}::timestamptz)::text`));
  const permit=validateNativeLunchDispatch(prepared,{jobId:job,leaseToken:lease,expected:lunchExpected});
  check(`${event} exact native LUNCH payload kind`,permit.reservation.payload.kind,'employee_lunch_coverage');
  check(`${event} exact native LUNCH schema`,permit.reservation.payload.schema,'custodial.native-provider-payload.v1');
  check(`${event} exact native LUNCH business expiry`,permit.reservation.payload.valid_until,
   new Date(original.source.valid_until).toISOString().replace('.000Z','.000000Z'));
  check(`${event} original 27 native string fields`,Object.keys(permit.reservation.payload).length,27);
  check(`${event} one durable dispatch attempt`,sql(`select count(*) from public.employee_native_lunch_dispatch_attempts where job_id=${q(job)}`),'1');
  const replay=JSON.parse(sql(`select public.custodial_native_lunch_dispatch_prepare_at(${q(job)},${q(lease)},
   ${q(JSON.stringify(lunchExpected))}::jsonb,${q(atDue)}::timestamptz)::text`));
  check(`${event} replay cannot authorize second provider attempt`,replay.dispatch_authorized,false);
  check(`${event} immutable original status attempt`,JSON.parse(sql(`select public.custodial_native_lunch_dispatch_status(${q(job)})`)).attempt_id,permit.attempt_id);
  lunchPrepared.push({event,job,atDue,permit});
 }
 for(const role of ['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator'])
  reject(`LUNCH dispatch denied ${role}`,`set role ${role};select public.custodial_native_lunch_dispatch_status(${q(lunchCases[0].job)})`,/permission denied/);
 for(const fn of ['custodial_native_lunch_target','custodial_native_lunch_dispatch_status','custodial_native_lunch_dispatch_prepare',
  'custodial_native_lunch_outcome','custodial_native_lunch_outcome_status'])
  check('LUNCH service-only '+fn,sql(`select has_function_privilege('service_role',p.oid,'EXECUTE')::text from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=${q(fn)}`),'true');
 for(const fn of ['custodial_native_lunch_target_at(uuid,uuid,timestamptz)',
  'custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamptz)',
  'custodial_native_lunch_dispatch_prepare_at(uuid,uuid,jsonb,timestamptz)',
  'custodial_native_lunch_live(uuid,jsonb,timestamptz)'])
  check('LUNCH test-time/internal helper denied service '+fn,
   sql(`select has_function_privilege('service_role',${q('public.'+fn)},'EXECUTE')::text`),'false');
 for(const role of ['anon','authenticated','service_role','custodial_application_reader'])
  check('LUNCH attempt table private '+role,sql(`select has_table_privilege(${q(role)},
   'public.employee_native_lunch_dispatch_attempts','SELECT')::text`),'false');
 reject('LUNCH attempt row update immutable',`update public.employee_native_lunch_dispatch_attempts
  set attempt_id=${q(id(190))} where job_id=${q(lunchCases[0].job)}`,/immutable|append.only|mutation/);
 reject('LUNCH attempt row delete immutable',`delete from public.employee_native_lunch_dispatch_attempts
  where job_id=${q(lunchCases[0].job)}`,/immutable|append.only|mutation/);
 for(const fn of ['custodial_native_lunch_target(uuid,uuid)',
  'custodial_native_lunch_dispatch_prepare(uuid,uuid,jsonb)',
  'custodial_native_lunch_outcome(jsonb,jsonb)'])
  check('LUNCH function recovery exact '+fn,sql(`select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='function' and to_regprocedure(object_identity)=${q('public.'+fn)}::regprocedure
   and definition_sha256=public.static_weekly_digest_text(
    pg_get_functiondef(${q('public.'+fn)}::regprocedure))`),'1');
 check('LUNCH receipt constraint recovery exact',sql(`select count(*) from public.custodial_release_authority_restore_inventory
  where object_kind='constraint' and object_identity='public.employee_native_push_delivery_receipts:native_location_payload_binding'
   and definition_sha256=public.static_weekly_digest_text(
    public.custodial_release_authority_current_constraint_definition(object_identity))`),'1');
 const canonical=value=>new Date(value).toISOString().replace(/\.(\d{3})Z$/,(_whole,fraction)=>'.'+fraction+'000Z');
 const plus=(value,ms)=>canonical(Date.parse(value)+ms);
 for(const [index,{event,job,atDue,permit}] of lunchPrepared.entries()){
  const outcome=event==='start'?'provider_accepted':'known_nonacceptance';
  const evidence={operation_id:permit.outcome_operation_id,outcome,
   provider_message_id:outcome==='provider_accepted'?'projects/synthetic-project/messages/lunch-original':null,
   error_code:outcome==='provider_accepted'?null:'synthetic_refusal'};
  const submitted=JSON.parse(sql(`select public.custodial_native_lunch_outcome_at(
   ${q(JSON.stringify(permit.binding))}::jsonb,${q(JSON.stringify(evidence))}::jsonb,
   ${q(plus(atDue,3000))}::timestamptz)::text`));
  check(`${event} exact original outcome admitted`,submitted.schema,'custodial.native-lunch-outcome-receipt.v1');
  check(`${event} outcome is never second dispatch`,submitted.dispatch_authorized,false);
  check(`${event} original outcome status`,JSON.parse(sql(`select public.custodial_native_lunch_outcome_status(
   ${q(JSON.stringify(permit.binding))}::jsonb)`)).provider_outcome,outcome);
  check(`${event} same operation replay`,JSON.parse(sql(`select public.custodial_native_lunch_outcome_at(
   ${q(JSON.stringify(permit.binding))}::jsonb,${q(JSON.stringify(evidence))}::jsonb,
   ${q(plus(atDue,4000))}::timestamptz)`)).replayed,true);
  reject(`${event} foreign outcome operation refused`,`select public.custodial_native_lunch_outcome_at(
   ${q(JSON.stringify(permit.binding))}::jsonb,
   ${q(JSON.stringify({...evidence,operation_id:id(150+index)}))}::jsonb,
   ${q(plus(atDue,5000))}::timestamptz)`,/original LUNCH dispatch outcome operation/);
  const body={schema:'custodial.native-provider-inventory-request.v1',scan_id:id(160+index),
   principal_digest:lunchExpected.principal_digest,device_id:lunchDeviceIdentifier,credential_id:lunchCredential,
   employee_id:lunchEmployee,assignment_epoch:1,generation_ids:[lunchGeneration],limit:32,
   cursor:null,ceiling:null,server_now:null};
  const inventory=JSON.parse(sql(`select public.custodial_native_location_inventory_at(
   ${q(lunchCredential)},${q(lunchCredentialHash)},${q(id(170+index))},${q('b'.repeat(64))},
   ${q(JSON.stringify(body))}::jsonb,${q(plus(atDue,6000))}::timestamptz)::text`));
  validateNativeLocationInventoryResponse(inventory,body);
  check(`${event} exact native inventory result`,inventory.data.rows.filter(r=>r.payload.receipt_job_id===job).length,
   event==='start'?1:0);
  if(event==='start')check('provider accepted is only provider outcome, not device receipt',
   inventory.data.rows.find(r=>r.payload.receipt_job_id===job).provider_outcome,'provider_accepted');
 }
 const start=lunchPrepared[0],admittedAt=plus(start.atDue,1000),observedAt=plus(start.atDue,2000),receivedAt=plus(start.atDue,4000);
 const original=start.permit.reservation.payload,recordId=hash(original.generation_id+'\n'+original.receipt_job_id+'\n'+original.notification_key);
 const observation=(instant,elapsed)=>({earliest_at:instant,latest_at:instant,clock_profile_id:'SYNTHETIC_ONLY_PC01',
  elapsed_realtime_ms:elapsed,boot_count:1});
 const nativeEvent=(action,eventId,when,elapsed)=>({schema:'custodial.native-provider-event.v2',event_id:eventId,
  record_id:recordId,action,
  ...Object.fromEntries(['generation_id','content_sha256','receipt_job_id','notification_key','receipt_credential_id',
   'receipt_employee_id','receipt_device_id','principal_digest','token_digest'].map(key=>[key,original[key]])),
  receipt_assignment_epoch:1,admission_bounds:observation(admittedAt,100),
  original_observation:observation(when,elapsed)});
 for(const [action,eventId,when,elapsed,nonce] of [
  ['received',id(180),admittedAt,100,id(182)],['acknowledged',id(181),observedAt,200,id(183)]]){
  const eventBody={schema:'custodial.native-provider-events.v2',events:[nativeEvent(action,eventId,when,elapsed)]};
  const receipt=JSON.parse(sql(`select public.custodial_native_provider_events_at(${q(lunchCredential)},
   ${q(lunchCredentialHash)},${q(nonce)},${q('b'.repeat(64))},${q(JSON.stringify(eventBody))}::jsonb,
   ${q(receivedAt)}::timestamptz)::text`));
  check(`typed LUNCH ${action} original interval receipt accepted`,receipt.data.results[0].admitted_state,'ACCEPTED');
 }
 check('LUNCH ACK never projects a location check',sql(`select count(*) from public.employee_native_location_ack_projections
  where job_id=${q(start.job)}`),'0');
 const revision=sql('select coalesce(max(authority_revision),0)+1 from public.weekly_schedule_authority_revisions');
 const staleAt=sql(`select ((${q(serviceDate+' 12:15:00')}::timestamp at time zone 'America/Chicago'))::text`);
 const currentLunchJob=lunchCases[0].job;
 const stale=sql(`begin;
  insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,operation,actor_manager_id,actor_manager_name_snapshot,content_digest)
  values(${revision},${q(id(88))},'mark_employee_departed',${q(manager)},'Synthetic target manager',repeat('d',64));
  insert into public.weekly_roster_slot_staffing_states(staffing_state_id,slot_id,employee_id,staffing_state,effective_start,
   authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
  values(${q(id(89))},${q(slots[0].id)},${q(employee)},'working',${q(serviceDate)},${revision},
   ${q(manager)},'Synthetic target manager','synthetic newer authority',repeat('e',64));
  ${lunchSlot===slots[0].id?'':`insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,
   operation,actor_manager_id,actor_manager_name_snapshot,content_digest)
   values(${Number(revision)+1},${q(id(107))},'mark_employee_departed',${q(manager)},
    'Synthetic target manager',repeat('f',64));
   insert into public.weekly_roster_slot_staffing_states(staffing_state_id,slot_id,
   employee_id,staffing_state,effective_start,authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
   values(${q(id(106))},${q(lunchSlot)},${q(lunchEmployee)},'working',${q(serviceDate)},${Number(revision)+1},
    ${q(manager)},'Synthetic target manager','synthetic newer lunch coverer authority',repeat('e',64));`}
  set role service_role;
  select public.custodial_native_target_source('SCHEDULE',${q(scheduleOccurrence)},${q(employee)},${q(generation)})->>'status';
  reset role;
  select public.custodial_native_target_source_at('LUNCH',${q(currentLunchJob)},${q(lunchEmployee)},${q(lunchGeneration)},${q(staleAt)}::timestamptz)->>'status';
  rollback;`).split('\n');
 check('newer staffing authority invalidates schedule source',stale[0],'SOURCE_STALE');
 check('newer staffing authority invalidates lunch source',stale[1],'SOURCE_STALE');
 // Test-only cross-repository bridge: preserve the actual SQL canonical wire,
 // independently read source/recipient expectations, and full replay provenance.
 // No provider token/credential secret or fabricated native admission is exported.
 if(process.env.NATIVE_LUNCH_WIRE_FIXTURE){
  const canonicalTime=value=>sql(`select to_char(${q(value)}::timestamptz at time zone 'UTC',
   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  const cases=lunchPrepared.map(({event,job,atDue,permit})=>{
   const source=lunchCases.find(item=>item.event===event).row.source;
   const intent=event==='start'?startIntent:endIntent;
   return {event,envelope:permit.reservation,expected:{...lunchExpected,
    receipt_job_id:job,notification_key:source.notification_key,projection_id:source.source_id,
    document_identity:source.source_digest,loan_id:source.loan_id,event:source.event,
    coverer_slot_id:source.coverer_slot_id,service_date:source.service_date,
    scheduled_time:intent.scheduled_time,scheduled_at:canonicalTime(source.valid_from),
    reservation_at:canonicalTime(atDue),valid_until:canonicalTime(source.valid_until)}};
  });
  const exported=writeNativeSqlFixture({envName:'NATIVE_LUNCH_WIRE_FIXTURE',fileName:'native-lunch-wire.json',
   payload:{schema:'custodial.native-lunch-sql-wire-fixture.v1',cases},manifest,
   owningMigration:'20261003194000_native_lunch_delivery.sql',
   scriptPath:'scripts/native-target-source-database-tests.mjs'});
  console.log('NATIVE_LUNCH_SQL_WIRE_EXPORTED',JSON.stringify(exported));
  // Parent-requested read-only diagnostic; never configure authority or repair
  // inventory to manufacture a successful health result in this fixture.
  try{
   console.log('CURRENT_AUTHORITY_HEALTH_DIAGNOSTIC',sql(`select public.custodial_backend_authority_health(null)::text`));
  }catch(error){
   console.log('CURRENT_AUTHORITY_HEALTH_DIAGNOSTIC_UNAVAILABLE',JSON.stringify({
    signature:'public.custodial_backend_authority_health(text)',authorityConfiguredByThisTest:false,
    detail:String(error.stderr).trim()}));
  }
  console.log('CURRENT_AUTHORITY_CATALOG_DIAGNOSTIC',sql(`select jsonb_build_object(
   'restore_counts',(select jsonb_object_agg(object_kind,n) from
    (select object_kind,count(*) n from public.custodial_release_authority_restore_inventory group by object_kind) counts),
   'canary_counts',(select jsonb_object_agg(object_kind,n) from
    (select object_kind,count(*) n from public.custodial_release_canary_authority_surface() group by object_kind) counts),
   'surface_uncovered',(select coalesce(jsonb_agg(s.object_identity order by s.object_kind,s.object_identity),'[]'::jsonb)
    from public.custodial_release_canary_authority_surface() s where not exists(select 1
     from public.custodial_release_authority_restore_inventory i where i.object_kind=s.object_kind and i.object_identity=s.object_identity)),
   'function_mismatches_only',(select coalesce(jsonb_agg(i.object_identity order by i.object_identity),'[]'::jsonb)
    from public.custodial_release_authority_restore_inventory i where i.object_kind='function'
     and to_regprocedure(i.object_identity) is not null and encode(extensions.digest(convert_to(
      pg_get_functiondef(to_regprocedure(i.object_identity)),'UTF8'),'sha256'),'hex')<>i.definition_sha256),
   'complete_authority_health',false)::text`));
 }
 console.log('NATIVE_TARGET_SOURCE_DATABASE_PASS',checks,JSON.stringify({migrations:manifest.length,manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),automaticGrants:false,production:false}));
}finally{cleanup()}
