-- Provision the fail-closed login shell consumed only by the dedicated
-- static-weekly Render service. The reusable password is never stored in
-- source: release operations install a SCRAM verifier after this migration.

begin;

do $runtime_role$
declare
  runtime_role pg_roles%rowtype;
begin
  if not exists (
    select 1 from pg_roles where rolname = 'static_weekly_runtime_20260823'
  ) then
    create role static_weekly_runtime_20260823
      login
      password null
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      connection limit 4;
  end if;

  select * into strict runtime_role
  from pg_roles
  where rolname = 'static_weekly_runtime_20260823';

  if runtime_role.rolsuper
    or runtime_role.rolcreatedb
    or runtime_role.rolcreaterole
    or runtime_role.rolreplication
    or runtime_role.rolbypassrls
    or runtime_role.rolinherit
    or not runtime_role.rolcanlogin
  then
    raise exception
      'static_weekly_runtime_20260823 has forbidden role attributes';
  end if;
end
$runtime_role$;

alter role static_weekly_runtime_20260823 connection limit 4;
alter role static_weekly_runtime_20260823 set statement_timeout = '30s';
alter role static_weekly_runtime_20260823 set lock_timeout = '5s';
alter role static_weekly_runtime_20260823 set idle_in_transaction_session_timeout = '15s';
alter role static_weekly_runtime_20260823 set idle_session_timeout = '5min';

revoke all privileges on schema public from static_weekly_runtime_20260823;
revoke all privileges on all tables in schema public from static_weekly_runtime_20260823;
revoke all privileges on all sequences in schema public from static_weekly_runtime_20260823;
revoke all privileges on all functions in schema public from static_weekly_runtime_20260823;
revoke static_weekly_release_operator from static_weekly_runtime_20260823;
grant static_weekly_control_plane to static_weekly_runtime_20260823;

do $membership_guard$
begin
  if exists (
    select 1
    from pg_auth_members membership
    join pg_roles granted on granted.oid = membership.roleid
    join pg_roles member on member.oid = membership.member
    where member.rolname = 'static_weekly_runtime_20260823'
      and granted.rolname <> 'static_weekly_control_plane'
  ) then
    raise exception
      'static_weekly_runtime_20260823 has unexpected authority membership';
  end if;
end
$membership_guard$;

comment on role static_weekly_runtime_20260823 is
  'Dedicated NOINHERIT login shell for the Memphis Zoo static-weekly control plane. Password verifier is provisioned out of band; authority is entered only with SET LOCAL ROLE static_weekly_control_plane.';

commit;
