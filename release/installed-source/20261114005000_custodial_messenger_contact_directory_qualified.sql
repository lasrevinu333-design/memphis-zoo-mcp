LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE contact_inventory_before ON COMMIT DROP AS TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE contact_functions_before ON COMMIT DROP AS
 SELECT s.signature,pg_get_functiondef(to_regprocedure(s.signature)) AS definition,
 public.custodial_release_authority_current_grant_definition(s.signature) AS grants
 FROM (VALUES('public.msg_is_runtime_user(uuid)'),('public.msg_list_users(uuid)'),
 ('public.msg_create_group_thread_v2(uuid,text,uuid[],text)'),('public.msg_get_or_create_direct_thread(uuid,uuid)')) s(signature);
CREATE TEMP TABLE contact_canary_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_canary_authority_surface();
DO $recovery_before$
BEGIN
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 AND tgname='custodial_disaster_restore_mutation_fence') IS DISTINCT FROM 'O'
 THEN RAISE EXCEPTION 'Contact repair requires unchanged ALWAYS inventory and ordinary restore fences'; END IF;
 IF (SELECT count(*) FROM contact_inventory_before WHERE CASE WHEN object_kind='function' THEN to_regprocedure(object_identity) END='public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure
 AND definition_sha256='48054b21df05d26a42eb59cd0af920016cb614f7b223a437cadec929fff47b42'
 AND definition_sql=pg_get_functiondef('public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure))<>1
 OR (SELECT count(*) FROM contact_inventory_before WHERE CASE WHEN object_kind='grant' AND position('(' IN object_identity)>0 THEN to_regprocedure(object_identity) END='public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure
 AND definition_sha256='e9aaea0fae90caf25f84665f7e6bd23639c2555ae7d405be68738e3185ceb0ca'
 AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))<>1
 THEN RAISE EXCEPTION 'Exact group original recovery predecessors differ'; END IF;
 IF EXISTS(SELECT 1 FROM contact_inventory_before WHERE CASE WHEN object_kind IN ('function','grant') AND position('(' IN object_identity)>0 THEN to_regprocedure(object_identity) END IN (to_regprocedure('public.msg_list_users(uuid)'),to_regprocedure('public.msg_is_contact_user(uuid)')))
 THEN RAISE EXCEPTION 'Contact/list recovery rows already exist; reconcile original repair'; END IF;
END
$recovery_before$;

-- Active employee contacts do not acquire phone/session/actor admission.
-- Exact live 424 predecessors; no employee/account/assignment/history writes.
do $guard$
declare v record;
begin
 if to_regprocedure('public.msg_is_contact_user(uuid)') is not null then
  raise exception using errcode='55000',message='Contact eligibility helper already exists; reconcile its original migration';
 end if;
 for v in select * from (values
  ('public.msg_is_runtime_user(uuid)','0d2ad7830e9f428c4d2348b369353c049e1ba257bc5dfcfa37e1d3ab6b682c31')
,  ('public.msg_list_users(uuid)','e0351db70dcb578a7639a99ecd255724a38c09afc7841ade759d586085e6ad76')
,  ('public.msg_create_group_thread_v2(uuid,text,uuid[],text)','48054b21df05d26a42eb59cd0af920016cb614f7b223a437cadec929fff47b42')
,  ('public.msg_get_or_create_direct_thread(uuid,uuid)','a313b735dfe0621c5037b29c9037b98de83e8a7981341482e6ec555aac3477d5')
) expected(signature,sha256) loop
  if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(v.signature)),'UTF8')),'hex') is distinct from v.sha256 then
   raise exception using errcode='55000',message='Messenger contact repair predecessor mismatch: '||v.signature;
  end if;
 end loop;
end
$guard$;

create function public.msg_is_contact_user(p_user_id uuid)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public','extensions'
as $contact$
 select public.msg_is_runtime_user(p_user_id) or exists(
  select 1 from public.msg_users mu join public.employees e on e.id=mu.employee_id
  where mu.id=p_user_id and mu.is_active and mu.role='employee'
   and e.active and coalesce(e.employee_code,'')~'^EMP[0-9]+'
 )
