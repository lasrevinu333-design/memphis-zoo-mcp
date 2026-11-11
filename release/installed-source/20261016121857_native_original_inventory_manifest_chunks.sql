-- UNAPPLIED SOURCE / isolated prototype only. Raw original manifest custody
-- does NOT imply complete semantic admission, inventory ACK or finalization.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.custodial_native_inventory_manifest_chunks (
 inventory_native_request_id uuid NOT NULL REFERENCES public.custodial_native_inventory_requests(native_request_id) ON DELETE RESTRICT,
 chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 511),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 manifest_byte_count integer NOT NULL CHECK(manifest_byte_count BETWEEN 1 AND 16777216),
 manifest_chunk_count integer NOT NULL CHECK(manifest_chunk_count BETWEEN 1 AND 512),
 chunk_sha256 text NOT NULL CHECK(chunk_sha256 ~ '^[a-f0-9]{64}$'),
 chunk_bytes bytea NOT NULL CHECK(octet_length(chunk_bytes) BETWEEN 1 AND 32768),
 native_request_id uuid NOT NULL UNIQUE,
 native_request_timestamp timestamptz NOT NULL CHECK(isfinite(native_request_timestamp)),
 original_request_utf8 text NOT NULL CHECK(octet_length(original_request_utf8) BETWEEN 1 AND 65536),
 request_body_sha256 text NOT NULL CHECK(request_body_sha256 ~ '^[a-f0-9]{64}$'),
 native_attestation_digest text NOT NULL CHECK(native_attestation_digest ~ '^[a-f0-9]{64}$'),
 registered_at timestamptz NOT NULL CHECK(isfinite(registered_at)),
 receipt_utf8 text NOT NULL CHECK(octet_length(receipt_utf8) BETWEEN 1 AND 8192),
 PRIMARY KEY(inventory_native_request_id,chunk_index),
 CHECK(manifest_chunk_count=(manifest_byte_count+32767)/32768),
 CHECK(chunk_index<manifest_chunk_count),
 CHECK(octet_length(chunk_bytes)=least(32768,manifest_byte_count-chunk_index*32768)),
 CHECK(native_request_timestamp BETWEEN registered_at-interval '120 seconds' AND registered_at+interval '30 seconds')
);
ALTER TABLE public.custodial_native_inventory_manifest_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_native_inventory_manifest_chunks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.custodial_native_inventory_manifest_chunks FROM PUBLIC,anon,authenticated,service_role,
 custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
DO $owner$ DECLARE owner_name text;BEGIN
 SELECT r.rolname INTO STRICT owner_name FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
  WHERE c.oid='public.custodial_native_inventory_manifest_chunks'::regclass;
 IF owner_name IN ('anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator')
 THEN RAISE EXCEPTION 'Existing trusted recovery owner required';END IF;
 EXECUTE format('CREATE POLICY native_inventory_manifest_owner ON public.custodial_native_inventory_manifest_chunks TO %I USING (true) WITH CHECK (true)',owner_name);
END $owner$;
CREATE TRIGGER native_inventory_manifest_immutable BEFORE UPDATE OR DELETE ON public.custodial_native_inventory_manifest_chunks
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
CREATE TRIGGER native_inventory_manifest_no_truncate BEFORE TRUNCATE ON public.custodial_native_inventory_manifest_chunks
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
ALTER TABLE public.custodial_native_inventory_manifest_chunks ENABLE ALWAYS TRIGGER native_inventory_manifest_immutable;
ALTER TABLE public.custodial_native_inventory_manifest_chunks ENABLE ALWAYS TRIGGER native_inventory_manifest_no_truncate;
DO $fence$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_native_inventory_manifest_chunks'::regclass
  AND tgname='custodial_disaster_restore_mutation_fence' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure
  AND NOT tgisinternal AND tgenabled='O') THEN RAISE EXCEPTION 'Existing application mutation fence missing';END IF;
END $fence$;

