SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '6fa48fcc808225665b61e9e7e286e06cc466cb160576bd26522ca0ee3b375170' THEN RAISE EXCEPTION 'GPS original actor predecessor changed'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.evaluate_location_proximity_v2(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric, p_session_uuid text DEFAULT NULL::text, p_client_event_id text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text, p_observed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_session_key text:=nullif(btrim(coalesce(p_session_uuid,'')),'');
  v_session_state text;
  v_session public.sessions%rowtype;
  v_context public.custodial_offline_actor_contexts%rowtype;
  v_device public.devices%rowtype;
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
  -- Advisory GPS can never create work authority. Settle rejected telemetry
  -- without persisting coordinates or blocking a separate cleaning command.
  if v_session_key is null then
    return jsonb_build_object('ok',true,'result','gps_session_unavailable',
      'authoritative',false,'authority_scope','advisory_no_active_session','scan_event_id',null);
  end if;
  select s.* into v_session from public.sessions s
    join public.locations l on l.id=s.location_id and l.active=true
    where s.session_uuid=v_session_key
      and l.location_code=public.resolve_scan_location_code(p_location_code)
    for share of s;
  -- Native Start is already signed and durable before a terminal sessions row.
  -- Read and lock that exact original context; do not create or change work.
  if v_session.id is null then
    select c.* into v_context
    from public.custodial_offline_actor_contexts c
    join public.custodial_offline_submission_proofs proof
      on proof.context_id=c.context_id and proof.state='issued'
    join public.locations location on location.id=c.location_id and location.active=true
    where c.client_session_id=v_session_key and c.status='activated'
      and location.location_code=public.resolve_scan_location_code(p_location_code)
      and c.native_completed_at is null and c.native_scan_entry_id is not null
      and c.native_start_attestation_version='custodial-native-start.v1'
      and c.native_start_attestation_sha256 ~ '^[0-9a-f]{64}$'
      and not exists(select 1 from public.sessions s where s.client_session_id=c.client_session_id)
    for share of c,proof;
    if v_context.context_id is not null then
      -- These are local actor fields only, never a synthetic persisted session.
      v_session.device_id:=v_context.device_id;
      v_session.location_id:=v_context.location_id;
      v_session.employee_id:=v_context.employee_id;
      v_session.assignment_epoch_snapshot:=v_context.assignment_epoch;
      v_session.started_at:=v_context.started_at;
      v_session.ended_at:=null;
      v_session.status:='active';
    end if;
  end if;
  select d.* into v_device from public.devices d
    where d.id=v_session.device_id and d.active=true and (
      upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_identifier,'')))
      or exists(select 1 from public.device_aliases a where a.canonical_device_id=d.id
        and a.active=true and upper(btrim(a.alias_identifier))=upper(btrim(coalesce(p_device_identifier,'')))))
    for share of d;
  if (v_session.id is null and v_context.context_id is null) or v_device.id is null then
    raise exception using errcode='23503', message='Session does not belong to this device and location';
  end if;
  v_session_state:=v_session.status;
  if v_session.status<>'active' or v_session.ended_at is not null then
    return jsonb_build_object('ok',true,'result','post_session','authoritative',false,
      'authority_scope','post_session_advisory','session_state',v_session_state,'scan_event_id',null);
  end if;
  if v_session.employee_id is distinct from v_device.assigned_employee_id
    or v_session.assignment_epoch_snapshot is null
    or v_session.assignment_epoch_snapshot is distinct from v_device.assignment_epoch then
    return jsonb_build_object('ok',true,'result','gps_original_actor_unavailable','authoritative',false,
      'authority_scope','advisory_original_actor_unavailable','scan_event_id',null);
  end if;
  if p_observed_at is null or not isfinite(p_observed_at)
    or v_session.started_at is null or not isfinite(v_session.started_at)
    or p_observed_at<v_session.started_at or p_observed_at>clock_timestamp() then
    return jsonb_build_object('ok',true,'result','gps_timestamp_unavailable','authoritative',false,
      'authority_scope','advisory_outside_active_interval','scan_event_id',null);
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
           'original_employee_id',v_session.employee_id,
           'original_assignment_epoch',v_session.assignment_epoch_snapshot,
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
           'original_employee_id',v_session.employee_id,
           'original_assignment_epoch',v_session.assignment_epoch_snapshot,
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
           'original_employee_id',v_session.employee_id,
           'original_assignment_epoch',v_session.assignment_epoch_snapshot,
    'badge_color',case when v_result_code='near' then 'green' when v_result_code='away' then 'red' else 'amber' end,
    'allowed_radius_m',case when v_scope='surveyed_location_radius' then v_radius else null end,
    'surveyed_at',v_surveyed_at
  );
end
$function$
;