$contact$;
revoke all on function public.msg_is_contact_user(uuid) from public,anon,authenticated;
grant execute on function public.msg_is_contact_user(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.msg_list_users(p_current_user_id uuid)
 RETURNS TABLE(id uuid, display_name text, role text, is_active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select mu.id, mu.display_name, mu.role, mu.is_active
  from public.msg_users mu
  where mu.is_active = true
    and public.msg_is_contact_user(mu.id)
    and (p_current_user_id is null or mu.id <> p_current_user_id)
  order by
    case
      when mu.role = 'bot' then 1
      when mu.role in ('manager','ops','ops_manager','operations_manager') then 2
      else 3
    end,
    mu.display_name;
$function$;

CREATE OR REPLACE FUNCTION public.msg_create_group_thread_v2(p_created_by_user_id uuid, p_title text, p_member_user_ids uuid[], p_client_thread_id text)
 RETURNS msg_threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_thread public.msg_threads%rowtype;
  v_member_ids uuid[];
  v_title text;
  v_client_thread_id text;
  v_original jsonb;
  v_ledger custodial_release_identity.group_original_creations%rowtype;
begin
  if p_created_by_user_id is null then
    raise exception using errcode='22023',message='Authenticated group creator is required';
  end if;
  if not public.msg_is_runtime_user(p_created_by_user_id) then
    raise exception using errcode='42501',message='Group creator is not an active Messenger user';
  end if;
  -- The existing HTTP facade supplies a one-dimensional UUID vector. Do not
  -- flatten multidimensional arrays into an invented original request.
  if p_member_user_ids is not null and cardinality(p_member_user_ids)>0
    and (array_ndims(p_member_user_ids) is distinct from 1
      or array_lower(p_member_user_ids,1) is distinct from 1) then
    raise exception using errcode='22023',message='Original group recipients must use the received one-dimensional vector';
  end if;
  v_member_ids := array(
    select distinct member_id
    from unnest(coalesce(p_member_user_ids,array[]::uuid[])) as selected(member_id)
    where member_id is not null and member_id <> p_created_by_user_id
    order by member_id
  );
  if coalesce(array_length(v_member_ids,1),0)<2 then
    raise exception using errcode='22023',message='A group requires at least two recipients';
  end if;
  if coalesce(array_length(v_member_ids,1),0)>100 then
    raise exception using errcode='22023',message='A group may contain at most 100 recipients';
  end if;
  if exists(select 1 from unnest(v_member_ids) as selected(member_id)
    where not public.msg_is_contact_user(selected.member_id)) then
    raise exception using errcode='22023',message='One or more recipients are invalid or inactive';
  end if;
  v_title := nullif(left(btrim(coalesce(p_title,'')),120),'');
  v_client_thread_id := nullif(btrim(coalesce(p_client_thread_id,'')),'');
  if v_client_thread_id is null or length(v_client_thread_id) not between 8 and 200 then
    raise exception using errcode='22023',message='A stable client thread operation id is required';
  end if;
  v_original := jsonb_build_object(
    'schema','custodial.group-original-creation.v1',
    'created_by_user_id',p_created_by_user_id,
    'client_thread_id',p_client_thread_id,
    'title',p_title,
    'member_user_ids',to_jsonb(p_member_user_ids)
  );
  -- Serialize this existing canonical creator/key (including first use) until
  -- transaction completion; hash collisions only serialize unrelated work.
  -- Raw received key spelling remains in the closed original tuple.
  perform pg_advisory_xact_lock(hashtextextended('custodial.group-original-creation.v1:'
    ||p_created_by_user_id::text||':'||v_client_thread_id,0));
  select * into v_ledger from custodial_release_identity.group_original_creations
    where creator_uuid=p_created_by_user_id and original_client_thread_id=v_client_thread_id;
  if found then
    if v_ledger.original_tuple is distinct from v_original then
      raise exception using errcode='22023',message='Group operation already belongs to a different original creation tuple';
    end if;
    select * into v_thread from public.msg_threads where id=v_ledger.group_uuid for update;
    if v_thread.id is null then
      raise exception using errcode='55000',message='Original group was retired; its original operation remains held and cannot create a replacement';
    end if;
    if v_thread.thread_type is distinct from 'group'
      or v_thread.created_by_user_id is distinct from p_created_by_user_id
      or v_thread.client_thread_id is distinct from v_client_thread_id
      or v_thread.original_group_creation is distinct from v_ledger.original_tuple then
      raise exception using errcode='55000',message='Original group ledger and current row binding disagree';
    end if;
    return v_thread;
  end if;
  -- A surviving row without an original ledger is legacy/unbound, even if
  -- someone presents matching current members or an unqualified column.
  if exists(select 1 from public.msg_threads
      where created_by_user_id=p_created_by_user_id and client_thread_id=v_client_thread_id) then
    raise exception using errcode='55000',message='Legacy group original creation is unbound and remains held';
  end if;
  insert into public.msg_threads(
    thread_type,title,created_by_user_id,client_thread_id,is_active,original_group_creation
  ) values('group',v_title,p_created_by_user_id,v_client_thread_id,true,v_original)
  on conflict(created_by_user_id,client_thread_id) where client_thread_id is not null
  do nothing returning * into v_thread;
  if v_thread.id is null then
    select * into v_thread from public.msg_threads
    where created_by_user_id=p_created_by_user_id and client_thread_id=v_client_thread_id
    limit 1 for update;
    if v_thread.id is null then
      raise exception using errcode='40001',message='Concurrent group creation could not be reconciled';
    end if;
    -- No adoption: all legitimate same-key RPC creators hold the same lock
    -- and store a ledger in their transaction. An outside legacy insertion
    -- must not gain provenance through this conflict branch.
    raise exception using errcode='55000',message='Concurrent group row lacks original ledger and remains held';
  end if;
  insert into custodial_release_identity.group_original_creations(
    creator_uuid,original_client_thread_id,group_uuid,original_tuple
  ) values(p_created_by_user_id,v_client_thread_id,v_thread.id,v_original);
  insert into public.msg_thread_participants(thread_id,user_id)
  values(v_thread.id,p_created_by_user_id)
  on conflict(thread_id,user_id) do update set left_at=null;
  insert into public.msg_thread_participants(thread_id,user_id)
  select v_thread.id,member_id from unnest(v_member_ids) as selected(member_id)
  on conflict(thread_id,user_id) do update set left_at=null;
  return v_thread;
end
$function$;


DO $preserved_runtime_and_grants$
DECLARE item record; expected text;
BEGIN
 FOR item IN SELECT * FROM contact_functions_before LOOP
  expected:=CASE item.signature
   WHEN 'public.msg_list_users(uuid)' THEN replace(item.definition,'public.msg_is_runtime_user(mu.id)','public.msg_is_contact_user(mu.id)')
   WHEN 'public.msg_create_group_thread_v2(uuid,text,uuid[],text)' THEN replace(item.definition,'public.msg_is_runtime_user(selected.member_id)','public.msg_is_contact_user(selected.member_id)')
   ELSE item.definition END;
  IF pg_get_functiondef(to_regprocedure(item.signature)) IS DISTINCT FROM expected
   OR public.custodial_release_authority_current_grant_definition(item.signature) IS DISTINCT FROM item.grants
  THEN RAISE EXCEPTION 'Contact repair changed unrelated function metadata, body or privileges: %',item.signature; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.msg_is_contact_user(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.msg_is_contact_user(uuid)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.msg_is_contact_user(uuid)','EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid='public.msg_is_contact_user(uuid)'::regprocedure AND
   (a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee NOT IN(p.proowner,(SELECT oid FROM pg_roles WHERE rolname='service_role'))))
 THEN RAISE EXCEPTION 'Contact helper grants exceed existing service boundary'; END IF;
END
$preserved_runtime_and_grants$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $rebind$
DECLARE identity text;kind text;definition text;affected integer;first_order integer;next_order integer;
BEGIN
 definition:=pg_get_functiondef('public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure);
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=definition,
 definition_sha256=encode(sha256(convert_to(definition,'UTF8')),'hex'),captured_at=statement_timestamp()
 WHERE CASE WHEN object_kind='function' THEN to_regprocedure(object_identity) END='public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure;
 GET DIAGNOSTICS affected=row_count;IF affected<>1 THEN RAISE EXCEPTION 'Original group recovery row count differs';END IF;
 -- SQL contact helper follows the unchanged runtime function, then the SQL
 -- directory follows its helper. PL/pgSQL group creation keeps its original order.
 FOREACH identity IN ARRAY ARRAY['public.msg_is_contact_user(uuid)','public.msg_list_users(uuid)'] LOOP
  FOREACH kind IN ARRAY ARRAY['function','grant'] LOOP
   definition:=CASE kind WHEN 'function' THEN pg_get_functiondef(to_regprocedure(identity))
    ELSE public.custodial_release_authority_current_grant_definition(identity) END;
   IF definition IS NULL THEN RAISE EXCEPTION 'Contact recovery definition missing';END IF;
   IF kind='function' THEN
    SELECT greatest(100000,coalesce(max(restore_order),100000))+1 INTO first_order FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function';
    SELECT min(n) INTO next_order FROM generate_series(first_order,899998)n WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.restore_order=n);
   ELSE
    SELECT min(n) INTO next_order FROM generate_series(900001,999998)n WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.restore_order=n);
   END IF;
   IF next_order IS NULL THEN RAISE EXCEPTION 'Contact recovery order unavailable';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,kind,identity,definition,encode(sha256(convert_to(definition,'UTF8')),'hex'));
  END LOOP;
 END LOOP;
