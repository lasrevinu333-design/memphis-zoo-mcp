-- Memphis Zoo custodial foundation release: scheduler readiness, canonical device
-- identity, durable notification acknowledgement, event single-flight delivery,
-- device queue telemetry, and authoritative server-side GPS proximity.
--
-- This migration is idempotent. Public/anon/authenticated access is revoked from
-- every internal table and mutating RPC introduced here; Render uses service_role.

create table if not exists public.device_aliases (
  alias_identifier text primary key,
  canonical_device_id uuid not null references public.devices(id) on delete cascade,
  active boolean not null default true,
  source text not null default 'migration',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.device_aliases(alias_identifier, canonical_device_id, active, source, updated_at)
select alias_device.device_id, canonical_device.id, true, 'assigned_employee_match', now()
from public.devices alias_device
join public.devices canonical_device
  on canonical_device.assigned_employee_id = alias_device.assigned_employee_id
 and canonical_device.active = true
 and canonical_device.device_id ~* '^KIOSK_(0[2-9]|10)$'
where alias_device.active = true
  and alias_device.assigned_employee_id is not null
  and alias_device.id <> canonical_device.id
  and alias_device.device_id !~* '^KIOSK_(0[2-9]|10)$'
on conflict(alias_identifier) do update
set canonical_device_id = excluded.canonical_device_id,
    active = true,
    source = excluded.source,
    updated_at = now();

alter table public.device_aliases enable row level security;
revoke all on table public.device_aliases from public, anon, authenticated;
grant select, insert, update, delete on table public.device_aliases to service_role;

create table if not exists public.device_sync_status (
  device_id uuid primary key references public.devices(id) on delete cascade,
  presented_identifier text null,
  queue_count integer not null default 0,
  oldest_item_at timestamptz null,
  retry_count integer not null default 0,
  last_server_ack_at timestamptz null,
  frontend_version text null,
  last_error text null,
  correlation_id text null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_device_sync_status_attention
  on public.device_sync_status(queue_count, oldest_item_at) where queue_count > 0;
create index if not exists idx_device_sync_status_updated_at
  on public.device_sync_status(updated_at desc);
alter table public.device_sync_status enable row level security;
revoke all on table public.device_sync_status from public, anon, authenticated;
grant select, insert, update, delete on table public.device_sync_status to service_role;

create or replace function public.tool_report_device_sync_status(
  p_device_identifier text,
  p_queue_count integer,
  p_oldest_item_at timestamptz,
  p_retry_count integer,
  p_last_server_ack_at timestamptz,
  p_frontend_version text,
  p_last_error text,
  p_correlation_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_device public.devices%rowtype;
begin
  select d.* into v_device
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active = true
  where upper(btrim(da.alias_identifier)) = upper(btrim(p_device_identifier))
    and da.active = true
  limit 1;

  if not found then
    select d.* into v_device
    from public.devices d
    where upper(btrim(d.device_id)) = upper(btrim(p_device_identifier))
      and d.active = true
    limit 1;
  end if;

  if v_device.id is null then raise exception 'Active device not found.'; end if;

  insert into public.device_sync_status(
    device_id, presented_identifier, queue_count, oldest_item_at, retry_count,
    last_server_ack_at, frontend_version, last_error, correlation_id, updated_at
  ) values (
    v_device.id,
    btrim(p_device_identifier),
    greatest(0, coalesce(p_queue_count, 0)),
    p_oldest_item_at,
    greatest(0, coalesce(p_retry_count, 0)),
    p_last_server_ack_at,
    nullif(btrim(coalesce(p_frontend_version, '')), ''),
    left(nullif(coalesce(p_last_error, ''), ''), 1000),
    nullif(btrim(coalesce(p_correlation_id, '')), ''),
    now()
  )
  on conflict(device_id) do update set
    presented_identifier = excluded.presented_identifier,
    queue_count = excluded.queue_count,
    oldest_item_at = excluded.oldest_item_at,
    retry_count = excluded.retry_count,
    last_server_ack_at = excluded.last_server_ack_at,
    frontend_version = excluded.frontend_version,
    last_error = excluded.last_error,
    correlation_id = excluded.correlation_id,
    updated_at = now();

  return jsonb_build_object('ok', true, 'device_id', v_device.device_id, 'updated_at', now());
end
$function$;
revoke all on function public.tool_report_device_sync_status(text,integer,timestamptz,integer,timestamptz,text,text,text) from public, anon, authenticated;
grant execute on function public.tool_report_device_sync_status(text,integer,timestamptz,integer,timestamptz,text,text,text) to service_role;

create or replace function public.run_application_write(p_name text, p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_sql text := btrim(coalesce(p_sql, ''));
  v_lower text;
  v_result jsonb;
begin
  if v_name is null then raise exception 'Application write name is required'; end if;
  if v_sql = '' then raise exception 'Application write SQL is required'; end if;
  if length(v_sql) > 1000000 then raise exception 'Application write SQL exceeds 1 MB'; end if;
  v_lower := lower(v_sql);
  if v_lower ~ '^\s*(begin|commit|rollback|savepoint|prepare|vacuum|reindex|cluster|copy|alter\s+system|create\s+extension|drop\s+database|drop\s+schema)' then
    raise exception 'Transaction, maintenance, extension, and destructive database-control statements are not accepted by run_application_write';
  end if;

  if v_lower ~ '^\s*(insert|update|delete|select|with)\b'
     and v_lower like '% returning %'
     and position(';' in regexp_replace(v_sql, ';\s*$', '')) = 0 then
    execute format(
      'with _application_rows as (%s) select coalesce(jsonb_agg(to_jsonb(_application_rows)), ''[]''::jsonb) from _application_rows',
      regexp_replace(v_sql, ';\s*$', '')
    ) into v_result;
  else
    execute v_sql;
    v_result := jsonb_build_object('ok', true, 'name', v_name, 'executed_at', now());
  end if;
  return coalesce(v_result, '[]'::jsonb);
end
$function$;
revoke all on function public.run_application_write(text,text) from public, anon, authenticated;
grant execute on function public.run_application_write(text,text) to service_role;

create or replace function public.sch_ensure_daily_schedule(
  p_service_date date,
  p_reason text default 'automatic_readiness_check'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_roster_count integer := 0;
  v_assignment_count integer := 0;
  v_generated boolean := false;
  v_generator_result jsonb := '{}'::jsonb;
  v_status text;
begin
  if p_service_date is null then raise exception 'p_service_date is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-ready:' || p_service_date::text, 0));

  select count(*)::int into v_roster_count
  from public.daily_work_roster
  where service_date = p_service_date and active = true;
  select count(*)::int into v_assignment_count
  from public.daily_schedule_assignments
  where service_date = p_service_date;

  if v_roster_count = 0 or v_assignment_count = 0 then
    v_generator_result := public.sch_generate_daily_schedule(p_service_date, false);
    v_generated := true;
    select count(*)::int into v_roster_count
    from public.daily_work_roster where service_date = p_service_date and active = true;
    select count(*)::int into v_assignment_count
    from public.daily_schedule_assignments where service_date = p_service_date;
  end if;

  v_status := case when v_roster_count > 0 and v_assignment_count > 0 then 'completed' else 'failed' end;
  insert into public.schedule_automation_runs(
    automation_key, service_date, status, result_json, created_at, updated_at
  ) values (
    'daily_static_schedule_ready', p_service_date, v_status,
    jsonb_build_object(
      'reason', coalesce(nullif(btrim(p_reason), ''), 'automatic_readiness_check'),
      'generated', v_generated,
      'roster_count', v_roster_count,
      'assignment_count', v_assignment_count,
      'generator_result', v_generator_result
    ), now(), now()
  )
  on conflict(automation_key, service_date) do update set
    status = excluded.status,
    result_json = excluded.result_json,
    updated_at = now();

  if v_status <> 'completed' then raise exception 'Schedule for % is not ready after generation', p_service_date; end if;
  return jsonb_build_object(
    'service_date', p_service_date,
    'generated', v_generated,
    'roster_count', v_roster_count,
    'assignment_count', v_assignment_count,
    'reason', p_reason,
    'generator_result', v_generator_result
  );
end
$function$;

create or replace function public.sch_ensure_current_day_schedule()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.sch_ensure_daily_schedule(public.sch_service_date(now()), 'scheduled_current_day_readiness');
$function$;
revoke all on function public.sch_ensure_daily_schedule(date,text) from public, anon, authenticated;
revoke all on function public.sch_ensure_current_day_schedule() from public, anon, authenticated;
grant execute on function public.sch_ensure_daily_schedule(date,text) to service_role;
grant execute on function public.sch_ensure_current_day_schedule() to service_role, postgres;

do $do$
declare v_job record;
begin
  if exists(select 1 from pg_namespace where nspname = 'cron') then
    for v_job in select jobid from cron.job where jobname = 'mz-current-day-static-schedule-ready'
    loop perform cron.unschedule(v_job.jobid); end loop;
    perform cron.schedule(
      'mz-current-day-static-schedule-ready',
      '*/10 * * * *',
      'select public.sch_ensure_current_day_schedule();'
    );
  end if;
end
$do$;

create table if not exists public.device_notification_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  device_identifier text not null,
  notification_key text not null,
  notification_type text not null default 'notification',
  displayed_at timestamptz null,
  dismissed_at timestamptz null,
  opened_at timestamptz null,
  acknowledged_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_notification_ack_key_length check(length(notification_key) between 1 and 500),
  constraint device_notification_ack_unique unique(device_identifier, notification_key)
);
create index if not exists idx_device_notification_ack_recent
  on public.device_notification_acknowledgements(device_identifier, updated_at desc);
create index if not exists idx_device_notification_ack_type
  on public.device_notification_acknowledgements(notification_type, acknowledged_at, dismissed_at);
alter table public.device_notification_acknowledgements enable row level security;
revoke all on table public.device_notification_acknowledgements from public, anon, authenticated;
grant select, insert, update, delete on table public.device_notification_acknowledgements to service_role;

create or replace function public.ack_device_notification(
  p_device_identifier text,
  p_notification_key text,
  p_notification_type text default 'notification',
  p_action text default 'dismissed',
  p_metadata_json jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier, '')), '');
  v_device text;
  v_key text := nullif(btrim(coalesce(p_notification_key, '')), '');
  v_type text := left(lower(coalesce(nullif(btrim(p_notification_type), ''), 'notification')), 80);
  v_action text := lower(coalesce(nullif(btrim(p_action), ''), 'dismissed'));
  v_row public.device_notification_acknowledgements%rowtype;
