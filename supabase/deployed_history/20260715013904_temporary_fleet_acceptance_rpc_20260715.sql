-- Deployed migration history snapshot: 20260715013904 temporary_fleet_acceptance_rpc_20260715

create or replace function public.temporary_fleet_acceptance_20260715()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
with service_context as (
  select public.sch_service_date(now()) as service_date,
         now() as checked_at,
         'release-2026.07.14.scheduler-alerts-gps.3'::text as expected_release
), fleet_base as (
  select
    d.id as device_pk,
    d.device_id,
    d.device_name,
    d.assigned_employee_id,
    e.display_name as employee_name,
    e.employee_code,
    d.last_seen_at,
    ds.presented_identifier,
    ds.frontend_version,
    ds.queue_count,
    ds.retry_count,
    ds.oldest_item_at,
    ds.last_server_ack_at,
    ds.last_error,
    ds.updated_at,
    public.sch_employee_my_schedule_page(
      (select service_date from service_context),
      d.assigned_employee_id,
      (select checked_at from service_context)
    ) as schedule_page,
    (
      select count(*)::integer
      from public.daily_schedule_assignments dsa
      where dsa.service_date = (select service_date from service_context)
        and dsa.assigned_employee_id = d.assigned_employee_id
        and dsa.status = 'ASSIGNED'
    ) as assignment_count
  from public.devices d
  join public.employees e on e.id = d.assigned_employee_id and e.active = true
  left join public.device_sync_status ds on ds.device_id = d.id
  where d.active = true
    and d.device_id ~ '^KIOSK_(0[2-9]|10)$'
), fleet as (
  select
    fb.*,
    coalesce(jsonb_array_length(coalesce(fb.schedule_page->'items', '[]'::jsonb)), 0) as schedule_item_count,
    coalesce(jsonb_array_length(coalesce(fb.schedule_page->'current_items', '[]'::jsonb)), 0) as current_item_count,
    coalesce(fb.schedule_page->>'phase', '') as schedule_phase,
    case
      when fb.updated_at is null then 'NO_CHECKIN'
      when fb.frontend_version <> (select expected_release from service_context) then 'OLD_RELEASE'
      when fb.updated_at <= now() - interval '15 minutes' then 'STALE_CHECKIN'
      when coalesce(fb.queue_count, 0) <> 0
        or coalesce(fb.retry_count, 0) <> 0
        or fb.last_error is not null then 'SYNC_PROBLEM'
      when fb.assignment_count > 0
        and coalesce(jsonb_array_length(coalesce(fb.schedule_page->'items', '[]'::jsonb)), 0) = 0 then 'SCHEDULE_MISSING'
      else 'PASS'
    end as acceptance
  from fleet_base fb
), markiesha as (
  select d.id as device_pk, d.device_id, e.id as employee_id, mu.id as msg_user_id
  from public.devices d
  join public.employees e on e.id = d.assigned_employee_id
  left join public.msg_device_assignments mda
    on mda.is_active = true
   and upper(btrim(mda.device_identifier)) = upper(btrim(d.device_id))
  left join public.msg_users mu on mu.id = mda.msg_user_id
  where d.active = true and d.device_id = 'KIOSK_09'
  limit 1
), markiesha_event_receipts as (
  select
    count(*)::integer as total,
    count(*) filter (where r.acknowledged_at is null)::integer as unacknowledged,
    count(*) filter (where r.acknowledged_at is not null)::integer as acknowledged,
    max(m.sent_at) as latest_message_at,
    max(r.acknowledged_at) as latest_acknowledged_at
  from markiesha mk
  join public.msg_receipts r on r.user_id = mk.msg_user_id
  join public.msg_messages m on m.id = r.message_id
  where coalesce(m.metadata_json->>'source', '') = 'events_app'
), markiesha_notification_ack as (
  select
    count(*)::integer as acknowledgement_rows,
    max(ack.acknowledged_at) as latest_acknowledgement_at,
    max(ack.updated_at) as latest_updated_at
  from public.device_notification_acknowledgements ack
  where upper(btrim(ack.device_identifier)) = 'KIOSK_09'
    and ack.notification_type in ('event', 'notification')
)
select jsonb_build_object(
  'checked_at', (select checked_at from service_context),
  'service_date', (select service_date from service_context),
  'expected_release', (select expected_release from service_context),
  'expected_devices', 9,
  'fleet_count', (select count(*) from fleet),
  'pass_count', (select count(*) from fleet where acceptance = 'PASS'),
  'current_release_count', (
    select count(*) from fleet
    where frontend_version = (select expected_release from service_context)
      and updated_at > now() - interval '15 minutes'
  ),
  'clean_sync_count', (
    select count(*) from fleet
    where frontend_version = (select expected_release from service_context)
      and updated_at > now() - interval '15 minutes'
      and coalesce(queue_count, 0) = 0
      and coalesce(retry_count, 0) = 0
      and last_error is null
  ),
  'fleet', (
    select jsonb_agg(
      jsonb_build_object(
        'device_id', device_id,
        'employee_name', employee_name,
        'employee_code', employee_code,
        'presented_identifier', presented_identifier,
        'frontend_version', frontend_version,
        'queue_count', queue_count,
        'retry_count', retry_count,
        'oldest_item_at', oldest_item_at,
        'last_server_ack_at', last_server_ack_at,
        'last_error', last_error,
        'updated_at', updated_at,
        'minutes_since_sync', case when updated_at is null then null else round(extract(epoch from (now()-updated_at))/60.0, 2) end,
        'assignment_count', assignment_count,
        'schedule_item_count', schedule_item_count,
        'current_item_count', current_item_count,
        'schedule_phase', schedule_phase,
        'acceptance', acceptance
      ) order by device_id
    ) from fleet
  ),
  'markiesha_event_receipts', coalesce((select to_jsonb(x) from markiesha_event_receipts x), '{}'::jsonb),
  'markiesha_notification_acknowledgements', coalesce((select to_jsonb(x) from markiesha_notification_ack x), '{}'::jsonb),
  'pass', (
    (select count(*) from fleet) = 9
    and (select count(*) from fleet where acceptance = 'PASS') = 9
    and coalesce((select unacknowledged from markiesha_event_receipts), 0) = 0
  )
);
$function$;

revoke all on function public.temporary_fleet_acceptance_20260715() from public, authenticated;
grant execute on function public.temporary_fleet_acceptance_20260715() to anon;
