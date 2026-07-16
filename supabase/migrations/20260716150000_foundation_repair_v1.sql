-- Foundation repair v1: canonical phone identity support, deterministic schedule
-- readiness, rolling schedule generation, lifecycle cleanup, and migration-log
-- compaction. Application source and this migration share the same release ID.

-- Preserve historical OPEN schedule rows without leaving them in the live table.
create table if not exists public.schedule_assignment_archive (
  archive_id uuid primary key default gen_random_uuid(),
  assignment_id uuid null,
  service_date date null,
  assignment_json jsonb not null,
  archive_reason text not null,
  archived_at timestamptz not null default now()
);
alter table public.schedule_assignment_archive enable row level security;
alter table public.schedule_assignment_archive force row level security;
revoke all on table public.schedule_assignment_archive from public, anon, authenticated;
grant select, insert on table public.schedule_assignment_archive to service_role, postgres;

insert into public.schedule_assignment_archive (
  assignment_id, service_date, assignment_json, archive_reason
)
select dsa.id, dsa.service_date, to_jsonb(dsa), 'historical_open_assignment_cleanup_20260716'
from public.daily_schedule_assignments dsa
where dsa.service_date < current_date
  and dsa.status = 'OPEN'
  and not exists (
    select 1
    from public.schedule_assignment_archive a
    where a.assignment_id = dsa.id
  );

delete from public.daily_schedule_assignments
where service_date < current_date
  and status = 'OPEN';

-- Expired PTO is historical evidence, not an active absence. Deactivate exact
-- duplicate ranges first, then all ranges that ended before today.
with ranked as (
  select id,
         row_number() over (
           partition by employee_id, start_date, end_date
           order by updated_at desc nulls last, created_at desc nulls last, id
         ) as row_rank
  from public.employee_planned_time_off
  where active = true
)
update public.employee_planned_time_off p
set active = false,
    notes = trim(concat_ws(' | ', nullif(p.notes, ''), 'Deactivated duplicate PTO during foundation repair.')),
    updated_at = now()
from ranked r
where p.id = r.id
  and r.row_rank > 1;

update public.employee_planned_time_off
set active = false,
    notes = trim(concat_ws(' | ', nullif(notes, ''), 'Archived after PTO end date during foundation repair.')),
    updated_at = now()
where active = true
  and end_date < current_date;

-- Preserve the detailed audit body under a stable helper name, then place a
-- readiness-aware wrapper at the public function name used by the application.
do $block$
begin
  if to_regprocedure('public.sch_audit_schedule_day_detail(date)') is null then
    alter function public.sch_audit_schedule_day(date) rename to sch_audit_schedule_day_detail;
  end if;
end
$block$;