-- Fixed original authentication/currentness comparison shared by this writer
-- and its status reader. No caller-selected table, SQL, grant or target rewrite.
CREATE FUNCTION custodial_recovery.assert_native_inventory_manifest_original(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_original_request_utf8 text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;parent public.custodial_native_inventory_requests%rowtype;
 credential public.device_auth_credentials%rowtype;op public.custodial_native_private_custody_operations%rowtype;
 target jsonb;keys text[];part bytea;total integer;parts integer;ordinal integer;binding text;context jsonb;generation jsonb;BEGIN
 IF p_original_request_utf8 IS NULL OR octet_length(p_original_request_utf8) NOT BETWEEN 1 AND 65536
  OR p_operation IS NULL OR p_device IS NULL OR p_credential IS NULL OR p_generation IS NULL OR p_separation IS NULL
  OR p_credential_hash IS NULL OR p_credential_hash !~ '^[a-f0-9]{64}$'
  OR p_credential_key_id IS NULL OR p_credential_key_id !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='bounded original inventory chunk required';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_request_utf8::json,0);
 request:=p_original_request_utf8::jsonb;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING errcode='22023',message='closed manifest chunk required';END IF;
 SELECT array_agg(key ORDER BY key COLLATE "C") INTO keys FROM jsonb_object_keys(request) key;
 IF keys IS DISTINCT FROM ARRAY['chunk_base64','chunk_sha256','intent_disk_sha256','intent_document_sha256','inventory_native_request_id',
  'manifest_byte_count','manifest_chunk_count','manifest_chunk_index','manifest_sha256','original_target','purpose','purpose_attestation',
  'purpose_binding_sha256','registration_request_body_sha256','schema']::text[]
  OR EXISTS(SELECT 1 FROM jsonb_each(request) WHERE key<>'original_target' AND jsonb_typeof(value) IS DISTINCT FROM 'string')
  OR request->>'schema' IS DISTINCT FROM 'custodial.original-native-inventory-manifest-chunk.v1'
  OR request->>'purpose' IS DISTINCT FROM 'RETAIN_EXACT_ORIGINAL_INVENTORY_MANIFEST_CHUNK'
  OR request->>'inventory_native_request_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['chunk_sha256','intent_disk_sha256','intent_document_sha256','manifest_sha256',
   'purpose_attestation','purpose_binding_sha256','registration_request_body_sha256']) k WHERE request->>k !~ '^[a-f0-9]{64}$')
  OR request->>'manifest_byte_count' !~ '^[1-9][0-9]{0,7}$'
  OR request->>'manifest_chunk_count' !~ '^[1-9][0-9]{0,2}$'
  OR request->>'manifest_chunk_index' !~ '^(0|[1-9][0-9]{0,2})$' THEN
  RAISE EXCEPTION USING errcode='22023',message='fixed manifest chunk schema required';END IF;
 total:=(request->>'manifest_byte_count')::integer;parts:=(request->>'manifest_chunk_count')::integer;ordinal:=(request->>'manifest_chunk_index')::integer;
 IF total NOT BETWEEN 1 AND 16777216 OR parts<>(total+32767)/32768 OR parts NOT BETWEEN 1 AND 512 OR ordinal>=parts
  OR octet_length(request->>'chunk_base64')>43692 THEN RAISE EXCEPTION USING errcode='22023',message='bounded manifest part required';END IF;
 part:=decode(request->>'chunk_base64','base64');
 IF replace(encode(part,'base64'),E'\n','') IS DISTINCT FROM request->>'chunk_base64'
  OR octet_length(part)<>least(32768,total-ordinal*32768)
  OR encode(extensions.digest(part,'sha256'),'hex') IS DISTINCT FROM request->>'chunk_sha256' THEN
  RAISE EXCEPTION USING errcode='22023',message='exact original chunk bytes required';END IF;
 binding:=encode(extensions.digest(convert_to(concat_ws(E'\n','custodial.native-original-inventory-manifest-chunk-purpose.v1',
  request->>'inventory_native_request_id',request->>'registration_request_body_sha256',request->>'intent_document_sha256',
  request->>'intent_disk_sha256',request->>'manifest_sha256',request->>'manifest_byte_count',request->>'manifest_chunk_count',
  request->>'manifest_chunk_index',request->>'chunk_sha256'),'UTF8'),'sha256'),'hex');
 IF binding IS DISTINCT FROM request->>'purpose_binding_sha256' THEN RAISE EXCEPTION USING errcode='42501',message='original manifest purpose changed';END IF;
 SELECT * INTO STRICT parent FROM public.custodial_native_inventory_requests
  WHERE native_request_id=(request->>'inventory_native_request_id')::uuid;
 SELECT * INTO STRICT credential FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device;
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations WHERE operation_id=p_operation;
 target:=request->'original_target';
 IF parent.operation_id IS DISTINCT FROM p_operation OR parent.generation_id IS DISTINCT FROM p_generation
  OR parent.request_body_sha256 IS DISTINCT FROM request->>'registration_request_body_sha256'
  OR parent.intent_document_sha256 IS DISTINCT FROM request->>'intent_document_sha256'
  OR parent.intent_disk_sha256 IS DISTINCT FROM request->>'intent_disk_sha256'
  OR credential.token_hash IS DISTINCT FROM p_credential_hash OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id
  OR credential.revoked_at IS NOT NULL OR credential.confirmed_at IS NULL OR NOT isfinite(credential.confirmed_at)
  OR credential.confirmed_at>clock_timestamp() OR credential.expires_at IS NULL OR NOT isfinite(credential.expires_at)
  OR credential.expires_at<=clock_timestamp() OR target->>'canonical_device_pk' IS DISTINCT FROM p_device::text
  OR target->>'credential_id' IS DISTINCT FROM p_credential::text OR target->>'original_generation_id' IS DISTINCT FROM p_generation::text
  OR target->>'separation_id' IS DISTINCT FROM p_separation::text OR target->>'separation_authority_revision' IS DISTINCT FROM p_authority_revision
  OR target->>'original_credential_secret_key_id' IS DISTINCT FROM p_credential_key_id
  OR ((parent.original_request_utf8::jsonb)->>'original_intent_utf8')::jsonb->'original_target' IS DISTINCT FROM target THEN
  RAISE EXCEPTION USING errcode='42501',message='current exact original inventory owner required';END IF;
 -- Observation-only readers use this nonlocking comparison in READ ONLY.
 -- The writer separately locks the original owner/fence and rechecks it.
 context:=public.custodial_v13_read_separation_context(p_device,p_credential);
 generation:=public.custodial_v14_read_separation_generation(p_device,p_credential,p_separation,p_generation,target->>'principal_digest');
 IF context IS NULL OR context IS DISTINCT FROM op.original_context OR context->>'state' IS DISTINCT FROM 'PENDING_RECONCILIATION'
  OR generation IS NULL OR generation IS DISTINCT FROM op.original_generation THEN
  RAISE EXCEPTION USING errcode='42501',message='current original manifest context required';END IF;
 RETURN request;
