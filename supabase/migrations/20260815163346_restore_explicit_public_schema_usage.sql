begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- PUBLIC no longer carries implicit schema access. Preserve the existing
-- application and scheduler authority edges as explicit grants so revoking
-- PUBLIC cannot disable otherwise-authorized functions and tables.
grant usage on schema public
  to anon,
     authenticated,
     service_role,
     static_weekly_control_plane,
     static_weekly_release_operator;

commit;
