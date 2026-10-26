begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The HTTP employee-create path is retired in favor of a stable-position
-- fill command. Protected separation is a child of receipt-bound vacancy,
-- not a second externally callable employee-state mutation endpoint.
-- SECURITY DEFINER owner-to-owner calls retain their existing authority.
revoke all on function public.custodial_create_employee(text,text,text,uuid)
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;
revoke all on function public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;

-- Restore/replay must not resurrect either direct grant. This forward-only
-- ACL correction adds no table/sequence or Data API exposure and changes no
-- employee, credential, native record, published schedule or history row.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare
  v_signature text;
  v_identity text;
  v_definition text;
  v_order integer;
begin
  foreach v_signature in array array[
    'public.custodial_create_employee(text,text,text,uuid)',
    'public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)'
  ] loop
    v_identity:=(v_signature::regprocedure)::text;
    v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
    if v_definition is null then raise exception 'missing retired helper grant definition: %',v_identity; end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=public.custodial_release_authority_current_grant_definition(object_identity),
        definition_sha256=public.static_weekly_digest_text(
          public.custodial_release_authority_current_grant_definition(object_identity)),
        captured_at=statement_timestamp()
    where object_kind='grant' and to_regprocedure(object_identity)=v_identity::regprocedure;
    if not found then
      select coalesce(max(restore_order),900000)+1 into v_order
      from public.custodial_release_authority_restore_inventory where restore_order>=900000;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(v_order,'grant',v_identity,v_definition,public.static_weekly_digest_text(v_definition));
    end if;
  end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
