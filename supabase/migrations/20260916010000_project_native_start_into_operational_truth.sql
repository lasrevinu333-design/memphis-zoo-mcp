begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A native Start is durable before the completion writer materializes its
-- terminal public.sessions row. Project that already-attested occurrence as
-- open work everywhere that operators and recovery gates consume live state.
-- Do not insert an active sessions row here: delayed offline occurrences are
-- allowed to arrive together and are overlap-checked only at completion.
create or replace function public.custodial_open_work()
returns table(
  open_work_id uuid,
  source_kind text,
  session_id uuid,
  context_id uuid,
  session_uuid text,
  client_session_id text,
  location_id uuid,
  location_code text,
  location_name text,
  employee_id uuid,
  employee_name text,
  device_id uuid,
  device_identifier text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer,
  duration_display text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select
    session.id,
    'session'::text,
    session.id,
    null::uuid,
    session.session_uuid,
    session.client_session_id,
    session.location_id,
    location.location_code,
    location.location_name,
    session.employee_id,
    employee.display_name,
    session.device_id,
    device.device_id,
    session.status,
    session.started_at,
    session.ended_at,
    session.duration_minutes,
    session.duration_display,
    session.created_at
  from public.sessions session
  join public.locations location on location.id=session.location_id
  join public.employees employee on employee.id=session.employee_id
  join public.devices device on device.id=session.device_id
  where session.status in ('active','pending_submit')

  union all

  select
    context.context_id,
    'native_offline_context'::text,
    null::uuid,
    context.context_id,
    context.client_session_id,
    context.client_session_id,
    context.location_id,
    context.canonical_location_code,
    location.location_name,
    context.employee_id,
    coalesce(assignment.new_employee_name,employee.display_name),
    context.device_id,
    coalesce(assignment.device_identifier,device.device_id),
    'active'::text,
    context.started_at,
    null::timestamptz,
    null::integer,
    null::text,
    context.created_at
  from public.custodial_offline_actor_contexts context
  join public.custodial_offline_submission_proofs proof
    on proof.context_id=context.context_id and proof.state='issued'
  join public.locations location on location.id=context.location_id
  join public.employees employee on employee.id=context.employee_id
  join public.devices device on device.id=context.device_id
  left join public.custodial_employee_device_assignment_history assignment
    on assignment.assignment_change_id=context.assignment_change_id
      and assignment.device_id=context.device_id
      and assignment.new_employee_id=context.employee_id
  where context.status='activated'
    and context.native_scan_entry_id is not null
    and context.native_start_attestation_version='custodial-native-start.v1'
    and context.native_start_attestation_sha256 ~ '^[0-9a-f]{64}$'
    and not exists(
      select 1 from public.sessions existing
      where existing.client_session_id=context.client_session_id
    );
$function$;

revoke all on function public.custodial_open_work() from public,anon,authenticated;
grant execute on function public.custodial_open_work() to postgres,service_role,custodial_application_reader;

-- Keep the projected-open lookup bounded as the immutable occurrence ledger
-- grows. The proof table already has a unique index on context_id.
create index if not exists idx_custodial_offline_actor_contexts_native_open
  on public.custodial_offline_actor_contexts(location_id,employee_id,device_id,started_at desc)
  where status='activated' and native_scan_entry_id is not null;

-- Evidence remains immutable to every ordinary caller. The expiry writer is a
-- SECURITY DEFINER function and opens one transaction-local transition only
-- when executing as that function's owner; a caller-set custom GUC alone is
-- therefore insufficient to bypass the append-only trigger.
create or replace function public.custodial_reject_offline_evidence_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_expiry_owner name;
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='Custodial offline authority evidence is append-only';
  end if;
  select pg_get_userbyid(proowner) into v_expiry_owner
  from pg_proc
  where oid=to_regprocedure('public.expire_stale_open_sessions(timestamp with time zone)');
  if current_setting('custodial.offline_expiry_transition',true)='expire_stale_open_sessions'
     and current_user=v_expiry_owner then
    return new;
  end if;
  if not public.custodial_backend_transition_allowed() then
    raise exception using errcode='23514',message='Custodial offline authority evidence is immutable outside the canonical writer';
  end if;
  return new;
end
$function$;

-- Native Start deliberately has no sessions row until terminalization. When
-- its signed context expires, create one same-UUID cancelled row before
-- cancelling the evidence. The phone then observes the same external identity
-- in terminal state and can safely discard its local workflow, while manager,
-- turnover and rollback readers all stop seeing projected open work.
create or replace function public.expire_stale_open_sessions(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_timeout_minutes integer := public.get_setting_int('stale_session_timeout_minutes',120);
  v_expired_count integer := 0;
  v_session_id uuid;
  v_session record;
  r record;
begin
  for r in
    select session.id,session.status,session.location_id,session.device_id,
      session.started_at,session.ended_at
    from public.sessions session
    where (session.status='active'
        and session.started_at<=p_now-make_interval(mins=>v_timeout_minutes))
       or (session.status='pending_submit'
        and coalesce(session.ended_at,session.started_at)<=p_now-make_interval(mins=>v_timeout_minutes))
    order by session.started_at
    for update skip locked
  loop
    update public.sessions
       set status='cancelled',ended_at=coalesce(ended_at,p_now),
           duration_minutes=coalesce(duration_minutes,
             greatest(0,round(extract(epoch from(coalesce(ended_at,p_now)-started_at))/60.0))),
           duration_display=coalesce(duration_display,
             greatest(0,round(extract(epoch from(coalesce(ended_at,p_now)-started_at))/60.0))::text||' min'),
           completion_source=coalesce(completion_source,'system_timeout_cancelled'),
           updated_at=p_now
     where id=r.id and status=r.status;
    if found then
      insert into public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
      values(r.id,'session_auto_cancelled','system','expire_stale_open_sessions',
        jsonb_build_object('reason','stale_timeout','previous_status',r.status,
          'timeout_minutes',v_timeout_minutes,'cancelled_at',p_now));
      insert into public.system_logs(level,source,message,session_id,location_id,device_id)
      values('WARN','expire_stale_open_sessions',
        'Stale session cancelled without fabricating completion',r.id,r.location_id,r.device_id);
      v_expired_count:=v_expired_count+1;
    end if;
  end loop;

  for r in
    select context.*,proof.submission_id
    from public.custodial_offline_actor_contexts context
    join public.custodial_offline_submission_proofs proof
      on proof.context_id=context.context_id and proof.state='issued'
    where context.status='activated' and context.expires_at<=p_now
    order by context.expires_at,context.context_id
    for update of context,proof skip locked
  loop
    perform set_config('custodial.offline_expiry_transition','expire_stale_open_sessions',true);
    v_session_id:=null;

    insert into public.sessions(
      session_uuid,client_session_id,location_id,employee_id,device_id,status,
      started_at,ended_at,duration_minutes,duration_display,completion_source,
      created_at,updated_at
    ) values (
      r.client_session_id,r.client_session_id,r.location_id,r.employee_id,r.device_id,'cancelled',
      r.started_at,p_now,
      greatest(0,round(extract(epoch from(p_now-r.started_at))/60.0)::integer),
      greatest(0,round(extract(epoch from(p_now-r.started_at))/60.0)::integer)::text||' min',
      'system_timeout_cancelled',r.created_at,p_now
    ) on conflict do nothing
    returning id into v_session_id;

    if v_session_id is null then
      select session.* into v_session
      from public.sessions session
      where session.client_session_id=r.client_session_id
         or session.session_uuid=r.client_session_id
      order by case when session.client_session_id=r.client_session_id then 0 else 1 end
      limit 1 for update;
      if v_session.id is null
         or v_session.session_uuid<>r.client_session_id
         or v_session.client_session_id<>r.client_session_id
         or v_session.location_id<>r.location_id
         or v_session.employee_id<>r.employee_id
         or v_session.device_id<>r.device_id
         or v_session.status<>'cancelled' then
        raise exception using errcode='23514',
          message='Expired native occurrence conflicts with an existing terminal identity';
      end if;
      v_session_id:=v_session.id;
    end if;

    update public.custodial_offline_actor_contexts
       set status='cancelled'
     where context_id=r.context_id and status='activated';
    if not found then
      raise exception using errcode='40001',message='Expired native occurrence changed during cancellation';
    end if;
    update public.custodial_offline_submission_proofs
       set state='quarantined',consumed_at=p_now
     where submission_id=r.submission_id and state='issued';
    if not found then
      raise exception using errcode='40001',message='Expired native proof changed during cancellation';
    end if;

    insert into public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
    values(v_session_id,'offline_occurrence_expired','system','expire_stale_open_sessions',
      jsonb_build_object('reason','offline_context_expired','context_id',r.context_id,
        'occurrence_id',r.occurrence_id,'cancelled_at',p_now));
    insert into public.system_logs(level,source,message,session_id,location_id,device_id)
    values('WARN','expire_stale_open_sessions',
      'Expired native Start materialized as a same-identity cancelled session',
      v_session_id,r.location_id,r.device_id);
    v_expired_count:=v_expired_count+1;
  end loop;

  return v_expired_count;
end
$function$;

revoke all on function public.expire_stale_open_sessions(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.expire_stale_open_sessions(timestamptz) to postgres;

-- Scan state ranks projected native work ahead of terminal history across an
-- operational-day boundary because its terminal completion has not synced yet.
-- Preserve the established stale-session rule for legacy sessions rows: an
-- abandoned prior-day row does not mask current readiness on the scan surface.
create or replace view public.v_location_status as
with work_candidates as (
  select
    work.location_id,
    work.location_code,
    work.session_id,
    work.session_uuid,
    work.status session_status,
    work.started_at,
    work.ended_at,
    work.duration_minutes,
    work.duration_display,
    work.employee_name,
    work.device_identifier device_id,
    work.created_at,
    0 source_priority
  from public.custodial_open_work() work
  where work.source_kind<>'session'
     or work.started_at>=public.operational_day_start(now())

  union all

  select
    session.location_id,
    null::text,
    session.id,
    session.session_uuid,
    session.status,
    session.started_at,
    session.ended_at,
    session.duration_minutes,
    session.duration_display,
    employee.display_name,
    device.device_id,
    session.created_at,
    1 source_priority
  from public.sessions session
  left join public.employees employee on employee.id=session.employee_id
  left join public.devices device on device.id=session.device_id
  where session.status not in ('active','pending_submit')
), ranked as (
  select
    location.id location_id,
    coalesce(work.location_code,location.location_code) location_code,
    location.location_name,
    location.location_type,
    location.active location_active,
    work.session_id,
    work.session_uuid,
    work.session_status,
    work.started_at,
    work.ended_at,
    work.duration_minutes,
    work.duration_display,
    work.employee_name,
    work.device_id,
    row_number() over (
      partition by location.id
      order by work.source_priority nulls last,
        work.started_at desc nulls last,
        work.created_at desc nulls last,
        work.session_id desc nulls last
    ) rn
  from public.locations location
  left join work_candidates work on work.location_id=location.id
)
select
  location_id,location_code,location_name,location_type,location_active,
  session_id,session_uuid,session_status,started_at,ended_at,
  duration_minutes,duration_display,employee_name,device_id
from ranked
where rn=1;

-- Preserve the governed static-weekly due-state calculation; replace only the
-- open-work input with the canonical projection above.
create or replace view public.v_location_dashboard_status as
with op_day as (
  select public.operational_day_start(now()) day_start,
    public.sch_service_date(now()) service_date
), authority as (
  select state.*
  from op_day day
  cross join lateral public.static_weekly_v6_schedule_authority_state(day.service_date) state
), scheduled_baseline as (
  select assignment.location_id,
    min((day.service_date + assignment.coverage_start) at time zone 'America/Chicago') baseline_at
  from op_day day
  join lateral public.custodial_operational_location_assignments(day.service_date) assignment on true
  group by assignment.location_id
), latest_scan as (
  select location_id,max(coalesce(scanned_at,created_at)) last_scan_at
  from public.scan_events group by location_id
), open_session as (
  -- Native Start evidence survives the 04:00 boundary until reconciled. Old
  -- sessions rows retain the established current-operational-day display rule.
  select distinct on (work.location_id)
    work.location_id,work.location_code,work.session_id,work.session_uuid,
    work.status session_status,work.started_at,work.ended_at,
    work.duration_minutes,work.duration_display,
    work.employee_name,work.device_identifier
  from public.custodial_open_work() work
  where work.source_kind<>'session'
     or work.started_at>=public.operational_day_start(now())
  order by work.location_id,work.started_at desc,work.created_at desc,work.open_work_id desc
), latest_completed as (
  select distinct on (session.location_id)
    session.location_id,session.id session_id,session.session_uuid,
    session.started_at,session.ended_at,session.duration_minutes,
    session.duration_display,employee.display_name employee_name,
    completion.submitted_at,completion.response_json,
    coalesce(session.ended_at,completion.submitted_at,session.started_at) effective_completed_at
  from public.sessions session
  join public.employees employee on employee.id=session.employee_id
  left join public.completion_responses completion on completion.session_id=session.id
  cross join op_day day
  where session.status='closed'
    and coalesce(session.ended_at,completion.submitted_at,session.started_at)>=day.day_start
  order by session.location_id,
    coalesce(session.ended_at,completion.submitted_at,session.started_at) desc,
    session.started_at desc
), open_tickets as (
  select location_id,count(*) open_ticket_count
  from public.maintenance_tickets where status='open' group by location_id
), truth as (
  select location.id location_id,
    coalesce(open_session.location_code,location.location_code) location_code,
    location.location_name,
    location.location_type,location.form_type,day.day_start,
    latest_scan.last_scan_at,
    open_session.session_id open_session_id,
    open_session.session_uuid open_session_uuid,
    open_session.session_status open_session_status,
    open_session.started_at open_session_started_at,
    open_session.ended_at open_session_ended_at,
    open_session.employee_name open_session_employee_name,
    open_session.device_identifier open_session_device_identifier,
    latest_completed.session_id latest_completed_session_id,
    latest_completed.session_uuid latest_completed_session_uuid,
    latest_completed.started_at latest_started_at,
    latest_completed.ended_at latest_ended_at,
    latest_completed.submitted_at latest_submitted_at,
    latest_completed.effective_completed_at latest_completed_at,
    latest_completed.employee_name latest_employee_name,
    latest_completed.duration_minutes,latest_completed.duration_display,
    latest_completed.response_json,
    coalesce(open_tickets.open_ticket_count,0::bigint) open_ticket_count,
    scheduled_baseline.baseline_at,
    case when scheduled_baseline.baseline_at is null then null
      else greatest(
        coalesce(latest_completed.effective_completed_at,scheduled_baseline.baseline_at),
        scheduled_baseline.baseline_at
      ) end due_baseline_at,
    authority.authority_source schedule_authority_source,
    authority.projection_status schedule_projection_status
  from public.locations location
  cross join op_day day
  cross join authority
  left join scheduled_baseline on scheduled_baseline.location_id=location.id
  left join latest_scan on latest_scan.location_id=location.id
  left join open_session on open_session.location_id=location.id
  left join latest_completed on latest_completed.location_id=location.id
  left join open_tickets on open_tickets.location_id=location.id
  where location.active=true
)
select location_id,location_code,location_name,location_type,form_type,
  day_start operational_day_start,last_scan_at,
  open_session_id,open_session_uuid,open_session_status,
  open_session_started_at,open_session_ended_at,
  latest_completed_session_id,latest_completed_session_uuid,
  latest_started_at,latest_ended_at,latest_submitted_at,latest_completed_at,
  latest_employee_name,duration_minutes,duration_display,
  coalesce(response_json->'services_performed',response_json->'servicesPerformed',
    response_json->'services',response_json->'completed_services',
    response_json->'completedServices','[]'::jsonb) services_performed,
  coalesce(response_json->>'notes',response_json->>'cleaning_notes',
    response_json->>'cleaningNotes',response_json->>'maintenance_notes',
    response_json->>'maintenanceNotes',response_json->>'other_service_performed',
    response_json->>'otherServicePerformed',response_json->>'note') notes,
  open_ticket_count,
  case
    when open_session_status in ('active','pending_submit') then 'in_progress'
    when due_baseline_at is null then 'not_cleaned'
    when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',120)) then 'overdue'
    when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',90)) then 'due_soon'
    when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',240)) then 'overdue'
    when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195)) then 'due_soon'
    else 'okay'
  end status_code,
  case
    when open_session_status in ('active','pending_submit') then 'blue'
    when due_baseline_at is null then 'black'
    when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',120)))
      or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',240))) then 'red'
    when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',90)))
      or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195))) then 'yellow'
    else 'green'
  end status_color,
  to_char(timezone('America/Chicago',day_start),'MM/DD/YYYY HH12:MI AM')||' Central' operational_day_start_display,
  to_char(timezone('America/Chicago',last_scan_at),'MM/DD/YYYY HH12:MI AM')||' Central' last_scan_at_display,
  to_char(timezone('America/Chicago',open_session_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_started_at_display,
  to_char(timezone('America/Chicago',open_session_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_ended_at_display,
  to_char(timezone('America/Chicago',latest_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_started_at_display,
  to_char(timezone('America/Chicago',latest_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_ended_at_display,
  to_char(timezone('America/Chicago',latest_submitted_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_submitted_at_display,
  to_char(timezone('America/Chicago',latest_completed_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_completed_at_display,
  open_session_employee_name,open_session_device_identifier,
  schedule_authority_source,schedule_projection_status
from truth;

-- The restroom timer and schedule-health package historically counted an
-- active sessions row as the latest check. Preserve that behavior while using
-- the same projected native Start, so operational health cannot contradict the
-- manager dashboard during an acknowledged cleaning.
create or replace view public.v_restroom_check_timers as
with restroom_locations as (
  select group_row.id location_group_id,group_row.group_code,group_row.group_name,
    location.id location_id,location.location_code,location.location_name
  from public.location_groups group_row
  join public.location_group_memberships membership
    on membership.location_group_id=group_row.id and membership.active=true
  join public.locations location on location.id=membership.location_id and location.active=true
  where group_row.active=true
    and lower(coalesce(location.form_type,location.location_type,''))='restroom'
    and public.sch_is_public_restroom_group(group_row.id)
    and not (
      location.location_name ilike '%East Admin%'
      or location.location_name ilike '%West Admin%'
      or location.location_name ilike '%Elephant Trunk%'
    )
), activity as (
  select session.location_id,
    coalesce(completion.submitted_at,session.ended_at,session.started_at) activity_at,
    coalesce(submitter.display_name,employee.display_name) actor_name,
    coalesce(completion_device.device_id,device.device_id) device_identifier
  from public.sessions session
  left join public.completion_responses completion on completion.session_id=session.id
  left join public.employees submitter on submitter.id=completion.submitted_by_employee_id
  left join public.employees employee on employee.id=session.employee_id
  left join public.devices completion_device on completion_device.id=completion.device_id
  left join public.devices device on device.id=session.device_id
  where session.started_at>=public.sch_service_date(now())::timestamptz
    and session.status in ('closed','completed')

  union all

  select work.location_id,work.started_at,work.employee_name,work.device_identifier
  from public.custodial_open_work() work
), latest_completion as (
  select distinct on (restroom.location_id)
    restroom.location_id,
    activity.activity_at last_completed_at,
    activity.actor_name last_completed_by,
    activity.device_identifier last_completed_device
  from restroom_locations restroom
  left join activity on activity.location_id=restroom.location_id
  order by restroom.location_id,activity.activity_at desc nulls last
), current_owner as (
  select distinct on (assignment.location_group_id)
    assignment.location_group_id,assignment.assigned_employee_id,
    employee.display_name assigned_owner,assignment.coverage_start,
    assignment.coverage_end,assignment.coverage_purpose,assignment.status
  from public.daily_schedule_assignments assignment
  left join public.employees employee on employee.id=assignment.assigned_employee_id
  where assignment.service_date=public.sch_service_date(now())
    and timezone('America/Chicago',now())::time>=assignment.coverage_start
    and timezone('America/Chicago',now())::time<assignment.coverage_end
  order by assignment.location_group_id,
    case when assignment.coverage_purpose in ('restroom_check','restroom_upkeep','area_owner') then 0 else 1 end,
    assignment.coverage_start desc
)
select public.sch_service_date(now()) service_date,
  restroom.location_group_id,restroom.group_code,
  restroom.group_name schedule_package_name,restroom.location_id,
  restroom.location_code,restroom.location_name scanned_restroom_name,
  latest.last_completed_at,
  timezone('America/Chicago',latest.last_completed_at) last_completed_at_central,
  latest.last_completed_by,latest.last_completed_device,
  case when latest.last_completed_at is not null
    then latest.last_completed_at+interval '2 hours' end next_check_due_at,
  case when latest.last_completed_at is not null
    then timezone('America/Chicago',latest.last_completed_at+interval '2 hours') end next_check_due_at_central,
  case
    when latest.last_completed_at is null then 'not_cleaned_yet'
    when latest.last_completed_at+interval '2 hours'<=now() then 'overdue'
    when latest.last_completed_at+interval '2 hours'<=now()+interval '30 minutes' then 'due_soon'
    else 'ok'
  end timer_status,
  case when latest.last_completed_at is not null then
    round(extract(epoch from latest.last_completed_at+interval '2 hours'-now())/60.0)::integer
  end minutes_until_due,
  owner.assigned_employee_id,owner.assigned_owner,
  to_char(owner.coverage_start::interval,'HH24:MI') owner_coverage_start,
  to_char(owner.coverage_end::interval,'HH24:MI') owner_coverage_end,
  owner.coverage_purpose,owner.status owner_status,
  case when latest.last_completed_at is not null then 'scan_completion' else 'no_scan_today' end timer_source
from restroom_locations restroom
left join latest_completion latest on latest.location_id=restroom.location_id
left join current_owner owner on owner.location_group_id=restroom.location_group_id;

create or replace view public.v_admin_health_snapshot as
with cfg as (
  select public.get_setting_int('stale_session_timeout_minutes',120) stale_timeout_minutes,
    public.get_setting_int('scan_history_warning_mb',350) scan_history_warning_mb,
    public.operational_day_start(now()) operational_day_start
), storage as (
  select public.scan_history_storage_summary() summary
), counts as (
  select
    (select count(*) from public.custodial_open_work() where status='active') active_sessions,
    (select count(*) from public.custodial_open_work() where status='pending_submit') pending_submit_sessions,
    (select count(*) from public.sessions
      where status='closed' and coalesce(ended_at,started_at,created_at)>=(select operational_day_start from cfg)) closed_sessions_today,
    (select count(*) from public.v_open_maintenance_tickets) open_ticket_count,
    (select count(*) from public.v_location_dashboard_status where status_code='overdue') overdue_locations,
    (select count(*) from public.v_location_dashboard_status where status_code='due_soon') due_soon_locations,
    (select count(*) from public.v_location_dashboard_status where status_code='in_progress') in_progress_locations,
    (select count(*) from public.locations where active=true) active_locations,
    (select count(*) from public.devices where active=true) active_devices,
    (select count(*) from public.devices where active=true and last_seen_at>=now()-interval '24 hours') devices_seen_last_24h,
    (select count(*) from public.devices where active=true and (last_seen_at is null or last_seen_at<now()-interval '24 hours')) devices_missing_recent_heartbeat,
    (select count(*) from public.custodial_open_work()
      where coalesce(ended_at,started_at)<=now()-make_interval(mins=>(select stale_timeout_minutes from cfg))) stale_open_sessions,
    (select count(*) from public.system_logs where level in ('WARN','ERROR') and created_at>=now()-interval '24 hours') warn_error_logs_last_24h
)
select now() snapshot_at,
  (select operational_day_start from cfg) operational_day_start,
  (select stale_timeout_minutes from cfg) stale_timeout_minutes,
  (select scan_history_warning_mb from cfg) scan_history_warning_mb,
  counts.active_sessions,counts.pending_submit_sessions,counts.closed_sessions_today,
  counts.open_ticket_count,counts.overdue_locations,counts.due_soon_locations,
  counts.in_progress_locations,counts.active_locations,counts.active_devices,
  counts.devices_seen_last_24h,counts.devices_missing_recent_heartbeat,
  counts.stale_open_sessions,counts.warn_error_logs_last_24h,
  storage.summary storage_summary
from counts cross join storage;

create or replace function public.custodial_get_device_rollback_readiness(p_device_identifier text)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','public'
as $function$
declare v_device public.devices%rowtype; v_sync public.device_sync_status%rowtype; v_open_sessions integer;
begin
  select device.* into v_device
  from public.device_aliases alias
  join public.devices device on device.id=alias.canonical_device_id
  where alias.alias_identifier=btrim(p_device_identifier) and alias.active=true and device.active=true
  limit 1;
  if v_device.id is null then
    select device.* into v_device from public.devices device
    where device.device_id=btrim(p_device_identifier) and device.active=true limit 1;
  end if;
  if v_device.id is null then
    raise exception using errcode='P0002',message='Active device not found';
  end if;
  select * into v_sync from public.device_sync_status where device_id=v_device.id;
  select count(*)::integer into v_open_sessions
  from public.custodial_open_work() where device_id=v_device.id;
  return jsonb_build_object(
    'contract_version','custodial-rollback-readiness.v2','device_id',v_device.device_id,
    'backend_queue_count',coalesce(v_sync.queue_count,-1),'backend_open_session_count',v_open_sessions,
    'backend_sync_reported_at',v_sync.updated_at,
    'eligible',v_sync.device_id is not null and v_sync.updated_at>=now()-interval '5 minutes'
      and v_sync.queue_count=0 and v_open_sessions=0
  );
end
$function$;

create or replace function public.can_employee_start_session(p_employee_name text)
returns table(employee_name text,can_start boolean,reason text,open_session_uuid text,open_location_name text,open_status text)
language plpgsql stable set search_path to 'pg_catalog','public'
as $function$
begin
  return query
  with employee as (
    select e.id,e.display_name from public.employees e
    where e.display_name=p_employee_name and e.active=true limit 1
  ), latest_open as (
    select work.session_uuid,work.location_name,work.status
    from public.custodial_open_work() work
    join employee on employee.id=work.employee_id
    order by work.started_at desc,work.created_at desc,work.open_work_id desc
    limit 1
  )
  select p_employee_name,
    case when not exists(select 1 from employee) then false
      when exists(select 1 from latest_open) then false else true end,
    case when not exists(select 1 from employee) then 'employee_not_found'
      when exists(select 1 from latest_open) then 'employee_has_open_session' else 'ok' end,
    (select session_uuid from latest_open),
    (select location_name from latest_open),
    (select status from latest_open);
end
$function$;

create or replace function public.list_open_sessions()
returns table(session_uuid text,location_code text,location_name text,employee_name text,device_id text,status text,started_at timestamptz,ended_at timestamptz,duration_minutes integer,duration_display text)
language sql stable set search_path to 'pg_catalog','public'
as $function$
  select work.session_uuid,work.location_code,work.location_name,
    work.employee_name,work.device_identifier,work.status,work.started_at,
    work.ended_at,work.duration_minutes,work.duration_display
  from public.custodial_open_work() work
  order by work.started_at desc,work.created_at desc,work.open_work_id desc;
$function$;

-- Native Start is already server-acknowledged open work even though its final
-- sessions row is intentionally materialized only at Finish. Admit GPS only
-- when the exact projected employee/device/location/session identity matches;
-- retain NULL scan_events.session_id until that terminal row exists, and carry
-- the stable external identity in payload_json for manager correlation.
create or replace function public.custodial_gps_session_state(
  p_location_code text,
  p_device_identifier text,
  p_session_uuid text
) returns text
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select candidate.status
  from (
    select work.status,0 source_priority
    from public.custodial_open_work() work
    where work.session_uuid=nullif(btrim(coalesce(p_session_uuid,'')),'')
      and work.location_code=public.resolve_scan_location_code(p_location_code)
      and (
        upper(btrim(work.device_identifier))=upper(btrim(coalesce(p_device_identifier,'')))
        or exists(
          select 1 from public.device_aliases alias
          where alias.canonical_device_id=work.device_id and alias.active=true
            and upper(btrim(alias.alias_identifier))=upper(btrim(coalesce(p_device_identifier,'')))
        )
      )

    union all

    select session.status,1 source_priority
    from public.sessions session
    join public.devices device on device.id=session.device_id and device.active=true
    join public.locations location on location.id=session.location_id and location.active=true
    where session.session_uuid=nullif(btrim(coalesce(p_session_uuid,'')),'')
      and location.location_code=public.resolve_scan_location_code(p_location_code)
      and (
        upper(btrim(device.device_id))=upper(btrim(coalesce(p_device_identifier,'')))
        or exists(
          select 1 from public.device_aliases alias
          where alias.canonical_device_id=device.id and alias.active=true
            and upper(btrim(alias.alias_identifier))=upper(btrim(coalesce(p_device_identifier,'')))
        )
      )
  ) candidate
  order by candidate.source_priority
  limit 1
$function$;

do $patch_projected_gps_measurements$
declare
  identity text;
  definition text;
  corrected text;
  validation_old text;
  validation_new text;
  payload_old text;
  payload_new text;
begin
  foreach identity in array array[
    'public.custodial_evaluate_location_proximity_measurement(text,text,numeric,numeric,numeric,text,text,text)',
    'public.custodial_evaluate_location_proximity_v2_measurement(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'
  ] loop
    definition:=pg_get_functiondef(to_regprocedure(identity));
    if definition is null then
      raise exception 'Required GPS measurement core % is missing',identity;
    end if;

    validation_old:='    if v_session_id is null then' || chr(10)
      || '      raise exception ''Session does not belong to this device and location'';' || chr(10)
      || '    end if;';
    validation_new:='    if v_session_id is null and public.custodial_gps_session_state(' || chr(10)
      || '      v_resolved_location_code,v_presented_device,v_session_key' || chr(10)
      || '    ) is null then' || chr(10)
      || '      raise exception ''Session does not belong to this device and location'';' || chr(10)
      || '    end if;';
    corrected:=replace(definition,validation_old,validation_new);

    if corrected=definition then
      validation_old:='    if v_session_id is null then raise exception ''Session does not belong to this device and location''; end if;';
      corrected:=replace(definition,validation_old,validation_new);
    end if;
    if corrected=definition then
      if position('public.custodial_gps_session_state(' in definition)=0 then
        raise exception 'GPS projected-session validation patch point was not found in %',identity;
      end if;
    end if;

    payload_old:='      jsonb_build_object(' || chr(10)
      || '        ''distance_m'', v_distance,';
    payload_new:='      jsonb_build_object(' || chr(10)
      || '        ''session_uuid'', nullif(v_session_key, ''''),' || chr(10)
      || '        ''client_session_id'', nullif(v_session_key, ''''),' || chr(10)
      || '        ''distance_m'', v_distance,';
    definition:=replace(corrected,payload_old,payload_new);
    if definition=corrected then
      if position('''session_uuid'', nullif(v_session_key' in corrected)=0
         or position('''client_session_id'', nullif(v_session_key' in corrected)=0 then
        raise exception 'GPS scan-event identity payload patch point was not found in %',identity;
      end if;
    end if;
    execute definition;
  end loop;
end
$patch_projected_gps_measurements$;

revoke all on function public.custodial_gps_session_state(text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.custodial_gps_session_state(text,text,text) to postgres;

create or replace view public.v_exception_queue as
select 'open_ticket'::text exception_type,
  ticket.ticket_id::text entity_id,ticket.location_code,ticket.location_name,
  ticket.date_submitted event_at,ticket.date_submitted_display event_at_display,
  ticket.maintenance_issue summary,ticket.reported_by actor,
  jsonb_build_object('fixture_type',ticket.fixture_type,'fixture_identifier',ticket.fixture_identifier,
    'out_of_order',ticket.out_of_order,'status',ticket.status) details
from public.v_open_maintenance_tickets ticket

union all

select 'overdue_location'::text,location.location_id::text,
  location.location_code,location.location_name,location.latest_completed_at,
  location.latest_completed_at_display,'Location overdue for cleaning'::text,
  location.latest_employee_name,
  jsonb_build_object('form_type',location.form_type,'status_code',location.status_code,
    'status_color',location.status_color,'open_ticket_count',location.open_ticket_count)
from public.v_location_dashboard_status location
where location.status_code='overdue'

union all

select 'stale_device'::text,device.id::text,null::text,device.device_name,
  greatest(device.last_seen_at,sync.last_server_ack_at,sync.updated_at),
  case when greatest(device.last_seen_at,sync.last_server_ack_at,sync.updated_at) is null then 'Never seen'::text
    else to_char(timezone('America/Chicago',greatest(device.last_seen_at,sync.last_server_ack_at,sync.updated_at)),
      'MM/DD/YYYY HH12:MI AM')||' Central' end,
  'Device missing recent heartbeat'::text,device.device_id,
  jsonb_build_object('device_id',device.device_id,'active',device.active,'last_seen_at',device.last_seen_at,
    'last_server_ack_at',sync.last_server_ack_at,'sync_updated_at',sync.updated_at)
from public.devices device
left join public.device_sync_status sync on sync.device_id=device.id
where device.active=true and device.assigned_employee_id is not null
  and (greatest(device.last_seen_at,sync.last_server_ack_at,sync.updated_at) is null
    or greatest(device.last_seen_at,sync.last_server_ack_at,sync.updated_at)<now()-interval '24 hours')

union all

select 'stale_open_session'::text,work.session_uuid,work.location_code,
  work.location_name,coalesce(work.ended_at,work.started_at),
  to_char(timezone('America/Chicago',coalesce(work.ended_at,work.started_at)),
    'MM/DD/YYYY HH12:MI AM')||' Central',
  'Open session exceeded stale timeout'::text,work.employee_name,
  jsonb_build_object('status',work.status,'device_id',work.device_identifier,
    'started_at',work.started_at,'ended_at',work.ended_at)
from public.custodial_open_work() work
where coalesce(work.ended_at,work.started_at)<=now()-make_interval(
  mins=>public.get_setting_int('stale_session_timeout_minutes',120)
);

-- Keep the external identity stable from phone Start through manager active
-- truth and final history. Existing historical sessions remain untouched.
do $patch_completion_session_identity$
declare
  definition text;
  corrected text;
  cancellation_old text := $needle$begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);$needle$;
  cancellation_new text := $needle$begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select session.* into v_session
  from public.sessions session
  where session.client_session_id=v_client_session_id and session.status='cancelled'
  limit 1;
  if v_session.id is not null then
    if not exists(
      select 1
      from public.custodial_offline_actor_contexts context
      join public.locations location on location.id=context.location_id
      join public.devices device on device.id=context.device_id
      where context.context_id::text=lower(btrim(coalesce(p_context_id,'')))
        and context.client_session_id=v_client_session_id
        and context.status='cancelled'
        and context.location_id=v_session.location_id
        and context.employee_id=v_session.employee_id
        and context.device_id=v_session.device_id
        and location.location_code=public.resolve_scan_location_code(p_location_code)
        and (
          upper(btrim(device.device_id))=upper(btrim(coalesce(p_device_id,'')))
          or exists(
            select 1 from public.device_aliases alias
            where alias.canonical_device_id=device.id and alias.active=true
              and upper(btrim(alias.alias_identifier))=upper(btrim(coalesce(p_device_id,'')))
          )
        )
    ) then
      raise exception using errcode='23514',message='Cancelled session does not match the frozen offline occurrence';
    end if;
    return jsonb_build_object(
      'status','cancelled','terminal',true,'discard_local_workflow',true,
      'reason','offline_context_expired','session_uuid',v_session.session_uuid,
      'client_session_id',v_session.client_session_id,
      'client_completion_id',v_client_completion_id,
      'started_at',v_session.started_at,'ended_at',v_session.ended_at,
      'duration_minutes',v_session.duration_minutes,
      'duration_display',v_session.duration_display,'replayed',true
    );
  end if;$needle$;
begin
  definition:=pg_get_functiondef('public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)'::regprocedure);
  corrected:=replace(
    definition,
    'values(gen_random_uuid()::text,v_client_session_id,v_context.location_id',
    'values(v_client_session_id,v_client_session_id,v_context.location_id'
  );
  if corrected=definition then
    if position('values(v_client_session_id,v_client_session_id,v_context.location_id' in definition)=0 then
      raise exception 'Canonical offline completion session identity patch point was not found';
    end if;
  else
    definition:=corrected;
  end if;
  if position('''reason'',''offline_context_expired''' in definition)=0 then
    corrected:=replace(definition,cancellation_old,cancellation_new);
    if corrected=definition then
      raise exception 'Canonical offline cancellation replay patch point was not found';
    end if;
    definition:=corrected;
  end if;
  execute definition;
end
$patch_completion_session_identity$;

-- v2 is retained for recovery clients. For projected active work there is no
-- sessions row yet, so the projected external UUID is also the client UUID.
create or replace function public.tool_get_location_scan_state_v2(p_location_code text,p_device_id text)
returns jsonb language sql stable security definer set search_path to 'pg_catalog','public','extensions'
as $function$
  with base as (
    select * from public.get_location_scan_state(p_location_code,p_device_id) limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'found',true,
        'location_code',base.location_code,
        'location_name',base.location_name,
        'location_type',base.location_type,
        'form_type',coalesce(location.form_type,base.location_type),
        'location_active',base.location_active,
        'device_approved',base.device_approved,
        'assigned_device_employee_name',assigned.display_name,
        'assigned_device_name',device.device_name,
        'latest_session_uuid',base.latest_session_uuid,
        'latest_client_session_id',coalesce(session.client_session_id,
          case when base.latest_session_status in ('active','pending_submit') then base.latest_session_uuid end),
        'latest_session_status',base.latest_session_status,
        'latest_employee_name',base.latest_employee_name,
        'latest_device_id',base.latest_device_id,
        'started_at',base.started_at,
        'ended_at',base.ended_at,
        'duration_minutes',session.duration_minutes,
        'duration_display',session.duration_display,
        'completion_source',session.completion_source,
        'suggested_action',base.suggested_action
      )
      from base
      left join public.locations location on location.location_code=base.location_code
      left join public.devices device
        on upper(btrim(device.device_id))=upper(btrim(coalesce(p_device_id,''))) and device.active=true
      left join public.employees assigned on assigned.id=device.assigned_employee_id and assigned.active=true
      left join public.sessions session
        on session.session_uuid=base.latest_session_uuid or session.client_session_id=base.latest_session_uuid
      limit 1
    ),
    jsonb_build_object(
      'found',false,
      'location_code',public.resolve_scan_location_code(p_location_code),
      'device_approved',public.is_approved_device(p_device_id),
      'message','No scan state found'
    )
  );
$function$;

-- Operational views are executable authority, not cosmetic reporting. Capture
-- an exact, replayable definition (including owner and security reloptions) so
-- release recovery cannot report green while phone and manager truth diverge.
alter table public.custodial_release_authority_restore_inventory
  drop constraint if exists custodial_release_authority_restore_inventory_object_kind_check;
alter table public.custodial_release_authority_restore_inventory
  add constraint custodial_release_authority_restore_inventory_object_kind_check
  check (object_kind in (
    'function','relation','column','column_set','constraint','index','trigger',
    'policy','relation_state','view','grant'
  ));

create or replace function public.custodial_release_authority_current_view_definition(
  p_object_identity text
) returns text
language sql
stable
strict
set search_path to 'pg_catalog','public'
as $function$
  select format(
    'create or replace view %I.%I as %s; alter view %I.%I reset (check_option,security_barrier,security_invoker);%s alter view %I.%I owner to %I;',
    namespace.nspname,relation.relname,
    rtrim(pg_get_viewdef(relation.oid,true),E' \n\r\t;'),
    namespace.nspname,relation.relname,
    case when coalesce(cardinality(relation.reloptions),0)=0 then '' else format(
      ' alter view %I.%I set (%s);',namespace.nspname,relation.relname,
      (select string_agg(format('%I=%L',option.option_name,option.option_value),', ' order by option.option_name)
       from pg_options_to_table(relation.reloptions) option)
    ) end,
    namespace.nspname,relation.relname,pg_get_userbyid(relation.relowner)
  )
  from pg_class relation
  join pg_namespace namespace on namespace.oid=relation.relnamespace
  where relation.oid=to_regclass(p_object_identity) and relation.relkind='v';
$function$;

revoke all on function public.custodial_release_authority_current_view_definition(text)
  from public,anon,authenticated,service_role;
grant execute on function public.custodial_release_authority_current_view_definition(text) to postgres;

do $extend_release_surface$
declare
  definition text;
  corrected text;
  old_tail text := $needle$    ('function','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','manager push dispatch completion');$needle$;
  new_tail text := $needle$    ('function','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','manager push dispatch completion'),
    ('view','public.v_location_status','phone scan-state operational truth'),
    ('view','public.v_location_dashboard_status','manager location operational truth'),
    ('view','public.v_restroom_check_timers','restroom timer operational truth'),
    ('view','public.v_admin_health_snapshot','admin operational health truth'),
    ('view','public.v_exception_queue','manager exception operational truth'),
    ('view','public.v_restroom_package_status','restroom timer dependent projection');$needle$;
begin
  definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if position('(''view'',''public.v_location_status''' in definition)=0 then
    corrected:=replace(definition,old_tail,new_tail);
    if corrected=definition then
      raise exception 'Release authority surface extension point was not found';
    end if;
    execute corrected;
  elsif position('(''view'',''public.v_restroom_package_status''' in definition)=0 then
    raise exception 'Release authority surface has only a partial operational-view projection';
  end if;
end
$extend_release_surface$;

do $extend_release_health_for_views$
declare
  definition text;
  corrected text;
  original text;
  surface_old text := $needle$     or (s.object_kind='relation' and to_regclass(s.object_identity) is null);$needle$;
  surface_new text := $needle$     or (s.object_kind='relation' and to_regclass(s.object_identity) is null)
     or (s.object_kind='view' and public.custodial_release_authority_current_view_definition(s.object_identity) is null);$needle$;
  missing_old text := $needle$     or (i.object_kind='grant' and public.custodial_release_authority_current_grant_definition(i.object_identity) is null);$needle$;
  missing_new text := $needle$     or (i.object_kind='view' and public.custodial_release_authority_current_view_definition(i.object_identity) is null)
     or (i.object_kind='grant' and public.custodial_release_authority_current_grant_definition(i.object_identity) is null);$needle$;
  mismatch_old text := $needle$     or (i.object_kind='grant' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_grant_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256);$needle$;
  mismatch_new text := $needle$     or (i.object_kind='view' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_view_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='grant' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_grant_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256);$needle$;
begin
  definition:=pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure);
  original:=definition;
  if position('s.object_kind=''view''' in definition)=0 then
    corrected:=replace(definition,surface_old,surface_new);
    if corrected=definition then raise exception 'Release health surface-view patch point was not found'; end if;
    definition:=corrected;
  end if;
  if position('i.object_kind=''view'' and public.custodial_release_authority_current_view_definition(i.object_identity) is null' in definition)=0 then
    corrected:=replace(definition,missing_old,missing_new);
    if corrected=definition then raise exception 'Release health missing-view patch point was not found'; end if;
    definition:=corrected;
  end if;
  if position('i.object_kind=''view'' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_view_definition' in definition)=0 then
    corrected:=replace(definition,mismatch_old,mismatch_new);
    if corrected=definition then raise exception 'Release health mismatched-view patch point was not found'; end if;
    definition:=corrected;
  end if;
  if definition<>original then execute definition; end if;
end
$extend_release_health_for_views$;

-- Refresh or add the exact executable recovery definitions and grants changed
-- by this migration. The immutable inventory remains the runtime drift gate.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $refresh_recovery_inventory$
declare
  identity text;
  canonical text;
  definition text;
  grant_definition text;
  next_order integer;
  changed integer;
begin
  foreach identity in array array[
    'public.custodial_open_work()',
    'public.custodial_release_authority_current_view_definition(text)',
    'public.custodial_release_canary_authority_surface()',
    'public.custodial_backend_authority_health(text)',
    'public.custodial_reject_offline_evidence_mutation()',
    'public.expire_stale_open_sessions(timestamp with time zone)',
    'public.custodial_get_device_rollback_readiness(text)',
    'public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)',
    'public.can_employee_start_session(text)',
    'public.list_open_sessions()',
    'public.get_location_scan_state(text,text)',
    'public.tool_get_location_scan_state(text,text)',
    'public.custodial_gps_session_state(text,text,text)',
    'public.custodial_evaluate_location_proximity_measurement(text,text,numeric,numeric,numeric,text,text,text)',
    'public.custodial_evaluate_location_proximity_v2_measurement(text,text,numeric,numeric,numeric,text,text,text,timestamptz)',
    'public.tool_get_location_scan_state_v2(text,text)'
  ] loop
    canonical:=to_regprocedure(identity)::text;
    definition:=pg_get_functiondef(to_regprocedure(identity));
    if canonical is null or definition is null then
      raise exception 'Required operational-truth function % is missing',identity;
    end if;

    update public.custodial_release_authority_restore_inventory
       set definition_sql=definition,
           definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
           restore_order=case when identity='public.custodial_open_work()' then 99999 else restore_order end,
           captured_at=statement_timestamp()
     where object_kind='function' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed=0 then
      if identity='public.custodial_open_work()' then
        -- Recovery executes the inventory in numeric order. This new helper
        -- must exist before every pre-existing function that now depends on it.
        next_order:=99999;
      else
        select coalesce(max(restore_order),100000)+1 into next_order
        from public.custodial_release_authority_restore_inventory
        where object_kind='function' and restore_order<200000;
      end if;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values (
        next_order,'function',canonical,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
    elsif changed<>1 then
      raise exception 'Recovery function inventory identity % is duplicated',canonical;
    end if;

    grant_definition:=public.custodial_release_authority_current_grant_definition(canonical);
    if grant_definition is null then
      raise exception 'Recovery grant definition for % is unavailable',canonical;
    end if;
    update public.custodial_release_authority_restore_inventory
       set definition_sql=grant_definition,
           definition_sha256=encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'),
           captured_at=statement_timestamp()
     where object_kind='grant' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed=0 then
      select coalesce(max(restore_order),100000)+1 into next_order
      from public.custodial_release_authority_restore_inventory;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values (
        next_order,'grant',canonical,grant_definition,
        encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex')
      );
    elsif changed<>1 then
      raise exception 'Recovery grant inventory identity % is duplicated',canonical;
    end if;
  end loop;
end
$refresh_recovery_inventory$;

do $refresh_recovery_nonfunction_inventory$
declare
  identity text;
  definition text;
  changed integer;
begin
  identity:='public.custodial_release_authority_restore_inventory:custodial_release_authority_restore_inventory_object_kind_check';
  definition:=public.custodial_release_authority_current_constraint_definition(identity);
  if definition is null then raise exception 'Recovery object-kind constraint definition is unavailable'; end if;
  update public.custodial_release_authority_restore_inventory
     set definition_sql=definition,
         definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
         captured_at=statement_timestamp()
   where object_kind='constraint' and object_identity=identity;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Recovery object-kind constraint inventory row is missing or duplicated'; end if;

  identity:='public.idx_custodial_offline_actor_contexts_native_open';
  definition:=public.custodial_release_authority_current_index_definition(identity);
  if definition is null then raise exception 'Native open-work index definition is unavailable'; end if;
  insert into public.custodial_release_authority_restore_inventory(
    restore_order,object_kind,object_identity,definition_sql,definition_sha256
  ) values (
    699999,'index',identity,definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
  ) on conflict(object_kind,object_identity) do update set
    restore_order=excluded.restore_order,definition_sql=excluded.definition_sql,
    definition_sha256=excluded.definition_sha256,captured_at=statement_timestamp();
end
$refresh_recovery_nonfunction_inventory$;

do $refresh_recovery_view_inventory$
declare
  row record;
  definition text;
begin
  for row in
    select * from (values
      ('public.v_location_status',850001,950001),
      ('public.v_location_dashboard_status',850002,950002),
      ('public.v_restroom_check_timers',850003,950003),
      ('public.v_admin_health_snapshot',850004,950004),
      ('public.v_exception_queue',850005,950005),
      ('public.v_restroom_package_status',850006,950006)
    ) wanted(object_identity,view_order,grant_order)
  loop
    definition:=public.custodial_release_authority_current_view_definition(row.object_identity);
    if definition is null then raise exception 'Required recovery view % is unavailable',row.object_identity; end if;
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values (
      row.view_order,'view',row.object_identity,definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
    ) on conflict(object_kind,object_identity) do update set
      restore_order=excluded.restore_order,definition_sql=excluded.definition_sql,
      definition_sha256=excluded.definition_sha256,captured_at=statement_timestamp();

    definition:=public.custodial_release_authority_current_grant_definition(row.object_identity);
    if definition is null then raise exception 'Required recovery view grant % is unavailable',row.object_identity; end if;
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values (
      row.grant_order,'grant',row.object_identity,definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
    ) on conflict(object_kind,object_identity) do update set
      restore_order=excluded.restore_order,definition_sql=excluded.definition_sql,
      definition_sha256=excluded.definition_sha256,captured_at=statement_timestamp();
  end loop;
end
$refresh_recovery_view_inventory$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
begin
  if not has_function_privilege('custodial_application_reader','public.custodial_open_work()','EXECUTE')
     or not has_function_privilege('service_role','public.custodial_open_work()','EXECUTE')
     or has_function_privilege('anon','public.custodial_open_work()','EXECUTE')
     or has_function_privilege('authenticated','public.custodial_open_work()','EXECUTE') then
    raise exception 'Open-work read authority is not exact';
  end if;
  if not exists(
    select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='function'
      and object_identity=to_regprocedure('public.custodial_open_work()')::text
      and restore_order<all(
        select restore_order from public.custodial_release_authority_restore_inventory
        where object_kind='function'
          and object_identity<>to_regprocedure('public.custodial_open_work()')::text
          and position('public.custodial_open_work()' in definition_sql)>0
      )
  ) then
    raise exception 'Open-work recovery helper is not ordered before its dependents';
  end if;
  if position('public.custodial_gps_session_state(' in pg_get_functiondef(
       'public.custodial_evaluate_location_proximity_measurement(text,text,numeric,numeric,numeric,text,text,text)'::regprocedure
     ))=0
     or position('''client_session_id'', nullif(v_session_key' in pg_get_functiondef(
       'public.custodial_evaluate_location_proximity_v2_measurement(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'::regprocedure
     ))=0 then
    raise exception 'Projected native GPS identity patch is not installed';
  end if;
  if (
    select count(*) from public.custodial_release_authority_restore_inventory
    where object_kind='view' and object_identity in (
      'public.v_location_status','public.v_location_dashboard_status',
      'public.v_restroom_check_timers','public.v_admin_health_snapshot',
      'public.v_exception_queue','public.v_restroom_package_status'
    )
  )<>6 or (
    select count(*) from public.custodial_release_authority_restore_inventory
    where object_kind='grant' and object_identity in (
      'public.v_location_status','public.v_location_dashboard_status',
      'public.v_restroom_check_timers','public.v_admin_health_snapshot',
      'public.v_exception_queue','public.v_restroom_package_status'
    ) and restore_order between 950001 and 950006
  )<>6 then
    raise exception 'Operational-view recovery inventory is incomplete';
  end if;
  if (
    select count(*) from public.custodial_release_canary_authority_surface()
    where object_kind='view' and object_identity in (
      'public.v_location_status','public.v_location_dashboard_status',
      'public.v_restroom_check_timers','public.v_admin_health_snapshot',
      'public.v_exception_queue','public.v_restroom_package_status'
    )
  )<>6 or position('object_kind=''view''' in pg_get_functiondef(
    'public.custodial_backend_authority_health(text)'::regprocedure
  ))=0 then
    raise exception 'Operational views are absent from release health authority';
  end if;
  if exists(
    select 1 from public.custodial_release_authority_restore_inventory inventory
    where inventory.object_kind='view' and inventory.object_identity in (
      'public.v_location_status','public.v_location_dashboard_status',
      'public.v_restroom_check_timers','public.v_admin_health_snapshot',
      'public.v_exception_queue','public.v_restroom_package_status'
    ) and (
      inventory.definition_sql is distinct from public.custodial_release_authority_current_view_definition(inventory.object_identity)
      or inventory.definition_sha256 is distinct from encode(extensions.digest(
        convert_to(public.custodial_release_authority_current_view_definition(inventory.object_identity),'UTF8'),'sha256'
      ),'hex')
    )
  ) then
    raise exception 'Operational-view recovery definitions are not exact';
  end if;
  if exists(
    select 1 from public.custodial_release_authority_restore_inventory
    where definition_sha256<>encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'Release recovery inventory digest mismatch';
  end if;
end
$postflight$;

commit;
