-- H03 recurring semantic generation and common-lock safety net. This is a
-- stale-preview detector, not a daily reshuffler or future invalidation
-- implementation. Confirmation remains unmounted until H04 terminal targets
-- and publication/range validity are implemented in the same transaction.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.static_weekly_recurring_generation (
  singleton boolean primary key default true check(singleton),
  generation bigint not null default 0 check(generation between 0 and 9007199254740991),
  changed_at timestamptz not null default statement_timestamp()
);
insert into public.static_weekly_recurring_generation(singleton) values(true);
alter table public.static_weekly_recurring_generation enable row level security;
alter table public.static_weekly_recurring_generation force row level security;
revoke all on table public.static_weekly_recurring_generation from public,anon,authenticated,
  service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.static_weekly_v15_lock_recurring_mutation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  return null;
end
$function$;

create function public.static_weekly_v15_advance_recurring_generation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if tg_table_name='employees' then
    if tg_op='UPDATE' and new.active is not distinct from old.active
      and new.display_name is not distinct from old.display_name
      and new.employee_code is not distinct from old.employee_code then return null;end if;
    if tg_op='INSERT' and new.employee_code!~'^EMP[0-9]+$' then return null;end if;
    if tg_op='DELETE' and old.employee_code!~'^EMP[0-9]+$' then return null;end if;
    if tg_op='UPDATE' and new.employee_code!~'^EMP[0-9]+$' and old.employee_code!~'^EMP[0-9]+$' then return null;end if;
  elsif tg_table_name='static_weekly_authority_source_documents' then
    -- Registration is immutable evidence, not schedule activation. Retirement
    -- or corruption/change of a selected source does invalidate preview basis.
    if tg_op='INSERT' then return null;end if;
    if tg_op='UPDATE' and new.active is not distinct from old.active
      and new.retired_at is not distinct from old.retired_at
      and new.canonical_source is not distinct from old.canonical_source
      and new.source_digest is not distinct from old.source_digest then return null;end if;
  elsif tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  update public.static_weekly_recurring_generation set generation=generation+1,
    changed_at=statement_timestamp() where singleton;
  if not found then raise exception 'recurring generation singleton is missing';end if;
  return null;
end
$function$;

do $triggers$
declare v_table text;
begin
  foreach v_table in array array['weekly_roster_slots','weekly_roster_slot_incumbencies',
    'weekly_roster_slot_incumbency_closures','weekly_roster_slot_staffing_states',
    'employees','static_weekly_authority_source_documents','weekly_schedule_publications'] loop
    execute format('create trigger trg_recurring_authority_lock before insert or update or delete on public.%I for each statement execute function public.static_weekly_v15_lock_recurring_mutation()',v_table);
    execute format('create trigger trg_recurring_authority_generation after insert or update or delete on public.%I for each row execute function public.static_weekly_v15_advance_recurring_generation()',v_table);
  end loop;
end
$triggers$;

create function public.static_weekly_v15_read_recurring_generation()
returns bigint language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_generation bigint;
begin
  perform public.static_weekly_v3_assert_control_plane();
  select generation into strict v_generation from public.static_weekly_recurring_generation where singleton;
  return v_generation;
end
$function$;
revoke all on function public.static_weekly_v15_lock_recurring_mutation(),
  public.static_weekly_v15_advance_recurring_generation(),public.static_weekly_v15_read_recurring_generation()
  from public,anon,authenticated,service_role,static_weekly_control_plane,
    static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v15_read_recurring_generation() to static_weekly_control_plane;

-- Forward recovery inventory is appended below before the migration commits.
do $surface$
declare v_definition text;v_additions text;
begin
  v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if (length(v_definition)-length(replace(v_definition,'  values','')))/length('  values')<>1 then
    raise exception 'recurring generation canary surface seam changed';
  end if;
  v_additions:=$rows$
 ('relation','public.static_weekly_recurring_generation','recurring semantic generation and serialization'),
 ('function','public.static_weekly_v15_lock_recurring_mutation()','recurring semantic generation and serialization'),
 ('function','public.static_weekly_v15_advance_recurring_generation()','recurring semantic generation and serialization'),
 ('function','public.static_weekly_v15_read_recurring_generation()','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slots.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slots.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbencies.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbencies.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbency_closures.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_incumbency_closures.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_staffing_states.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_roster_slot_staffing_states.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.employees.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.employees.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.static_weekly_authority_source_documents.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.static_weekly_authority_source_documents.trg_recurring_authority_generation','recurring semantic generation and serialization'),
 ('trigger','public.weekly_schedule_publications.trg_recurring_authority_lock','recurring semantic generation and serialization'),
 ('trigger','public.weekly_schedule_publications.trg_recurring_authority_generation','recurring semantic generation and serialization'),
$rows$;
  execute replace(v_definition,'  values','  values'||E'\n'||v_additions);
end
$surface$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
  for obj in with relation_names(name) as (values ('public.static_weekly_recurring_generation')),
    funcs as (select p.oid,'public.'||p.oid::regprocedure::text identity
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (starts_with(p.proname,'static_weekly_v15_')
        or p.oid='public.custodial_release_canary_authority_surface()'::regprocedure)),
    new_triggers as (select t.oid,c.relname,n.nspname,t.tgname,t.tgenabled
      from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and t.tgname in (
        'trg_recurring_authority_lock','trg_recurring_authority_generation')),
    objects as (
      select 1000 bucket,'relation'::text kind,name identity,
        public.custodial_release_authority_current_relation_definition(name) definition from relation_names
      union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
      union all select 200000,'column',r.name||':'||a.attname,
        public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
        from relation_names r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
      union all select 300000,'column_set',name,
        public.custodial_release_authority_current_column_set_definition(name) from relation_names
      union all select 400000,'relation_state',name,
        public.custodial_release_authority_current_relation_state_definition(name) from relation_names
      union all select 500000,'constraint',r.name||':'||c.conname,
        public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
        from relation_names r join pg_constraint c on c.conrelid=r.name::regclass
      union all select 600000,'index','public.'||quote_ident(ci.relname),
        public.custodial_release_authority_current_index_definition('public.'||quote_ident(ci.relname))
        from relation_names r join pg_index i on i.indrelid=r.name::regclass
        join pg_class ci on ci.oid=i.indexrelid
        where not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
      union all select 700000,'trigger',quote_ident(nspname)||'.'||quote_ident(relname)||'.'||quote_ident(tgname),
        'drop trigger if exists '||quote_ident(tgname)||' on '||quote_ident(nspname)||'.'||quote_ident(relname)||'; '
        ||pg_get_triggerdef(oid,true)||'; alter table '||quote_ident(nspname)||'.'||quote_ident(relname)||' '
        ||case tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
        ||' trigger '||quote_ident(tgname)||';' from new_triggers
      union all select 900000,'grant',name,
        public.custodial_release_authority_current_grant_definition(name) from relation_names
      union all select 900000,'grant',identity,
        public.custodial_release_authority_current_grant_definition(identity) from funcs
    ) select * from objects order by bucket,identity loop
    if obj.definition is null then raise exception 'missing recurring confirmation recovery object %',obj.identity;end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and (object_identity=obj.identity or
        case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
          then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
    if not found then
      select coalesce(max(restore_order),obj.bucket)+1 into next_order
        from public.custodial_release_authority_restore_inventory
        where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
