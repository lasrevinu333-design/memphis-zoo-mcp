begin;

insert into public.system_settings(setting_key,setting_value,description,updated_at)
values
  ('guest_issues_feature_approved','false'::jsonb,'Guest QR cleanliness reporting remains disabled until Memphis Zoo approval and sticker rollout.',now()),
  ('guest_issues_marketing_review_required','true'::jsonb,'Future guest reports must be reviewed by Marketing before dispatch to Operations Managers and the currently assigned custodian.',now()),
  ('guest_contact_retention_days','30'::jsonb,'Guest contact details are removed when a report is resolved or rejected and should not remain pending longer than 30 days.',now())
on conflict(setting_key) do update
set setting_value=excluded.setting_value,
    description=excluded.description,
    updated_at=now();

alter table public.guest_cleanliness_reports
  add column if not exists marketing_review_status text not null default 'pending',
  add column if not exists marketing_reviewed_at timestamptz,
  add column if not exists marketing_reviewed_by text,
  add column if not exists marketing_review_notes text,
  add column if not exists dispatched_at timestamptz,
  add column if not exists resolved_by text;

update public.guest_cleanliness_reports
set status='pending_marketing_review',
    marketing_review_status='pending',
    notification_status='awaiting_marketing_review',
    notified_employee_user_id=null,
    notified_ops_count=0
where status not in ('resolved','rejected');

alter table public.guest_cleanliness_reports alter column status set default 'pending_marketing_review';
alter table public.guest_cleanliness_reports alter column notification_status set default 'awaiting_marketing_review';

alter table public.guest_cleanliness_reports drop constraint if exists guest_cleanliness_reports_issue_type_check;
alter table public.guest_cleanliness_reports add constraint guest_cleanliness_reports_issue_type_check
  check (length(btrim(issue_type)) between 1 and 160);
alter table public.guest_cleanliness_reports drop constraint if exists guest_cleanliness_reports_severity_check;
alter table public.guest_cleanliness_reports add constraint guest_cleanliness_reports_severity_check
  check (severity in ('normal','high','urgent'));
alter table public.guest_cleanliness_reports drop constraint if exists guest_cleanliness_reports_notes_length_check;
alter table public.guest_cleanliness_reports add constraint guest_cleanliness_reports_notes_length_check
  check (notes is null or length(notes) <= 2000);
alter table public.guest_cleanliness_reports drop constraint if exists guest_cleanliness_reports_status_check;
alter table public.guest_cleanliness_reports add constraint guest_cleanliness_reports_status_check
  check (status in ('pending_marketing_review','open','resolved','rejected'));
alter table public.guest_cleanliness_reports drop constraint if exists guest_cleanliness_reports_marketing_review_check;
alter table public.guest_cleanliness_reports add constraint guest_cleanliness_reports_marketing_review_check
  check (marketing_review_status in ('pending','approved','rejected'));
alter table public.guest_cleanliness_reports drop constraint if exists guest_cleanliness_reports_marketing_notes_length_check;
alter table public.guest_cleanliness_reports add constraint guest_cleanliness_reports_marketing_notes_length_check
  check (marketing_review_notes is null or length(marketing_review_notes) <= 2000);
alter table public.guest_cleanliness_reports drop constraint if exists guest_cleanliness_reports_metadata_contact_check;
alter table public.guest_cleanliness_reports add constraint guest_cleanliness_reports_metadata_contact_check
  check (
    length(coalesce(metadata_json->'reporter'->>'name','')) <= 160
    and length(coalesce(metadata_json->'reporter'->>'phone','')) <= 40
    and length(coalesce(metadata_json->'reporter'->>'email','')) <= 320
    and length(coalesce(metadata_json->>'ip','')) <= 64
    and length(coalesce(metadata_json->>'user_agent','')) <= 500
  );

create or replace function public.redact_guest_report_contact_on_terminal()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $function$
begin
  if new.status in ('resolved','rejected') and old.status is distinct from new.status then
    new.metadata_json := (coalesce(new.metadata_json,'{}'::jsonb) - 'reporter' - 'ip' - 'user_agent')
      || jsonb_build_object('guest_contact_redacted_at',now());
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_redact_guest_report_contact_on_terminal on public.guest_cleanliness_reports;
create trigger trg_redact_guest_report_contact_on_terminal
before update on public.guest_cleanliness_reports
for each row execute function public.redact_guest_report_contact_on_terminal();

