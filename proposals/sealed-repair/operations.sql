-- REVIEWABLE PROPOSAL ONLY: Main owns canonical successor identity and inventory/canary provenance.
-- No historical migration is edited. Requires root-owned isolated verification.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '7fa82fecdbafc4f2da58fc2996cdda75b8949a793846dc6fb6d54518be01a706' THEN RAISE EXCEPTION 'operations predecessor changed: public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'::regprocedure)) IS DISTINCT FROM 'f18600be783af50bb5b57f2eb407f3cdf68a8c9e3c1b4cedbc76b257b8c4d66f' THEN RAISE EXCEPTION 'operations predecessor changed: public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamptz)'::regprocedure)) IS DISTINCT FROM '1661a4a12fbe965408318183cc7e201dd7645ed099c261fa9066a1b9bb0ef2d3' THEN RAISE EXCEPTION 'operations predecessor changed: public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamptz)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamptz)'::regprocedure)) IS DISTINCT FROM '758cfabe33b62e2ca018cf1170a15df5348a1519fd570dfdc2557613e23a411f' THEN RAISE EXCEPTION 'operations predecessor changed: public.custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamptz)'; END IF; END $guard$;

DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_viewdef('public.v_cleaning_performance_comparison'::regclass,true)) IS DISTINCT FROM '16884f0336717be3e2b48f0a442cd503182039053a7e9c0f39da0ad635158aa0' THEN RAISE EXCEPTION 'operations predecessor changed: public.v_cleaning_performance_comparison'; END IF; END $guard$;

DO $guard$ BEGIN IF to_regprocedure('public.custodial_native_alert_utf8_prefix(text,integer)') IS NOT NULL THEN RAISE EXCEPTION 'native prefix identity already exists';END IF;END $guard$;

CREATE FUNCTION public.custodial_native_alert_utf8_prefix(p_value text,p_max_bytes integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $prefix$
declare result text;
begin
 if p_max_bytes<0 or p_max_bytes>1000 then raise exception 'native preview byte budget invalid' using errcode='22023';end if;
 result:=left(p_value,p_max_bytes);
 while octet_length(result)>p_max_bytes loop result:=left(result,length(result)-1);end loop;
 return result;
end $prefix$;
REVOKE ALL ON FUNCTION public.custodial_native_alert_utf8_prefix(text,integer) FROM public,anon,authenticated,service_role;

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
  select d.* into v_device from public.devices d
    where d.id=v_session.device_id and d.active=true and (
      upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_identifier,'')))
      or exists(select 1 from public.device_aliases a where a.canonical_device_id=d.id
        and a.active=true and upper(btrim(a.alias_identifier))=upper(btrim(coalesce(p_device_identifier,'')))))
    for share of d;
  if v_session.id is null or v_device.id is null then
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
$function$;