begin
  if v_requested is null or length(v_requested) > 200 then raise exception 'device_identifier is required and must be at most 200 characters'; end if;
  if v_key is null or length(v_key) > 500 then raise exception 'notification_key is required and must be at most 500 characters'; end if;
  if v_action not in ('displayed','dismissed','opened','acknowledged') then raise exception 'unsupported notification action: %', v_action; end if;
  if jsonb_typeof(coalesce(p_metadata_json, '{}'::jsonb)) <> 'object' then raise exception 'metadata_json must be an object'; end if;

  select d.device_id into v_device
  from public.devices d
  where d.active and upper(btrim(d.device_id)) = upper(v_requested)
  limit 1;
  if v_device is null then
    select d.device_id into v_device
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active
    where da.active and upper(btrim(da.alias_identifier)) = upper(v_requested)
    limit 1;
  end if;
  if v_device is null then raise exception 'Active device not found: %', v_requested; end if;

  insert into public.device_notification_acknowledgements(
    device_identifier, notification_key, notification_type,
    displayed_at, dismissed_at, opened_at, acknowledged_at,
    metadata_json, updated_at
  ) values (
    v_device, v_key, v_type,
    case when v_action = 'displayed' then now() end,
    case when v_action = 'dismissed' then now() end,
    case when v_action = 'opened' then now() end,
    case when v_action in ('dismissed','opened','acknowledged') then now() end,
    coalesce(p_metadata_json, '{}'::jsonb) || jsonb_build_object('presented_device_identifier', v_requested),
    now()
  )
  on conflict(device_identifier, notification_key) do update set
    notification_type = excluded.notification_type,
    displayed_at = coalesce(public.device_notification_acknowledgements.displayed_at, excluded.displayed_at),
    dismissed_at = coalesce(public.device_notification_acknowledgements.dismissed_at, excluded.dismissed_at),
    opened_at = coalesce(public.device_notification_acknowledgements.opened_at, excluded.opened_at),
    acknowledged_at = coalesce(public.device_notification_acknowledgements.acknowledged_at, excluded.acknowledged_at),
    metadata_json = coalesce(public.device_notification_acknowledgements.metadata_json, '{}'::jsonb) || excluded.metadata_json,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'device_identifier', v_row.device_identifier,
    'notification_key', v_row.notification_key,
    'notification_type', v_row.notification_type,
    'displayed_at', v_row.displayed_at,
    'dismissed_at', v_row.dismissed_at,
    'opened_at', v_row.opened_at,
    'acknowledged_at', v_row.acknowledged_at
  );
