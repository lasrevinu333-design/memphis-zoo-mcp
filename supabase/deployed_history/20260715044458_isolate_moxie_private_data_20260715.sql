-- Deployed migration history snapshot: 20260715044458 isolate_moxie_private_data_20260715

do $do$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'annie_chat_state',
    'annie_contacts',
    'annie_deliverables',
    'annie_log_notes',
    'annie_log_reminders',
    'annie_log_suggested_reminders',
    'annie_suggested_contacts'
  ]
  loop
    if to_regclass(format('public.%I',v_table)) is null then
      raise exception 'Expected Moxie table public.% is missing', v_table;
    end if;

    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated',v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role',v_table);

    for v_policy in
      select policyname
      from pg_policies
      where schemaname='public' and tablename=v_table
    loop
      execute format('drop policy if exists %I on public.%I',v_policy.policyname,v_table);
    end loop;
  end loop;
end
$do$;

create table if not exists public.moxie_access_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_identity text not null default 'moxie',
  data_domain text not null,
  access_mode text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint moxie_access_audit_mode_check check (access_mode in ('read','write','deny'))
);

alter table public.moxie_access_audit enable row level security;
revoke all on table public.moxie_access_audit from public, anon, authenticated;
grant select, insert on table public.moxie_access_audit to service_role;
create index if not exists idx_moxie_access_audit_created_at on public.moxie_access_audit(created_at desc);
create index if not exists idx_moxie_access_audit_domain on public.moxie_access_audit(data_domain,created_at desc);

comment on table public.moxie_access_audit is 'Server-side audit of Moxie data access. Memphis modules are not authorized to read Annie/Moxie state tables.';
