-- Deployed migration history snapshot: 20260714141721 custodial_archive_runtime_migration_log_20260714

create schema if not exists audit_archive;
revoke all on schema audit_archive from public,anon,authenticated;
grant usage on schema audit_archive to service_role;
create table if not exists audit_archive.migration_log_legacy_20260714 (like public.migration_log including all);
insert into audit_archive.migration_log_legacy_20260714 select * from public.migration_log on conflict do nothing;
delete from public.migration_log where lower(ltrim(sql_text)) ~ '^(insert|update|delete|select|with)\s';
revoke all on table audit_archive.migration_log_legacy_20260714 from public,anon,authenticated;
grant select,insert,update,delete on table audit_archive.migration_log_legacy_20260714 to service_role;
