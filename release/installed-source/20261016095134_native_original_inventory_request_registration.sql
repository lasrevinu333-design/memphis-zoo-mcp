-- UNAPPLIED SOURCE / isolated local prototype only. A retained REQUEST is not
-- inventory acceptance, semantic disposition, ACK or destructive authority.
-- The fixed backend authenticates the exact purpose + HTTP HMAC before this
-- private service RPC; THIS transaction reopens the existing original rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE public.custodial_native_inventory_requests (
 native_request_id uuid PRIMARY KEY,
 operation_id uuid NOT NULL REFERENCES public.custodial_native_private_custody_operations(operation_id) ON DELETE RESTRICT,
 generation_id uuid NOT NULL,
 challenge_id uuid NOT NULL REFERENCES public.custodial_same_original_recovery_challenges(challenge_id) ON DELETE RESTRICT,
 original_request_utf8 text NOT NULL CHECK(octet_length(original_request_utf8) BETWEEN 1 AND 65536),
 request_body_sha256 text NOT NULL CHECK(request_body_sha256 ~ '^[a-f0-9]{64}$'),
 native_request_timestamp timestamptz NOT NULL CHECK(isfinite(native_request_timestamp)),
 native_attestation_digest text NOT NULL CHECK(native_attestation_digest ~ '^[a-f0-9]{64}$'),
 intent_document_sha256 text NOT NULL CHECK(intent_document_sha256 ~ '^[a-f0-9]{64}$'),
 intent_disk_sha256 text NOT NULL CHECK(intent_disk_sha256 ~ '^[a-f0-9]{64}$'),
 registered_at timestamptz NOT NULL CHECK(isfinite(registered_at)),
 receipt_utf8 text NOT NULL CHECK(octet_length(receipt_utf8) BETWEEN 1 AND 8192),
 UNIQUE(operation_id,generation_id),
 CHECK(native_request_timestamp BETWEEN registered_at-interval '120 seconds' AND registered_at+interval '30 seconds')
);
ALTER TABLE public.custodial_native_inventory_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_native_inventory_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.custodial_native_inventory_requests FROM PUBLIC,anon,authenticated,service_role,
 custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
DO $owner$ DECLARE owner_name text;BEGIN
 SELECT r.rolname INTO STRICT owner_name FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
  WHERE c.oid='public.custodial_native_inventory_requests'::regclass;
 IF owner_name IN ('anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator') THEN
  RAISE EXCEPTION 'Existing trusted recovery owner required';END IF;
 EXECUTE format('CREATE POLICY native_inventory_request_owner ON public.custodial_native_inventory_requests TO %I USING (true) WITH CHECK (true)',owner_name);
END $owner$;
CREATE TRIGGER native_inventory_request_immutable BEFORE UPDATE OR DELETE ON public.custodial_native_inventory_requests
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
CREATE TRIGGER native_inventory_request_no_truncate BEFORE TRUNCATE ON public.custodial_native_inventory_requests
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
ALTER TABLE public.custodial_native_inventory_requests ENABLE ALWAYS TRIGGER native_inventory_request_immutable;
ALTER TABLE public.custodial_native_inventory_requests ENABLE ALWAYS TRIGGER native_inventory_request_no_truncate;
DO $fence$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_native_inventory_requests'::regclass
  AND tgname='custodial_disaster_restore_mutation_fence' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure
  AND NOT tgisinternal AND tgenabled='O') THEN RAISE EXCEPTION 'Existing application mutation fence missing';END IF;
END $fence$;

