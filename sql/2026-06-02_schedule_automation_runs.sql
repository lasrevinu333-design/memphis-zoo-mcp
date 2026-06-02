-- Persistent run markers for schedule automations that must survive service restarts.
-- Used first by the 9:45am restroom rebalance to avoid repeat scheduled runs
-- after Render/app restarts later in the same service day.

create table if not exists public.schedule_automation_runs (
  automation_key text not null,
  service_date date not null,
  status text not null default 'completed',
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (automation_key, service_date)
);

create index if not exists idx_schedule_automation_runs_service_date
  on public.schedule_automation_runs (service_date desc);