end
$function$;

create or replace function public.dismiss_device_reminder(
  p_instance_key text,
  p_device_id text,
  p_reminder_kind text default 'notification',
  p_source_id text default null,
  p_metadata_json jsonb default '{}'::jsonb
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.ack_device_notification(
    p_device_id, p_instance_key, p_reminder_kind, 'dismissed',
    coalesce(p_metadata_json, '{}'::jsonb) || jsonb_build_object('source_id', p_source_id)
  );
$function$;
revoke all on function public.ack_device_notification(text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.dismiss_device_reminder(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.ack_device_notification(text,text,text,text,jsonb) to service_role;
grant execute on function public.dismiss_device_reminder(text,text,text,text,jsonb) to service_role;

alter table public.events_app_notification_log drop constraint if exists events_app_notification_log_status_check;
alter table public.events_app_notification_log add constraint events_app_notification_log_status_check
  check(status = any(array['sending'::text,'sent'::text,'error'::text]));

create or replace function public.claim_event_notification(
  p_event_id uuid,
  p_employee_id uuid,
  p_msg_user_id uuid,
  p_notification_kind text,
  p_scheduled_for_local text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_kind text := nullif(btrim(coalesce(p_notification_kind, '')), '');
  v_scheduled timestamp;
  v_existing public.events_app_notification_log%rowtype;
begin
  if p_event_id is null or p_employee_id is null or p_msg_user_id is null then raise exception 'event_id, employee_id, and msg_user_id are required'; end if;
  if v_kind is null or length(v_kind) > 120 then raise exception 'notification_kind is required and must be at most 120 characters'; end if;
  begin v_scheduled := p_scheduled_for_local::timestamp;
  exception when others then raise exception 'scheduled_for_local is invalid'; end;

  perform pg_advisory_xact_lock(hashtextextended('event-reminder:' || p_event_id::text || ':' || p_employee_id::text, 0));
  select log.* into v_existing
  from public.events_app_notification_log log
  where log.event_id = p_event_id
    and log.employee_id = p_employee_id
    and log.status in ('sent','sending')
    and (log.status = 'sent' or log.updated_at > now() - interval '10 minutes')
  order by case when log.status = 'sent' then 0 else 1 end, log.updated_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'claimed', false,
      'reason', case when v_existing.status = 'sent' then 'event_already_notified' else 'event_notification_in_flight' end,
      'notification_kind', v_existing.notification_kind,
      'response_message_id', v_existing.response_message_id,
      'status', v_existing.status
    );
  end if;

  insert into public.events_app_notification_log(
    event_id, employee_id, msg_user_id, notification_kind, scheduled_for_local,
    sent_at, status, notes, created_at, updated_at
  ) values (
    p_event_id, p_employee_id, p_msg_user_id, v_kind, v_scheduled,
    now(), 'sending', 'Claimed before message delivery', now(), now()
  )
  on conflict(event_id, employee_id, notification_kind) do update set
    msg_user_id = excluded.msg_user_id,
    scheduled_for_local = excluded.scheduled_for_local,
    sent_at = now(), status = 'sending', response_message_id = null,
    notes = 'Retry claimed before message delivery', updated_at = now()
  where public.events_app_notification_log.status = 'error'
     or (public.events_app_notification_log.status = 'sending'
         and public.events_app_notification_log.updated_at <= now() - interval '10 minutes')
  returning * into v_existing;

  if not found then
    select log.* into v_existing
    from public.events_app_notification_log log
    where log.event_id = p_event_id and log.employee_id = p_employee_id and log.notification_kind = v_kind
    limit 1;
    return jsonb_build_object(
      'claimed', false, 'reason', 'notification_already_claimed',
      'response_message_id', v_existing.response_message_id, 'status', v_existing.status
    );
  end if;

  return jsonb_build_object(
    'claimed', true, 'reason', 'claim_created', 'notification_kind', v_kind,
    'log_id', v_existing.id, 'status', v_existing.status
  );
end
$function$;

create or replace function public.finalize_event_notification(
  p_event_id uuid,
  p_employee_id uuid,
  p_notification_kind text,
  p_status text,
  p_thread_id uuid default null,
  p_response_message_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_row public.events_app_notification_log%rowtype;
begin
  if v_status not in ('sent','error') then raise exception 'status must be sent or error'; end if;
  update public.events_app_notification_log log
  set status = v_status,
      thread_id = p_thread_id,
      response_message_id = p_response_message_id,
      sent_at = case when v_status = 'sent' then now() else log.sent_at end,
      notes = left(coalesce(p_notes, log.notes, ''), 4000),
      updated_at = now()
  where log.event_id = p_event_id
    and log.employee_id = p_employee_id
    and log.notification_kind = p_notification_kind
  returning * into v_row;
  if not found then raise exception 'Event notification claim was not found'; end if;
  return jsonb_build_object('ok', true, 'status', v_row.status, 'response_message_id', v_row.response_message_id, 'updated_at', v_row.updated_at);
end
$function$;
revoke all on function public.claim_event_notification(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.finalize_event_notification(uuid,uuid,text,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_event_notification(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.finalize_event_notification(uuid,uuid,text,text,uuid,uuid,text) to service_role;

insert into public.system_settings(setting_key, setting_value, description, updated_at) values
  ('gps_proximity_radius_m', '175'::jsonb, 'Maximum standard distance from the authoritative location coordinate for a green cleaning proximity result.', now()),
  ('gps_max_accuracy_m', '100'::jsonb, 'GPS readings less accurate than this remain amber and cannot be marked near.', now())
on conflict(setting_key) do update set description = excluded.description, updated_at = now();

create table if not exists public.device_location_proximity_status (
  device_id uuid not null references public.devices(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  session_uuid text not null default '',
  presented_identifier text null,
  result text not null,
  badge_color text not null,
  distance_m numeric null,
  allowed_radius_m numeric not null,
  accuracy_m numeric null,
  client_latitude numeric null,
  client_longitude numeric null,
  target_latitude numeric null,
  target_longitude numeric null,
  coordinate_source text null,
  evaluated_at timestamptz not null default now(),
  correlation_id text null,
  metadata_json jsonb not null default '{}'::jsonb,
  primary key(device_id, location_id, session_uuid)
);
create index if not exists idx_device_location_proximity_status_evaluated
  on public.device_location_proximity_status(evaluated_at desc);
alter table public.device_location_proximity_status enable row level security;
revoke all on table public.device_location_proximity_status from public, anon, authenticated;
grant select, insert, update, delete on table public.device_location_proximity_status to service_role;

alter table public.scan_events drop constraint if exists scan_events_event_type_check;
alter table public.scan_events add constraint scan_events_event_type_check check(
  event_type = any(array[
    'scan_received'::text,'scan_blocked'::text,'scan_start'::text,'scan_finish'::text,
    'scan_resume_pending'::text,'scan_invalid_location'::text,'scan_unauthorized_device'::text,
    'scan_error'::text,'work_position_check'::text
  ])
);

create or replace function public.evaluate_location_proximity(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_presented_device text := nullif(btrim(coalesce(p_device_identifier, '')), '');
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
  v_device_pk uuid;
  v_device_id text;
  v_location_id uuid;
  v_location_name text;
  v_session_id uuid;
  v_target_lat numeric;
  v_target_lon numeric;
  v_coordinate_source text;
  v_radius numeric := greatest(25, public.get_setting_int('gps_proximity_radius_m', 175));
  v_max_accuracy numeric := greatest(25, public.get_setting_int('gps_max_accuracy_m', 100));
  v_distance numeric;
  v_effective_radius numeric;
  v_result text;
  v_badge_color text;
  v_event_id uuid;
  v_session_key text := coalesce(nullif(btrim(p_session_uuid), ''), '');
begin
  if v_presented_device is null then raise exception 'device identifier is required'; end if;
  if v_resolved_location_code is null then raise exception 'Active location not found for code: %', p_location_code; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then raise exception 'latitude is invalid'; end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'longitude is invalid'; end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then raise exception 'accuracy_m cannot be negative'; end if;

  select d.id, d.device_id into v_device_pk, v_device_id
  from public.devices d
  where d.active and upper(btrim(d.device_id)) = upper(v_presented_device)
  union all
  select d.id, d.device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active
  where da.active and upper(btrim(da.alias_identifier)) = upper(v_presented_device)
  limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %', v_presented_device; end if;

  select l.id, l.location_name into v_location_id, v_location_name
  from public.locations l
  where l.active and l.location_code = v_resolved_location_code
  limit 1;

  if v_session_key <> '' then
    select s.id into v_session_id
    from public.sessions s
    where s.session_uuid = v_session_key and s.device_id = v_device_pk and s.location_id = v_location_id
    limit 1;
    if v_session_id is null then raise exception 'Session does not belong to this device and location'; end if;
  end if;

  select lp.latitude, lp.longitude, coalesce(nullif(lp.coordinate_source, ''), 'location_proximity_settings')
  into v_target_lat, v_target_lon, v_coordinate_source
  from public.location_proximity_settings lp
  where lp.location_id = v_location_id and lp.active and lp.latitude is not null and lp.longitude is not null
  order by lp.updated_at desc limit 1;

  if v_target_lat is null or v_target_lon is null then
    select gp.latitude, gp.longitude, coalesce(nullif(gp.coordinate_source, ''), 'location_group_proximity_settings')
    into v_target_lat, v_target_lon, v_coordinate_source
    from public.location_group_memberships gm
    join public.location_groups lg on lg.id = gm.location_group_id and lg.active
    join public.location_group_proximity_settings gp
      on gp.location_group_id = lg.id and gp.active and gp.latitude is not null and gp.longitude is not null
    where gm.location_id = v_location_id and gm.active
    order by gp.updated_at desc, lg.group_name limit 1;
  end if;

  if v_target_lat is null or v_target_lon is null then
    v_result := 'not_configured'; v_badge_color := 'amber'; v_effective_radius := v_radius;
  else
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_latitude - v_target_lat)::double precision) / 2), 2)
      + cos(radians(v_target_lat::double precision)) * cos(radians(p_latitude::double precision))
      * power(sin(radians((p_longitude - v_target_lon)::double precision) / 2), 2)
    ));
    v_effective_radius := v_radius + least(greatest(coalesce(p_accuracy_m, 0), 0), 25);
    if p_accuracy_m is not null and p_accuracy_m > v_max_accuracy then
      v_result := 'low_accuracy'; v_badge_color := 'amber';
    elsif v_distance <= v_effective_radius then
      v_result := 'near'; v_badge_color := 'green';
    else
      v_result := 'away'; v_badge_color := 'red';
    end if;
  end if;

  insert into public.device_location_proximity_status(
    device_id, location_id, session_uuid, presented_identifier, result, badge_color,
    distance_m, allowed_radius_m, accuracy_m, client_latitude, client_longitude,
    target_latitude, target_longitude, coordinate_source, evaluated_at, correlation_id, metadata_json
  ) values (
    v_device_pk, v_location_id, v_session_key, v_presented_device, v_result, v_badge_color,
    v_distance, v_effective_radius, p_accuracy_m, p_latitude, p_longitude,
    v_target_lat, v_target_lon, v_coordinate_source, now(), nullif(btrim(coalesce(p_correlation_id, '')), ''),
    jsonb_build_object('location_code', v_resolved_location_code, 'location_name', v_location_name)
  )
  on conflict(device_id, location_id, session_uuid) do update set
    presented_identifier = excluded.presented_identifier,
    result = excluded.result,
    badge_color = excluded.badge_color,
    distance_m = excluded.distance_m,
    allowed_radius_m = excluded.allowed_radius_m,
    accuracy_m = excluded.accuracy_m,
    client_latitude = excluded.client_latitude,
    client_longitude = excluded.client_longitude,
    target_latitude = excluded.target_latitude,
    target_longitude = excluded.target_longitude,
    coordinate_source = excluded.coordinate_source,
    evaluated_at = now(),
    correlation_id = excluded.correlation_id,
    metadata_json = excluded.metadata_json;

  if p_client_event_id is not null then
    select se.id into v_event_id from public.scan_events se where se.client_event_id = p_client_event_id limit 1;
  end if;
  if v_event_id is null then
    insert into public.scan_events(
      scanned_at, location_id, location_code, device_id, device_identifier,
      session_id, event_type, result, notes, payload_json, client_event_id
    ) values (
      now(), v_location_id, v_resolved_location_code, v_device_pk, v_device_id,
      v_session_id, 'work_position_check', v_result,
      case
        when v_result = 'away' then format('Phone is %s meters from the authoritative location coordinate.', round(v_distance))
        when v_result = 'near' then 'Phone is within the authoritative location radius.'
        when v_result = 'low_accuracy' then 'GPS accuracy is too low for a green proximity result.'
        else 'No authoritative GPS coordinate is configured for this location.'
      end,
      jsonb_build_object(
        'distance_m', v_distance, 'allowed_radius_m', v_effective_radius, 'accuracy_m', p_accuracy_m,
        'client_latitude', p_latitude, 'client_longitude', p_longitude,
        'target_latitude', v_target_lat, 'target_longitude', v_target_lon,
        'coordinate_source', v_coordinate_source, 'badge_color', v_badge_color,
        'correlation_id', p_correlation_id
      ),
      nullif(btrim(coalesce(p_client_event_id, '')), '')
    ) returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'result', v_result, 'badge_color', v_badge_color,
    'device_id', v_device_id, 'presented_device_id', v_presented_device,
    'location_code', v_resolved_location_code, 'location_name', v_location_name,
    'session_uuid', nullif(v_session_key, ''),
    'distance_m', case when v_distance is null then null else round(v_distance, 1) end,
    'allowed_radius_m', round(v_effective_radius, 1), 'accuracy_m', p_accuracy_m,
    'target_latitude', v_target_lat, 'target_longitude', v_target_lon,
    'coordinate_source', v_coordinate_source, 'evaluated_at', now(), 'scan_event_id', v_event_id
  );
end
$function$;

create or replace function public.tool_evaluate_location_proximity(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.evaluate_location_proximity(
    p_location_code, p_device_identifier, p_latitude, p_longitude,
    p_accuracy_m, p_session_uuid, p_client_event_id, p_correlation_id
  );
$function$;
revoke all on function public.evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.tool_evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) from public, anon, authenticated;
grant execute on function public.evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) to service_role;
grant execute on function public.tool_evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) to service_role;

