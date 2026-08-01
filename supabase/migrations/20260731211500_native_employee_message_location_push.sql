begin;

-- Custodial phones use one assignment-bound FCM registration for every native
-- notification. Messenger inserts and current location state feed the same
-- durable operational outbox already used by event reminders.
create or replace function public.mz_enqueue_employee_message_push()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  if new.is_deleted=true then return new; end if;

  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,available_at,payload_json
  )
  select
    'employee-message-push:'||new.id::text||':'||pr.credential_id::text,
    'employee_native_push',
    new.id,
    now(),
    jsonb_build_object(
      'credential_id',pr.credential_id,
      'employee_id',recipient.employee_id,
      'device_id',d.id,
      'device_identifier',d.device_id,
      'assignment_epoch',d.assignment_epoch,
      'channel_id','employee-messages',
      'title',coalesce(nullif(sender.display_name,''),'Memphis Zoo'),
      'body',left(coalesce(nullif(regexp_replace(new.body,'[[:space:]]+',' ','g'),''),'New message'),1000),
      'data_json',jsonb_build_object(
        'kind','employee_message',
        'notification_type','message',
        'notification_key','message:'||new.id::text,
        'thread_id',new.thread_id::text,
        'message_id',new.id::text,
        'route','messages.html?hub=employee&thread_id='||new.thread_id::text,
        'sender_name',coalesce(nullif(sender.display_name,''),'Memphis Zoo'),
        'thread_title',coalesce(nullif(thread.title,''),'Conversation')
      )
    )
  from public.msg_thread_participants participant
  join public.msg_users recipient
    on recipient.id=participant.user_id
   and recipient.employee_id is not null
   and recipient.is_active=true
  join public.employees employee
    on employee.id=recipient.employee_id
   and employee.active=true
  join public.employee_push_registrations pr
    on pr.employee_id=recipient.employee_id
   and pr.active=true
   and pr.revoked_at is null
  join public.devices d
    on d.id=pr.device_id
   and d.assigned_employee_id=recipient.employee_id
   and d.assignment_epoch=pr.assignment_epoch
   and d.active=true
  join public.device_auth_credentials credential
    on credential.credential_id=pr.credential_id
   and credential.device_id=d.id
   and credential.confirmed_at is not null
   and credential.revoked_at is null
   and credential.expires_at>now()
  left join public.msg_users sender on sender.id=new.sender_user_id
  left join public.msg_threads thread on thread.id=new.thread_id
  where participant.thread_id=new.thread_id
    and participant.left_at is null
    and participant.user_id<>new.sender_user_id
  on conflict(job_key) do nothing;

  return new;
end
$function$;

revoke all on function public.mz_enqueue_employee_message_push() from public,anon,authenticated;
drop trigger if exists trg_mz_enqueue_employee_message_push on public.msg_messages;
create trigger trg_mz_enqueue_employee_message_push
after insert on public.msg_messages
for each row execute function public.mz_enqueue_employee_message_push();

