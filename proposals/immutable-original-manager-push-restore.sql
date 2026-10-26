-- UNACTIVATED Source proposal. Main owns installation and native qualification.
-- Exact original INSERT plus native effect-3 retirement UPDATE; no new role/grant/trigger/admission.
-- Original UNIT archive c2ca572a9b54f9e3f02f3136fbe42a590857778f310edd32e54315edd3554ef0.
-- source-catalog.json SHA256 0bd433901d199bd273b8442fd0b295c619cc4fe912e3d5ea7c17ab21a6c30e2d.
-- Its migration_owner label is not a runtime role assertion: the captured
-- pg_dump and original-acls.json independently require supabase_admin ownership.
-- Ordinary preferences/UPDATE/credential checks remain unchanged outside the native fixed effect-3 scope.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $immutable_original_manager_push_restore$
DECLARE
 owner_oid oid; postgres_oid oid; function_oid oid; helper_oid oid; staged_helper_oid oid;
 push_oid oid; preferences_oid oid; authority_helper_oid oid; authority_scope_oid oid; image_oid oid;
 authority_helper pg_catalog.pg_proc; authority_scope pg_catalog.pg_class;
 original pg_catalog.pg_proc; observed pg_catalog.pg_proc; helper pg_catalog.pg_proc; staged_helper pg_catalog.pg_proc;
 before_definition text; after_definition text; after_body text;
 helper_definition text; staged_helper_definition text; original_triggers jsonb; original_relations jsonb;
 insertion_point constant text:=E'\nbegin\n';
 profile constant jsonb:=$original_manager_push_profile$
{
  "identity": "public.ops_manager_notification_validate_owner()",
  "registry_identity": "ops_manager_notification_validate_owner()",
  "before_definition": "CREATE OR REPLACE FUNCTION public.ops_manager_notification_validate_owner()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare\n  v_manager_id uuid;\nbegin\n  select manager_id into v_manager_id\n  from public.ops_manager_trusted_devices\n  where credential_id=new.credential_id\n    and revoked_at is null\n    and expires_at>now();\n  if v_manager_id is null or v_manager_id is distinct from new.manager_id then\n    raise exception using errcode='23514',message='Notification record must belong to the active trusted manager device.';\n  end if;\n  new.updated_at:=now();\n  return new;\nend\n$function$\n",
  "before_definition_sha256": "c51dd11eb1a98774e84e7e22bebc807f2f31baae91e2803d68092349fe7a5212",
  "before_prosrc_sha256": "88f82afd9a60e291ef2715b404303d715b5764fae0d7cc5d44e9aa6996072aab",
  "restore_branch": "  -- Only the native effect-3 scope may retire an authenticated original push.\n  -- An expired archived credential is never renewed or used to enable a push.\n  if TG_OP = 'UPDATE' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'ops_manager_push_devices'\n    and TG_NAME = 'trg_ops_manager_push_devices_owner' and TG_NARGS = 0\n    and TG_RELID = pg_catalog.to_regclass('public.ops_manager_push_devices')\n    and pg_catalog.pg_trigger_depth() = 1\n    and current_user = session_user and current_user = 'supabase_admin' then\n    if custodial_dr.immutable_original_authority_guard_matches(TG_RELID,TG_OP) is true then\n      declare v_original_authority custodial_dr.immutable_original_authority_scopes;\n        v_original_unretired public.ops_manager_push_devices;\n      begin\n        select * into strict v_original_authority from custodial_dr.immutable_original_authority_scopes\n          where database_oid=(select oid from pg_catalog.pg_database where datname=current_database())\n            and backend_pid=pg_catalog.pg_backend_pid() and transaction_id=pg_catalog.txid_current();\n        v_original_unretired:=NEW;\n        v_original_unretired.enabled:=OLD.enabled;\n        v_original_unretired.revoked_at:=OLD.revoked_at;\n        v_original_unretired.updated_at:=OLD.updated_at;\n        if v_original_authority.phase is distinct from 'RUNNING'\n          or v_original_authority.completed_step is distinct from 2\n          or v_original_authority.active_table_oid is distinct from TG_RELID\n          or v_original_authority.owner_oid is distinct from (select oid from pg_catalog.pg_roles where rolname=session_user)\n          or v_original_authority.result is not null\n          or (select count(*) from pg_catalog.jsonb_object_keys(v_original_authority.counts))<>2\n          or not (v_original_authority.counts ?& array['employee_credentials','employee_enrollment']::text[])\n          or not (coalesce(OLD.enabled,true)=true or OLD.revoked_at is null)\n          or NEW.enabled is distinct from false or NEW.revoked_at is null\n          or NEW.revoked_at < pg_catalog.transaction_timestamp() or NEW.revoked_at > pg_catalog.clock_timestamp()\n          or NEW.updated_at is distinct from OLD.updated_at\n          or pg_catalog.record_image_eq(v_original_unretired,OLD) is not true then\n          raise exception using errcode='55000',message='Original manager push retirement row differs';\n        end if;\n        if custodial_dr.immutable_original_authority_guard_matches(TG_RELID,TG_OP) is not true\n          or (select pg_catalog.to_jsonb(s) from custodial_dr.immutable_original_authority_scopes s\n            where database_oid=v_original_authority.database_oid and backend_pid=v_original_authority.backend_pid\n              and transaction_id=v_original_authority.transaction_id) is distinct from pg_catalog.to_jsonb(v_original_authority) then\n          raise exception using errcode='55000',message='Original manager push retirement scope changed';\n        end if;\n        NEW.updated_at:=pg_catalog.now();\n        return NEW;\n      end;\n    end if;\n  end if;\n  -- Exact staged original push DATA only; never a live credential grant.\n  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'ops_manager_push_devices'\n    and TG_NAME = 'trg_ops_manager_push_devices_owner' and TG_NARGS = 0 then\n    if TG_RELID = pg_catalog.to_regclass('public.ops_manager_push_devices')\n      and current_user = session_user and current_user = 'supabase_admin'\n      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then\n      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then\n        return NEW;\n      end if;\n    end if;\n  end if;\n",
  "after_prosrc_sha256": "f059d042c3457b857072489cab53e758b1459d4719be0563db1389659f5868f6",
  "after_definition_sha256": "a94e65887e886b4b16163382e7f9cdfa5795a3aed6a2a35db371675a5d2d8cc6"
}
$original_manager_push_profile$::jsonb;
BEGIN
 -- Closed fixed Source literal, not a caller profile, selected ID or JSON grant.
 IF pg_catalog.jsonb_typeof(profile) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(profile))<>8
  OR NOT (profile ?& ARRAY['identity','registry_identity','before_definition','before_definition_sha256',
       'before_prosrc_sha256','restore_branch','after_prosrc_sha256','after_definition_sha256']::text[])
  OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(profile) e WHERE pg_catalog.jsonb_typeof(e.value)<>'string')
  OR profile->>'identity' IS DISTINCT FROM 'public.ops_manager_notification_validate_owner()'
  OR profile->>'registry_identity' IS DISTINCT FROM 'ops_manager_notification_validate_owner()'
  OR profile->>'before_definition_sha256' IS DISTINCT FROM 'c51dd11eb1a98774e84e7e22bebc807f2f31baae91e2803d68092349fe7a5212'
  OR profile->>'before_prosrc_sha256' IS DISTINCT FROM '88f82afd9a60e291ef2715b404303d715b5764fae0d7cc5d44e9aa6996072aab'
  OR pg_catalog.length(profile->>'restore_branch')=0
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Closed original manager push Source profile differs'; END IF;
 SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
 SELECT oid INTO postgres_oid FROM pg_catalog.pg_roles WHERE rolname='postgres';
 function_oid:=pg_catalog.to_regprocedure('public.ops_manager_notification_validate_owner()');
 helper_oid:=pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)');
 staged_helper_oid:=pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_staged(oid,json)');
 push_oid:=pg_catalog.to_regclass('public.ops_manager_push_devices');
 preferences_oid:=pg_catalog.to_regclass('public.ops_manager_notification_preferences');
 authority_helper_oid:=pg_catalog.to_regprocedure('custodial_dr.immutable_original_authority_guard_matches(oid,text)');
 authority_scope_oid:=pg_catalog.to_regclass('custodial_dr.immutable_original_authority_scopes');
 image_oid:=pg_catalog.to_regprocedure('pg_catalog.record_image_eq(record,record)');
 IF authority_helper_oid IS NULL OR authority_scope_oid IS NULL OR image_oid IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.oid=authority_scope_oid AND n.nspname='custodial_dr' AND c.relname='immutable_original_authority_scopes'
     AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
     AND c.relrowsecurity AND c.relforcerowsecurity
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
       WHERE a.grantee<>owner_oid))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f WHERE f.oid=authority_helper_oid
    AND f.proowner=owner_oid AND NOT f.prosecdef AND f.prokind='f'
    AND f.prorettype='pg_catalog.bool'::regtype AND NOT f.proretset AND f.pronargs=2
    AND f.proargtypes[0]='pg_catalog.oid'::regtype AND f.proargtypes[1]='pg_catalog.text'::regtype
    AND f.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND f.provolatile='v' AND f.proparallel='u'
    AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
    AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(f.prosrc,'UTF8'),'sha256'),'hex')
      ='72b2bb99197370c4c0587d759ccd6b3f6a47f9fed072a3e72d49aa2b58b5a3af'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
      WHERE a.grantee<>owner_oid OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
    WHERE f.oid=image_oid AND n.nspname='pg_catalog' AND f.proname='record_image_eq'
     AND f.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='internal') AND f.prosrc='record_image_eq'
     AND f.prokind='f' AND f.prorettype='pg_catalog.bool'::regtype AND f.pronargs=2
     AND f.proargtypes[0]='pg_catalog.record'::regtype AND f.proargtypes[1]='pg_catalog.record'::regtype
     AND NOT f.proretset AND NOT f.prosecdef AND f.provolatile='i' AND f.proparallel='s' AND f.proconfig IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original manager push retirement private Source unavailable'; END IF;
 LOCK TABLE custodial_dr.immutable_original_authority_scopes IN SHARE MODE;
 SELECT * INTO STRICT authority_helper FROM pg_catalog.pg_proc WHERE oid=authority_helper_oid;
 SELECT * INTO STRICT authority_scope FROM pg_catalog.pg_class WHERE oid=authority_scope_oid;

 IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
  OR pg_catalog.current_setting('session_replication_role')<>'origin'
  OR owner_oid IS NULL OR postgres_oid IS NULL OR function_oid IS NULL OR helper_oid IS NULL
  OR push_oid IS NULL OR preferences_oid IS NULL OR push_oid=preferences_oid
  OR (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.oid IN(push_oid,preferences_oid) AND n.nspname='public'
     AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid
    AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
    AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2
    AND p.proargtypes[0]='pg_catalog.oid'::regtype AND p.proargtypes[1]='pg_catalog.anyelement'::regtype
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND p.provolatile='v' AND p.proparallel='u'
    AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
      ='bab0bb8bce6dc748814e3cdff40df3a90d27adc5ee37f0350bd9486cab58dafa'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE a.grantee<>owner_oid OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  -- The typed wrapper delegates membership to the original private matcher.
  -- Keep an exact Source/owner/ACL check on that implementation too; merely
  -- pinning a wrapper's name or body cannot attest its current dependency.
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=staged_helper_oid
    AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
    AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2
    AND p.proargtypes[0]='pg_catalog.oid'::regtype AND p.proargtypes[1]='pg_catalog.json'::regtype
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND p.provolatile='v' AND p.proparallel='u' AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
    AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
      ='884485499c6f2c893407e809f5a32200c5b4abe48c8eca944130babdff9d5b15'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE a.grantee<>owner_oid OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original manager push owner/relation/private invoker matcher unavailable'; END IF;
 -- This validates the actual original database/session/namespace/relation
 -- owners, origin, absent leases and held exclusive global mutation fence.
 -- Function names or this profile's hashes alone never create that admission.
 PERFORM custodial_dr.immutable_import_owner_fence();
 LOCK TABLE public.ops_manager_notification_preferences,public.ops_manager_push_devices IN ACCESS EXCLUSIVE MODE;
 -- EXACT complete usage set, including any unexpected internal consumer.
 IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgfoid=function_oid)<>2
  OR (SELECT count(*) FROM pg_catalog.pg_trigger t
    JOIN (VALUES
      (preferences_oid,'trg_ops_manager_notification_preferences_owner'::name,
       'CREATE TRIGGER trg_ops_manager_notification_preferences_owner BEFORE INSERT OR UPDATE ON public.ops_manager_notification_preferences FOR EACH ROW EXECUTE FUNCTION public.ops_manager_notification_validate_owner()'::text),
      (push_oid,'trg_ops_manager_push_devices_owner'::name,
       'CREATE TRIGGER trg_ops_manager_push_devices_owner BEFORE INSERT OR UPDATE ON public.ops_manager_push_devices FOR EACH ROW EXECUTE FUNCTION public.ops_manager_notification_validate_owner()'::text)
    ) expected(relation_oid,trigger_name,definition)
     ON t.tgrelid=expected.relation_oid AND t.tgname=expected.trigger_name
    WHERE t.tgfoid=function_oid AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal
     AND t.tgqual IS NULL AND t.tgnargs=0 AND pg_catalog.octet_length(t.tgargs)=0
     AND t.tgattr::text='' AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
     AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
     AND pg_catalog.pg_get_triggerdef(t.oid,false) IS NOT DISTINCT FROM expected.definition)<>2
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original manager owner trigger consumers differ'; END IF;
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.oid)
  INTO original_triggers FROM pg_catalog.pg_trigger t WHERE t.tgfoid=function_oid;
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) ORDER BY c.oid)
  INTO original_relations FROM pg_catalog.pg_class c WHERE c.oid IN(push_oid,preferences_oid);
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
 SELECT * INTO STRICT helper FROM pg_catalog.pg_proc WHERE oid=helper_oid;
 SELECT * INTO STRICT staged_helper FROM pg_catalog.pg_proc WHERE oid=staged_helper_oid;
 before_definition:=pg_catalog.pg_get_functiondef(function_oid);
 helper_definition:=pg_catalog.pg_get_functiondef(helper_oid);
 staged_helper_definition:=pg_catalog.pg_get_functiondef(staged_helper_oid);
 IF original.proowner<>owner_oid OR original.prokind<>'f' OR original.pronargs<>0 OR original.proretset
  OR original.prorettype<>'pg_catalog.trigger'::regtype OR NOT original.prosecdef
  OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR original.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  OR before_definition IS DISTINCT FROM profile->>'before_definition'
  OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_definition,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM profile->>'before_definition_sha256'
  OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original.prosrc,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM profile->>'before_prosrc_sha256'
  OR (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,insertion_point,'')))
    <>pg_catalog.length(insertion_point)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original manager owner function predecessor differs'; END IF;
 -- Native captured ACL is owner + postgres EXECUTE without grant option.
 -- No role, default policy, grant or original ACL entry is changed.
 IF (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(original.proacl,pg_catalog.acldefault('f',owner_oid))))<>2
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(original.proacl,pg_catalog.acldefault('f',owner_oid))) a
    WHERE a.grantee NOT IN(owner_oid,postgres_oid) OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(original.proacl) a WHERE a.grantee=owner_oid)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(original.proacl) a WHERE a.grantee=postgres_oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original manager owner function ACL differs'; END IF;
 after_body:=pg_catalog.replace(original.prosrc,insertion_point,insertion_point||(profile->>'restore_branch'));
 after_definition:=pg_catalog.replace(before_definition,insertion_point,insertion_point||(profile->>'restore_branch'));
 IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM profile->>'after_prosrc_sha256'
  OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM profile->>'after_definition_sha256'
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Source-derived original manager push transformation differs'; END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
 SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=function_oid;
 IF (SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=authority_helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(authority_helper)
  OR (SELECT pg_catalog.to_jsonb(c) FROM pg_catalog.pg_class c WHERE c.oid=authority_scope_oid) IS DISTINCT FROM pg_catalog.to_jsonb(authority_scope)
  OR pg_catalog.to_jsonb(observed) IS DISTINCT FROM pg_catalog.to_jsonb(original)
  OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM before_definition
  OR (SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(helper)
  OR pg_catalog.pg_get_functiondef(helper_oid) IS DISTINCT FROM helper_definition
  OR (SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=staged_helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(staged_helper)
  OR pg_catalog.pg_get_functiondef(staged_helper_oid) IS DISTINCT FROM staged_helper_definition
  OR (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=function_oid)
    IS DISTINCT FROM original_triggers
  OR (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) ORDER BY c.oid) FROM pg_catalog.pg_class c WHERE c.oid IN(push_oid,preferences_oid))
    IS DISTINCT FROM original_relations
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original manager push Source changed before replacement'; END IF;
 -- ONE exact original function replacement; all metadata except prosrc survives.
 EXECUTE after_definition;
 SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=function_oid;
 IF (SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=authority_helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(authority_helper)
  OR (SELECT pg_catalog.to_jsonb(c) FROM pg_catalog.pg_class c WHERE c.oid=authority_scope_oid) IS DISTINCT FROM pg_catalog.to_jsonb(authority_scope)
  OR observed.prosrc IS DISTINCT FROM after_body
  OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM after_definition
  OR pg_catalog.to_jsonb(observed)-'prosrc' IS DISTINCT FROM pg_catalog.to_jsonb(original)-'prosrc'
  OR (SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(helper)
  OR pg_catalog.pg_get_functiondef(helper_oid) IS DISTINCT FROM helper_definition
  OR (SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=staged_helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(staged_helper)
  OR pg_catalog.pg_get_functiondef(staged_helper_oid) IS DISTINCT FROM staged_helper_definition
  OR (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=function_oid)
    IS DISTINCT FROM original_triggers
  OR (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) ORDER BY c.oid) FROM pg_catalog.pg_class c WHERE c.oid IN(push_oid,preferences_oid))
    IS DISTINCT FROM original_relations
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Manager push restore changed metadata outside the closed branch'; END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END;
$immutable_original_manager_push_restore$;
COMMIT;
