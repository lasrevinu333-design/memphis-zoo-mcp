-- Deployed migration history snapshot: 20260716001853 ai_provider_data_boundary

create table if not exists public.ai_provider_access_audit (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  purpose text not null,
  allowed boolean not null,
  input_sha256 text not null,
  redaction_count integer not null default 0 check (redaction_count >= 0),
  redaction_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_provider_access_audit_input_hash check (input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_provider_access_audit_redaction_object check (jsonb_typeof(redaction_json)='object'),
  constraint ai_provider_access_audit_metadata_object check (jsonb_typeof(metadata_json)='object')
);
alter table public.ai_provider_access_audit enable row level security;
alter table public.ai_provider_access_audit force row level security;
revoke all on table public.ai_provider_access_audit from public,anon,authenticated;
grant select,insert on table public.ai_provider_access_audit to service_role;
create index if not exists idx_ai_provider_access_audit_created on public.ai_provider_access_audit(created_at desc);
create index if not exists idx_ai_provider_access_audit_purpose on public.ai_provider_access_audit(purpose,created_at desc);