revoke all on function public.redact_guest_report_contact_on_terminal() from public,anon,authenticated;

create or replace function public.redact_stale_guest_report_contact(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_changed integer := 0;
begin
  update public.guest_cleanliness_reports
  set metadata_json=(coalesce(metadata_json,'{}'::jsonb) - 'reporter' - 'ip' - 'user_agent')
      || jsonb_build_object('guest_contact_redacted_at',p_now,'guest_contact_redaction_reason','retention_limit'),
      marketing_review_notes=case
        when status='pending_marketing_review' then coalesce(marketing_review_notes,'Guest contact removed after the 30-day privacy retention limit.')
        else marketing_review_notes
      end
  where submitted_at < p_now - interval '30 days'
    and (
      metadata_json ? 'reporter'
      or metadata_json ? 'ip'
      or metadata_json ? 'user_agent'
    );
  get diagnostics v_changed=row_count;
  return v_changed;
end;
$function$;

revoke all on function public.redact_stale_guest_report_contact(timestamptz) from public,anon,authenticated;
grant execute on function public.redact_stale_guest_report_contact(timestamptz) to postgres,service_role;

alter table public.system_feedback_items drop constraint if exists system_feedback_items_category_check;
alter table public.system_feedback_items add constraint system_feedback_items_category_check
  check (length(btrim(category)) between 1 and 80 and category ~ '^[a-z0-9_]+$');
alter table public.system_feedback_items drop constraint if exists system_feedback_items_priority_check;
alter table public.system_feedback_items add constraint system_feedback_items_priority_check
  check (priority in ('low','normal','high','urgent'));
alter table public.system_feedback_items drop constraint if exists system_feedback_items_message_length_check;
alter table public.system_feedback_items add constraint system_feedback_items_message_length_check
  check (length(btrim(message)) between 1 and 12000);
alter table public.system_feedback_items drop constraint if exists system_feedback_items_identity_lengths_check;
alter table public.system_feedback_items add constraint system_feedback_items_identity_lengths_check
  check (
    length(coalesce(submitted_by,'')) <= 160
    and length(hub_context) <= 80
    and length(coalesce(device_id,'')) <= 160
    and length(coalesce(page_url,'')) <= 1000
    and length(coalesce(summary,'')) <= 500
  );
alter table public.system_feedback_items drop constraint if exists system_feedback_items_status_check;
alter table public.system_feedback_items add constraint system_feedback_items_status_check
  check (status in ('new','acknowledged','resolved','closed','reminder_exhausted'));

create table if not exists public.public_submission_rate_limits (
  bucket_key text primary key,
  scope text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  constraint public_submission_rate_limits_bucket_check check (bucket_key ~ '^[0-9a-f]{64}$'),
  constraint public_submission_rate_limits_scope_check check (scope in ('feedback','guest')),
  constraint public_submission_rate_limits_count_check check (request_count between 1 and 100000)
);

alter table public.public_submission_rate_limits enable row level security;
alter table public.public_submission_rate_limits force row level security;
revoke all on table public.public_submission_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on table public.public_submission_rate_limits to service_role,postgres;

create index if not exists idx_public_submission_rate_limits_updated
  on public.public_submission_rate_limits(updated_at);

create or replace function public.purge_stale_public_submission_rate_limits(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_changed integer := 0;
begin
  delete from public.public_submission_rate_limits
  where updated_at < p_now - interval '10 minutes';
  get diagnostics v_changed=row_count;
  return v_changed;
end;
$function$;

revoke all on function public.purge_stale_public_submission_rate_limits(timestamptz) from public,anon,authenticated;
grant execute on function public.purge_stale_public_submission_rate_limits(timestamptz) to postgres,service_role;

do $block$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron schedule function is required for guest-contact and public-rate-limit retention';
  end if;
  perform cron.schedule(
    'mz-guest-contact-retention-daily',
    '35 3 * * *',
    'select public.redact_stale_guest_report_contact(now());'
  );
  perform cron.schedule(
    'mz-public-submission-rate-limit-cleanup-hourly',
    '42 * * * *',
    'select public.purge_stale_public_submission_rate_limits(now());'
  );
end;
$block$;

comment on table public.public_submission_rate_limits is
  'Durable, service-only public submission throttles; bucket keys are HMACs and never store raw IP addresses.';
comment on column public.guest_cleanliness_reports.marketing_review_status is
  'Marketing-first approval gate. Only approved reports may be dispatched to Operations Managers and the current location custodian.';

commit;
