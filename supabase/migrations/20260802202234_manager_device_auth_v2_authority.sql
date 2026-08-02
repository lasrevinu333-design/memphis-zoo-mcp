-- Manager native device-auth v2 authority.
--
-- Forward-only and data-preserving. Browser and v1 native credentials remain
-- valid. V2 stores only keyed verifiers, public keys, attestation evidence
-- needed for validation, and envelopes sealed to a device wrapping key.

begin;

alter table public.ops_manager_enrollment_codes
  add column if not exists reserved_operation_id uuid null,
  add column if not exists reserved_at timestamptz null;

alter table public.ops_manager_enrollment_codes
  drop constraint if exists ops_manager_enrollment_codes_status;
alter table public.ops_manager_enrollment_codes
  add constraint ops_manager_enrollment_codes_status
  check (status in ('active','pending_confirmation','used','expired','revoked','locked'));
alter table public.ops_manager_enrollment_codes
  add constraint ops_manager_enrollment_codes_reservation_check
  check (
    (status = 'pending_confirmation' and reserved_operation_id is not null and reserved_at is not null
      and consumed_at is null and revoked_at is null)
    or
    (status <> 'pending_confirmation' and reserved_operation_id is null and reserved_at is null)
  );

alter table public.ops_manager_trusted_devices
  add column if not exists auth_contract_version text null,
  add column if not exists authority_epoch bigint not null default 1,
  add column if not exists signing_key_id text null,
  add column if not exists wrapping_key_id text null,
  add column if not exists attestation_provider text null,
  add column if not exists attestation_app_id text null,
  add column if not exists attestation_policy_version text null,
  add column if not exists attestation_verified_at timestamptz null;

alter table public.ops_manager_trusted_devices
  add constraint ops_manager_trusted_devices_v2_contract_check
  check (auth_contract_version is null or auth_contract_version = 'manager-device-auth.v2'),
  add constraint ops_manager_trusted_devices_v2_epoch_check
  check (authority_epoch >= 1),
  add constraint ops_manager_trusted_devices_v2_binding_check
  check (
    auth_contract_version is null
    or (
      device_id ~ '^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and signing_key_id ~ '^[A-Za-z0-9_-]{43}$'
      and wrapping_key_id ~ '^[A-Za-z0-9_-]{43}$'
      and signing_key_id <> wrapping_key_id
      and attestation_provider in ('play_integrity','apple_app_attest')
      and length(attestation_app_id) between 3 and 240
      and length(attestation_policy_version) between 1 and 80
      and attestation_verified_at is not null
    )
  );

-- This trigger is the shared v1/v2 serialization boundary. Every future
-- trusted-device insert locks and supersedes the prior active device binding,
-- even when an older v1 enrollment function is the writer. The notification
-- owner trigger normally rejects updates after credential revocation, so give
-- it one narrow fail-closed transition: an existing push registration may be
-- deactivated without changing its identity or delivery token.
create or replace function public.ops_manager_notification_validate_owner()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_manager_id uuid;
begin
  if tg_table_name = 'ops_manager_push_devices' and tg_op = 'UPDATE' then
    if new.credential_id = old.credential_id
       and new.manager_id = old.manager_id
       and new.device_id = old.device_id
       and new.provider = old.provider
       and new.platform = old.platform
       and new.fcm_token = old.fcm_token
       and new.enabled = false
       and new.revoked_at is not null
       and new.app_version is not distinct from old.app_version
       and new.app_build is not distinct from old.app_build
       and new.last_registered_at = old.last_registered_at
       and new.last_seen_at = old.last_seen_at
       and new.metadata_json = old.metadata_json
       and new.created_at = old.created_at then
      new.updated_at := now();
      return new;
    end if;
  end if;

  select manager_id into v_manager_id
  from public.ops_manager_trusted_devices
  where credential_id=new.credential_id
    and revoked_at is null
    and expires_at>now();
  if v_manager_id is null or v_manager_id is distinct from new.manager_id then
    raise exception using errcode='23514',message='Notification record must belong to the active trusted manager device.';
  end if;
  new.updated_at:=now();
  return new;
end
$function$;
revoke all on function public.ops_manager_notification_validate_owner() from public,anon,authenticated;
grant execute on function public.ops_manager_notification_validate_owner() to postgres,service_role;

