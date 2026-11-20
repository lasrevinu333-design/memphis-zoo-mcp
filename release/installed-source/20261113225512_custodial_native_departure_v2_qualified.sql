-- Prepared successor only. No live database was changed to create this file.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE departure_inventory_before ON COMMIT DROP AS TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE departure_canary_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_canary_authority_surface();
CREATE TEMP TABLE departure_functions_before ON COMMIT DROP AS
 SELECT p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid) definition_sql FROM pg_proc p WHERE p.oid IN(
'custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)'::regprocedure,'custodial_native_schedule_preparation_source(uuid,uuid,uuid)'::regprocedure,'custodial_native_schedule_content_source(uuid,uuid,uuid)'::regprocedure,'custodial_native_schedule_source_status(uuid,uuid,uuid)'::regprocedure,'custodial_native_schedule_job_prepare(uuid,jsonb,uuid)'::regprocedure,'custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)'::regprocedure,'custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)'::regprocedure,'custodial_native_schedule_target(uuid,uuid)'::regprocedure,'custodial_native_schedule_outcome(jsonb,jsonb)'::regprocedure,'custodial_native_schedule_observation_originals(uuid,text,jsonb)'::regprocedure,'custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,'custodial_native_schedule_content_source_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,'custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone,timestamp with time zone,text)'::regprocedure,'custodial_native_schedule_live(uuid,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_schedule_original_record_id(uuid,uuid,text)'::regprocedure,'custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)'::regprocedure,'public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'::regprocedure,'custodial_release_canary_authority_surface()'::regprocedure);
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)'::regprocedure)) IS DISTINCT FROM '15ac1df45768f60fc1c5f29a26501cec698d56d35f33dcf193795bf42ebd6d29' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_preparation_source(uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM '37cfd199d92ef3ccdcc6ef9690e5951802d64d906f00a5775337f6d16e82079f' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_preparation_source(uuid,uuid,uuid)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_content_source(uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM '9fdd914ff616e3545090274418749fe6538254bd0a01b5cc6a6d0276eb0c2e97' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_content_source(uuid,uuid,uuid)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_source_status(uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM '5928f3ca893754b3f555385c5a396cb56a22831302d9217628597712334425b2' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_source_status(uuid,uuid,uuid)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_job_prepare(uuid,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM '3468d9d29dfc37d3dba2ec8175ba61db30a830ba2c57ccf8753a12ea982e24d0' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_job_prepare(uuid,jsonb,uuid)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)'::regprocedure)) IS DISTINCT FROM 'a853b0e5b1c286250003d56c6af8448c853d236fb8899365424d38433017eb63' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)'::regprocedure)) IS DISTINCT FROM 'f8e68f482176ac5b3b0ee5c0cd34e29591be323cc7770457d6e018a6329cc036' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_target(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '819b03d92f25ef117dbe3d07e74f228a5e39de401affe7073637efa4491f95fc' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_target(uuid,uuid)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_outcome(jsonb,jsonb)'::regprocedure)) IS DISTINCT FROM '491d31eeb2852066f39c8993a880a11fb679d193c875b6e5064e722d16741bee' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_outcome(jsonb,jsonb)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_observation_originals(uuid,text,jsonb)'::regprocedure)) IS DISTINCT FROM 'f16a3959520479807f84f6c5600b34a085339fe04c24da316e2ccd351d2e1b49' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_observation_originals(uuid,text,jsonb)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '401def6bfc4b4803a7756b09f95402d1572772d0cf134f1071b8157261400857' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamp with time zone)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_content_source_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '2520890cbb50e2044e0687b2edde0a3e84806366f20c36e38c91fe1fc2af3914' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_content_source_at(uuid,uuid,uuid,timestamp with time zone)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '73fcd0b4304e57875bd36938f8602ce8460a2f01dd40e13fc301afce4fbc9b99' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamp with time zone)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone,timestamp with time zone,text)'::regprocedure)) IS DISTINCT FROM 'fafb0244e279dbbed2577f62ca0476e1e61cea606e255cb1b6c4e90f341ed3e4' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone,timestamp with time zone,text)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_live(uuid,jsonb,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '4189d270a6d48e4818e97c1bdff3a15607feac03e8fa250ccce194dc5c819081' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_live(uuid,jsonb,timestamp with time zone)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '16d4a5abd8a10464d1913ff553e94fa923cdb8a6211de056cdebb7fdc76a8c88' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamp with time zone)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_schedule_original_record_id(uuid,uuid,text)'::regprocedure)) IS DISTINCT FROM '9740ec305b95c6603a82f56f4faee11523332f0bc8f658cbad045393b6f6d967' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_schedule_original_record_id(uuid,uuid,text)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '4f4ca09f92b0b5142b10550c506ccd535a57533b5bad7128f67e31b6925dcd3d' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '1726a7874b51279d91ec4c2bb0983e9b3490d48a21169734b17a2f0cc5ccf461' THEN RAISE EXCEPTION 'Departure predecessor differs: %','custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)';END IF;END $preimage$;
DO $preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'::regprocedure)) IS DISTINCT FROM '497b5be4f212d5c441f0b23f061f9f51700e03828037bd360e9c5c3343c77566' THEN RAISE EXCEPTION 'Departure predecessor differs: %','public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)';END IF;END $preimage$;
DO $canary_preimage$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_release_canary_authority_surface()'::regprocedure)) NOT IN ('a60ddcc37b6affa49becbb5adb76a96a9bcd2dc25b6c7fec6085311346042224','55fe3e609c8a145f946602c6fbf16df4aa1eab410f50e048b778e7f4bfe72b33') THEN RAISE EXCEPTION 'Departure exact canary predecessor differs';END IF;END $canary_preimage$;
DO $inventory$ BEGIN
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Departure requires ALWAYS inventory guard';END IF;
 IF (SELECT count(*) FROM departure_inventory_before i JOIN departure_functions_before f
  ON CASE WHEN i.object_kind='function' THEN to_regprocedure(i.object_identity)=f.oid ELSE false END
  WHERE i.definition_sql=f.definition_sql AND i.definition_sha256=public.static_weekly_digest_text(f.definition_sql))
  <>(SELECT count(*) FROM departure_functions_before) THEN RAISE EXCEPTION 'Departure exact recovery predecessors differ';END IF;
 IF NOT EXISTS(SELECT 1 FROM departure_inventory_before WHERE object_kind='constraint' AND object_identity='public.employee_native_schedule_source_reservations:employee_native_schedule_source_reservations_check' AND definition_sha256='7b79e206afb236e6544a8e9d4175944c90f4b42377e205a42e3212e24f11ddd6' AND definition_sql='select public.custodial_release_authority_restore_constraint(''public.employee_native_schedule_source_reservations'',''employee_native_schedule_source_reservations_check'',''CHECK ((isfinite(reserved_at) AND isfinite(valid_from) AND isfinite(valid_until) AND valid_from <= reserved_at AND reserved_at < valid_until AND logical_key = ((((''''schedule-ownership:''''::text || service_date::text) || '''':''''::text) || employee_id::text) || '''':09:45''''::text) AND (source_window ->> ''''schema''''::text) = ''''custodial.native-schedule-server-window.v1''''::text AND (source_window ->> ''''logical_key''''::text) = logical_key AND (source_window ->> ''''service_date''''::text) = service_date::text AND (source_window ->> ''''employee_id''''::text) = employee_id::text AND (source_window ->> ''''generation_id''''::text) = generation_id::text AND (source_window ->> ''''assignment_occurrence_id''''::text) = source_key::text AND (source_window ->> ''''server_source_sha256''''::text) = source_sha256 AND (source_window ->> ''''valid_from''''::text) = custodial_native_location_utc(valid_from) AND (source_window ->> ''''valid_until''''::text) = custodial_native_location_utc(valid_until) AND (source_window ->> ''''server_now''''::text) = custodial_native_location_utc(reserved_at) AND jsonb_typeof(source_window -> ''''before_units''''::text) = ''''array''''::text AND jsonb_typeof(source_window -> ''''after_units''''::text) = ''''array''''::text AND (source_window -> ''''before_units''''::text) IS DISTINCT FROM (source_window -> ''''after_units''''::text) AND source_window_sha256 = static_weekly_digest_jsonb(source_window) AND octet_length(source_window::text) <= 2097152) IS TRUE)'');') THEN RAISE EXCEPTION 'Departure reservation constraint recovery differs';END IF;
