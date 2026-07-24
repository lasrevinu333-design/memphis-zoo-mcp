-- Restore non-executable schema documentation present in the authoritative
-- source chain but absent from the hosted production catalog.

comment on table public.ops_manager_device_security_config is
  'Argon2id Device Security application password hash and rotation version. No plaintext password is stored.';

comment on table public.ops_manager_device_security_sessions is
  'Short-lived second-factor Device Security sessions for SECURITY_ADMIN trusted manager devices.';

comment on table public.ops_manager_managers is
  'Named passwordless Ops Manager principals. Device trust is stored separately in ops_manager_trusted_devices.';

comment on function public.ops_manager_consume_manager_invitation(
  text, uuid, text, text, text, text, text, text, timestamptz, jsonb
) is
  'Atomically consumes a role-bound named-manager invitation and enrolls the opening browser as a trusted Ops Manager device.';