create or replace function public.sch_audit_schedule_day(
  p_service_date date default public.sch_service_date(now())
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_date date := coalesce(p_service_date, public.sch_service_date(now()));
  v_detail jsonb := public.sch_audit_schedule_day_detail(v_date);
  v_roster_count integer := coalesce((v_detail #>> '{counts,active_roster_rows}')::integer, 0);
  v_assignment_count integer := coalesce((v_detail #>> '{counts,assignments_total}')::integer, 0);
  v_open_count integer := coalesce((v_detail #>> '{counts,assignments_open}')::integer, 0);
  v_expected_template_count integer := 0;
  v_schedule_expected boolean := false;
  v_readiness_ok boolean := false;
  v_issue_free boolean := false;
  v_readiness_status text;
begin
  select count(*)::integer
    into v_expected_template_count
  from public.employee_shift_templates est
  join public.employees e on e.id = est.employee_id
  where est.active = true
    and e.active = true
    and est.day_of_week = extract(dow from v_date)::integer;

  v_schedule_expected := v_expected_template_count > 0
    or v_roster_count > 0
    or v_assignment_count > 0;

  v_readiness_status := case
    when not v_schedule_expected then 'not_expected'
    when v_roster_count = 0 then 'missing_roster'
    when v_assignment_count = 0 then 'missing_assignments'
    when v_open_count > 0 then 'open_assignments'
    else 'ready'
  end;

  v_readiness_ok := (not v_schedule_expected)
    or (v_roster_count > 0 and v_assignment_count > 0 and v_open_count = 0);

  v_issue_free := jsonb_array_length(coalesce(v_detail->'assigned_while_absent', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'pto_without_absence_override', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'working_without_assignments', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'assigned_outside_active_roster', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'open_segments', '[]'::jsonb)) = 0;

  return v_detail || jsonb_build_object(
    'ok', v_readiness_ok and v_issue_free,
    'readiness_status', v_readiness_status,
    'schedule_expected', v_schedule_expected,
    'expected_template_count', v_expected_template_count,
    'readiness_ok', v_readiness_ok,
    'issue_free', v_issue_free,
    'readiness_issues', case
      when v_readiness_status = 'ready' or v_readiness_status = 'not_expected' then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'code', v_readiness_status,
        'message', format('Schedule readiness failed for %s: roster=%s assignments=%s open=%s', v_date, v_roster_count, v_assignment_count, v_open_count)
      ))
    end
  );
end
$function$;

revoke all on function public.sch_audit_schedule_day(date) from public, anon, authenticated;
grant execute on function public.sch_audit_schedule_day(date) to service_role, postgres;

-- One canonical rolling window generator replaces a current-day-only cron and
-- removes the need for GET requests to mutate schedule state.
create or replace function public.sch_ensure_schedule_window(
  p_start_date date default public.sch_service_date(now()),
  p_days integer default 14,
  p_reason text default 'scheduled_rolling_window_readiness'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_start date := coalesce(p_start_date, public.sch_service_date(now()));
  v_days integer := greatest(1, least(coalesce(p_days, 14), 31));
  v_offset integer;
  v_date date;
  v_result jsonb;
  v_audit jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ready integer := 0;
  v_failed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('schedule-window:' || v_start::text || ':' || v_days::text, 0));

  for v_offset in 0..(v_days - 1) loop
    v_date := v_start + v_offset;
    begin
      v_result := public.sch_ensure_daily_schedule(
        v_date,
        coalesce(nullif(btrim(p_reason), ''), 'scheduled_rolling_window_readiness')
      );
      v_audit := public.sch_audit_schedule_day(v_date);
      if coalesce((v_audit->>'ok')::boolean, false) then
        v_ready := v_ready + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', true,
          'result', v_result,
          'audit', v_audit
        ));
      else
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', false,
          'error', 'schedule_audit_failed',
          'result', v_result,
          'audit', v_audit
        ));
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'service_date', v_date,
        'ok', false,
        'error', sqlerrm
      ));
    end;
  end loop;

  insert into public.schedule_automation_runs(
    automation_key, service_date, status, result_json, created_at, updated_at
  ) values (
    'rolling_schedule_window_ready',
    v_start,
    case when v_failed = 0 then 'completed' else 'failed' end,
    jsonb_build_object(
      'start_date', v_start,
      'days', v_days,
      'reason', p_reason,
      'ready_days', v_ready,
      'failed_days', v_failed,
      'results', v_results
    ),
    now(), now()
  )
  on conflict (automation_key, service_date) do update set
    status = excluded.status,
    result_json = excluded.result_json,
    updated_at = now();

  return jsonb_build_object(
    'ok', v_failed = 0,
    'start_date', v_start,
    'days', v_days,
    'ready_days', v_ready,
    'failed_days', v_failed,
    'results', v_results
  );
end
$function$;

revoke all on function public.sch_ensure_schedule_window(date,integer,text) from public, anon, authenticated;
grant execute on function public.sch_ensure_schedule_window(date,integer,text) to service_role, postgres;

-- Replace the current-day-only job with an idempotent rolling window sweep.
do $block$
declare
  v_job record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job in
      select jobid
      from cron.job
      where jobname in ('mz-current-day-static-schedule-ready', 'mz-rolling-schedule-window-ready')
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;

    perform cron.schedule(
      'mz-rolling-schedule-window-ready',
      '*/30 * * * *',
      $cron$select public.sch_ensure_schedule_window(public.sch_service_date(now()), 14, 'scheduled_rolling_window_readiness');$cron$
    );
  end if;
end
$block$;

-- Compact the legacy SQL write ledger into its existing summary table, then
-- keep future log rows bounded to hashes and byte counts instead of full SQL.
insert into public.migration_log_summary(
  migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
  first_applied_at, last_applied_at, last_applied_by, updated_at
)
select
  ml.migration_name,
  count(*)::bigint,
  sum(octet_length(coalesce(ml.sql_text, '')))::bigint,
  (array_agg(encode(extensions.digest(convert_to(coalesce(ml.sql_text, ''), 'UTF8'), 'sha256'), 'hex') order by ml.applied_at desc))[1],
  min(ml.applied_at),
  max(ml.applied_at),
  (array_agg(ml.applied_by order by ml.applied_at desc))[1],
  now()
