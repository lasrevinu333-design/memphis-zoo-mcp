-- Deployed migration history snapshot: 20260715040708 foundational_runtime_schema_preprovision_20260715

create table if not exists public.guest_cleanliness_reports (
  id uuid primary key default gen_random_uuid(),
  location_code text not null,
  location_name text null,
  issue_type text not null,
  severity text not null,
  notes text null,
  status text not null default 'open',
  source text not null default 'guest_qr',
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz null,
  notification_status text not null default 'pending',
  notified_employee_user_id uuid null,
  notified_ops_count integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb
);
create index if not exists idx_guest_cleanliness_reports_submitted_at on public.guest_cleanliness_reports (submitted_at desc);
create index if not exists idx_guest_cleanliness_reports_location_code on public.guest_cleanliness_reports (location_code);
create index if not exists idx_guest_cleanliness_reports_status on public.guest_cleanliness_reports (status);

create table if not exists public.system_feedback_items (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'other',
  priority text not null default 'normal',
  message text not null,
  submitted_by text null,
  hub_context text not null default 'unknown',
  device_id text null,
  page_url text null,
  status text not null default 'new',
  summary text null,
  notification_status text not null default 'pending',
  notified_ops_count integer not null default 0,
  last_feedback_reminder_at timestamptz null,
  feedback_reminder_count integer not null default 0,
  acknowledged_at timestamptz null,
  acknowledged_by text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.system_feedback_items add column if not exists last_feedback_reminder_at timestamptz null;
alter table public.system_feedback_items add column if not exists feedback_reminder_count integer not null default 0;
alter table public.system_feedback_items add column if not exists acknowledged_at timestamptz null;
alter table public.system_feedback_items add column if not exists acknowledged_by text null;
create index if not exists idx_system_feedback_items_created_at on public.system_feedback_items (created_at desc);
create index if not exists idx_system_feedback_items_status on public.system_feedback_items (status);
create index if not exists idx_system_feedback_items_priority on public.system_feedback_items (priority);
create index if not exists idx_system_feedback_items_hub_context on public.system_feedback_items (hub_context);
create index if not exists idx_system_feedback_items_reminder_due on public.system_feedback_items (status, last_feedback_reminder_at);

create table if not exists public.schedule_automation_runs (
  automation_key text not null,
  service_date date not null,
  status text not null default 'completed',
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (automation_key, service_date)
);

create table if not exists public.employee_planned_time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  pto_type text not null default 'PTO',
  source text not null default 'import',
  notes text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_planned_time_off_date_order check (end_date >= start_date),
  constraint employee_planned_time_off_unique unique (employee_id, start_date, end_date, pto_type, source)
);
create index if not exists employee_planned_time_off_active_dates_idx on public.employee_planned_time_off (active, start_date, end_date);
create index if not exists employee_planned_time_off_employee_dates_idx on public.employee_planned_time_off (employee_id, start_date, end_date);
