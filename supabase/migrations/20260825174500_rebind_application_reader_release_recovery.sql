-- Rebind release recovery after the application reader moved from broad table
-- privileges to an explicit, non-secret identity-column projection.  The
-- recovery inventory must preserve that projection and its three FORCE-RLS
-- policies instead of restoring the older no-column-ACL authority shape.

begin;

do $preflight$
declare
  reader_oid oid;
  unexpected_acl_count integer;
begin
  select oid into strict reader_oid
  from pg_roles
  where rolname = 'custodial_application_reader'
    and not rolsuper
    and not rolbypassrls
    and not rolcanlogin;

  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null
     or to_regprocedure('public.custodial_backend_authority_health(text)') is null then
    raise exception 'release recovery authority is unavailable';
  end if;

  select count(*) into unexpected_acl_count
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(a.attacl) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
  where n.nspname = 'public'
    and a.attnum > 0
    and not a.attisdropped
    and a.attacl is not null
    and acl.grantee <> c.relowner
    and not (
      grantee.rolname = 'custodial_application_reader'
      and acl.privilege_type = 'SELECT'
      and not acl.is_grantable
      and (c.relname, a.attname) in (
        ('devices','id'),
        ('devices','device_id'),
        ('devices','device_name'),
        ('devices','active'),
        ('devices','assigned_employee_id'),
        ('devices','last_seen_at'),
        ('devices','created_at'),
        ('devices','updated_at'),
        ('devices','assignment_epoch'),
        ('employees','id'),
        ('employees','employee_code'),
        ('employees','display_name'),
        ('employees','active'),
        ('employees','role'),
        ('employees','created_at'),
        ('employees','updated_at'),
        ('device_aliases','alias_identifier'),
        ('device_aliases','canonical_device_id'),
        ('device_aliases','active'),
        ('device_aliases','source'),
        ('device_aliases','created_at'),
        ('device_aliases','updated_at')
      )
    );

  if unexpected_acl_count <> 0 then
    raise exception 'unexpected public column authority exists outside the admitted application-reader projection';
  end if;

  if (
    select count(*)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) acl
    where n.nspname = 'public'
      and a.attnum > 0
      and not a.attisdropped
      and a.attacl is not null
      and acl.grantee = reader_oid
      and acl.privilege_type = 'SELECT'
      and not acl.is_grantable
  ) <> 22 then
    raise exception 'the admitted application-reader identity projection is incomplete';
  end if;
end
$preflight$;

-- Keep relation-level and column-level ACLs in one deterministic restoration
-- row.  The existing reset helper already revokes both classes before replay.
create or replace function public.custodial_release_authority_current_grant_definition(p_object_identity text)
returns text language plpgsql stable security invoker set search_path to 'pg_catalog','public'
as $function$
declare
  v_relation oid := to_regclass(p_object_identity);
  v_function oid := to_regprocedure(p_object_identity);
begin
  if v_relation is not null then
    return (
      select 'select public.custodial_release_authority_reset_grants('||quote_literal(p_object_identity)||');'
        || coalesce((
          select string_agg(
            ' grant '||g.privilege_type||' on table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' to '
              ||case when g.grantee=0 then 'public' else quote_ident(r.rolname) end
              ||case when g.is_grantable then ' with grant option' else '' end||';',
            '' order by g.grantee,g.privilege_type,g.is_grantable
          )
          from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g
          left join pg_roles r on r.oid=g.grantee
          where g.grantee<>c.relowner
        ),'')
        || coalesce((
          select string_agg(
            ' grant '||g.privilege_type||' ('||quote_ident(a.attname)||') on table '
              ||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' to '
              ||case when g.grantee=0 then 'public' else quote_ident(r.rolname) end
              ||case when g.is_grantable then ' with grant option' else '' end||';',
            '' order by g.grantee,a.attnum,g.privilege_type,g.is_grantable
          )
          from pg_attribute a
          cross join lateral aclexplode(a.attacl) g
          left join pg_roles r on r.oid=g.grantee
          where a.attrelid=c.oid
            and a.attnum>0
            and not a.attisdropped
            and a.attacl is not null
            and g.grantee<>c.relowner
        ),'')
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where c.oid=v_relation
    );
  end if;
  if v_function is not null then
    return (
      select 'select public.custodial_release_authority_reset_grants('||quote_literal(p_object_identity)||');'
        ||coalesce((
          select string_agg(
            ' grant execute on function '||p.oid::regprocedure::text||' to '
              ||case when a.grantee=0 then 'public' else quote_ident(r.rolname) end
              ||case when a.is_grantable then ' with grant option' else '' end||';',
            '' order by a.grantee,a.is_grantable
          )
          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          left join pg_roles r on r.oid=a.grantee
          where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
        ),'')
      from pg_proc p
      where p.oid=v_function
    );
  end if;
  return null;
