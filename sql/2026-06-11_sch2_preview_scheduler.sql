-- SCH2 preview-first scheduler substrate for Memphis Zoo custodial operations.
-- Additive only: creates preview/audit/publish objects without touching published
-- daily_schedule_assignments until sch2_publish_solution(..., true) is called.

create table if not exists public.schedule_generation_runs (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  generator_version text not null default 'sch2-preview-2026-06-11',
  input_hash text not null,
  status text not null default 'building',
  mode text not null default 'preview',
  force boolean not null default false,
  hard_violation_count integer not null default 0,
  open_required_count integer not null default 0,
  score_total numeric not null default 0,
  audit_summary jsonb not null default '{}'::jsonb,
  diff_summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by text
);

create index if not exists idx_schedule_generation_runs_service_date
  on public.schedule_generation_runs(service_date, created_at desc);
create index if not exists idx_schedule_generation_runs_input_hash
  on public.schedule_generation_runs(service_date, input_hash);

create index if not exists idx_coverage_templates_employee_day_purpose_active
  on public.coverage_templates(assigned_employee_id, day_of_week, coverage_purpose, location_group_id)
  where active = true;

create table if not exists public.schedule_work_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.schedule_generation_runs(id) on delete cascade,
  service_date date not null,
  work_item_key text not null,
  source_daily_assignment_id uuid,
  location_group_id uuid not null references public.location_groups(id),
  segment_number integer not null default 1,
  coverage_start time not null,
  coverage_end time not null,
  coverage_purpose text not null default 'area_owner',
  required boolean not null default true,
  may_be_open boolean not null default false,
  scan_required boolean not null default true,
  is_public_restroom boolean not null default false,
  route_zone text,
  bundle_key text,
  load_points numeric not null default 0,
  original_assigned_employee_id uuid,
  original_owner_type text,
  original_status text,
  original_source_type text,
  notes text,
  hard_rule_tags text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  unique (run_id, work_item_key)
);

create index if not exists idx_schedule_work_items_run
  on public.schedule_work_items(run_id, service_date, coverage_start);
create index if not exists idx_schedule_work_items_group
  on public.schedule_work_items(location_group_id);

create table if not exists public.schedule_candidate_scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.schedule_generation_runs(id) on delete cascade,
  work_item_id uuid not null references public.schedule_work_items(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  eligible boolean not null default false,
  hard_reject_reasons text[] not null default array[]::text[],
  proximity_score numeric not null default 0,
  route_fit_score numeric not null default 0,
  workload_score numeric not null default 0,
  total_score numeric not null default 0,
  explanation text,
  created_at timestamptz not null default now(),
  unique (work_item_id, employee_id)
);

create index if not exists idx_schedule_candidate_scores_run_item
  on public.schedule_candidate_scores(run_id, work_item_id, eligible, total_score desc);

create table if not exists public.schedule_solution_assignments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.schedule_generation_runs(id) on delete cascade,
  work_item_id uuid not null references public.schedule_work_items(id) on delete cascade,
  service_date date not null,
  location_group_id uuid not null references public.location_groups(id),
  segment_number integer not null default 1,
  assigned_employee_id uuid references public.employees(id),
  owner_type text not null default 'OPEN',
  coverage_start time not null,
  coverage_end time not null,
  coverage_purpose text not null default 'area_owner',
  status text not null default 'OPEN',
  source_type text not null default 'sch2_preview',
  source_daily_assignment_id uuid,
  load_points numeric not null default 0,
  assignment_reason text,
  score_total numeric not null default 0,
  score_breakdown jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  unique (run_id, work_item_id)
);

create index if not exists idx_schedule_solution_assignments_run
  on public.schedule_solution_assignments(run_id, service_date, coverage_start);
create index if not exists idx_schedule_solution_assignments_employee
  on public.schedule_solution_assignments(run_id, assigned_employee_id);

create table if not exists public.schedule_manual_locks (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  location_group_id uuid not null references public.location_groups(id),
  segment_number integer not null default 1,
  coverage_start time,
  coverage_end time,
  coverage_purpose text,
  assigned_employee_id uuid references public.employees(id),
  reason text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_schedule_manual_locks_active
  on public.schedule_manual_locks(service_date, location_group_id, active);

create table if not exists public.schedule_publish_audit (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.schedule_generation_runs(id),
  service_date date not null,
  previous_rows jsonb not null default '[]'::jsonb,
  published_rows jsonb not null default '[]'::jsonb,
  diff_summary jsonb not null default '{}'::jsonb,
  published_by text,
  status text not null default 'dry_run',
  error_message text,
  published_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rollback_rows jsonb not null default '[]'::jsonb
);

create index if not exists idx_schedule_publish_audit_run
  on public.schedule_publish_audit(run_id, published_at desc);
create index if not exists idx_schedule_publish_audit_service_date
  on public.schedule_publish_audit(service_date, published_at desc);

create or replace function public.sch2_input_hash(p_service_date date)
returns text
language sql
stable
as $function$
  with payload as (
    select jsonb_build_object(
      'service_date', p_service_date,
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', dsa.id,
          'location_group_id', dsa.location_group_id,
          'segment_number', dsa.segment_number,
          'assigned_employee_id', dsa.assigned_employee_id,
          'owner_type', dsa.owner_type,
          'coverage_start', dsa.coverage_start,
          'coverage_end', dsa.coverage_end,
          'coverage_purpose', dsa.coverage_purpose,
          'status', dsa.status,
          'load_points', dsa.load_points,
          'source_type', dsa.source_type,
          'notes', dsa.notes
        ) order by dsa.location_group_id, dsa.coverage_start, dsa.segment_number, dsa.id)
        from public.daily_schedule_assignments dsa
        where dsa.service_date = p_service_date
      ), '[]'::jsonb),
      'roster', coalesce((
        select jsonb_agg(jsonb_build_object(
          'employee_id', r.employee_id,
          'shift_start', r.shift_start,
          'shift_end', r.shift_end,
          'active', r.active,
          'notes', r.notes
        ) order by r.employee_id)
        from public.daily_work_roster r
        where r.service_date = p_service_date
      ), '[]'::jsonb),
      'absences', coalesce((
        select jsonb_agg(jsonb_build_object(
          'employee_id', a.employee_id,
          'absence_type', a.absence_type,
          'active', a.active,
          'notes', a.notes
        ) order by a.employee_id, a.absence_type)
        from public.daily_absence_overrides a
        where a.absence_date = p_service_date
      ), '[]'::jsonb),
      'manual_locks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'location_group_id', l.location_group_id,
          'segment_number', l.segment_number,
          'coverage_start', l.coverage_start,
          'coverage_end', l.coverage_end,
          'coverage_purpose', l.coverage_purpose,
          'assigned_employee_id', l.assigned_employee_id,
          'active', l.active,
          'reason', l.reason
        ) order by l.location_group_id, l.coverage_start, l.segment_number)
        from public.schedule_manual_locks l
        where l.service_date = p_service_date
      ), '[]'::jsonb)
    ) as data
  )
  select md5(data::text) from payload;
