begin;

-- Retention policy: operational cleaning and issue history is long-lived; only
-- expired events and user-deleted Messenger content are short-lived.
insert into public.system_settings(setting_key,setting_value,description,updated_at)
values
  ('retention_event_days','14'::jsonb,'Keep an event for 14 full local calendar days after its end date, then physically delete the event, its reminder log, and its event audit history.',now()),
  ('retention_event_notification_days','14'::jsonb,'Event notification rows follow the parent event and are removed when the event reaches its 14-day retention boundary.',now()),
  ('retention_message_days','14'::jsonb,'Only messages or conversations explicitly deleted by a user are physically purged after 14 days. Active Messenger content is not age-purged.',now()),
  ('retention_scan_history_days','3650'::jsonb,'Cleaning sessions, completion responses, scan evidence, and related operational history are retained for long-term comparison and trend analysis.',now()),
  ('retention_maintenance_closed_days','3650'::jsonb,'Closed maintenance tickets are retained for long-term recurring-fixture and location trend analysis.',now()),
  ('retention_guest_resolved_days','3650'::jsonb,'Resolved guest cleanliness reports are retained for long-term location and issue trend analysis.',now()),
  ('retention_operational_history_mode',to_jsonb('preserve'::text),'Cleaning, inspection, maintenance-ticket, and guest-issue facts are durable operational history and must not be removed by routine retention.',now())
on conflict(setting_key) do update
set setting_value=excluded.setting_value,
    description=excluded.description,
    updated_at=now();

-- Event history is useful during the 14-day review window but has no separate
-- long-term retention requirement. It therefore follows the parent event.
alter table public.events_app_event_history
  drop constraint if exists events_app_event_history_event_id_fkey;

alter table public.events_app_event_history
  add constraint events_app_event_history_event_id_fkey
  foreign key(event_id) references public.events_app_events(id) on delete cascade
  not valid;

alter table public.events_app_event_history
  validate constraint events_app_event_history_event_id_fkey;

create or replace function public.events_app_delete_retention_guard()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_days integer := public.mz_retention_setting_int('retention_event_days',14,1,3650);
  v_local_today date := (clock_timestamp() at time zone 'America/Chicago')::date;
begin
  -- Existing legacy clients issue broad DELETE requests for every past event.
  -- Silently keep rows that have not completed their full retention period.
  if coalesce(old.end_date,old.event_date) > v_local_today-v_days then
    return null;
  end if;
  return old;
end
$function$;

comment on function public.events_app_delete_retention_guard() is
  'Prevents physical event deletion until 14 full America/Chicago calendar days after the event end date.';

drop trigger if exists trg_events_app_delete_retention_guard on public.events_app_events;
create trigger trg_events_app_delete_retention_guard
before delete on public.events_app_events
for each row execute function public.events_app_delete_retention_guard();

