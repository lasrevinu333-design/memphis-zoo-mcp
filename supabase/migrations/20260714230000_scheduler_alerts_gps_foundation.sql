-- Memphis Zoo custodial foundation release
-- Scheduler readiness, full-day My Schedule, durable reminder acknowledgement,
-- one-message-per-notification-instance, and authoritative GPS evaluation.
-- This migration is intentionally idempotent because the production functions
-- were installed and validated before the source snapshot was committed.

create or replace function public.run_application_write(p_name text, p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_sql text := btrim(coalesce(p_sql, ''));
  v_lower text;
  v_result jsonb;
begin
  if v_name is null then raise exception 'Application write name is required'; end if;
  if v_sql = '' then raise exception 'Application write SQL is required'; end if;
  if length(v_sql) > 1000000 then raise exception 'Application write SQL exceeds 1 MB'; end if;
  v_lower := lower(v_sql);
  if v_lower ~ '^\s*(begin|commit|rollback|savepoint|prepare|vacuum|reindex|cluster|copy|alter\s+system|create\s+extension|drop\s+database|drop\s+schema)' then
    raise exception 'Database-control statements are not accepted by run_application_write';
  end if;
  if v_lower ~ '^\s*(insert|update|delete|select|with)\b'
     and v_lower like '% returning %'
     and position(';' in regexp_replace(v_sql, ';\s*$', '')) = 0 then
    execute format(
      'with _application_rows as (%s) select coalesce(jsonb_agg(to_jsonb(_application_rows)), ''[]''::jsonb) from _application_rows',
      regexp_replace(v_sql, ';\s*$', '')
    ) into v_result;
  else
    execute v_sql;
    v_result := jsonb_build_object('ok', true, 'name', v_name, 'executed_at', now());
  end if;
  return coalesce(v_result, '[]'::jsonb);
end
$function$;
revoke all on function public.run_application_write(text,text) from public,anon,authenticated;
grant execute on function public.run_application_write(text,text) to service_role;

insert into public.system_settings(setting_key,setting_value,description,updated_at)
values
  ('gps_proximity_radius_m','175'::jsonb,'Maximum standard distance from the authoritative location coordinate for a green cleaning proximity result.',now()),
  ('gps_max_accuracy_m','100'::jsonb,'GPS readings less accurate than this remain amber and cannot be marked near.',now())
on conflict(setting_key) do update set
  description=excluded.description,
  updated_at=now();

create table if not exists public.device_notification_acknowledgements(
  id uuid primary key default gen_random_uuid(),
  device_identifier text not null,
  notification_key text not null,
  notification_type text not null default 'notification',
  displayed_at timestamptz null,
  dismissed_at timestamptz null,
  opened_at timestamptz null,
  acknowledged_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_notification_ack_key_length check(length(notification_key) between 1 and 500),
  constraint device_notification_ack_unique unique(device_identifier,notification_key)
);
alter table public.device_notification_acknowledgements enable row level security;
revoke all on table public.device_notification_acknowledgements from public,anon,authenticated;
grant select,insert,update,delete on table public.device_notification_acknowledgements to service_role;
create index if not exists idx_device_notification_ack_recent
  on public.device_notification_acknowledgements(device_identifier,updated_at desc);
create index if not exists idx_device_notification_ack_type
  on public.device_notification_acknowledgements(notification_type,acknowledged_at,dismissed_at);

create or replace function public.ack_device_notification(
  p_device_identifier text,
  p_notification_key text,
  p_notification_type text default 'notification',
  p_action text default 'dismissed',
  p_metadata_json jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
  v_key text := nullif(btrim(coalesce(p_notification_key,'')), '');
  v_type text := left(lower(coalesce(nullif(btrim(p_notification_type),''),'notification')),80);
  v_action text := lower(coalesce(nullif(btrim(p_action),''),'dismissed'));
  v_row public.device_notification_acknowledgements%rowtype;
begin
  if v_requested is null or length(v_requested)>200 then raise exception 'device_identifier is required and must be at most 200 characters'; end if;
  if v_key is null or length(v_key)>500 then raise exception 'notification_key is required and must be at most 500 characters'; end if;
  if v_action not in ('displayed','dismissed','opened','acknowledged') then raise exception 'unsupported notification action: %',v_action; end if;
  if jsonb_typeof(coalesce(p_metadata_json,'{}'::jsonb))<>'object' then raise exception 'metadata_json must be an object'; end if;

  select d.device_id into v_device
  from public.devices d
  where d.active=true and upper(btrim(d.device_id))=upper(v_requested)
  limit 1;
  if v_device is null then
    select d.device_id into v_device
    from public.device_aliases da
    join public.devices d on d.id=da.canonical_device_id and d.active=true
    where da.active=true and upper(btrim(da.alias_identifier))=upper(v_requested)
    limit 1;
  end if;
  if v_device is null then raise exception 'Active device not found: %',v_requested; end if;

  insert into public.device_notification_acknowledgements(
    device_identifier,notification_key,notification_type,
    displayed_at,dismissed_at,opened_at,acknowledged_at,metadata_json,updated_at
  ) values(
    v_device,v_key,v_type,
    case when v_action='displayed' then now() end,
    case when v_action='dismissed' then now() end,
    case when v_action='opened' then now() end,
    case when v_action in ('dismissed','opened','acknowledged') then now() end,
    coalesce(p_metadata_json,'{}'::jsonb)||jsonb_build_object('presented_device_identifier',v_requested),now()
  )
  on conflict(device_identifier,notification_key) do update set
    notification_type=excluded.notification_type,
    displayed_at=coalesce(public.device_notification_acknowledgements.displayed_at,excluded.displayed_at),
    dismissed_at=coalesce(public.device_notification_acknowledgements.dismissed_at,excluded.dismissed_at),
    opened_at=coalesce(public.device_notification_acknowledgements.opened_at,excluded.opened_at),
    acknowledged_at=coalesce(public.device_notification_acknowledgements.acknowledged_at,excluded.acknowledged_at),
    metadata_json=coalesce(public.device_notification_acknowledgements.metadata_json,'{}'::jsonb)||excluded.metadata_json,
    updated_at=now()
  returning * into v_row;

  return jsonb_build_object(
    'device_identifier',v_row.device_identifier,
    'notification_key',v_row.notification_key,
    'notification_type',v_row.notification_type,
    'displayed_at',v_row.displayed_at,
    'dismissed_at',v_row.dismissed_at,
    'opened_at',v_row.opened_at,
    'acknowledged_at',v_row.acknowledged_at
  );
end
$function$;

create or replace function public.list_device_notification_acknowledgements(
  p_device_identifier text,
  p_limit integer default 500
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
  v_limit integer := greatest(1,least(coalesce(p_limit,500),2000));
  v_result jsonb;
begin
  if v_requested is null or length(v_requested)>200 then raise exception 'device_identifier is required and must be at most 200 characters'; end if;
  select d.device_id into v_device from public.devices d
   where d.active=true and upper(btrim(d.device_id))=upper(v_requested) limit 1;
  if v_device is null then
    select d.device_id into v_device from public.device_aliases da
    join public.devices d on d.id=da.canonical_device_id and d.active=true
    where da.active=true and upper(btrim(da.alias_identifier))=upper(v_requested) limit 1;
  end if;
  if v_device is null then raise exception 'Active device not found: %',v_requested; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb) into v_result
  from(
    select notification_key,notification_type,displayed_at,dismissed_at,opened_at,acknowledged_at,updated_at
    from public.device_notification_acknowledgements
    where device_identifier=v_device and acknowledged_at is not null
    order by updated_at desc limit v_limit
  )x;
  return jsonb_build_object('device_identifier',v_device,'acknowledgements',v_result);
end
$function$;

create or replace function public.dismiss_device_reminder(
  p_instance_key text,
  p_device_id text,
  p_reminder_kind text default 'notification',
  p_source_id text default null,
  p_metadata_json jsonb default '{}'::jsonb
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.ack_device_notification(
    p_device_id,p_instance_key,p_reminder_kind,'dismissed',
    coalesce(p_metadata_json,'{}'::jsonb)||jsonb_build_object('source_id',p_source_id)
  );
$function$;
revoke all on function public.ack_device_notification(text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.list_device_notification_acknowledgements(text,integer) from public,anon,authenticated;
revoke all on function public.dismiss_device_reminder(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ack_device_notification(text,text,text,text,jsonb) to service_role;
grant execute on function public.list_device_notification_acknowledgements(text,integer) to service_role;
grant execute on function public.dismiss_device_reminder(text,text,text,text,jsonb) to service_role;

create or replace function public.msg_send_message(
  p_thread_id uuid,
  p_sender_user_id uuid,
  p_body text,
  p_message_type text default 'text'::text,
  p_metadata_json jsonb default '{}'::jsonb
) returns public.msg_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_message public.msg_messages%rowtype;
  v_metadata jsonb := coalesce(p_metadata_json,'{}'::jsonb);
  v_client_message_id text := nullif(btrim(coalesce(p_metadata_json->>'client_message_id','')), '');
  v_source text := lower(btrim(coalesce(p_metadata_json->>'source','')));
  v_event_id text := nullif(btrim(coalesce(p_metadata_json->>'event_id','')), '');
  v_dedupe_key text := nullif(btrim(coalesce(
    p_metadata_json->>'notification_instance_key',p_metadata_json->>'instance_key',
    p_metadata_json->>'notification_key',p_metadata_json->>'alert_key',
    p_metadata_json->>'reminder_key',''
  )), '');
begin
  if p_thread_id is null then raise exception 'thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'Message body is required.'; end if;
  if length(p_body)>2000 then raise exception 'Message body cannot exceed 2000 characters.'; end if;
  if not exists(select 1 from public.msg_thread_participants tp
                where tp.thread_id=p_thread_id and tp.user_id=p_sender_user_id and tp.left_at is null) then
    raise exception 'Sender is not an active participant in this thread.';
  end if;
  if v_dedupe_key is null and v_source='events_app' and v_event_id is not null then v_dedupe_key:='event:'||v_event_id; end if;
  if v_dedupe_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('message-notification:'||p_thread_id::text||':'||p_sender_user_id::text||':'||v_dedupe_key,0));
    select * into v_message from public.msg_messages m
    where m.thread_id=p_thread_id and m.sender_user_id=p_sender_user_id and m.is_deleted=false
      and (m.metadata_json->>'notification_instance_key'=v_dedupe_key
           or (v_source='events_app' and v_event_id is not null
               and coalesce(m.metadata_json->>'source','')='events_app'
               and m.metadata_json->>'event_id'=v_event_id))
    order by m.sent_at limit 1;
    if found then return v_message; end if;
    v_metadata:=v_metadata||jsonb_build_object('notification_instance_key',v_dedupe_key);
  end if;
  if v_client_message_id is not null then
    select * into v_message from public.msg_messages m
    where m.sender_user_id=p_sender_user_id and m.client_message_id=v_client_message_id limit 1;
    if found then return v_message; end if;
  end if;
  insert into public.msg_messages(thread_id,sender_user_id,message_type,body,metadata_json,client_message_id)
  values(p_thread_id,p_sender_user_id,coalesce(nullif(btrim(p_message_type),''),'text'),btrim(p_body),v_metadata,v_client_message_id)
  returning * into v_message;
  insert into public.msg_receipts(message_id,user_id,delivered_at,displayed_at,read_at,acknowledged_at)
  select v_message.id,tp.user_id,null,null,null,null
  from public.msg_thread_participants tp
  where tp.thread_id=p_thread_id and tp.left_at is null and tp.user_id<>p_sender_user_id
  on conflict(message_id,user_id) do nothing;
  update public.msg_threads set last_message_at=v_message.sent_at,updated_at=now() where id=p_thread_id;
  return v_message;
exception when unique_violation then
  if v_client_message_id is not null then
    select * into v_message from public.msg_messages m
    where m.sender_user_id=p_sender_user_id and m.client_message_id=v_client_message_id limit 1;
    if found then return v_message; end if;
  end if;
  if v_dedupe_key is not null then
    select * into v_message from public.msg_messages m
    where m.thread_id=p_thread_id and m.sender_user_id=p_sender_user_id
      and m.metadata_json->>'notification_instance_key'=v_dedupe_key limit 1;
    if found then return v_message; end if;
  end if;
  raise;
end
$function$;
revoke all on function public.msg_send_message(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb) to service_role;

do $do$
begin
  if to_regprocedure('public.sch_employee_my_schedule_phase_v1(date,uuid,timestamp with time zone)') is null then
    if to_regprocedure('public.sch_employee_my_schedule_page(date,uuid,timestamp with time zone)') is null then
      raise exception 'public.sch_employee_my_schedule_page(date,uuid,timestamptz) is missing';
    end if;
    alter function public.sch_employee_my_schedule_page(date,uuid,timestamp with time zone)
      rename to sch_employee_my_schedule_phase_v1;
  end if;
end
$do$;

create or replace function public.sch_employee_my_schedule_page(
  p_service_date date,
  p_employee_id uuid,
  p_now timestamp with time zone default now()
) returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public
as $function$
declare
  v_base jsonb := '{}'::jsonb;
  v_all_items jsonb := '[]'::jsonb;
  v_current_items jsonb := '[]'::jsonb;
  v_employee_name text;
  v_employee_code text;
  v_shift_start time;
  v_shift_end time;
  v_roster_active boolean := false;
  v_local_time time;
  v_phase text;
  v_notice text;
  v_assignment_count integer := 0;
begin
  if p_service_date is null or p_employee_id is null then raise exception 'service_date and employee_id are required'; end if;
  v_base:=coalesce(public.sch_employee_my_schedule_phase_v1(p_service_date,p_employee_id,p_now),'{}'::jsonb);
  select e.display_name,e.employee_code into v_employee_name,v_employee_code
  from public.employees e where e.id=p_employee_id and e.active=true limit 1;
  if v_employee_name is null then raise exception 'Active employee not found'; end if;
  select r.shift_start,r.shift_end,r.active into v_shift_start,v_shift_end,v_roster_active
  from public.daily_work_roster r
  where r.service_date=p_service_date and r.employee_id=p_employee_id
  order by r.active desc,r.updated_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',dsa.id,'service_date',dsa.service_date,'segment_number',dsa.segment_number,
    'location_group_id',dsa.location_group_id,'group_code',lg.group_code,'group_name',lg.group_name,
    'location_group_code',lg.group_code,'location_group_name',lg.group_name,
    'coverage_start',dsa.coverage_start,'coverage_end',dsa.coverage_end,
    'start_time',dsa.coverage_start,'end_time',dsa.coverage_end,
    'coverage_purpose',dsa.coverage_purpose,'purpose',dsa.coverage_purpose,
    'source_type',dsa.source_type,'owner_type',dsa.owner_type,'status',dsa.status,
    'load_points',dsa.load_points,'notes',dsa.notes
  ) order by dsa.coverage_start,dsa.coverage_end,dsa.segment_number,lg.group_name),'[]'::jsonb),count(*)::integer
  into v_all_items,v_assignment_count
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id=dsa.location_group_id
  where dsa.service_date=p_service_date and dsa.assigned_employee_id=p_employee_id and dsa.status='ASSIGNED';
  v_current_items:=case when jsonb_typeof(v_base->'items')='array' then v_base->'items' else '[]'::jsonb end;
  v_local_time:=(p_now at time zone 'America/Chicago')::time;
  if coalesce(v_roster_active,false)=false then
    v_phase:='off_day'; v_notice:='You are not scheduled to work today.';
  elsif v_assignment_count=0 then
    v_phase:='schedule_missing'; v_notice:='Your shift exists, but no work assignments were generated. Contact an Ops Manager.';
  elsif v_shift_start is not null and v_local_time<v_shift_start then
    v_phase:='before_shift'; v_notice:=format('Your full schedule is below. Your shift begins at %s.',to_char(v_shift_start,'FMHH12:MI AM'));
  elsif v_shift_end is not null and v_local_time>=v_shift_end then
    v_phase:='after_shift'; v_notice:='Your shift is complete. Today''s full schedule remains below.';
  elsif jsonb_array_length(v_current_items)=0 then
    v_phase:='between_assignments'; v_notice:='You are between scheduled assignments. Your complete day remains below.';
  else
    v_phase:=coalesce(nullif(v_base->>'phase',''),'current_assignment');
    v_notice:=coalesce(nullif(v_base->>'notice',''),'Your complete day is shown below.');
  end if;
  return v_base||jsonb_build_object(
    'employee_id',p_employee_id,'employee_name',v_employee_name,'employee_code',v_employee_code,
    'service_date',p_service_date,'phase',v_phase,'notice',v_notice,
    'shift',jsonb_build_object('shift_start',v_shift_start,'shift_end',v_shift_end,'active',coalesce(v_roster_active,false)),
    'items',v_all_items,'all_items',v_all_items,'current_items',v_current_items,
    'assignment_count',v_assignment_count,'contract_version','my_schedule.v2'
  );
end
$function$;
revoke all on function public.sch_employee_my_schedule_page(date,uuid,timestamp with time zone) from public,anon,authenticated;
grant execute on function public.sch_employee_my_schedule_page(date,uuid,timestamp with time zone) to service_role,postgres;

create or replace function public.sch_ensure_daily_schedule(
  p_service_date date,
  p_reason text default 'automatic_readiness_check'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_roster_count integer := 0;
  v_assignment_count integer := 0;
  v_generated boolean := false;
  v_generator_result jsonb := '{}'::jsonb;
  v_status text;
begin
  if p_service_date is null then raise exception 'p_service_date is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-ready:'||p_service_date::text,0));
  select count(*)::int into v_roster_count from public.daily_work_roster where service_date=p_service_date and active=true;
  select count(*)::int into v_assignment_count from public.daily_schedule_assignments where service_date=p_service_date;
  if v_roster_count=0 or v_assignment_count=0 then
    v_generator_result:=public.sch_generate_daily_schedule(p_service_date,false);
    v_generated:=true;
    select count(*)::int into v_roster_count from public.daily_work_roster where service_date=p_service_date and active=true;
    select count(*)::int into v_assignment_count from public.daily_schedule_assignments where service_date=p_service_date;
  end if;
  v_status:=case when v_roster_count>0 and v_assignment_count>0 then 'completed' else 'failed' end;
  insert into public.schedule_automation_runs(automation_key,service_date,status,result_json,created_at,updated_at)
  values('daily_static_schedule_ready',p_service_date,v_status,
    jsonb_build_object('reason',coalesce(nullif(btrim(p_reason),''),'automatic_readiness_check'),
      'generated',v_generated,'roster_count',v_roster_count,'assignment_count',v_assignment_count,
      'generator_result',v_generator_result),now(),now())
  on conflict(automation_key,service_date) do update set status=excluded.status,result_json=excluded.result_json,updated_at=now();
  if v_status<>'completed' then raise exception 'Schedule for % is not ready after generation',p_service_date; end if;
  return jsonb_build_object('service_date',p_service_date,'generated',v_generated,
    'roster_count',v_roster_count,'assignment_count',v_assignment_count,'reason',p_reason,
    'generator_result',v_generator_result);
