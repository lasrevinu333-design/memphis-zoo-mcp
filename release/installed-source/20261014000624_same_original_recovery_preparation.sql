-- UNAPPLIED SOURCE / ISOLATED LOCAL PROTOTYPE ONLY. No production admission.
-- Preparation approval is NOT ACK, replay, finalizer, reassignment or key access.
-- Challenge registration remains owner-private until Main's new purpose-specific
-- native challenge producer and exact original provenance are available.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA custodial_recovery;
REVOKE ALL ON SCHEMA custodial_recovery FROM PUBLIC,anon,authenticated,service_role,
 custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
-- No runtime schema USAGE. Only three fixed public RPC wrappers below can
-- enter the owner-private store, through the existing backend service role.

CREATE TABLE public.custodial_same_original_recovery_challenges (
 challenge_id uuid PRIMARY KEY,
 operation_id uuid NOT NULL REFERENCES public.custodial_native_private_custody_operations(operation_id) ON DELETE RESTRICT,
 target_sha256 text NOT NULL CHECK(target_sha256 ~ '^[a-f0-9]{64}$'),
 original_target jsonb NOT NULL CHECK(jsonb_typeof(original_target)='object'),
 challenge_sha256 text NOT NULL CHECK(challenge_sha256 ~ '^[a-f0-9]{64}$'),
 preview_sha256 text NOT NULL CHECK(preview_sha256 ~ '^[a-f0-9]{64}$'),
 preview_utf8 text NOT NULL CHECK(octet_length(preview_utf8) BETWEEN 1 AND 16384),
 native_challenge_request_sha256 text NOT NULL CHECK(native_challenge_request_sha256 ~ '^[a-f0-9]{64}$'),
 registered_at timestamptz NOT NULL CHECK(isfinite(registered_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>registered_at AND expires_at<=registered_at+interval '5 minutes'),
 UNIQUE(operation_id,target_sha256)
);
CREATE TABLE public.custodial_same_original_recovery_approvals (
 request_id uuid PRIMARY KEY,
 challenge_id uuid NOT NULL UNIQUE REFERENCES public.custodial_same_original_recovery_challenges(challenge_id) ON DELETE RESTRICT,
 approval_id uuid NOT NULL UNIQUE,
 manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id) ON DELETE RESTRICT,
 manager_credential_id uuid NOT NULL REFERENCES public.ops_manager_trusted_devices(credential_id) ON DELETE RESTRICT,
 manager_device_id text NOT NULL CHECK(manager_device_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 original_request_utf8 text NOT NULL CHECK(octet_length(original_request_utf8) BETWEEN 1 AND 8192),
 original_request_raw_sha256 text NOT NULL CHECK(original_request_raw_sha256 ~ '^[a-f0-9]{64}$'),
 original_request_sha256 text NOT NULL CHECK(original_request_sha256 ~ '^[a-f0-9]{64}$'),
 signed_session_sha256 text NOT NULL CHECK(signed_session_sha256 ~ '^[a-f0-9]{64}$'),
 signed_session_expires_at timestamptz NOT NULL CHECK(isfinite(signed_session_expires_at)),
 security_session_id uuid NOT NULL REFERENCES public.ops_manager_device_security_sessions(session_id) ON DELETE RESTRICT,
 security_password_version integer NOT NULL CHECK(security_password_version>0),
 security_token_hash text NOT NULL CHECK(security_token_hash ~ '^[a-f0-9]{64}$'),
 security_csrf_hash text NOT NULL CHECK(security_csrf_hash ~ '^[a-f0-9]{64}$'),
 receipt_utf8 text NOT NULL CHECK(octet_length(receipt_utf8) BETWEEN 1 AND 24576),
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL CHECK(isfinite(issued_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>issued_at AND expires_at<=issued_at+interval '5 minutes')
);
ALTER TABLE public.custodial_same_original_recovery_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_same_original_recovery_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_same_original_recovery_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_same_original_recovery_approvals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.custodial_same_original_recovery_challenges,public.custodial_same_original_recovery_approvals
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
-- Existing trusted object owner only, explicitly under FORCE RLS. No new role,
-- client policy, generic definer grant or reliance on automatic table grants.
DO $owner$ DECLARE owner_name text;BEGIN
 SELECT r.rolname INTO STRICT owner_name FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
  WHERE c.oid='public.custodial_same_original_recovery_approvals'::regclass;
 IF owner_name IN ('anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator') THEN
  RAISE EXCEPTION 'Recovery prototype requires the existing trusted schema owner';END IF;
 EXECUTE format('CREATE POLICY recovery_challenge_owner ON public.custodial_same_original_recovery_challenges TO %I USING (true) WITH CHECK (true)',owner_name);
 EXECUTE format('CREATE POLICY recovery_approval_owner ON public.custodial_same_original_recovery_approvals TO %I USING (true) WITH CHECK (true)',owner_name);
END $owner$;
CREATE FUNCTION custodial_recovery.reject_original_mutation() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN RAISE EXCEPTION USING errcode='42501',message='same-original preparation records are immutable';END $fn$;
CREATE TRIGGER same_original_challenge_immutable BEFORE UPDATE OR DELETE ON public.custodial_same_original_recovery_challenges
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
CREATE TRIGGER same_original_challenge_no_truncate BEFORE TRUNCATE ON public.custodial_same_original_recovery_challenges
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
CREATE TRIGGER same_original_approval_immutable BEFORE UPDATE OR DELETE ON public.custodial_same_original_recovery_approvals
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
CREATE TRIGGER same_original_approval_no_truncate BEFORE TRUNCATE ON public.custodial_same_original_recovery_approvals
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
ALTER TABLE public.custodial_same_original_recovery_challenges ENABLE ALWAYS TRIGGER same_original_challenge_immutable;
ALTER TABLE public.custodial_same_original_recovery_challenges ENABLE ALWAYS TRIGGER same_original_challenge_no_truncate;
ALTER TABLE public.custodial_same_original_recovery_approvals ENABLE ALWAYS TRIGGER same_original_approval_immutable;
ALTER TABLE public.custodial_same_original_recovery_approvals ENABLE ALWAYS TRIGGER same_original_approval_no_truncate;
DO $fence$ BEGIN
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.custodial_same_original_recovery_challenges'::regclass,
 'public.custodial_same_original_recovery_approvals'::regclass) AND tgname='custodial_disaster_restore_mutation_fence'
 AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND NOT tgisinternal AND tgenabled='O')<>2 THEN
 RAISE EXCEPTION 'Existing application mutation fence missing on new recovery prototype';END IF;
