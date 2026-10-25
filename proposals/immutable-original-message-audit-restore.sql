-- UNACTIVATED isolated Source proposal; no migration or restore admission.
-- Backend baseline a3093deae58776f647da6a3911f1f136f75b9825.
-- Authenticated v12 original application-schema.sql SHA256:
-- 4b9e6eca6030427446f988358e0efdb69d934e9d56fff07a50a1e50db7cef20f
-- Authenticated v12 original recovery registry member SHA256:
-- 3e2be3852d2b3f31a283cc5f82af7747c06da92dd8c347cdf6d2dc0a214d56c6
-- The original function/grant registry identity is UNQUALIFIED and retained.
-- Compose only inside Main's same original owner/transaction/exclusive fences.
-- Main separately pins the sealed internal staged-original invoker matcher;
-- its mere presence or a function name/hash never authenticates original DATA.
-- Only exact staged-original audit INSERT may take the new BEFORE-row branch.
-- The entire normal body, including UPDATE/DELETE history refusal, is verbatim.
-- No transaction control, registry writes, grants, role/owner/trigger changes,
-- automatic activation, message delivery, new audit or caller-selected scope.
DO $immutable_original_message_audit_restore$
DECLARE
  owner_oid oid;
  relation_oid oid;
  helper_oid oid;
  function_oid oid;
  trigger_oid oid;
  profile jsonb;
  original pg_catalog.pg_proc%rowtype;
  after_row pg_catalog.pg_proc%rowtype;
  original_trigger pg_catalog.pg_trigger%rowtype;
  after_trigger pg_catalog.pg_trigger%rowtype;
  before_definition text;
  before_grants text;
  after_definition text;
  after_body text;
  checked jsonb := '[]'::jsonb;
  insertion_point constant text := E'\nbegin\n';
  restore_branch constant text := $original_message_audit_branch$  -- Exact immutable original audit DATA only; never a fresh message/history mutation.
  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'
    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_message_audit' then
    if TG_RELID = pg_catalog.to_regclass('public.msg_message_audit')
      and current_user = session_user and current_user = 'supabase_admin'
      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then
      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then
        return NEW;
      end if;
    end if;
  end if;
$original_message_audit_branch$;
  profiles constant jsonb := $original_message_audit_profiles$
