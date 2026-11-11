-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
-- Durable once-per-employee/service-day SOURCE reservation, not a provider
-- delivery receipt. No job, send right, native wire, effect clock, retention
-- deletion policy, HTTP route or automatic producer is activated here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- BEGIN FINITE NEW-CREATOR PROFILE 104
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_104_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.employee_native_schedule_source_reservations']::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_source_immutable','custodial_native_schedule_source_reserve_at','custodial_native_schedule_source_reserve','custodial_native_schedule_source_status_at','custodial_native_schedule_source_status']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_native_schedule_source_immutable','custodial_native_schedule_source_reserve_at','custodial_native_schedule_source_reserve','custodial_native_schedule_source_status_at','custodial_native_schedule_source_status']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['public.employee_native_schedule_source_reservations']::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source104 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_104_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 104
CREATE TABLE public.employee_native_schedule_source_reservations (
 reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL UNIQUE,
 service_date date NOT NULL,
 employee_id uuid NOT NULL REFERENCES public.employees(id),
 generation_id uuid NOT NULL REFERENCES public.employee_native_push_generations(generation_id),
 source_key uuid NOT NULL REFERENCES public.weekly_schedule_occurrences(occurrence_id),
 logical_key text NOT NULL UNIQUE,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 reserved_at timestamptz NOT NULL,
 valid_from timestamptz NOT NULL,
 valid_until timestamptz NOT NULL,
 source_window jsonb NOT NULL,
 source_window_sha256 text NOT NULL CHECK(source_window_sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(employee_id,service_date),
 CHECK((isfinite(reserved_at) AND isfinite(valid_from) AND isfinite(valid_until)
  AND valid_from<=reserved_at AND reserved_at<valid_until
  AND logical_key='schedule-ownership:'||service_date::text||':'||employee_id::text||':09:45'
  AND source_window->>'schema'='custodial.native-schedule-server-window.v1'
  AND source_window->>'logical_key'=logical_key AND source_window->>'service_date'=service_date::text
  AND source_window->>'employee_id'=employee_id::text AND source_window->>'generation_id'=generation_id::text
  AND source_window->>'assignment_occurrence_id'=source_key::text
  AND source_window->>'server_source_sha256'=source_sha256
  AND source_window->>'valid_from'=public.custodial_native_location_utc(valid_from)
  AND source_window->>'valid_until'=public.custodial_native_location_utc(valid_until)
  AND source_window->>'server_now'=public.custodial_native_location_utc(reserved_at)
  AND jsonb_typeof(source_window->'before_units')='array' AND jsonb_typeof(source_window->'after_units')='array'
  AND source_window->'before_units' IS DISTINCT FROM source_window->'after_units'
  AND source_window_sha256=public.static_weekly_digest_jsonb(source_window)
  AND octet_length(source_window::text)<=2097152) IS TRUE)
);
ALTER TABLE public.employee_native_schedule_source_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_native_schedule_source_reservations FORCE ROW LEVEL SECURITY;

DO $creator_table_before$ DECLARE identity text;c record;BEGIN
 FOREACH identity IN ARRAY ARRAY['public.employee_native_schedule_source_reservations']::text[] LOOP
  SELECT p.oid,p.relowner,p.relacl,p.relkind,p.relpersistence,p.relrowsecurity,p.relforcerowsecurity INTO STRICT c FROM pg_class p WHERE p.oid=to_regclass(identity);
  IF c.relowner<>'postgres'::regrole OR c.relkind<>'r' OR c.relpersistence<>'p' OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
   OR EXISTS(SELECT 1 FROM (SELECT DISTINCT privilege_type privilege FROM aclexplode(acldefault('r',c.relowner))) creator_privileges
    WHERE NOT has_table_privilege(current_user,c.oid,privilege)
     OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner AND a.privilege_type=privilege))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner AND(a.grantor<>c.relowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source104 new relation owner ordinary privileges unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_104_before VALUES('relation',identity,c.oid,c.relowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner),NULL);
 END LOOP;
END $creator_table_before$;
REVOKE ALL ON TABLE public.employee_native_schedule_source_reservations FROM PUBLIC,anon,authenticated,
 service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
CREATE FUNCTION public.custodial_native_schedule_source_immutable()
 RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN RAISE EXCEPTION 'original SCHEDULE source reservation is immutable; no deletion/rewriting/resend authority'
 USING errcode='23514';END $fn$;
CREATE TRIGGER trg_native_schedule_source_immutable BEFORE UPDATE OR DELETE ON public.employee_native_schedule_source_reservations
 FOR EACH ROW EXECUTE FUNCTION public.custodial_native_schedule_source_immutable();
ALTER TABLE public.employee_native_schedule_source_reservations ENABLE ALWAYS TRIGGER trg_native_schedule_source_immutable;