create or replace function public.ops_manager_serialize_trusted_device_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_revoked_credentials uuid[] := '{}'::uuid[];
  v_retired_installations uuid[] := '{}'::uuid[];
  v_now timestamptz := statement_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('manager-device-auth-binding:' || new.device_id, 0));
  with revoked as (
    update public.ops_manager_trusted_devices
       set revoked_at = coalesce(revoked_at, greatest(v_now,created_at)),
           revoked_reason = coalesce(revoked_reason, 'superseded_by_device_binding'),
           authority_epoch = authority_epoch + 1
     where device_id = new.device_id
       and credential_id <> new.credential_id
       and revoked_at is null
     returning credential_id, manager_v2_installation_id
  )
  select
    coalesce(array_agg(credential_id), '{}'::uuid[]),
    coalesce(array_agg(manager_v2_installation_id) filter (
      where manager_v2_installation_id is not null
        and manager_v2_installation_id is distinct from new.manager_v2_installation_id
    ), '{}'::uuid[])
    into v_revoked_credentials, v_retired_installations
  from revoked;

  if cardinality(v_revoked_credentials) > 0 then
    update public.ops_manager_push_devices
       set enabled=false,revoked_at=coalesce(revoked_at,greatest(v_now,created_at)),updated_at=greatest(v_now,created_at),
           last_error='credential_superseded_by_device_binding'
     where credential_id=any(v_revoked_credentials) and (enabled=true or revoked_at is null);
    update public.ops_manager_notification_queue
       set status='cancelled',completed_at=greatest(v_now,created_at),leased_at=null,leased_until=null,lease_token=null,
           worker_id=null,updated_at=greatest(v_now,created_at),last_error='credential_superseded_by_device_binding'
     where credential_id=any(v_revoked_credentials) and status in ('pending','leased');
    update public.ops_manager_device_auth_v2_sessions
       set revoked_at=coalesce(revoked_at,greatest(v_now,created_at)),
           revoked_reason=coalesce(revoked_reason,'credential_superseded_by_device_binding')
     where credential_id=any(v_revoked_credentials) and revoked_at is null;
    update public.ops_manager_device_auth_v2_credential_installations
       set unlinked_at=coalesce(unlinked_at,greatest(v_now,linked_at)),
           unlinked_reason=coalesce(unlinked_reason,'credential_superseded_by_device_binding')
     where credential_id=any(v_revoked_credentials) and unlinked_at is null;
  end if;

  if cardinality(v_retired_installations) > 0 then
    update public.ops_manager_device_auth_v2_key_generations
       set status='retired',retired_at=coalesce(retired_at,greatest(v_now,created_at)),
           retired_reason=coalesce(retired_reason,'device_binding_superseded'),updated_at=greatest(v_now,created_at)
     where installation_id=any(v_retired_installations) and status<>'retired';
    update public.ops_manager_device_auth_v2_installations
       set status='retired',retired_at=coalesce(retired_at,greatest(v_now,created_at)),
           retired_reason=coalesce(retired_reason,'device_binding_superseded'),updated_at=greatest(v_now,created_at)
     where installation_id=any(v_retired_installations) and status<>'retired';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_ops_manager_serialize_trusted_device_binding on public.ops_manager_trusted_devices;
create trigger trg_ops_manager_serialize_trusted_device_binding
before insert on public.ops_manager_trusted_devices
for each row execute function public.ops_manager_serialize_trusted_device_binding();
revoke all on function public.ops_manager_serialize_trusted_device_binding() from public, anon, authenticated;
grant execute on function public.ops_manager_serialize_trusted_device_binding() to postgres, service_role;

