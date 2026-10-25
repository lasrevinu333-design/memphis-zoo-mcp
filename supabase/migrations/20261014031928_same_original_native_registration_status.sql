-- SOURCE + ISOLATED LOCAL PROTOTYPE ONLY. Same original status, never resend.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION custodial_recovery.read_native_registration_original(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_original_write_request uuid,p_original_write_body_sha256 text,p_original_write_attestation_digest text,
 p_native_request uuid,p_native_request_timestamp timestamptz,p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_utf8 text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE source jsonb;original public.custodial_same_original_recovery_challenges%rowtype;BEGIN
 IF p_operation IS NULL OR p_device IS NULL OR p_credential IS NULL OR p_generation IS NULL OR p_native_request IS NULL
  OR p_original_write_request IS NULL OR p_chunk_index IS DISTINCT FROM 0
  OR p_original_utf8 IS NULL OR octet_length(p_original_utf8) NOT BETWEEN 1 AND 786432
  OR p_native_request_timestamp IS NULL OR NOT isfinite(p_native_request_timestamp)
  OR p_native_request_body_sha256 IS NULL OR p_native_request_body_sha256 !~ '^[a-f0-9]{64}$'
  OR p_native_attestation_digest IS NULL OR p_native_attestation_digest !~ '^[a-f0-9]{64}$'
  OR encode(extensions.digest(convert_to(p_original_utf8,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_native_request_body_sha256 THEN
  RAISE EXCEPTION USING errcode='22023',message='fixed same original native status inputs required';END IF;
 -- Same statement snapshot/current original credential and complete retained
 -- target. Never replace issuer/generation from today's defaults or a row ID.
 source:=custodial_recovery.read_original_target(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,p_generation,
  p_chunk_index,p_original_write_request,p_original_write_body_sha256,p_original_write_attestation_digest);
 IF source IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO original FROM public.custodial_same_original_recovery_challenges WHERE challenge_id=p_native_request;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF original.operation_id IS DISTINCT FROM p_operation
  OR original.target_sha256 IS DISTINCT FROM source->>'original_target_sha256'
  OR original.original_target IS DISTINCT FROM source->'original_target'
  OR original.native_request_id IS DISTINCT FROM p_native_request
  OR original.native_request_timestamp IS DISTINCT FROM p_native_request_timestamp
  OR original.native_challenge_request_sha256 IS DISTINCT FROM p_native_request_body_sha256
  OR original.native_attestation_digest IS DISTINCT FROM p_native_attestation_digest
  OR original.native_request_utf8 IS DISTINCT FROM p_original_utf8 THEN
  RAISE EXCEPTION USING errcode='42501',message='native status belongs to another original request';END IF;
 PERFORM custodial_recovery.assert_registered_challenge(original);
 -- Exact stored receipt, including its original expiry and six false effects.
 -- Expired historical evidence is not renewed current preparation authority.
 RETURN original.native_registration_receipt_utf8;
END $fn$;
CREATE FUNCTION public.custodial_same_original_preparation_registration_status_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_original_write_request uuid,p_original_write_body_sha256 text,p_original_write_attestation_digest text,
 p_native_request uuid,p_native_request_timestamp timestamptz,p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_utf8 text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_native_registration_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,p_generation,
  p_chunk_index,p_original_write_request,p_original_write_body_sha256,p_original_write_attestation_digest,p_native_request,p_native_request_timestamp,
  p_native_request_body_sha256,p_native_attestation_digest,p_original_utf8)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.read_native_registration_original(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_same_original_preparation_registration_status_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_same_original_preparation_registration_status_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 TO service_role;
COMMIT;
