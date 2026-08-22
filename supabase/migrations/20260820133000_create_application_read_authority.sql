-- Create the dedicated non-login read authority before deployment cutover. A
-- separately provisioned LOGIN may inherit only this role and is consumed
-- through CUSTODIAL_READONLY_DATABASE_URL.

begin;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'custodial_application_reader') then
    create role custodial_application_reader
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;
end
$role$;

alter role custodial_application_reader
  nologin
  nocreatedb
  nocreaterole
  noinherit;

-- Supabase's managed `postgres` migration role is deliberately not a true
-- superuser. PostgreSQL therefore rejects ALTER ROLE clauses for the
-- SUPERUSER, REPLICATION, and BYPASSRLS attributes even when they merely
-- restate the safe false value. CREATE ROLE above sets those attributes
-- safely for a new role; an existing role must already satisfy them or the
-- migration fails closed without attempting a privileged repair.
do $role_guard$
declare
  reader pg_roles%rowtype;
begin
  select * into strict reader
  from pg_roles
  where rolname = 'custodial_application_reader';

  if reader.rolsuper or reader.rolreplication or reader.rolbypassrls then
    raise exception
      'custodial_application_reader has forbidden authority (superuser=%, replication=%, bypassrls=%)',
      reader.rolsuper,
      reader.rolreplication,
      reader.rolbypassrls;
  end if;
end
$role_guard$;

revoke all privileges on schema public from custodial_application_reader;
grant usage on schema public to custodial_application_reader;
grant select on all tables in schema public to custodial_application_reader;

alter default privileges for role postgres in schema public
  grant select on tables to custodial_application_reader;

-- Explicitly enumerate the application read functions. The mutating SCH2
-- audit function is intentionally absent; read routes consume its persisted
-- audit_summary instead of causing an UPDATE through SELECT.
grant execute on function public.msg_get_memphis_thread_context(uuid) to custodial_application_reader;
grant execute on function public.msg_get_memphis_user_id() to custodial_application_reader;
grant execute on function public.msg_get_user_by_device(text) to custodial_application_reader;
grant execute on function public.msg_list_users(uuid) to custodial_application_reader;
grant execute on function public.sch2_compare_current_vs_preview(uuid) to custodial_application_reader;
grant execute on function public.sch2_explain_assignment(uuid,uuid) to custodial_application_reader;
grant execute on function public.sch_absence_preview(date,uuid[]) to custodial_application_reader;
grant execute on function public.sch_audit_schedule_day(date) to custodial_application_reader;
grant execute on function public.sch_employee_my_schedule_page(date,uuid,timestamptz) to custodial_application_reader;
grant execute on function public.sch_extract_lunch_end(text) to custodial_application_reader;
grant execute on function public.sch_extract_lunch_start(text) to custodial_application_reader;
grant execute on function public.sch_get_coverage_candidates(date,uuid,time,time) to custodial_application_reader;
grant execute on function public.sch_get_current_owner(text,timestamptz) to custodial_application_reader;
grant execute on function public.sch_get_daily_schedule_with_purpose(date) to custodial_application_reader;
grant execute on function public.sch_get_employee_work_status(date,uuid) to custodial_application_reader;
grant execute on function public.sch_get_schedule_close_time(date) to custodial_application_reader;
grant execute on function public.sch_is_employee_location_group_restricted(uuid,uuid,integer) to custodial_application_reader;
grant execute on function public.sch_is_public_restroom_group(uuid) to custodial_application_reader;
grant execute on function public.sch_list_location_workload_settings() to custodial_application_reader;
grant execute on function public.sch_resolve_employee_ref(text) to custodial_application_reader;
grant execute on function public.sch_service_date(timestamptz) to custodial_application_reader;
grant execute on function public.sch_validate_operational_schedule_rules(date,date) to custodial_application_reader;
grant execute on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) to custodial_application_reader;
grant execute on function public.tool_admin_bundle(integer,integer,integer,integer,integer) to custodial_application_reader;

comment on role custodial_application_reader is
  'Non-login application/MCP read authority. No BYPASSRLS, no relation mutation, and consumed only inside an explicit READ ONLY transaction.';

commit;
