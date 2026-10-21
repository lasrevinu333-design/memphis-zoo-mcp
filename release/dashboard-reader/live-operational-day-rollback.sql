-- Roll back only the new reader grant if the exact forward state remains.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
 if current_setting('custodial.deployment_project_ref',true) is distinct from 'rqquvtjdmugpigbndmne'
  or current_user<>'postgres' then raise exception 'Exact Custodial project/owner required';end if;
 if md5(pg_get_functiondef(to_regprocedure('public.operational_day_start(timestamptz)'))) is distinct from '5d65060220af58fb51aeeb0a23fadf66'
  or md5(pg_get_functiondef(to_regprocedure('public.get_setting_int(text,integer)'))) is distinct from '661012346c042b10ca22e0491a495802' then
  raise exception 'Observed definitions changed; do not roll back unrelated work';end if;
 if (select array_agg(coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text order by coalesce(r.rolname,'PUBLIC'))
  from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee
  where p.oid='public.operational_day_start(timestamptz)'::regprocedure)
  is distinct from array['custodial_application_reader:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']::text[] then
  raise exception 'Exact new operational-day ACL changed';end if;
end $guard$;
revoke execute on function public.operational_day_start(timestamptz) from custodial_application_reader;
select jsonb_build_object('scope','old-dashboard-operational-day-only-rollback',
 'definition_md5',md5(pg_get_functiondef('public.operational_day_start(timestamptz)'::regprocedure)),
 'acl_text',proacl::text,'reader_can_execute',has_function_privilege('custodial_application_reader',oid,'EXECUTE'))
from pg_proc where oid='public.operational_day_start(timestamptz)'::regprocedure;
commit;
