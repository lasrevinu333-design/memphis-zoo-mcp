-- Read-only normal-source discovery. No producer, reservation, job or sender
-- activation. Time comes from the wrapper's PostgreSQL statement, not clients.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.custodial_native_schedule_source_requests_at(p_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE day date;a record;actor record;anchor uuid;target jsonb;requests jsonb:='[]';authority jsonb;status text;
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
   FOR actor IN SELECT g.generation_id,g.employee_id FROM public.employee_native_push_generations g
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
       AND (v#>>'{shift,start}')::time<=time '09:45' AND (v#>>'{shift,end}')::time>time '09:45')=1
    ORDER BY g.employee_id,g.generation_id LOOP
    SELECT o.occurrence_id INTO anchor FROM public.weekly_schedule_occurrences o
     WHERE o.projection_id=a.projection_id AND o.publication_id=a.publication_id AND o.version_id=a.version_id
      AND o.service_date=day AND o.state='created' AND o.coverage_start<=time '09:45' AND o.coverage_end>=time '09:45'
      AND o.coverage_start<o.coverage_end AND (o.owner_person_id_snapshot=actor.employee_id OR EXISTS(
       SELECT 1 FROM public.static_weekly_v8_read_lunch_segments(day) l
        WHERE l.projection_id=a.projection_id AND l.normal_occurrence_id=o.occurrence_id
         AND l.normal_owner_id=o.owner_person_id_snapshot AND l.coverer_id=actor.employee_id
         AND l.coverage_start<=time '09:45' AND l.coverage_end>=time '09:45' AND l.coverage_start<l.coverage_end))
     ORDER BY o.occurrence_id LIMIT 1;
    IF anchor IS NULL THEN CONTINUE;END IF;
    -- Reuse the actual current recipient/source validator; registrations alone
    -- never establish current target identity. No token is returned.
    target:=public.custodial_native_target_source_at('SCHEDULE',anchor,actor.employee_id,actor.generation_id,p_at);
    IF target->>'status' IS DISTINCT FROM 'SOURCE_ONLY_POLICY_MISSING' THEN CONTINUE;END IF;
    IF target#>>'{source,source_id}' IS DISTINCT FROM a.projection_id::text
     OR target#>>'{source,publication_id}' IS DISTINCT FROM a.publication_id::text
     OR target#>>'{source,version_id}' IS DISTINCT FROM a.version_id::text
     OR target#>>'{source,source_revision}' IS DISTINCT FROM a.projection_authority_revision::text THEN
     RAISE EXCEPTION 'native source discovery snapshot binding changed' USING errcode='22023';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(requests) r WHERE r->>'employee_id'=actor.employee_id::text) THEN
     status:='SOURCE_AMBIGUOUS';requests:='[]';authority:=null;EXIT;END IF;
    IF jsonb_array_length(requests)>=4096 THEN status:='SOURCE_LIMIT_EXCEEDED';requests:='[]';authority:=null;EXIT;END IF;
    requests:=requests||jsonb_build_array(jsonb_build_object('source_key',anchor,'employee_id',actor.employee_id,'generation_id',actor.generation_id));
   END LOOP;
  END IF;
 END IF;
 RETURN jsonb_build_object('schema','custodial.native-schedule-source-requests.v1','status',status,
  'service_date',day,'timezone','America/Chicago','authority',authority,'requests',requests,
  'dispatch_authorized',false,'delivery_admitted',false,'clock_effect_authority',null,'retention_authority',null);
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_source_requests()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_source_requests_at(statement_timestamp());
$fn$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_source_requests_at(timestamptz),public.custodial_native_schedule_source_requests()
 FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_source_requests() TO service_role;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_discovery_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE discovery captured canary/ALWAYS guard changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''function'',''custodial_native_schedule_source_requests()'',''service-only current recurring recipient/anchor discovery; source-only''),\n'
  ||E'    (''grant'',''custodial_native_schedule_source_requests()'',''service-only; no client table or send access''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE discovery canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;definition text;kind text;identity text;BEGIN
 FOR obj IN SELECT p.oid FROM pg_proc p WHERE p.oid=ANY(ARRAY[
  'public.custodial_native_schedule_source_requests_at(timestamptz)'::regprocedure,
  'public.custodial_native_schedule_source_requests()'::regprocedure,'public.custodial_release_canary_authority_surface()'::regprocedure])
  ORDER BY p.oid::regprocedure::text COLLATE "C" LOOP
  FOR kind,identity,definition IN SELECT 'function',obj.oid::regprocedure::text,pg_get_functiondef(obj.oid)
   UNION ALL SELECT 'grant',obj.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(obj.oid::regprocedure::text) LOOP
   UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=CASE WHEN kind='grant'
    THEN public.custodial_release_authority_current_grant_definition(object_identity) ELSE definition END,
    definition_sha256=public.static_weekly_digest_text(CASE WHEN kind='grant'
     THEN public.custodial_release_authority_current_grant_definition(object_identity) ELSE definition END),captured_at=statement_timestamp()
    WHERE object_kind=kind AND (object_identity=identity OR (object_identity LIKE '%(%' AND identity LIKE '%(%'
     AND to_regprocedure(object_identity)=obj.oid));
   GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'SCHEDULE discovery recovery duplicate';END IF;
   IF changed=0 THEN SELECT n INTO next_order FROM generate_series(CASE WHEN kind='grant' THEN 900001 ELSE 100001 END,
     CASE WHEN kind='grant' THEN 999998 ELSE 199998 END) n WHERE NOT EXISTS(
      SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
    IF next_order IS NULL OR definition IS NULL THEN RAISE EXCEPTION 'SCHEDULE discovery recovery object/order missing';END IF;
    INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     VALUES(next_order,kind,identity,definition,public.static_weekly_digest_text(definition));END IF;
  END LOOP;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_discovery_inventory_before i WHERE NOT(object_identity='custodial_release_canary_authority_surface()'
  AND object_kind IN('function','grant')) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE discovery inventory changed';END IF;
END $scope$;
COMMIT;
