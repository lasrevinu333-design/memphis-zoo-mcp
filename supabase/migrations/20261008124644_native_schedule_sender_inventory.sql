-- Source/transport contract only. No producer/worker/profile activation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.custodial_native_schedule_target_at(p_job uuid,p_lease uuid,p_test_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE m public.employee_native_schedule_jobs%rowtype;j public.operational_notification_jobs%rowtype;
 d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;s public.employee_native_schedule_source_reservations%rowtype;
 at_time timestamptz;expected jsonb;content jsonb;
BEGIN
 PERFORM public.custodial_begin_application_mutation();
 IF p_job IS NULL OR p_lease IS NULL OR (p_test_at IS NOT NULL AND NOT isfinite(p_test_at)) THEN
  RAISE EXCEPTION 'exact SCHEDULE target job/lease required' USING errcode='22023';END IF;
 SELECT * INTO m FROM public.employee_native_schedule_jobs WHERE job_id=p_job;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT d0.* INTO d FROM public.devices d0 JOIN public.device_auth_credentials c0 ON c0.device_id=d0.id
  WHERE c0.credential_id=(m.expected->>'credential_id')::uuid FOR UPDATE OF d0;
 SELECT * INTO c FROM public.device_auth_credentials WHERE credential_id=(m.expected->>'credential_id')::uuid FOR UPDATE;
 PERFORM 1 FROM public.employees WHERE id=d.assigned_employee_id FOR SHARE;
 PERFORM 1 FROM public.employee_push_registrations WHERE device_id=d.id ORDER BY registration_id FOR UPDATE;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=(m.expected->>'generation_id')::uuid FOR UPDATE;
 SELECT * INTO r FROM public.employee_push_registrations WHERE registration_id=g.registration_id;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=p_job FOR UPDATE;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=m.source_reservation_id FOR UPDATE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 -- A missing owned job/source is ordinary unavailability, not a request to
 -- call the strict original-content RPC with NULL actor/operation identity.
 IF m.job_id IS NULL OR s.reservation_id IS NULL THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-target.v1','current',false,
   'delivery_admitted',false,'reason','native_schedule_target_unavailable');END IF;
 expected:=jsonb_build_object('assignment_epoch',d.assignment_epoch::text,'credential_id',c.credential_id::text,
  'device_id',d.device_id,'employee_id',d.assigned_employee_id::text,'generation_id',g.generation_id::text,
  'principal_digest',g.principal_digest,'registration_id',r.registration_id::text,'token_digest',g.token_digest);
 content:=public.custodial_native_schedule_content_source_at(s.operation_id,s.employee_id,s.generation_id,at_time);
 IF m.job_id IS NULL OR j.job_id IS NULL OR s.reservation_id IS NULL OR d.id IS NULL OR c.credential_id IS NULL OR g.generation_id IS NULL
  OR r.registration_id IS NULL OR NOT isfinite(at_time) OR m.expected IS DISTINCT FROM expected
  OR d.active IS NOT TRUE OR c.confirmed_at IS NULL OR c.revoked_at IS NOT NULL OR c.expires_at<=at_time
  OR g.revoked_at IS NOT NULL OR g.dispatch_retired_at IS NOT NULL OR g.activated_at>at_time
  OR g.device_id IS DISTINCT FROM d.id OR g.credential_id IS DISTINCT FROM c.credential_id
  OR g.employee_id IS DISTINCT FROM d.assigned_employee_id OR g.assignment_epoch IS DISTINCT FROM d.assignment_epoch
  OR g.device_identifier IS DISTINCT FROM d.device_id OR c.device_id IS DISTINCT FROM d.id
  OR r.active IS NOT TRUE OR r.revoked_at IS NOT NULL OR r.platform IS DISTINCT FROM 'android'
  OR r.device_id IS DISTINCT FROM d.id OR r.credential_id IS DISTINCT FROM c.credential_id
  OR r.employee_id IS DISTINCT FROM d.assigned_employee_id OR r.assignment_epoch IS DISTINCT FROM d.assignment_epoch
  OR r.token_hash IS DISTINCT FROM g.token_digest OR public.static_weekly_digest_text(r.fcm_token) IS DISTINCT FROM g.token_digest
  OR NOT EXISTS(SELECT 1 FROM public.employees WHERE id=d.assigned_employee_id AND active AND employee_code~'^EMP[0-9]+$')
  OR s.generation_id IS DISTINCT FROM g.generation_id OR s.employee_id IS DISTINCT FROM d.assigned_employee_id
  OR m.source_window_sha256 IS DISTINCT FROM s.source_window_sha256 OR j.source_id IS DISTINCT FROM s.reservation_id
  OR j.status IS DISTINCT FROM 'leased' OR j.lease_token IS DISTINCT FROM p_lease OR j.leased_until IS NULL OR j.leased_until<=at_time
  OR j.job_type IS DISTINCT FROM 'employee_native_push' OR j.job_key IS DISTINCT FROM 'employee-schedule-push:'||s.reservation_id::text||':'||c.credential_id::text
  OR j.payload_json IS DISTINCT FROM jsonb_build_object('credential_id',c.credential_id::text,'device_id',d.id::text,
   'device_identifier',d.device_id,'employee_id',d.assigned_employee_id::text,'assignment_epoch',d.assignment_epoch::text,
   'data_json',jsonb_build_object('kind','employee_schedule_ownership','source_reservation_id',s.reservation_id::text))
  OR content->>'status' IS DISTINCT FROM 'CONTENT_CURRENT_SOURCE_ONLY'
  OR EXISTS(SELECT 1 FROM public.employee_native_schedule_dispatch_attempts WHERE job_id=p_job) THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-target.v1','current',false,
   'delivery_admitted',false,'reason','native_schedule_target_unavailable');END IF;
 RETURN jsonb_build_object('schema','custodial.native-schedule-target.v1','current',true,'delivery_admitted',false,
  'expected',expected,'token',r.fcm_token,'source_candidate',content->'candidate');
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_target(uuid,uuid)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_target_at($1,$2,null);
$fn$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_target_at(uuid,uuid,timestamptz),public.custodial_native_schedule_target(uuid,uuid)
 FROM PUBLIC,postgres,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_target(uuid,uuid) TO service_role;

