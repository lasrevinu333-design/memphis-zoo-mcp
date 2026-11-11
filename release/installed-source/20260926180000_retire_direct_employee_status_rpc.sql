begin;

-- Employee active-state changes are now accepted only through the versioned
-- Weekly Schedule turnover commands. Their SECURITY DEFINER implementations
-- retain owner-to-owner access to this legacy helper inside the same
-- transaction; the ordinary service-role Data API must not call it directly
-- and silently bypass the scheduler revision/position ledger.
revoke all on function public.custodial_set_employee_active(uuid,boolean,uuid,text,boolean)
  from public, anon, authenticated, service_role,
       static_weekly_control_plane, static_weekly_release_operator,
       custodial_application_reader;

-- Keep disaster-restore permission replay aligned with the denied direct RPC;
-- otherwise restoration could silently re-grant the retired path.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare
  v_identity text := ('public.custodial_set_employee_active(uuid,boolean,uuid,text,boolean)'::regprocedure)::text;
  v_definition text;
  v_order integer;
begin
  v_definition := public.custodial_release_authority_current_grant_definition(v_identity);
  if v_definition is null then
    raise exception 'missing retired employee-status grant definition';
  end if;
  update public.custodial_release_authority_restore_inventory
  set definition_sql = public.custodial_release_authority_current_grant_definition(object_identity),
      definition_sha256 = public.static_weekly_digest_text(
        public.custodial_release_authority_current_grant_definition(object_identity)),
      captured_at = statement_timestamp()
  where object_kind = 'grant'
    and to_regprocedure(object_identity) = v_identity::regprocedure;
  if not found then
    select coalesce(max(restore_order), 900000) + 1 into v_order
    from public.custodial_release_authority_restore_inventory
    where restore_order >= 900000;
    insert into public.custodial_release_authority_restore_inventory
      (restore_order, object_kind, object_identity, definition_sql, definition_sha256)
    values (v_order, 'grant', v_identity, v_definition,
      public.static_weekly_digest_text(v_definition));
  end if;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
