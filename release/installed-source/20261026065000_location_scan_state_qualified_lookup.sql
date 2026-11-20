-- Append294: qualify the inner location lookup without rewriting prior migrations.
-- Preserve all prior293 migration bodies. Correct only the inner table reference.
begin;
do $repair$
declare
  target oid := to_regprocedure('public.get_location_scan_state(text,text)');
  before_definition text;
  after_definition text;
  inventory_identity text;
  inventory_definition text;
  inventory_sha text;
  inventory_count integer;
  changed integer;
  old_seam constant text := '(select id from public.locations where location_code=vls.location_code)';
  new_seam constant text := '(select scan_location.id from public.locations AS scan_location where scan_location.location_code=vls.location_code)';
begin
  if target is null then raise exception 'Location scan-state function is missing'; end if;
  before_definition := pg_get_functiondef(target);
  if length(before_definition)-length(replace(before_definition,old_seam,'')) <> length(old_seam) then
    raise exception 'Location scan-state inner-reference preimage changed';
  end if;
  if position(new_seam in before_definition) <> 0 then
    raise exception 'Location scan-state alias correction already present';
  end if;
  select count(*) into inventory_count
    from public.custodial_release_authority_restore_inventory
    where object_kind='function' and to_regprocedure(object_identity)=target;
  if inventory_count <> 1 then raise exception 'Location scan-state recovery identity is missing or duplicated'; end if;
  select object_identity,definition_sql,definition_sha256
    into strict inventory_identity,inventory_definition,inventory_sha
    from public.custodial_release_authority_restore_inventory
    where object_kind='function' and to_regprocedure(object_identity)=target;
  if inventory_definition is distinct from before_definition
    or inventory_sha is distinct from public.static_weekly_digest_text(before_definition) then
    raise exception 'Location scan-state captured/live recovery definition differs';
  end if;
  if not exists(select 1 from pg_trigger where
    tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable'
    and tgenabled='A') then
    raise exception 'Location scan-state recovery immutability is unavailable';
  end if;
  execute replace(before_definition,old_seam,new_seam);
  after_definition := pg_get_functiondef(target);
  if after_definition is distinct from replace(before_definition,old_seam,new_seam) then
    raise exception 'Location scan-state definition changed outside the selected alias';
  end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  update public.custodial_release_authority_restore_inventory
    set definition_sql=after_definition,
      definition_sha256=public.static_weekly_digest_text(after_definition),
      captured_at=statement_timestamp()
    where object_kind='function' and object_identity=inventory_identity
      and definition_sql=before_definition and definition_sha256=inventory_sha;
  get diagnostics changed=row_count;
  if changed <> 1 then raise exception 'Location scan-state recovery rebind is not singular'; end if;
  alter table public.custodial_release_authority_restore_inventory
    enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
end $repair$;
commit;
