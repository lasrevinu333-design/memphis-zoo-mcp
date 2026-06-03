-- Memphis Zoo scheduler safety guard: Alijah / Herpetarium restriction.
-- Rule: Alijah Collins must not be assigned to clean Herpetarium unless a
-- manager has explicitly recorded the narrow Monday exception condition.
-- Existing live data currently has Alijah/HERPETARIUM marked restricted; this
-- migration makes the scheduler enforce that restriction at write/materialize time.

create or replace function public.sch_alijah_herpetarium_monday_exception_allowed(
  p_employee_id uuid,
  p_location_group_id uuid,
  p_day_of_week integer
)
returns boolean
language sql
stable
as $$
  select coalesce((
    select
      p_day_of_week = 1
      and e.display_name = 'Alijah Collins'
      and lg.group_code = 'HERPETARIUM'
      and exists (
        select 1
        from public.employee_area_preferences allow_pref
        where allow_pref.employee_id = p_employee_id
          and allow_pref.location_group_id = p_location_group_id
          and allow_pref.active = true
          and lower(coalesce(allow_pref.preference_type, '')) in ('allow','allowed','prefer','preferred')
          and allow_pref.notes ilike '%monday%'
          and allow_pref.notes ilike '%husband not working%'
      )
    from public.employees e
    join public.location_groups lg on lg.id = p_location_group_id
    where e.id = p_employee_id
  ), false);
$$;

create or replace function public.sch_is_employee_location_group_restricted(
  p_employee_id uuid,
  p_location_group_id uuid,
  p_day_of_week integer default null
)
returns boolean
language sql
stable
as $$
  with target as (
    select e.display_name, lg.group_code
    from public.employees e
    join public.location_groups lg on lg.id = p_location_group_id
    where e.id = p_employee_id
  )
  select coalesce((
    select case
      when t.display_name = 'Alijah Collins' and t.group_code = 'HERPETARIUM' then
        not public.sch_alijah_herpetarium_monday_exception_allowed(
          p_employee_id,
          p_location_group_id,
          p_day_of_week
        )
      else exists (
        select 1
        from public.employee_area_preferences eap
        where eap.employee_id = p_employee_id
          and eap.location_group_id = p_location_group_id
          and eap.active = true
          and lower(coalesce(eap.preference_type, '')) = 'restricted'
      )
    end
    from target t
  ), false);
$$;

create or replace function public.sch_guard_restricted_daily_assignment()
returns trigger
language plpgsql
as $$
declare
  v_day integer;
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  v_day := extract(dow from new.service_date)::integer;

  if public.sch_is_employee_location_group_restricted(new.assigned_employee_id, new.location_group_id, v_day) then
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.status := 'OPEN';
    new.notes := trim(concat_ws(
      ' | ',
      nullif(new.notes, ''),
      'Opened by schedule safety guard: assigned employee is restricted from this location group.'
    ));
    new.source_type := trim(both ':' from concat_ws(
      ':',
      nullif(new.source_type, ''),
      'restricted_guard'
    ));
  end if;

  return new;
end;
$$;

create or replace function public.sch_guard_restricted_coverage_template()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  if public.sch_is_employee_location_group_restricted(new.assigned_employee_id, new.location_group_id, new.day_of_week) then
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.notes := trim(concat_ws(
      ' | ',
      nullif(new.notes, ''),
      'Opened by schedule safety guard: assigned employee is restricted from this location group.'
    ));
  end if;

  return new;
end;
$$;

create or replace function public.sch_guard_restricted_location_coverage_template()
returns trigger
language plpgsql
as $$
declare
  v_location_group_id uuid;
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  select lgm.location_group_id
    into v_location_group_id
  from public.location_group_memberships lgm
  join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
  where lgm.location_id = new.location_id
    and lgm.active = true
  order by lg.group_code
  limit 1;

  if v_location_group_id is not null
     and public.sch_is_employee_location_group_restricted(new.assigned_employee_id, v_location_group_id, new.day_of_week) then
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.notes := trim(concat_ws(
      ' | ',
      nullif(new.notes, ''),
      'Opened by schedule safety guard: assigned employee is restricted from this location group.'
    ));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sch_guard_restricted_daily_assignment on public.daily_schedule_assignments;
