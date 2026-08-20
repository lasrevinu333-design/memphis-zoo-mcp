-- Disaster-restore control is deliberately outside every backed-up/restored
-- application schema.  A public/auth/storage snapshot therefore cannot roll
-- the generation or pause state backwards.
create schema if not exists custodial_dr authorization postgres;
revoke all on schema custodial_dr from public, anon, authenticated, service_role;
grant usage on schema custodial_dr to postgres;

create table if not exists custodial_dr.restore_control (
  singleton boolean primary key default true check (singleton),
  authority_generation bigint not null default 0 check (authority_generation >= 0),
  mutations_paused boolean not null default false,
  state text not null default 'READY' check (state in (
    'READY',
    'PREPARING',
    'DATABASE_RESTORED',
    'STORAGE_RESTORING',
    'VERIFYING',
    'PAUSED_FAILURE',
    'PAUSED_RECONCILIATION',
    'COMPLETE'
  )),
  restore_id uuid,
  archive_digest text check (archive_digest is null or archive_digest ~ '^[0-9a-f]{64}$'),
  source_project_ref text,
  target_project_ref text,
  release_identity jsonb not null default '{}'::jsonb check (jsonb_typeof(release_identity) = 'object'),
  started_by text,
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  updated_at timestamptz not null default clock_timestamp(),
  check (mutations_paused or state in ('READY', 'COMPLETE')),
  check ((restore_id is null and state = 'READY') or restore_id is not null)
);

insert into custodial_dr.restore_control(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists custodial_dr.restore_events (
  event_id bigint generated always as identity primary key,
  restore_id uuid not null,
  authority_generation bigint not null check (authority_generation > 0),
  phase text not null,
  outcome text not null check (outcome in ('STARTED', 'PASSED', 'FAILED', 'HELD', 'RESOLVED')),
  actor text,
  evidence_json jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_json) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);

create table if not exists custodial_dr.pre_restore_snapshots (
  restore_id uuid not null,
  authority_generation bigint not null check (authority_generation > 0),
  category text not null,
  row_count bigint not null check (row_count >= 0),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  state_json jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default clock_timestamp(),
  primary key (restore_id, category)
);

create table if not exists custodial_dr.restore_discrepancies (
  discrepancy_id bigint generated always as identity primary key,
  restore_id uuid not null,
  authority_generation bigint not null check (authority_generation > 0),
  category text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'ACCEPTED_LOSS')),
  before_sha256 text,
  restored_sha256 text,
  before_count bigint,
  restored_count bigint,
  details_json jsonb not null default '{}'::jsonb check (jsonb_typeof(details_json) = 'object'),
  resolved_by text,
  resolved_at timestamptz,
  resolution text,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (restore_id, category)
);

create table if not exists custodial_dr.restore_manifests (
  restore_id uuid primary key,
  authority_generation bigint not null check (authority_generation > 0),
  archive_digest text not null check (archive_digest ~ '^[0-9a-f]{64}$'),
  database_verified boolean not null default false,
  storage_verified boolean not null default false,
  authority_invalidated boolean not null default false,
  post_restore_verified boolean not null default false,
  database_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(database_evidence) = 'object'),
  storage_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(storage_evidence) = 'object'),
  authority_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(authority_evidence) = 'object'),
  final_manifest_sha256 text check (final_manifest_sha256 is null or final_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

revoke all on all tables in schema custodial_dr from public, anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema custodial_dr to postgres;
grant usage, select on all sequences in schema custodial_dr to postgres;

create or replace function public.custodial_restore_runtime_state()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, custodial_dr
as $$
  select jsonb_build_object(
    'authority_generation', authority_generation,
    'mutations_paused', mutations_paused,
    'state', state,
    'restore_id', restore_id,
    'updated_at', updated_at
  )
  from custodial_dr.restore_control
  where singleton = true
$$;

revoke all on function public.custodial_restore_runtime_state() from public, anon, authenticated;
grant execute on function public.custodial_restore_runtime_state() to postgres, service_role;

comment on schema custodial_dr is
  'Non-restored disaster-recovery generation, pause, discrepancy and verification authority.';
comment on table custodial_dr.restore_control is
  'Singleton generation and fail-closed mutation pause. This schema is excluded from Memphis Zoo application backups.';
comment on function public.custodial_restore_runtime_state() is
  'Service-only read of the non-restored disaster-recovery mutation gate; never a public RPC.';
