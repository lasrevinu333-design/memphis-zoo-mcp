-- Deployed migration history snapshot: 20260716121245 operational_recovery_20260716

insert into public.device_auth_policy(singleton, mode, updated_by, updated_at)
values (true, 'observe', 'operational_recovery_20260716', now())
on conflict (singleton) do update
set mode = excluded.mode,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

drop trigger if exists trg_device_auth_auto_enforce on public.device_auth_credentials;
delete from public.system_settings where setting_key = 'device_auth_rollout_mode';

create or replace function public.tool_report_device_sync_status(
  p_device_identifier text,
  p_queue_count integer,
  p_oldest_item_at timestamptz,
  p_retry_count integer,
  p_last_server_ack_at timestamptz,
  p_frontend_version text,
  p_last_error text,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_device public.devices%rowtype;
  v_now timestamptz := now();
begin
  select d.* into v_device
  from public.device_aliases da
  join public.devices d
    on d.id = da.canonical_device_id
   and d.active = true
  where da.alias_identifier = btrim(p_device_identifier)
    and da.active = true
  limit 1;

  if not found then
    select d.* into v_device
    from public.devices d
    where d.device_id = btrim(p_device_identifier)
      and d.active = true
    limit 1;
  end if;

  if v_device.id is null then
    raise exception 'Active device not found.';
  end if;

  insert into public.device_sync_status(
    device_id,
    presented_identifier,
    queue_count,
    oldest_item_at,
    retry_count,
    last_server_ack_at,
    frontend_version,
    last_error,
    correlation_id,
    updated_at
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
    v_now
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
    updated_at = v_now;

  update public.devices
  set last_seen_at = v_now,
      updated_at = v_now
  where id = v_device.id;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device.device_id,
    'updated_at', v_now,
    'last_seen_at', v_now
  );
end;
$function$;

update public.devices d
set last_seen_at = greatest(d.last_seen_at, ds.last_server_ack_at, ds.updated_at),
    updated_at = greatest(d.updated_at, ds.updated_at)
from public.device_sync_status ds
where ds.device_id = d.id
  and d.active = true
  and d.assigned_employee_id is not null
  and greatest(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) is distinct from d.last_seen_at;

create or replace view public.v_exception_queue as
select
  'open_ticket'::text as exception_type,
  mt.ticket_id::text as entity_id,
  mt.location_code,
  mt.location_name,
  mt.date_submitted as event_at,
  mt.date_submitted_display as event_at_display,
  mt.maintenance_issue as summary,
  mt.reported_by as actor,
  jsonb_build_object(
    'fixture_type', mt.fixture_type,
    'fixture_identifier', mt.fixture_identifier,
    'out_of_order', mt.out_of_order,
    'status', mt.status
  ) as details
from public.v_open_maintenance_tickets mt
union all
select
  'overdue_location'::text as exception_type,
  v.location_id::text as entity_id,
  v.location_code,
  v.location_name,
  v.latest_completed_at as event_at,
  v.latest_completed_at_display as event_at_display,
  'Location overdue for cleaning'::text as summary,
  v.latest_employee_name as actor,
  jsonb_build_object(
    'form_type', v.form_type,
    'status_code', v.status_code,
    'status_color', v.status_color,
    'open_ticket_count', v.open_ticket_count
  ) as details
from public.v_location_dashboard_status v
where v.status_code = 'overdue'
union all
select
  'stale_device'::text as exception_type,
  d.id::text as entity_id,
  null::text as location_code,
  d.device_name as location_name,
  greatest(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) as event_at,
  case
    when greatest(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) is null then 'Never seen'::text
    else to_char(
      timezone('America/Chicago', greatest(d.last_seen_at, ds.last_server_ack_at, ds.updated_at)),
      'MM/DD/YYYY HH12:MI AM'
    ) || ' Central'
  end as event_at_display,
  'Device missing recent heartbeat'::text as summary,
  d.device_id as actor,
  jsonb_build_object(
    'device_id', d.device_id,
    'active', d.active,
    'last_seen_at', d.last_seen_at,
    'last_server_ack_at', ds.last_server_ack_at,
    'sync_updated_at', ds.updated_at
  ) as details
from public.devices d
left join public.device_sync_status ds on ds.device_id = d.id
where d.active = true
  and d.assigned_employee_id is not null
  and (
    greatest(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) is null
    or greatest(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) < now() - interval '24 hours'
  )
union all
select
  'stale_open_session'::text as exception_type,
  s.session_uuid as entity_id,
  l.location_code,
  l.location_name,
  coalesce(s.ended_at, s.started_at) as event_at,
  to_char(
    timezone('America/Chicago', coalesce(s.ended_at, s.started_at)),
    'MM/DD/YYYY HH12:MI AM'
  ) || ' Central' as event_at_display,
  'Open session exceeded stale timeout'::text as summary,
  e.display_name as actor,
  jsonb_build_object(
    'status', s.status,
    'device_id', d.device_id,
    'started_at', s.started_at,
    'ended_at', s.ended_at
  ) as details
from public.sessions s
join public.locations l on l.id = s.location_id
join public.employees e on e.id = s.employee_id
left join public.devices d on d.id = s.device_id
where s.status = any(array['active'::text, 'pending_submit'::text])
  and coalesce(s.ended_at, s.started_at) <= now() - make_interval(
    mins => public.get_setting_int('stale_session_timeout_minutes', 120)
  );

insert into public.release_validation_runs(release_id, area, status, details_json)
values (
  'release-2026.07.16.operational-recovery.1',
  'operations_first_database_recovery',
  'pass',
  jsonb_build_object(
    'device_auth_mode', 'observe',
    'auto_enforcement_disabled', true,
    'device_presence_clock_reconciled', true,
    'exception_queue_uses_sync_presence', true,
    'applied_at', now()
  )
);
