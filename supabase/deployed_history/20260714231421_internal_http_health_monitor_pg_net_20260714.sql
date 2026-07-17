-- Deployed migration history snapshot: 20260714231421 internal_http_health_monitor_pg_net_20260714

create extension if not exists pg_net;
revoke usage on schema net from public, anon, authenticated;
revoke execute on all functions in schema net from public, anon, authenticated;
grant usage on schema net to postgres, service_role;
grant execute on all functions in schema net to postgres, service_role;
