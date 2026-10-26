-- UNACTIVATED Source proposal. Main owns the existing caller transaction.
-- DO-only: no outer BEGIN/COMMIT and no caller transaction/setting acquisition.
-- Original archive c2ca572a9b54f9e3f02f3136fbe42a590857778f310edd32e54315edd3554ef0.
-- source-catalog.json 0bd433901d199bd273b8442fd0b295c619cc4fe912e3d5ea7c17ab21a6c30e2d.
-- Native pg_dump/ACL owner is supabase_admin, not the curated migration_owner label.
-- Install AFTER the existing six-function authority scope and target-shape Source.
-- Main must explicitly name this exact AFTER ROW consumer in its private gate
-- contract comment; that gate's code/ACL/Source/fence semantics are NOT changed.
-- Only derived employee push work is suppressed for the actual effect-1 row.
-- Normal body and all three derived table originals remain untouched here.
DO $immutable_original_employee_push_authority_restore$
DECLARE
 owner_oid oid; postgres_oid oid; function_oid oid; helper_oid oid; image_oid oid;
 relation_oid oid; scope_oid oid;
 original pg_catalog.pg_proc; observed pg_catalog.pg_proc;
 helper pg_catalog.pg_proc; image_function pg_catalog.pg_proc;
 before_definition text; after_definition text; after_body text; helper_definition text;
 original_trigger jsonb; original_relation jsonb; original_scope jsonb;
 insertion_point constant text:=E'\nbegin\n';
 profile constant jsonb:=$original_employee_push_authority_profile$
{
  "identity": "public.mz_reconcile_employee_push_credential_state()",
  "registry_identity": "mz_reconcile_employee_push_credential_state()",
  "before_definition": "CREATE OR REPLACE FUNCTION public.mz_reconcile_employee_push_credential_state()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare\n  v_reason text;\nbegin\n  if new.revoked_at is null and new.expires_at>clock_timestamp() then\n    return new;\n  end if;\n  v_reason:=case when new.revoked_at is not null then 'device_credential_revoked' else 'device_credential_expired' end;\n  update public.employee_push_registrations\n     set active=false,revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_reason=v_reason,updated_at=clock_timestamp()\n   where credential_id=new.credential_id and (active=true or revoked_at is null);\n  update public.event_push_instances\n     set state='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()),last_error=v_reason,updated_at=clock_timestamp()\n   where credential_id=new.credential_id and state in ('pending','leased');\n  update public.operational_notification_jobs\n     set status='dead',completed_at=coalesce(completed_at,clock_timestamp()),last_error=v_reason,updated_at=clock_timestamp()\n   where job_type in ('employee_event_push','employee_native_push')\n     and status in ('pending','leased')\n     and payload_json->>'credential_id'=new.credential_id::text\n     and (status='pending' or leased_until<clock_timestamp());\n  return new;\nend\n$function$\n",
  "before_definition_sha256": "f7b9cde8f63ef75c44cccf284795d7e9bafd6137b2bc9aee10de0533b7f0149d",
  "before_prosrc_sha256": "e147975610b07876bd3571b3cbcd1e3b3f68d7d87f28b54a6935b6964e1c9442",
  "restore_branch": "  -- Only the reviewed direct effect-1 AFTER ROW caller may suppress derived work.\n  if TG_OP = 'UPDATE' and TG_LEVEL = 'ROW' and TG_WHEN = 'AFTER'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'device_auth_credentials'\n    and TG_NAME = 'trg_mz_reconcile_employee_push_credential_state' and TG_NARGS = 0\n    and TG_RELID = pg_catalog.to_regclass('public.device_auth_credentials')\n    and pg_catalog.pg_trigger_depth() = 1\n    and current_user = session_user and current_user = 'supabase_admin' then\n    if custodial_dr.immutable_original_authority_guard_matches(TG_RELID,TG_OP) is true then\n      declare v_original_authority custodial_dr.immutable_original_authority_scopes;\n        v_original_unrevoked public.device_auth_credentials;\n      begin\n        select * into strict v_original_authority from custodial_dr.immutable_original_authority_scopes\n          where database_oid=(select oid from pg_catalog.pg_database where datname=current_database())\n            and backend_pid=pg_catalog.pg_backend_pid() and transaction_id=pg_catalog.txid_current();\n        v_original_unrevoked:=NEW;\n        v_original_unrevoked.revoked_at:=OLD.revoked_at;\n        v_original_unrevoked.revoked_reason:=OLD.revoked_reason;\n        if v_original_authority.phase is distinct from 'RUNNING'\n          or v_original_authority.completed_step is distinct from 0\n          or v_original_authority.active_table_oid is distinct from TG_RELID\n          or v_original_authority.owner_oid is distinct from (select oid from pg_catalog.pg_roles where rolname=session_user)\n          or v_original_authority.result is not null or v_original_authority.counts is distinct from '{}'::jsonb\n          or OLD.revoked_at is not null or NEW.revoked_at is null\n          or NEW.revoked_reason is distinct from ('disaster_restore_generation_'||v_original_authority.authority_generation::text)\n          or pg_catalog.record_image_eq(v_original_unrevoked,OLD) is not true then\n          raise exception using errcode='55000',message='Original employee push authority row differs';\n        end if;\n        if custodial_dr.immutable_original_authority_guard_matches(TG_RELID,TG_OP) is not true\n          or (select pg_catalog.to_jsonb(s) from custodial_dr.immutable_original_authority_scopes s\n            where database_oid=v_original_authority.database_oid and backend_pid=v_original_authority.backend_pid\n              and transaction_id=v_original_authority.transaction_id) is distinct from pg_catalog.to_jsonb(v_original_authority) then\n          raise exception using errcode='55000',message='Original employee push authority scope changed';\n        end if;\n        return NEW;\n      end;\n    end if;\n  end if;\n",
  "after_prosrc_sha256": "8a5bd03b5638ecefcd058bae098d97edf99ce3b55c90458c546c5df28a879e5d",
  "after_definition_sha256": "556aee5def43d88feadd4df2e7c14d9dc6a4a3c3756068f5a2fb34df70a1a6c6"
}
$original_employee_push_authority_profile$::jsonb;
BEGIN
 IF pg_catalog.jsonb_typeof(profile) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(profile))<>8
  OR NOT (profile ?& ARRAY['identity','registry_identity','before_definition','before_definition_sha256',
       'before_prosrc_sha256','restore_branch','after_prosrc_sha256','after_definition_sha256']::text[])
  OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(profile) e WHERE pg_catalog.jsonb_typeof(e.value)<>'string')
  OR profile->>'identity' IS DISTINCT FROM 'public.mz_reconcile_employee_push_credential_state()'
  OR profile->>'registry_identity' IS DISTINCT FROM 'mz_reconcile_employee_push_credential_state()'
  OR profile->>'before_definition_sha256' IS DISTINCT FROM 'f7b9cde8f63ef75c44cccf284795d7e9bafd6137b2bc9aee10de0533b7f0149d'
  OR profile->>'before_prosrc_sha256' IS DISTINCT FROM 'e147975610b07876bd3571b3cbcd1e3b3f68d7d87f28b54a6935b6964e1c9442'
  OR pg_catalog.length(profile->>'restore_branch')=0
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Closed employee push authority Source profile differs'; END IF;
 SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
 SELECT oid INTO postgres_oid FROM pg_catalog.pg_roles WHERE rolname='postgres';
 function_oid:=pg_catalog.to_regprocedure('public.mz_reconcile_employee_push_credential_state()');
 helper_oid:=pg_catalog.to_regprocedure('custodial_dr.immutable_original_authority_guard_matches(oid,text)');
 image_oid:=pg_catalog.to_regprocedure('pg_catalog.record_image_eq(record,record)');
 relation_oid:=pg_catalog.to_regclass('public.device_auth_credentials');
 scope_oid:=pg_catalog.to_regclass('custodial_dr.immutable_original_authority_scopes');
 IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
  OR pg_catalog.current_setting('session_replication_role')<>'origin'
  OR owner_oid IS NULL OR postgres_oid IS NULL OR function_oid IS NULL OR helper_oid IS NULL
  OR image_oid IS NULL OR relation_oid IS NULL OR scope_oid IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.oid=relation_oid AND n.nspname='public' AND c.relname='device_auth_credentials'
     AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.oid=scope_oid AND n.nspname='custodial_dr' AND c.relname='immutable_original_authority_scopes'
     AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
     AND c.relrowsecurity AND c.relforcerowsecurity
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
       WHERE a.grantee<>owner_oid))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f WHERE f.oid=helper_oid
    AND f.proowner=owner_oid AND NOT f.prosecdef AND f.prokind='f'
    AND f.prorettype='pg_catalog.bool'::regtype AND NOT f.proretset AND f.pronargs=2
    AND f.proargtypes[0]='pg_catalog.oid'::regtype AND f.proargtypes[1]='pg_catalog.text'::regtype
    AND f.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND f.provolatile='v' AND f.proparallel='u'
    AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
    AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(f.prosrc,'UTF8'),'sha256'),'hex')='72b2bb99197370c4c0587d759ccd6b3f6a47f9fed072a3e72d49aa2b58b5a3af'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
      WHERE a.grantee<>owner_oid OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  -- The binary-record comparison is the actual builtin internal routine:
  -- no custom type equality/output callback or JSON null/lexical coercion.
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
    WHERE f.oid=image_oid AND n.nspname='pg_catalog' AND f.proname='record_image_eq'
     AND f.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='internal') AND f.prosrc='record_image_eq'
     AND f.prokind='f' AND f.prorettype='pg_catalog.bool'::regtype AND f.pronargs=2
     AND f.proargtypes[0]='pg_catalog.record'::regtype AND f.proargtypes[1]='pg_catalog.record'::regtype
     AND NOT f.proretset AND NOT f.prosecdef AND f.provolatile='i' AND f.proparallel='s' AND f.proconfig IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original employee push authority owner or private Source unavailable'; END IF;
 -- Actual database/principal/namespace/origin/lease/global-fence proof;
 -- no active scope is fabricated, observed as authority or reopened here.
 PERFORM custodial_dr.immutable_import_owner_fence();
 LOCK TABLE public.device_auth_credentials IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE custodial_dr.immutable_original_authority_scopes IN SHARE MODE;
 IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgfoid=function_oid)<>1
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=relation_oid AND t.tgfoid=function_oid
    AND t.tgname='trg_mz_reconcile_employee_push_credential_state' AND t.tgtype=17 AND t.tgenabled='O' AND NOT t.tgisinternal
    AND t.tgqual IS NOT NULL AND t.tgnargs=0 AND pg_catalog.octet_length(t.tgargs)=0
    AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
    AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY pos.ordinality)
      FROM pg_catalog.unnest(t.tgattr::smallint[]) WITH ORDINALITY pos(attnum,ordinality)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=pos.attnum AND NOT a.attisdropped)
       =ARRAY['revoked_at','expires_at']::text[]
    AND pg_catalog.pg_get_triggerdef(t.oid,false) IS NOT DISTINCT FROM 'CREATE TRIGGER trg_mz_reconcile_employee_push_credential_state AFTER UPDATE OF revoked_at, expires_at ON public.device_auth_credentials FOR EACH ROW WHEN (((old.revoked_at IS DISTINCT FROM new.revoked_at) OR (old.expires_at IS DISTINCT FROM new.expires_at))) EXECUTE FUNCTION public.mz_reconcile_employee_push_credential_state()')
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original employee push credential trigger differs'; END IF;
 SELECT pg_catalog.to_jsonb(t) INTO STRICT original_trigger FROM pg_catalog.pg_trigger t WHERE t.tgfoid=function_oid;
 SELECT pg_catalog.to_jsonb(c) INTO STRICT original_relation FROM pg_catalog.pg_class c WHERE c.oid=relation_oid;
 SELECT pg_catalog.to_jsonb(c) INTO STRICT original_scope FROM pg_catalog.pg_class c WHERE c.oid=scope_oid;
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
 SELECT * INTO STRICT helper FROM pg_catalog.pg_proc WHERE oid=helper_oid;
 SELECT * INTO STRICT image_function FROM pg_catalog.pg_proc WHERE oid=image_oid;
 before_definition:=pg_catalog.pg_get_functiondef(function_oid);
 helper_definition:=pg_catalog.pg_get_functiondef(helper_oid);
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
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original employee push credential function predecessor differs'; END IF;
 IF (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(original.proacl,pg_catalog.acldefault('f',owner_oid))))<>2
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(original.proacl,pg_catalog.acldefault('f',owner_oid))) a
    WHERE a.grantee NOT IN(owner_oid,postgres_oid) OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(original.proacl) a WHERE a.grantee=owner_oid)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(original.proacl) a WHERE a.grantee=postgres_oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original employee push credential function ACL differs'; END IF;
 after_body:=pg_catalog.replace(original.prosrc,insertion_point,insertion_point||(profile->>'restore_branch'));
 after_definition:=pg_catalog.replace(before_definition,insertion_point,insertion_point||(profile->>'restore_branch'));
 IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM profile->>'after_prosrc_sha256'
  OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM profile->>'after_definition_sha256'
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Source-derived employee push authority transformation differs'; END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
 SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=function_oid;
 IF pg_catalog.to_jsonb(observed) IS DISTINCT FROM pg_catalog.to_jsonb(original)
  OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM before_definition
  OR (SELECT pg_catalog.to_jsonb(f) FROM pg_catalog.pg_proc f WHERE f.oid=helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(helper)
  OR pg_catalog.pg_get_functiondef(helper_oid) IS DISTINCT FROM helper_definition
  OR (SELECT pg_catalog.to_jsonb(f) FROM pg_catalog.pg_proc f WHERE f.oid=image_oid) IS DISTINCT FROM pg_catalog.to_jsonb(image_function)
  OR (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=function_oid)
    IS DISTINCT FROM pg_catalog.jsonb_build_array(original_trigger)
  OR (SELECT pg_catalog.to_jsonb(c) FROM pg_catalog.pg_class c WHERE c.oid=relation_oid) IS DISTINCT FROM original_relation
  OR (SELECT pg_catalog.to_jsonb(c) FROM pg_catalog.pg_class c WHERE c.oid=scope_oid) IS DISTINCT FROM original_scope
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original employee push authority Source changed before replacement'; END IF;
 EXECUTE after_definition;
 SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=function_oid;
 IF observed.prosrc IS DISTINCT FROM after_body
  OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM after_definition
  OR pg_catalog.to_jsonb(observed)-'prosrc' IS DISTINCT FROM pg_catalog.to_jsonb(original)-'prosrc'
  OR (SELECT pg_catalog.to_jsonb(f) FROM pg_catalog.pg_proc f WHERE f.oid=helper_oid) IS DISTINCT FROM pg_catalog.to_jsonb(helper)
  OR pg_catalog.pg_get_functiondef(helper_oid) IS DISTINCT FROM helper_definition
  OR (SELECT pg_catalog.to_jsonb(f) FROM pg_catalog.pg_proc f WHERE f.oid=image_oid) IS DISTINCT FROM pg_catalog.to_jsonb(image_function)
  OR (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=function_oid)
    IS DISTINCT FROM pg_catalog.jsonb_build_array(original_trigger)
  OR (SELECT pg_catalog.to_jsonb(c) FROM pg_catalog.pg_class c WHERE c.oid=relation_oid) IS DISTINCT FROM original_relation
  OR (SELECT pg_catalog.to_jsonb(c) FROM pg_catalog.pg_class c WHERE c.oid=scope_oid) IS DISTINCT FROM original_scope
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Employee push authority restore changed metadata outside closed branch'; END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END;
$immutable_original_employee_push_authority_restore$;
