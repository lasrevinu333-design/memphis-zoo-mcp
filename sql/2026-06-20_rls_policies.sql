-- H17-H20: Add RLS policies to unprotected tables.
--
-- schedule_automation_runs: service_role can do all, authenticated can read
-- schedule_operational_notes: service_role can do all, authenticated can read
-- All SCH2 tables: service_role can all, authenticated can read
-- events_app_events.end_date: RLS already covers the table (column-level is automatic)

-- ============================================================================
-- H17: schedule_automation_runs
-- ============================================================================
alter table public.schedule_automation_runs enable row level security;

drop policy if exists schedule_automation_runs_service_all on public.schedule_automation_runs;
create policy schedule_automation_runs_service_all
  on public.schedule_automation_runs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_automation_runs_authed_read on public.schedule_automation_runs;
create policy schedule_automation_runs_authed_read
  on public.schedule_automation_runs
  for select
  to authenticated
  using (true);

-- ============================================================================
-- H18: schedule_operational_notes
-- ============================================================================
alter table public.schedule_operational_notes enable row level security;

drop policy if exists schedule_operational_notes_service_all on public.schedule_operational_notes;
create policy schedule_operational_notes_service_all
  on public.schedule_operational_notes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_operational_notes_authed_read on public.schedule_operational_notes;
create policy schedule_operational_notes_authed_read
  on public.schedule_operational_notes
  for select
  to authenticated
  using (true);

-- ============================================================================
-- H19: All SCH2 tables — service_role can all, authenticated can read
-- ============================================================================

-- schedule_generation_runs
alter table public.schedule_generation_runs enable row level security;

drop policy if exists schedule_generation_runs_service_all on public.schedule_generation_runs;
create policy schedule_generation_runs_service_all
  on public.schedule_generation_runs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_generation_runs_authed_read on public.schedule_generation_runs;
create policy schedule_generation_runs_authed_read
  on public.schedule_generation_runs
  for select
  to authenticated
  using (true);

-- schedule_work_items
alter table public.schedule_work_items enable row level security;

drop policy if exists schedule_work_items_service_all on public.schedule_work_items;
create policy schedule_work_items_service_all
  on public.schedule_work_items
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_work_items_authed_read on public.schedule_work_items;
create policy schedule_work_items_authed_read
  on public.schedule_work_items
  for select
  to authenticated
  using (true);

-- schedule_candidate_scores
alter table public.schedule_candidate_scores enable row level security;

drop policy if exists schedule_candidate_scores_service_all on public.schedule_candidate_scores;
create policy schedule_candidate_scores_service_all
  on public.schedule_candidate_scores
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_candidate_scores_authed_read on public.schedule_candidate_scores;
create policy schedule_candidate_scores_authed_read
  on public.schedule_candidate_scores
  for select
  to authenticated
  using (true);

-- schedule_solution_assignments
alter table public.schedule_solution_assignments enable row level security;

drop policy if exists schedule_solution_assignments_service_all on public.schedule_solution_assignments;
create policy schedule_solution_assignments_service_all
  on public.schedule_solution_assignments
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_solution_assignments_authed_read on public.schedule_solution_assignments;
create policy schedule_solution_assignments_authed_read
  on public.schedule_solution_assignments
  for select
  to authenticated
  using (true);

-- schedule_manual_locks
alter table public.schedule_manual_locks enable row level security;

drop policy if exists schedule_manual_locks_service_all on public.schedule_manual_locks;
create policy schedule_manual_locks_service_all
  on public.schedule_manual_locks
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_manual_locks_authed_read on public.schedule_manual_locks;
create policy schedule_manual_locks_authed_read
  on public.schedule_manual_locks
  for select
  to authenticated
  using (true);

-- schedule_publish_audit
alter table public.schedule_publish_audit enable row level security;

drop policy if exists schedule_publish_audit_service_all on public.schedule_publish_audit;
create policy schedule_publish_audit_service_all
  on public.schedule_publish_audit
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_publish_audit_authed_read on public.schedule_publish_audit;
create policy schedule_publish_audit_authed_read
  on public.schedule_publish_audit
  for select
  to authenticated
  using (true);

-- ============================================================================
-- H20: events_app_events.end_date
-- RLS on events_app_events already covers all columns including end_date.
-- If RLS is not yet enabled, enable it with the same pattern.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'events_app_events'
      and c.relrowsecurity = true
  ) then
    alter table public.events_app_events enable row level security;
  end if;
end;
$$;

-- Ensure service_role has full access and authenticated can read events.
drop policy if exists events_app_events_service_all on public.events_app_events;
create policy events_app_events_service_all
  on public.events_app_events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists events_app_events_authed_read on public.events_app_events;
create policy events_app_events_authed_read
  on public.events_app_events
  for select
  to authenticated
  using (true);

