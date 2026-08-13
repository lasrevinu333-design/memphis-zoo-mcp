begin;

-- One Central service date owns schedules, turnover, occurrences, and daily
-- operational truth. It changes at the configured 04:00 boundary, including
-- across both daylight-saving transitions.
create or replace function public.sch_service_date(p_at timestamptz default now())
returns date language sql stable
as $function$
  select (
    date_trunc(
      'day',
      timezone('America/Chicago', p_at)
        - make_interval(hours => public.get_setting_int('operational_day_start_hour', 4))
    )
  )::date;
$function$;

comment on function public.sch_service_date(timestamptz) is
  'Canonical Memphis Zoo operational service date; rolls at the configured Central operational-day start hour (04:00 by default).';

revoke all on function public.sch_service_date(timestamptz) from public,anon,authenticated;
grant execute on function public.sch_service_date(timestamptz) to postgres,service_role,static_weekly_control_plane,static_weekly_release_operator;

-- These two procedures were installed before the canonical service date was
-- corrected and embedded a Central-midnight expression in their declarations.
-- Rewrite only that exact reviewed initializer for already-migrated databases;
-- clean rebuilds already contain the canonical call and take the no-op branch.
do $turnover_service_date$
declare
  v_identity text;
  v_definition text;
  v_rewritten text;
begin
  foreach v_identity in array array[
    'public.static_weekly_v4_mark_employee_departed(uuid,text,bigint,uuid,text)',
    'public.static_weekly_v4_replace_employee(uuid,text,text,bigint,uuid,text)'
  ] loop
    if to_regprocedure(v_identity) is null then
      raise exception 'Missing required turnover authority function %',v_identity;
    end if;
    v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
    if position('v_effective_start date:=public.sch_service_date(statement_timestamp())' in v_definition)>0
       or position('v_effective_start date := public.sch_service_date(statement_timestamp())' in v_definition)>0 then
      continue;
    end if;
    v_rewritten:=replace(
      v_definition,
      'v_effective_start date:=(statement_timestamp() at time zone ''America/Chicago'')::date;',
      'v_effective_start date:=public.sch_service_date(statement_timestamp());'
    );
    if v_rewritten=v_definition then
      raise exception 'Turnover authority function % has an unreviewed service-date initializer',v_identity;
    end if;
    execute v_rewritten;
  end loop;
end
$turnover_service_date$;

alter table public.custodial_offline_actor_contexts
  validate constraint custodial_offline_actor_contexts_snapshot_identity_check;