create or replace function public.events_app_purge_expired(
  p_now timestamptz default now(),
  p_batch_limit integer default 500
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_days integer := public.mz_retention_setting_int('retention_event_days',14,1,3650);
  v_local_today date := (p_now at time zone 'America/Chicago')::date;
  v_deleted integer := 0;
begin
  if p_batch_limit is null or p_batch_limit<1 or p_batch_limit>5000 then
    raise exception using errcode='22023',message='Event purge batch limit must be between 1 and 5000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('memphis-zoo-event-retention-v1',0));

  with candidates as (
    select e.id
    from public.events_app_events e
    where coalesce(e.end_date,e.event_date)<=v_local_today-v_days
    order by coalesce(e.end_date,e.event_date),e.id
    limit p_batch_limit
    for update skip locked
  ), deleted as (
    delete from public.events_app_events e
    using candidates c
    where e.id=c.id
    returning e.id
  )
  select count(*)::integer into v_deleted from deleted;

  return jsonb_build_object(
    'ok',true,
    'retention_days',v_days,
    'local_today',v_local_today,
    'purged_at',p_now,
    'deleted_events',v_deleted
  );
end
$function$;

comment on function public.events_app_purge_expired(timestamptz,integer) is
  'Batch-purges events after the 14-day review window. Event notification and event history rows follow by cascade.';

revoke all on function public.events_app_purge_expired(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.events_app_purge_expired(timestamptz,integer) to postgres,service_role;

-- Manager inspections provide the quality half of time-versus-result analysis.
create table if not exists public.cleaning_inspections (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  request_fingerprint text not null,
  session_id uuid not null references public.sessions(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  inspector_manager_id uuid references public.ops_manager_managers(manager_id) on delete set null,
  inspector_name_snapshot text not null,
  employee_name_snapshot text not null,
  location_code_snapshot text not null,
  location_name_snapshot text not null,
  session_started_at timestamptz not null,
  session_ended_at timestamptz,
  session_duration_minutes integer,
  inspection_type text not null default 'manager_spot_check',
  rubric_version text not null default 'custodial-v1',
  overall_score integer not null,
  appearance_score integer,
  sanitation_score integer,
  supplies_score integer,
  detail_score integer,
  safety_score integer,
  pass_threshold integer not null default 85,
  critical_failure boolean not null default false,
  passed boolean generated always as ((not critical_failure) and overall_score>=pass_threshold) stored,
  follow_up_required boolean not null default false,
  findings_json jsonb not null default '[]'::jsonb,
  notes text,
  inspected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cleaning_inspections_fingerprint_len check(length(request_fingerprint)=64),
  constraint cleaning_inspections_type_check check(inspection_type in ('manager_spot_check','formal','follow_up','complaint_response','training_coaching')),
  constraint cleaning_inspections_overall_score check(overall_score between 0 and 100),
  constraint cleaning_inspections_appearance_score check(appearance_score is null or appearance_score between 0 and 100),
  constraint cleaning_inspections_sanitation_score check(sanitation_score is null or sanitation_score between 0 and 100),
  constraint cleaning_inspections_supplies_score check(supplies_score is null or supplies_score between 0 and 100),
  constraint cleaning_inspections_detail_score check(detail_score is null or detail_score between 0 and 100),
  constraint cleaning_inspections_safety_score check(safety_score is null or safety_score between 0 and 100),
  constraint cleaning_inspections_pass_threshold check(pass_threshold between 0 and 100),
  constraint cleaning_inspections_duration check(session_duration_minutes is null or session_duration_minutes>=0),
  constraint cleaning_inspections_findings_shape check(jsonb_typeof(findings_json) in ('array','object'))
);

create or replace function public.cleaning_inspections_set_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_session record;
  v_inspector_name text;
begin
  if tg_op='UPDATE' then
    if new.operation_id is distinct from old.operation_id then
      raise exception using errcode='23514',message='Inspection operation_id is immutable';
    end if;
    if new.session_id is distinct from old.session_id then
      raise exception using errcode='23514',message='Inspection session_id is immutable';
    end if;
  end if;

  select
    s.location_id,s.employee_id,s.started_at,s.ended_at,s.duration_minutes,s.status,
    l.location_code,l.location_name,e.display_name employee_name
  into v_session
  from public.sessions s
  join public.locations l on l.id=s.location_id
  join public.employees e on e.id=s.employee_id
  where s.id=new.session_id;

  if not found then
    raise exception using errcode='P0002',message='Cleaning session was not found';
  end if;
  if v_session.status not in ('pending_submit','closed') then
    raise exception using errcode='23514',message='Only a finished cleaning session can be inspected';
  end if;

  new.location_id:=v_session.location_id;
  new.employee_id:=v_session.employee_id;
  new.employee_name_snapshot:=v_session.employee_name;
  new.location_code_snapshot:=v_session.location_code;
  new.location_name_snapshot:=v_session.location_name;
  new.session_started_at:=v_session.started_at;
  new.session_ended_at:=v_session.ended_at;
  new.session_duration_minutes:=coalesce(
    v_session.duration_minutes,
    case when v_session.ended_at is not null
      then greatest(0,ceil(extract(epoch from (v_session.ended_at-v_session.started_at))/60.0)::integer)
      else null end
  );

  if new.inspector_manager_id is not null then
    select m.display_name into v_inspector_name
    from public.ops_manager_managers m
    where m.manager_id=new.inspector_manager_id
      and m.active=true and m.revoked_at is null and m.is_system_principal=false;
    if not found then
      raise exception using errcode='23503',message='Active inspector manager was not found';
    end if;
    new.inspector_name_snapshot:=v_inspector_name;
  else
    new.inspector_name_snapshot:=coalesce(nullif(btrim(new.inspector_name_snapshot),''),'Custodial Manager');
  end if;

  new.updated_at:=clock_timestamp();
  return new;
end
$function$;

drop trigger if exists trg_cleaning_inspections_set_snapshot on public.cleaning_inspections;
create trigger trg_cleaning_inspections_set_snapshot
before insert or update on public.cleaning_inspections
for each row execute function public.cleaning_inspections_set_snapshot();

create index if not exists idx_cleaning_inspections_session on public.cleaning_inspections(session_id,inspected_at desc);
create index if not exists idx_cleaning_inspections_employee on public.cleaning_inspections(employee_id,inspected_at desc);
create index if not exists idx_cleaning_inspections_location on public.cleaning_inspections(location_id,inspected_at desc);
create index if not exists idx_cleaning_inspections_score on public.cleaning_inspections(overall_score,inspected_at desc);
create index if not exists idx_maintenance_ticket_trend_lookup on public.maintenance_tickets(location_id,issue_category,fixture_type,fixture_identifier,reported_at desc);

alter table public.cleaning_inspections enable row level security;
alter table public.cleaning_inspections force row level security;
revoke all on table public.cleaning_inspections from public,anon,authenticated;
grant select,insert,update,delete on table public.cleaning_inspections to postgres,service_role;

drop policy if exists cleaning_inspections_service_all on public.cleaning_inspections;
create policy cleaning_inspections_service_all
on public.cleaning_inspections
for all
to service_role
using(true)
with check(true);

create or replace view public.v_cleaning_session_facts
with (security_invoker=true)
as
select
  s.id as session_id,
  s.session_uuid,
  s.client_session_id,
  s.status,
  s.location_id,
  l.location_code,
  l.location_name,
  l.location_type,
  s.employee_id,
  e.employee_code,
  e.display_name as employee_name,
  s.device_id,
  d.device_id as device_identifier,
  s.started_at,
  s.ended_at,
  s.duration_minutes,
  s.duration_display,
  s.completion_source,
  response.completion_response_id,
  response.completion_submitted_at,
  coalesce(response.services_performed,array[]::text[]) as services_performed,
  response.cleaning_note,
  coalesce(ticket.ticket_count,0) as maintenance_ticket_count,
  coalesce(ticket.open_ticket_count,0) as open_maintenance_ticket_count,
  coalesce(ticket.issue_categories,array[]::text[]) as maintenance_issue_categories,
  coalesce(ticket.fixture_identifiers,array[]::text[]) as maintenance_fixture_identifiers,
  coalesce(inspection.inspection_count,0) as inspection_count,
  inspection.inspection_score_total,
  inspection.average_inspection_score,
  coalesce(inspection.inspection_pass_count,0) as inspection_pass_count,
  inspection.latest_inspection_score,
  inspection.latest_inspection_passed,
  inspection.latest_inspected_at,
  inspection.latest_inspection_notes
from public.sessions s
join public.locations l on l.id=s.location_id
join public.employees e on e.id=s.employee_id
join public.devices d on d.id=s.device_id
left join lateral (
  select
    cr.id as completion_response_id,
    cr.submitted_at as completion_submitted_at,
    coalesce((
      select array_agg(svc.value order by svc.ordinality)
      from jsonb_array_elements_text(
        case when jsonb_typeof(cr.response_json->'services_performed')='array'
          then cr.response_json->'services_performed' else '[]'::jsonb end
      ) with ordinality as svc(value,ordinality)
    ),array[]::text[]) as services_performed,
    nullif(btrim(coalesce(cr.response_json->>'note',cr.response_json->>'notes','')),'') as cleaning_note
  from public.completion_responses cr
  where cr.session_id=s.id
  order by cr.submitted_at desc,cr.id desc
  limit 1
) response on true
left join lateral (
  select
    count(*)::integer as ticket_count,
    count(*) filter(where lower(coalesce(mt.status,'open'))='open')::integer as open_ticket_count,
    coalesce(array_agg(distinct nullif(btrim(mt.issue_category),'')) filter(where nullif(btrim(mt.issue_category),'') is not null),array[]::text[]) as issue_categories,
    coalesce(array_agg(distinct nullif(btrim(mt.fixture_identifier),'')) filter(where nullif(btrim(mt.fixture_identifier),'') is not null),array[]::text[]) as fixture_identifiers
  from public.maintenance_tickets mt
  where mt.session_id=s.id
) ticket on true
left join lateral (
  select
    count(*)::integer as inspection_count,
    sum(ci.overall_score)::numeric as inspection_score_total,
    round(avg(ci.overall_score)::numeric,1) as average_inspection_score,
    count(*) filter(where ci.passed)::integer as inspection_pass_count,
    (array_agg(ci.overall_score order by ci.inspected_at desc,ci.id desc))[1] as latest_inspection_score,
    (array_agg(ci.passed order by ci.inspected_at desc,ci.id desc))[1] as latest_inspection_passed,
    max(ci.inspected_at) as latest_inspected_at,
    (array_agg(ci.notes order by ci.inspected_at desc,ci.id desc))[1] as latest_inspection_notes
  from public.cleaning_inspections ci
  where ci.session_id=s.id
) inspection on true;

create or replace view public.v_cleaning_performance_comparison
with (security_invoker=true)
as
with facts as (
  select *
  from public.v_cleaning_session_facts
  where status='closed' and duration_minutes is not null and duration_minutes>=0
), employee_location as (
  select
    employee_id,employee_code,employee_name,
    location_id,location_code,location_name,
    count(*)::integer as cleaning_count,
    round(avg(duration_minutes)::numeric,1) as average_duration_minutes,
    round(percentile_cont(0.5) within group(order by duration_minutes)::numeric,1) as median_duration_minutes,
    round(percentile_cont(0.9) within group(order by duration_minutes)::numeric,1) as p90_duration_minutes,
    min(duration_minutes)::integer as minimum_duration_minutes,
    max(duration_minutes)::integer as maximum_duration_minutes,
    count(*) filter(where started_at>=now()-interval '30 days')::integer as cleanings_last_30_days,
    round(avg(duration_minutes) filter(where started_at>=now()-interval '30 days')::numeric,1) as average_duration_last_30_days,
    sum(maintenance_ticket_count)::integer as maintenance_ticket_count,
    round((sum(maintenance_ticket_count)::numeric/nullif(count(*),0)),2) as maintenance_tickets_per_cleaning,
    sum(inspection_count)::integer as inspection_count,
    round((sum(inspection_score_total)/nullif(sum(inspection_count),0))::numeric,1) as average_inspection_score,
    round((100.0*sum(inspection_pass_count)/nullif(sum(inspection_count),0))::numeric,1) as inspection_pass_rate_pct,
    max(started_at) as latest_cleaning_at
  from facts
  group by employee_id,employee_code,employee_name,location_id,location_code,location_name
), location_baseline as (
  select
    location_id,
    round(avg(duration_minutes)::numeric,1) as location_average_duration_minutes,
    round((sum(inspection_score_total)/nullif(sum(inspection_count),0))::numeric,1) as location_average_inspection_score
  from facts
  group by location_id
)
select
  el.*,
  lb.location_average_duration_minutes,
  round((el.average_duration_minutes-lb.location_average_duration_minutes)::numeric,1) as duration_delta_from_location_minutes,
  lb.location_average_inspection_score,
  round((el.average_inspection_score-lb.location_average_inspection_score)::numeric,1) as inspection_score_delta_from_location
from employee_location el
join location_baseline lb on lb.location_id=el.location_id;

create or replace view public.v_maintenance_ticket_trends
with (security_invoker=true)
as
with normalized as (
  select
    mt.*,
    lower(coalesce(nullif(btrim(mt.issue_category),''),'uncategorized')) as issue_category_key,
    lower(coalesce(nullif(btrim(mt.fixture_type),''),'unspecified')) as fixture_type_key,
    lower(coalesce(nullif(btrim(mt.fixture_identifier),''),'unspecified')) as fixture_identifier_key
  from public.maintenance_tickets mt
), grouped as (
  select
    location_id,
    max(location_code_snapshot) as location_code,
    max(location_name_snapshot) as location_name,
    issue_category_key,
    max(nullif(btrim(issue_category),'')) as issue_category,
    fixture_type_key,
    max(nullif(btrim(fixture_type),'')) as fixture_type,
    fixture_identifier_key,
    max(nullif(btrim(fixture_identifier),'')) as fixture_identifier,
    count(*)::integer as total_ticket_count,
    count(*) filter(where reported_at>=now()-interval '7 days')::integer as ticket_count_last_7_days,
    count(*) filter(where reported_at>=now()-interval '30 days')::integer as ticket_count_last_30_days,
    count(*) filter(where reported_at>=now()-interval '90 days')::integer as ticket_count_last_90_days,
    count(*) filter(where lower(coalesce(status,'open'))='open')::integer as open_ticket_count,
    min(reported_at) as first_reported_at,
    max(reported_at) as latest_reported_at,
    round(avg(extract(epoch from (closed_at-reported_at))/3600.0) filter(where closed_at is not null)::numeric,1) as average_resolution_hours
  from normalized
  group by location_id,issue_category_key,fixture_type_key,fixture_identifier_key
)
select
  g.*,
  md5(coalesce(location_id::text,'')||'|'||issue_category_key||'|'||fixture_type_key||'|'||fixture_identifier_key) as issue_signature,
  case
    when ticket_count_last_7_days>=3 then 'hotspot'
    when ticket_count_last_30_days>=3 then 'recurring'
    when total_ticket_count>=2 then 'repeat'
    else 'isolated'
  end as recurrence_status
from grouped g;

revoke all on public.v_cleaning_session_facts from public,anon,authenticated;
revoke all on public.v_cleaning_performance_comparison from public,anon,authenticated;
revoke all on public.v_maintenance_ticket_trends from public,anon,authenticated;
grant select on public.v_cleaning_session_facts to postgres,service_role;
grant select on public.v_cleaning_performance_comparison to postgres,service_role;
grant select on public.v_maintenance_ticket_trends to postgres,service_role;

comment on table public.cleaning_inspections is
  'Durable manager quality inspections linked to canonical cleaning sessions for employee/location performance comparison.';
comment on view public.v_cleaning_session_facts is
  'One durable fact row per cleaning session, including services, maintenance issues, and inspection outcomes.';
comment on view public.v_cleaning_performance_comparison is
  'Employee-by-location cleaning duration, issue, and inspection comparison with location baselines.';
comment on view public.v_maintenance_ticket_trends is
  'Recurring maintenance issue and fixture trends across 7, 30, 90 day, and lifetime windows.';

-- The event purge is independent of the disabled legacy free-tier retention job.
do $cron$
begin
  if to_regnamespace('cron') is not null
     and to_regprocedure('cron.schedule(text,text,text)') is not null
     and to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is not null then
    perform cron.alter_job(
      cron.schedule('mz-events-expired-retention-hourly','37 * * * *','select public.events_app_purge_expired(now(),500);'),
      null,null,null,null,true
    );
  end if;
end
$cron$;

commit;
