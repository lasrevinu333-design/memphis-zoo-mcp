-- UNAPPLIED SOURCE / isolated prototype only. Current protected manager reads
-- complete retained original manifest DATA. Never review/ACK/write authority.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION custodial_recovery.assert_inventory_manager_read(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text)
 RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m public.ops_manager_managers%rowtype;c public.ops_manager_trusted_devices%rowtype;
 cfg public.ops_manager_device_security_config%rowtype;s public.ops_manager_device_security_sessions%rowtype;
 observed timestamptz;BEGIN
 -- Same owner/password/security-session boundary as assert_current_manager,
 -- with NO FOR SHARE or effects: the intended port must work in READ ONLY.
 SELECT * INTO STRICT m FROM public.ops_manager_managers WHERE manager_id=p_manager;
 SELECT * INTO STRICT c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential;
 SELECT * INTO STRICT cfg FROM public.ops_manager_device_security_config WHERE singleton;
 SELECT * INTO STRICT s FROM public.ops_manager_device_security_sessions WHERE session_id=p_security_session;
 observed:=clock_timestamp();
 IF p_manager IS NULL OR p_credential IS NULL OR p_security_session IS NULL OR nullif(btrim(p_device),'') IS NULL
  OR m.active IS DISTINCT FROM true OR m.revoked_at IS NOT NULL OR m.is_system_principal IS DISTINCT FROM false
  OR m.system_key IS DISTINCT FROM 'eric_custodial_manager' OR ('SECURITY_ADMIN'=ANY(m.roles)) IS DISTINCT FROM true
  OR nullif(btrim(m.display_name),'') IS NULL
  OR c.manager_id IS DISTINCT FROM p_manager OR c.device_id IS DISTINCT FROM p_device OR c.max_access_level IS DISTINCT FROM 'full_access'
  OR c.revoked_at IS NOT NULL OR c.created_at IS NULL OR NOT isfinite(c.created_at) OR c.created_at>observed
  OR c.expires_at IS NULL OR NOT isfinite(c.expires_at) OR c.expires_at<=observed
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=observed
  OR s.manager_id IS DISTINCT FROM p_manager OR s.credential_id IS DISTINCT FROM p_credential
  OR s.revoked_at IS NOT NULL OR s.created_at IS NULL OR NOT isfinite(s.created_at) OR s.created_at>observed
  OR s.expires_at IS NULL OR NOT isfinite(s.expires_at) OR s.expires_at<=observed
  OR s.password_version IS DISTINCT FROM cfg.password_version OR s.password_version IS DISTINCT FROM p_password_version
  OR p_security_hash IS NULL OR p_security_hash !~ '^[a-f0-9]{64}$' OR s.token_hash IS DISTINCT FROM p_security_hash
  OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[a-f0-9]{64}$' OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR cfg.sessions_revoked_at IS NOT NULL AND s.created_at<=cfg.sessions_revoked_at THEN
  RAISE EXCEPTION USING errcode='42501',message='current original inventory owner read session required';END IF;
 RETURN least(observed+interval '5 minutes',p_signed_expires,c.expires_at,s.expires_at);
END $fn$;

