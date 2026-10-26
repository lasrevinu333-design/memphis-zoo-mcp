-- Unapplied source253 private opaque custody. Never accepted work, inventory
-- ACK, resend, finalizer, key retirement or app/device release. No plaintext
-- namespace values or credential secrets are stored by this protocol.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
-- Exact source252 predecessor, derived from its source-pinned isolated replay.
-- This is not production/canonical admission; unexpected survivors fail closed.
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE private_custody_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE private_custody_surface_before ON COMMIT DROP AS
 SELECT p.proacl acl,p.proowner owner,pg_get_functiondef(p.oid) definition FROM pg_proc p
 WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $private_predecessor$ DECLARE body text;saved public.custodial_release_authority_restore_inventory%rowtype;expected_record record;BEGIN
 -- Explicit NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE. Source-bound downstream core reference;
 -- comparison only: actual recovery rows/definitions/orders are never updated.
 if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S')
   and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)) then
  raise exception 'No-auto fixture table/sequence defaults are not zero';end if;
 if (select array_agg(restore_order order by restore_order) from public.custodial_release_authority_restore_inventory
  where object_kind='constraint' and object_identity=any(array['maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_actor_manager_id_fkey','maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_outcome_check','maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_pkey','maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_ticket_id_fkey','maintenance_tickets:maintenance_ticket_resolution_evidence_check','maintenance_tickets:maintenance_tickets_resolution_actor_manager_id_fkey']::text[]))
  is distinct from array[500000,501237,501238,501241,501242,501243]::integer[] then
  raise exception 'No-auto exact six source-unordered constraint order permutation differs';end if;
 for expected_record in select * from jsonb_to_recordset($no_auto_grants$[{"kind":"grant","order":900026,"sha256":"f0bc3b6fb092702b873ee6b55c05903294a0cb26586563b897fb35433b0bb7f9","identity":"public.custodial_session_corrections","definition":"select public.custodial_release_authority_reset_grants('public.custodial_session_corrections'); grant INSERT on table public.custodial_session_corrections to postgres; grant SELECT on table public.custodial_session_corrections to postgres; grant SELECT on table public.custodial_session_corrections to service_role;"},{"kind":"grant","order":900036,"sha256":"93abb99740611008b55417482209d0c85cb291076207ee86e4ffb43f4220a025","identity":"public.device_auth_removal_operations","definition":"select public.custodial_release_authority_reset_grants('public.device_auth_removal_operations'); grant INSERT on table public.device_auth_removal_operations to postgres; grant SELECT on table public.device_auth_removal_operations to postgres; grant INSERT on table public.device_auth_removal_operations to service_role; grant SELECT on table public.device_auth_removal_operations to service_role; grant SELECT on table public.device_auth_removal_operations to custodial_application_reader;"},{"kind":"grant","order":900093,"sha256":"fcbf2c457b02a90f964cffe63175ed4bbb411a51418f63bdea3b76bbe317474a","identity":"public.msg_thread_deletion_operations","definition":"select public.custodial_release_authority_reset_grants('public.msg_thread_deletion_operations'); grant DELETE on table public.msg_thread_deletion_operations to postgres; grant INSERT on table public.msg_thread_deletion_operations to postgres; grant SELECT on table public.msg_thread_deletion_operations to postgres; grant UPDATE on table public.msg_thread_deletion_operations to postgres; grant DELETE on table public.msg_thread_deletion_operations to service_role; grant INSERT on table public.msg_thread_deletion_operations to service_role; grant SELECT on table public.msg_thread_deletion_operations to service_role; grant UPDATE on table public.msg_thread_deletion_operations to service_role;"},{"kind":"grant","order":900104,"sha256":"c033f1f8ab7607644ce3e84ce3967a7c58b4622e10de974d5ebac726e7d62e0a","identity":"public.ops_manager_notification_preferences","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_notification_preferences'); grant DELETE on table public.ops_manager_notification_preferences to postgres; grant INSERT on table public.ops_manager_notification_preferences to postgres; grant SELECT on table public.ops_manager_notification_preferences to postgres; grant UPDATE on table public.ops_manager_notification_preferences to postgres; grant DELETE on table public.ops_manager_notification_preferences to service_role; grant INSERT on table public.ops_manager_notification_preferences to service_role; grant SELECT on table public.ops_manager_notification_preferences to service_role; grant UPDATE on table public.ops_manager_notification_preferences to service_role; grant SELECT on table public.ops_manager_notification_preferences to custodial_application_reader;"},{"kind":"grant","order":900088,"sha256":"407d9a983f2f7d9fdf0e119a6b3079e745e5990c4fb1f6dba0d437435bc04bc0","identity":"public.msg_message_audit","definition":"select public.custodial_release_authority_reset_grants('public.msg_message_audit'); grant SELECT on table public.msg_message_audit to service_role;"},{"kind":"grant","order":900006,"sha256":"17f0d9fe32b656a6678aee14b9ac575863c07eccf9324b3d6b08efbe90f2918b","identity":"public.custodial_employee_status_history","definition":"select public.custodial_release_authority_reset_grants('public.custodial_employee_status_history'); grant DELETE on table public.custodial_employee_status_history to postgres; grant INSERT on table public.custodial_employee_status_history to postgres; grant SELECT on table public.custodial_employee_status_history to postgres; grant UPDATE on table public.custodial_employee_status_history to postgres; grant DELETE on table public.custodial_employee_status_history to service_role; grant INSERT on table public.custodial_employee_status_history to service_role; grant SELECT on table public.custodial_employee_status_history to service_role; grant UPDATE on table public.custodial_employee_status_history to service_role; grant SELECT on table public.custodial_employee_status_history to custodial_application_reader;"},{"kind":"grant","order":900108,"sha256":"a02093760cff3c234380d192cfd4cef2a134331feca85ed8221896e6d36b3e76","identity":"public.ops_manager_push_devices","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_push_devices'); grant DELETE on table public.ops_manager_push_devices to postgres; grant INSERT on table public.ops_manager_push_devices to postgres; grant SELECT on table public.ops_manager_push_devices to postgres; grant UPDATE on table public.ops_manager_push_devices to postgres; grant DELETE on table public.ops_manager_push_devices to service_role; grant INSERT on table public.ops_manager_push_devices to service_role; grant SELECT on table public.ops_manager_push_devices to service_role; grant UPDATE on table public.ops_manager_push_devices to service_role; grant SELECT on table public.ops_manager_push_devices to custodial_application_reader;"},{"kind":"grant","order":900058,"sha256":"627e08babcc019a2cdac97fcf7f4e1adccd7a63ffc6bd8eb8221fbd37e09ca50","identity":"public.event_push_instances","definition":"select public.custodial_release_authority_reset_grants('public.event_push_instances'); grant DELETE on table public.event_push_instances to postgres; grant INSERT on table public.event_push_instances to postgres; grant SELECT on table public.event_push_instances to postgres; grant UPDATE on table public.event_push_instances to postgres; grant DELETE on table public.event_push_instances to service_role; grant INSERT on table public.event_push_instances to service_role; grant SELECT on table public.event_push_instances to service_role; grant UPDATE on table public.event_push_instances to service_role; grant SELECT on table public.event_push_instances to custodial_application_reader;"},{"kind":"grant","order":900015,"sha256":"4f824eb56a569e35a75e9a3eee04072ec91c0477b0ff01bae0e68f9eb763943a","identity":"public.custodial_offline_scan_authority_snapshots","definition":"select public.custodial_release_authority_reset_grants('public.custodial_offline_scan_authority_snapshots'); grant SELECT on table public.custodial_offline_scan_authority_snapshots to custodial_application_reader;"},{"kind":"grant","order":900106,"sha256":"222112fc4690ec7fc4a1cde7899416bc724a78bbc07a43ca4743d5e51e9371ce","identity":"public.ops_manager_notification_state","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_notification_state'); grant DELETE on table public.ops_manager_notification_state to postgres; grant INSERT on table public.ops_manager_notification_state to postgres; grant SELECT on table public.ops_manager_notification_state to postgres; grant UPDATE on table public.ops_manager_notification_state to postgres; grant DELETE on table public.ops_manager_notification_state to service_role; grant INSERT on table public.ops_manager_notification_state to service_role; grant SELECT on table public.ops_manager_notification_state to service_role; grant UPDATE on table public.ops_manager_notification_state to service_role; grant SELECT on table public.ops_manager_notification_state to custodial_application_reader;"},{"kind":"grant","order":900098,"sha256":"34c82b300a74aabab88327a5c87c1829deb41a095e32aae0d4b2d86bfa5720e7","identity":"public.operational_notification_jobs","definition":"select public.custodial_release_authority_reset_grants('public.operational_notification_jobs'); grant INSERT on table public.operational_notification_jobs to service_role; grant SELECT on table public.operational_notification_jobs to service_role; grant UPDATE on table public.operational_notification_jobs to service_role; grant SELECT on table public.operational_notification_jobs to custodial_application_reader;"},{"kind":"grant","order":900001,"sha256":"a809f0bd302ec292999d2fa2bf4f75fbe9254d29ba48b826abc805b2ae281f2a","identity":"public.cleaning_inspections","definition":"select public.custodial_release_authority_reset_grants('public.cleaning_inspections'); grant DELETE on table public.cleaning_inspections to postgres; grant INSERT on table public.cleaning_inspections to postgres; grant SELECT on table public.cleaning_inspections to postgres; grant UPDATE on table public.cleaning_inspections to postgres; grant SELECT on table public.cleaning_inspections to service_role; grant SELECT on table public.cleaning_inspections to custodial_application_reader;"},{"kind":"grant","order":950111,"sha256":"609afcdbc8937a8206a9b30493fbee700d61fe05c609aa1f4f65388d8ae92aa7","identity":"public.v_weekly_schedule_effective_ranges","definition":"select public.custodial_release_authority_reset_grants('public.v_weekly_schedule_effective_ranges'); grant SELECT on table public.v_weekly_schedule_effective_ranges to custodial_application_reader;"},{"kind":"grant","order":900034,"sha256":"6e2b0b8cb92704b8fd7f0074a84722dbfa749a323836c40bb269683a8d7d8563","identity":"public.device_auth_enrollment_operations","definition":"select public.custodial_release_authority_reset_grants('public.device_auth_enrollment_operations'); grant DELETE on table public.device_auth_enrollment_operations to postgres; grant INSERT on table public.device_auth_enrollment_operations to postgres; grant SELECT on table public.device_auth_enrollment_operations to postgres; grant UPDATE on table public.device_auth_enrollment_operations to postgres; grant DELETE on table public.device_auth_enrollment_operations to service_role; grant INSERT on table public.device_auth_enrollment_operations to service_role; grant SELECT on table public.device_auth_enrollment_operations to service_role; grant UPDATE on table public.device_auth_enrollment_operations to service_role; grant SELECT on table public.device_auth_enrollment_operations to custodial_application_reader;"},{"kind":"grant","order":900051,"sha256":"53d490ad69b0ce490e07d9a8cef48d9f07d334cee6a22f4be0a9974838e4dc17","identity":"public.employee_push_registrations","definition":"select public.custodial_release_authority_reset_grants('public.employee_push_registrations'); grant DELETE on table public.employee_push_registrations to postgres; grant INSERT on table public.employee_push_registrations to postgres; grant SELECT on table public.employee_push_registrations to postgres; grant UPDATE on table public.employee_push_registrations to postgres; grant DELETE on table public.employee_push_registrations to service_role; grant INSERT on table public.employee_push_registrations to service_role; grant SELECT on table public.employee_push_registrations to service_role; grant UPDATE on table public.employee_push_registrations to service_role; grant SELECT on table public.employee_push_registrations to custodial_application_reader;"},{"kind":"grant","order":900005,"sha256":"60e71cffd2b183205b3265815ddfffb8a2589f91fe7d088479ec5a250b6ae2a2","identity":"public.custodial_employee_device_assignment_history","definition":"select public.custodial_release_authority_reset_grants('public.custodial_employee_device_assignment_history'); grant DELETE on table public.custodial_employee_device_assignment_history to postgres; grant INSERT on table public.custodial_employee_device_assignment_history to postgres; grant SELECT on table public.custodial_employee_device_assignment_history to postgres; grant UPDATE on table public.custodial_employee_device_assignment_history to postgres; grant DELETE on table public.custodial_employee_device_assignment_history to service_role; grant INSERT on table public.custodial_employee_device_assignment_history to service_role; grant SELECT on table public.custodial_employee_device_assignment_history to service_role; grant UPDATE on table public.custodial_employee_device_assignment_history to service_role; grant SELECT on table public.custodial_employee_device_assignment_history to custodial_application_reader;"},{"kind":"grant","order":900105,"sha256":"e7a8d8b271caa6f9095c8d37c7d794a2d2ed7f2b2304e3b80fdf8ba2af3fe80e","identity":"public.ops_manager_notification_queue","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_notification_queue'); grant DELETE on table public.ops_manager_notification_queue to postgres; grant INSERT on table public.ops_manager_notification_queue to postgres; grant SELECT on table public.ops_manager_notification_queue to postgres; grant UPDATE on table public.ops_manager_notification_queue to postgres; grant DELETE on table public.ops_manager_notification_queue to service_role; grant INSERT on table public.ops_manager_notification_queue to service_role; grant SELECT on table public.ops_manager_notification_queue to service_role; grant UPDATE on table public.ops_manager_notification_queue to service_role; grant SELECT on table public.ops_manager_notification_queue to custodial_application_reader;"}]$no_auto_grants$::jsonb)
  x(kind text,identity text,"order" integer,definition text,sha256 text) loop
  if (select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind=expected_record.kind and object_identity=expected_record.identity
    and restore_order=expected_record."order" and definition_sql=expected_record.definition
    and definition_sha256=expected_record.sha256) <> 1 then
   raise exception 'No-auto source-bound grant definition/order differs: %',expected_record.identity;end if;
 end loop;
 SELECT definition INTO STRICT body FROM private_custody_surface_before;
 IF (SELECT count(*) FROM private_custody_inventory_before)<>6884
  OR public.static_weekly_digest_text(body) IS DISTINCT FROM '0180ad91acf42e45aee3092a31b7b8b297f4c455e78d1c9ea97a7bdead272594'
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR (SELECT public.static_weekly_digest_text(string_agg((CASE WHEN object_kind='constraint' THEN CASE object_identity WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_actor_manager_id_fkey' THEN 501238 WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_outcome_check' THEN 501241 WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_pkey' THEN 501242 WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_ticket_id_fkey' THEN 501243 WHEN 'maintenance_tickets:maintenance_ticket_resolution_evidence_check' THEN 500000 WHEN 'maintenance_tickets:maintenance_tickets_resolution_actor_manager_id_fkey' THEN 501237 ELSE restore_order END ELSE restore_order END)::text||E'\n'||object_kind||E'\n'||object_identity||E'\n'||definition_sha256,E'\n---\n'
   ORDER BY object_kind COLLATE "C",object_identity COLLATE "C")) FROM private_custody_inventory_before)
   IS DISTINCT FROM 'b651fc39ee0dcd81d33b9bc827e9d8b4789482fc7a8d0560c2f0db665813f641'
  OR EXISTS(SELECT 1 FROM private_custody_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
 THEN RAISE EXCEPTION 'Private custody exact source252 recovery predecessor changed';END IF;
 SELECT * INTO STRICT saved FROM private_custody_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
  AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure;
 IF saved.definition_sql IS DISTINCT FROM body OR saved.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(body)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('public.custodial_native_private_custody_operations') IS NOT NULL
  OR to_regclass('public.custodial_native_private_custody_chunks') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
   'custodial_private_custody_v1_immutable','custodial_private_custody_v1_retain_chunk','custodial_private_custody_v1_read_chunk'))
 THEN RAISE EXCEPTION 'Private custody predecessor guard changed or unadmitted survivors exist';END IF;