CREATE FUNCTION public.custodial_native_schedule_source_reserve_at(
 p_source_key uuid,p_employee_id uuid,p_generation_id uuid,p_expected_source_sha256 text,p_operation_id uuid,p_test_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
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
 report:=public.custodial_native_schedule_window_source_at(p_source_key,p_employee_id,p_generation_id,at_time);
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
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_source_reserve_at($1,$2,$3,$4,$5,null);
$fn$;

-- Exact original recovery/status is separate from new reservation admission.
-- A stale/retired/expired source stays readable as ORIGINAL, never sendable.
CREATE FUNCTION public.custodial_native_schedule_source_status_at(p_operation_id uuid,p_employee_id uuid,p_generation_id uuid,p_at timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE prior public.employee_native_schedule_source_reservations%rowtype;current_source jsonb;is_current boolean;record_json jsonb;
BEGIN
 IF p_operation_id IS NULL OR p_employee_id IS NULL OR p_generation_id IS NULL OR p_at IS NULL OR NOT isfinite(p_at) THEN
  RAISE EXCEPTION 'exact original SCHEDULE source status required' USING errcode='22023';END IF;
 SELECT * INTO prior FROM public.employee_native_schedule_source_reservations WHERE operation_id=p_operation_id
  AND employee_id=p_employee_id AND generation_id=p_generation_id;
 IF prior.reservation_id IS NULL THEN RETURN jsonb_build_object('schema','custodial.native-schedule-source-status.v1',
  'status','ORIGINAL_NOT_FOUND','source_current',false,'dispatch_authorized',false,'delivery_admitted',false,'reservation',null);END IF;
 current_source:=public.custodial_native_schedule_window_source_at(prior.source_key,prior.employee_id,prior.generation_id,p_at);
 is_current:=current_source->>'status'='CURRENT_WINDOW_SOURCE_ONLY'
  AND current_source#>>'{window,server_source_sha256}'=prior.source_sha256;
 record_json:=jsonb_build_object('reservation_id',prior.reservation_id,'operation_id',prior.operation_id,
  'reserved_at',public.custodial_native_location_utc(prior.reserved_at),'window',prior.source_window,'window_sha256',prior.source_window_sha256);
 RETURN jsonb_build_object('schema','custodial.native-schedule-source-status.v1','status','ORIGINAL_SOURCE_RETAINED',
  'source_current',coalesce(is_current,false),'current_source_status',current_source->>'status',
  'dispatch_authorized',false,'delivery_admitted',false,'clock_effect_authority',null,'retention_authority',null,'reservation',record_json);
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_source_status(uuid,uuid,uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_source_status_at($1,$2,$3,statement_timestamp());
$fn$;

DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_source_immutable()","name":"custodial_native_schedule_source_immutable","body_md5":"f28abbbcc99d74c15603d172407d59d2","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":false,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamptz)","name":"custodial_native_schedule_source_reserve_at","body_md5":"30b57392771c9d7391dda4c927311fb0","argument_names":["p_source_key","p_employee_id","p_generation_id","p_expected_source_sha256","p_operation_id","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)","name":"custodial_native_schedule_source_reserve","body_md5":"2c57d3dfcc541bfe4d94d17cee0b008a","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]},{"signature":"public.custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamptz)","name":"custodial_native_schedule_source_status_at","body_md5":"2d3139f3408c8e3e6b594c1a4b1f8f75","argument_names":["p_operation_id","p_employee_id","p_generation_id","p_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_status(uuid,uuid,uuid)","name":"custodial_native_schedule_source_status","body_md5":"4cceaaf468ed6266b365456790bfce66","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source104 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_104_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
DO $acl$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN('custodial_native_schedule_source_immutable','custodial_native_schedule_source_reserve_at',
   'custodial_native_schedule_source_reserve','custodial_native_schedule_source_status_at','custodial_native_schedule_source_status') LOOP
  EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.employee_native_schedule_source_reservations'::regclass
  AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O') THEN
  RAISE EXCEPTION 'SCHEDULE source restore mutation fence missing';END IF;
END $acl$;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid),
 public.custodial_native_schedule_source_status(uuid,uuid,uuid) TO service_role;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_source_immutable','custodial_native_schedule_source_reserve_at','custodial_native_schedule_source_reserve','custodial_native_schedule_source_status_at','custodial_native_schedule_source_status']::text[]))<>5
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_104_before)<>6 THEN
  RAISE EXCEPTION 'Finite creator Source104 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_104_before LOOP
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
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[{"relation":"public.employee_native_schedule_source_reservations","name":"trg_native_schedule_source_immutable","function":"public.custodial_native_schedule_source_immutable()","type":27,"enabled":"A"}]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source104 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source104 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_source_immutable()","name":"custodial_native_schedule_source_immutable","body_md5":"f28abbbcc99d74c15603d172407d59d2","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":false,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamptz)","name":"custodial_native_schedule_source_reserve_at","body_md5":"30b57392771c9d7391dda4c927311fb0","argument_names":["p_source_key","p_employee_id","p_generation_id","p_expected_source_sha256","p_operation_id","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)","name":"custodial_native_schedule_source_reserve","body_md5":"2c57d3dfcc541bfe4d94d17cee0b008a","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]},{"signature":"public.custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamptz)","name":"custodial_native_schedule_source_status_at","body_md5":"2d3139f3408c8e3e6b594c1a4b1f8f75","argument_names":["p_operation_id","p_employee_id","p_generation_id","p_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_status(uuid,uuid,uuid)","name":"custodial_native_schedule_source_status","body_md5":"4cceaaf468ed6266b365456790bfce66","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source104 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;


-- Exact recovery closure: new internal relation, fields, constraints, state,
-- immutable/fence triggers, functions and explicit grants, no runtime policy.
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_source_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $canary$ DECLARE definition text;patched text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity='custodial_release_canary_authority_surface()' AND definition_sql=definition
  AND definition_sha256=public.static_weekly_digest_text(definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE source captured canary/ALWAYS boundary changed';END IF;
 patched:=replace(definition,E'  values\n',E'  values\n'
  ||E'    (''relation'',''public.employee_native_schedule_source_reservations'',''immutable09:45source-only original; no delivery''),\n'
  ||E'    (''relation_state'',''public.employee_native_schedule_source_reservations'',''RPC-only FORCE-RLS source original''),\n'
  ||E'    (''grant'',''public.employee_native_schedule_source_reservations'',''no direct runtime source access''),\n'
  ||E'    (''function'',''custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)'',''service-only source reservation; no send''),\n'
  ||E'    (''function'',''custodial_native_schedule_source_status(uuid,uuid,uuid)'',''exact original source readback; no send''),\n');
 IF patched=definition THEN RAISE EXCEPTION 'SCHEDULE source canary seam changed';END IF;EXECUTE patched;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 FOR obj IN WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_native_schedule_source_immutable','custodial_native_schedule_source_reserve_at','custodial_native_schedule_source_reserve',
  'custodial_native_schedule_source_status_at','custodial_native_schedule_source_status','custodial_release_canary_authority_surface')),
 objects AS(
  SELECT 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
  UNION ALL SELECT 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs
  UNION ALL SELECT x.bucket,x.kind,x.identity,x.definition FROM unnest(array['public.employee_native_schedule_source_reservations']) rel CROSS JOIN LATERAL(
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
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'missing SCHEDULE source recovery object %',obj.identity;END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND(object_identity=obj.identity OR(obj.kind IN('function','grant') AND object_identity LIKE '%(%'
    AND obj.identity LIKE '%(%' AND to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  GET DIAGNOSTICS changed=row_count;IF changed>1 THEN RAISE EXCEPTION 'duplicate SCHEDULE source recovery %',obj.identity;END IF;
  IF changed=0 THEN SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF next_order IS NULL THEN RAISE EXCEPTION 'SCHEDULE source recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF EXISTS(SELECT i.* FROM schedule_source_inventory_before i WHERE NOT(
   object_identity='custodial_release_canary_authority_surface()' AND object_kind IN('function','grant'))
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) THEN
  RAISE EXCEPTION 'unrelated SCHEDULE source recovery row changed';END IF;
END $scope$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_source_immutable','custodial_native_schedule_source_reserve_at','custodial_native_schedule_source_reserve','custodial_native_schedule_source_status_at','custodial_native_schedule_source_status']::text[]))<>5
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_104_before)<>6 THEN
  RAISE EXCEPTION 'Finite creator Source104 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_104_before LOOP
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
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[{"relation":"public.employee_native_schedule_source_reservations","name":"trg_native_schedule_source_immutable","function":"public.custodial_native_schedule_source_immutable()","type":27,"enabled":"A"}]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source104 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source104 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_source_immutable()","name":"custodial_native_schedule_source_immutable","body_md5":"f28abbbcc99d74c15603d172407d59d2","argument_names":null,"returns":"trigger","language":"plpgsql","security_definer":false,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_reserve_at(uuid,uuid,uuid,text,uuid,timestamptz)","name":"custodial_native_schedule_source_reserve_at","body_md5":"30b57392771c9d7391dda4c927311fb0","argument_names":["p_source_key","p_employee_id","p_generation_id","p_expected_source_sha256","p_operation_id","p_test_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_reserve(uuid,uuid,uuid,text,uuid)","name":"custodial_native_schedule_source_reserve","body_md5":"2c57d3dfcc541bfe4d94d17cee0b008a","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]},{"signature":"public.custodial_native_schedule_source_status_at(uuid,uuid,uuid,timestamptz)","name":"custodial_native_schedule_source_status_at","body_md5":"2d3139f3408c8e3e6b594c1a4b1f8f75","argument_names":["p_operation_id","p_employee_id","p_generation_id","p_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_source_status(uuid,uuid,uuid)","name":"custodial_native_schedule_source_status","body_md5":"4cceaaf468ed6266b365456790bfce66","argument_names":null,"returns":"jsonb","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source104 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
COMMIT;