create table public.ops_manager_device_auth_v2_installations (
  installation_id uuid primary key,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  device_id text not null,
  platform text not null,
  provider text not null,
  app_id text not null,
  policy_version text not null,
  verified_at timestamptz not null,
  key_id text null unique,
  public_key_spki text null,
  receipt text null,
  assertion_counter bigint not null default 0,
  validation_category integer null,
  bundle_version text null,
  status text not null default 'pending',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  activated_at timestamptz null,
  retired_at timestamptz null,
  retired_reason text null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_device_auth_v2_installation_device_check
    check (device_id ~ '^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint ops_manager_device_auth_v2_installation_platform_check check (platform in ('android','ios')),
  constraint ops_manager_device_auth_v2_installation_provider_check
    check ((platform = 'android' and provider = 'play_integrity') or (platform = 'ios' and provider = 'apple_app_attest')),
  constraint ops_manager_device_auth_v2_installation_text_check
    check (length(app_id) between 3 and 240 and length(policy_version) between 1 and 80),
  constraint ops_manager_device_auth_v2_installation_provider_material_check check (
    (provider = 'play_integrity' and key_id is null and public_key_spki is null and receipt is null
      and assertion_counter = 0 and validation_category is null and bundle_version is null)
    or
    (provider = 'apple_app_attest' and key_id ~ '^[A-Za-z0-9_-]{43}$'
      and length(public_key_spki) between 80 and 2048 and public_key_spki ~ '^[A-Za-z0-9_-]+$'
      and length(receipt) between 80 and 32768 and receipt ~ '^[A-Za-z0-9_-]+$'
      and assertion_counter >= 0 and validation_category between 0 and 10
      and bundle_version ~ '^[A-Za-z0-9._-]{1,64}$')
  ),
  constraint ops_manager_device_auth_v2_installation_status_check check (status in ('pending','active','retired')),
  constraint ops_manager_device_auth_v2_installation_state_check check (
    (status = 'pending' and activated_at is null and retired_at is null and retired_reason is null)
    or (status = 'active' and activated_at is not null and retired_at is null and retired_reason is null)
    or (status = 'retired' and retired_at is not null and length(retired_reason) between 1 and 160)
  ),
  constraint ops_manager_device_auth_v2_installation_time_check
    check (updated_at >= created_at and verified_at >= created_at - interval '10 minutes'),
  constraint ops_manager_device_auth_v2_installation_metadata_check check (jsonb_typeof(metadata_json) = 'object')
);

create unique index uq_ops_manager_device_auth_v2_active_installation_device
  on public.ops_manager_device_auth_v2_installations(device_id)
  where status = 'active';
create unique index uq_ops_manager_device_auth_v2_pending_installation_device
  on public.ops_manager_device_auth_v2_installations(device_id)
  where status = 'pending';
create index idx_ops_manager_device_auth_v2_installations_manager
  on public.ops_manager_device_auth_v2_installations(manager_id, updated_at desc);

create table public.ops_manager_device_auth_v2_key_generations (
  key_generation_id uuid primary key,
  installation_id uuid not null references public.ops_manager_device_auth_v2_installations(installation_id) on delete restrict,
  operation_id uuid not null unique,
  signing_key_id text not null unique,
  signing_public_key_jwk jsonb not null,
  wrapping_key_id text not null unique,
  wrapping_public_key_jwk jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  activated_at timestamptz null,
  retired_at timestamptz null,
  retired_reason text null,
  retain_until timestamptz not null,
  constraint ops_manager_device_auth_v2_generation_key_ids_check
    check (signing_key_id ~ '^[A-Za-z0-9_-]{43}$' and wrapping_key_id ~ '^[A-Za-z0-9_-]{43}$' and signing_key_id <> wrapping_key_id),
  constraint ops_manager_device_auth_v2_generation_signing_jwk_check check (
    jsonb_typeof(signing_public_key_jwk) = 'object'
    and signing_public_key_jwk ?& array['kty','crv','x','y']
    and signing_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and signing_public_key_jwk->>'kty' = 'EC' and signing_public_key_jwk->>'crv' = 'P-256'
    and signing_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' and signing_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  constraint ops_manager_device_auth_v2_generation_wrapping_jwk_check check (
    jsonb_typeof(wrapping_public_key_jwk) = 'object'
    and wrapping_public_key_jwk ?& array['kty','crv','x','y']
    and wrapping_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and wrapping_public_key_jwk->>'kty' = 'EC' and wrapping_public_key_jwk->>'crv' = 'P-256'
    and wrapping_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' and wrapping_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
    and wrapping_public_key_jwk <> signing_public_key_jwk
  ),
  constraint ops_manager_device_auth_v2_generation_status_check check (status in ('pending','active','retired')),
  constraint ops_manager_device_auth_v2_generation_state_check check (
    (status = 'pending' and activated_at is null and retired_at is null and retired_reason is null)
    or (status = 'active' and activated_at is not null and retired_at is null and retired_reason is null)
    or (status = 'retired' and retired_at is not null and length(retired_reason) between 1 and 160)
  ),
  constraint ops_manager_device_auth_v2_generation_installation_pair unique (installation_id, key_generation_id),
  constraint ops_manager_device_auth_v2_generation_binding_pair unique (key_generation_id, installation_id, signing_key_id, wrapping_key_id),
  constraint ops_manager_device_auth_v2_generation_time_check
    check (updated_at >= created_at and retain_until >= created_at + interval '90 days')
);
create unique index uq_ops_manager_device_auth_v2_active_generation
  on public.ops_manager_device_auth_v2_key_generations(installation_id) where status = 'active';
create unique index uq_ops_manager_device_auth_v2_pending_generation
  on public.ops_manager_device_auth_v2_key_generations(installation_id) where status = 'pending';
create index idx_ops_manager_device_auth_v2_generation_retention
  on public.ops_manager_device_auth_v2_key_generations(retain_until, key_generation_id);
create index idx_ops_manager_device_auth_v2_generation_installation
  on public.ops_manager_device_auth_v2_key_generations(installation_id);

alter table public.ops_manager_device_auth_v2_installations
  add column current_key_generation_id uuid null
    references public.ops_manager_device_auth_v2_key_generations(key_generation_id) on delete restrict;
alter table public.ops_manager_device_auth_v2_installations
  add constraint ops_manager_device_auth_v2_installation_current_generation_check check (
    (status = 'pending' and current_key_generation_id is null)
    or (status = 'active' and current_key_generation_id is not null)
    or status = 'retired'
  );
alter table public.ops_manager_device_auth_v2_installations
  add constraint ops_manager_device_auth_v2_installation_current_generation_fkey
  foreign key (installation_id, current_key_generation_id)
  references public.ops_manager_device_auth_v2_key_generations(installation_id, key_generation_id)
  on delete restrict deferrable initially deferred;
create index idx_ops_manager_device_auth_v2_installations_current_generation
  on public.ops_manager_device_auth_v2_installations(current_key_generation_id);
create index idx_ops_manager_device_auth_v2_installations_generation_binding
  on public.ops_manager_device_auth_v2_installations(installation_id, current_key_generation_id);

create table public.ops_manager_device_auth_v2_attestation_challenges (
  challenge_id uuid primary key,
  operation_id uuid not null,
  generation integer not null default 1,
  purpose text not null,
  request_fingerprint text not null,
  rate_key_hash text not null,
  device_id text not null,
  device_label text not null,
  platform text not null,
  provider text not null,
  signing_key_id text not null,
  signing_public_key_jwk jsonb not null,
  wrapping_key_id text not null,
  wrapping_public_key_jwk jsonb not null,
  proof_nonce text not null,
  policy_version text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_evidence_digest text null,
  superseded_at timestamptz null,
  unique (operation_id, generation),
  constraint ops_manager_device_auth_v2_challenge_generation_check check (generation >= 1),
  constraint ops_manager_device_auth_v2_challenge_purpose_check check (purpose in ('enroll','recover','authorized_session')),
  constraint ops_manager_device_auth_v2_challenge_device_check
    check (device_id ~ '^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint ops_manager_device_auth_v2_challenge_label_check check (length(device_label) between 1 and 160 and device_label !~ '[[:cntrl:]]'),
  constraint ops_manager_device_auth_v2_challenge_platform_check check (platform in ('android','ios')),
  constraint ops_manager_device_auth_v2_challenge_provider_check
    check ((platform = 'android' and provider = 'play_integrity') or (platform = 'ios' and provider = 'apple_app_attest')),
  constraint ops_manager_device_auth_v2_challenge_hashes_check check (
    request_fingerprint ~ '^[a-f0-9]{64}$' and rate_key_hash ~ '^[a-f0-9]{64}$'
    and proof_nonce ~ '^[A-Za-z0-9_-]{22}$'
    and (consumed_evidence_digest is null or consumed_evidence_digest ~ '^[a-f0-9]{64}$')
  ),
  constraint ops_manager_device_auth_v2_challenge_keys_check
    check (signing_key_id ~ '^[A-Za-z0-9_-]{43}$' and wrapping_key_id ~ '^[A-Za-z0-9_-]{43}$' and signing_key_id <> wrapping_key_id),
  constraint ops_manager_device_auth_v2_challenge_signing_jwk_check check (
    jsonb_typeof(signing_public_key_jwk) = 'object' and signing_public_key_jwk ?& array['kty','crv','x','y']
    and signing_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and signing_public_key_jwk->>'kty' = 'EC' and signing_public_key_jwk->>'crv' = 'P-256'
    and signing_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' and signing_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  constraint ops_manager_device_auth_v2_challenge_wrapping_jwk_check check (
    jsonb_typeof(wrapping_public_key_jwk) = 'object' and wrapping_public_key_jwk ?& array['kty','crv','x','y']
    and wrapping_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and wrapping_public_key_jwk->>'kty' = 'EC' and wrapping_public_key_jwk->>'crv' = 'P-256'
    and wrapping_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' and wrapping_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
    and wrapping_public_key_jwk <> signing_public_key_jwk
  ),
  constraint ops_manager_device_auth_v2_challenge_policy_check check (length(policy_version) between 1 and 80),
  constraint ops_manager_device_auth_v2_challenge_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint ops_manager_device_auth_v2_challenge_consumption_check check (
    (consumed_at is null and consumed_evidence_digest is null and (superseded_at is null or superseded_at >= created_at))
    or (consumed_at is not null and consumed_evidence_digest is not null and consumed_at >= created_at and superseded_at is null)
  )
);

create index idx_ops_manager_device_auth_v2_challenge_expiry
  on public.ops_manager_device_auth_v2_attestation_challenges(expires_at, operation_id)
  where consumed_at is null and superseded_at is null;
create unique index uq_ops_manager_device_auth_v2_current_challenge
  on public.ops_manager_device_auth_v2_attestation_challenges(operation_id)
  where consumed_at is null and superseded_at is null;
create index idx_ops_manager_device_auth_v2_challenge_rate
  on public.ops_manager_device_auth_v2_attestation_challenges(rate_key_hash, expires_at)
  where consumed_at is null and superseded_at is null;

create table public.ops_manager_device_auth_v2_attestation_verifications (
  verification_id uuid primary key,
  challenge_id uuid not null references public.ops_manager_device_auth_v2_attestation_challenges(challenge_id) on delete restrict,
  evidence_digest text not null,
  provider text not null,
  app_id text not null,
  result_json jsonb not null,
  verified_at timestamptz not null,
  retain_until timestamptz not null,
  unique (challenge_id, evidence_digest),
  constraint ops_manager_device_auth_v2_verification_digest_check check (evidence_digest ~ '^[a-f0-9]{64}$'),
  constraint ops_manager_device_auth_v2_verification_provider_check check (provider in ('play_integrity','apple_app_attest')),
  constraint ops_manager_device_auth_v2_verification_app_check check (length(app_id) between 3 and 240),
  constraint ops_manager_device_auth_v2_verification_result_check
    check (jsonb_typeof(result_json) = 'object' and pg_column_size(result_json) <= 65536),
  constraint ops_manager_device_auth_v2_verification_retention_check
    check (retain_until >= verified_at + interval '90 days')
);
create index idx_ops_manager_device_auth_v2_verification_challenge
  on public.ops_manager_device_auth_v2_attestation_verifications(challenge_id);
create index idx_ops_manager_device_auth_v2_verification_retention
  on public.ops_manager_device_auth_v2_attestation_verifications(retain_until, verification_id);

create table public.ops_manager_device_auth_v2_operations (
  operation_id uuid primary key,
  contract_version text not null default 'manager-device-auth.v2',
  flow text not null,
  status text not null default 'pending_confirmation',
  request_fingerprint text not null,
  proof_nonce text not null,
  device_id text not null,
  device_label text not null,
  platform text not null,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  manager_roles text[] not null,
  enrollment_code_id uuid not null unique references public.ops_manager_enrollment_codes(id) on delete restrict,
  installation_id uuid not null references public.ops_manager_device_auth_v2_installations(installation_id) on delete restrict,
  key_generation_id uuid not null references public.ops_manager_device_auth_v2_key_generations(key_generation_id) on delete restrict,
  credential_id uuid not null unique,
  credential_verifier text null,
  credential_expires_at timestamptz not null,
  resume_expires_at timestamptz not null,
  signing_key_id text not null,
  signing_public_key_jwk jsonb not null,
  wrapping_key_id text not null,
  wrapping_public_key_jwk jsonb not null,
  requested_access_level text not null,
  granted_access_level text not null,
  attestation_challenge_id uuid not null references public.ops_manager_device_auth_v2_attestation_challenges(challenge_id) on delete restrict,
  attestation_provider text not null,
  attestation_app_id text not null,
  attestation_policy_version text not null,
  attestation_evidence_digest text not null,
  attestation_verified_at timestamptz not null,
  attestation_key_id text null,
  attestation_public_key_spki text null,
  attestation_receipt text null,
  attestation_assertion_counter bigint not null default 0,
  attestation_validation_category integer null,
  attestation_bundle_version text null,
  envelope_algorithm text null,
  envelope_ephemeral_public_key_jwk jsonb null,
  envelope_ephemeral_key_id text null,
  envelope_salt text null,
  envelope_iv text null,
  envelope_ciphertext text null,
  envelope_tag text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  confirmed_at timestamptz null,
  cancelled_at timestamptz null,
  expired_at timestamptz null,
  retain_until timestamptz not null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_device_auth_v2_operation_contract_check check (contract_version = 'manager-device-auth.v2'),
  constraint ops_manager_device_auth_v2_operation_flow_check check (flow in ('enroll','recover')),
  constraint ops_manager_device_auth_v2_operation_status_check check (status in ('pending_confirmation','confirmed','cancelled','expired')),
  constraint ops_manager_device_auth_v2_operation_hashes_check check (
    request_fingerprint ~ '^[a-f0-9]{64}$' and proof_nonce ~ '^[A-Za-z0-9_-]{22}$'
    and (credential_verifier is null or credential_verifier ~ '^[a-f0-9]{64}$')
    and attestation_evidence_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint ops_manager_device_auth_v2_operation_device_check
    check (device_id ~ '^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and length(device_label) between 1 and 160 and device_label !~ '[[:cntrl:]]'),
  constraint ops_manager_device_auth_v2_operation_platform_check check (platform in ('android','ios')),
  constraint ops_manager_device_auth_v2_operation_access_check check (
    requested_access_level in ('read_only','full_access') and granted_access_level in ('read_only','full_access')
    and (requested_access_level = 'full_access' or granted_access_level = 'read_only')
  ),
  constraint ops_manager_device_auth_v2_operation_roles_check check (
    manager_roles = array['OPS_MANAGER']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER']::text[]
    or manager_roles = array['OPS_MANAGER','DIRECTOR']::text[]
    or manager_roles = array['OPS_MANAGER','SECURITY_ADMIN']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN']::text[]
    or manager_roles = array['OPS_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  ),
  constraint ops_manager_device_auth_v2_operation_key_ids_check
    check (signing_key_id ~ '^[A-Za-z0-9_-]{43}$' and wrapping_key_id ~ '^[A-Za-z0-9_-]{43}$' and signing_key_id <> wrapping_key_id),
  constraint ops_manager_device_auth_v2_operation_signing_jwk_check check (
    jsonb_typeof(signing_public_key_jwk) = 'object' and signing_public_key_jwk ?& array['kty','crv','x','y']
    and signing_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and signing_public_key_jwk->>'kty' = 'EC' and signing_public_key_jwk->>'crv' = 'P-256'
    and signing_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' and signing_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  constraint ops_manager_device_auth_v2_operation_wrapping_jwk_check check (
    jsonb_typeof(wrapping_public_key_jwk) = 'object' and wrapping_public_key_jwk ?& array['kty','crv','x','y']
    and wrapping_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and wrapping_public_key_jwk->>'kty' = 'EC' and wrapping_public_key_jwk->>'crv' = 'P-256'
    and wrapping_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' and wrapping_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
    and wrapping_public_key_jwk <> signing_public_key_jwk
  ),
  constraint ops_manager_device_auth_v2_operation_attestation_check check (
    ((platform = 'android' and attestation_provider = 'play_integrity' and attestation_key_id is null
       and attestation_public_key_spki is null and attestation_receipt is null and attestation_assertion_counter = 0
       and attestation_validation_category is null and attestation_bundle_version is null)
     or
     (platform = 'ios' and attestation_provider = 'apple_app_attest' and attestation_key_id ~ '^[A-Za-z0-9_-]{43}$'
       and length(attestation_public_key_spki) between 80 and 2048 and attestation_public_key_spki ~ '^[A-Za-z0-9_-]+$'
       and length(attestation_receipt) between 80 and 32768 and attestation_receipt ~ '^[A-Za-z0-9_-]+$'
       and attestation_assertion_counter >= 0 and attestation_validation_category between 0 and 10
       and attestation_bundle_version ~ '^[A-Za-z0-9._-]{1,64}$'))
    and length(attestation_app_id) between 3 and 240 and length(attestation_policy_version) between 1 and 80
  ),
  constraint ops_manager_device_auth_v2_operation_expiry_check check (
    credential_expires_at > created_at and resume_expires_at > created_at
    and resume_expires_at <= created_at + interval '1 hour' and retain_until >= created_at + interval '90 days'
    and updated_at >= created_at
  ),
  constraint ops_manager_device_auth_v2_operation_state_check check (
    (status = 'pending_confirmation' and credential_verifier is not null
      and envelope_algorithm = 'ECDH-P256-HKDF-SHA256+A256GCM'
      and envelope_ephemeral_public_key_jwk is not null and envelope_ephemeral_key_id ~ '^[A-Za-z0-9_-]{43}$'
      and envelope_salt ~ '^[A-Za-z0-9_-]{43}$' and envelope_iv ~ '^[A-Za-z0-9_-]{16}$'
      and length(envelope_ciphertext) between 32 and 16384 and envelope_ciphertext ~ '^[A-Za-z0-9_-]+$'
      and envelope_tag ~ '^[A-Za-z0-9_-]{22}$'
      and confirmed_at is null and cancelled_at is null and expired_at is null)
    or
    (status <> 'pending_confirmation' and credential_verifier is null and envelope_algorithm is null
      and envelope_ephemeral_public_key_jwk is null and envelope_ephemeral_key_id is null and envelope_salt is null
      and envelope_iv is null and envelope_ciphertext is null and envelope_tag is null
      and ((status = 'confirmed' and confirmed_at is not null and cancelled_at is null and expired_at is null)
        or (status = 'cancelled' and confirmed_at is null and cancelled_at is not null and expired_at is null)
        or (status = 'expired' and confirmed_at is null and cancelled_at is null and expired_at is not null)))
  ),
  constraint ops_manager_device_auth_v2_operation_ephemeral_jwk_check check (
    envelope_ephemeral_public_key_jwk is null
    or (jsonb_typeof(envelope_ephemeral_public_key_jwk) = 'object'
      and envelope_ephemeral_public_key_jwk ?& array['kty','crv','x','y']
      and envelope_ephemeral_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
      and envelope_ephemeral_public_key_jwk->>'kty' = 'EC' and envelope_ephemeral_public_key_jwk->>'crv' = 'P-256'
      and envelope_ephemeral_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$'
      and envelope_ephemeral_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$')
  ),
  constraint ops_manager_device_auth_v2_operation_metadata_check check (jsonb_typeof(metadata_json) = 'object')
);

alter table public.ops_manager_enrollment_codes
  add constraint ops_manager_enrollment_codes_reserved_operation_id_fkey
  foreign key (reserved_operation_id) references public.ops_manager_device_auth_v2_operations(operation_id) on delete restrict;
create index idx_ops_manager_enrollment_codes_reserved_operation
  on public.ops_manager_enrollment_codes(reserved_operation_id)
  where reserved_operation_id is not null;

alter table public.ops_manager_device_auth_v2_key_generations
  add constraint ops_manager_device_auth_v2_generation_operation_fkey
  foreign key (operation_id) references public.ops_manager_device_auth_v2_operations(operation_id) on delete restrict
  deferrable initially deferred;
alter table public.ops_manager_device_auth_v2_operations
  add constraint ops_manager_device_auth_v2_operation_generation_binding_fkey
  foreign key (key_generation_id, installation_id, signing_key_id, wrapping_key_id)
  references public.ops_manager_device_auth_v2_key_generations(
    key_generation_id, installation_id, signing_key_id, wrapping_key_id
  ) on delete restrict deferrable initially deferred;

create index idx_ops_manager_device_auth_v2_operations_expiry
  on public.ops_manager_device_auth_v2_operations(resume_expires_at, operation_id)
  where status = 'pending_confirmation';
create index idx_ops_manager_device_auth_v2_operations_retention
  on public.ops_manager_device_auth_v2_operations(retain_until, operation_id);
create index idx_ops_manager_device_auth_v2_operations_manager
  on public.ops_manager_device_auth_v2_operations(manager_id);
create index idx_ops_manager_device_auth_v2_operations_installation
  on public.ops_manager_device_auth_v2_operations(installation_id);
create index idx_ops_manager_device_auth_v2_operations_generation
  on public.ops_manager_device_auth_v2_operations(key_generation_id);
create index idx_ops_manager_device_auth_v2_operations_generation_binding
  on public.ops_manager_device_auth_v2_operations(key_generation_id,installation_id,signing_key_id,wrapping_key_id);
create index idx_ops_manager_device_auth_v2_operations_challenge
  on public.ops_manager_device_auth_v2_operations(attestation_challenge_id);

alter table public.ops_manager_trusted_devices
  add column if not exists manager_v2_installation_id uuid null
    references public.ops_manager_device_auth_v2_installations(installation_id) on delete restrict;
alter table public.ops_manager_trusted_devices
  add constraint ops_manager_trusted_devices_v2_installation_check
  check ((auth_contract_version is null and manager_v2_installation_id is null)
    or (auth_contract_version = 'manager-device-auth.v2' and manager_v2_installation_id is not null));

create unique index uq_ops_manager_v2_active_device_binding
  on public.ops_manager_trusted_devices(device_id)
  where auth_contract_version = 'manager-device-auth.v2' and revoked_at is null;
create index idx_ops_manager_trusted_devices_v2_installation
  on public.ops_manager_trusted_devices(manager_v2_installation_id);

create table public.ops_manager_device_auth_v2_credential_installations (
  credential_id uuid primary key references public.ops_manager_trusted_devices(credential_id) on delete cascade,
  installation_id uuid not null references public.ops_manager_device_auth_v2_installations(installation_id) on delete restrict,
  linked_at timestamptz not null,
  unlinked_at timestamptz null,
  unlinked_reason text null,
  constraint ops_manager_device_auth_v2_credential_link_check check (
    (unlinked_at is null and unlinked_reason is null)
    or (unlinked_at is not null and unlinked_at >= linked_at and length(unlinked_reason) between 1 and 160)
  )
);
create index idx_ops_manager_device_auth_v2_credential_installation_history
  on public.ops_manager_device_auth_v2_credential_installations(installation_id, linked_at desc);

create table public.ops_manager_device_auth_v2_sessions (
  session_id uuid primary key,
  operation_id uuid not null unique,
  request_fingerprint text not null,
  proof_nonce text not null,
  credential_id uuid not null references public.ops_manager_trusted_devices(credential_id) on delete cascade,
  installation_id uuid not null references public.ops_manager_device_auth_v2_installations(installation_id) on delete restrict,
  key_generation_id uuid not null references public.ops_manager_device_auth_v2_key_generations(key_generation_id) on delete restrict,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  manager_roles text[] not null,
  device_id text not null,
  authority_epoch bigint not null,
  requested_access_level text not null,
  granted_access_level text not null,
  token_hash text not null unique,
  attestation_challenge_id uuid not null references public.ops_manager_device_auth_v2_attestation_challenges(challenge_id) on delete restrict,
  attestation_evidence_digest text not null,
  envelope_algorithm text not null,
  envelope_ephemeral_public_key_jwk jsonb not null,
  envelope_ephemeral_key_id text not null,
  envelope_salt text not null,
  envelope_iv text not null,
  envelope_ciphertext text not null,
  envelope_tag text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_reason text null,
  retain_until timestamptz not null,
  constraint ops_manager_device_auth_v2_session_hashes_check check (
    request_fingerprint ~ '^[a-f0-9]{64}$' and proof_nonce ~ '^[A-Za-z0-9_-]{22}$'
    and token_hash ~ '^[a-f0-9]{64}$' and attestation_evidence_digest ~ '^[a-f0-9]{64}$'
  ),
  constraint ops_manager_device_auth_v2_session_device_check
    check (device_id ~ '^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint ops_manager_device_auth_v2_session_epoch_check check (authority_epoch >= 1),
  constraint ops_manager_device_auth_v2_session_roles_check check (
    manager_roles = array['OPS_MANAGER']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER']::text[]
    or manager_roles = array['OPS_MANAGER','DIRECTOR']::text[]
    or manager_roles = array['OPS_MANAGER','SECURITY_ADMIN']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN']::text[]
    or manager_roles = array['OPS_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
    or manager_roles = array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  ),
  constraint ops_manager_device_auth_v2_session_access_check check (
    requested_access_level in ('read_only','full_access') and granted_access_level in ('read_only','full_access')
    and (requested_access_level = 'full_access' or granted_access_level = 'read_only')
  ),
  constraint ops_manager_device_auth_v2_session_envelope_check check (
    envelope_algorithm = 'ECDH-P256-HKDF-SHA256+A256GCM'
    and envelope_ephemeral_key_id ~ '^[A-Za-z0-9_-]{43}$'
    and envelope_salt ~ '^[A-Za-z0-9_-]{43}$' and envelope_iv ~ '^[A-Za-z0-9_-]{16}$'
    and length(envelope_ciphertext) between 32 and 16384 and envelope_ciphertext ~ '^[A-Za-z0-9_-]+$'
    and envelope_tag ~ '^[A-Za-z0-9_-]{22}$'
    and jsonb_typeof(envelope_ephemeral_public_key_jwk) = 'object'
    and envelope_ephemeral_public_key_jwk ?& array['kty','crv','x','y']
    and envelope_ephemeral_public_key_jwk - 'kty' - 'crv' - 'x' - 'y' = '{}'::jsonb
    and envelope_ephemeral_public_key_jwk->>'kty' = 'EC'
    and envelope_ephemeral_public_key_jwk->>'crv' = 'P-256'
    and envelope_ephemeral_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$'
    and envelope_ephemeral_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  constraint ops_manager_device_auth_v2_session_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '1 hour'
    and retain_until >= created_at + interval '90 days'
  ),
  constraint ops_manager_device_auth_v2_session_revocation_check check (
    (revoked_at is null and revoked_reason is null)
    or (revoked_at is not null and revoked_at >= created_at and length(revoked_reason) between 1 and 160)
  ),
  constraint ops_manager_device_auth_v2_session_generation_binding_fkey
    foreign key (installation_id, key_generation_id)
    references public.ops_manager_device_auth_v2_key_generations(installation_id, key_generation_id)
    on delete restrict
);
create index idx_ops_manager_device_auth_v2_sessions_active
  on public.ops_manager_device_auth_v2_sessions(credential_id, expires_at)
  where revoked_at is null;
create index idx_ops_manager_device_auth_v2_sessions_credential
  on public.ops_manager_device_auth_v2_sessions(credential_id);
create index idx_ops_manager_device_auth_v2_sessions_installation
  on public.ops_manager_device_auth_v2_sessions(installation_id);
create index idx_ops_manager_device_auth_v2_sessions_generation
  on public.ops_manager_device_auth_v2_sessions(key_generation_id);
create index idx_ops_manager_device_auth_v2_sessions_generation_binding
  on public.ops_manager_device_auth_v2_sessions(installation_id,key_generation_id);
create index idx_ops_manager_device_auth_v2_sessions_manager
  on public.ops_manager_device_auth_v2_sessions(manager_id);
create index idx_ops_manager_device_auth_v2_sessions_challenge
  on public.ops_manager_device_auth_v2_sessions(attestation_challenge_id);
create index idx_ops_manager_device_auth_v2_sessions_retention
  on public.ops_manager_device_auth_v2_sessions(retain_until, session_id);

create table public.ops_manager_device_auth_v2_removal_operations (
  operation_id uuid primary key,
  request_fingerprint text not null,
  proof_nonce text not null,
  credential_id uuid not null,
  credential_verifier text not null,
  installation_id uuid not null references public.ops_manager_device_auth_v2_installations(installation_id) on delete restrict,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  device_id text not null,
  status text not null default 'removed',
  result_json jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  retain_until timestamptz not null,
  constraint ops_manager_device_auth_v2_removal_hashes_check check (
    request_fingerprint ~ '^[a-f0-9]{64}$' and proof_nonce ~ '^[A-Za-z0-9_-]{22}$'
    and credential_verifier ~ '^[a-f0-9]{64}$'
  ),
  constraint ops_manager_device_auth_v2_removal_device_check
    check (device_id ~ '^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint ops_manager_device_auth_v2_removal_status_check check (status = 'removed'),
  constraint ops_manager_device_auth_v2_removal_result_check
    check (jsonb_typeof(result_json) = 'object' and pg_column_size(result_json) <= 8192),
  constraint ops_manager_device_auth_v2_removal_time_check
    check (updated_at = created_at and retain_until >= created_at + interval '90 days')
);
create index idx_ops_manager_device_auth_v2_removal_retention
  on public.ops_manager_device_auth_v2_removal_operations(retain_until, operation_id);
create index idx_ops_manager_device_auth_v2_removal_installation
  on public.ops_manager_device_auth_v2_removal_operations(installation_id);
create index idx_ops_manager_device_auth_v2_removal_manager
  on public.ops_manager_device_auth_v2_removal_operations(manager_id);

create table public.ops_manager_device_auth_v2_nonces (
  signing_key_id text not null,
  nonce text not null,
  operation_id uuid not null,
  request_fingerprint text not null,
  resource_kind text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (signing_key_id, nonce),
  constraint ops_manager_device_auth_v2_nonce_shape_check check (
    signing_key_id ~ '^[A-Za-z0-9_-]{43}$' and nonce ~ '^[A-Za-z0-9_-]{22}$'
    and request_fingerprint ~ '^[a-f0-9]{64}$'
    and resource_kind in ('challenge','enrollment','resume','confirm','cancel','removal','session')
  ),
  constraint ops_manager_device_auth_v2_nonce_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create index idx_ops_manager_device_auth_v2_nonces_expiry
  on public.ops_manager_device_auth_v2_nonces(expires_at, signing_key_id, nonce);

create table public.ops_manager_device_auth_v2_rate_limits (
  key_hash text primary key,
  failure_count integer not null default 0,
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  locked_until timestamptz null,
  request_count integer not null default 0,
  request_window_started_at timestamptz null,
  last_request_at timestamptz null,
  constraint ops_manager_device_auth_v2_rate_shape_check check (
    key_hash ~ '^[a-f0-9]{64}$' and failure_count between 0 and 1000
    and request_count between 0 and 1000
    and last_failed_at >= first_failed_at and (locked_until is null or locked_until >= last_failed_at)
    and (
      (request_count = 0 and request_window_started_at is null and last_request_at is null)
      or (request_count > 0 and request_window_started_at is not null
          and last_request_at is not null and last_request_at >= request_window_started_at)
    )
  )
);

-- A reserved v2 code cannot be stolen by the legacy v1 function. The check is
-- deferred until v1 attempts its final status update, so its entire insert is
-- rolled back without affecting the live device.
create or replace function public.ops_manager_protect_v2_code_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_contract text;
begin
  if old.status = 'pending_confirmation' and old.reserved_operation_id is not null and new.status = 'used' then
    select auth_contract_version into v_contract
      from public.ops_manager_trusted_devices
     where credential_id = new.consumed_credential_id;
    if v_contract is distinct from 'manager-device-auth.v2' then
      raise exception using errcode = '55000', message = 'manager enrollment code is reserved by device-auth v2';
    end if;
  end if;
  return new;
end
$function$;
drop trigger if exists trg_ops_manager_protect_v2_code_reservation on public.ops_manager_enrollment_codes;
create trigger trg_ops_manager_protect_v2_code_reservation
before update on public.ops_manager_enrollment_codes
for each row execute function public.ops_manager_protect_v2_code_reservation();
revoke all on function public.ops_manager_protect_v2_code_reservation() from public, anon, authenticated;
grant execute on function public.ops_manager_protect_v2_code_reservation() to postgres, service_role;

alter table public.ops_manager_device_auth_v2_installations enable row level security;
alter table public.ops_manager_device_auth_v2_installations force row level security;
alter table public.ops_manager_device_auth_v2_key_generations enable row level security;
alter table public.ops_manager_device_auth_v2_key_generations force row level security;
alter table public.ops_manager_device_auth_v2_attestation_challenges enable row level security;
alter table public.ops_manager_device_auth_v2_attestation_challenges force row level security;
alter table public.ops_manager_device_auth_v2_attestation_verifications enable row level security;
alter table public.ops_manager_device_auth_v2_attestation_verifications force row level security;
alter table public.ops_manager_device_auth_v2_operations enable row level security;
alter table public.ops_manager_device_auth_v2_operations force row level security;
alter table public.ops_manager_device_auth_v2_credential_installations enable row level security;
alter table public.ops_manager_device_auth_v2_credential_installations force row level security;
alter table public.ops_manager_device_auth_v2_sessions enable row level security;
alter table public.ops_manager_device_auth_v2_sessions force row level security;
alter table public.ops_manager_device_auth_v2_removal_operations enable row level security;
alter table public.ops_manager_device_auth_v2_removal_operations force row level security;
alter table public.ops_manager_device_auth_v2_nonces enable row level security;
alter table public.ops_manager_device_auth_v2_nonces force row level security;
alter table public.ops_manager_device_auth_v2_rate_limits enable row level security;
alter table public.ops_manager_device_auth_v2_rate_limits force row level security;

revoke all on table public.ops_manager_device_auth_v2_installations from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_key_generations from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_attestation_challenges from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_attestation_verifications from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_operations from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_credential_installations from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_sessions from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_removal_operations from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_nonces from public, anon, authenticated, service_role;
revoke all on table public.ops_manager_device_auth_v2_rate_limits from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.ops_manager_device_auth_v2_installations to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_key_generations to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_attestation_challenges to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_attestation_verifications to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_operations to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_credential_installations to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_sessions to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_removal_operations to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_nonces to postgres;
grant select, insert, update, delete on table public.ops_manager_device_auth_v2_rate_limits to postgres;

comment on table public.ops_manager_device_auth_v2_installations is
  'Durable native Manager installation identity. Apple App Attest key/counter survive credential rotations and are retired on removal.';
comment on table public.ops_manager_device_auth_v2_key_generations is
  'Pending, active, and retired transport-key generations. Recovery promotes a new pair atomically without replacing the App Attest installation key.';
comment on table public.ops_manager_device_auth_v2_operations is
  'Restart-safe Manager native enrollment operations. No plaintext device credential is persisted.';
comment on table public.ops_manager_device_auth_v2_sessions is
  'Short-lived device-sealed Ops session results bound to credential authority epoch and attestation.';
comment on table public.ops_manager_device_auth_v2_removal_operations is
  'Idempotent retained removal receipts; verifier is keyed and plaintext credentials are never stored.';

commit;
