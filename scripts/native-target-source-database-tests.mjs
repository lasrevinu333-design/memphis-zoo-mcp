import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {seedCompiledEventAuthority,eventAuthorityWeekStart} from './fixtures/event-static-authority-fixture.mjs';
import {nativeLocationAuthoritySource} from './fixtures/native-location-authority.mjs';
import {createStaticWeeklyProjectionWithLunchRpcInput} from '../src/static-weekly-lunch-publication.js';

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
const files=readdirSync('supabase/migrations').filter(file=>file.endsWith('.sql')).sort(),manifest=[];
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
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const token='synthetic-target-source-fcm-token-0001',tokenHash=hash(token);
 sql(`insert into public.employees(id,employee_code,display_name,role,active)
  values(${q(employee)},'EMP994','Synthetic target employee','staff',true);
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
  values(${q(device)},'KIOSK_08','Synthetic target phone',true,${q(employee)},1);
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
  values(${q(credential)},${q(device)},repeat('c',64),now()-interval '1 day',now()+interval '1 day');
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
 const serviceDate=sql('select public.sch_service_date(statement_timestamp())::text');
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
 sql(`set role service_role;select public.mz_enqueue_employee_lunch_coverage_pushes(
  (${q(serviceDate+' 12:15:00')}::timestamp at time zone 'America/Chicago'));`);
 const lunchJob=(event)=>sql(`select job_id from public.operational_notification_jobs
  where job_type='employee_native_push' and payload_json#>>'{data_json,kind}'='employee_lunch_coverage'
   and payload_json->>'employee_id'=${q(employee)} and payload_json#>>'{data_json,event}'=${q(event)}
   and status='pending' order by job_id limit 1`);
 const at=(job,date)=>JSON.parse(sql(`select public.custodial_native_target_source_at('LUNCH',${q(job)},${q(employee)},${q(generation)},${q(date)}::timestamptz)::text`));
 for(const event of ['start','end']){
  const job=lunchJob(event);assert.ok(job,`real lunch producer created ${event} intent for current coverer`);
  const scheduled=sql(`select payload_json#>>'{data_json,scheduled_at}' from public.operational_notification_jobs where job_id=${q(job)}`);
  const atDue=new Date(Date.parse(scheduled)+60000).toISOString();
  row=at(job,atDue);
  check(`${event} accepted lunch source`,row.status,'CURRENT_SOURCE_ONLY');
  check(`${event} exact existing delivery occurrence`,row.source.delivery_occurrence_id,job);
  check(`${event} current projection source`,row.source.source_id,projection);
  check(`${event} private original notification key`,row.source.notification_key.length,64);
  check(`${event} no provider admission`,row.delivery_admitted,false);
  check(`${event} exact expiry boundary`,at(job,row.source.valid_until).status,'SOURCE_EXPIRED');
   check(`${event} stale document digest refused`,sql(`begin;update public.operational_notification_jobs
   set payload_json=jsonb_set(payload_json,'{data_json,document_identity}',to_jsonb(repeat('f',64))) where job_id=${q(job)};
   select public.custodial_native_target_source_at('LUNCH',${q(job)},${q(employee)},${q(generation)},${q(atDue)}::timestamptz)->>'status';rollback;`).split('\n')[0],'SOURCE_STALE');
 }
 const revision=sql('select coalesce(max(authority_revision),0)+1 from public.weekly_schedule_authority_revisions');
 const staleAt=sql(`select ((${q(serviceDate+' 12:15:00')}::timestamp at time zone 'America/Chicago'))::text`);
 const currentLunchJob=lunchJob('start');
 const stale=sql(`begin;
  insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,operation,actor_manager_id,actor_manager_name_snapshot,content_digest)
  values(${revision},${q(id(88))},'mark_employee_departed',${q(manager)},'Synthetic target manager',repeat('d',64));
  insert into public.weekly_roster_slot_staffing_states(staffing_state_id,slot_id,employee_id,staffing_state,effective_start,
   authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
  values(${q(id(89))},${q(slots[0].id)},${q(employee)},'working',${q(serviceDate)},${revision},
   ${q(manager)},'Synthetic target manager','synthetic newer authority',repeat('e',64));
  set role service_role;
  select public.custodial_native_target_source('SCHEDULE',${q(scheduleOccurrence)},${q(employee)},${q(generation)})->>'status';
  reset role;
  select public.custodial_native_target_source_at('LUNCH',${q(currentLunchJob)},${q(employee)},${q(generation)},${q(staleAt)}::timestamptz)->>'status';
  rollback;`).split('\n');
 check('newer staffing authority invalidates schedule source',stale[0],'SOURCE_STALE');
 check('newer staffing authority invalidates lunch source',stale[1],'SOURCE_STALE');
 console.log('NATIVE_TARGET_SOURCE_DATABASE_PASS',checks,JSON.stringify({migrations:manifest.length,manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),automaticGrants:false,production:false}));
}finally{cleanup()}
