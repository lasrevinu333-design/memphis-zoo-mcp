-- UNAPPLIED SOURCE / isolated local prototype. The original manager records
-- a logical-separation decision for one exact retained inventory. This record
-- is not a native private ACK/finalizer capability and removes no original,
-- history, credential, key, employee assignment or phone containment.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.custodial_original_inventory_separation_approvals (
 request_id uuid PRIMARY KEY,
 inventory_native_request_id uuid NOT NULL UNIQUE REFERENCES public.custodial_native_inventory_requests(native_request_id) ON DELETE RESTRICT,
 approval_id uuid NOT NULL UNIQUE,
 manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id) ON DELETE RESTRICT,
 manager_credential_id uuid NOT NULL REFERENCES public.ops_manager_trusted_devices(credential_id) ON DELETE RESTRICT,
 manager_device_id text NOT NULL CHECK(manager_device_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 original_request_utf8 text NOT NULL CHECK(octet_length(original_request_utf8) BETWEEN 1 AND 8192),
 original_request_sha256 text NOT NULL CHECK(original_request_sha256 ~ '^[a-f0-9]{64}$'),
 original_target jsonb NOT NULL CHECK(jsonb_typeof(original_target)='object'),
 review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 registration_receipt_sha256 text NOT NULL CHECK(registration_receipt_sha256 ~ '^[a-f0-9]{64}$'),
 signed_session_sha256 text NOT NULL CHECK(signed_session_sha256 ~ '^[a-f0-9]{64}$'),
 signed_session_expires_at timestamptz NOT NULL CHECK(isfinite(signed_session_expires_at)),
 security_session_id uuid NOT NULL REFERENCES public.ops_manager_device_security_sessions(session_id) ON DELETE RESTRICT,
 security_password_version integer NOT NULL CHECK(security_password_version>0),
 security_token_hash text NOT NULL CHECK(security_token_hash ~ '^[a-f0-9]{64}$'),
 security_csrf_hash text NOT NULL CHECK(security_csrf_hash ~ '^[a-f0-9]{64}$'),
 receipt_utf8 text NOT NULL CHECK(octet_length(receipt_utf8) BETWEEN 1 AND 24576),
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 approved_at timestamptz NOT NULL CHECK(isfinite(approved_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>approved_at AND expires_at<=approved_at+interval '5 minutes'),
 CHECK(original_request_sha256=encode(extensions.digest(convert_to(original_request_utf8,'UTF8'),'sha256'),'hex'))
);
ALTER TABLE public.custodial_original_inventory_separation_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_original_inventory_separation_approvals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.custodial_original_inventory_separation_approvals FROM PUBLIC,anon,authenticated,service_role,
 custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
DO $owner$ DECLARE owner_name text;BEGIN
 SELECT r.rolname INTO STRICT owner_name FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
  WHERE c.oid='public.custodial_original_inventory_separation_approvals'::regclass;
 IF owner_name IN ('anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator') THEN
  RAISE EXCEPTION 'Existing trusted recovery owner required';END IF;
 EXECUTE format('CREATE POLICY original_inventory_approval_owner ON public.custodial_original_inventory_separation_approvals TO %I USING (true) WITH CHECK (true)',owner_name);
END $owner$;
CREATE TRIGGER original_inventory_approval_immutable BEFORE UPDATE OR DELETE ON public.custodial_original_inventory_separation_approvals
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
CREATE TRIGGER original_inventory_approval_no_truncate BEFORE TRUNCATE ON public.custodial_original_inventory_separation_approvals
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
ALTER TABLE public.custodial_original_inventory_separation_approvals ENABLE ALWAYS TRIGGER original_inventory_approval_immutable;
ALTER TABLE public.custodial_original_inventory_separation_approvals ENABLE ALWAYS TRIGGER original_inventory_approval_no_truncate;
DO $fence$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_original_inventory_separation_approvals'::regclass
  AND tgname='custodial_disaster_restore_mutation_fence' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure
  AND NOT tgisinternal AND tgenabled='O') THEN RAISE EXCEPTION 'Existing application mutation fence missing';END IF;
END $fence$;

