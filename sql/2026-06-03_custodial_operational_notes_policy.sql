-- Memphis Zoo custodial operational notes policy.
-- Purpose: make Eric's/ops notes first-class scheduler data and enforce the
-- rules in schedule generation, lunch coverage, and manual writes.

create table if not exists public.schedule_operational_notes (
  rule_code text primary key,
  category text not null,
  rule_text text not null,
  enforcement_target text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.schedule_operational_notes (rule_code, category, rule_text, enforcement_target, active)
values
  ('balance_primary', 'scheduler_priority', 'Equal balanced coverage across the working custodians on each day is the primary objective, especially restroom balance and lunch coverage. Employee route/location preferences are accommodation targets only; business needs and lunch coverage may override soft preferences.', 'scheduler scoring and candidate selection', true),
  ('no_same_lunch_relief', 'lunch_coverage', 'A custodian cannot cover another custodian during an overlapping lunch window. Same-lunch employees cannot cover each other.', 'sch_apply_lunch_coverage / sch_get_coverage_candidates', true),
  ('michael_device_call_coverage', 'device_schedule', 'Michael McWright is afternoon call coverage; on workdays his device/My Schedule page should show all locations as assigned to him after day-shift coverage ends so every location has an owner. Balanced paper training printouts should exclude Michael from morning/restroom/lunch balancing sections.', 'daily device schedule and printout generation', true),
  ('printouts_static_timeless', 'printouts', 'Weekly employee schedule printouts are timeless static full-attendance templates: no dates, no current-week labels, no generated-on clutter. Include day of week, employee name, morning assignments, 9:45 AM restroom rebalance, and lunch coverage times only; do not print employee clock-in/clock-out times.', 'print-first schedule documents', true),
  ('printouts_restrooms_first', 'printouts', 'Printed employee schedule assignments list visible Restrooms labels first, then exhibits/other areas; alphabetize within each group. Static printout restroom assignments should stay the same from Morning to 9:45 unless a true must-change condition exists.', 'print-first schedule documents', true),
  ('gift_shops_monday_reminders_only', 'schedule_scope', 'Gift shop areas are Monday 8:00 AM schedule reminders only, not scan-system work, not overdue-driver coverage, not after 9:45 AM, and not lunch coverage. Monday reminders: Kinnaye at Elephant Trunk Gift Shop plus Elephant Trunk employee restrooms; Sherita at Bamboo Gift Shop; Markiesha at Trading Post Gift Shop.', 'coverage_templates / daily_schedule_assignments guards', true),
  ('primate_canyon_cat_country_response_only', 'schedule_scope', 'Primate Canyon and Cat Country are labeled No Clean / Calls to Location Only. They are not normal deep-clean schedule work; if represented, they must be response-only ownership/call coverage.', 'location groups / coverage purpose guards', true),
  ('herpetarium_no_wednesday', 'schedule_scope', 'Herpetarium is not cleaned on Wednesdays and must not appear on Wednesday printed schedules or active Wednesday scan-system coverage.', 'coverage_templates / daily_schedule_assignments guards', true),
  ('alijah_herpetarium_restriction', 'employee_restriction', 'Alijah Collins must not be assigned to clean Herpetarium on any day except Monday, and only Monday when the husband-not-working exception has been explicitly recorded.', 'employee_area_preferences / restriction guard', true),
  ('kinnaye_route', 'employee_preference', 'Kinnaye Peete should be kept near the entrance/courtyard route when possible. Preferred nearby choices include West Admin, East Admin, Education, Courtyard Restrooms, Cathouse Cafe Restrooms, Nocturnal, and Elephant Trunk Restrooms. Farther fallback choices include Tropical Birds, Event Center, Splash Pad Restrooms, Bonobos Restrooms, and China only when load balance/business needs require.', 'employee_area_preferences / scheduler scoring', true),
  ('karen_route', 'employee_preference', 'Karen Robinson preferred route is Zambezi, Primate Pavillion, Breezeway Restrooms, Cathouse Cafe Restrooms, Tropical Birds, and Nocturnal. Karen last-resort areas include far west locations: Expo, Aquarium, Komodos, and MemMex Restrooms.', 'employee_area_preferences / scheduler scoring', true),
  ('tammy_route', 'employee_preference', 'Tammy Miller preferred route is Teton, North West Passage, East End Restrooms, and East End Break Room. Tammy options if needed are China and Primate Pavillion. Tammy absolute last resorts are west/central-west-end areas.', 'employee_area_preferences / scheduler scoring', true),
  ('kathy_route', 'employee_preference', 'Kathy Phelps should stay on the west end when possible, with preferred/core areas Expo, Aquarium, Komodos, and MemMex Restrooms. Her farthest/least-preferred stretch areas are Tropical Birds, Cathouse Cafe Restrooms, Event Center, and Herpetarium; existing route-limit restrictions still prevent lunch relief outside her assigned route.', 'employee_area_preferences / scheduler scoring', true),
  ('preserve_primate_pavillion_key', 'data_integrity', 'Preserve PRIMATE_PAVILLION as the real NFC/dashboard key and group code spelling even though the display spelling is unusual.', 'location_groups / NFC keys', true)
on conflict (rule_code) do update set
  category = excluded.category,
  rule_text = excluded.rule_text,
  enforcement_target = excluded.enforcement_target,
  active = excluded.active,
  updated_at = now();

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

  if v_employee_id is null or v_location_group_id is null then
    return;
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

alter table public.coverage_templates drop constraint if exists coverage_templates_purpose_check;
alter table public.coverage_templates add constraint coverage_templates_purpose_check
  check (coverage_purpose = any (array['deep_clean'::text, 'area_owner'::text, 'restroom_upkeep'::text, 'reminder'::text, 'late_coverage'::text, 'response_only'::text]));

alter table public.daily_schedule_assignments drop constraint if exists daily_schedule_assignments_purpose_check;
alter table public.daily_schedule_assignments add constraint daily_schedule_assignments_purpose_check
  check (coverage_purpose = any (array['deep_clean'::text, 'area_owner'::text, 'restroom_upkeep'::text, 'reminder'::text, 'late_coverage'::text, 'lunch_coverage'::text, 'response_only'::text]));

-- Employee route preferences / restrictions.
select public.sch_upsert_employee_area_preference_by_code('Alijah Collins', 'HERPETARIUM', 'restricted', 'Hard restriction: Alijah cannot be assigned to Herpetarium except the explicit Monday husband-not-working exception.', true, true);

select public.sch_upsert_employee_area_preference_by_code('Kinnaye Peete', x.group_code, 'prefer', 'Kinnaye entrance/courtyard route preference; keep nearby when possible.', true, false)
from (values
  ('WEST_ADMIN'), ('EAST_ADMIN'), ('EDUCATION'), ('COURTYARD_RESTROOMS'),
  ('CATHOUSE_CAFE_RESTROOMS'), ('NOCTURNAL'), ('ELEPHANT_TRUNK_RESTROOMS')
) as x(group_code);
select public.sch_upsert_employee_area_preference_by_code('Kinnaye Peete', 'ELEPHANT_TRUNK_GIFT_SHOP', 'prefer', 'Kinnaye Monday 8 AM reminder preference; gift shop is reminder-only, not scan-system work.', true, false);
select public.sch_upsert_employee_area_preference_by_code('Kinnaye Peete', x.group_code, 'avoid', 'Kinnaye farther fallback only when load balance/business needs require.', true, false)
from (values
  ('TROPICAL_BIRDS'), ('EVENT_CENTER'), ('SPLASH_PAD_RESTROOMS'), ('BONOBOS_RESTROOMS'), ('CHINA')
) as x(group_code);

select public.sch_upsert_employee_area_preference_by_code('Karen Robinson', x.group_code, 'prefer', 'Karen preferred route area.', true, false)
from (values
  ('ZAMBEZI'), ('PRIMATE_PAVILLION'), ('BREEZEWAY_RESTROOMS'),
  ('CATHOUSE_CAFE_RESTROOMS'), ('TROPICAL_BIRDS'), ('NOCTURNAL')
) as x(group_code);
select public.sch_upsert_employee_area_preference_by_code('Karen Robinson', x.group_code, 'last_resort', 'Karen last-resort far-west area; use only when business needs/load balance require.', true, false)
from (values
  ('EXPO'), ('AQUARIUM'), ('KOMODOS'), ('MEMMEX_RESTROOMS')
) as x(group_code);

select public.sch_upsert_employee_area_preference_by_code('Tammy Miller', x.group_code, 'prefer', 'Tammy preferred east/end route area.', true, false)
from (values
  ('TETON'), ('NORTH_WEST_PASSAGE'), ('EAST_END_RESTROOMS'), ('EAST_END_BREAK_ROOM')
) as x(group_code);
select public.sch_upsert_employee_area_preference_by_code('Tammy Miller', x.group_code, 'prefer', 'Tammy conditional option if needed.', true, false)
from (values
  ('CHINA'), ('PRIMATE_PAVILLION')
) as x(group_code);
select public.sch_upsert_employee_area_preference_by_code('Tammy Miller', x.group_code, 'last_resort', 'Tammy west/central-west last-resort area; use only when business needs/load balance require.', true, false)
from (values
  ('AQUARIUM'), ('EXPO'), ('KOMODOS'), ('MEMMEX_RESTROOMS')
) as x(group_code);

select public.sch_upsert_employee_area_preference_by_code('Kathy Phelps', x.group_code, 'prefer', 'Kathy core west-end route preference.', true, false)
from (values
  ('EXPO'), ('AQUARIUM'), ('KOMODOS'), ('MEMMEX_RESTROOMS')
) as x(group_code);
select public.sch_upsert_employee_area_preference_by_code('Kathy Phelps', x.group_code, 'last_resort', 'Kathy farthest/least-preferred stretch area. Keep west when possible; use only when balancing/business needs require. Existing route-limit restrictions still prevent lunch relief outside assigned route.', true, false)
from (values
  ('TROPICAL_BIRDS'), ('CATHOUSE_CAFE_RESTROOMS'), ('EVENT_CENTER'), ('HERPETARIUM')
) as x(group_code);

select public.sch_upsert_employee_area_preference_by_code('Sherita Wilbon', 'BAMBOO_GIFT_SHOP', 'prefer', 'Sherita Monday 8 AM Bamboo Gift Shop reminder only; not scan-system work.', true, false);
select public.sch_upsert_employee_area_preference_by_code('Markiesha Warren', 'TRADING_POST_GIFT_SHOP', 'prefer', 'Markiesha Monday 8 AM Trading Post Gift Shop reminder only; not scan-system work.', true, false);

-- Location notes / schedule scope labels.
update public.location_groups
   set notes = trim(concat_ws(' | ', nullif(notes, ''), 'No Clean / Calls to Location Only. Response-only ownership; not normal deep-clean schedule work.')),
       updated_at = now()
 where group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
   and coalesce(notes, '') not ilike '%No Clean / Calls to Location Only%';

update public.location_groups
   set notes = trim(concat_ws(' | ', nullif(notes, ''), 'Herpetarium is not cleaned on Wednesdays; no Wednesday printed schedule or active scan-system coverage.')),
       updated_at = now()
 where group_code = 'HERPETARIUM'
   and coalesce(notes, '') not ilike '%not cleaned on Wednesdays%';

update public.location_groups
   set notes = trim(concat_ws(' | ', nullif(notes, ''), 'Gift shop schedule reminder only: Monday 8:00 AM, not scan-system work, not overdue-driver coverage, not after 9:45 AM, not lunch coverage.')),
       updated_at = now()
 where group_code like '%GIFT_SHOP'
   and coalesce(notes, '') not ilike '%Gift shop schedule reminder only%';

-- Normalize existing template data to the notes.
update public.coverage_templates ct
   set coverage_purpose = 'response_only',
       notes = trim(concat_ws(' | ', nullif(ct.notes, ''), 'No Clean / Calls to Location Only. Response-only ownership; not normal deep-clean schedule work.')),
       updated_at = now()
  from public.location_groups lg
 where lg.id = ct.location_group_id
   and lg.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
   and ct.active = true
   and coalesce(ct.coverage_purpose, '') in ('deep_clean', 'area_owner', 'late_coverage', '');

update public.coverage_templates ct
   set active = false,
       assigned_employee_id = null,
       owner_type = 'OPEN',
       notes = trim(concat_ws(' | ', nullif(ct.notes, ''), 'Removed from Wednesday schedule: Herpetarium is not cleaned on Wednesdays.')),
       updated_at = now()
  from public.location_groups lg
 where lg.id = ct.location_group_id
   and lg.group_code = 'HERPETARIUM'
   and ct.day_of_week = 3
   and ct.active = true;

update public.coverage_templates ct
   set active = false,
       assigned_employee_id = null,
       owner_type = 'OPEN',
       notes = trim(concat_ws(' | ', nullif(ct.notes, ''), 'Disabled by gift-shop reminder-only policy: Monday 8 AM only; not scan-system work, not after 9:45, not lunch coverage.')),
       updated_at = now()
  from public.location_groups lg
 where lg.id = ct.location_group_id
   and lg.group_code like '%GIFT_SHOP'
   and ct.active = true
   and not (
     ct.day_of_week = 1
     and coalesce(ct.coverage_purpose, '') = 'reminder'
     and ct.coverage_start = time '08:00'
     and ct.coverage_end <= time '09:45'
   );

create or replace function public.sch_operational_preference_score_adjustment(
  p_employee_id uuid,
  p_location_group_id uuid,
  p_purpose text default null
)
returns numeric
language sql
stable
as $$
  select coalesce((
    select sum(case lower(coalesce(eap.preference_type, ''))
      when 'prefer' then -8
      when 'preferred' then -8
      when 'avoid' then 15
      when 'last_resort' then 28
      when 'fallback' then 12
      else 0
    end)::numeric
    from public.employee_area_preferences eap
    where eap.employee_id = p_employee_id
      and eap.location_group_id = p_location_group_id
      and eap.active = true
      and lower(coalesce(eap.preference_type, '')) <> 'restricted'
  ), 0::numeric);
$$;

create or replace function public.sch_assignment_candidate_score(
  p_employee_id uuid,
  p_day_of_week integer,
  p_location_group_id uuid,
  p_purpose text default null
)
returns numeric
language sql
stable
as $$
  with weights as (
    select proximity_weight, difficulty_weight, priority_weight
    from public.scheduler_scoring_settings
    where setting_code = 'default' and active = true
    limit 1
  ), components as (
    select
      public.sch_employee_route_fit_score(p_employee_id, p_day_of_week, p_location_group_id, p_purpose) as route_fit_penalty,
      public.sch_group_difficulty_points(p_location_group_id) as difficulty_points,
      public.sch_group_priority_points(p_location_group_id) as priority_points,
      public.sch_operational_preference_score_adjustment(p_employee_id, p_location_group_id, p_purpose) as operational_preference_penalty
  )
  select round(
    (route_fit_penalty * coalesce(proximity_weight, 0.50))
    + (difficulty_points * coalesce(difficulty_weight, 0.25))
    + (priority_points * coalesce(priority_weight, 0.25))
    + operational_preference_penalty,
    2
  )::numeric
  from components cross join weights;
$$;

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
as $$
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
    greatest(dwr.shift_start, p_coverage_start) as overlap_start,
    least(dwr.shift_end, p_coverage_end) as overlap_end,
    (extract(epoch from (least(dwr.shift_end, p_coverage_end) - greatest(dwr.shift_start, p_coverage_start))) / 60.0)::numeric as overlap_minutes
  from public.daily_work_roster dwr
  where dwr.service_date = p_service_date
    and dwr.active = true
    and dwr.shift_start < p_coverage_end
    and dwr.shift_end > p_coverage_start
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
  select x.employee_id, max(x.familiarity_score)::int as familiarity_score, bool_or(x.is_primary) as is_primary, bool_or(x.is_backup) as is_backup
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
    bool_or(lower(coalesce(eap.preference_type, '')) = 'restricted') as is_restricted,
    bool_or(lower(coalesce(eap.preference_type, '')) in ('avoid', 'last_resort', 'fallback')) as is_avoid,
    bool_or(lower(coalesce(eap.preference_type, '')) = 'last_resort') as is_last_resort,
    bool_or(lower(coalesce(eap.preference_type, '')) in ('prefer', 'preferred')) as is_prefer
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
  select cg.employee_id, max(lga.proximity_score) as best_proximity_score, min(lga.walking_minutes) as walking_minutes
  from current_groups cg
  join public.location_group_adjacency lga
    on lga.from_location_group_id = cg.location_group_id
   and lga.to_location_group_id = p_location_group_id
   and lga.active = true
  group by cg.employee_id
),
proximity_legacy as (
  select egp.employee_id, max(egp.proximity_score)::int as best_proximity_score, null::integer as walking_minutes
  from public.employee_group_proximity egp
  where egp.location_group_id = p_location_group_id
    and egp.active = true
  group by egp.employee_id
),
proximity as (
  select x.employee_id, max(x.best_proximity_score)::int as best_proximity_score, min(x.walking_minutes) as walking_minutes
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
      - (case when coalesce(p.is_last_resort, false) then 18 else 0 end)
      - (case when coalesce(p.is_restricted, false) then 100 else 0 end)
      - (coalesce(ls.assigned_load_points, 0) * 1.5)
      - (coalesce(ls.assigned_segments, 0) * 1.25)
      - (case when oc.has_overlap then 8 else 0 end)
      - (case when ar.shift_start > p_coverage_start then (extract(epoch from (ar.shift_start - p_coverage_start)) / 60.0) * 0.25 else 0 end)
      - (case when ar.shift_end < p_coverage_end then (extract(epoch from (p_coverage_end - ar.shift_end)) / 60.0) * 0.20 else 0 end)
      - (case
          when (select is_restroom from target_group)
           and p_coverage_start < time '12:00'
           and ar.shift_start > time '08:00'
          then 30 + ((extract(epoch from (ar.shift_start - time '08:00')) / 60.0) * 0.50)
          else 0
        end)
    )::numeric as recommendation_score,
    trim(both ' ' from concat_ws('. ',
      case when oc.has_overlap then 'Already covering other concurrent areas' else 'No concurrent areas at that exact window' end,
      'Familiarity ' || coalesce(f.familiarity_score, 5),
      case when coalesce(f.is_primary, false) then 'Primary area' when coalesce(f.is_backup, false) then 'Backup area' else null end,
      case when p.preference_type is not null then 'Preference ' || p.preference_type else null end,
      case when coalesce(p.is_last_resort, false) then 'Operational last resort / least preferred route' else null end,
      'Current load ' || coalesce(ls.assigned_load_points, 0) || ' points across ' || coalesce(ls.assigned_segments, 0) || ' segments',
      'Overlap ' || round(coalesce(ar.overlap_minutes, 0), 0) || ' minutes',
      case when (select is_restroom from target_group) and p_coverage_start < time '12:00' and ar.shift_start > time '08:00' then 'Restroom morning late-start penalty' else null end,
      case when ar.shift_start > p_coverage_start then 'Starts after original owner at ' || to_char(ar.shift_start, 'HH24:MI') else null end,
      case when ar.shift_end < p_coverage_end then 'Leaves before original end at ' || to_char(ar.shift_end, 'HH24:MI') else null end,
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
  where coalesce(ar.overlap_minutes, 0) >= 30
)
select *
from ranked
where coalesce(preference_type, '') not like '%restricted%'
order by recommendation_score desc, employee_name asc;
$$;

create or replace function public.sch_apply_lunch_coverage(p_service_date date)
returns jsonb
language plpgsql
as $$
declare
  v_row record;
  v_candidate record;
  v_lunch_start time;
  v_lunch_end time;
  v_overlap_start time;
  v_overlap_end time;
  v_split_rows integer := 0;
  v_lunch_rows integer := 0;
  v_open_rows integer := 0;
  v_before_after_rows integer := 0;
  v_next_segment integer;
  v_existing_lunch boolean := false;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  for v_row in
    select dsa.*, e.display_name as owner_name, lw.lunch_start, lw.lunch_end
    from public.daily_schedule_assignments dsa
    join public.employees e on e.id = dsa.assigned_employee_id
    join lateral public.sch_lunch_window_for_employee(p_service_date, dsa.assigned_employee_id) lw on true
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id is not null
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.coverage_purpose, '') not in ('lunch_coverage', 'reminder', 'response_only')
      and dsa.coverage_start < lw.lunch_end
      and dsa.coverage_end > lw.lunch_start
      and dsa.coverage_start < dsa.coverage_end
    order by dsa.coverage_start, dsa.coverage_end, dsa.location_group_id, dsa.segment_number
  loop
    v_lunch_start := v_row.lunch_start;
    v_lunch_end := v_row.lunch_end;
    v_overlap_start := greatest(v_row.coverage_start, v_lunch_start);
    v_overlap_end := least(v_row.coverage_end, v_lunch_end);

    if v_overlap_start >= v_overlap_end then
      continue;
    end if;

    v_candidate := null;

    select c.*
      into v_candidate
    from public.sch_get_coverage_candidates(
      p_service_date,
      v_row.location_group_id,
      v_overlap_start,
      v_overlap_end
    ) c
    where c.employee_id <> v_row.assigned_employee_id
      and not exists (
        select 1
        from public.sch_lunch_window_for_employee(p_service_date, c.employee_id) clw
        where clw.lunch_start < v_overlap_end
          and clw.lunch_end > v_overlap_start
      )
    order by c.recommendation_score desc, c.employee_name asc
    limit 1;

    select exists (
      select 1
      from public.daily_schedule_assignments existing
      where existing.service_date = p_service_date
        and existing.location_group_id = v_row.location_group_id
        and existing.coverage_purpose = 'lunch_coverage'
        and existing.coverage_start = v_overlap_start
        and existing.coverage_end = v_overlap_end
    ) into v_existing_lunch;

    delete from public.daily_schedule_assignments where id = v_row.id;
    v_split_rows := v_split_rows + 1;

    if v_row.coverage_start < v_overlap_start then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, v_row.location_group_id, v_next_segment, v_row.assigned_employee_id, v_row.owner_type,
        v_row.coverage_start, v_overlap_start, v_row.status, v_row.load_points,
        trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Morning ownership until lunch')),
        trim(concat_ws(':', nullif(v_row.source_type, ''), 'lunch_split_before')),
        v_row.coverage_purpose
      );
      v_before_after_rows := v_before_after_rows + 1;
    end if;

    if not v_existing_lunch then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date,
        v_row.location_group_id,
        v_next_segment,
        v_candidate.employee_id,
        case when v_candidate.employee_id is null then 'OPEN' else 'EMPLOYEE' end,
        v_overlap_start,
        v_overlap_end,
        case when v_candidate.employee_id is null then 'OPEN' else 'ASSIGNED' end,
        v_row.load_points,
        case
          when v_candidate.employee_id is null then
            trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage needed for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. No available coverage candidate found.'))
          else
            trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. Cover: ' || v_candidate.employee_name || '. ' || coalesce(v_candidate.explanation, '')))
        end,
        case when v_candidate.employee_id is null then 'lunch_coverage_open' else 'lunch_coverage' end,
        'lunch_coverage'
      );
      v_lunch_rows := v_lunch_rows + 1;
      if v_candidate.employee_id is null then
        v_open_rows := v_open_rows + 1;
      end if;
    end if;

    if v_overlap_end < v_row.coverage_end then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, v_row.location_group_id, v_next_segment, v_row.assigned_employee_id, v_row.owner_type,
        v_overlap_end, v_row.coverage_end, v_row.status, v_row.load_points,
        trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Return to owner after lunch')),
        trim(concat_ws(':', nullif(v_row.source_type, ''), 'lunch_split_after')),
        v_row.coverage_purpose
      );
      v_before_after_rows := v_before_after_rows + 1;
    end if;
  end loop;

  update public.daily_schedule_assignments
     set segment_number = segment_number + 100000,
         updated_at = now()
   where service_date = p_service_date;

  with renumbered as (
    select id,
           row_number() over (
             partition by service_date, location_group_id
             order by coverage_start, coverage_end,
               case coverage_purpose when 'lunch_coverage' then 1 else 0 end,
               created_at,
               id
           )::integer as new_segment_number
    from public.daily_schedule_assignments
    where service_date = p_service_date
  )
  update public.daily_schedule_assignments dsa
     set segment_number = r.new_segment_number,
         updated_at = now()
    from renumbered r
   where dsa.id = r.id;

  return jsonb_build_object(
    'service_date', p_service_date,
    'applied', v_split_rows > 0,
    'split_original_segments', v_split_rows,
    'lunch_coverage_rows', v_lunch_rows,
    'open_lunch_coverage_rows', v_open_rows,
    'owner_before_after_rows', v_before_after_rows
  );