END $fence$;

-- Fixed preparation document encoding only; objects/string/boolean primitives.
CREATE FUNCTION custodial_recovery.canonical_document(p_value jsonb) RETURNS text
 LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $fn$
DECLARE result text;BEGIN
 IF jsonb_typeof(p_value) IN ('string','boolean') THEN RETURN p_value::text;END IF;
 IF jsonb_typeof(p_value)<>'object' THEN RAISE EXCEPTION USING errcode='22023',message='closed preparation document required';END IF;
 SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||custodial_recovery.canonical_document(value),',' ORDER BY key COLLATE "C"),'')||'}'
 INTO result FROM jsonb_each(p_value);RETURN result;
END $fn$;
CREATE FUNCTION custodial_recovery.document_digest(p_kind text,p_value jsonb) RETURNS text
 LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF p_kind NOT IN ('target','request','preview','receipt') THEN RAISE EXCEPTION USING errcode='22023',message='closed preparation digest purpose required';END IF;
 RETURN encode(extensions.digest(convert_to('custodial.same-original-recovery-'||p_kind||'.v1'||E'\n'
  ||custodial_recovery.canonical_document(CASE p_kind WHEN 'preview' THEN p_value-'preview_sha256'
   WHEN 'receipt' THEN p_value-'receipt_sha256' ELSE p_value END),'UTF8'),'sha256'),'hex');
END $fn$;
CREATE FUNCTION custodial_recovery.denied_effects() RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT '{"inventory_acknowledged":false,"work_accepted":false,"replay_allowed":false,"finalizer_allowed":false,"key_removal":false,"phone_released":false}'::jsonb
$fn$;
CREATE FUNCTION custodial_recovery.utc_micros(p_time timestamptz) RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $fn$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$fn$;