$function$;

create or replace view public.v_sch2_constraint_violations as
with solution as (
  select
    sa.*,
    wi.required,
    wi.may_be_open,
    wi.scan_required,
    wi.is_public_restroom,
    wi.hard_rule_tags,
    lg.group_code,
    lg.group_name,
    e.display_name as employee_name,
    e.employee_code
  from public.schedule_solution_assignments sa
  join public.schedule_work_items wi on wi.id = sa.work_item_id
  join public.location_groups lg on lg.id = sa.location_group_id
  left join public.employees e on e.id = sa.assigned_employee_id
), lunch_windows as (
  select
    s.*,
    lw.lunch_start,
    lw.lunch_end
  from solution s
  left join lateral public.sch_lunch_window_for_employee(s.service_date, s.assigned_employee_id) lw on s.assigned_employee_id is not null
)
select
  s.run_id,
  s.service_date,
  s.work_item_id,
  s.id as assignment_id,
  s.location_group_id,
  s.assigned_employee_id,
  'open_required'::text as violation_type,
  'hard'::text as severity,
  ('Required work item is OPEN or missing owner: ' || s.group_name || ' ' || s.coverage_start || '-' || s.coverage_end)::text as detail
from solution s
where s.required = true
  and (s.status <> 'ASSIGNED' or s.assigned_employee_id is null)

union all
select
  s.run_id, s.service_date, s.work_item_id, s.id, s.location_group_id, s.assigned_employee_id,
  'restricted_assignment'::text,
  'hard'::text,
  ('Restricted assignment: ' || coalesce(s.employee_name, 'OPEN') || ' -> ' || s.group_name)::text
from solution s
where s.assigned_employee_id is not null
  and public.sch_is_employee_location_group_restricted(
    s.assigned_employee_id,
    s.location_group_id,
    extract(dow from s.service_date)::integer
  )

union all
select
  s.run_id, s.service_date, s.work_item_id, s.id, s.location_group_id, s.assigned_employee_id,
  'herpetarium_wednesday'::text,
  'hard'::text,
  'Herpetarium must not be scheduled on Wednesday'::text
from solution s
where s.group_code = 'HERPETARIUM'
  and extract(dow from s.service_date)::integer = 3
  and s.coverage_purpose in ('deep_clean', 'area_owner', 'restroom_upkeep', 'lunch_coverage')

union all
select
  s.run_id, s.service_date, s.work_item_id, s.id, s.location_group_id, s.assigned_employee_id,
  'response_only_group_has_normal_work'::text,
  'hard'::text,
  'Primate Canyon/Cat Country must stay No Clean / Calls to Location Only'::text
from solution s
where s.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
  and s.coverage_purpose in ('deep_clean', 'area_owner', 'restroom_upkeep', 'lunch_coverage')

union all
select
  s.run_id, s.service_date, s.work_item_id, s.id, s.location_group_id, s.assigned_employee_id,
  'gift_shop_not_monday_0800_reminder'::text,
  'hard'::text,
  'Gift shops are Monday 8:00 reminder-only work, not scan-cleaning work'::text
