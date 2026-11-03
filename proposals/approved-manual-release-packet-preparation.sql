-- Worker1 preparation-only successor. Main owns SQL qualification/application.
-- AFTER custodial-leadership-pin; BEFORE device delivery and proof LAST.
-- No runtime privilege, chosen-name assertion, context, credential or owner actor.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
DO $requires$ BEGIN
 IF current_user<>session_user OR current_user NOT IN('postgres','supabase_admin')
  OR to_regclass('custodial_leadership_private.policy') IS NULL
  OR to_regprocedure('public.static_weekly_prepare_coverall_activation(jsonb)') IS NULL
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure) IS DISTINCT FROM current_user::regrole::oid
 THEN RAISE EXCEPTION 'Current original packet owner and installed PIN/cohort policy required';END IF;
END $requires$;
CREATE FUNCTION custodial_coverall.assert_packet_preparation_target(p_manager uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE p custodial_leadership_private.policy%rowtype;
BEGIN
 IF p_manager IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Explicit packet preparation target required';END IF;
 SELECT * INTO STRICT p FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 IF p_manager=p.cohort_principal_id THEN
  IF p.enabled IS DISTINCT FROM true OR NOT coalesce('custodialManagementAdmin'=ANY(p.permissions),false)
   OR p.approved_by IS NULL OR p.approved_at IS NULL OR p.approval_ref IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id
    AND m.active IS TRUE AND m.revoked_at IS NULL AND m.is_system_principal IS TRUE)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact enabled approved management cohort target required';END IF;
  RETURN; -- Target eligibility ONLY; not an authenticated actor or browser.
 END IF;
 -- Named-target semantics remain the original manager_actor call, unchanged.
 PERFORM public.static_weekly_v3_manager_actor(p_manager);
END $fn$;
REVOKE ALL ON FUNCTION custodial_coverall.assert_packet_preparation_target(uuid)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
DO $single_clause$
DECLARE original text;changed text;inverse text;needle text;replacement text;metadata jsonb;
BEGIN
 SELECT to_jsonb(p)-'prosrc' INTO STRICT metadata FROM pg_proc p WHERE oid='public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure;
 original:=pg_get_functiondef('public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure);
 needle:=$before$PERFORM public.static_weekly_v3_manager_actor((p_data->>'managerId')::uuid);$before$;
 replacement:=$after$PERFORM custodial_coverall.assert_packet_preparation_target((p_data->>'managerId')::uuid);$after$;
 IF length(original)-length(replace(original,needle,''))<>length(needle)
  OR position('PERFORM public.static_weekly_v3_assert_release_operator();' IN original)=0
  OR position(replacement IN original)>0
 THEN RAISE EXCEPTION 'Exact release-only packet target predecessor differs';END IF;
 changed:=replace(original,needle,replacement);inverse:=replace(changed,replacement,needle);
 IF inverse<>original THEN RAISE EXCEPTION 'Packet target single-clause whole inverse differs';END IF;
 EXECUTE changed;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure) IS DISTINCT FROM metadata
 THEN RAISE EXCEPTION 'Packet preparation owner/ACL/signature/config/volatility changed';END IF;
END $single_clause$;
-- Helper is owner-only. Existing release-only prepare EXECUTE and ALL runtime
-- activation/request/credential/permission guards remain byte-literal.
COMMIT;
