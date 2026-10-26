-- UNACTIVATED isolated Source proposal, not a migration or restore admission.
-- Backend source baseline 9b275574c8347d72eff71eeb48cca7c6b33b764d.
-- Authenticated-original pg_dump SHA256:
-- a55d04c7c5ef24e5824bc1ac806990e59db23ec900841b5d66df93df523a44dc
-- Authenticated-original registry member SHA256:
-- 5f1c651ea94ba9d938e07894e1c0fe375286cb139bfe744b4d571370d8de7f12
-- Both original registry function/grant identities are UNQUALIFIED; retain them.
-- No outer transaction: Main retains its original owner, connection, transaction,
-- exclusive admission/mutation fence, current control and staged-original scope.
-- The internal invoker matcher's accepted Source must be independently pinned
-- by Main. Its presence/owner alone is not Source authentication or admission.
-- No registry writes, grants, owner/role changes, trigger switches, DATA writers,
-- AFTER-message side effects, begin-profile edits or automatic activation.
DO $immutable_original_message_guards_restore$
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
  restore_branch constant text := $original_message_guard_branch$  -- Exact immutable original message DATA only; never a fresh command or actor permission.
  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'
    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_messages' then
    if TG_RELID = pg_catalog.to_regclass('public.msg_messages')
      and current_user = session_user and current_user = 'supabase_admin'
      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then
      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then
        return NEW;
      end if;
    end if;
  end if;
$original_message_guard_branch$;
  profiles constant jsonb := $original_message_guard_profiles$
