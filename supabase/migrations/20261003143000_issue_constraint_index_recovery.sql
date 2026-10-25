-- Forward-only correction for two redundant, constraint-owned primary-key
-- index entries captured by the Issue and Event transition migrations. The
-- corresponding exact primary-key constraints remain in the restore inventory;
-- restoring either constraint recreates its backing index. Never drop the live
-- index, rewrite history, or broaden recovery rights to correct this catalog.
begin;
set local search_path = pg_catalog, public;

do $repair$
declare
  target record;
  live_index oid;
  live_constraint pg_constraint%rowtype;
  index_entry public.custodial_release_authority_restore_inventory%rowtype;
  constraint_entry public.custodial_release_authority_restore_inventory%rowtype;
  matched integer;
begin
  lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      and tgname='trg_custodial_release_authority_restore_inventory_immutable'
      and tgenabled='O'
  ) then
    raise exception 'release recovery inventory immutability is unavailable';
  end if;

  for target in
    select * from (values
      ('public.maintenance_ticket_outcome_history'::text, 'maintenance_ticket_outcome_history_pkey'::text),
      ('public.events_app_transition_receipts'::text, 'events_app_transition_receipts_pkey'::text)
    ) as expected(relation_identity,constraint_name)
  loop
    select c.* into strict live_constraint from pg_constraint c
    where c.conrelid=to_regclass(target.relation_identity)
      and c.conname=target.constraint_name and c.contype='p';
    live_index:=live_constraint.conindid;
    if live_index is null or live_index=0 or not exists (
      select 1 from pg_index pi join pg_class ix on ix.oid=pi.indexrelid
      join pg_namespace ns on ns.oid=ix.relnamespace
      where pi.indexrelid=live_index and pi.indrelid=live_constraint.conrelid
        and pi.indisprimary and pi.indisunique and ix.relkind='i'
        and ns.nspname='public' and ix.relname=target.constraint_name
    ) then
      raise exception 'expected primary-key backing index is not live: %.%',target.relation_identity,target.constraint_name;
    end if;

    select i.* into strict index_entry
    from public.custodial_release_authority_restore_inventory i
    where i.object_kind='index'
      and i.object_identity in (target.constraint_name,'public.'||target.constraint_name)
      and to_regclass(i.object_identity)=live_index;
    select i.* into strict constraint_entry
    from public.custodial_release_authority_restore_inventory i
    where i.object_kind='constraint'
      and to_regclass(split_part(i.object_identity,':',1))=live_constraint.conrelid
      and substr(i.object_identity,position(':' in i.object_identity)+1)=live_constraint.conname;

    if index_entry.definition_sha256<>public.static_weekly_digest_text(index_entry.definition_sql)
      or index_entry.definition_sql is distinct from public.custodial_release_authority_current_index_definition(index_entry.object_identity)
      or constraint_entry.definition_sha256<>public.static_weekly_digest_text(constraint_entry.definition_sql)
      or constraint_entry.definition_sql is distinct from public.custodial_release_authority_current_constraint_definition(constraint_entry.object_identity)
      or constraint_entry.definition_sql not like 'select public.custodial_release_authority_restore_constraint(%'
    then
      raise exception 'exact primary-key constraint/index recovery definitions do not match live catalog: %.%',target.relation_identity,target.constraint_name;
    end if;
  end loop;

  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for target in
    select * from (values
      ('public.maintenance_ticket_outcome_history'::text, 'maintenance_ticket_outcome_history_pkey'::text),
      ('public.events_app_transition_receipts'::text, 'events_app_transition_receipts_pkey'::text)
    ) as expected(relation_identity,constraint_name)
  loop
    select c.conindid into strict live_index from pg_constraint c
    where c.conrelid=to_regclass(target.relation_identity)
      and c.conname=target.constraint_name and c.contype='p';
    delete from public.custodial_release_authority_restore_inventory i
    where i.object_kind='index'
      and i.object_identity in (target.constraint_name,'public.'||target.constraint_name)
      and to_regclass(i.object_identity)=live_index;
    get diagnostics matched=row_count;
    if matched<>1 then
      raise exception 'expected one redundant constraint-owned index entry: %.%',target.relation_identity,target.constraint_name;
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $repair$;

commit;
