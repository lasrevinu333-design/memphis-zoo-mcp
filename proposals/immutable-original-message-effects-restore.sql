-- UNACTIVATED isolated Source prototype: no migration/registration/admission.
-- Frozen backend 9b275574c8347d72eff71eeb48cca7c6b33b764d.
-- Authenticated original pg_dump SHA256:
-- a55d04c7c5ef24e5824bc1ac806990e59db23ec900841b5d66df93df523a44dc
-- Authenticated original recovery registry member SHA256:
-- 5f1c651ea94ba9d938e07894e1c0fe375286cb139bfe744b4d571370d8de7f12
-- All FIVE original inventory identities below are retained UNQUALIFIED;
-- only lookup_identity resolves their fixed public function OID.
-- No BEGIN/COMMIT: retain Main's SAME original owner/transaction/xact fence.
-- No registry writes, grants, owner changes, trigger switches or begin profile.
-- Restored messages already have their archived audit/outbox/history; this
-- exact-original path must not mint new schedule, AI, push or background work.
-- Main must independently pin the sealed invoker matcher implementation and
-- qualify its SINGLE/SET behavior. This proposal only checks its internal
-- invoker API/owner/ACL/config prerequisites, not authority from a name.
-- Four bodies receive a prologue; the schedule body's original exception
-- handler remains in a verbatim inner block, outside the new matcher phase.
DO $immutable_message_effects_restore$
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
  restore_branch constant text := $exact_message_effects_branch$  -- Exact archived message DATA only; no fresh audit, push, AI or schedule work.
  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'AFTER'
    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'msg_messages' then
    if TG_RELID = pg_catalog.to_regclass('public.msg_messages')
      and current_user = session_user and current_user = 'supabase_admin'
      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then
      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then
        return NULL;
      end if;
    end if;
  end if;
$exact_message_effects_branch$;
  profiles constant jsonb := $original_message_effects_profiles$