end
$function$;

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_missing text[];
  v_mismatched text[];
  v_surface_missing text[];
  v_surface_uncovered text[];
  v_checks jsonb;
  v_ok boolean;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select array_agg(s.object_identity order by s.object_kind,s.object_identity) into v_surface_missing
  from public.custodial_release_canary_authority_surface() s
  where (s.object_kind='function' and to_regprocedure(s.object_identity) is null)
     or (s.object_kind='relation' and to_regclass(s.object_identity) is null);
  select array_agg(s.object_identity order by s.object_kind,s.object_identity) into v_surface_uncovered
  from public.custodial_release_canary_authority_surface() s
  where not exists(
    select 1 from public.custodial_release_authority_restore_inventory i
    where i.object_kind=s.object_kind and i.object_identity=s.object_identity
  );
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_missing
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is null)
     or (i.object_kind='relation' and public.custodial_release_authority_current_relation_definition(i.object_identity) is null)
     or (i.object_kind='column' and public.custodial_release_authority_current_column_definition(i.object_identity) is null)
     or (i.object_kind='column_set' and public.custodial_release_authority_current_column_set_definition(i.object_identity) is null)
     or (i.object_kind='constraint' and public.custodial_release_authority_current_constraint_definition(i.object_identity) is null)
     or (i.object_kind='index' and public.custodial_release_authority_current_index_definition(i.object_identity) is null)
     or (i.object_kind='trigger' and not exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal))
     or (i.object_kind='policy' and public.custodial_release_authority_current_policy_definition(i.object_identity) is null)
     or (i.object_kind='relation_state' and public.custodial_release_authority_current_relation_state_definition(i.object_identity) is null)
     or (i.object_kind='grant' and public.custodial_release_authority_current_grant_definition(i.object_identity) is null);
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_mismatched
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is not null and encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(i.object_identity)),'UTF8'),'sha256'),'hex')<>i.definition_sha256)
     or (i.object_kind='relation' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_relation_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='column' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_column_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='column_set' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_column_set_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='constraint' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_constraint_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='index' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_index_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='trigger' and exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal and encode(extensions.digest(convert_to('drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';','UTF8'),'sha256'),'hex')<>i.definition_sha256))
     or (i.object_kind='policy' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_policy_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='relation_state' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_relation_state_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='grant' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_grant_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256);
  v_checks:=jsonb_build_object(
    'restore_inventory_present',(select count(*)>40 from public.custodial_release_authority_restore_inventory),
    'restore_inventory_exact',coalesce(cardinality(v_missing),0)=0 and coalesce(cardinality(v_mismatched),0)=0,
    'canary_authority_surface_live',coalesce(cardinality(v_surface_missing),0)=0,
    'canary_authority_surface_captured',coalesce(cardinality(v_surface_uncovered),0)=0,
    'bootstrap_controller_seed_present',exists(select 1 from public.custodial_release_authority_bootstrap_definitions),
    'authority_activation_history',to_regclass('public.custodial_offline_authority_activation_events') is not null
      and to_regprocedure('public.custodial_offline_authority_active_at(text,uuid,timestamptz)') is not null,
    'completion_uuid_constraints',exists(select 1 from pg_constraint where conrelid='public.custodial_offline_reconciliation_records'::regclass and conname='custodial_offline_reconciliation_client_completion_id_uuid')
      and exists(select 1 from pg_constraint where conrelid='public.completion_responses'::regclass and conname='completion_responses_client_completion_id_uuid'),
    'native_finish_scan_authority',exists(
      select 1 from pg_attribute
      where attrelid='public.custodial_offline_actor_contexts'::regclass
        and attname='native_finish_scan_entry_id' and attnum>0 and not attisdropped
    )
      and exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass and conname='custodial_offline_native_completion_evidence_check')
      and exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass and conname='uq_custodial_offline_native_finish_scan_entry')
      and to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)') is not null
      and to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text)') is null
      and not has_function_privilege('anon','public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE'),
    'offline_evidence_direct_dml_denied',not (
      has_table_privilege('service_role','public.custodial_offline_actor_contexts','insert')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','insert')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','insert')
    ),
    'application_reader_identity_projection_bounded',(
      select count(*)=22
        and bool_and(grantee.rolname='custodial_application_reader' and acl.privilege_type='SELECT' and not acl.is_grantable)
        and bool_and((c.relname,a.attname) in (
          ('devices','id'),('devices','device_id'),('devices','device_name'),('devices','active'),
          ('devices','assigned_employee_id'),('devices','last_seen_at'),('devices','created_at'),
          ('devices','updated_at'),('devices','assignment_epoch'),('employees','id'),
          ('employees','employee_code'),('employees','display_name'),('employees','active'),
          ('employees','role'),('employees','created_at'),('employees','updated_at'),
          ('device_aliases','alias_identifier'),('device_aliases','canonical_device_id'),
          ('device_aliases','active'),('device_aliases','source'),('device_aliases','created_at'),
          ('device_aliases','updated_at')
        ))
      from pg_attribute a
      join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(a.attacl) acl
      left join pg_roles grantee on grantee.oid=acl.grantee
      where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null
        and acl.grantee<>c.relowner
    ) and (
      select count(*)=3
      from pg_policy p
      join pg_roles r on r.oid=any(p.polroles)
      where p.polrelid in ('public.devices'::regclass,'public.employees'::regclass,'public.device_aliases'::regclass)
        and p.polname in ('custodial_application_reader_device_identity','custodial_application_reader_employee_identity','custodial_application_reader_device_alias_identity')
        and r.rolname='custodial_application_reader'
        and p.polcmd='r' and p.polpermissive and pg_get_expr(p.polqual,p.polrelid)='true'
    ),
    'alternate_terminal_writers_absent',not exists(
      select 1 from public.custodial_terminal_writer_inventory i
      where i.application_callable and (i.mutates_terminal_truth or i.delegates_alternate_terminal_authority)
        and i.oid is distinct from to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.tool_complete_session_authoritative(text,jsonb,text,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.custodial_finish_historical_session_authoritative(text,text,uuid,timestamptz,text)')
    ),
    'generic_terminal_writer_execute_denied',not exists(
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'run_application_write','run_sql_write','run_sql_migration','force_close_session','tool_force_close_session',
        'purge_closed_scan_history_before','tool_purge_closed_scan_history_before'
      ) and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))
    ),
    'native_timestamp_renderer',public.custodial_canonical_utc_millis('2026-08-13 12:34:56.789123+00'::timestamptz)='2026-08-13T12:34:56.789Z'
  );
  select bool_and(value::boolean) into v_ok from jsonb_each_text(v_checks);
  return jsonb_build_object(
    'ok',coalesce(v_ok,false),'authority','offline-authority.v5',
    'canonical_objects_expected',(select count(*) from public.custodial_release_authority_restore_inventory),
    'canary_surface_objects_expected',(select count(*) from public.custodial_release_canary_authority_surface()),
    'missing_objects',to_jsonb(coalesce(v_missing,array[]::text[])),
    'mismatched_objects',to_jsonb(coalesce(v_mismatched,array[]::text[])),
    'surface_missing_objects',to_jsonb(coalesce(v_surface_missing,array[]::text[])),
    'surface_uncovered_objects',to_jsonb(coalesce(v_surface_uncovered,array[]::text[])),
    'checks',v_checks
  );
