create or replace function public.sch_get_coverage_candidates(
  p_service_date date,
  p_location_group_id uuid,
  p_coverage_start time without time zone,
  p_coverage_end time without time zone
)
returns table(
  employee_id uuid,
  employee_name text,
  employee_code text,
  shift_start text,
  shift_end text,
  assigned_segments integer,
  assigned_load_points numeric,
  assigned_minutes numeric,
  familiarity_score integer,
  is_primary boolean,
  is_backup boolean,
  preference_type text,
  best_proximity_score integer,
  walking_minutes integer,
  has_overlap boolean,
  recommendation_score numeric,
  explanation text
)
language sql
stable
set search_path = pg_catalog, public
as $function$
with target_group as (
  select exists(
    select 1
    from public.location_group_memberships lgm
    join public.locations l on l.id = lgm.location_id and l.active = true
    where lgm.location_group_id = p_location_group_id
      and lgm.active = true
      and lower(coalesce(l.form_type, l.location_type, '')) = 'restroom'
  ) as is_restroom
),
active_roster as (
  select
    dwr.employee_id,
    dwr.shift_start,
    dwr.shift_end,
    p_coverage_start as overlap_start,
    p_coverage_end as overlap_end,
    (extract(epoch from (p_coverage_end - p_coverage_start)) / 60.0)::numeric as overlap_minutes
  from public.daily_work_roster dwr
  where dwr.service_date = p_service_date
    and dwr.active = true
    and dwr.shift_start <= p_coverage_start
    and dwr.shift_end >= p_coverage_end
),
load_summary as (
  select v.employee_id, v.assigned_segments, v.assigned_load_points, v.assigned_minutes
  from public.v_memphis_employee_load_summary v
  where v.service_date = p_service_date
),
overlap_check as (
  select
    ar.employee_id,
    exists(
      select 1
      from public.daily_schedule_assignments dsa
      where dsa.service_date = p_service_date
        and dsa.assigned_employee_id = ar.employee_id
        and dsa.status = 'ASSIGNED'
        and dsa.coverage_start < p_coverage_end
        and dsa.coverage_end > p_coverage_start
    ) as has_overlap
  from active_roster ar
),
familiarity_explicit as (
  select eaf.employee_id, eaf.familiarity_score, eaf.is_primary, eaf.is_backup
  from public.employee_area_familiarity eaf
  where eaf.location_group_id = p_location_group_id
    and eaf.active = true
),
familiarity_legacy_primary as (
  select epga.employee_id, 9 as familiarity_score, true as is_primary, false as is_backup
  from public.employee_primary_group_assignments epga
  where epga.location_group_id = p_location_group_id
    and epga.active = true
),
familiarity_legacy_backup as (
  select ebga.employee_id, 7 as familiarity_score, false as is_primary, true as is_backup
  from public.employee_backup_group_assignments ebga
  where ebga.location_group_id = p_location_group_id
    and ebga.active = true
),
familiarity as (
  select x.employee_id, max(x.familiarity_score)::int as familiarity_score,
         bool_or(x.is_primary) as is_primary, bool_or(x.is_backup) as is_backup
  from (
    select * from familiarity_explicit
    union all
    select * from familiarity_legacy_primary
    union all
    select * from familiarity_legacy_backup
  ) x
  group by x.employee_id
),
preferences as (
  select
    eap.employee_id,
    string_agg(eap.preference_type, ',' order by eap.preference_type) as preference_type,
    bool_or(eap.preference_type = 'restricted') as is_restricted,
    bool_or(eap.preference_type = 'avoid') as is_avoid,
    bool_or(eap.preference_type = 'prefer') as is_prefer
  from public.employee_area_preferences eap
  where eap.location_group_id = p_location_group_id
    and eap.active = true
  group by eap.employee_id
),
current_groups as (
  select distinct dsa.assigned_employee_id as employee_id, dsa.location_group_id
  from public.daily_schedule_assignments dsa
  where dsa.service_date = p_service_date
    and dsa.status = 'ASSIGNED'
    and dsa.assigned_employee_id is not null
),
proximity_explicit as (
  select cg.employee_id, max(lga.proximity_score) as best_proximity_score,
         min(lga.walking_minutes) as walking_minutes
  from current_groups cg
  join public.location_group_adjacency lga
    on lga.from_location_group_id = cg.location_group_id
   and lga.to_location_group_id = p_location_group_id
   and lga.active = true
  group by cg.employee_id
),
proximity_legacy as (
  select egp.employee_id, max(egp.proximity_score)::int as best_proximity_score,
         null::integer as walking_minutes
  from public.employee_group_proximity egp
  where egp.location_group_id = p_location_group_id
    and egp.active = true
  group by egp.employee_id
),
proximity as (
  select x.employee_id, max(x.best_proximity_score)::int as best_proximity_score,
         min(x.walking_minutes) as walking_minutes
  from (
    select * from proximity_explicit
    union all
    select * from proximity_legacy
  ) x
  group by x.employee_id
),
ranked as (
  select
    e.id as employee_id,
    e.display_name as employee_name,
    e.employee_code,
    to_char(ar.shift_start, 'HH24:MI') as shift_start,
    to_char(ar.shift_end, 'HH24:MI') as shift_end,
    coalesce(ls.assigned_segments, 0)::int as assigned_segments,
    coalesce(ls.assigned_load_points, 0)::numeric as assigned_load_points,
    coalesce(ls.assigned_minutes, 0)::numeric as assigned_minutes,
    coalesce(f.familiarity_score, 5)::int as familiarity_score,
    coalesce(f.is_primary, false) as is_primary,
    coalesce(f.is_backup, false) as is_backup,
    p.preference_type,
    coalesce(pr.best_proximity_score, 5)::int as best_proximity_score,
    pr.walking_minutes,
    oc.has_overlap,
    (
      (coalesce(f.familiarity_score, 5) * 6)
      + (case when coalesce(f.is_primary, false) then 12 else 0 end)
      + (case when coalesce(f.is_backup, false) then 6 else 0 end)
      + (coalesce(pr.best_proximity_score, 5) * 2)
      + (case when coalesce(p.is_prefer, false) then 6 else 0 end)
      + (least(coalesce(ar.overlap_minutes, 0), 180) * 0.05)
      - (case when coalesce(p.is_avoid, false) then 10 else 0 end)
      - (case when coalesce(p.is_restricted, false) then 100 else 0 end)
      - (coalesce(ls.assigned_load_points, 0) * 1.5)
      - (coalesce(ls.assigned_segments, 0) * 1.25)
      - (case when oc.has_overlap then 8 else 0 end)
    )::numeric as recommendation_score,
    trim(both ' ' from concat_ws('. ',
      case when oc.has_overlap then 'Already covering other concurrent areas' else 'No concurrent areas at that exact window' end,
      'Full-window shift coverage verified',
      'Familiarity ' || coalesce(f.familiarity_score, 5),
      case when coalesce(f.is_primary, false) then 'Primary area' when coalesce(f.is_backup, false) then 'Backup area' else null end,
      case when p.preference_type is not null then 'Preference ' || p.preference_type else null end,
      'Current load ' || coalesce(ls.assigned_load_points, 0) || ' points across ' || coalesce(ls.assigned_segments, 0) || ' segments',
      'Coverage window ' || round(coalesce(ar.overlap_minutes, 0), 0) || ' minutes',
      case when pr.best_proximity_score is not null then 'Proximity ' || pr.best_proximity_score else null end,
      case when pr.walking_minutes is not null then 'Walk ' || pr.walking_minutes || ' min' else null end
    )) as explanation
  from active_roster ar
  join public.employees e on e.id = ar.employee_id and e.active = true
  left join load_summary ls on ls.employee_id = ar.employee_id
  left join overlap_check oc on oc.employee_id = ar.employee_id
  left join familiarity f on f.employee_id = ar.employee_id
  left join preferences p on p.employee_id = ar.employee_id
  left join proximity pr on pr.employee_id = ar.employee_id
)
select *
from ranked
where coalesce(preference_type, '') not like '%restricted%'
order by recommendation_score desc, employee_name asc;
$function$;
