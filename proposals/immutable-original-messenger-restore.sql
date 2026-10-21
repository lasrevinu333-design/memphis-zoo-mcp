-- UNACTIVATED isolated prototype; not a migration, registry recipe or admission.
-- Frozen backend 24994e3f3608280b29f6b9f254ee3d016974a63c.
-- Authenticated original pg_dump SHA256:
-- a55d04c7c5ef24e5824bc1ac806990e59db23ec900841b5d66df93df523a44dc
-- Authenticated original recovery registry member SHA256:
-- 5f1c651ea94ba9d938e07894e1c0fe375286cb139bfe744b4d571370d8de7f12
-- No BEGIN/COMMIT: retain Main's SAME original owner, transaction and fence.
-- No registry writes, grants, owner changes, trigger switches or begin profile.
-- Exact historical row restoration is NOT new message/recipient permission.
-- Main must independently pin the invoker matcher's accepted Source (including
-- any separately qualified staged-set support); its name/owner alone is NOT
-- proof of that implementation. This proposal never replaces the helper.
-- Four original registry identities below are deliberately UNQUALIFIED. Keep
-- them for the original grant recipe; lookup_identity is the fixed public OID.
DO $immutable_messenger_restore$
DECLARE
  owner_oid oid;
  helper_oid oid;
  function_oid oid;
  relation_oid oid;
  profile jsonb;
  checked jsonb := '[]'::jsonb;
  original pg_catalog.pg_proc%rowtype;
  after_row pg_catalog.pg_proc%rowtype;
  before_definition text;
  before_grants text;
  after_definition text;
  after_body text;
  insertion_point constant text := E'\nbegin\n';
  profiles constant jsonb := $original_messenger_profiles$
