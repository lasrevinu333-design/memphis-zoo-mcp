// Positive exact-instance projection proof against a real compiled, accepted
// static-weekly publication in an owned network-isolated replay database.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {buildEventStaticAuthoritySource,seedCompiledEventAuthority} from './fixtures/event-static-authority-fixture.mjs';

const container=process.env.CUSTODIAL_SYNTHETIC_EVENT_NOTIFY_DB;
assert.match(container??'',/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
const inspected=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspected.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspected.HostConfig.PortBindings??{}).length,0);
const q=value=>`'${String(value).replaceAll("'","''")}'`;
function sql(input){return execFileSync('docker',['exec','-e','PGPASSWORD=postgres','-i',container,'psql',
  '-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],
  {input,encoding:'utf8',timeout:120000,maxBuffer:16_000_000}).trim().split('\n').filter(Boolean).at(-1)||'';}
const manager='00000000-0000-4000-8000-000000000001';
const employee=randomUUID(),location=randomUUID(),group=randomUUID(),slot=randomUUID();
const device=randomUUID(),credential=randomUUID(),registration=randomUUID();
const event=randomUUID(),instance=randomUUID(),job=randomUUID(),lease=randomUUID();
const token='synthetic-event-notification-token-'+randomUUID();
const tokenHash=createHash('sha256').update(token).digest('hex');
const credentialHash=createHash('sha256').update('synthetic-credential-'+credential).digest('hex');
const dates=sql(`select ((public.sch_service_date(now())+
  ((8-extract(isodow from public.sch_service_date(now()))::integer)%7))::text)||'|'
  ||((public.sch_service_date(now())+
  ((8-extract(isodow from public.sch_service_date(now()))::integer)%7)+2)::text);`).split('|');
const [reminderDate,eventDate]=dates;
assert.match(reminderDate,/^\d{4}-\d\d-\d\d$/);
sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active)
  values(${q(location)}::uuid,'EVNPOS_LOC','Synthetic Event projection area','restroom','restroom',true);
  insert into public.location_groups(id,group_code,group_name,active)
  values(${q(group)}::uuid,'EVNPOS_GROUP','Synthetic Event projection family',true);
  insert into public.location_group_memberships(location_id,location_group_id,active)
  values(${q(location)}::uuid,${q(group)}::uuid,true);
  insert into public.employees(id,employee_code,display_name,active,role)
  values(${q(employee)}::uuid,'EVNPOS_EMP','Synthetic Event Employee',true,'staff');
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
  values(${q(device)}::uuid,'EVNPOS_DEVICE','Synthetic Event Device',true,${q(employee)}::uuid);`);
const source=buildEventStaticAuthoritySource({weekStart:reminderDate,
  employees:[{id:employee,slotId:slot,displayName:'Synthetic Event Employee'}],
  locationId:location,locationCode:'EVNPOS_GROUP',locationName:'Synthetic Event projection family',
  label:'event-notification-projection'});
await seedCompiledEventAuthority({sql,container,managerId:manager,dates:[reminderDate,eventDate],
  source,label:'event-notification-projection',mode:'official'});
sql(`insert into public.events_app_events(id,event_name,location_group_id,event_scope,primary_venue_id,venue_ids,
  display_location,event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,status,
  needs_review,audience_scope,notes,custodial_note_codes,custodial_public_notes)
  select ${q(event)}::uuid,'Synthetic accepted event',v.location_group_id,'SINGLE_VENUE',v.id,array[v.id],
    v.display_name,${q(eventDate)}::date,${q(eventDate)}::date,'10:00','11:00',
    (${q(eventDate)}::date+'10:00'::time) at time zone 'America/Chicago',
    (${q(eventDate)}::date+'11:00'::time) at time zone 'America/Chicago',
    'SCHEDULED',false,'all_working_employees','PRIVATE_MANAGER_NOTE',array['trash_boxes']::text[],
    'Public custodial preparation'
  from public.event_venues v where venue_code='CAT_HOUSE_CAFE';`);
const scheduledFor=sql(`select scheduled_for::text from public.mz_event_reminder_schedule(
  ${q(event)}::uuid,1,${q(employee)}::uuid,'two_days_before');`);
assert.ok(scheduledFor,'real accepted schedule must project employee reminder');
sql(`insert into public.device_auth_credentials
  (credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json)
  values(${q(credential)}::uuid,${q(device)}::uuid,${q(credentialHash)},'synthetic Event credential',
    now(),now()+interval '1 day','{}'::jsonb);
  insert into public.employee_push_registrations
  (registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash)
  values(${q(registration)}::uuid,${q(device)}::uuid,${q(credential)}::uuid,
    ${q(employee)}::uuid,1,'android',${q(token)},${q(tokenHash)});
  insert into public.operational_notification_jobs
  (job_id,job_key,job_type,source_id,status,leased_at,leased_until,lease_token,payload_json)
  values(${q(job)}::uuid,${q('event-notify-positive-'+job)},'employee_event_push',${q(instance)}::uuid,
    'leased',now(),now()+interval '2 minutes',${q(lease)}::uuid,
    jsonb_build_object('employee_id',${q(employee)}::uuid,'event_id',${q(event)}::uuid,
      'notification_key',${q('event-notify-positive-'+instance)}));
  insert into public.event_push_instances
  (instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
    assignment_epoch,notification_kind,scheduled_for,state,dispatch_job_id,dispatch_lease_token,
    dispatch_registration_id,dispatch_token_hash,dispatch_started_at)
  values(${q(instance)}::uuid,${q('event-notify-positive-'+instance)},${q(event)}::uuid,1,
    ${q(eventDate)}::date,${q(employee)}::uuid,${q(device)}::uuid,${q(credential)}::uuid,1,
    'two_days_before',${q(scheduledFor)}::timestamptz,'leased',${q(job)}::uuid,
    ${q(lease)}::uuid,${q(registration)}::uuid,${q(tokenHash)},now());`);
const read=()=>JSON.parse(sql(`set role service_role;select public.mz_employee_event_push_current_projection(
  ${q(job)}::uuid,${q(lease)}::uuid,${q(instance)}::uuid,${q(credential)}::uuid,1)::text;`));
const current=read();
assert.equal(current.current,true,JSON.stringify(current));
assert.equal(current.event_id,event);
assert.equal(current.employee_id,employee);
assert.equal(current.display_location,'Cat House Café');
assert.deepEqual(current.custodial_note_codes,['trash_boxes']);
assert.equal(current.custodial_public_notes,'Public custodial preparation');
assert.ok(!Object.hasOwn(current,'notes'));
assert.ok(!JSON.stringify(current).includes('PRIVATE_MANAGER_NOTE'));
assert.equal(JSON.parse(sql(`set role service_role;select public.mz_employee_event_push_current_projection(
  ${q(job)}::uuid,gen_random_uuid(),${q(instance)}::uuid,${q(credential)}::uuid,1)::text;`)).current,false);
const managerCredential=randomUUID(),managerToken='synthetic-manager-event-token-'+randomUUID();
const managerTokenHash=createHash('sha256').update(managerToken).digest('hex');
sql(`insert into public.ops_manager_trusted_devices
  (credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json)
  values(${q(managerCredential)}::uuid,${q('event-notify-manager-'+managerCredential)},
    'Synthetic Event Manager',${q('a'.repeat(64))},'full_access',${q(manager)}::uuid,
    now()+interval '1 day','{"synthetic":true}'::jsonb);
  insert into public.ops_manager_notification_preferences
  (credential_id,manager_id,event_reminders_enabled,event_reminder_time,event_lookahead_days)
  values(${q(managerCredential)}::uuid,${q(manager)}::uuid,true,'00:00',30);
  insert into public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
  values(${q(managerCredential)}::uuid,${q(manager)}::uuid,
    ${q('event-notify-manager-'+managerCredential)},'android',${q(managerToken)});`);
const enqueued=JSON.parse(sql(`select public.ops_manager_enqueue_scheduled_notifications(now())::text;`));
assert.ok(enqueued.enqueued>=1,'current Event digest must enqueue');
const digest=JSON.parse(sql(`select to_jsonb(q)::text from public.ops_manager_notification_queue q
  where q.credential_id=${q(managerCredential)}::uuid and q.notification_type='event_digest';`));
assert.equal(digest.data_json.next_event_id,event);
assert.equal(digest.data_json.next_event_revision,1);
assert.match(digest.body,/Cat House Café/);
assert.doesNotMatch(digest.body,/PRIVATE_MANAGER_NOTE|Public custodial preparation/);
const leased=JSON.parse(sql(`select to_jsonb(q)::text from public.ops_manager_claim_notification_jobs(
  'event-notify-manager-worker',10,120) q where q.queue_id=${q(digest.queue_id)}::uuid;`));
const pushDeviceId=sql(`select push_device_id::text from public.ops_manager_push_devices
  where credential_id=${q(managerCredential)}::uuid;`);
assert.equal(sql(`select public.ops_manager_notification_job_is_current(${q(digest.queue_id)}::uuid,
  ${q(leased.lease_token)}::uuid,${q(pushDeviceId)}::uuid,${q(managerTokenHash)});`),'t');
sql(`update public.event_venues set active=false where venue_code='CAT_HOUSE_CAFE';`);
assert.equal(read().current,false,'inactive legacy/Place venue must stop spoken read');
assert.equal(sql(`select public.ops_manager_notification_job_is_current(${q(digest.queue_id)}::uuid,
  ${q(leased.lease_token)}::uuid,${q(pushDeviceId)}::uuid,${q(managerTokenHash)});`),'f');
assert.equal(sql(`select (public.ops_manager_finish_notification_job(${q(digest.queue_id)}::uuid,
  ${q(leased.lease_token)}::uuid,${q(pushDeviceId)}::uuid,${q(managerTokenHash)},
  false,null,'synthetic drift',30,false)).status;`),'cancelled');
sql(`update public.event_venues set active=true where venue_code='CAT_HOUSE_CAFE';`);
assert.equal(read().current,true,'restored unchanged venue remains the same legacy identity');
sql(`update public.device_auth_credentials set revoked_at=now()
  where credential_id=${q(credential)}::uuid;`);
assert.equal(read().current,false,'revoked assigned credential must stop spoken read');
console.log('EVENT_NOTIFICATION_CURRENT_SCHEDULE_DB_PASS',JSON.stringify({
  checks:23,disposable_container:container,network:false,provider:false,production:false,
  reminder_date:reminderDate,event_date:eventDate}));