[
  {
    "identity": "msg_reject_retired_ops_manager_shared_message_mutation()",
    "lookup_identity": "public.msg_reject_retired_ops_manager_shared_message_mutation()",
    "table_name": "msg_messages",
    "trigger_name": "trg_msg_reject_retired_ops_manager_shared_message_mutation",
    "trigger_type": 31,
    "trigger_columns": "",
    "owner": "supabase_admin",
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_reject_retired_ops_manager_shared_message_mutation()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if tg_op = 'INSERT'\n     and exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then\n    raise exception using\n      errcode = '23514',\n      message = 'No message may be created in the retired Operations Leadership conversation';\n  end if;\n\n  if tg_op = 'UPDATE'\n     and (\n       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n       or exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n     ) then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership message history is immutable';\n  end if;\n\n  if tg_op = 'DELETE'\n     and exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership message history cannot be deleted';\n  end if;\n\n  return case when tg_op = 'DELETE' then old else new end;\nend\n$function$\n",
    "before_definition_sha256": "0a384dd2309246645e4f018c1e552a0d425dd06aa063f7f752ebf3c2151f5b05",
    "before_prosrc_sha256": "1bb48211c3d0d441f06d80c05107cb1290f2695fcfdc63502d63bc227cb1148b",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_reject_retired_ops_manager_shared_message_mutation()'); grant execute on function msg_reject_retired_ops_manager_shared_message_mutation() to postgres;",
    "before_grant_sha256": "65255edc26ab7fa941176252d1141f9bed680745870f01836f14639f9a3e3fe6",
    "before_trigger_definition": "drop trigger if exists trg_msg_reject_retired_ops_manager_shared_message_mutation on public.msg_messages; CREATE TRIGGER trg_msg_reject_retired_ops_manager_shared_message_mutation BEFORE INSERT OR DELETE OR UPDATE ON msg_messages FOR EACH ROW EXECUTE FUNCTION msg_reject_retired_ops_manager_shared_message_mutation(); alter table public.msg_messages enable trigger trg_msg_reject_retired_ops_manager_shared_message_mutation;",
    "before_trigger_sha256": "0f4f8ca9f9d106b91fe860787d7ccce605f1c5ea091e83de593f5be2c30284cc",
    "after_prosrc_sha256": "9d0b3ed4a7649102ee475fdae0adcc2824b12893bc36692dfba5f08ec0609025",
    "after_definition_sha256": "5bf8519f4297836c0b2f99db47fb8b3e60dbf294786a747413631cfffe8175d6"
  },
  {
    "identity": "mz_reject_event_messenger_message()",
    "lookup_identity": "public.mz_reject_event_messenger_message()",
    "table_name": "msg_messages",
    "trigger_name": "trg_mz_reject_event_messenger_message",
    "trigger_type": 7,
    "trigger_columns": "",
    "owner": "supabase_admin",
    "before_definition": "CREATE OR REPLACE FUNCTION public.mz_reject_event_messenger_message()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if lower(coalesce(new.metadata_json->>'source',''))='events_app' then\n    raise exception using\n      errcode='23514',\n      message='Event notifications are native-only and cannot create Messenger messages';\n  end if;\n  return new;\nend\n$function$\n",
    "before_definition_sha256": "aae564d70c24ed682c607b183d5e3a44f53af2ae887c498acb7fe67415e13c47",
    "before_prosrc_sha256": "2cf0394200969e377fd6e9d199a1e95a538288662509f39a1e626568bd7f41d2",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('mz_reject_event_messenger_message()'); grant execute on function mz_reject_event_messenger_message() to postgres;",
    "before_grant_sha256": "44a644ab6f1681e761784ffcc67d928fc2edb01770e076705b4f5476b1d929c9",
    "before_trigger_definition": "drop trigger if exists trg_mz_reject_event_messenger_message on public.msg_messages; CREATE TRIGGER trg_mz_reject_event_messenger_message BEFORE INSERT ON msg_messages FOR EACH ROW EXECUTE FUNCTION mz_reject_event_messenger_message(); alter table public.msg_messages enable trigger trg_mz_reject_event_messenger_message;",
    "before_trigger_sha256": "85517dbeb751cd2f0349623a28d633fc5b92a9168deea655350f17477df4443a",
    "after_prosrc_sha256": "072e7611fca8744f311a42be6a1c90a0ef49986806e1e877e6a0762d0faef5d5",
    "after_definition_sha256": "ac2257d8e9062cbbf83df46a5cc865fd3cd3d55765c8d3c6e2a201af550e0a07"
  }
]
$original_message_guard_profiles$::jsonb;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
  relation_oid := pg_catalog.to_regclass('public.msg_messages');
  helper_oid := pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)');
  IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
    OR owner_oid IS NULL OR relation_oid IS NULL OR helper_oid IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid=relation_oid AND n.nspname='public' AND c.relname='msg_messages'
        AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid
      AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
      AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2
      AND p.proargtypes[0]='pg_catalog.oid'::regtype AND p.proargtypes[1]='pg_catalog.anyelement'::regtype
      AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original message-guard restore owner/relation/internal matcher unavailable'; END IF;
  PERFORM custodial_dr.immutable_import_owner_fence();
  LOCK TABLE public.msg_messages IN ACCESS EXCLUSIVE MODE;
  IF pg_catalog.jsonb_array_length(profiles)<>2 THEN RAISE EXCEPTION 'Closed two-function original-message profile required'; END IF;
  -- Check BOTH exact original definitions, ACLs and trigger bindings before
  -- replacing either; all original pg_proc attributes except prosrc survive.
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
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original message function/owner/ACL/trigger predecessor differs'; END IF;
    after_body := pg_catalog.replace(original.prosrc,insertion_point,insertion_point||restore_branch);
    after_definition := pg_catalog.replace(before_definition,insertion_point,insertion_point||restore_branch);
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_prosrc_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_definition_sha256'
    THEN RAISE EXCEPTION 'Source-derived original message transformation differs'; END IF;
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
    THEN RAISE EXCEPTION 'Original message guard changed before replacement'; END IF;
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
    THEN RAISE EXCEPTION 'Original message restore changed metadata outside the closed branch'; END IF;
  END LOOP;
END;
$immutable_original_message_guards_restore$;
