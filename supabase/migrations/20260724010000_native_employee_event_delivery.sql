begin;

alter table public.devices
  add column if not exists assignment_epoch bigint not null default 1;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.devices'::regclass
      and conname = 'devices_assignment_epoch_positive'
  ) then
    alter table public.devices
      add constraint devices_assignment_epoch_positive
      check (assignment_epoch > 0) not valid;
  end if;
end
$constraints$;
alter table public.devices validate constraint devices_assignment_epoch_positive;

alter table public.events_app_events
  add column if not exists audience_scope text not null default 'assigned_location',
  add column if not exists audience_employee_ids uuid[] not null default '{}'::uuid[];

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events_app_events'::regclass
      and conname = 'events_app_events_audience_scope_check'
  ) then
    alter table public.events_app_events
      add constraint events_app_events_audience_scope_check
      check (audience_scope in ('assigned_location','specific_employees','all_working_employees')) not valid;
  end if;
end
$constraints$;
alter table public.events_app_events validate constraint events_app_events_audience_scope_check;

create table if not exists public.employee_push_registrations (
  registration_id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  credential_id uuid not null references public.device_auth_credentials(credential_id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  assignment_epoch bigint not null,
  provider text not null default 'fcm' check (provider='fcm'),
  platform text not null check (platform in ('android','ios')),
  fcm_token text not null,
  token_hash text not null,
  app_version text null,
  app_build text null,
  active boolean not null default true,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_successful_delivery_at timestamptz null,
  revoked_at timestamptz null,
  revoked_reason text null,
  last_error text null,
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json)='object'),
  updated_at timestamptz not null default now(),
  unique (credential_id,assignment_epoch)
);

create index if not exists idx_employee_push_registrations_active
  on public.employee_push_registrations(employee_id,device_id,assignment_epoch,last_seen_at desc)
  where active=true and revoked_at is null;
create unique index if not exists uq_employee_push_registrations_active_token
  on public.employee_push_registrations(token_hash)
  where active=true and revoked_at is null;

create table if not exists public.event_push_instances (
  instance_id uuid primary key default gen_random_uuid(),
  notification_key text not null unique,
  event_id uuid not null references public.events_app_events(id) on delete cascade,
  event_revision integer not null,
  service_date date not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  credential_id uuid not null references public.device_auth_credentials(credential_id) on delete cascade,
  assignment_epoch bigint not null,
  notification_kind text not null check (notification_kind in ('day_before','shift_plus_15')),
  scheduled_for timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending','leased','sent','failed','cancelled','opened')),
  provider_message_id text null,
  sent_at timestamptz null,
  opened_at timestamptz null,
  cancelled_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,event_revision,service_date,employee_id,device_id,assignment_epoch,notification_kind)
);

create index if not exists idx_event_push_instances_ready
  on public.event_push_instances(state,scheduled_for,created_at)
  where state in ('pending','leased');

alter table public.employee_push_registrations enable row level security;
alter table public.employee_push_registrations force row level security;
alter table public.event_push_instances enable row level security;
alter table public.event_push_instances force row level security;
revoke all on public.employee_push_registrations from public,anon,authenticated;
revoke all on public.event_push_instances from public,anon,authenticated;
grant select,insert,update,delete on public.employee_push_registrations to postgres,service_role;
grant select,insert,update,delete on public.event_push_instances to postgres,service_role;

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
     where job_type='employee_event_push'
       and status in ('pending','leased')
       and payload_json->>'device_id'=old.id::text;
  end if;
  return new;
end
$function$;

revoke all on function public.mz_revoke_stale_employee_push_registrations() from public,anon,authenticated;
drop trigger if exists trg_devices_assignment_epoch on public.devices;
create trigger trg_devices_assignment_epoch
before update of assigned_employee_id on public.devices
for each row execute function public.mz_revoke_stale_employee_push_registrations();

create or replace function public.mz_register_employee_push(
  p_credential_id uuid,
  p_token text,
  p_token_hash text,
  p_platform text,
  p_app_version text default null,
  p_app_build text default null
) returns public.employee_push_registrations
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_device public.devices%rowtype;
  v_result public.employee_push_registrations%rowtype;
