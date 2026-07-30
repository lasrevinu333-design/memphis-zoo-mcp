-- Cover every remaining public-schema foreign key with a leading-column index.
-- These tables are currently small, but the indexes prevent full scans and
-- excessive locking as inspections, notifications, and audit history grow.
set lock_timeout = '5s';
set statement_timeout = '30s';

create index if not exists idx_cleaning_inspections_inspector_manager_id_fkey
  on public.cleaning_inspections (inspector_manager_id);

create index if not exists idx_custodial_employee_device_history_previous_employee_id_fkey
  on public.custodial_employee_device_assignment_history (previous_employee_id);

create index if not exists idx_cust_device_history_changed_by_manager_id_fkey
  on public.custodial_employee_device_assignment_history (changed_by_manager_id);

create index if not exists idx_cust_status_history_changed_by_manager_id_fkey
  on public.custodial_employee_status_history (changed_by_manager_id);

create index if not exists idx_device_auth_enrollment_codes_revoked_by_manager_id_fkey
  on public.device_auth_enrollment_codes (revoked_by_manager_id);

create index if not exists idx_employee_push_registrations_device_id_fkey
  on public.employee_push_registrations (device_id);

create index if not exists idx_event_default_rules_primary_venue_id_fkey
  on public.event_default_rules (primary_venue_id);

create index if not exists idx_event_push_instances_credential_id_fkey
  on public.event_push_instances (credential_id);

create index if not exists idx_event_push_instances_device_id_fkey
  on public.event_push_instances (device_id);

create index if not exists idx_event_push_instances_employee_id_fkey
  on public.event_push_instances (employee_id);

create index if not exists idx_gemini_console_repair_jobs_approving_credential_id_fkey
  on public.gemini_console_repair_jobs (approving_credential_id);

create index if not exists idx_gemini_console_repair_jobs_authorization_message_id_fkey
  on public.gemini_console_repair_jobs (authorization_message_id);

create index if not exists idx_msg_message_audit_thread_id_fkey
  on public.msg_message_audit (thread_id);

create index if not exists idx_ops_device_security_config_rotated_by_manager_id_fkey
  on public.ops_manager_device_security_config (rotated_by_manager_id);

create index if not exists idx_ops_manager_device_security_sessions_credential_id_fkey
  on public.ops_manager_device_security_sessions (credential_id);

create index if not exists idx_ops_manager_enrollment_codes_consumed_credential_id_fkey
  on public.ops_manager_enrollment_codes (consumed_credential_id);

create index if not exists idx_ops_manager_enrollment_codes_created_by_credential_id_fkey
  on public.ops_manager_enrollment_codes (created_by_credential_id);

create index if not exists idx_ops_manager_notification_queue_manager_id_fkey
  on public.ops_manager_notification_queue (manager_id);

create index if not exists idx_ops_manager_security_code_events_credential_id_fkey
  on public.ops_manager_security_code_events (credential_id);

create index if not exists idx_ops_manager_security_code_events_manager_id_fkey
  on public.ops_manager_security_code_events (manager_id);

create index if not exists idx_ops_manager_security_code_events_target_device_id_fkey
  on public.ops_manager_security_code_events (target_device_id);
