-- Add real overnight event support for events_app_events.
-- Stores one logical event row with event_date + end_date instead of splitting
-- overnight events into fake start-day/end-day rows.

alter table public.events_app_events
  add column if not exists end_date date;

update public.events_app_events
set end_date = event_date
where end_date is null;

create or replace function public.events_app_events_set_end_date()
returns trigger
language plpgsql
as $$
begin
  if new.end_date is null then
    new.end_date := new.event_date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_app_events_set_end_date on public.events_app_events;
create trigger trg_events_app_events_set_end_date
before insert or update of event_date, end_date
on public.events_app_events
for each row
execute function public.events_app_events_set_end_date();

alter table public.events_app_events
  alter column end_date set not null;

alter table public.events_app_events
  drop constraint if exists events_app_events_end_after_start_check;

alter table public.events_app_events
  drop constraint if exists events_app_events_end_date_not_before_start_check;

alter table public.events_app_events
  add constraint events_app_events_end_date_not_before_start_check
  check (end_date >= event_date);

alter table public.events_app_events
  add constraint events_app_events_end_after_start_check
  check (
    end_time is null
    or end_date > event_date
    or end_time > start_time
  );

create index if not exists idx_events_app_events_date_window
  on public.events_app_events (event_date, end_date, start_time);

create index if not exists idx_events_app_events_location_date_window
  on public.events_app_events (location_group_id, event_date, end_date, start_time);

comment on column public.events_app_events.end_date is
  'Inclusive local end date for events. Same as event_date for same-day events; later for overnight events such as Zoo Snooze.';
