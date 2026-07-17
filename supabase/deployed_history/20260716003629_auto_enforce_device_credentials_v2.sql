-- Deployed migration history snapshot: 20260716003629 auto_enforce_device_credentials_v2

create or replace function public.device_auth_evaluate_and_enforce()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_active_devices integer;
  v_confirmed_devices integer;
  v_mode text;
  v_changed boolean := false;
begin
  select count(*) into v_active_devices
  from public.devices d
  where d.active=true and d.device_id ~ '^KIOSK_(0[2-9]|10)$';

  select count(distinct c.device_id) into v_confirmed_devices
  from public.device_auth_credentials c
  join public.devices d on d.id=c.device_id
  where d.active=true
    and d.device_id ~ '^KIOSK_(0[2-9]|10)$'
    and c.confirmed_at is not null
    and c.revoked_at is null
    and c.expires_at>now();

  select trim(both '"' from s.setting_value::text) into v_mode
  from public.system_settings s
  where s.setting_key='device_auth_rollout_mode';

  if v_mode='enroll' and v_active_devices=9 and v_confirmed_devices=v_active_devices then
    update public.system_settings
    set setting_value='"enforce"'::jsonb,
        description='Cryptographic device credentials are required for every employee kiosk. Enabled automatically after 9/9 confirmed enrollment.',
        updated_at=now()
    where setting_key='device_auth_rollout_mode';

    insert into public.release_validation_runs(release_id,area,status,details_json)
    values(
      'release-2026.07.16.foundation-stable.1',
      'device_credential_automatic_enforcement',
      'pass',
      jsonb_build_object(
        'active_employee_devices',v_active_devices,
        'confirmed_devices',v_confirmed_devices,
        'previous_mode',v_mode,
        'new_mode','enforce',
        'enabled_at',now()
      )
    );
    v_mode := 'enforce';
    v_changed := true;
  end if;

  return jsonb_build_object(
    'active_employee_devices',v_active_devices,
    'confirmed_devices',v_confirmed_devices,
    'mode',v_mode,
    'changed',v_changed
  );
end
$function$;

revoke all on function public.device_auth_evaluate_and_enforce() from public,anon,authenticated;
grant execute on function public.device_auth_evaluate_and_enforce() to service_role;

create or replace function public.device_auth_auto_enforce_when_ready()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
begin
  perform public.device_auth_evaluate_and_enforce();
  return coalesce(new,old);
end
$function$;

revoke all on function public.device_auth_auto_enforce_when_ready() from public,anon,authenticated;
grant execute on function public.device_auth_auto_enforce_when_ready() to service_role;

drop trigger if exists trg_device_auth_auto_enforce on public.device_auth_credentials;
create trigger trg_device_auth_auto_enforce
after insert or update of confirmed_at,revoked_at,expires_at on public.device_auth_credentials
for each statement execute function public.device_auth_auto_enforce_when_ready();

select public.device_auth_evaluate_and_enforce();