end;
$$;

create or replace function public.sch_guard_operational_coverage_template()
returns trigger
language plpgsql
as $$
declare
  v_group_code text;
begin
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  if v_group_code = 'HERPETARIUM' and new.day_of_week = 3 then
    new.active := false;
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.notes := trim(concat_ws(' | ', nullif(new.notes, ''), 'Disabled by operational guard: Herpetarium is not cleaned on Wednesdays.'));
    return new;
  end if;

  if v_group_code like '%GIFT_SHOP' and not (
    new.day_of_week = 1
    and coalesce(new.coverage_purpose, '') = 'reminder'
    and new.coverage_start = time '08:00'
    and new.coverage_end <= time '09:45'
  ) then
    new.active := false;
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.notes := trim(concat_ws(' | ', nullif(new.notes, ''), 'Disabled by operational guard: gift shops are Monday 8 AM reminder-only, not scan-system/lunch/after-9:45 work.'));
    return new;
  end if;

  if v_group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY') and coalesce(new.coverage_purpose, '') in ('deep_clean', 'cleaning', 'area_owner', 'late_coverage', '') then
    new.coverage_purpose := 'response_only';
    new.notes := trim(concat_ws(' | ', nullif(new.notes, ''), 'No Clean / Calls to Location Only. Response-only ownership; not normal deep-clean schedule work.'));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sch_guard_operational_coverage_template on public.coverage_templates;