create table if not exists public.custodial_release_canary_recovery_probes (
  probe_id uuid primary key default gen_random_uuid(),
  device_identifier text not null check (device_identifier ~ '^KIOSK_(0[2-9]|10)$'),
  checked_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  passed boolean not null,
  authority_health jsonb not null,
  authority_health_sha256 text not null check (authority_health_sha256 ~ '^[0-9a-f]{64}$'),
  check (expires_at > checked_at and expires_at <= checked_at + interval '5 minutes')
);

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_expected integer;
  v_missing text[];
  v_mismatched text[];
  v_checks jsonb;
  v_ok boolean;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select count(*) into v_expected from public.custodial_release_authority_restore_definitions;
  select array_agg(d.function_identity order by d.restore_order) into v_missing
  from public.custodial_release_authority_restore_definitions d
  where to_regprocedure(d.function_identity) is null;
  select array_agg(d.function_identity order by d.restore_order) into v_mismatched
  from public.custodial_release_authority_restore_definitions d
  where to_regprocedure(d.function_identity) is not null
    and encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(d.function_identity)),'UTF8'),'sha256'),'hex')<>d.definition_sha256;

  v_checks:=jsonb_build_object(
    'restore_set_complete',v_expected=7,
    'canonical_functions_present',coalesce(cardinality(v_missing),0)=0,
    'canonical_functions_exact',coalesce(cardinality(v_mismatched),0)=0,
    'authority_ledgers_present',to_regclass('public.custodial_offline_actor_contexts') is not null
      and to_regclass('public.custodial_offline_submission_proofs') is not null
      and to_regclass('public.custodial_offline_scan_authority_snapshots') is not null
      and to_regclass('public.custodial_offline_reconciliation_records') is not null
      and to_regclass('public.custodial_offline_scan_event_evidence') is not null
      and to_regclass('public.custodial_offline_time_reservations') is not null
      and to_regclass('public.custodial_offline_reconciliation_outbox') is not null,
    'snapshot_constraint_validated',exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass
      and conname='custodial_offline_actor_contexts_snapshot_identity_check' and convalidated),
    'completion_replay_unique',exists(select 1 from pg_constraint where conrelid='public.custodial_offline_reconciliation_records'::regclass
      and conname='uq_custodial_offline_reconciliation_completion' and contype='u' and convalidated),
    'time_overlap_exclusions_validated',(select count(*)=2 from pg_constraint where conrelid='public.custodial_offline_time_reservations'::regclass
      and conname in ('custodial_offline_employee_time_no_overlap','custodial_offline_device_time_no_overlap') and contype='x' and convalidated),
    'evidence_direct_dml_denied',not (
      has_table_privilege('service_role','public.custodial_offline_actor_contexts','insert')
      or has_table_privilege('service_role','public.custodial_offline_actor_contexts','update')
      or has_table_privilege('service_role','public.custodial_offline_actor_contexts','delete')
      or has_table_privilege('service_role','public.custodial_offline_actor_contexts','truncate')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','insert')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','update')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','delete')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','truncate')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','insert')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','update')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','delete')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','truncate')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','insert')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','update')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','delete')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','truncate')
    ),
    'alternate_terminal_writers_absent',not exists(select 1 from public.custodial_terminal_writer_inventory
      where application_callable and (mutates_terminal_truth or delegates_alternate_terminal_authority)
        and proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative')),
    'named_manager_messaging_ready',to_regclass('public.ops_manager_managers') is not null
      and to_regprocedure('public.msg_ensure_ops_manager_user(uuid)') is not null,
    'operational_service_date_boundary',public.sch_service_date('2026-08-13 03:59:59-05'::timestamptz)=date '2026-08-12'
      and public.sch_service_date('2026-08-13 04:00:00-05'::timestamptz)=date '2026-08-13'
  );
  select bool_and(value::boolean) into v_ok from jsonb_each_text(v_checks);
  return jsonb_build_object(
    'ok',coalesce(v_ok,false),'authority','offline-authority.v4','phase','operational-canary-live-health',
    'configured',true,'checks',v_checks,
    'canonical_functions_expected',7,
    'canonical_functions_verified',v_expected-coalesce(cardinality(v_missing),0)-coalesce(cardinality(v_mismatched),0),
    'missing_functions',to_jsonb(coalesce(v_missing,array[]::text[])),
    'mismatched_functions',to_jsonb(coalesce(v_mismatched,array[]::text[]))
  );
end
$function$;

update public.custodial_release_authority_restore_definitions
set function_definition=pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure),
    definition_sha256=encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure),'UTF8'),'sha256'),'hex'),
    captured_at=statement_timestamp()
where function_identity='public.custodial_backend_authority_health(text)';

