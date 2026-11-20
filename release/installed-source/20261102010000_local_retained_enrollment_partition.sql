-- Forward-only known-repair continuation. Local originals remain on the phone;
-- this small receipt neither uploads nor accepts original cleaning work.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
DO $preimage$ BEGIN
 IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_v12_guard_protected_device()'::regprocedure),'UTF8'),'sha256'),'hex')
  IS DISTINCT FROM 'ff340a30703f1fe222b8813ea045a8ab14ffbff7632f5cc143599071d4a2cf5f' THEN
  RAISE EXCEPTION 'Exact current307 protected-device predecessor changed';END IF;
 IF encode(extensions.digest(convert_to(pg_get_functiondef('public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex')
  IS DISTINCT FROM '895521d65cd3b6e025c0cef0b33cb1b8cc3bd71e103cb2f8ed5ab4db0f3f6094' THEN
  RAISE EXCEPTION 'Exact current307 enrollment-consumer predecessor changed';END IF;
END $preimage$;
CREATE TABLE custodial_employment.local_retained_enrollments_v1(
 realm_id uuid PRIMARY KEY,
 inventory_native_request_id uuid NOT NULL UNIQUE REFERENCES public.custodial_native_inventory_requests(native_request_id) ON DELETE RESTRICT,
 approval_id uuid NOT NULL UNIQUE REFERENCES public.custodial_original_inventory_separation_approvals(approval_id) ON DELETE RESTRICT,
 operation_id uuid NOT NULL UNIQUE,
 separation_id uuid NOT NULL REFERENCES public.custodial_employee_separation_fences(separation_id) ON DELETE RESTRICT,
 device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
 credential_id uuid NOT NULL UNIQUE REFERENCES public.device_auth_credentials(credential_id) ON DELETE RESTRICT,
 employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
 assignment_epoch bigint NOT NULL CHECK(assignment_epoch>0 AND assignment_epoch<=9007199254740991),
 original_utf8 text NOT NULL CHECK(octet_length(original_utf8) BETWEEN 1 AND 16384),
 report_sha256 text NOT NULL CHECK(report_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 receipt jsonb NOT NULL,
 CHECK(report_sha256=encode(extensions.digest(convert_to(original_utf8,'UTF8'),'sha256'),'hex')));
ALTER TABLE custodial_employment.local_retained_enrollments_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_employment.local_retained_enrollments_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON custodial_employment.local_retained_enrollments_v1 FROM PUBLIC,anon,authenticated,service_role,
 custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON custodial_employment.local_retained_enrollments_v1 FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation();
CREATE TRIGGER local_retained_enrollment_immutable BEFORE UPDATE OR DELETE ON custodial_employment.local_retained_enrollments_v1
 FOR EACH ROW EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
CREATE TRIGGER local_retained_enrollment_no_truncate BEFORE TRUNCATE ON custodial_employment.local_retained_enrollments_v1
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_recovery.reject_original_mutation();
ALTER TABLE custodial_employment.local_retained_enrollments_v1 ENABLE ALWAYS TRIGGER local_retained_enrollment_immutable;
ALTER TABLE custodial_employment.local_retained_enrollments_v1 ENABLE ALWAYS TRIGGER local_retained_enrollment_no_truncate;

CREATE FUNCTION public.custodial_record_local_enrollment_retention_v1(
 p_credential uuid,p_credential_hash text,p_credential_key_id text,p_original_utf8 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE body jsonb;target jsonb;fields text[];binding text;digest text;manifest_text text;manifest jsonb;
 approved public.custodial_original_inventory_separation_approvals%rowtype;
 credential public.device_auth_credentials%rowtype;device public.devices%rowtype;fence public.custodial_employee_separation_fences%rowtype;
 saved custodial_employment.local_retained_enrollments_v1%rowtype;marker jsonb;receipt jsonb;recorded timestamptz;
BEGIN
 IF p_original_utf8 IS NULL OR octet_length(p_original_utf8) NOT BETWEEN 1 AND 16384
  OR p_credential IS NULL OR p_credential_hash IS NULL OR p_credential_hash !~ '^[a-f0-9]{64}$'
  OR p_credential_key_id IS NULL OR p_credential_key_id !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Bounded authenticated local-preservation report required' USING ERRCODE='22023';END IF;
 PERFORM public.custodial_v15_assert_native_json(p_original_utf8::json,0);body:=p_original_utf8::jsonb;
 fields:=ARRAY['schema','realm_id','previous_realm','inventory_native_request_id','approval_id','operation_id','credential_id','manifest_sha256',
  'local_finalization_intent_document_sha256','local_finalization_intent_disk_sha256','original_native_values_sha256',
  'original_browser_frame_sha256','original_browser_part_set_sha256'];
 IF NOT custodial_recovery.inventory_object_keys(body,fields||ARRAY['purpose_binding_sha256','purpose_attestation'])
  OR EXISTS(SELECT 1 FROM jsonb_each(body) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')
  OR body->>'schema' IS DISTINCT FROM 'custodial.native-local-enrollment-retention.v1'
  OR body->>'credential_id' IS DISTINCT FROM p_credential::text
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['realm_id','inventory_native_request_id','approval_id','operation_id','credential_id']) k
   WHERE body->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
  OR (body->>'previous_realm'<>'legacy' AND body->>'previous_realm' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
  OR body->>'previous_realm'=body->>'realm_id'
  OR EXISTS(SELECT 1 FROM jsonb_each_text(body) x WHERE (x.key LIKE '%sha256' OR x.key='purpose_attestation') AND x.value !~ '^[a-f0-9]{64}$') THEN
  RAISE EXCEPTION 'Exact local-preservation report required' USING ERRCODE='22023';END IF;
 SELECT string_agg(body->>key,E'\n' ORDER BY ordinal) INTO binding FROM unnest(fields) WITH ORDINALITY f(key,ordinal);
 IF body->>'purpose_binding_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(binding,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'Original local-preservation binding changed' USING ERRCODE='42501';END IF;
 digest:=encode(extensions.digest(convert_to(p_original_utf8,'UTF8'),'sha256'),'hex');
 -- The HTTP owner has verified both fixed purpose and fresh transport HMACs.
 -- SQL independently owns current row/hash/key and the approved exact target.
 PERFORM public.custodial_begin_application_mutation();
 SELECT * INTO STRICT approved FROM public.custodial_original_inventory_separation_approvals
  WHERE approval_id=(body->>'approval_id')::uuid AND inventory_native_request_id=(body->>'inventory_native_request_id')::uuid FOR SHARE;
 PERFORM custodial_recovery.inventory_manager_receipt_document(approved);
 target:=approved.original_target;
 IF body->>'operation_id' IS DISTINCT FROM target->>'operation_id'
  OR body->>'credential_id' IS DISTINCT FROM target->>'credential_id'
  OR body->>'manifest_sha256' IS DISTINCT FROM approved.manifest_sha256
  OR body->>'original_native_values_sha256' IS DISTINCT FROM target->>'values_sha256'
  OR p_credential_key_id IS DISTINCT FROM target->>'original_credential_secret_key_id' THEN
  RAISE EXCEPTION 'Approved original inventory identity differs' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('custodial-device-assignment:'||(target->>'canonical_device_id'),0));
 SELECT * INTO STRICT device FROM public.devices WHERE id=(target->>'canonical_device_pk')::uuid FOR UPDATE;
 SELECT * INTO STRICT credential FROM public.device_auth_credentials WHERE credential_id=p_credential FOR UPDATE;
 IF credential.device_id IS DISTINCT FROM (target->>'canonical_device_pk')::uuid
  OR credential.token_hash IS DISTINCT FROM p_credential_hash OR credential.revoked_at IS NOT NULL
  OR credential.confirmed_at IS NULL OR credential.confirmed_at>clock_timestamp()
  OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id THEN
  RAISE EXCEPTION 'Original credential proof differs' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM custodial_employment.local_retained_enrollments_v1
  WHERE realm_id=(body->>'realm_id')::uuid OR inventory_native_request_id=approved.inventory_native_request_id OR credential_id=p_credential;
 IF FOUND THEN
  IF saved.realm_id IS DISTINCT FROM (body->>'realm_id')::uuid OR saved.credential_id IS DISTINCT FROM p_credential
   OR saved.original_utf8 IS DISTINCT FROM p_original_utf8 OR saved.report_sha256 IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'Original local-preservation receipt conflict' USING ERRCODE='23505';END IF;
  RETURN saved.receipt;
 END IF;
 SELECT * INTO STRICT fence FROM public.custodial_employee_separation_fences
  WHERE separation_id=(target->>'separation_id')::uuid FOR SHARE;
 IF fence.employee_id IS DISTINCT FROM (target->>'employee_id')::uuid OR fence.state<>'PENDING_RECONCILIATION'
  OR fence.authority_revision::text IS DISTINCT FROM target->>'separation_authority_revision'
  OR device.assigned_employee_id IS DISTINCT FROM fence.employee_id
  OR device.assignment_epoch::text IS DISTINCT FROM target->>'assignment_epoch'
  OR device.device_id IS DISTINCT FROM target->>'canonical_device_id'
  OR NOT EXISTS(SELECT 1 FROM public.employees WHERE id=fence.employee_id AND active=false)
  OR credential.metadata_json ? 'retained_original_enrollment' THEN
  RAISE EXCEPTION 'Original separation or phone generation changed' USING ERRCODE='42501';END IF;
 manifest_text:=custodial_recovery.retained_inventory_manifest_utf8(approved.inventory_native_request_id);
 IF manifest_text IS NULL OR encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM approved.manifest_sha256 THEN
  RAISE EXCEPTION 'Complete original manifest missing or changed' USING ERRCODE='42501';END IF;
 manifest:=manifest_text::jsonb;
 IF manifest->'original_target' IS DISTINCT FROM target
  OR manifest#>>'{browser_value_frame,frame_sha256}' IS DISTINCT FROM body->>'original_browser_frame_sha256'
  OR manifest->>'browser_part_set_sha256' IS DISTINCT FROM body->>'original_browser_part_set_sha256' THEN
  RAISE EXCEPTION 'Original browser preservation binding differs' USING ERRCODE='42501';END IF;
 recorded:=clock_timestamp();
 receipt:=jsonb_build_object('schema','custodial.local-enrollment-retention-receipt.v1','realm_id',body->>'realm_id',
  'operation_id',body->>'operation_id','inventory_native_request_id',approved.inventory_native_request_id,
  'credential_id',p_credential,'employee_id',fence.employee_id,'canonical_device_id',device.device_id,
  'report_sha256',digest,'recorded_at',custodial_recovery.utc_micros(recorded),'work_accepted',false,'key_removal',false,'phone_released',false);
 INSERT INTO custodial_employment.local_retained_enrollments_v1(realm_id,inventory_native_request_id,approval_id,operation_id,separation_id,
  device_id,credential_id,employee_id,assignment_epoch,original_utf8,report_sha256,recorded_at,receipt)
 VALUES((body->>'realm_id')::uuid,approved.inventory_native_request_id,approved.approval_id,(body->>'operation_id')::uuid,
  fence.separation_id,device.id,p_credential,fence.employee_id,device.assignment_epoch,p_original_utf8,digest,recorded,receipt);
 marker:=jsonb_build_object('realm_id',body->>'realm_id','operation_id',body->>'operation_id','report_sha256',digest,
  'inventory_native_request_id',body->>'inventory_native_request_id');
 -- Denial marker only. Original secret/hash/key/expiry and attribution stay.
 -- Ordinary authentication refuses this marker even if the phone is later B.
 UPDATE public.device_auth_credentials SET metadata_json=metadata_json||jsonb_build_object('retained_original_enrollment',marker)
  WHERE credential_id=p_credential;
 RETURN receipt;
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_record_local_enrollment_retention_v1(uuid,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_record_local_enrollment_retention_v1(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.custodial_v12_guard_protected_device() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF old.assigned_employee_id IS NOT NULL
  AND (new.assigned_employee_id IS DISTINCT FROM old.assigned_employee_id OR new.active IS DISTINCT FROM old.active)
  AND EXISTS(SELECT 1 FROM public.custodial_employee_separation_fences f
   WHERE f.employee_id=old.assigned_employee_id AND f.state='PENDING_RECONCILIATION'
    AND NOT EXISTS(SELECT 1 FROM custodial_employment.local_retained_enrollments_v1 r
     WHERE r.separation_id=f.separation_id AND r.device_id=old.id AND r.employee_id=old.assigned_employee_id
      AND r.assignment_epoch=old.assignment_epoch)) THEN
  RAISE EXCEPTION 'Protected original phone requires verified local preservation before reassignment' USING ERRCODE='42501';
 END IF;
 RETURN new;
END $fn$;
-- New enrollment does not revoke an original retained credential: its normal
-- use is independently denied by the server-owned marker. Existing recovery
-- evidence and secret lineage remain original; it is not B's predecessor.
DO $consumer$ DECLARE definition text;needle text;replacement text;BEGIN
 definition:=pg_get_functiondef('public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb)'::regprocedure);
 needle:='where device_id=p_device_id and revoked_at is null';
 replacement:=needle||E'\n        and not (metadata_json ? ''retained_original_enrollment'')';
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Exact enrollment credential replacement seam changed';END IF;
 EXECUTE replace(definition,needle,replacement);
END $consumer$;
DO $owner$ DECLARE owner_name name;BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc WHERE oid='public.custodial_v12_guard_protected_device()'::regprocedure;
 EXECUTE format('ALTER TABLE custodial_employment.local_retained_enrollments_v1 OWNER TO %I',owner_name);
 EXECUTE format('ALTER FUNCTION public.custodial_record_local_enrollment_retention_v1(uuid,text,text,text) OWNER TO %I',owner_name);
 EXECUTE format('CREATE POLICY local_retained_enrollment_owner ON custodial_employment.local_retained_enrollments_v1 TO %I USING(true) WITH CHECK(true)',owner_name);
END $owner$;
COMMIT;