create trigger trg_sch_guard_operational_coverage_template
before insert or update of location_group_id, day_of_week, coverage_start, coverage_end, coverage_purpose, active
on public.coverage_templates
for each row
execute function public.sch_guard_operational_coverage_template();

create or replace function public.sch_guard_operational_daily_assignment()
returns trigger
language plpgsql
as $$
declare
  v_group_code text;
  v_day integer;
begin
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  v_day := extract(dow from new.service_date)::integer;

  if v_group_code = 'HERPETARIUM' and v_day = 3 then
    return null;
  end if;

  if v_group_code like '%GIFT_SHOP' and not (
    v_day = 1
    and coalesce(new.coverage_purpose, '') = 'reminder'
    and new.coverage_start = time '08:00'
    and new.coverage_end <= time '09:45'
  ) then
    return null;
  end if;

  if v_group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY') and coalesce(new.coverage_purpose, '') in ('deep_clean', 'cleaning', 'area_owner', 'late_coverage', '') then
    new.coverage_purpose := 'response_only';
    new.notes := trim(concat_ws(' | ', nullif(new.notes, ''), 'No Clean / Calls to Location Only. Response-only ownership; not normal deep-clean schedule work.'));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sch_guard_operational_daily_assignment on public.daily_schedule_assignments;
