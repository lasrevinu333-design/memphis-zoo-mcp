-- Exact 2026-10-21 observed old deployment. Execute only against authenticated
-- project rqquvtjdmugpigbndmne. No migration-history claim or candidate rollout.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
create temporary table dashboard_reader_before on commit drop as
select p.oid,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition_sql,
 md5(pg_get_functiondef(p.oid)) definition_md5,p.proacl::text acl_text
from pg_proc p where p.oid in(
 to_regprocedure('public.operational_day_start(timestamptz)'),
 to_regprocedure('public.get_setting_int(text,integer)'));
do $guard$
begin
 if current_setting('custodial.deployment_project_ref',true) is distinct from 'rqquvtjdmugpigbndmne'
  or current_user<>'postgres' then raise exception 'Exact Custodial project/owner required';end if;
 if not exists(select 1 from pg_roles where rolname='custodial_application_reader'
  and not rolsuper and not rolbypassrls and not rolcanlogin and not rolcreaterole
  and not rolcreatedb and not rolreplication) then raise exception 'Restricted reader required';end if;
 if (select count(*) from dashboard_reader_before)<>2
  or md5(pg_get_functiondef(to_regprocedure('public.operational_day_start(timestamptz)'))) is distinct from '5d65060220af58fb51aeeb0a23fadf66'
  or md5(pg_get_functiondef(to_regprocedure('public.get_setting_int(text,integer)'))) is distinct from '661012346c042b10ca22e0491a495802' then
  raise exception 'Exact observed old Dashboard function definitions changed';end if;
 if exists(select 1 from pg_proc p where p.oid in(select oid from dashboard_reader_before)
  and (p.prosecdef or p.proowner<>'postgres'::regrole or p.proconfig is not null)) then
  raise exception 'Expected existing INVOKER owner/search_path changed';end if;
 if (select array_agg(coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text order by coalesce(r.rolname,'PUBLIC'))
  from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee
  where p.oid='public.operational_day_start(timestamptz)'::regprocedure)
  is distinct from array['postgres:EXECUTE:false','service_role:EXECUTE:false']::text[] then
  raise exception 'Exact old operational-day ACL changed';end if;
 if (select array_agg(coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text order by coalesce(r.rolname,'PUBLIC'))
  from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee
  where p.oid='public.get_setting_int(text,integer)'::regprocedure)
  is distinct from array['custodial_application_reader:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']::text[] then
  raise exception 'Exact old integer-setting ACL changed';end if;
end $guard$;
grant execute on function public.operational_day_start(timestamptz) to custodial_application_reader;
do $after$
begin
 if exists(select 1 from dashboard_reader_before b join pg_proc p on p.oid=b.oid
  where pg_get_functiondef(p.oid) is distinct from b.definition_sql
   or (p.oid='public.get_setting_int(text,integer)'::regprocedure and p.proacl::text is distinct from b.acl_text)) then
  raise exception 'Unrelated function definition/setting ACL changed';end if;
 if not has_function_privilege('custodial_application_reader','public.operational_day_start(timestamptz)','EXECUTE')
  or has_function_privilege('anon','public.operational_day_start(timestamptz)','EXECUTE')
  or has_function_privilege('authenticated','public.operational_day_start(timestamptz)','EXECUTE') then
  raise exception 'Exact intended operational-day grant not established';end if;
end $after$;
select jsonb_build_object('scope','old-dashboard-operational-day-only','project_ref','rqquvtjdmugpigbndmne',
 'before',jsonb_agg(to_jsonb(b)),'after',jsonb_agg(jsonb_build_object('signature',b.signature,
  'definition_md5',md5(pg_get_functiondef(p.oid)),'acl_text',p.proacl::text)),
 'candidate_restoration_applied',false,'signed_in_manager_proven',false)
from dashboard_reader_before b join pg_proc p on p.oid=b.oid;
commit;
