-- SOURCE + ISOLATED LOCAL PROTOTYPE ONLY; no production admission.
-- Native registration records a preparation challenge. It grants none of
-- ACK, work acceptance, replay, finalization, key access or phone reuse.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Preserve any predecessor rows without backfill/adopting today's issuer.
-- New inserts must carry their exact new-purpose provenance below.
ALTER TABLE public.custodial_same_original_recovery_challenges
 ADD COLUMN native_request_utf8 text,
 ADD COLUMN native_request_id uuid,
 ADD COLUMN native_request_timestamp timestamptz,
 ADD COLUMN native_attestation_digest text,
 ADD COLUMN native_intent_record_sha256 text,
 ADD COLUMN native_registration_receipt_utf8 text;

CREATE FUNCTION custodial_recovery.assert_registered_challenge(
 p_challenge public.custodial_same_original_recovery_challenges) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE request jsonb;receipt jsonb;keys text[];BEGIN
 IF p_challenge.native_request_utf8 IS NULL OR octet_length(p_challenge.native_request_utf8) NOT BETWEEN 1 AND 786432
  OR p_challenge.native_request_id IS NULL OR p_challenge.native_request_id<>p_challenge.challenge_id
  OR p_challenge.native_request_timestamp IS NULL OR NOT isfinite(p_challenge.native_request_timestamp)
  OR p_challenge.native_attestation_digest IS NULL OR p_challenge.native_attestation_digest !~ '^[a-f0-9]{64}$'
  OR p_challenge.native_intent_record_sha256 IS NULL OR p_challenge.native_intent_record_sha256 !~ '^[a-f0-9]{64}$'
  OR p_challenge.native_registration_receipt_utf8 IS NULL
  OR octet_length(p_challenge.native_registration_receipt_utf8) NOT BETWEEN 1 AND 24576
  OR p_challenge.native_challenge_request_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(p_challenge.native_request_utf8,'UTF8'),'sha256'),'hex')
  OR p_challenge.native_request_timestamp>p_challenge.registered_at+interval '30 seconds'
  OR p_challenge.native_request_timestamp<p_challenge.registered_at-interval '120 seconds'
  OR p_challenge.expires_at>least(p_challenge.registered_at+interval '5 minutes',p_challenge.native_request_timestamp+interval '5 minutes') THEN
  RAISE EXCEPTION USING errcode='42501',message='original native preparation provenance unavailable';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_challenge.native_request_utf8::json,0);
 request:=p_challenge.native_request_utf8::jsonb;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING errcode='22023',message='closed original challenge required';END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO keys FROM jsonb_object_keys(request) key;
 IF keys IS DISTINCT FROM ARRAY['current_original_query_envelope_base64','native_challenge_intent_id','native_challenge_intent_record_sha256',
   'original_target','original_target_sha256','purpose','schema']::text[]
  OR request->>'schema' IS DISTINCT FROM 'custodial.same-original-recovery-native-challenge.v1'
  OR request->>'purpose' IS DISTINCT FROM 'AUTHORIZE_SAME_ORIGINAL_RECOVERY_PREPARATION'
  OR request->>'native_challenge_intent_id' IS DISTINCT FROM p_challenge.native_request_id::text
  OR request->>'native_challenge_intent_record_sha256' IS DISTINCT FROM p_challenge.native_intent_record_sha256
  OR request->'original_target' IS DISTINCT FROM p_challenge.original_target
  OR request->>'original_target_sha256' IS DISTINCT FROM p_challenge.target_sha256
  OR p_challenge.target_sha256 IS DISTINCT FROM custodial_recovery.document_digest('target',p_challenge.original_target) THEN
  RAISE EXCEPTION USING errcode='42501',message='exact original native preparation binding required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_challenge.native_registration_receipt_utf8::json,0);
 receipt:=p_challenge.native_registration_receipt_utf8::jsonb;
 IF receipt IS DISTINCT FROM jsonb_build_object(
  'schema','custodial.same-original-recovery-native-challenge-receipt.v1','state','ORIGINAL_CHALLENGE_RECORDED_PREPARATION_ONLY',
  'challenge_id',p_challenge.challenge_id,'challenge_sha256',p_challenge.challenge_sha256,'original_target_sha256',p_challenge.target_sha256,
  'native_challenge_intent_id',p_challenge.native_request_id,'native_challenge_intent_record_sha256',p_challenge.native_intent_record_sha256,
  'registered_at',custodial_recovery.utc_micros(p_challenge.registered_at),'expires_at',custodial_recovery.utc_micros(p_challenge.expires_at),
  'retry_safe',false,'limits',custodial_recovery.denied_effects()) THEN
  RAISE EXCEPTION USING errcode='42501',message='original native registration receipt changed';END IF;
END $fn$;