create trigger trg_sch_guard_restricted_daily_assignment
before insert or update of service_date, location_group_id, assigned_employee_id
on public.daily_schedule_assignments
for each row
execute function public.sch_guard_restricted_daily_assignment();

drop trigger if exists trg_sch_guard_restricted_coverage_template on public.coverage_templates;
create trigger trg_sch_guard_restricted_coverage_template
before insert or update of location_group_id, day_of_week, assigned_employee_id
on public.coverage_templates
for each row
execute function public.sch_guard_restricted_coverage_template();

drop trigger if exists trg_sch_guard_restricted_location_coverage_template on public.location_coverage_templates;
create trigger trg_sch_guard_restricted_location_coverage_template
before insert or update of location_id, day_of_week, assigned_employee_id
on public.location_coverage_templates
for each row
execute function public.sch_guard_restricted_location_coverage_template();

create or replace function public.sch_validate_alijah_herpetarium_rule(
  p_start_date date default current_date,
  p_end_date date default (current_date + 60)
)
returns table(
  source_table text,
  service_date date,
  day_of_week integer,
  group_code text,
  group_name text,
  employee_name text,
  segment_number integer,
  coverage_start text,
  coverage_end text,
  notes text
)
language sql
stable
as $$
  with alijah as (
    select id, display_name from public.employees where display_name = 'Alijah Collins' limit 1
  ), herp as (
    select id, group_code, group_name from public.location_groups where group_code = 'HERPETARIUM' limit 1
  ), date_window as (
    select coalesce(p_start_date, current_date) as start_date,
           coalesce(p_end_date, coalesce(p_start_date, current_date)) as end_date
  )
  select
    'coverage_templates'::text as source_table,
    null::date as service_date,
    ct.day_of_week,
    h.group_code,
    h.group_name,
    a.display_name as employee_name,
    ct.segment_number,
    to_char(ct.coverage_start, 'HH24:MI:SS') as coverage_start,
    to_char(ct.coverage_end, 'HH24:MI:SS') as coverage_end,
    ct.notes
  from public.coverage_templates ct
  cross join alijah a
  cross join herp h
  where ct.active = true
    and ct.assigned_employee_id = a.id
    and ct.location_group_id = h.id
    and public.sch_is_employee_location_group_restricted(ct.assigned_employee_id, ct.location_group_id, ct.day_of_week)

  union all

  select
    'daily_schedule_assignments'::text as source_table,
    dsa.service_date,
    extract(dow from dsa.service_date)::integer as day_of_week,
    h.group_code,
    h.group_name,
    a.display_name as employee_name,
    dsa.segment_number,
    to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
    to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
    dsa.notes
  from public.daily_schedule_assignments dsa
  cross join alijah a
  cross join herp h
  cross join date_window dw
  where dsa.service_date between dw.start_date and dw.end_date
    and dsa.assigned_employee_id = a.id
    and dsa.location_group_id = h.id
    and public.sch_is_employee_location_group_restricted(dsa.assigned_employee_id, dsa.location_group_id, extract(dow from dsa.service_date)::integer)

  union all

  select
    'location_coverage_templates'::text as source_table,
    null::date as service_date,
    lct.day_of_week,
    h.group_code,
    h.group_name,
    a.display_name as employee_name,
    lct.segment_number,
    to_char(lct.coverage_start, 'HH24:MI:SS') as coverage_start,
    to_char(lct.coverage_end, 'HH24:MI:SS') as coverage_end,
    lct.notes
  from public.location_coverage_templates lct
  join public.location_group_memberships lgm on lgm.location_id = lct.location_id and lgm.active = true
  cross join alijah a
  cross join herp h
  where lct.active = true
    and lct.assigned_employee_id = a.id
    and lgm.location_group_id = h.id
    and public.sch_is_employee_location_group_restricted(lct.assigned_employee_id, h.id, lct.day_of_week)
  order by source_table, day_of_week, coverage_start, segment_number;
$$;