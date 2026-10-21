-- SOURCE PROPOSAL ONLY. Not a registered migration or application admission.
-- Compose AFTER immutable-private-owner-context.sql, inside the same owned
-- unexposed initializer transaction. Main must qualify and register this exact
-- changed definition before immutable import begin(). Never UPDATE a registry.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $source$
DECLARE original_oid oid; operator_oid oid;
BEGIN
 SELECT oid INTO operator_oid FROM pg_catalog.pg_roles WHERE rolname=session_user;
 original_oid:=to_regprocedure('public.static_weekly_v15_advance_recurring_generation()');
 IF current_user<>session_user OR original_oid IS NULL OR operator_oid IS NULL
  OR (SELECT proowner FROM pg_catalog.pg_proc WHERE oid=original_oid) IS DISTINCT FROM operator_oid
  OR (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.restore_control'::regclass) IS DISTINCT FROM operator_oid
  OR to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') IS NULL
  OR public.static_weekly_digest_text(pg_get_functiondef(original_oid))
    IS DISTINCT FROM '4a94f5e0cc6f6dcdd8e9547036266f05964306a04e4eb7621f8b70b811bd635c'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Immutable employee Source predecessor or owner changed'; END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END $source$;

CREATE OR REPLACE FUNCTION public.static_weekly_v15_advance_recurring_generation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- Exact original DATA insertion is not a fresh staffing command. Only the
  -- independently staged original under the existing private transaction can
  -- suppress this INSERT's derived generation/effects. Ordinary commands,
  -- other tables, UPDATE/DELETE and absent context retain the original body.
  if TG_OP='INSERT' and TG_LEVEL='ROW' and TG_WHEN='AFTER'
    and TG_RELID='public.employees'::regclass
    and custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) then
    return null;
  end if;
  if tg_table_name='employees' then
    if tg_op='UPDATE' and new.active is not distinct from old.active
      and new.display_name is not distinct from old.display_name
      and new.employee_code is not distinct from old.employee_code then return null;end if;
    if tg_op='INSERT' and new.employee_code!~'^EMP[0-9]+$' and not exists(select 1 from public.weekly_roster_slot_incumbencies i where i.person_id=new.id) then return null;end if;
    if tg_op='DELETE' and old.employee_code!~'^EMP[0-9]+$' and not exists(select 1 from public.weekly_roster_slot_incumbencies i where i.person_id=old.id) then return null;end if;
    if tg_op='UPDATE' and new.employee_code!~'^EMP[0-9]+$' and old.employee_code!~'^EMP[0-9]+$' and not exists(select 1 from public.weekly_roster_slot_incumbencies i where i.person_id=new.id) then return null;end if;
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

  perform public.static_weekly_v21_track_dependency_change(tg_table_name,tg_op,
   case when tg_op='INSERT' then null else to_jsonb(old) end,
   case when tg_op='DELETE' then null else to_jsonb(new) end);
 
  return null;
end
$function$;
-- CREATE OR REPLACE retains the original owner and ACL. No grants, bypass,
-- trigger disabling, normal-path exception or automatic activation is added.
COMMIT;