-- ============================================================================
-- MEDIUM SQL: updated_at triggers for schedule_automation_runs and
--             schedule_operational_notes
-- ============================================================================

-- Trigger function for schedule_automation_runs updated_at
create or replace function public.set_updated_at_schedule_automation_runs()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_schedule_automation_runs_updated_at on public.schedule_automation_runs;
create trigger trg_schedule_automation_runs_updated_at
  before update on public.schedule_automation_runs
  for each row
  execute function public.set_updated_at_schedule_automation_runs();

-- Trigger function for schedule_operational_notes updated_at
create or replace function public.set_updated_at_schedule_operational_notes()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_schedule_operational_notes_updated_at on public.schedule_operational_notes;
create trigger trg_schedule_operational_notes_updated_at
  before update on public.schedule_operational_notes
  for each row
  execute function public.set_updated_at_schedule_operational_notes();

-- ============================================================================
-- MEDIUM SQL: CHECK constraints
-- ============================================================================

-- schedule_automation_runs: status enum
alter table public.schedule_automation_runs
  drop constraint if exists schedule_automation_runs_status_check;
alter table public.schedule_automation_runs
  add constraint schedule_automation_runs_status_check
  check (status in ('pending', 'running', 'completed', 'failed'));

-- schedule_operational_notes: category enum
alter table public.schedule_operational_notes
  drop constraint if exists schedule_operational_notes_category_check;
alter table public.schedule_operational_notes
  add constraint schedule_operational_notes_category_check
  check (category in (
    'scheduler_priority', 'lunch_coverage', 'device_schedule', 'printouts',
    'schedule_scope', 'employee_restriction', 'employee_preference',
    'data_integrity'
  ));

-- schedule_operational_notes: enforcement_target enum
alter table public.schedule_operational_notes
  drop constraint if exists schedule_operational_notes_enforcement_target_check;
alter table public.schedule_operational_notes
  add constraint schedule_operational_notes_enforcement_target_check
  check (enforcement_target in (
    'scheduler scoring and candidate selection',
    'sch_apply_lunch_coverage / sch_get_coverage_candidates',
    'daily device schedule and printout generation',
    'print-first schedule documents',
    'coverage_templates / daily_schedule_assignments guards',
    'location groups / coverage purpose guards',
    'employee_area_preferences / restriction guard',
    'employee_area_preferences / scheduler scoring',
    'location_groups / NFC keys'
  ));

-- daily_schedule_assignments: coverage_end > coverage_start
alter table public.daily_schedule_assignments
  drop constraint if exists daily_schedule_assignments_coverage_end_after_start_check;
alter table public.daily_schedule_assignments
  add constraint daily_schedule_assignments_coverage_end_after_start_check
  check (coverage_end > coverage_start);

-- ============================================================================
-- MEDIUM SQL: Fix sch_upsert_employee_area_preference_by_code to raise
--             exception instead of silent no-op on missing employee/group
-- ============================================================================
create or replace function public.sch_upsert_employee_area_preference_by_code(
  p_employee_name text,
  p_group_code text,
  p_preference_type text,
  p_notes text,
  p_active boolean default true,
  p_override_restricted boolean default false
)
returns void
language plpgsql
as $$
declare
  v_employee_id uuid;
  v_location_group_id uuid;
  v_existing_id uuid;
  v_existing_type text;
begin
  select id into v_employee_id
  from public.employees
  where display_name = p_employee_name
  limit 1;

  select id into v_location_group_id
  from public.location_groups
  where group_code = p_group_code
  limit 1;

  if v_employee_id is null then
    raise exception 'Employee not found with display_name: %', p_employee_name;
  end if;

  if v_location_group_id is null then
    raise exception 'Location group not found with group_code: %', p_group_code;
  end if;

  select id, preference_type
    into v_existing_id, v_existing_type
  from public.employee_area_preferences
  where employee_id = v_employee_id
    and location_group_id = v_location_group_id
    and active = true
  order by updated_at desc nulls last, created_at desc nulls last
  limit 1;

  if v_existing_id is null then
    insert into public.employee_area_preferences (
      employee_id, location_group_id, preference_type, notes, active
    ) values (
      v_employee_id, v_location_group_id, p_preference_type, p_notes, p_active
    );
  elsif lower(coalesce(v_existing_type, '')) = 'restricted' and not p_override_restricted then
    update public.employee_area_preferences
       set notes = case
             when coalesce(notes, '') = '' then p_notes
             when notes ilike ('%' || p_notes || '%') then notes
             else trim(concat_ws(' | ', nullif(notes, ''), p_notes))
           end,
           updated_at = now()
     where id = v_existing_id;
  else
    update public.employee_area_preferences
       set preference_type = p_preference_type,
           notes = p_notes,
           active = p_active,
           updated_at = now()
     where id = v_existing_id;
  end if;
end;
$$;
