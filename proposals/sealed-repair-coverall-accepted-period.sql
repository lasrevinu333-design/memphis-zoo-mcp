-- Proposed successor component for Main integration. Historical303 unchanged.
-- Period validation only: existing function/owner/ACL and link history retained.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $repair$
declare target oid:='public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure;
 before_acl aclitem[];before_owner oid;definition text;old_fragment text;new_fragment text;before_grants text;
begin
 select proacl,proowner into before_acl,before_owner from pg_proc where oid=target;
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid=target))<>'7d2cbac0277e28a917d5ad28dd3d18a21586bb5b8a674c9371b5748097081a07' then
  raise exception 'Unexpected canonical CoverAll period validator predecessor';end if;
 before_grants:=public.custodial_release_authority_current_grant_definition('public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)');
 definition:=pg_get_functiondef(target);
 old_fragment:=$old$if not isfinite(day) or day-(extract(isodow from day)::integer-1)<>(p_binding->>'week_start')::date then$old$;
 new_fragment:=$new$if not isfinite(day) or not isfinite((p_binding->>'week_start')::date)
  or day<(p_binding->>'week_start')::date or day>(p_binding->>'week_start')::date+6 then$new$;
 if length(definition)-length(replace(definition,old_fragment,''))<>length(old_fragment) then raise exception 'Unexpected CoverAll date guard';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$or projection.replay_digest is distinct from p_binding->>'replay_digest' then$old$;
 new_fragment:=$new$or projection.replay_digest is distinct from p_binding->>'replay_digest'
  or projection.week_start is distinct from (p_binding->>'week_start')::date
  or projection.week_end is distinct from (p_binding->>'week_start')::date+6 then$new$;
 if length(definition)-length(replace(definition,old_fragment,''))<>length(old_fragment) then raise exception 'Unexpected CoverAll accepted projection guard';end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select proacl from pg_proc where oid=target) is distinct from before_acl
  or (select proowner from pg_proc where oid=target) is distinct from before_owner
  or public.custodial_release_authority_current_grant_definition('public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)') is distinct from before_grants then
  raise exception 'CoverAll period repair changed authority';end if;
end $repair$;
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $inventory$
declare definition text:=pg_get_functiondef('public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure);changed integer;
begin
 update public.custodial_release_authority_restore_inventory set definition_sql=definition,
  definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
 where case when object_kind='function' then to_regprocedure(object_identity) end='public.static_weekly_assert_coverall_link_basis(jsonb,uuid,text)'::regprocedure;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Exact existing CoverAll function recovery row required';end if;
end $inventory$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
