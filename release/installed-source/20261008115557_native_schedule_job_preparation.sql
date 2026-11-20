-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
-- Once-only SOURCE->job preparation. No scheduler/cron/HTTP producer is wired
-- and no sender/native clock/audio/profile/retention authority is granted.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- BEGIN FINITE NEW-CREATOR PROFILE 109
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_109_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.employee_native_schedule_jobs']::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_job_guard','custodial_native_schedule_job_prepare_at','custodial_native_schedule_job_prepare']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_native_schedule_job_guard','custodial_native_schedule_job_prepare_at','custodial_native_schedule_job_prepare']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.employee_native_schedule_jobs']::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source109 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_109_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 109
CREATE TABLE public.employee_native_schedule_jobs (
 source_reservation_id uuid PRIMARY KEY REFERENCES public.employee_native_schedule_source_reservations(reservation_id),
 job_id uuid NOT NULL UNIQUE REFERENCES public.operational_notification_jobs(job_id),
 operation_id uuid NOT NULL UNIQUE,
 expected jsonb NOT NULL CHECK(jsonb_typeof(expected)='object' AND octet_length(expected::text)<=4096),
 prepared_at timestamptz NOT NULL CHECK(isfinite(prepared_at)),
 job_payload_sha256 text NOT NULL CHECK(job_payload_sha256~'^[0-9a-f]{64}$'),
 source_window_sha256 text NOT NULL CHECK(source_window_sha256~'^[0-9a-f]{64}$')
);
ALTER TABLE public.employee_native_schedule_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_native_schedule_jobs FORCE ROW LEVEL SECURITY;

DO $creator_table_before$ DECLARE identity text;c record;BEGIN
 FOREACH identity IN ARRAY ARRAY['public.employee_native_schedule_jobs']::text[] LOOP
  SELECT p.oid,p.relowner,p.relacl,p.relkind,p.relpersistence,p.relrowsecurity,p.relforcerowsecurity INTO STRICT c FROM pg_class p WHERE p.oid=to_regclass(identity);
  IF c.relowner<>'postgres'::regrole OR c.relkind<>'r' OR c.relpersistence<>'p' OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
   OR EXISTS(SELECT 1 FROM (SELECT DISTINCT privilege_type privilege FROM aclexplode(acldefault('r',c.relowner))) creator_privileges
    WHERE NOT has_table_privilege(current_user,c.oid,privilege)
     OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner AND a.privilege_type=privilege))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner AND(a.grantor<>c.relowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source109 new relation owner ordinary privileges unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_109_before VALUES('relation',identity,c.oid,c.relowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner),NULL);
 END LOOP;
END $creator_table_before$;
REVOKE ALL ON TABLE public.employee_native_schedule_jobs FROM PUBLIC,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
CREATE FUNCTION public.custodial_native_schedule_job_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE s public.employee_native_schedule_source_reservations%rowtype;j public.operational_notification_jobs%rowtype;g public.employee_native_push_generations%rowtype;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'original SCHEDULE job marker immutable' USING errcode='23514';END IF;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=NEW.source_reservation_id;
 SELECT * INTO j FROM public.operational_notification_jobs WHERE job_id=NEW.job_id;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=s.generation_id;
 IF s.reservation_id IS NULL OR j.job_id IS NULL OR g.generation_id IS NULL OR g.employee_id IS DISTINCT FROM s.employee_id
  OR NEW.prepared_at<s.reserved_at OR NEW.prepared_at>=s.valid_until
  OR NEW.source_window_sha256 IS DISTINCT FROM s.source_window_sha256
  OR NEW.expected IS DISTINCT FROM jsonb_build_object('assignment_epoch',g.assignment_epoch::text,'credential_id',g.credential_id::text,
   'device_id',g.device_identifier,'employee_id',g.employee_id::text,'generation_id',g.generation_id::text,'principal_digest',g.principal_digest,
   'registration_id',g.registration_id::text,'token_digest',g.token_digest)
  OR j.job_type IS DISTINCT FROM 'employee_native_push' OR j.source_id IS DISTINCT FROM s.reservation_id
  OR j.job_key IS DISTINCT FROM 'employee-schedule-push:'||s.reservation_id::text||':'||g.credential_id::text
  OR j.payload_json IS DISTINCT FROM jsonb_build_object('credential_id',g.credential_id::text,'device_id',g.device_id::text,
   'device_identifier',g.device_identifier,'employee_id',g.employee_id::text,'assignment_epoch',g.assignment_epoch::text,
   'data_json',jsonb_build_object('kind','employee_schedule_ownership','source_reservation_id',s.reservation_id::text))
  OR NEW.job_payload_sha256 IS DISTINCT FROM public.static_weekly_digest_jsonb(j.payload_json) THEN
  RAISE EXCEPTION 'SCHEDULE job not bound to exact source/actor/payload' USING errcode='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER trg_native_schedule_job_guard BEFORE INSERT OR UPDATE OR DELETE ON public.employee_native_schedule_jobs
 FOR EACH ROW EXECUTE FUNCTION public.custodial_native_schedule_job_guard();