from solution s
where (s.group_code like '%GIFT_SHOP%' or s.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP'))
  and not (
    extract(dow from s.service_date)::integer = 1
    and s.coverage_purpose = 'reminder'
    and s.coverage_start = time '08:00'
    and s.coverage_end <= time '09:45'
  )

union all
select
  lw.run_id, lw.service_date, lw.work_item_id, lw.id, lw.location_group_id, lw.assigned_employee_id,
  'lunch_coverage_same_lunch_overlap'::text,
  'hard'::text,
  ('same_lunch / overlap / lunch_coverage violation: ' || coalesce(lw.employee_name, 'OPEN') || ' has lunch ' || coalesce(lw.lunch_start::text, '?') || '-' || coalesce(lw.lunch_end::text, '?'))::text
from lunch_windows lw
where lw.coverage_purpose = 'lunch_coverage'
  and lw.lunch_start is not null
  and lw.lunch_end is not null
  and lw.lunch_start < lw.coverage_end
  and lw.lunch_end > lw.coverage_start

union all
select
  s.run_id, s.service_date, s.work_item_id, s.id, s.location_group_id, s.assigned_employee_id,
  'Michael_EMP002_regular_assignment'::text,
  'hard'::text,
  'Michael / EMP002 is afternoon-call visibility only and must not be balanced into regular morning/restroom/lunch work'::text
from solution s
where s.assigned_employee_id is not null
  and (s.employee_code = 'EMP002' or s.employee_name ilike 'Michael McWright')
  and s.coverage_purpose <> 'late_coverage'

union all
select
  s.run_id, s.service_date, s.work_item_id, s.id, s.location_group_id, s.assigned_employee_id,
  'restroom_0945_missing_assignment'::text,
  'hard'::text,
  '09:45 / 0945 restroom protection: public restroom has no assigned owner through rebalance window'::text
from solution s
where s.is_public_restroom = true
  and s.coverage_start <= time '09:45'
  and s.coverage_end > time '09:45'
  and (s.status <> 'ASSIGNED' or s.assigned_employee_id is null);

create or replace view public.v_sch2_workload_audit as
with regular_roster as (
  select
    r.id as run_id,
    dwr.employee_id
  from public.schedule_generation_runs r
  join public.daily_work_roster dwr
    on dwr.service_date = r.service_date
   and dwr.active = true
  join public.employees e
    on e.id = dwr.employee_id
   and e.active = true
  left join public.daily_absence_overrides dao
    on dao.absence_date = r.service_date
   and dao.employee_id = dwr.employee_id
   and dao.active = true
  where dao.id is null
    and coalesce(e.employee_code, '') <> 'EMP002'
), employee_counts as (
  select run_id, count(distinct employee_id)::numeric as regular_employee_count
  from regular_roster
  group by run_id
), work_totals as (
  select
    run_id,
    coalesce(sum(load_points) filter (where required = true), 0)::numeric as total_required_load,
    count(distinct location_group_id) filter (where required = true)::numeric as total_required_locations
  from public.schedule_work_items
  group by run_id
), targets as (
  select
    wt.run_id,
    coalesce(wt.total_required_load / nullif(ec.regular_employee_count, 0), 0)::numeric as target_required_load,
    coalesce(wt.total_required_locations / nullif(ec.regular_employee_count, 0), 0)::numeric as target_required_location_count
  from work_totals wt
  left join employee_counts ec on ec.run_id = wt.run_id
), employee_load as (
  select
    rr.run_id,
    rr.employee_id,
    coalesce(sum(coalesce(sa.load_points, 0)) filter (where sa.status = 'ASSIGNED' and wi.required = true), 0)::numeric as assigned_load_points,
    coalesce(sum(case when wi.is_public_restroom then coalesce(sa.load_points, 0) else 0 end) filter (where sa.status = 'ASSIGNED' and wi.required = true), 0)::numeric as restroom_load_points,
    count(sa.id) filter (where sa.status = 'ASSIGNED' and wi.required = true)::integer as assigned_segments,
    count(distinct sa.location_group_id) filter (where sa.status = 'ASSIGNED' and wi.required = true)::integer as required_location_count
  from regular_roster rr
  left join public.schedule_solution_assignments sa
    on sa.run_id = rr.run_id
   and sa.assigned_employee_id = rr.employee_id
   and sa.coverage_purpose not in ('reminder', 'response_only', 'late_coverage')
  left join public.schedule_work_items wi on wi.id = sa.work_item_id
  group by rr.run_id, rr.employee_id
), spread as (
  select
    el.*,
    t.target_required_load,
    t.target_required_location_count,
    (max(el.assigned_load_points) over (partition by el.run_id) - min(el.assigned_load_points) over (partition by el.run_id))::numeric as workload_spread,
    (max(el.required_location_count) over (partition by el.run_id) - min(el.required_location_count) over (partition by el.run_id))::integer as location_count_spread
  from employee_load el
  left join targets t on t.run_id = el.run_id
)
select
  run_id,
  employee_id,
  assigned_load_points,
  restroom_load_points,
  workload_spread,
  assigned_segments,
  required_location_count,
  target_required_load,
  target_required_location_count,
  location_count_spread,
  case
    when location_count_spread > 1 then 'location_count_spread_high'
    when workload_spread > greatest(6, coalesce(target_required_load, 0) * 0.35) then 'workload_spread_high'
    else null::text
  end as violation_type
from spread;

create or replace view public.v_sch2_route_audit as
with employee_routes as (
  select
    sa.run_id,
    sa.assigned_employee_id as employee_id,
    count(distinct coalesce(wi.route_zone, 'unknown'))::integer as route_zone_count,
    coalesce(public.sch_group_route_spread_penalty(array_agg(distinct sa.location_group_id)), 0)::numeric as route_spread_penalty
  from public.schedule_solution_assignments sa
  join public.schedule_work_items wi on wi.id = sa.work_item_id
  where sa.status = 'ASSIGNED'
    and sa.assigned_employee_id is not null
    and sa.coverage_purpose not in ('reminder', 'response_only')
  group by sa.run_id, sa.assigned_employee_id
)
select
  run_id,
  employee_id,
  route_zone_count,
  route_spread_penalty,
  (route_zone_count > 3 or route_spread_penalty > 18)::boolean as route_spread_violation,
  case when route_zone_count > 3 or route_spread_penalty > 18 then 'route_spread_high' else null::text end as violation_type
from employee_routes;

create or replace view public.v_sch2_publish_diff as
with preview_rows as (
  select
    r.id as run_id,
    sa.service_date,
    sa.location_group_id,
    sa.segment_number,
    sa.coverage_start,
    sa.coverage_end,
    sa.coverage_purpose,
    sa.assigned_employee_id,
    sa.owner_type,
    sa.status,
    sa.load_points
  from public.schedule_generation_runs r
  join public.schedule_solution_assignments sa on sa.run_id = r.id
), current_rows as (
  select
    r.id as run_id,
    dsa.service_date,
    dsa.location_group_id,
    dsa.segment_number,
    dsa.coverage_start,
    dsa.coverage_end,
    dsa.coverage_purpose,
    dsa.assigned_employee_id,
    dsa.owner_type,
    dsa.status,
    dsa.load_points
  from public.schedule_generation_runs r
  join public.daily_schedule_assignments dsa on dsa.service_date = r.service_date
)
select
  coalesce(p.run_id, c.run_id) as run_id,
  coalesce(p.service_date, c.service_date) as service_date,
  coalesce(p.location_group_id, c.location_group_id) as location_group_id,
  coalesce(p.segment_number, c.segment_number) as segment_number,
  coalesce(p.coverage_start, c.coverage_start) as coverage_start,
  coalesce(p.coverage_end, c.coverage_end) as coverage_end,
  coalesce(p.coverage_purpose, c.coverage_purpose) as coverage_purpose,
  case
    when c.location_group_id is null then 'preview_only'
    when p.location_group_id is null then 'current_only'
    when p.assigned_employee_id is distinct from c.assigned_employee_id
      or p.owner_type is distinct from c.owner_type
      or p.status is distinct from c.status
      or p.load_points is distinct from c.load_points then 'changed'
    else 'same'
  end as diff_type,
  c.assigned_employee_id as current_employee_id,
  p.assigned_employee_id as preview_employee_id,
  c.status as current_status,
  p.status as preview_status,
  c.load_points as current_load_points,
  p.load_points as preview_load_points
from preview_rows p
full join current_rows c
  on c.run_id = p.run_id
 and c.location_group_id = p.location_group_id
 and c.segment_number = p.segment_number
 and c.coverage_start = p.coverage_start
 and c.coverage_end = p.coverage_end
 and c.coverage_purpose = p.coverage_purpose;

create or replace function public.sch2_audit_solution(p_run_id uuid)
returns jsonb
language plpgsql
as $function$
declare
  v_hard integer := 0;
  v_open integer := 0;
  v_workload integer := 0;
  v_route integer := 0;
  v_score numeric := 0;
  v_result jsonb;
begin
  select count(*)::integer into v_hard
  from public.v_sch2_constraint_violations
  where run_id = p_run_id
    and severity = 'hard';

  select count(*)::integer into v_open
  from public.schedule_solution_assignments sa
  join public.schedule_work_items wi on wi.id = sa.work_item_id
  where sa.run_id = p_run_id
    and wi.required = true
    and (sa.status <> 'ASSIGNED' or sa.assigned_employee_id is null);

  select count(*)::integer into v_workload
  from public.v_sch2_workload_audit
  where run_id = p_run_id
    and violation_type is not null;

  select count(*)::integer into v_route
  from public.v_sch2_route_audit
  where run_id = p_run_id
    and route_spread_violation = true;

  select coalesce(sum(score_total), 0)::numeric into v_score
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  v_result := jsonb_build_object(
    'ok', v_hard = 0 and v_open = 0,
    'run_id', p_run_id,
    'hard_violation_count', v_hard,
    'open_required_count', v_open,
    'workload_warning_count', v_workload,
    'route_warning_count', v_route,
    'score_total', v_score
  );

  update public.schedule_generation_runs
     set hard_violation_count = v_hard,
         open_required_count = v_open,
         score_total = v_score,
         audit_summary = v_result,
         status = case when v_hard = 0 and v_open = 0 then 'preview_ready' else 'preview_blocked' end,
         updated_at = now()
   where id = p_run_id;

  return v_result;
end;
$function$;

create or replace function public.sch2_build_work_items(p_service_date date)
returns uuid
language plpgsql
as $function$
declare
  v_run_id uuid;
  v_input_hash text;
begin
  v_input_hash := public.sch2_input_hash(p_service_date);

  insert into public.schedule_generation_runs (
    service_date, generator_version, input_hash, status, mode, force
  ) values (
    p_service_date, 'sch2-preview-2026-06-11', v_input_hash, 'building_work_items', 'preview', false
  ) returning id into v_run_id;

  with has_daily as (
    select exists (
      select 1 from public.daily_schedule_assignments dsa where dsa.service_date = p_service_date
    ) as ok
  ), source_rows as (
    select
      dsa.id as source_daily_assignment_id,
      dsa.service_date,
      dsa.location_group_id,
      dsa.segment_number,
      dsa.assigned_employee_id,
      dsa.owner_type,
      dsa.coverage_start,
      dsa.coverage_end,
      dsa.coverage_purpose,
      dsa.status,
      dsa.load_points,
      dsa.source_type,
      dsa.notes
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date

    union all

    select
      null::uuid as source_daily_assignment_id,
      p_service_date as service_date,
      ct.location_group_id,
      ct.segment_number,
      ct.assigned_employee_id,
      ct.owner_type,
      ct.coverage_start,
      ct.coverage_end,
      ct.coverage_purpose,
      case when ct.assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end as status,
      coalesce(public.sch_group_adjusted_load_points(ct.location_group_id), 1)::numeric as load_points,
      'coverage_template'::text as source_type,
      ct.notes
    from public.coverage_templates ct
    cross join has_daily hd
    where hd.ok = false
      and ct.active = true
      and ct.day_of_week = extract(dow from p_service_date)::integer
  ), enriched as (
    select
      sr.*,
      lg.group_code,
      lg.group_name,
      public.sch_is_public_restroom_group(sr.location_group_id) as is_public_restroom
    from source_rows sr
    join public.location_groups lg on lg.id = sr.location_group_id
    where lg.active = true
  )
  insert into public.schedule_work_items (
    run_id,
    service_date,
    work_item_key,
    source_daily_assignment_id,
    location_group_id,
    segment_number,
    coverage_start,
    coverage_end,
    coverage_purpose,
    required,
    may_be_open,
    scan_required,
    is_public_restroom,
    route_zone,
    bundle_key,
    load_points,
    original_assigned_employee_id,
    original_owner_type,
    original_status,
    original_source_type,
    notes,
    hard_rule_tags
  )
  select
    v_run_id,
    e.service_date,
    concat_ws(':', e.location_group_id::text, e.segment_number::text, e.coverage_start::text, e.coverage_end::text, e.coverage_purpose) as work_item_key,
    e.source_daily_assignment_id,
    e.location_group_id,
    e.segment_number,
    e.coverage_start,
    e.coverage_end,
    e.coverage_purpose,
    not (
      e.coverage_purpose in ('reminder', 'response_only')
      or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
      or (
        (e.group_code like '%GIFT_SHOP%' or e.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP'))
        and extract(dow from e.service_date)::integer = 1
        and e.coverage_purpose = 'reminder'
        and e.coverage_start = time '08:00'
        and e.coverage_end <= time '09:45'
      )
    ) as required,
    (
      e.coverage_purpose in ('reminder', 'response_only')
      or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
    ) as may_be_open,
    not (e.coverage_purpose in ('reminder', 'response_only') or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')) as scan_required,
    e.is_public_restroom,
    case
      when e.group_code in ('EXPO', 'EXPO_RESTROOMS', 'AQUARIUM', 'KOMODOS', 'MEMMEX_RESTROOMS') then 'west'
      when e.group_code in ('TETON', 'TETON_RESTROOMS', 'NORTH_WEST_PASSAGE', 'NWP', 'EAST_END_RESTROOMS', 'EAST_END_BREAK_ROOM') then 'east'
      when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'bonobos_event'
      when e.group_code in ('CAT_HOUSE_CAFE_RESTROOMS', 'CATHOUSE_CAFE_RESTROOMS', 'TROPICAL_BIRDS', 'HERPETARIUM') then 'central_east'
      else lower(regexp_replace(coalesce(split_part(e.group_code, '_', 1), 'unknown'), '[^a-zA-Z0-9]+', '_', 'g'))
    end as route_zone,
    case
      when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'BONOBOS_SPLASH_EVENT'
      else e.group_code
    end as bundle_key,
    coalesce(e.load_points, 0),
    e.assigned_employee_id,
    e.owner_type,
    e.status,
    e.source_type,
    e.notes,
    array_remove(array[
      case when e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY') then 'response_only' end,
      case when e.group_code = 'HERPETARIUM' and extract(dow from e.service_date)::integer = 3 then 'herpetarium_wednesday' end,
      case when e.is_public_restroom then 'restroom' end,
      case when e.coverage_purpose = 'lunch_coverage' then 'lunch_coverage' end,
      case when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'bonobos_splash_event_bundle' end,
      case when e.group_code like '%GIFT_SHOP%' or e.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP') then 'gift_shop_reminder_only' end
    ]::text[], null)
  from enriched e;

  update public.schedule_generation_runs
     set status = 'work_items_ready', updated_at = now()
   where id = v_run_id;

  return v_run_id;
end;
$function$;

create or replace function public.sch2_generate_preview(p_service_date date, p_force boolean default false)
returns jsonb
language plpgsql
as $function$
declare
  v_run_id uuid;
  v_input_hash text;
  v_existing_run_id uuid;
  v_audit jsonb;
  v_diff jsonb;
  v_item record;
  v_choice record;
  v_target_required_load numeric := 0;
  v_target_required_location_count numeric := 0;
  v_final_employee_id uuid;
  v_final_total_score numeric := 0;
  v_final_proximity_score numeric := 0;
  v_final_route_fit_score numeric := 0;
  v_final_workload_score numeric := 0;
  v_final_hard_reject_reasons text[] := array[]::text[];
  v_final_current_solution_load numeric := 0;
  v_final_required_location_count integer := 0;
  v_final_target_load_gap_after numeric := 0;
  v_final_balanced_rank integer := null;
  v_assignment_reason text;
begin
  v_input_hash := public.sch2_input_hash(p_service_date);

  if not coalesce(p_force, false) then
    select id into v_existing_run_id
    from public.schedule_generation_runs
    where service_date = p_service_date
      and input_hash = v_input_hash
      and status in ('preview_ready', 'preview_blocked')
    order by created_at desc
    limit 1;

    if v_existing_run_id is not null then
      v_audit := public.sch2_audit_solution(v_existing_run_id);
      v_diff := public.sch2_compare_current_vs_preview(v_existing_run_id);
      return jsonb_build_object(
        'ok', true,
        'reused', true,
        'run_id', v_existing_run_id,
        'service_date', p_service_date,
        'audit', v_audit,
        'diff', v_diff
      );
    end if;
  end if;

  v_run_id := public.sch2_build_work_items(p_service_date);

  update public.schedule_generation_runs
     set force = coalesce(p_force, false), status = 'scoring_candidates', updated_at = now()
   where id = v_run_id;

  with roster as (
    select
      r.employee_id,
      e.display_name as employee_name,
      e.employee_code,
      r.shift_start,
      r.shift_end
    from public.daily_work_roster r
    join public.employees e on e.id = r.employee_id and e.active = true
    left join public.daily_absence_overrides dao
      on dao.absence_date = r.service_date
     and dao.employee_id = r.employee_id
     and dao.active = true
    where r.service_date = p_service_date
      and r.active = true
      and dao.id is null
  ), base as materialized (
    select
      wi.id as work_item_id,
      wi.run_id,
      r.employee_id,
      r.employee_name,
      r.employee_code,
      wi.location_group_id,
      wi.coverage_start,
      wi.coverage_end,
      wi.coverage_purpose,
      wi.original_assigned_employee_id,
      wi.required,
      0::numeric as assigned_load_points,
      0::numeric as assigned_segments,
      public.sch_is_employee_location_group_restricted(r.employee_id, wi.location_group_id, extract(dow from p_service_date)::integer) as is_restricted,
      (r.shift_start < wi.coverage_end and r.shift_end > wi.coverage_start) as shift_overlaps,
      lw.lunch_start,
      lw.lunch_end,
      coalesce(public.sch_employee_route_fit_score(r.employee_id, extract(dow from p_service_date)::integer, wi.location_group_id, wi.coverage_purpose), 0)::numeric as route_penalty
    from public.schedule_work_items wi
    cross join roster r
    left join lateral public.sch_lunch_window_for_employee(p_service_date, r.employee_id) lw on true
    where wi.run_id = v_run_id
  ), scored as materialized (
    select
      b.*,
      array_remove(array[
        case when b.is_restricted then 'restricted' end,
        case when not b.shift_overlaps then 'shift_no_overlap' end,
        case when b.employee_code = 'EMP002' and b.coverage_purpose <> 'late_coverage' then 'Michael_EMP002_not_regular_worker' end,
        case when b.coverage_purpose = 'lunch_coverage'
              and b.lunch_start is not null
              and b.lunch_end is not null
              and b.lunch_start < b.coverage_end
              and b.lunch_end > b.coverage_start then 'same_lunch_overlap' end
      ]::text[], null) as hard_reject_reasons,
      greatest(0, 100 - coalesce(b.route_penalty, 0))::numeric as route_fit_score,
      greatest(0, 100 - (coalesce(b.assigned_load_points, 0) * 8) - (coalesce(b.assigned_segments, 0) * 4))::numeric as workload_score,
      greatest(0, 100 - coalesce(b.route_penalty, 0))::numeric as proximity_score
    from base b
  )
  insert into public.schedule_candidate_scores (
    run_id,
    work_item_id,
    employee_id,
    eligible,
    hard_reject_reasons,
    proximity_score,
    route_fit_score,
    workload_score,
    total_score,
    explanation
  )
  select
    s.run_id,
    s.work_item_id,
    s.employee_id,
    cardinality(s.hard_reject_reasons) = 0,
    s.hard_reject_reasons,
    round(s.proximity_score, 2),
    round(s.route_fit_score, 2),
    round(s.workload_score, 2),
    round(((s.route_fit_score * 0.75) + (s.workload_score * 0.25))::numeric, 2),
    concat_ws('; ',
      'route_fit=' || round(s.route_fit_score, 2)::text,
      'workload=' || round(s.workload_score, 2)::text,
      'current_load=' || s.assigned_load_points::text,
      case when cardinality(s.hard_reject_reasons) > 0 then 'reject=' || array_to_string(s.hard_reject_reasons, ',') else 'eligible' end
    )
  from scored s;

  update public.schedule_generation_runs
     set status = 'building_solution', updated_at = now()
   where id = v_run_id;

  with regular_roster as (
    select distinct r.employee_id
    from public.daily_work_roster r
    join public.employees e on e.id = r.employee_id and e.active = true
    left join public.daily_absence_overrides dao
      on dao.absence_date = r.service_date
     and dao.employee_id = r.employee_id
     and dao.active = true
    where r.service_date = p_service_date
      and r.active = true
      and dao.id is null
      and coalesce(e.employee_code, '') <> 'EMP002'
  ), employee_count as (
    select count(*)::numeric as n from regular_roster
  ), work_totals as (
    select
      coalesce(sum(wi.load_points) filter (where wi.required), 0)::numeric as required_load,
      count(distinct wi.location_group_id) filter (where wi.required)::numeric as required_locations
    from public.schedule_work_items wi
    where wi.run_id = v_run_id
  )
  select
    coalesce(wt.required_load / nullif(ec.n, 0), 0)::numeric,
    coalesce(wt.required_locations / nullif(ec.n, 0), 0)::numeric
  into v_target_required_load, v_target_required_location_count
  from work_totals wt
  cross join employee_count ec;

  for v_item in
    select wi.*
    from public.schedule_work_items wi
    where wi.run_id = v_run_id
      and wi.required = true
    order by
      wi.load_points desc,
      wi.is_public_restroom desc,
      wi.coverage_start,
      wi.bundle_key,
      wi.id
  loop
    with current_solution_load as (
      select
        c.employee_id,
        coalesce(sum(sa.load_points) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true), 0)::numeric as assigned_load_points,
        count(distinct sa.location_group_id) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true)::integer as required_location_count
      from public.schedule_candidate_scores c
      left join public.schedule_solution_assignments sa
        on sa.run_id = c.run_id
       and sa.assigned_employee_id = c.employee_id
      left join public.schedule_work_items assigned_wi
        on assigned_wi.id = sa.work_item_id
      where c.run_id = v_run_id
        and c.work_item_id = v_item.id
        and c.eligible = true
      group by c.employee_id
    ), candidate_balance as (
      select
        c.*,
        coalesce(csl.assigned_load_points, 0)::numeric as current_solution_load,
        coalesce(csl.required_location_count, 0)::integer as current_required_location_count,
        abs((coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - v_target_required_load)::numeric as target_load_gap_after,
        greatest(
          0,
          100
            - (abs((coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - v_target_required_load) * 8)
            - (greatest(0, coalesce(csl.required_location_count, 0) - floor(v_target_required_location_count)::integer) * 4)
        )::numeric as dynamic_workload_score
      from public.schedule_candidate_scores c
      join current_solution_load csl on csl.employee_id = c.employee_id
      where c.run_id = v_run_id
        and c.work_item_id = v_item.id
        and c.eligible = true
    ), candidate_ranked as (
      select
        cb.*,
        round(((cb.route_fit_score * 0.75) + (cb.dynamic_workload_score * 0.25))::numeric, 2) as balanced_total_score,
        row_number() over (
          order by
            round(((cb.route_fit_score * 0.75) + (cb.dynamic_workload_score * 0.25))::numeric, 2) desc,
            cb.target_load_gap_after asc,
            cb.current_required_location_count asc,
            cb.current_solution_load asc,
            case when cb.employee_id = v_item.original_assigned_employee_id then 0 else 1 end,
            cb.employee_id
        )::integer as balanced_rank
      from candidate_balance cb
    )
    select * into v_choice
    from candidate_ranked
    order by balanced_rank asc
    limit 1;

    if not found then
      v_final_employee_id := null;
      v_final_total_score := 0;
      v_final_proximity_score := 0;
      v_final_route_fit_score := 0;
      v_final_workload_score := 0;
      v_final_hard_reject_reasons := array['no_eligible_candidate']::text[];
      v_final_current_solution_load := 0;
      v_final_required_location_count := 0;
      v_final_target_load_gap_after := 0;
      v_final_balanced_rank := null;
      v_assignment_reason := 'no_eligible_candidate_required_open';
    else
      v_final_employee_id := v_choice.employee_id;
      v_final_total_score := coalesce(v_choice.total_score, 0);
      v_final_proximity_score := coalesce(v_choice.proximity_score, 0);
      v_final_route_fit_score := coalesce(v_choice.route_fit_score, 0);
      v_final_workload_score := coalesce(v_choice.dynamic_workload_score, v_choice.workload_score, 0);
      v_final_hard_reject_reasons := coalesce(v_choice.hard_reject_reasons, array[]::text[]);
      v_final_current_solution_load := coalesce(v_choice.current_solution_load, 0);
      v_final_required_location_count := coalesce(v_choice.current_required_location_count, 0);
      v_final_target_load_gap_after := coalesce(v_choice.target_load_gap_after, 0);
      v_final_total_score := coalesce(v_choice.balanced_total_score, v_final_total_score);
      v_final_balanced_rank := v_choice.balanced_rank;
      v_assignment_reason := case
        when v_final_employee_id = v_item.original_assigned_employee_id then 'kept_existing_owner_after_fairness'
        else 'selected_fair_balanced_candidate'
      end;
    end if;

    insert into public.schedule_solution_assignments (
      run_id,
      work_item_id,
      service_date,
      location_group_id,
      segment_number,
      assigned_employee_id,
      owner_type,
      coverage_start,
      coverage_end,
      coverage_purpose,
      status,
      source_type,
      source_daily_assignment_id,
      load_points,
      assignment_reason,
      score_total,
      score_breakdown,
      notes
    ) values (
      v_item.run_id,
      v_item.id,
      v_item.service_date,
      v_item.location_group_id,
      v_item.segment_number,
      v_final_employee_id,
      case when v_final_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
      v_item.coverage_start,
      v_item.coverage_end,
      v_item.coverage_purpose,
      case when v_final_employee_id is null then 'OPEN' else 'ASSIGNED' end,
      'sch2_preview',
      v_item.source_daily_assignment_id,
      v_item.load_points,
      v_assignment_reason,
      v_final_total_score,
      jsonb_build_object(
        'total_score', v_final_total_score,
        'proximity_score', v_final_proximity_score,
        'route_fit_score', v_final_route_fit_score,
        'workload_score', v_final_workload_score,
        'target_required_load', v_target_required_load,
        'target_required_location_count', v_target_required_location_count,
        'current_solution_load', v_final_current_solution_load,
        'current_required_location_count', v_final_required_location_count,
        'target_load_gap_after', v_final_target_load_gap_after,
        'balanced_rank', v_final_balanced_rank,
        'hard_reject_reasons', coalesce(to_jsonb(v_final_hard_reject_reasons), '[]'::jsonb)
      ),
      concat_ws(' | ', nullif(v_item.notes, ''), 'SCH2 preview')
    );
  end loop;

  insert into public.schedule_solution_assignments (
    run_id,
    work_item_id,
    service_date,
    location_group_id,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    coverage_purpose,
    status,
    source_type,
    source_daily_assignment_id,
    load_points,
    assignment_reason,
    score_total,
    score_breakdown,
    notes
  )
  select
    wi.run_id,
    wi.id,
    wi.service_date,
    wi.location_group_id,
    wi.segment_number,
    wi.original_assigned_employee_id,
    case when wi.original_assigned_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
    wi.coverage_start,
    wi.coverage_end,
    wi.coverage_purpose,
    case when wi.original_assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end,
    'sch2_preview',
    wi.source_daily_assignment_id,
    wi.load_points,
    'preserved_non_required_preview_item',
    0,
    jsonb_build_object(
      'target_required_load', v_target_required_load,
      'target_required_location_count', v_target_required_location_count,
      'hard_reject_reasons', '[]'::jsonb
    ),
    concat_ws(' | ', nullif(wi.notes, ''), 'SCH2 preview')
  from public.schedule_work_items wi
  where wi.run_id = v_run_id
    and wi.required = false;

  v_audit := public.sch2_audit_solution(v_run_id);
  v_diff := public.sch2_compare_current_vs_preview(v_run_id);

  update public.schedule_generation_runs
     set diff_summary = v_diff, updated_at = now()
   where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'run_id', v_run_id,
    'service_date', p_service_date,
    'audit', v_audit,
    'diff', v_diff
  );
exception
  when others then
    if v_run_id is not null then
      update public.schedule_generation_runs
         set status = 'preview_error', error_message = sqlerrm, updated_at = now()
       where id = v_run_id;
    end if;
    raise;
end;
$function$;

create or replace function public.sch2_compare_current_vs_preview(p_run_id uuid)
returns jsonb
language sql
stable
as $function$
  select jsonb_build_object(
    'run_id', p_run_id,
    'diff_count', count(*) filter (where diff_type <> 'same'),
    'changed_count', count(*) filter (where diff_type = 'changed'),
    'preview_only_count', count(*) filter (where diff_type = 'preview_only'),
    'current_only_count', count(*) filter (where diff_type = 'current_only'),
    'diffs', coalesce(jsonb_agg(to_jsonb(d) order by coverage_start, location_group_id::text) filter (where diff_type <> 'same'), '[]'::jsonb)
  )
  from public.v_sch2_publish_diff d
  where d.run_id = p_run_id;
$function$;

create or replace function public.sch2_explain_assignment(p_run_id uuid, p_work_item_id uuid)
returns jsonb
language sql
stable
as $function$
  select jsonb_build_object(
    'run_id', p_run_id,
    'work_item', to_jsonb(wi),
    'solution', to_jsonb(sa),
    'candidates', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.eligible desc, c.total_score desc)
      from public.schedule_candidate_scores c
      where c.run_id = p_run_id
        and c.work_item_id = p_work_item_id
    ), '[]'::jsonb),
    'violations', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.violation_type)
      from public.v_sch2_constraint_violations v
      where v.run_id = p_run_id
        and v.work_item_id = p_work_item_id
    ), '[]'::jsonb)
  )
  from public.schedule_work_items wi
  left join public.schedule_solution_assignments sa on sa.work_item_id = wi.id and sa.run_id = wi.run_id
  where wi.run_id = p_run_id
    and wi.id = p_work_item_id;