-- Preserve the entire old inventory query except these exact SCHEDULE seams.
DO $rows$ DECLARE fn regprocedure:='public.custodial_native_location_inventory_rows(uuid,text,jsonb,timestamptz)'::regprocedure;definition text;body text;changed text;acl aclitem[];BEGIN
 SELECT prosrc,proacl INTO body,acl FROM pg_proc WHERE oid=fn;definition:=pg_get_functiondef(fn);
 IF public.static_weekly_digest_text(body) IS DISTINCT FROM 'a083d6b510b7a6eb1cece86fc5a0bb079ae8f7a3ed2cacbfabacc87e29f8e27d'
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
   AND to_regprocedure(object_identity)=fn AND definition_sql=definition AND definition_sha256=public.static_weekly_digest_text(definition)) THEN
  RAISE EXCEPTION 'SCHEDULE outcome inventory exact predecessor changed';END IF;
 changed:=replace(replace(body,$old$SELECT r.job_id,r.prepared_at,r.native_payload,'prepared'::text
 FROM public.employee_native_schedule_finalizations f
 JOIN public.employee_native_push_delivery_receipts r ON r.job_id=f.job_id$old$,$new$SELECT r.job_id,r.prepared_at,r.native_payload,coalesce(o.evidence->>'outcome','prepared')::text
 FROM public.employee_native_schedule_finalizations f
 JOIN public.employee_native_push_delivery_receipts r ON r.job_id=f.job_id
 LEFT JOIN public.employee_native_schedule_outcomes o ON o.job_id=f.job_id$new$),$old$AND public.custodial_native_schedule_live(r.job_id,r.native_payload,p_at) IS TRUE;$old$,$new$AND coalesce(o.evidence->>'outcome','prepared') IN('prepared','delivery_outcome_unknown','provider_accepted')
  AND public.custodial_native_schedule_live(r.job_id,r.native_payload,p_at) IS TRUE;$new$);
 IF changed=body OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1 THEN
  RAISE EXCEPTION 'SCHEDULE outcome inventory seam changed';END IF;
 EXECUTE replace(definition,body,changed);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'SCHEDULE outcome inventory ACL changed';END IF;
END $rows$;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_sender_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE sender inventory captured canary/ALWAYS guard changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''function'',''custodial_native_schedule_target(uuid,uuid)'',''service-only source-current recipient/token before final attempt''),\n'
  ||E'    (''grant'',''custodial_native_schedule_target(uuid,uuid)'',''service-only target; no client access''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE sender inventory canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'custodial_native_schedule_target_at','custodial_native_schedule_target','custodial_native_location_inventory_rows','custodial_release_canary_authority_surface')),
 objects AS(SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs)
 SELECT * FROM objects ORDER BY bucket,identity LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'SCHEDULE sender inventory recovery object missing';END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'SCHEDULE sender inventory recovery duplicate';END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,obj.bucket+99998) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE sender inventory recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_sender_inventory_before i WHERE NOT((object_identity='custodial_release_canary_authority_surface()' AND object_kind IN('function','grant'))
  OR (object_kind IN('function','grant') AND object_identity LIKE 'custodial_native_location_inventory_rows(%')) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE sender inventory recovery row changed';END IF;
END $scope$;
COMMIT;
