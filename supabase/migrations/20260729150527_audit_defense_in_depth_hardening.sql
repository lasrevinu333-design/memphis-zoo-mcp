begin;

-- These append-only audit tables were introduced after the canonical public
-- schema grant hardening. Keep them behind the backend service boundary even
-- if a future grant is added accidentally.
alter table public.custodial_employee_device_assignment_history enable row level security;
alter table public.custodial_employee_device_assignment_history force row level security;
revoke all on table public.custodial_employee_device_assignment_history from public, anon, authenticated;
grant select, insert, update, delete on table public.custodial_employee_device_assignment_history to postgres, service_role;

drop policy if exists custodial_employee_device_assignment_history_service_all
  on public.custodial_employee_device_assignment_history;
create policy custodial_employee_device_assignment_history_service_all
  on public.custodial_employee_device_assignment_history
  for all
  to service_role
  using (true)
  with check (true);

alter table public.custodial_employee_status_history enable row level security;
alter table public.custodial_employee_status_history force row level security;
revoke all on table public.custodial_employee_status_history from public, anon, authenticated;
grant select, insert, update, delete on table public.custodial_employee_status_history to postgres, service_role;

drop policy if exists custodial_employee_status_history_service_all
  on public.custodial_employee_status_history;
create policy custodial_employee_status_history_service_all
  on public.custodial_employee_status_history
  for all
  to service_role
  using (true)
  with check (true);

-- Sequences currently have no browser-role grants. Preserve that boundary for
-- existing and future sequences as well as tables and functions.
revoke all privileges on all sequences in schema public from public, anon, authenticated;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

commit;
