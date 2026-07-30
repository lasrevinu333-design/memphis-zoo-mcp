begin;

insert into public.employees(employee_code,display_name,active,role,notes)
values
  ('COVERALL_01','CoverAll_01',true,'staff','Third-party CoverAll custodial slot. Used for extra event/traffic help or 3+ absence escalation.'),
  ('COVERALL_02','CoverAll_02',true,'staff','Third-party CoverAll custodial slot. Used for extra event/traffic help or 3+ absence escalation.'),
  ('COVERALL_03','CoverAll_03',true,'staff','Third-party CoverAll custodial slot. Used for extra event/traffic help or 3+ absence escalation.'),
  ('COVERALL_04','CoverAll_04',true,'staff','Third-party CoverAll custodial slot. Used for extra event/traffic help or 3+ absence escalation.')
on conflict(employee_code) do nothing;

create table if not exists public.coverall_assignment_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  service_date date not null,
  slot_code text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  constraint coverall_assignment_links_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint coverall_assignment_links_slot_code_check check (slot_code in ('COVERALL_01','COVERALL_02','COVERALL_03','COVERALL_04')),
  constraint coverall_assignment_links_creator_length_check check (length(created_by) between 1 and 160),
  constraint coverall_assignment_links_revoker_length_check check (revoked_by is null or length(revoked_by) between 1 and 160),
  constraint coverall_assignment_links_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);

alter table public.coverall_assignment_links enable row level security;
alter table public.coverall_assignment_links force row level security;
revoke all on table public.coverall_assignment_links from public,anon,authenticated;
grant select,insert,update,delete on table public.coverall_assignment_links to service_role,postgres;

create index if not exists idx_coverall_assignment_links_lookup
  on public.coverall_assignment_links(token_hash,service_date,slot_code,expires_at)
  where revoked_at is null;
create index if not exists idx_coverall_assignment_links_management
  on public.coverall_assignment_links(service_date,slot_code,created_at desc);

alter table public.public_submission_rate_limits
  drop constraint if exists public_submission_rate_limits_scope_check;
alter table public.public_submission_rate_limits
  add constraint public_submission_rate_limits_scope_check
  check (scope in ('feedback','guest','coverall_assignment'));

comment on table public.coverall_assignment_links is
  'Hashed, manager-issued, expiring and revocable access grants for public CoverAll assignment pages.';

commit;
