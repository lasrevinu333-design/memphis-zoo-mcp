-- Shared 48-hour Ops Manager enrollment passcode.
--
-- Forward-only and data-preserving:
--   * preserves every existing trusted manager device, including Eric's desktop;
--   * revokes only unconsumed legacy invitation/code artifacts;
--   * keeps legacy tables/functions for rollback evidence while runtime routes are retired;
--   * stores only the HMAC hash of the shared numeric passcode.

create extension if not exists pgcrypto with schema extensions;

alter table public.ops_manager_managers
  add column if not exists system_key text null;

alter table public.ops_manager_managers
  drop constraint if exists ops_manager_managers_roles_valid;

alter table public.ops_manager_managers
  add constraint ops_manager_managers_roles_valid check (
    cardinality(roles) >= 1
    and roles <@ array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  );

alter table public.ops_manager_managers
  drop constraint if exists ops_manager_managers_system_key_len;

alter table public.ops_manager_managers
  add constraint ops_manager_managers_system_key_len check (
    system_key is null or system_key ~ '^[a-z][a-z0-9_]{2,63}$'
  );

create unique index if not exists idx_ops_manager_managers_system_key
  on public.ops_manager_managers (system_key)
  where system_key is not null;

-- The existing bootstrap manager is the canonical custodial manager.  This
-- predicate is stable in empty rebuilds and production and does not depend on a
-- newly generated identifier.
update public.ops_manager_managers
set roles = array['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN']::text[],
    system_key = 'eric_custodial_manager',
    metadata_json = metadata_json || jsonb_build_object(
      'custodial_manager_authority', true,
      'shared_enrollment_migration', '20260718055946'
    )
where metadata_json @> '{"bootstrap":true}'::jsonb
  and lower(btrim(display_name)) = 'eric';

do $block$
begin
  if (select count(*) from public.ops_manager_managers where system_key = 'eric_custodial_manager') <> 1 then
    raise exception 'exactly one Eric custodial manager principal is required';
  end if;
end;
$block$;

insert into public.ops_manager_managers (
  display_name,
  contact_label,
  roles,
  active,
  created_by_manager_id,
  metadata_json,
  system_key
)
select
  'Shared Ops Manager Enrollment',
  'System principal for shared 48-hour enrollment devices',
  array['OPS_MANAGER']::text[],
  true,
  creator.manager_id,
  jsonb_build_object(
    'system_principal', true,
    'purpose', 'shared_48_hour_ops_manager_enrollment',
    'source_migration', '20260718055946'
  ),
  'shared_ops_manager'
from public.ops_manager_managers creator
where creator.system_key = 'eric_custodial_manager'
on conflict (system_key) where system_key is not null do update
set roles = array['OPS_MANAGER']::text[],
    active = true,
    revoked_at = null,
    revoked_reason = null,
    metadata_json = public.ops_manager_managers.metadata_json || excluded.metadata_json;