-- Server-owned authenticated session pins are comparison inputs, not a bearer
-- JSON credential. Only the fixed server role calls this boundary. Signature,
-- cookie and CSRF verification remain in the actual Main auth adapter.
CREATE FUNCTION custodial_recovery.assert_current_manager(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text)
 RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor jsonb;m public.ops_manager_managers%rowtype;c public.ops_manager_trusted_devices%rowtype;
 cfg public.ops_manager_device_security_config%rowtype;s public.ops_manager_device_security_sessions%rowtype;
 decision_time timestamptz;BEGIN
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,'full_access','write');
 SELECT * INTO STRICT c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential FOR SHARE;
 SELECT * INTO STRICT m FROM public.ops_manager_managers WHERE manager_id=p_manager FOR SHARE;
 SELECT * INTO STRICT cfg FROM public.ops_manager_device_security_config WHERE singleton FOR SHARE;
 SELECT * INTO STRICT s FROM public.ops_manager_device_security_sessions WHERE session_id=p_security_session FOR SHARE;
 decision_time:=clock_timestamp();
 IF ('SECURITY_ADMIN'=ANY(m.roles)) IS DISTINCT FROM true OR m.active IS DISTINCT FROM true OR m.revoked_at IS NOT NULL OR m.is_system_principal IS DISTINCT FROM false
  OR m.system_key IS DISTINCT FROM 'eric_custodial_manager' OR c.max_access_level IS DISTINCT FROM 'full_access'
  OR c.manager_id IS DISTINCT FROM p_manager OR c.device_id IS DISTINCT FROM p_device OR c.revoked_at IS NOT NULL
  OR c.expires_at<=decision_time OR c.created_at>decision_time
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=decision_time
  OR s.manager_id IS DISTINCT FROM p_manager OR s.credential_id IS DISTINCT FROM p_credential
  OR s.revoked_at IS NOT NULL OR s.expires_at<=decision_time OR s.created_at>decision_time
  OR s.password_version IS DISTINCT FROM cfg.password_version OR s.password_version IS DISTINCT FROM p_password_version
  OR p_security_hash IS NULL OR p_security_hash !~ '^[a-f0-9]{64}$' OR s.token_hash IS DISTINCT FROM p_security_hash
  OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[a-f0-9]{64}$' OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR cfg.sessions_revoked_at IS NOT NULL AND s.created_at<=cfg.sessions_revoked_at THEN
  RAISE EXCEPTION USING errcode='42501',message='current same-original owner security session required';END IF;
 RETURN least(decision_time+interval '5 minutes',p_signed_expires,c.expires_at,s.expires_at);
END $fn$;

