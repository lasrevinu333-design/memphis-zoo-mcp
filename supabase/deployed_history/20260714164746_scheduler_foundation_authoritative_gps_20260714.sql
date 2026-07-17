-- Deployed migration history snapshot: 20260714164746 scheduler_foundation_authoritative_gps_20260714

insert into public.system_settings(setting_key, setting_value, description, updated_at)
values
  ('gps_proximity_radius_m', '175'::jsonb, 'Maximum standard distance from the authoritative location coordinate for a green cleaning proximity result.', now()),
  ('gps_max_accuracy_m', '100'::jsonb, 'GPS readings less accurate than this remain amber and cannot be marked near.', now())
on conflict (setting_key) do update set
  description = excluded.description,
  updated_at = now();

create table if not exists public.device_location_proximity_status (
  device_id uuid not null references public.devices(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  session_uuid text not null default '',
  presented_identifier text null,
  result text not null,
  badge_color text not null,
  distance_m numeric null,
  allowed_radius_m numeric not null,
  accuracy_m numeric null,
  client_latitude numeric null,
  client_longitude numeric null,
  target_latitude numeric null,
  target_longitude numeric null,
  coordinate_source text null,
  evaluated_at timestamptz not null default now(),
  correlation_id text null,
  metadata_json jsonb not null default '{}'::jsonb,
  primary key (device_id, location_id, session_uuid)
);

alter table public.device_location_proximity_status enable row level security;
revoke all on table public.device_location_proximity_status from public, anon, authenticated;
grant select, insert, update, delete on table public.device_location_proximity_status to service_role;
create index if not exists idx_device_location_proximity_status_evaluated
  on public.device_location_proximity_status(evaluated_at desc);

alter table public.scan_events drop constraint if exists scan_events_event_type_check;
alter table public.scan_events add constraint scan_events_event_type_check check (
  event_type = any(array[
    'scan_received'::text,
    'scan_blocked'::text,
    'scan_start'::text,
    'scan_finish'::text,
    'scan_resume_pending'::text,
    'scan_invalid_location'::text,
    'scan_unauthorized_device'::text,
    'scan_error'::text,
    'work_position_check'::text
  ])
);

create or replace function public.evaluate_location_proximity(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
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
  v_distance numeric;
  v_effective_radius numeric;
  v_result text;
  v_badge_color text;
  v_event_id uuid;
  v_session_key text := coalesce(nullif(btrim(p_session_uuid), ''), '');
begin
  if v_presented_device is null then raise exception 'device identifier is required'; end if;
  if v_resolved_location_code is null then raise exception 'Active location not found for code: %', p_location_code; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then raise exception 'latitude is invalid'; end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'longitude is invalid'; end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then raise exception 'accuracy_m cannot be negative'; end if;

  select d.id, d.device_id
    into v_device_pk, v_device_id
  from public.devices d
  where d.active = true and upper(btrim(d.device_id)) = upper(v_presented_device)
  union all
  select d.id, d.device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active = true
  where da.active = true and upper(btrim(da.alias_identifier)) = upper(v_presented_device)
  limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %', v_presented_device; end if;

  select l.id, l.location_name
    into v_location_id, v_location_name
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
    if v_session_id is null then
      raise exception 'Session does not belong to this device and location';
    end if;
  end if;

  select lp.latitude, lp.longitude,
         coalesce(nullif(lp.coordinate_source, ''), 'location_proximity_settings')
    into v_target_lat, v_target_lon, v_coordinate_source
  from public.location_proximity_settings lp
  where lp.location_id = v_location_id
    and lp.active = true
    and lp.latitude is not null
    and lp.longitude is not null
  order by lp.updated_at desc
  limit 1;

  if v_target_lat is null or v_target_lon is null then
    select gp.latitude, gp.longitude,
           coalesce(nullif(gp.coordinate_source, ''), 'location_group_proximity_settings')
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

  if v_target_lat is null or v_target_lon is null then
    v_result := 'not_configured';
    v_badge_color := 'amber';
    v_effective_radius := v_radius;
  else
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_latitude - v_target_lat)::double precision) / 2), 2)
      + cos(radians(v_target_lat::double precision))
      * cos(radians(p_latitude::double precision))
      * power(sin(radians((p_longitude - v_target_lon)::double precision) / 2), 2)
    ));
    v_effective_radius := v_radius + least(greatest(coalesce(p_accuracy_m, 0), 0), 25);
    if p_accuracy_m is not null and p_accuracy_m > v_max_accuracy then
      v_result := 'low_accuracy';
      v_badge_color := 'amber';
    elsif v_distance <= v_effective_radius then
      v_result := 'near';
      v_badge_color := 'green';
    else
      v_result := 'away';
      v_badge_color := 'red';
    end if;
  end if;

  insert into public.device_location_proximity_status(
    device_id, location_id, session_uuid, presented_identifier, result, badge_color,
    distance_m, allowed_radius_m, accuracy_m, client_latitude, client_longitude,
    target_latitude, target_longitude, coordinate_source, evaluated_at,
    correlation_id, metadata_json
  ) values (
    v_device_pk, v_location_id, v_session_key, v_presented_device, v_result, v_badge_color,
    v_distance, v_effective_radius, p_accuracy_m, p_latitude, p_longitude,
    v_target_lat, v_target_lon, v_coordinate_source, now(),
    nullif(btrim(coalesce(p_correlation_id, '')), ''),
    jsonb_build_object('location_code', v_resolved_location_code, 'location_name', v_location_name)
  )
  on conflict (device_id, location_id, session_uuid) do update set
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
    evaluated_at = now(),
    correlation_id = excluded.correlation_id,
    metadata_json = excluded.metadata_json;

  if p_client_event_id is not null then
    select se.id into v_event_id
    from public.scan_events se
    where se.client_event_id = p_client_event_id
    limit 1;
  end if;

  if v_event_id is null then
    insert into public.scan_events(
      scanned_at, location_id, location_code, device_id, device_identifier,
      session_id, event_type, result, notes, payload_json, client_event_id
    ) values (
      now(), v_location_id, v_resolved_location_code, v_device_pk, v_device_id,
      v_session_id, 'work_position_check', v_result,
      case
        when v_result = 'away' then format('Phone is %s meters from the authoritative location coordinate.', round(v_distance))
        when v_result = 'near' then 'Phone is within the authoritative location radius.'
        when v_result = 'low_accuracy' then 'GPS accuracy is too low for a green proximity result.'
        else 'No authoritative GPS coordinate is configured for this location.'
      end,
      jsonb_build_object(
        'distance_m', v_distance,
        'allowed_radius_m', v_effective_radius,
        'accuracy_m', p_accuracy_m,
        'client_latitude', p_latitude,
        'client_longitude', p_longitude,
        'target_latitude', v_target_lat,
        'target_longitude', v_target_lon,
        'coordinate_source', v_coordinate_source,
        'badge_color', v_badge_color,
        'correlation_id', p_correlation_id
      ),
      nullif(btrim(coalesce(p_client_event_id, '')), '')
    ) returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', v_result,
    'badge_color', v_badge_color,
    'device_id', v_device_id,
    'presented_device_id', v_presented_device,
    'location_code', v_resolved_location_code,
    'location_name', v_location_name,
    'session_uuid', nullif(v_session_key, ''),
    'distance_m', case when v_distance is null then null else round(v_distance, 1) end,
    'allowed_radius_m', round(v_effective_radius, 1),
    'accuracy_m', p_accuracy_m,
    'target_latitude', v_target_lat,
    'target_longitude', v_target_lon,
    'coordinate_source', v_coordinate_source,
    'evaluated_at', now(),
    'scan_event_id', v_event_id
  );
end
$function$;

create or replace function public.tool_evaluate_location_proximity(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.evaluate_location_proximity(
    p_location_code,
    p_device_identifier,
    p_latitude,
    p_longitude,
    p_accuracy_m,
    p_session_uuid,
    p_client_event_id,
    p_correlation_id
  );
$function$;

revoke all on function public.evaluate_location_proximity(text, text, numeric, numeric, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.tool_evaluate_location_proximity(text, text, numeric, numeric, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.evaluate_location_proximity(text, text, numeric, numeric, numeric, text, text, text) to service_role;
grant execute on function public.tool_evaluate_location_proximity(text, text, numeric, numeric, numeric, text, text, text) to service_role;