create trigger trg_sch_guard_operational_daily_assignment
before insert or update of service_date, location_group_id, coverage_start, coverage_end, coverage_purpose
on public.daily_schedule_assignments
for each row
execute function public.sch_guard_operational_daily_assignment();

create or replace function public.sch_validate_operational_schedule_rules(
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
    'active_herpetarium_wednesday_template'::text,
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
  join public.location_groups lg on lg.id = ct.location_group_id
  left join public.employees e on e.id = ct.assigned_employee_id
  where ct.active = true
    and lg.group_code = 'HERPETARIUM'
    and ct.day_of_week = 3

  union all

  select
    'daily_herpetarium_wednesday'::text,
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
  join public.location_groups lg on lg.id = dsa.location_group_id
  left join public.employees e on e.id = dsa.assigned_employee_id
  where dsa.service_date between coalesce(p_start_date, current_date) and coalesce(p_end_date, coalesce(p_start_date, current_date))
    and lg.group_code = 'HERPETARIUM'
    and extract(dow from dsa.service_date)::integer = 3

  union all

  select
    'invalid_gift_shop_template'::text,
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
  join public.location_groups lg on lg.id = ct.location_group_id
  left join public.employees e on e.id = ct.assigned_employee_id
  where ct.active = true
    and lg.group_code like '%GIFT_SHOP'
    and not (
      ct.day_of_week = 1
      and coalesce(ct.coverage_purpose, '') = 'reminder'
      and ct.coverage_start = time '08:00'
      and ct.coverage_end <= time '09:45'
    )

  union all

  select
    'invalid_gift_shop_daily_assignment'::text,
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
  join public.location_groups lg on lg.id = dsa.location_group_id
  left join public.employees e on e.id = dsa.assigned_employee_id
  where dsa.service_date between coalesce(p_start_date, current_date) and coalesce(p_end_date, coalesce(p_start_date, current_date))
    and lg.group_code like '%GIFT_SHOP'
    and not (
      extract(dow from dsa.service_date)::integer = 1
      and coalesce(dsa.coverage_purpose, '') = 'reminder'
      and dsa.coverage_start = time '08:00'
      and dsa.coverage_end <= time '09:45'
    )

  union all

  select
    'response_only_group_marked_deep_clean'::text,
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
  join public.location_groups lg on lg.id = ct.location_group_id
  left join public.employees e on e.id = ct.assigned_employee_id
  where ct.active = true
    and lg.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
    and coalesce(ct.coverage_purpose, '') not in ('response_only')
  order by 1, 2, 4, 3, 5, 8;
$$;
