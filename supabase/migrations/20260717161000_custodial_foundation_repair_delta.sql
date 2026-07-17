-- Memphis Zoo Custodial Program foundation repair delta.
-- Forward-only and data-preserving.  Baseline remains the captured production schema;
-- this migration contains operational repairs required after the baseline.

begin;

alter table public.device_auth_policy
  drop constraint if exists device_auth_policy_mode_check;

alter table public.device_auth_policy
  add constraint device_auth_policy_mode_check
  check (mode = any (array['observe'::text, 'enroll'::text, 'enforce-ready'::text, 'enforce'::text]));

create or replace function public.device_auth_evaluate_and_enforce()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_active_devices integer;
  v_confirmed_devices integer;
  v_mode text;
  v_changed boolean := false;
begin
  select count(*) into v_active_devices
  from public.devices d
  where d.active = true and d.device_id ~ '^KIOSK_(0[2-9]|10)$';

  select count(distinct c.device_id) into v_confirmed_devices
  from public.device_auth_credentials c
  join public.devices d on d.id = c.device_id
  where d.active = true
    and d.device_id ~ '^KIOSK_(0[2-9]|10)$'
    and c.confirmed_at is not null
    and c.revoked_at is null
    and c.expires_at > now();

  select coalesce(p.mode, trim(both '"' from s.setting_value::text), 'observe')
    into v_mode
  from public.system_settings s
  full join public.device_auth_policy p on p.singleton = true
  where s.setting_key = 'device_auth_rollout_mode'
     or p.singleton = true
  limit 1;

  if v_mode = 'enroll' and v_active_devices = 9 and v_confirmed_devices = v_active_devices then
    insert into public.device_auth_policy(singleton, mode, updated_by, updated_at)
    values (true, 'enforce-ready', 'device_auth_evaluate_and_enforce', now())
    on conflict (singleton) do update
      set mode = excluded.mode,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;

    update public.system_settings
    set setting_value = '"enforce-ready"'::jsonb,
        description = 'All expected employee kiosks have confirmed credentials. Physical acceptance is still required before enforce.',
        updated_at = now()
    where setting_key = 'device_auth_rollout_mode';

    insert into public.release_validation_runs(release_id, area, status, details_json)
    values(
      'custodial-foundation-repair-20260717',
      'device_credential_enforce_ready',
      'pass',
      jsonb_build_object(
        'active_employee_devices', v_active_devices,
        'confirmed_devices', v_confirmed_devices,
        'previous_mode', v_mode,
        'new_mode', 'enforce-ready',
        'requires_physical_acceptance', true,
        'evaluated_at', now()
      )
    );
    v_mode := 'enforce-ready';
    v_changed := true;
  end if;

  return jsonb_build_object(
    'active_employee_devices', v_active_devices,
    'confirmed_devices', v_confirmed_devices,
    'mode', v_mode,
    'changed', v_changed,
    'physical_acceptance_required_for_enforce', true
  );
end
$function$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'system-feedback-private',
      'system-feedback-private',
      false,
      5242880,
      array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types,
          updated_at = now();
  end if;
end $$;

commit;
