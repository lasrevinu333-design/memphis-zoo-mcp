-- UNAPPLIED SOURCE / isolated qualification only. No new table, direct table
-- grant, approval, token, registration, replay or destructive capability.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION custodial_recovery.read_current_native_manager_preparation(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_original_write_request uuid,p_original_write_body_sha256 text,p_original_write_attestation_digest text,
 p_native_request uuid,p_native_request_timestamp timestamptz,p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_utf8 text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE registered text;challenge public.custodial_same_original_recovery_challenges%rowtype;
 approval public.custodial_same_original_recovery_approvals%rowtype;
 manager public.ops_manager_managers%rowtype;credential public.ops_manager_trusted_devices%rowtype;
 config public.ops_manager_device_security_config%rowtype;session public.ops_manager_device_security_sessions%rowtype;
 receipt jsonb;request jsonb;observed timestamptz;until_time timestamptz;BEGIN
 -- Revalidate the SAME original native credential, frame, target, request and
 -- attestation under this one statement snapshot before looking for approval.
 registered:=custodial_recovery.read_native_registration_original(p_operation,p_device,p_credential,p_credential_hash,
  p_credential_key_id,p_generation,p_chunk_index,p_original_write_request,p_original_write_body_sha256,
  p_original_write_attestation_digest,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,
  p_native_attestation_digest,p_original_utf8);
 IF registered IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT challenge FROM public.custodial_same_original_recovery_challenges WHERE challenge_id=p_native_request;
 SELECT * INTO approval FROM public.custodial_same_original_recovery_approvals WHERE challenge_id=challenge.challenge_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT manager FROM public.ops_manager_managers WHERE manager_id=approval.manager_id;
 SELECT * INTO STRICT credential FROM public.ops_manager_trusted_devices WHERE credential_id=approval.manager_credential_id;
 SELECT * INTO STRICT config FROM public.ops_manager_device_security_config WHERE singleton;
 SELECT * INTO STRICT session FROM public.ops_manager_device_security_sessions WHERE session_id=approval.security_session_id;
 observed:=clock_timestamp();
 -- Same owner/password floor as the original issue path, without row locks:
 -- this read has NO mutation/effect authority and must run in READ ONLY SQL.
 IF manager.active IS DISTINCT FROM true OR manager.revoked_at IS NOT NULL
  OR manager.is_system_principal IS DISTINCT FROM false OR manager.system_key IS DISTINCT FROM 'eric_custodial_manager'
  OR ('SECURITY_ADMIN'=ANY(manager.roles)) IS DISTINCT FROM true OR nullif(btrim(manager.display_name),'') IS NULL
  OR credential.manager_id IS DISTINCT FROM manager.manager_id OR credential.device_id IS DISTINCT FROM approval.manager_device_id
  OR credential.max_access_level IS DISTINCT FROM 'full_access' OR credential.revoked_at IS NOT NULL
  OR credential.created_at IS NULL OR credential.created_at>observed OR credential.expires_at IS NULL
  OR NOT isfinite(credential.expires_at) OR credential.expires_at<=observed
  OR NOT isfinite(approval.signed_session_expires_at) OR approval.signed_session_expires_at<=observed
  OR session.manager_id IS DISTINCT FROM approval.manager_id OR session.credential_id IS DISTINCT FROM approval.manager_credential_id
  OR session.revoked_at IS NOT NULL OR session.created_at IS NULL OR session.created_at>observed
  OR session.expires_at IS NULL OR NOT isfinite(session.expires_at) OR session.expires_at<=observed
  OR session.password_version IS DISTINCT FROM config.password_version
  OR session.password_version IS DISTINCT FROM approval.security_password_version
  OR session.token_hash IS DISTINCT FROM approval.security_token_hash OR session.csrf_hash IS DISTINCT FROM approval.security_csrf_hash
  OR config.sessions_revoked_at IS NOT NULL AND session.created_at<=config.sessions_revoked_at
  OR challenge.expires_at<=observed OR approval.expires_at<=observed OR approval.issued_at>observed THEN
  RAISE EXCEPTION USING errcode='42501',message='current original owner preparation session required';END IF;
 PERFORM public.custodial_v15_assert_native_json(approval.original_request_utf8::json,0);
 PERFORM public.custodial_v15_assert_native_json(approval.receipt_utf8::json,0);
 request:=approval.original_request_utf8::jsonb;receipt:=approval.receipt_utf8::jsonb;
 IF approval.original_request_raw_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(approval.original_request_utf8,'UTF8'),'sha256'),'hex')
  OR approval.original_request_sha256 IS DISTINCT FROM custodial_recovery.document_digest('request',request)
  OR approval.receipt_sha256 IS DISTINCT FROM custodial_recovery.document_digest('receipt',receipt)
  OR receipt->>'receipt_sha256' IS DISTINCT FROM approval.receipt_sha256
  OR receipt->>'schema' IS DISTINCT FROM 'custodial.same-original-recovery-approval-receipt.v1'
  OR receipt->>'state' IS DISTINCT FROM 'APPROVAL_RECORDED_ONLY'
  OR receipt->>'purpose_admission_id' IS DISTINCT FROM 'same-original-preparation.v1'
  OR receipt->>'approval_id' IS DISTINCT FROM approval.approval_id::text
  OR receipt->'original_request' IS DISTINCT FROM request
  OR receipt->>'original_request_sha256' IS DISTINCT FROM approval.original_request_sha256
  OR receipt->'original_target' IS DISTINCT FROM challenge.original_target
  OR receipt->>'challenge_sha256' IS DISTINCT FROM challenge.challenge_sha256
  OR receipt->>'preview_sha256' IS DISTINCT FROM challenge.preview_sha256
  OR receipt->'issuer' IS DISTINCT FROM jsonb_build_object('manager_id',approval.manager_id,
   'manager_credential_id',approval.manager_credential_id,'manager_device_id',approval.manager_device_id)
  OR receipt->>'issued_at' IS DISTINCT FROM custodial_recovery.utc_micros(approval.issued_at)
  OR receipt->>'expires_at' IS DISTINCT FROM custodial_recovery.utc_micros(approval.expires_at)
  OR receipt->'retry_safe' IS DISTINCT FROM 'false'::jsonb OR receipt->'limits' IS DISTINCT FROM custodial_recovery.denied_effects()
  OR request->>'schema' IS DISTINCT FROM 'custodial.same-original-recovery-approval-request.v1'
  OR request->>'decision' IS DISTINCT FROM 'AUTHORIZE_SAME_ORIGINAL_RECOVERY_PREPARATION'
  OR request->>'manager_confirmation' IS DISTINCT FROM 'CONFIRM_THIS_SAME_ORIGINAL_ONLY'
  OR request->>'challenge_id' IS DISTINCT FROM challenge.challenge_id::text
  OR request->>'request_id' IS DISTINCT FROM approval.request_id::text
  OR request->>'expected_challenge_sha256' IS DISTINCT FROM challenge.challenge_sha256
  OR request->>'expected_preview_sha256' IS DISTINCT FROM challenge.preview_sha256
  OR request->>'expected_manager_id' IS DISTINCT FROM approval.manager_id::text
  OR request->>'expected_manager_credential_id' IS DISTINCT FROM approval.manager_credential_id::text
  OR request->>'expected_manager_device_id' IS DISTINCT FROM approval.manager_device_id THEN
  RAISE EXCEPTION USING errcode='42501',message='original manager preparation receipt changed';END IF;
 until_time:=least(challenge.expires_at,approval.expires_at,approval.signed_session_expires_at,credential.expires_at,session.expires_at);
 RETURN custodial_recovery.canonical_document(jsonb_build_object(
  'schema','custodial.same-original-current-manager-preparation.v1',
  'state','CURRENT_MANAGER_PREPARATION_OBSERVED_NO_EFFECT_RIGHTS','purpose_admission_id','same-original-preparation.v1',
  'original_registration_utf8',registered,'original_approval_receipt_utf8',approval.receipt_utf8,
  'observed_at',custodial_recovery.utc_micros(observed),'current_until',custodial_recovery.utc_micros(until_time),
  'transaction_authority',false,'limits',custodial_recovery.denied_effects()));
END $fn$;
CREATE FUNCTION public.custodial_same_original_current_manager_preparation_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_original_write_request uuid,p_original_write_body_sha256 text,p_original_write_attestation_digest text,
 p_native_request uuid,p_native_request_timestamp timestamptz,p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_utf8 text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_current_native_manager_preparation(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_chunk_index,p_original_write_request,p_original_write_body_sha256,p_original_write_attestation_digest,
  p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_utf8)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.read_current_native_manager_preparation(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_same_original_current_manager_preparation_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
-- Source-only fixed backend entrypoint; no client/table/security administration
-- privilege. Deployment/operational grant changes remain separately controlled.
GRANT EXECUTE ON FUNCTION public.custodial_same_original_current_manager_preparation_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text) TO service_role;
COMMIT;