create table if not exists public.ops_manager_shared_enrollment_windows (
  window_id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  created_by_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  created_by_credential_id uuid not null references public.ops_manager_trusted_devices(credential_id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  disabled_at timestamptz null,
  disabled_by_manager_id uuid null references public.ops_manager_managers(manager_id) on delete set null,
  disabled_by_credential_id uuid null references public.ops_manager_trusted_devices(credential_id) on delete set null,
  disabled_reason text null,
  replaced_by_window_id uuid null references public.ops_manager_shared_enrollment_windows(window_id) on delete set null,
  enrollment_count integer not null default 0,
  failed_attempt_count integer not null default 0,
  last_enrolled_at timestamptz null,
  status text not null default 'active',
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_shared_windows_hash_len check (code_hash ~ '^[a-f0-9]{64}$'),
  constraint ops_manager_shared_windows_exact_lifetime check (expires_at = created_at + interval '48 hours'),
  constraint ops_manager_shared_windows_status check (status in ('active','expired','disabled','replaced')),
  constraint ops_manager_shared_windows_counts check (enrollment_count >= 0 and failed_attempt_count >= 0),
  constraint ops_manager_shared_windows_reason_len check (disabled_reason is null or length(disabled_reason) <= 160),
  constraint ops_manager_shared_windows_metadata_object check (jsonb_typeof(metadata_json) = 'object'),
  constraint ops_manager_shared_windows_disabled_consistent check (
    (status = 'active' and disabled_at is null and replaced_by_window_id is null)
    or (status = 'expired' and disabled_at is null and replaced_by_window_id is null)
    or (status = 'disabled' and disabled_at is not null and replaced_by_window_id is null)
    or (status = 'replaced' and disabled_at is not null and replaced_by_window_id is not null)
  )
);

create unique index if not exists idx_ops_manager_shared_windows_one_active
  on public.ops_manager_shared_enrollment_windows ((status))
  where status = 'active';

create index if not exists idx_ops_manager_shared_windows_history
  on public.ops_manager_shared_enrollment_windows (created_at desc);

create index if not exists idx_ops_manager_shared_windows_expires
  on public.ops_manager_shared_enrollment_windows (expires_at)
  where status = 'active';

alter table public.ops_manager_shared_enrollment_windows enable row level security;
alter table public.ops_manager_shared_enrollment_windows force row level security;
revoke all on table public.ops_manager_shared_enrollment_windows from public, anon, authenticated;
grant select, insert, update on table public.ops_manager_shared_enrollment_windows to postgres, service_role;

alter table public.ops_manager_trusted_devices
  add column if not exists shared_enrollment_window_id uuid null
    references public.ops_manager_shared_enrollment_windows(window_id) on delete set null;

create index if not exists idx_ops_manager_trusted_devices_shared_window
  on public.ops_manager_trusted_devices (shared_enrollment_window_id, created_at desc)
  where shared_enrollment_window_id is not null;

create table if not exists public.ops_manager_shared_enrollment_rate_limits (
  key_hash text primary key,
  failure_count integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  locked_until timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_shared_rate_key_len check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint ops_manager_shared_rate_count check (failure_count between 0 and 1000),
  constraint ops_manager_shared_rate_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists idx_ops_manager_shared_rate_locked
  on public.ops_manager_shared_enrollment_rate_limits (locked_until)
  where locked_until is not null;

alter table public.ops_manager_shared_enrollment_rate_limits enable row level security;
alter table public.ops_manager_shared_enrollment_rate_limits force row level security;
revoke all on table public.ops_manager_shared_enrollment_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_manager_shared_enrollment_rate_limits to postgres, service_role;

create or replace function public.ops_manager_create_shared_enrollment_window(
  p_code_hash text,
  p_created_by_manager_id uuid,
  p_created_by_credential_id uuid,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_actor public.ops_manager_managers%rowtype;
  v_device public.ops_manager_trusted_devices%rowtype;
  v_shared_manager public.ops_manager_managers%rowtype;
  v_old public.ops_manager_shared_enrollment_windows%rowtype;
  v_new public.ops_manager_shared_enrollment_windows%rowtype;
  v_now timestamptz := clock_timestamp();
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
begin
  perform pg_advisory_xact_lock(hashtextextended('ops-manager-shared-enrollment-window', 0));

  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid code hash is required';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;

  select * into v_actor
  from public.ops_manager_managers
  where manager_id = p_created_by_manager_id
  for update;

  if not found or not v_actor.active or v_actor.revoked_at is not null
     or not ('CUSTODIAL_MANAGER' = any(v_actor.roles)) then
    return jsonb_build_object('ok', false, 'status', 403, 'reason', 'custodial_manager_required');
  end if;

  select * into v_device
  from public.ops_manager_trusted_devices
  where credential_id = p_created_by_credential_id
    and manager_id = v_actor.manager_id
    and revoked_at is null
    and expires_at > v_now
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 403, 'reason', 'active_creator_device_required');
  end if;

  select * into v_shared_manager
  from public.ops_manager_managers
  where system_key = 'shared_ops_manager'
    and active
    and revoked_at is null
  for update;

  if not found or v_shared_manager.roles <> array['OPS_MANAGER']::text[] then
    return jsonb_build_object('ok', false, 'status', 503, 'reason', 'shared_manager_unavailable');
  end if;

  select * into v_old
  from public.ops_manager_shared_enrollment_windows
  where status = 'active'
  for update;

  if found then
    update public.ops_manager_shared_enrollment_windows
    set status = case when expires_at <= v_now then 'expired' else 'disabled' end,
        disabled_at = case when expires_at <= v_now then null else v_now end,
        disabled_by_manager_id = case when expires_at <= v_now then null else v_actor.manager_id end,
        disabled_by_credential_id = case when expires_at <= v_now then null else v_device.credential_id end,
        disabled_reason = case when expires_at <= v_now then null else 'replaced_by_new_window' end,
        metadata_json = metadata_json || jsonb_build_object('closed_at', v_now)
    where window_id = v_old.window_id;
  end if;

  insert into public.ops_manager_shared_enrollment_windows (
    code_hash, manager_id, created_by_manager_id, created_by_credential_id,
    created_at, expires_at, metadata_json
  ) values (
    lower(p_code_hash), v_shared_manager.manager_id, v_actor.manager_id,
    v_device.credential_id, v_now, v_now + interval '48 hours',
    v_metadata || jsonb_build_object('role_snapshot', 'OPS_MANAGER')
  ) returning * into v_new;

  if v_old.window_id is not null and v_old.expires_at > v_now then
    update public.ops_manager_shared_enrollment_windows
    set status = 'replaced',
        replaced_by_window_id = v_new.window_id
    where window_id = v_old.window_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'window_id', v_new.window_id,
    'status', v_new.status,
    'created_at', v_new.created_at,
    'expires_at', v_new.expires_at,
    'enrollment_count', v_new.enrollment_count,
    'replaced_window_id', v_old.window_id
  );
end;
$function$;

create or replace function public.ops_manager_disable_shared_enrollment_window(
  p_window_id uuid,
  p_actor_manager_id uuid,
  p_actor_credential_id uuid,
  p_reason text default 'disabled_by_custodial_manager'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor public.ops_manager_managers%rowtype;
  v_device public.ops_manager_trusted_devices%rowtype;
  v_window public.ops_manager_shared_enrollment_windows%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('ops-manager-shared-enrollment-window', 0));

  select * into v_actor from public.ops_manager_managers
  where manager_id = p_actor_manager_id for update;
  if not found or not v_actor.active or v_actor.revoked_at is not null
     or not ('CUSTODIAL_MANAGER' = any(v_actor.roles)) then
    return jsonb_build_object('ok', false, 'status', 403, 'reason', 'custodial_manager_required');
  end if;

  select * into v_device from public.ops_manager_trusted_devices
  where credential_id = p_actor_credential_id
    and manager_id = v_actor.manager_id
    and revoked_at is null
    and expires_at > v_now
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 403, 'reason', 'active_creator_device_required');
  end if;

  select * into v_window from public.ops_manager_shared_enrollment_windows
  where window_id = p_window_id for update;
  if not found then return jsonb_build_object('ok', false, 'status', 404, 'reason', 'not_found'); end if;
  if v_window.status <> 'active' then
    return jsonb_build_object('ok', true, 'window_id', v_window.window_id, 'status', v_window.status, 'already_closed', true);
  end if;

  update public.ops_manager_shared_enrollment_windows
  set status = case when expires_at <= v_now then 'expired' else 'disabled' end,
      disabled_at = case when expires_at <= v_now then null else v_now end,
      disabled_by_manager_id = case when expires_at <= v_now then null else v_actor.manager_id end,
      disabled_by_credential_id = case when expires_at <= v_now then null else v_device.credential_id end,
      disabled_reason = case when expires_at <= v_now then null else left(coalesce(nullif(btrim(p_reason), ''), 'disabled_by_custodial_manager'), 160) end,
      metadata_json = metadata_json || jsonb_build_object('closed_at', v_now)
  where window_id = v_window.window_id
  returning * into v_window;

  return jsonb_build_object('ok', true, 'window_id', v_window.window_id, 'status', v_window.status, 'disabled_at', v_window.disabled_at);
