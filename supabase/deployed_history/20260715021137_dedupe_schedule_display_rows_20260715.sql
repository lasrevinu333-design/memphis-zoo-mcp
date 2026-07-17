-- Deployed migration history snapshot: 20260715021137 dedupe_schedule_display_rows_20260715

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.schedule_assignment_duplicates_20260715
(like public.daily_schedule_assignments including defaults including constraints including indexes);

alter table archive.schedule_assignment_duplicates_20260715
  add column if not exists archived_at timestamptz not null default now();
alter table archive.schedule_assignment_duplicates_20260715
  add column if not exists archive_reason text not null default 'exact_display_duplicate';

with ranked as (
  select dsa.id,
         row_number() over (
           partition by dsa.service_date,
                        dsa.assigned_employee_id,
                        dsa.location_group_id,
                        dsa.coverage_start,
                        dsa.coverage_end,
                        coalesce(dsa.coverage_purpose,''),
                        coalesce(dsa.status,''),
                        coalesce(dsa.segment_number,-1)
           order by
             case when coalesce(dsa.source_type,'') like 'coverage_template%' then 0 else 1 end,
             dsa.updated_at desc nulls last,
             dsa.created_at desc nulls last,
             dsa.id
         ) as duplicate_rank
  from public.daily_schedule_assignments dsa
  where dsa.service_date >= public.sch_service_date(now())
), duplicates as (
  select dsa.*
  from public.daily_schedule_assignments dsa
  join ranked r on r.id=dsa.id
  where r.duplicate_rank>1
)
insert into archive.schedule_assignment_duplicates_20260715
select duplicates.*,now(),'exact_display_duplicate'
from duplicates
on conflict(id) do nothing;

delete from public.daily_schedule_assignments dsa
using archive.schedule_assignment_duplicates_20260715 a
where dsa.id=a.id and a.archive_reason='exact_display_duplicate';

create or replace view public.v_schedule_display_duplicates as
select service_date,assigned_employee_id,location_group_id,coverage_start,coverage_end,
       coverage_purpose,status,segment_number,count(*)::integer as duplicate_count,
       array_agg(id order by updated_at desc nulls last,created_at desc nulls last) as assignment_ids
from public.daily_schedule_assignments
group by service_date,assigned_employee_id,location_group_id,coverage_start,coverage_end,
         coverage_purpose,status,segment_number
having count(*)>1;

revoke all on public.v_schedule_display_duplicates from public,anon,authenticated;
grant select on public.v_schedule_display_duplicates to service_role;
