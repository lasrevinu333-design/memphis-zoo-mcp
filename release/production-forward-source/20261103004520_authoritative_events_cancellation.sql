-- Exact existing-owner counterpart, coupled to guarded current310 postcondition.
-- Events F001/F002/F003: exact-current same-source cancellation must remove active status,
-- retain manual facts/provenance, and never adopt an unbound source key.
-- Additive SOURCE qualification only. No original migration, grant, default,
-- application record, existing receipt, or historical fingerprint is rewritten.
BEGIN;
DO $production_forward_original_owner$
BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR current_setting('transaction_read_only')<>'off'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.custodial_release_authority_restore_inventory')
   AND relowner='postgres'::regrole AND relkind='r' AND relpersistence='p')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact production postgres original owner/project/normal mutation context required';END IF;
END $production_forward_original_owner$;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
SELECT pg_advisory_xact_lock(hashtextextended('custodial-outlook-events-v1',0));
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
DO $preflight$
DECLARE actual text; writer oid:=to_regprocedure('public.custodial_outlook_event_sync_v1(text,jsonb)');
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin') THEN
  RAISE EXCEPTION 'Maintained migration owner required';END IF;
 IF writer IS NULL OR public.static_weekly_digest_text(pg_get_functiondef(writer)) IS DISTINCT FROM '943393c799426d0430a44b0056db6b292d171f5e637c66f059fac4beff65a067' THEN
  RAISE EXCEPTION 'Exact original Events writer required';END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.app_event_cancellation_transition_guard()'::regprocedure)) IS DISTINCT FROM '0731412d608701cec051f478b4d5c3188634a017838bd2a5239bceeceadbe408'
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.events_app_events'::regclass AND tgname='trg_app_event_cancellation_transition_guard'
   AND tgenabled='O' AND tgfoid='public.app_event_cancellation_transition_guard()'::regprocedure) THEN
  RAISE EXCEPTION 'Exact original cancellation transition guard required';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A' THEN
  RAISE EXCEPTION 'Original ALWAYS recovery guard required';END IF;
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>7700 THEN
  RAISE EXCEPTION 'Exact current310 recovery inventory count required';END IF;
 SELECT public.static_weekly_digest_text(string_agg(restore_order::text||E'\n'||object_kind||E'\n'||object_identity||E'\n'||definition_sha256||E'\n'||public.static_weekly_digest_text(definition_sql),E'\n---\n' ORDER BY object_kind COLLATE "C",object_identity COLLATE "C"))
 INTO actual FROM public.custodial_release_authority_restore_inventory;
 IF actual IS DISTINCT FROM '0213f2b256bcac7b8db623758ef26807583ea27074a7c362af259122d4275dca' THEN
  RAISE EXCEPTION 'Exact current310 recovery predecessor differs; reconcile other deltas first';END IF;
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity IN('custodial_outlook_event_sync_v1(text,jsonb)','public.custodial_outlook_event_sync_v1(text,jsonb)'))<>1
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
   AND object_identity IN('custodial_outlook_event_sync_v1(text,jsonb)','public.custodial_outlook_event_sync_v1(text,jsonb)')
   AND definition_sha256='943393c799426d0430a44b0056db6b292d171f5e637c66f059fac4beff65a067' AND public.static_weekly_digest_text(definition_sql)='943393c799426d0430a44b0056db6b292d171f5e637c66f059fac4beff65a067'
   AND definition_sql=pg_get_functiondef(writer)) THEN RAISE EXCEPTION 'Exact original Events recovery tuple required';END IF;
 IF has_function_privilege('anon',writer,'EXECUTE') OR has_function_privilege('authenticated',writer,'EXECUTE')
  OR NOT has_function_privilege('service_role',writer,'EXECUTE') THEN RAISE EXCEPTION 'Original service-only Events access required';END IF;
 -- Existing-owner profile: compare the complete measured 44 API default ACL
 -- rows. Do not grant, revoke, or replace the original platform defaults.
 IF (SELECT jsonb_agg(to_jsonb(q) ORDER BY owner_name COLLATE "C",schema_name COLLATE "C",object_type COLLATE "C",grantee COLLATE "C",grantor COLLATE "C",privilege_type COLLATE "C",is_grantable) FROM (
  SELECT r.rolname owner_name,CASE WHEN d.defaclnamespace=0 THEN '' ELSE n.nspname END schema_name,d.defaclobjtype::text object_type,
   coalesce(g.rolname,'PUBLIC') grantee,grantor.rolname grantor,a.privilege_type,a.is_grantable
  FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles g ON g.oid=a.grantee LEFT JOIN pg_roles grantor ON grantor.oid=a.grantor
  WHERE d.defaclnamespace IN(0,'public'::regnamespace) AND d.defaclobjtype IN('r','S')
   AND a.grantee IN(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)
 ) q) IS DISTINCT FROM $existing_defaults$[{"owner_name":"postgres","schema_name":"public","object_type":"S","grantee":"service_role","grantor":"postgres","privilege_type":"SELECT","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"S","grantee":"service_role","grantor":"postgres","privilege_type":"UPDATE","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"S","grantee":"service_role","grantor":"postgres","privilege_type":"USAGE","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"DELETE","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"INSERT","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"MAINTAIN","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"REFERENCES","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"SELECT","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"TRIGGER","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"TRUNCATE","is_grantable":false},{"owner_name":"postgres","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"postgres","privilege_type":"UPDATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"anon","grantor":"supabase_admin","privilege_type":"SELECT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"anon","grantor":"supabase_admin","privilege_type":"UPDATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"anon","grantor":"supabase_admin","privilege_type":"USAGE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"SELECT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"UPDATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"USAGE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"service_role","grantor":"supabase_admin","privilege_type":"SELECT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"service_role","grantor":"supabase_admin","privilege_type":"UPDATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"S","grantee":"service_role","grantor":"supabase_admin","privilege_type":"USAGE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"DELETE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"INSERT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"MAINTAIN","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"REFERENCES","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"SELECT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"TRIGGER","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"TRUNCATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"anon","grantor":"supabase_admin","privilege_type":"UPDATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"DELETE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"INSERT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"MAINTAIN","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"REFERENCES","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"SELECT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"TRIGGER","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"TRUNCATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"authenticated","grantor":"supabase_admin","privilege_type":"UPDATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"DELETE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"INSERT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"MAINTAIN","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"REFERENCES","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"SELECT","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"TRIGGER","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"TRUNCATE","is_grantable":false},{"owner_name":"supabase_admin","schema_name":"public","object_type":"r","grantee":"service_role","grantor":"supabase_admin","privilege_type":"UPDATE","is_grantable":false}]$existing_defaults$::jsonb THEN
  RAISE EXCEPTION 'Exact existing existing API defaults differ';END IF;
