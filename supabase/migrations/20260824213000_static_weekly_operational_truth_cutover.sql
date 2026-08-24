begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Resolve one authoritative schedule source before any consumer reads rows.
-- A date governed by static-weekly authority is never allowed to fall back to
-- the mutable daily scheduler when its projection is missing or stale.
create or replace function public.static_weekly_v6_schedule_authority_state(
  p_service_date date
) returns table(
  service_date date,
  governed boolean,
  authority_source text,
  projection_status text,
  version_id uuid,
  publication_id uuid,
  projection_id uuid,
  projection_authority_revision bigint,
  staffing_authority_revision bigint,
  week_start date
) language plpgsql stable security definer
set search_path = pg_catalog, public
as $function$
declare
  v_version_id uuid;
  v_publication_id uuid;
  v_projection_id uuid;
  v_projection_revision bigint;
  v_staffing_revision bigint;
  v_week_start date;
  v_status text;
begin
  if p_service_date is null then
    raise exception using errcode = '22023', message = 'service_date is required';
  end if;

  v_version_id := public.static_weekly_effective_version(p_service_date);
  if v_version_id is null then
    return query select p_service_date, false, 'legacy_daily_schedule'::text,
      'legacy_ungoverned'::text, null::uuid, null::uuid, null::uuid,
      null::bigint, null::bigint, null::date;
    return;
  end if;

  v_week_start := p_service_date - (extract(isodow from p_service_date)::integer - 1);
  select p.publication_id
    into v_publication_id
  from public.weekly_schedule_publications p
  where p.version_id = v_version_id
  order by p.authority_revision desc, p.published_at desc, p.publication_id desc
  limit 1;

  if v_publication_id is null then
    return query select p_service_date, true, 'static_weekly_projection'::text,
      'missing_publication'::text, v_version_id, null::uuid, null::uuid,
      null::bigint, null::bigint, v_week_start;
    return;
  end if;

  select projection.projection_id, (receipt.response_json->>'revision')::bigint
    into v_projection_id, v_projection_revision
  from public.weekly_schedule_compiled_projections projection
  join public.weekly_schedule_command_receipts receipt
    on receipt.command_type = 'materialize_projection'
   and receipt.response_json#>>'{data,projection_id}' = projection.projection_id::text
  where projection.publication_id = v_publication_id
    and projection.week_start = v_week_start
    and projection.exception_set_digest = public.static_weekly_digest_jsonb(
      public.static_weekly_accepted_exception_set(v_publication_id, v_week_start)
    )
  order by (receipt.response_json->>'revision')::bigint desc,
           receipt.command_id desc,
           projection.compiled_at desc,
           projection.projection_id desc
  limit 1;

  select max(staffing.authority_revision)
    into v_staffing_revision
  from public.weekly_roster_slot_staffing_states staffing
  where staffing.effective_start <= v_week_start + 6;

  if v_projection_id is null or v_projection_revision is null then
    v_status := 'missing_projection';
  elsif v_staffing_revision is not null and v_projection_revision <= v_staffing_revision then
    v_status := 'stale_staffing_change';
  else
    v_status := 'current';
  end if;

  return query select p_service_date, true, 'static_weekly_projection'::text,
    v_status, v_version_id, v_publication_id, v_projection_id,
    v_projection_revision, v_staffing_revision, v_week_start;
end
$function$;

-- Compatibility-shaped schedule rows backed by the single authority state
-- above. Existing consumers can move to this function without redefining the
-- operational meaning of groups, employees, coverage windows, or open work.
create or replace function public.static_weekly_v6_read_schedule_segments(
  p_service_date date
) returns table(
  service_date date,
  location_group_id uuid,
  group_code text,
  group_name text,
  included_locations text[],
  included_location_ids uuid[],
  segment_id uuid,
  segment_number integer,
  owner_type text,
  assigned_employee_id uuid,
  assigned_employee_name text,
  coverage_start text,
  coverage_end text,
  status text,
  load_points numeric,
  coverage_purpose text,
  notes text,
  source_type text,
  service_mode text,
  governed boolean,
  projection_status text,
  version_id uuid,
  publication_id uuid,
  projection_id uuid
) language plpgsql stable security definer
set search_path = pg_catalog, public
as $function$
declare
  authority record;
