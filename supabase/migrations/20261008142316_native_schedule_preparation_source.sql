-- Read-only source-to-job projection. No timer, producer, native dispatch,
-- clock/audio qualification or client table access is activated.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.custodial_native_schedule_preparation_source_at(p_source uuid,p_employee uuid,p_generation uuid,p_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE window_reply jsonb;w jsonb;g public.employee_native_push_generations%rowtype;expected jsonb;preparation jsonb;
BEGIN
 IF p_source IS NULL OR p_employee IS NULL OR p_generation IS NULL OR p_at IS NULL OR NOT isfinite(p_at) THEN
  RAISE EXCEPTION 'exact SCHEDULE preparation source/actor/time required' USING errcode='22023';END IF;
 window_reply:=public.custodial_native_schedule_window_source_at(p_source,p_employee,p_generation,p_at);
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
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_preparation_source(uuid,uuid,uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_preparation_source_at($1,$2,$3,statement_timestamp());
$fn$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_preparation_source_at(uuid,uuid,uuid,timestamptz),public.custodial_native_schedule_preparation_source(uuid,uuid,uuid)
 FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_preparation_source(uuid,uuid,uuid) TO service_role;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_preparation_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE preparation captured canary/ALWAYS guard changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''function'',''custodial_native_schedule_preparation_source(uuid,uuid,uuid)'',''service-only current source/native recipient projection; no delivery''),\n'
  ||E'    (''grant'',''custodial_native_schedule_preparation_source(uuid,uuid,uuid)'',''service-only; no table or send access''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE preparation canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;definition text;kind text;identity text;BEGIN
 FOR obj IN SELECT p.oid FROM pg_proc p WHERE p.oid=ANY(ARRAY[
  'public.custodial_native_schedule_preparation_source_at(uuid,uuid,uuid,timestamptz)'::regprocedure,
  'public.custodial_native_schedule_preparation_source(uuid,uuid,uuid)'::regprocedure,'public.custodial_release_canary_authority_surface()'::regprocedure]) LOOP
  FOR kind,identity,definition IN SELECT 'function',obj.oid::regprocedure::text,pg_get_functiondef(obj.oid)
   UNION ALL SELECT 'grant',obj.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(obj.oid::regprocedure::text) LOOP
   UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=CASE WHEN kind='grant'
    THEN public.custodial_release_authority_current_grant_definition(object_identity) ELSE definition END,
    definition_sha256=public.static_weekly_digest_text(CASE WHEN kind='grant'
     THEN public.custodial_release_authority_current_grant_definition(object_identity) ELSE definition END),captured_at=statement_timestamp()
    WHERE object_kind=kind AND (object_identity=identity OR (object_identity LIKE '%(%' AND identity LIKE '%(%'
     AND to_regprocedure(object_identity)=obj.oid));
   GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'SCHEDULE preparation recovery duplicate';END IF;
   IF changed=0 THEN SELECT n INTO next_order FROM generate_series(CASE WHEN kind='grant' THEN 900001 ELSE 100001 END,
     CASE WHEN kind='grant' THEN 999998 ELSE 199998 END) n WHERE NOT EXISTS(
      SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
    IF next_order IS NULL OR definition IS NULL THEN RAISE EXCEPTION 'SCHEDULE preparation recovery object/order missing';END IF;
    INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     VALUES(next_order,kind,identity,definition,public.static_weekly_digest_text(definition));END IF;
  END LOOP;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_preparation_inventory_before i WHERE NOT(object_identity='custodial_release_canary_authority_surface()'
  AND object_kind IN('function','grant')) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE preparation inventory changed';END IF;
END $scope$;
COMMIT;