CREATE FUNCTION custodial_recovery.inventory_manager_original_command(p_original_utf8 text,p_manager uuid,p_credential uuid,p_device text)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE request jsonb;BEGIN
 IF p_original_utf8 IS NULL OR octet_length(p_original_utf8) NOT BETWEEN 1 AND 8192 THEN
  RAISE EXCEPTION USING errcode='22023',message='bounded original inventory decision required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_utf8::json,0);request:=p_original_utf8::jsonb;
 IF NOT custodial_recovery.inventory_object_keys(request,ARRAY['schema','request_id','native_request_id',
   'expected_review_sha256','expected_inventory_manifest_sha256','expected_registration_receipt_sha256',
   'expected_separation_authority_revision','expected_manager_id','expected_manager_credential_id',
   'expected_manager_device_id','decision','manager_confirmation'])
  OR EXISTS(SELECT 1 FROM jsonb_each(request) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')
  OR request->>'schema' IS DISTINCT FROM 'custodial.original-inventory-separation-request.v1'
  OR request->>'decision' IS DISTINCT FROM 'AUTHORIZE_EXACT_ORIGINAL_RETAINED_INVENTORY_SEPARATION'
  OR request->>'manager_confirmation' IS DISTINCT FROM 'CONFIRM_LOGICAL_SEPARATION_KEEP_ALL_ORIGINAL_WORK_AND_KEYS'
  OR request->>'expected_manager_id' IS DISTINCT FROM p_manager::text
  OR request->>'expected_manager_credential_id' IS DISTINCT FROM p_credential::text
  OR request->>'expected_manager_device_id' IS DISTINCT FROM p_device
  OR p_device IS NULL OR p_device !~ '^[A-Za-z0-9_-]{1,128}$'
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['request_id','native_request_id','expected_manager_id','expected_manager_credential_id']) k
   WHERE request->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['expected_review_sha256','expected_inventory_manifest_sha256','expected_registration_receipt_sha256']) k
   WHERE request->>k !~ '^[a-f0-9]{64}$')
  OR request->>'expected_separation_authority_revision' !~ '^[1-9][0-9]{0,15}$'
  OR (request->>'expected_separation_authority_revision')::numeric>9007199254740991 THEN
  RAISE EXCEPTION USING errcode='22023',message='closed original inventory command and issuer required';END IF;
 RETURN request;
END $fn$;
CREATE FUNCTION custodial_recovery.inventory_manager_receipt_document(saved public.custodial_original_inventory_separation_approvals)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE request jsonb;receipt jsonb;digest text;BEGIN
 request:=custodial_recovery.inventory_manager_original_command(saved.original_request_utf8,saved.manager_id,saved.manager_credential_id,saved.manager_device_id);
 IF saved.original_request_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(saved.original_request_utf8,'UTF8'),'sha256'),'hex')
  OR request->>'request_id' IS DISTINCT FROM saved.request_id::text
  OR request->>'native_request_id' IS DISTINCT FROM saved.inventory_native_request_id::text
  OR request->>'expected_review_sha256' IS DISTINCT FROM saved.review_sha256
  OR request->>'expected_inventory_manifest_sha256' IS DISTINCT FROM saved.manifest_sha256
  OR request->>'expected_registration_receipt_sha256' IS DISTINCT FROM saved.registration_receipt_sha256
  OR request->>'expected_separation_authority_revision' IS DISTINCT FROM saved.original_target->>'separation_authority_revision' THEN
  RAISE EXCEPTION USING errcode='42501',message='immutable original inventory decision changed';END IF;
 receipt:=jsonb_build_object('schema','custodial.original-inventory-separation-receipt.v1',
  'state','INVENTORY_ACK_RECORDED_LOGICAL_SEPARATION_ONLY','approval_id',saved.approval_id,
  'original_request',request,'original_request_sha256',saved.original_request_sha256,'original_target',saved.original_target,
  'issuer',jsonb_build_object('manager_id',saved.manager_id,'manager_credential_id',saved.manager_credential_id,'manager_device_id',saved.manager_device_id),
  'inventory_manifest_sha256',saved.manifest_sha256,'registration_receipt_sha256',saved.registration_receipt_sha256,
  'approved_at',custodial_recovery.utc_micros(saved.approved_at),'expires_at',custodial_recovery.utc_micros(saved.expires_at),
  'purpose_admission_id','exact-original-retained-inventory-separation.v1','retry_safe',false,
  'limits',custodial_recovery.denied_effects()||'{"inventory_acknowledged":true,"finalizer_allowed":true}'::jsonb);
 digest:=encode(extensions.digest(convert_to('custodial.original-inventory-separation-receipt.v1'||E'\n'
  ||custodial_recovery.canonical_document(receipt),'UTF8'),'sha256'),'hex');
 receipt:=receipt||jsonb_build_object('receipt_sha256',digest);
 IF saved.receipt_sha256 IS NOT NULL AND saved.receipt_sha256 IS DISTINCT FROM digest THEN
  RAISE EXCEPTION USING errcode='42501',message='immutable original decision receipt digest changed';END IF;
 IF saved.receipt_utf8 IS NOT NULL AND saved.receipt_utf8 IS DISTINCT FROM custodial_recovery.canonical_document(receipt) THEN
  RAISE EXCEPTION USING errcode='42501',message='immutable original decision receipt bytes changed';END IF;
 RETURN custodial_recovery.canonical_document(receipt);
END $fn$;

