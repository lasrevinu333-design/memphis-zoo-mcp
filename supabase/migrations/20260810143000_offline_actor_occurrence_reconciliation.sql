begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Phase A is deliberately additive.  It does not replace a legacy completion
-- writer: it only gives a current backend a durable way to activate a specific
-- offline occurrence before the device loses connectivity.  Enforcement is in
-- the later 20260810150000 migration after a dual-client window exists.
create table if not exists public.custodial_backend_execution_config (
  config_key boolean primary key default true check (config_key),
  execution_secret_digest text,
  enabled boolean not null default false,
  configured_at timestamptz,
  configured_by text,
  check (execution_secret_digest is null or execution_secret_digest ~ '^[0-9a-f]{64}$')
);

insert into public.custodial_backend_execution_config(config_key, enabled)
values (true, false)
on conflict (config_key) do nothing;

create table if not exists public.custodial_offline_actor_contexts (
  context_id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null unique default gen_random_uuid(),
  client_session_id text not null unique check (length(btrim(client_session_id)) between 1 and 200),
  device_id uuid not null references public.devices(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  credential_id uuid not null references public.device_auth_credentials(credential_id) on delete restrict,
  assignment_epoch bigint not null check (assignment_epoch >= 1),
  assignment_change_id uuid references public.custodial_employee_device_assignment_history(assignment_change_id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  canonical_location_code text not null,
  location_aliases jsonb not null default '[]'::jsonb,
  started_at timestamptz not null,
  occurrence_fingerprint text not null unique check (occurrence_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'activated' check (status in ('activated','committed','quarantined','cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > started_at)
);

create table if not exists public.custodial_offline_submission_proofs (
  submission_id uuid primary key default gen_random_uuid(),
  context_id uuid not null unique references public.custodial_offline_actor_contexts(context_id) on delete restrict,
  proof_digest text not null unique check (proof_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'issued' check (state in ('issued','consumed','quarantined')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists idx_custodial_offline_actor_contexts_actor_time
  on public.custodial_offline_actor_contexts(employee_id, device_id, started_at desc);

-- The secret digest is configured by the deployment owner after this migration
-- and paired with CUSTODIAL_BACKEND_PROOF_SECRET on the backend.  There is no
-- default credential and no production secret in source control.
create or replace function public.custodial_configure_backend_execution_key(
  p_execution_secret_digest text,
  p_configured_by text default 'release-owner'
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if coalesce(p_execution_secret_digest, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='execution secret digest must be a lowercase SHA-256 hex digest';
  end if;
  insert into public.custodial_backend_execution_config(config_key, execution_secret_digest, enabled, configured_at, configured_by)
  values (true, p_execution_secret_digest, true, now(), left(coalesce(p_configured_by, 'release-owner'), 200))
  on conflict (config_key) do update set
    execution_secret_digest=excluded.execution_secret_digest,
    enabled=true,
    configured_at=excluded.configured_at,
    configured_by=excluded.configured_by;
end
$function$;

create or replace function public.custodial_require_backend_execution_secret(p_execution_secret text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_expected text;
  v_enabled boolean;
begin
  select execution_secret_digest, enabled into v_expected, v_enabled
    from public.custodial_backend_execution_config
   where config_key=true;
  if v_enabled is not true or v_expected is null
     or coalesce(p_execution_secret, '') = ''
     or encode(extensions.digest(convert_to(p_execution_secret, 'UTF8'), 'sha256'), 'hex') <> v_expected then
    raise exception using errcode='42501', message='custodial backend execution boundary is not authorized';
  end if;
  perform set_config('custodial.backend_execution_secret', p_execution_secret, true);
end
$function$;

create or replace function public.custodial_backend_transition_allowed()
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_expected text;
begin
  select execution_secret_digest into v_expected from public.custodial_backend_execution_config where config_key=true and enabled=true;
  return coalesce(v_expected is not null
    and encode(extensions.digest(convert_to(current_setting('custodial.backend_execution_secret', true), 'UTF8'), 'sha256'), 'hex') = v_expected, false);
end
$function$;

create or replace function public.custodial_reject_offline_evidence_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='23514', message='Custodial offline authority evidence is append-only';
  end if;
  if not public.custodial_backend_transition_allowed() then
    raise exception using errcode='23514', message='Custodial offline authority evidence is immutable outside the canonical writer';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_custodial_offline_context_immutable on public.custodial_offline_actor_contexts;
create trigger trg_custodial_offline_context_immutable
before update or delete on public.custodial_offline_actor_contexts
for each row execute function public.custodial_reject_offline_evidence_mutation();
drop trigger if exists trg_custodial_offline_proof_immutable on public.custodial_offline_submission_proofs;
create trigger trg_custodial_offline_proof_immutable
before update or delete on public.custodial_offline_submission_proofs
for each row execute function public.custodial_reject_offline_evidence_mutation();

create or replace function public.custodial_start_offline_occurrence(
  p_device_id text,
  p_location_code text,
  p_client_session_id text,
  p_client_started_at text,
  p_authenticated_credential_id text,
  p_backend_execution_secret text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_client_session_id text := nullif(btrim(coalesce(p_client_session_id, '')), '');
  v_credential_id uuid;
  v_started_at timestamptz;
  v_device record;
  v_location record;
  v_context public.custodial_offline_actor_contexts%rowtype;
  v_existing public.custodial_offline_actor_contexts%rowtype;
  v_assignment_change_id uuid;
  v_proof text := encode(extensions.gen_random_bytes(32), 'hex');
  v_fingerprint text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_client_session_id is null or length(v_client_session_id) > 200 then
    raise exception using errcode='22023', message='client_session_id is required for offline occurrence activation';
  end if;
  begin
    v_credential_id := nullif(lower(btrim(coalesce(p_authenticated_credential_id, ''))), '')::uuid;
    v_started_at := nullif(btrim(coalesce(p_client_started_at, '')), '')::timestamptz;
  exception when others then
    raise exception using errcode='22023', message='offline occurrence activation requires canonical credential and start timestamp';
  end;
  if v_started_at > now() + interval '10 minutes' or v_started_at < now() - interval '7 days' then
    raise exception using errcode='22023', message='offline occurrence start timestamp is outside the accepted window';
  end if;

  select * into v_existing from public.custodial_offline_actor_contexts where client_session_id=v_client_session_id for update;
  if v_existing.context_id is not null then
    if upper(btrim(coalesce(p_device_id, ''))) <> upper((select device_id from public.devices where id=v_existing.device_id))
       or v_existing.credential_id <> v_credential_id
       or v_existing.canonical_location_code <> public.resolve_scan_location_code(p_location_code)
       or v_existing.started_at <> v_started_at then
      raise exception using errcode='23505', message='offline occurrence activation replay does not match the original occurrence';
    end if;
    select encode(extensions.digest(convert_to(v_proof, 'UTF8'), 'sha256'), 'hex') into v_fingerprint;
    -- A raw proof is intentionally returned only on first activation.  A replay
    -- is safe but cannot mint a second committable proof.
    return jsonb_build_object('context_id', v_existing.context_id, 'occurrence_id', v_existing.occurrence_id,
      'client_session_id', v_existing.client_session_id, 'started_at', v_existing.started_at,
      'proof_replay_requires_durable_local_copy', true, 'schema_version', 'offline-authority.v2');
  end if;

  select d.id, d.device_id, d.assigned_employee_id, d.assignment_epoch, e.active as employee_active,
         c.credential_id, c.confirmed_at, c.revoked_at, c.expires_at
    into v_device
    from public.devices d
    join public.employees e on e.id=d.assigned_employee_id
    join public.device_auth_credentials c on c.credential_id=v_credential_id and c.device_id=d.id
   where upper(btrim(d.device_id))=upper(btrim(p_device_id)) and d.active=true
   for update of d;
  if v_device.id is null or v_device.assigned_employee_id is null or v_device.employee_active is not true
     or v_device.confirmed_at is null or v_device.revoked_at is not null or v_device.expires_at <= now() then
    raise exception using errcode='42501', message='active authenticated actor assignment is required for offline occurrence activation';
  end if;
  -- Location aliases are resolved by resolve_scan_location_code.  Preserve both
  -- the canonical code and the exact normalized presented alias in the proof.
  select l.id, l.location_code,
         jsonb_build_array(l.location_code, upper(btrim(p_location_code))) as aliases
    into v_location
    from public.locations l
   where l.location_code=public.resolve_scan_location_code(p_location_code) and l.active=true;
  if v_location.id is null then
    raise exception using errcode='22023', message='active canonical location is required for offline occurrence activation';
  end if;
  select h.assignment_change_id into v_assignment_change_id
    from public.custodial_employee_device_assignment_history h
   where h.device_id=v_device.id and h.new_employee_id=v_device.assigned_employee_id
   order by h.changed_at desc limit 1;
  if v_assignment_change_id is null then
    raise exception using errcode='42501', message='an authoritative device assignment epoch is required for offline occurrence activation';
  end if;
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'client_session_id',v_client_session_id,'device_id',v_device.id::text,'employee_id',v_device.assigned_employee_id::text,
    'credential_id',v_credential_id::text,'assignment_epoch',v_device.assignment_epoch,'assignment_change_id',v_assignment_change_id::text,
    'location_id',v_location.id::text,'location_code',v_location.location_code,'location_aliases',v_location.aliases,'started_at',v_started_at
  )::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.custodial_offline_actor_contexts(
    client_session_id, device_id, employee_id, credential_id, assignment_epoch, assignment_change_id, location_id,
    canonical_location_code, location_aliases, started_at, occurrence_fingerprint, expires_at
  ) values (
    v_client_session_id, v_device.id, v_device.assigned_employee_id, v_credential_id, v_device.assignment_epoch, v_assignment_change_id,
    v_location.id, v_location.location_code, v_location.aliases, v_started_at, v_fingerprint, now() + interval '7 days'
  ) returning * into v_context;
  insert into public.custodial_offline_submission_proofs(context_id, proof_digest)
  values (v_context.context_id, encode(extensions.digest(convert_to(v_proof, 'UTF8'), 'sha256'), 'hex'));
  return jsonb_build_object(
    'context_id',v_context.context_id,'occurrence_id',v_context.occurrence_id,'client_session_id',v_context.client_session_id,
    'canonical_location_code',v_context.canonical_location_code,'location_aliases',v_context.location_aliases,
    'started_at',v_context.started_at,'submission_proof',v_proof,'expires_at',v_context.expires_at,
    'schema_version','offline-authority.v2','committable',true
  );
end
$function$;

create or replace function public.tool_start_offline_occurrence(
  p_device_id text,
  p_location_code text,
  p_client_session_id text,
  p_client_started_at text,
  p_authenticated_credential_id text,
  p_backend_execution_secret text
)
returns jsonb language sql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
  select public.custodial_start_offline_occurrence(
    p_device_id,p_location_code,p_client_session_id,p_client_started_at,p_authenticated_credential_id,p_backend_execution_secret
  );
$function$;

revoke all on table public.custodial_backend_execution_config, public.custodial_offline_actor_contexts, public.custodial_offline_submission_proofs from public, anon, authenticated, service_role;
revoke all on function public.custodial_configure_backend_execution_key(text,text) from public, anon, authenticated, service_role;
revoke all on function public.custodial_require_backend_execution_secret(text) from public, anon, authenticated;
revoke all on function public.custodial_backend_transition_allowed() from public, anon, authenticated;
revoke all on function public.custodial_start_offline_occurrence(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.tool_start_offline_occurrence(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.custodial_start_offline_occurrence(text,text,text,text,text,text) to postgres, service_role;
grant execute on function public.tool_start_offline_occurrence(text,text,text,text,text,text) to postgres, service_role;

commit;