CREATE FUNCTION custodial_recovery.read_original_inventory_manifest_for_manager(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text,p_inventory_request uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE saved public.custodial_native_inventory_requests%rowtype;op public.custodial_native_private_custody_operations%rowtype;
 native_credential public.device_auth_credentials%rowtype;first_chunk public.custodial_native_inventory_manifest_chunks%rowtype;
 registered text;manifest text;intent jsonb;observed timestamptz;until_time timestamptz;BEGIN
 until_time:=custodial_recovery.assert_inventory_manager_read(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 IF p_inventory_request IS NULL THEN RAISE EXCEPTION USING errcode='22023',message='original inventory request required';END IF;
 SELECT * INTO saved FROM public.custodial_native_inventory_requests WHERE native_request_id=p_inventory_request;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations WHERE operation_id=saved.operation_id;
 SELECT * INTO STRICT native_credential FROM public.device_auth_credentials WHERE credential_id=op.credential_id AND device_id=op.device_id;
 -- Derive original pins ONLY from immutable original rows/current private
 -- sources. The caller supplies neither native credentials/hashes nor a body.
 -- This is observation of an existing registration, NOT native impersonation
 -- or a writer dispatch. No secret/token is returned or selected.
 registered:=custodial_recovery.read_native_inventory_request_original(op.operation_id,op.device_id,op.credential_id,
  native_credential.token_hash,native_credential.metadata_json->>'credential_secret_key_id',op.generation_id,op.separation_id,
  op.original_context->>'authority_revision',saved.native_request_id,saved.native_request_timestamp,
  saved.request_body_sha256,saved.native_attestation_digest,saved.original_request_utf8);
 IF registered IS NULL THEN RETURN NULL;END IF;
 manifest:=custodial_recovery.retained_inventory_manifest_utf8(saved.native_request_id);
 IF manifest IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT first_chunk FROM public.custodial_native_inventory_manifest_chunks
  WHERE inventory_native_request_id=saved.native_request_id AND chunk_index=0;
 IF octet_length(manifest) NOT BETWEEN 1 AND 16777216
  OR encode(extensions.digest(convert_to(manifest,'UTF8'),'sha256'),'hex') IS DISTINCT FROM first_chunk.manifest_sha256 THEN
  RAISE EXCEPTION USING errcode='42501',message='complete exact original manifest required';END IF;
 intent:=((saved.original_request_utf8::jsonb)->>'original_intent_utf8')::jsonb;
 -- Recheck actual current manager session and original native source AFTER
 -- assembly. No effect/transaction authority can be derived from this read.
 until_time:=least(until_time,custodial_recovery.assert_inventory_manager_read(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash));
 IF registered IS DISTINCT FROM custodial_recovery.read_native_inventory_request_original(op.operation_id,op.device_id,op.credential_id,
  native_credential.token_hash,native_credential.metadata_json->>'credential_secret_key_id',op.generation_id,op.separation_id,
  op.original_context->>'authority_revision',saved.native_request_id,saved.native_request_timestamp,
  saved.request_body_sha256,saved.native_attestation_digest,saved.original_request_utf8) THEN
  RAISE EXCEPTION USING errcode='42501',message='original registration read changed';END IF;
 observed:=clock_timestamp();IF observed>=until_time THEN RAISE EXCEPTION USING errcode='42501',message='original manifest read expired';END IF;
 RETURN jsonb_build_object('schema','custodial.original-inventory-manifest-manager-source.v1',
  'state','CURRENT_MANAGER_ORIGINAL_MANIFEST_DATA_ONLY_NOT_REVIEW_OR_ACK','manifest_utf8',manifest,
  'expected_original',jsonb_build_object('inventory_native_request_id',saved.native_request_id,
   'registration_request_body_sha256',saved.request_body_sha256,'intent_document_sha256',saved.intent_document_sha256,
   'intent_disk_sha256',saved.intent_disk_sha256,'original_target',intent->'original_target','manifest_sha256',first_chunk.manifest_sha256),
  'original_registration_receipt_sha256',(registered::jsonb)->>'receipt_sha256',
  'observed_at',custodial_recovery.utc_micros(observed),'current_until',custodial_recovery.utc_micros(until_time),
  'transaction_authority',false,'limits',custodial_recovery.denied_effects());
END $fn$;
CREATE FUNCTION public.custodial_original_inventory_separation_manifest_v1(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text,p_inventory_request uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_original_inventory_manifest_for_manager(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash,p_inventory_request)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.assert_inventory_manager_read(uuid,uuid,text,timestamptz,uuid,integer,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION custodial_recovery.read_original_inventory_manifest_for_manager(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_original_inventory_separation_manifest_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
-- Exact existing private backend service port only; no direct table grant,
-- browser/employee/helper execute, new role, default or security-policy change.
GRANT EXECUTE ON FUNCTION public.custodial_original_inventory_separation_manifest_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid) TO service_role;
COMMIT;