end;
$function$;

create or replace function public.ops_manager_consume_shared_enrollment_window(
  p_code_hash text,
  p_credential_id uuid,
  p_device_id text,
  p_device_label text,
  p_trust_token_hash text,
  p_user_agent_hash text default null,
  p_created_ip_hash text default null,
  p_platform_summary text default null,
  p_expires_at timestamptz default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_window public.ops_manager_shared_enrollment_windows%rowtype;
  v_manager public.ops_manager_managers%rowtype;
  v_device public.ops_manager_trusted_devices%rowtype;
  v_now timestamptz := clock_timestamp();
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'malformed');
  end if;
  if p_credential_id is null then raise exception 'credential_id is required'; end if;
  if p_device_id is null or length(btrim(p_device_id)) not between 1 and 96 then
    raise exception 'valid device_id is required';
  end if;
  if p_device_label is null or length(btrim(p_device_label)) not between 1 and 160 then
    raise exception 'valid device_label is required';
  end if;
  if p_trust_token_hash is null or p_trust_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid trust token hash is required';
  end if;
  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'future trusted-device expiration is required';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then raise exception 'metadata_json must be an object'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ops-manager-shared-enrollment-window', 0));

  select * into v_window
  from public.ops_manager_shared_enrollment_windows
  where status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'inactive');
  end if;

  if v_window.expires_at <= v_now then
    update public.ops_manager_shared_enrollment_windows
    set status = 'expired', metadata_json = metadata_json || jsonb_build_object('expired_checked_at', v_now)
    where window_id = v_window.window_id;
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'expired');
  end if;

  if v_window.code_hash <> lower(p_code_hash) then
    update public.ops_manager_shared_enrollment_windows
    set failed_attempt_count = failed_attempt_count + 1,
        metadata_json = metadata_json || jsonb_build_object('last_failed_at', v_now)
    where window_id = v_window.window_id;
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'invalid');
  end if;

  select * into v_manager
  from public.ops_manager_managers
  where manager_id = v_window.manager_id
  for update;

  if not found or not v_manager.active or v_manager.revoked_at is not null
     or v_manager.roles <> array['OPS_MANAGER']::text[] then
    return jsonb_build_object('ok', false, 'status', 503, 'reason', 'shared_manager_unavailable');
  end if;

  update public.ops_manager_trusted_devices
  set revoked_at = v_now,
      revoked_reason = 'device_re_enrolled_by_shared_window'
  where device_id = btrim(p_device_id)
    and revoked_at is null;

  insert into public.ops_manager_trusted_devices (
    credential_id, device_id, device_label, token_hash, max_access_level,
    manager_id, shared_enrollment_window_id, user_agent_hash, created_ip_hash,
    platform_summary, expires_at, metadata_json
  ) values (
    p_credential_id, btrim(p_device_id), btrim(p_device_label), lower(p_trust_token_hash),
    'full_access', v_manager.manager_id, v_window.window_id, p_user_agent_hash,
    p_created_ip_hash, nullif(left(coalesce(p_platform_summary, ''), 160), ''),
    p_expires_at,
    v_metadata || jsonb_build_object(
      'shared_enrollment_window_id', v_window.window_id,
      'enrollment_source', 'shared_48_hour_passcode',
      'role_snapshot', 'OPS_MANAGER'
    )
  ) returning * into v_device;

  update public.ops_manager_shared_enrollment_windows
  set enrollment_count = enrollment_count + 1,
      last_enrolled_at = v_now
  where window_id = v_window.window_id;

  update public.ops_manager_managers
  set last_access_at = v_now
  where manager_id = v_manager.manager_id;

  return jsonb_build_object(
    'ok', true,
    'window_id', v_window.window_id,
    'manager', jsonb_build_object(
      'manager_id', v_manager.manager_id,
      'display_name', v_manager.display_name,
      'roles', to_jsonb(v_manager.roles),
      'active', v_manager.active
    ),
    'trusted_device', jsonb_build_object(
      'credential_id', v_device.credential_id,
      'device_id', v_device.device_id,
      'device_label', v_device.device_label,
      'manager_id', v_device.manager_id,
      'shared_enrollment_window_id', v_window.window_id,
      'max_access_level', v_device.max_access_level,
      'created_at', v_device.created_at,
      'expires_at', v_device.expires_at
    )
  );