[
  {
    "identity": "msg_enqueue_background_work()",
    "lookup_identity": "public.msg_enqueue_background_work()",
    "table_name": "msg_messages",
    "trigger_name": "trg_msg_enqueue_background_work",
    "trigger_type": 5,
    "strategy": "first_begin",
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_enqueue_background_work()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if lower(coalesce(new.metadata_json->>'channel','')) = 'memphis'\n     and lower(coalesce(new.metadata_json->>'ai','false')) not in ('true','1','yes')\n     and new.message_type <> 'bot_response' then\n    insert into public.operational_notification_jobs(job_key, job_type, source_id, payload_json)\n    values (\n      'memphis-reply:' || new.id::text,\n      'memphis_bot_reply',\n      new.id,\n      jsonb_build_object('message_id', new.id, 'thread_id', new.thread_id, 'sender_user_id', new.sender_user_id)\n    )\n    on conflict (job_key) do nothing;\n  end if;\n  return new;\nend;\n$function$\n",
    "before_definition_sha256": "989f464b84cbc2f7f8efcbe27406f64c2e1695ac3a1b64725e50a86cdc6245a0",
    "before_prosrc_sha256": "93c3d7cb3d72c4abcc92737ff4058f0bb825135baa00d6723c18b8bf884dbc8e",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_enqueue_background_work()'); grant execute on function msg_enqueue_background_work() to postgres;",
    "before_grant_sha256": "d7a8fce06951b7a7ae4a71b39efe37a16aa198db91396211aebde8bb2d68ab48",
    "after_prosrc_sha256": "b2b19ac2fa5e68f753a8821ae2acb716c0d809a9f767ab2c16756b336982a3c8",
    "after_definition_sha256": "697c62e17d7333004df058159ffa9592c25368aa8575d4b714954f6a4308b9fb"
  },
  {
    "identity": "msg_memphis_pre_generate_schedule()",
    "lookup_identity": "public.msg_memphis_pre_generate_schedule()",
    "table_name": "msg_messages",
    "trigger_name": "trg_msg_memphis_pre_generate_schedule",
    "trigger_type": 5,
    "strategy": "outer_original_block",
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_memphis_pre_generate_schedule()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\ndeclare\n  v_body text := coalesce(new.body, '');\n  v_lower text := lower(coalesce(new.body, ''));\n  v_start_offset integer := 0;\n  v_offsets integer[] := array[0];\n  v_offset integer;\n  v_service_date date;\nbegin\n  if coalesce(new.metadata_json->>'channel', '') <> 'memphis' then\n    return new;\n  end if;\n\n  if coalesce(new.message_type, '') <> 'text' then\n    return new;\n  end if;\n\n  if v_lower !~ '(schedule|scheduled|shift|shifts|assigned|assignment|assignments|staff|staffing|working|works|work today|work tomorrow|who cleans|cleans|cleaning|cover|coverage|open area|open areas|open segment|uncovered|unassigned|restroom|restrooms|aquarium|teton|zambezi|expo|courtyard|breezeway|bonobos|cathouse|memmex|splash pad|event center|east admin|west admin|china|primate|pavilion)' then\n    return new;\n  end if;\n\n  if v_lower ~ '\\mtomorrow\\M' then\n    v_offsets := array[1];\n  elsif v_lower ~ '\\myesterday\\M' then\n    v_offsets := array[-1];\n  elsif v_lower ~ '(this week|next week|weekly|week schedule|whole week|entire week|all week)' then\n    if v_lower ~ 'next week' then\n      v_start_offset := 7;\n    else\n      v_start_offset := 0;\n    end if;\n    v_offsets := array[\n      v_start_offset,\n      v_start_offset + 1,\n      v_start_offset + 2,\n      v_start_offset + 3,\n      v_start_offset + 4,\n      v_start_offset + 5,\n      v_start_offset + 6\n    ];\n  end if;\n\n  foreach v_offset in array v_offsets loop\n    v_service_date := public.sch_service_date(now() + make_interval(days => v_offset));\n    perform public.sch_generate_daily_schedule(v_service_date, false);\n  end loop;\n\n  return new;\nexception when others then\n  raise warning 'msg_memphis_pre_generate_schedule failed for message %, error: %', new.id, sqlerrm;\n  return new;\nend;\n$function$\n",
    "before_definition_sha256": "6afb95b250f8d814d2f1cdb59936bfb99282721e2d7f0118e999b9b30c0c56a4",
    "before_prosrc_sha256": "ddc6ca4606177ae2ca18b0ae66640e0b8c74f532ca1d08ded5de3d9df674aa96",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_memphis_pre_generate_schedule()'); grant execute on function msg_memphis_pre_generate_schedule() to postgres;",
    "before_grant_sha256": "282b7f70e1e75ca927f5d312ed195b681a79f1b566a7e6bb2af5bfac6b346103",
    "after_prosrc_sha256": "db9dab6375e7d17616bdba33e7d9ba9ecc39649df47221c7d2c5cf4a5208f8ac",
    "after_definition_sha256": "a32e898e4f0807d85b8ebbf5254a39091380451f6070718c12adbd08f879aff6"
  },
  {
    "identity": "msg_audit_persisted_message()",
    "lookup_identity": "public.msg_audit_persisted_message()",
    "table_name": "msg_messages",
    "trigger_name": "trg_msg_message_immutable_audit",
    "trigger_type": 5,
    "strategy": "first_begin",
    "before_definition": "CREATE OR REPLACE FUNCTION public.msg_audit_persisted_message()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  insert into public.msg_message_audit(\n    message_id, thread_id, sender_user_id, sender_ops_manager_id,\n    client_message_id, message_type, sender_display_name, sender_role, created_at\n  )\n  select\n    new.id, new.thread_id, new.sender_user_id, u.ops_manager_id,\n    new.client_message_id, new.message_type, u.display_name, u.role, new.created_at\n  from public.msg_users u\n  where u.id = new.sender_user_id\n  on conflict (message_id) do nothing;\n  return new;\nend;\n$function$\n",
    "before_definition_sha256": "6d27044cdfbdc4b963181e286c8333c90601db557834ce1110b37facfeef3018",
    "before_prosrc_sha256": "4116e596d35f1779375b03d43d69e9b14bfc4ac6b7ff52bcea47d20de00135cb",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('msg_audit_persisted_message()'); grant execute on function msg_audit_persisted_message() to postgres;",
    "before_grant_sha256": "f91a15b93425218ee85faf03708c137cf0cc31d1e7f9eb7f7b4b63ec57fc1a9e",
    "after_prosrc_sha256": "6008464645019a9d27d96e166f07ad7a626e2a17c685ec4965c1f9c1ebbecb52",
    "after_definition_sha256": "ddbfb3e3d17773ad30ce24e2fe8caf7b962b58ecd9e5d6c32e78d5698e840d57"
  },
  {
    "identity": "mz_enqueue_employee_message_push()",
    "lookup_identity": "public.mz_enqueue_employee_message_push()",
    "table_name": "msg_messages",
    "trigger_name": "trg_mz_enqueue_employee_message_push",
    "trigger_type": 5,
    "strategy": "first_begin",
    "before_definition": "CREATE OR REPLACE FUNCTION public.mz_enqueue_employee_message_push()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if new.is_deleted=true then return new; end if;\n\n  insert into public.operational_notification_jobs(\n    job_key,job_type,source_id,available_at,payload_json\n  )\n  select\n    'employee-message-push:'||new.id::text||':'||pr.credential_id::text,\n    'employee_native_push',\n    new.id,\n    now(),\n    jsonb_build_object(\n      'credential_id',pr.credential_id,\n      'employee_id',recipient.employee_id,\n      'device_id',d.id,\n      'device_identifier',d.device_id,\n      'assignment_epoch',d.assignment_epoch,\n      'channel_id','employee-messages',\n      'title',coalesce(nullif(sender.display_name,''),'Memphis Zoo'),\n      'body',left(coalesce(nullif(regexp_replace(new.body,'[[:space:]]+',' ','g'),''),'New message'),1000),\n      'data_json',jsonb_build_object(\n        'kind','employee_message',\n        'notification_type','message',\n        'notification_key','message:'||new.id::text,\n        'thread_id',new.thread_id::text,\n        'message_id',new.id::text,\n        'route','messages.html?hub=employee&thread_id='||new.thread_id::text,\n        'sender_name',coalesce(nullif(sender.display_name,''),'Memphis Zoo'),\n        'thread_title',coalesce(nullif(thread.title,''),'Conversation')\n      )\n    )\n  from public.msg_thread_participants participant\n  join public.msg_users recipient\n    on recipient.id=participant.user_id\n   and recipient.employee_id is not null\n   and recipient.is_active=true\n  join public.employees employee\n    on employee.id=recipient.employee_id\n   and employee.active=true\n  join public.employee_push_registrations pr\n    on pr.employee_id=recipient.employee_id\n   and pr.active=true\n   and pr.revoked_at is null\n  join public.devices d\n    on d.id=pr.device_id\n   and d.assigned_employee_id=recipient.employee_id\n   and d.assignment_epoch=pr.assignment_epoch\n   and d.active=true\n  join public.device_auth_credentials credential\n    on credential.credential_id=pr.credential_id\n   and credential.device_id=d.id\n   and credential.confirmed_at is not null\n   and credential.revoked_at is null\n   and credential.expires_at>now()\n  left join public.msg_users sender on sender.id=new.sender_user_id\n  left join public.msg_threads thread on thread.id=new.thread_id\n  where participant.thread_id=new.thread_id\n    and participant.left_at is null\n    and participant.user_id<>new.sender_user_id\n  on conflict(job_key) do nothing;\n\n  return new;\nend\n$function$\n",
    "before_definition_sha256": "87c583ab74d9f6e823c52f08dd398a063a8e2ad9348b328cade5bc1a436c4203",
    "before_prosrc_sha256": "210516da782aa1b88feb0083458a0264587b125dc4af4f019ef9947e64be9457",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('mz_enqueue_employee_message_push()'); grant execute on function mz_enqueue_employee_message_push() to postgres;",
    "before_grant_sha256": "5b746931e2c20647e87dd7f717a3f1fd0be533679fac0b7f8ff54ee4092d8861",
    "after_prosrc_sha256": "328d146e9b71e8bdbb39b1b598e1b07709928592c6d6804b0046957bda7a10c7",
    "after_definition_sha256": "ed86b03776d740a1f75482092a16e76ca75848142982187bf303e73eb567d459"
  },
  {
    "identity": "ops_manager_enqueue_message_push()",
    "lookup_identity": "public.ops_manager_enqueue_message_push()",
    "table_name": "msg_messages",
    "trigger_name": "trg_ops_manager_enqueue_message_push",
    "trigger_type": 5,
    "strategy": "first_begin",
    "before_definition": "CREATE OR REPLACE FUNCTION public.ops_manager_enqueue_message_push()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if new.is_deleted=true then return new; end if;\n\n  insert into public.ops_manager_notification_queue(\n    job_key,credential_id,manager_id,notification_type,source_id,title,body,data_json\n  )\n  select\n    'manager-message:'||new.id::text||':'||pd.credential_id::text,\n    pd.credential_id,\n    pd.manager_id,\n    'message',\n    new.id,\n    left(coalesce(nullif(sender.display_name,''),'Memphis Zoo Ops'),180),\n    left(coalesce(nullif(regexp_replace(new.body,'[[:space:]]+',' ','g'),''),'New message'),1000),\n    jsonb_build_object(\n      'kind','message',\n      'thread_id',new.thread_id::text,\n      'message_id',new.id::text,\n      'route','messages-chatscope.html?thread_id='||new.thread_id::text,\n      'sender_name',coalesce(sender.display_name,'Memphis Zoo Ops'),\n      'thread_title',coalesce(t.title,'Conversation')\n    )\n  from public.msg_thread_participants participant\n  join public.msg_users recipient on recipient.id=participant.user_id\n  join public.ops_manager_managers manager on manager.manager_id=recipient.ops_manager_id\n  join public.ops_manager_push_devices pd on pd.manager_id=manager.manager_id\n  join public.ops_manager_trusted_devices td on td.credential_id=pd.credential_id and td.manager_id=manager.manager_id\n  left join public.ops_manager_notification_preferences pref on pref.credential_id=pd.credential_id\n  left join public.msg_users sender on sender.id=new.sender_user_id\n  left join public.msg_threads t on t.id=new.thread_id\n  where participant.thread_id=new.thread_id\n    and participant.left_at is null\n    and participant.user_id<>new.sender_user_id\n    and manager.active=true\n    and manager.revoked_at is null\n    and manager.is_system_principal=false\n    and pd.enabled=true\n    and pd.revoked_at is null\n    and td.revoked_at is null\n    and td.expires_at>now()\n    and coalesce(pref.messages_enabled,true)=true\n  on conflict(job_key) do nothing;\n\n  return new;\nend\n$function$\n",
    "before_definition_sha256": "f813902e7e102d4180f2789384562583602461f93cbbf5d6e34f48df57e884fb",
    "before_prosrc_sha256": "f4dfb29de8877da3d032a5cd89692b7550bac4f3bababc3ac62e062ed7a920a0",
    "before_grant_definition": "select public.custodial_release_authority_reset_grants('ops_manager_enqueue_message_push()'); grant execute on function ops_manager_enqueue_message_push() to postgres;",
    "before_grant_sha256": "33569f0085e85471f0f61ae053dd9ac721a541d6d8b0ed46a587ab47dedeebd5",
    "after_prosrc_sha256": "9c16f14bd5b069a7c880c2505bde70fb4e46374ed75320e351d4b8da409ac933",
    "after_definition_sha256": "2488028c7f06420255bc3825053b2c0d58c63c43faf99ad5cd779853a19abff1"
  }
]
$original_message_effects_profiles$::jsonb;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
  helper_oid := pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)');
  IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
    OR owner_oid IS NULL OR helper_oid IS NULL
    OR (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid=pg_catalog.to_regclass('public.msg_messages')
        AND n.nspname='public' AND c.relname='msg_messages' AND c.relowner=owner_oid
        AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid
      AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
      AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2
      AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner))
  THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='Original message effects restore owner/relations/internal invoker matcher unavailable';
  END IF;
  -- This validates actual original objects/session and the already-held
  -- exclusive application xact fence, not a role-name permission substitute.
  PERFORM custodial_dr.immutable_import_owner_fence();
  LOCK TABLE public.msg_messages IN ACCESS EXCLUSIVE MODE;
  IF pg_catalog.jsonb_array_length(profiles)<>5 THEN
    RAISE EXCEPTION 'Closed five-function message effects profile required';
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
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original message effects function/ACL/trigger predecessor differs';
    END IF;
    IF profile->>'strategy'='outer_original_block'
      AND profile->>'lookup_identity'='public.msg_memphis_pre_generate_schedule()' THEN
      -- The original schedule block catches WHEN OTHERS. Keep that entire
      -- declaration/body/handler verbatim INSIDE a new outer block, so it
      -- cannot swallow the exact-context matcher's stale/corruption refusal.
      -- Its original declarations evaluate only on the original normal path.
      after_body := E'\nbegin\n'||restore_branch||original.prosrc||E'end;\n';
    ELSIF profile->>'strategy'='first_begin'
      AND profile->>'lookup_identity'<>'public.msg_memphis_pre_generate_schedule()' THEN
      after_body := pg_catalog.replace(original.prosrc,insertion_point,insertion_point||restore_branch);
    ELSE RAISE EXCEPTION 'Closed message effects transformation strategy differs'; END IF;
    after_definition := pg_catalog.replace(before_definition,
      'AS $function$'||original.prosrc||E'$function$\n',
      'AS $function$'||after_body||E'$function$\n');
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_prosrc_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_definition_sha256'
    THEN RAISE EXCEPTION 'Source-derived message effects branch transformation differs'; END IF;
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
    THEN RAISE EXCEPTION 'Original message effects function changed before replacement'; END IF;
    PERFORM custodial_dr.immutable_import_owner_fence();
    EXECUTE profile->>'after_definition';
    SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=function_oid;
    IF after_row.prosrc IS DISTINCT FROM profile->>'after_body'
      OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM profile->>'after_definition'
      OR pg_catalog.to_jsonb(after_row)-'prosrc' IS DISTINCT FROM profile->'metadata'
      OR public.custodial_release_authority_current_grant_definition(profile->>'identity')
        IS DISTINCT FROM profile->>'before_grant_definition'
    THEN RAISE EXCEPTION 'Message effects restore changed attributes outside the closed branch'; END IF;
  END LOOP;
END;
$immutable_message_effects_restore$;
