-- Owner 2026-10-05: overdue pop-ups repeat every five minutes despite Dismiss,
-- but stop when accepted Start shows this location is already being cleaned.
-- Start is NOT completion: leave all cleaning/check clocks and history intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $patch$
declare identity text:='public.mz_location_reminder_candidates(date,timestamptz)';
 prior text;definition text;acl text;old text;replacement text;changed integer;
 captured_identities text[];trigger_mode "char";
begin
 select pg_get_functiondef(p.oid) into prior from pg_proc p where p.oid=identity::regprocedure
  and public.static_weekly_digest_text(p.prosrc)='4d90899c40b69bba34afa36a0df45d71b0bc9caf212ea239227731f973efd49e';
 if prior is null then raise exception 'Overdue scan-start predecessor changed';end if;
 acl:=public.custodial_release_authority_current_grant_definition(identity);
 -- 20261001152633 captured the public-qualified spelling under pg_catalog;
 -- 20261002120000 rebound the earlier unqualified spelling. Preserve BOTH
 -- rows and their restore orders; neither is an additional live function.
 select array_agg(object_identity order by object_identity) into captured_identities
  from public.custodial_release_authority_restore_inventory
  where object_kind='function' and to_regprocedure(object_identity)=identity::regprocedure;
 if captured_identities is distinct from array[
   'mz_location_reminder_candidates(date,timestamp with time zone)',
   'public.mz_location_reminder_candidates(date,timestamp with time zone)']::text[]
  or public.static_weekly_digest_text(prior)<>'ad5bf4abee1d732f8fc4503f12bfb2ad5924f46c8168e59c4c5557cc7ac1f949'
  or exists(select 1 from public.custodial_release_authority_restore_inventory
   where object_kind='function' and object_identity=any(captured_identities)
    and (definition_sql is distinct from prior
      or definition_sha256 is distinct from public.static_weekly_digest_text(prior))) then
  raise exception 'Overdue scan-start recovery predecessor changed';end if;
 select tgenabled into trigger_mode from pg_trigger
  where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable';
 if trigger_mode is null or trigger_mode not in ('O','A') then
  raise exception 'Overdue scan-start recovery immutability unavailable';end if;
 old:=$old$and cycle.status_code is not null;$old$;
 replacement:=$new$and cycle.status_code is not null
   and (cycle.status_code<>'overdue' or not exists(
     select 1 from public.custodial_open_work() work
     where work.location_id=status.location_id
       and work.status in ('active','pending_submit')
       and isfinite(work.started_at)
       and work.started_at>=cycle.cycle_base_at and work.started_at<=p_now
   ));$new$;
 if (length(prior)-length(replace(prior,old,'')))/length(old)<>1 then
  raise exception 'Overdue scan-start exact predicate seam changed';end if;
 definition:=replace(prior,old,replacement);
 execute definition;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from acl then
  raise exception 'Overdue scan-start ACL changed';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory
  set definition_sql=pg_get_functiondef(identity::regprocedure),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(identity::regprocedure)),captured_at=statement_timestamp()
  where object_kind='function' and object_identity=any(captured_identities)
   and definition_sql=prior and definition_sha256=public.static_weekly_digest_text(prior);
 get diagnostics changed=row_count;
 if changed<>2 then raise exception 'Overdue scan-start recovery update count changed';end if;
 if trigger_mode='A' then
  alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 else
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
 end if;
end $patch$;
commit;