begin
  select d.* into v_device
    from public.device_auth_credentials c
    join public.devices d on d.id=c.device_id
   where c.credential_id=p_credential_id
     and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>now()
     and d.active=true
   for update of d;
  if v_device.id is null or v_device.assigned_employee_id is null then
    raise exception using errcode='42501',message='Credential is not assigned to an active employee device.';
  end if;
  if p_platform not in ('android','ios') or length(btrim(coalesce(p_token,'')))<20 then
    raise exception using errcode='22023',message='A valid FCM token and platform are required.';
  end if;

  update public.employee_push_registrations
     set active=false,revoked_at=now(),revoked_reason='token_rotated',updated_at=now()
   where device_id=v_device.id and active=true and revoked_at is null
     and (credential_id<>p_credential_id or assignment_epoch<>v_device.assignment_epoch or token_hash<>p_token_hash);

  insert into public.employee_push_registrations(
    device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash,
    app_version,app_build,active,registered_at,last_seen_at,revoked_at,revoked_reason,last_error,updated_at
  ) values (
    v_device.id,p_credential_id,v_device.assigned_employee_id,v_device.assignment_epoch,p_platform,p_token,p_token_hash,
    nullif(left(coalesce(p_app_version,''),80),''),nullif(left(coalesce(p_app_build,''),120),''),
    true,now(),now(),null,null,null,now()
  )
  on conflict(credential_id,assignment_epoch) do update set
    employee_id=excluded.employee_id,platform=excluded.platform,fcm_token=excluded.fcm_token,
    token_hash=excluded.token_hash,app_version=excluded.app_version,app_build=excluded.app_build,
    active=true,registered_at=now(),last_seen_at=now(),revoked_at=null,revoked_reason=null,last_error=null,updated_at=now()
  returning * into v_result;
  return v_result;
end
$function$;

