begin;

lock table public.ops_manager_trusted_devices in share row exclusive mode;

update public.ops_manager_trusted_devices
set metadata_json = coalesce(metadata_json, '{}'::jsonb)
      || jsonb_build_object(
        'pre_bounded_trust_expires_at', expires_at,
        'trust_boundary_migrated_at', now(),
        'trust_boundary_policy', 'max_365_days_default_90_days'
      ),
    expires_at = created_at + interval '365 days'
where expires_at > created_at + interval '365 days';

alter table public.ops_manager_trusted_devices
  drop constraint if exists ops_manager_trusted_devices_bounded_lifetime;

alter table public.ops_manager_trusted_devices
  add constraint ops_manager_trusted_devices_bounded_lifetime
  check (expires_at <= created_at + interval '365 days');

comment on constraint ops_manager_trusted_devices_bounded_lifetime
  on public.ops_manager_trusted_devices is
  'Manager device trust is bounded to 365 days; the application default is 90 days.';

commit;
