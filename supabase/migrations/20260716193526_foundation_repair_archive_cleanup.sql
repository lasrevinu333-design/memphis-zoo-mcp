create table if not exists public.schedule_assignment_archive (
  archive_id uuid primary key default gen_random_uuid(),
  assignment_id uuid null,
  service_date date null,
  assignment_json jsonb not null,
  archive_reason text not null,
  archived_at timestamptz not null default now()
);
alter table public.schedule_assignment_archive enable row level security;
alter table public.schedule_assignment_archive force row level security;
revoke all on table public.schedule_assignment_archive from public, anon, authenticated;
grant select, insert on table public.schedule_assignment_archive to service_role, postgres;

insert into public.schedule_assignment_archive (
  assignment_id, service_date, assignment_json, archive_reason
)
select dsa.id, dsa.service_date, to_jsonb(dsa), 'historical_open_assignment_cleanup_20260716'
from public.daily_schedule_assignments dsa
where dsa.service_date < current_date
  and dsa.status = 'OPEN'
  and not exists (
    select 1 from public.schedule_assignment_archive a
    where a.assignment_id = dsa.id
  );

delete from public.daily_schedule_assignments
where service_date < current_date
  and status = 'OPEN';

with ranked as (
  select id,
         row_number() over (
           partition by employee_id, start_date, end_date
           order by updated_at desc nulls last, created_at desc nulls last, id
         ) as row_rank
  from public.employee_planned_time_off
  where active = true
)
update public.employee_planned_time_off p
set active = false,
    notes = trim(concat_ws(' | ', nullif(p.notes, ''), 'Deactivated duplicate PTO during foundation repair.')),
    updated_at = now()
from ranked r
where p.id = r.id
  and r.row_rank > 1;

update public.employee_planned_time_off
set active = false,
    notes = trim(concat_ws(' | ', nullif(notes, ''), 'Archived after PTO end date during foundation repair.')),
    updated_at = now()
where active = true
  and end_date < current_date;
