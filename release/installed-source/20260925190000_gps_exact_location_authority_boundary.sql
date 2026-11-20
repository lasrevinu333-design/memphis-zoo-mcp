-- GPS remains advisory to cleaning. Only an explicitly surveyed exact location
-- with its own bounded radius may claim exact scanned-location proximity.
-- Existing group centers and the historical global 175 m radius are retained
-- for context, never promoted to exact-location authority.
begin;

alter table public.location_proximity_settings
  add column if not exists authority_radius_m numeric,
  add column if not exists authority_surveyed_at timestamptz;

alter table public.location_proximity_settings
  add constraint location_proximity_authority_radius_bound
  check (authority_radius_m is null or authority_radius_m between 25 and 5000);

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
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_session_key text:=nullif(btrim(coalesce(p_session_uuid,'')),'');
  v_session_state text;
  v_result jsonb;
  v_location_code text;
  v_target_lat numeric;
  v_target_lon numeric;
  v_radius numeric;
  v_surveyed_at timestamptz;
  v_confidence text;
  v_source text;
  v_distance numeric;
  v_uncertainty numeric;
  v_result_code text;
  v_authoritative boolean:=false;
  v_scope text:='advisory_uncalibrated';
  v_event_id uuid;
  v_event_count integer;
begin
  if v_session_key is not null then
    v_session_state:=public.custodial_gps_session_state(p_location_code,p_device_identifier,v_session_key);
    if v_session_state is null then
      raise exception using errcode='23503', message='Session does not belong to this device and location';
    end if;
  end if;

  v_location_code:=public.resolve_scan_location_code(p_location_code);
  if v_location_code is null then
    raise exception using errcode='23503', message='Active scanned location was not found';
  end if;
  -- The measurement core historically substitutes clock_timestamp() for NULL.
  -- Settle an old queued reading as unavailable without a status/event write;
  -- an arrival time is not a phone capture time. This keeps saved cleaning
  -- actions moving and does not reject or defer a cleaning submission.
  if p_observed_at is null then
    return jsonb_build_object('ok',true,'result','gps_timestamp_unavailable',
      'authoritative',false,'authority_scope','advisory_missing_capture_time',
      'scan_event_id',null);
  end if;
  select lp.latitude,lp.longitude,lp.authority_radius_m,lp.authority_surveyed_at,
         lp.coordinate_confidence,lp.coordinate_source
    into v_target_lat,v_target_lon,v_radius,v_surveyed_at,v_confidence,v_source
  from public.locations l
  join public.location_proximity_settings lp on lp.location_id=l.id
  where l.active=true and l.location_code=v_location_code and lp.active=true
    and lp.latitude is not null and lp.longitude is not null
  order by lp.updated_at desc
  limit 1
  for share of lp;

  v_result:=public.custodial_evaluate_location_proximity_v2_measurement(
    p_location_code,p_device_identifier,p_latitude,p_longitude,p_accuracy_m,
    p_session_uuid,p_client_event_id,p_correlation_id,p_observed_at
  );

  v_result_code:=coalesce(v_result->>'result','gps_unavailable');
  if v_target_lat is not null and v_target_lon is not null
     and v_radius is not null and v_surveyed_at is not null and v_surveyed_at<=clock_timestamp()
     and lower(btrim(coalesce(v_confidence,'')))='surveyed'
     and nullif(btrim(coalesce(v_source,'')),'') is not null then
    v_scope:='surveyed_location_radius';
    -- The core has already checked observation age, accuracy and motion. Its
    -- global-radius near/away/boundary result is replaced using the surveyed
    -- exact location and radius; terminal session handling remains below.
    if v_result_code in ('near','away','boundary_uncertain') then
      v_distance:=6371000 * 2 * asin(sqrt(
        power(sin(radians((p_latitude-v_target_lat)::double precision)/2),2)
        + cos(radians(v_target_lat::double precision))*cos(radians(p_latitude::double precision))
        * power(sin(radians((p_longitude-v_target_lon)::double precision)/2),2)
      ));
      v_uncertainty:=greatest(
        greatest(5,public.get_setting_int('gps_boundary_hysteresis_m',15)),
        least(greatest(coalesce(p_accuracy_m,0),0),greatest(25,public.get_setting_int('gps_max_accuracy_m',100)))
      );
      if abs(v_distance-v_radius)<=v_uncertainty then
        v_result_code:='boundary_uncertain';
      elsif v_distance<v_radius then
        v_result_code:='near';
        v_authoritative:=true;
      else
        v_result_code:='away';
        v_authoritative:=true;
      end if;
    end if;
  elsif v_result_code in ('near','away','boundary_uncertain') then
    v_result_code:='location_uncalibrated';
  end if;

  if v_session_state is not null and v_session_state not in ('active','pending_submit') then
    v_result_code:='post_session';
    v_authoritative:=false;
    v_scope:='post_session_advisory';
  end if;

  v_event_id:=nullif(v_result->>'scan_event_id','')::uuid;
  -- A repeated client event ID may refer to an earlier, different reading.
  -- Never rewrite that evidence or return a new authoritative claim for it.
  update public.scan_events se
     set result=v_result_code,
         notes=case
           when v_result_code='near' then 'Phone is within the surveyed scanned-location radius.'
           when v_result_code='away' then 'Phone is outside the surveyed scanned-location radius.'
           when v_result_code='location_uncalibrated' then 'GPS estimate is advisory; the scanned location has no surveyed coordinate and radius.'
           when v_result_code='post_session' then 'GPS arrived after the cleaning was no longer active; advisory evidence only.'
           else se.notes end,
         payload_json=coalesce(se.payload_json,'{}'::jsonb) || jsonb_build_object(
           'authoritative',v_authoritative,'authority_scope',v_scope,
           'evidence_scope',case when v_scope='post_session_advisory' then 'post_session_advisory' else 'active_work_advisory' end,
           'session_state',v_session_state,
           'allowed_radius_m',case when v_scope='surveyed_location_radius' then v_radius else null end,
           'coordinate_source',case when v_scope='surveyed_location_radius' then v_source else se.payload_json->>'coordinate_source' end,
           'surveyed_at',v_surveyed_at
         )
  where se.id=v_event_id
    and se.event_type='work_position_check'
    and se.location_code=v_result->>'location_code'
    and se.device_identifier=v_result->>'device_id'
    and se.session_id is not distinct from (
      select s.id from public.sessions s where s.session_uuid=v_result->>'session_uuid' limit 1
    )
    and (se.payload_json->>'observed_at')::timestamptz=p_observed_at
    and se.payload_json->>'correlation_id' is not distinct from p_correlation_id
    and (se.payload_json->>'client_latitude')::numeric is not distinct from p_latitude
    and (se.payload_json->>'client_longitude')::numeric is not distinct from p_longitude
    and (se.payload_json->>'accuracy_m')::numeric is not distinct from p_accuracy_m;
  get diagnostics v_event_count=row_count;
  if v_event_count<>1 then
    v_result_code:='gps_duplicate_event';
    v_authoritative:=false;
    v_scope:='advisory_duplicate_event';
  end if;

  update public.device_location_proximity_status gps
     set result=v_result_code,
         badge_color=case when v_result_code='near' then 'green' when v_result_code='away' then 'red' else 'amber' end,
         allowed_radius_m=case when v_scope='surveyed_location_radius' then v_radius else gps.allowed_radius_m end,
         metadata_json=coalesce(gps.metadata_json,'{}'::jsonb) || jsonb_build_object(
           'authoritative',v_authoritative,'authority_scope',v_scope,
           'evidence_scope',case when v_scope='post_session_advisory' then 'post_session_advisory' else 'active_work_advisory' end,
           'session_state',v_session_state,
           'surveyed_at',v_surveyed_at
         )
  where gps.device_id=(select d.id from public.devices d where d.device_id=v_result->>'device_id' limit 1)
    and gps.location_id=(select l.id from public.locations l where l.location_code=v_result->>'location_code' limit 1)
    and gps.session_uuid=coalesce(v_result->>'session_uuid','')
    and gps.evaluated_at=(v_result->>'evaluated_at')::timestamptz;

  return v_result || jsonb_build_object(
    'result',v_result_code,
    'authoritative',v_authoritative,
    'authority_scope',v_scope,
    'evidence_scope',case when v_scope='post_session_advisory' then 'post_session_advisory' else 'active_work_advisory' end,
    'session_state',v_session_state,
    'badge_color',case when v_result_code='near' then 'green' when v_result_code='away' then 'red' else 'amber' end,
    'allowed_radius_m',case when v_scope='surveyed_location_radius' then v_radius else null end,
    'surveyed_at',v_surveyed_at
  );
end
$function$;

revoke all on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
  to service_role;

comment on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) is
  'Advisory GPS evidence unless an exact location has manually surveyed coordinates and bounded radius; null capture time is rejected.';

commit;
