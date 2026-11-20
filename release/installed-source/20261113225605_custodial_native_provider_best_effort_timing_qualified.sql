-- Additive explicit best-effort observation protocol. Historical events are never rewritten.
-- Built from the exact r11 database definitions, including MESSAGE/EVENT/LUNCH/SCHEDULE branches.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE timing_preimages(identity text,sha text) ON COMMIT DROP;
INSERT INTO timing_preimages VALUES
('custodial_native_provider_interval_observation(jsonb,boolean)','e924a7d7fcf62edcc4401b20ea26f90f3a3182fc101f267577b611c0e5664a97'),
('custodial_native_provider_event_shape(jsonb)','c9554d489b175ac0560815ad1de6a28e7d45bf47d1a25ec44817f319b09e2edb'),
('custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)','5fd0ef7b7a6e34dc19b1e980bd087fd8fada8fe3388bca8d81ec04a7b6a5b881'),
('public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)','501f40782aca18fc3e7be7b55f657f99b53ad510e9211e920bd7f404d27fa146'),
('custodial_native_schedule_dispatch_prepare_at(uuid,uuid,uuid,jsonb,timestamp with time zone)','cadbf9ccebced45c1d2cbb74ee82f54e0a30b95fb8d78e065eb39ed9972b9cdb'),
('custodial_release_canary_authority_surface()','3c9f6e93251d05ca632bf141e4ec75b57371e9f980b64e145270f38b7db6b634');
DO $preimage$ DECLARE obj record;definition text;BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Best effort recovery guard differs';END IF;
 FOR obj IN SELECT * FROM timing_preimages LOOP
  definition:=pg_get_functiondef(obj.identity::regprocedure);
  IF public.static_weekly_digest_text(definition)<>obj.sha OR NOT EXISTS(
   SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
    AND to_regprocedure(object_identity)=obj.identity::regprocedure AND definition_sql=definition AND definition_sha256=obj.sha) THEN
   RAISE EXCEPTION 'Best effort exact predecessor differs %',obj.identity;END IF;
 END LOOP;
END $preimage$;