-- Historical opaque retention is a necessary source pin, not native challenge
-- authentication. This comparison does not register or approve caller JSON.
CREATE FUNCTION custodial_recovery.assert_original_target(p_target jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE op public.custodial_native_private_custody_operations%rowtype;c public.device_auth_credentials%rowtype;
 context jsonb;generation jsonb;expected jsonb;keys text[];assembled bytea;counted integer;BEGIN
 IF jsonb_typeof(p_target) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING errcode='22023',message='original preparation target required';END IF;
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations WHERE operation_id=(p_target->>'operation_id')::uuid FOR SHARE;
 SELECT * INTO STRICT c FROM public.device_auth_credentials WHERE credential_id=op.credential_id AND device_id=op.device_id FOR SHARE;
 -- Legacy absence/rotation is unresolved. Never stamp today's key identifier
 -- into an original; a Main original challenge must already bind this pin.
 IF c.revoked_at IS NOT NULL OR c.confirmed_at IS NULL
  OR jsonb_typeof(c.metadata_json->'credential_secret_key_id') IS DISTINCT FROM 'string'
  OR c.metadata_json->>'credential_secret_key_id' !~ '^[a-f0-9]{64}$'
  OR c.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_target->>'original_credential_secret_key_id' THEN
  RAISE EXCEPTION USING errcode='42501',message='original credential key provenance unavailable or changed';END IF;
 context:=public.custodial_v13_read_separation_context(op.device_id,op.credential_id);
 IF context IS NULL OR context IS DISTINCT FROM op.original_context OR context->>'state' IS DISTINCT FROM 'PENDING_RECONCILIATION' THEN
  RAISE EXCEPTION USING errcode='42501',message='original separation source changed';END IF;
 PERFORM 1 FROM public.custodial_employee_separation_fences WHERE separation_id=op.separation_id FOR SHARE;
 generation:=public.custodial_v14_read_separation_generation(op.device_id,op.credential_id,op.separation_id,op.generation_id,op.principal_digest);
 IF generation IS NULL OR generation IS DISTINCT FROM op.original_generation THEN
  RAISE EXCEPTION USING errcode='42501',message='original generation source changed';END IF;
 expected:=jsonb_build_object('operation_id',op.operation_id,'separation_id',op.separation_id,
  'separation_authority_revision',context->>'authority_revision','canonical_device_pk',op.device_id,
  'canonical_device_id',context->>'canonical_device_id','employee_id',context->>'employee_id','credential_id',op.credential_id,
  'assignment_epoch',context->>'assignment_epoch','original_generation_id',op.generation_id,
  'original_credential_secret_key_id',c.metadata_json->>'credential_secret_key_id','principal_digest',op.principal_digest,
  'engine_revision',op.owner_proof->>'engine_revision','original_wire_sha256',op.original_wire_sha256,
  'original_frozen_work_sha256',op.owner_proof->>'original_frozen_work_sha256','capsule_sha256',op.owner_proof->>'capsule_sha256',
  'record_sha256',op.record_sha256,'frame_sha256',op.frame_sha256,'plan_sha256',op.plan_sha256,
  'aad_binding_sha256',op.owner_proof->>'aad_binding_sha256','source_capture_sha256',op.owner_proof->>'source_capture_sha256',
  'values_sha256',op.owner_proof->>'values_sha256','semantic_join_sha256',op.owner_proof->>'semantic_join_sha256','layout_sha256',op.owner_proof->>'layout_sha256');
 IF p_target IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM jsonb_each(expected) WHERE jsonb_typeof(value)<>'string') THEN
  RAISE EXCEPTION USING errcode='42501',message='exact original preparation source tuple required';END IF;
 SELECT count(*),decode(string_agg(encode(chunk_bytes,'hex'),'' ORDER BY chunk_index),'hex') INTO counted,assembled
  FROM public.custodial_native_private_custody_chunks WHERE operation_id=op.operation_id;
 IF counted<>op.chunk_count OR octet_length(assembled) IS DISTINCT FROM op.frame_bytes
  OR encode(extensions.digest(assembled,'sha256'),'hex') IS DISTINCT FROM op.frame_sha256 THEN
  RAISE EXCEPTION USING errcode='42501',message='complete original opaque frame unavailable';END IF;
END $fn$;