[
  {
    "identity": "msg_enforce_canonical_active_pair_participants()",
    "lookup_identity": "public.msg_enforce_canonical_active_pair_participants()",
    "table_name": "msg_thread_participants",
    "trigger_name": "trg_msg_enforce_canonical_active_pair_participants",
    "trigger_type": 29,
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_enforce_canonical_active_pair_participants()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  perform public.msg_assert_no_ambiguous_active_pair_for_thread(case when tg_op='DELETE' then old.thread_id else new.thread_id end);\n  if tg_op='UPDATE' and old.thread_id is distinct from new.thread_id then\n    perform public.msg_assert_no_ambiguous_active_pair_for_thread(old.thread_id);\n  end if;\n  return null;\nend\n$function$\n",
    "before_definition_sha256": "76f952a0dc3c0697ba5df6b044a729afd6239deba05fb02783648bedad5240d3",
    "before_prosrc_sha256": "d0c5016a0fbdf984a2695cfab25f41ccbe4faf65ecce48edfc18c6933238dbdc",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_enforce_canonical_active_pair_participants()'); grant execute on function msg_enforce_canonical_active_pair_participants() to postgres;",
    "before_grant_sha256": "15b732fb81c726019cd5a1624e27118e2ad9a2be56b73a28ac83b104f0ba9ef4",
    "restore_branch": "  -- Exact archived original DATA only; never fresh message/recipient authority.\n  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'AFTER'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_thread_participants' then\n    if TG_RELID = pg_catalog.to_regclass('public.msg_thread_participants')\n      and current_user = session_user and current_user = 'supabase_admin'\n      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then\n      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then\n        return NULL;\n      end if;\n    end if;\n  end if;\n",
    "after_prosrc_sha256": "980db4c1a4cf8d0dabf28966f32c2ff462dbb1226f620abd8edbba8d1b80fdfa",
    "after_definition_sha256": "aa4cfddd420f816b1fa1a14a350c8ef942ece81521c4de253aba9d08338303c6"
  },
  {
    "identity": "msg_enforce_canonical_active_pair_thread()",
    "lookup_identity": "public.msg_enforce_canonical_active_pair_thread()",
    "table_name": "msg_threads",
    "trigger_name": "trg_msg_enforce_canonical_active_pair_thread",
    "trigger_type": 21,
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_enforce_canonical_active_pair_thread()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  perform public.msg_assert_no_ambiguous_active_pair_for_thread(new.id);\n  return null;\nend\n$function$\n",
    "before_definition_sha256": "50626cd795d154c26dd15d4a95d0b3edd21769aca4f0718d7c118bffee53032b",
    "before_prosrc_sha256": "1ecbe497854fb8db8c7ad99c501d110622808795ffe2b1bcb26aab71329fb1ee",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_enforce_canonical_active_pair_thread()'); grant execute on function msg_enforce_canonical_active_pair_thread() to postgres;",
    "before_grant_sha256": "656eaea62a2a252a1994e0027dcd32ea0e090462c20ee05b2fc90b250ad71ec8",
    "restore_branch": "  -- Exact archived original DATA only; never fresh message/recipient authority.\n  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'AFTER'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_threads' then\n    if TG_RELID = pg_catalog.to_regclass('public.msg_threads')\n      and current_user = session_user and current_user = 'supabase_admin'\n      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then\n      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then\n        return NULL;\n      end if;\n    end if;\n  end if;\n",
    "after_prosrc_sha256": "3c1c49bd157736bd0f1bdeefb4e826c29fc8f641140319474b773856b6ed6f86",
    "after_definition_sha256": "ab4983eadde2033585c0090578c485eaa5f88d0c19b2ec2bcf1e1c69c9cacaa4"
  },
  {
    "identity": "public.msg_preserve_original_group_creation()",
    "lookup_identity": "public.msg_preserve_original_group_creation()",
    "table_name": "msg_threads",
    "trigger_name": "trg_msg_preserve_original_group_creation",
    "trigger_type": 23,
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_preserve_original_group_creation()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public', 'extensions'\nAS $function$\ndeclare\n  v_original jsonb;\n  v_recipient_count integer;\nbegin\n  if TG_OP='UPDATE' then\n    if NEW.original_group_creation is distinct from OLD.original_group_creation\n      or (OLD.original_group_creation is not null and\n        (NEW.id is distinct from OLD.id\n         or NEW.created_by_user_id is distinct from OLD.created_by_user_id\n         or NEW.client_thread_id is distinct from OLD.client_thread_id)) then\n      raise exception using errcode='23514',message='Original group creation tuple cannot be rewritten, removed or backfilled';\n    end if;\n    return NEW;\n  end if;\n  v_original := NEW.original_group_creation;\n  if v_original is null then return NEW; end if;\n  if jsonb_typeof(v_original) is distinct from 'object' then\n    raise exception using errcode='23514',message='Original group creation tuple must be closed';\n  end if;\n  if not (v_original ?& array['schema','created_by_user_id','client_thread_id','title','member_user_ids'])\n    or (v_original - array['schema','created_by_user_id','client_thread_id','title','member_user_ids']) <> '{}'::jsonb\n    or v_original->'schema' is distinct from to_jsonb('custodial.group-original-creation.v1'::text)\n    or v_original->'created_by_user_id' is distinct from to_jsonb(NEW.created_by_user_id)\n    or jsonb_typeof(v_original->'client_thread_id') is distinct from 'string'\n    or btrim(v_original->>'client_thread_id') is distinct from NEW.client_thread_id\n    or jsonb_typeof(v_original->'title') not in ('null','string')\n    or jsonb_typeof(v_original->'member_user_ids') is distinct from 'array'\n    or NEW.thread_type <> 'group' then\n    raise exception using errcode='23514',message='Original group creation tuple does not match its inserted group';\n  end if;\n  -- UUID[] can contain NULL/self/duplicate entries under the existing RPC.\n  -- Retain that exact received vector; membership still uses the existing\n  -- distinct non-NULL non-creator 2..100 recipient validation below.\n  if exists(select 1 from jsonb_array_elements(v_original->'member_user_ids') as m(value)\n    where jsonb_typeof(m.value) not in ('null','string')\n      or (jsonb_typeof(m.value)='string' and\n        (m.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then\n    raise exception using errcode='23514',message='Original group recipient vector must contain canonical UUID values';\n  end if;\n  select count(distinct m.value)::integer into v_recipient_count\n  from jsonb_array_elements_text(v_original->'member_user_ids') as m(value)\n  where m.value is not null and m.value <> NEW.created_by_user_id::text;\n  if v_recipient_count < 2 or v_recipient_count > 100 then\n    raise exception using errcode='23514',message='Original group recipient limit is invalid';\n  end if;\n  return NEW;\nend\n$function$\n",
    "before_definition_sha256": "c6bdccb229c02c9bb4b364c80593bced3a303f6f0ae6444dcc104fb2a4333780",
    "before_prosrc_sha256": "d68b6be9b3583b1b8662deae2f9c5be465641a19330992c5d65518cb175fb23f",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('public.msg_preserve_original_group_creation()');",
    "before_grant_sha256": "eae44ad5732fe4960381be2b7fda568cbe7f18c9d85f61313acec32c903d87e5",
    "restore_branch": "  -- Exact archived original DATA only; never fresh message/recipient authority.\n  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_threads' then\n    if TG_RELID = pg_catalog.to_regclass('public.msg_threads')\n      and current_user = session_user and current_user = 'supabase_admin'\n      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then\n      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then\n        return NEW;\n      end if;\n    end if;\n  end if;\n",
    "after_prosrc_sha256": "08aa4715f7f74a1b1030c2ab73430130eecba2d5ee347109bc0d1ae885690489",
    "after_definition_sha256": "2f344eb3dec0191a707067d3b37a223cb47e1a97cda134cd957fe1964edb6ee0"
  },
  {
    "identity": "msg_reject_retired_ops_manager_shared_participation()",
    "lookup_identity": "public.msg_reject_retired_ops_manager_shared_participation()",
    "table_name": "msg_thread_participants",
    "trigger_name": "trg_msg_reject_retired_ops_manager_shared_participation",
    "trigger_type": 31,
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_reject_retired_ops_manager_shared_participation()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if tg_op = 'INSERT'\n     and exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership participant history is immutable';\n  end if;\n\n  if tg_op = 'UPDATE'\n     and (\n       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n       or exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')\n     ) then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership participant history is immutable';\n  end if;\n\n  if tg_op = 'DELETE'\n     and exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership participant history cannot be deleted';\n  end if;\n\n  return case when tg_op = 'DELETE' then old else new end;\nend\n$function$\n",
    "before_definition_sha256": "073b880adce45199bc95d85b4d0140588e2ec64b2fe942bd29ee94f18ab3f1a7",
    "before_prosrc_sha256": "ffcbc1b4ba57bfef41d5f66223046ef2d18b3ce4e3a3e812f147a7cf53dce170",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_reject_retired_ops_manager_shared_participation()'); grant execute on function msg_reject_retired_ops_manager_shared_participation() to postgres;",
    "before_grant_sha256": "802e9d0c00886aa7ddead9b5f7f5a43cc29c73280f73dc67869e96ac485e1743",
    "restore_branch": "  -- Exact archived original DATA only; never fresh message/recipient authority.\n  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_thread_participants' then\n    if TG_RELID = pg_catalog.to_regclass('public.msg_thread_participants')\n      and current_user = session_user and current_user = 'supabase_admin'\n      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then\n      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then\n        return NEW;\n      end if;\n    end if;\n  end if;\n",
    "after_prosrc_sha256": "0cf4ff0225dae8a78ba20b2b0cd8840dad658bd012f26a76796b5cb8d5a197d6",
    "after_definition_sha256": "d8636eae240797ad58aa906fab3c0cd71f451d205a8b34c87910a5b8e7d07fe5"
  },
  {
    "identity": "msg_reject_retired_ops_manager_shared_thread_mutation()",
    "lookup_identity": "public.msg_reject_retired_ops_manager_shared_thread_mutation()",
    "table_name": "msg_threads",
    "trigger_name": "trg_msg_reject_retired_ops_manager_shared_thread_mutation",
    "trigger_type": 31,
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_reject_retired_ops_manager_shared_thread_mutation()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if tg_op = 'INSERT' and new.system_key = 'ops_manager_shared_chat_v1' then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership conversation cannot be recreated';\n  end if;\n\n  if tg_op = 'UPDATE'\n     and (old.system_key = 'ops_manager_shared_chat_v1'\n       or new.system_key = 'ops_manager_shared_chat_v1') then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership conversation is immutable';\n  end if;\n\n  if tg_op = 'DELETE' and old.system_key = 'ops_manager_shared_chat_v1' then\n    raise exception using\n      errcode = '23514',\n      message = 'The retired Operations Leadership conversation cannot be deleted';\n  end if;\n\n  return case when tg_op = 'DELETE' then old else new end;\nend\n$function$\n",
    "before_definition_sha256": "38d2ec5ac8cec0b4f5505a6ff6c703b208dbd233adac192e102fc877f8a44510",
    "before_prosrc_sha256": "5f271c8fadf830f96640470cc4a6ef272f404e07b735dee730c9b4a7268ab746",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_reject_retired_ops_manager_shared_thread_mutation()'); grant execute on function msg_reject_retired_ops_manager_shared_thread_mutation() to postgres;",
    "before_grant_sha256": "d9994b0ffc00ccf92fefc9895ae2cfedf2377e2a8079e2a7e411ec2292bc7af2",
    "restore_branch": "  -- Exact archived original DATA only; never fresh message/recipient authority.\n  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'\n    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_threads' then\n    if TG_RELID = pg_catalog.to_regclass('public.msg_threads')\n      and current_user = session_user and current_user = 'supabase_admin'\n      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then\n      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then\n        return NEW;\n      end if;\n    end if;\n  end if;\n",
    "after_prosrc_sha256": "f97fd5b78d32cc2ed7f702e633a370c5ef6bd308b58a61cea6c147c39f86bf82",
    "after_definition_sha256": "1db72f65a7322057cd190f2b019a8383d9523e92b0c62b340264ba5d7f250499"
  }
]
$original_messenger_profiles$::jsonb;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
  helper_oid := pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)');
  IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
    OR owner_oid IS NULL OR helper_oid IS NULL
    OR (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid IN(pg_catalog.to_regclass('public.msg_threads'),pg_catalog.to_regclass('public.msg_thread_participants'))
        AND n.nspname='public' AND c.relowner=owner_oid
        AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)<>2
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid
      AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
      AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2
      AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner))
  THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='Original messenger restore owner/relations/internal invoker matcher unavailable';
  END IF;
  -- This validates actual original objects/session and the already-held
  -- exclusive application xact fence, not a role-name permission substitute.
  PERFORM custodial_dr.immutable_import_owner_fence();
  LOCK TABLE public.msg_threads,public.msg_thread_participants IN ACCESS EXCLUSIVE MODE;
  IF pg_catalog.jsonb_array_length(profiles)<>5 THEN
    RAISE EXCEPTION 'Closed five-function messenger profile required';
  END IF;
  -- Validate ALL exact predecessors, original ACL recipes and trigger timing
  -- before any replacement. The normal function bodies are retained verbatim.
  FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(profiles) LOOP
    function_oid := pg_catalog.to_regprocedure(profile->>'lookup_identity');
    relation_oid := pg_catalog.to_regclass('public.'||(profile->>'table_name'));
    SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
    before_definition := pg_catalog.pg_get_functiondef(function_oid);
    before_grants := public.custodial_release_authority_current_grant_definition(profile->>'identity');
    IF original.proowner<>owner_oid OR original.prokind<>'f' OR original.pronargs<>0
      OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset
      OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      OR before_definition IS DISTINCT FROM profile->>'before_definition'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_definition_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original.prosrc,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_prosrc_sha256'
      OR before_grants IS DISTINCT FROM profile->>'before_grant_definition'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_grants,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_grant_sha256'
      OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger g WHERE g.tgrelid=relation_oid AND g.tgfoid=function_oid
        AND g.tgname=profile->>'trigger_name' AND g.tgtype=(profile->>'trigger_type')::integer
        AND g.tgenabled='O' AND NOT g.tgisinternal AND g.tgnargs=0 AND g.tgconstraint=0)
      OR (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,insertion_point,'')))
        <>pg_catalog.length(insertion_point)
    THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original messenger function/ACL/trigger predecessor differs',
       DETAIL=jsonb_build_object(
        'identity',profile->>'lookup_identity','owner',pg_catalog.pg_get_userbyid(original.proowner),
        'definition_matches',before_definition IS NOT DISTINCT FROM profile->>'before_definition',
        'definition_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_definition,'UTF8'),'sha256'),'hex'),
        'prosrc_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original.prosrc,'UTF8'),'sha256'),'hex'),
        'grant_matches',before_grants IS NOT DISTINCT FROM profile->>'before_grant_definition',
        'actual_grant_definition',before_grants,
        'insertion_points',(pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,insertion_point,'')))/pg_catalog.length(insertion_point),
        'actual_triggers',(SELECT jsonb_agg(jsonb_build_object('name',g.tgname,'type',g.tgtype,'enabled',g.tgenabled,
          'args',g.tgnargs,'constraint',g.tgconstraint,'definition',pg_catalog.pg_get_triggerdef(g.oid,true)) ORDER BY g.tgname)
         FROM pg_catalog.pg_trigger g WHERE g.tgrelid=relation_oid AND g.tgfoid=function_oid)
       )::text;
    END IF;
    after_body := pg_catalog.replace(original.prosrc,insertion_point,insertion_point||(profile->>'restore_branch'));
    after_definition := pg_catalog.replace(before_definition,insertion_point,insertion_point||(profile->>'restore_branch'));
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_prosrc_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_definition_sha256'
    THEN RAISE EXCEPTION 'Source-derived messenger branch transformation differs'; END IF;
    checked := checked || pg_catalog.jsonb_build_array(profile || pg_catalog.jsonb_build_object(
      'oid',function_oid,'metadata',pg_catalog.to_jsonb(original)-'prosrc',
      'after_definition',after_definition,'after_body',after_body));
  END LOOP;
  FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(checked) LOOP
    function_oid := (profile->>'oid')::oid;
    SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
    IF pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM profile->>'before_definition'
      OR pg_catalog.to_jsonb(original)-'prosrc' IS DISTINCT FROM profile->'metadata'
      OR public.custodial_release_authority_current_grant_definition(profile->>'identity')
        IS DISTINCT FROM profile->>'before_grant_definition'
    THEN RAISE EXCEPTION 'Original messenger function changed before replacement'; END IF;
    PERFORM custodial_dr.immutable_import_owner_fence();
    EXECUTE profile->>'after_definition';
    SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=function_oid;
    IF after_row.prosrc IS DISTINCT FROM profile->>'after_body'
      OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM profile->>'after_definition'
      OR pg_catalog.to_jsonb(after_row)-'prosrc' IS DISTINCT FROM profile->'metadata'
      OR public.custodial_release_authority_current_grant_definition(profile->>'identity')
        IS DISTINCT FROM profile->>'before_grant_definition'
    THEN RAISE EXCEPTION 'Messenger restore changed attributes outside the closed branch'; END IF;
  END LOOP;
END;
$immutable_messenger_restore$;