end
$function$;

create or replace function public.sch_ensure_current_day_schedule()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.sch_ensure_daily_schedule(public.sch_service_date(now()),'scheduled_current_day_readiness');
$function$;
revoke all on function public.sch_ensure_daily_schedule(date,text) from public,anon,authenticated;
revoke all on function public.sch_ensure_current_day_schedule() from public,anon,authenticated;
grant execute on function public.sch_ensure_daily_schedule(date,text) to service_role;
grant execute on function public.sch_ensure_current_day_schedule() to service_role,postgres;

do $do$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname='mz-current-day-static-schedule-ready'
  loop perform cron.unschedule(v_job.jobid); end loop;
  perform cron.schedule('mz-current-day-static-schedule-ready','*/10 * * * *','select public.sch_ensure_current_day_schedule();');
end
$do$;

create table if not exists public.device_location_proximity_status(
  device_id uuid not null references public.devices(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  session_uuid text not null default '',
  presented_identifier text null,
  result text not null,
  badge_color text not null,
  distance_m numeric null,
  allowed_radius_m numeric not null,
  accuracy_m numeric null,
  client_latitude numeric null,
  client_longitude numeric null,
  target_latitude numeric null,
  target_longitude numeric null,
  coordinate_source text null,
  evaluated_at timestamptz not null default now(),
  correlation_id text null,
  metadata_json jsonb not null default '{}'::jsonb,
  primary key(device_id,location_id,session_uuid)
);
alter table public.device_location_proximity_status enable row level security;
revoke all on table public.device_location_proximity_status from public,anon,authenticated;
grant select,insert,update,delete on table public.device_location_proximity_status to service_role;
create index if not exists idx_device_location_proximity_status_evaluated
  on public.device_location_proximity_status(evaluated_at desc);

alter table public.scan_events drop constraint if exists scan_events_event_type_check;
alter table public.scan_events add constraint scan_events_event_type_check check(
  event_type=any(array[
    'scan_received'::text,'scan_blocked'::text,'scan_start'::text,'scan_finish'::text,
    'scan_resume_pending'::text,'scan_invalid_location'::text,'scan_unauthorized_device'::text,
    'scan_error'::text,'work_position_check'::text
  ])
);

create or replace function public.evaluate_location_proximity(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_presented_device text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
  v_device_pk uuid;
  v_device_id text;
  v_location_id uuid;
  v_location_name text;
  v_session_id uuid;
  v_target_lat numeric;
  v_target_lon numeric;
  v_coordinate_source text;
  v_radius numeric := greatest(25,public.get_setting_int('gps_proximity_radius_m',175));
  v_max_accuracy numeric := greatest(25,public.get_setting_int('gps_max_accuracy_m',100));
  v_distance numeric;
  v_effective_radius numeric;
  v_result text;
  v_badge_color text;
  v_event_id uuid;
  v_session_key text := coalesce(nullif(btrim(p_session_uuid),''),'');
begin
  if v_presented_device is null then raise exception 'device identifier is required'; end if;
  if v_resolved_location_code is null then raise exception 'Active location not found for code: %',p_location_code; end if;
  if p_latitude is null or p_latitude<-90 or p_latitude>90 then raise exception 'latitude is invalid'; end if;
  if p_longitude is null or p_longitude<-180 or p_longitude>180 then raise exception 'longitude is invalid'; end if;
  if p_accuracy_m is not null and p_accuracy_m<0 then raise exception 'accuracy_m cannot be negative'; end if;

  select d.id,d.device_id into v_device_pk,v_device_id
  from public.devices d where d.active=true and upper(btrim(d.device_id))=upper(v_presented_device) limit 1;
  if v_device_pk is null then
    select d.id,d.device_id into v_device_pk,v_device_id
    from public.device_aliases da join public.devices d on d.id=da.canonical_device_id and d.active=true
    where da.active=true and upper(btrim(da.alias_identifier))=upper(v_presented_device) limit 1;
  end if;
  if v_device_pk is null then raise exception 'Active device not found: %',v_presented_device; end if;
  select l.id,l.location_name into v_location_id,v_location_name
  from public.locations l where l.active=true and l.location_code=v_resolved_location_code limit 1;
  if v_session_key<>'' then
    select s.id into v_session_id from public.sessions s
    where s.session_uuid=v_session_key and s.device_id=v_device_pk and s.location_id=v_location_id limit 1;
    if v_session_id is null then raise exception 'Session does not belong to this device and location'; end if;
  end if;
  select lp.latitude,lp.longitude,coalesce(nullif(lp.coordinate_source,''),'location_proximity_settings')
    into v_target_lat,v_target_lon,v_coordinate_source
  from public.location_proximity_settings lp
  where lp.location_id=v_location_id and lp.active=true and lp.latitude is not null and lp.longitude is not null
  order by lp.updated_at desc limit 1;
  if v_target_lat is null or v_target_lon is null then
    select gp.latitude,gp.longitude,coalesce(nullif(gp.coordinate_source,''),'location_group_proximity_settings')
      into v_target_lat,v_target_lon,v_coordinate_source
    from public.location_group_memberships gm
    join public.location_groups lg on lg.id=gm.location_group_id and lg.active=true
    join public.location_group_proximity_settings gp on gp.location_group_id=lg.id and gp.active=true
      and gp.latitude is not null and gp.longitude is not null
    where gm.location_id=v_location_id and gm.active=true
    order by gp.updated_at desc,lg.group_name limit 1;
  end if;
  if v_target_lat is null or v_target_lon is null then
    v_result:='not_configured';v_badge_color:='amber';v_effective_radius:=v_radius;
  else
    v_distance:=6371000*2*asin(sqrt(
      power(sin(radians((p_latitude-v_target_lat)::double precision)/2),2)
      +cos(radians(v_target_lat::double precision))*cos(radians(p_latitude::double precision))
      *power(sin(radians((p_longitude-v_target_lon)::double precision)/2),2)
    ));
    v_effective_radius:=v_radius+least(greatest(coalesce(p_accuracy_m,0),0),25);
    if p_accuracy_m is not null and p_accuracy_m>v_max_accuracy then v_result:='low_accuracy';v_badge_color:='amber';
    elsif v_distance<=v_effective_radius then v_result:='near';v_badge_color:='green';
    else v_result:='away';v_badge_color:='red'; end if;
  end if;
  insert into public.device_location_proximity_status(
    device_id,location_id,session_uuid,presented_identifier,result,badge_color,distance_m,
    allowed_radius_m,accuracy_m,client_latitude,client_longitude,target_latitude,target_longitude,
    coordinate_source,evaluated_at,correlation_id,metadata_json
  ) values(
    v_device_pk,v_location_id,v_session_key,v_presented_device,v_result,v_badge_color,v_distance,
    v_effective_radius,p_accuracy_m,p_latitude,p_longitude,v_target_lat,v_target_lon,v_coordinate_source,
    now(),nullif(btrim(coalesce(p_correlation_id,'')),''),jsonb_build_object('location_code',v_resolved_location_code,'location_name',v_location_name)
  ) on conflict(device_id,location_id,session_uuid) do update set
    presented_identifier=excluded.presented_identifier,result=excluded.result,badge_color=excluded.badge_color,
    distance_m=excluded.distance_m,allowed_radius_m=excluded.allowed_radius_m,accuracy_m=excluded.accuracy_m,
    client_latitude=excluded.client_latitude,client_longitude=excluded.client_longitude,
    target_latitude=excluded.target_latitude,target_longitude=excluded.target_longitude,
    coordinate_source=excluded.coordinate_source,evaluated_at=now(),correlation_id=excluded.correlation_id,
    metadata_json=excluded.metadata_json;
  if p_client_event_id is not null then
    select se.id into v_event_id from public.scan_events se where se.client_event_id=p_client_event_id limit 1;
  end if;
  if v_event_id is null then
    insert into public.scan_events(
      scanned_at,location_id,location_code,device_id,device_identifier,session_id,event_type,
      result,notes,payload_json,client_event_id
    ) values(
      now(),v_location_id,v_resolved_location_code,v_device_pk,v_device_id,v_session_id,'work_position_check',v_result,
      case when v_result='away' then format('Phone is %s meters from the authoritative location coordinate.',round(v_distance))
           when v_result='near' then 'Phone is within the authoritative location radius.'
           when v_result='low_accuracy' then 'GPS accuracy is too low for a green proximity result.'
           else 'No authoritative GPS coordinate is configured for this location.' end,
      jsonb_build_object('distance_m',v_distance,'allowed_radius_m',v_effective_radius,'accuracy_m',p_accuracy_m,
        'client_latitude',p_latitude,'client_longitude',p_longitude,'target_latitude',v_target_lat,
        'target_longitude',v_target_lon,'coordinate_source',v_coordinate_source,'badge_color',v_badge_color,
        'correlation_id',p_correlation_id),
      nullif(btrim(coalesce(p_client_event_id,'')),'')
    ) returning id into v_event_id;
  end if;
  return jsonb_build_object(
    'ok',true,'result',v_result,'badge_color',v_badge_color,'device_id',v_device_id,
    'presented_device_id',v_presented_device,'location_code',v_resolved_location_code,
    'location_name',v_location_name,'session_uuid',nullif(v_session_key,''),
    'distance_m',case when v_distance is null then null else round(v_distance,1) end,
    'allowed_radius_m',round(v_effective_radius,1),'accuracy_m',p_accuracy_m,
    'target_latitude',v_target_lat,'target_longitude',v_target_lon,
    'coordinate_source',v_coordinate_source,'evaluated_at',now(),'scan_event_id',v_event_id
  );
end
$function$;

create or replace function public.tool_evaluate_location_proximity(
  p_location_code text,p_device_identifier text,p_latitude numeric,p_longitude numeric,
  p_accuracy_m numeric default null,p_session_uuid text default null,
  p_client_event_id text default null,p_correlation_id text default null
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.evaluate_location_proximity(
    p_location_code,p_device_identifier,p_latitude,p_longitude,p_accuracy_m,
    p_session_uuid,p_client_event_id,p_correlation_id
  );
$function$;
revoke all on function public.evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.tool_evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) to service_role;
grant execute on function public.tool_evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) to service_role;