CREATE FUNCTION custodial_recovery.issue_original_inventory_decision_once(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_signed_sha text,p_original_utf8 text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;review jsonb;registered public.custodial_native_inventory_requests%rowtype;
 saved public.custodial_original_inventory_separation_approvals%rowtype;expiry timestamptz;BEGIN
 request:=custodial_recovery.inventory_manager_original_command(p_original_utf8,p_manager,p_credential,p_device);
 IF p_signed_sha IS NULL OR p_signed_sha !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='actual signed original owner session required';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 expiry:=custodial_recovery.assert_current_manager(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 PERFORM pg_advisory_xact_lock(hashtextextended('original-native-inventory-manifest:'||(request->>'native_request_id'),0));
 SELECT * INTO STRICT registered FROM public.custodial_native_inventory_requests
  WHERE native_request_id=(request->>'native_request_id')::uuid FOR SHARE;
 -- The normal immutable native frame/current separation/generation owner is
 -- held and reopened, not replaced by the request's hashes or a WORK witness.
 review:=custodial_recovery.review_original_inventory(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash,registered.native_request_id);
 IF review IS NULL OR request->>'expected_review_sha256' IS DISTINCT FROM review->>'review_sha256'
  OR request->>'expected_inventory_manifest_sha256' IS DISTINCT FROM review->>'inventory_manifest_sha256'
  OR request->>'expected_registration_receipt_sha256' IS DISTINCT FROM review->>'registration_receipt_sha256'
  OR request->>'expected_separation_authority_revision' IS DISTINCT FROM review#>>'{original_target,separation_authority_revision}' THEN
  RAISE EXCEPTION USING errcode='40001',message='exact original inventory review changed';END IF;
 PERFORM custodial_recovery.assert_original_target(review->'original_target');
 PERFORM 1 FROM public.devices WHERE id=(review#>>'{original_target,canonical_device_pk}')::uuid FOR SHARE;
 PERFORM 1 FROM public.employees WHERE id=(review#>>'{original_target,employee_id}')::uuid FOR SHARE;
 PERFORM 1 FROM public.employee_native_push_generations WHERE generation_id=(review#>>'{original_target,original_generation_id}')::uuid FOR SHARE;
 -- Duplicate/uncertain writes never become a second dispatch. Only the
 -- separate fixed original-status reader may recover a persisted decision.
 IF EXISTS(SELECT 1 FROM public.custodial_original_inventory_separation_approvals
  WHERE request_id=(request->>'request_id')::uuid OR inventory_native_request_id=registered.native_request_id) THEN
  RAISE EXCEPTION USING errcode='23505',message='original inventory decision exists; read original status only';END IF;
 expiry:=least(expiry,(review->>'expires_at')::timestamptz,
  custodial_recovery.assert_current_manager(p_manager,p_credential,p_device,p_signed_expires,
   p_security_session,p_password_version,p_security_hash,p_csrf_hash));
 PERFORM custodial_recovery.assert_original_target(review->'original_target');
 saved.approved_at:=clock_timestamp();IF saved.approved_at>=expiry THEN
  RAISE EXCEPTION USING errcode='42501',message='original inventory decision expired';END IF;
 saved.request_id:=(request->>'request_id')::uuid;saved.inventory_native_request_id:=registered.native_request_id;
 saved.approval_id:=gen_random_uuid();saved.manager_id:=p_manager;saved.manager_credential_id:=p_credential;saved.manager_device_id:=p_device;
 saved.original_request_utf8:=p_original_utf8;saved.original_request_sha256:=encode(extensions.digest(convert_to(p_original_utf8,'UTF8'),'sha256'),'hex');
 saved.original_target:=review->'original_target';saved.review_sha256:=review->>'review_sha256';saved.manifest_sha256:=review->>'inventory_manifest_sha256';
 saved.registration_receipt_sha256:=review->>'registration_receipt_sha256';saved.signed_session_sha256:=p_signed_sha;
 saved.signed_session_expires_at:=p_signed_expires;saved.security_session_id:=p_security_session;saved.security_password_version:=p_password_version;
 saved.security_token_hash:=p_security_hash;saved.security_csrf_hash:=p_csrf_hash;saved.expires_at:=expiry;
 saved.receipt_utf8:=custodial_recovery.inventory_manager_receipt_document(saved);
 saved.receipt_sha256:=saved.receipt_utf8::jsonb->>'receipt_sha256';
 INSERT INTO public.custodial_original_inventory_separation_approvals SELECT saved.*;
 -- These two server-reported flags describe the stored decision only. The
 -- native engine STILL requires its unforgeable current all-writer/browser
 -- inventory admission before logical finalization. No effect occurs here.
 RETURN saved.receipt_utf8;
END $fn$;

CREATE FUNCTION custodial_recovery.read_original_inventory_decision(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_original_utf8 text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;saved public.custodial_original_inventory_separation_approvals%rowtype;receipt text;BEGIN
 PERFORM custodial_recovery.assert_inventory_manager_read(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 request:=custodial_recovery.inventory_manager_original_command(p_original_utf8,p_manager,p_credential,p_device);
 SELECT * INTO saved FROM public.custodial_original_inventory_separation_approvals WHERE request_id=(request->>'request_id')::uuid;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF saved.original_request_utf8 IS DISTINCT FROM p_original_utf8 OR saved.inventory_native_request_id::text IS DISTINCT FROM request->>'native_request_id'
  OR saved.manager_id IS DISTINCT FROM p_manager OR saved.manager_credential_id IS DISTINCT FROM p_credential
  OR saved.manager_device_id IS DISTINCT FROM p_device THEN
  RAISE EXCEPTION USING errcode='42501',message='only exact original inventory decision status may be read';END IF;
 receipt:=custodial_recovery.inventory_manager_receipt_document(saved);
 PERFORM custodial_recovery.assert_inventory_manager_read(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 RETURN receipt; -- Historical bytes, never a freshness renewal or native admission.
END $fn$;

CREATE FUNCTION custodial_recovery.read_native_inventory_decision_current(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE registered text;saved public.custodial_original_inventory_separation_approvals%rowtype;review jsonb;receipt text;BEGIN
 registered:=custodial_recovery.read_native_inventory_request_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_request_utf8);
 IF registered IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO saved FROM public.custodial_original_inventory_separation_approvals WHERE inventory_native_request_id=p_native_request;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF clock_timestamp()>=saved.expires_at OR saved.approved_at>clock_timestamp() THEN
  RAISE EXCEPTION USING errcode='42501',message='original inventory approval no longer current';END IF;
 receipt:=custodial_recovery.inventory_manager_receipt_document(saved);
 -- The current native caller cannot select the manager/session or reuse a
 -- historical receipt as live authority. All pins derive from its immutable
 -- actual original issuing row, then the complete semantics are re-read now.
 review:=custodial_recovery.review_original_inventory(saved.manager_id,saved.manager_credential_id,saved.manager_device_id,
  saved.signed_session_expires_at,saved.security_session_id,saved.security_password_version,saved.security_token_hash,saved.security_csrf_hash,
  saved.inventory_native_request_id);
 IF review IS NULL OR review->>'review_sha256' IS DISTINCT FROM saved.review_sha256
  OR review->'original_target' IS DISTINCT FROM saved.original_target
  OR review->>'inventory_manifest_sha256' IS DISTINCT FROM saved.manifest_sha256
  OR review->>'registration_receipt_sha256' IS DISTINCT FROM saved.registration_receipt_sha256
  OR registered IS DISTINCT FROM custodial_recovery.read_native_inventory_request_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
   p_generation,p_separation,p_authority_revision,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_request_utf8)
  OR clock_timestamp()>=saved.expires_at THEN
  RAISE EXCEPTION USING errcode='42501',message='current exact original inventory approval source changed';END IF;
 RETURN receipt; -- Still DATA; no native capability, removal or replay authority.
END $fn$;

CREATE FUNCTION public.custodial_original_inventory_separation_issue_v1(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_signed_sha text,p_original_utf8 text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.issue_original_inventory_decision_once(p_manager,p_credential,p_device,p_signed_expires,p_security_session,
  p_password_version,p_security_hash,p_csrf_hash,p_signed_sha,p_original_utf8)
$fn$;
CREATE FUNCTION public.custodial_original_inventory_separation_status_v1(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,
 p_password_version integer,p_security_hash text,p_csrf_hash text,p_original_utf8 text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_original_inventory_decision(p_manager,p_credential,p_device,p_signed_expires,p_security_session,
  p_password_version,p_security_hash,p_csrf_hash,p_original_utf8)
$fn$;
CREATE FUNCTION public.custodial_read_native_original_inventory_separation_approval_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_native_inventory_decision_current(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_request_utf8)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.inventory_manager_original_command(text,uuid,uuid,text),
 custodial_recovery.inventory_manager_receipt_document(public.custodial_original_inventory_separation_approvals),
 custodial_recovery.issue_original_inventory_decision_once(uuid,uuid,text,timestamptz,uuid,integer,text,text,text,text),
 custodial_recovery.read_original_inventory_decision(uuid,uuid,text,timestamptz,uuid,integer,text,text,text),
 custodial_recovery.read_native_inventory_decision_current(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text),
 public.custodial_original_inventory_separation_issue_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,text,text),
 public.custodial_original_inventory_separation_status_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,text),
 public.custodial_read_native_original_inventory_separation_approval_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_original_inventory_separation_issue_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,text,text),
 public.custodial_original_inventory_separation_status_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,text),
 public.custodial_read_native_original_inventory_separation_approval_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 TO service_role;
COMMIT;
