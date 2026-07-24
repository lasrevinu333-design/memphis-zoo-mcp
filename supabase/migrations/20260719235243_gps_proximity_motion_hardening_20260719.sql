-- GPS observations are advisory operational evidence. Cleaning-session authority
-- remains the canonical session UUID and valid server-side state transition.
-- This migration preserves the v1 RPC for cached phones and adds a v2 contract
-- with observation time, staleness, boundary uncertainty, and motion checks.

insert into public.system_settings(setting_key, setting_value, description, updated_at) values
  ('gps_max_observation_age_seconds', '120'::jsonb, 'Maximum age of a phone GPS observation before it is advisory-only.', now()),
  ('gps_future_tolerance_seconds', '30'::jsonb, 'Maximum accepted GPS observation clock lead over server time.', now()),
  ('gps_boundary_hysteresis_m', '15'::jsonb, 'Minimum uncertainty band around a configured location radius.', now()),
  ('gps_max_human_speed_mps', '12'::jsonb, 'Maximum plausible custodial walking/running speed between accepted GPS observations.', now())
on conflict(setting_key) do update
set description = excluded.description,
    updated_at = now();

alter table public.device_location_proximity_status
  add column if not exists observed_at timestamptz,
  add column if not exists observation_age_seconds numeric,
  add column if not exists motion_speed_mps numeric;

update public.device_location_proximity_status
set observed_at = evaluated_at
where observed_at is null;

alter table public.device_location_proximity_status
  alter column observed_at set default now();

create index if not exists idx_device_location_proximity_status_observed
  on public.device_location_proximity_status(observed_at desc);

