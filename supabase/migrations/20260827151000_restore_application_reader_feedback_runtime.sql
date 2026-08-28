-- The canonical feedback writer already commits through
-- app_apply_operational_command, but the dedicated application reader could
-- not observe the committed row through FORCE RLS. That made a successful
-- submission return 500 and also broke idempotent replay. Admit only the
-- reviewed feedback runtime columns; private legacy image backups remain
-- outside the application reader.

begin;

do $preflight$
declare
  reader pg_roles%rowtype;
begin
  select * into strict reader
  from pg_roles
  where rolname = 'custodial_application_reader';

  if reader.rolsuper or reader.rolbypassrls or reader.rolcanlogin then
    raise exception 'custodial_application_reader is not the admitted restricted role';
  end if;

  if to_regclass('public.system_feedback_items') is null
     or to_regclass('public.system_feedback_legacy_image_backups') is null then
    raise exception 'Required feedback runtime relations are unavailable';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'system_feedback_items'
      and c.relkind = 'r'
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception 'public.system_feedback_items must retain enabled and forced RLS';
  end if;

  if exists (
    select 1
    from pg_policy p
    where p.polrelid = 'public.system_feedback_items'::regclass
      and reader.oid = any(p.polroles)
  ) then
    raise exception 'Unexpected application-reader feedback policy exists before cutover';
  end if;

  if to_regprocedure('public.app_get_public_rate_limit_count(text,text)') is null
     or to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null
     or to_regprocedure('public.custodial_release_authority_current_policy_definition(text)') is null then
    raise exception 'Feedback or release-recovery authority is unavailable';
  end if;
end
$preflight$;

revoke all privileges on table public.system_feedback_items
  from custodial_application_reader;
revoke all privileges on table public.system_feedback_legacy_image_backups
  from custodial_application_reader;

grant select (
  id,
  operation_id,
  request_fingerprint,
  category,
  priority,
  message,
  submitted_by,
  hub_context,
  device_id,
  page_url,
  status,
  summary,
  notification_status,
  notified_ops_count,
  last_feedback_reminder_at,
  feedback_reminder_count,
  acknowledged_at,
  acknowledged_by,
  metadata_json,
  created_at,
  updated_at
) on table public.system_feedback_items to custodial_application_reader;

create policy custodial_application_reader_system_feedback_runtime
  on public.system_feedback_items as permissive for select
  to custodial_application_reader using (true);

-- A restore rehearsal must reproduce both the fixed feedback projection and
-- the bounded public-ingest count function introduced immediately before it.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $capture_feedback_function$
declare
  identity text := to_regprocedure('public.app_get_public_rate_limit_count(text,text)')::text;
  definition text;
  next_order integer;
begin
  definition := pg_get_functiondef(to_regprocedure('public.app_get_public_rate_limit_count(text,text)'));
  if definition is null then
    raise exception 'Bounded feedback rate-count function is unavailable';
  end if;
  if exists (
    select 1 from public.custodial_release_authority_restore_inventory
    where object_kind = 'function' and object_identity = identity
  ) then
    update public.custodial_release_authority_restore_inventory
    set definition_sql = definition,
        definition_sha256 = encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
        captured_at = statement_timestamp()
    where object_kind = 'function' and object_identity = identity;
  else
    select coalesce(max(restore_order),100000) + 1 into next_order
    from public.custodial_release_authority_restore_inventory
    where object_kind = 'function';
    insert into public.custodial_release_authority_restore_inventory(
      restore_order, object_kind, object_identity, definition_sql, definition_sha256
    ) values (
      next_order, 'function', identity, definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
    );
  end if;
end
$capture_feedback_function$;

do $capture_feedback_grants$
declare
  identity text;
  definition text;
  next_order integer;