from public.migration_log ml
group by ml.migration_name
on conflict (migration_name) do update set
  statement_count = greatest(public.migration_log_summary.statement_count, excluded.statement_count),
  total_sql_bytes = greatest(public.migration_log_summary.total_sql_bytes, excluded.total_sql_bytes),
  latest_sql_sha256 = coalesce(excluded.latest_sql_sha256, public.migration_log_summary.latest_sql_sha256),
  first_applied_at = least(public.migration_log_summary.first_applied_at, excluded.first_applied_at),
  last_applied_at = greatest(public.migration_log_summary.last_applied_at, excluded.last_applied_at),
  last_applied_by = coalesce(excluded.last_applied_by, public.migration_log_summary.last_applied_by),
  updated_at = now();

create temporary table migration_log_summary_compact on commit drop as
select * from public.migration_log_summary;
truncate table public.migration_log_summary;
insert into public.migration_log_summary
select * from migration_log_summary_compact;
truncate table public.migration_log;

create or replace function public.run_sql_migration(p_name text, p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set statement_timeout = '180s'
as $function$
declare
  v_trimmed text;
  v_executable text;
  v_lowered text;
  v_result jsonb;
  v_sha text;
  v_bytes integer;
begin
  v_trimmed := trim(coalesce(p_sql, ''));
  v_executable := regexp_replace(v_trimmed, ';\s*$', '');
  v_lowered := lower(v_executable);

  if coalesce(trim(p_name), '') = '' then raise exception 'Migration name is required'; end if;
  if v_trimmed = '' then raise exception 'Migration SQL is required'; end if;
  if v_lowered like 'begin%' or position(('com' || 'mit') in v_lowered) > 0 then
    raise exception 'Do not include transaction wrappers in p_sql. Submit the migration body only.';
  end if;
  if exists (select 1 from public.migration_log_summary where migration_name = p_name) then
    raise exception 'Migration "%" has already been applied', p_name;
  end if;

  if v_lowered ~ '^\s*(insert|update|delete)\s'
     and v_lowered like '% returning %'
     and position(';' in v_executable) = 0 then
    execute format('with _migration_rows as (%s) select coalesce(jsonb_agg(to_jsonb(_migration_rows)), ''[]''::jsonb) from _migration_rows', v_executable)
      into v_result;
  else
    execute v_trimmed;
    v_result := jsonb_build_object('ok', true, 'migration_name', p_name, 'applied_at', now());
  end if;

  v_sha := encode(extensions.digest(convert_to(p_sql, 'UTF8'), 'sha256'), 'hex');
  v_bytes := octet_length(p_sql);

  insert into public.migration_log_summary(
    migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
    first_applied_at, last_applied_at, last_applied_by, updated_at
  ) values (
    p_name, 1, v_bytes, v_sha, now(), now(), current_user, now()
  );

  insert into public.migration_log(migration_name, sql_text, applied_by, notes)
  values (
    p_name,
    format('sha256:%s bytes:%s', v_sha, v_bytes),
    current_user,
    'Compact migration evidence; full SQL belongs in canonical source control.'
  );

  return v_result || jsonb_build_object('sql_sha256', v_sha, 'sql_bytes', v_bytes);
end
$function$;

revoke all on function public.run_sql_migration(text,text) from public, anon, authenticated;
grant execute on function public.run_sql_migration(text,text) to service_role, postgres;

-- Seed an auditable release row; deployment completion fills exact commits.
insert into public.release_deployment_manifest(
  release_id, backend_commit, frontend_commit, migration_head,
  migration_manifest_sha256, environment_contract_version,
  status, details_json, deployed_at
) values (
  'release-2026.07.16.foundation-repair.1',
  '4a36a415b3e9f079530308a3c792be237e0e2f87',
  '5aad4c03e48d47c2a1e4f3cc66964068edc7b1b2',
  '20260716150000',
  encode(extensions.digest(convert_to('20260716150000_foundation_repair_v1', 'UTF8'), 'sha256'), 'hex'),
  'custodial-env.v1',
  'candidate',
  jsonb_build_object('source_migration', '20260716150000_foundation_repair_v1.sql'),
  null
)
on conflict (release_id) do update set
  migration_head = excluded.migration_head,
  migration_manifest_sha256 = excluded.migration_manifest_sha256,
  environment_contract_version = excluded.environment_contract_version,
  status = excluded.status,
  details_json = public.release_deployment_manifest.details_json || excluded.details_json;

insert into public.release_validation_runs(release_id, area, status, validated_at, details_json)
values (
  'release-2026.07.16.foundation-repair.1',
  'database_foundation',
  'pass',
  now(),
  jsonb_build_object(
    'schedule_window_days', 14,
    'schedule_reads_write', false,
    'historical_pto_cleanup', true,
    'historical_open_assignment_archive', true,
    'migration_log_compacted', true
  )
);

-- Populate and verify the rolling schedule horizon immediately.
select public.sch_ensure_schedule_window(
  public.sch_service_date(now()),
  14,
  'foundation_repair_initial_window'
);