END $preflight$;
CREATE TEMP TABLE events_cancel_inventory_before ON COMMIT DROP AS TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE events_cancel_writer_before ON COMMIT DROP AS SELECT * FROM pg_proc
 WHERE oid='public.custodial_outlook_event_sync_v1(text,jsonb)'::regprocedure;
CREATE TEMP TABLE events_cancel_guard_before ON COMMIT DROP AS SELECT to_jsonb(t) AS value FROM pg_trigger t
 WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass;
CREATE TEMP TABLE events_cancel_canary_before ON COMMIT DROP AS SELECT pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) AS definition;
CREATE TEMP TABLE events_cancel_surface_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_canary_authority_surface();
CREATE TEMP TABLE events_cancel_defaults_before ON COMMIT DROP AS TABLE pg_default_acl;
DO $repair$
DECLARE prior text; revised text; changed integer;
BEGIN
 prior:=pg_get_functiondef('public.custodial_outlook_event_sync_v1(text,jsonb)'::regprocedure);
 IF public.static_weekly_digest_text(prior) IS DISTINCT FROM '943393c799426d0430a44b0056db6b292d171f5e637c66f059fac4beff65a067' THEN RAISE EXCEPTION 'Writer changed after preflight';END IF;
 revised:=prior;
 revised:=replace(revised,$old$ v_event_id:=coalesce(nullif(v_input->>'event_id','')::uuid,v_prior.event_id);$old$,$new$ if p_action='cancel' and v_prior.id is null then
  raise exception using errcode='40901',message='Cancellation requires an established source event binding';end if;
 v_event_id:=coalesce(nullif(v_input->>'event_id','')::uuid,v_prior.event_id);$new$);
 revised:=replace(revised,$old$elsif v_existing.manually_overridden then$old$,$new$elsif v_existing.manually_overridden and p_action<>'cancel' then$new$);
 revised:=replace(revised,$old$revision=coalesce(revision,1)+1,source_format='outlook_auto_sync' where id=v_event_id returning * into v_saved;$old$,$new$revision=coalesce(revision,1)+1 where id=v_event_id returning * into v_saved;$new$);
 revised:=replace(revised,$old$ v_request uuid:=gen_random_uuid();v_lease jsonb;v_result jsonb;v_actor constant text:='ChatGPT Outlook Sync';$old$,$new$ v_request uuid:=gen_random_uuid();v_lease jsonb;v_result jsonb;v_transition text;v_actor constant text:='ChatGPT Outlook Sync';$new$);
 revised:=replace(revised,$old$   else update public.events_app_events set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=v_actor,$old$,$new$   else
    v_transition:=current_setting('app.event_cancellation_transition',true);
    perform set_config('app.event_cancellation_transition','on',true);
    update public.events_app_events set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=v_actor,$new$);
 revised:=replace(revised,$old$    v_status:='CANCELLED';end if;$old$,$new$    perform set_config('app.event_cancellation_transition',coalesce(v_transition,''),true);
    v_status:='CANCELLED';end if;$new$);
 IF public.static_weekly_digest_text(revised) IS DISTINCT FROM 'c3365337cf3650999b4d1a7af16c46cd1a3d8209d176273035fd0aa9ae0ecdaf' THEN RAISE EXCEPTION 'Cancellation body is not the exact reviewed substitution';END IF;
 EXECUTE revised;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_outlook_event_sync_v1(text,jsonb)'::regprocedure)) IS DISTINCT FROM 'c3365337cf3650999b4d1a7af16c46cd1a3d8209d176273035fd0aa9ae0ecdaf' THEN
  RAISE EXCEPTION 'Repaired Events writer readback differs';END IF;
 -- Exact existing inventory maintenance pattern, locked and rollback-atomic.
 -- The original guard is restored to ALWAYS before this transaction can commit.
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory
 SET definition_sql=revised,definition_sha256='c3365337cf3650999b4d1a7af16c46cd1a3d8209d176273035fd0aa9ae0ecdaf',captured_at=statement_timestamp()
 WHERE object_kind='function' AND object_identity IN('custodial_outlook_event_sync_v1(text,jsonb)','public.custodial_outlook_event_sync_v1(text,jsonb)')
 AND definition_sha256='943393c799426d0430a44b0056db6b292d171f5e637c66f059fac4beff65a067';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Exactly one Events recovery tuple must change';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
  AND object_identity IN('custodial_outlook_event_sync_v1(text,jsonb)','public.custodial_outlook_event_sync_v1(text,jsonb)')
  AND definition_sha256='c3365337cf3650999b4d1a7af16c46cd1a3d8209d176273035fd0aa9ae0ecdaf' AND definition_sql=revised AND public.static_weekly_digest_text(definition_sql)='c3365337cf3650999b4d1a7af16c46cd1a3d8209d176273035fd0aa9ae0ecdaf') THEN
  RAISE EXCEPTION 'Repaired Events recovery tuple readback differs';END IF;
 IF EXISTS(SELECT b.* FROM events_cancel_inventory_before b WHERE NOT(b.object_kind='function' AND b.object_identity IN('custodial_outlook_event_sync_v1(text,jsonb)','public.custodial_outlook_event_sync_v1(text,jsonb)'))
  EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory) OR EXISTS(
  SELECT i.* FROM public.custodial_release_authority_restore_inventory i WHERE NOT(i.object_kind='function' AND i.object_identity IN('custodial_outlook_event_sync_v1(text,jsonb)','public.custodial_outlook_event_sync_v1(text,jsonb)'))
  EXCEPT SELECT * FROM events_cancel_inventory_before) THEN RAISE EXCEPTION 'Unrelated recovery tuple changed';END IF;
 IF EXISTS(SELECT 1 FROM events_cancel_inventory_before b FULL JOIN public.custodial_release_authority_restore_inventory i USING(object_kind,object_identity)
  WHERE (to_jsonb(b)-ARRAY['definition_sql','definition_sha256','captured_at']) IS DISTINCT FROM (to_jsonb(i)-ARRAY['definition_sql','definition_sha256','captured_at'])) THEN
  RAISE EXCEPTION 'Recovery identity, ordering, or unrelated metadata changed';END IF;
 IF EXISTS(SELECT 1 FROM events_cancel_writer_before b LEFT JOIN pg_proc p ON p.oid=b.oid
  WHERE (to_jsonb(b)-'prosrc') IS DISTINCT FROM (to_jsonb(p)-'prosrc')) THEN
  RAISE EXCEPTION 'Writer owner, ACL, identity or non-body property changed';END IF;
 IF EXISTS(SELECT * FROM events_cancel_guard_before EXCEPT SELECT to_jsonb(t) FROM pg_trigger t WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass)
  OR EXISTS(SELECT to_jsonb(t) FROM pg_trigger t WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass EXCEPT SELECT * FROM events_cancel_guard_before) THEN
  RAISE EXCEPTION 'Original inventory trigger definition or state changed';END IF;
 IF (SELECT definition FROM events_cancel_canary_before) IS DISTINCT FROM pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)
  OR EXISTS(SELECT * FROM events_cancel_surface_before EXCEPT SELECT * FROM public.custodial_release_canary_authority_surface())
  OR EXISTS(SELECT * FROM public.custodial_release_canary_authority_surface() EXCEPT SELECT * FROM events_cancel_surface_before) THEN
  RAISE EXCEPTION 'Original canary definition or surface changed';END IF;
 IF EXISTS(SELECT * FROM events_cancel_defaults_before EXCEPT SELECT * FROM pg_default_acl)
  OR EXISTS(SELECT * FROM pg_default_acl EXCEPT SELECT * FROM events_cancel_defaults_before) THEN RAISE EXCEPTION 'Default privileges changed';END IF;
END $repair$;
COMMIT;
