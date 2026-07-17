-- Source backfill for production-applied corrective migration 20260717170136.
-- Forward-only/data-preserving.  This fixes device_auth_evaluate_and_enforce()
-- so policy/settings lookup does not depend on an invalid FULL JOIN condition,
-- and keeps production in enforce-ready rather than enforce until physical
-- phone acceptance is complete.

begin;

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

  select coalesce(
    (select p.mode from public.device_auth_policy p where p.singleton = true limit 1),
    (select trim(both '"' from s.setting_value::text) from public.system_settings s where s.setting_key = 'device_auth_rollout_mode' limit 1),
    'observe'
  ) into v_mode;

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

revoke all on function public.device_auth_evaluate_and_enforce() from public, anon, authenticated;
grant execute on function public.device_auth_evaluate_and_enforce() to postgres, service_role;

commit;