-- Release source is empty at preparation/build time. A separately reviewed,
-- data-preserving post-install migration supplies the exact accepted generation,
-- native_app and immutable evidence hashes, rebinding recovery in that same
-- transaction. Revocation removes that entry through the same supported path.
-- This is deliberately not an HTTP flag or a mutable runtime approval endpoint.
CREATE FUNCTION public.custodial_native_schedule_accepted_releases()
RETURNS TABLE(generation_id uuid,native_app jsonb,backend_protocol_evidence_sha256 text,
 composition_evidence_sha256 text,apk_sha256 text,device_acceptance_sha256 text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
 SELECT null::uuid,null::jsonb,null::text,null::text,null::text,null::text WHERE false;
$fn$;
ALTER FUNCTION public.custodial_native_schedule_accepted_releases() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_accepted_releases() FROM PUBLIC,anon,
 authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_accepted_releases() TO postgres;
CREATE OR REPLACE FUNCTION public.custodial_native_provider_interval_observation(o jsonb, p_required boolean)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare field text; first_at timestamptz; last_at timestamptz;
begin
 -- v3 records estimates explicitly. No estimate claims a measured UTC bound.
 if o->>'schema'='custodial.provider-best-effort-observation.v1' then
  if (select array_agg(key order by key) from jsonb_object_keys(o) key) is distinct from
   array['boot_count','clock_policy_id','elapsed_realtime_ms','estimated_at','schema','server_observed_at']
   or jsonb_typeof(o->'clock_policy_id') is distinct from 'string'
   or o->>'clock_policy_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
   raise exception 'exact best effort observation required' using errcode='22023';end if;
  foreach field in array array['boot_count','elapsed_realtime_ms'] loop
   if jsonb_typeof(o->field) is distinct from 'number' or o->>field !~ '^(0|[1-9][0-9]{0,15})$'
    or (o->>field)::numeric>(case when field='boot_count' then 2147483647 else 9007199254740991 end) then
    raise exception 'best effort counter required' using errcode='22023';end if;
  end loop;
  first_at:=public.custodial_native_provider_event_time(o->'server_observed_at');
  last_at:=public.custodial_native_provider_event_time(o->'estimated_at');
  if last_at<first_at or last_at>=first_at+interval '15 minutes' then
   raise exception 'bounded best effort estimate required' using errcode='22023';end if;
  return;
 end if;
 if jsonb_typeof(o) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(o) key) is distinct from
   array['boot_count','clock_profile_id','earliest_at','elapsed_realtime_ms','latest_at'] then
  raise exception 'exact native interval observation required' using errcode='22023';end if;
 foreach field in array array['boot_count','elapsed_realtime_ms'] loop
  if o->field is distinct from 'null'::jsonb and
   (jsonb_typeof(o->field) is distinct from 'number' or o->>field !~ '^(0|[1-9][0-9]{0,15})$'
    or (o->>field)::numeric>(case when field='boot_count' then 2147483647 else 9007199254740991 end)) then
   raise exception 'exact native interval counter required' using errcode='22023';end if;
 end loop;
 if o->'earliest_at'='null'::jsonb then
  if p_required is distinct from false or o->'latest_at' is distinct from 'null'::jsonb or o->'clock_profile_id' is distinct from 'null'::jsonb then
   raise exception 'complete native interval required' using errcode='22023';end if;
 else
  first_at:=public.custodial_native_provider_event_time(o->'earliest_at');last_at:=public.custodial_native_provider_event_time(o->'latest_at');
  if last_at<first_at or jsonb_typeof(o->'clock_profile_id') is distinct from 'string'
   or o->>'clock_profile_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' or o->'boot_count'='null'::jsonb or o->'elapsed_realtime_ms'='null'::jsonb then
   raise exception 'ordered qualified native interval evidence required' using errcode='22023';end if;
 end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.custodial_native_provider_event_shape(p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare field text;
begin
 if jsonb_typeof(p_event) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(p_event) key) is distinct from
  array['action','admission_bounds','content_sha256','event_id','generation_id','notification_key','original_observation','principal_digest',
   'receipt_assignment_epoch','receipt_credential_id','receipt_device_id','receipt_employee_id','receipt_job_id','record_id','schema','token_digest']
  or coalesce(p_event->>'schema','') not in ('custodial.native-provider-event.v2','custodial.native-provider-event.v3')
  or p_event->>'action' not in ('received','displayed','opened','acknowledged') then
  raise exception 'exact finite native event required' using errcode='22023';end if;
 foreach field in array array['action','schema','event_id','generation_id','receipt_credential_id','receipt_employee_id','receipt_job_id',
  'record_id','content_sha256','principal_digest','token_digest','notification_key','receipt_device_id'] loop
  if jsonb_typeof(p_event->field) is distinct from 'string' then raise exception 'native event string required' using errcode='22023';end if;
 end loop;
 foreach field in array array['event_id','generation_id','receipt_credential_id','receipt_employee_id','receipt_job_id'] loop
  if p_event->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'native event UUID required' using errcode='22023';end if;
 end loop;
 foreach field in array array['record_id','content_sha256','principal_digest','token_digest'] loop
  if p_event->>field !~ '^[0-9a-f]{64}$' then raise exception 'native event digest required' using errcode='22023';end if;
 end loop;
 if p_event->>'receipt_device_id' !~ '^KIOSK_(0[2-9]|10)$' or jsonb_typeof(p_event->'receipt_assignment_epoch') is distinct from 'number'
  or p_event->>'receipt_assignment_epoch' !~ '^[1-9][0-9]{0,15}$' or (p_event->>'receipt_assignment_epoch')::numeric>9007199254740991
  or length(p_event->>'notification_key') not between 1 and 1000 or p_event->>'notification_key' ~ '[[:cntrl:]]'
  or p_event->>'record_id' IS DISTINCT FROM public.custodial_native_schedule_original_record_id(
    (p_event->>'generation_id')::uuid,(p_event->>'receipt_job_id')::uuid,p_event->>'notification_key')
 then raise exception 'native event identity required' using errcode='22023';end if;
 if (p_event->>'schema'='custodial.native-provider-event.v3') is distinct from
  coalesce(p_event#>>'{admission_bounds,schema}'='custodial.provider-best-effort-observation.v1',false)
  or (p_event->>'schema'='custodial.native-provider-event.v2'
   and p_event#>>'{original_observation,schema}'='custodial.provider-best-effort-observation.v1') then
  raise exception 'event timing schema mismatch' using errcode='22023';end if;
 perform public.custodial_native_provider_interval_observation(p_event->'admission_bounds',true);
 perform public.custodial_native_provider_interval_observation(p_event->'original_observation',p_event->>'action'='displayed');
end $function$
;
CREATE OR REPLACE FUNCTION public.custodial_native_provider_events_at(p_credential uuid, p_credential_hash text, p_native_request uuid, p_attestation_digest text, p_body jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;g public.employee_native_push_generations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;
 alert public.employee_native_alert_finalizations%rowtype;
 reservation_started timestamptz;valid_cutoff timestamptz;
 prior public.employee_native_provider_events%rowtype;
 received public.employee_native_provider_events%rowtype;request public.employee_native_provider_event_requests%rowtype;
 e jsonb;first_event jsonb;payload jsonb;results jsonb:='[]';observed timestamptz;observed_last timestamptz;admitted timestamptz;admitted_last timestamptz;at_time timestamptz;
 other_event jsonb;best boolean;observation_best boolean;admission_floor timestamptz;observation_floor timestamptz;field text;body_digest text;code text;replayed boolean;
begin
 perform public.custodial_begin_application_mutation();
 if p_credential is null or p_native_request is null or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536
  or (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from array['events','schema']
  or coalesce(p_body->>'schema','') not in ('custodial.native-provider-events.v2','custodial.native-provider-events.v3') or jsonb_typeof(p_body->'events') is distinct from 'array'
  or jsonb_array_length(p_body->'events') not between 1 and 16 then raise exception 'exact native event batch required' using errcode='22023';end if;
 first_event:=p_body->'events'->0;
 for e in select value from jsonb_array_elements(p_body->'events') loop
  perform public.custodial_native_provider_event_shape(e);
  if p_body->>'schema'='custodial.native-provider-events.v2' and e->>'schema'<>'custodial.native-provider-event.v2' then
   raise exception 'event batch schema mismatch' using errcode='22023';end if;
  foreach field in array array['receipt_credential_id','receipt_employee_id','receipt_device_id','receipt_assignment_epoch','principal_digest'] loop
   if e->field is distinct from first_event->field then raise exception 'one exact batch principal required' using errcode='22023';end if;
  end loop;
 end loop;
 if (select count(distinct x->>'event_id') from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events')
  or (select count(distinct (x->>'record_id',x->>'action')) from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events') then
  raise exception 'unique native events and transitions required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id where c0.credential_id=p_credential for update of d0;
 select * into c from public.device_auth_credentials where credential_id=p_credential for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 perform 1 from public.employee_native_push_generations where generation_id in(select (x->>'generation_id')::uuid from jsonb_array_elements(p_body->'events') x) order by generation_id for update;
 perform 1 from public.operational_notification_jobs where job_id in(select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for update;
 perform 1 from public.employee_native_push_delivery_receipts where job_id in(select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for update;
 perform 1 from public.employee_native_alert_finalizations where job_id in(select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if not isfinite(at_time) or d.id is null or d.active is not true or c.token_hash is distinct from p_credential_hash
  or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or first_event->>'receipt_credential_id' is distinct from c.credential_id::text
  or first_event->>'receipt_device_id' is distinct from d.device_id or first_event->>'receipt_employee_id' is distinct from d.assigned_employee_id::text
  or first_event->>'receipt_assignment_epoch' is distinct from d.assignment_epoch::text
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$') then
  raise exception 'current event credential required' using errcode='42501';end if;
 body_digest:=public.static_weekly_digest_text(p_body::text);
 select * into request from public.employee_native_provider_event_requests where native_request_id=p_native_request;
 if request.native_request_id is null then
  insert into public.employee_native_provider_event_requests values(p_native_request,p_credential,body_digest,p_attestation_digest,at_time);
 elsif request.credential_id<>p_credential or request.body_digest<>body_digest or request.attestation_digest<>p_attestation_digest then
  raise exception 'native request identity conflict' using errcode='23505';end if;
 -- Received first even if a durable batch was enumerated in another order.
 for e in select value from jsonb_array_elements(p_body->'events') order by value->>'record_id',
  case value->>'action' when 'received' then 0 when 'displayed' then 1 when 'opened' then 2 else 3 end loop
  code:=null;replayed:=false;
  select * into g from public.employee_native_push_generations where generation_id=(e->>'generation_id')::uuid;
  select * into r from public.employee_native_push_delivery_receipts where job_id=(e->>'receipt_job_id')::uuid;
  select * into alert from public.employee_native_alert_finalizations where job_id=(e->>'receipt_job_id')::uuid;
  payload:=case when alert.job_id is not null then alert.payload else r.native_payload end;
  reservation_started:=case when alert.job_id is not null then alert.finalized_at else r.prepared_at end;
  valid_cutoff:=case when alert.job_id is not null then alert.valid_until else r.native_valid_until end;
  if alert.job_id is not null then
   if public.custodial_native_alert_event_binding(alert.job_id,e,c.credential_id,at_time) is not true then
    code:='native_provider_original_binding_invalid';end if;
  elsif payload->>'schema' IN('custodial.native-schedule-payload.v1','custodial.native-schedule-payload.v2') then
   if public.custodial_native_schedule_event_binding(r.job_id,e,c.credential_id,at_time) is not true then
    code:='native_provider_original_binding_invalid';end if;
  else
  if g.generation_id is null or g.device_id is distinct from d.id or g.device_identifier is distinct from d.device_id
   or g.credential_id is distinct from c.credential_id or g.employee_id is distinct from d.assigned_employee_id or g.assignment_epoch is distinct from d.assignment_epoch
   or g.principal_digest is distinct from e->>'principal_digest' or g.token_digest is distinct from e->>'token_digest' or g.revoked_at is not null
   or r.native_generation_id is distinct from g.generation_id or r.registration_id is distinct from g.registration_id
   or r.credential_id is distinct from c.credential_id or r.assignment_epoch is distinct from d.assignment_epoch
   or reservation_started<g.activated_at or reservation_started>at_time or (g.dispatch_retired_at is not null and reservation_started>g.dispatch_retired_at)
   or (payload->>'schema' is distinct from 'custodial.native-location-payload.v2'
    and not (payload->>'schema'='custodial.native-provider-payload.v1'
     and payload->>'kind'='employee_lunch_coverage')) then code:='native_provider_original_binding_invalid';end if;
  end if;
  foreach field in array array['generation_id','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id',
   'receipt_assignment_epoch','principal_digest','token_digest','content_sha256'] loop
   if e->>field is distinct from payload->>field then code:='native_provider_original_binding_invalid';end if;
  end loop;
  select * into prior from public.employee_native_provider_events where event_id=(e->>'event_id')::uuid;
  if code is null and prior.event_id is not null then
   if prior.original_event<>e then code:='native_provider_event_conflict';else replayed:=true;end if;
  end if;
  if code is null and not replayed then
   if exists(select 1 from public.employee_native_provider_events where record_id=e->>'record_id' and action=e->>'action') then
    code:='native_provider_event_conflict';
   else
    best:=e->>'schema'='custodial.native-provider-event.v3';
    observation_best:=coalesce(e#>>'{original_observation,schema}'='custodial.provider-best-effort-observation.v1',false);
    admitted:=public.custodial_native_provider_event_time(case when best then e#>'{admission_bounds,estimated_at}' else e#>'{admission_bounds,earliest_at}' end);
    admitted_last:=case when best then admitted else public.custodial_native_provider_event_time(e#>'{admission_bounds,latest_at}') end;
    admission_floor:=case when best then public.custodial_native_provider_event_time(e#>'{admission_bounds,server_observed_at}') else admitted end;
    observed:=case when observation_best then public.custodial_native_provider_event_time(e#>'{original_observation,estimated_at}')
     when e#>'{original_observation,earliest_at}'='null'::jsonb then null else public.custodial_native_provider_event_time(e#>'{original_observation,earliest_at}') end;
    observed_last:=case when observation_best then observed when observed is null then null else public.custodial_native_provider_event_time(e#>'{original_observation,latest_at}') end;
    observation_floor:=case when observation_best then public.custodial_native_provider_event_time(e#>'{original_observation,server_observed_at}') else observed end;
    -- BOTH endpoints for admission; a cutoff-straddling interval grants nothing.
    -- Server receipt can tighten its own upper bound, not rewrite original evidence.
    if admitted<reservation_started or admitted_last>=valid_cutoff or admission_floor>at_time or observation_floor>at_time then code:='native_provider_observation_invalid';end if;
    if e->>'action'='received' then
     if (not best and observed>admitted_last) or not public.custodial_native_provider_observation_order(e->'original_observation',e->'admission_bounds') then
      code:='native_provider_observation_invalid';end if;
    else
     select * into received from public.employee_native_provider_events where record_id=e->>'record_id' and action='received';
     if received.event_id is null then code:='native_provider_transition_pending';
     elsif received.original_event->>'schema' is distinct from e->>'schema'
      or received.original_event->'admission_bounds'<>e->'admission_bounds' or received.original_event->>'content_sha256'<>e->>'content_sha256'
      or (not best and observed_last<admitted)
      or not public.custodial_native_provider_observation_order(e->'admission_bounds',e->'original_observation') then code:='native_provider_observation_invalid';
     end if;
     if e->>'action'='displayed' and (observed is null or observed<reservation_started or observed_last>=valid_cutoff) then
      code:='native_provider_observation_invalid';end if;
    end if;
   end if;
   if code is null then
    insert into public.employee_native_provider_events values((e->>'event_id')::uuid,e->>'record_id',e->>'action',g.generation_id,(e->>'receipt_job_id')::uuid,c.credential_id,
     e,at_time,p_native_request,p_attestation_digest) returning * into prior;
   end if;
  end if;
  if code is null and prior.action='acknowledged'
   and payload->>'schema'='custodial.native-location-payload.v2' then
   perform public.custodial_native_location_project_ack(prior.event_id,at_time);end if;
  if code is not null then results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','admitted_state','REJECTED','code',code));
  else results:=results||jsonb_build_array(prior.original_event||jsonb_build_object('schema',replace(prior.original_event->>'schema','event.','event-receipt.'),
   'admitted_state','ACCEPTED','server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',replayed));end if;
 end loop;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema',replace(p_body->>'schema','events.','event-receipts.'),'results',results));
end $function$
;
CREATE OR REPLACE FUNCTION public.custodial_native_provider_event_decisions(p_credential uuid, p_credential_hash text, p_native_request uuid, p_attestation_digest text, p_raw_body_sha256 text, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;
 current_g public.employee_native_push_generations%rowtype;g public.employee_native_push_generations%rowtype;
 registration public.employee_push_registrations%rowtype;r public.employee_native_push_delivery_receipts%rowtype;
 prior public.employee_native_provider_events%rowtype;
 alert public.employee_native_alert_finalizations%rowtype;
 requester jsonb;e jsonb;payload jsonb;results jsonb:='[]';field text;at_time timestamptz;
 current_ok boolean;original_ok boolean;
begin
 -- The service-only HTTP adapter verifies the CURRENT credential and fresh
 -- path/method/nonce/timestamp/raw-body HMAC before this RPC. The exact request
 -- nonce and raw digest are echoed, not promoted to a time anchor or receipt.
 if p_credential is null or p_native_request is null or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$' or coalesce(p_raw_body_sha256,'') !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536
  or (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from array['events','requester','schema']
  or p_body->>'schema' is distinct from 'custodial.native-provider-event-decision-query.v1'
  or jsonb_typeof(p_body->'events') is distinct from 'array' or jsonb_array_length(p_body->'events') not between 1 and 16 then
  raise exception 'exact native original event query required' using errcode='22023';end if;
 requester:=p_body->'requester';
 if jsonb_typeof(requester) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(requester) key) is distinct from
   array['assignment_epoch','credential_id','current_generation_id','device_id','employee_id','principal_digest','token_digest'] then
  raise exception 'exact native current requester required' using errcode='22023';end if;
 foreach field in array array['credential_id','current_generation_id','employee_id'] loop
  if jsonb_typeof(requester->field) is distinct from 'string' or requester->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'exact native requester UUID required' using errcode='22023';end if;
 end loop;
 foreach field in array array['principal_digest','token_digest'] loop
  if jsonb_typeof(requester->field) is distinct from 'string' or requester->>field !~ '^[0-9a-f]{64}$' then
   raise exception 'exact native requester digest required' using errcode='22023';end if;
 end loop;
 if requester->>'credential_id' is distinct from p_credential::text or jsonb_typeof(requester->'device_id') is distinct from 'string'
  or requester->>'device_id' !~ '^KIOSK_(0[2-9]|10)$' or jsonb_typeof(requester->'assignment_epoch') is distinct from 'number'
  or requester->>'assignment_epoch' !~ '^[1-9][0-9]{0,15}$' or (requester->>'assignment_epoch')::numeric>9007199254740991 then
  raise exception 'exact native requester identity required' using errcode='22023';end if;
 for e in select value from jsonb_array_elements(p_body->'events') loop
  perform public.custodial_native_provider_event_shape(e);
  if e->>'receipt_credential_id' is distinct from requester->>'credential_id'
   or e->>'receipt_employee_id' is distinct from requester->>'employee_id'
   or e->>'receipt_device_id' is distinct from requester->>'device_id'
   or e->'receipt_assignment_epoch' is distinct from requester->'assignment_epoch'
   or e->>'principal_digest' is distinct from requester->>'principal_digest' then
   raise exception 'one exact original query principal required' using errcode='22023';end if;
 end loop;
 if (select count(distinct x->>'event_id') from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events')
  or (select count(distinct (x->>'record_id',x->>'action')) from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events') then
  raise exception 'unique original events and transitions required' using errcode='22023';end if;

 -- Existing authority order: global -> device -> credential -> employee ->
 -- registrations -> generations -> original reservations. SHARE locks prevent
 -- a current binding from being revoked between check and readback. No network
 -- and no INSERT/UPDATE/DELETE or application-mutation/control call occurs here.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=p_credential for share of d0;
 select * into c from public.device_auth_credentials where credential_id=p_credential for share;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for share;
 perform 1 from public.employee_native_push_generations where generation_id=(requester->>'current_generation_id')::uuid
  or generation_id in(select (x->>'generation_id')::uuid from jsonb_array_elements(p_body->'events') x) order by generation_id for share;
 perform 1 from public.employee_native_push_delivery_receipts where job_id in
  (select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for share;
 perform 1 from public.employee_native_alert_finalizations where job_id in
  (select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for share;
 select * into current_g from public.employee_native_push_generations where generation_id=(requester->>'current_generation_id')::uuid;
 select * into registration from public.employee_push_registrations where registration_id=current_g.registration_id;
 at_time:=clock_timestamp();
 current_ok:=isfinite(at_time) and d.id is not null and d.active is true and c.device_id=d.id
  and c.token_hash=p_credential_hash and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>at_time
  and requester->>'device_id'=d.device_id and requester->>'employee_id'=d.assigned_employee_id::text
  and requester->>'assignment_epoch'=d.assignment_epoch::text
  and exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$')
  and current_g.generation_id is not null and current_g.device_id=d.id and current_g.device_identifier=d.device_id
  and current_g.credential_id=c.credential_id and current_g.employee_id=d.assigned_employee_id and current_g.assignment_epoch=d.assignment_epoch
  and current_g.principal_digest=requester->>'principal_digest' and current_g.token_digest=requester->>'token_digest'
  and current_g.activated_at<=at_time and current_g.dispatch_retired_at is null and current_g.revoked_at is null
  and registration.registration_id is not null and registration.device_id=d.id and registration.credential_id=c.credential_id
  and registration.employee_id=d.assigned_employee_id and registration.assignment_epoch=d.assignment_epoch
  and registration.active is true and registration.revoked_at is null and registration.platform='android'
  and registration.token_hash=current_g.token_digest and public.static_weekly_digest_text(registration.fcm_token)=current_g.token_digest;
 for e in select value from jsonb_array_elements(p_body->'events') loop
  original_ok:=false;
  -- Denied current state deliberately does not disclose whether an event exists.
  if current_ok is true then
   select * into g from public.employee_native_push_generations where generation_id=(e->>'generation_id')::uuid;
   select * into r from public.employee_native_push_delivery_receipts where job_id=(e->>'receipt_job_id')::uuid;
   select * into alert from public.employee_native_alert_finalizations where job_id=(e->>'receipt_job_id')::uuid;
   payload:=case when alert.job_id is not null then alert.payload else r.native_payload end;
   if alert.job_id is not null then
    original_ok:=public.custodial_native_alert_event_binding(alert.job_id,e,c.credential_id,at_time);
   elsif payload->>'schema' IN('custodial.native-schedule-payload.v1','custodial.native-schedule-payload.v2') then
    original_ok:=public.custodial_native_schedule_event_binding(r.job_id,e,c.credential_id,at_time);
   else
   original_ok:=g.generation_id is not null and g.device_id=d.id and g.device_identifier=d.device_id
    and g.credential_id=c.credential_id and g.employee_id=d.assigned_employee_id and g.assignment_epoch=d.assignment_epoch
    and g.principal_digest=requester->>'principal_digest' and g.token_digest=e->>'token_digest' and g.revoked_at is null
    and r.native_generation_id=g.generation_id and r.registration_id=g.registration_id and r.credential_id=c.credential_id
    and r.assignment_epoch=d.assignment_epoch and r.prepared_at>=g.activated_at and r.prepared_at<=at_time
    and (g.dispatch_retired_at is null or r.prepared_at<=g.dispatch_retired_at)
    and r.native_payload_sha256=payload->>'content_sha256' and r.token_hash=g.token_digest
    and (payload->>'schema'='custodial.native-location-payload.v2' or
      (payload->>'schema'='custodial.native-provider-payload.v1' and payload->>'kind'='employee_lunch_coverage'));
   end if;
   foreach field in array array['generation_id','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id',
    'receipt_device_id','receipt_assignment_epoch','principal_digest','token_digest','content_sha256'] loop
    if e->>field is distinct from payload->>field then original_ok:=false;end if;
   end loop;
   select * into prior from public.employee_native_provider_events where event_id=(e->>'event_id')::uuid;
   original_ok:=original_ok and prior.event_id is not null and prior.original_event=e
    and prior.generation_id=g.generation_id and prior.job_id=(e->>'receipt_job_id')::uuid and prior.credential_id=c.credential_id
    and prior.record_id=e->>'record_id' and prior.action=e->>'action';
  end if;
  if original_ok is true then
   -- This is the immutable prior ACCEPTED fact, not a new effect. Business
   -- expiry/supersession cannot rewrite it; supported same-principal rotation
   -- keeps the ORIGINAL generation/token/observation/server receipt unchanged.
   results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','decision','ORIGINAL_ACCEPTED',
    'receipt',prior.original_event||jsonb_build_object('schema',replace(prior.original_event->>'schema','event.','event-receipt.'),
     'admitted_state','ACCEPTED','server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',true)));
  else
   results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','decision','UNRESOLVED'));
  end if;
 end loop;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-event-decisions.v1',
  'native_request_id',p_native_request::text,'request_body_sha256',p_raw_body_sha256,'requester',requester,'results',results));
end $function$
;
CREATE OR REPLACE FUNCTION public.custodial_native_schedule_dispatch_prepare_at(p_job uuid, p_lease uuid, p_source uuid, p_expected jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v jsonb;r public.employee_native_push_delivery_receipts%rowtype;a public.employee_native_schedule_dispatch_attempts%rowtype;
 j public.operational_notification_jobs%rowtype;at_time timestamptz;ttl bigint;
BEGIN
 -- The exact existing finalizer owns actor/source/publication locks. Its
 -- original replay is NOT fresh authority; revalidate after those locks.
 v:=public.custodial_native_schedule_finalize_at(p_job,p_lease,p_source,p_expected,p_test_at);
 IF v->'finalized' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',false,
   'delivery_admitted',false,'replayed',false,'reason','SOURCE_OR_JOB_SUPERSEDED','attempt',null);END IF;
 SELECT * INTO a FROM public.employee_native_schedule_dispatch_attempts WHERE job_id=p_job FOR UPDATE;
 IF a.job_id IS NOT NULL THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',false,
   'delivery_admitted',false,'replayed',true,'reason','ORIGINAL_ATTEMPT_RETAINED','attempt',null);END IF;
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job FOR UPDATE;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=p_job FOR UPDATE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 ttl:=least(2419200,floor(extract(epoch from r.native_valid_until-at_time))::bigint);
 IF NOT isfinite(at_time) OR ttl<=0 OR j.status IS DISTINCT FROM 'leased' OR j.lease_token IS DISTINCT FROM p_lease
  OR j.leased_until IS NULL OR j.leased_until<=at_time OR at_time<r.prepared_at
  OR public.custodial_native_schedule_live(p_job,r.native_payload,at_time) IS NOT TRUE THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',false,
   'delivery_admitted',false,'replayed',false,'reason','SOURCE_OR_JOB_SUPERSEDED','attempt',null);END IF;
 -- The current generation is locked by the finalizer. Qualification is server
 -- source owned, exact to this generation/app and post-install evidence.
 -- No client JSON, worker flag, job key or elapsed-clock estimate grants it.
 IF NOT EXISTS(SELECT 1 FROM public.employee_native_push_generations g
  JOIN public.custodial_native_schedule_accepted_releases() q ON q.generation_id=g.generation_id
  WHERE g.generation_id=r.native_generation_id AND g.native_app=q.native_app
   AND g.revoked_at IS NULL AND g.dispatch_retired_at IS NULL
   AND q.backend_protocol_evidence_sha256 ~ '^[0-9a-f]{64}$'
   AND q.composition_evidence_sha256 ~ '^[0-9a-f]{64}$'
   AND q.apk_sha256 ~ '^[0-9a-f]{64}$' AND q.device_acceptance_sha256 ~ '^[0-9a-f]{64}$') THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',false,
   'delivery_admitted',false,'replayed',false,'reason','NATIVE_RELEASE_UNQUALIFIED','attempt',null);END IF;
 INSERT INTO public.employee_native_schedule_dispatch_attempts(job_id,source_reservation_id,attempt_reserved_at,binding)
 VALUES(p_job,p_source,at_time,public.custodial_native_schedule_attempt_binding(p_job)) RETURNING * INTO a;
 RETURN jsonb_build_object('schema','custodial.native-schedule-dispatch.v1','dispatch_authorized',true,
  'delivery_admitted',false,'replayed',false,'reason',null,'attempt',jsonb_build_object('attempt_id',a.attempt_id::text,
   'outcome_operation_id',a.outcome_operation_id::text,'attempt_reserved_at',public.custodial_native_location_utc(a.attempt_reserved_at),
   'binding',a.binding,'payload',r.native_payload,'wire',public.custodial_native_location_canonical(r.native_payload),'ttl_seconds',ttl));
END $function$
;
CREATE OR REPLACE FUNCTION public.custodial_release_canary_authority_surface()
 RETURNS TABLE(object_kind text, object_identity text, purpose text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  values
    ('function','custodial_native_schedule_accepted_releases()','exact post-install native generation and release evidence; empty until acceptance'),
    ('grant','custodial_native_schedule_accepted_releases()','private SQL-owned schedule admission; no runtime writer'),
    ('function','custodial_native_departure_window_source_at(uuid,uuid,uuid,timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('grant','custodial_native_departure_window_source_at(uuid,uuid,uuid,timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('function','custodial_native_departure_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('grant','custodial_native_departure_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('function','custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid)','Departure v2; exact source and existing native admission required'),
    ('grant','custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid)','Departure v2; exact source and existing native admission required'),
    ('function','custodial_native_departure_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('grant','custodial_native_departure_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('function','custodial_native_departure_preparation_source(uuid,uuid,uuid)','Departure v2; exact source and existing native admission required'),
    ('grant','custodial_native_departure_preparation_source(uuid,uuid,uuid)','Departure v2; exact source and existing native admission required'),
    ('function','custodial_native_departure_source_requests_at(timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('grant','custodial_native_departure_source_requests_at(timestamp with time zone)','Departure v2; exact source and existing native admission required'),
    ('function','custodial_native_departure_source_requests()','Departure v2; exact source and existing native admission required'),
    ('grant','custodial_native_departure_source_requests()','Departure v2; exact source and existing native admission required'),
 ('relation','custodial_employment.local_retained_enrollments_v1','Current source recovery binding qualified after R006'),
 ('relation','custodial_leadership_private.feedback_triage_receipts_v1','Current source recovery binding qualified after R006'),
 ('relation','custodial_leadership_private.unfinished_clears_v1','Current source recovery binding qualified after R006'),
 ('relation','custodial_leadership_private.unfinished_notices_v1','Current source recovery binding qualified after R006'),
 ('relation','public.custodial_offline_reconciliation_outbox','Current source recovery binding qualified after R006'),
 ('function','capture_system_feedback_email_intent()','Current source recovery binding qualified after R006'),
 ('function','custodial_claim_offline_reconciliation_notification_recipients(uuid,text,uuid,jsonb,text)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.assert_scoped_cohort_actor_v1(jsonb,uuid)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.completion_evidence_v1(text)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.custodial_place_bridge_confirm_cohort_v1(jsonb,uuid,uuid,uuid)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.custodial_place_bridge_preview_cohort_v1(jsonb,uuid,text,uuid,text,uuid,timestamp with time zone,text)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.custodial_place_command_cohort_v1(jsonb,uuid,uuid,uuid,integer,text,timestamp with time zone,jsonb,text)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.custodial_place_preview_cohort_v1(jsonb,uuid,timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.custodial_place_source_confirm_cohort_v1(jsonb,uuid,uuid,uuid)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.custodial_place_source_preview_cohort_v1(jsonb,uuid,text,uuid,text,jsonb,timestamp with time zone,text)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.feedback_operation_v1(jsonb,text,jsonb)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.feedback_request_collision_v1()','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.place_operation_v1(jsonb,jsonb)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.place_source_apply_cohort_v1(jsonb,uuid,uuid,uuid,timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.unfinished_evidence_immutable_v1()','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.unfinished_work_operation_v1(jsonb,text,jsonb)','Current source recovery binding qualified after R006'),
 ('function','custodial_leadership_private.valid_feedback_cohort_identity_v1(jsonb,text)','Current source recovery binding qualified after R006'),
 ('function','custodial_record_local_enrollment_retention_v1(uuid,text,text,text)','Current source recovery binding qualified after R006'),
 ('function','custodial_unfinished_work_recipient_v1(text)','Current source recovery binding qualified after R006'),
 ('function','device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,jsonb)','Current source recovery binding qualified after R006'),
 ('function','expire_stale_open_sessions(timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('function','static_weekly_accepted_exception_set(uuid,date)','Current source recovery binding qualified after R006'),
 ('function','static_weekly_compiler_exception_set(uuid,date)','Current source recovery binding qualified after R006'),
 ('column_set','custodial_employment.local_retained_enrollments_v1','Current source recovery binding qualified after R006'),
 ('column_set','custodial_leadership_private.feedback_triage_receipts_v1','Current source recovery binding qualified after R006'),
 ('column_set','custodial_leadership_private.unfinished_clears_v1','Current source recovery binding qualified after R006'),
 ('column_set','custodial_leadership_private.unfinished_notices_v1','Current source recovery binding qualified after R006'),
 ('column_set','public.custodial_offline_reconciliation_outbox','Current source recovery binding qualified after R006'),
 ('relation_state','custodial_employment.local_retained_enrollments_v1','Current source recovery binding qualified after R006'),
 ('relation_state','custodial_leadership_private.feedback_triage_receipts_v1','Current source recovery binding qualified after R006'),
 ('relation_state','custodial_leadership_private.unfinished_clears_v1','Current source recovery binding qualified after R006'),
 ('relation_state','custodial_leadership_private.unfinished_notices_v1','Current source recovery binding qualified after R006'),
 ('relation_state','public.custodial_offline_reconciliation_outbox','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_approval_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_approval_id_key','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_assignment_epoch_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_credential_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_credential_id_key','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_device_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_employee_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_inventory_native_request_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_inventory_native_request_id_key','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_operation_id_key','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_original_utf8_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_pkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_report_sha256_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_employment.local_retained_enrollments_v1:local_retained_enrollments_v1_separation_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.feedback_triage_receipts_v1:feedback_triage_receipts_v1_actor_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.feedback_triage_receipts_v1:feedback_triage_receipts_v1_command_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.feedback_triage_receipts_v1:feedback_triage_receipts_v1_feedback_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.feedback_triage_receipts_v1:feedback_triage_receipts_v1_pkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.feedback_triage_receipts_v1:feedback_triage_receipts_v1_receipt_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.feedback_triage_receipts_v1:feedback_triage_receipts_v1_registration_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.unfinished_clears_v1:unfinished_clears_v1_notice_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.unfinished_clears_v1:unfinished_clears_v1_notice_id_key','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.unfinished_clears_v1:unfinished_clears_v1_pkey','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.unfinished_clears_v1:unfinished_clears_v1_reason_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.unfinished_notices_v1:unfinished_notices_v1_kind_check','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.unfinished_notices_v1:unfinished_notices_v1_kind_source_id_key','Current source recovery binding qualified after R006'),
 ('constraint','custodial_leadership_private.unfinished_notices_v1:unfinished_notices_v1_pkey','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliat_reconciliation_id_notificatio_key','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outb_unfinished_notice_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_attempts_check','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_disposition_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_notification_key_check','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_notification_key_key','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_notification_kind_check','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_pkey','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_reconciliation_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:custodial_offline_reconciliation_outbox_state_check','Current source recovery binding qualified after R006'),
 ('constraint','public.custodial_offline_reconciliation_outbox:unfinished_notice_source_v1','Current source recovery binding qualified after R006'),
 ('constraint','public.system_feedback_triage_receipts:system_feedback_triage_receipts_action_check','Current source recovery binding qualified after R006'),
 ('constraint','public.system_feedback_triage_receipts:system_feedback_triage_receipts_credential_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','public.system_feedback_triage_receipts:system_feedback_triage_receipts_expected_version_check','Current source recovery binding qualified after R006'),
 ('constraint','public.system_feedback_triage_receipts:system_feedback_triage_receipts_feedback_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','public.system_feedback_triage_receipts:system_feedback_triage_receipts_manager_id_fkey','Current source recovery binding qualified after R006'),
 ('constraint','public.system_feedback_triage_receipts:system_feedback_triage_receipts_pkey','Current source recovery binding qualified after R006'),
 ('constraint','public.system_feedback_triage_receipts:system_feedback_triage_receipts_receipt_check','Current source recovery binding qualified after R006'),
 ('grant','custodial_employment.local_retained_enrollments_v1','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.feedback_triage_receipts_v1','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.unfinished_clears_v1','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.unfinished_notices_v1','Current source recovery binding qualified after R006'),
 ('grant','public.custodial_offline_reconciliation_outbox','Current source recovery binding qualified after R006'),
 ('grant','capture_system_feedback_email_intent()','Current source recovery binding qualified after R006'),
 ('grant','custodial_claim_offline_reconciliation_notification_recipients(uuid,text,uuid,jsonb,text)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.assert_scoped_cohort_actor_v1(jsonb,uuid)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.completion_evidence_v1(text)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.custodial_place_bridge_confirm_cohort_v1(jsonb,uuid,uuid,uuid)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.custodial_place_bridge_preview_cohort_v1(jsonb,uuid,text,uuid,text,uuid,timestamp with time zone,text)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.custodial_place_command_cohort_v1(jsonb,uuid,uuid,uuid,integer,text,timestamp with time zone,jsonb,text)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.custodial_place_preview_cohort_v1(jsonb,uuid,timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.custodial_place_source_confirm_cohort_v1(jsonb,uuid,uuid,uuid)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.custodial_place_source_preview_cohort_v1(jsonb,uuid,text,uuid,text,jsonb,timestamp with time zone,text)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.feedback_operation_v1(jsonb,text,jsonb)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.feedback_request_collision_v1()','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.place_operation_v1(jsonb,jsonb)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.place_source_apply_cohort_v1(jsonb,uuid,uuid,uuid,timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.unfinished_evidence_immutable_v1()','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.unfinished_work_operation_v1(jsonb,text,jsonb)','Current source recovery binding qualified after R006'),
 ('grant','custodial_leadership_private.valid_feedback_cohort_identity_v1(jsonb,text)','Current source recovery binding qualified after R006'),
 ('grant','custodial_record_local_enrollment_retention_v1(uuid,text,text,text)','Current source recovery binding qualified after R006'),
 ('grant','custodial_unfinished_work_recipient_v1(text)','Current source recovery binding qualified after R006'),
 ('grant','device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,jsonb)','Current source recovery binding qualified after R006'),
 ('grant','expire_stale_open_sessions(timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('grant','mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('grant','public.custodial_v12_guard_protected_device()','Current source recovery binding qualified after R006'),
 ('grant','public.static_weekly_v22_ack_recurring_application_target(uuid,uuid,uuid,uuid,bigint,bigint,text,text,timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('grant','public.static_weekly_v22_read_recurring_application_target(date,uuid,uuid,uuid,bigint)','Current source recovery binding qualified after R006'),
 ('grant','public.static_weekly_v22_reconcile_recurring_application_date(date)','Current source recovery binding qualified after R006'),
 ('grant','public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)','Current source recovery binding qualified after R006'),
 ('grant','public.static_weekly_v24_read_device_schedule_delivery(date,uuid,uuid,uuid,bigint)','Current source recovery binding qualified after R006'),
 ('grant','public.static_weekly_v25_read_current_recurring_delivery(date,uuid)','Current source recovery binding qualified after R006'),
 ('grant','static_weekly_accepted_exception_set(uuid,date)','Current source recovery binding qualified after R006'),
 ('grant','static_weekly_compiler_exception_set(uuid,date)','Current source recovery binding qualified after R006'),
 ('grant','static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','Current source recovery binding qualified after R006'),
 ('grant','static_weekly_v8_assert_lunch_document(uuid,jsonb)','Current source recovery binding qualified after R006'),
 ('grant','static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)','Current source recovery binding qualified after R006'),
 ('grant','static_weekly_v8_read_lunch_document(date)','Current source recovery binding qualified after R006'),
 ('relation','custodial_leadership_private.messaging_message_bindings','approved sealed repair dependency; existing schedules preserved'),
 ('relation','custodial_leadership_private.registrations','approved sealed repair dependency; existing schedules preserved'),
 ('relation','public.msg_broadcast_request_receipts','approved sealed repair dependency; existing schedules preserved'),
 ('relation','public.msg_users','approved sealed repair dependency; existing schedules preserved'),
 ('relation','public.ops_manager_notification_credentials','approved sealed repair dependency; existing schedules preserved'),
 ('relation','public.ops_manager_notification_preferences','approved sealed repair dependency; existing schedules preserved'),
 ('relation','public.ops_manager_notification_state','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.bind_registration_generation()','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.ensure_messaging_account(uuid,uuid,text)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.execute(text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.messaging_account_active(uuid,uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.notification_credential(uuid,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.session_view(uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_named_record_operation_v1(uuid,text,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_native_alert_utf8_prefix(text,integer)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_ops_manager_message_push_is_current(uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_ops_manager_notification_binding_is_current(uuid,uuid,uuid,text,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_ops_manager_notification_recipient_is_current(uuid,uuid,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_release_canary_authority_surface()','approved sealed repair dependency; existing schedules preserved'),
 ('function','evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('function','events_app_validate_scope_venue()','approved sealed repair dependency; existing schedules preserved'),
 ('function','msg_broadcast_operation_v1(uuid,text,text,text,boolean)','approved sealed repair dependency; existing schedules preserved'),
 ('function','msg_custodial_cohort_message_actor_v1(uuid,uuid,text)','approved sealed repair dependency; existing schedules preserved'),
 ('function','msg_is_runtime_user(uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('function','mz_event_reminder_schedule_candidate(jsonb,uuid,text)','approved sealed repair dependency; existing schedules preserved'),
 ('function','ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('function','ops_manager_enqueue_message_push()','approved sealed repair dependency; existing schedules preserved'),
 ('function','ops_manager_enqueue_scheduled_notifications(timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('function','ops_manager_notification_bind_credential()','approved sealed repair dependency; existing schedules preserved'),
 ('function','ops_manager_notification_validate_owner()','approved sealed repair dependency; existing schedules preserved'),
 ('function','static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text)','approved sealed repair dependency; existing schedules preserved'),
 ('function','static_weekly_manual_repeat_components(uuid,date)','approved sealed repair dependency; existing schedules preserved'),
 ('function','static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','approved sealed repair dependency; existing schedules preserved'),
 ('function','static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','custodial_leadership_private.messaging_message_bindings','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','custodial_leadership_private.registrations','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','public.msg_broadcast_request_receipts','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','public.msg_users','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','public.ops_manager_notification_credentials','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','public.ops_manager_notification_preferences','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','public.ops_manager_notification_queue','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','public.ops_manager_notification_state','approved sealed repair dependency; existing schedules preserved'),
 ('column_set','public.ops_manager_push_devices','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','custodial_leadership_private.messaging_message_bindings','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','custodial_leadership_private.registrations','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','public.msg_broadcast_request_receipts','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','public.msg_users','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','public.ops_manager_notification_credentials','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','public.ops_manager_notification_preferences','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','public.ops_manager_notification_queue','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','public.ops_manager_notification_state','approved sealed repair dependency; existing schedules preserved'),
 ('relation_state','public.ops_manager_push_devices','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.messaging_message_bindings:messaging_message_bindings_message_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.messaging_message_bindings:messaging_message_bindings_msg_user_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.messaging_message_bindings:messaging_message_bindings_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.messaging_message_bindings:messaging_message_bindings_registration_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_authority_generation_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_browser_hash_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_browser_id_key','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_claimed_account_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_cohort_principal_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_expiration_policy','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_identity_assurance_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_token_hash_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','custodial_leadership_private.registrations:registrations_token_hash_key','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_broadcast_request_receipts:msg_broadcast_request_receipts_client_broadcast_id_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_broadcast_request_receipts:msg_broadcast_request_receipts_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_custodial_claimed_account_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_custodial_cohort_identity_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_custodial_cohort_manager_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_employee_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_employee_unique','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_messaging_identity_key_format_chk','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_ops_manager_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.msg_users:msg_users_role_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_credentials:ops_manager_notification_creden_leadership_registration_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_credentials:ops_manager_notification_credent_leadership_registration_id_key','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_credentials:ops_manager_notification_credentials_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_credentials:ops_manager_notification_credentials_credential_kind_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_credentials:ops_manager_notification_credentials_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_credentials:ops_manager_notification_credentials_trusted_credential_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_credentials:ops_manager_notification_credentials_trusted_credential_id_key','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_preferences:ops_manager_notification_lookahead_valid','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_preferences:ops_manager_notification_preferences_credential_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_preferences:ops_manager_notification_preferences_manager_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_preferences:ops_manager_notification_preferences_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_preferences:ops_manager_notification_repeat_valid','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_preferences:ops_manager_notification_timezone_len','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_preferences:ops_manager_notification_weekdays_valid','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_attempts','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_body_len','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_credential_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_data_object','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_dispatch_binding','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_job_key_key','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_manager_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_status','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_title_len','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_queue:ops_manager_notification_queue_type','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_state:ops_manager_notification_state_credential_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_state:ops_manager_notification_state_key_len','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_state:ops_manager_notification_state_metadata_object','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_notification_state:ops_manager_notification_state_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_credential_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_credential_id_key','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_fcm_token_key','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_id_len','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_manager_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_metadata_object','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_platform','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_provider','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.ops_manager_push_devices:ops_manager_push_devices_token_len','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:coverall_exact_credential_kind','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:coverall_exact_revocation_actor','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_cohort_revoked_claimed_accou_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_cohort_revoked_registration__fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_li_cohort_claimed_account_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_binding_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_check1','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_cohort_registration_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_credential_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_manager_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_pkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_revoked_by_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_session_access_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_source_digest_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_source_id_fkey','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_token_hash_check','approved sealed repair dependency; existing schedules preserved'),
 ('constraint','public.static_weekly_coverall_access_links:static_weekly_coverall_access_links_token_hash_key','approved sealed repair dependency; existing schedules preserved'),
 ('view','public.v_cleaning_performance_comparison','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.messaging_message_bindings','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.registrations','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.msg_broadcast_request_receipts','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.msg_users','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_notification_credentials','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_notification_preferences','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_notification_queue','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_notification_state','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_push_devices','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.bind_registration_generation()','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.ensure_messaging_account(uuid,uuid,text)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.execute(text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.messaging_account_active(uuid,uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.notification_credential(uuid,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_private.session_view(uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_named_record_operation_v1(uuid,text,text,jsonb)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_native_alert_utf8_prefix(text,integer)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_ops_manager_message_push_is_current(uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_ops_manager_notification_binding_is_current(uuid,uuid,uuid,text,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_ops_manager_notification_recipient_is_current(uuid,uuid,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','custodial_release_canary_authority_surface()','approved sealed repair dependency; existing schedules preserved'),
 ('grant','evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','events_app_validate_scope_venue()','approved sealed repair dependency; existing schedules preserved'),
 ('grant','msg_broadcast_operation_v1(uuid,text,text,text,boolean)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','msg_custodial_cohort_message_actor_v1(uuid,uuid,text)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','msg_is_runtime_user(uuid)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','ops_manager_enqueue_message_push()','approved sealed repair dependency; existing schedules preserved'),
 ('grant','ops_manager_enqueue_scheduled_notifications(timestamp with time zone)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','ops_manager_notification_bind_credential()','approved sealed repair dependency; existing schedules preserved'),
 ('grant','ops_manager_notification_validate_owner()','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_enqueue_scheduled_notifications(timestamptz)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','static_weekly_manual_repeat_components(uuid,date)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','approved sealed repair dependency; existing schedules preserved'),
 ('grant','static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)','approved sealed repair dependency; existing schedules preserved'),
 ('function','custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)','typed original CoverAll credential; cohort name remains self-asserted'),
 ('grant','custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)','typed original CoverAll credential; cohort name remains self-asserted'),
 ('relation','public.static_weekly_manual_activation_confirmations','approved current-day activation; seven immutable normal days'),
 ('relation','public.static_weekly_manual_activation_packets','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_manual_activation_initial_envelope(uuid,uuid,bigint,text)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_manual_activation_packet_fingerprint(uuid,text,uuid,jsonb,jsonb)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_manual_activation_store_baseline(uuid)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_manual_roster_snapshot(date)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_manual_store_initial_baseline(uuid,text,jsonb)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_projection_window_start(date)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_read_manual_activation_basis(uuid,uuid,bigint)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_read_manual_activation_confirmation(uuid,text)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_read_manual_activation_roster(uuid)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_register_manual_activation_packet(uuid,uuid,text,uuid,jsonb,jsonb)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_source_window_start(jsonb,date)','approved current-day activation; seven immutable normal days'),
 ('function','static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamp with time zone)','approved current-day activation; seven immutable normal days'),
 ('column_set','public.static_weekly_manual_activation_confirmations','approved current-day activation; seven immutable normal days'),
 ('column_set','public.static_weekly_manual_activation_packets','approved current-day activation; seven immutable normal days'),
 ('relation_state','public.static_weekly_manual_activation_confirmations','approved current-day activation; seven immutable normal days'),
 ('relation_state','public.static_weekly_manual_activation_packets','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_confirmations:static_weekly_manual_activation_confirmat_idempotency_key_check','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_confirmations:static_weekly_manual_activation_confirmati_receipt_digest_check','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_confirmations:static_weekly_manual_activation_confirmations_manager_id_fkey','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_confirmations:static_weekly_manual_activation_confirmations_packet_id_fkey','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_confirmations:static_weekly_manual_activation_confirmations_pkey','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_packets:static_weekly_manual_activation_packets_manager_id_fkey','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_packets:static_weekly_manual_activation_packets_packet_digest_check','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_packets:static_weekly_manual_activation_packets_pkey','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_packets:static_weekly_manual_activation_packets_source_id_fkey','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_packets:static_weekly_manual_activation_packets_source_id_key','approved current-day activation; seven immutable normal days'),
 ('constraint','public.static_weekly_manual_activation_packets:static_weekly_manual_activation_packets_template_id_fkey','approved current-day activation; seven immutable normal days'),
 ('grant','public.static_weekly_manual_activation_confirmations','approved current-day activation; seven immutable normal days'),
 ('grant','public.static_weekly_manual_activation_packets','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_manual_activation_initial_envelope(uuid,uuid,bigint,text)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_manual_activation_packet_fingerprint(uuid,text,uuid,jsonb,jsonb)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_manual_activation_store_baseline(uuid)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_manual_roster_snapshot(date)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_manual_store_initial_baseline(uuid,text,jsonb)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_projection_window_start(date)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_read_manual_activation_basis(uuid,uuid,bigint)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_read_manual_activation_confirmation(uuid,text)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_read_manual_activation_roster(uuid)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_register_manual_activation_packet(uuid,uuid,text,uuid,jsonb,jsonb)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_source_window_start(jsonb,date)','approved current-day activation; seven immutable normal days'),
 ('grant','static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamp with time zone)','approved current-day activation; seven immutable normal days'),
 ('relation','public.static_weekly_coverall_access_links','canonical capacity-bound private handout; no legacy employee mapping'),
 ('function','static_weekly_assert_coverall_link_basis(jsonb,uuid,text)','canonical capacity-bound private handout; no legacy employee mapping'),
 ('function','static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)','canonical capacity-bound private handout; no legacy employee mapping'),
 ('function','static_weekly_read_coverall_link(text)','canonical capacity-bound private handout; no legacy employee mapping'),
 ('function','static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)','canonical capacity-bound private handout; no legacy employee mapping'),
 ('column_set','public.static_weekly_coverall_access_links','canonical capacity-bound private handout; no legacy employee mapping'),
 ('relation_state','public.static_weekly_coverall_access_links','canonical capacity-bound private handout; no legacy employee mapping'),
 ('grant','public.static_weekly_coverall_access_links','canonical capacity-bound private handout; no legacy employee mapping'),
 ('grant','static_weekly_assert_coverall_link_basis(jsonb,uuid,text)','canonical capacity-bound private handout; no legacy employee mapping'),
 ('grant','static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)','canonical capacity-bound private handout; no legacy employee mapping'),
 ('grant','static_weekly_read_coverall_link(text)','canonical capacity-bound private handout; no legacy employee mapping'),
 ('grant','static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)','canonical capacity-bound private handout; no legacy employee mapping'),
('column','public.static_weekly_recurring_notification_plan_reads:assignment_epoch','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:authority_revision','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:backend_principal','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:credential_id','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:device_id','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:employee_id','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:intent_id','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:issued_at','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:plan_body','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:plan_read_id','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:rendered_digest','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:semantic_digest','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:service_date','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:target_digest','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:target_type','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column','public.static_weekly_recurring_notification_plan_reads:valid_until','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('column_set','public.static_weekly_recurring_notification_plan_reads','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_p_authority_revision_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_pl_backend_principal_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_pla_assignment_epoch_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_r_target_digest_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_re_credential_id_fkey','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_rea_target_type_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_read_employee_id_fkey','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_reads_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_reads_device_id_fkey','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_reads_pkey','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_reads_plan_body_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_rendered_digest_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('constraint','public.static_weekly_recurring_notification_plan_reads:static_weekly_recurring_notification_plan_semantic_digest_check','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v27_issue_recurring_notification_plan(date,uuid,uuid,uuid,bigint,uuid,text)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v27_lock_notification_plan_sources()','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v27_notification_plan_at(date,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v27_notification_plan_backend_principal(uuid,uuid,uuid,bigint)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v27_notification_plan_source_write_fence()','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v27_original_native_bindings(jsonb,timestamp with time zone)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_recurring_notification_plan_reads','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_v27_issue_recurring_notification_plan(date,uuid,uuid,uuid,bigint,uuid,text)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_v27_lock_notification_plan_sources()','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_v27_notification_plan_at(date,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_v27_notification_plan_backend_principal(uuid,uuid,uuid,bigint)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_v27_notification_plan_source_write_fence()','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('grant','public.static_weekly_v27_original_native_bindings(jsonb,timestamp with time zone)','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('relation','public.static_weekly_recurring_notification_plan_reads','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('relation_state','public.static_weekly_recurring_notification_plan_reads','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.completion_responses.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.coverage_templates.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_dated_activations.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_dated_occurrences.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_dated_publications.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_employee_device_assignment_history.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_offline_actor_contexts.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_offline_reconciliation_records.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_offline_scan_event_evidence.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.custodial_offline_submission_proofs.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.daily_group_assignments.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.daily_schedule_assignments.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.daily_work_roster.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.device_auth_credentials.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.device_notification_acknowledgements.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.devices.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.employee_native_lunch_dispatch_attempts.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.employee_native_push_delivery_receipts.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.employee_native_push_generations.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.employee_push_registrations.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.employee_shift_templates.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.employees.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.location_group_memberships.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.location_group_workload_settings.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.location_groups.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.locations.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.msg_device_assignments.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.msg_users.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.operating_hours.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.operational_notification_jobs.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_notification_plan_reads.custodial_disaster_restore_mutation_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_notification_plan_reads.trg_recurring_notification_plan_reads_immutable','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.sessions.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_authority_source_documents.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_contractor_capacity_registrations.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_application_intents.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_application_receipts.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_invalidations.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_publication_bindings.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_terminal_intents.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_recurring_terminal_receipts.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_staffing_absence_cancellations.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.static_weekly_staffing_absences.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.system_settings.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_roster_slot_incumbencies.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_roster_slot_incumbency_closures.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_roster_slot_staffing_states.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_roster_slots.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_schedule_command_receipts.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_schedule_compiled_projections.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_schedule_exception_commands.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_schedule_lunch_documents.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_schedule_occurrences.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_schedule_publications.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('trigger','public.weekly_schedule_versions.custodial_recurring_notification_plan_source_fence','complete authenticated current notification plan; issued immutable server read; no native or OS receipt authority'),
('function','public.static_weekly_v26_read_original_delivery_outcome(uuid,text,uuid,uuid,uuid,bigint)','authenticated read-only original delivery outcome'),
    ('function','custodial_release_identity.read_current_verified_dashboard_checks_v1()','dashboard read dependency'),
('function','static_weekly_pending_applied_summary(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_assert_day(uuid,jsonb,uuid,date,jsonb)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_assert_payload(uuid,uuid,jsonb)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_assert_projection(uuid,uuid,jsonb)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_context(uuid,uuid)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_day_source(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_effective_work(uuid,date,uuid,date,jsonb)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_exception_set(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_lunch_base(uuid,jsonb,jsonb,uuid,date)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_lunch_derivation(uuid,jsonb,jsonb,uuid,date,uuid)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_original_exception_set(uuid,date,uuid)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_pending_summary(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_applied_summary(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_assert_day(uuid,jsonb,uuid,date,jsonb)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_assert_payload(uuid,uuid,jsonb)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_assert_projection(uuid,uuid,jsonb)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_context(uuid,uuid)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_day_source(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_effective_work(uuid,date,uuid,date,jsonb)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_exception_set(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_lunch_base(uuid,jsonb,jsonb,uuid,date)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_lunch_derivation(uuid,jsonb,jsonb,uuid,date,uuid)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_original_exception_set(uuid,date,uuid)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','private independently checked approved pending staffing; no public capability'),
('grant','static_weekly_pending_summary(uuid,uuid,date,date)','private independently checked approved pending staffing; no public capability'),
('function','static_weekly_approved_dated_assert_closing(jsonb,jsonb,jsonb,jsonb,jsonb,date)','private independently checked approved dated original materialization; no public capability'),
('function','static_weekly_approved_dated_assert_window(jsonb,text)','private independently checked approved dated original materialization; no public capability'),
('function','static_weekly_approved_dated_effective_availability(jsonb,text,date,jsonb)','private independently checked approved dated original materialization; no public capability'),
('function','static_weekly_approved_dated_effective_work(uuid,date,jsonb)','private independently checked approved dated original materialization; no public capability'),
('function','static_weekly_approved_dated_materialize_projection(uuid,uuid,date,text,bigint,bigint,text,jsonb)','private independently checked approved dated original materialization; no public capability'),
('function','static_weekly_approved_dated_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','private independently checked approved dated original materialization; no public capability'),
('function','static_weekly_assert_approved_dated_lunch(uuid,jsonb)','private independently checked approved dated original materialization; no public capability'),
('function','static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_approved_dated_assert_closing(jsonb,jsonb,jsonb,jsonb,jsonb,date)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_approved_dated_assert_window(jsonb,text)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_approved_dated_effective_availability(jsonb,text,date,jsonb)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_approved_dated_effective_work(uuid,date,jsonb)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_approved_dated_materialize_projection(uuid,uuid,date,text,bigint,bigint,text,jsonb)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_approved_dated_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_assert_approved_dated_lunch(uuid,jsonb)','private independently checked approved dated original materialization; no public capability'),
('grant','static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','private independently checked approved dated original materialization; no public capability'),
('column','public.static_weekly_approved_template_confirmations:idempotency_key','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('column','public.static_weekly_approved_template_confirmations:manager_id','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('column','public.static_weekly_approved_template_confirmations:projection_id','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('column','public.static_weekly_approved_template_confirmations:publication_id','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('column','public.static_weekly_approved_template_confirmations:receipt_json','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('column','public.static_weekly_approved_template_confirmations:request_json','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('column','public.static_weekly_approved_template_confirmations:source_publication_id','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('column_set','public.static_weekly_approved_template_confirmations','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_key_shape','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_manager_fk','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_objects','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_original_key','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_projection_fk','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_projection_once','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_publication_fk','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_publication_profile','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('constraint','public.static_weekly_approved_template_confirmations:approved_confirmation_source_fk','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_approved_recurring_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_approved_recurring_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_approved_recurring_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_assert_approved_recurring_document(jsonb,date,boolean)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_assert_approved_recurring_projection(jsonb,uuid,date,jsonb)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_assert_approved_recurring_shift_end_derivation(jsonb,jsonb,jsonb,jsonb)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_guard_approved_template_confirmation()','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','static_weekly_read_approved_template_confirmation(uuid,text)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','public.static_weekly_approved_template_confirmations','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_approved_recurring_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_approved_recurring_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_approved_recurring_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_assert_approved_recurring_document(jsonb,date,boolean)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_assert_approved_recurring_projection(jsonb,uuid,date,jsonb)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_assert_approved_recurring_shift_end_derivation(jsonb,jsonb,jsonb,jsonb)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_guard_approved_template_confirmation()','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('grant','static_weekly_read_approved_template_confirmation(uuid,text)','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('index','approved_confirmation_publication_once','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('index','approved_confirmation_source_publication_idx','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('relation','public.static_weekly_approved_template_confirmations','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('relation_state','public.static_weekly_approved_template_confirmations','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('trigger','public.static_weekly_approved_template_confirmations.approved_confirmation_binding','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('trigger','public.static_weekly_approved_template_confirmations.approved_confirmation_immutable','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('trigger','public.static_weekly_approved_template_confirmations.approved_confirmation_no_truncate','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('trigger','public.static_weekly_approved_template_confirmations.custodial_disaster_restore_mutation_fence','immutable original fixed-approved confirmation and controlled recurring writer; no resend permission'),
('function','custodial_recovery.read_original_completion(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)','retained exact original completion disposition read only; no submission, ACK, finalizer, key or release authority'),
('function','public.custodial_same_original_completion_read_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)','retained exact original completion disposition read only; no submission, ACK, finalizer, key or release authority'),
('grant','custodial_recovery.read_original_completion(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)','retained exact original completion disposition read only; no submission, ACK, finalizer, key or release authority'),
('grant','public.custodial_same_original_completion_read_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)','retained exact original completion disposition read only; no submission, ACK, finalizer, key or release authority'),
    ('relation','custodial_release_identity.group_original_creations','exact source270 retained original group recovery'),
    ('relation','public.msg_threads','exact source270 retained original group recovery'),
    ('function','custodial_release_identity.guard_group_original_creation()','exact source270 retained original group recovery'),
    ('function','public.msg_create_group_thread_v2(uuid,text,uuid[],text)','exact source270 retained original group recovery'),
    ('function','public.msg_preserve_original_group_creation()','exact source270 retained original group recovery'),
    ('column','public.msg_threads:original_group_creation','exact source270 retained original group recovery'),
    ('column','custodial_release_identity.group_original_creations:creator_uuid','exact source270 retained original group recovery'),
    ('column','custodial_release_identity.group_original_creations:original_client_thread_id','exact source270 retained original group recovery'),
    ('column','custodial_release_identity.group_original_creations:group_uuid','exact source270 retained original group recovery'),
    ('column','custodial_release_identity.group_original_creations:original_tuple','exact source270 retained original group recovery'),
    ('column_set','custodial_release_identity.group_original_creations','exact source270 retained original group recovery'),
    ('column_set','public.msg_threads','exact source270 retained original group recovery'),
    ('relation_state','custodial_release_identity.group_original_creations','exact source270 retained original group recovery'),
    ('constraint','custodial_release_identity.group_original_creations:group_original_creations_pkey','exact source270 retained original group recovery'),
    ('constraint','custodial_release_identity.group_original_creations:group_original_creations_group_uuid_key','exact source270 retained original group recovery'),
    ('constraint','custodial_release_identity.group_original_creations:group_original_creations_original_client_thread_id_check','exact source270 retained original group recovery'),
    ('constraint','custodial_release_identity.group_original_creations:group_original_creations_original_tuple_check','exact source270 retained original group recovery'),
    ('trigger','custodial_release_identity.group_original_creations.group_original_creation_immutable','exact source270 retained original group recovery'),
    ('trigger','custodial_release_identity.group_original_creations.group_original_creation_no_truncate','exact source270 retained original group recovery'),
    ('trigger','public.msg_threads.trg_msg_preserve_original_group_creation','exact source270 retained original group recovery'),
    ('policy','custodial_release_identity.group_original_creations:group_original_creation_definer_owner','exact source270 retained original group recovery'),
    ('grant','custodial_release_identity.group_original_creations','exact source270 retained original group recovery'),
    ('grant','custodial_release_identity.guard_group_original_creation()','exact source270 retained original group recovery'),
    ('grant','public.msg_create_group_thread_v2(uuid,text,uuid[],text)','exact source270 retained original group recovery'),
    ('grant','public.msg_preserve_original_group_creation()','exact source270 retained original group recovery'),

    ('relation','custodial_release_identity.employee_message_original_outcomes','exact source268 private original Messenger ledger'),
    ('column','custodial_release_identity.employee_message_original_outcomes:request_fingerprint','exact source268 private original Messenger ledger'),
    ('column','custodial_release_identity.employee_message_original_outcomes:original_command','exact source268 private original Messenger ledger'),
    ('column','custodial_release_identity.employee_message_original_outcomes:original_request','exact source268 private original Messenger ledger'),
    ('column','custodial_release_identity.employee_message_original_outcomes:outcome_json','exact source268 private original Messenger ledger'),
    ('column','custodial_release_identity.employee_message_original_outcomes:recorded_at','exact source268 private original Messenger ledger'),
    ('column_set','custodial_release_identity.employee_message_original_outcomes','exact source268 private original Messenger ledger'),
    ('relation_state','custodial_release_identity.employee_message_original_outcomes','exact source268 private original Messenger ledger'),
    ('constraint','custodial_release_identity.employee_message_original_outcomes:employee_message_original_outcomes_original_command_check','exact source268 private original Messenger ledger'),
    ('constraint','custodial_release_identity.employee_message_original_outcomes:employee_message_original_outcomes_original_request_check','exact source268 private original Messenger ledger'),
    ('constraint','custodial_release_identity.employee_message_original_outcomes:employee_message_original_outcomes_outcome_json_check','exact source268 private original Messenger ledger'),
    ('constraint','custodial_release_identity.employee_message_original_outcomes:employee_message_original_outcomes_pkey','exact source268 private original Messenger ledger'),
    ('constraint','custodial_release_identity.employee_message_original_outcomes:employee_message_original_outcomes_request_fingerprint_check','exact source268 private original Messenger ledger'),
    ('trigger','custodial_release_identity.employee_message_original_outcomes.employee_message_original_outcomes_immutable','exact source268 private original Messenger ledger'),
    ('grant','custodial_release_identity.employee_message_original_outcomes','exact source268 private original Messenger ledger'),

('function','custodial_release_identity.read_original_scan_completion_v1(uuid,text,uuid,bigint,uuid,jsonb)','Exact original native completion read'),
('function','custodial_release_identity.read_current_original_dashboard_completions_v1()','Current accepted original Dashboard read'),
    ('relation','public.static_weekly_vacancy_reviewed_preparations','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_consume_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text,text)','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_read_vacancy_reviewed_preparation(uuid,uuid,text,text,text)','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_stage_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text)','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_vacancy_reviewed_current(static_weekly_vacancy_reviewed_preparations,bigint,text)','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_vacancy_reviewed_descriptor(static_weekly_vacancy_reviewed_preparations,boolean,boolean)','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_vacancy_reviewed_guard()','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_vacancy_reviewed_input(jsonb,date)','exact source265 private vacancy reviewed preparation'),
    ('function','public.static_weekly_vacancy_reviewed_packet(text,uuid,text)','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:manager_id','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:idempotency_key','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:credential_id','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:device_identifier','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:generation','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:state','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:packet_utf8','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:payload_sha256','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:preview_digest','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:worker_candidate_digest','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:staged_at','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:consumed_at','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:accepted_witness','exact source265 private vacancy reviewed preparation'),
    ('column','public.static_weekly_vacancy_reviewed_preparations:accepted_witness_sha256','exact source265 private vacancy reviewed preparation'),
    ('column_set','public.static_weekly_vacancy_reviewed_preparations','exact source265 private vacancy reviewed preparation'),
    ('relation_state','public.static_weekly_vacancy_reviewed_preparations','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:static_weekly_vacancy_reviewed_preparations_credential_id_fkey','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:static_weekly_vacancy_reviewed_preparations_manager_id_fkey','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:static_weekly_vacancy_reviewed_preparations_pkey','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:vacancy_review_device','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:vacancy_review_digests','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:vacancy_review_generation','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:vacancy_review_key','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:vacancy_review_packet','exact source265 private vacancy reviewed preparation'),
    ('constraint','public.static_weekly_vacancy_reviewed_preparations:vacancy_review_terminal','exact source265 private vacancy reviewed preparation'),
    ('trigger','public.static_weekly_vacancy_reviewed_preparations.custodial_disaster_restore_mutation_fence','exact source265 private vacancy reviewed preparation'),
    ('trigger','public.static_weekly_vacancy_reviewed_preparations.trg_static_weekly_vacancy_reviewed_guard','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_vacancy_reviewed_preparations','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_consume_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text,text)','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_read_vacancy_reviewed_preparation(uuid,uuid,text,text,text)','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_stage_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text)','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_vacancy_reviewed_current(static_weekly_vacancy_reviewed_preparations,bigint,text)','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_vacancy_reviewed_descriptor(static_weekly_vacancy_reviewed_preparations,boolean,boolean)','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_vacancy_reviewed_guard()','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_vacancy_reviewed_input(jsonb,date)','exact source265 private vacancy reviewed preparation'),
    ('grant','public.static_weekly_vacancy_reviewed_packet(text,uuid,text)','exact source265 private vacancy reviewed preparation'),

('function','public.mz_mark_employee_event_opened(uuid,text)','exact original employee Event open authority'),
('grant','public.mz_mark_employee_event_opened(uuid,text)','unchanged server-only original Event open ACL'),
('grant','static_weekly_v10_begin_staffing_command(jsonb,uuid,bigint,uuid)','exact existing CP-only original cancellation writer ACL'),
('grant','static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','exact existing CP-only original cancellation writer ACL'),
('grant','static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','exact existing CP-only original cancellation writer ACL'),
('function','public.static_weekly_v3_read_manager_snapshot(date)','existing CP-only manager cancellation target snapshot'),
('grant','public.static_weekly_v3_read_manager_snapshot(date)','exact existing CP-only manager snapshot ACL'),
('grant','static_weekly_v10_read_staffing_command(uuid,uuid)','existing CP-only prepared staffing read; no raw staged access'),
('function','public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)','exact immutable original Feedback receipt readback; no writer replay or retry authorization'),
('grant','public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)','exact immutable original Feedback receipt readback; no writer replay or retry authorization'),
('function','public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)','exact original staffing command readback only; no mutation, resend or phone release'),
('grant','public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)','exact original staffing command readback only; no mutation, resend or phone release'),
('column','public.custodial_held_event_previews_v2:applied_at','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:created_at','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:credential_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:db_review_snapshot_sha256','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:device_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:event_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:expires_at','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:ledger_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:manager_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:normalized_event','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_created_at','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_event_key','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_message_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_payload_sha256','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_received_at','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_subject','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_sync_note','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:original_updated_at','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:preview_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:preview_sha256','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:session_fingerprint','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:source_provenance_digest','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:state','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:ui_review_snapshot_sha256','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:venue_fingerprint','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column','public.custodial_held_event_previews_v2:venue_id','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('column_set','public.custodial_held_event_previews_v2','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_credential_id_fkey','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_event_id_fkey','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_ledger_id_fkey','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_manager_id_fkey','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_normalized_event_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_original_payload_sha256_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_pkey','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_preview_sha256_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_session_fingerprint_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_source_provenance_digest_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_state_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_venue_fingerprint_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v2_venue_id_fkey','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v_db_review_snapshot_sha256_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:custodial_held_event_previews_v_ui_review_snapshot_sha256_check','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('constraint','public.custodial_held_event_previews_v2:held_preview_state_event_pair','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('function','public.custodial_held_event_confirm_v2(uuid,text,uuid,uuid,text,text)','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('function','public.custodial_held_event_preview_v2(uuid,text,text,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,uuid,text)','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('grant','public.custodial_held_event_confirm_v2(uuid,text,uuid,uuid,text,text)','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('grant','public.custodial_held_event_preview_v2(uuid,text,text,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,uuid,text)','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('grant','public.custodial_held_event_previews_v2','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('index','custodial_held_event_previews_v2_ledger_idx','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('policy','public.custodial_held_event_previews_v2:held_event_previews_service_v2','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('relation','public.custodial_held_event_previews_v2','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('relation_state','public.custodial_held_event_previews_v2','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('trigger','public.custodial_held_event_previews_v2.custodial_disaster_restore_mutation_fence','explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders'),
('function','public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)','current original opaque frame bytes/syntax only; no ACK, decryption, work, finalizer or key authority'),
('grant','public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)','current original opaque frame bytes/syntax only; no ACK, decryption, work, finalizer or key authority'),
('column','public.custodial_native_private_custody_chunks:attestation_digest','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:chunk_bytes','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:chunk_index','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:chunk_sha256','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:native_request_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:operation_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:received_at','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:request_body_sha256','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:request_bytes','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_chunks:write_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:chunk_count','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:credential_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:device_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:frame_bytes','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:frame_sha256','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:generation_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:operation_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:original_context','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:original_generation','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:original_wire','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:original_wire_sha256','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:owner_proof','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:plan_sha256','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:principal_digest','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:record_sha256','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:retained_at','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:separation_id','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_native_private_custody_operations:verified_binding','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column_set','public.custodial_native_private_custody_chunks','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column_set','public.custodial_native_private_custody_operations','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chun_request_body_sha256_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunk_attestation_digest_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_check1','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_chunk_bytes_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_chunk_index_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_chunk_sha256_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_native_request_id_key','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_operation_id_fkey','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_pkey','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_received_at_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_request_bytes_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_chunks:custodial_native_private_custody_chunks_write_id_key','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_ope_original_wire_sha256_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_oper_original_generation_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operati_original_context_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operati_principal_digest_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operati_verified_binding_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_check1','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_credential_id_fkey','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_device_id_fkey','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_frame_bytes_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_frame_sha256_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_generation_id_fkey','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_original_wire_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_owner_proof_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_pkey','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_plan_sha256_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_record_sha256_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_retained_at_check','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('constraint','public.custodial_native_private_custody_operations:custodial_native_private_custody_operations_separation_id_fkey','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('function','public.custodial_private_custody_v1_immutable()','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('function','public.custodial_private_custody_v1_read_chunk(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('function','public.custodial_private_custody_v1_retain_chunk(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb,jsonb)','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('grant','public.custodial_native_private_custody_chunks','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('grant','public.custodial_native_private_custody_operations','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('grant','public.custodial_private_custody_v1_immutable()','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('grant','public.custodial_private_custody_v1_read_chunk(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('grant','public.custodial_private_custody_v1_retain_chunk(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb,jsonb)','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('index','custodial_native_private_custody_operation_credential_idx','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('index','custodial_native_private_custody_operation_generation_idx','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('index','custodial_native_private_custody_operation_owner_idx','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('index','custodial_native_private_custody_operation_separation_idx','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('relation','public.custodial_native_private_custody_chunks','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('relation','public.custodial_native_private_custody_operations','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('relation_state','public.custodial_native_private_custody_chunks','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('relation_state','public.custodial_native_private_custody_operations','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('trigger','public.custodial_native_private_custody_chunks.custodial_disaster_restore_mutation_fence','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('trigger','public.custodial_native_private_custody_chunks.trg_native_private_custody_chunk_immutable','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('trigger','public.custodial_native_private_custody_chunks.trg_native_private_custody_chunk_no_truncate','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('trigger','public.custodial_native_private_custody_operations.custodial_disaster_restore_mutation_fence','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('trigger','public.custodial_native_private_custody_operations.trg_native_private_custody_operation_immutable','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('trigger','public.custodial_native_private_custody_operations.trg_native_private_custody_operation_no_truncate','opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority'),
('column','public.custodial_private_retained_chunk_requests:chunk_index','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_chunk_requests:chunk_sha256','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_chunk_requests:native_request_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_chunk_requests:operation_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_chunk_requests:received_at','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_record_values:native_request_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_record_values:operation_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_record_values:parent_wire_sha256','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_record_values:record_count','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_record_values:retained_at','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_record_values:values_bytes','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_record_values:values_sha256','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:chunk_bytes','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:chunk_count','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:chunk_index','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:chunk_sha256','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:native_request_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:operation_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:parent_wire_sha256','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:retained_at','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:value_bytes','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_chunks:value_sha256','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_requests:native_request_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_requests:operation_id','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_requests:received_at','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_private_retained_value_requests:values_sha256','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column_set','public.custodial_private_retained_chunk_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column_set','public.custodial_private_retained_record_values','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column_set','public.custodial_private_retained_value_chunks','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column_set','public.custodial_private_retained_value_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_chunk_requests:custodial_private_retained_chunk__operation_id_chunk_index_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_chunk_requests:custodial_private_retained_chunk_request_native_request_id_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_chunk_requests:custodial_private_retained_chunk_requests_chunk_sha256_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_chunk_requests:custodial_private_retained_chunk_requests_pkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_chunk_requests:custodial_private_retained_chunk_requests_received_at_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_valu_parent_wire_sha256_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_native_request_id_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_operation_id_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_pkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_record_count_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_retained_at_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_values_bytes_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_record_values:custodial_private_retained_record_values_values_sha256_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunk_parent_wire_sha256_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_check1','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_check2','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_chunk_bytes_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_chunk_count_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_chunk_index_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_chunk_sha256_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_native_request_id_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_operation_id_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_pkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_retained_at_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_value_bytes_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_chunks:custodial_private_retained_value_chunks_value_sha256_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_requests:custodial_private_retained_value_request_native_request_id_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_requests:custodial_private_retained_value_requests_operation_id_fkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_requests:custodial_private_retained_value_requests_pkey','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_requests:custodial_private_retained_value_requests_received_at_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('constraint','public.custodial_private_retained_value_requests:custodial_private_retained_value_requests_values_sha256_check','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('function','public.custodial_private_assert_original_record_values(uuid,bytea)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('function','public.custodial_private_parse_original_value_chunk(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('function','public.custodial_private_read_original_record_values(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('function','public.custodial_private_read_original_value_chunk(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('function','public.custodial_private_retain_original_record_values(uuid,uuid,bytea)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('function','public.custodial_private_retain_original_value_chunk(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_assert_original_record_values(uuid,bytea)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_parse_original_value_chunk(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_read_original_record_values(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_read_original_value_chunk(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_retain_original_record_values(uuid,uuid,bytea)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_retain_original_value_chunk(uuid,uuid)','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_retained_chunk_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_retained_record_values','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_retained_value_chunks','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('grant','public.custodial_private_retained_value_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('index','private_chunk_requests_operation_idx','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('index','private_value_chunks_native_request_idx','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation','public.custodial_private_retained_chunk_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation','public.custodial_private_retained_record_values','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation','public.custodial_private_retained_value_chunks','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation','public.custodial_private_retained_value_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation_state','public.custodial_private_retained_chunk_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation_state','public.custodial_private_retained_record_values','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation_state','public.custodial_private_retained_value_chunks','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('relation_state','public.custodial_private_retained_value_requests','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_chunk_requests.custodial_disaster_restore_mutation_fence','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_chunk_requests.trg_private_chunk_requests_immutable','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_chunk_requests.trg_private_chunk_requests_no_truncate','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_record_values.custodial_disaster_restore_mutation_fence','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_record_values.trg_private_values_immutable','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_record_values.trg_private_values_no_truncate','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_value_chunks.custodial_disaster_restore_mutation_fence','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_value_chunks.trg_private_value_chunks_immutable','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_value_chunks.trg_private_value_chunks_no_truncate','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_value_requests.custodial_disaster_restore_mutation_fence','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_value_requests.trg_private_value_requests_immutable','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('trigger','public.custodial_private_retained_value_requests.trg_private_value_requests_no_truncate','private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority'),
('column','public.custodial_native_retained_evidence:assignment_epoch','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:authority_revision','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:canonical_device_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:credential_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:cutoff_at','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:device_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:employee_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:generation_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:operation_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:original_context','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:original_generation','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:retained_at','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:separation_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:verified_binding','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:wire_bytes','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence:wire_sha256','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence_requests:attestation_digest','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence_requests:native_request_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence_requests:operation_id','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence_requests:received_at','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence_requests:request_bytes','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column','public.custodial_native_retained_evidence_requests:request_sha256','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column_set','public.custodial_native_retained_evidence','original retained manifest/digest evidence only; no work, ACK or reuse'),
('column_set','public.custodial_native_retained_evidence_requests','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evi_separation_id_generation_id_c_key','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_assignment_epoch_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_authority_revision_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_canonical_device_id_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_credential_id_fkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_cutoff_at_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_device_id_fkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_employee_id_fkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_generation_id_fkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_original_context_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_original_generation_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_pkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_retained_at_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_separation_id_fkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_verified_binding_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_wire_bytes_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_wire_digest','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence:custodial_native_retained_evidence_wire_sha256_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence_requests:custodial_native_retained_evidence_req_attestation_digest_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence_requests:custodial_native_retained_evidence_request_request_sha256_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence_requests:custodial_native_retained_evidence_requests_operation_id_fkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence_requests:custodial_native_retained_evidence_requests_pkey','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence_requests:custodial_native_retained_evidence_requests_received_at_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence_requests:custodial_native_retained_evidence_requests_request_bytes_check','original retained manifest/digest evidence only; no work, ACK or reuse'),
('constraint','public.custodial_native_retained_evidence_requests:custodial_native_retained_request_digest','original retained manifest/digest evidence only; no work, ACK or reuse'),
('function','public.custodial_v15_assert_native_json(json,integer)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('function','public.custodial_v15_read_retained_native_evidence(uuid,uuid,uuid,text,text,uuid)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('function','public.custodial_v15_reject_retained_evidence_mutation()','original retained manifest/digest evidence only; no work, ACK or reuse'),
('function','public.custodial_v15_retain_original_native_evidence(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('function','public.custodial_v15_retained_evidence_receipt(custodial_native_retained_evidence)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('grant','public.custodial_native_retained_evidence','original retained manifest/digest evidence only; no work, ACK or reuse'),
('grant','public.custodial_native_retained_evidence_requests','original retained manifest/digest evidence only; no work, ACK or reuse'),
('grant','public.custodial_v15_assert_native_json(json,integer)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('grant','public.custodial_v15_read_retained_native_evidence(uuid,uuid,uuid,text,text,uuid)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('grant','public.custodial_v15_reject_retained_evidence_mutation()','original retained manifest/digest evidence only; no work, ACK or reuse'),
('grant','public.custodial_v15_retain_original_native_evidence(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('grant','public.custodial_v15_retained_evidence_receipt(custodial_native_retained_evidence)','original retained manifest/digest evidence only; no work, ACK or reuse'),
('relation','public.custodial_native_retained_evidence','original retained manifest/digest evidence only; no work, ACK or reuse'),
('relation','public.custodial_native_retained_evidence_requests','original retained manifest/digest evidence only; no work, ACK or reuse'),
('relation_state','public.custodial_native_retained_evidence','original retained manifest/digest evidence only; no work, ACK or reuse'),
('relation_state','public.custodial_native_retained_evidence_requests','original retained manifest/digest evidence only; no work, ACK or reuse'),
('trigger','public.custodial_native_retained_evidence.custodial_disaster_restore_mutation_fence','original retained manifest/digest evidence only; no work, ACK or reuse'),
('trigger','public.custodial_native_retained_evidence.trg_native_retained_evidence_immutable','original retained manifest/digest evidence only; no work, ACK or reuse'),
('trigger','public.custodial_native_retained_evidence.trg_native_retained_evidence_no_truncate','original retained manifest/digest evidence only; no work, ACK or reuse'),
('trigger','public.custodial_native_retained_evidence_requests.custodial_disaster_restore_mutation_fence','original retained manifest/digest evidence only; no work, ACK or reuse'),
('trigger','public.custodial_native_retained_evidence_requests.trg_native_retained_requests_immutable','original retained manifest/digest evidence only; no work, ACK or reuse'),
('trigger','public.custodial_native_retained_evidence_requests.trg_native_retained_requests_no_truncate','original retained manifest/digest evidence only; no work, ACK or reuse'),
('function','public.custodial_v14_read_separation_generation(uuid,uuid,uuid,uuid,text)','purpose-only original native generation retention'),
    ('function','custodial_native_schedule_preparation_source(uuid,uuid,uuid)','service-only current source/native recipient projection; no delivery'),
    ('grant','custodial_native_schedule_preparation_source(uuid,uuid,uuid)','service-only; no table or send access'),
    ('function','custodial_native_schedule_source_requests()','service-only current recurring recipient/anchor discovery; source-only'),
    ('grant','custodial_native_schedule_source_requests()','service-only; no client table or send access'),
    ('function','custodial_native_schedule_target(uuid,uuid)','service-only source-current recipient/token before final attempt'),
    ('grant','custodial_native_schedule_target(uuid,uuid)','service-only target; no client access'),
    ('relation','public.employee_native_schedule_outcomes','immutable original provider outcome; not handset delivery'),
    ('relation_state','public.employee_native_schedule_outcomes','RPC-only FORCE-RLS outcomes'),
    ('grant','public.employee_native_schedule_outcomes','no direct runtime outcome access'),
    ('function','custodial_native_schedule_dispatch_status(uuid)','original attempt/outcome readback; never resends'),
    ('function','custodial_native_schedule_outcome(jsonb,jsonb)','service-only original settlement; no successor mutation'),
    ('relation','public.employee_native_schedule_dispatch_attempts','immutable single business attempt; native qualification separate'),
    ('relation_state','public.employee_native_schedule_dispatch_attempts','RPC-only FORCE-RLS attempt original'),
    ('grant','public.employee_native_schedule_dispatch_attempts','no direct runtime source access'),
    ('function','custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)','service-only business attempt; no runtime activation'),
    ('relation','public.employee_native_schedule_jobs','immutable SOURCE-to-job original; no delivery'),
    ('relation_state','public.employee_native_schedule_jobs','RPC-only FORCE-RLS job marker'),
    ('grant','public.employee_native_schedule_jobs','no direct runtime source access'),
    ('function','custodial_native_schedule_job_prepare(uuid,jsonb,uuid)','service-only job preparation; no send'),
    ('function','custodial_native_schedule_original_record_id(uuid,uuid,text)','SCHEDULE authoritative original identity; no send'),
    ('grant','custodial_native_schedule_original_record_id(uuid,uuid,text)','SCHEDULE authoritative original identity; no send'),
    ('function','custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamp with time zone)','SCHEDULE authoritative original identity; no send'),
    ('grant','custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamp with time zone)','SCHEDULE authoritative original identity; no send'),
    ('function','custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamp with time zone)','SCHEDULE authoritative original identity; no send'),
    ('grant','custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamp with time zone)','SCHEDULE authoritative original identity; no send'),
    ('function','custodial_native_schedule_observation_originals(uuid,text,jsonb)','SCHEDULE authoritative original identity; no send'),
    ('grant','custodial_native_schedule_observation_originals(uuid,text,jsonb)','SCHEDULE authoritative original identity; no send'),
    ('function','custodial_native_schedule_live(uuid,jsonb,timestamp with time zone)','private current SCHEDULE source/receipt inventory predicate; no send'),
    ('grant','custodial_native_schedule_live(uuid,jsonb,timestamp with time zone)','no direct runtime predicate access'),
    ('relation','public.employee_native_schedule_finalizations','immutable09:45 final wire; no send'),
    ('relation_state','public.employee_native_schedule_finalizations','RPC-only FORCE-RLS final original'),
    ('grant','public.employee_native_schedule_finalizations','no direct runtime finalization access'),
    ('function','custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)','service-only finalization; no send'),
    ('function','custodial_native_schedule_finalization_status(uuid,uuid,uuid)','exact original wire readback; no send'),
    ('function','custodial_native_schedule_content_source(uuid,uuid,uuid)','accepted source-only personalized09:45content; no send'),
    ('grant','custodial_native_schedule_content_source(uuid,uuid,uuid)','service-only content read; no send'),
    ('relation','public.employee_native_schedule_source_reservations','immutable09:45source-only original; no delivery'),
    ('relation_state','public.employee_native_schedule_source_reservations','RPC-only FORCE-RLS source original'),
    ('grant','public.employee_native_schedule_source_reservations','no direct runtime source access'),
    ('function','custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)','service-only source reservation; no send'),
    ('function','custodial_native_schedule_source_status(uuid,uuid,uuid)','exact original source readback; no send'),
    ('function','custodial_native_schedule_window_source(uuid,uuid,uuid)','private server-bound SCHEDULE source window; no delivery authority'),
    ('function','custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)','accepted lunch spoken content'),
    ('grant','custodial_native_lunch_spoken_body(uuid,text,text,uuid,text)','accepted lunch spoken content'),
    ('function','custodial_read_approved_initial_selection_v1(uuid,uuid,text,text,date)','approved initial selection metadata'),
    ('grant','custodial_read_approved_initial_selection_v1(uuid,uuid,text,text,date)','approved initial selection metadata'),
    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),
    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),

    ('function','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_action_actor_v1(uuid,uuid,text,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('function','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb)','source-bound manager scheduling and scan-ticket authority'),
    ('function','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid)','source-bound manager scheduling and scan-ticket authority'),
    ('function','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('function','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('function','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text)','source-bound manager scheduling and scan-ticket authority'),
    ('function','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text)','source-bound manager scheduling and scan-ticket authority'),
    ('function','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),
    ('grant','custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])','source-bound manager scheduling and scan-ticket authority'),

    ('function','custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamp with time zone)','native alert receipt authority'),
    ('function','custodial_native_alert_source_live(uuid,timestamp with time zone)','native alert receipt authority'),
    ('function','custodial_native_provider_original_tuple(uuid)','native alert receipt authority'),
    ('grant','custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamp with time zone)','native alert receipt authority'),
    ('grant','custodial_native_alert_source_live(uuid,timestamp with time zone)','native alert receipt authority'),
    ('grant','custodial_native_provider_original_tuple(uuid)','native alert receipt authority'),

    ('relation','public.employee_native_alert_finalizations','native alert birth authority'),
    ('relation','public.employee_native_alert_outcomes','native alert birth authority'),
    ('function','custodial_native_alert_dispatch_status(uuid)','native alert birth authority'),
    ('function','custodial_native_alert_finalize(uuid,uuid,uuid,jsonb,jsonb)','native alert birth authority'),
    ('function','custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)','native alert birth authority'),
    ('function','custodial_native_alert_message_current(uuid,jsonb,timestamp with time zone)','native alert birth authority'),
    ('function','custodial_native_alert_record_outcome(uuid,uuid,jsonb)','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:alert_kind','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:attempt_id','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:content_sha256','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:finalized_at','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:job_id','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:outcome_operation_id','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:payload','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:preparation_id','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:source_revision','native alert birth authority'),
    ('column','public.employee_native_alert_finalizations:valid_until','native alert birth authority'),
    ('column','public.employee_native_alert_outcomes:error_code','native alert birth authority'),
    ('column','public.employee_native_alert_outcomes:job_id','native alert birth authority'),
    ('column','public.employee_native_alert_outcomes:operation_id','native alert birth authority'),
    ('column','public.employee_native_alert_outcomes:provider_message_id','native alert birth authority'),
    ('column','public.employee_native_alert_outcomes:provider_outcome','native alert birth authority'),
    ('column','public.employee_native_alert_outcomes:recorded_at','native alert birth authority'),
    ('column_set','public.employee_native_alert_finalizations','native alert birth authority'),
    ('column_set','public.employee_native_alert_outcomes','native alert birth authority'),
    ('relation_state','public.employee_native_alert_finalizations','native alert birth authority'),
    ('relation_state','public.employee_native_alert_outcomes','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_alert_kind_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_attempt_id_key','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_check1','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_check2','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_content_sha256_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_job_id_fkey','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_outcome_operation_id_key','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_payload_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_pkey','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_preparation_id_key','native alert birth authority'),
    ('constraint','public.employee_native_alert_finalizations:employee_native_alert_finalizations_source_revision_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_outcomes:employee_native_alert_outcomes_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_outcomes:employee_native_alert_outcomes_job_id_fkey','native alert birth authority'),
    ('constraint','public.employee_native_alert_outcomes:employee_native_alert_outcomes_operation_id_key','native alert birth authority'),
    ('constraint','public.employee_native_alert_outcomes:employee_native_alert_outcomes_pkey','native alert birth authority'),
    ('constraint','public.employee_native_alert_outcomes:employee_native_alert_outcomes_provider_outcome_check','native alert birth authority'),
    ('trigger','public.employee_native_alert_finalizations.custodial_disaster_restore_mutation_fence','native alert birth authority'),
    ('trigger','public.employee_native_alert_finalizations.trg_employee_native_alert_finalizations_immutable','native alert birth authority'),
    ('trigger','public.employee_native_alert_outcomes.custodial_disaster_restore_mutation_fence','native alert birth authority'),
    ('trigger','public.employee_native_alert_outcomes.trg_employee_native_alert_outcomes_immutable','native alert birth authority'),
    ('grant','custodial_native_alert_dispatch_status(uuid)','native alert birth authority'),
    ('grant','custodial_native_alert_finalize(uuid,uuid,uuid,jsonb,jsonb)','native alert birth authority'),
    ('grant','custodial_native_alert_finalize_at(uuid,uuid,uuid,jsonb,jsonb,timestamp with time zone)','native alert birth authority'),
    ('grant','custodial_native_alert_message_current(uuid,jsonb,timestamp with time zone)','native alert birth authority'),
    ('grant','custodial_native_alert_record_outcome(uuid,uuid,jsonb)','native alert birth authority'),
    ('grant','public.employee_native_alert_finalizations','native alert birth authority'),
    ('grant','public.employee_native_alert_outcomes','native alert birth authority'),

    ('relation','public.employee_native_alert_preparations','native alert birth authority'),
    ('function','custodial_native_alert_prepare(uuid,uuid,jsonb)','native alert birth authority'),
    ('function','custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','native alert birth authority'),
    ('function','custodial_native_alert_target(uuid,uuid)','native alert birth authority'),
    ('function','custodial_native_alert_target_at(uuid,uuid,timestamp with time zone)','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:alert_kind','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:expected','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:job_id','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:lease_token','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:preparation_id','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:prepared_at','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:prepared_until','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:source_projection','native alert birth authority'),
    ('column','public.employee_native_alert_preparations:source_revision','native alert birth authority'),
    ('column_set','public.employee_native_alert_preparations','native alert birth authority'),
    ('relation_state','public.employee_native_alert_preparations','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_alert_kind_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_expected_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_job_id_fkey','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_pkey','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_preparation_id_key','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_source_projection_check','native alert birth authority'),
    ('constraint','public.employee_native_alert_preparations:employee_native_alert_preparations_source_revision_check','native alert birth authority'),
    ('trigger','public.employee_native_alert_preparations.custodial_disaster_restore_mutation_fence','native alert birth authority'),
    ('trigger','public.employee_native_alert_preparations.trg_employee_native_alert_preparations_immutable','native alert birth authority'),
    ('grant','custodial_native_alert_prepare(uuid,uuid,jsonb)','native alert birth authority'),
    ('grant','custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','native alert birth authority'),
    ('grant','custodial_native_alert_target(uuid,uuid)','native alert birth authority'),
    ('grant','custodial_native_alert_target_at(uuid,uuid,timestamp with time zone)','native alert birth authority'),
    ('grant','public.employee_native_alert_preparations','native alert birth authority'),


 ('relation','public.static_weekly_approved_template_catalog','release-only fixed pattern catalog'),
 ('relation','public.static_weekly_approved_template_source_configs','release-only current configuration binding'),
 ('relation','public.static_weekly_approved_template_retirements','immutable pattern retirement'),
 ('relation','public.static_weekly_approved_initial_baselines','release-admitted independent static feasibility'),
 ('relation','public.static_weekly_approved_initial_confirmations','atomic current staff baseline receipt'),
 ('function','static_weekly_register_approved_initial_baseline(uuid,text,jsonb)','release-only initial snapshot admission'),
 ('function','static_weekly_read_approved_initial_basis(uuid,uuid,date,bigint,text)','named-manager current initial basis'),
 ('function','static_weekly_read_approved_initial_confirmation(uuid,text)','exact original initial receipt'),
 ('function','static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)','initial supersession/projection/lunch transaction'),
 
    ('function','public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)','original accepted native event lookup'),
    ('grant','public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)','server-only original event lookup ACL'),

    ('relation','public.static_weekly_sch022_staffing_witnesses','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('column_set','public.static_weekly_sch022_staffing_witnesses','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('relation_state','public.static_weekly_sch022_staffing_witnesses','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_work_witness(date,jsonb)','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('function','static_weekly_sch022_retained_member_referenced(uuid)','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('function','static_weekly_sch022_membership_identity_guard()','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('function','static_weekly_sch022_group_identity_guard()','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('trigger','public.location_group_memberships.trg_static_weekly_sch022_membership_identity_guard','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('trigger','public.location_groups.trg_static_weekly_sch022_group_identity_guard','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('function','static_weekly_sch022_preview_witness(date,jsonb,uuid)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_normalize_work(uuid,text,jsonb)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_publication_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_exception_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_occurrence_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_projection_work(jsonb)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_candidate_witness(jsonb)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_preview_staffing_witness(jsonb,uuid)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_staged_witness(uuid)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid,text)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('function','static_weekly_sch022_staffing_accept_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('trigger','public.weekly_schedule_publications.trg_static_weekly_sch022_publication_gate','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('trigger','public.weekly_schedule_exception_commands.trg_static_weekly_sch022_exception_gate','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('trigger','public.weekly_schedule_occurrences.trg_static_weekly_sch022_occurrence_gate','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('trigger','public.static_weekly_staffing_commands.trg_static_weekly_sch022_staffing_accept_gate','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('trigger','public.static_weekly_sch022_staffing_witnesses.trg_static_weekly_sch022_staffing_witness_immutable','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('constraint','public.employee_native_push_delivery_receipts:native_location_payload_binding','current source: 20261003194000_native_lunch_delivery.sql'),
    ('trigger','public.employee_native_lunch_dispatch_attempts.trg_native_lunch_dispatch_immutable','current source: 20261003194000_native_lunch_delivery.sql'),
    ('trigger','public.custodial_completion_taxonomy_versions.custodial_completion_taxonomy_immutable','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('trigger','public.completion_responses.custodial_completion_taxonomy_response_guard','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('relation','public.custodial_place_bridge_previews','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('relation','public.custodial_place_bridge_versions','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('relation','public.events_app_transition_receipts','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('relation','public.custodial_place_source_previews','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('relation','public.custodial_place_source_versions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('relation','public.custodial_place_source_admissions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('relation','public.employee_native_location_outcomes','current source: 20261003010000_native_location_lifecycle.sql'),
    ('relation','public.employee_native_location_inventory_scans','current source: 20261003010000_native_location_lifecycle.sql'),
    ('relation','public.custodial_place_operational_previews','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('relation','public.custodial_place_operational_commands','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('relation','public.custodial_place_operational_receipts','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('relation','public.employee_native_provider_events','current source: 20261003050000_native_provider_events.sql'),
    ('relation','public.employee_native_provider_event_requests','current source: 20261003050000_native_provider_events.sql'),
    ('relation','public.system_feedback_triage_receipts','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('relation','public.employee_native_location_dispatch_attempts','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('relation','public.employee_native_location_ack_projections','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('relation','public.custodial_completion_taxonomy_versions','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('relation','public.static_weekly_contractor_capacity_registrations','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('relation','public.static_weekly_capacity_source_previews','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('relation','public.static_weekly_capacity_source_commands','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('relation','public.static_weekly_capacity_source_receipts','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('relation','public.employee_native_lunch_dispatch_attempts','current source: 20261003194000_native_lunch_delivery.sql'),
    ('column_set','public.custodial_place_bridge_previews','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('column_set','public.custodial_place_bridge_versions','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('column_set','public.events_app_transition_receipts','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('column_set','public.custodial_place_source_previews','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('column_set','public.custodial_place_source_versions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('column_set','public.custodial_place_source_admissions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('column_set','public.employee_native_location_outcomes','current source: 20261003010000_native_location_lifecycle.sql'),
    ('column_set','public.employee_native_location_inventory_scans','current source: 20261003010000_native_location_lifecycle.sql'),
    ('column_set','public.custodial_place_operational_previews','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('column_set','public.custodial_place_operational_commands','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('column_set','public.custodial_place_operational_receipts','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('column_set','public.employee_native_provider_events','current source: 20261003050000_native_provider_events.sql'),
    ('column_set','public.employee_native_provider_event_requests','current source: 20261003050000_native_provider_events.sql'),
    ('column_set','public.system_feedback_triage_receipts','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('column_set','public.employee_native_location_dispatch_attempts','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('column_set','public.employee_native_location_ack_projections','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('column_set','public.custodial_completion_taxonomy_versions','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('column_set','public.static_weekly_contractor_capacity_registrations','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('column_set','public.static_weekly_capacity_source_previews','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('column_set','public.static_weekly_capacity_source_commands','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('column_set','public.static_weekly_capacity_source_receipts','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('column_set','public.employee_native_lunch_dispatch_attempts','current source: 20261003194000_native_lunch_delivery.sql'),
    ('relation_state','public.custodial_place_bridge_previews','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('relation_state','public.custodial_place_bridge_versions','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('relation_state','public.events_app_transition_receipts','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('relation_state','public.custodial_place_source_previews','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('relation_state','public.custodial_place_source_versions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('relation_state','public.custodial_place_source_admissions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('relation_state','public.employee_native_location_outcomes','current source: 20261003010000_native_location_lifecycle.sql'),
    ('relation_state','public.employee_native_location_inventory_scans','current source: 20261003010000_native_location_lifecycle.sql'),
    ('relation_state','public.custodial_place_operational_previews','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('relation_state','public.custodial_place_operational_commands','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('relation_state','public.custodial_place_operational_receipts','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('relation_state','public.employee_native_provider_events','current source: 20261003050000_native_provider_events.sql'),
    ('relation_state','public.employee_native_provider_event_requests','current source: 20261003050000_native_provider_events.sql'),
    ('relation_state','public.system_feedback_triage_receipts','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('relation_state','public.employee_native_location_dispatch_attempts','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('relation_state','public.employee_native_location_ack_projections','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('relation_state','public.custodial_completion_taxonomy_versions','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('relation_state','public.static_weekly_contractor_capacity_registrations','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('relation_state','public.static_weekly_capacity_source_previews','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('relation_state','public.static_weekly_capacity_source_commands','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('relation_state','public.static_weekly_capacity_source_receipts','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('relation_state','public.employee_native_lunch_dispatch_attempts','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','public.custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)','current source: 20261002130000_native_provider_clock_transport.sql'),
    ('function','app_event_supersession_guard()','current source: 20261002140000_event_supersession_and_chicago_instants.sql'),
    ('function','app_replace_event_authoritative(uuid,integer,jsonb,uuid)','current source: 20261002140000_event_supersession_and_chicago_instants.sql'),
    ('function','custodial_feedback_delivery_status(uuid[])','current source: 20261002150000_feedback_delivery_readback.sql'),
    ('function','place_bridge_source()','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('function','place_bridge_sha(jsonb)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('function','place_bridge_overlay(timestamp with time zone,jsonb)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('function','custodial_place_event_venue_overlay(timestamp with time zone)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('function','custodial_place_bridge_preview(uuid,text,uuid,text,uuid,timestamp with time zone,text)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('function','custodial_place_bridge_confirm(uuid,uuid,uuid)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('function','app_event_transition_receipt_immutable()','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('function','app_event_cancellation_transition_guard()','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('function','app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('function','custodial_native_location_canonical(jsonb)','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('function','custodial_native_location_receipt_guard()','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('function','custodial_native_location_reserve_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('function','custodial_native_location_reserve(uuid,uuid,jsonb)','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('function','place_source_row(text,uuid)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','place_source_dependencies()','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','place_source_manifest()','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','place_source_locks()','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','custodial_place_source_preview(uuid,text,uuid,text,jsonb,timestamp with time zone,text)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','place_source_apply(uuid,uuid,uuid,timestamp with time zone)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','custodial_place_source_confirm(uuid,uuid,uuid)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','custodial_place_source_overlay(timestamp with time zone)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('function','app_event_place_authority(jsonb,timestamp with time zone)','current source: 20261002210000_event_place_overlay_admission.sql'),
    ('function','app_event_place_admission_guard()','current source: 20261002210000_event_place_overlay_admission.sql'),
    ('function','mz_event_reminder_schedule(uuid,integer,uuid,text)','current source: 20261002210000_event_place_overlay_admission.sql'),
    ('function','feedback_email_relay_immutable()','current source: 20261002220000_feedback_relay_preflight_and_reconciliation.sql'),
    ('function','feedback_email_relay_command(text,text,jsonb)','current source: 20261002220000_feedback_relay_preflight_and_reconciliation.sql'),
    ('function','feedback_email_attachment_source_matches(uuid)','current source: 20261002230000_feedback_protected_attachment_admission.sql'),
    ('function','custodial_feedback_relay_attachment_internal(text,text,jsonb)','current source: 20261002230000_feedback_protected_attachment_admission.sql'),
    ('function','public.custodial_memphis_schedule_day(date)','current source: 20261003000000_memphis_current_schedule_day.sql'),
    ('function','custodial_native_location_utc(timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_live(uuid,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_target_at(uuid,uuid,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_target(uuid,uuid)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_append_only()','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_outcome(jsonb,jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_outcome_status(jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_tuple(jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_inventory_rows(uuid,text,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_inventory_at(uuid,text,uuid,text,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','custodial_native_location_inventory(uuid,text,uuid,text,jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('function','place_operational_preview_document(custodial_place_operational_previews)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','custodial_place_operational_preview(uuid,uuid,date,bigint,jsonb,text)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','custodial_place_operational_status(uuid,uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','custodial_place_operational_begin(uuid,uuid,uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','place_operational_assert_source_use(uuid,uuid,text,text)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','place_operational_assert_unchanged_draft(uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','custodial_place_operational_finalize(uuid,uuid,uuid,uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','place_operational_require_receipt()','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','place_operational_accepted_record(text,uuid,timestamp with time zone)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','place_operational_location_name(uuid,timestamp with time zone)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','place_operational_assert_accepted_names(uuid,date)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('function','custodial_native_provider_event_time(jsonb)','current source: 20261003050000_native_provider_events.sql'),
    ('function','custodial_native_provider_event_shape(jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('function','custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('function','custodial_native_provider_events(uuid,text,uuid,text,jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('function','mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('function','app_event_manager_digest_candidate(uuid,timestamp with time zone)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('function','app_event_manager_digest_is_current(jsonb,timestamp with time zone)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('function','ops_manager_notification_job_is_current(uuid,uuid,uuid,text)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('function','custodial_feedback_triage_version(text,timestamp with time zone)','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('function','custodial_feedback_triage_immutable()','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('function','custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('function','custodial_native_location_dispatch_status(uuid)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('function','custodial_native_location_dispatch_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('function','custodial_native_location_dispatch_prepare(uuid,uuid,jsonb)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('function','custodial_native_location_project_ack(uuid,timestamp with time zone)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('function','custodial_completion_taxonomy_immutable()','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('function','custodial_completion_assert_taxonomy(jsonb)','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('function','custodial_completion_taxonomy_response_guard()','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('function','custodial_completion_taxonomy_read(text)','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('function','custodial_manager_completion_evidence(uuid,text,text)','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('function','static_weekly_capacity_assert_shape(jsonb)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('function','static_weekly_capacity_registered(jsonb)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('function','static_weekly_capacity_accepted_slot(uuid,date,uuid)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('function','static_weekly_capacity_assert_projection_owner(jsonb,uuid,jsonb)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('function','static_weekly_capacity_assert_lunch_party(uuid,jsonb,text)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('function','custodial_native_provider_interval_observation(jsonb,boolean)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('function','custodial_native_provider_observation_order(jsonb,jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('function','custodial_native_provider_inventory_clock_at(uuid,text,uuid,text,jsonb,timestamp with time zone,timestamp with time zone)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('function','custodial_native_provider_inventory_clock(uuid,text,uuid,text,jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('function','custodial_native_target_source_at(text,uuid,uuid,uuid,timestamp with time zone)','current source: 20261003170000_native_target_source_projection.sql'),
    ('function','static_weekly_capacity_source_locks()','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_basis(uuid,uuid,date,bigint)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_legacy_reference(jsonb,text[])','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_candidate(jsonb,jsonb,date,uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_preview_document(static_weekly_capacity_source_previews)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_order_equivalent(jsonb,jsonb)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_preview(uuid,uuid,date,bigint,jsonb,text,jsonb)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_status(uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_begin(uuid,uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_assert_use(uuid,uuid,text,text)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_assert_unchanged_draft(uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_finalize(uuid,uuid,uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_require_receipt()','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','static_weekly_capacity_source_roster_visible(uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('function','public.static_weekly_coverall_event_brief_candidate(uuid,uuid,integer,uuid,date,uuid,bigint,text,text)','current source: 20261003193000_coverall_event_brief_private_reader.sql'),
    ('function','public.static_weekly_coverall_event_brief_candidates(uuid,uuid,date,uuid,bigint,text,text)','current source: 20261003193000_coverall_event_brief_private_reader.sql'),
    ('function','custodial_native_lunch_live(uuid,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_target_at(uuid,uuid,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_target(uuid,uuid)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_reserve(uuid,uuid,jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_dispatch_status(uuid)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_dispatch_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_dispatch_prepare(uuid,uuid,jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_outcome_at(jsonb,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_outcome(jsonb,jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('function','custodial_native_lunch_outcome_status(jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','public.static_weekly_sch022_staffing_witnesses','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_work_witness(date,jsonb)','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('grant','static_weekly_sch022_retained_member_referenced(uuid)','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('grant','static_weekly_sch022_membership_identity_guard()','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('grant','static_weekly_sch022_group_identity_guard()','current source: 20261003211000_static_weekly_splash_source_retention.sql'),
    ('grant','static_weekly_sch022_preview_witness(date,jsonb,uuid)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_normalize_work(uuid,text,jsonb)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_publication_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_exception_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_occurrence_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_projection_work(jsonb)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_candidate_witness(jsonb)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_preview_staffing_witness(jsonb,uuid)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_staged_witness(uuid)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid,text)','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','static_weekly_sch022_staffing_accept_gate()','current source: 20261003210000_static_weekly_splash_season_gate.sql'),
    ('grant','public.custodial_place_bridge_previews','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','public.custodial_place_bridge_versions','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','public.events_app_transition_receipts','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('grant','public.custodial_place_source_previews','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','public.custodial_place_source_versions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','public.custodial_place_source_admissions','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','public.employee_native_location_outcomes','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','public.employee_native_location_inventory_scans','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','public.custodial_place_operational_previews','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','public.custodial_place_operational_commands','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','public.custodial_place_operational_receipts','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','public.employee_native_provider_events','current source: 20261003050000_native_provider_events.sql'),
    ('grant','public.employee_native_provider_event_requests','current source: 20261003050000_native_provider_events.sql'),
    ('grant','public.system_feedback_triage_receipts','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('grant','public.employee_native_location_dispatch_attempts','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('grant','public.employee_native_location_ack_projections','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('grant','public.custodial_completion_taxonomy_versions','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('grant','public.static_weekly_contractor_capacity_registrations','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('grant','public.static_weekly_capacity_source_previews','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','public.static_weekly_capacity_source_commands','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','public.static_weekly_capacity_source_receipts','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','public.employee_native_lunch_dispatch_attempts','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','public.custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)','current source: 20261002130000_native_provider_clock_transport.sql'),
    ('grant','public.app_event_supersession_guard()','current source: 20261002140000_event_supersession_and_chicago_instants.sql'),
    ('grant','public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)','current source: 20261002140000_event_supersession_and_chicago_instants.sql'),
    ('grant','custodial_feedback_delivery_status(uuid[])','current source: 20261002150000_feedback_delivery_readback.sql'),
    ('grant','place_bridge_source()','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','place_bridge_sha(jsonb)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','place_bridge_overlay(timestamp with time zone,jsonb)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','custodial_place_event_venue_overlay(timestamp with time zone)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','custodial_place_bridge_preview(uuid,text,uuid,text,uuid,timestamp with time zone,text)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','custodial_place_bridge_confirm(uuid,uuid,uuid)','current source: 20261002160000_place_event_venue_bridge.sql'),
    ('grant','public.app_event_transition_receipt_immutable()','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('grant','public.app_event_cancellation_transition_guard()','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('grant','public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)','current source: 20261002170000_event_cancellation_cas_restore.sql'),
    ('grant','custodial_native_location_canonical(jsonb)','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('grant','custodial_native_location_receipt_guard()','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('grant','custodial_native_location_reserve_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('grant','custodial_native_location_reserve(uuid,uuid,jsonb)','current source: 20261002180000_native_provider_location_reservation.sql'),
    ('grant','place_source_row(text,uuid)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','place_source_dependencies()','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','place_source_manifest()','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','place_source_locks()','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','custodial_place_source_preview(uuid,text,uuid,text,jsonb,timestamp with time zone,text)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','place_source_apply(uuid,uuid,uuid,timestamp with time zone)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','custodial_place_source_confirm(uuid,uuid,uuid)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','custodial_place_source_overlay(timestamp with time zone)','current source: 20261002200000_place_operational_metadata_bridge.sql'),
    ('grant','public.app_event_place_authority(jsonb,timestamptz)','current source: 20261002210000_event_place_overlay_admission.sql'),
    ('grant','public.app_event_place_admission_guard()','current source: 20261002210000_event_place_overlay_admission.sql'),
    ('grant','public.mz_event_reminder_schedule(uuid,integer,uuid,text)','current source: 20261002210000_event_place_overlay_admission.sql'),
    ('grant','feedback_email_relay_immutable()','current source: 20261002220000_feedback_relay_preflight_and_reconciliation.sql'),
    ('grant','feedback_email_relay_command(text,text,jsonb)','current source: 20261002220000_feedback_relay_preflight_and_reconciliation.sql'),
    ('grant','feedback_email_attachment_source_matches(uuid)','current source: 20261002230000_feedback_protected_attachment_admission.sql'),
    ('grant','custodial_feedback_relay_attachment_internal(text,text,jsonb)','current source: 20261002230000_feedback_protected_attachment_admission.sql'),
    ('grant','public.custodial_memphis_schedule_day(date)','current source: 20261003000000_memphis_current_schedule_day.sql'),
    ('grant','custodial_native_location_utc(timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_live(uuid,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_target_at(uuid,uuid,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_target(uuid,uuid)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_append_only()','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_outcome(jsonb,jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_outcome_status(jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_tuple(jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_inventory_rows(uuid,text,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_inventory_at(uuid,text,uuid,text,jsonb,timestamp with time zone)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','custodial_native_location_inventory(uuid,text,uuid,text,jsonb)','current source: 20261003010000_native_location_lifecycle.sql'),
    ('grant','place_operational_preview_document(custodial_place_operational_previews)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','custodial_place_operational_preview(uuid,uuid,date,bigint,jsonb,text)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','custodial_place_operational_status(uuid,uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','custodial_place_operational_begin(uuid,uuid,uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','place_operational_assert_source_use(uuid,uuid,text,text)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','place_operational_assert_unchanged_draft(uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','custodial_place_operational_finalize(uuid,uuid,uuid,uuid)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','place_operational_require_receipt()','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','place_operational_accepted_record(text,uuid,timestamp with time zone)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','place_operational_location_name(uuid,timestamp with time zone)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','place_operational_assert_accepted_names(uuid,date)','current source: 20261003030000_place_operational_name_adoption.sql'),
    ('grant','custodial_native_provider_event_time(jsonb)','current source: 20261003050000_native_provider_events.sql'),
    ('grant','custodial_native_provider_event_shape(jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('grant','custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('grant','custodial_native_provider_events(uuid,text,uuid,text,jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('grant','public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('grant','public.app_event_manager_digest_candidate(uuid,timestamptz)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('grant','public.app_event_manager_digest_is_current(jsonb,timestamptz)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('grant','ops_manager_notification_job_is_current(uuid,uuid,uuid,text)','current source: 20261003060000_event_notification_current_projection.sql'),
    ('grant','custodial_feedback_triage_version(text,timestamp with time zone)','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('grant','custodial_feedback_triage_immutable()','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('grant','custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)','current source: 20261003070000_feedback_triage_receipts.sql'),
    ('grant','custodial_native_location_dispatch_status(uuid)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('grant','custodial_native_location_dispatch_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('grant','custodial_native_location_dispatch_prepare(uuid,uuid,jsonb)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('grant','custodial_native_location_project_ack(uuid,timestamp with time zone)','current source: 20261003080000_native_location_dispatch_and_ack.sql'),
    ('grant','custodial_completion_taxonomy_immutable()','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('grant','custodial_completion_assert_taxonomy(jsonb)','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('grant','custodial_completion_taxonomy_response_guard()','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('grant','custodial_completion_taxonomy_read(text)','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('grant','custodial_manager_completion_evidence(uuid,text,text)','current source: 20261003120000_completion_taxonomy_evidence.sql'),
    ('grant','static_weekly_capacity_assert_shape(jsonb)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('grant','static_weekly_capacity_registered(jsonb)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('grant','static_weekly_capacity_accepted_slot(uuid,date,uuid)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('grant','static_weekly_capacity_assert_projection_owner(jsonb,uuid,jsonb)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('grant','static_weekly_capacity_assert_lunch_party(uuid,jsonb,text)','current source: 20261003140000_static_weekly_nonemployee_contractor_capacity.sql'),
    ('grant','custodial_native_provider_interval_observation(jsonb,boolean)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('grant','custodial_native_provider_observation_order(jsonb,jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('grant','custodial_native_provider_inventory_clock_at(uuid,text,uuid,text,jsonb,timestamp with time zone,timestamp with time zone)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('grant','custodial_native_provider_inventory_clock(uuid,text,uuid,text,jsonb)','current source: 20261003150000_native_provider_interval_protocol.sql'),
    ('grant','public.custodial_native_target_source_at(text,uuid,uuid,uuid,timestamptz)','current source: 20261003170000_native_target_source_projection.sql'),
    ('grant','public.custodial_native_target_source(text,uuid,uuid,uuid)','current source: 20261003170000_native_target_source_projection.sql'),
    ('grant','static_weekly_capacity_source_locks()','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_basis(uuid,uuid,date,bigint)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_legacy_reference(jsonb,text[])','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_candidate(jsonb,jsonb,date,uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_preview_document(static_weekly_capacity_source_previews)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_order_equivalent(jsonb,jsonb)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_preview(uuid,uuid,date,bigint,jsonb,text,jsonb)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_status(uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_begin(uuid,uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_assert_use(uuid,uuid,text,text)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_assert_unchanged_draft(uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_finalize(uuid,uuid,uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_require_receipt()','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','static_weekly_capacity_source_roster_visible(uuid,uuid)','current source: 20261003190000_static_weekly_capacity_current_source_bridge.sql'),
    ('grant','public.static_weekly_coverall_event_brief_candidate(uuid,uuid,integer,uuid,date,uuid,bigint,text,text)','current source: 20261003193000_coverall_event_brief_private_reader.sql'),
    ('grant','public.static_weekly_coverall_event_brief_candidates(uuid,uuid,date,uuid,bigint,text,text)','current source: 20261003193000_coverall_event_brief_private_reader.sql'),
    ('grant','custodial_native_lunch_live(uuid,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_target_at(uuid,uuid,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_target(uuid,uuid)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_reserve_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_reserve(uuid,uuid,jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_dispatch_status(uuid)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_dispatch_prepare_at(uuid,uuid,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_dispatch_prepare(uuid,uuid,jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_outcome_at(jsonb,jsonb,timestamp with time zone)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_outcome(jsonb,jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),
    ('grant','custodial_native_lunch_outcome_status(jsonb)','current source: 20261003194000_native_lunch_delivery.sql'),

    ('function','custodial_native_target_source(text,uuid,uuid,uuid)','private read-only native source/recipient projection'),
('function','public.custodial_v13_read_separation_context(uuid,uuid)','purpose-only original separation context'),
    ('function','operational_day_start(timestamp with time zone)','dashboard operational-day read dependency'),
    ('function','get_setting_int(text,integer)','dashboard integer-setting read dependency'),
('function','public.static_weekly_v25_read_current_recurring_delivery(date,uuid)','named manager current exact recurring phone readback'),
('function','public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)','authenticated schedule delivery and exact device receipt'),
('function','public.static_weekly_v24_read_device_schedule_delivery(date,uuid,uuid,uuid,bigint)','authenticated schedule delivery and exact device receipt'),
('function','public.static_weekly_v23_finalize_recurring_confirmation(uuid,uuid)','exact recurring schedule atomic acceptances'),
('relation','public.static_weekly_recurring_acceptance_proofs','exact recurring schedule atomic acceptances'),
('trigger','public.static_weekly_recurring_acceptance_proofs.trg_recurring_acceptance_immutable','exact recurring schedule atomic acceptances'),
('function','public.static_weekly_v22_ack_recurring_application_target(uuid,uuid,uuid,uuid,bigint,bigint,text,text,timestamp with time zone)','exact recurring schedule application targets'),
('function','public.static_weekly_v22_read_recurring_application_target(date,uuid,uuid,uuid,bigint)','exact recurring schedule application targets'),
('function','public.static_weekly_v22_reconcile_recurring_application_date(date)','exact recurring schedule application targets'),
('function','public.static_weekly_v22_recurring_render_view(uuid,date,uuid)','exact recurring schedule application targets'),
('relation','public.static_weekly_recurring_application_intents','exact recurring schedule application targets'),
('relation','public.static_weekly_recurring_application_receipts','exact recurring schedule application targets'),
('trigger','public.static_weekly_recurring_application_intents.trg_recurring_application_immutable','exact recurring schedule application targets'),
('trigger','public.static_weekly_recurring_application_receipts.trg_recurring_application_immutable','exact recurring schedule application targets'),
('function','public.static_weekly_v21_first_changed_dependency_date(uuid,date)','atomic recurring dependency reconciliation'),
('function','public.static_weekly_v21_reconcile_dependency_changes(uuid)','atomic recurring dependency reconciliation'),
('function','public.static_weekly_v21_require_reconciled_dependency_change()','atomic recurring dependency reconciliation'),
('function','public.static_weekly_v21_track_dependency_change(text,text,jsonb,jsonb)','atomic recurring dependency reconciliation'),
('relation','public.static_weekly_recurring_dependency_changes','atomic recurring dependency reconciliation'),
('relation','public.static_weekly_recurring_dependency_checks','atomic recurring dependency reconciliation'),
('trigger','public.static_weekly_recurring_dependency_changes.trg_recurring_dependency_complete','atomic recurring dependency reconciliation'),
('trigger','public.static_weekly_recurring_dependency_changes.trg_recurring_dependency_immutable','atomic recurring dependency reconciliation'),
('trigger','public.static_weekly_recurring_dependency_checks.trg_recurring_dependency_immutable','atomic recurring dependency reconciliation'),

 ('function','public.static_weekly_v20_assert_usable_recurring_week(uuid,date)','terminal recurring authority enforcement'),
 ('function','public.static_weekly_v20_read_recurring_preview_basis(uuid,date)','explicit prior pattern repair basis with current roster'),
 
('function','public.static_weekly_v19_ack_terminal_target(uuid,uuid,uuid,uuid,bigint,bigint,text,timestamp with time zone)','recurring terminal range and phone targets'),
('function','public.static_weekly_v19_assert_terminal_principal(uuid,uuid,uuid,bigint)','recurring terminal range and phone targets'),
('function','public.static_weekly_v19_current_terminal_range(date)','recurring terminal range and phone targets'),
('function','public.static_weekly_v19_invalidate_recurring_range(uuid,uuid,uuid,date,date,text,text,bigint)','recurring terminal range and phone targets'),
('function','public.static_weekly_v19_read_terminal_target(date,uuid,uuid,uuid,bigint)','recurring terminal range and phone targets'),
('function','public.static_weekly_v19_reconcile_terminal_date(date)','recurring terminal range and phone targets'),
('relation','public.static_weekly_recurring_invalidated_principals','recurring terminal range and phone targets'),
('relation','public.static_weekly_recurring_invalidations','recurring terminal range and phone targets'),
('relation','public.static_weekly_recurring_terminal_intents','recurring terminal range and phone targets'),
('relation','public.static_weekly_recurring_terminal_receipts','recurring terminal range and phone targets'),
('trigger','public.static_weekly_recurring_invalidated_principals.trg_recurring_terminal_immutable','recurring terminal range and phone targets'),
('trigger','public.static_weekly_recurring_invalidations.trg_recurring_terminal_immutable','recurring terminal range and phone targets'),
('trigger','public.static_weekly_recurring_terminal_intents.trg_recurring_terminal_immutable','recurring terminal range and phone targets'),
('trigger','public.static_weekly_recurring_terminal_receipts.trg_recurring_terminal_immutable','recurring terminal range and phone targets'),

 ('relation','public.static_weekly_recurring_publication_bindings','recurring decision and roster publication binding'),
 ('function','public.static_weekly_v18_canonical_display_assignment(jsonb)','recurring canonical displayed assignment boundary'),
 ('function','public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb)','recurring decision and roster publication binding'),
 ('trigger','public.static_weekly_recurring_publication_bindings.trg_recurring_publication_binding_immutable','recurring decision and roster publication binding'),
 
('function','public.static_weekly_v17_recurring_dependency_snapshot(uuid,date)','internal recurring dependency snapshot'),
('function','public.static_weekly_v16_assert_future_same_monday(uuid,uuid,uuid,text,text,uuid)','future same-Monday parent-only authority'),

 ('relation','public.static_weekly_recurring_generation','recurring semantic generation and serialization'),
 ('function','public.static_weekly_v15_lock_recurring_mutation()','recurring semantic generation and serialization'),
 ('function','public.static_weekly_v15_advance_recurring_generation()','recurring semantic generation and serialization'),
 ('function','public.static_weekly_v15_read_recurring_generation()','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slots.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slots.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbencies.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbencies.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbency_closures.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbency_closures.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_staffing_states.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_staffing_states.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.employees.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.employees.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.static_weekly_authority_source_documents.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.static_weekly_authority_source_documents.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_schedule_publications.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_schedule_publications.trg_recurring_authority_generation','recurring semantic generation and serialization'),


 ('relation','public.static_weekly_recurring_source_bindings','parent-transaction recurring source admission'),
 ('function','public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text)','parent-transaction recurring source admission'),
 ('function','public.static_weekly_v14_assert_recurring_source_use(uuid,uuid,date,text,text)','parent-transaction recurring source admission'),
 ('trigger','public.static_weekly_recurring_source_bindings.trg_recurring_source_binding_immutable','parent-transaction recurring source admission'),


 ('relation','public.static_weekly_recurring_confirmations','atomic recurring confirmation parent receipt boundary'),
 ('relation','public.static_weekly_recurring_confirmation_receipts','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_require_completed_recurring_confirmation()','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_guard_recurring_receipt()','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid)','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmations.trg_recurring_confirmation_immutable','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmations.trg_recurring_confirmation_complete','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmation_receipts.trg_recurring_confirmation_receipt_immutable','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmation_receipts.trg_recurring_confirmation_receipt_binding','atomic recurring confirmation parent receipt boundary'),


 ('relation','public.custodial_employee_separation_fences','private protected-work separation and original-principal fence'),
 ('function','public.custodial_v12_reject_post_separation_start()','new Start persistence fence'),
 ('function','public.custodial_v12_guard_protected_device()','old phone ownership fence'),
 ('function','public.custodial_v12_guard_protected_credential()','old credential ownership fence'),
 ('function','public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)','status transition preserving old phone work'),
 ('function','public.custodial_v12_read_separation(uuid,uuid)','manager-only honest pending separation readback'),
 ('trigger','public.sessions.trg_custodial_v12_session_separation_fence','new online Start fence'),
 ('trigger','public.custodial_offline_actor_contexts.trg_custodial_v12_offline_separation_fence','new offline Start fence'),
 ('trigger','public.devices.trg_custodial_v12_guard_protected_device','pending old-phone preservation'),
 ('trigger','public.device_auth_credentials.trg_custodial_v12_guard_protected_credential','pending credential preservation'),
 ('trigger','public.custodial_employee_separation_fences.trg_custodial_employee_separation_fences_immutable','immutable pending separation evidence'),

 ('function','static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','atomic staffing acceptance'),
 ('function','static_weekly_v11_read_current_refresh_targets(date,date,uuid)','current normal and lunch refresh ownership'),
 ('function','static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','private exact staged projection binding'),
('function','static_weekly_v10_ack_device_schedule_application(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,timestamp with time zone)','staffing command authority'),
('function','static_weekly_v10_begin_staffing_command(jsonb,uuid,bigint,uuid)','staffing command authority'),
('function','static_weekly_v10_cancel_staffing_preparation(uuid,uuid)','staffing command authority'),
('function','static_weekly_v10_list_pending_staffing_commands(uuid,integer,timestamp with time zone,uuid)','staffing command authority'),
('function','static_weekly_v10_read_device_schedule_application(date,uuid,uuid,uuid,bigint)','staffing command authority'),
('function','static_weekly_v10_read_staffing_command(uuid,uuid)','staffing command authority'),
('function','static_weekly_v10_read_staffing_delivery_status(uuid,uuid)','staffing command authority'),
('function','static_weekly_v10_staffing_guard()','staffing command authority'),
('function','static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','staffing command authority'),

 ('relation','public.static_weekly_staffing_commands','private staffing command ledger'),
 ('relation','public.static_weekly_staffing_command_receipts','append-only staffing command receipts'),
 ('relation','public.static_weekly_staffing_staged_candidates','non-authoritative staffing candidate staging'),
 ('relation','public.static_weekly_staffing_absences','accepted person-bound absences'),
 ('relation','public.static_weekly_staffing_absence_cancellations','append-only absence cancellation lineage'),
 ('relation','public.static_weekly_schedule_application_intents','assignment-bound schedule application intents'),
 ('relation','public.static_weekly_schedule_application_receipts','device-reported schedule application evidence'),
 ('trigger','public.static_weekly_staffing_commands.trg_static_weekly_staffing_guard','typed command transitions'),
 ('trigger','public.static_weekly_staffing_command_receipts.trg_static_weekly_staffing_receipt_immutable','immutable command receipts'),
 ('trigger','public.static_weekly_staffing_staged_candidates.trg_static_weekly_staffing_stage_immutable','immutable staging'),
 ('trigger','public.static_weekly_staffing_absences.trg_static_weekly_staffing_absence_immutable','immutable absences'),
 ('trigger','public.static_weekly_staffing_absence_cancellations.trg_static_weekly_staffing_cancel_immutable','immutable cancellations'),
 ('trigger','public.static_weekly_schedule_application_intents.trg_static_weekly_schedule_intent_immutable','immutable application intents'),
 ('trigger','public.static_weekly_schedule_application_receipts.trg_static_weekly_schedule_receipt_immutable','immutable application receipts'),

('function','public.custodial_oc24_legacy_replay_allowed(text,text,text,text,text,text,text,jsonb,jsonb,text)','Exact immutable legacy replay only'),
  
('function','public.custodial_oc24_service_trim(text)','Exact JavaScript service whitespace'),
  ('function','public.custodial_oc24_assert_completion_selection(jsonb)','Shared completion selection precheck and trigger'),
  
('function','custodial_native_provider_app_valid(jsonb)','native provider generation authority'),
('function','custodial_native_provider_generation_guard()','native provider generation authority'),
('function','custodial_native_provider_generation_json(employee_native_push_generations,boolean)','native provider generation authority'),
('function','custodial_native_provider_registration(uuid,text,uuid,text,jsonb,boolean)','native provider generation authority'),
('function','custodial_native_provider_registration_changed()','native provider generation authority'),
('relation','public.employee_native_push_generations','private provider generations'),
 ('trigger','public.employee_native_push_generations.trg_native_provider_generation_guard','immutable provider binding'),
 ('trigger','public.employee_native_push_generations.custodial_disaster_restore_mutation_fence','provider restore fence'),
 ('trigger','public.employee_push_registrations.trg_native_provider_registration_changed','legacy provider invalidation'),
 
('function','public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)','OC24 actual dated contractor lunch'),
 
('function','public.custodial_oc24_completion_selection_guard()','OC24 truthful completion selection'),
  ('function','public.custodial_oc24_inspection_recording_retired()','OC24 no new inspection records'),
  ('trigger','public.completion_responses.trg_oc24_completion_selection','OC24 persisted full or selective selection'),
  ('trigger','public.cleaning_inspections.aaa_oc24_inspection_recording_retired','OC24 historical inspection preservation'),
  
('function','custodial_legacy_activation_bind(uuid,uuid,uuid,text,text,uuid,text)','current legacy installation observation'),
('function','custodial_legacy_activation_binding_json(custodial_activation_legacy_lineage_bindings)','current legacy installation observation'),
('function','custodial_legacy_activation_context(uuid,uuid,uuid,text)','current legacy installation observation'),
('function','custodial_legacy_activation_guard()','current legacy installation observation'),
('function','custodial_legacy_activation_result(uuid,uuid,uuid,text,jsonb)','current legacy installation observation'),
('relation','public.custodial_activation_legacy_lineage_bindings','private legacy installation binding'),
('trigger','public.custodial_activation_legacy_lineage_bindings.trg_custodial_legacy_activation_guard','immutable current legacy observation'),
('trigger','public.custodial_activation_legacy_lineage_bindings.custodial_disaster_restore_mutation_fence','pause activation writes during disaster restore'),
('function','custodial_activation_assert_consume(uuid,uuid,text)','assigned phone operation authority'),
('function','custodial_activation_assert_manager(uuid,uuid,text)','assigned phone operation authority'),
('function','custodial_activation_assignment_changed()','assigned phone operation authority'),
('function','custodial_activation_claim(uuid,uuid,uuid,text,text,text,text,jsonb)','assigned phone operation authority'),
('function','custodial_activation_delivery(uuid,uuid,uuid,text,integer,text,text)','assigned phone operation authority'),
('function','custodial_activation_expire_device(uuid)','assigned phone operation authority'),
('function','custodial_activation_expire_pending(integer)','assigned phone operation authority'),
('function','custodial_activation_guard_row()','assigned phone operation authority'),
('function','custodial_activation_list(uuid,uuid)','assigned phone operation authority'),
('function','custodial_activation_native_result(uuid,uuid,uuid,text,jsonb)','assigned phone operation authority'),
('function','custodial_activation_public_status(custodial_assigned_activation_operations)','assigned phone operation authority'),
('function','custodial_activation_read(uuid,uuid,uuid)','assigned phone operation authority'),
('function','custodial_activation_request(uuid,text,uuid,bigint,uuid,uuid,text)','assigned phone operation authority'),
('relation','public.custodial_assigned_activation_operations','private activation operation ledger'),
('trigger','public.devices.trg_custodial_activation_assignment_changed','cancel stale assignment activation'),
('trigger','public.custodial_assigned_activation_operations.trg_custodial_activation_guard_row','immutable activation recipient and terminal receipt'),
('trigger','public.custodial_assigned_activation_operations.custodial_disaster_restore_mutation_fence','pause activation writes during disaster restore'),
    ('function','custodial_dr.guard_release_selection()','database-derived ordinary release selection'),
    ('function','custodial_dr.require_single_release_on_resume()','paused recovery single-selector admission'),
    ('column','public.release_deployment_manifest:recovery_staged','database-derived staging marker'),
    ('column_set','public.release_deployment_manifest','release ledger schema'),
    ('index','public.release_deployment_manifest_one_ordinary_deployed','concurrent deployed selector uniqueness'),
    ('trigger','public.release_deployment_manifest.trg_release_selection_guard','restore-mode staging guard'),
    ('trigger','custodial_dr.restore_control.trg_require_single_release_on_resume','resume cannot retain ambiguous selection'),
    ('function','ack_native_device_notification(text,uuid,bigint,uuid,uuid,text,text,text)','assignment-bound native notification lifecycle'),
    ('function','mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)','accepted lunch start/end push producer'),
    ('function','static_weekly_v8_read_lunch_segments(date)','current lunch responsibility consumer'),
    ('function','custodial_operational_location_assignments(date)','current physical responsibility and lunch handoff'),
    ('function','static_weekly_v5_read_employee_day(date,uuid,timestamp with time zone)','employee published lunch display'),
    ('relation','public.weekly_schedule_lunch_documents','accepted temporary lunch coverage'),
    ('function','static_weekly_v8_assert_lunch_document(uuid,jsonb)','lunch exact projection validation'),
    ('function','static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)','atomic lunch persistence'),
    ('function','static_weekly_v8_read_lunch_document(date)','current projection lunch reader'),
    ('relation','public.devices','phone identity and assignment'),
    ('relation','public.locations','scan location authority'),
    ('relation','public.device_auth_credentials','native credential authority'),
    ('relation','public.device_sync_status','phone queue and release readiness'),
    ('relation','public.device_location_proximity_status','current accepted proximity'),
    ('relation','public.sessions','canonical cleaning session truth'),
    ('relation','public.completion_responses','canonical completion response truth'),
    ('relation','public.scan_events','accepted scan event truth'),
    ('relation','public.maintenance_tickets','completion-derived maintenance truth'),
    ('relation','public.custodial_offline_actor_contexts','frozen offline actor and native evidence'),
    ('relation','public.custodial_offline_submission_proofs','offline submission proof state'),
    ('relation','public.custodial_offline_reconciliation_records','offline reconciliation decision'),
    ('relation','public.custodial_offline_scan_event_evidence','immutable scan evidence binding'),
    ('relation','public.custodial_release_canary_controls','exact canary pause state'),
    ('relation','public.custodial_release_canary_transport_probes','native canary transport proof'),
    ('relation','public.custodial_release_canary_recovery_probes','database canary recovery proof'),
    ('relation','public.events_app_events','canonical event mutation truth'),
    ('relation','public.events_app_event_history','event actor history'),
    ('relation','public.event_push_instances','event push occurrence authority'),
    ('relation','public.employee_push_registrations','employee push recipient authority'),
    ('relation','public.employee_native_push_delivery_receipts','employee push delivery truth'),
    ('relation','public.operational_notification_jobs','durable operational notification jobs'),
    ('relation','public.ops_manager_notification_queue','manager notification jobs'),
    ('relation','public.ops_manager_push_devices','manager push recipient authority'),
    ('relation','public.device_notification_acknowledgements','phone notification acceptance'),
    ('function','tool_get_offline_scan_authority_snapshot(text,text,text)','offline snapshot boundary'),
    ('function','tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)','native offline start boundary'),
    ('function','tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','native completion boundary'),
    ('function','tool_complete_session_authoritative(text,jsonb,text,text,text,text)','online completion boundary'),
    ('function','custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)','maintenance terminal boundary'),
    ('function','custodial_finish_historical_session_authoritative(text,text,uuid,timestamp with time zone,text)','historical exact-finish adapter'),
    ('function','custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,uuid,text,text,text)','native canary transport recorder'),
    ('function','custodial_get_release_canary_transport_probe_health(text,text,text,text)','native canary transport health'),
    ('function','custodial_run_release_canary_recovery_probe(text,text)','persisted recovery probe'),
    ('function','custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)','release canary controller'),
    ('function','custodial_backend_authority_health(text)','database authority health'),
    ('function','app_apply_event_command(text,uuid,jsonb,text,text)','bounded event mutation authority'),
    ('function','custodial_assign_employee_device(text,uuid,uuid,text,boolean,boolean,uuid)','serialized manager assignment CAS'),
    ('function','mz_register_employee_push(uuid,text,text,text,text,text)','employee push registration authority'),
    ('function','mz_enqueue_employee_event_pushes(timestamp with time zone)','event push enqueue authority'),
    ('function','mz_enqueue_employee_location_pushes(timestamp with time zone)','location push enqueue authority'),
    ('function','mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)','employee push dispatch preparation'),
    ('function','mz_record_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,text,timestamp with time zone)','employee push dispatch completion'),
    ('function','ops_manager_prepare_notification_dispatch(uuid,uuid,uuid,text)','manager push dispatch preparation'),
    ('function','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','manager push dispatch completion'),
    ('view','public.v_location_status','phone scan-state operational truth'),
    ('view','public.v_location_dashboard_status','manager location operational truth'),
    ('view','public.v_restroom_check_timers','restroom timer operational truth'),
    ('view','public.v_admin_health_snapshot','admin operational health truth'),
    ('view','public.v_exception_queue','manager exception operational truth'),
    ('view','public.v_restroom_package_status','restroom timer dependent projection');
$function$
;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $rebind$ DECLARE obj record;changed integer;BEGIN
 FOR obj IN SELECT * FROM timing_preimages LOOP
  UPDATE public.custodial_release_authority_restore_inventory SET
   definition_sql=pg_get_functiondef(obj.identity::regprocedure),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(obj.identity::regprocedure)),captured_at=statement_timestamp()
   WHERE object_kind='function' AND to_regprocedure(object_identity)=obj.identity::regprocedure;
  GET DIAGNOSTICS changed=row_count;
  IF changed<>1 THEN RAISE EXCEPTION 'Best effort recovery identity differs %',obj.identity;END IF;
 END LOOP;
 INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 SELECT (SELECT min(n) FROM generate_series(bucket+1,bucket+99998)n WHERE NOT EXISTS(
  SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.restore_order=n)),kind,
  'custodial_native_schedule_accepted_releases()',definition,public.static_weekly_digest_text(definition)
 FROM (SELECT 100000 bucket,'function' kind,pg_get_functiondef('public.custodial_native_schedule_accepted_releases()'::regprocedure) definition
  UNION ALL SELECT 900000,'grant',public.custodial_release_authority_current_grant_definition('custodial_native_schedule_accepted_releases()')) x;
END $rebind$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
COMMIT;
