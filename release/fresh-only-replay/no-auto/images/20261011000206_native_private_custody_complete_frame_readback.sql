-- UNAPPLIED source254. Server-only complete opaque frame read in one current
-- SQL snapshot. This is not namespace decryption/semantic ACK or key release.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE complete_frame_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE complete_frame_surface_before ON COMMIT DROP AS
 SELECT proacl acl,proowner owner,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $predecessor$ DECLARE body text;digest text;expected_record record;BEGIN
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
 SELECT definition INTO STRICT body FROM complete_frame_surface_before;
 SELECT encode(extensions.digest(convert_to('['||string_agg(
  '{"object_kind":'||to_json(object_kind)::text||',"object_identity":'||to_json(object_identity)::text||
  ',"restore_order":'||(CASE WHEN object_kind='constraint' THEN CASE object_identity WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_actor_manager_id_fkey' THEN 501238 WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_outcome_check' THEN 501241 WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_pkey' THEN 501242 WHEN 'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_ticket_id_fkey' THEN 501243 WHEN 'maintenance_tickets:maintenance_ticket_resolution_evidence_check' THEN 500000 WHEN 'maintenance_tickets:maintenance_tickets_resolution_actor_manager_id_fkey' THEN 501237 ELSE restore_order END ELSE restore_order END)::text||',"definition_sha256":'||to_json(definition_sha256)::text||'}',','
  ORDER BY object_kind COLLATE "C",object_identity COLLATE "C")||']','UTF8'),'sha256'),'hex')
  INTO digest FROM complete_frame_inventory_before;
 IF (SELECT count(*) FROM complete_frame_inventory_before)<>6968
  OR digest IS DISTINCT FROM '3b6f36893e19bf9987fedb196a4c826af3d57211e0e8e25e04237eeb18dc25ae'
  OR EXISTS(SELECT 1 FROM complete_frame_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR NOT EXISTS(SELECT 1 FROM complete_frame_inventory_before WHERE object_kind='function'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=body)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='custodial_private_custody_v1_read_complete_frame')
 THEN RAISE EXCEPTION 'Complete frame exact source253 recovery predecessor changed';END IF;
END $predecessor$;

-- A narrowly scoped privileged lookup is necessary because the existing
-- opaque tables are FORCE-RLS/internal and have NO direct runtime grants.
-- Its only entry is the same exact current credential/generation/original
-- write target already checked by the owning fixed reader, in this snapshot.
CREATE FUNCTION public.custodial_private_custody_v1_read_complete_frame(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_native_request uuid,p_request_sha256 text,p_attestation_digest text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE target jsonb;op public.custodial_native_private_custody_operations%rowtype;row_count integer;frame bytea;
BEGIN
 target:=public.custodial_private_custody_v1_read_chunk(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_chunk_index,p_native_request,p_request_sha256,p_attestation_digest);
 IF target IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations
  WHERE operation_id=p_operation AND device_id=p_device AND credential_id=p_credential AND generation_id=p_generation;
 SELECT count(*) INTO row_count FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation;
 IF row_count>op.chunk_count OR EXISTS(
  SELECT 1 FROM public.custodial_native_private_custody_chunks c WHERE c.operation_id=p_operation AND
   (c.chunk_index>=op.chunk_count OR octet_length(c.chunk_bytes)<>least(24576,op.frame_bytes-c.chunk_index*24576)
    OR c.chunk_sha256 IS DISTINCT FROM encode(extensions.digest(c.chunk_bytes,'sha256'),'hex')
    OR c.request_body_sha256 IS DISTINCT FROM encode(extensions.digest(c.request_bytes,'sha256'),'hex')))
 THEN RAISE EXCEPTION USING errcode='23514',message='complete original custody chunk closure mismatch';END IF;
 IF row_count<op.chunk_count THEN
  RETURN jsonb_build_object('schema','custodial.private-custody-complete-frame-SQL-input.v1',
   'state','INCOMPLETE_ORIGINAL_OPAQUE_FRAME','readback',target,'frame_bytes',op.frame_bytes,'frame_sha256',op.frame_sha256,
   'record_sha256',op.record_sha256,'plan_sha256',op.plan_sha256,'chunk_count',op.chunk_count,'received_chunk_count',row_count,'frame_base64',NULL);
 END IF;
 -- Unique immutable (operation,index) rows and exact bounded count/length
 -- imply every original index exists. Ordered binary concatenation is not a
 -- new request, write, retry or change to any retained row.
 SELECT string_agg(chunk_bytes,''::bytea ORDER BY chunk_index) INTO frame
  FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation;
 IF octet_length(frame) IS DISTINCT FROM op.frame_bytes
  OR encode(extensions.digest(frame,'sha256'),'hex') IS DISTINCT FROM op.frame_sha256
 THEN RAISE EXCEPTION USING errcode='23514',message='complete original custody frame bytes mismatch';END IF;
 RETURN jsonb_build_object('schema','custodial.private-custody-complete-frame-SQL-input.v1',
  'state','COMPLETE_ORIGINAL_OPAQUE_FRAME_BYTES_ONLY','readback',target,'frame_bytes',op.frame_bytes,'frame_sha256',op.frame_sha256,
  'record_sha256',op.record_sha256,'plan_sha256',op.plan_sha256,'chunk_count',op.chunk_count,'received_chunk_count',row_count,
  'frame_base64',replace(encode(frame,'base64'),E'\n',''));
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 TO service_role,custodial_application_reader;

CREATE TEMP TABLE complete_frame_objects ON COMMIT DROP AS
 SELECT 100000 bucket,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition
  FROM pg_proc WHERE oid='public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure
 UNION ALL SELECT 900000,'grant','public.'||oid::regprocedure::text,
  public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text)
  FROM pg_proc WHERE oid='public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure;
DO $surface$ DECLARE original text;patched text;entries text;BEGIN
 IF (SELECT count(*) FROM complete_frame_objects)<>2 OR EXISTS(SELECT 1 FROM complete_frame_objects WHERE definition IS NULL)
  OR EXISTS(SELECT 1 FROM complete_frame_inventory_before i JOIN complete_frame_objects x ON x.kind=i.object_kind AND x.identity=i.object_identity)
 THEN RAISE EXCEPTION 'Complete frame finite new function/grant declaration changed';END IF;
 SELECT definition INTO STRICT original FROM complete_frame_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('current original opaque frame bytes/syntax only; no ACK, decryption, work, finalizer or key authority')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM complete_frame_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM (SELECT acl FROM complete_frame_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM (SELECT owner FROM complete_frame_surface_before)
 THEN RAISE EXCEPTION 'Complete frame canary owner/ACL/body changed beyond declared source';END IF;
END $surface$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;n integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM complete_frame_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Complete frame canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM complete_frame_objects ORDER BY bucket,identity LOOP
  SELECT candidate INTO n FROM generate_series(obj.bucket+1,obj.bucket+99998) candidate
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=candidate) ORDER BY candidate LIMIT 1;
  IF n IS NULL THEN RAISE EXCEPTION 'Complete frame recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(n,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>6970
  OR EXISTS(SELECT old.* FROM complete_frame_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT 1 FROM complete_frame_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Complete frame exact new recovery scope/ALWAYS guard changed';END IF;
END $scope$;
COMMIT;