-- Final privilege assertions for internal foundations.
revoke all on function public.run_sql_readonly(text) from public, anon, authenticated;

-- Operational schedule correction supplied by the custodial manager:
-- Markiesha Warren now works 8:00 AM-5:00 PM rather than 8:30 AM-5:30 PM.
-- Keep the static morning assignment start times, but cap all Markiesha-owned
-- static and generated coverage at her authoritative 5:00 PM shift end.
do $do$
declare
  v_employee_id uuid;
  v_template_count integer;
  v_roster_count integer;
  v_coverage_count integer;
  v_assignment_count integer;
begin
  select e.id into v_employee_id
  from public.employees e
  where e.display_name = 'Markiesha Warren' and e.active = true
  limit 1;

  if v_employee_id is null then
    raise exception 'Active employee Markiesha Warren was not found';
  end if;

  update public.employee_shift_templates est
  set shift_start = time '08:00',
      shift_end = time '17:00',
      notes = case
        when coalesce(est.notes, '') like '%Shift updated 2026-07-14: 8:00 AM-5:00 PM.%' then est.notes
        else concat_ws(' | ', nullif(est.notes, ''), 'Shift updated 2026-07-14: 8:00 AM-5:00 PM.')
      end,
      updated_at = now()
  where est.employee_id = v_employee_id
    and est.active = true;
  get diagnostics v_template_count = row_count;

  if v_template_count <> 5 then
    raise exception 'Expected 5 active Markiesha shift templates, updated %', v_template_count;
  end if;

  update public.daily_work_roster r
  set shift_start = time '08:00',
      shift_end = time '17:00',
      notes = case
        when coalesce(r.notes, '') like '%Shift updated 2026-07-14: 8:00 AM-5:00 PM.%' then r.notes
        else concat_ws(' | ', nullif(r.notes, ''), 'Shift updated 2026-07-14: 8:00 AM-5:00 PM.')
      end,
      updated_at = now()
  where r.employee_id = v_employee_id
    and r.service_date >= public.sch_service_date(now());
  get diagnostics v_roster_count = row_count;

  update public.coverage_templates ct
  set coverage_end = time '17:00',
      notes = case
        when coalesce(ct.notes, '') like '%Capped to Markiesha 5:00 PM shift end.%' then ct.notes
        else concat_ws(' | ', nullif(ct.notes, ''), 'Capped to Markiesha 5:00 PM shift end.')
      end,
      updated_at = now()
  where ct.assigned_employee_id = v_employee_id
    and ct.active = true
    and ct.coverage_end > time '17:00';
  get diagnostics v_coverage_count = row_count;

  update public.daily_schedule_assignments dsa
  set coverage_end = time '17:00',
      notes = case
        when coalesce(dsa.notes, '') like '%Capped to Markiesha 5:00 PM shift end.%' then dsa.notes
        else concat_ws(' | ', nullif(dsa.notes, ''), 'Capped to Markiesha 5:00 PM shift end.')
      end,
      updated_at = now()
  where dsa.assigned_employee_id = v_employee_id
    and dsa.service_date >= public.sch_service_date(now())
    and dsa.coverage_end > time '17:00';
  get diagnostics v_assignment_count = row_count;

  insert into public.system_logs(level, source, message, created_at)
  values (
    'INFO',
    'schedule_configuration',
    format(
      'Markiesha Warren shift updated to 08:00-17:00. Templates=%s, rosters=%s, coverage templates capped=%s, generated assignments capped=%s.',
      v_template_count, v_roster_count, v_coverage_count, v_assignment_count
    ),
    now()
  );
end
$do$;
