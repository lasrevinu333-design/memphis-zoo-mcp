begin;

-- One unique identity row is the cross-relation serialization primitive. It
-- makes enrollment and pre-create cancellation mutually exclusive even when a
-- future writer does not use the repository advisory lock or begins a
-- SERIALIZABLE transaction before the winning transaction commits.
create table public.ops_manager_device_auth_v2_operation_identities (
  operation_id uuid primary key,
  identity_kind text not null,
  created_at timestamptz not null,
  retain_until timestamptz not null,
  unique (operation_id,identity_kind),
  constraint ops_manager_device_auth_v2_identity_kind_check
    check (identity_kind in ('enrollment','cancelled')),
  constraint ops_manager_device_auth_v2_identity_retention_check
    check (retain_until >= created_at + interval '90 days')
);

insert into public.ops_manager_device_auth_v2_operation_identities(
  operation_id,identity_kind,created_at,retain_until
)
select operation_id,'enrollment',created_at,retain_until
  from public.ops_manager_device_auth_v2_operations;

alter table public.ops_manager_device_auth_v2_operations
  add column identity_kind text not null default 'enrollment';
alter table public.ops_manager_device_auth_v2_operations
  add constraint ops_manager_device_auth_v2_operation_identity_kind_check
  check (identity_kind = 'enrollment');
alter table public.ops_manager_device_auth_v2_operations
  add constraint ops_manager_device_auth_v2_operation_identity_fkey
  foreign key (operation_id,identity_kind)
  references public.ops_manager_device_auth_v2_operation_identities(operation_id,identity_kind)
  on delete restrict;
create index idx_ops_manager_device_auth_v2_operation_identity
  on public.ops_manager_device_auth_v2_operations(operation_id,identity_kind);
create index idx_ops_manager_device_auth_v2_identity_retention
  on public.ops_manager_device_auth_v2_operation_identities(retain_until,operation_id);

