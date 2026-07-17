-- Deployed migration history snapshot: 20260716001701 release_deployment_manifest

create table if not exists public.release_deployment_manifest (
  release_id text primary key,
  backend_commit text not null,
  frontend_commit text not null,
  migration_head text not null,
  migration_manifest_sha256 text not null,
  environment_contract_version text not null,
  status text not null default 'validated' check (status in ('candidate','validated','deployed','retired','rolled_back')),
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deployed_at timestamptz,
  constraint release_deployment_manifest_backend_sha check (backend_commit ~ '^[0-9a-f]{40}$'),
  constraint release_deployment_manifest_frontend_sha check (frontend_commit ~ '^[0-9a-f]{40}$'),
  constraint release_deployment_manifest_manifest_sha check (migration_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint release_deployment_manifest_details_object check (jsonb_typeof(details_json)='object')
);
alter table public.release_deployment_manifest enable row level security;
alter table public.release_deployment_manifest force row level security;
revoke all on table public.release_deployment_manifest from public,anon,authenticated;
grant select,insert,update on table public.release_deployment_manifest to service_role;