end;
$function$;

revoke all on function public.ops_manager_create_shared_enrollment_window(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ops_manager_disable_shared_enrollment_window(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ops_manager_consume_shared_enrollment_window(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.ops_manager_create_shared_enrollment_window(text, uuid, uuid, jsonb) to postgres, service_role;
grant execute on function public.ops_manager_disable_shared_enrollment_window(uuid, uuid, uuid, text) to postgres, service_role;
grant execute on function public.ops_manager_consume_shared_enrollment_window(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) to postgres, service_role;

-- Sanitize unconsumed legacy artifacts without removing history or affecting any
-- previously enrolled device.
update public.ops_manager_pairing_tokens
set revoked_at = coalesce(revoked_at, now()),
    revoked_reason = coalesce(revoked_reason, 'retired_shared_48_hour_enrollment'),
    metadata_json = metadata_json || jsonb_build_object('retired_by_migration', '20260718055946')
where revoked_at is null
  and coalesce(use_count, 0) < coalesce(max_uses, 1)
  and used_at is null;

update public.ops_manager_enrollment_codes
set revoked_at = coalesce(revoked_at, now()),
    revoked_reason = coalesce(revoked_reason, 'retired_shared_48_hour_enrollment'),
    status = case when status = 'active' then 'revoked' else status end,
    metadata_json = metadata_json || jsonb_build_object('retired_by_migration', '20260718055946')
where consumed_at is null
  and revoked_at is null
  and status = 'active';

comment on table public.ops_manager_shared_enrollment_windows is
  'One active shared Ops Manager enrollment window at a time. The server returns an eight-digit passcode once; only its keyed HMAC is persisted. Each successful use creates a separate revocable OPS_MANAGER device and does not consume the window.';
comment on table public.ops_manager_shared_enrollment_rate_limits is
  'Durable privacy-preserving per-browser/IP abuse limits for the shared numeric enrollment passcode.';
comment on function public.ops_manager_create_shared_enrollment_window(text, uuid, uuid, jsonb) is
  'CUSTODIAL_MANAGER-only transaction that atomically replaces any active shared enrollment window with a new exact 48-hour window.';
comment on function public.ops_manager_consume_shared_enrollment_window(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) is
  'Atomically enrolls one independent OPS_MANAGER browser from the active shared passcode without invalidating the passcode for other approved browsers.';
