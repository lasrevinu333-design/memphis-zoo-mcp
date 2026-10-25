-- Server-derived personalized09:45 CONTENT candidate only. No provider job,
-- native receipt/wire, final clock/effect, send, retention or activation right.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.custodial_native_schedule_content_source_at(p_operation_id uuid,p_employee_id uuid,p_generation_id uuid,p_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE source_status jsonb;r jsonb;w jsonb;candidate jsonb;
BEGIN
 source_status:=public.custodial_native_schedule_source_status_at(p_operation_id,p_employee_id,p_generation_id,p_at);
 IF source_status->'source_current' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-content-source.v1','status','CONTENT_SOURCE_UNAVAILABLE',
   'dispatch_authorized',false,'delivery_admitted',false,'source_status',source_status,'candidate',null);END IF;
 r:=source_status->'reservation';w:=r->'window';
 candidate:=jsonb_build_object('schema','custodial.native-schedule-content-candidate.v1','kind','employee_schedule_ownership',
  'notification_type','schedule_ownership','title','9:45 assignment update',
  'body',(w->>'employee_name')||', your scheduled responsibilities have changed at 9:45 AM. Please see your Schedule page for your updated assignments.',
  'channel_id','employee-schedule-ownership','route','employee-schedule.html?hub=employee','notification_key',w->>'logical_key',
  'service_date',w->>'service_date','boundary_local','09:45','employee_id',w->>'employee_id','generation_id',w->>'generation_id',
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
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_content_source(uuid,uuid,uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_content_source_at($1,$2,$3,statement_timestamp());
$fn$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_content_source_at(uuid,uuid,uuid,timestamptz),
 public.custodial_native_schedule_content_source(uuid,uuid,uuid) FROM PUBLIC,postgres,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_content_source(uuid,uuid,uuid) TO service_role;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_content_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE content captured canary/ALWAYS guard changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''function'',''custodial_native_schedule_content_source(uuid,uuid,uuid)'',''accepted source-only personalized09:45content; no send''),\n'
  ||E'    (''grant'',''custodial_native_schedule_content_source(uuid,uuid,uuid)'',''service-only content read; no send''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE content canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'custodial_native_schedule_content_source_at','custodial_native_schedule_content_source','custodial_release_canary_authority_surface')),
 objects AS(SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs)
 SELECT * FROM objects ORDER BY bucket,identity LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'SCHEDULE content recovery object missing';END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'SCHEDULE content recovery duplicate';END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,obj.bucket+99998) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE content recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_content_inventory_before i WHERE NOT(object_identity='custodial_release_canary_authority_surface()'
  AND object_kind IN('function','grant')) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE content recovery row changed';END IF;
END $scope$;
COMMIT;