END $inventory$;
DO $absent$ BEGIN IF to_regprocedure('public.custodial_native_departure_window_source_at(uuid,uuid,uuid,timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'Departure new function already exists';END IF;END $absent$;
DO $absent$ BEGIN IF to_regprocedure('public.custodial_native_departure_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'Departure new function already exists';END IF;END $absent$;
DO $absent$ BEGIN IF to_regprocedure('public.custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Departure new function already exists';END IF;END $absent$;
DO $absent$ BEGIN IF to_regprocedure('public.custodial_native_departure_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'Departure new function already exists';END IF;END $absent$;
DO $absent$ BEGIN IF to_regprocedure('public.custodial_native_departure_preparation_source(uuid,uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Departure new function already exists';END IF;END $absent$;
DO $absent$ BEGIN IF to_regprocedure('public.custodial_native_departure_source_requests_at(timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'Departure new function already exists';END IF;END $absent$;
DO $absent$ BEGIN IF to_regprocedure('public.custodial_native_departure_source_requests()') IS NOT NULL THEN RAISE EXCEPTION 'Departure new function already exists';END IF;END $absent$;
DO $daily_preimage$ DECLARE c record;BEGIN
 IF NOT EXISTS(SELECT 1 FROM departure_inventory_before WHERE object_kind='constraint' AND object_identity='public.employee_native_schedule_source_reservations:employee_native_schedule_source_re_employee_id_service_date_key' AND definition_sha256='cfccf3203eae332653b65ab90408378884abcdb4f5f36f31ec8b6d1f63678c8c' AND definition_sql='select public.custodial_release_authority_restore_constraint(''public.employee_native_schedule_source_reservations'',''employee_native_schedule_source_re_employee_id_service_date_key'',''UNIQUE (employee_id, service_date)'');' ) THEN RAISE EXCEPTION 'Departure daily uniqueness recovery differs';END IF;
 SELECT oid,conindid,pg_get_constraintdef(oid,true) AS definition INTO c FROM pg_constraint
  WHERE conrelid='public.employee_native_schedule_source_reservations'::regclass
   AND conname='employee_native_schedule_source_re_employee_id_service_date_key';
 IF c.definition IS DISTINCT FROM 'UNIQUE (employee_id, service_date)' THEN RAISE EXCEPTION 'Departure actual daily uniqueness predecessor differs';END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND conindid=c.conindid)
 THEN RAISE EXCEPTION 'Departure daily uniqueness has dependent foreign key';END IF;
 IF EXISTS(SELECT 1 FROM departure_inventory_before WHERE object_kind='index'
  AND (object_identity=c.conindid::regclass::text OR object_identity='public.'||c.conindid::regclass::text))
 THEN RAISE EXCEPTION 'Departure daily uniqueness has separate index recovery';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.employee_native_schedule_source_reservations'::regclass
  AND conname='employee_native_schedule_source_reservations_logical_key_key' AND pg_get_constraintdef(oid,true)='UNIQUE (logical_key)')
 THEN RAISE EXCEPTION 'Departure exact logical identity uniqueness absent';END IF;
END $daily_preimage$;

CREATE OR REPLACE FUNCTION public.custodial_native_departure_window_source_at(p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
 target jsonb;day date;projection uuid;publication uuid;version uuid;availability jsonb;matches integer;
 segments jsonb;physical jsonb;loans jsonb;analysis jsonb;before_units jsonb;after_units jsonb;
 cut time;shift_end time;start_at timestamptz;end_at timestamptz;credential_end timestamptz;
 boundary time;departure_evidence jsonb; name text;source_document jsonb;source_digest text;window_data jsonb;v_status text;
BEGIN
 IF p_source_key IS NULL OR p_employee_id IS NULL OR p_generation_id IS NULL OR p_at IS NULL OR NOT isfinite(p_at) THEN
  RAISE EXCEPTION 'exact native SCHEDULE source and server time required' USING errcode='22023';END IF;
 target:=public.custodial_native_target_source_at('SCHEDULE',p_source_key,p_employee_id,p_generation_id,p_at);
 IF target->>'status' IS DISTINCT FROM 'SOURCE_ONLY_POLICY_MISSING' THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status',target->>'status',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 day:=(target#>>'{source,service_date}')::date;projection:=(target#>>'{source,source_id}')::uuid;
 publication:=(target#>>'{source,publication_id}')::uuid;version:=(target#>>'{source,version_id}')::uuid;

 -- The anchor must be an actual incoming physical assignment. Both sides
 -- must be ordinary approved ownership, not a temporary lunch loan. The
 -- departing person's accepted working shift must end at exactly this edge.
 SELECT o.coverage_start INTO boundary FROM public.weekly_schedule_occurrences o
 WHERE o.occurrence_id=p_source_key AND o.projection_id=projection
  AND o.publication_id=publication AND o.version_id=version AND o.service_date=day
  AND o.state='created' AND o.owner_person_id_snapshot=p_employee_id;
 IF boundary IS NULL OR boundary=time '09:45' OR extract(second FROM boundary)<>0 THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status','SOURCE_STALE',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 WITH physical AS MATERIALIZED(SELECT * FROM public.custodial_operational_location_assignments(day)),
 availability AS MATERIALIZED(SELECT value FROM public.weekly_schedule_compiled_projections p,
  jsonb_array_elements(p.projection_envelope#>'{authority,projectionAvailability}') value WHERE p.projection_id=projection),
 transfers AS(SELECT DISTINCT pre.location_id,pre.assigned_employee_id AS departing_employee_id,
  pre.occurrence_id AS departing_occurrence_id,post.occurrence_id AS receiving_occurrence_id,a.value AS departing_availability
  FROM physical pre JOIN physical post ON post.location_id=pre.location_id
  JOIN availability a ON a.value->>'incumbentPersonId'=pre.assigned_employee_id::text
  WHERE pre.projection_id=projection AND post.projection_id=projection
   AND pre.publication_id=publication AND post.publication_id=publication
   AND pre.version_id=version AND post.version_id=version
   AND pre.projection_status='current' AND post.projection_status='current'
   AND pre.assignment_status='ASSIGNED' AND post.assignment_status='ASSIGNED'
   AND pre.authority_source='static_weekly_projection' AND post.authority_source='static_weekly_projection'
   AND pre.assigned_employee_id IS NOT NULL AND pre.assigned_employee_id<>p_employee_id
   AND pre.coverage_start<boundary AND pre.coverage_end>=boundary
   AND post.coverage_start<=boundary AND post.coverage_end>boundary
   AND post.assigned_employee_id=p_employee_id AND post.occurrence_id=p_source_key
   AND a.value->>'serviceDate'=day::text AND a.value->>'status'='working'
   AND (a.value#>>'{shift,start}')::time<boundary AND (a.value#>>'{shift,end}')::time=boundary)
 SELECT jsonb_agg(to_jsonb(t) ORDER BY location_id,departing_employee_id,departing_occurrence_id) INTO departure_evidence FROM transfers t;
 IF departure_evidence IS NULL THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status','NO_OWNERSHIP_CHANGE',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 SELECT count(*),min(value::text)::jsonb INTO matches,availability
  FROM public.weekly_schedule_compiled_projections p,
   jsonb_array_elements(p.projection_envelope#>'{authority,projectionAvailability}') value
  WHERE p.projection_id=projection AND value->>'serviceDate'=day::text
   AND value->>'incumbentPersonId'=p_employee_id::text AND value->>'status'='working';
 IF matches<>1 OR availability#>>'{shift,start}' IS NULL OR availability#>>'{shift,end}' IS NULL
  OR (availability#>>'{shift,start}')::time>boundary
  OR (availability#>>'{shift,end}')::time<=boundary THEN
  RAISE EXCEPTION 'exact working SCHEDULE recipient availability required' USING errcode='22023';END IF;
 name:=availability->>'incumbentName';shift_end:=(availability#>>'{shift,end}')::time;
 IF name IS NULL OR btrim(name)='' OR octet_length(name)>180 OR name~'[[:cntrl:]]' THEN
  RAISE EXCEPTION 'accepted SCHEDULE recipient name unsupported' USING errcode='22023';END IF;
 -- Trusted canonical readers, not a caller-supplied DTO or SQL expression.
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY segment_id),'[]'::jsonb) INTO segments FROM (
  SELECT service_date,projection_status,version_id,publication_id,projection_id,segment_id,location_group_id,
   included_location_ids,owner_type,assigned_employee_id,coverage_start,coverage_end,status,source_type,service_mode,governed
  FROM public.static_weekly_v6_read_schedule_segments(day)) r;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY occurrence_id,location_id,coverage_start),'[]'::jsonb) INTO physical FROM (
  SELECT service_date,projection_status,version_id,publication_id,projection_id,occurrence_id,location_group_id,location_id,
   assigned_employee_id,coverage_start,coverage_end,assignment_status,authority_source
  FROM public.custodial_operational_location_assignments(day)) r;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY normal_occurrence_id,responsibility_id,coverage_start),'[]'::jsonb) INTO loans FROM (
  SELECT projection_id,loan_id,responsibility_id,normal_occurrence_id,normal_owner_id,coverer_id,location_group_id,
   included_location_ids,included_snapshots='[]'::jsonb AS included_snapshots_empty,service_mode,coverage_start,coverage_end
  FROM public.static_weekly_v8_read_lunch_segments(day)) r;
 IF jsonb_array_length(segments)>4096 OR jsonb_array_length(physical)>4096 OR jsonb_array_length(loans)>4096
  OR octet_length(jsonb_build_array(segments,physical,loans)::text)>2097152 THEN
  RAISE EXCEPTION 'SCHEDULE source limit exceeded' USING errcode='22023';END IF;
 WITH s AS MATERIALIZED(SELECT * FROM jsonb_to_recordset(segments) AS r(service_date date,projection_status text,
  version_id uuid,publication_id uuid,projection_id uuid,segment_id uuid,location_group_id uuid,included_location_ids uuid[],
  owner_type text,assigned_employee_id uuid,coverage_start time,coverage_end time,status text,source_type text,service_mode text,governed boolean)),
 p AS MATERIALIZED(SELECT * FROM jsonb_to_recordset(physical) AS r(service_date date,projection_status text,version_id uuid,
  publication_id uuid,projection_id uuid,occurrence_id uuid,location_group_id uuid,location_id uuid,assigned_employee_id uuid,
  coverage_start time,coverage_end time,assignment_status text,authority_source text)),
 l AS MATERIALIZED(SELECT * FROM jsonb_to_recordset(loans) AS r(projection_id uuid,loan_id text,responsibility_id text,
  normal_occurrence_id uuid,normal_owner_id uuid,coverer_id uuid,location_group_id uuid,included_location_ids uuid[],
  included_snapshots_empty boolean,service_mode text,coverage_start time,coverage_end time)),
 sides AS(SELECT * FROM (VALUES(0,true),(1,false)) r(side,pre)),
 active AS(SELECT sides.side,sides.pre,s.* FROM s CROSS JOIN sides WHERE
  CASE WHEN sides.pre THEN s.coverage_start<boundary AND s.coverage_end>=boundary
   ELSE s.coverage_start<=boundary AND s.coverage_end>boundary END),
 effective AS(SELECT a.*,loan.n AS loan_count,CASE WHEN loan.n=1 THEN loan.coverer ELSE a.assigned_employee_id END AS effective_owner
  FROM active a CROSS JOIN LATERAL(SELECT count(*) AS n,(array_agg(l.coverer_id))[1] AS coverer FROM l
   WHERE l.normal_occurrence_id=a.segment_id AND CASE WHEN a.pre THEN l.coverage_start<boundary AND l.coverage_end>=boundary
    ELSE l.coverage_start<=boundary AND l.coverage_end>boundary END) loan),
 selected_physical AS(SELECT e.side,e.segment_id,e.effective_owner,e.loan_count,p.* FROM effective e JOIN p
  ON p.occurrence_id=e.segment_id AND CASE WHEN e.pre THEN p.coverage_start<boundary AND p.coverage_end>=boundary
   ELSE p.coverage_start<=boundary AND p.coverage_end>boundary END),
 units AS(SELECT e.side,'DUTY:'||e.service_mode||':'||e.location_group_id::text AS key,e.effective_owner AS owner
   FROM effective e WHERE e.service_mode IN('reminder_only','response_only_no_clean')
  UNION ALL SELECT p.side,'LOCATION:'||p.location_id::text,p.assigned_employee_id FROM selected_physical p),
 invalid_segments AS(SELECT 1 FROM s WHERE s.service_date IS DISTINCT FROM day OR s.projection_id IS DISTINCT FROM projection
  OR s.publication_id IS DISTINCT FROM publication OR s.version_id IS DISTINCT FROM version OR s.projection_status IS DISTINCT FROM 'current'
  OR s.governed IS DISTINCT FROM true OR s.source_type IS DISTINCT FROM 'static_weekly_projection'
  OR s.coverage_start IS NULL OR s.coverage_end IS NULL OR s.coverage_start>=s.coverage_end
  OR s.service_mode IS NULL OR s.service_mode NOT IN('scan_tracked','reminder_only','response_only_no_clean')
  OR s.included_location_ids IS NULL OR (s.service_mode='scan_tracked' AND cardinality(s.included_location_ids)=0)
  OR (s.service_mode<>'scan_tracked' AND cardinality(s.included_location_ids)<>0)
  OR NOT((s.status='ASSIGNED' AND ((s.owner_type='EMPLOYEE' AND s.assigned_employee_id IS NOT NULL)
   OR(s.owner_type='COVERALL' AND s.assigned_employee_id IS NULL))) OR(s.status='OPEN' AND s.owner_type='OPEN' AND s.assigned_employee_id IS NULL))),
 invalid_loans AS(SELECT 1 FROM l LEFT JOIN s ON s.segment_id=l.normal_occurrence_id WHERE s.segment_id IS NULL
  OR s.status IS DISTINCT FROM 'ASSIGNED' OR l.projection_id IS DISTINCT FROM projection
  OR l.normal_owner_id IS DISTINCT FROM s.assigned_employee_id OR l.location_group_id IS DISTINCT FROM s.location_group_id
  OR l.service_mode IS DISTINCT FROM s.service_mode OR l.coverage_start IS NULL OR l.coverage_end IS NULL
  OR l.coverage_start>=l.coverage_end OR l.coverage_start<s.coverage_start OR l.coverage_end>s.coverage_end
  OR (l.service_mode='scan_tracked' AND (l.included_snapshots_empty IS DISTINCT FROM false OR l.included_location_ids IS NULL))
  OR (l.service_mode<>'scan_tracked' AND l.included_snapshots_empty IS DISTINCT FROM true)
  OR ARRAY(SELECT unnest(coalesce(l.included_location_ids,'{}'::uuid[])) ORDER BY 1)
    IS DISTINCT FROM ARRAY(SELECT unnest(s.included_location_ids) ORDER BY 1)),
 invalid_physical AS(SELECT 1 FROM p LEFT JOIN s ON s.segment_id=p.occurrence_id WHERE s.segment_id IS NULL
  OR s.service_mode IS DISTINCT FROM 'scan_tracked' OR p.location_id IS NULL OR NOT(p.location_id=ANY(s.included_location_ids))
  OR p.location_group_id IS DISTINCT FROM s.location_group_id OR p.projection_id IS DISTINCT FROM projection
  OR p.publication_id IS DISTINCT FROM publication OR p.version_id IS DISTINCT FROM version OR p.service_date IS DISTINCT FROM day
  OR p.projection_status IS DISTINCT FROM 'current' OR p.assignment_status IS DISTINCT FROM s.status
  OR p.coverage_start IS NULL OR p.coverage_end IS NULL OR p.coverage_start>=p.coverage_end
  OR p.coverage_start<s.coverage_start OR p.coverage_end>s.coverage_end
  OR p.authority_source IS NULL OR p.authority_source NOT IN('static_weekly_projection','static_weekly_lunch_coverage')),
 edges AS(SELECT coverage_start AS edge FROM s WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_end FROM s WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_start FROM p WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_end FROM p WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_start FROM l WHERE normal_owner_id=p_employee_id OR coverer_id=p_employee_id UNION ALL
  SELECT coverage_end FROM l WHERE normal_owner_id=p_employee_id OR coverer_id=p_employee_id)
 SELECT jsonb_build_object(
  'before_units',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM units WHERE side=0 AND owner=p_employee_id),'[]'::jsonb),
  'after_units',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM units WHERE side=1 AND owner=p_employee_id),'[]'::jsonb),
  'cut',(SELECT min(edge) FROM edges WHERE edge>boundary),
  'invalid',EXISTS(SELECT 1 FROM invalid_segments) OR EXISTS(SELECT 1 FROM invalid_loans) OR EXISTS(SELECT 1 FROM invalid_physical)
   OR EXISTS(SELECT 1 FROM effective WHERE loan_count>1)
   OR EXISTS(SELECT 1 FROM units GROUP BY side,key HAVING count(*)<>1)
   OR EXISTS(SELECT 1 FROM effective e WHERE e.service_mode='scan_tracked' AND
    (SELECT count(*) FROM selected_physical p WHERE p.side=e.side AND p.segment_id=e.segment_id)<>cardinality(e.included_location_ids))
   OR EXISTS(SELECT 1 FROM selected_physical p WHERE p.assigned_employee_id IS DISTINCT FROM p.effective_owner
    OR p.authority_source IS DISTINCT FROM CASE WHEN p.loan_count=1 THEN 'static_weekly_lunch_coverage' ELSE 'static_weekly_projection' END)) INTO analysis;
 IF (analysis->>'invalid')::boolean IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'current accepted SCHEDULE source incomplete or ambiguous' USING errcode='22023';END IF;
 before_units:=analysis->'before_units';after_units:=analysis->'after_units';
 IF before_units=after_units THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status','NO_OWNERSHIP_CHANGE',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 cut:=(analysis->>'cut')::time;
 -- Working availability is an additional authoritative ceiling, never an
 -- invented expiry. Credential and04:00 operational-day ceilings also apply.
 cut:=least(coalesce(cut,shift_end),shift_end);
 start_at:=(day+boundary) AT TIME ZONE 'America/Chicago';
 SELECT expires_at INTO STRICT credential_end FROM public.device_auth_credentials
  WHERE credential_id=(target#>>'{recipient,credential_id}')::uuid;
 end_at:=least((day+cut) AT TIME ZONE 'America/Chicago',credential_end,
  ((day+1)+time '04:00') AT TIME ZONE 'America/Chicago');
 IF end_at<=start_at THEN RAISE EXCEPTION 'finite SCHEDULE source interval unavailable' USING errcode='22023';END IF;
 IF p_at>=end_at OR (p_at>=start_at AND public.sch_service_date(p_at) IS DISTINCT FROM day) THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status','SOURCE_WINDOW_EXPIRED',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 source_document:=jsonb_build_object('schema','custodial.native-schedule-server-source-evidence.v2','departure_evidence',departure_evidence,'target',target,
  'availability',availability,'segments',segments,'physical',physical,'loans',loans,
  'valid_from',to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'valid_until',to_char(end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 source_digest:=public.static_weekly_digest_jsonb(source_document);
 window_data:=jsonb_build_object('schema','custodial.native-schedule-server-window.v2','logical_key','schedule-departure:'||day::text||':'||p_employee_id::text||':'||to_char(boundary,'HH24:MI')||':projection:'||projection::text||':revision:'||(target#>>'{source,source_revision}'),
  'service_date',day,'timezone','America/Chicago','employee_id',p_employee_id,'employee_name',name,'generation_id',p_generation_id,
  'recipient',target->'recipient','projection_id',projection,'publication_id',publication,'version_id',version,
  'source_revision',target#>>'{source,source_revision}','assignment_occurrence_id',p_source_key,'before_units',before_units,'after_units',after_units,
  'server_source_sha256',source_digest,'server_digest_format','postgres-jsonb-sha256.v1',
  'valid_from',to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'valid_until',to_char(end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'server_now',to_char(p_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_status:=CASE WHEN p_at<start_at THEN 'WINDOW_NOT_STARTED' ELSE 'CURRENT_WINDOW_SOURCE_ONLY' END;
 RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status',v_status,
  'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',window_data);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_departure_source_reserve_at(p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_expected_source_sha256 text, p_operation_id uuid, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE g public.employee_native_push_generations%rowtype;d public.devices%rowtype;
 prior public.employee_native_schedule_source_reservations%rowtype;
 at_time timestamptz;report jsonb;w jsonb;record_json jsonb;
BEGIN
 PERFORM public.custodial_begin_application_mutation();
 IF p_source_key IS NULL OR p_employee_id IS NULL OR p_generation_id IS NULL OR p_operation_id IS NULL
  OR coalesce(p_expected_source_sha256,'') !~ '^[0-9a-f]{64}$'
  OR (p_test_at IS NOT NULL AND NOT isfinite(p_test_at)) THEN
  RAISE EXCEPTION 'exact SCHEDULE source operation and digest required' USING errcode='22023';END IF;
 -- Same publication fence and native device->credential->employee->registration
 -- ->generation order as existing native registration/reservation owners.
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT d0.* INTO d FROM public.devices d0 JOIN public.employee_native_push_generations g0 ON g0.device_id=d0.id
  WHERE g0.generation_id=p_generation_id FOR UPDATE OF d0;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=p_generation_id;
 PERFORM 1 FROM public.device_auth_credentials WHERE credential_id=g.credential_id FOR UPDATE;
 PERFORM 1 FROM public.employees WHERE id=p_employee_id FOR SHARE;
 PERFORM 1 FROM public.employee_push_registrations WHERE device_id=d.id ORDER BY registration_id FOR UPDATE;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=p_generation_id FOR UPDATE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 report:=public.custodial_native_departure_window_source_at(p_source_key,p_employee_id,p_generation_id,at_time);
 IF report->>'status' IS DISTINCT FROM 'CURRENT_WINDOW_SOURCE_ONLY' THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-source-reservation.v1','status',report->>'status',
   'reserved',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,
   'clock_effect_authority',null,'retention_authority',null,'reservation',null);END IF;
 w:=report->'window';
 IF w->>'server_source_sha256' IS DISTINCT FROM p_expected_source_sha256 THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-source-reservation.v1','status','SOURCE_CHANGED',
   'reserved',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,
   'clock_effect_authority',null,'retention_authority',null,'reservation',null);END IF;
 SELECT * INTO prior FROM public.employee_native_schedule_source_reservations
  WHERE operation_id=p_operation_id FOR UPDATE;
 IF prior.reservation_id IS NOT NULL AND (prior.source_key IS DISTINCT FROM p_source_key
  OR prior.employee_id IS DISTINCT FROM p_employee_id OR prior.generation_id IS DISTINCT FROM p_generation_id
  OR prior.source_sha256 IS DISTINCT FROM p_expected_source_sha256
  OR prior.logical_key IS DISTINCT FROM w->>'logical_key') THEN
  RAISE EXCEPTION 'original SCHEDULE operation binding conflict' USING errcode='23514';END IF;
 SELECT * INTO prior FROM public.employee_native_schedule_source_reservations
  WHERE logical_key=w->>'logical_key' FOR UPDATE;
 IF prior.reservation_id IS NOT NULL THEN
  IF prior.source_key IS DISTINCT FROM p_source_key OR prior.employee_id IS DISTINCT FROM p_employee_id
   OR prior.generation_id IS DISTINCT FROM p_generation_id OR prior.source_sha256 IS DISTINCT FROM p_expected_source_sha256 THEN
   RETURN jsonb_build_object('schema','custodial.native-schedule-source-reservation.v1','status','ORIGINAL_SOURCE_CONFLICT',
    'reserved',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,
    'clock_effect_authority',null,'retention_authority',null,'reservation',null);END IF;
 ELSE
  INSERT INTO public.employee_native_schedule_source_reservations(operation_id,service_date,employee_id,generation_id,source_key,
   logical_key,source_sha256,reserved_at,valid_from,valid_until,source_window,source_window_sha256)
   VALUES(p_operation_id,(w->>'service_date')::date,p_employee_id,p_generation_id,p_source_key,w->>'logical_key',
    p_expected_source_sha256,at_time,(w->>'valid_from')::timestamptz,(w->>'valid_until')::timestamptz,w,
    public.static_weekly_digest_jsonb(w)) RETURNING * INTO prior;
  record_json:=jsonb_build_object('reservation_id',prior.reservation_id,'operation_id',prior.operation_id,
   'reserved_at',public.custodial_native_location_utc(prior.reserved_at),'window',prior.source_window,'window_sha256',prior.source_window_sha256);
  RETURN jsonb_build_object('schema','custodial.native-schedule-source-reservation.v1','status','SOURCE_RESERVED_NATIVE_UNQUALIFIED',
   'reserved',true,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,
   'clock_effect_authority',null,'retention_authority',null,'reservation',record_json);
 END IF;
 -- Preserve the ORIGINAL operation, sampled timestamp and complete bytes even
 -- when a retry uses another operation ID. A replay NEVER authorizes a send.
 record_json:=jsonb_build_object('reservation_id',prior.reservation_id,'operation_id',prior.operation_id,
  'reserved_at',public.custodial_native_location_utc(prior.reserved_at),'window',prior.source_window,'window_sha256',prior.source_window_sha256);
 RETURN jsonb_build_object('schema','custodial.native-schedule-source-reservation.v1','status','ORIGINAL_SOURCE_RESERVED',
  'reserved',true,'replayed',true,'dispatch_authorized',false,'delivery_admitted',false,
  'clock_effect_authority',null,'retention_authority',null,'reservation',record_json);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_departure_source_reserve(p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_expected_source_sha256 text, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_departure_source_reserve_at($1,$2,$3,$4,$5,null);
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_departure_preparation_source_at(p_source uuid, p_employee uuid, p_generation uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE window_reply jsonb;w jsonb;g public.employee_native_push_generations%rowtype;expected jsonb;preparation jsonb;
BEGIN
 IF p_source IS NULL OR p_employee IS NULL OR p_generation IS NULL OR p_at IS NULL OR NOT isfinite(p_at) THEN
  RAISE EXCEPTION 'exact SCHEDULE preparation source/actor/time required' USING errcode='22023';END IF;
 window_reply:=public.custodial_native_departure_window_source_at(p_source,p_employee,p_generation,p_at);
 IF window_reply->>'status' IS DISTINCT FROM 'CURRENT_WINDOW_SOURCE_ONLY' THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-preparation-source.v1','status','SOURCE_NOT_CURRENT','source_status',window_reply->>'status',
   'dispatch_authorized',false,'delivery_admitted',false,'clock_effect_authority',null,'retention_authority',null,'preparation',null);END IF;
 w:=window_reply->'window';
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=p_generation;
 -- The canonical window has already validated the current generation,
 -- registration, credential/device/person/epoch and accepted source. Never
 -- synthesize the missing registration ID from the source window or artwork.
 IF g.generation_id IS NULL OR w->>'employee_id' IS DISTINCT FROM p_employee::text
  OR w->>'generation_id' IS DISTINCT FROM p_generation::text OR w->>'assignment_occurrence_id' IS DISTINCT FROM p_source::text
  OR w#>>'{recipient,employee_id}' IS DISTINCT FROM g.employee_id::text
  OR w#>>'{recipient,generation_id}' IS DISTINCT FROM g.generation_id::text
  OR w#>>'{recipient,device_id}' IS DISTINCT FROM g.device_id::text
  OR w#>>'{recipient,device_identifier}' IS DISTINCT FROM g.device_identifier
  OR w#>>'{recipient,credential_id}' IS DISTINCT FROM g.credential_id::text
  OR w#>>'{recipient,assignment_epoch}' IS DISTINCT FROM g.assignment_epoch::text
  OR w#>>'{recipient,principal_digest}' IS DISTINCT FROM g.principal_digest
  OR w#>>'{recipient,token_digest}' IS DISTINCT FROM g.token_digest THEN
  RAISE EXCEPTION 'SCHEDULE preparation current recipient projection mismatch' USING errcode='22023';END IF;
 expected:=jsonb_build_object('assignment_epoch',g.assignment_epoch::text,'credential_id',g.credential_id::text,
  'device_id',g.device_identifier,'employee_id',g.employee_id::text,'generation_id',g.generation_id::text,
  'principal_digest',g.principal_digest,'registration_id',g.registration_id::text,'token_digest',g.token_digest);
 preparation:=jsonb_build_object('source_key',p_source,'employee_id',p_employee,'generation_id',p_generation,
  'service_date',w->>'service_date','projection_id',w->>'projection_id','publication_id',w->>'publication_id',
  'version_id',w->>'version_id','source_revision',w->>'source_revision','expected_source_sha256',w->>'server_source_sha256','expected',expected);
 RETURN jsonb_build_object('schema','custodial.native-schedule-preparation-source.v1','status','CURRENT_PREPARATION_SOURCE_ONLY','source_status','CURRENT_WINDOW_SOURCE_ONLY',
  'dispatch_authorized',false,'delivery_admitted',false,'clock_effect_authority',null,'retention_authority',null,'preparation',preparation);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_departure_preparation_source(p_source uuid, p_employee uuid, p_generation uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_departure_preparation_source_at($1,$2,$3,statement_timestamp());
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_departure_source_requests_at(p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE day date;a record;actor record;anchor uuid;candidate record;candidate_sources jsonb;target jsonb;last_boundary time;seen_generations jsonb:='{}';requests jsonb:='[]';authority jsonb;status text;
BEGIN
 IF p_at IS NULL OR NOT isfinite(p_at) THEN RAISE EXCEPTION 'finite source discovery time required' USING errcode='22023';END IF;
 day:=public.sch_service_date(p_at);
 SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
 status:='SOURCE_NOT_CURRENT';
 IF a.governed IS TRUE AND a.projection_status='current' AND a.authority_source='static_weekly_projection' THEN
  -- The retired four-day transition has separate occurrence/projection tables.
  -- Never label that illustrated reader DTO as a normal native source.
  IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p
   WHERE p.projection_id=a.projection_id AND p.publication_id=a.publication_id AND p.version_id=a.version_id) THEN
   status:='SOURCE_ORIGIN_UNSUPPORTED';
  ELSE
   status:='SOURCE_CANDIDATES_ONLY';
   authority:=jsonb_build_object('projection_id',a.projection_id,'publication_id',a.publication_id,
    'version_id',a.version_id,'source_revision',a.projection_authority_revision::text);
   -- Materialize the canonical physical reader once. A normal base/start
   -- occurrence is not a departure candidate. This only narrows enumeration;
   -- target validation remains here; complete window/composition/expiry checks
   -- remain in preparation_source before any reservation or job write.
   WITH physical AS MATERIALIZED(SELECT * FROM public.custodial_operational_location_assignments(day)),
   availability AS MATERIALIZED(SELECT value FROM public.weekly_schedule_compiled_projections p,
    jsonb_array_elements(p.projection_envelope#>'{authority,projectionAvailability}') value WHERE p.projection_id=a.projection_id),
   candidates AS(SELECT DISTINCT o.owner_person_id_snapshot AS employee_id,o.occurrence_id,o.coverage_start
    FROM public.weekly_schedule_occurrences o JOIN physical post ON post.occurrence_id=o.occurrence_id
    JOIN physical pre ON pre.location_id=post.location_id
    JOIN availability v ON v.value->>'incumbentPersonId'=pre.assigned_employee_id::text
    JOIN availability receiving ON receiving.value->>'incumbentPersonId'=o.owner_person_id_snapshot::text
    CROSS JOIN LATERAL(SELECT min(edge) AS next_edge FROM physical pe
     CROSS JOIN LATERAL unnest(ARRAY[pe.coverage_start,pe.coverage_end]) AS edge_row(edge)
     WHERE pe.projection_id=a.projection_id AND pe.assigned_employee_id=o.owner_person_id_snapshot
      AND edge>o.coverage_start) ceiling
    WHERE o.projection_id=a.projection_id AND o.publication_id=a.publication_id AND o.version_id=a.version_id
     AND o.service_date=day AND o.state='created' AND o.coverage_start<>time '09:45'
     AND extract(second FROM o.coverage_start)=0 AND o.coverage_start<o.coverage_end
     AND pre.projection_id=a.projection_id AND post.projection_id=a.projection_id
     AND pre.publication_id=a.publication_id AND post.publication_id=a.publication_id
     AND pre.version_id=a.version_id AND post.version_id=a.version_id
     AND pre.projection_status='current' AND post.projection_status='current'
     AND pre.assignment_status='ASSIGNED' AND post.assignment_status='ASSIGNED'
     AND pre.authority_source='static_weekly_projection' AND post.authority_source='static_weekly_projection'
     AND pre.assigned_employee_id IS NOT NULL AND pre.assigned_employee_id<>o.owner_person_id_snapshot
     AND pre.coverage_start<o.coverage_start AND pre.coverage_end>=o.coverage_start
     AND post.coverage_start<=o.coverage_start AND post.coverage_end>o.coverage_start
     AND post.assigned_employee_id=o.owner_person_id_snapshot
     AND v.value->>'serviceDate'=day::text AND v.value->>'status'='working'
     AND (v.value#>>'{shift,start}')::time<o.coverage_start AND (v.value#>>'{shift,end}')::time=o.coverage_start
     AND receiving.value->>'serviceDate'=day::text AND receiving.value->>'status'='working'
     AND (receiving.value#>>'{shift,start}')::time<=o.coverage_start AND (receiving.value#>>'{shift,end}')::time>o.coverage_start
     AND p_at>=(day+o.coverage_start) AT TIME ZONE 'America/Chicago'
     AND p_at<(day+least(o.coverage_end,(receiving.value#>>'{shift,end}')::time,
      coalesce(ceiling.next_edge,o.coverage_end))) AT TIME ZONE 'America/Chicago')
   SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY employee_id,coverage_start,occurrence_id),'[]'::jsonb) INTO candidate_sources FROM candidates c;
   IF jsonb_array_length(candidate_sources)>4096 OR octet_length(candidate_sources::text)>2097152
   THEN RAISE EXCEPTION 'departure source candidate limit exceeded' USING errcode='22023';END IF;
   FOR actor IN SELECT g.generation_id,g.employee_id,g.device_id AS device_uuid,g.registration_id FROM public.employee_native_push_generations g
    JOIN public.devices d ON d.id=g.device_id AND d.active AND d.device_id=g.device_identifier
     AND d.assigned_employee_id=g.employee_id AND d.assignment_epoch=g.assignment_epoch
    JOIN public.device_auth_credentials c ON c.credential_id=g.credential_id AND c.device_id=d.id
     AND c.confirmed_at IS NOT NULL AND c.revoked_at IS NULL AND c.expires_at>p_at
    JOIN public.employee_push_registrations r ON r.registration_id=g.registration_id AND r.device_id=d.id
     AND r.credential_id=c.credential_id AND r.employee_id=g.employee_id AND r.assignment_epoch=g.assignment_epoch
     AND r.active AND r.revoked_at IS NULL AND r.platform='android' AND r.token_hash=g.token_digest
    JOIN public.employees e ON e.id=g.employee_id AND e.active AND e.employee_code~'^EMP[0-9]+$'
    WHERE g.activated_at<=p_at AND g.revoked_at IS NULL AND g.dispatch_retired_at IS NULL
     AND (SELECT count(*) FROM public.weekly_schedule_compiled_projections p,
       jsonb_array_elements(p.projection_envelope#>'{authority,projectionAvailability}') v
      WHERE p.projection_id=a.projection_id AND v->>'serviceDate'=day::text
       AND v->>'incumbentPersonId'=g.employee_id::text AND v->>'status'='working'
       AND (v#>>'{shift,start}')::time<(v#>>'{shift,end}')::time)=1
    ORDER BY g.employee_id,g.generation_id LOOP
    last_boundary:=null;
    FOR candidate IN SELECT c.occurrence_id,c.coverage_start FROM jsonb_to_recordset(candidate_sources)
     AS c(employee_id uuid,occurrence_id uuid,coverage_start time)
     WHERE c.employee_id=actor.employee_id ORDER BY c.coverage_start,c.occurrence_id LOOP
    IF candidate.coverage_start IS NOT DISTINCT FROM last_boundary THEN CONTINUE;END IF;
    anchor:=candidate.occurrence_id;
    -- Reuse the actual current recipient/source validator; registrations alone
    -- never establish current target identity. No token is returned.
    target:=public.custodial_native_target_source_at('SCHEDULE',anchor,actor.employee_id,actor.generation_id,p_at);
    IF target->>'status' IS DISTINCT FROM 'SOURCE_ONLY_POLICY_MISSING' THEN CONTINUE;END IF;
    IF target#>>'{source,source_id}' IS DISTINCT FROM a.projection_id::text
     OR target#>>'{source,publication_id}' IS DISTINCT FROM a.publication_id::text
     OR target#>>'{source,version_id}' IS DISTINCT FROM a.version_id::text
     OR target#>>'{source,source_revision}' IS DISTINCT FROM a.projection_authority_revision::text THEN
     RAISE EXCEPTION 'native source discovery snapshot binding changed' USING errcode='22023';END IF;
    last_boundary:=candidate.coverage_start;
    -- Ambiguity is checked even if this generation already owns a job.
    IF seen_generations ? actor.employee_id::text AND seen_generations->>actor.employee_id::text<>actor.generation_id::text THEN
     status:='SOURCE_AMBIGUOUS';requests:='[]';authority:=null;EXIT;END IF;
    seen_generations:=jsonb_set(seen_generations,ARRAY[actor.employee_id::text],to_jsonb(actor.generation_id::text));
    -- Deduplicate preparation, never delivery. Reservation alone is NOT a
    -- completed job. Only the exact linked, immutable original job can avoid
    -- repeating the expensive preparation prefix on every bounded sweep.
    IF EXISTS(SELECT 1 FROM public.employee_native_schedule_source_reservations sr
     JOIN public.employee_native_schedule_jobs sj ON sj.source_reservation_id=sr.reservation_id
     JOIN public.operational_notification_jobs oj ON oj.job_id=sj.job_id
     WHERE sr.logical_key='schedule-departure:'||day::text||':'||actor.employee_id::text||':'||to_char(candidate.coverage_start,'HH24:MI')
      ||':projection:'||a.projection_id::text||':revision:'||a.projection_authority_revision::text
      AND sr.service_date=day AND sr.employee_id=actor.employee_id AND sr.generation_id=actor.generation_id AND sr.source_key=anchor
      AND sr.source_window->>'schema'='custodial.native-schedule-server-window.v2'
      AND sr.source_window->>'projection_id'=a.projection_id::text AND sr.source_window->>'publication_id'=a.publication_id::text
      AND sr.source_window->>'version_id'=a.version_id::text AND sr.source_window->>'source_revision'=a.projection_authority_revision::text
      AND sr.source_window->'recipient'=target->'recipient'
      AND sj.expected=jsonb_build_object('assignment_epoch',target#>>'{recipient,assignment_epoch}',
       'credential_id',target#>>'{recipient,credential_id}','device_id',target#>>'{recipient,device_identifier}',
       'employee_id',actor.employee_id::text,'generation_id',actor.generation_id::text,
       'principal_digest',target#>>'{recipient,principal_digest}','registration_id',actor.registration_id::text,
       'token_digest',target#>>'{recipient,token_digest}')
      AND sj.source_window_sha256=sr.source_window_sha256 AND oj.source_id=sr.reservation_id
      AND oj.job_type='employee_native_push' AND oj.job_key='employee-schedule-push:'||sr.reservation_id::text||':'||(target#>>'{recipient,credential_id}')
      AND oj.payload_json=jsonb_build_object('credential_id',target#>>'{recipient,credential_id}','device_id',actor.device_uuid::text,
       'device_identifier',target#>>'{recipient,device_identifier}','employee_id',actor.employee_id::text,
       'assignment_epoch',target#>>'{recipient,assignment_epoch}','data_json',jsonb_build_object('kind','employee_schedule_ownership','source_reservation_id',sr.reservation_id::text))
      AND sj.job_payload_sha256=public.static_weekly_digest_jsonb(oj.payload_json)) THEN CONTINUE;END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(requests) r WHERE r->>'employee_id'=actor.employee_id::text AND r->>'generation_id'<>actor.generation_id::text) THEN
     status:='SOURCE_AMBIGUOUS';requests:='[]';authority:=null;EXIT;END IF;
    IF jsonb_array_length(requests)>=4096 THEN status:='SOURCE_LIMIT_EXCEEDED';requests:='[]';authority:=null;EXIT;END IF;
    requests:=requests||jsonb_build_array(jsonb_build_object('source_key',anchor,'employee_id',actor.employee_id,'generation_id',actor.generation_id));
    END LOOP;
    IF status<>'SOURCE_CANDIDATES_ONLY' THEN EXIT;END IF;
   END LOOP;
  END IF;
 END IF;
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'employee_id',r->>'source_key'),'[]'::jsonb) INTO requests FROM jsonb_array_elements(requests) r;
 RETURN jsonb_build_object('schema','custodial.native-schedule-source-requests.v2','status',status,
  'service_date',day,'timezone','America/Chicago','authority',authority,'requests',requests,
  'dispatch_authorized',false,'delivery_admitted',false,'clock_effect_authority',null,'retention_authority',null);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_departure_source_requests()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_departure_source_requests_at(statement_timestamp());
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_source_reserve(p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_expected_source_sha256 text, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_source_reserve_at($1,$2,$3,$4,$5,null);
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_preparation_source(p_source uuid, p_employee uuid, p_generation uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_preparation_source_at($1,$2,$3,statement_timestamp());
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_content_source(p_operation_id uuid, p_employee_id uuid, p_generation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_content_source_at($1,$2,$3,statement_timestamp());
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_source_status(p_operation_id uuid, p_employee_id uuid, p_generation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_source_status_at($1,$2,$3,statement_timestamp());
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_job_prepare(p_source uuid, p_expected jsonb, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN RETURN public.custodial_native_schedule_job_prepare_at($1,$2,$3,null);END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_finalize(p_job uuid, p_lease uuid, p_source uuid, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_finalize_at($1,$2,$3,$4,null);
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_dispatch_prepare(p_job uuid, p_lease uuid, p_source uuid, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_dispatch_prepare_at($1,$2,$3,$4,null);
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_target(p_job uuid, p_lease uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_target_at($1,$2,null);
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_outcome(p_binding jsonb, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.custodial_native_schedule_outcome_at($1,$2,null);
$function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_observation_originals(p_credential uuid, p_credential_hash text, p_jobs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN RETURN public.custodial_native_schedule_observation_originals_at($1,$2,$3,null);END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_source_status_at(p_operation_id uuid, p_employee_id uuid, p_generation_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE prior public.employee_native_schedule_source_reservations%rowtype;current_source jsonb;is_current boolean;record_json jsonb;
BEGIN
 IF p_operation_id IS NULL OR p_employee_id IS NULL OR p_generation_id IS NULL OR p_at IS NULL OR NOT isfinite(p_at) THEN
  RAISE EXCEPTION 'exact original SCHEDULE source status required' USING errcode='22023';END IF;
 SELECT * INTO prior FROM public.employee_native_schedule_source_reservations WHERE operation_id=p_operation_id
  AND employee_id=p_employee_id AND generation_id=p_generation_id;
 IF prior.reservation_id IS NULL THEN RETURN jsonb_build_object('schema','custodial.native-schedule-source-status.v1',
  'status','ORIGINAL_NOT_FOUND','source_current',false,'dispatch_authorized',false,'delivery_admitted',false,'reservation',null);END IF;
 current_source:=CASE WHEN prior.source_window->>'schema'='custodial.native-schedule-server-window.v2'
 THEN public.custodial_native_departure_window_source_at(prior.source_key,prior.employee_id,prior.generation_id,p_at)
 ELSE public.custodial_native_schedule_window_source_at(prior.source_key,prior.employee_id,prior.generation_id,p_at) END;
 is_current:=current_source->>'status'='CURRENT_WINDOW_SOURCE_ONLY'
  AND current_source#>>'{window,server_source_sha256}'=prior.source_sha256;
 record_json:=jsonb_build_object('reservation_id',prior.reservation_id,'operation_id',prior.operation_id,
  'reserved_at',public.custodial_native_location_utc(prior.reserved_at),'window',prior.source_window,'window_sha256',prior.source_window_sha256);
 RETURN jsonb_build_object('schema','custodial.native-schedule-source-status.v1','status','ORIGINAL_SOURCE_RETAINED',
  'source_current',coalesce(is_current,false),'current_source_status',current_source->>'status',
  'dispatch_authorized',false,'delivery_admitted',false,'clock_effect_authority',null,'retention_authority',null,'reservation',record_json);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_content_source_at(p_operation_id uuid, p_employee_id uuid, p_generation_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE source_status jsonb;r jsonb;w jsonb;candidate jsonb;departure boolean;boundary text;label text;
BEGIN
 source_status:=public.custodial_native_schedule_source_status_at(p_operation_id,p_employee_id,p_generation_id,p_at);
 IF source_status->'source_current' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-content-source.v1','status','CONTENT_SOURCE_UNAVAILABLE',
   'dispatch_authorized',false,'delivery_admitted',false,'source_status',source_status,'candidate',null);END IF;
 r:=source_status->'reservation';w:=r->'window';
 departure:=w->>'schema'='custodial.native-schedule-server-window.v2';
 boundary:=to_char((w->>'valid_from')::timestamptz AT TIME ZONE 'America/Chicago','HH24:MI');
 label:=to_char((w->>'valid_from')::timestamptz AT TIME ZONE 'America/Chicago','FMHH12:MI AM');
 candidate:=jsonb_build_object('schema',CASE WHEN departure THEN 'custodial.native-schedule-content-candidate.v2' ELSE 'custodial.native-schedule-content-candidate.v1' END,'kind','employee_schedule_ownership',
  'notification_type','schedule_ownership','title',CASE WHEN departure THEN 'Assignment update' ELSE '9:45 assignment update' END,
  'body',CASE WHEN departure THEN (w->>'employee_name')||', your assignments changed at '||label||' as a scheduled shift ended. Please see your Schedule page for your updated assignments.' ELSE (w->>'employee_name')||', your scheduled responsibilities have changed at 9:45 AM. Please see your Schedule page for your updated assignments.' END,
  'channel_id','employee-schedule-ownership','route','employee-schedule.html?hub=employee','notification_key',w->>'logical_key',
  'service_date',w->>'service_date','boundary_local',CASE WHEN departure THEN boundary ELSE '09:45' END,'employee_id',w->>'employee_id','generation_id',w->>'generation_id',
  'source_reservation_id',r->>'reservation_id','source_operation_id',r->>'operation_id','source_window_sha256',r->>'window_sha256',
  'server_source_sha256',w->>'server_source_sha256','source_revision',w->>'source_revision','projection_id',w->>'projection_id',
  'publication_id',w->>'publication_id','version_id',w->>'version_id','assignment_occurrence_id',w->>'assignment_occurrence_id',
  'source_valid_from',w->>'valid_from','source_valid_until',w->>'valid_until');
 IF EXISTS(SELECT 1 FROM jsonb_each(candidate) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string')
  OR EXISTS(SELECT 1 FROM jsonb_each_text(candidate) e WHERE e.value='' OR e.value~'[[:cntrl:]]'
   OR octet_length(e.value)>CASE WHEN e.key='title' THEN 180 WHEN e.key='notification_key' THEN 240 ELSE 1000 END)
  OR octet_length(public.custodial_native_location_canonical(candidate))>3500 THEN
  RAISE EXCEPTION 'SCHEDULE accepted content unsupported; no truncation' USING errcode='22023';END IF;
 RETURN jsonb_build_object('schema','custodial.native-schedule-content-source.v1','status','CONTENT_CURRENT_SOURCE_ONLY',
  'dispatch_authorized',false,'delivery_admitted',false,'source_status',source_status,'candidate',candidate);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_finalize_at(p_job uuid, p_lease uuid, p_source uuid, p_expected jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;j public.operational_notification_jobs%rowtype;
 s public.employee_native_schedule_source_reservations%rowtype;prior public.employee_native_schedule_finalizations%rowtype;
 receipt public.employee_native_push_delivery_receipts%rowtype;at_time timestamptz;content jsonb;expected jsonb;data jsonb;digest text;field text;
BEGIN
 PERFORM public.custodial_begin_application_mutation();
 IF p_job IS NULL OR p_lease IS NULL OR p_source IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(p_expected) key) IS DISTINCT FROM
   ARRAY['assignment_epoch','credential_id','device_id','employee_id','generation_id','principal_digest','registration_id','token_digest']
  OR EXISTS(SELECT 1 FROM jsonb_each(p_expected) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string')
  OR (p_test_at IS NOT NULL AND NOT isfinite(p_test_at)) THEN
  RAISE EXCEPTION 'exact SCHEDULE finalization job/source/recipient required' USING errcode='22023';END IF;
 FOREACH field IN ARRAY ARRAY['credential_id','employee_id','generation_id','registration_id'] LOOP
  IF p_expected->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'invalid SCHEDULE recipient UUID' USING errcode='22023';END IF;
 END LOOP;
 IF p_expected->>'assignment_epoch' !~ '^[1-9][0-9]{0,15}$' OR (p_expected->>'assignment_epoch')::numeric>9007199254740991
  OR p_expected->>'device_id' !~ '^KIOSK_(0[2-9]|10)$' OR p_expected->>'principal_digest' !~ '^[0-9a-f]{64}$'
  OR p_expected->>'token_digest' !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid SCHEDULE recipient binding' USING errcode='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT d0.* INTO d FROM public.devices d0 JOIN public.device_auth_credentials c0 ON c0.device_id=d0.id
  WHERE c0.credential_id=(p_expected->>'credential_id')::uuid FOR UPDATE OF d0;
 SELECT * INTO c FROM public.device_auth_credentials WHERE credential_id=(p_expected->>'credential_id')::uuid FOR UPDATE;
 PERFORM 1 FROM public.employees WHERE id=d.assigned_employee_id FOR SHARE;
 PERFORM 1 FROM public.employee_push_registrations WHERE device_id=d.id ORDER BY registration_id FOR UPDATE;
 SELECT * INTO r FROM public.employee_push_registrations WHERE registration_id=(p_expected->>'registration_id')::uuid;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=(p_expected->>'generation_id')::uuid FOR UPDATE;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=p_job FOR UPDATE;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=p_source FOR UPDATE;
 SELECT * INTO prior FROM public.employee_native_schedule_finalizations WHERE source_reservation_id=p_source FOR UPDATE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 -- Original readback works after expiry/rotation without granting a new send.
 IF prior.job_id IS NOT NULL THEN
  SELECT * INTO receipt FROM public.employee_native_push_delivery_receipts WHERE job_id=prior.job_id;
  expected:=jsonb_build_object('assignment_epoch',receipt.assignment_epoch::text,'credential_id',receipt.credential_id::text,
   'device_id',receipt.native_payload->>'receipt_device_id','employee_id',receipt.native_payload->>'receipt_employee_id',
   'generation_id',receipt.native_generation_id::text,'principal_digest',receipt.native_payload->>'principal_digest',
   'registration_id',receipt.registration_id::text,'token_digest',receipt.token_hash);
  IF prior.job_id IS DISTINCT FROM p_job OR receipt.lease_token IS DISTINCT FROM p_lease OR expected IS DISTINCT FROM p_expected THEN
   RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','ORIGINAL_FINALIZATION_CONFLICT',
    'finalized',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',null,'wire',null);END IF;
  RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','ORIGINAL_FINALIZATION_RETAINED',
   'finalized',true,'replayed',true,'dispatch_authorized',false,'delivery_admitted',false,'payload',receipt.native_payload,
   'wire',public.custodial_native_location_canonical(receipt.native_payload));
 END IF;
 IF s.reservation_id IS NULL THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','SOURCE_OR_JOB_SUPERSEDED',
   'finalized',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',null,'wire',null);END IF;
 content:=public.custodial_native_schedule_content_source_at(s.operation_id,s.employee_id,s.generation_id,at_time);
 expected:=jsonb_build_object('assignment_epoch',d.assignment_epoch::text,'credential_id',c.credential_id::text,
  'device_id',d.device_id,'employee_id',d.assigned_employee_id::text,'generation_id',g.generation_id::text,
  'principal_digest',g.principal_digest,'registration_id',r.registration_id::text,'token_digest',g.token_digest);
 IF NOT isfinite(at_time) OR d.id IS NULL OR c.credential_id IS NULL OR r.registration_id IS NULL OR g.generation_id IS NULL
  OR s.reservation_id IS NULL OR expected IS DISTINCT FROM p_expected
  OR g.registration_id IS DISTINCT FROM r.registration_id OR g.credential_id IS DISTINCT FROM c.credential_id
  OR g.device_id IS DISTINCT FROM d.id OR r.device_id IS DISTINCT FROM d.id OR r.credential_id IS DISTINCT FROM c.credential_id
  OR s.generation_id IS DISTINCT FROM g.generation_id OR s.employee_id IS DISTINCT FROM d.assigned_employee_id
  OR content->>'status' IS DISTINCT FROM 'CONTENT_CURRENT_SOURCE_ONLY'
  OR j.job_id IS NULL OR j.job_type IS DISTINCT FROM 'employee_native_push' OR j.status IS DISTINCT FROM 'leased'
  OR j.lease_token IS DISTINCT FROM p_lease OR j.leased_until IS NULL OR j.leased_until<=at_time
  OR j.source_id IS DISTINCT FROM p_source
  OR j.job_key IS DISTINCT FROM 'employee-schedule-push:'||p_source::text||':'||c.credential_id::text
  OR j.payload_json IS DISTINCT FROM jsonb_build_object('credential_id',c.credential_id::text,'device_id',d.id::text,
   'device_identifier',d.device_id,'employee_id',d.assigned_employee_id::text,'assignment_epoch',d.assignment_epoch::text,
   'data_json',jsonb_build_object('kind','employee_schedule_ownership','source_reservation_id',p_source::text))
  OR EXISTS(SELECT 1 FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job) THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','SOURCE_OR_JOB_SUPERSEDED',
   'finalized',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',null,'wire',null);END IF;
 -- Current source enforces all credential, generation, active staff, token,
 -- registration and schedule predicates under the locks held above.
 data:=((content->'candidate')-'employee_id')||jsonb_build_object('schema',CASE WHEN content#>>'{candidate,schema}'='custodial.native-schedule-content-candidate.v2' THEN 'custodial.native-schedule-payload.v2' ELSE 'custodial.native-schedule-payload.v1' END,
  'principal_digest',g.principal_digest,'token_digest',g.token_digest,'receipt_job_id',p_job::text,
  'receipt_credential_id',c.credential_id::text,'receipt_employee_id',s.employee_id::text,'receipt_device_id',d.device_id,
  'receipt_assignment_epoch',d.assignment_epoch::text,'reservation_at',public.custodial_native_location_utc(at_time),
  'valid_until',public.custodial_native_location_utc(s.valid_until));
 digest:=public.static_weekly_digest_text(public.custodial_native_location_canonical(data));
 data:=data||jsonb_build_object('content_sha256',digest);
 IF public.custodial_native_schedule_receipt_binding(data,p_job,p_source,c.credential_id,d.assignment_epoch,
  g.generation_id,g.token_digest,at_time,s.valid_until,digest) IS NOT TRUE THEN
  RAISE EXCEPTION 'SCHEDULE closed wire invalid; no truncation' USING errcode='22023';END IF;
 INSERT INTO public.employee_native_push_delivery_receipts(job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,
  registration_id,token_hash,prepared_at,native_generation_id,native_payload,native_payload_sha256,native_valid_until)
 VALUES(p_job,j.job_key,p_source,p_lease,c.credential_id,d.assignment_epoch,r.registration_id,g.token_digest,at_time,g.generation_id,data,digest,s.valid_until);
 INSERT INTO public.employee_native_schedule_finalizations(source_reservation_id,job_id,source_window_sha256,content_sha256,finalized_at,valid_until)
 VALUES(p_source,p_job,s.source_window_sha256,digest,at_time,s.valid_until);
 RETURN jsonb_build_object('schema','custodial.native-schedule-finalization.v1','status','FINALIZED_NATIVE_UNQUALIFIED',
  'finalized',true,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'payload',data,
  'wire',public.custodial_native_location_canonical(data));
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_receipt_binding(p jsonb, p_job uuid, p_source uuid, p_credential uuid, p_epoch bigint, p_generation uuid, p_token text, p_at timestamp with time zone, p_until timestamp with time zone, p_sha text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE keys text[];field text;source_from timestamptz;source_until timestamptz;
BEGIN
 IF p IS NULL OR p_job IS NULL OR p_source IS NULL OR p_credential IS NULL OR p_epoch IS NULL
  OR p_generation IS NULL OR p_token IS NULL OR p_at IS NULL OR p_until IS NULL OR p_sha IS NULL
  OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO keys FROM jsonb_object_keys(p) key;
 IF keys IS DISTINCT FROM ARRAY['assignment_occurrence_id','body','boundary_local','channel_id','content_sha256',
  'generation_id','kind','notification_key','notification_type','principal_digest','projection_id','publication_id',
  'receipt_assignment_epoch','receipt_credential_id','receipt_device_id','receipt_employee_id','receipt_job_id',
  'reservation_at','route','schema','server_source_sha256','service_date','source_operation_id','source_reservation_id',
  'source_revision','source_valid_from','source_valid_until','source_window_sha256','title','token_digest','valid_until','version_id']
  OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string')
  OR EXISTS(SELECT 1 FROM jsonb_each_text(p) e WHERE e.value='' OR e.value~'[[:cntrl:]]'
   OR octet_length(e.value)>CASE WHEN e.key='title' THEN 180 WHEN e.key='notification_key' THEN 240 ELSE 1000 END)
  OR p->>'schema' NOT IN('custodial.native-schedule-payload.v1','custodial.native-schedule-payload.v2') OR p->>'kind'<>'employee_schedule_ownership'
  OR p->>'notification_type'<>'schedule_ownership' OR p->>'channel_id'<>'employee-schedule-ownership'
  OR p->>'route'<>'employee-schedule.html?hub=employee' OR (CASE WHEN p->>'schema'='custodial.native-schedule-payload.v1' THEN p->>'boundary_local'<>'09:45' ELSE p->>'boundary_local' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p->>'boundary_local'='09:45' END)
  OR p->>'generation_id'<>p_generation::text OR p->>'receipt_job_id'<>p_job::text
  OR p->>'source_reservation_id'<>p_source::text OR p->>'receipt_credential_id'<>p_credential::text
  OR p->>'receipt_assignment_epoch'<>p_epoch::text OR p_epoch<1 OR p_epoch>9007199254740991
  OR p->>'token_digest'<>p_token OR p->>'content_sha256'<>p_sha
  OR p->>'receipt_device_id' !~ '^KIOSK_(0[2-9]|10)$'
  OR p->>'source_revision' !~ '^[1-9][0-9]{0,15}$' OR (p->>'source_revision')::numeric>9007199254740991
  OR p->>'notification_key'<>(CASE WHEN p->>'schema'='custodial.native-schedule-payload.v1' THEN 'schedule-ownership:'||(p->>'service_date')||':'||(p->>'receipt_employee_id')||':09:45' ELSE 'schedule-departure:'||(p->>'service_date')||':'||(p->>'receipt_employee_id')||':'||(p->>'boundary_local')||':projection:'||(p->>'projection_id')||':revision:'||(p->>'source_revision') END)
  THEN RETURN false;END IF;
 FOREACH field IN ARRAY ARRAY['generation_id','receipt_job_id','receipt_credential_id','receipt_employee_id',
  'source_reservation_id','source_operation_id','projection_id','publication_id','version_id','assignment_occurrence_id'] LOOP
  IF p->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false;END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['principal_digest','token_digest','content_sha256','source_window_sha256','server_source_sha256'] LOOP
  IF p->>field !~ '^[0-9a-f]{64}$' THEN RETURN false;END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['source_valid_from','source_valid_until','reservation_at','valid_until'] LOOP
  IF p->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
   OR p->>field<>public.custodial_native_location_utc((p->>field)::timestamptz) THEN RETURN false;END IF;
 END LOOP;
 source_from:=(p->>'source_valid_from')::timestamptz;source_until:=(p->>'source_valid_until')::timestamptz;
 RETURN isfinite(p_at) AND isfinite(p_until) AND source_from<=p_at AND p_at<p_until AND p_until<=source_until
  AND p->>'reservation_at'=public.custodial_native_location_utc(p_at)
  AND p->>'valid_until'=public.custodial_native_location_utc(p_until)
  AND (source_from AT TIME ZONE 'America/Chicago')::date::text=p->>'service_date'
  AND (source_from AT TIME ZONE 'America/Chicago')::time=(p->>'boundary_local')::time
  AND p_sha=public.static_weekly_digest_text(public.custodial_native_location_canonical(p-'content_sha256'))
  AND octet_length(public.custodial_native_location_canonical(p))<=3500;
EXCEPTION WHEN data_exception THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_live(p_job uuid, p_payload jsonb, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE f public.employee_native_schedule_finalizations%rowtype;s public.employee_native_schedule_source_reservations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;j public.operational_notification_jobs%rowtype;
 g public.employee_native_push_generations%rowtype;source_status jsonb;
BEGIN
 IF p_job IS NULL OR p_at IS NULL OR NOT isfinite(p_at) OR coalesce(p_payload->>'schema','') NOT IN('custodial.native-schedule-payload.v1','custodial.native-schedule-payload.v2')
  OR p_payload->>'kind' IS DISTINCT FROM 'employee_schedule_ownership' THEN RETURN false;END IF;
 SELECT * INTO f FROM public.employee_native_schedule_finalizations WHERE job_id=p_job;
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=f.source_reservation_id;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=p_job;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=r.native_generation_id;
 IF f.job_id IS NULL OR r.job_id IS NULL OR s.reservation_id IS NULL OR j.job_id IS NULL OR g.generation_id IS NULL
  OR p_payload IS DISTINCT FROM r.native_payload OR r.source_id IS DISTINCT FROM s.reservation_id
  OR s.generation_id IS DISTINCT FROM r.native_generation_id OR f.content_sha256 IS DISTINCT FROM r.native_payload_sha256
  OR f.source_window_sha256 IS DISTINCT FROM s.source_window_sha256 OR f.finalized_at IS DISTINCT FROM r.prepared_at
  OR f.valid_until IS DISTINCT FROM r.native_valid_until OR r.native_valid_until IS DISTINCT FROM s.valid_until
  OR f.finalized_at>p_at OR p_at>=f.valid_until
  OR public.custodial_native_schedule_receipt_binding(r.native_payload,r.job_id,r.source_id,r.credential_id,r.assignment_epoch,
   r.native_generation_id,r.token_hash,r.prepared_at,r.native_valid_until,r.native_payload_sha256) IS NOT TRUE
  OR j.job_type IS DISTINCT FROM 'employee_native_push' OR j.source_id IS DISTINCT FROM s.reservation_id
  OR j.job_key IS DISTINCT FROM 'employee-schedule-push:'||s.reservation_id::text||':'||r.credential_id::text
  OR j.payload_json IS DISTINCT FROM jsonb_build_object('credential_id',r.credential_id::text,'device_id',g.device_id::text,
   'device_identifier',g.device_identifier,'employee_id',g.employee_id::text,'assignment_epoch',g.assignment_epoch::text,
   'data_json',jsonb_build_object('kind','employee_schedule_ownership','source_reservation_id',s.reservation_id::text)) THEN RETURN false;END IF;
 source_status:=public.custodial_native_schedule_source_status_at(s.operation_id,s.employee_id,s.generation_id,p_at);
 RETURN source_status->'source_current'='true'::jsonb;
EXCEPTION WHEN data_exception THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_observation_originals_at(p_credential uuid, p_credential_hash text, p_jobs jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d public.devices%rowtype;c public.device_auth_credentials%rowtype;g public.employee_native_push_generations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;at_time timestamptz;job text;originals jsonb:='[]';probe jsonb;
BEGIN
 IF p_credential IS NULL OR coalesce(p_credential_hash,'')!~'^[0-9a-f]{64}$' OR jsonb_typeof(p_jobs) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_jobs) NOT BETWEEN 1 AND 16 OR (p_test_at IS NOT NULL AND NOT isfinite(p_test_at)) THEN
  RAISE EXCEPTION 'exact bounded SCHEDULE original lookup required' USING errcode='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_jobs) x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}'!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(p_jobs) x)<>jsonb_array_length(p_jobs) THEN
  RAISE EXCEPTION 'exact unique SCHEDULE original jobs required' USING errcode='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT d0.* INTO d FROM public.devices d0 JOIN public.device_auth_credentials c0 ON c0.device_id=d0.id WHERE c0.credential_id=p_credential FOR SHARE OF d0;
 SELECT * INTO c FROM public.device_auth_credentials WHERE credential_id=p_credential FOR SHARE;
 PERFORM 1 FROM public.employees WHERE id=d.assigned_employee_id FOR SHARE;
 PERFORM 1 FROM public.employee_push_registrations WHERE device_id=d.id ORDER BY registration_id FOR SHARE;
 PERFORM 1 FROM public.employee_native_push_generations WHERE device_id=d.id ORDER BY generation_id FOR SHARE;
 PERFORM 1 FROM public.operational_notification_jobs WHERE job_id IN(SELECT x::uuid FROM jsonb_array_elements_text(p_jobs) x) ORDER BY job_id FOR SHARE;
 PERFORM 1 FROM public.employee_native_push_delivery_receipts WHERE job_id IN(SELECT x::uuid FROM jsonb_array_elements_text(p_jobs) x) ORDER BY job_id FOR SHARE;
 PERFORM 1 FROM public.employee_native_schedule_finalizations WHERE job_id IN(SELECT x::uuid FROM jsonb_array_elements_text(p_jobs) x) ORDER BY job_id FOR SHARE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 IF NOT isfinite(at_time) OR d.id IS NULL OR d.active IS NOT TRUE OR d.device_id!~'^KIOSK_(0[2-9]|10)$'
  OR c.device_id IS DISTINCT FROM d.id OR c.token_hash IS DISTINCT FROM p_credential_hash OR c.confirmed_at IS NULL
  OR c.revoked_at IS NOT NULL OR c.expires_at<=at_time OR NOT EXISTS(SELECT 1 FROM public.employees WHERE id=d.assigned_employee_id AND active AND employee_code~'^EMP[0-9]+$') THEN
  RAISE EXCEPTION 'current SCHEDULE original credential required' USING errcode='42501';END IF;
 FOR job IN SELECT jsonb_array_elements_text(p_jobs) ORDER BY 1 LOOP
  SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=job::uuid;
  SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=r.native_generation_id;
  IF r.job_id IS NULL OR coalesce(r.native_payload->>'schema','') NOT IN('custodial.native-schedule-payload.v1','custodial.native-schedule-payload.v2')
   OR r.credential_id IS DISTINCT FROM c.credential_id OR g.device_id IS DISTINCT FROM d.id
   OR g.device_identifier IS DISTINCT FROM d.device_id OR g.employee_id IS DISTINCT FROM d.assigned_employee_id OR g.assignment_epoch IS DISTINCT FROM d.assignment_epoch THEN CONTINUE;END IF;
  probe:=r.native_payload||jsonb_build_object('record_id',public.custodial_native_schedule_original_record_id(g.generation_id,r.job_id,r.native_payload->>'notification_key'));
  IF public.custodial_native_schedule_event_binding(r.job_id,probe,c.credential_id,at_time) IS NOT TRUE THEN CONTINUE;END IF;
  originals:=originals||jsonb_build_array(jsonb_build_object('job_id',r.job_id::text,'generation_id',g.generation_id::text,
   'source_reservation_id',r.source_id::text,'record_id',probe->>'record_id','notification_key',r.native_payload->>'notification_key',
   'credential_id',c.credential_id::text,'employee_id',d.assigned_employee_id::text,'device_id',d.device_id,'assignment_epoch',d.assignment_epoch::text,
   'principal_digest',g.principal_digest,'token_digest',r.token_hash,'content_sha256',r.native_payload_sha256));
 END LOOP;
 RETURN jsonb_build_object('schema','custodial.native-schedule-observation-originals.v1','originals',originals);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_schedule_original_record_id(p_generation uuid, p_job uuid, p_key text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.employee_native_push_delivery_receipts%rowtype;f public.employee_native_schedule_finalizations%rowtype;
BEGIN
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job;
 IF r.native_payload->>'schema' IN('custodial.native-schedule-payload.v1','custodial.native-schedule-payload.v2') THEN
  SELECT * INTO f FROM public.employee_native_schedule_finalizations WHERE job_id=p_job;
  IF f.job_id IS NULL OR f.source_reservation_id IS DISTINCT FROM r.source_id OR r.native_generation_id IS DISTINCT FROM p_generation
   OR r.native_payload->>'notification_key' IS DISTINCT FROM p_key OR r.native_payload->>'source_reservation_id' IS DISTINCT FROM r.source_id::text
   OR f.content_sha256 IS DISTINCT FROM r.native_payload_sha256 THEN RETURN NULL;END IF;
  RETURN public.static_weekly_digest_text(p_generation::text||E'\n'||f.source_reservation_id::text||E'\n'||p_key);
 END IF;
 -- All four earlier kinds retain exactly their existing identity formula.
 RETURN public.static_weekly_digest_text(p_generation::text||E'\n'||p_job::text||E'\n'||p_key);
END $function$
;

CREATE OR REPLACE FUNCTION public.custodial_native_location_outcome_at(p_binding jsonb, p_evidence jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare receipt public.employee_native_push_delivery_receipts%rowtype;g public.employee_native_push_generations%rowtype;
 prior public.employee_native_location_outcomes%rowtype;terminal public.employee_native_location_outcomes%rowtype;
 expected jsonb;operation uuid;state text;at_time timestamptz;replayed boolean:=false;
begin
 perform public.custodial_begin_application_mutation();
 if jsonb_typeof(p_binding) is distinct from 'object' or jsonb_typeof(p_evidence) is distinct from 'object'
  or octet_length(p_binding::text)>4096 or octet_length(p_evidence::text)>4096
  or (select array_agg(key order by key) from jsonb_object_keys(p_evidence) key) is distinct from array['error_code','operation_id','outcome','provider_message_id']
  or jsonb_typeof(p_evidence->'operation_id') is distinct from 'string' or p_evidence->>'operation_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_evidence->'outcome') is distinct from 'string' or p_evidence->>'outcome' not in ('delivery_outcome_unknown','provider_accepted','known_nonacceptance')
  or jsonb_typeof(p_binding->'receipt_job_id') is distinct from 'string' or p_binding->>'receipt_job_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 then raise exception 'exact native outcome binding/evidence required' using errcode='22023';end if;
 state:=p_evidence->>'outcome';operation:=(p_evidence->>'operation_id')::uuid;
 if state='provider_accepted' then
  if jsonb_typeof(p_evidence->'provider_message_id') is distinct from 'string' or length(p_evidence->>'provider_message_id') not between 1 and 1000
   or p_evidence->>'provider_message_id'<>btrim(p_evidence->>'provider_message_id') or p_evidence->>'provider_message_id' ~ '[[:cntrl:]]'
   or p_evidence->'error_code' is distinct from 'null'::jsonb then raise exception 'exact provider acceptance required' using errcode='22023';end if;
 else
  if p_evidence->'provider_message_id' is distinct from 'null'::jsonb or jsonb_typeof(p_evidence->'error_code') is distinct from 'string'
   or p_evidence->>'error_code' !~ '^[a-z][a-z0-9_]{0,99}$' then raise exception 'bounded outcome diagnostic required' using errcode='22023';end if;
 end if;
 select * into receipt from public.employee_native_push_delivery_receipts where job_id=(p_binding->>'receipt_job_id')::uuid;
 if receipt.native_generation_id is null then raise exception 'original native reservation required' using errcode='42501';end if;
 if exists(select 1 from public.employee_native_location_dispatch_attempts where job_id=receipt.job_id and outcome_operation_id<>operation) then
  raise exception 'original dispatch outcome operation required' using errcode='23505';end if;
 if receipt.native_payload->>'schema'='custodial.native-provider-payload.v1'
  and (receipt.native_payload->>'kind' is distinct from 'employee_lunch_coverage'
   or not exists(select 1 from public.employee_native_lunch_dispatch_attempts
    where job_id=receipt.job_id and outcome_operation_id=operation)) then
  raise exception 'original LUNCH dispatch outcome operation required' using errcode='23505';end if;
 IF receipt.native_payload->>'schema' IN('custodial.native-schedule-payload.v1','custodial.native-schedule-payload.v2') THEN
  RAISE EXCEPTION 'SCHEDULE dispatch/outcome not admitted' USING errcode='42501';END IF;
 select * into g from public.employee_native_push_generations where generation_id=receipt.native_generation_id;
 -- Original ledger settlement remains legal after rotation/removal/lease expiry;
 -- it neither dispatches nor updates a successor registration's health.
 perform 1 from public.devices where id=g.device_id for update;
 perform 1 from public.device_auth_credentials where credential_id=receipt.credential_id for update;
 perform 1 from public.employee_push_registrations where device_id=g.device_id order by registration_id for update;
 perform 1 from public.employee_native_push_generations where generation_id=g.generation_id for update;
 perform 1 from public.operational_notification_jobs where job_id=receipt.job_id for update;
 select r0.* into receipt from public.employee_native_push_delivery_receipts r0 where r0.job_id=receipt.job_id for update;
 expected:=jsonb_build_object('receipt_job_id',receipt.job_id::text,'lease_token',receipt.lease_token::text,
  'registration_id',receipt.registration_id::text,'generation_id',receipt.native_generation_id::text,
  'reservation_at',public.custodial_native_location_utc(receipt.prepared_at),'content_sha256',receipt.native_payload_sha256,
  'token_digest',receipt.token_hash,'principal_digest',receipt.native_payload->>'principal_digest',
  'receipt_credential_id',receipt.credential_id::text,'receipt_assignment_epoch',receipt.assignment_epoch::text,
  'receipt_employee_id',receipt.native_payload->>'receipt_employee_id','receipt_device_id',receipt.native_payload->>'receipt_device_id');
 if p_binding is distinct from expected then raise exception 'original reservation identity mismatch' using errcode='23505';end if;
 select * into prior from public.employee_native_location_outcomes where operation_id=operation;
 if prior.operation_id is not null then
  if prior.binding is distinct from expected or prior.evidence is distinct from p_evidence then raise exception 'outcome operation identity conflict' using errcode='23505';end if;
  replayed:=true;
 else
  select * into terminal from public.employee_native_location_outcomes where job_id=receipt.job_id and outcome<>'delivery_outcome_unknown';
  if terminal.operation_id is not null then raise exception 'original reservation already has exact final outcome' using errcode='23505';end if;
  at_time:=coalesce(p_test_at,clock_timestamp());
  if not isfinite(at_time) or at_time<receipt.prepared_at then raise exception 'outcome server time unavailable';end if;
  insert into public.employee_native_location_outcomes(operation_id,job_id,generation_id,binding,evidence,outcome,server_received_at)
   values(operation,receipt.job_id,receipt.native_generation_id,expected,p_evidence,state,at_time) returning * into prior;
 end if;
 return jsonb_build_object('schema','custodial.native-location-outcome-receipt.v1','binding',prior.binding,'evidence',prior.evidence,
  'server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',replayed,'dispatch_authorized',false);
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
 other_event jsonb;field text;body_digest text;code text;replayed boolean;
begin
 perform public.custodial_begin_application_mutation();
 if p_credential is null or p_native_request is null or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536
  or (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from array['events','schema']
  or p_body->>'schema' is distinct from 'custodial.native-provider-events.v2' or jsonb_typeof(p_body->'events') is distinct from 'array'
  or jsonb_array_length(p_body->'events') not between 1 and 16 then raise exception 'exact native event batch required' using errcode='22023';end if;
 first_event:=p_body->'events'->0;
 for e in select value from jsonb_array_elements(p_body->'events') loop
  perform public.custodial_native_provider_event_shape(e);
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
    admitted:=public.custodial_native_provider_event_time(e#>'{admission_bounds,earliest_at}');
    admitted_last:=public.custodial_native_provider_event_time(e#>'{admission_bounds,latest_at}');
    observed:=case when e#>'{original_observation,earliest_at}'='null'::jsonb then null else public.custodial_native_provider_event_time(e#>'{original_observation,earliest_at}') end;
    observed_last:=case when observed is null then null else public.custodial_native_provider_event_time(e#>'{original_observation,latest_at}') end;
    -- BOTH endpoints for admission; a cutoff-straddling interval grants nothing.
    -- Server receipt can tighten its own upper bound, not rewrite original evidence.
    if admitted<reservation_started or admitted_last>=valid_cutoff or admitted>at_time or observed>at_time then code:='native_provider_observation_invalid';end if;
    if e->>'action'='received' then
     if observed>admitted_last or not public.custodial_native_provider_observation_order(e->'original_observation',e->'admission_bounds') then
      code:='native_provider_observation_invalid';end if;
    else
     select * into received from public.employee_native_provider_events where record_id=e->>'record_id' and action='received';
     if received.event_id is null then code:='native_provider_transition_pending';
     elsif received.original_event->>'schema' is distinct from 'custodial.native-provider-event.v2'
      or received.original_event->'admission_bounds'<>e->'admission_bounds' or received.original_event->>'content_sha256'<>e->>'content_sha256'
      or observed_last<admitted
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
  else results:=results||jsonb_build_array(prior.original_event||jsonb_build_object('schema','custodial.native-provider-event-receipt.v2',
   'admitted_state','ACCEPTED','server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',replayed));end if;
 end loop;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-event-receipts.v2','results',results));
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
    'receipt',prior.original_event||jsonb_build_object('schema','custodial.native-provider-event-receipt.v2',
     'admitted_state','ACCEPTED','server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',true)));
  else
   results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','decision','UNRESOLVED'));
  end if;
 end loop;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-event-decisions.v1',
  'native_request_id',p_native_request::text,'request_body_sha256',p_raw_body_sha256,'requester',requester,'results',results));
end $function$
;

DO $constraint_preimage$ BEGIN IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='public.employee_native_schedule_source_reservations'::regclass AND conname='employee_native_schedule_source_reservations_check'),true) IS DISTINCT FROM 'CHECK ((isfinite(reserved_at) AND isfinite(valid_from) AND isfinite(valid_until) AND valid_from <= reserved_at AND reserved_at < valid_until AND logical_key = ((((''schedule-ownership:''::text || service_date::text) || '':''::text) || employee_id::text) || '':09:45''::text) AND (source_window ->> ''schema''::text) = ''custodial.native-schedule-server-window.v1''::text AND (source_window ->> ''logical_key''::text) = logical_key AND (source_window ->> ''service_date''::text) = service_date::text AND (source_window ->> ''employee_id''::text) = employee_id::text AND (source_window ->> ''generation_id''::text) = generation_id::text AND (source_window ->> ''assignment_occurrence_id''::text) = source_key::text AND (source_window ->> ''server_source_sha256''::text) = source_sha256 AND (source_window ->> ''valid_from''::text) = custodial_native_location_utc(valid_from) AND (source_window ->> ''valid_until''::text) = custodial_native_location_utc(valid_until) AND (source_window ->> ''server_now''::text) = custodial_native_location_utc(reserved_at) AND jsonb_typeof(source_window -> ''before_units''::text) = ''array''::text AND jsonb_typeof(source_window -> ''after_units''::text) = ''array''::text AND (source_window -> ''before_units''::text) IS DISTINCT FROM (source_window -> ''after_units''::text) AND source_window_sha256 = static_weekly_digest_jsonb(source_window) AND octet_length(source_window::text) <= 2097152) IS TRUE)' THEN RAISE EXCEPTION 'Departure actual constraint predecessor differs';END IF;END $constraint_preimage$;
ALTER TABLE public.employee_native_schedule_source_reservations DROP CONSTRAINT employee_native_schedule_source_reservations_check;
ALTER TABLE public.employee_native_schedule_source_reservations ADD CONSTRAINT employee_native_schedule_source_reservations_check CHECK ((isfinite(reserved_at) AND isfinite(valid_from) AND isfinite(valid_until) AND valid_from <= reserved_at AND reserved_at < valid_until AND ((logical_key = (((('schedule-ownership:'::text || service_date::text) || ':'::text) || employee_id::text) || ':09:45'::text) AND (source_window ->> 'schema'::text) = 'custodial.native-schedule-server-window.v1'::text) OR ((source_window->>'schema')='custodial.native-schedule-server-window.v2'
 AND (valid_from AT TIME ZONE 'America/Chicago')::date=service_date
 AND extract(second FROM (valid_from AT TIME ZONE 'America/Chicago'))=0
 AND (valid_from AT TIME ZONE 'America/Chicago')::time<>time '09:45'
 AND (source_window->>'projection_id')~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 AND (source_window->>'source_revision')~'^[1-9][0-9]{0,15}$'
 AND (source_window->>'source_revision')::numeric<=9007199254740991
 AND logical_key='schedule-departure:'||service_date::text||':'||employee_id::text||':'||to_char(valid_from AT TIME ZONE 'America/Chicago','HH24:MI')
  ||':projection:'||(source_window->>'projection_id')||':revision:'||(source_window->>'source_revision'))) AND (source_window ->> 'logical_key'::text) = logical_key AND (source_window ->> 'service_date'::text) = service_date::text AND (source_window ->> 'employee_id'::text) = employee_id::text AND (source_window ->> 'generation_id'::text) = generation_id::text AND (source_window ->> 'assignment_occurrence_id'::text) = source_key::text AND (source_window ->> 'server_source_sha256'::text) = source_sha256 AND (source_window ->> 'valid_from'::text) = custodial_native_location_utc(valid_from) AND (source_window ->> 'valid_until'::text) = custodial_native_location_utc(valid_until) AND (source_window ->> 'server_now'::text) = custodial_native_location_utc(reserved_at) AND jsonb_typeof(source_window -> 'before_units'::text) = 'array'::text AND jsonb_typeof(source_window -> 'after_units'::text) = 'array'::text AND (source_window -> 'before_units'::text) IS DISTINCT FROM (source_window -> 'after_units'::text) AND source_window_sha256 = static_weekly_digest_jsonb(source_window) AND octet_length(source_window::text) <= 2097152) IS TRUE);
-- The closed check plus UNIQUE(logical_key) retains one canonical v1 09:45
-- notice per employee/day; distinct source-bound v2 boundaries can coexist.
-- Retain the same recovery identity and validate existing data; never CASCADE.
ALTER TABLE public.employee_native_schedule_source_reservations DROP CONSTRAINT employee_native_schedule_source_re_employee_id_service_date_key;
ALTER TABLE public.employee_native_schedule_source_reservations ADD CONSTRAINT employee_native_schedule_source_re_employee_id_service_date_key UNIQUE (employee_id, service_date, logical_key);
REVOKE ALL ON FUNCTION public.custodial_native_departure_window_source_at(uuid,uuid,uuid,timestamp with time zone) FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
REVOKE ALL ON FUNCTION public.custodial_native_departure_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamp with time zone) FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
REVOKE ALL ON FUNCTION public.custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid) FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.custodial_native_departure_preparation_source_at(uuid,uuid,uuid,timestamp with time zone) FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
REVOKE ALL ON FUNCTION public.custodial_native_departure_preparation_source(uuid,uuid,uuid) FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_departure_preparation_source(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.custodial_native_departure_source_requests_at(timestamp with time zone) FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
REVOKE ALL ON FUNCTION public.custodial_native_departure_source_requests() FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_departure_source_requests() TO service_role;
-- The observed live canary differs from the reconstruction only by four
-- row placements. Accept exactly these two byte fingerprints and preserve
-- whichever original order is installed; never replace it with fixture order.
DO $canary_successor$ DECLARE definition text;expected_sha text;BEGIN
 SELECT definition_sql INTO STRICT definition FROM departure_functions_before WHERE oid='custodial_release_canary_authority_surface()'::regprocedure;
 IF public.static_weekly_digest_text(definition) NOT IN ('a60ddcc37b6affa49becbb5adb76a96a9bcd2dc25b6c7fec6085311346042224','55fe3e609c8a145f946602c6fbf16df4aa1eab410f50e048b778e7f4bfe72b33' )
  OR (length(definition)-length(replace(definition,'  values
','')))<>length('  values
' )
 THEN RAISE EXCEPTION 'Departure exact canary insertion point differs';END IF;
 expected_sha:=CASE public.static_weekly_digest_text(definition)
  WHEN 'a60ddcc37b6affa49becbb5adb76a96a9bcd2dc25b6c7fec6085311346042224' THEN '9fb58aa1cc709260dc7d3c047bb9b77e9877f786d655e9de0c31e8c114fd6e3d'
 ELSE '3c9f6e93251d05ca632bf141e4ec75b57371e9f980b64e145270f38b7db6b634' END;
 EXECUTE replace(definition,'  values
','  values
    (''function'',''custodial_native_departure_window_source_at(uuid,uuid,uuid,timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''grant'',''custodial_native_departure_window_source_at(uuid,uuid,uuid,timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''function'',''custodial_native_departure_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''grant'',''custodial_native_departure_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''function'',''custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid)'',''Departure v2; exact source and existing native admission required''),
    (''grant'',''custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid)'',''Departure v2; exact source and existing native admission required''),
    (''function'',''custodial_native_departure_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''grant'',''custodial_native_departure_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''function'',''custodial_native_departure_preparation_source(uuid,uuid,uuid)'',''Departure v2; exact source and existing native admission required''),
    (''grant'',''custodial_native_departure_preparation_source(uuid,uuid,uuid)'',''Departure v2; exact source and existing native admission required''),
    (''function'',''custodial_native_departure_source_requests_at(timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''grant'',''custodial_native_departure_source_requests_at(timestamp with time zone)'',''Departure v2; exact source and existing native admission required''),
    (''function'',''custodial_native_departure_source_requests()'',''Departure v2; exact source and existing native admission required''),
    (''grant'',''custodial_native_departure_source_requests()'',''Departure v2; exact source and existing native admission required''),
' );
 IF public.static_weekly_digest_text(pg_get_functiondef('custodial_release_canary_authority_surface()'::regprocedure)) IS DISTINCT FROM expected_sha
 THEN RAISE EXCEPTION 'Departure exact canary successor differs';END IF;
END $canary_successor$;

ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $rebind$ DECLARE obj record;kind text;identity text;definition text;next_order integer;changed integer;BEGIN
 FOR obj IN SELECT oid FROM pg_proc WHERE oid IN('custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)'::regprocedure,'custodial_native_schedule_preparation_source(uuid,uuid,uuid)'::regprocedure,'custodial_native_schedule_content_source(uuid,uuid,uuid)'::regprocedure,'custodial_native_schedule_source_status(uuid,uuid,uuid)'::regprocedure,'custodial_native_schedule_job_prepare(uuid,jsonb,uuid)'::regprocedure,'custodial_native_schedule_finalize(uuid,uuid,uuid,jsonb)'::regprocedure,'custodial_native_schedule_dispatch_prepare(uuid,uuid,uuid,jsonb)'::regprocedure,'custodial_native_schedule_target(uuid,uuid)'::regprocedure,'custodial_native_schedule_outcome(jsonb,jsonb)'::regprocedure,'custodial_native_schedule_observation_originals(uuid,text,jsonb)'::regprocedure,'custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,'custodial_native_schedule_content_source_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,'custodial_native_schedule_finalize_at(uuid,uuid,uuid,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_schedule_receipt_binding(jsonb,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone,timestamp with time zone,text)'::regprocedure,'custodial_native_schedule_live(uuid,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_schedule_original_record_id(uuid,uuid,text)'::regprocedure,'custodial_native_location_outcome_at(jsonb,jsonb,timestamp with time zone)'::regprocedure,'custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamp with time zone)'::regprocedure,'public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'::regprocedure,'custodial_release_canary_authority_surface()'::regprocedure,'public.custodial_native_departure_window_source_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,'public.custodial_native_departure_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamp with time zone)'::regprocedure,'public.custodial_native_departure_source_reserve(uuid,uuid,uuid,text,uuid)'::regprocedure,'public.custodial_native_departure_preparation_source_at(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,'public.custodial_native_departure_preparation_source(uuid,uuid,uuid)'::regprocedure,'public.custodial_native_departure_source_requests_at(timestamp with time zone)'::regprocedure,'public.custodial_native_departure_source_requests()'::regprocedure ) LOOP
  FOR kind,identity,definition IN SELECT 'function',obj.oid::regprocedure::text,pg_get_functiondef(obj.oid)
   UNION ALL SELECT 'grant',obj.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(obj.oid::regprocedure::text) LOOP
   -- Existing grants are unchanged; retain their original evidence rows.
   IF kind='grant' AND EXISTS(SELECT 1 FROM departure_functions_before WHERE oid=obj.oid) THEN CONTINUE;END IF;
   UPDATE public.custodial_release_authority_restore_inventory i SET definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    WHERE i.object_kind=kind AND CASE WHEN i.object_kind IN('function','grant') AND i.object_identity LIKE '%(%' THEN to_regprocedure(i.object_identity)=obj.oid ELSE false END;
   GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'Departure duplicate recovery identity';END IF;
   IF changed=0 THEN
    SELECT n INTO next_order FROM generate_series(CASE WHEN kind='grant' THEN 900001 ELSE 100001 END,
     CASE WHEN kind='grant' THEN 999998 ELSE 199998 END) n WHERE NOT EXISTS(
      SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
    IF next_order IS NULL OR definition IS NULL THEN RAISE EXCEPTION 'Departure recovery slot unavailable';END IF;
    INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     VALUES(next_order,kind,identity,definition,public.static_weekly_digest_text(definition));
   END IF;
  END LOOP;
 END LOOP;
 FOR identity IN SELECT unnest(ARRAY['employee_native_schedule_source_reservations_check','employee_native_schedule_source_re_employee_id_service_date_key']) LOOP
  SELECT format('select public.custodial_release_authority_restore_constraint(%L,%L,%L);',
  'public.employee_native_schedule_source_reservations',identity,pg_get_constraintdef(oid,true))
  INTO definition FROM pg_constraint WHERE conrelid='public.employee_native_schedule_source_reservations'::regclass AND conname=identity;
  IF definition IS NULL THEN RAISE EXCEPTION 'Departure constraint recovery definition absent';END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=definition,
  definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
  WHERE object_kind='constraint' AND object_identity='public.employee_native_schedule_source_reservations:'||identity;
  GET DIAGNOSTICS changed=row_count;IF changed<>1 THEN RAISE EXCEPTION 'Departure constraint recovery count differs';END IF;
 END LOOP;
END $rebind$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT 1 FROM departure_functions_before b LEFT JOIN pg_proc p ON p.oid=b.oid
  WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl)
 THEN RAISE EXCEPTION 'Departure changed existing owner or ACL';END IF;
 IF EXISTS(SELECT i.* FROM departure_inventory_before i WHERE NOT(
  (i.object_kind='function' AND EXISTS(SELECT 1 FROM departure_functions_before f WHERE CASE WHEN i.object_kind='function' THEN to_regprocedure(i.object_identity)=f.oid ELSE false END))
  OR (i.object_kind='constraint' AND i.object_identity IN('public.employee_native_schedule_source_reservations:employee_native_schedule_source_reservations_check','public.employee_native_schedule_source_reservations:employee_native_schedule_source_re_employee_id_service_date_key')))
  EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
 THEN RAISE EXCEPTION 'Departure changed unrelated recovery rows';END IF;
 IF EXISTS(SELECT * FROM departure_canary_before EXCEPT SELECT * FROM public.custodial_release_canary_authority_surface())
 THEN RAISE EXCEPTION 'Departure removed original canary membership';END IF;
END $scope$;
COMMIT;

