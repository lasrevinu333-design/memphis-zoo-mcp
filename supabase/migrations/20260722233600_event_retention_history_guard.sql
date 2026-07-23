begin;

-- Keep event audit history protected from accidental parent cascades during the
-- 14-day review window. The retention trigger explicitly removes history only
-- when the parent event has reached its approved physical-delete boundary.
alter table public.events_app_event_history
  drop constraint if exists events_app_event_history_event_id_fkey;

alter table public.events_app_event_history
  add constraint events_app_event_history_event_id_fkey
  foreign key(event_id) references public.events_app_events(id) on delete restrict
  not valid;

alter table public.events_app_event_history
  validate constraint events_app_event_history_event_id_fkey;

create or replace function public.events_app_delete_retention_guard()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_days integer := public.mz_retention_setting_int('retention_event_days',14,1,3650);
  v_local_today date := (clock_timestamp() at time zone 'America/Chicago')::date;
begin
  -- Old clients still send DELETE for every event whose end date is in the
  -- past. Treat that request as a retention attempt rather than authority to
  -- erase a recent event.
  if coalesce(old.end_date,old.event_date)>v_local_today-v_days then
    return null;
  end if;

  -- The row is now outside the review window. Remove its short-lived audit
  -- history explicitly; notification rows follow the parent by cascade.
  delete from public.events_app_event_history where event_id=old.id;
  return old;
end
$function$;

comment on function public.events_app_delete_retention_guard() is
  'Protects recent events and explicitly removes event history only when the parent event is at least 14 local calendar days past its end date.';

commit;