CREATE FUNCTION custodial_recovery.register_native_inventory_request_once(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;intent jsonb;target jsonb;keys text[];binding text;preparation_digest text;
 op public.custodial_native_private_custody_operations%rowtype;
 chunk public.custodial_native_private_custody_chunks%rowtype;
 credential public.device_auth_credentials%rowtype;
 challenge public.custodial_same_original_recovery_challenges%rowtype;
 approval public.custodial_same_original_recovery_approvals%rowtype;
 manager_read text;registered timestamptz;receipt jsonb;receipt_sha text;BEGIN
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
  RAISE EXCEPTION USING errcode='22023',message='bounded original inventory request required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_request_utf8::json,0);
 request:=p_original_request_utf8::jsonb;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING errcode='22023',message='closed inventory request required';END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO keys FROM jsonb_object_keys(request) key;
 IF keys IS DISTINCT FROM ARRAY['original_intent_disk_sha256','original_intent_document_sha256','original_intent_utf8',
  'original_preparation_http_attestation','original_preparation_native_request_id','original_preparation_request_body_sha256',
  'purpose','purpose_attestation','purpose_binding_sha256','schema']::text[]
  OR EXISTS(SELECT 1 FROM jsonb_each(request) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')
  OR request->>'schema' IS DISTINCT FROM 'custodial.original-native-inventory-ack-request.v1'
  OR request->>'purpose' IS DISTINCT FROM 'REQUEST_EXACT_ORIGINAL_INVENTORY_ACK'
  OR octet_length(request->>'original_intent_utf8') NOT BETWEEN 1 AND 16384 THEN
  RAISE EXCEPTION USING errcode='22023',message='original inventory purpose required';END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['original_intent_disk_sha256','original_intent_document_sha256',
  'original_preparation_http_attestation','original_preparation_request_body_sha256','purpose_attestation','purpose_binding_sha256']) k
  WHERE request->>k !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION USING errcode='22023',message='original request hashes required';END IF;
 IF encode(extensions.digest(convert_to(request->>'original_intent_utf8','UTF8'),'sha256'),'hex')
  IS DISTINCT FROM request->>'original_intent_document_sha256' THEN RAISE EXCEPTION USING errcode='42501',message='original intent bytes changed';END IF;
 PERFORM public.custodial_v15_assert_native_json((request->>'original_intent_utf8')::json,0);
 intent:=(request->>'original_intent_utf8')::jsonb;
 IF jsonb_typeof(intent) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING errcode='22023',message='closed original intent required';END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO keys FROM jsonb_object_keys(intent) key;
 IF keys IS DISTINCT FROM ARRAY['browser_frame_sha256','browser_part_set_sha256','created_at','finalizer_allowed','intent_id',
  'inventory_acknowledged','key_removal','native_held_stamp','original_target','phone_released','purpose','replay_allowed','schema','work_accepted']::text[]
  OR intent->>'schema' IS DISTINCT FROM 'custodial.native-original-inventory-ack-intent.v1'
  OR intent->>'purpose' IS DISTINCT FROM 'PREPARE_EXACT_ORIGINAL_INVENTORY_ACK'
  OR intent->>'intent_id' IS DISTINCT FROM p_native_request::text
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['schema','purpose','intent_id','native_held_stamp','browser_frame_sha256',
    'browser_part_set_sha256','created_at']) k WHERE jsonb_typeof(intent->k) IS DISTINCT FROM 'string')
  OR intent->>'native_held_stamp' !~ '^DURABLE_HELD:[1-9][0-9]{0,18}$'
  OR substring(intent->>'native_held_stamp' FROM 14)::numeric>9223372036854775807
  OR intent->>'browser_frame_sha256' !~ '^[a-f0-9]{64}$' OR intent->>'browser_part_set_sha256' !~ '^[a-f0-9]{64}$'
  OR intent->>'created_at' IS DISTINCT FROM to_char((intent->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR intent->>'created_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  OR left(intent->>'created_at',4)='0000'
  OR EXISTS(SELECT 1 FROM jsonb_each(custodial_recovery.denied_effects()) f WHERE intent->f.key IS DISTINCT FROM 'false'::jsonb) THEN
  RAISE EXCEPTION USING errcode='22023',message='exact original held intent with no effect rights required';END IF;
 binding:=encode(extensions.digest(convert_to('custodial.native-original-inventory-ack-purpose.v1'||E'\n'
  ||(request->>'original_intent_disk_sha256')||E'\n'||(request->>'original_intent_document_sha256')||E'\n'
  ||(request->>'original_preparation_native_request_id')||E'\n'||(request->>'original_preparation_request_body_sha256')||E'\n'
  ||(request->>'original_preparation_http_attestation'),'UTF8'),'sha256'),'hex');
 IF binding IS DISTINCT FROM request->>'purpose_binding_sha256' THEN RAISE EXCEPTION USING errcode='42501',message='original purpose binding changed';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations WHERE operation_id=p_operation FOR SHARE;
 SELECT * INTO STRICT credential FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device FOR SHARE;
 IF op.device_id IS DISTINCT FROM p_device OR op.credential_id IS DISTINCT FROM p_credential
  OR op.generation_id IS DISTINCT FROM p_generation OR op.separation_id IS DISTINCT FROM p_separation
  OR op.original_context->>'authority_revision' IS DISTINCT FROM p_authority_revision
  OR credential.token_hash IS DISTINCT FROM p_credential_hash OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id
  OR credential.revoked_at IS NOT NULL OR credential.confirmed_at IS NULL OR credential.expires_at IS NULL
  OR NOT isfinite(credential.expires_at) OR credential.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING errcode='42501',message='current original inventory principal required';END IF;
 target:=intent->'original_target';PERFORM custodial_recovery.assert_original_target(target);
 IF target->>'operation_id' IS DISTINCT FROM p_operation::text OR target->>'original_generation_id' IS DISTINCT FROM p_generation::text
  OR target->>'canonical_device_pk' IS DISTINCT FROM p_device::text OR target->>'credential_id' IS DISTINCT FROM p_credential::text
  OR target->>'original_credential_secret_key_id' IS DISTINCT FROM p_credential_key_id THEN
  RAISE EXCEPTION USING errcode='42501',message='same original inventory target required';END IF;
 SELECT * INTO STRICT challenge FROM public.custodial_same_original_recovery_challenges
  WHERE challenge_id=(request->>'original_preparation_native_request_id')::uuid AND operation_id=p_operation FOR SHARE;
 PERFORM custodial_recovery.assert_registered_challenge(challenge);
 IF challenge.original_target IS DISTINCT FROM target
  OR challenge.native_challenge_request_sha256 IS DISTINCT FROM request->>'original_preparation_request_body_sha256' THEN
  RAISE EXCEPTION USING errcode='42501',message='original preparation does not match inventory request';END IF;
 -- All entries in this JSON transcript are fixed ASCII strings without comma
 -- spaces. Removing the jsonb separators reproduces the existing JS array
 -- digest; it does not normalize original request/intent bytes.
 preparation_digest:=encode(extensions.digest(convert_to(replace(jsonb_build_array('custodial-native-request.v1',p_credential::text,
  target->>'canonical_device_id','POST','/device-auth/same-original-recovery/challenge',challenge.native_challenge_request_sha256,
  challenge.native_request_id::text,to_char(challenge.native_request_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  request->>'original_preparation_http_attestation')::text,', ',','),'UTF8'),'sha256'),'hex');
 IF preparation_digest IS DISTINCT FROM challenge.native_attestation_digest THEN
  RAISE EXCEPTION USING errcode='42501',message='original preparation attestation changed';END IF;
 SELECT * INTO STRICT chunk FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation AND chunk_index=0 FOR SHARE;
 SELECT * INTO STRICT approval FROM public.custodial_same_original_recovery_approvals WHERE challenge_id=challenge.challenge_id FOR SHARE;
 PERFORM custodial_recovery.assert_current_manager(approval.manager_id,approval.manager_credential_id,approval.manager_device_id,
  approval.signed_session_expires_at,approval.security_session_id,approval.security_password_version,approval.security_token_hash,approval.security_csrf_hash);
 manager_read:=custodial_recovery.read_current_native_manager_preparation(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,0,chunk.native_request_id,chunk.request_body_sha256,chunk.attestation_digest,challenge.native_request_id,
  challenge.native_request_timestamp,challenge.native_challenge_request_sha256,challenge.native_attestation_digest,challenge.native_request_utf8);
 IF manager_read IS NULL THEN RAISE EXCEPTION USING errcode='42501',message='current original manager preparation unavailable';END IF;
 -- Registration is one INSERT, never an upsert/retry or historical adoption.
 -- A lost response is UNKNOWN and needs the later authenticated status route.
 PERFORM pg_advisory_xact_lock(hashtextextended('original-native-inventory-request:'||p_operation::text,0));
 IF EXISTS(SELECT 1 FROM public.custodial_native_inventory_requests WHERE native_request_id=p_native_request
  OR operation_id=p_operation AND generation_id=p_generation) THEN
  RAISE EXCEPTION USING errcode='23505',message='original inventory request exists; status only';END IF;
 PERFORM custodial_recovery.assert_current_manager(approval.manager_id,approval.manager_credential_id,approval.manager_device_id,
  approval.signed_session_expires_at,approval.security_session_id,approval.security_password_version,approval.security_token_hash,approval.security_csrf_hash);
 registered:=clock_timestamp();
 IF challenge.expires_at<=registered OR approval.expires_at<=registered OR credential.expires_at<=registered
  OR p_native_request_timestamp>registered+interval '30 seconds' OR p_native_request_timestamp<registered-interval '120 seconds' THEN
  RAISE EXCEPTION USING errcode='42501',message='original inventory request timestamp expired';END IF;
 receipt_sha:=encode(extensions.digest(convert_to('custodial.native-original-inventory-request-registration-digest.v1'||E'\n'
  ||p_native_request::text||E'\n'||p_operation::text||E'\n'||p_generation::text||E'\n'||p_native_request_body_sha256||E'\n'
  ||(request->>'original_intent_document_sha256')||E'\n'||(request->>'original_intent_disk_sha256')||E'\n'
  ||custodial_recovery.utc_micros(registered),'UTF8'),'sha256'),'hex');
 receipt:=jsonb_build_object('schema','custodial.native-original-inventory-request-registration.v1','state','REGISTERED_REQUEST_ONLY_NOT_ACK',
  'native_request_id',p_native_request,'operation_id',p_operation,'original_generation_id',p_generation,'request_body_sha256',p_native_request_body_sha256,
  'intent_document_sha256',request->>'original_intent_document_sha256','intent_disk_sha256',request->>'original_intent_disk_sha256',
  'registered_at',custodial_recovery.utc_micros(registered),'receipt_sha256',receipt_sha,'limits',custodial_recovery.denied_effects());
 INSERT INTO public.custodial_native_inventory_requests(native_request_id,operation_id,generation_id,challenge_id,original_request_utf8,
  request_body_sha256,native_request_timestamp,native_attestation_digest,intent_document_sha256,intent_disk_sha256,registered_at,receipt_utf8)
 VALUES(p_native_request,p_operation,p_generation,challenge.challenge_id,p_original_request_utf8,p_native_request_body_sha256,
  p_native_request_timestamp,p_native_attestation_digest,request->>'original_intent_document_sha256',request->>'original_intent_disk_sha256',registered,receipt::text);
 RETURN receipt::text;
END $fn$;
CREATE FUNCTION public.custodial_register_native_original_inventory_request_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.register_native_inventory_request_once(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_request_utf8)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.register_native_inventory_request_once(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_register_native_original_inventory_request_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
-- Fixed private backend RPC only; no direct table, schema or client grants.
-- This source is not permission to apply operational grants/deployments.
GRANT EXECUTE ON FUNCTION public.custodial_register_native_original_inventory_request_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text) TO service_role;
COMMIT;
