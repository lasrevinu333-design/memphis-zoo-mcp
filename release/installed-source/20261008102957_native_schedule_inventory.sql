-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
-- Source-current SCHEDULE inventory branch only. No new producer, send or
-- provider/handset outcome authority, timing profile, native effect or route.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- BEGIN FINITE NEW-CREATOR PROFILE 107
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_107_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_live']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_native_schedule_live']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source107 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_107_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 107
CREATE FUNCTION public.custodial_native_schedule_live(p_job uuid,p_payload jsonb,p_at timestamptz)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE f public.employee_native_schedule_finalizations%rowtype;s public.employee_native_schedule_source_reservations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;j public.operational_notification_jobs%rowtype;
 g public.employee_native_push_generations%rowtype;source_status jsonb;
BEGIN
 IF p_job IS NULL OR p_at IS NULL OR NOT isfinite(p_at) OR p_payload->>'schema' IS DISTINCT FROM 'custodial.native-schedule-payload.v1'
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
END $fn$;

DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_live(uuid,jsonb,timestamptz)","name":"custodial_native_schedule_live","body_md5":"76dfc4911181e1dc27685a2684245c89","argument_names":["p_job","p_payload","p_at"],"returns":"boolean","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source107 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_107_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_live(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,
 service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_live']::text[]))<>1
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_107_before)<>1 THEN
  RAISE EXCEPTION 'Finite creator Source107 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_107_before LOOP
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
    RAISE EXCEPTION 'Finite creator Source107 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source107 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_live(uuid,jsonb,timestamptz)","name":"custodial_native_schedule_live","body_md5":"76dfc4911181e1dc27685a2684245c89","argument_names":["p_job","p_payload","p_at"],"returns":"boolean","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source107 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;


-- The complete old Location/Lunch/Event/Message query is retained as the
-- exact prefix, rather than regenerated or partially rewritten.
DO $rows$ DECLARE fn regprocedure:='public.custodial_native_location_inventory_rows(uuid,text,jsonb,timestamptz)'::regprocedure;
 definition text;body text;expected_body_sha256 constant text:='5ffebf3df922e311c4e22deb8feb40c8961cc3b746f79d32d12a09632f8c3443';acl aclitem[];
 branch constant text:=$branch$
 UNION ALL
 SELECT r.job_id,r.prepared_at,r.native_payload,'prepared'::text
 FROM public.employee_native_schedule_finalizations f
 JOIN public.employee_native_push_delivery_receipts r ON r.job_id=f.job_id
 JOIN public.employee_native_push_generations g ON g.generation_id=r.native_generation_id
 WHERE r.credential_id=p_credential AND g.credential_id=p_credential AND g.principal_digest=p_principal
  AND p_generations ? g.generation_id::text AND g.revoked_at IS NULL
  AND g.registration_id=r.registration_id AND g.token_digest=r.token_hash AND g.assignment_epoch=r.assignment_epoch
  AND r.native_payload->>'receipt_employee_id'=g.employee_id::text
  AND r.native_payload->>'receipt_device_id'=g.device_identifier AND r.native_payload->>'principal_digest'=g.principal_digest
  AND r.prepared_at>=g.activated_at AND (g.dispatch_retired_at IS NULL OR r.prepared_at<=g.dispatch_retired_at)
  AND NOT EXISTS(SELECT 1 FROM public.employee_native_provider_events n WHERE n.job_id=r.job_id AND n.action='acknowledged')
  AND public.custodial_native_schedule_live(r.job_id,r.native_payload,p_at) IS TRUE;$branch$;
BEGIN
 SELECT prosrc,proacl INTO body,acl FROM pg_proc WHERE oid=fn;definition:=pg_get_functiondef(fn);
 IF public.static_weekly_digest_text(body) IS DISTINCT FROM expected_body_sha256
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
   AND to_regprocedure(object_identity)=fn AND definition_sql=definition AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=fn
   AND definition_sql=public.custodial_release_authority_current_grant_definition(fn::text))
  OR body !~ ';[[:space:]]*$' THEN RAISE EXCEPTION 'SCHEDULE inventory exact predecessor changed';END IF;
 IF (length(definition)-length(replace(definition,body,'')))/length(body)<>1 THEN
  RAISE EXCEPTION 'SCHEDULE inventory body occurrence changed';END IF;
 EXECUTE replace(definition,body,regexp_replace(body,';([[:space:]]*)$','')||branch||E'\n');
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN
  RAISE EXCEPTION 'SCHEDULE inventory permissions changed';END IF;
END $rows$;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE inventory captured canary/ALWAYS guard changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''function'',''custodial_native_schedule_live(uuid,jsonb,timestamptz)'',''private current SCHEDULE source/receipt inventory predicate; no send''),\n'
  ||E'    (''grant'',''custodial_native_schedule_live(uuid,jsonb,timestamptz)'',''no direct runtime predicate access''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE inventory canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
  'custodial_native_schedule_live','custodial_native_location_inventory_rows','custodial_release_canary_authority_surface')),
 objects AS(SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs)
 SELECT * FROM objects ORDER BY bucket,identity LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'SCHEDULE inventory recovery object missing';END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'SCHEDULE inventory recovery duplicate';END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,obj.bucket+99998) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE inventory recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_inventory_before i WHERE NOT((object_identity='custodial_release_canary_authority_surface()' AND object_kind IN('function','grant'))
  OR (object_kind IN('function','grant') AND object_identity LIKE 'custodial_native_location_inventory_rows(%')) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE inventory recovery row changed';END IF;
END $scope$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_live']::text[]))<>1
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_107_before)<>1 THEN
  RAISE EXCEPTION 'Finite creator Source107 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_107_before LOOP
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
    RAISE EXCEPTION 'Finite creator Source107 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source107 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_live(uuid,jsonb,timestamptz)","name":"custodial_native_schedule_live","body_md5":"76dfc4911181e1dc27685a2684245c89","argument_names":["p_job","p_payload","p_at"],"returns":"boolean","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source107 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
COMMIT;