[
  {
    "identity": "msg_reject_retired_ops_manager_shared_message_audit_mutation()",
    "lookup_identity": "public.msg_reject_retired_ops_manager_shared_message_audit_mutation()",
    "table_name": "msg_message_audit",
    "trigger_name": "trg_msg_reject_retired_ops_manager_shared_audit_guard",
    "trigger_type": 31,
    "trigger_columns": "",
    "owner": "supabase_admin",
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_reject_retired_ops_manager_shared_message_audit_mutation()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if tg_op = 'INSERT'\n     and (\n       exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1')\n     ) then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership message audit is immutable';\n  end if;\n\n  if tg_op = 'UPDATE'\n     and (\n       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1')\n       or exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1')\n     ) then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership message audit is immutable';\n  end if;\n\n  if tg_op = 'DELETE'\n     and (\n       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1')\n     ) then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership message audit cannot be deleted';\n  end if;\n\n  return case when tg_op = 'DELETE' then old else new end;\nend\n$function$\n",
    "before_definition_sha256": "6c3717ebd362bd4bf9abfc00a3ece56963f21542f6f808780fcf6d5b6bcf3bb7",
    "before_prosrc_sha256": "95aa90a35c5cb961be7e8a7fcad9f137e1c68eb7e842da0da31d98dc89bcadb8",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_reject_retired_ops_manager_shared_message_audit_mutation()'); grant execute on function msg_reject_retired_ops_manager_shared_message_audit_mutation() to postgres;",
    "before_grant_sha256": "5f6ae03b849db6aded7224fa06f6fd92e97435a338c06938bf13caac24cd0959",
    "before_trigger_definition": "drop trigger if exists trg_msg_reject_retired_ops_manager_shared_audit_guard on public.msg_message_audit; CREATE TRIGGER trg_msg_reject_retired_ops_manager_shared_audit_guard BEFORE INSERT OR DELETE OR UPDATE ON msg_message_audit FOR EACH ROW EXECUTE FUNCTION msg_reject_retired_ops_manager_shared_message_audit_mutation(); alter table public.msg_message_audit enable trigger trg_msg_reject_retired_ops_manager_shared_audit_guard;",
    "before_trigger_sha256": "383ccb3e645a13ae0d697bbf836cce757c0484be0c3ca8799f543d621aa33b75",
    "after_prosrc_sha256": "9bcc5eae944c8db1d1b586b705a832bc99ba0167fe33b042df509d24c6809a83",
    "after_definition_sha256": "1dd682ce84ef7572ed78f6ec355d7f06036ef2ebc4195e69125b1f980222e692"
  }
]
$original_message_audit_profiles$::jsonb;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
  relation_oid := pg_catalog.to_regclass('public.msg_message_audit');
  helper_oid := pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)');
  IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
    OR owner_oid IS NULL OR relation_oid IS NULL OR helper_oid IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid=relation_oid AND n.nspname='public' AND c.relname='msg_message_audit'
        AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid
      AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
      AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2
      AND p.proargtypes[0]='pg_catalog.oid'::regtype AND p.proargtypes[1]='pg_catalog.anyelement'::regtype
      AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original message-audit restore owner/relation/internal matcher unavailable'; END IF;
  PERFORM custodial_dr.immutable_import_owner_fence();
  LOCK TABLE public.msg_message_audit IN ACCESS EXCLUSIVE MODE;
  IF pg_catalog.jsonb_array_length(profiles)<>1 THEN RAISE EXCEPTION 'Closed one-function original-audit profile required'; END IF;
  -- Check the single exact original definition, ACL and trigger binding before
  -- replacement; all original pg_proc attributes except prosrc survive.
  FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(profiles) LOOP
    function_oid := pg_catalog.to_regprocedure(profile->>'lookup_identity');
    SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
    SELECT * INTO STRICT original_trigger FROM pg_catalog.pg_trigger
      WHERE tgrelid=relation_oid AND tgfoid=function_oid AND tgname=profile->>'trigger_name';
    before_definition := pg_catalog.pg_get_functiondef(function_oid);
    before_grants := public.custodial_release_authority_current_grant_definition(profile->>'identity');
    IF original.proowner<>owner_oid OR original.prokind<>'f' OR original.pronargs<>0
      OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset OR original.prosecdef
      OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      OR before_definition IS DISTINCT FROM profile->>'before_definition'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_definition_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original.prosrc,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_prosrc_sha256'
      OR before_grants IS DISTINCT FROM profile->>'before_grant_definition'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_grants,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_grant_sha256'
      OR original_trigger.tgtype<>(profile->>'trigger_type')::integer
      OR original_trigger.tgattr::text IS DISTINCT FROM profile->>'trigger_columns'
      OR original_trigger.tgenabled<>'O' OR original_trigger.tgisinternal
      OR original_trigger.tgnargs<>0 OR pg_catalog.octet_length(original_trigger.tgargs)<>0
      OR original_trigger.tgconstraint<>0 OR original_trigger.tgdeferrable OR original_trigger.tginitdeferred
      OR original_trigger.tgqual IS NOT NULL OR original_trigger.tgoldtable IS NOT NULL OR original_trigger.tgnewtable IS NOT NULL
      OR (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,insertion_point,'')))
        <>pg_catalog.length(insertion_point)
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original message-audit function/owner/ACL/trigger predecessor differs'; END IF;
    after_body := pg_catalog.replace(original.prosrc,insertion_point,insertion_point||restore_branch);
    after_definition := pg_catalog.replace(before_definition,insertion_point,insertion_point||restore_branch);
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_prosrc_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_definition_sha256'
    THEN RAISE EXCEPTION 'Source-derived original message-audit transformation differs'; END IF;
    checked := checked || pg_catalog.jsonb_build_array(profile || pg_catalog.jsonb_build_object(
      'oid',function_oid,'metadata',pg_catalog.to_jsonb(original)-'prosrc',
      'trigger_oid',original_trigger.oid,'trigger_metadata',pg_catalog.to_jsonb(original_trigger),
      'after_definition',after_definition,'after_body',after_body));
  END LOOP;
  FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(checked) LOOP
    function_oid := (profile->>'oid')::oid;
    trigger_oid := (profile->>'trigger_oid')::oid;
    SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
    SELECT * INTO STRICT original_trigger FROM pg_catalog.pg_trigger WHERE oid=trigger_oid;
    IF pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM profile->>'before_definition'
      OR pg_catalog.to_jsonb(original)-'prosrc' IS DISTINCT FROM profile->'metadata'
      OR pg_catalog.to_jsonb(original_trigger) IS DISTINCT FROM profile->'trigger_metadata'
      OR public.custodial_release_authority_current_grant_definition(profile->>'identity')
        IS DISTINCT FROM profile->>'before_grant_definition'
    THEN RAISE EXCEPTION 'Original message-audit guard changed before replacement'; END IF;
    PERFORM custodial_dr.immutable_import_owner_fence();
    EXECUTE profile->>'after_definition';
    SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=function_oid;
    SELECT * INTO STRICT after_trigger FROM pg_catalog.pg_trigger WHERE oid=trigger_oid;
    IF after_row.prosrc IS DISTINCT FROM profile->>'after_body'
      OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM profile->>'after_definition'
      OR pg_catalog.to_jsonb(after_row)-'prosrc' IS DISTINCT FROM profile->'metadata'
      OR pg_catalog.to_jsonb(after_trigger) IS DISTINCT FROM profile->'trigger_metadata'
      OR public.custodial_release_authority_current_grant_definition(profile->>'identity')
        IS DISTINCT FROM profile->>'before_grant_definition'
    THEN RAISE EXCEPTION 'Original message-audit restore changed metadata outside the closed branch'; END IF;
  END LOOP;
  PERFORM custodial_dr.immutable_import_owner_fence();
END;
$immutable_original_message_audit_restore$;
