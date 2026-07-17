-- Deployed migration history snapshot: 20260715013305 schedule_assignment_exact_duplicate_guard_20260715_v2

create schema if not exists archive;

create table if not exists archive.daily_schedule_assignment_duplicates_20260715 as
select dsa.*, now() as archived_at,
       'Exact duplicate employee/location/time/purpose assignment preserved before deduplication'::text as archive_reason
from public.daily_schedule_assignments dsa
where false;
create unique index if not exists ux_archive_daily_schedule_assignment_duplicates_20260715_id
  on archive.daily_schedule_assignment_duplicates_20260715(id);
revoke all on table archive.daily_schedule_assignment_duplicates_20260715 from public, anon, authenticated;
grant select, insert on table archive.daily_schedule_assignment_duplicates_20260715 to service_role;

with ranked as (
  select dsa.*,
         row_number() over (
           partition by service_date, assigned_employee_id, location_group_id,
                        coverage_start, coverage_end,
                        coalesce(coverage_purpose, ''), coalesce(owner_type, ''), status
           order by created_at, id
         ) as duplicate_rank
  from public.daily_schedule_assignments dsa
  where assigned_employee_id is not null
)
insert into archive.daily_schedule_assignment_duplicates_20260715(
  id,service_date,location_group_id,segment_number,assigned_employee_id,owner_type,
  coverage_start,coverage_end,status,load_points,notes,source_type,created_at,updated_at,
  coverage_purpose,archived_at,archive_reason
)
select r.id,r.service_date,r.location_group_id,r.segment_number,r.assigned_employee_id,r.owner_type,
       r.coverage_start,r.coverage_end,r.status,r.load_points,r.notes,r.source_type,r.created_at,r.updated_at,
       r.coverage_purpose,now(),
       'Exact duplicate employee/location/time/purpose assignment preserved before deduplication'
from ranked r
where r.duplicate_rank > 1
on conflict (id) do nothing;

with ranked as (
  select id,
         row_number() over (
           partition by service_date, assigned_employee_id, location_group_id,
                        coverage_start, coverage_end,
                        coalesce(coverage_purpose, ''), coalesce(owner_type, ''), status
           order by created_at, id
         ) as duplicate_rank
  from public.daily_schedule_assignments
  where assigned_employee_id is not null
)
delete from public.daily_schedule_assignments dsa
using ranked r
where dsa.id=r.id and r.duplicate_rank>1;

create or replace function public.prevent_duplicate_daily_schedule_assignment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.assigned_employee_id is not null and exists (
    select 1 from public.daily_schedule_assignments existing
    where existing.service_date = new.service_date
      and existing.assigned_employee_id = new.assigned_employee_id
      and existing.location_group_id = new.location_group_id
      and existing.coverage_start = new.coverage_start
      and existing.coverage_end = new.coverage_end
      and coalesce(existing.coverage_purpose, '') = coalesce(new.coverage_purpose, '')
      and coalesce(existing.owner_type, '') = coalesce(new.owner_type, '')
      and existing.status = new.status
  ) then
    return null;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_prevent_duplicate_daily_schedule_assignment on public.daily_schedule_assignments;
create trigger trg_prevent_duplicate_daily_schedule_assignment
before insert on public.daily_schedule_assignments
for each row execute function public.prevent_duplicate_daily_schedule_assignment();

create unique index if not exists ux_daily_schedule_assignment_exact_employee_window
on public.daily_schedule_assignments(
  service_date,
  assigned_employee_id,
  location_group_id,
  coverage_start,
  coverage_end,
  (coalesce(coverage_purpose, '')),
  (coalesce(owner_type, '')),
  status
)
where assigned_employee_id is not null;
