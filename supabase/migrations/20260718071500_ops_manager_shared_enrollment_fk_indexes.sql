-- Cover every foreign key used by shared manager-enrollment audit and cleanup.
-- Forward-only and online-safe: these tables are new and currently contain only
-- disposable acceptance history.

create index if not exists idx_ops_manager_shared_windows_manager
  on public.ops_manager_shared_enrollment_windows (manager_id);

create index if not exists idx_ops_manager_shared_windows_created_by_manager
  on public.ops_manager_shared_enrollment_windows (created_by_manager_id);

create index if not exists idx_ops_manager_shared_windows_created_by_credential
  on public.ops_manager_shared_enrollment_windows (created_by_credential_id);

create index if not exists idx_ops_manager_shared_windows_disabled_by_manager
  on public.ops_manager_shared_enrollment_windows (disabled_by_manager_id)
  where disabled_by_manager_id is not null;

create index if not exists idx_ops_manager_shared_windows_disabled_by_credential
  on public.ops_manager_shared_enrollment_windows (disabled_by_credential_id)
  where disabled_by_credential_id is not null;

create index if not exists idx_ops_manager_shared_windows_replaced_by
  on public.ops_manager_shared_enrollment_windows (replaced_by_window_id)
  where replaced_by_window_id is not null;
