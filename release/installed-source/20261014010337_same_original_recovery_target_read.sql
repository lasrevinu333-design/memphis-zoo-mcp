-- SOURCE + ISOLATED LOCAL PROTOTYPE ONLY. Read-only original metadata, NOT
-- challenge registration, manager approval, inventory acceptance or effects.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION custodial_recovery.read_original_target(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_native_request uuid,p_request_sha256 text,p_attestation_digest text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE source jsonb;op public.custodial_native_private_custody_operations%rowtype;
 credential public.device_auth_credentials%rowtype;descriptor jsonb;BEGIN
 -- The owning fixed reader verifies current original credential, separation,
 -- generation and exact already-retained WRITE target in this same snapshot.
 source:=public.custodial_private_custody_v1_read_complete_frame(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_chunk_index,p_native_request,p_request_sha256,p_attestation_digest);
 IF source IS NULL THEN RETURN NULL;END IF;
 IF source->>'state' IS DISTINCT FROM 'COMPLETE_ORIGINAL_OPAQUE_FRAME_BYTES_ONLY' THEN
  RAISE EXCEPTION USING errcode='42501',message='complete original recovery source unavailable';END IF;
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations
  WHERE operation_id=p_operation AND device_id=p_device AND credential_id=p_credential AND generation_id=p_generation;
 SELECT * INTO STRICT credential FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device;
 -- Missing or rotated issuer provenance is NOT filled from current defaults.
 -- This pin describes the existing server credential issuer, not phone AES.
 IF jsonb_typeof(credential.metadata_json->'credential_secret_key_id') IS DISTINCT FROM 'string'
  OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id THEN
  RAISE EXCEPTION USING errcode='42501',message='original credential issuer provenance unavailable';END IF;
 descriptor:=jsonb_build_object('operation_id',op.operation_id,'separation_id',op.separation_id,
  'separation_authority_revision',op.original_context->>'authority_revision','canonical_device_pk',op.device_id,
  'canonical_device_id',op.original_context->>'canonical_device_id','employee_id',op.original_context->>'employee_id',
  'credential_id',op.credential_id,'assignment_epoch',op.original_context->>'assignment_epoch',
  'original_generation_id',op.generation_id,'original_credential_secret_key_id',credential.metadata_json->>'credential_secret_key_id',
  'principal_digest',op.principal_digest,'engine_revision',op.owner_proof->>'engine_revision',
  'original_wire_sha256',op.original_wire_sha256,'original_frozen_work_sha256',op.owner_proof->>'original_frozen_work_sha256',
  'capsule_sha256',op.owner_proof->>'capsule_sha256','record_sha256',op.record_sha256,'frame_sha256',op.frame_sha256,
  'plan_sha256',op.plan_sha256,'aad_binding_sha256',op.owner_proof->>'aad_binding_sha256',
  'source_capture_sha256',op.owner_proof->>'source_capture_sha256','values_sha256',op.owner_proof->>'values_sha256',
  'semantic_join_sha256',op.owner_proof->>'semantic_join_sha256','layout_sha256',op.owner_proof->>'layout_sha256');
 IF EXISTS(SELECT 1 FROM jsonb_each(descriptor) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string') THEN
  RAISE EXCEPTION USING errcode='42501',message='original recovery target has unresolved fields';END IF;
 RETURN jsonb_build_object('schema','custodial.same-original-recovery-target-SQL.v1',
  'state','ORIGINAL_TARGET_DESCRIPTOR_ONLY','original_target',descriptor,
  'original_target_sha256',custodial_recovery.document_digest('target',descriptor),
  'original_write_readback',source->'readback','limits',custodial_recovery.denied_effects());
END $fn$;
CREATE FUNCTION public.custodial_same_original_preparation_target_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_native_request uuid,p_request_sha256 text,p_attestation_digest text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_original_target(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
 p_generation,p_chunk_index,p_native_request,p_request_sha256,p_attestation_digest)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.read_original_target(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_same_original_preparation_target_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_same_original_preparation_target_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 TO service_role,custodial_application_reader;
COMMIT;
