begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- Standalone forward proposal. Main owns the CLI migration, recovery/canonical
-- registration, application and SQL qualification. No legacy row backfill.
-- Input: B2b90b0ff/tree546deed17; original RPC prosrc SHA below is source-derived.
do $group_original_forward$
declare
  v_oid oid := to_regprocedure('public.msg_create_group_thread_v2(uuid,text,uuid[],text)');
  v_before record;
  v_after record;
  v_table_before record;
  v_table_after record;
  v_schema_before record;
  v_schema_after record;
  v_owner_name text;
begin
  if v_oid is null then
    raise exception using errcode='P0001',message='Original group RPC predecessor is missing';
  end if;
  select proowner,proacl,proconfig,prosecdef,prolang,prorettype,proretset,prosrc into strict v_before
  from pg_proc where oid=v_oid;
  if encode(extensions.digest(convert_to(v_before.prosrc,'UTF8'),'sha256'),'hex')
       <> '4ff3d2cf0e033744431f6b43258d63a7b2b5e79c6d09fb15eb19f36728072983'
     or v_before.prosecdef is not true
     or v_before.prolang <> (select oid from pg_language where lanname='plpgsql')
     or v_before.prorettype <> 'public.msg_threads'::regtype
     or v_before.proretset is not false
     or not has_function_privilege('service_role',v_oid,'EXECUTE')
     or exists(select 1 from aclexplode(coalesce(v_before.proacl,acldefault('f',v_before.proowner))) as a
       where a.grantee=0 and a.privilege_type='EXECUTE')
     or has_function_privilege('anon',v_oid,'EXECUTE')
     or has_function_privilege('authenticated',v_oid,'EXECUTE') then
    raise exception using errcode='P0001',message='Original group RPC source or private ACL changed';
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.msg_threads'::regclass
      and attname='original_group_creation' and not attisdropped)
    or to_regprocedure('public.msg_preserve_original_group_creation()') is not null
    or exists(select 1 from pg_trigger where tgrelid='public.msg_threads'::regclass
      and tgname='trg_msg_preserve_original_group_creation')
    or to_regclass('custodial_release_identity.group_original_creations') is not null
    or to_regprocedure('custodial_release_identity.guard_group_original_creation()') is not null then
    raise exception using errcode='P0001',message='Original group binding source already exists; explicit rebind required';
  end if;
  select relowner,relacl,relrowsecurity,relforcerowsecurity into strict v_table_before
  from pg_class where oid='public.msg_threads'::regclass;
  select nspowner,nspacl into strict v_schema_before from pg_namespace
    where nspname='custodial_release_identity';
  select rolname into strict v_owner_name from pg_roles where oid=v_before.proowner;
  if v_owner_name in ('anon','authenticated','service_role','custodial_application_reader')
    or not has_schema_privilege(v_before.proowner,'custodial_release_identity','USAGE')
    or not has_schema_privilege(v_before.proowner,'custodial_release_identity','CREATE') then
    raise exception using errcode='P0001',message='Original group definer private-schema owner path must be explicitly rebound';
  end if;

  -- No FK: original identity survives legitimate thread/user retention purge.
  -- No sequence/default/backfill; only four immutable creation metadata fields.
  execute $ledger_ddl$
    create table custodial_release_identity.group_original_creations(
      creator_uuid uuid not null,
      original_client_thread_id text not null check(length(original_client_thread_id) between 8 and 200
        and original_client_thread_id=btrim(original_client_thread_id)),
      group_uuid uuid not null unique,
      original_tuple jsonb not null check(jsonb_typeof(original_tuple)='object'),
      primary key(creator_uuid,original_client_thread_id)
    )
  $ledger_ddl$;
  execute format('alter table custodial_release_identity.group_original_creations owner to %I',v_owner_name);
  execute 'alter table custodial_release_identity.group_original_creations enable row level security';
  execute 'alter table custodial_release_identity.group_original_creations force row level security';
  execute 'revoke all on custodial_release_identity.group_original_creations from public,anon,authenticated,service_role,custodial_application_reader';
  -- FORCE RLS must not depend on superuser/BYPASSRLS assumptions. This NEW
  -- object admits only the already-existing RPC owner, with no runtime grants.
  execute format('create policy group_original_creation_definer_owner on custodial_release_identity.group_original_creations for all to %I using (true) with check (true)',v_owner_name);

  execute 'alter table public.msg_threads add column original_group_creation jsonb';
  execute $comment$
    comment on column public.msg_threads.original_group_creation is
    'Immutable original group RPC creation tuple; NULL means legacy UNBOUND, never inferred from current membership. Contains exact received title and ordered UUID array, not device/auth authority.'
  $comment$;

  execute $guard_ddl$