END $private_predecessor$;

CREATE TABLE public.custodial_native_private_custody_operations (
 operation_id uuid PRIMARY KEY,
 separation_id uuid NOT NULL REFERENCES public.custodial_employee_separation_fences(separation_id),
 generation_id uuid NOT NULL REFERENCES public.employee_native_push_generations(generation_id),
 device_id uuid NOT NULL REFERENCES public.devices(id),
 credential_id uuid NOT NULL REFERENCES public.device_auth_credentials(credential_id),
 original_context jsonb NOT NULL CHECK(jsonb_typeof(original_context)='object'),
 original_generation jsonb NOT NULL CHECK(jsonb_typeof(original_generation)='object'),
 verified_binding jsonb NOT NULL CHECK(jsonb_typeof(verified_binding)='object'),
 owner_proof jsonb NOT NULL CHECK(jsonb_typeof(owner_proof)='object'),
 original_wire bytea NOT NULL CHECK(octet_length(original_wire) BETWEEN 1 AND 262144),
 original_wire_sha256 text NOT NULL CHECK(original_wire_sha256 ~ '^[0-9a-f]{64}$'),
 principal_digest text NOT NULL CHECK(principal_digest ~ '^[0-9a-f]{64}$'),
 plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[0-9a-f]{64}$'),
 frame_sha256 text NOT NULL CHECK(frame_sha256 ~ '^[0-9a-f]{64}$'),
 record_sha256 text NOT NULL CHECK(record_sha256 ~ '^[0-9a-f]{64}$'),
 frame_bytes integer NOT NULL CHECK(frame_bytes BETWEEN 1 AND 42500000),
 chunk_count integer NOT NULL CHECK(chunk_count=(frame_bytes+24575)/24576),
 retained_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(retained_at)),
 CHECK(original_wire_sha256=encode(extensions.digest(original_wire,'sha256'),'hex'))
);
CREATE TABLE public.custodial_native_private_custody_chunks (
 operation_id uuid NOT NULL REFERENCES public.custodial_native_private_custody_operations(operation_id),
 chunk_index integer NOT NULL CHECK(chunk_index>=0),
 write_id uuid NOT NULL UNIQUE,
 native_request_id uuid NOT NULL UNIQUE,
 chunk_bytes bytea NOT NULL CHECK(octet_length(chunk_bytes) BETWEEN 1 AND 24576),
 chunk_sha256 text NOT NULL CHECK(chunk_sha256 ~ '^[0-9a-f]{64}$'),
 request_bytes bytea NOT NULL CHECK(octet_length(request_bytes) BETWEEN 1 AND 393216),
 request_body_sha256 text NOT NULL CHECK(request_body_sha256 ~ '^[0-9a-f]{64}$'),
 attestation_digest text NOT NULL CHECK(attestation_digest ~ '^[0-9a-f]{64}$'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(received_at)),
 PRIMARY KEY(operation_id,chunk_index),
 CHECK(chunk_sha256=encode(extensions.digest(chunk_bytes,'sha256'),'hex')),
 CHECK(request_body_sha256=encode(extensions.digest(request_bytes,'sha256'),'hex'))
);
CREATE INDEX custodial_native_private_custody_operation_owner_idx ON public.custodial_native_private_custody_operations(device_id,credential_id,generation_id);
CREATE INDEX custodial_native_private_custody_operation_separation_idx ON public.custodial_native_private_custody_operations(separation_id);
CREATE INDEX custodial_native_private_custody_operation_generation_idx ON public.custodial_native_private_custody_operations(generation_id);
CREATE INDEX custodial_native_private_custody_operation_credential_idx ON public.custodial_native_private_custody_operations(credential_id);
ALTER TABLE public.custodial_native_private_custody_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_native_private_custody_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_native_private_custody_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custodial_native_private_custody_chunks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.custodial_native_private_custody_operations,public.custodial_native_private_custody_chunks
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE FUNCTION public.custodial_private_custody_v1_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN RAISE EXCEPTION USING errcode='42501',message='original opaque custody evidence is immutable';END $fn$;
REVOKE ALL ON FUNCTION public.custodial_private_custody_v1_immutable()
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE TRIGGER trg_native_private_custody_operation_immutable BEFORE UPDATE OR DELETE ON public.custodial_native_private_custody_operations
 FOR EACH ROW EXECUTE FUNCTION public.custodial_private_custody_v1_immutable();