-- A native client records ENROLLMENT_DISPATCHED before sending the enrollment
-- request. If cancellation reaches the backend while that request is still in
-- flight, there may not yet be an enrollment-operation row to cancel. Retain a
-- terminal, public-key-bound tombstone so cancellation can win that race and an
-- exact retry remains authoritative after either process restarts. No code,
-- credential verifier, sealed credential, or other secret material is stored.
create table public.ops_manager_device_auth_v2_cancellation_tombstones (
  operation_id uuid primary key,
  identity_kind text not null default 'cancelled',
  contract_version text not null default 'manager-device-auth.v2',
  challenge_id uuid not null references public.ops_manager_device_auth_v2_attestation_challenges(challenge_id) on delete restrict,
  challenge_generation integer not null,
  challenge_request_fingerprint text not null,
  action_request_fingerprint text not null,
  proof_nonce text not null,
  device_id text not null,
  platform text not null,
  signing_key_id text not null,
  signing_public_key_jwk jsonb not null,
  wrapping_key_id text not null,
  wrapping_public_key_jwk jsonb not null,
  status text not null default 'cancelled',
  cancelled_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  retain_until timestamptz not null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_device_auth_v2_cancel_tombstone_identity_kind_check
    check (identity_kind = 'cancelled'),
  constraint ops_manager_device_auth_v2_cancel_tombstone_identity_fkey
    foreign key (operation_id,identity_kind)
    references public.ops_manager_device_auth_v2_operation_identities(operation_id,identity_kind)
    on delete restrict,
  constraint ops_manager_device_auth_v2_cancel_tombstone_contract_check
    check (contract_version = 'manager-device-auth.v2'),
  constraint ops_manager_device_auth_v2_cancel_tombstone_status_check
    check (status = 'cancelled'),
  constraint ops_manager_device_auth_v2_cancel_tombstone_challenge_check
    check (challenge_generation >= 1),
  constraint ops_manager_device_auth_v2_cancel_tombstone_hashes_check check (
    challenge_request_fingerprint ~ '^[a-f0-9]{64}$'
    and action_request_fingerprint ~ '^[a-f0-9]{64}$'
    and proof_nonce ~ '^[A-Za-z0-9_-]{22}$'
  ),
  constraint ops_manager_device_auth_v2_cancel_tombstone_device_check check (
    device_id ~ '^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and platform in ('android','ios')
  ),
  constraint ops_manager_device_auth_v2_cancel_tombstone_key_ids_check check (
    signing_key_id ~ '^[A-Za-z0-9_-]{43}$'
    and wrapping_key_id ~ '^[A-Za-z0-9_-]{43}$'
    and signing_key_id <> wrapping_key_id
  ),
  constraint ops_manager_device_auth_v2_cancel_tombstone_signing_jwk_check check (
    jsonb_typeof(signing_public_key_jwk) = 'object'
    and signing_public_key_jwk ?& array['kty','crv','x','y']
    and signing_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and signing_public_key_jwk->>'kty' = 'EC'
    and signing_public_key_jwk->>'crv' = 'P-256'
    and signing_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$'
    and signing_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  constraint ops_manager_device_auth_v2_cancel_tombstone_wrapping_jwk_check check (
    jsonb_typeof(wrapping_public_key_jwk) = 'object'
    and wrapping_public_key_jwk ?& array['kty','crv','x','y']
    and wrapping_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and wrapping_public_key_jwk->>'kty' = 'EC'
    and wrapping_public_key_jwk->>'crv' = 'P-256'
    and wrapping_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$'
    and wrapping_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
    and wrapping_public_key_jwk <> signing_public_key_jwk
  ),
  constraint ops_manager_device_auth_v2_cancel_tombstone_time_check check (
    cancelled_at = created_at and updated_at = created_at
    and retain_until >= created_at + interval '90 days'
  ),
  constraint ops_manager_device_auth_v2_cancel_tombstone_metadata_check
    check (jsonb_typeof(metadata_json) = 'object' and pg_column_size(metadata_json) <= 8192)
);

create index idx_ops_manager_device_auth_v2_cancel_tombstone_challenge
  on public.ops_manager_device_auth_v2_cancellation_tombstones(challenge_id);
create index idx_ops_manager_device_auth_v2_cancel_tombstone_identity
  on public.ops_manager_device_auth_v2_cancellation_tombstones(operation_id,identity_kind);
create index idx_ops_manager_device_auth_v2_cancel_tombstone_retention
  on public.ops_manager_device_auth_v2_cancellation_tombstones(retain_until,operation_id);

-- The two authoritative relations cannot share an operation UUID. Repository
-- writers normally arrive already serialized; the unique identity insertion
-- is the database-owned fallback. A concurrent row invisible to an older
-- SERIALIZABLE snapshot forces a retry rather than permitting write skew.
create or replace function public.ops_manager_device_auth_v2_serialize_operation_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_kind text;
  v_existing_kind text;
  v_inserted integer;
begin
  v_kind := case
    when tg_table_name = 'ops_manager_device_auth_v2_operations' then 'enrollment'
    else 'cancelled'
  end;
  if new.identity_kind is distinct from v_kind then
    raise exception using errcode = '23514', message = 'manager device-auth v2 operation identity kind is invalid';
  end if;

  select identity_kind into v_existing_kind
    from public.ops_manager_device_auth_v2_operation_identities
   where operation_id = new.operation_id;
  if found then
    if v_existing_kind is distinct from v_kind then
      raise exception using errcode = '23514', message = 'manager device-auth v2 operation identity is terminal';
    end if;
    return new;
  end if;

  insert into public.ops_manager_device_auth_v2_operation_identities(
    operation_id,identity_kind,created_at,retain_until
  ) values(new.operation_id,v_kind,new.created_at,new.retain_until)
  on conflict(operation_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception using errcode = '40001', message = 'manager device-auth v2 operation identity changed concurrently';
  end if;
  return new;
end
$function$;

create trigger trg_ops_manager_device_auth_v2_operation_identity
before insert on public.ops_manager_device_auth_v2_operations
for each row execute function public.ops_manager_device_auth_v2_serialize_operation_identity();

create trigger trg_ops_manager_device_auth_v2_cancel_identity
before insert on public.ops_manager_device_auth_v2_cancellation_tombstones
for each row execute function public.ops_manager_device_auth_v2_serialize_operation_identity();

revoke all on function public.ops_manager_device_auth_v2_serialize_operation_identity()
  from public, anon, authenticated, service_role;
grant execute on function public.ops_manager_device_auth_v2_serialize_operation_identity() to postgres;

alter table public.ops_manager_device_auth_v2_cancellation_tombstones enable row level security;
alter table public.ops_manager_device_auth_v2_cancellation_tombstones force row level security;
alter table public.ops_manager_device_auth_v2_operation_identities enable row level security;
alter table public.ops_manager_device_auth_v2_operation_identities force row level security;
revoke all on table public.ops_manager_device_auth_v2_cancellation_tombstones
  from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_operation_identities
  from public, anon, authenticated, service_role;
grant select, insert, update, delete
  on table public.ops_manager_device_auth_v2_cancellation_tombstones to postgres;
grant select, insert, update, delete
  on table public.ops_manager_device_auth_v2_operation_identities to postgres;

comment on table public.ops_manager_device_auth_v2_cancellation_tombstones is
  'Terminal public-key-bound cancellation receipts that prevent credential issuance when cancellation wins before enrollment creation; contains no plaintext secret material.';
comment on table public.ops_manager_device_auth_v2_operation_identities is
  'Unique cross-relation operation identities that make enrollment issuance and pre-create cancellation mutually exclusive under every transaction interleaving.';

commit;