begin
  select * into strict authority
  from public.static_weekly_v6_schedule_authority_state(p_service_date);

  if authority.governed and authority.projection_status <> 'current' then
    return;
  end if;

  if not authority.governed then
    return query
    select
      p_service_date,
      legacy.location_group_id,
      legacy.group_code,
      legacy.group_name,
      legacy.included_locations,
      coalesce((
        select array_agg(membership.location_id order by location.sort_order, location.location_name)
        from public.location_group_memberships membership
        join public.locations location on location.id = membership.location_id and location.active = true
        where membership.location_group_id = legacy.location_group_id and membership.active = true
      ), array[]::uuid[]),
      legacy.segment_id,
      legacy.segment_number,
      legacy.owner_type,
      legacy.assigned_employee_id,
      legacy.assigned_employee_name,
      legacy.coverage_start,
      legacy.coverage_end,
      legacy.status,
      legacy.load_points,
      legacy.coverage_purpose,
      legacy.notes,
      legacy.source_type,
      case when coalesce(legacy.coverage_purpose, '') = 'reminder'
        then 'reminder_only' else 'scan_tracked' end,
      false,
      authority.projection_status,
      null::uuid,
      null::uuid,
      null::uuid
    from public.sch_get_daily_schedule_with_purpose(p_service_date) legacy;
    return;
  end if;

  if exists (
    select 1
    from public.weekly_schedule_occurrences occurrence
    left join public.location_groups location_group
      on upper(location_group.group_code) = upper(occurrence.location_code_snapshot)
     and location_group.active = true
    where occurrence.projection_id = authority.projection_id
      and occurrence.service_date = p_service_date
      and location_group.id is null
  ) then
    raise exception using errcode = '23514',
      message = 'current static-weekly projection contains an unmapped location family';
  end if;

  if exists (
    select 1
    from public.weekly_schedule_occurrences occurrence
    cross join lateral jsonb_array_elements(
      coalesce(occurrence.authority_facts_json#>'{work_snapshot,includedLocations}', '[]'::jsonb)
    ) included
    left join public.locations location
      on location.id = nullif(included->>'locationId', '')::uuid
     and location.active = true
    where occurrence.projection_id = authority.projection_id
      and occurrence.service_date = p_service_date
      and occurrence.authority_facts_json#>>'{work_snapshot,serviceMode}' = 'scan_tracked'
      and location.id is null
  ) then
    raise exception using errcode = '23514',
      message = 'current static-weekly projection contains an unmapped active cleaning location';
  end if;

  return query
  with occurrence_rows as (
    select occurrence.*,
      row_number() over (
        partition by upper(occurrence.location_code_snapshot)
        order by occurrence.coverage_start, occurrence.coverage_end,
                 occurrence.work_id, occurrence.occurrence_id
      )::integer as ordinal
    from public.weekly_schedule_occurrences occurrence
    where occurrence.projection_id = authority.projection_id
      and occurrence.service_date = p_service_date
      and occurrence.state in ('created', 'open', 'review')
  )
  select
    p_service_date,
    location_group.id,
    occurrence.location_code_snapshot,
    occurrence.location_name_snapshot,
    coalesce((
      select array_agg(included->>'locationNameSnapshot' order by ordinality)
      from jsonb_array_elements(
        coalesce(occurrence.authority_facts_json#>'{work_snapshot,includedLocations}', '[]'::jsonb)
      ) with ordinality item(included, ordinality)
    ), array[]::text[]),
    coalesce((
      select array_agg((included->>'locationId')::uuid order by ordinality)
      from jsonb_array_elements(
        coalesce(occurrence.authority_facts_json#>'{work_snapshot,includedLocations}', '[]'::jsonb)
      ) with ordinality item(included, ordinality)
    ), array[]::uuid[]),
    occurrence.occurrence_id,
    occurrence.ordinal,
    case when occurrence.state = 'created' and occurrence.owner_person_id_snapshot is not null
      then 'EMPLOYEE' else 'OPEN' end,
    case when occurrence.state = 'created' then occurrence.owner_person_id_snapshot else null end,
    case when occurrence.state = 'created' then occurrence.owner_name_snapshot else null end,
    to_char(occurrence.coverage_start, 'HH24:MI:SS'),
    to_char(occurrence.coverage_end, 'HH24:MI:SS'),
    case occurrence.state when 'created' then 'ASSIGNED' when 'open' then 'OPEN' else 'REVIEW' end,
    coalesce((occurrence.authority_facts_json#>>'{work_snapshot,serviceEffortMinutes}')::numeric, 0::numeric),
    coalesce(
      nullif(occurrence.authority_facts_json#>>'{work_snapshot,coveragePurpose}', ''),
      case occurrence.authority_facts_json#>>'{work_snapshot,serviceMode}'
        when 'reminder_only' then 'reminder'
        when 'response_only_no_clean' then 'response_only'
        else 'area_owner'
      end
    ),
    occurrence.state_reason,
    'static_weekly_projection'::text,
    occurrence.authority_facts_json#>>'{work_snapshot,serviceMode}',
    true,
    authority.projection_status,
    authority.version_id,
    authority.publication_id,
    authority.projection_id
  from occurrence_rows occurrence
  join public.location_groups location_group
    on upper(location_group.group_code) = upper(occurrence.location_code_snapshot)
   and location_group.active = true;
end
$function$;

create or replace function public.static_weekly_v6_read_roster(
  p_service_date date
) returns table(
  employee_id uuid,
  employee_name text,
  employee_code text,
  shift_start text,
  shift_end text,
  lunch_start text,
  lunch_end text,
  active boolean,
  source_type text,
  notes text,
  slot_id uuid,
  slot_code text,
  slot_label text,
  staffing_state text,
  governed boolean,
  projection_status text,
  version_id uuid,
  publication_id uuid,
  projection_id uuid
) language plpgsql stable security definer
set search_path = pg_catalog, public
as $function$
declare
  authority record;
begin
  select * into strict authority
  from public.static_weekly_v6_schedule_authority_state(p_service_date);

  if authority.governed and authority.projection_status <> 'current' then
    return;
  end if;

  if not authority.governed then
    return query
    select roster.employee_id, employee.display_name, employee.employee_code,
      to_char(roster.shift_start, 'HH24:MI:SS'), to_char(roster.shift_end, 'HH24:MI:SS'),
      null::text, null::text, roster.active, roster.source_type, roster.notes,
      null::uuid, null::text, null::text, case when roster.active then 'working' else 'unavailable' end,
      false, authority.projection_status, null::uuid, null::uuid, null::uuid
    from public.daily_work_roster roster
    join public.employees employee on employee.id = roster.employee_id
    where roster.service_date = p_service_date;
    return;
  end if;

  return query
  select incumbent.person_id,
    coalesce(employee.display_name, incumbent.person_name_snapshot),
    employee.employee_code,
    case when availability.shift_start is null then null else to_char(availability.shift_start, 'HH24:MI:SS') end,
    case when availability.shift_end is null then null else to_char(availability.shift_end, 'HH24:MI:SS') end,
    case when availability.lunch_start is null then null else to_char(availability.lunch_start, 'HH24:MI:SS') end,
    case when availability.lunch_end is null then null else to_char(availability.lunch_end, 'HH24:MI:SS') end,
    availability.availability_state = 'working'
      and coalesce(staffing.staffing_state, 'working') = 'working'
      and coalesce(employee.active, false),
    'static_weekly_projection'::text,
    case
      when incumbent.person_id is null then 'Open roster slot'
      when coalesce(staffing.staffing_state, availability.availability_state) = 'departed_named_absent'
        then 'Departed employee placeholder; replacement not yet approved'
      when availability.availability_state <> 'working' then initcap(replace(availability.availability_state, '_', ' '))
      else null
    end,
    slot.slot_id,
    slot.slot_code,
    slot.slot_label,
    coalesce(staffing.staffing_state, availability.availability_state),
    true,
    authority.projection_status,
    authority.version_id,
    authority.publication_id,
    authority.projection_id
  from public.weekly_roster_slots slot
  join public.weekly_schedule_slot_availability availability
    on availability.slot_id = slot.slot_id
   and availability.version_id = authority.version_id
   and availability.day_of_week = extract(dow from p_service_date)::integer
  left join lateral (
    select range.person_id, range.person_name_snapshot
    from public.v_weekly_roster_slot_incumbency_ranges range
    where range.slot_id = slot.slot_id
      and range.effective_start <= p_service_date
      and (range.effective_end is null or p_service_date < range.effective_end)
    order by range.effective_start desc, range.incumbency_id desc
    limit 1
  ) incumbent on true
  left join public.employees employee on employee.id = incumbent.person_id
  left join lateral (
    select state.staffing_state
    from public.weekly_roster_slot_staffing_states state
    where state.slot_id = slot.slot_id and state.effective_start <= p_service_date
    order by state.effective_start desc, state.authority_revision desc
    limit 1
  ) staffing on true
  order by availability.shift_start nulls last, slot.slot_label;
end
$function$;

-- Physical cleaning truth is derived only from scan-tracked included
-- locations. Reminder-only and response-only work never creates a cleaning
-- obligation, due alert, or employee location notification.
create or replace function public.custodial_operational_location_assignments(
  p_service_date date
) returns table(
  service_date date,
  authority_source text,
  projection_status text,
  version_id uuid,
  publication_id uuid,
  projection_id uuid,
  occurrence_id uuid,
  location_group_id uuid,
  group_code text,
  group_name text,
  assigned_employee_id uuid,
  assigned_employee_name text,
  assignment_status text,
  coverage_start time,
  coverage_end time,
  location_id uuid,
  location_code text,
  location_name text,
  form_type text
) language sql stable security definer
set search_path = pg_catalog, public
as $function$
  select segment.service_date,
    segment.source_type,
    segment.projection_status,
    segment.version_id,
    segment.publication_id,
    segment.projection_id,
    segment.segment_id,
    segment.location_group_id,
    segment.group_code,
    segment.group_name,
    segment.assigned_employee_id,
    segment.assigned_employee_name,
    segment.status,
    segment.coverage_start::time,
    segment.coverage_end::time,
    location.id,
    location.location_code,
    location.location_name,
    location.form_type
  from public.static_weekly_v6_read_schedule_segments(p_service_date) segment
  cross join lateral unnest(segment.included_location_ids) included(location_id)
  join public.locations location on location.id = included.location_id and location.active = true
  where segment.service_mode = 'scan_tracked'
$function$;

revoke all on function public.static_weekly_v6_schedule_authority_state(date),
  public.static_weekly_v6_read_schedule_segments(date),
  public.static_weekly_v6_read_roster(date),
  public.custodial_operational_location_assignments(date)
from public, anon, authenticated, service_role, static_weekly_control_plane, static_weekly_release_operator;
grant execute on function public.static_weekly_v6_schedule_authority_state(date),
  public.static_weekly_v6_read_schedule_segments(date),
  public.static_weekly_v6_read_roster(date),
  public.custodial_operational_location_assignments(date)
to custodial_application_reader;

comment on function public.static_weekly_v6_schedule_authority_state(date) is
  'Single fail-closed source decision for static-weekly versus explicitly ungoverned legacy schedule reads.';
comment on function public.static_weekly_v6_read_schedule_segments(date) is
  'Canonical compatibility-shaped schedule rows; governed dates never read the legacy daily scheduler.';
comment on function public.custodial_operational_location_assignments(date) is
  'Exact physical scan-tracked locations and owners derived from the current schedule authority.';

-- Preserve legacy view contracts while changing their owning source to the
-- canonical authority adapter. This closes AI/analytics compatibility readers
-- without keeping a second schedule authority alive.
create or replace view public.v_memphis_area_schedule as
with authority_dates as (
  select distinct occurrence.service_date from public.weekly_schedule_occurrences occurrence
  union
  select distinct assignment.service_date from public.daily_schedule_assignments assignment
)
select segment.service_date,
  segment.location_group_id,
  segment.group_code,
  segment.group_name,
  segment.segment_number,
  segment.assigned_employee_id,
  segment.assigned_employee_name,
  employee.employee_code,
  left(segment.coverage_start, 5) as coverage_start,
  left(segment.coverage_end, 5) as coverage_end,
  segment.status,
  segment.owner_type,
  segment.load_points::numeric(10,2),
  segment.source_type,
  segment.notes
from authority_dates authority_date
cross join lateral public.static_weekly_v6_read_schedule_segments(authority_date.service_date) segment
left join public.employees employee on employee.id = segment.assigned_employee_id;

create or replace view public.v_memphis_employee_schedule as
select area.service_date,
  area.assigned_employee_id as employee_id,
  area.assigned_employee_name as employee_name,
  area.employee_code,
  area.location_group_id,
  area.group_code,
  area.group_name,
  area.segment_number,
  area.coverage_start,
  area.coverage_end,
  area.status,
  area.owner_type,
  area.load_points,
  area.source_type,
  area.notes
from public.v_memphis_area_schedule area
where area.assigned_employee_id is not null;

create or replace view public.v_memphis_employee_load_summary as
select area.service_date,
  area.assigned_employee_id as employee_id,
  area.assigned_employee_name as employee_name,
  area.employee_code,
  count(*) filter (where area.status = 'ASSIGNED')::integer as assigned_segments,
  coalesce(sum(area.load_points) filter (where area.status = 'ASSIGNED'), 0::numeric) as assigned_load_points,
  coalesce(sum(extract(epoch from (area.coverage_end::time - area.coverage_start::time)) / 60::numeric)
    filter (where area.status = 'ASSIGNED'), 0::numeric) as assigned_minutes,
  count(*) filter (where area.status = 'ASSIGNED' and coalesce(area.source_type, '') like '%auto_reassigned%')::integer as open_gap_coverage_count
from public.v_memphis_area_schedule area
where area.assigned_employee_id is not null
group by area.service_date, area.assigned_employee_id, area.assigned_employee_name, area.employee_code;

create or replace view public.v_memphis_open_segments as
select area.service_date,
  area.location_group_id,
  area.group_code,
  area.group_name,
  area.segment_number,
  area.coverage_start,
  area.coverage_end,
  area.notes,
  case
    when area.notes ilike '%off%' then 'template owner off'
    when area.notes ilike '%absent%' then 'absence impact'
    when area.source_type ilike '%open%' then 'open coverage'
    else 'no active coverage'
  end as reason_open
from public.v_memphis_area_schedule area
where area.status = 'OPEN';

-- Manager readiness and notifications consume the same physical-location
-- projection as employee location alerts. Open coverage remains visible as an
-- obligation, while non-cleaning work never becomes falsely overdue.
create or replace view public.v_location_dashboard_status as
with op_day as (
  select public.operational_day_start(now()) day_start,
    public.sch_service_date(now()) service_date
), authority as (
  select state.*
  from op_day day
  cross join lateral public.static_weekly_v6_schedule_authority_state(day.service_date) state
), scheduled_baseline as (
  select assignment.location_id,
    min((day.service_date + assignment.coverage_start) at time zone 'America/Chicago') baseline_at
  from op_day day
  join lateral public.custodial_operational_location_assignments(day.service_date) assignment on true
  group by assignment.location_id
), latest_scan as (
  select location_id, max(coalesce(scanned_at, created_at)) last_scan_at
  from public.scan_events group by location_id
), open_session as (
  select distinct on (session.location_id)
    session.location_id, session.id session_id, session.session_uuid,
    session.status session_status, session.started_at, session.ended_at,
    session.duration_minutes, session.duration_display,
    employee.display_name employee_name, device.device_id device_identifier
  from public.sessions session
  cross join op_day day
  left join public.employees employee on employee.id = session.employee_id
  left join public.devices device on device.id = session.device_id
  where session.status in ('active', 'pending_submit') and session.started_at >= day.day_start
  order by session.location_id, session.started_at desc, session.created_at desc
), latest_completed as (
  select distinct on (session.location_id)
    session.location_id, session.id session_id, session.session_uuid,
    session.started_at, session.ended_at, session.duration_minutes,
    session.duration_display, employee.display_name employee_name,
    completion.submitted_at, completion.response_json,
    coalesce(session.ended_at, completion.submitted_at, session.started_at) effective_completed_at
  from public.sessions session
  join public.employees employee on employee.id = session.employee_id
  left join public.completion_responses completion on completion.session_id = session.id
  cross join op_day day
  where session.status = 'closed'
    and coalesce(session.ended_at, completion.submitted_at, session.started_at) >= day.day_start
  order by session.location_id,
    coalesce(session.ended_at, completion.submitted_at, session.started_at) desc,
    session.started_at desc
), open_tickets as (
  select location_id, count(*) open_ticket_count
  from public.maintenance_tickets where status = 'open' group by location_id
), truth as (
  select location.id location_id, location.location_code, location.location_name,
    location.location_type, location.form_type, day.day_start,
    latest_scan.last_scan_at,
    open_session.session_id open_session_id,
    open_session.session_uuid open_session_uuid,
    open_session.session_status open_session_status,
    open_session.started_at open_session_started_at,
    open_session.ended_at open_session_ended_at,
    open_session.employee_name open_session_employee_name,
    open_session.device_identifier open_session_device_identifier,
    latest_completed.session_id latest_completed_session_id,
    latest_completed.session_uuid latest_completed_session_uuid,
    latest_completed.started_at latest_started_at,
    latest_completed.ended_at latest_ended_at,
    latest_completed.submitted_at latest_submitted_at,
    latest_completed.effective_completed_at latest_completed_at,
    latest_completed.employee_name latest_employee_name,
    latest_completed.duration_minutes, latest_completed.duration_display,
    latest_completed.response_json,
    coalesce(open_tickets.open_ticket_count, 0::bigint) open_ticket_count,
    scheduled_baseline.baseline_at,
    case when scheduled_baseline.baseline_at is null then null
      else greatest(
        coalesce(latest_completed.effective_completed_at, scheduled_baseline.baseline_at),
        scheduled_baseline.baseline_at
      ) end due_baseline_at,
    authority.authority_source schedule_authority_source,
    authority.projection_status schedule_projection_status
  from public.locations location
  cross join op_day day
  cross join authority
  left join scheduled_baseline on scheduled_baseline.location_id = location.id
  left join latest_scan on latest_scan.location_id = location.id
  left join open_session on open_session.location_id = location.id
  left join latest_completed on latest_completed.location_id = location.id
  left join open_tickets on open_tickets.location_id = location.id
  where location.active = true
)
select location_id, location_code, location_name, location_type, form_type,
  day_start operational_day_start, last_scan_at,
  open_session_id, open_session_uuid, open_session_status,
  open_session_started_at, open_session_ended_at,
  latest_completed_session_id, latest_completed_session_uuid,
  latest_started_at, latest_ended_at, latest_submitted_at, latest_completed_at,
  latest_employee_name, duration_minutes, duration_display,
  coalesce(response_json->'services_performed', response_json->'servicesPerformed',
    response_json->'services', response_json->'completed_services',
    response_json->'completedServices', '[]'::jsonb) services_performed,
  coalesce(response_json->>'notes', response_json->>'cleaning_notes',
    response_json->>'cleaningNotes', response_json->>'maintenance_notes',
    response_json->>'maintenanceNotes', response_json->>'other_service_performed',
    response_json->>'otherServicePerformed', response_json->>'note') notes,
  open_ticket_count,
  case
    when open_session_status in ('active', 'pending_submit') then 'in_progress'
    when due_baseline_at is null then 'not_cleaned'
    when form_type = 'restroom' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('restroom_overdue_minutes', 120)) then 'overdue'
    when form_type = 'restroom' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('restroom_due_soon_minutes', 90)) then 'due_soon'
    when form_type = 'exhibit' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('exhibit_overdue_minutes', 240)) then 'overdue'
    when form_type = 'exhibit' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('exhibit_due_soon_minutes', 195)) then 'due_soon'
    else 'okay'
  end status_code,
  case
    when open_session_status in ('active', 'pending_submit') then 'blue'
    when due_baseline_at is null then 'black'
    when (form_type = 'restroom' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('restroom_overdue_minutes', 120)))
      or (form_type = 'exhibit' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('exhibit_overdue_minutes', 240))) then 'red'
    when (form_type = 'restroom' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('restroom_due_soon_minutes', 90)))
      or (form_type = 'exhibit' and now() >= due_baseline_at + make_interval(mins => public.get_setting_int('exhibit_due_soon_minutes', 195))) then 'yellow'
    else 'green'
  end status_color,
  to_char(timezone('America/Chicago', day_start), 'MM/DD/YYYY HH12:MI AM') || ' Central' operational_day_start_display,
  to_char(timezone('America/Chicago', last_scan_at), 'MM/DD/YYYY HH12:MI AM') || ' Central' last_scan_at_display,
  to_char(timezone('America/Chicago', open_session_started_at), 'MM/DD/YYYY HH12:MI AM') || ' Central' open_session_started_at_display,
  to_char(timezone('America/Chicago', open_session_ended_at), 'MM/DD/YYYY HH12:MI AM') || ' Central' open_session_ended_at_display,
  to_char(timezone('America/Chicago', latest_started_at), 'MM/DD/YYYY HH12:MI AM') || ' Central' latest_started_at_display,
  to_char(timezone('America/Chicago', latest_ended_at), 'MM/DD/YYYY HH12:MI AM') || ' Central' latest_ended_at_display,
  to_char(timezone('America/Chicago', latest_submitted_at), 'MM/DD/YYYY HH12:MI AM') || ' Central' latest_submitted_at_display,
  to_char(timezone('America/Chicago', latest_completed_at), 'MM/DD/YYYY HH12:MI AM') || ' Central' latest_completed_at_display,
  open_session_employee_name, open_session_device_identifier,
  schedule_authority_source, schedule_projection_status