CREATE OR REPLACE FUNCTION public.mz_employee_event_push_current_projection(p_job_id uuid, p_lease_token uuid, p_instance_id uuid, p_credential_id uuid, p_assignment_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_job public.operational_notification_jobs%rowtype;
  v_instance public.event_push_instances%rowtype;
  v_event public.events_app_events%rowtype;
  v_employee public.employees%rowtype;
  v_place jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_instance_id is null
    or p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1 then
    raise exception using errcode='22023',message='exact leased Event delivery identity is required';
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id;
  if v_job.job_id is null or v_job.job_type<>'employee_event_push'
    or v_job.source_id<>p_instance_id or v_job.status<>'leased'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.leased_until is null or v_job.leased_until<=statement_timestamp()
    or v_instance.instance_id is null or v_instance.state<>'leased'
    or v_instance.dispatch_job_id is distinct from p_job_id
    or v_instance.dispatch_lease_token is distinct from p_lease_token
    or v_instance.credential_id is distinct from p_credential_id
    or v_instance.assignment_epoch is distinct from p_assignment_epoch
    or v_job.payload_json->>'employee_id' is distinct from v_instance.employee_id::text
    or v_job.payload_json->>'event_id' is distinct from v_instance.event_id::text
    or v_job.payload_json->>'notification_key' is distinct from v_instance.notification_key
    or not exists(
      select 1 from public.devices d
      join public.device_auth_credentials c on c.device_id=d.id
        and c.credential_id=v_instance.credential_id
      join public.employee_push_registrations r on r.device_id=d.id
        and r.credential_id=c.credential_id
      where d.id=v_instance.device_id and d.active=true
        and d.assigned_employee_id=v_instance.employee_id
        and d.assignment_epoch=v_instance.assignment_epoch
        and c.confirmed_at is not null and c.revoked_at is null
        and c.expires_at>statement_timestamp()
        and r.registration_id=v_instance.dispatch_registration_id
        and r.employee_id=v_instance.employee_id
        and r.assignment_epoch=v_instance.assignment_epoch
        and r.token_hash=v_instance.dispatch_token_hash
        and r.active=true and r.revoked_at is null) then
    return jsonb_build_object('current',false,'reason','event_delivery_identity_superseded');
  end if;
  select * into v_event from public.events_app_events where id=v_instance.event_id;
  select * into v_employee from public.employees where id=v_instance.employee_id and active=true;
  if v_event.id is null or v_employee.id is null
    or v_event.revision<>v_instance.event_revision or v_event.status<>'SCHEDULED'
    or coalesce(v_event.needs_review,false) or v_event.event_scope='UNKNOWN'
    or v_event.cancelled_at is not null or v_event.archived_at is not null
    or v_event.start_instant_utc is null or v_event.end_instant_utc is null
    or not isfinite(v_event.start_instant_utc) or not isfinite(v_event.end_instant_utc)
    or v_event.end_instant_utc<=v_event.start_instant_utc
    or v_event.end_instant_utc<=statement_timestamp()
    or not exists(select 1 from public.mz_event_reminder_schedule(
      v_event.id,v_event.revision,v_instance.employee_id,v_instance.notification_kind) schedule
      where schedule.scheduled_for=v_instance.scheduled_for) then
    return jsonb_build_object('current',false,'reason','event_or_recipient_superseded');
  end if;
  v_place:=public.app_event_place_authority(to_jsonb(v_event),statement_timestamp());
  if (v_place->>'admissible')::boolean is not true then
    return jsonb_build_object('current',false,'reason','event_place_needs_review');
  end if;
  return jsonb_build_object('current',true,'event_id',v_event.id,
    'event_revision',v_event.revision,'instance_id',v_instance.instance_id,
    'notification_key',v_instance.notification_key,
    'employee_id',v_employee.id,'employee_name',v_employee.display_name,
    'event_name',v_event.event_name,
    'display_location',coalesce(nullif(v_place->>'primary_display_name',''),v_event.display_location),
    'event_date',v_event.event_date,'start_time',v_event.start_time,
    'end_time',v_event.end_time,'start_instant_utc',v_event.start_instant_utc,
    'end_instant_utc',v_event.end_instant_utc,
    'attendee_count',v_event.attendee_count,
    'custodial_note_codes',v_event.custodial_note_codes,
    'custodial_public_notes',v_event.custodial_public_notes,
    'place_authority',v_place->>'capability_authority');
end $function$;

CREATE OR REPLACE FUNCTION public.custodial_native_alert_prepare_at(p_job uuid, p_lease uuid, p_expected jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare target jsonb;j public.operational_notification_jobs%rowtype;i public.event_push_instances%rowtype;
 prep public.employee_native_alert_preparations%rowtype;claim jsonb;projection jsonb;
 at_time timestamptz;until_time timestamptz;revision text;kind text;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or jsonb_typeof(p_expected) is distinct from 'object' then
  raise exception 'exact alert preparation required' using errcode='22023';end if;
 target:=public.custodial_native_alert_target_at(p_job,p_lease,p_test_at);
 if target->'current' is distinct from 'true'::jsonb or target->'expected' is distinct from p_expected then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_target_superseded');end if;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());kind:=target->>'kind';
 until_time:=least(j.leased_until,(select expires_at from public.device_auth_credentials
  where credential_id=(p_expected->>'credential_id')::uuid));
 select * into prep from public.employee_native_alert_preparations where job_id=p_job for update;
 if prep.job_id is not null then
  if prep.lease_token is distinct from p_lease or prep.expected is distinct from p_expected
   or prep.alert_kind is distinct from kind or prep.prepared_until<=at_time then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_preparation_superseded');end if;
  return jsonb_build_object('schema','custodial.native-alert-preparation.v1','current',true,
   'dispatch_authorized',false,'prepared_id',prep.preparation_id,'job_id',p_job,'lease_token',p_lease,
   'kind',kind,'expected',prep.expected,'source_revision',prep.source_revision,
   'source_projection',prep.source_projection,
   'prepared_until',public.custodial_native_location_utc(prep.prepared_until));
 end if;
 if kind='EVENT' then
  select * into i from public.event_push_instances where instance_id=j.source_id for update;
  claim:=public.mz_claim_employee_event_push_delivery(p_job,p_lease,i.instance_id,
   (p_expected->>'credential_id')::uuid,i.assignment_epoch,(p_expected->>'registration_id')::uuid,
   p_expected->>'token_digest',at_time);
  if claim->'dispatch_authorized' is distinct from 'true'::jsonb then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_event_claim_unavailable');end if;
  projection:=public.mz_employee_event_push_current_projection(p_job,p_lease,i.instance_id,
   (p_expected->>'credential_id')::uuid,i.assignment_epoch);
  if projection->'current' is distinct from 'true'::jsonb then
   raise exception 'native Event projection unavailable after claim' using errcode='42501';end if;
  until_time:=least(until_time,(projection->>'end_instant_utc')::timestamptz);
  projection:=projection||jsonb_build_object('notification_kind',i.notification_kind,'service_date',i.service_date::text);
  revision:=public.static_weekly_digest_jsonb(projection);
 elsif kind='MESSAGE' then
  claim:=public.mz_prepare_employee_native_push_delivery(p_job,p_lease,
   (p_expected->>'credential_id')::uuid,(p_expected->>'assignment_epoch')::bigint,
   (p_expected->>'registration_id')::uuid,p_expected->>'token_digest',at_time);
  if claim->'dispatch_authorized' is distinct from 'true'::jsonb
   or jsonb_typeof(claim->'message_projection') is distinct from 'object' then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_message_source_unavailable');end if;
  projection:=claim->'message_projection';revision:=projection->>'source_revision';
 else raise exception 'native alert kind unavailable' using errcode='22023';end if;
 if not isfinite(at_time) or until_time<=at_time+interval '1 second'
  or revision !~ '^[0-9a-f]{64}$' then
  raise exception 'native alert preparation window or source unavailable' using errcode='42501';end if;
 insert into public.employee_native_alert_preparations(job_id,lease_token,alert_kind,expected,
  source_projection,source_revision,prepared_at,prepared_until)
 values(p_job,p_lease,kind,p_expected,projection,revision,at_time,until_time) returning * into prep;
 return jsonb_build_object('schema','custodial.native-alert-preparation.v1','current',true,
  'dispatch_authorized',false,'prepared_id',prep.preparation_id,'job_id',p_job,'lease_token',p_lease,
  'kind',kind,'expected',prep.expected,'source_revision',prep.source_revision,
  'source_projection',prep.source_projection,
  'prepared_until',public.custodial_native_location_utc(prep.prepared_until));
end $function$;

CREATE OR REPLACE FUNCTION public.custodial_native_alert_finalize_at(p_job uuid, p_lease uuid, p_prepared uuid, p_expected jsonb, p_candidate jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare target jsonb;prep public.employee_native_alert_preparations%rowtype;
 prior public.employee_native_alert_finalizations%rowtype;j public.operational_notification_jobs%rowtype;
 c public.device_auth_credentials%rowtype;i public.event_push_instances%rowtype;
 projection jsonb;at_time timestamptz;until_time timestamptz;data jsonb;
 required_keys text[];ttl integer;row_out public.employee_native_alert_finalizations%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or p_prepared is null
  or jsonb_typeof(p_expected) is distinct from 'object'
  or jsonb_typeof(p_candidate) is distinct from 'object' then
  raise exception 'exact native alert finalize request required' using errcode='22023';end if;
 target:=public.custodial_native_alert_target_at(p_job,p_lease,p_test_at);
 if target->'current' is distinct from 'true'::jsonb or target->'expected' is distinct from p_expected then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_target_superseded');end if;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 select * into prep from public.employee_native_alert_preparations where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if prep.job_id is null or prep.preparation_id<>p_prepared or prep.lease_token<>p_lease
  or prep.expected is distinct from p_expected or prep.alert_kind is distinct from target->>'kind'
  or prep.prepared_until<=at_time or j.leased_until<=at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_preparation_superseded');end if;
 select * into prior from public.employee_native_alert_finalizations where job_id=p_job for update;
 if prior.job_id is not null then
  return jsonb_build_object('current',true,'dispatch_authorized',false,
   'delivery_outcome_unknown',true,'reason','native_alert_original_finalization_no_resend');end if;
 select * into c from public.device_auth_credentials where credential_id=(p_expected->>'credential_id')::uuid for update;
 until_time:=least(prep.prepared_until,j.leased_until,c.expires_at);
 if c.credential_id is null or c.revoked_at is not null or c.expires_at<=at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_credential_superseded');end if;
 if prep.alert_kind='EVENT' then
  select * into i from public.event_push_instances where instance_id=j.source_id for update;
  projection:=public.mz_employee_event_push_current_projection(p_job,p_lease,i.instance_id,c.credential_id,i.assignment_epoch);
  if projection->'current' is distinct from 'true'::jsonb then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_event_source_superseded');end if;
  projection:=projection||jsonb_build_object('notification_kind',i.notification_kind,'service_date',i.service_date::text);
  until_time:=least(until_time,(projection->>'end_instant_utc')::timestamptz);
  required_keys:=array['body','channel_id','event_id','event_revision','instance_id','kind',
   'notification_key','notification_kind','notification_type','recipient_device_uuid','route',
   'schema','service_date','source_revision','title'];
 else
  if not public.custodial_native_alert_message_current(p_job,prep.source_projection,at_time) then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_message_source_superseded');end if;
  projection:=prep.source_projection;
  required_keys:=array['body','channel_id','kind','message_id','notification_key','notification_type',
   'recipient_user_id','route','schema','source_revision','thread_id','title'];
 end if;
 if projection is distinct from prep.source_projection
  or (prep.alert_kind='EVENT' and public.static_weekly_digest_jsonb(projection) is distinct from prep.source_revision)
  or (prep.alert_kind='MESSAGE' and projection->>'source_revision' is distinct from prep.source_revision)
  or until_time<=at_time+interval '1 second' then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_source_or_window_superseded');end if;
 if (select array_agg(key order by key collate "C") from jsonb_object_keys(p_candidate) key) is distinct from required_keys
  or exists(select 1 from jsonb_each(p_candidate) e where jsonb_typeof(e.value)<>'string')
  or octet_length(p_candidate->>'title') not between 1 and 180
  or octet_length(p_candidate->>'body') not between 1 and 1000
  or p_candidate->>'source_revision' is distinct from prep.source_revision
  or p_candidate->>'kind' is distinct from (case prep.alert_kind when 'EVENT' then 'employee_event' else 'employee_message' end)
  or p_candidate->>'notification_type' is distinct from lower(prep.alert_kind)
  or p_candidate->>'channel_id' is distinct from (case prep.alert_kind when 'EVENT' then 'employee-events' else 'employee-messages' end)
  or p_candidate->>'schema' is distinct from (case prep.alert_kind when 'EVENT' then 'custodial.native-event-payload.v1'
   else 'custodial.native-message-payload.v1' end) then
  raise exception 'native alert content candidate invalid' using errcode='22023';end if;
 if prep.alert_kind='EVENT' then
  if coalesce(projection->>'employee_name','')=''
   or coalesce(projection->>'event_name','')=''
   or coalesce(projection->>'display_location','')=''
   or p_candidate->>'event_id' is distinct from projection->>'event_id'
   or p_candidate->>'instance_id' is distinct from projection->>'instance_id'
   or p_candidate->>'event_revision' is distinct from projection->>'event_revision'
   or p_candidate->>'recipient_device_uuid' is distinct from p_expected->>'device_uuid'
   or p_candidate->>'notification_kind' is distinct from projection->>'notification_kind'
   or p_candidate->>'service_date' is distinct from projection->>'service_date'
   or p_candidate->>'notification_key' is distinct from projection->>'notification_key'
   or p_candidate->>'route' is distinct from 'events.html?hub=employee&event_id='||(projection->>'event_id')
   or p_candidate->>'title' is distinct from 'Memphis Zoo event reminder'
   or position((case when octet_length(projection->>'employee_name')<=120 then projection->>'employee_name' else public.custodial_native_alert_utf8_prefix(projection->>'employee_name',117)||'…' end) in p_candidate->>'body')=0
   or position((case when octet_length(projection->>'event_name')<=180 then projection->>'event_name' else public.custodial_native_alert_utf8_prefix(projection->>'event_name',177)||'…' end) in p_candidate->>'body')=0
   or position((case when octet_length(projection->>'display_location')<=240 then projection->>'display_location' else public.custodial_native_alert_utf8_prefix(projection->>'display_location',237)||'…' end) in p_candidate->>'body')=0 then
   raise exception 'native Event content not bound to current source' using errcode='42501';end if;
 else
  if p_candidate->>'message_id' is distinct from projection->>'message_id'
   or p_candidate->>'thread_id' is distinct from projection->>'thread_id'
   or p_candidate->>'recipient_user_id' is distinct from projection->>'recipient_user_id'
   or p_candidate->>'notification_key' is distinct from 'message:'||j.source_id::text
   or p_candidate->>'route' is distinct from 'messages.html?hub=employee&thread_id='||(projection->>'thread_id')
   or p_candidate->>'title' is distinct from public.custodial_native_alert_utf8_prefix(projection#>>'{payload,title}',180)
   or p_candidate->>'body' is distinct from public.custodial_native_alert_utf8_prefix(projection#>>'{payload,body}',1000) then
   raise exception 'native Message content not bound to current source' using errcode='42501';end if;
 end if;
 if exists(select 1 from jsonb_each_text(p_candidate) e where e.value~'[[:cntrl:]]') then
  raise exception 'native alert content contains controls' using errcode='22023';end if;
 data:=p_candidate||jsonb_build_object('generation_id',p_expected->>'generation_id',
  'principal_digest',p_expected->>'principal_digest','token_digest',p_expected->>'token_digest',
  'receipt_job_id',p_job::text,'receipt_credential_id',p_expected->>'credential_id',
  'receipt_employee_id',p_expected->>'employee_id','receipt_device_id',p_expected->>'device_id',
  'receipt_assignment_epoch',p_expected->>'assignment_epoch',
  'reservation_at',public.custodial_native_location_utc(at_time),
  'valid_until',public.custodial_native_location_utc(until_time));
 if prep.alert_kind='MESSAGE' then
  data:=data||jsonb_build_object('service_date',public.sch_service_date(at_time)::text);end if;
 data:=data||jsonb_build_object('content_sha256',
  public.static_weekly_digest_text(public.custodial_native_location_canonical(data)));
 if octet_length(public.custodial_native_location_canonical(data))>3500 then
  raise exception 'native alert closed wire too large' using errcode='22023';end if;
 insert into public.employee_native_alert_finalizations(job_id,preparation_id,alert_kind,source_revision,
  payload,content_sha256,finalized_at,valid_until)
 values(p_job,p_prepared,prep.alert_kind,prep.source_revision,data,data->>'content_sha256',at_time,until_time)
 returning * into row_out;
 ttl:=least(2419200,floor(extract(epoch from until_time-at_time))::integer);
 return jsonb_build_object('schema','custodial.native-alert-dispatch.v1','dispatch_authorized',true,
  'reservation',jsonb_build_object('current',true,'replayed',false,'delivery_outcome_unknown',false,
   'dispatch_authorized',true,'payload',data,'wire',public.custodial_native_location_canonical(data)),
  'attempt_id',row_out.attempt_id,'outcome_operation_id',row_out.outcome_operation_id,'ttl_seconds',ttl);
end $function$;

CREATE OR REPLACE VIEW public.v_cleaning_performance_comparison WITH (security_invoker=true) AS
 WITH facts AS (
         SELECT v_cleaning_session_facts.session_id,
            v_cleaning_session_facts.session_uuid,
            v_cleaning_session_facts.client_session_id,
            v_cleaning_session_facts.status,
            v_cleaning_session_facts.location_id,
            v_cleaning_session_facts.location_code,
            v_cleaning_session_facts.location_name,
            v_cleaning_session_facts.location_type,
            v_cleaning_session_facts.employee_id,
            v_cleaning_session_facts.employee_code,
            v_cleaning_session_facts.employee_name,
            v_cleaning_session_facts.device_id,
            v_cleaning_session_facts.device_identifier,
            v_cleaning_session_facts.started_at,
            v_cleaning_session_facts.ended_at,
            v_cleaning_session_facts.duration_minutes,
            v_cleaning_session_facts.duration_display,
            v_cleaning_session_facts.completion_source,
            v_cleaning_session_facts.completion_response_id,
            v_cleaning_session_facts.completion_submitted_at,
            v_cleaning_session_facts.services_performed,
            v_cleaning_session_facts.cleaning_note,
            v_cleaning_session_facts.maintenance_ticket_count,
            v_cleaning_session_facts.open_maintenance_ticket_count,
            v_cleaning_session_facts.maintenance_issue_categories,
            v_cleaning_session_facts.maintenance_fixture_identifiers,
            v_cleaning_session_facts.inspection_count,
            v_cleaning_session_facts.inspection_score_total,
            v_cleaning_session_facts.average_inspection_score,
            v_cleaning_session_facts.inspection_pass_count,
            v_cleaning_session_facts.latest_inspection_score,
            v_cleaning_session_facts.latest_inspection_passed,
            v_cleaning_session_facts.latest_inspected_at,
            v_cleaning_session_facts.latest_inspection_notes
           FROM v_cleaning_session_facts
          WHERE v_cleaning_session_facts.status = 'closed'::text AND v_cleaning_session_facts.duration_minutes IS NOT NULL AND v_cleaning_session_facts.duration_minutes >= 0 AND EXISTS (SELECT 1 FROM unnest(v_cleaning_session_facts.services_performed) AS performed(service) WHERE nullif(btrim(performed.service),'') IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM public.completion_responses response WHERE response.id=v_cleaning_session_facts.completion_response_id AND response.response_json->>'work_result'='checked_no_cleaning_needed')
        ), employee_location AS (
         SELECT facts.employee_id,
            facts.employee_code,
            facts.employee_name,
            facts.location_id,
            facts.location_code,
            facts.location_name,
            count(*)::integer AS cleaning_count,
            round(avg(facts.duration_minutes), 1) AS average_duration_minutes,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (facts.duration_minutes::double precision))::numeric, 1) AS median_duration_minutes,
            round(percentile_cont(0.9::double precision) WITHIN GROUP (ORDER BY (facts.duration_minutes::double precision))::numeric, 1) AS p90_duration_minutes,
            min(facts.duration_minutes) AS minimum_duration_minutes,
            max(facts.duration_minutes) AS maximum_duration_minutes,
            count(*) FILTER (WHERE facts.started_at >= (now() - '30 days'::interval))::integer AS cleanings_last_30_days,
            round(avg(facts.duration_minutes) FILTER (WHERE facts.started_at >= (now() - '30 days'::interval)), 1) AS average_duration_last_30_days,
            sum(facts.maintenance_ticket_count)::integer AS maintenance_ticket_count,
            round(sum(facts.maintenance_ticket_count)::numeric / NULLIF(count(*), 0)::numeric, 2) AS maintenance_tickets_per_cleaning,
            sum(facts.inspection_count)::integer AS inspection_count,
            round(sum(facts.inspection_score_total) / NULLIF(sum(facts.inspection_count), 0)::numeric, 1) AS average_inspection_score,
            round(100.0 * sum(facts.inspection_pass_count)::numeric / NULLIF(sum(facts.inspection_count), 0)::numeric, 1) AS inspection_pass_rate_pct,
            max(facts.started_at) AS latest_cleaning_at
           FROM facts
          GROUP BY facts.employee_id, facts.employee_code, facts.employee_name, facts.location_id, facts.location_code, facts.location_name
        ), location_baseline AS (
         SELECT facts.location_id,
            round(avg(facts.duration_minutes), 1) AS location_average_duration_minutes,
            round(sum(facts.inspection_score_total) / NULLIF(sum(facts.inspection_count), 0)::numeric, 1) AS location_average_inspection_score
           FROM facts
          GROUP BY facts.location_id
        )
 SELECT el.employee_id,
    el.employee_code,
    el.employee_name,
    el.location_id,
    el.location_code,
    el.location_name,
    el.cleaning_count,
    el.average_duration_minutes,
    el.median_duration_minutes,
    el.p90_duration_minutes,
    el.minimum_duration_minutes,
    el.maximum_duration_minutes,
    el.cleanings_last_30_days,
    el.average_duration_last_30_days,
    el.maintenance_ticket_count,
    el.maintenance_tickets_per_cleaning,
    el.inspection_count,
    el.average_inspection_score,
    el.inspection_pass_rate_pct,
    el.latest_cleaning_at,
    lb.location_average_duration_minutes,
    round(el.average_duration_minutes - lb.location_average_duration_minutes, 1) AS duration_delta_from_location_minutes,
    lb.location_average_inspection_score,
    round(el.average_inspection_score - lb.location_average_inspection_score, 1) AS inspection_score_delta_from_location
   FROM employee_location el
     JOIN location_baseline lb ON lb.location_id = el.location_id;

-- Inventory/canary successor binding deliberately remains Main-owned; this proposal alone is not release admissible.
COMMIT;