CREATE FUNCTION custodial_recovery.guard_native_registration() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE challenge public.custodial_same_original_recovery_challenges%rowtype;BEGIN
 IF TG_TABLE_NAME='custodial_same_original_recovery_challenges' THEN
  PERFORM custodial_recovery.assert_registered_challenge(NEW);
 ELSE
  SELECT * INTO STRICT challenge FROM public.custodial_same_original_recovery_challenges
   WHERE challenge_id=NEW.challenge_id FOR SHARE;
  PERFORM custodial_recovery.assert_registered_challenge(challenge);
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER same_original_native_registration_required BEFORE INSERT ON public.custodial_same_original_recovery_challenges
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.guard_native_registration();
CREATE TRIGGER same_original_native_approval_source_required BEFORE INSERT ON public.custodial_same_original_recovery_approvals
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.guard_native_registration();
ALTER TABLE public.custodial_same_original_recovery_challenges ENABLE ALWAYS TRIGGER same_original_native_registration_required;
ALTER TABLE public.custodial_same_original_recovery_approvals ENABLE ALWAYS TRIGGER same_original_native_approval_source_required;

-- The fixed Main backend authenticates this NEW path/body/intent nonce HMAC
-- before entry. Captured comparisons are not a JSON credential or SQL fence.
-- This intended service-only transaction revalidates current original rows.
CREATE FUNCTION custodial_recovery.register_native_challenge_once(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_original_write_request uuid,p_original_write_body_sha256 text,p_original_write_attestation_digest text,
 p_native_request uuid,p_native_request_timestamp timestamptz,p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_utf8 text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;source jsonb;target jsonb;preview jsonb;receipt jsonb;registered timestamptz;expiry timestamptz;
 challenge_sha text;preview_sha text;credential public.device_auth_credentials%rowtype;context jsonb;BEGIN
 IF p_operation IS NULL OR p_device IS NULL OR p_credential IS NULL OR p_generation IS NULL OR p_native_request IS NULL
  OR p_original_write_request IS NULL OR p_chunk_index IS DISTINCT FROM 0
  OR p_original_utf8 IS NULL OR octet_length(p_original_utf8) NOT BETWEEN 1 AND 786432
  OR p_native_request_timestamp IS NULL OR NOT isfinite(p_native_request_timestamp)
  OR mod(extract(microseconds FROM p_native_request_timestamp)::bigint,1000)<>0
  OR p_credential_hash IS NULL OR p_credential_hash !~ '^[a-f0-9]{64}$'
  OR p_credential_key_id IS NULL OR p_credential_key_id !~ '^[a-f0-9]{64}$'
  OR p_original_write_body_sha256 IS NULL OR p_original_write_body_sha256 !~ '^[a-f0-9]{64}$'
  OR p_original_write_attestation_digest IS NULL OR p_original_write_attestation_digest !~ '^[a-f0-9]{64}$'
  OR p_native_request_body_sha256 IS NULL OR p_native_request_body_sha256 !~ '^[a-f0-9]{64}$'
  OR p_native_attestation_digest IS NULL OR p_native_attestation_digest !~ '^[a-f0-9]{64}$'
  OR encode(extensions.digest(convert_to(p_original_utf8,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_native_request_body_sha256 THEN
  RAISE EXCEPTION USING errcode='22023',message='fixed original native challenge inputs required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_utf8::json,0);request:=p_original_utf8::jsonb;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR request->>'schema' IS DISTINCT FROM 'custodial.same-original-recovery-native-challenge.v1'
  OR request->>'purpose' IS DISTINCT FROM 'AUTHORIZE_SAME_ORIGINAL_RECOVERY_PREPARATION'
  OR request->>'native_challenge_intent_id' IS DISTINCT FROM p_native_request::text
  OR jsonb_typeof(request->'native_challenge_intent_record_sha256') IS DISTINCT FROM 'string'
  OR request->>'native_challenge_intent_record_sha256' !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='original native challenge purpose required';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT credential FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device FOR SHARE;
 IF credential.revoked_at IS NOT NULL OR credential.confirmed_at IS NULL OR credential.token_hash IS DISTINCT FROM p_credential_hash
  OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id THEN
  RAISE EXCEPTION USING errcode='42501',message='current original native credential required';END IF;
 context:=public.custodial_v13_read_separation_context(p_device,p_credential);
 IF context IS NULL OR context->>'state' IS DISTINCT FROM 'PENDING_RECONCILIATION' THEN
  RAISE EXCEPTION USING errcode='42501',message='current original native separation required';END IF;
 PERFORM 1 FROM public.custodial_employee_separation_fences WHERE separation_id=(context->>'separation_id')::uuid FOR SHARE;
 source:=custodial_recovery.read_original_target(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,p_generation,
  p_chunk_index,p_original_write_request,p_original_write_body_sha256,p_original_write_attestation_digest);
 IF source IS NULL OR source->>'state' IS DISTINCT FROM 'ORIGINAL_TARGET_DESCRIPTOR_ONLY' THEN
  RAISE EXCEPTION USING errcode='42501',message='retained complete original target required';END IF;
 target:=source->'original_target';PERFORM custodial_recovery.assert_original_target(target);
 IF request->'original_target' IS DISTINCT FROM target OR request->>'original_target_sha256' IS DISTINCT FROM source->>'original_target_sha256' THEN
  RAISE EXCEPTION USING errcode='42501',message='declared native target differs from retained original';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('same-original-native-preparation:'||p_operation::text,0));
 IF EXISTS(SELECT 1 FROM public.custodial_same_original_recovery_challenges WHERE challenge_id=p_native_request
  OR operation_id=p_operation AND target_sha256=source->>'original_target_sha256') THEN
  RAISE EXCEPTION USING errcode='23505',message='original challenge already exists; status only, no registration retry';END IF;
 registered:=clock_timestamp();
 IF p_native_request_timestamp>registered+interval '30 seconds' OR p_native_request_timestamp<registered-interval '120 seconds' THEN
  RAISE EXCEPTION USING errcode='42501',message='original native request timestamp no longer current';END IF;
 expiry:=least(registered+interval '5 minutes',p_native_request_timestamp+interval '5 minutes');
 challenge_sha:=encode(extensions.digest(convert_to('custodial.same-original-native-challenge-binding.v1'||E'\n'||p_native_request::text||E'\n'
  ||p_native_request_body_sha256||E'\n'||p_native_attestation_digest||E'\n'||(request->>'native_challenge_intent_record_sha256')||E'\n'
  ||(source->>'original_target_sha256')||E'\n'||custodial_recovery.utc_micros(registered)||E'\n'||custodial_recovery.utc_micros(expiry),'UTF8'),'sha256'),'hex');
 preview:=jsonb_build_object('schema','custodial.same-original-recovery-review.v1','state','ORIGINAL_BINDING_REVIEW_ONLY',
  'purpose','AUTHORIZE_SAME_ORIGINAL_RECOVERY_PREPARATION','challenge_id',p_native_request,'challenge_sha256',challenge_sha,
  'preview_sha256',repeat('0',64),'original_target',target,'expires_at',custodial_recovery.utc_micros(expiry),'limits',custodial_recovery.denied_effects());
 preview_sha:=custodial_recovery.document_digest('preview',preview);preview:=jsonb_set(preview,'{preview_sha256}',to_jsonb(preview_sha));
 receipt:=jsonb_build_object('schema','custodial.same-original-recovery-native-challenge-receipt.v1',
  'state','ORIGINAL_CHALLENGE_RECORDED_PREPARATION_ONLY','challenge_id',p_native_request,'challenge_sha256',challenge_sha,
  'original_target_sha256',source->>'original_target_sha256','native_challenge_intent_id',p_native_request,
  'native_challenge_intent_record_sha256',request->>'native_challenge_intent_record_sha256',
  'registered_at',custodial_recovery.utc_micros(registered),'expires_at',custodial_recovery.utc_micros(expiry),
  'retry_safe',false,'limits',custodial_recovery.denied_effects());
 INSERT INTO public.custodial_same_original_recovery_challenges(challenge_id,operation_id,target_sha256,original_target,challenge_sha256,
  preview_sha256,preview_utf8,native_challenge_request_sha256,registered_at,expires_at,native_request_utf8,native_request_id,
  native_request_timestamp,native_attestation_digest,native_intent_record_sha256,native_registration_receipt_utf8)
 VALUES(p_native_request,p_operation,source->>'original_target_sha256',target,challenge_sha,preview_sha,preview::text,
  p_native_request_body_sha256,registered,expiry,p_original_utf8,p_native_request,p_native_request_timestamp,p_native_attestation_digest,
  request->>'native_challenge_intent_record_sha256',receipt::text);
 RETURN receipt::text;
END $fn$;

CREATE FUNCTION public.custodial_same_original_preparation_register_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_original_write_request uuid,p_original_write_body_sha256 text,p_original_write_attestation_digest text,
 p_native_request uuid,p_native_request_timestamp timestamptz,p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_utf8 text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.register_native_challenge_once(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,p_generation,
  p_chunk_index,p_original_write_request,p_original_write_body_sha256,p_original_write_attestation_digest,p_native_request,p_native_request_timestamp,
  p_native_request_body_sha256,p_native_attestation_digest,p_original_utf8)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.assert_registered_challenge(public.custodial_same_original_recovery_challenges),
 custodial_recovery.guard_native_registration(),
 custodial_recovery.register_native_challenge_once(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_same_original_preparation_register_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_same_original_preparation_register_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,uuid,timestamptz,text,text,text)
 TO service_role;
COMMIT;
