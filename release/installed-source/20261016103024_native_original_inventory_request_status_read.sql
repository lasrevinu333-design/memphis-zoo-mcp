-- UNAPPLIED SOURCE / isolated prototype only. Current authenticated original
-- device READS an immutable registration; no re-registration/renewal or ACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION custodial_recovery.read_native_inventory_request_original(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE op public.custodial_native_private_custody_operations%rowtype;
 chunk public.custodial_native_private_custody_chunks%rowtype;credential public.device_auth_credentials%rowtype;
 saved public.custodial_native_inventory_requests%rowtype;source jsonb;request jsonb;intent jsonb;receipt jsonb;expected jsonb;digest text;
BEGIN
 IF p_operation IS NULL OR p_device IS NULL OR p_credential IS NULL OR p_generation IS NULL OR p_separation IS NULL
  OR p_native_request IS NULL OR p_original_request_utf8 IS NULL OR octet_length(p_original_request_utf8) NOT BETWEEN 1 AND 65536
  OR p_credential_hash IS NULL OR p_credential_hash !~ '^[a-f0-9]{64}$'
  OR p_credential_key_id IS NULL OR p_credential_key_id !~ '^[a-f0-9]{64}$'
  OR p_native_request_body_sha256 IS NULL OR p_native_request_body_sha256 !~ '^[a-f0-9]{64}$'
  OR p_native_attestation_digest IS NULL OR p_native_attestation_digest !~ '^[a-f0-9]{64}$'
  OR p_authority_revision IS NULL OR p_authority_revision !~ '^[1-9][0-9]*$'
  OR p_native_request_timestamp IS NULL OR NOT isfinite(p_native_request_timestamp)
  OR mod(extract(microseconds FROM p_native_request_timestamp)::bigint,1000)<>0
  OR encode(extensions.digest(convert_to(p_original_request_utf8,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_native_request_body_sha256 THEN
  RAISE EXCEPTION USING errcode='22023',message='bounded same-original inventory status required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_request_utf8::json,0);request:=p_original_request_utf8::jsonb;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object'
  OR request->>'schema' IS DISTINCT FROM 'custodial.original-native-inventory-ack-request.v1'
  OR request->>'purpose' IS DISTINCT FROM 'REQUEST_EXACT_ORIGINAL_INVENTORY_ACK'
  OR jsonb_typeof(request->'original_intent_utf8') IS DISTINCT FROM 'string'
  OR octet_length(request->>'original_intent_utf8') NOT BETWEEN 1 AND 16384 THEN
  RAISE EXCEPTION USING errcode='22023',message='exact original request required';END IF;
 SELECT * INTO op FROM public.custodial_native_private_custody_operations WHERE operation_id=p_operation;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT credential FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device;
 IF op.device_id IS DISTINCT FROM p_device OR op.credential_id IS DISTINCT FROM p_credential
  OR op.generation_id IS DISTINCT FROM p_generation OR op.separation_id IS DISTINCT FROM p_separation
  OR op.original_context->>'authority_revision' IS DISTINCT FROM p_authority_revision
  OR credential.token_hash IS DISTINCT FROM p_credential_hash OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id
  OR credential.revoked_at IS NOT NULL OR credential.confirmed_at IS NULL OR NOT isfinite(credential.confirmed_at)
  OR credential.confirmed_at>clock_timestamp() OR credential.expires_at IS NULL OR NOT isfinite(credential.expires_at)
  OR credential.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING errcode='42501',message='current original status principal required';END IF;
 SELECT * INTO STRICT chunk FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation AND chunk_index=0;
 -- This existing intended READ ONLY owner rechecks current separation,
 -- generation and complete original frame; no FOR SHARE/mutation/bootstrap.
 source:=custodial_recovery.read_original_target(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,p_generation,
  0,chunk.native_request_id,chunk.request_body_sha256,chunk.attestation_digest);
 IF source IS NULL THEN RETURN NULL;END IF;
 PERFORM public.custodial_v15_assert_native_json((request->>'original_intent_utf8')::json,0);
 intent:=(request->>'original_intent_utf8')::jsonb;
 IF jsonb_typeof(intent) IS DISTINCT FROM 'object' OR intent->'original_target' IS DISTINCT FROM source->'original_target'
  OR intent->>'intent_id' IS DISTINCT FROM p_native_request::text
  OR request->>'original_intent_document_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(request->>'original_intent_utf8','UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION USING errcode='42501',message='same original inventory target required';END IF;
 SELECT * INTO saved FROM public.custodial_native_inventory_requests WHERE native_request_id=p_native_request;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF saved.operation_id IS DISTINCT FROM p_operation OR saved.generation_id IS DISTINCT FROM p_generation
  OR saved.original_request_utf8 IS DISTINCT FROM p_original_request_utf8 OR saved.native_request_timestamp IS DISTINCT FROM p_native_request_timestamp
  OR saved.request_body_sha256 IS DISTINCT FROM p_native_request_body_sha256 OR saved.native_attestation_digest IS DISTINCT FROM p_native_attestation_digest
  OR saved.intent_document_sha256 IS DISTINCT FROM request->>'original_intent_document_sha256'
  OR saved.intent_disk_sha256 IS DISTINCT FROM request->>'original_intent_disk_sha256'
  OR saved.challenge_id::text IS DISTINCT FROM request->>'original_preparation_native_request_id'
  OR saved.request_body_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(saved.original_request_utf8,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION USING errcode='42501',message='status belongs to another original request';END IF;
 PERFORM public.custodial_v15_assert_native_json(saved.receipt_utf8::json,0);receipt:=saved.receipt_utf8::jsonb;
 digest:=encode(extensions.digest(convert_to('custodial.native-original-inventory-request-registration-digest.v1'||E'\n'
  ||saved.native_request_id::text||E'\n'||saved.operation_id::text||E'\n'||saved.generation_id::text||E'\n'
  ||saved.request_body_sha256||E'\n'||saved.intent_document_sha256||E'\n'||saved.intent_disk_sha256||E'\n'
  ||custodial_recovery.utc_micros(saved.registered_at),'UTF8'),'sha256'),'hex');
 expected:=jsonb_build_object('schema','custodial.native-original-inventory-request-registration.v1','state','REGISTERED_REQUEST_ONLY_NOT_ACK',
  'native_request_id',saved.native_request_id,'operation_id',saved.operation_id,'original_generation_id',saved.generation_id,
  'request_body_sha256',saved.request_body_sha256,'intent_document_sha256',saved.intent_document_sha256,
  'intent_disk_sha256',saved.intent_disk_sha256,'registered_at',custodial_recovery.utc_micros(saved.registered_at),
  'receipt_sha256',digest,'limits',custodial_recovery.denied_effects());
 IF receipt IS DISTINCT FROM expected THEN RAISE EXCEPTION USING errcode='42501',message='immutable inventory registration receipt changed';END IF;
 -- Historical receipt is not renewed manager approval, present transaction
 -- admission or an effect capability; all six rights remain exactly false.
 RETURN saved.receipt_utf8;
END $fn$;
CREATE FUNCTION public.custodial_read_native_original_inventory_request_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_native_inventory_request_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_request_utf8)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.read_native_inventory_request_original(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_read_native_original_inventory_request_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_read_native_original_inventory_request_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 TO service_role,custodial_application_reader;
COMMIT;
