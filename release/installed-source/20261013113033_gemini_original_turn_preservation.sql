-- CLI-created forward correction. Existing tables, RPC signatures, owners and
-- ACLs remain unchanged. Original metadata is new-message-only: never backfill
-- historical requests or turn transport acceptance into a delivery receipt.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE console_original_functions_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,proconfig,prolang,provolatile,proparallel,prosecdef,prorettype,
  prosrc,pg_get_functiondef(oid) AS definition
 FROM pg_proc WHERE oid IN (
  'public.gemini_console_begin_turn(uuid,uuid,uuid,text,uuid[],uuid)'::regprocedure,
  'public.gemini_console_complete_turn(uuid,text,text,text,uuid,jsonb)'::regprocedure);
CREATE TEMP TABLE console_original_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;

DO $original_turn$
DECLARE target regprocedure; before text; body text; changed text; after text;
 old_piece text;new_piece text; wanted_hash text;
BEGIN
 FOR target,wanted_hash IN SELECT * FROM (VALUES
  ('public.gemini_console_begin_turn(uuid,uuid,uuid,text,uuid[],uuid)'::regprocedure,
   'e73547ec7c66697dbf055faac3ffc57d1daab1898f735be8384d66eef01fd90d'),
  ('public.gemini_console_complete_turn(uuid,text,text,text,uuid,jsonb)'::regprocedure,
   'a6f90d0dff1e0806cce2fa4d1ace12bfe9c053ee818ac254776d8ff2e4a1e604')) s(oid,hash)
 LOOP
  SELECT definition,prosrc INTO STRICT before,body FROM console_original_functions_before WHERE oid=target;
  IF public.static_weekly_digest_text(body)<>wanted_hash
   OR EXISTS(SELECT 1 FROM console_original_inventory_before
    WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
   OR (SELECT count(*) FROM console_original_inventory_before WHERE object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
    AND definition_sql=before)<>0
   OR (SELECT count(*) FROM console_original_inventory_before WHERE object_kind='grant'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
    AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))<>0
   OR EXISTS(SELECT 1 FROM console_original_inventory_before
    WHERE object_kind IN('function','grant') AND object_identity LIKE '%(%'
     AND to_regprocedure(object_identity)=target)
   OR NOT has_function_privilege('service_role',target,'EXECUTE')
   OR has_function_privilege('anon',target,'EXECUTE')
   OR has_function_privilege('authenticated',target,'EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
     AND (p.prosecdef IS NOT TRUE OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, extensions']))
   OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=target AND a.grantee<>p.proowner
     AND (r.rolname IS NULL OR r.rolname NOT IN('postgres','service_role')
       OR a.is_grantable OR a.privilege_type<>'EXECUTE'))
  THEN RAISE EXCEPTION 'Console exact original RPC predecessor or recovery binding changed';END IF;
  changed:=body;
  IF target='public.gemini_console_begin_turn(uuid,uuid,uuid,text,uuid[],uuid)'::regprocedure THEN
   old_piece:=$old$  insert into public.gemini_console_messages(
$old$;
   new_piece:=$new$  if v_expected > 8
    or exists(select 1 from unnest(p_attachment_ids) id where id is null)
    or (select count(distinct id) from unnest(p_attachment_ids) id) <> v_expected
  then raise exception 'original attachment identifiers must be distinct and bounded'; end if;

  insert into public.gemini_console_messages(
$new$;
   IF (length(changed)-length(replace(changed,old_piece,'')))/length(old_piece)<>1 THEN RAISE EXCEPTION 'Console begin insert changed';END IF;
   changed:=replace(changed,old_piece,new_piece);
   old_piece:=$old$    jsonb_build_object('source', 'direct_authenticated_user')
$old$;
   new_piece:=$new$    jsonb_build_object('source', 'direct_authenticated_user',
      'original_attachment_ids',to_jsonb(coalesce(p_attachment_ids,'{}'::uuid[])),
      'original_client_time_policy','LOCAL_DISPLAY_METADATA_NOT_SERVER_AUTHORITY')
$new$;
   IF (length(changed)-length(replace(changed,old_piece,'')))/length(old_piece)<>1 THEN RAISE EXCEPTION 'Console begin metadata changed';END IF;
   changed:=replace(changed,old_piece,new_piece);
   old_piece:=$old$  if v_expected > 0 then
$old$;
   new_piece:=$new$  -- A legacy/mismatched original cannot adopt newly supplied pins.
  if v_message.correlation_id is distinct from p_correlation_id
    or v_message.metadata_json->'original_attachment_ids' is distinct from to_jsonb(coalesce(p_attachment_ids,'{}'::uuid[]))
    or v_message.metadata_json->>'original_client_time_policy' is distinct from 'LOCAL_DISPLAY_METADATA_NOT_SERVER_AUTHORITY'
  then raise exception 'original message request identity is unavailable or conflicts'; end if;

  if v_expected > 0 then
$new$;
   IF (length(changed)-length(replace(changed,old_piece,'')))/length(old_piece)<>1 THEN RAISE EXCEPTION 'Console begin attachment branch changed';END IF;
   changed:=replace(changed,old_piece,new_piece);
  ELSE
   old_piece:=$old$  if not found then raise exception 'user message not found'; end if;
$old$;
   new_piece:=$new$  if not found then raise exception 'user message not found'; end if;
  if v_user.correlation_id is distinct from p_correlation_id
    or not exists(select 1 from public.ops_manager_managers m
      where m.manager_id=v_user.manager_id and m.active and m.revoked_at is null)
  then raise exception 'original turn identity or manager authority changed'; end if;
  select * into v_assistant from public.gemini_console_messages
    where response_to_message_id=v_user.message_id and role='assistant' for update;
  if found then
    if v_user.state<>'completed' or v_assistant.state<>'completed'
      or v_assistant.manager_id is distinct from v_user.manager_id
      or v_assistant.conversation_id is distinct from v_user.conversation_id
      or v_assistant.correlation_id is distinct from p_correlation_id
      or v_assistant.body is distinct from coalesce(p_body,'')
      or v_assistant.provider is distinct from nullif(btrim(p_provider),'')
      or v_assistant.model is distinct from nullif(btrim(p_model),'')
      or v_assistant.metadata_json is distinct from coalesce(p_metadata_json,'{}'::jsonb)
    then raise exception 'original completed turn conflicts; history retained'; end if;
    return to_jsonb(v_assistant);
  end if;
  if v_user.state<>'generating' then raise exception 'original turn is not generating'; end if;
$new$;
   IF (length(changed)-length(replace(changed,old_piece,'')))/length(old_piece)<>1 THEN RAISE EXCEPTION 'Console complete original branch changed';END IF;
   changed:=replace(changed,old_piece,new_piece);
   old_piece:=$old$  do update set body = excluded.body, state = 'completed', provider = excluded.provider,
    model = excluded.model, metadata_json = excluded.metadata_json,
    completed_at = coalesce(public.gemini_console_messages.completed_at, excluded.completed_at)
$old$;
   new_piece:=$new$  do nothing
$new$;
   IF (length(changed)-length(replace(changed,old_piece,'')))/length(old_piece)<>1 THEN RAISE EXCEPTION 'Console complete overwrite branch changed';END IF;
   changed:=replace(changed,old_piece,new_piece);
   old_piece:=$old$  update public.gemini_console_messages
$old$;
   new_piece:=$new$  if not found then raise exception 'original completed turn conflicted; history retained'; end if;

  update public.gemini_console_messages
$new$;
   IF (length(changed)-length(replace(changed,old_piece,'')))/length(old_piece)<>1 THEN RAISE EXCEPTION 'Console complete state branch changed';END IF;
   changed:=replace(changed,old_piece,new_piece);
  END IF;
  IF (length(before)-length(replace(before,body,'')))/length(body)<>1 THEN RAISE EXCEPTION 'Console RPC definition changed';END IF;
  after:=replace(before,body,changed);EXECUTE after;
  IF pg_get_functiondef(target) IS DISTINCT FROM after
   OR EXISTS(SELECT 1 FROM pg_proc p JOIN console_original_functions_before old ON old.oid=p.oid
    WHERE p.oid=target AND ROW(p.proowner,p.proacl,p.proconfig,p.prolang,p.provolatile,p.proparallel,p.prosecdef,p.prorettype)
     IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.prolang,old.provolatile,old.proparallel,old.prosecdef,old.prorettype))
  THEN RAISE EXCEPTION 'Console RPC unrelated attributes or permissions changed';END IF;
 END LOOP;
END $original_turn$;

-- These two Console functions are outside the existing Custodial recovery
-- surface at the exact268 predecessor. Preserve that scope, do not manufacture
-- registration or touch other program rollback definitions.
-- No recovery inventory write or trigger toggle is needed for zero membership.
DO $original_scope$
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)
   <>(SELECT count(*) FROM console_original_inventory_before)
  OR EXISTS(SELECT old.* FROM console_original_inventory_before old
   WHERE NOT(old.object_kind='function' AND old.object_identity LIKE '%(%'
    AND to_regprocedure(old.object_identity) IN(SELECT oid FROM console_original_functions_before))
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT current_row.* FROM public.custodial_release_authority_restore_inventory current_row
   WHERE NOT(current_row.object_kind='function' AND current_row.object_identity LIKE '%(%'
    AND to_regprocedure(current_row.object_identity) IN(SELECT oid FROM console_original_functions_before))
   EXCEPT SELECT * FROM console_original_inventory_before)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Console original unrelated recovery inventory or guard changed';END IF;
END $original_scope$;
COMMIT;