CREATE TRIGGER trg_native_private_custody_chunk_immutable BEFORE UPDATE OR DELETE ON public.custodial_native_private_custody_chunks
 FOR EACH ROW EXECUTE FUNCTION public.custodial_private_custody_v1_immutable();
CREATE TRIGGER trg_native_private_custody_operation_no_truncate BEFORE TRUNCATE ON public.custodial_native_private_custody_operations
 FOR EACH STATEMENT EXECUTE FUNCTION public.custodial_private_custody_v1_immutable();
CREATE TRIGGER trg_native_private_custody_chunk_no_truncate BEFORE TRUNCATE ON public.custodial_native_private_custody_chunks
 FOR EACH STATEMENT EXECUTE FUNCTION public.custodial_private_custody_v1_immutable();
ALTER TABLE public.custodial_native_private_custody_operations ENABLE ALWAYS TRIGGER trg_native_private_custody_operation_immutable;
ALTER TABLE public.custodial_native_private_custody_chunks ENABLE ALWAYS TRIGGER trg_native_private_custody_chunk_immutable;
ALTER TABLE public.custodial_native_private_custody_operations ENABLE ALWAYS TRIGGER trg_native_private_custody_operation_no_truncate;
ALTER TABLE public.custodial_native_private_custody_chunks ENABLE ALWAYS TRIGGER trg_native_private_custody_chunk_no_truncate;
-- Existing common disaster-restore DDL hook must attach its normal mutation
-- fence to BOTH new relations. A missing/changed hook is not repaired here by
-- an ad-hoc grant, disabled guard or substitute privileged application path.
DO $mutation_boundary$ BEGIN
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN(
   'public.custodial_native_private_custody_operations'::regclass,'public.custodial_native_private_custody_chunks'::regclass)
   AND tgname='custodial_disaster_restore_mutation_fence'
   AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgenabled='O' AND NOT tgisinternal)<>2
 THEN RAISE EXCEPTION 'Private custody existing disaster-restore mutation boundary unavailable';END IF;
