begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- Aggregate visitor counts only. Manager mutation authorization is unchanged.
create policy custodial_reader_current_visitor_attendance
on public.current_attendance_state for select
to custodial_application_reader using (id=1);

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare identity text:='public.current_attendance_state:custodial_reader_current_visitor_attendance';
  definition text; next_order integer;
begin
  definition:=public.custodial_release_authority_current_policy_definition(identity);
  if definition is null then raise exception 'visitor attendance reader policy missing'; end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='policy' and object_identity=identity) then
    raise exception 'visitor attendance reader recovery policy already exists';
  end if;
  select coalesce(max(restore_order),800000)+1 into next_order
    from public.custodial_release_authority_restore_inventory
    where restore_order>=800000 and restore_order<900000;
  insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
  values(next_order,'policy',identity,definition,public.static_weekly_digest_text(definition));
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