create or replace function public.custodial_run_release_canary_recovery_probe(
  p_device_identifier text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_device text:=upper(btrim(coalesce(p_device_identifier,'')));
  v_health jsonb;
  v_probe public.custodial_release_canary_recovery_probes%rowtype;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_device !~ '^KIOSK_(0[2-9]|10)$' then
    raise exception using errcode='22023',message='an exact employee-phone canary identifier is required';
  end if;
  if not exists(select 1 from public.custodial_release_canary_controls where device_identifier=v_device and paused=true) then
    raise exception using errcode='55000',message='the exact release canary must exist and remain paused during its recovery probe';
  end if;
  v_health:=public.custodial_backend_authority_health(p_backend_execution_secret);
  insert into public.custodial_release_canary_recovery_probes(
    device_identifier,expires_at,passed,authority_health,authority_health_sha256
  ) values(
    v_device,statement_timestamp()+interval '5 minutes',coalesce((v_health->>'ok')::boolean,false),v_health,
    encode(extensions.digest(convert_to(v_health::text,'UTF8'),'sha256'),'hex')
  ) returning * into v_probe;
  return jsonb_build_object(
    'probe_id',v_probe.probe_id,'device_identifier',v_device,'checked_at',v_probe.checked_at,
    'expires_at',v_probe.expires_at,'passed',v_probe.passed,'authority_health_sha256',v_probe.authority_health_sha256,
    'authority_health',v_health
  );
end
$function$;

create or replace function public.custodial_release_canary_is_paused(
  p_device_identifier text,p_backend_execution_secret text
) returns boolean language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_device text:=upper(btrim(coalesce(p_device_identifier,''))); v_paused boolean;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_device !~ '^KIOSK_(0[2-9]|10)$' then
    raise exception using errcode='22023',message='an exact employee-phone canary identifier is required';
  end if;
  select paused into v_paused from public.custodial_release_canary_controls where device_identifier=v_device;
  if not found then raise exception using errcode='55000',message='the exact release canary control has not been initialized'; end if;
  return v_paused;
end
$function$;

do $resume_probe_binding$
declare v_definition text; v_rewritten text;
begin
  v_definition:=pg_get_functiondef('public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure);
  v_rewritten:=replace(v_definition,
$old$    select array_agg(d.function_identity order by d.restore_order) into v_missing
    from public.custodial_release_authority_restore_definitions d where to_regprocedure(d.function_identity) is null;
    select array_agg(d.function_identity order by d.restore_order) into v_mismatched
    from public.custodial_release_authority_restore_definitions d where to_regprocedure(d.function_identity) is not null
      and encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(d.function_identity)),'UTF8'),'sha256'),'hex')<>d.definition_sha256;
    v_current_health:=jsonb_build_object('ok',coalesce(cardinality(v_missing),0)=0 and coalesce(cardinality(v_mismatched),0)=0,
      'canonical_functions_expected',7,'canonical_functions_verified',7-coalesce(cardinality(v_missing),0)-coalesce(cardinality(v_mismatched),0),
      'missing_functions',to_jsonb(coalesce(v_missing,array[]::text[])),'mismatched_functions',to_jsonb(coalesce(v_mismatched,array[]::text[])));
    if p_authoritative_health->>'ok'<>'true' or v_current_health->>'ok'<>'true' then
      raise exception using errcode='55000',message='the release canary cannot resume until authoritative health is green';
    end if;$old$,
$new$    v_current_health:=public.custodial_run_release_canary_recovery_probe(v_device,p_backend_execution_secret);
    if v_current_health->>'passed'<>'true' then
      raise exception using errcode='55000',message='the release canary cannot resume until a fresh persisted recovery probe is green';
    end if;$new$);
  if v_rewritten=v_definition then
    raise exception 'Release canary resume implementation did not match the reviewed predecessor';
  end if;
  execute v_rewritten;
end
$resume_probe_binding$;

drop trigger if exists trg_custodial_release_canary_recovery_probes_immutable
  on public.custodial_release_canary_recovery_probes;
create trigger trg_custodial_release_canary_recovery_probes_immutable
before update or delete on public.custodial_release_canary_recovery_probes
for each row execute function public.static_weekly_reject_update_delete();

alter table public.custodial_release_canary_recovery_probes enable row level security;
alter table public.custodial_release_canary_recovery_probes force row level security;
revoke all on table public.custodial_release_canary_recovery_probes from public,anon,authenticated,service_role;
revoke all on function public.custodial_run_release_canary_recovery_probe(text,text) from public,anon,authenticated;
grant execute on function public.custodial_run_release_canary_recovery_probe(text,text) to postgres,service_role;

commit;