ALTER TABLE public.employee_native_schedule_jobs ENABLE ALWAYS TRIGGER trg_native_schedule_job_guard;
CREATE FUNCTION public.custodial_native_schedule_job_prepare_at(p_source uuid,p_expected jsonb,p_operation uuid,p_test_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE s public.employee_native_schedule_source_reservations%rowtype;prior public.employee_native_schedule_jobs%rowtype;
 d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;j public.operational_notification_jobs%rowtype;
 at_time timestamptz;actor jsonb;content jsonb;payload jsonb;key text;field text;
BEGIN
 PERFORM public.custodial_begin_application_mutation();
 IF p_source IS NULL OR p_operation IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(p_expected) k) IS DISTINCT FROM
   ARRAY['assignment_epoch','credential_id','device_id','employee_id','generation_id','principal_digest','registration_id','token_digest']
  OR EXISTS(SELECT 1 FROM jsonb_each(p_expected) e WHERE jsonb_typeof(e.value)<>'string')
  OR (p_test_at IS NOT NULL AND NOT isfinite(p_test_at)) THEN RAISE EXCEPTION 'exact SCHEDULE source/job operation/actor required' USING errcode='22023';END IF;
 FOREACH field IN ARRAY ARRAY['credential_id','employee_id','generation_id','registration_id'] LOOP
  IF p_expected->>field !~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid SCHEDULE job UUID' USING errcode='22023';END IF;
 END LOOP;
 IF p_expected->>'assignment_epoch' !~'^[1-9][0-9]{0,15}$' OR (p_expected->>'assignment_epoch')::numeric>9007199254740991
  OR p_expected->>'device_id'!~'^KIOSK_(0[2-9]|10)$' OR p_expected->>'principal_digest'!~'^[0-9a-f]{64}$'
  OR p_expected->>'token_digest'!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid SCHEDULE job actor' USING errcode='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT d0.* INTO d FROM public.devices d0 JOIN public.device_auth_credentials c0 ON c0.device_id=d0.id
  WHERE c0.credential_id=(p_expected->>'credential_id')::uuid FOR UPDATE OF d0;
 SELECT * INTO c FROM public.device_auth_credentials WHERE credential_id=(p_expected->>'credential_id')::uuid FOR UPDATE;
 PERFORM 1 FROM public.employees WHERE id=d.assigned_employee_id FOR SHARE;
 PERFORM 1 FROM public.employee_push_registrations WHERE device_id=d.id ORDER BY registration_id FOR UPDATE;
 SELECT * INTO r FROM public.employee_push_registrations WHERE registration_id=(p_expected->>'registration_id')::uuid;
 SELECT * INTO g FROM public.employee_native_push_generations WHERE generation_id=(p_expected->>'generation_id')::uuid FOR UPDATE;
 SELECT * INTO s FROM public.employee_native_schedule_source_reservations WHERE reservation_id=p_source FOR UPDATE;
 SELECT * INTO prior FROM public.employee_native_schedule_jobs WHERE operation_id=p_operation FOR UPDATE;
 IF prior.source_reservation_id IS NOT NULL AND(prior.source_reservation_id IS DISTINCT FROM p_source OR prior.expected IS DISTINCT FROM p_expected) THEN
  RAISE EXCEPTION 'original SCHEDULE job operation conflict' USING errcode='23514';END IF;
 SELECT * INTO prior FROM public.employee_native_schedule_jobs WHERE source_reservation_id=p_source FOR UPDATE;
 at_time:=coalesce(p_test_at,clock_timestamp());
 IF prior.job_id IS NOT NULL THEN
  IF prior.expected IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('schema','custodial.native-schedule-job-preparation.v1',
   'status','ORIGINAL_JOB_CONFLICT','prepared',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'job',null);END IF;
  RETURN jsonb_build_object('schema','custodial.native-schedule-job-preparation.v1','status','ORIGINAL_JOB_RETAINED','prepared',true,'replayed',true,
   'dispatch_authorized',false,'delivery_admitted',false,'job',jsonb_build_object('job_id',prior.job_id,'operation_id',prior.operation_id,
    'source_reservation_id',prior.source_reservation_id,'prepared_at',public.custodial_native_location_utc(prior.prepared_at),
    'payload_sha256',prior.job_payload_sha256,'source_window_sha256',prior.source_window_sha256));
 END IF;
 IF s.reservation_id IS NULL THEN RETURN jsonb_build_object('schema','custodial.native-schedule-job-preparation.v1','status','SOURCE_OR_ACTOR_SUPERSEDED',
  'prepared',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'job',null);END IF;
 actor:=jsonb_build_object('assignment_epoch',d.assignment_epoch::text,'credential_id',c.credential_id::text,'device_id',d.device_id,
  'employee_id',d.assigned_employee_id::text,'generation_id',g.generation_id::text,'principal_digest',g.principal_digest,
  'registration_id',r.registration_id::text,'token_digest',g.token_digest);
 content:=public.custodial_native_schedule_content_source_at(s.operation_id,s.employee_id,s.generation_id,at_time);
 IF actor IS DISTINCT FROM p_expected OR content->>'status' IS DISTINCT FROM 'CONTENT_CURRENT_SOURCE_ONLY'
  OR s.employee_id IS DISTINCT FROM d.assigned_employee_id OR s.generation_id IS DISTINCT FROM g.generation_id
  OR g.registration_id IS DISTINCT FROM r.registration_id OR g.credential_id IS DISTINCT FROM c.credential_id
  OR g.device_id IS DISTINCT FROM d.id OR r.device_id IS DISTINCT FROM d.id OR r.credential_id IS DISTINCT FROM c.credential_id THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-job-preparation.v1','status','SOURCE_OR_ACTOR_SUPERSEDED',
   'prepared',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'job',null);END IF;
 key:='employee-schedule-push:'||s.reservation_id::text||':'||c.credential_id::text;
 IF EXISTS(SELECT 1 FROM public.operational_notification_jobs WHERE job_key=key) THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-job-preparation.v1','status','UNOWNED_JOB_CONFLICT',
   'prepared',false,'replayed',false,'dispatch_authorized',false,'delivery_admitted',false,'job',null);END IF;
 payload:=jsonb_build_object('credential_id',c.credential_id::text,'device_id',d.id::text,'device_identifier',d.device_id,
  'employee_id',d.assigned_employee_id::text,'assignment_epoch',d.assignment_epoch::text,
  'data_json',jsonb_build_object('kind','employee_schedule_ownership','source_reservation_id',s.reservation_id::text));
 INSERT INTO public.operational_notification_jobs(job_key,job_type,source_id,payload_json,available_at)
  VALUES(key,'employee_native_push',s.reservation_id,payload,at_time) RETURNING * INTO j;
 INSERT INTO public.employee_native_schedule_jobs(source_reservation_id,job_id,operation_id,expected,prepared_at,job_payload_sha256,source_window_sha256)
  VALUES(s.reservation_id,j.job_id,p_operation,p_expected,at_time,public.static_weekly_digest_jsonb(payload),s.source_window_sha256) RETURNING * INTO prior;
 RETURN jsonb_build_object('schema','custodial.native-schedule-job-preparation.v1','status','JOB_PREPARED_NATIVE_UNQUALIFIED','prepared',true,'replayed',false,
  'dispatch_authorized',false,'delivery_admitted',false,'job',jsonb_build_object('job_id',prior.job_id,'operation_id',prior.operation_id,
   'source_reservation_id',prior.source_reservation_id,'prepared_at',public.custodial_native_location_utc(prior.prepared_at),
   'payload_sha256',prior.job_payload_sha256,'source_window_sha256',prior.source_window_sha256));
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_job_prepare(uuid,jsonb,uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN RETURN public.custodial_native_schedule_job_prepare_at($1,$2,$3,null);END $fn$;

DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_job_guard()","name":"custodial_native_schedule_job_guard","body_md5":"ecf916d4a91209696ac5bdc3d81e263f","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_job_prepare_at(uuid,jsonb,uuid,timestamptz)","name":"custodial_native_schedule_job_prepare_at","body_md5":"a6a93eb5c21cde052667363ecb3c01e9","argument_names":["p_source","p_expected","p_operation","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_job_prepare(uuid,jsonb,uuid)","name":"custodial_native_schedule_job_prepare","body_md5":"1df3d4abacccef53b2a6d3ca409dba17","argument_names":null,"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source109 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_109_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_job_guard(),public.custodial_native_schedule_job_prepare_at(uuid,jsonb,uuid,timestamptz),
 public.custodial_native_schedule_job_prepare(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_job_prepare(uuid,jsonb,uuid) TO service_role;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_job_guard','custodial_native_schedule_job_prepare_at','custodial_native_schedule_job_prepare']::text[]))<>3
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_109_before)<>4 THEN
  RAISE EXCEPTION 'Finite creator Source109 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_109_before LOOP
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
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[{"relation":"public.employee_native_schedule_jobs","name":"trg_native_schedule_job_guard","function":"public.custodial_native_schedule_job_guard()","type":31,"enabled":"A"}]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source109 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source109 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_job_guard()","name":"custodial_native_schedule_job_guard","body_md5":"ecf916d4a91209696ac5bdc3d81e263f","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_job_prepare_at(uuid,jsonb,uuid,timestamptz)","name":"custodial_native_schedule_job_prepare_at","body_md5":"a6a93eb5c21cde052667363ecb3c01e9","argument_names":["p_source","p_expected","p_operation","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_job_prepare(uuid,jsonb,uuid)","name":"custodial_native_schedule_job_prepare","body_md5":"1df3d4abacccef53b2a6d3ca409dba17","argument_names":null,"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source109 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;

-- Exact recovery closure: new internal relation, fields, constraints, state,
-- immutable/fence triggers, functions and explicit grants, no runtime policy.
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_job_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE job captured canary/ALWAYS boundary changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''relation'',''public.employee_native_schedule_jobs'',''immutable SOURCE-to-job original; no delivery''),\n'
  ||E'    (''relation_state'',''public.employee_native_schedule_jobs'',''RPC-only FORCE-RLS job marker''),\n'
  ||E'    (''grant'',''public.employee_native_schedule_jobs'',''no direct runtime source access''),\n'
  ||E'    (''function'',''custodial_native_schedule_job_prepare(uuid,jsonb,uuid)'',''service-only job preparation; no send''),\n'
);
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE job canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_native_schedule_job_guard','custodial_native_schedule_job_prepare_at','custodial_native_schedule_job_prepare','custodial_release_canary_authority_surface')),
 objects AS(
  SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs
  UNION ALL SELECT x.bucket,x.kind,x.identity,x.definition FROM unnest(array['public.employee_native_schedule_jobs']) rel CROSS JOIN LATERAL(
   SELECT 1000 bucket,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
   UNION ALL SELECT 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
    FROM pg_attribute WHERE attrelid=rel::regclass AND attnum>0 AND NOT attisdropped
   UNION ALL SELECT 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
   UNION ALL SELECT 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
   UNION ALL SELECT 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
    FROM pg_constraint WHERE conrelid=rel::regclass
   UNION ALL SELECT 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
    FROM pg_index i WHERE indrelid=rel::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
   UNION ALL SELECT 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
    ||pg_get_triggerdef(oid,true)||'; alter table '||rel||CASE WHEN tgenabled='A' THEN ' enable always trigger ' ELSE ' enable trigger ' END||quote_ident(tgname)||';'
    FROM pg_trigger WHERE tgrelid=rel::regclass AND NOT tgisinternal
   UNION ALL SELECT 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x)
 SELECT * FROM objects ORDER BY bucket,identity LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'missing SCHEDULE job recovery object %',obj.identity;END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(obj.kind IN('function','grant') AND object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'duplicate SCHEDULE job recovery %',obj.identity;END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE job recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_job_inventory_before i WHERE NOT(
   object_identity='custodial_release_canary_authority_surface()' AND object_kind IN('function','grant'))
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE job recovery row changed';END IF;
END $scope$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_job_guard','custodial_native_schedule_job_prepare_at','custodial_native_schedule_job_prepare']::text[]))<>3
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_109_before)<>4 THEN
  RAISE EXCEPTION 'Finite creator Source109 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_109_before LOOP
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
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[{"relation":"public.employee_native_schedule_jobs","name":"trg_native_schedule_job_guard","function":"public.custodial_native_schedule_job_guard()","type":31,"enabled":"A"}]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source109 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source109 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_job_guard()","name":"custodial_native_schedule_job_guard","body_md5":"ecf916d4a91209696ac5bdc3d81e263f","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_job_prepare_at(uuid,jsonb,uuid,timestamptz)","name":"custodial_native_schedule_job_prepare_at","body_md5":"a6a93eb5c21cde052667363ecb3c01e9","argument_names":["p_source","p_expected","p_operation","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_job_prepare(uuid,jsonb,uuid)","name":"custodial_native_schedule_job_prepare","body_md5":"1df3d4abacccef53b2a6d3ca409dba17","argument_names":null,"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source109 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
COMMIT;