END $mutation_boundary$;

-- Genuinely owner-privileged internal access follows the existing native
-- separation RPC boundary; no JWT user_metadata or employee/browser table grant.
CREATE FUNCTION public.custodial_private_custody_v1_retain_chunk(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_native_request uuid,p_attestation_digest text,p_request_base64 text,p_binding jsonb,p_owner_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE credential public.device_auth_credentials%rowtype;context jsonb;generation jsonb;frame jsonb;
 request_bytes bytea;wire bytea;chunk bytea;request_sha text;wire_sha text;frame_length integer;chunks integer;idx integer;
 prior public.custodial_native_private_custody_operations%rowtype;existing public.custodial_native_private_custody_chunks%rowtype;
 replayed boolean:=false;key text;keys text[];wire_json jsonb;manifest jsonb;
BEGIN
 IF p_operation IS NULL OR p_device IS NULL OR p_credential IS NULL OR p_generation IS NULL OR p_native_request IS NULL
  OR p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' OR p_credential_key_id IS NULL OR p_credential_key_id !~ '^[0-9a-f]{64}$'
  OR p_attestation_digest IS NULL OR p_attestation_digest !~ '^[0-9a-f]{64}$' OR p_request_base64 IS NULL OR length(p_request_base64)>524288
  OR p_request_base64 !~ '^[A-Za-z0-9+/]+={0,2}$' OR jsonb_typeof(p_binding) IS DISTINCT FROM 'object' OR jsonb_typeof(p_owner_proof) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION USING errcode='22023',message='closed original private custody request required';END IF;
 SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(p_binding) k;
 IF keys IS DISTINCT FROM ARRAY['automatic_acceptance','browser_inventory_state','credential_id','generation_activated_at','generation_id','inventory_acknowledged','manifest_sha256','native_semantic_inventory_state','new_work_allowed','phone_released','principal_digest','raw_snapshot_sha256','record_count','schema','separation_id','verification']::text[]
  OR p_binding->>'schema' IS DISTINCT FROM 'custodial.native-protected-generation-raw-binding.v1'
  OR p_binding->>'verification' IS DISTINCT FROM 'MATCHED_PRE_CUTOFF_GENERATION_RAW_BINDING_RETENTION_ONLY'
  OR p_binding->>'native_semantic_inventory_state' IS DISTINCT FROM 'UNKNOWN' OR p_binding->>'browser_inventory_state' IS DISTINCT FROM 'UNKNOWN'
  OR p_binding->'automatic_acceptance' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION USING errcode='22023',message='closed identity-only generation binding required';END IF;
 request_bytes:=decode(p_request_base64,'base64');IF octet_length(request_bytes) NOT BETWEEN 1 AND 393216
  OR replace(encode(request_bytes,'base64'),E'\n','') IS DISTINCT FROM p_request_base64 THEN RAISE EXCEPTION USING errcode='22023',message='exact request bytes required';END IF;
 -- Existing strict duplicate/UTF8/bounded native JSON validator, unchanged.
 PERFORM public.custodial_v15_assert_native_json(convert_from(request_bytes,'UTF8')::json,0);
 frame:=convert_from(request_bytes,'UTF8')::jsonb;
 SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(frame) k;
 IF keys IS DISTINCT FROM ARRAY['attempt_id','chunk_base64','chunk_bytes','chunk_count','chunk_index','chunk_sha256','engine_revision','frame_bytes','frame_sha256','offset','operation_id','original_frozen_work_sha256','original_generation_id','original_signed_wire_base64','owner_proof_base64','plan_sha256','principal_digest','purpose_attestation','purpose_binding_sha256','read_query_id','record_sha256','schema','write_id']::text[]
 THEN RAISE EXCEPTION USING errcode='22023',message='exact private write envelope fields required';END IF;
 FOR key IN SELECT jsonb_object_keys(frame) LOOP IF jsonb_typeof(frame->key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING errcode='22023',message='private write literal strings required';END IF;END LOOP;
 IF frame->>'schema' IS DISTINCT FROM 'custodial.original-native-private-custody-write.v1'
  OR frame->>'operation_id' IS DISTINCT FROM p_operation::text OR frame->>'original_generation_id' IS DISTINCT FROM p_generation::text
  OR frame->>'attempt_id' IS DISTINCT FROM p_native_request::text OR p_binding->>'credential_id' IS DISTINCT FROM p_credential::text
  OR p_binding->>'generation_id' IS DISTINCT FROM p_generation::text OR p_binding->>'principal_digest' IS DISTINCT FROM frame->>'principal_digest'
  OR p_owner_proof->>'credential_id' IS DISTINCT FROM p_credential::text OR p_owner_proof->>'original_generation_id' IS DISTINCT FROM p_generation::text
  OR p_owner_proof->>'principal_digest' IS DISTINCT FROM frame->>'principal_digest' OR p_owner_proof->>'record_sha256' IS DISTINCT FROM frame->>'record_sha256'
  OR p_binding->'new_work_allowed' IS DISTINCT FROM 'false'::jsonb OR p_binding->'phone_released' IS DISTINCT FROM 'false'::jsonb
  OR p_binding->'inventory_acknowledged' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION USING errcode='22023',message='original identity-only scope required';END IF;
 FOREACH key IN ARRAY ARRAY['frame_sha256','record_sha256','plan_sha256','chunk_sha256','principal_digest'] LOOP
  IF frame->>key IS NULL OR frame->>key !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING errcode='22023',message='exact private custody digest required';END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['frame_bytes','chunk_count','chunk_index','offset','chunk_bytes'] LOOP
  IF frame->>key IS NULL OR frame->>key !~ '^(0|[1-9][0-9]*)$' OR length(frame->>key)>8 THEN RAISE EXCEPTION USING errcode='22023',message='bounded chunk shape required';END IF;
 END LOOP;
 frame_length:=(frame->>'frame_bytes')::integer;chunks:=(frame->>'chunk_count')::integer;idx:=(frame->>'chunk_index')::integer;
 IF frame_length NOT BETWEEN 1 AND 42500000 OR chunks<>(frame_length+24575)/24576 OR idx<0 OR idx>=chunks OR (frame->>'offset')::integer<>idx*24576 THEN RAISE EXCEPTION USING errcode='22023',message='exact chunk offset/count required';END IF;
 wire:=decode(frame->>'original_signed_wire_base64','base64');chunk:=decode(frame->>'chunk_base64','base64');
 IF octet_length(wire) NOT BETWEEN 1 AND 262144 OR replace(encode(wire,'base64'),E'\n','') IS DISTINCT FROM frame->>'original_signed_wire_base64'
  OR octet_length(chunk)<>least(24576,frame_length-idx*24576) OR octet_length(chunk)<>(frame->>'chunk_bytes')::integer
  OR replace(encode(chunk,'base64'),E'\n','') IS DISTINCT FROM frame->>'chunk_base64'
  OR encode(extensions.digest(chunk,'sha256'),'hex') IS DISTINCT FROM frame->>'chunk_sha256' THEN RAISE EXCEPTION USING errcode='22023',message='exact original encrypted slice required';END IF;
 wire_sha:=encode(extensions.digest(wire,'sha256'),'hex');request_sha:=encode(extensions.digest(request_bytes,'sha256'),'hex');
 IF p_owner_proof->>'original_wire_sha256' IS DISTINCT FROM wire_sha THEN RAISE EXCEPTION USING errcode='22023',message='original signed identity wire required';END IF;
 PERFORM public.custodial_v15_assert_native_json(convert_from(wire,'UTF8')::json,0);wire_json:=convert_from(wire,'UTF8')::jsonb;
 IF wire_json->>'manifest_sha256' IS DISTINCT FROM p_binding->>'manifest_sha256' OR jsonb_typeof(wire_json->'manifest_body') IS DISTINCT FROM 'string'
  OR encode(extensions.digest(convert_to(wire_json->>'manifest_body','UTF8'),'sha256'),'hex') IS DISTINCT FROM p_binding->>'manifest_sha256'
 THEN RAISE EXCEPTION USING errcode='22023',message='original manifest identity required';END IF;
 PERFORM public.custodial_v15_assert_native_json((wire_json->>'manifest_body')::json,0);manifest:=(wire_json->>'manifest_body')::jsonb;
 IF manifest->>'raw_snapshot_sha256' IS DISTINCT FROM p_binding->>'raw_snapshot_sha256' OR manifest->'record_count' IS DISTINCT FROM p_binding->'record_count'
 THEN RAISE EXCEPTION USING errcode='22023',message='original snapshot identity required';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO credential FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device FOR SHARE;
 IF NOT FOUND OR credential.revoked_at IS NOT NULL OR credential.confirmed_at IS NULL OR credential.token_hash IS DISTINCT FROM p_credential_hash
  OR credential.metadata_json IS NOT NULL AND jsonb_typeof(credential.metadata_json) NOT IN ('object','null')
  OR jsonb_typeof(credential.metadata_json)='object' AND credential.metadata_json ? 'credential_secret_key_id'
   AND (jsonb_typeof(credential.metadata_json->'credential_secret_key_id') IS DISTINCT FROM 'string' OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id)
 THEN RAISE EXCEPTION USING errcode='42501',message='current original credential required at custody transaction';END IF;
 context:=public.custodial_v13_read_separation_context(p_device,p_credential);
 IF context IS NULL OR context->>'separation_id' IS DISTINCT FROM p_binding->>'separation_id' OR context->>'state' IS DISTINCT FROM 'PENDING_RECONCILIATION'
 THEN RAISE EXCEPTION USING errcode='42501',message='current original separation required';END IF;
 IF manifest#>>'{original_principal,device_id}' IS DISTINCT FROM context->>'canonical_device_id' OR manifest#>>'{original_principal,employee_id}' IS DISTINCT FROM context->>'employee_id'
  OR manifest#>>'{original_principal,credential_id}' IS DISTINCT FROM context->>'credential_id' OR manifest#>'{original_principal,assignment_epoch}' IS DISTINCT FROM context->'assignment_epoch'
 THEN RAISE EXCEPTION USING errcode='42501',message='original full principal tuple required';END IF;
 PERFORM 1 FROM public.custodial_employee_separation_fences WHERE separation_id=(context->>'separation_id')::uuid FOR UPDATE;
 generation:=public.custodial_v14_read_separation_generation(p_device,p_credential,(context->>'separation_id')::uuid,p_generation,frame->>'principal_digest');
 IF generation IS NULL OR generation->>'activated_at' IS DISTINCT FROM p_binding->>'generation_activated_at' THEN RAISE EXCEPTION USING errcode='42501',message='current original generation required';END IF;
 SELECT * INTO prior FROM public.custodial_native_private_custody_operations WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.device_id<>p_device OR prior.credential_id<>p_credential OR prior.generation_id<>p_generation OR prior.separation_id<>(context->>'separation_id')::uuid
   OR prior.frame_sha256 IS DISTINCT FROM frame->>'frame_sha256' OR prior.record_sha256 IS DISTINCT FROM frame->>'record_sha256' OR prior.plan_sha256 IS DISTINCT FROM frame->>'plan_sha256'
   OR prior.original_wire IS DISTINCT FROM wire OR prior.owner_proof IS DISTINCT FROM p_owner_proof OR prior.verified_binding IS DISTINCT FROM p_binding
   OR prior.frame_bytes<>frame_length OR prior.chunk_count<>chunks THEN RAISE EXCEPTION USING errcode='23505',message='original private custody operation conflict';END IF;
 ELSE
  INSERT INTO public.custodial_native_private_custody_operations(operation_id,separation_id,generation_id,device_id,credential_id,original_context,original_generation,verified_binding,owner_proof,original_wire,original_wire_sha256,principal_digest,plan_sha256,frame_sha256,record_sha256,frame_bytes,chunk_count)
   VALUES(p_operation,(context->>'separation_id')::uuid,p_generation,p_device,p_credential,context,generation,p_binding,p_owner_proof,wire,wire_sha,frame->>'principal_digest',frame->>'plan_sha256',frame->>'frame_sha256',frame->>'record_sha256',frame_length,chunks) RETURNING * INTO prior;
 END IF;
 SELECT * INTO existing FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation AND chunk_index=idx;
 IF FOUND THEN
  IF existing.write_id<>(frame->>'write_id')::uuid OR existing.native_request_id<>p_native_request OR existing.chunk_bytes IS DISTINCT FROM chunk
   OR existing.request_bytes IS DISTINCT FROM request_bytes OR existing.attestation_digest IS DISTINCT FROM p_attestation_digest THEN RAISE EXCEPTION USING errcode='23505',message='original private custody chunk/request conflict';END IF;replayed:=true;
 ELSE
  INSERT INTO public.custodial_native_private_custody_chunks(operation_id,chunk_index,write_id,native_request_id,chunk_bytes,chunk_sha256,request_bytes,request_body_sha256,attestation_digest)
   VALUES(p_operation,idx,(frame->>'write_id')::uuid,p_native_request,chunk,frame->>'chunk_sha256',request_bytes,request_sha,p_attestation_digest) RETURNING * INTO existing;
 END IF;
 RETURN jsonb_build_object('schema','custodial.private-custody-chunk-receipt.v1','state','OPAQUE_CHUNK_RETAINED_ONLY_PENDING_RECONCILIATION',
  'operation_id',p_operation,'generation_id',p_generation,'chunk_index',idx,'native_request_id',p_native_request,'request_body_sha256',request_sha,'attestation_digest',p_attestation_digest,
  'frame_sha256',prior.frame_sha256,'plan_sha256',prior.plan_sha256,'chunk_sha256',existing.chunk_sha256,'replayed',replayed,
  'inventory_acknowledged',false,'work_accepted',false,'new_work_allowed',false,'resend_allowed',false,'finalizer_allowed',false,'key_removal',false,'phone_released',false);
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_private_custody_v1_retain_chunk(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_private_custody_v1_retain_chunk(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.custodial_private_custody_v1_read_chunk(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,p_chunk_index integer,p_native_request uuid,p_request_sha256 text,p_attestation_digest text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE credential public.device_auth_credentials%rowtype;op public.custodial_native_private_custody_operations%rowtype;chunk public.custodial_native_private_custody_chunks%rowtype;context jsonb;generation jsonb;
BEGIN
 IF p_operation IS NULL OR p_device IS NULL OR p_credential IS NULL OR p_generation IS NULL OR p_chunk_index IS NULL OR p_chunk_index<0 OR p_native_request IS NULL
  OR p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' OR p_credential_key_id IS NULL OR p_credential_key_id !~ '^[0-9a-f]{64}$'
  OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[0-9a-f]{64}$' OR p_attestation_digest IS NULL OR p_attestation_digest !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING errcode='22023',message='exact original private custody read target required';END IF;
 SELECT * INTO credential FROM public.device_auth_credentials WHERE credential_id=p_credential AND device_id=p_device;
 IF NOT FOUND OR credential.revoked_at IS NOT NULL OR credential.confirmed_at IS NULL OR credential.token_hash IS DISTINCT FROM p_credential_hash
  OR credential.metadata_json IS NOT NULL AND jsonb_typeof(credential.metadata_json) NOT IN ('object','null')
  OR jsonb_typeof(credential.metadata_json)='object' AND credential.metadata_json ? 'credential_secret_key_id'
   AND (jsonb_typeof(credential.metadata_json->'credential_secret_key_id') IS DISTINCT FROM 'string' OR credential.metadata_json->>'credential_secret_key_id' IS DISTINCT FROM p_credential_key_id)
 THEN RAISE EXCEPTION USING errcode='42501',message='current private custody read credential required';END IF;
 SELECT * INTO op FROM public.custodial_native_private_custody_operations WHERE operation_id=p_operation AND device_id=p_device AND credential_id=p_credential AND generation_id=p_generation;
 IF NOT FOUND THEN RETURN NULL;END IF;
 context:=public.custodial_v13_read_separation_context(p_device,p_credential);
 IF context IS NULL OR context->>'separation_id' IS DISTINCT FROM op.separation_id::text THEN RAISE EXCEPTION USING errcode='42501',message='current private custody read separation required';END IF;
 generation:=public.custodial_v14_read_separation_generation(p_device,p_credential,op.separation_id,p_generation,op.principal_digest);
 IF generation IS NULL OR generation IS DISTINCT FROM op.original_generation THEN RAISE EXCEPTION USING errcode='42501',message='original private custody read generation required';END IF;
 SELECT * INTO chunk FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation AND chunk_index=p_chunk_index AND native_request_id=p_native_request;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF chunk.request_body_sha256 IS DISTINCT FROM p_request_sha256 OR chunk.attestation_digest IS DISTINCT FROM p_attestation_digest
  OR chunk.request_body_sha256 IS DISTINCT FROM encode(extensions.digest(chunk.request_bytes,'sha256'),'hex') OR chunk.chunk_sha256 IS DISTINCT FROM encode(extensions.digest(chunk.chunk_bytes,'sha256'),'hex')
 THEN RAISE EXCEPTION USING errcode='23514',message='original private custody read witness mismatch';END IF;
 RETURN jsonb_build_object('schema','custodial.private-custody-chunk-readback.v1','state','OPAQUE_CHUNK_READ_ONLY_PENDING_RECONCILIATION','operation_id',p_operation,'generation_id',p_generation,
  'chunk_index',p_chunk_index,'native_request_id',p_native_request,'request_body_sha256',p_request_sha256,'attestation_digest',p_attestation_digest,'frame_sha256',op.frame_sha256,'record_sha256',op.record_sha256,
  'plan_sha256',op.plan_sha256,'chunk_sha256',chunk.chunk_sha256,'chunk_bytes',octet_length(chunk.chunk_bytes),
  'received_at',to_char(chunk.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'frame_complete_syntax_verified',false,'inventory_acknowledged',false,'work_accepted',false,'new_work_allowed',false,'resend_allowed',false,'finalizer_allowed',false,'key_removal',false,'phone_released',false);
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_private_custody_v1_read_chunk(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_private_custody_v1_read_chunk(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text) TO service_role,custodial_application_reader;

-- Exact recovery/canary inventory extension is intentionally still a draft
-- qualification requirement; the finite source extension below is NOT live
-- admission, production fingerprint, full restore or operational acceptance.
CREATE TEMP TABLE private_custody_objects ON COMMIT DROP AS
 WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_private_custody_v1_immutable','custodial_private_custody_v1_retain_chunk','custodial_private_custody_v1_read_chunk')),
 objects AS(
 SELECT 100000 bucket,0 priority,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
 UNION ALL SELECT 900000,0,'grant','public.'||oid::regprocedure::text,public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text) FROM funcs
 UNION ALL SELECT x.bucket,x.priority,x.kind,x.identity,x.definition FROM unnest(array[
  'public.custodial_native_private_custody_operations','public.custodial_native_private_custody_chunks']) rel CROSS JOIN LATERAL(
  SELECT 1000 bucket,0 priority,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
  UNION ALL SELECT 200000,0,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
   FROM pg_attribute WHERE attrelid=rel::regclass AND attnum>0 AND NOT attisdropped
  UNION ALL SELECT 300000,0,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
  UNION ALL SELECT 400000,0,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
  UNION ALL SELECT 500000,CASE WHEN contype='f' THEN 1 ELSE 0 END,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
   FROM pg_constraint WHERE conrelid=rel::regclass
  UNION ALL SELECT 600000,0,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   FROM pg_index i WHERE indrelid=rel::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
  UNION ALL SELECT 700000,0,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
   ||pg_get_triggerdef(oid,true)||'; alter table '||rel||CASE WHEN tgenabled='A' THEN ' enable always trigger ' ELSE ' enable trigger ' END||quote_ident(tgname)||';'
   FROM pg_trigger WHERE tgrelid=rel::regclass AND NOT tgisinternal
  UNION ALL SELECT 800000,0,'policy',rel||':'||polname,public.custodial_release_authority_current_policy_definition(rel||':'||polname)
   FROM pg_policy WHERE polrelid=rel::regclass
  UNION ALL SELECT 900000,0,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x)
 SELECT * FROM objects;
DO $private_objects$ BEGIN
 IF (SELECT count(*) FROM private_custody_objects)<>84
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='function')<>3
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='relation')<>2
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='column')<>28
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='column_set')<>2
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='relation_state')<>2
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='constraint')<>32
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='index')<>4
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='trigger')<>6
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='policy')<>0
  OR (SELECT count(*) FROM private_custody_objects WHERE kind='grant')<>5
  OR EXISTS(SELECT 1 FROM private_custody_objects WHERE definition IS NULL)
  OR EXISTS(SELECT kind,identity FROM private_custody_objects GROUP BY kind,identity HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM private_custody_inventory_before old JOIN private_custody_objects x ON x.kind=old.object_kind AND x.identity=old.object_identity)
 THEN RAISE EXCEPTION 'Private custody finite source object declaration changed';END IF;
END $private_objects$;
DO $private_surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM private_custody_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('opaque original private custody only; no namespace semantics, ACK, work, resend, finalizer or key/reuse authority')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM private_custody_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT acl FROM private_custody_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT owner FROM private_custody_surface_before)
 THEN RAISE EXCEPTION 'Private custody canary owner/ACL/body changed outside exact finite extension';END IF;
END $private_surface$;
-- Same normal, exclusive-lock, exact-predecessor inventory extension used by
-- the existing source251/252 migration controls. No application guard is changed.
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $private_recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM private_custody_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Private custody exact canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM private_custody_objects ORDER BY bucket,priority,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Private custody finite recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $private_recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $private_scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>6968
  OR EXISTS(SELECT old.* FROM private_custody_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   AND NOT EXISTS(SELECT 1 FROM private_custody_objects x WHERE x.kind=now.object_kind AND x.identity=now.object_identity)
   EXCEPT SELECT * FROM private_custody_inventory_before)
  OR EXISTS(SELECT 1 FROM private_custody_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Private custody unrelated recovery scope, exact new bytes or final ALWAYS inventory guard changed';END IF;
END $private_scope$;
COMMIT;