revoke all on function public.mz_register_employee_push(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mz_register_employee_push(uuid,text,text,text,text,text) to postgres,service_role;

create or replace function public.mz_mark_employee_event_opened(
  p_credential_id uuid,
  p_notification_key text
) returns public.event_push_instances
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_result public.event_push_instances%rowtype;
begin
  update public.event_push_instances i
     set state='opened',opened_at=coalesce(opened_at,now()),updated_at=now()
   where i.notification_key=p_notification_key and i.credential_id=p_credential_id
     and i.state in ('sent','opened')
  returning * into v_result;
  if v_result.instance_id is null then
    raise exception using errcode='P0002',message='Notification was not found for this device credential.';
  end if;
  return v_result;
end
$function$;

revoke all on function public.mz_mark_employee_event_opened(uuid,text) from public,anon,authenticated;
grant execute on function public.mz_mark_employee_event_opened(uuid,text) to postgres,service_role;

create or replace function public.mz_enqueue_employee_event_pushes(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_inserted integer:=0;
begin
  with recipients as (
    select distinct
      e.id event_id,e.revision event_revision,e.event_date service_date,
      emp.id employee_id,d.id device_id,d.assignment_epoch,c.credential_id,
      e.event_name,e.display_location,r.shift_start
    from public.events_app_events e
    join public.employees emp on emp.active=true and (
      (e.audience_scope='specific_employees' and emp.id=any(e.audience_employee_ids))
      or (e.audience_scope='all_working_employees' and exists (
        select 1 from public.daily_work_roster rw
        where rw.service_date=e.event_date and rw.employee_id=emp.id and rw.active=true
      ))
      or (e.audience_scope='assigned_location' and exists (
        select 1 from public.daily_group_assignments ga
        where ga.assignment_date=e.event_date and ga.location_group_id=e.location_group_id
          and ga.assigned_employee_id=emp.id and ga.active=true and ga.is_coverall=false
      ))
    )
    join public.daily_work_roster r
      on r.service_date=e.event_date and r.employee_id=emp.id and r.active=true
    join public.devices d
      on d.assigned_employee_id=emp.id and d.active=true
    join public.device_auth_credentials c
      on c.device_id=d.id and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>p_now
    join public.employee_push_registrations pr
      on pr.device_id=d.id and pr.credential_id=c.credential_id and pr.employee_id=emp.id
     and pr.assignment_epoch=d.assignment_epoch and pr.active=true and pr.revoked_at is null
    where e.status='SCHEDULED' and e.archived_at is null and e.cancelled_at is null
      and e.event_date between ((p_now at time zone 'America/Chicago')::date - 1)
                           and ((p_now at time zone 'America/Chicago')::date + 60)
  ), reminders as (
    select recipients.*,'day_before'::text notification_kind,
      ((service_date-1)::text||' 08:00:00 America/Chicago')::timestamptz scheduled_for
    from recipients
    union all
    select recipients.*,'shift_plus_15'::text,
      (service_date::text||' '||shift_start::text||' America/Chicago')::timestamptz + interval '15 minutes'
    from recipients
  ), inserted as (
    insert into public.event_push_instances(
      notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
      assignment_epoch,notification_kind,scheduled_for
    )
    select
      'event:'||event_id||':'||event_revision||':'||service_date||':'||employee_id||':'||device_id||':'||assignment_epoch||':'||notification_kind,
      event_id,event_revision,service_date,employee_id,device_id,credential_id,
      assignment_epoch,notification_kind,scheduled_for
    from reminders
    on conflict(event_id,event_revision,service_date,employee_id,device_id,assignment_epoch,notification_kind) do nothing
    returning *
  )
  insert into public.operational_notification_jobs(job_key,job_type,source_id,available_at,payload_json)
  select
    'employee-event-push:'||i.notification_key,
    'employee_event_push',
    i.instance_id,
    i.scheduled_for,
    jsonb_build_object(
      'instance_id',i.instance_id,'notification_key',i.notification_key,'event_id',i.event_id,
      'employee_id',i.employee_id,'device_id',i.device_id,'credential_id',i.credential_id,
      'assignment_epoch',i.assignment_epoch,'notification_kind',i.notification_kind
    )
  from inserted i
  on conflict(job_key) do nothing;
  get diagnostics v_inserted=row_count;

  update public.event_push_instances i
     set state='cancelled',cancelled_at=now(),last_error='event_or_assignment_superseded',updated_at=now()
   where i.state in ('pending','leased') and not exists (
     select 1 from public.events_app_events e
     join public.devices d on d.id=i.device_id
     join public.device_auth_credentials c on c.credential_id=i.credential_id
     join public.employee_push_registrations pr
       on pr.credential_id=i.credential_id and pr.assignment_epoch=i.assignment_epoch
      and pr.employee_id=i.employee_id and pr.active=true and pr.revoked_at is null
     where e.id=i.event_id and e.revision=i.event_revision and e.status='SCHEDULED'
       and e.cancelled_at is null and d.active=true and d.assigned_employee_id=i.employee_id
       and d.assignment_epoch=i.assignment_epoch and c.revoked_at is null and c.expires_at>p_now
   );

  update public.operational_notification_jobs j
     set status='dead',completed_at=now(),last_error='event_or_assignment_superseded',updated_at=now()
   where j.job_type='employee_event_push' and j.status in ('pending','leased')
     and exists (
       select 1 from public.event_push_instances i
       where i.instance_id=j.source_id and i.state='cancelled'
     );

  return jsonb_build_object('ok',true,'enqueued',v_inserted,'checked_at',p_now);
end
$function$;

revoke all on function public.mz_enqueue_employee_event_pushes(timestamptz) from public,anon,authenticated;
grant execute on function public.mz_enqueue_employee_event_pushes(timestamptz) to postgres,service_role;

comment on table public.employee_push_registrations is
  'Service-only FCM registrations bound to one device credential, employee assignment, and assignment epoch.';
comment on table public.event_push_instances is
  'Native employee event reminders. Provider acceptance is sent; ordinary swipe dismissal is local and not claimed as delivery proof.';

commit;