end
$function$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

-- Refresh every existing function and ACL row so the inventory is internally
-- consistent with the new column-aware renderer and health contract.
update public.custodial_release_authority_restore_inventory i
set definition_sql=pg_get_functiondef(to_regprocedure(i.object_identity)),
    definition_sha256=encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(i.object_identity)),'UTF8'),'sha256'),'hex'),
    captured_at=statement_timestamp()
where i.object_kind='function'
  and to_regprocedure(i.object_identity) is not null;

update public.custodial_release_authority_restore_inventory i
set definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity),
    definition_sha256=encode(extensions.digest(convert_to(public.custodial_release_authority_current_grant_definition(i.object_identity),'UTF8'),'sha256'),'hex'),
    captured_at=statement_timestamp()
where i.object_kind='grant';

do $capture_identity_policies$
declare
  identity text;
  next_order integer;
  definition text;
begin
  select coalesce(max(restore_order),800000)+1 into next_order
  from public.custodial_release_authority_restore_inventory
  where object_kind='policy';

  foreach identity in array array[
    'public.device_aliases:custodial_application_reader_device_alias_identity',
    'public.devices:custodial_application_reader_device_identity',
    'public.employees:custodial_application_reader_employee_identity'
  ] loop
    definition := public.custodial_release_authority_current_policy_definition(identity);
    if definition is null then
      raise exception 'required application-reader policy % is missing', identity;
    end if;
    if exists (
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind='policy' and object_identity=identity
    ) then
      update public.custodial_release_authority_restore_inventory
      set definition_sql=definition,
          definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
          captured_at=statement_timestamp()
      where object_kind='policy' and object_identity=identity;
    else
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values (
        next_order,'policy',identity,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
      next_order := next_order+1;
    end if;
  end loop;
end
$capture_identity_policies$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
begin
  if exists (
    select 1 from public.custodial_release_authority_restore_inventory
    where definition_sha256<>encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'release recovery inventory digest mismatch';
  end if;

  if (
    select count(*) from public.custodial_release_authority_restore_inventory
    where object_kind='policy' and object_identity in (
      'public.device_aliases:custodial_application_reader_device_alias_identity',
      'public.devices:custodial_application_reader_device_identity',
      'public.employees:custodial_application_reader_employee_identity'
    )
  ) <> 3 then
    raise exception 'application-reader RLS policy recovery is incomplete';
  end if;

  if not (
    select definition_sql ilike '%grant SELECT (%custodial_application_reader%'
    from public.custodial_release_authority_restore_inventory
    where object_kind='grant' and object_identity='public.devices'
  ) then
    raise exception 'application-reader column authority is absent from release recovery';
  end if;

  if pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure)
       ilike '%authority_column_grants_absent%'
     or pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure)
       not ilike '%application_reader_identity_projection_bounded%' then
    raise exception 'release health still applies the obsolete column-authority contract';
  end if;
end
$postflight$;

commit;