create function public.msg_preserve_original_group_creation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $guard_body$
declare
  v_original jsonb;
  v_recipient_count integer;
begin
  if TG_OP='UPDATE' then
    if NEW.original_group_creation is distinct from OLD.original_group_creation
      or (OLD.original_group_creation is not null and
        (NEW.id is distinct from OLD.id
         or NEW.created_by_user_id is distinct from OLD.created_by_user_id
         or NEW.client_thread_id is distinct from OLD.client_thread_id)) then
      raise exception using errcode='23514',message='Original group creation tuple cannot be rewritten, removed or backfilled';
    end if;
    return NEW;
  end if;
  v_original := NEW.original_group_creation;
  if v_original is null then return NEW; end if;
  if jsonb_typeof(v_original) is distinct from 'object' then
    raise exception using errcode='23514',message='Original group creation tuple must be closed';
  end if;
  if not (v_original ?& array['schema','created_by_user_id','client_thread_id','title','member_user_ids'])
    or (v_original - array['schema','created_by_user_id','client_thread_id','title','member_user_ids']) <> '{}'::jsonb
    or v_original->'schema' is distinct from to_jsonb('custodial.group-original-creation.v1'::text)
    or v_original->'created_by_user_id' is distinct from to_jsonb(NEW.created_by_user_id)
    or jsonb_typeof(v_original->'client_thread_id') is distinct from 'string'
    or btrim(v_original->>'client_thread_id') is distinct from NEW.client_thread_id
    or jsonb_typeof(v_original->'title') not in ('null','string')
    or jsonb_typeof(v_original->'member_user_ids') is distinct from 'array'
    or NEW.thread_type <> 'group' then
    raise exception using errcode='23514',message='Original group creation tuple does not match its inserted group';
  end if;
  -- UUID[] can contain NULL/self/duplicate entries under the existing RPC.
  -- Retain that exact received vector; membership still uses the existing
  -- distinct non-NULL non-creator 2..100 recipient validation below.
  if exists(select 1 from jsonb_array_elements(v_original->'member_user_ids') as m(value)
    where jsonb_typeof(m.value) not in ('null','string')
      or (jsonb_typeof(m.value)='string' and
        (m.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception using errcode='23514',message='Original group recipient vector must contain canonical UUID values';
  end if;
  select count(distinct m.value)::integer into v_recipient_count
  from jsonb_array_elements_text(v_original->'member_user_ids') as m(value)
  where m.value is not null and m.value <> NEW.created_by_user_id::text;
  if v_recipient_count < 2 or v_recipient_count > 100 then
    raise exception using errcode='23514',message='Original group recipient limit is invalid';
  end if;
  return NEW;
end
$guard_body$;
  $guard_ddl$;
  -- New trigger-only function gets no public/runtime direct entrypoint.
  execute 'revoke all on function public.msg_preserve_original_group_creation() from public, anon, authenticated, service_role';
  execute 'create trigger trg_msg_preserve_original_group_creation before insert or update on public.msg_threads for each row execute function public.msg_preserve_original_group_creation()';

  execute $ledger_guard_ddl$
create function custodial_release_identity.guard_group_original_creation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $ledger_guard_body$
declare
  v_original jsonb;
  v_recipient_count integer;
begin
  if TG_OP <> 'INSERT' then
    raise exception using errcode='23514',message='Original group ledger cannot be rewritten, removed or truncated';
  end if;
  v_original := NEW.original_tuple;
  if jsonb_typeof(v_original) is distinct from 'object' then
    raise exception using errcode='23514',message='Original group ledger tuple must be closed';
  end if;
  if not (v_original ?& array['schema','created_by_user_id','client_thread_id','title','member_user_ids'])
    or (v_original - array['schema','created_by_user_id','client_thread_id','title','member_user_ids']) <> '{}'::jsonb
    or v_original->'schema' is distinct from to_jsonb('custodial.group-original-creation.v1'::text)
    or v_original->'created_by_user_id' is distinct from to_jsonb(NEW.creator_uuid)
    or jsonb_typeof(v_original->'client_thread_id') is distinct from 'string'
    or btrim(v_original->>'client_thread_id') is distinct from NEW.original_client_thread_id
    or jsonb_typeof(v_original->'title') not in ('null','string')
    or jsonb_typeof(v_original->'member_user_ids') is distinct from 'array' then
    raise exception using errcode='23514',message='Original group ledger tuple is invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(v_original->'member_user_ids') as m(value)
    where jsonb_typeof(m.value) not in ('null','string')
      or (jsonb_typeof(m.value)='string' and
        (m.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception using errcode='23514',message='Original group ledger recipients must be canonical UUID values';
  end if;
  select count(distinct m.value)::integer into v_recipient_count
  from jsonb_array_elements_text(v_original->'member_user_ids') as m(value)
  where m.value is not null and m.value <> NEW.creator_uuid::text;
  if v_recipient_count < 2 or v_recipient_count > 100
    or not exists(select 1 from public.msg_threads t where t.id=NEW.group_uuid
      and t.thread_type='group' and t.created_by_user_id=NEW.creator_uuid
      and t.client_thread_id=NEW.original_client_thread_id
      and t.original_group_creation=NEW.original_tuple) then
    raise exception using errcode='23514',message='Original group ledger must bind its actual newly inserted group';
  end if;
  return NEW;
end
$ledger_guard_body$;
  $ledger_guard_ddl$;
  execute format('alter function custodial_release_identity.guard_group_original_creation() owner to %I',v_owner_name);
  execute 'revoke all on function custodial_release_identity.guard_group_original_creation() from public,anon,authenticated,service_role,custodial_application_reader';
  execute 'create trigger group_original_creation_immutable before insert or update or delete on custodial_release_identity.group_original_creations for each row execute function custodial_release_identity.guard_group_original_creation()';
  execute 'create trigger group_original_creation_no_truncate before truncate on custodial_release_identity.group_original_creations for each statement execute function custodial_release_identity.guard_group_original_creation()';
  execute 'alter table custodial_release_identity.group_original_creations enable always trigger group_original_creation_immutable';
  execute 'alter table custodial_release_identity.group_original_creations enable always trigger group_original_creation_no_truncate';

  execute $rpc_ddl$
create or replace function public.msg_create_group_thread_v2(
  p_created_by_user_id uuid,
  p_title text,
  p_member_user_ids uuid[],
  p_client_thread_id text
)
returns public.msg_threads
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $rpc_body$
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
    where not public.msg_is_runtime_user(selected.member_id)) then
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
$rpc_body$;
  $rpc_ddl$;

  select proowner,proacl,proconfig,prosecdef,prolang,prorettype,proretset into strict v_after
  from pg_proc where oid=v_oid;
  select relowner,relacl,relrowsecurity,relforcerowsecurity into strict v_table_after
  from pg_class where oid='public.msg_threads'::regclass;
  select nspowner,nspacl into strict v_schema_after from pg_namespace
    where nspname='custodial_release_identity';
  if v_after.proowner is distinct from v_before.proowner
    or v_after.proacl is distinct from v_before.proacl
    or v_after.proconfig is distinct from v_before.proconfig
    or v_after.prosecdef is distinct from v_before.prosecdef
    or v_after.prolang is distinct from v_before.prolang
    or v_after.prorettype is distinct from v_before.prorettype
    or v_after.proretset is distinct from v_before.proretset
    or v_table_after.relowner is distinct from v_table_before.relowner
    or v_table_after.relacl is distinct from v_table_before.relacl
    or v_table_after.relrowsecurity is distinct from v_table_before.relrowsecurity
    or v_table_after.relforcerowsecurity is distinct from v_table_before.relforcerowsecurity
    or v_schema_after.nspowner is distinct from v_schema_before.nspowner
    or v_schema_after.nspacl is distinct from v_schema_before.nspacl then
    raise exception using errcode='P0001',message='Original group RPC/table owner, ACL or authority configuration changed';
  end if;
  -- New invoker guards must belong to the same preserved original RPC owner,
  -- not whichever bootstrap role happened to execute this local migration.
  -- Their existing runtime EXECUTE revocations remain unchanged.
  execute format('alter function public.msg_preserve_original_group_creation() owner to %I',v_owner_name);
  execute format('alter function custodial_release_identity.guard_group_original_creation() owner to %I',v_owner_name);
  -- The existing public-schema function defaults also grant postgres EXECUTE.
  -- Actual isolated catalog rejection identified that extra ACL on the NEW
  -- public guard. Remove only this exact grant; preserve original RPC/schema
  -- ACLs and the existing original-owner privilege.
  if v_owner_name <> 'postgres' then
    execute 'revoke all on function public.msg_preserve_original_group_creation() from postgres';
  end if;
  if exists(select 1 from aclexplode(coalesce(
      (select relacl from pg_class where oid='custodial_release_identity.group_original_creations'::regclass),
      acldefault('r',v_before.proowner))) a where a.grantee<>v_before.proowner)
    or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role','custodial_application_reader')
      and has_table_privilege(r.oid,'custodial_release_identity.group_original_creations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    or not exists(select 1 from pg_class where oid='custodial_release_identity.group_original_creations'::regclass
      and relowner=v_before.proowner and relrowsecurity and relforcerowsecurity)
    or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid in ('public.msg_preserve_original_group_creation()'::regprocedure,
        'custodial_release_identity.guard_group_original_creation()'::regprocedure)
      and a.grantee<>p.proowner and a.privilege_type='EXECUTE')
    or not exists(select 1 from pg_proc where oid='custodial_release_identity.guard_group_original_creation()'::regprocedure
      and proowner=v_before.proowner and not prosecdef)
    or (select count(*) from pg_policy where polrelid='custodial_release_identity.group_original_creations'::regclass)<>1
    or not exists(select 1 from pg_policy where polrelid='custodial_release_identity.group_original_creations'::regclass
      and polname='group_original_creation_definer_owner' and polroles=array[v_before.proowner]
      and polcmd='*' and polpermissive and pg_get_expr(polqual,polrelid)='true' and pg_get_expr(polwithcheck,polrelid)='true') then
    raise exception using errcode='P0001',message='Original group private ledger owner-only FORCE RLS/ACL contract changed',
      detail=jsonb_build_object(
        'original_owner',v_owner_name,
        'ledger',(select jsonb_build_object('owner',relowner::regrole::text,'acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity)
          from pg_class where oid='custodial_release_identity.group_original_creations'::regclass),
        'runtime_effective_access',(select jsonb_agg(jsonb_build_object('role',r.rolname,'superuser',r.rolsuper,'bypass_rls',r.rolbypassrls,
          'table_access',has_table_privilege(r.oid,'custodial_release_identity.group_original_creations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
          from pg_roles r where r.rolname in ('anon','authenticated','service_role','custodial_application_reader')),
        'guards',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'owner',p.proowner::regrole::text,'acl',p.proacl::text,'definer',p.prosecdef))
          from pg_proc p where p.oid in('public.msg_preserve_original_group_creation()'::regprocedure,'custodial_release_identity.guard_group_original_creation()'::regprocedure)),
        'policy',(select jsonb_agg(jsonb_build_object('name',polname,'roles',polroles,'command',polcmd,'permissive',polpermissive,
          'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)))
          from pg_policy where polrelid='custodial_release_identity.group_original_creations'::regclass)
      )::text;
  end if;
end
$group_original_forward$;
-- Append BEFORE the owning migration's final COMMIT, in its same transaction.
-- Input B2b90b0ffb5290dc5c8364c3a6bbd913327f6fc03 / tree546deed170de4490f072b8f84e6e19a35eccbc7c.
-- Revised owning core B d38608ec84e112ed53360eb8db1eba8204e81bd6 / tree61be1f42046d672aca5358ba492746aa6c078160.
-- Owning migration SHA256 24c9bcc6cf7dcef14420659df334db3f626c2a45316d1f5fd348c1103b9b8596.
-- Exact source270 registration, not catalog adoption, data restoration or a
-- privilege/owner change. Existing rows survive metadata replay. Lost ledger
-- DATA (including purged-group originals) needs a separate owning restore
-- admission: the INSERT guard deliberately cannot infer those originals.
set local search_path=pg_catalog,public,extensions;
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temp table group_recovery_before on commit drop as
 select * from public.custodial_release_authority_restore_inventory;
create temp table group_surface_before on commit drop as
 select * from public.custodial_release_canary_authority_surface();
create temp table group_surface_function_before on commit drop as
 select oid,proowner,proacl,pg_get_functiondef(oid) definition from pg_proc
 where oid='public.custodial_release_canary_authority_surface()'::regprocedure;

do $group_recovery_predecessor$
declare
 ledger regclass:='custodial_release_identity.group_original_creations'::regclass;
 rpc regprocedure:='public.msg_create_group_thread_v2(uuid,text,uuid[],text)'::regprocedure;
 owner_oid oid; item record; current_sql text; prior_sql text;
begin
 select proowner into strict owner_oid from pg_proc where oid=rpc;
 if exists(select 1 from group_recovery_before where definition_sha256 is distinct from public.static_weekly_digest_text(definition_sql))
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A')
  or (select count(*) from group_recovery_before where object_kind='function' and position('(' in object_identity)>0
    and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    and definition_sql=(select definition from group_surface_function_before))<>1
  or exists(select 1 from group_recovery_before where object_kind in ('function','grant') and position('(' in object_identity)>0
    and to_regprocedure(object_identity)=rpc)
  or exists(select 1 from group_surface_before where object_kind in ('function','grant') and position('(' in object_identity)>0
    and to_regprocedure(object_identity)=rpc)
  or exists(select 1 from group_surface_before where object_kind in ('relation','column_set') and object_identity='public.msg_threads')
 then raise exception 'Original group source-declared recovery predecessor changed'; end if;
 -- The 201550 capture excludes msg_create_group_thread_v2 by its exact
 -- function-root selection. The same capture DOES reach msg_threads through
 -- its bidirectional FK closure. Later Messenger reader capture changes only
 -- grants/policies. Require those actual 0/1 memberships, never guessed aliases.
 for item in select * from (values
   ('relation','public.msg_threads'),('column_set','public.msg_threads'),('grant','public.msg_threads')
 ) expected(kind,identity) loop
  if (select count(*) from group_recovery_before where object_kind=item.kind and object_identity=item.identity)<>1
    or (select count(*) from group_recovery_before where object_kind=item.kind
      and case when object_kind in ('relation','column_set','grant') and position('(' in object_identity)=0
        then to_regclass(object_identity) end='public.msg_threads'::regclass)<>1 then
   raise exception 'Original group existing thread recovery membership changed: %',item.kind;
  end if;
  select definition_sql into strict prior_sql from group_recovery_before
   where object_kind=item.kind and object_identity=item.identity;
  current_sql:=case item.kind
   when 'relation' then public.custodial_release_authority_current_relation_definition(item.identity)
   when 'column_set' then public.custodial_release_authority_current_column_set_definition(item.identity)
   when 'grant' then public.custodial_release_authority_current_grant_definition(item.identity) end;
  if item.kind='relation' then
   if (length(current_sql)-length(replace(current_sql,E'  original_group_creation jsonb,\n','')))
       <>length(E'  original_group_creation jsonb,\n') then raise exception 'Original group exact new column declaration changed'; end if;
   current_sql:=replace(current_sql,E'  original_group_creation jsonb,\n','');
  elsif item.kind='column_set' then
   if (length(current_sql)-length(replace(current_sql,'''original_group_creation'',','')))
       <>length('''original_group_creation'',') then raise exception 'Original group exact new column-set declaration changed'; end if;
   current_sql:=replace(current_sql,'''original_group_creation'',','');
  end if;
  if current_sql is distinct from prior_sql then raise exception 'Original group unrelated thread structure/ACL changed: %',item.kind; end if;
 end loop;
 if not exists(select 1 from pg_class where oid=ledger and relkind='r' and relpersistence='p'
     and relowner=owner_oid and relrowsecurity and relforcerowsecurity)
  or owner_oid is distinct from (select proowner from pg_proc
    where oid='public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure)
  or (select array_agg(attname::text order by attnum) from pg_attribute where attrelid=ledger and attnum>0 and not attisdropped)
    is distinct from array['creator_uuid','original_client_thread_id','group_uuid','original_tuple']::text[]
  or (select array_agg(atttypid order by attnum) from pg_attribute where attrelid=ledger and attnum>0 and not attisdropped)
    is distinct from array['uuid'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'jsonb'::regtype::oid]
  or exists(select 1 from pg_attribute where attrelid=ledger and attnum>0 and not attisdropped
    and (not attnotnull or attacl is not null or attidentity<>'' or attgenerated<>''))
  or exists(select 1 from pg_attrdef where adrelid=ledger)
  or (select count(*) from pg_constraint where conrelid=ledger)<>4
  or exists(select 1 from pg_constraint where conrelid=ledger and (not convalidated or
    (conname,contype::text) not in (('group_original_creations_pkey','p'),('group_original_creations_group_uuid_key','u'),
      ('group_original_creations_original_client_thread_id_check','c'),('group_original_creations_original_tuple_check','c'))))
  or exists(select 1 from pg_index i where i.indrelid=ledger
    and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid))
  or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid=ledger and a.grantee<>c.relowner)
  or (select count(*) from pg_policy where polrelid=ledger)<>1
  or not exists(select 1 from pg_policy where polrelid=ledger and polname='group_original_creation_definer_owner'
    and polroles=array[owner_oid] and polcmd='*' and polpermissive
    and pg_get_expr(polqual,polrelid)='true' and pg_get_expr(polwithcheck,polrelid)='true')
  or not exists(select 1 from pg_attribute where attrelid='public.msg_threads'::regclass
    and attname='original_group_creation' and attnum>0 and not attisdropped
    and atttypid='jsonb'::regtype and not attnotnull and attacl is null and attidentity='' and attgenerated='')
  or exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where d.adrelid='public.msg_threads'::regclass and a.attname='original_group_creation')
 then raise exception 'Original group exact private ledger/column/owner path changed'; end if;
 -- Existing serializers omit OWNER. Same original definer owner is required
 -- for re-creation; this is NOT an arbitrary owner-drift repair contract.
 for item in select * from (values
  ('public.msg_create_group_thread_v2(uuid,text,uuid[],text)','b9a57dfcac7d5ab3d7f8070b293ca1852974a5c8c691de58db1409cb945bfb4d',true,'public.msg_threads'::regtype::oid),
  ('public.msg_preserve_original_group_creation()','d68b6be9b3583b1b8662deae2f9c5be465641a19330992c5d65518cb175fb23f',false,'trigger'::regtype::oid),
  ('custodial_release_identity.guard_group_original_creation()','29708f9ca161950f4e3b4b71b2e7dd85b2f31a6031407a353635713678a3386f',false,'trigger'::regtype::oid)
 ) expected(identity,prosrc_sha256,definer,result_type) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.identity)
    and p.proowner=owner_oid and p.prosecdef=item.definer and p.prorettype=item.result_type and not p.proretset
    and p.provolatile='v' and p.proparallel='u' and not p.proleakproof
    and p.prolang=(select oid from pg_language where lanname='plpgsql')
    and p.proconfig=array['search_path=pg_catalog, public, extensions']::text[]
    and public.static_weekly_digest_text(p.prosrc)=item.prosrc_sha256) then
   raise exception 'Original group exact routine source/owner changed: %',item.identity; end if;
  if item.definer then
   if not has_function_privilege('service_role',to_regprocedure(item.identity),'EXECUTE')
     or has_function_privilege('anon',to_regprocedure(item.identity),'EXECUTE')
     or has_function_privilege('authenticated',to_regprocedure(item.identity),'EXECUTE') then
    raise exception 'Original group existing RPC ACL changed'; end if;
  elsif exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=to_regprocedure(item.identity) and a.grantee<>p.proowner) then
   raise exception 'Original group private guard ACL changed'; end if;
 end loop;
 if (select count(*) from pg_trigger where tgrelid=ledger and not tgisinternal)<>2
  or not exists(select 1 from pg_trigger where tgrelid=ledger and tgname='group_original_creation_immutable'
    and not tgisinternal and tgenabled='A' and tgtype=31 and tgqual is null and octet_length(tgargs)=0
    and tgfoid='custodial_release_identity.guard_group_original_creation()'::regprocedure)
  or not exists(select 1 from pg_trigger where tgrelid=ledger and tgname='group_original_creation_no_truncate'
    and not tgisinternal and tgenabled='A' and tgtype=34 and tgqual is null and octet_length(tgargs)=0
    and tgfoid='custodial_release_identity.guard_group_original_creation()'::regprocedure)
  or not exists(select 1 from pg_trigger where tgrelid='public.msg_threads'::regclass
    and tgname='trg_msg_preserve_original_group_creation' and not tgisinternal and tgenabled='O'
    and tgtype=23 and tgqual is null and octet_length(tgargs)=0
    and tgfoid='public.msg_preserve_original_group_creation()'::regprocedure)
 then raise exception 'Original group original trigger scope/enabled state changed'; end if;
end $group_recovery_predecessor$;

create temp table group_recovery_objects(
 bucket integer not null,priority integer not null,kind text not null,identity text not null,definition text not null,
 existed boolean not null default false,primary key(kind,identity)
) on commit drop;
insert into group_recovery_objects(bucket,priority,kind,identity,definition)
 select 1000,0,'relation','custodial_release_identity.group_original_creations',
  public.custodial_release_authority_current_relation_definition('custodial_release_identity.group_original_creations')
 union all select 300000,0,'column_set','custodial_release_identity.group_original_creations',
  public.custodial_release_authority_current_column_set_definition('custodial_release_identity.group_original_creations')
 union all select 400000,0,'relation_state','custodial_release_identity.group_original_creations',
  public.custodial_release_authority_current_relation_state_definition('custodial_release_identity.group_original_creations')
 union all select 800000,0,'policy','custodial_release_identity.group_original_creations:group_original_creation_definer_owner',
  public.custodial_release_authority_current_policy_definition('custodial_release_identity.group_original_creations:group_original_creation_definer_owner')
 union all select 900000,0,'grant','custodial_release_identity.group_original_creations',
  public.custodial_release_authority_current_grant_definition('custodial_release_identity.group_original_creations')
 union all select 200000,0,'column','public.msg_threads:original_group_creation',
  public.custodial_release_authority_current_column_definition('public.msg_threads:original_group_creation');
insert into group_recovery_objects(bucket,priority,kind,identity,definition)
 select 200000,a.attnum,'column','custodial_release_identity.group_original_creations:'||a.attname,
  public.custodial_release_authority_current_column_definition('custodial_release_identity.group_original_creations:'||a.attname)
 from pg_attribute a where a.attrelid='custodial_release_identity.group_original_creations'::regclass and a.attnum>0 and not a.attisdropped;
insert into group_recovery_objects(bucket,priority,kind,identity,definition)
 select 500000,case c.contype when 'p' then 0 when 'u' then 1 else 2 end,'constraint',
  'custodial_release_identity.group_original_creations:'||c.conname,
  public.custodial_release_authority_current_constraint_definition('custodial_release_identity.group_original_creations:'||c.conname)
 from pg_constraint c where c.conrelid='custodial_release_identity.group_original_creations'::regclass;
-- Constraint-owned indexes are restored by the exact PK/UNIQUE declarations.
insert into group_recovery_objects(bucket,priority,kind,identity,definition)
 select 100000,0,'function',identity,pg_get_functiondef(to_regprocedure(identity))
 from (values ('public.msg_create_group_thread_v2(uuid,text,uuid[],text)'),
  ('public.msg_preserve_original_group_creation()'),('custodial_release_identity.guard_group_original_creation()')) wanted(identity)
 union all select 1000000,0,'grant',identity,public.custodial_release_authority_current_grant_definition(identity)
 from (values ('public.msg_create_group_thread_v2(uuid,text,uuid[],text)'),
  ('public.msg_preserve_original_group_creation()'),('custodial_release_identity.guard_group_original_creation()')) wanted(identity);
insert into group_recovery_objects(bucket,priority,kind,identity,definition)
 select 700000,0,'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,
  'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '
   ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '
   ||case t.tgenabled when 'A' then 'enable always' when 'O' then 'enable' end||' trigger '||quote_ident(t.tgname)||';'
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where not t.tgisinternal and (t.tgrelid='custodial_release_identity.group_original_creations'::regclass
  or (t.tgrelid='public.msg_threads'::regclass and t.tgname='trg_msg_preserve_original_group_creation'));
insert into group_recovery_objects(bucket,priority,kind,identity,definition,existed)
 select 1000,0,'relation','public.msg_threads',public.custodial_release_authority_current_relation_definition('public.msg_threads'),true
 union all select 300000,0,'column_set','public.msg_threads',public.custodial_release_authority_current_column_set_definition('public.msg_threads'),true;

do $group_recovery_scope$ begin
 if (select count(*) from group_recovery_objects)<>25
  or (select count(*) from group_recovery_objects where not existed)<>23
  or exists(select 1 from group_recovery_objects n join group_recovery_before old
    on old.object_kind=n.kind and old.object_identity=n.identity where not n.existed)
  or exists(select 1 from group_recovery_objects n join group_surface_before old
    on old.object_kind=n.kind and old.object_identity=n.identity)
  or exists(select 1 from group_recovery_before old where old.object_kind in ('function','grant') and position('(' in old.object_identity)>0
    and to_regprocedure(old.object_identity) in ('public.msg_preserve_original_group_creation()'::regprocedure,
      'custodial_release_identity.guard_group_original_creation()'::regprocedure))
  or exists(select 1 from group_recovery_before old where case
    when old.object_kind in ('relation','column_set','relation_state','grant') and position('(' in old.object_identity)=0
      then to_regclass(old.object_identity)
    when old.object_kind in ('column','constraint','policy') then to_regclass(split_part(old.object_identity,':',1))
    end='custodial_release_identity.group_original_creations'::regclass)
 then raise exception 'Original group exact new registration/aliases were not absent'; end if;
end $group_recovery_scope$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $group_recovery_register$
declare o record; next_order integer; limit_order integer; changed integer;
 before text; after text; additions text:='';surface regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
begin
 for o in select * from group_recovery_objects order by bucket,priority,kind,identity loop
  if o.existed then
   update public.custodial_release_authority_restore_inventory set definition_sql=o.definition,
    definition_sha256=public.static_weekly_digest_text(o.definition),captured_at=statement_timestamp()
    where object_kind=o.kind and object_identity=o.identity;
   get diagnostics changed=row_count; if changed<>1 then raise exception 'Original group exact prior registration missing'; end if;
  else
   limit_order:=case when o.bucket=1000 then 100000 else o.bucket+100000 end;
   select candidate into next_order from generate_series(o.bucket,limit_order-1) candidate
    where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=candidate)
    order by candidate limit 1;
   if next_order is null then raise exception 'Original group recovery bucket exhausted'; end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,o.kind,o.identity,o.definition,public.static_weekly_digest_text(o.definition));
  end if;
  additions:=additions||format(E'    (%L,%L,%L),\n',o.kind,o.identity,'exact source270 retained original group recovery');
 end loop;
 select definition into strict before from group_surface_function_before;
 if (length(before)-length(replace(before,'  values','')))/length('  values')<>1 then
  raise exception 'Original group exact canary VALUES predecessor changed'; end if;
 after:=replace(before,'  values',E'  values\n'||additions); execute after;
 if pg_get_functiondef(surface) is distinct from after
  or (select proowner from pg_proc where oid=surface) is distinct from (select proowner from group_surface_function_before)
  or (select proacl from pg_proc where oid=surface) is distinct from (select proacl from group_surface_function_before)
 then raise exception 'Original group canary source/owner/ACL changed'; end if;
 update public.custodial_release_authority_restore_inventory set definition_sql=after,
  definition_sha256=public.static_weekly_digest_text(after),captured_at=statement_timestamp()
  where object_kind='function' and position('(' in object_identity)>0 and to_regprocedure(object_identity)=surface
   and definition_sql=before and definition_sha256=public.static_weekly_digest_text(before);
 get diagnostics changed=row_count; if changed<>1 then raise exception 'Original group exact canary recovery identity missing'; end if;
end $group_recovery_register$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
do $group_recovery_final$ begin
 if (select count(*) from public.custodial_release_authority_restore_inventory)<>(select count(*) from group_recovery_before)+23
  or exists(select old.* from group_recovery_before old
    where not exists(select 1 from group_recovery_objects n where n.existed and n.kind=old.object_kind and n.identity=old.object_identity)
      and not(old.object_kind='function' and position('(' in old.object_identity)>0
        and to_regprocedure(old.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
    except select * from public.custodial_release_authority_restore_inventory)
  or exists(select now.* from public.custodial_release_authority_restore_inventory now
    where not exists(select 1 from group_recovery_objects n where n.kind=now.object_kind and n.identity=now.object_identity)
      and not(now.object_kind='function' and position('(' in now.object_identity)>0
        and to_regprocedure(now.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
    except select * from group_recovery_before)
  or exists(select 1 from group_recovery_objects n left join public.custodial_release_authority_restore_inventory i
    on i.object_kind=n.kind and i.object_identity=n.identity where i.inventory_id is null or i.definition_sql is distinct from n.definition
      or i.definition_sha256 is distinct from public.static_weekly_digest_text(n.definition))
  or exists(select old.* from group_surface_before old except select * from public.custodial_release_canary_authority_surface())
  or (select count(*) from public.custodial_release_canary_authority_surface())<>(select count(*) from group_surface_before)+25
  or exists(select 1 from group_recovery_objects n where (select count(*) from public.custodial_release_canary_authority_surface() s
    where s.object_kind=n.kind and s.object_identity=n.identity)<>1)
  or exists(select 1 from public.custodial_release_authority_restore_inventory where definition_sha256 is distinct from public.static_weekly_digest_text(definition_sql))
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A')
 then raise exception 'Original group unrelated inventory/surface or ALWAYS integrity changed'; end if;
end $group_recovery_final$;
commit;