create or replace function public.mz_enqueue_employee_location_pushes(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_service_date date:=(p_now at time zone 'America/Chicago')::date;
  v_inserted integer:=0;
begin
  with targets as (
    select
      pr.credential_id,pr.employee_id,pr.device_id,pr.assignment_epoch,
      d.device_id as device_identifier
    from public.employee_push_registrations pr
    join public.devices d
      on d.id=pr.device_id
     and d.assigned_employee_id=pr.employee_id
     and d.assignment_epoch=pr.assignment_epoch
     and d.active=true
    join public.employees employee on employee.id=pr.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=pr.credential_id
     and credential.device_id=d.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where pr.active=true and pr.revoked_at is null
  ), assigned_locations as (
    select distinct on (target.credential_id,location.id)
      target.*,
      schedule.location_group_id,schedule.group_code,schedule.group_name,
      coalesce(schedule.coverage_purpose,'area_owner') as coverage_purpose,
      location.id as location_id,location.location_code,location.location_name,location.form_type
    from targets target
    join lateral public.sch_get_daily_schedule_with_purpose(v_service_date) schedule
      on schedule.assigned_employee_id=target.employee_id
     and coalesce(schedule.coverage_purpose,'area_owner')<>'reminder'
    join public.location_group_memberships membership
      on membership.location_group_id=schedule.location_group_id
     and membership.active=true
    join public.locations location on location.id=membership.location_id and location.active=true
    order by target.credential_id,location.id,schedule.group_name,schedule.group_code
  ), candidates as (
    select
      assigned.*,
      status.status_code,
      ('location-status:'||v_service_date::text||':'||assigned.location_id::text||':'||status.status_code||':'||
        coalesce(to_char(status.latest_completed_at at time zone 'UTC','YYYYMMDDHH24MISSUS'),'never')) as notification_key
    from assigned_locations assigned
    join public.v_location_dashboard_status status on status.location_id=assigned.location_id
    where status.status_code in ('due_soon','overdue')
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,available_at,payload_json
  )
  select
    'employee-location-push:'||candidate.notification_key||':'||candidate.credential_id::text,
    'employee_native_push',
    candidate.location_id,
    p_now,
    jsonb_build_object(
      'credential_id',candidate.credential_id,
      'employee_id',candidate.employee_id,
      'device_id',candidate.device_id,
      'device_identifier',candidate.device_identifier,
      'assignment_epoch',candidate.assignment_epoch,
      'channel_id',case when candidate.status_code='overdue' then 'employee-overdue' else 'employee-due-soon' end,
      'title',candidate.location_name||case when candidate.status_code='overdue' then ' is overdue' else ' is due soon' end,
      'body',candidate.location_name||case when candidate.status_code='overdue'
        then ' on your assigned route needs attention now.'
        else ' on your assigned route is approaching its cleaning window.' end,
      'data_json',jsonb_build_object(
        'kind','employee_location_status',
        'notification_type','location_status',
        'notification_key',candidate.notification_key,
        'status_code',candidate.status_code,
        'service_date',v_service_date::text,
        'location_id',candidate.location_id::text,
        'location_code',candidate.location_code,
        'location_name',candidate.location_name,
        'form_type',candidate.form_type,
        'group_code',candidate.group_code,
        'group_name',candidate.group_name,
        'route','employee-schedule.html?hub=employee&highlight='||
          replace(replace(coalesce(candidate.location_code,''),'%','%25'),' ','%20')
      )
    )
  from candidates candidate
  where not exists (
    select 1
    from public.device_notification_acknowledgements acknowledgement
    where upper(btrim(acknowledgement.device_identifier))=upper(btrim(candidate.device_identifier))
      and acknowledgement.notification_key=candidate.notification_key
      and acknowledgement.acknowledged_at is not null
  )
  on conflict(job_key) do nothing;
  get diagnostics v_inserted=row_count;

  update public.operational_notification_jobs job
     set status='dead',completed_at=now(),last_error='employee_assignment_or_notification_superseded',updated_at=now()
   where job.job_type='employee_native_push'
     and job.status in ('pending','leased')
     and (
       not exists (
         select 1
         from public.employee_push_registrations registration
         join public.devices device on device.id=registration.device_id
         join public.device_auth_credentials credential on credential.credential_id=registration.credential_id
         where registration.credential_id=(job.payload_json->>'credential_id')::uuid
           and registration.assignment_epoch=(job.payload_json->>'assignment_epoch')::bigint
           and registration.active=true and registration.revoked_at is null
           and device.id=registration.device_id and device.active=true
           and device.assigned_employee_id=registration.employee_id
           and device.assignment_epoch=registration.assignment_epoch
           and credential.device_id=device.id and credential.confirmed_at is not null
           and credential.revoked_at is null and credential.expires_at>p_now
       )
       or (
         job.payload_json->'data_json'->>'notification_type'='location_status'
         and exists (
           select 1 from public.device_notification_acknowledgements acknowledgement
           where upper(btrim(acknowledgement.device_identifier))=
                 upper(btrim(job.payload_json->>'device_identifier'))
             and acknowledgement.notification_key=job.payload_json->'data_json'->>'notification_key'
             and acknowledgement.acknowledged_at is not null
         )
       )
     );

  return jsonb_build_object('ok',true,'enqueued',v_inserted,'service_date',v_service_date,'checked_at',p_now);
end
$function$;

revoke all on function public.mz_enqueue_employee_location_pushes(timestamptz) from public,anon,authenticated;
grant execute on function public.mz_enqueue_employee_location_pushes(timestamptz) to postgres,service_role;

-- Assignment rotation must cancel every employee-native job, not only event
-- reminders. This preserves the same fail-closed assignment epoch boundary.
create or replace function public.mz_revoke_stale_employee_push_registrations()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  if new.assigned_employee_id is distinct from old.assigned_employee_id then
    new.assignment_epoch := old.assignment_epoch + 1;
    update public.employee_push_registrations
       set active=false,revoked_at=now(),revoked_reason='assignment_epoch_rotated',updated_at=now()
     where device_id=old.id and active=true and revoked_at is null;
    update public.event_push_instances
       set state='cancelled',cancelled_at=now(),last_error='device_assignment_changed',updated_at=now()
     where device_id=old.id and state in ('pending','leased');
    update public.operational_notification_jobs
       set status='dead',completed_at=now(),last_error='device_assignment_changed',updated_at=now()
     where job_type in ('employee_event_push','employee_native_push')
       and status in ('pending','leased')
       and payload_json->>'device_id'=old.id::text;
  end if;
  return new;
end
$function$;

revoke all on function public.mz_revoke_stale_employee_push_registrations() from public,anon,authenticated;

comment on function public.mz_enqueue_employee_message_push() is
  'Queues one durable native FCM job per active employee recipient and assignment-bound app registration.';
comment on function public.mz_enqueue_employee_location_pushes(timestamptz) is
  'Queues due-soon and overdue FCM jobs from the same authoritative schedule and dashboard status used by the employee UI.';

commit;
