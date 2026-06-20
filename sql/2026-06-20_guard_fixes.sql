-- H22 + H23 + H24 + H29: Guard function fixes.
--
-- H22: Fix sch_guard_operational_daily_assignment to RAISE EXCEPTION instead of
--      returning NULL when blocking a Herpetarium Wednesday insert. The error
--      message should say which employee and location was blocked.
-- H23: Fix guard functions failing open on NULL group_code. Add NULL check
--      that raises exception with the unknown location_group_id.
-- H24: Fix hardcoded employee name matching in sch_is_employee_location_group_restricted
--      to use employee_id (the stable identifier already passed as parameter)
--      instead of display_name. Keep display_name as a fallback comment.
-- H29: Fix sch_guard_restricted_daily_assignment NULL issue (covered by H23).

-- ============================================================================
-- H24: Fix sch_alijah_herpetarium_monday_exception_allowed to use employee_id
--      instead of display_name for the employee lookup. The function already
--      receives p_employee_id — use it directly with the preferences table.
-- ============================================================================
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
    from public.location_groups lg
    where lg.id = p_location_group_id
  ), false);
$$;

-- ============================================================================
-- H24: Fix sch_is_employee_location_group_restricted to use employee_id
--      instead of display_name. The original hardcoded 'Alijah Collins' name
--      match is replaced with a check that looks up whether this employee has
--      a 'restricted' preference for this location group, and if so, whether
--      the Monday exception applies.
-- ============================================================================
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
    -- H24: Use employee_id (stable) and group_code for matching.
    -- Original code matched on display_name = 'Alijah Collins' which is fragile.
    -- Now we match on the restriction preference by employee_id directly,
    -- and use group_code only for the Herpetarium-specific Monday exception.
    -- Fallback comment: display_name was 'Alijah Collins' in the original code.
    select lg.group_code
    from public.location_groups lg
    where lg.id = p_location_group_id
  )
  select coalesce((
    select case
      -- H24: Use group_code + employee_id-based preference check instead of
      -- hardcoded display_name. If the employee has an active 'restricted'
      -- preference for HERPETARIUM, check the Monday exception.
      when t.group_code = 'HERPETARIUM'
           and exists (
             select 1
             from public.employee_area_preferences eap
             where eap.employee_id = p_employee_id
               and eap.location_group_id = p_location_group_id
               and eap.active = true
               and lower(coalesce(eap.preference_type, '')) = 'restricted'
           ) then
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

-- ============================================================================
-- H22 + H23: Fix sch_guard_operational_daily_assignment
-- H22: RAISE EXCEPTION instead of returning NULL for Herpetarium Wednesday.
-- H23: Raise exception on NULL group_code instead of failing open.
-- ============================================================================
create or replace function public.sch_guard_operational_daily_assignment()
returns trigger
language plpgsql
as $$
declare
  v_group_code text;
  v_day integer;
  v_employee_name text;
begin
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  -- H23: Fail closed on unknown location_group_id instead of silently passing.
  if v_group_code is null then
    raise exception 'Unknown location_group_id %', new.location_group_id;
  end if;

  v_day := extract(dow from new.service_date)::integer;

  -- H22: Raise exception instead of returning NULL for Herpetarium Wednesday.
  -- Include the employee name and location in the error message.
  if v_group_code = 'HERPETARIUM' and v_day = 3 then
    select display_name into v_employee_name
    from public.employees
    where id = new.assigned_employee_id;

    raise exception 'Herpetarium Wednesday guard: blocked assignment for employee "%" (id %) to HERPETARIUM on Wednesday (service_date %). Herpetarium is not cleaned on Wednesdays.',
      coalesce(v_employee_name, 'UNKNOWN'), coalesce(new.assigned_employee_id::text, 'NULL'), new.service_date;
  end if;

  if v_group_code like '%GIFT_SHOP' and not (
    v_day = 1
    and coalesce(new.coverage_purpose, '') = 'reminder'
    and new.coverage_start = time '08:00'
    and new.coverage_end <= time '09:45'
  ) then
    select display_name into v_employee_name
    from public.employees
    where id = new.assigned_employee_id;

    raise exception 'Gift shop guard: blocked assignment for employee "%" (id %) to "%" on service_date %. Gift shops are Monday 8 AM reminder-only; this assignment does not meet the reminder-only criteria.',
      coalesce(v_employee_name, 'UNKNOWN'), coalesce(new.assigned_employee_id::text, 'NULL'), v_group_code, new.service_date;
  end if;

  if v_group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY') and coalesce(new.coverage_purpose, '') in ('deep_clean', 'cleaning', 'area_owner', 'late_coverage', '') then
    new.coverage_purpose := 'response_only';
    new.notes := trim(concat_ws(' | ', nullif(new.notes, ''), 'No Clean / Calls to Location Only. Response-only ownership; not normal deep-clean schedule work.'));
  end if;

  return new;
end;
$$;

-- ============================================================================
-- H23 + H29: Fix sch_guard_restricted_daily_assignment NULL group_code issue.
-- Add NULL check that raises exception with the unknown location_group_id.
-- ============================================================================
create or replace function public.sch_guard_restricted_daily_assignment()
returns trigger
language plpgsql
as $$
declare
  v_day integer;
  v_group_code text;
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  -- H23: Look up group_code and fail closed on NULL.
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  if v_group_code is null then
    raise exception 'Unknown location_group_id %', new.location_group_id;
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