$function$;

create or replace function public.sch2_publish_solution(p_run_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql
as $function$
declare
  v_run public.schedule_generation_runs%rowtype;
  v_audit jsonb;
  v_diff jsonb;
  v_audit_id uuid;
  v_previous_rows jsonb := '[]'::jsonb;
  v_published_rows jsonb := '[]'::jsonb;
  v_current_hash text;
  v_inserted integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('memphis_sch2_publish'));

  select * into v_run
  from public.schedule_generation_runs
  where id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SCH2 run not found', 'run_id', p_run_id);
  end if;

  v_current_hash := public.sch2_input_hash(v_run.service_date);
  if v_current_hash is distinct from v_run.input_hash then
    return jsonb_build_object(
      'ok', false,
      'error', 'SCH2 preview is stale; regenerate before publishing',
      'run_id', p_run_id,
      'service_date', v_run.service_date,
      'preview_input_hash', v_run.input_hash,
      'current_input_hash', v_current_hash
    );
  end if;

  v_audit := public.sch2_audit_solution(p_run_id);
  if coalesce((v_audit->>'hard_violation_count')::integer, 0) > 0
     or coalesce((v_audit->>'open_required_count')::integer, 0) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'SCH2 publish blocked by hard violations or required OPEN rows',
      'run_id', p_run_id,
      'audit', v_audit
    );
  end if;

  v_diff := public.sch2_compare_current_vs_preview(p_run_id);

  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_previous_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_run.service_date;

  insert into public.schedule_publish_audit (
    run_id,
    service_date,
    previous_rows,
    published_rows,
    diff_summary,
    published_by,
    status,
    published_at
  ) values (
    p_run_id,
    v_run.service_date,
    v_previous_rows,
    '[]'::jsonb,
    v_diff,
    current_user,
    case when coalesce(p_confirm, false) then 'publishing' else 'dry_run' end,
    now()
  ) returning id into v_audit_id;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'publish_audit_id', v_audit_id,
      'run_id', p_run_id,
      'service_date', v_run.service_date,
      'audit', v_audit,
      'diff', v_diff
    );
  end if;

  delete from public.daily_schedule_assignments
   where service_date = v_run.service_date;

  insert into public.daily_schedule_assignments (
    service_date,
    location_group_id,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    status,
    load_points,
    notes,
    source_type,
    coverage_purpose
  )
  select
    sa.service_date,
    sa.location_group_id,
    sa.segment_number,
    sa.assigned_employee_id,
    sa.owner_type,
    sa.coverage_start,
    sa.coverage_end,
    sa.status,
    sa.load_points,
    concat_ws(' | ', nullif(sa.notes, ''), 'Published by SCH2 run ' || p_run_id::text),
    'sch2_published',
    sa.coverage_purpose
  from public.schedule_solution_assignments sa
  where sa.run_id = p_run_id
  order by sa.coverage_start, sa.location_group_id, sa.segment_number;

  get diagnostics v_inserted = row_count;

  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_published_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_run.service_date;

  update public.schedule_publish_audit
     set published_rows = v_published_rows,
         status = 'published',
         published_at = now()
   where id = v_audit_id;

  update public.schedule_generation_runs
     set status = 'published', published_at = now(), published_by = current_user, updated_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'publish_audit_id', v_audit_id,
    'run_id', p_run_id,
    'service_date', v_run.service_date,
    'inserted_rows', v_inserted,
    'audit', v_audit,
    'diff', v_diff
  );