END $fn$;

CREATE FUNCTION custodial_recovery.register_native_inventory_manifest_chunk_once(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;registered timestamptz;receipt jsonb;receipt_sha text;parent_id uuid;ordinal integer;BEGIN
 IF p_native_request IS NULL OR p_native_request_timestamp IS NULL OR NOT isfinite(p_native_request_timestamp)
  OR mod(extract(microseconds FROM p_native_request_timestamp)::bigint,1000)<>0
  OR p_native_request_body_sha256 IS NULL OR p_native_request_body_sha256 !~ '^[a-f0-9]{64}$'
  OR p_native_attestation_digest IS NULL OR p_native_attestation_digest !~ '^[a-f0-9]{64}$'
  OR encode(extensions.digest(convert_to(p_original_request_utf8,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_native_request_body_sha256 THEN
  RAISE EXCEPTION USING errcode='22023',message='original manifest HTTP identity required';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 request:=custodial_recovery.assert_native_inventory_manifest_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_original_request_utf8);
 parent_id:=(request->>'inventory_native_request_id')::uuid;ordinal:=(request->>'manifest_chunk_index')::integer;
 PERFORM pg_advisory_xact_lock(hashtextextended('original-native-inventory-manifest:'||parent_id::text,0));
 PERFORM 1 FROM public.custodial_native_inventory_requests WHERE native_request_id=parent_id FOR SHARE;
 PERFORM 1 FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device FOR SHARE;
 PERFORM custodial_recovery.assert_original_target(request->'original_target');
 IF p_native_request=parent_id OR EXISTS(SELECT 1 FROM public.custodial_native_inventory_manifest_chunks
  WHERE inventory_native_request_id=parent_id AND chunk_index=ordinal OR native_request_id=p_native_request) THEN
  RAISE EXCEPTION USING errcode='23505',message='original manifest chunk exists; status only';END IF;
 IF EXISTS(SELECT 1 FROM public.custodial_native_inventory_manifest_chunks WHERE inventory_native_request_id=parent_id
  AND (manifest_sha256 IS DISTINCT FROM request->>'manifest_sha256' OR manifest_byte_count IS DISTINCT FROM (request->>'manifest_byte_count')::integer
   OR manifest_chunk_count IS DISTINCT FROM (request->>'manifest_chunk_count')::integer)) THEN
  RAISE EXCEPTION USING errcode='42501',message='original inventory manifest cannot change';END IF;
 -- Recheck the original principal after waiting for the exact manifest lock.
 PERFORM custodial_recovery.assert_native_inventory_manifest_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_original_request_utf8);
 registered:=clock_timestamp();
 IF p_native_request_timestamp NOT BETWEEN registered-interval '120 seconds' AND registered+interval '30 seconds' THEN
  RAISE EXCEPTION USING errcode='42501',message='current manifest request timestamp required';END IF;
 receipt_sha:=encode(extensions.digest(convert_to(concat_ws(E'\n','custodial.native-original-inventory-manifest-chunk-receipt.v1',
  parent_id::text,request->>'manifest_sha256',request->>'manifest_chunk_index',request->>'chunk_sha256',
  p_native_request::text,p_native_request_body_sha256,custodial_recovery.utc_micros(registered)),'UTF8'),'sha256'),'hex');
 receipt:=jsonb_build_object('schema','custodial.native-original-inventory-manifest-chunk-registration.v1','state','CHUNK_RETAINED_NOT_ACK',
  'inventory_native_request_id',parent_id,'manifest_sha256',request->>'manifest_sha256','manifest_chunk_index',request->>'manifest_chunk_index',
  'chunk_sha256',request->>'chunk_sha256','native_request_id',p_native_request,'request_body_sha256',p_native_request_body_sha256,
  'registered_at',custodial_recovery.utc_micros(registered),'receipt_sha256',receipt_sha,'limits',custodial_recovery.denied_effects());
 INSERT INTO public.custodial_native_inventory_manifest_chunks(inventory_native_request_id,chunk_index,manifest_sha256,manifest_byte_count,
  manifest_chunk_count,chunk_sha256,chunk_bytes,native_request_id,native_request_timestamp,original_request_utf8,request_body_sha256,
  native_attestation_digest,registered_at,receipt_utf8)
 VALUES(parent_id,ordinal,request->>'manifest_sha256',(request->>'manifest_byte_count')::integer,(request->>'manifest_chunk_count')::integer,
  request->>'chunk_sha256',decode(request->>'chunk_base64','base64'),p_native_request,p_native_request_timestamp,p_original_request_utf8,
  p_native_request_body_sha256,p_native_attestation_digest,registered,receipt::text);
 RETURN receipt::text;
END $fn$;

CREATE FUNCTION public.custodial_register_original_inventory_manifest_chunk_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.register_native_inventory_manifest_chunk_once(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_request_utf8)
$fn$;
CREATE FUNCTION custodial_recovery.read_native_inventory_manifest_chunk_original(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request jsonb;row public.custodial_native_inventory_manifest_chunks%rowtype;BEGIN
 request:=custodial_recovery.assert_native_inventory_manifest_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_original_request_utf8);
 SELECT * INTO row FROM public.custodial_native_inventory_manifest_chunks
  WHERE inventory_native_request_id=(request->>'inventory_native_request_id')::uuid
   AND chunk_index=(request->>'manifest_chunk_index')::integer;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF row.native_request_id IS DISTINCT FROM p_native_request OR row.native_request_timestamp IS DISTINCT FROM p_native_request_timestamp
  OR row.original_request_utf8 IS DISTINCT FROM p_original_request_utf8 OR row.request_body_sha256 IS DISTINCT FROM p_native_request_body_sha256
  OR row.native_attestation_digest IS DISTINCT FROM p_native_attestation_digest THEN
  RAISE EXCEPTION USING errcode='42501',message='same original manifest chunk status only';END IF;
 RETURN row.receipt_utf8;
END $fn$;
CREATE FUNCTION public.custodial_read_original_inventory_manifest_chunk_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_separation uuid,p_authority_revision text,p_native_request uuid,p_native_request_timestamp timestamptz,
 p_native_request_body_sha256 text,p_native_attestation_digest text,p_original_request_utf8 text)
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_native_inventory_manifest_chunk_original(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_separation,p_authority_revision,p_native_request,p_native_request_timestamp,p_native_request_body_sha256,p_native_attestation_digest,p_original_request_utf8)
$fn$;

-- Private RAW DATA assembly only; no public or service execute. The future
-- owning manager admission MUST validate every row/disposition/current source
-- before a semantic review or ACK can be issued from this retained document.
CREATE FUNCTION custodial_recovery.retained_inventory_manifest_utf8(p_inventory_request uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE first_row public.custodial_native_inventory_manifest_chunks%rowtype;counted integer;assembled bytea;original text;BEGIN
 SELECT * INTO first_row FROM public.custodial_native_inventory_manifest_chunks
  WHERE inventory_native_request_id=p_inventory_request AND chunk_index=0;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM public.custodial_native_inventory_manifest_chunks WHERE inventory_native_request_id=p_inventory_request
  AND (manifest_sha256 IS DISTINCT FROM first_row.manifest_sha256 OR manifest_byte_count<>first_row.manifest_byte_count
   OR manifest_chunk_count<>first_row.manifest_chunk_count
   OR encode(extensions.digest(chunk_bytes,'sha256'),'hex') IS DISTINCT FROM chunk_sha256)) THEN
  RAISE EXCEPTION USING errcode='42501',message='mixed original manifest retained unresolved';END IF;
 SELECT count(*),decode(string_agg(encode(chunk_bytes,'hex'),'' ORDER BY chunk_index),'hex') INTO counted,assembled
  FROM public.custodial_native_inventory_manifest_chunks WHERE inventory_native_request_id=p_inventory_request;
 IF counted<>first_row.manifest_chunk_count THEN RETURN NULL;END IF;
 IF octet_length(assembled)<>first_row.manifest_byte_count
  OR encode(extensions.digest(assembled,'sha256'),'hex') IS DISTINCT FROM first_row.manifest_sha256 THEN
  RAISE EXCEPTION USING errcode='42501',message='exact full original manifest bytes required';END IF;
 original:=convert_from(assembled,'UTF8');RETURN original;
END $fn$;
REVOKE ALL ON FUNCTION custodial_recovery.assert_native_inventory_manifest_original(uuid,uuid,uuid,text,text,uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION custodial_recovery.register_native_inventory_manifest_chunk_once(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_register_original_inventory_manifest_chunk_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION custodial_recovery.read_native_inventory_manifest_chunk_original(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_read_original_inventory_manifest_chunk_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION custodial_recovery.retained_inventory_manifest_utf8(uuid)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
-- Exact existing backend service port only. No table/helper/runtime grants.
GRANT EXECUTE ON FUNCTION public.custodial_register_original_inventory_manifest_chunk_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.custodial_read_original_inventory_manifest_chunk_v1(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,timestamptz,text,text,text) TO service_role,custodial_application_reader;
COMMIT;
