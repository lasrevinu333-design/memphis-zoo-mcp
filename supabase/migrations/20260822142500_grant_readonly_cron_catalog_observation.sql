-- The connected-catalog release identity includes the active pg_cron jobs.
-- Keep that observation on the dedicated read-only authority: grant only
-- schema lookup and the six columns consumed by schema-fingerprint-catalog.

begin;

do $guard$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'custodial_application_reader'
      and not rolsuper
      and not rolbypassrls
      and not rolcanlogin
  ) then
    raise exception 'The restricted custodial_application_reader role is required.';
  end if;

  if to_regclass('cron.job') is null then
    raise exception 'The managed cron.job catalog is required for release identity observation.';
  end if;
end
$guard$;

revoke create on schema cron from custodial_application_reader;
grant usage on schema cron to custodial_application_reader;
grant select (jobname, schedule, command, database, username, active)
  on table cron.job
  to custodial_application_reader;

do $verify$
begin
  if not has_schema_privilege('custodial_application_reader', 'cron', 'usage') then
    raise exception 'custodial_application_reader lacks cron schema usage after grant.';
  end if;

  if not has_column_privilege('custodial_application_reader', 'cron.job', 'jobname', 'select')
     or not has_column_privilege('custodial_application_reader', 'cron.job', 'schedule', 'select')
     or not has_column_privilege('custodial_application_reader', 'cron.job', 'command', 'select')
     or not has_column_privilege('custodial_application_reader', 'cron.job', 'database', 'select')
     or not has_column_privilege('custodial_application_reader', 'cron.job', 'username', 'select')
     or not has_column_privilege('custodial_application_reader', 'cron.job', 'active', 'select') then
    raise exception 'custodial_application_reader lacks an admitted cron catalog column after grant.';
  end if;

  if has_schema_privilege('custodial_application_reader', 'cron', 'create')
     or has_table_privilege('custodial_application_reader', 'cron.job', 'insert')
     or has_table_privilege('custodial_application_reader', 'cron.job', 'update')
     or has_table_privilege('custodial_application_reader', 'cron.job', 'delete') then
    raise exception 'custodial_application_reader gained forbidden cron mutation authority.';
  end if;
end
$verify$;

commit;
