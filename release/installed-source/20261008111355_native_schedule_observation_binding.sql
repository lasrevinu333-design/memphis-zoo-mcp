-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
-- Exact SCHEDULE original observation identity, not a new notification/send
-- or native clock/profile/retention authority. Existing v2 fields are retained.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- BEGIN FINITE NEW-CREATOR PROFILE 108
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_108_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_original_record_id','custodial_native_schedule_event_binding','custodial_native_schedule_observation_originals_at','custodial_native_schedule_observation_originals']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_native_schedule_original_record_id','custodial_native_schedule_event_binding','custodial_native_schedule_observation_originals_at','custodial_native_schedule_observation_originals']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source108 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_108_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 108
CREATE FUNCTION public.custodial_native_schedule_original_record_id(p_generation uuid,p_job uuid,p_key text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r public.employee_native_push_delivery_receipts%rowtype;f public.employee_native_schedule_finalizations%rowtype;
BEGIN
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job;
 IF r.native_payload->>'schema'='custodial.native-schedule-payload.v1' THEN
  SELECT * INTO f FROM public.employee_native_schedule_finalizations WHERE job_id=p_job;
  IF f.job_id IS NULL OR f.source_reservation_id IS DISTINCT FROM r.source_id OR r.native_generation_id IS DISTINCT FROM p_generation
   OR r.native_payload->>'notification_key' IS DISTINCT FROM p_key OR r.native_payload->>'source_reservation_id' IS DISTINCT FROM r.source_id::text
   OR f.content_sha256 IS DISTINCT FROM r.native_payload_sha256 THEN RETURN NULL;END IF;
  RETURN public.static_weekly_digest_text(p_generation::text||E'\n'||f.source_reservation_id::text||E'\n'||p_key);
 END IF;
 -- All four earlier kinds retain exactly their existing identity formula.
 RETURN public.static_weekly_digest_text(p_generation::text||E'\n'||p_job::text||E'\n'||p_key);
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_event_binding(p_job uuid,p_event jsonb,p_credential uuid,p_at timestamptz)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE f public.employee_native_schedule_finalizations%rowtype;s public.employee_native_schedule_source_reservations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;g public.employee_native_push_generations%rowtype;field text;
BEGIN
 IF p_job IS NULL OR p_credential IS NULL OR p_at IS NULL OR NOT isfinite(p_at) THEN RETURN false;END IF;
 SELECT * INTO f FROM public.employee_native_schedule_finalizations WHERE job_id=p_job;
 SELECT * INTO r FROM public.employee_native_push_delivery_receipts WHERE job_id=p_job;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=f.source_reservation_id;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=r.native_generation_id;
 IF f.job_id IS NULL OR s.reservation_id IS NULL OR r.job_id IS NULL OR g.generation_id IS NULL
  OR r.credential_id IS DISTINCT FROM p_credential OR g.credential_id IS DISTINCT FROM p_credential OR g.revoked_at IS NOT NULL
  OR r.native_generation_id IS DISTINCT FROM s.generation_id OR r.source_id IS DISTINCT FROM s.reservation_id
  OR r.registration_id IS DISTINCT FROM g.registration_id OR r.assignment_epoch IS DISTINCT FROM g.assignment_epoch
  OR r.token_hash IS DISTINCT FROM g.token_digest OR r.native_payload->>'principal_digest' IS DISTINCT FROM g.principal_digest
  OR r.native_payload->>'receipt_employee_id' IS DISTINCT FROM g.employee_id::text
  OR r.native_payload->>'receipt_device_id' IS DISTINCT FROM g.device_identifier
  OR r.prepared_at<g.activated_at OR r.prepared_at>p_at OR (g.dispatch_retired_at IS NOT NULL AND r.prepared_at>g.dispatch_retired_at)
  OR f.finalized_at IS DISTINCT FROM r.prepared_at OR f.valid_until IS DISTINCT FROM r.native_valid_until
  OR f.content_sha256 IS DISTINCT FROM r.native_payload_sha256 OR f.source_window_sha256 IS DISTINCT FROM s.source_window_sha256
  OR public.custodial_native_schedule_receipt_binding(r.native_payload,r.job_id,r.source_id,r.credential_id,r.assignment_epoch,
   r.native_generation_id,r.token_hash,r.prepared_at,r.native_valid_until,r.native_payload_sha256) IS NOT TRUE
  OR p_event->>'record_id' IS DISTINCT FROM public.custodial_native_schedule_original_record_id(g.generation_id,p_job,r.native_payload->>'notification_key') THEN RETURN false;END IF;
 FOREACH field IN ARRAY ARRAY['generation_id','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id',
  'receipt_device_id','receipt_assignment_epoch','principal_digest','token_digest','content_sha256'] LOOP
  IF p_event->>field IS DISTINCT FROM r.native_payload->>field THEN RETURN false;END IF;
 END LOOP;
 -- ORIGINAL reconciliation is distinct from fresh source inventory. Never
 -- erase a valid original merely because business source/window later ended.
 -- The unchanged outer v2 algorithm still checks admission/observation bounds,
 -- original Received first, exact event replay, current credential and nonce.
 RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_observation_originals_at(p_credential uuid,p_credential_hash text,p_jobs jsonb,p_test_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
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
  IF r.job_id IS NULL OR r.native_payload->>'schema' IS DISTINCT FROM 'custodial.native-schedule-payload.v1'
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
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_observation_originals(uuid,text,jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN RETURN public.custodial_native_schedule_observation_originals_at($1,$2,$3,null);END $fn$;

-- Pin whole independently retained prior SQL bodies and captured definitions,
-- not just matching snippets. Unknown drift fails before any replacement.
DO $patch$ DECLARE obj record;definition text;body text;acl aclitem[];old text;replacement text;BEGIN
 FOR obj IN SELECT * FROM(VALUES
  ('public.custodial_native_provider_event_shape(jsonb)','70a1ec0648699a0d32ef13e87c8cc09c41ce1631b4edc3ad97c9092d6625ad11'),
  ('public.custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamptz)','6aacabfdf1cbbf9211998e9121648e7e4de1262bce92c51d30dbd4315696984f'),
  ('public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)','7c7b5333a3b34d3a1ff462e30a33c30f55b9fc461b852c157cc18701cea3b375')
 ) x(identity,body_sha256) LOOP
  SELECT prosrc,proacl INTO body,acl FROM pg_proc WHERE oid=obj.identity::regprocedure;definition:=pg_get_functiondef(obj.identity::regprocedure);
  IF public.static_weekly_digest_text(body) IS DISTINCT FROM obj.body_sha256 OR NOT EXISTS(
   SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function' AND to_regprocedure(object_identity)=obj.identity::regprocedure
    AND definition_sql=definition AND definition_sha256=public.static_weekly_digest_text(definition)) THEN
   RAISE EXCEPTION 'SCHEDULE observation exact predecessor changed %',obj.identity;END IF;
  IF obj.identity='public.custodial_native_provider_event_shape(jsonb)' THEN
   old:=$old$or p_event->>'record_id'<>public.static_weekly_digest_text((p_event->>'generation_id')||E'\n'||(p_event->>'receipt_job_id')||E'\n'||(p_event->>'notification_key'))$old$;
   replacement:=$new$or p_event->>'record_id' IS DISTINCT FROM public.custodial_native_schedule_original_record_id(
    (p_event->>'generation_id')::uuid,(p_event->>'receipt_job_id')::uuid,p_event->>'notification_key')$new$;
   IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'SCHEDULE event identity seam changed';END IF;
   definition:=replace(definition,old,replacement);
   -- Original-row lookup is stable, not immutable/cached. No client controls
   -- that lookup; EXECUTE remains private and helpers are separately revoked.
   IF (length(definition)-length(replace(definition,' IMMUTABLE','')))/length(' IMMUTABLE')<>1 THEN RAISE EXCEPTION 'SCHEDULE shape volatility seam changed';END IF;
   definition:=replace(definition,' IMMUTABLE',E' STABLE SECURITY DEFINER');
  ELSIF obj.identity LIKE 'public.custodial_native_provider_events_at(%' THEN
   old:=$old$if alert.job_id is not null then
   if public.custodial_native_alert_event_binding(alert.job_id,e,c.credential_id,at_time) is not true then
    code:='native_provider_original_binding_invalid';end if;
  else$old$;
   replacement:=replace(old,E'\n  else',E'\n  elsif payload->>''schema''=''custodial.native-schedule-payload.v1'' then\n   if public.custodial_native_schedule_event_binding(r.job_id,e,c.credential_id,at_time) is not true then\n    code:=''native_provider_original_binding_invalid'';end if;\n  else');
   IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'SCHEDULE original event branch changed';END IF;
   definition:=replace(definition,old,replacement);
  ELSE
   old:=$old$if alert.job_id is not null then
    original_ok:=public.custodial_native_alert_event_binding(alert.job_id,e,c.credential_id,at_time);
   else$old$;
   replacement:=replace(old,E'\n   else',E'\n   elsif payload->>''schema''=''custodial.native-schedule-payload.v1'' then\n    original_ok:=public.custodial_native_schedule_event_binding(r.job_id,e,c.credential_id,at_time);\n   else');
   IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'SCHEDULE original decision branch changed';END IF;
   definition:=replace(definition,old,replacement);
  END IF;
  EXECUTE definition;
  IF (SELECT proacl FROM pg_proc WHERE oid=obj.identity::regprocedure) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'SCHEDULE observation ACL changed';END IF;
 END LOOP;
END $patch$;

DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_original_record_id(uuid,uuid,text)","name":"custodial_native_schedule_original_record_id","body_md5":"826c4aa3ae8db1d7ff05bda841c5cb59","argument_names":["p_generation","p_job","p_key"],"returns":"text","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz)","name":"custodial_native_schedule_event_binding","body_md5":"32325c39226e67801a133918ab38afa9","argument_names":["p_job","p_event","p_credential","p_at"],"returns":"boolean","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz)","name":"custodial_native_schedule_observation_originals_at","body_md5":"76e737019ab3eea74d009af7db007a13","argument_names":["p_credential","p_credential_hash","p_jobs","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_observation_originals(uuid,text,jsonb)","name":"custodial_native_schedule_observation_originals","body_md5":"54d6ea3d1ce4a3679c6fd3d1355286ab","argument_names":null,"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source108 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_108_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_original_record_id(uuid,uuid,text),
 public.custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz),
 public.custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz),
 public.custodial_native_schedule_observation_originals(uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_observation_originals(uuid,text,jsonb) TO service_role;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_original_record_id','custodial_native_schedule_event_binding','custodial_native_schedule_observation_originals_at','custodial_native_schedule_observation_originals']::text[]))<>4
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_108_before)<>4 THEN
  RAISE EXCEPTION 'Finite creator Source108 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_108_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source108 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source108 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_original_record_id(uuid,uuid,text)","name":"custodial_native_schedule_original_record_id","body_md5":"826c4aa3ae8db1d7ff05bda841c5cb59","argument_names":["p_generation","p_job","p_key"],"returns":"text","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz)","name":"custodial_native_schedule_event_binding","body_md5":"32325c39226e67801a133918ab38afa9","argument_names":["p_job","p_event","p_credential","p_at"],"returns":"boolean","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz)","name":"custodial_native_schedule_observation_originals_at","body_md5":"76e737019ab3eea74d009af7db007a13","argument_names":["p_credential","p_credential_hash","p_jobs","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_observation_originals(uuid,text,jsonb)","name":"custodial_native_schedule_observation_originals","body_md5":"54d6ea3d1ce4a3679c6fd3d1355286ab","argument_names":null,"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source108 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;

LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_observation_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE observation captured canary/ALWAYS guard changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''function'',''custodial_native_schedule_original_record_id(uuid,uuid,text)'',''SCHEDULE authoritative original identity; no send''),\n'
  ||E'    (''grant'',''custodial_native_schedule_original_record_id(uuid,uuid,text)'',''SCHEDULE authoritative original identity; no send''),\n'
  ||E'    (''function'',''custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz)'',''SCHEDULE authoritative original identity; no send''),\n'
  ||E'    (''grant'',''custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz)'',''SCHEDULE authoritative original identity; no send''),\n'
  ||E'    (''function'',''custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz)'',''SCHEDULE authoritative original identity; no send''),\n'
  ||E'    (''grant'',''custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz)'',''SCHEDULE authoritative original identity; no send''),\n'
  ||E'    (''function'',''custodial_native_schedule_observation_originals(uuid,text,jsonb)'',''SCHEDULE authoritative original identity; no send''),\n'
  ||E'    (''grant'',''custodial_native_schedule_observation_originals(uuid,text,jsonb)'',''SCHEDULE authoritative original identity; no send''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE observation canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'custodial_native_schedule_original_record_id','custodial_native_schedule_event_binding','custodial_native_schedule_observation_originals_at','custodial_native_schedule_observation_originals','custodial_native_provider_event_shape','custodial_native_provider_events_at','custodial_native_provider_event_decisions','custodial_release_canary_authority_surface')),
 objects AS(SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs)
 SELECT * FROM objects ORDER BY bucket,identity LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'SCHEDULE observation recovery object missing';END IF;
  -- Existing callable rows can retain a schema-qualified spelling while
  -- regprocedure renders an unqualified alias. The reset statement embeds
  -- that spelling, so serialize an existing grant with its retained identity.
  -- This changes neither the resolved function nor its ACL or restore order.
  UPDATE public.custodial_release_authority_restore_inventory SET
   definition_sql=CASE WHEN obj.kind='grant' THEN public.custodial_release_authority_current_grant_definition(object_identity) ELSE obj.definition END,
   definition_sha256=public.static_weekly_digest_text(CASE WHEN obj.kind='grant' THEN public.custodial_release_authority_current_grant_definition(object_identity) ELSE obj.definition END),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'SCHEDULE observation recovery duplicate';END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,obj.bucket+99998) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE observation recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_observation_inventory_before i WHERE NOT((object_identity='custodial_release_canary_authority_surface()' AND object_kind IN('function','grant'))
  OR (object_kind IN('function','grant') AND object_identity LIKE '%(%' AND to_regprocedure(object_identity) IN(
   'public.custodial_native_provider_event_shape(jsonb)'::regprocedure,
   'public.custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamptz)'::regprocedure,
   'public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'::regprocedure))) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE observation recovery row changed';END IF;
END $scope$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_original_record_id','custodial_native_schedule_event_binding','custodial_native_schedule_observation_originals_at','custodial_native_schedule_observation_originals']::text[]))<>4
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_108_before)<>4 THEN
  RAISE EXCEPTION 'Finite creator Source108 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_108_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source108 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source108 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_original_record_id(uuid,uuid,text)","name":"custodial_native_schedule_original_record_id","body_md5":"826c4aa3ae8db1d7ff05bda841c5cb59","argument_names":["p_generation","p_job","p_key"],"returns":"text","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz)","name":"custodial_native_schedule_event_binding","body_md5":"32325c39226e67801a133918ab38afa9","argument_names":["p_job","p_event","p_credential","p_at"],"returns":"boolean","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz)","name":"custodial_native_schedule_observation_originals_at","body_md5":"76e737019ab3eea74d009af7db007a13","argument_names":["p_credential","p_credential_hash","p_jobs","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_observation_originals(uuid,text,jsonb)","name":"custodial_native_schedule_observation_originals","body_md5":"54d6ea3d1ce4a3679c6fd3d1355286ab","argument_names":null,"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source108 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
COMMIT;
