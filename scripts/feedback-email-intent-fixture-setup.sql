\set ON_ERROR_STOP on
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $roles$
declare v_role text;
begin
  foreach v_role in array array['anon','authenticated','service_role',
    'custodial_application_reader','static_weekly_control_plane',
    'static_weekly_release_operator','static_weekly_runtime_20260823'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      execute format('create role %I nologin', v_role);
    end if;
  end loop;
end;
$roles$;

-- Exercise the October 30 posture: the migration must not depend on an
-- automatic Data API grant being present for its new table/function.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated, service_role;

create table public.system_feedback_items (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  request_fingerprint text,
  category text not null,
  priority text not null,
  message text not null,
  submitted_by text,
  hub_context text not null,
  device_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Existing saved history must never be enrolled by the new migration.
insert into public.system_feedback_items (
  id, operation_id, request_fingerprint, category, priority, message,
  submitted_by, hub_context, device_id, metadata_json
) values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  repeat('a', 64), 'suggestion', 'normal', 'historical item',
  'Former Employee', 'employee', 'KIOSK_08',
  '{"identity_verification":{"status":"verified","kind":"enrolled_employee_device","employee_id":"00000000-0000-4000-8000-000000000003","credential_id":"old","device_id":"KIOSK_08"}}'
);