END
$rebind$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery_after$
DECLARE before_row record;after_row record;identity text;kind text;definition text;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*)+4 FROM contact_inventory_before)
 OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 AND tgname='custodial_disaster_restore_mutation_fence') IS DISTINCT FROM 'O'
 THEN RAISE EXCEPTION 'Contact repair recovery count or guard differs';END IF;
 FOR before_row IN SELECT * FROM contact_inventory_before LOOP
  SELECT * INTO STRICT after_row FROM public.custodial_release_authority_restore_inventory WHERE inventory_id=before_row.inventory_id;
  IF (CASE WHEN before_row.object_kind='function' THEN to_regprocedure(before_row.object_identity)='public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure ELSE false END) THEN
   definition:=pg_get_functiondef('public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure);
   IF after_row.definition_sql IS DISTINCT FROM definition OR after_row.definition_sha256 IS DISTINCT FROM encode(sha256(convert_to(definition,'UTF8')),'hex')
    OR (to_jsonb(after_row)-ARRAY['definition_sql','definition_sha256','captured_at']) IS DISTINCT FROM (to_jsonb(before_row)-ARRAY['definition_sql','definition_sha256','captured_at'])
   THEN RAISE EXCEPTION 'Group recovery postimage or unrelated fields changed';END IF;
  ELSIF to_jsonb(after_row) IS DISTINCT FROM to_jsonb(before_row) THEN RAISE EXCEPTION 'Unrelated contact recovery row changed';END IF;
 END LOOP;
 FOREACH identity IN ARRAY ARRAY['public.msg_is_contact_user(uuid)','public.msg_list_users(uuid)','public.msg_create_group_thread_v2(uuid,text,uuid[],text)'] LOOP
  FOREACH kind IN ARRAY ARRAY['function','grant'] LOOP
   definition:=CASE kind WHEN 'function' THEN pg_get_functiondef(to_regprocedure(identity)) ELSE public.custodial_release_authority_current_grant_definition(identity) END;
   IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE CASE WHEN i.object_kind=kind AND position('(' IN i.object_identity)>0 THEN to_regprocedure(i.object_identity) END=to_regprocedure(identity) AND i.definition_sql=definition
    AND i.definition_sha256=encode(sha256(convert_to(definition,'UTF8')),'hex'))<>1
   THEN RAISE EXCEPTION 'Exact contact recovery binding differs: % %',kind,identity;END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT * FROM contact_canary_before EXCEPT SELECT * FROM public.custodial_release_canary_authority_surface())
 OR EXISTS(SELECT * FROM public.custodial_release_canary_authority_surface() EXCEPT SELECT * FROM contact_canary_before)
 THEN RAISE EXCEPTION 'Contact repair changed unrelated schedule/native canary roots';END IF;
END
$recovery_after$;
