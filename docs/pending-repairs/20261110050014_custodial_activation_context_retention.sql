-- Exact-owner activation memory repair: preserve every context/native/lunch guard.
-- Discard two unused full context returns and remove only two no-longer-read
-- local context fields after their original exact staged/hash validation.
-- Existing grants, restore surface, original transactions and deadlines remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';
do $context_retention$
declare targets jsonb:=$targets$[{"identity":"public.static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb)","preimage_sha256":"d3010ab1c56efb2a4990adf9b3a51af03fdc3af24e64a200bf25cb10d7b9b09f","acl":"{postgres=X/postgres,static_weekly_control_plane=X/postgres}","before":" ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);","after":" PERFORM public.static_weekly_coverall_initial_context(p_operation,p_manager);"},{"identity":"public.static_weekly_coverall_finalize_initial_operational(uuid,uuid,text)","preimage_sha256":"73c63d5f28cd4a13b3b2a61400f83db7329d7618537b1e10c721bafed39b2db7","acl":"{postgres=X/postgres,static_weekly_control_plane=X/postgres}","before":" ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);","after":" PERFORM public.static_weekly_coverall_initial_context(p_operation,p_manager);"},{"identity":"public.static_weekly_coverall_initial_assert_payload(uuid,uuid,jsonb)","preimage_sha256":"6c0f709879c1bfe6553759d131e651be2b8ea387cc306b062f2f7c9d31d29158","acl":"{postgres=X/postgres}","before":" THEN RAISE EXCEPTION 'Exact staged original INITIAL_EMPLOYMENT_OPERATIONALIZATION data required';END IF;","after":" THEN RAISE EXCEPTION 'Exact staged original INITIAL_EMPLOYMENT_OPERATIONALIZATION data required';END IF;\n -- These duplicates are no longer read; the native guard fetches its own full context.\n ctx:=ctx-array['basis','stagedEnvelope'];"}]$targets$::jsonb;
 target jsonb;identity text;original text;changed text;before_meta jsonb;after_meta jsonb;
begin
 for target in select value from jsonb_array_elements(targets) loop
  identity:=target->>'identity';original:=pg_get_functiondef(to_regprocedure(identity));
  if public.static_weekly_digest_text(original) is distinct from target->>'preimage_sha256' then
   raise exception 'Exact activation context predecessor differs: %',identity;end if;
  select jsonb_build_object('owner',proowner::regrole::text,'acl',proacl::text,'definer',prosecdef,
   'volatility',provolatile,'strict',proisstrict,'config',to_jsonb(proconfig)) into strict before_meta
   from pg_proc where oid=to_regprocedure(identity);
  if before_meta is distinct from jsonb_build_object('owner','postgres','acl',target->>'acl','definer',true,
   'volatility','v','strict',false,'config',jsonb_build_array('search_path=pg_catalog, public')) then
   raise exception 'Exact activation context metadata differs: %',identity;end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory
   where object_identity in(identity,substr(identity,8)))
   or exists(select 1 from public.custodial_release_canary_authority_surface()
    where object_identity in(identity,substr(identity,8))) then
   raise exception 'Activation context recovery surface differs: %',identity;end if;
  if length(original)-length(replace(original,target->>'before',''))<>length(target->>'before') then
   raise exception 'Exact activation context seam differs: %',identity;end if;
  changed:=replace(original,target->>'before',target->>'after');
  if replace(changed,target->>'after',target->>'before') is distinct from original then
   raise exception 'Activation context seam is not exactly reversible: %',identity;end if;
  execute changed;
  select jsonb_build_object('owner',proowner::regrole::text,'acl',proacl::text,'definer',prosecdef,
   'volatility',provolatile,'strict',proisstrict,'config',to_jsonb(proconfig)) into strict after_meta
   from pg_proc where oid=to_regprocedure(identity);
  if pg_get_functiondef(to_regprocedure(identity)) is distinct from changed or after_meta is distinct from before_meta then
   raise exception 'Activation context definition or authority readback differs: %',identity;end if;
 end loop;
end $context_retention$;
commit;
