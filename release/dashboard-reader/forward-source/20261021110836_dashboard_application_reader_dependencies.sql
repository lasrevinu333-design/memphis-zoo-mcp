-- G12/G31 independent exact old-Dashboard repair.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local check_function_bodies=on;
set local search_path=pg_catalog,public;
-- Exact reviewed project only. Caller supplies project identity from its
-- authenticated deployment target; no key or database URL is stored here.
do $target$
begin
 if current_setting('custodial.deployment_project_ref',true) is distinct from 'rqquvtjdmugpigbndmne' then
  raise exception 'Expected explicit Custodial deployment target rqquvtjdmugpigbndmne';end if;
 if current_user<>'postgres' then raise exception 'Expected existing postgres migration owner';end if;
 if not exists(select 1 from pg_roles where rolname='custodial_application_reader'
  and not rolsuper and not rolbypassrls and not rolcanlogin and not rolcreaterole
  and not rolcreatedb and not rolreplication) then
  raise exception 'Existing restricted application reader required';end if;
 if to_regclass('public.custodial_release_authority_restore_inventory') is null
  or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null
  or to_regprocedure('public.static_weekly_digest_text(text)') is null
  or to_regprocedure('public.custodial_release_canary_authority_surface()') is null then
  raise exception 'Canonical release recovery prerequisites missing';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled in('O','A')) then
  raise exception 'Expected enabled canonical inventory guard';end if;
end $target$;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
create temporary table dashboard_recovery_guard_before on commit drop as
 select tgenabled::text enabled from pg_trigger
 where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 and tgname='trg_custodial_release_authority_restore_inventory_immutable';

-- Independent old-Dashboard repair; never requires the missing new visit helper.
do $existing_helpers$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.operational_day_start(timestamptz)')
   and p.proowner='postgres'::regrole and p.prokind='f' and p.prorettype='timestamptz'::regtype
   and p.provolatile='s' and p.prosecdef=false and p.proconfig is null
   and md5(p.prosrc)='d33db6b640b600d3018f70a57e54f5b9') then
  raise exception 'Canonical signature/body/owner/security mismatch: public.operational_day_start(timestamptz)';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.get_setting_int(text,integer)')
   and p.proowner='postgres'::regrole and p.prokind='f' and p.prorettype='integer'::regtype
   and p.provolatile='s' and p.prosecdef=false and p.proconfig is null
   and md5(p.prosrc)='7ae77b31b61d1fbfe47976ab4041f06c') then
  raise exception 'Canonical signature/body/owner/security mismatch: public.get_setting_int(text,integer)';end if;
 if not has_table_privilege('custodial_application_reader','public.system_settings','SELECT') then
  raise exception 'Existing setting SELECT prerequisite missing';end if;
 if has_function_privilege('anon','public.operational_day_start(timestamptz)','EXECUTE')
  or has_function_privilege('authenticated','public.operational_day_start(timestamptz)','EXECUTE') then
  raise exception 'Unexpected client operational-day execution authority';end if;
end $existing_helpers$;
grant execute on function public.operational_day_start(timestamptz),public.get_setting_int(text,integer)
 to custodial_application_reader;
-- Extend only the exact required recovery surface; no unrelated recapture.
do $surface$
declare definition text;insertion text:=''; identity text;
begin
 if not exists(select 1 from public.custodial_release_canary_authority_surface() where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure('public.operational_day_start(timestamp with time zone)')) then
  insertion:=insertion||E'\n    (''function'',''operational_day_start(timestamp with time zone)'',''dashboard read dependency''),';end if;
 if not exists(select 1 from public.custodial_release_canary_authority_surface() where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure('public.get_setting_int(text,integer)')) then
  insertion:=insertion||E'\n    (''function'',''get_setting_int(text,integer)'',''dashboard read dependency''),';end if;
 if insertion<>'' then
  definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if length(definition)-length(replace(definition,'  values',''))<>length('  values') then
   raise exception 'Canonical surface insertion seam changed';end if;
  execute replace(definition,'  values','  values'||insertion);
 end if;
end $surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $capture$
declare signature text;kind text;definition text;changed integer;next_order integer;bucket integer;
begin
 foreach signature in array array[
'public.operational_day_start(timestamptz)','public.get_setting_int(text,integer)','public.custodial_release_canary_authority_surface()'] loop
  foreach kind in array array['function','grant'] loop
   definition:=case when kind='function' then pg_get_functiondef(to_regprocedure(signature))
    else public.custodial_release_authority_current_grant_definition(to_regprocedure(signature)::text) end;
   if definition is null then raise exception 'Missing exact recovery definition: % %',kind,signature;end if;
   update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind=kind and object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(signature);
   get diagnostics changed=row_count;
   if changed=0 and signature<>'public.custodial_release_canary_authority_surface()' then
    bucket:=case when kind='function' then 100000 else 900000 end;
    select coalesce(max(restore_order),bucket)+1 into next_order
     from public.custodial_release_authority_restore_inventory where restore_order>=bucket and restore_order<bucket+100000;
    if next_order>=bucket+100000 then raise exception 'Recovery order bucket exhausted';end if;
    insert into public.custodial_release_authority_restore_inventory
     (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     values(next_order,kind,to_regprocedure(signature)::text,definition,public.static_weekly_digest_text(definition));
   elsif changed<>1 then raise exception 'Expected one exact recovery identity: % %',kind,signature;end if;
  end loop;
 end loop;
end $capture$;
do $restore_guard$
begin
 if (select enabled from dashboard_recovery_guard_before)='A' then
  alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 else
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
 end if;
end $restore_guard$;
commit;