from truth;

create or replace function public.mz_enqueue_employee_location_pushes(
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $function$
declare
  v_service_date date := public.sch_service_date(p_now);
  v_inserted integer := 0;
begin
  with targets as (
    select registration.credential_id, registration.employee_id,
      registration.device_id, registration.assignment_epoch,
      device.device_id as device_identifier
    from public.employee_push_registrations registration
    join public.devices device
      on device.id = registration.device_id
     and device.assigned_employee_id = registration.employee_id
     and device.assignment_epoch = registration.assignment_epoch
     and device.active = true
    join public.employees employee on employee.id = registration.employee_id and employee.active = true
    join public.device_auth_credentials credential
      on credential.credential_id = registration.credential_id
     and credential.device_id = device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at > p_now
    where registration.active = true and registration.revoked_at is null
  ), assigned_locations as (
    select distinct on (target.credential_id, assignment.location_id)
      target.*,
      assignment.location_group_id, assignment.group_code, assignment.group_name,
      assignment.location_id, assignment.location_code,
      assignment.location_name, assignment.form_type
    from targets target
    join lateral public.custodial_operational_location_assignments(v_service_date) assignment
      on assignment.assigned_employee_id = target.employee_id
     and assignment.assignment_status = 'ASSIGNED'
    order by target.credential_id, assignment.location_id,
      assignment.coverage_start, assignment.group_name, assignment.group_code
  ), candidates as (
    select assigned.*, status.status_code,
      ('location-status:' || v_service_date::text || ':' || assigned.location_id::text || ':' ||
        status.status_code || ':' || coalesce(to_char(status.latest_completed_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), 'never')) notification_key
    from assigned_locations assigned
    join public.v_location_dashboard_status status on status.location_id = assigned.location_id
    where status.status_code in ('due_soon', 'overdue')
  )
  insert into public.operational_notification_jobs(job_key, job_type, source_id, available_at, payload_json)
  select 'employee-location-push:' || candidate.notification_key || ':' || candidate.credential_id::text,
    'employee_native_push', candidate.location_id, p_now,
    jsonb_build_object(
      'credential_id', candidate.credential_id,
      'employee_id', candidate.employee_id,
      'device_id', candidate.device_id,
      'device_identifier', candidate.device_identifier,
      'assignment_epoch', candidate.assignment_epoch,
      'channel_id', case when candidate.status_code = 'overdue' then 'employee-overdue' else 'employee-due-soon' end,
      'title', candidate.location_name || case when candidate.status_code = 'overdue' then ' is overdue' else ' is due soon' end,
      'body', candidate.location_name || case when candidate.status_code = 'overdue'
        then ' on your assigned route needs attention now.'
        else ' on your assigned route is approaching its cleaning window.' end,
      'data_json', jsonb_build_object(
        'kind', 'employee_location_status',
        'notification_type', 'location_status',
        'notification_key', candidate.notification_key,
        'status_code', candidate.status_code,
        'service_date', v_service_date::text,
        'location_id', candidate.location_id::text,
        'location_code', candidate.location_code,
        'location_name', candidate.location_name,
        'form_type', candidate.form_type,
        'group_code', candidate.group_code,
        'group_name', candidate.group_name,
        'route', 'employee-schedule.html?hub=employee&highlight=' ||
          replace(replace(coalesce(candidate.location_code, ''), '%', '%25'), ' ', '%20')
      )
    )
  from candidates candidate
  where not exists (
    select 1 from public.device_notification_acknowledgements acknowledgement
    where upper(btrim(acknowledgement.device_identifier)) = upper(btrim(candidate.device_identifier))
      and acknowledgement.notification_key = candidate.notification_key
      and acknowledgement.acknowledged_at is not null
  )
  on conflict(job_key) do nothing;
  get diagnostics v_inserted = row_count;

  update public.operational_notification_jobs job
  set status = 'dead', completed_at = now(),
    last_error = 'employee_assignment_or_notification_superseded', updated_at = now()
  where job.job_type = 'employee_native_push'
    and job.status in ('pending', 'leased')
    and (
      not exists (
        select 1
        from public.employee_push_registrations registration
        join public.devices device on device.id = registration.device_id
        join public.device_auth_credentials credential on credential.credential_id = registration.credential_id
        where registration.credential_id = (job.payload_json->>'credential_id')::uuid
          and registration.assignment_epoch = (job.payload_json->>'assignment_epoch')::bigint
          and registration.active = true and registration.revoked_at is null
          and device.id = registration.device_id and device.active = true
          and device.assigned_employee_id = registration.employee_id
          and device.assignment_epoch = registration.assignment_epoch
          and credential.device_id = device.id and credential.confirmed_at is not null
          and credential.revoked_at is null and credential.expires_at > p_now
      )
      or (
        job.payload_json->'data_json'->>'notification_type' = 'location_status'
        and exists (
          select 1 from public.device_notification_acknowledgements acknowledgement
          where upper(btrim(acknowledgement.device_identifier)) =
                upper(btrim(job.payload_json->>'device_identifier'))
            and acknowledgement.notification_key = job.payload_json->'data_json'->>'notification_key'
            and acknowledgement.acknowledged_at is not null
        )
      )
    );

  return jsonb_build_object('ok', true, 'enqueued', v_inserted,
    'service_date', v_service_date, 'checked_at', p_now);
end
$function$;

revoke all on function public.mz_enqueue_employee_location_pushes(timestamptz)
from public, anon, authenticated;
grant execute on function public.mz_enqueue_employee_location_pushes(timestamptz)
to postgres, service_role;

commit;
