begin;

alter table public.devices
  add column if not exists assignment_epoch bigint not null default 1;

alter table public.devices
  add constraint devices_assignment_epoch_positive
  check (assignment_epoch > 0) not valid;
alter table public.devices validate constraint devices_assignment_epoch_positive;

alter table public.events_app_events
  add column if not exists audience_scope text not null default 'assigned_location',
  add column if not exists audience_employee_ids uuid[] not null default '{}'::uuid[];

alter table public.events_app_events
  add constraint events_app_events_audience_scope_check
  check (audience_scope in ('assigned_location','specific_employees','all_working_employees')) not valid;
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
  unique (credential_id,assignment_epoch),
  unique (token_hash)
);

create index if not exists idx_employee_push_registrations_active
  on public.employee_push_registrations(employee_id,device_id,assignment_epoch,last_seen_at desc)
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
       set status='cancelled',completed_at=now(),last_error='device_assignment_changed',updated_at=now()
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

comment on table public.employee_push_registrations is
  'Service-only FCM registrations bound to one device credential, employee assignment, and assignment epoch.';
comment on table public.event_push_instances is
  'Native employee event reminders. Provider acceptance is sent; ordinary swipe dismissal is local and not claimed as delivery proof.';

commit;
