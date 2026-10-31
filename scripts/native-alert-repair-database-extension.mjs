// Root-invoked extension only. Uses the existing owned fresh fixture, one
// rollback transaction and normal registration/source admission writers.
// No constructor, URL, provider, native build/review approval, socket or cleanup.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {validateNativeAlertPreparation,buildNativeAlertCandidate} from '../src/native-alert-two-stage.js';
import {validateNativeAlertReservation} from '../src/native-alert-reservation.js';
import {buildEmployeeEventReminderBody} from '../src/employee-notifications.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function run({fixture,pool,at,save,sourceCurrent,assertFrozen}) {
 assert.equal(typeof fixture?.assertOwned,'function');await fixture.assertOwned();
 assert.equal(fixture.receipt.selected_replay.migrations,303);
 assert.equal(pool.options.host,fixture.socketDirectory);assert.ok(fixture.socketDirectory?.startsWith('/'));
 for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL'])assert.equal(process.env[key],undefined,'No ambient target: '+key);
 sourceCurrent();assertFrozen();
 const checks=[],ids={device:randomUUID(),credential:randomUUID(),generation:randomUUID(),operation:randomUUID(),request:randomUUID(),thread:randomUUID(),sender:randomUUID(),message:randomUUID(),event:randomUUID(),instance:randomUUID(),eventJob:randomUUID(),eventLease:randomUUID()};
 const mark=(name,detail={})=>{const row={name,status:'PASS',...detail};checks.push(row);save('NATIVE_ALERT_SQL_CHECK_'+String(checks.length).padStart(3,'0')+'.json',row);};
 const c=await pool.connect();let rolledBack=false;
 try {
  await c.query('begin');await c.query("set local lock_timeout='5s'");await c.query("set local statement_timeout='60s'");
  const one=async(sql,args=[])=>{const r=await c.query(sql,args);assert.equal(r.rows.length,1,'Exactly one source/readback required: '+sql.slice(0,100));return r.rows[0];};
  const rpc=async(name,args)=>{assert.match(name,/^[a-z_]+$/);return (await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).result;};
  const date=(await one('select public.sch_service_date(statement_timestamp())::text as service_date')).service_date;assert.equal(date,at,'Root current Zoo day must remain current');
  // Select from the actually admitted roster. No invented employee availability
  // or schedule projections; the real reminder function must find a workday.
  const employee=await one(`select r.employee_id,e.display_name,u.id as user_id,s.scheduled_for
   from public.static_weekly_v6_read_roster($1::date) r
   join public.employees e on e.id=r.employee_id and e.active and e.employee_code ~ '^EMP[0-9]+$'
   join public.msg_users u on u.employee_id=e.id and u.is_active
   cross join lateral public.mz_event_reminder_schedule_candidate(jsonb_build_object(
    'event_date',$1::date,'status','SCHEDULED','needs_review',false,'audience_scope','all_working_employees'),e.id,'shift_plus_15') s
   order by e.employee_code limit 1`,[date]);
  const slot=await one(`select 'KIOSK_'||lpad(n::text,2,'0') as identifier from generate_series(2,10) n
   where not exists(select 1 from public.devices d where d.device_id='KIOSK_'||lpad(n::text,2,'0'))
   and not exists(select 1 from public.msg_device_assignments m where m.device_identifier='KIOSK_'||lpad(n::text,2,'0')) order by n limit 1`);
  await c.query('insert into public.devices(id,device_id,device_name,assigned_employee_id,active) values($1,$2,$3,$4,true)',[ids.device,slot.identifier,'Synthetic rollback native-alert SQL fixture',employee.employee_id]);
  const device=await one('select assignment_epoch from public.devices where id=$1',[ids.device]);
  await c.query('insert into public.msg_device_assignments(device_identifier,msg_user_id,is_active,notes) values($1,$2,true,$3)',[slot.identifier,employee.user_id,'Synthetic rollback native-alert recipient assignment']);
  assert.equal(await rpc('msg_is_runtime_user',[employee.user_id]),true,'Recipient must have a current active runtime Messenger assignment');
  const token='synthetic-native-token-no-provider-'+randomUUID(),credentialHash=hash('synthetic-credential-'+randomUUID());
  await c.query(`insert into public.device_auth_credentials(credential_id,device_id,token_hash,created_at,expires_at,confirmed_at)
   values($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '3 days',clock_timestamp()-interval '30 seconds')`,[ids.credential,ids.device,credentialHash]);
  const nativeApp={package_name:'org.memphiszoo.custodial',version_name:'synthetic-sql-fixture',version_code:1,build_id:'synthetic.custodial.0123456789ab'};
  const registration=await rpc('custodial_native_provider_registration',[ids.credential,credentialHash,ids.request,hash('synthetic SQL attestation, no native proof'),{
   schema:'custodial.native-provider-register.v1',operation_id:ids.operation,generation_id:ids.generation,credential_id:ids.credential,
   device_id:slot.identifier,employee_id:employee.employee_id,assignment_epoch:Number(device.assignment_epoch),native_app:nativeApp,
   principal_digest:hash('synthetic SQL principal'),token_digest:hash(token),token},false]);
  assert.equal(registration.admitted_state,'ACTIVE');assert.equal(registration.generation_id,ids.generation);
  mark('Actual registration writer creates synthetic current generation; no reviewed-release record or native acceptance',{deviceIdentifier:slot.identifier,generationId:ids.generation});
  await c.query("insert into public.msg_users(id,display_name,role,is_active) values($1,$2,'manager',true)",[ids.sender,'é'.repeat(91)]);
  assert.equal(await rpc('msg_is_runtime_user',[ids.sender]),true,'Synthetic sender must satisfy the actual current runtime-user predicate');
  await c.query("insert into public.msg_threads(id,thread_type,title,created_by_user_id) values($1,'direct','Synthetic rollback Unicode thread',$2)",[ids.thread,ids.sender]);
  await c.query('insert into public.msg_thread_participants(thread_id,user_id) values($1,$2),($1,$3)',[ids.thread,ids.sender,employee.user_id]);
  await c.query('insert into public.msg_messages(id,thread_id,sender_user_id,body) values($1,$2,$3,$4)',[ids.message,ids.thread,ids.sender,'é'.repeat(501)]);
  await c.query('insert into public.msg_receipts(message_id,user_id) values($1,$2) on conflict(message_id,user_id) do nothing',[ids.message,employee.user_id]);
  const msg=await one("select job_id,payload_json from public.operational_notification_jobs where job_key=$1",['employee-message-push:'+ids.message+':'+ids.credential]);
  assert.equal(msg.payload_json.body,'é'.repeat(501));assert.equal(msg.payload_json.title,'é'.repeat(91));
  const messageLease=randomUUID();await c.query("update public.operational_notification_jobs set status='leased',lease_token=$2,leased_at=clock_timestamp(),leased_until=clock_timestamp()+interval '3 days',worker_id='synthetic-no-provider' where job_id=$1",[msg.job_id,messageLease]);
  mark('Actual message enqueue trigger preserves full Unicode source body and title');
  async function stages(jobId,leaseToken,testAt=null,eventBody){
   const target=await rpc('custodial_native_alert_target_at',[jobId,leaseToken,testAt]);assert.equal(target.current,true);assert.equal(target.expected.generation_id,ids.generation);
   const raw=await rpc('custodial_native_alert_prepare_at',[jobId,leaseToken,target.expected,testAt]);
   const prepared=validateNativeAlertPreparation(raw,{jobId,leaseToken,expected:target.expected});
   const candidate=buildNativeAlertCandidate(prepared,{eventBody});
   return {jobId,leaseToken,testAt,expected:target.expected,prepared,candidate};
  }
  const final=async(s,candidate=s.candidate)=>rpc('custodial_native_alert_finalize_at',[s.jobId,s.leaseToken,s.prepared.prepared_id,s.expected,candidate,s.testAt]);
  const refuseAlteration=async(name,fn)=>{await c.query('savepoint negative');let error;try{await fn();}catch(e){error=e;}await c.query('rollback to savepoint negative');assert.ok(error,name);assert.ok(['42501','22023'].includes(error.code),error.code);mark(name,{code:error.code});};
  const m=await stages(msg.job_id,messageLease);assert.equal(m.prepared.source_projection.payload.body,msg.payload_json.body);
  assert.equal(m.candidate.body,'é'.repeat(500));assert.equal(m.candidate.title,'é'.repeat(90));
  await refuseAlteration('F14 SQL rejects unrelated bounded candidate text',()=>final(m,{...m.candidate,body:'unrelated'}));
  await c.query('savepoint ack_negative');await c.query('update public.msg_receipts set acknowledged_at=clock_timestamp() where message_id=$1 and user_id=$2',[ids.message,employee.user_id]);
  const ack=await final(m);assert.equal(ack.dispatch_authorized,false);assert.equal(ack.reason,'native_message_source_superseded');await c.query('rollback to savepoint ack_negative');mark('F14 original recipient ACK after prepare denies finalization');
  const mr=await final(m);const mp=m.prepared.source_projection;
  validateNativeAlertReservation(mr,{jobId:m.jobId,leaseToken:m.leaseToken,expected:m.expected,source:{kind:'MESSAGE',message_id:mp.message_id,thread_id:mp.thread_id,recipient_user_id:mp.recipient_user_id,source_revision:m.prepared.source_revision,valid_until:m.prepared.prepared_until}});
  assert.equal(mr.reservation.payload.body,m.candidate.body);assert.equal((await one('select body from public.msg_messages where id=$1',[ids.message])).body,'é'.repeat(501));
  mark('F14 actual prepare → JS candidate → SQL finalize → exact JS reservation validator; full original preserved');
  assert.equal((await final(m)).reason,'native_alert_original_finalization_no_resend');mark('F14 original finalization replay cannot resend');
  // Ongoing at the real SQL clock; finite test clock is at/after the genuine
  // shift+15 due instant. No scheduler rows or reviewed approvals are forged.
  const event=await one(`insert into public.events_app_events(id,event_name,event_date,end_date,start_time,end_time,event_scope,location_group_id,display_location,
   start_instant_utc,end_instant_utc,audience_scope,needs_review,attendee_count)
   values($1,$2,$3::date,$3::date+1,'00:00','23:59','OFFSITE',
    (select id from public.location_groups where group_code='OFFSITE'),$4,
    $3::date::timestamp at time zone 'America/Chicago',($3::date+1+time '23:59') at time zone 'America/Chicago','all_working_employees',false,25)
   returning *`,[ids.event,'漢'.repeat(180),date,'Known outside venue '+'😀'.repeat(240-'Known outside venue '.length)]);
  const schedule=await one('select * from public.mz_event_reminder_schedule($1,$2,$3,$4)',[ids.event,event.revision,employee.employee_id,'shift_plus_15']);
  const notificationKey=`event:${ids.event}:${event.revision}:${date}:${employee.employee_id}:${ids.device}:${device.assignment_epoch}:shift_plus_15`;
  await c.query(`insert into public.event_push_instances(instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,assignment_epoch,notification_kind,scheduled_for)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,'shift_plus_15',$10)`,[ids.instance,notificationKey,ids.event,event.revision,date,employee.employee_id,ids.device,ids.credential,device.assignment_epoch,schedule.scheduled_for]);
  await c.query(`insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,status,leased_at,leased_until,lease_token,worker_id,payload_json)
   values($1,$2,'employee_event_push',$3,'leased',clock_timestamp(),clock_timestamp()+interval '3 days',$4,'synthetic-no-provider',$5)`,[ids.eventJob,'synthetic-event:'+ids.instance,ids.instance,ids.eventLease,{employee_id:employee.employee_id,event_id:ids.event,notification_key:notificationKey}]);
  const clock=await one('select greatest(clock_timestamp(),$1::timestamptz+interval \'1 second\') as test_at',[schedule.scheduled_for]);
  const time=instant=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(instant));
  const e=await stages(ids.eventJob,ids.eventLease,clock.test_at,p=>buildEmployeeEventReminderBody({...p,start_time:time(p.start_instant_utc),end_time:time(p.end_instant_utc)},p.employee_name));
  assert.ok(Date.parse(e.prepared.source_projection.start_instant_utc)<=Date.parse(clock.test_at));assert.ok(Date.parse(e.prepared.source_projection.end_instant_utc)>Date.parse(clock.test_at));
  assert.equal(Date.parse(e.prepared.prepared_until),Date.parse(event.end_instant_utc));
  assert.equal(e.prepared.source_projection.event_name,event.event_name);assert.equal(e.prepared.source_projection.display_location,event.display_location);
  mark('F15 ongoing Event real current projection/claim/prepare and genuine current-day roster preserve source through end',{testClock:clock.test_at,scheduledFor:schedule.scheduled_for,preparedUntil:e.prepared.prepared_until});
  await refuseAlteration('F16 SQL rejects Event body missing source-bound title/location previews',()=>final(e,{...e.candidate,body:'unrelated'}));
  await c.query('savepoint audience_negative');await c.query("update public.events_app_events set audience_scope='specific_employees',audience_employee_ids='{}'::uuid[] where id=$1",[ids.event]);
  const audience=await final(e);assert.equal(audience.dispatch_authorized,false);await c.query('rollback to savepoint audience_negative');mark('F15 audience removal after prepare denies finalization');
  const er=await final(e),ep=e.prepared.source_projection;
  validateNativeAlertReservation(er,{jobId:e.jobId,leaseToken:e.leaseToken,expected:e.expected,source:{kind:'EVENT',event_id:ep.event_id,instance_id:ep.instance_id,event_revision:String(ep.event_revision),notification_kind:ep.notification_kind,source_revision:e.prepared.source_revision,valid_until:e.prepared.prepared_until}});
  assert.equal(Date.parse(er.reservation.payload.valid_until),Date.parse(event.end_instant_utc));assert.ok(Buffer.byteLength(er.reservation.payload.body)<=1000);
  mark('F15/F16 actual ongoing Unicode Event finalizes, validates exact wire and ends at current Event end');
  assert.equal((await final(e)).reason,'native_alert_original_finalization_no_resend');mark('F15 finalized Event cannot resend');
  const atEnd=await rpc('custodial_native_alert_finalize_at',[e.jobId,e.leaseToken,e.prepared.prepared_id,e.expected,e.candidate,event.end_instant_utc]);assert.equal(atEnd.dispatch_authorized,false);mark('F15 exact Event end cannot authorize dispatch');
  await c.query('rollback');rolledBack=true;
  const missing=await c.query('select (select count(*) from public.devices where id=$1)+(select count(*) from public.msg_messages where id=$2)+(select count(*) from public.events_app_events where id=$3) as n',[ids.device,ids.message,ids.event]);assert.equal(Number(missing.rows[0].n),0);mark('Exact synthetic device/message/event fixture absent after rollback');
 } finally {if(!rolledBack)await c.query('rollback').catch(()=>{});c.release();}
 sourceCurrent();assertFrozen();await fixture.assertOwned();
 const result={status:'PASS',checks,scope:'ACTUAL_ISOLATED_SQL_SOURCE_ADMISSION_AND_FINALIZATION_WITH_SYNTHETIC_NATIVE_REGISTRATION_NO_PROVIDER_OR_RELEASE_ACCEPTANCE',providerCalls:0,nativePhysicalAcceptance:false,reviewedReleaseApprovalInserted:false,rolledBack};save('NATIVE_ALERT_SQL_RESULT.json',result);return result;
}