CREATE FUNCTION custodial_recovery.issue_original_preparation_once(
 p_manager uuid,p_credential uuid,p_device text,p_signed_sha text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text,p_original_utf8 text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;challenge public.custodial_same_original_recovery_challenges%rowtype;
 prior public.custodial_same_original_recovery_approvals%rowtype;request_sha text;receipt jsonb;
 issued timestamptz;expiry timestamptz;approval uuid;keys text[];BEGIN
 IF p_original_utf8 IS NULL OR octet_length(p_original_utf8) NOT BETWEEN 1 AND 8192
  OR p_signed_sha IS NULL OR p_signed_sha !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='original preparation request required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_utf8::json,0);request:=p_original_utf8::jsonb;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO keys FROM jsonb_object_keys(request) key;
 IF keys IS DISTINCT FROM ARRAY['challenge_id','decision','expected_challenge_sha256','expected_manager_credential_id','expected_manager_device_id','expected_manager_id',
  'expected_preview_sha256','manager_confirmation','request_id','schema']::text[]
  OR request->>'schema' IS DISTINCT FROM 'custodial.same-original-recovery-approval-request.v1'
  OR request->>'decision' IS DISTINCT FROM 'AUTHORIZE_SAME_ORIGINAL_RECOVERY_PREPARATION'
  OR request->>'manager_confirmation' IS DISTINCT FROM 'CONFIRM_THIS_SAME_ORIGINAL_ONLY'
  OR request->>'expected_manager_id' IS DISTINCT FROM p_manager::text
  OR request->>'expected_manager_credential_id' IS DISTINCT FROM p_credential::text
  OR request->>'expected_manager_device_id' IS DISTINCT FROM p_device
  OR EXISTS(SELECT 1 FROM jsonb_each(request) WHERE jsonb_typeof(value)<>'string')
  OR request->>'request_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  OR request->>'challenge_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  OR p_device IS NULL OR p_device !~ '^[A-Za-z0-9_-]{1,128}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='exact original preparation request and issuer required';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 expiry:=custodial_recovery.assert_current_manager(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 SELECT * INTO STRICT challenge FROM public.custodial_same_original_recovery_challenges
  WHERE challenge_id=(request->>'challenge_id')::uuid FOR SHARE;
 IF request->>'expected_challenge_sha256' IS DISTINCT FROM challenge.challenge_sha256
  OR request->>'expected_preview_sha256' IS DISTINCT FROM challenge.preview_sha256 THEN
  RAISE EXCEPTION USING errcode='40001',message='original preparation preview changed';END IF;
 PERFORM custodial_recovery.assert_original_target(challenge.original_target);
 -- Serialize competing confirmations for THIS immutable original challenge.
 PERFORM pg_advisory_xact_lock(hashtextextended('same-original-preparation:'||challenge.challenge_id::text,0));
 request_sha:=custodial_recovery.document_digest('request',request);
 SELECT * INTO prior FROM public.custodial_same_original_recovery_approvals WHERE request_id=(request->>'request_id')::uuid;
 IF FOUND THEN
  IF prior.manager_id<>p_manager OR prior.manager_credential_id<>p_credential OR prior.manager_device_id<>p_device
   OR prior.original_request_utf8 IS DISTINCT FROM p_original_utf8 OR prior.original_request_sha256<>request_sha THEN
   RAISE EXCEPTION USING errcode='23505',message='conflicting original preparation request';END IF;
  RETURN prior.receipt_utf8;
 END IF;
 issued:=clock_timestamp();expiry:=least(expiry,challenge.expires_at);
 IF expiry<=issued THEN RAISE EXCEPTION USING errcode='42501',message='original preparation expired';END IF;
 IF EXISTS(SELECT 1 FROM public.custodial_same_original_recovery_approvals WHERE challenge_id=challenge.challenge_id) THEN
  RAISE EXCEPTION USING errcode='23505',message='original challenge already confirmed';END IF;
 approval:=gen_random_uuid();
 receipt:=jsonb_build_object('schema','custodial.same-original-recovery-approval-receipt.v1','state','APPROVAL_RECORDED_ONLY',
  'approval_id',approval,'original_request',request,'original_request_sha256',request_sha,
  'issuer',jsonb_build_object('manager_id',p_manager,'manager_credential_id',p_credential,'manager_device_id',p_device),
  'challenge_sha256',challenge.challenge_sha256,'preview_sha256',challenge.preview_sha256,'original_target',challenge.original_target,
  'purpose_admission_id','same-original-preparation.v1','issued_at',custodial_recovery.utc_micros(issued),
  'expires_at',custodial_recovery.utc_micros(expiry),'retry_safe',false,'limits',custodial_recovery.denied_effects());
 receipt:=receipt||jsonb_build_object('receipt_sha256',custodial_recovery.document_digest('receipt',receipt));
 INSERT INTO public.custodial_same_original_recovery_approvals(request_id,challenge_id,approval_id,manager_id,manager_credential_id,manager_device_id,
 original_request_utf8,original_request_raw_sha256,original_request_sha256,signed_session_sha256,signed_session_expires_at,
 security_session_id,security_password_version,security_token_hash,security_csrf_hash,receipt_utf8,receipt_sha256,issued_at,expires_at)
 VALUES((request->>'request_id')::uuid,challenge.challenge_id,approval,p_manager,p_credential,p_device,p_original_utf8,
 encode(extensions.digest(convert_to(p_original_utf8,'UTF8'),'sha256'),'hex'),request_sha,p_signed_sha,p_signed_expires,
 p_security_session,p_password_version,p_security_hash,p_csrf_hash,custodial_recovery.canonical_document(receipt),receipt->>'receipt_sha256',issued,expiry);
 RETURN custodial_recovery.canonical_document(receipt);
END $fn$;

CREATE FUNCTION custodial_recovery.read_original_preparation(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_original_utf8 text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;prior public.custodial_same_original_recovery_approvals%rowtype;BEGIN
 PERFORM custodial_recovery.assert_current_manager(p_manager,p_credential,p_device,p_signed_expires,
 p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 IF p_original_utf8 IS NULL OR octet_length(p_original_utf8) NOT BETWEEN 1 AND 8192 THEN
 RAISE EXCEPTION USING errcode='22023',message='original preparation status request required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_utf8::json,0);request:=p_original_utf8::jsonb;
 SELECT * INTO prior FROM public.custodial_same_original_recovery_approvals WHERE request_id=(request->>'request_id')::uuid;
 IF NOT FOUND OR prior.manager_id<>p_manager OR prior.manager_credential_id<>p_credential OR prior.manager_device_id<>p_device
  OR prior.original_request_utf8 IS DISTINCT FROM p_original_utf8 THEN RETURN NULL;END IF;
 RETURN prior.receipt_utf8; -- Original bytes/time only; never writer/upsert/renew.
END $fn$;
CREATE FUNCTION custodial_recovery.read_preparation_preview(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_challenge uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE challenge public.custodial_same_original_recovery_challenges%rowtype;BEGIN
 PERFORM custodial_recovery.assert_current_manager(p_manager,p_credential,p_device,p_signed_expires,
 p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 SELECT * INTO challenge FROM public.custodial_same_original_recovery_challenges WHERE challenge_id=p_challenge FOR SHARE;
 IF NOT FOUND OR challenge.expires_at<=clock_timestamp() THEN RETURN NULL;END IF;
 PERFORM custodial_recovery.assert_original_target(challenge.original_target);
 IF challenge.preview_sha256 IS DISTINCT FROM custodial_recovery.document_digest('preview',challenge.preview_utf8::jsonb)
  OR challenge.original_target IS DISTINCT FROM challenge.preview_utf8::jsonb->'original_target'
  OR challenge.challenge_sha256 IS DISTINCT FROM challenge.preview_utf8::jsonb->>'challenge_sha256'
  OR challenge.challenge_id::text IS DISTINCT FROM challenge.preview_utf8::jsonb->>'challenge_id' THEN
 RAISE EXCEPTION USING errcode='42501',message='original preparation preview source changed';END IF;
 RETURN challenge.preview_utf8;
END $fn$;
CREATE FUNCTION public.custodial_same_original_preparation_issue_v1(
 p_manager uuid,p_credential uuid,p_device text,p_signed_sha text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text,p_original_utf8 text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.issue_original_preparation_once(p_manager,p_credential,p_device,p_signed_sha,p_signed_expires,
 p_security_session,p_password_version,p_security_hash,p_csrf_hash,p_original_utf8)
$fn$;
CREATE FUNCTION public.custodial_same_original_preparation_status_v1(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_original_utf8 text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_original_preparation(p_manager,p_credential,p_device,p_signed_expires,
 p_security_session,p_password_version,p_security_hash,p_csrf_hash,p_original_utf8)
$fn$;
CREATE FUNCTION public.custodial_same_original_preparation_preview_v1(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_challenge uuid)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_preparation_preview(p_manager,p_credential,p_device,p_signed_expires,
 p_security_session,p_password_version,p_security_hash,p_csrf_hash,p_challenge)
$fn$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA custodial_recovery FROM PUBLIC,anon,authenticated,service_role,
 custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_same_original_preparation_issue_v1(uuid,uuid,text,text,timestamptz,uuid,integer,text,text,text),
 public.custodial_same_original_preparation_status_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,text),
 public.custodial_same_original_preparation_preview_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_same_original_preparation_issue_v1(uuid,uuid,text,text,timestamptz,uuid,integer,text,text,text),
 public.custodial_same_original_preparation_status_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,text),
 public.custodial_same_original_preparation_preview_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid)
 TO service_role;
-- No challenge insert/registration or native claim runtime grant. No direct
-- ledger access; no current schema/canary/recovery admission is claimed here.
COMMIT;