create or replace function public.evaluate_location_proximity_v2(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null,
  p_observed_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_observed_at timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_presented_device text := nullif(btrim(coalesce(p_device_identifier, '')), '');
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
  v_device_pk uuid;
  v_device_id text;
  v_location_id uuid;
  v_location_name text;
  v_session_id uuid;
  v_target_lat numeric;
  v_target_lon numeric;
  v_coordinate_source text;
  v_radius numeric := greatest(25, public.get_setting_int('gps_proximity_radius_m', 175));
  v_max_accuracy numeric := greatest(25, public.get_setting_int('gps_max_accuracy_m', 100));
  v_max_age_seconds numeric := greatest(30, public.get_setting_int('gps_max_observation_age_seconds', 120));
  v_future_tolerance_seconds numeric := greatest(0, public.get_setting_int('gps_future_tolerance_seconds', 30));
  v_boundary_hysteresis numeric := greatest(5, public.get_setting_int('gps_boundary_hysteresis_m', 15));
  v_max_human_speed numeric := greatest(2, public.get_setting_int('gps_max_human_speed_mps', 12));
  v_distance numeric;
  v_uncertainty numeric;
  v_observation_age_seconds numeric;
  v_previous_lat numeric;
  v_previous_lon numeric;
  v_previous_accuracy_m numeric;
  v_previous_observed_at timestamptz;
  v_motion_distance_m numeric;
  v_motion_effective_distance_m numeric;
  v_motion_elapsed_seconds numeric;
  v_motion_speed_mps numeric;
  v_status_observed_at timestamptz;
  v_result text;
  v_badge_color text;
  v_event_id uuid;
  v_session_key text := coalesce(nullif(btrim(p_session_uuid), ''), '');
  v_authoritative boolean := false;
begin
  if v_presented_device is null then raise exception 'device identifier is required'; end if;
  if v_resolved_location_code is null then raise exception 'Active location not found for code: %', p_location_code; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then raise exception 'latitude is invalid'; end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'longitude is invalid'; end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then raise exception 'accuracy_m cannot be negative'; end if;

  select d.id, d.device_id into v_device_pk, v_device_id
  from public.devices d
  where d.active = true and upper(btrim(d.device_id)) = upper(v_presented_device)
  union all
  select d.id, d.device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active = true
  where da.active = true and upper(btrim(da.alias_identifier)) = upper(v_presented_device)
  limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %', v_presented_device; end if;

  select l.id, l.location_name into v_location_id, v_location_name
  from public.locations l
  where l.active = true and l.location_code = v_resolved_location_code
  limit 1;

  if v_session_key <> '' then
    select s.id into v_session_id
    from public.sessions s
    where s.session_uuid = v_session_key
      and s.device_id = v_device_pk
      and s.location_id = v_location_id
    limit 1;
    if v_session_id is null then raise exception 'Session does not belong to this device and location'; end if;
  end if;

  select lp.latitude, lp.longitude, coalesce(nullif(lp.coordinate_source, ''), 'location_proximity_settings')
  into v_target_lat, v_target_lon, v_coordinate_source
  from public.location_proximity_settings lp
  where lp.location_id = v_location_id
    and lp.active = true
    and lp.latitude is not null
    and lp.longitude is not null
  order by lp.updated_at desc
  limit 1;

  if v_target_lat is null or v_target_lon is null then
    select gp.latitude, gp.longitude, coalesce(nullif(gp.coordinate_source, ''), 'location_group_proximity_settings')
    into v_target_lat, v_target_lon, v_coordinate_source
    from public.location_group_memberships gm
    join public.location_groups lg on lg.id = gm.location_group_id and lg.active = true
    join public.location_group_proximity_settings gp
      on gp.location_group_id = lg.id
     and gp.active = true
     and gp.latitude is not null
     and gp.longitude is not null
    where gm.location_id = v_location_id and gm.active = true
    order by gp.updated_at desc, lg.group_name
    limit 1;
  end if;

  select s.client_latitude, s.client_longitude, s.accuracy_m, coalesce(s.observed_at, s.evaluated_at)
  into v_previous_lat, v_previous_lon, v_previous_accuracy_m, v_previous_observed_at
  from public.device_location_proximity_status s
  where s.device_id = v_device_pk
    and s.location_id = v_location_id
    and s.session_uuid = v_session_key
    and s.result in ('near', 'away', 'boundary_uncertain')
  limit 1;

  v_observation_age_seconds := extract(epoch from (v_now - v_observed_at));
  -- A client clock that is ahead must not pin the current-status row into the
  -- future and suppress later legitimate observations. The unmodified client
  -- timestamp remains in the scan event and metadata for audit evidence.
  v_status_observed_at := least(v_observed_at, v_now);
  v_uncertainty := greatest(v_boundary_hysteresis, least(greatest(coalesce(p_accuracy_m, 0), 0), v_max_accuracy));

  if v_target_lat is not null and v_target_lon is not null then
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_latitude - v_target_lat)::double precision) / 2), 2)
      + cos(radians(v_target_lat::double precision)) * cos(radians(p_latitude::double precision))
      * power(sin(radians((p_longitude - v_target_lon)::double precision) / 2), 2)
    ));
  end if;

  if v_previous_lat is not null
     and v_previous_lon is not null
     and v_previous_observed_at is not null
     and v_observed_at > v_previous_observed_at then
    v_motion_elapsed_seconds := extract(epoch from (v_observed_at - v_previous_observed_at));
    v_motion_distance_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_latitude - v_previous_lat)::double precision) / 2), 2)
      + cos(radians(v_previous_lat::double precision)) * cos(radians(p_latitude::double precision))
      * power(sin(radians((p_longitude - v_previous_lon)::double precision) / 2), 2)
    ));
    v_motion_effective_distance_m := greatest(
      0,
      v_motion_distance_m - greatest(coalesce(p_accuracy_m, 0), 0) - greatest(coalesce(v_previous_accuracy_m, 0), 0)
    );
    v_motion_speed_mps := v_motion_effective_distance_m / greatest(v_motion_elapsed_seconds, 0.001);
  end if;

  if v_observation_age_seconds < -v_future_tolerance_seconds then
    v_result := 'future_clock'; v_badge_color := 'amber';
  elsif v_observation_age_seconds > v_max_age_seconds then
    v_result := 'stale'; v_badge_color := 'amber';
  elsif p_accuracy_m is null or p_accuracy_m > v_max_accuracy then
    v_result := 'low_accuracy'; v_badge_color := 'amber';
  elsif v_target_lat is null or v_target_lon is null then
    v_result := 'not_configured'; v_badge_color := 'amber';
  elsif v_motion_speed_mps is not null and v_motion_speed_mps > v_max_human_speed then
    v_result := 'implausible_jump'; v_badge_color := 'amber';
  elsif abs(v_distance - v_radius) <= v_uncertainty then
    v_result := 'boundary_uncertain'; v_badge_color := 'amber';
  elsif v_distance < v_radius then
    v_result := 'near'; v_badge_color := 'green'; v_authoritative := true;
  else
    v_result := 'away'; v_badge_color := 'red'; v_authoritative := true;
  end if;

  insert into public.device_location_proximity_status(
    device_id, location_id, session_uuid, presented_identifier, result, badge_color,
    distance_m, allowed_radius_m, accuracy_m, client_latitude, client_longitude,
    target_latitude, target_longitude, coordinate_source, observed_at,
    observation_age_seconds, motion_speed_mps, evaluated_at, correlation_id, metadata_json
  ) values (
    v_device_pk, v_location_id, v_session_key, v_presented_device, v_result, v_badge_color,
    v_distance, v_radius, p_accuracy_m, p_latitude, p_longitude,
    v_target_lat, v_target_lon, v_coordinate_source, v_status_observed_at,
    v_observation_age_seconds, v_motion_speed_mps, v_now,
    nullif(btrim(coalesce(p_correlation_id, '')), ''),
    jsonb_build_object(
      'location_code', v_resolved_location_code,
      'location_name', v_location_name,
      'authoritative', v_authoritative,
      'reported_observed_at', v_observed_at,
      'boundary_uncertainty_m', v_uncertainty,
      'motion_distance_m', v_motion_distance_m,
      'motion_effective_distance_m', v_motion_effective_distance_m
    )
  )
  on conflict(device_id, location_id, session_uuid) do update set
    presented_identifier = excluded.presented_identifier,
    result = excluded.result,
    badge_color = excluded.badge_color,
    distance_m = excluded.distance_m,
    allowed_radius_m = excluded.allowed_radius_m,
    accuracy_m = excluded.accuracy_m,
    client_latitude = excluded.client_latitude,
    client_longitude = excluded.client_longitude,
    target_latitude = excluded.target_latitude,
    target_longitude = excluded.target_longitude,
    coordinate_source = excluded.coordinate_source,
    observed_at = excluded.observed_at,
    observation_age_seconds = excluded.observation_age_seconds,
    motion_speed_mps = excluded.motion_speed_mps,
    evaluated_at = excluded.evaluated_at,
    correlation_id = excluded.correlation_id,
    metadata_json = excluded.metadata_json
  where excluded.observed_at >= coalesce(device_location_proximity_status.observed_at, device_location_proximity_status.evaluated_at);

  insert into public.scan_events(
      scanned_at, location_id, location_code, device_id, device_identifier,
      session_id, event_type, result, notes, payload_json, client_event_id
    ) values (
      v_now, v_location_id, v_resolved_location_code, v_device_pk, v_device_id,
      v_session_id, 'work_position_check', v_result,
      case
        when v_result = 'away' then format('Phone is %s meters from the authoritative location coordinate.', round(v_distance))
        when v_result = 'near' then 'Phone is within the authoritative location radius.'
        when v_result = 'boundary_uncertain' then 'Phone is near the GPS boundary; location remains advisory until a clearer reading arrives.'
        when v_result = 'low_accuracy' then 'GPS accuracy is too low for an authoritative proximity result.'
        when v_result = 'stale' then 'GPS observation is stale and was not accepted as current position.'
        when v_result = 'future_clock' then 'GPS observation timestamp is ahead of server time.'
        when v_result = 'implausible_jump' then 'GPS movement is implausibly fast and requires a fresh reading.'
        else 'No authoritative GPS coordinate is configured for this location.'
      end,
      jsonb_build_object(
        'distance_m', v_distance,
        'allowed_radius_m', v_radius,
        'accuracy_m', p_accuracy_m,
        'client_latitude', p_latitude,
        'client_longitude', p_longitude,
        'target_latitude', v_target_lat,
        'target_longitude', v_target_lon,
        'coordinate_source', v_coordinate_source,
        'badge_color', v_badge_color,
        'authoritative', v_authoritative,
        'observed_at', v_observed_at,
        'observation_age_seconds', v_observation_age_seconds,
        'motion_speed_mps', v_motion_speed_mps,
        'motion_distance_m', v_motion_distance_m,
        'motion_effective_distance_m', v_motion_effective_distance_m,
        'correlation_id', p_correlation_id
      ),
      nullif(btrim(coalesce(p_client_event_id, '')), '')
    )
    on conflict(client_event_id) where client_event_id is not null do nothing
    returning id into v_event_id;

  if v_event_id is null and nullif(btrim(coalesce(p_client_event_id, '')), '') is not null then
    select se.id into v_event_id
    from public.scan_events se
    where se.client_event_id = nullif(btrim(p_client_event_id), '')
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', v_result,
    'authoritative', v_authoritative,
    'badge_color', v_badge_color,
    'device_id', v_device_id,
    'presented_device_id', v_presented_device,
    'location_code', v_resolved_location_code,
    'location_name', v_location_name,
    'session_uuid', nullif(v_session_key, ''),
    'distance_m', case when v_distance is null then null else round(v_distance, 1) end,
    'allowed_radius_m', round(v_radius, 1),
    'accuracy_m', p_accuracy_m,
    'target_latitude', v_target_lat,
    'target_longitude', v_target_lon,
    'coordinate_source', v_coordinate_source,
    'observed_at', v_observed_at,
    'observation_age_seconds', round(v_observation_age_seconds, 1),
    'motion_speed_mps', case when v_motion_speed_mps is null then null else round(v_motion_speed_mps, 2) end,
    'evaluated_at', v_now,
    'scan_event_id', v_event_id
  );
end
$function$;

create or replace function public.tool_evaluate_location_proximity_v2(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null,
  p_observed_at timestamptz default null
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public, extensions
as $function$
  select public.evaluate_location_proximity_v2(
    p_location_code, p_device_identifier, p_latitude, p_longitude,
    p_accuracy_m, p_session_uuid, p_client_event_id, p_correlation_id, p_observed_at
  );
$function$;

revoke all on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) to service_role;
grant execute on function public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) to service_role;

comment on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
  is 'Server-authoritative GPS evidence with observation age, boundary uncertainty, and implausible-motion checks; never changes cleaning session authority.';
