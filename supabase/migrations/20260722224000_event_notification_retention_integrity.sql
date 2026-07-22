begin;

alter table public.events_app_notification_log
  drop constraint if exists events_app_notification_log_kind_check;

alter table public.events_app_notification_log
  add constraint events_app_notification_log_kind_check
  check (notification_kind = any (array[
    'event_reminder'::text,
    'day_of_event'::text,
    'two_days_out'::text,
    'three_days_out'::text,
    'two_days_before'::text,
    'day_before'::text,
    'morning_of'::text,
    'shift_plus_15'::text,
    'shift_plus_fifteen'::text
  ])) not valid;

alter table public.events_app_notification_log
  validate constraint events_app_notification_log_kind_check;

create or replace function public.mz_apply_free_tier_retention(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $safe_retention$
begin
  perform pg_advisory_xact_lock(hashtextextended('memphis-zoo-disabled-legacy-retention', 0));
  return jsonb_build_object(
    'ok', true,
    'disabled', true,
    'ran_at', p_now,
    'deleted_events', 0,
    'deleted_event_notifications', 0,
    'reason', 'Legacy retention is disabled; event and audit history are preserved.'
  );
end
$safe_retention$;

comment on function public.mz_apply_free_tier_retention(timestamptz) is
  'Compatibility-only no-op. Use separately tested domain retention functions.';

commit;