exception
  when others then
    if v_audit_id is not null then
      update public.schedule_publish_audit
         set status = 'publish_error', error_message = sqlerrm
       where id = v_audit_id;
    end if;
    raise;
end;
$function$;

create or replace function public.sch2_rollback_publish(p_publish_audit_id uuid)
returns jsonb
language plpgsql
as $function$
declare
  v_audit public.schedule_publish_audit%rowtype;
  v_restored integer := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('memphis_sch2_publish'));

  select * into v_audit
  from public.schedule_publish_audit
  where id = p_publish_audit_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'publish audit row not found', 'publish_audit_id', p_publish_audit_id);
  end if;

  if v_audit.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'publish audit row is not in published status', 'publish_audit_id', p_publish_audit_id, 'status', v_audit.status);
  end if;

  delete from public.daily_schedule_assignments
   where service_date = v_audit.service_date;

  insert into public.daily_schedule_assignments (
    id,
    service_date,
    location_group_id,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    status,
    load_points,
    notes,
    source_type,
    created_at,
    updated_at,
    coverage_purpose
  )
  select
    coalesce(x.id, gen_random_uuid()),
    coalesce(x.service_date, v_audit.service_date),
    x.location_group_id,
    coalesce(x.segment_number, 1),
    x.assigned_employee_id,
    coalesce(x.owner_type, case when x.assigned_employee_id is null then 'OPEN' else 'EMPLOYEE' end),
    x.coverage_start,
    x.coverage_end,
    coalesce(x.status, case when x.assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end),
    coalesce(x.load_points, 0),
    x.notes,
    coalesce(x.source_type, 'sch2_rollback'),
    coalesce(x.created_at, now()),
    now(),
    coalesce(x.coverage_purpose, 'area_owner')
  from jsonb_to_recordset(v_audit.previous_rows) as x(
    id uuid,
    service_date date,
    location_group_id uuid,
    segment_number integer,
    assigned_employee_id uuid,
    owner_type text,
    coverage_start time,
    coverage_end time,
    status text,
    load_points numeric,
    notes text,
    source_type text,
    created_at timestamptz,
    updated_at timestamptz,
    coverage_purpose text
  );

  get diagnostics v_restored = row_count;

  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_audit.service_date;

  update public.schedule_publish_audit
     set status = 'rolled_back',
         rolled_back_at = now(),
         rollback_rows = v_rows
   where id = p_publish_audit_id;

  update public.schedule_generation_runs
     set status = 'rolled_back', updated_at = now()
   where id = v_audit.run_id;

  return jsonb_build_object(
    'ok', true,
    'publish_audit_id', p_publish_audit_id,
    'run_id', v_audit.run_id,
    'service_date', v_audit.service_date,
    'restored_rows', v_restored
  );
end;
$function$;