begin
  foreach identity in array array[
    'public.system_feedback_items',
    'public.app_get_public_rate_limit_count(text,text)'
  ] loop
    definition := public.custodial_release_authority_current_grant_definition(identity);
    if definition is null then
      raise exception 'Feedback grant definition % is unavailable', identity;
    end if;
    if exists (
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind = 'grant' and object_identity = identity
    ) then
      update public.custodial_release_authority_restore_inventory
      set definition_sql = definition,
          definition_sha256 = encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
          captured_at = statement_timestamp()
      where object_kind = 'grant' and object_identity = identity;
    else
      select coalesce(max(restore_order),1000000) + 1 into next_order
      from public.custodial_release_authority_restore_inventory
      where object_kind = 'grant';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order, object_kind, object_identity, definition_sql, definition_sha256
      ) values (
        next_order, 'grant', identity, definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
    end if;
  end loop;
end
$capture_feedback_grants$;

do $capture_feedback_policy$
declare
  identity text := 'public.system_feedback_items:custodial_application_reader_system_feedback_runtime';
  definition text;
  next_order integer;
begin
  definition := public.custodial_release_authority_current_policy_definition(identity);
  if definition is null then
    raise exception 'Required feedback reader policy is unavailable';
  end if;
  select coalesce(max(restore_order),800000) + 1 into next_order
  from public.custodial_release_authority_restore_inventory
  where object_kind = 'policy';
  insert into public.custodial_release_authority_restore_inventory(
    restore_order, object_kind, object_identity, definition_sql, definition_sha256
  ) values (
    next_order, 'policy', identity, definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
  );
end
$capture_feedback_policy$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
declare
  reader_oid oid;
  admitted_columns text[] := array[
    'acknowledged_at','acknowledged_by','category','created_at','device_id',
    'feedback_reminder_count','hub_context','id','last_feedback_reminder_at',
    'message','metadata_json','notification_status','notified_ops_count',
    'operation_id','page_url','priority','request_fingerprint','status',
    'submitted_by','summary','updated_at'
  ];
begin
  select oid into strict reader_oid
  from pg_roles
  where rolname = 'custodial_application_reader';

  if has_table_privilege('custodial_application_reader','public.system_feedback_items','select')
     or has_table_privilege('custodial_application_reader','public.system_feedback_items','insert')
     or has_table_privilege('custodial_application_reader','public.system_feedback_items','update')
     or has_table_privilege('custodial_application_reader','public.system_feedback_items','delete') then
    raise exception 'Feedback reader retained relation-level or mutation authority';
  end if;

  if (
    select array_agg(a.attname::text order by a.attname::text)
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) acl
    where a.attrelid = 'public.system_feedback_items'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attacl is not null
      and acl.grantee = reader_oid
      and acl.privilege_type = 'SELECT'
      and not acl.is_grantable
  ) is distinct from admitted_columns then
    raise exception 'Feedback reader column projection is not exact';
  end if;

  if (
    select count(*)
    from pg_policy p
    where p.polrelid = 'public.system_feedback_items'::regclass
      and reader_oid = any(p.polroles)
      and p.polname = 'custodial_application_reader_system_feedback_runtime'
      and p.polcmd = 'r'
      and p.polpermissive
      and pg_get_expr(p.polqual,p.polrelid) = 'true'
  ) <> 1 then
    raise exception 'Feedback reader RLS policy is invalid';
  end if;

  if has_table_privilege('custodial_application_reader','public.system_feedback_legacy_image_backups','select')
     or exists (
       select 1
       from pg_attribute a
       cross join lateral aclexplode(a.attacl) acl
       where a.attrelid = 'public.system_feedback_legacy_image_backups'::regclass
         and a.attnum > 0
         and not a.attisdropped
         and a.attacl is not null
         and acl.grantee = reader_oid
     ) then
    raise exception 'Feedback reader can observe private legacy image backups';
  end if;

  if not has_function_privilege(
       'custodial_application_reader',
       'public.app_get_public_rate_limit_count(text,text)',
       'execute'
     )
     or has_function_privilege('public','public.app_get_public_rate_limit_count(text,text)','execute')
     or has_function_privilege('anon','public.app_get_public_rate_limit_count(text,text)','execute')
     or has_function_privilege('authenticated','public.app_get_public_rate_limit_count(text,text)','execute')
     or has_function_privilege('service_role','public.app_get_public_rate_limit_count(text,text)','execute') then
    raise exception 'Bounded feedback rate-count authority is invalid';
  end if;

  if (
    select count(*)
    from public.custodial_release_authority_restore_inventory
    where (object_kind,object_identity) in (
      ('function',to_regprocedure('public.app_get_public_rate_limit_count(text,text)')::text),
      ('grant','public.app_get_public_rate_limit_count(text,text)'),
      ('grant','public.system_feedback_items'),
      ('policy','public.system_feedback_items:custodial_application_reader_system_feedback_runtime')
    )
  ) <> 4 then
    raise exception 'Feedback release-recovery inventory is incomplete';
  end if;

  if exists (
    select 1 from public.custodial_release_authority_restore_inventory
    where definition_sha256 <> encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'Release recovery inventory digest mismatch';
  end if;
end
$postflight$;

commit;
