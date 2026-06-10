-- Memphis Zoo Kathy Phelps east-boundary safety guard.
-- Purpose: Kathy's west-end route may stretch to Tropical Birds only; do not
-- assign Kathy to locations east of Tropical Birds unless an explicit future
-- manual override changes this policy.

insert into public.schedule_operational_notes (rule_code, category, rule_text, enforcement_target, active)
values (
  'kathy_east_boundary',
  'employee_restriction',
  'Kathy Phelps stays on the west-end route. Tropical Birds is the farthest east stretch area; do not assign Kathy to Cathouse Cafe Restrooms, Event Center, Herpetarium, or any other area east of Tropical Birds unless an explicit manual override is recorded.',
  'employee_area_preferences / restriction guard / printout generator',
  true
)
on conflict (rule_code) do update set
  category = excluded.category,
  rule_text = excluded.rule_text,
  enforcement_target = excluded.enforcement_target,
  active = excluded.active,
  updated_at = now();

update public.schedule_operational_notes
   set rule_text = 'Kathy Phelps should stay on the west end. Core areas are Expo, Aquarium, Komodos, and MemMex Restrooms. Tropical Birds is the farthest east stretch/last-resort area. Areas east of Tropical Birds, including Cathouse Cafe Restrooms, Event Center, and Herpetarium, are restricted unless an explicit manual override is recorded.',
       category = 'employee_preference',
       enforcement_target = 'employee_area_preferences / restriction guard / scheduler scoring',
       active = true,
       updated_at = now()
 where rule_code = 'kathy_route';

-- Keep Tropical Birds as the farthest allowed stretch only, not a normal route.
select public.sch_upsert_employee_area_preference_by_code(
  'Kathy Phelps',
  'TROPICAL_BIRDS',
  'avoid',
  'Kathy farthest allowed east stretch; do not assign farther east unless an explicit manual override is recorded.',
  true,
  false
);

-- Hard-restrict locations east of Tropical Birds for Kathy.
select public.sch_upsert_employee_area_preference_by_code(
  'Kathy Phelps',
  x.group_code,
  'restricted',
  'Kathy east-boundary restriction: beyond Tropical Birds; do not assign unless an explicit manual override is recorded.',
  true,
  true
)
from (values
  ('CATHOUSE_CAFE_RESTROOMS'),
  ('EVENT_CENTER'),
  ('HERPETARIUM')
) as x(group_code);

-- Make the restriction guard fail closed even if a preference row is later edited.
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
      when t.display_name = 'Kathy Phelps'
       and t.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM') then
        true
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

-- Remove Kathy from active static templates east of Tropical Birds. Keep the
-- template row open so coverage is still visible and can be reassigned.
update public.coverage_templates ct
   set assigned_employee_id = null,
       owner_type = 'OPEN',
       notes = trim(concat_ws(
         ' | ',
         nullif(ct.notes, ''),
         'Opened by Kathy east-boundary guard: Kathy is not assigned east of Tropical Birds.'
       )),
       updated_at = now()
  from public.employees e,
       public.location_groups lg
 where e.id = ct.assigned_employee_id
   and lg.id = ct.location_group_id
   and e.display_name = 'Kathy Phelps'
   and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')
   and ct.active = true;

-- Remove Kathy from already-generated current/future live schedule rows east of
-- Tropical Birds. Keep the row open; do not silently reassign to the wrong person.
update public.daily_schedule_assignments dsa
   set assigned_employee_id = null,
       owner_type = 'OPEN',
       status = 'OPEN',
       source_type = trim(both ':' from concat_ws(':', nullif(dsa.source_type, ''), 'kathy_east_boundary_guard')),
       notes = trim(concat_ws(
         ' | ',
         nullif(dsa.notes, ''),
         'Opened by Kathy east-boundary guard: Kathy is not assigned east of Tropical Birds.'
       )),
       updated_at = now()
  from public.employees e,
       public.location_groups lg
 where e.id = dsa.assigned_employee_id
   and lg.id = dsa.location_group_id
   and e.display_name = 'Kathy Phelps'
   and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')
   and dsa.service_date >= public.sch_service_date(now())::date
   and coalesce(dsa.status, '') = 'ASSIGNED';

create or replace function public.sch_validate_kathy_east_boundary(
  p_start_date date default current_date,
  p_end_date date default (current_date + 60)
)
returns table(
  violation_type text,
  source_table text,
  service_date date,
  day_of_week integer,
  group_code text,
  group_name text,
  employee_name text,
  coverage_start text,
  coverage_end text,
  coverage_purpose text,
  notes text
)
language sql
stable
as $$
  select
    'kathy_east_boundary_template'::text,
    'coverage_templates'::text,
    null::date,
    ct.day_of_week,
    lg.group_code,
    lg.group_name,
    e.display_name,
    to_char(ct.coverage_start, 'HH24:MI:SS'),
    to_char(ct.coverage_end, 'HH24:MI:SS'),
    ct.coverage_purpose,
    ct.notes
  from public.coverage_templates ct
  join public.employees e on e.id = ct.assigned_employee_id
  join public.location_groups lg on lg.id = ct.location_group_id
  where ct.active = true
    and e.display_name = 'Kathy Phelps'
    and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')

  union all

  select
    'kathy_east_boundary_daily'::text,
    'daily_schedule_assignments'::text,
    dsa.service_date,
    extract(dow from dsa.service_date)::integer,
    lg.group_code,
    lg.group_name,
    e.display_name,
    to_char(dsa.coverage_start, 'HH24:MI:SS'),
    to_char(dsa.coverage_end, 'HH24:MI:SS'),
    dsa.coverage_purpose,
    dsa.notes
  from public.daily_schedule_assignments dsa
  join public.employees e on e.id = dsa.assigned_employee_id
  join public.location_groups lg on lg.id = dsa.location_group_id
  where dsa.service_date between coalesce(p_start_date, current_date) and coalesce(p_end_date, coalesce(p_start_date, current_date))
    and coalesce(dsa.status, '') = 'ASSIGNED'
    and e.display_name = 'Kathy Phelps'
    and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')

  union all

  select
    'kathy_missing_restricted_preference'::text,
    'employee_area_preferences'::text,
    null::date,
    null::integer,
    lg.group_code,
    lg.group_name,
    e.display_name,
    null::text,
    null::text,
    null::text,
    'Kathy east-boundary preference is not active/restricted.'::text
  from public.employees e
  cross join public.location_groups lg
  where e.display_name = 'Kathy Phelps'
    and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')
    and not exists (
      select 1
      from public.employee_area_preferences eap
      where eap.employee_id = e.id
        and eap.location_group_id = lg.id
        and eap.active = true
        and lower(coalesce(eap.preference_type, '')) = 'restricted'
    );
$$;
