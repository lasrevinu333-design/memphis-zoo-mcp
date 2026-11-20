-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Main CLI-generated filename; RPC-only lookup of an immutable original,
-- never a replay of the triage writer.
-- A narrow definer is required because the existing FORCE-RLS receipt table
-- has no direct server-role SELECT grant. Preserve that boundary. The fixed
-- server route verifies the signed current session/device before and after
-- this call; SQL independently checks its current named manager/credential.

-- BEGIN FINITE NEW-CREATOR PROFILE 123
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_123_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_feedback_triage_receipt']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_feedback_triage_receipt']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source123 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_123_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 123
CREATE FUNCTION public.custodial_feedback_triage_receipt(
 p_request uuid,p_manager uuid,p_credential uuid,p_feedback uuid,p_action text,p_expected_version text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
 original public.system_feedback_triage_receipts%ROWTYPE;
 manager public.ops_manager_managers%ROWTYPE;
 credential public.ops_manager_trusted_devices%ROWTYPE;
 accepted_text text; accepted_instant timestamptz;
 unknown_result CONSTANT jsonb := '{"ok":true,"outcome":"UNKNOWN","retry_safe":false}'::jsonb;
BEGIN
 IF p_request IS NULL OR p_manager IS NULL OR p_credential IS NULL OR p_feedback IS NULL
  OR p_action IS NULL OR p_action NOT IN ('acknowledged','resolved','closed')
  OR p_expected_version IS NULL OR length(p_expected_version)<>64
  OR p_expected_version!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='Exact original Feedback command required';END IF;

 -- Share locks prevent a concurrent revocation/change from slipping between
 -- authorization and the bounded read. They never lock or mutate feedback.
 SELECT * INTO manager FROM public.ops_manager_managers m WHERE m.manager_id=p_manager
  AND m.active IS TRUE AND m.revoked_at IS NULL AND m.is_system_principal IS FALSE
  AND nullif(btrim(m.display_name),'') IS NOT NULL
  AND m.roles&&ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='Current named manager required';END IF;
 SELECT * INTO credential FROM public.ops_manager_trusted_devices d WHERE d.credential_id=p_credential
  AND d.manager_id=manager.manager_id AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp()
  AND d.created_at<=clock_timestamp() AND d.max_access_level='full_access'
  AND nullif(btrim(d.device_id),'') IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='Current full-access manager credential required';END IF;

 -- A foreign request never returns its stored command. No current feedback
 -- projection, caller echo, advisory writer lock, or inferred no-effect result.
 SELECT * INTO original FROM public.system_feedback_triage_receipts r
 WHERE r.request_id=p_request AND r.manager_id=p_manager AND r.credential_id=p_credential
  AND r.feedback_id=p_feedback AND r.action=p_action AND r.expected_version=p_expected_version;
 IF NOT FOUND THEN RETURN unknown_result;END IF;

 IF jsonb_typeof(original.receipt) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM jsonb_object_keys(original.receipt))<>7
  OR NOT(original.receipt ?& ARRAY['request_id','feedback_id','status','triage_version',
    'actor_manager_id','actor_credential_id','accepted_at'])
  OR EXISTS(SELECT 1 FROM jsonb_each(original.receipt) entry WHERE jsonb_typeof(entry.value)<>'string')
  OR original.receipt->>'request_id' IS DISTINCT FROM original.request_id::text
  OR original.receipt->>'feedback_id' IS DISTINCT FROM original.feedback_id::text
  OR original.receipt->>'status' IS DISTINCT FROM original.action
  OR original.receipt->>'actor_manager_id' IS DISTINCT FROM original.manager_id::text
  OR original.receipt->>'actor_credential_id' IS DISTINCT FROM original.credential_id::text
  OR length(original.receipt->>'triage_version')<>64
  OR original.receipt->>'triage_version'!~'^[a-f0-9]{64}$'
  OR original.receipt->>'triage_version'=original.expected_version THEN RETURN unknown_result;END IF;

 -- Preserve the persisted timestamp bytes, including SQL microseconds. A
 -- genuine Gregorian date and exact civil time must match the stored instant;
 -- no current-clock cutoff, repaired date, or reconstructed acceptance value.
 accepted_text:=original.receipt->>'accepted_at';
 IF accepted_text!~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
  OR right(accepted_text,1) IN (chr(10),chr(13),chr(8232),chr(8233)) THEN RETURN unknown_result;END IF;
 BEGIN
  PERFORM make_date(substring(accepted_text,1,4)::integer,substring(accepted_text,6,2)::integer,
    substring(accepted_text,9,2)::integer);
  accepted_instant:=accepted_text::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN unknown_result;
 END;
 IF accepted_instant IS DISTINCT FROM original.accepted_at THEN RETURN unknown_result;END IF;
 IF credential.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING errcode='42501',message='Current full-access manager credential required';END IF;
 RETURN jsonb_build_object('ok',true,'outcome','APPLIED','retry_safe',false,
  'command',jsonb_build_object('request_id',original.request_id,'feedback_id',original.feedback_id,
    'status',original.action,'expected_version',original.expected_version,
    'expected_manager_id',original.manager_id,'expected_credential_id',original.credential_id),
  'receipt',original.receipt);
END $fn$;


DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)","name":"custodial_feedback_triage_receipt","body_md5":"c6407ea29c2a243a8b91041e21e5cc81","argument_names":["p_request","p_manager","p_credential","p_feedback","p_action","p_expected_version"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source123 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_123_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
REVOKE ALL ON FUNCTION public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,service_role;
GRANT EXECUTE ON FUNCTION public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text) TO service_role;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_feedback_triage_receipt']::text[]))<>1
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_123_before)<>1 THEN
  RAISE EXCEPTION 'Finite creator Source123 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_123_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source123 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source123 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)","name":"custodial_feedback_triage_receipt","body_md5":"c6407ea29c2a243a8b91041e21e5cc81","argument_names":["p_request","p_manager","p_credential","p_feedback","p_action","p_expected_version"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source123 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;


-- Abort rather than silently inherit a different owner or broad default ACL.
DO $acl$
DECLARE target regprocedure:='public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
BEGIN
 IF (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM
    (SELECT proowner FROM pg_proc WHERE oid='public.custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=target AND (a.grantee NOT IN (p.proowner,'service_role'::regrole::oid)
      OR (a.grantee='service_role'::regrole::oid AND a.is_grantable)))
  OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
  RAISE EXCEPTION 'Feedback original reader exact owner/EXECUTE boundary changed';END IF;
END $acl$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_feedback_triage_receipt']::text[]))<>1
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_123_before)<>1 THEN
  RAISE EXCEPTION 'Finite creator Source123 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_123_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source123 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source123 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)","name":"custodial_feedback_triage_receipt","body_md5":"c6407ea29c2a243a8b91041e21e5cc81","argument_names":["p_request","p_manager","p_credential","p_feedback","p_action","p_expected_version"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"v","config":["search_path=pg_catalog"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source123 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
COMMIT;
