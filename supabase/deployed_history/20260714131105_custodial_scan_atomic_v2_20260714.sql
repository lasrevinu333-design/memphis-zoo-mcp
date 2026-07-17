-- Deployed migration history snapshot: 20260714131105 custodial_scan_atomic_v2_20260714

create table if not exists public.device_aliases (
  alias_identifier text primary key,
  canonical_device_id uuid not null references public.devices(id) on delete cascade,
  active boolean not null default true,
  source text not null default 'migration',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.device_aliases(alias_identifier, canonical_device_id, source)
select alias.device_id, canonical.id, 'assigned_employee_match'
from public.devices alias
join public.devices canonical
  on canonical.assigned_employee_id = alias.assigned_employee_id
 and canonical.active = true
 and canonical.device_id ~* '^KIOSK_(0[1-9]|10)$'
where alias.active = true
  and alias.assigned_employee_id is not null
  and alias.id <> canonical.id
  and alias.device_id !~* '^KIOSK_(0[1-9]|10)$'
on conflict (alias_identifier) do update
set canonical_device_id = excluded.canonical_device_id,
    active = true,
    source = excluded.source,
    updated_at = now();
create table if not exists public.device_sync_status (
  device_id uuid primary key references public.devices(id) on delete cascade,
  presented_identifier text null,
  queue_count integer not null default 0 check (queue_count >= 0),
  oldest_item_at timestamptz null,
  retry_count integer not null default 0 check (retry_count >= 0),
  last_server_ack_at timestamptz null,
  frontend_version text null,
  last_error text null,
  correlation_id text null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_device_sync_status_updated_at on public.device_sync_status(updated_at desc);
create index if not exists idx_device_sync_status_attention on public.device_sync_status(queue_count, oldest_item_at) where queue_count > 0;
drop index if exists public.uq_sessions_active_employee;
drop index if exists public.uq_sessions_active_location;
create unique index if not exists uq_sessions_open_employee on public.sessions(employee_id) where status in ('active','pending_submit');
create unique index if not exists uq_sessions_open_location on public.sessions(location_id) where status in ('active','pending_submit');
create unique index if not exists uq_sessions_open_device on public.sessions(device_id) where status in ('active','pending_submit');
create or replace function public.tool_commit_cleaning_workflow(
  p_client_session_id text,
  p_client_completion_id text,
  p_device_id text,
  p_location_code text,
  p_client_started_at timestamptz,
  p_client_ended_at timestamptz,
  p_response_json jsonb default '{}'::jsonb,
  p_scan_evidence jsonb default '[]'::jsonb,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_device public.devices%rowtype;
  v_employee public.employees%rowtype;
  v_location public.locations%rowtype;
  v_session public.sessions%rowtype;
  v_completion public.completion_responses%rowtype;
  v_now timestamptz := now();
  v_started timestamptz;
  v_ended timestamptz;
  v_duration integer;
  v_replayed boolean := false;
  v_item jsonb;
  v_event_type text;
  v_client_event_id text;
  v_scan_array jsonb;
begin
  if nullif(btrim(coalesce(p_client_session_id,'')),'') is null then raise exception 'client_session_id is required.'; end if;
  if nullif(btrim(coalesce(p_client_completion_id,'')),'') is null then raise exception 'client_completion_id is required.'; end if;
  if nullif(btrim(coalesce(p_device_id,'')),'') is null then raise exception 'device_id is required.'; end if;
  if nullif(btrim(coalesce(p_location_code,'')),'') is null then raise exception 'location_code is required.'; end if;
  select d.* into v_device
  from public.device_aliases da
  join public.devices d on d.id=da.canonical_device_id and d.active=true
  where da.alias_identifier=btrim(p_device_id) and da.active=true
  limit 1;
  if not found then
    select d.* into v_device from public.devices d where d.device_id=btrim(p_device_id) and d.active=true limit 1;
  end if;
  if v_device.id is null then raise exception 'Active device not found: %',p_device_id; end if;
  if v_device.assigned_employee_id is null then raise exception 'Device has no assigned employee: %',v_device.device_id; end if;
  select e.* into v_employee from public.employees e where e.id=v_device.assigned_employee_id and e.active=true;
  if v_employee.id is null then raise exception 'Assigned employee is inactive or missing for device: %',v_device.device_id; end if;
  select l.* into v_location from public.locations l
  where l.location_code=public.resolve_scan_location_code(p_location_code) and l.active=true limit 1;
  if v_location.id is null then raise exception 'Active location not found for code: %',p_location_code; end if;
  perform pg_advisory_xact_lock(hashtextextended('scan-device:'||v_device.id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('scan-employee:'||v_employee.id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('scan-location:'||v_location.id::text,0));
  perform public.expire_stale_open_sessions(v_now);
  select * into v_session from public.sessions where client_session_id=btrim(p_client_session_id) limit 1 for update;
  if v_session.id is not null then
    if v_session.device_id<>v_device.id or v_session.employee_id<>v_employee.id or v_session.location_id<>v_location.id then
      raise exception 'client_session_id is already bound to another device, employee, or location.';
    end if;
    if v_session.status='cancelled' then raise exception 'This workflow was cancelled and cannot be completed.'; end if;
    select * into v_completion from public.completion_responses where session_id=v_session.id limit 1;
    if v_session.status='closed' and v_completion.id is not null then
      return jsonb_build_object('ok',true,'replayed',true,'session_uuid',v_session.session_uuid,'client_session_id',v_session.client_session_id,'client_completion_id',v_completion.client_completion_id,'status','closed','device_id',v_device.device_id,'employee_name',v_employee.display_name,'location_code',v_location.location_code,'location_name',v_location.location_name,'submitted_at',v_completion.submitted_at,'correlation_id',p_correlation_id);
    end if;
  else
    if exists(select 1 from public.sessions s where s.device_id=v_device.id and s.status in ('active','pending_submit')) then raise exception 'Device already has an open session: %',v_device.device_id; end if;
    if exists(select 1 from public.sessions s where s.employee_id=v_employee.id and s.status in ('active','pending_submit')) then raise exception 'Employee already has an open session: %',v_employee.display_name; end if;
    if exists(select 1 from public.sessions s where s.location_id=v_location.id and s.status in ('active','pending_submit')) then raise exception 'Location already has an open session: %',v_location.location_code; end if;
    v_started := coalesce(p_client_started_at,v_now);
    if v_started > v_now + interval '5 minutes' then v_started:=v_now; end if;
    if v_started < v_now - interval '7 days' then raise exception 'client_started_at is too old.'; end if;
    insert into public.sessions(session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at)
    values(gen_random_uuid()::text,btrim(p_client_session_id),v_location.id,v_employee.id,v_device.id,'active',v_started)
    returning * into v_session;
    insert into public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
    values(v_session.id,'session_started','device',v_device.device_id,jsonb_build_object('client_session_id',p_client_session_id,'correlation_id',p_correlation_id,'location_code',v_location.location_code,'device_id',v_device.device_id,'employee_name',v_employee.display_name,'source','atomic_workflow'));
  end if;
  v_started := v_session.started_at;
  v_ended := coalesce(p_client_ended_at,v_now);
  if v_ended < v_started then raise exception 'client_ended_at cannot precede client_started_at.'; end if;
  if v_ended > v_now + interval '5 minutes' then v_ended:=v_now; end if;
  v_duration := greatest(0,round(extract(epoch from (v_ended-v_started))/60.0));
  if v_session.status='active' then
    update public.sessions set status='pending_submit',ended_at=v_ended,duration_minutes=v_duration,duration_display=v_duration::text||' min',updated_at=v_now where id=v_session.id returning * into v_session;
    insert into public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
    values(v_session.id,'session_finished','device',v_device.device_id,jsonb_build_object('client_session_id',p_client_session_id,'correlation_id',p_correlation_id,'duration_minutes',v_duration,'source','atomic_workflow'));
  end if;
  select * into v_completion from public.completion_responses where client_completion_id=btrim(p_client_completion_id) limit 1;
  if v_completion.id is not null and v_completion.session_id<>v_session.id then raise exception 'client_completion_id is already bound to another session.'; end if;
  insert into public.completion_responses(session_id,location_id,submitted_by_employee_id,device_id,response_json,submitted_at,client_completion_id)
  values(v_session.id,v_location.id,v_employee.id,v_device.id,coalesce(p_response_json,'{}'::jsonb),v_now,btrim(p_client_completion_id))
  on conflict (session_id) do update set response_json=excluded.response_json,submitted_at=excluded.submitted_at,submitted_by_employee_id=excluded.submitted_by_employee_id,device_id=excluded.device_id,client_completion_id=coalesce(public.completion_responses.client_completion_id,excluded.client_completion_id)
  returning * into v_completion;
  perform public.create_maintenance_tickets_from_response(v_completion.id,v_session.id,v_location.id,v_employee.id,v_device.id,v_now,coalesce(p_response_json,'{}'::jsonb));
  update public.sessions set status='closed',completion_source='kiosk_form',ended_at=v_ended,duration_minutes=v_duration,duration_display=v_duration::text||' min',updated_at=v_now
  where id=v_session.id and status='pending_submit' returning * into v_session;
  if not exists(select 1 from public.session_events se where se.session_id=v_session.id and se.event_type='session_completed') then
    insert into public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
    values(v_session.id,'session_completed','form',v_employee.display_name,jsonb_build_object('client_session_id',p_client_session_id,'client_completion_id',p_client_completion_id,'correlation_id',p_correlation_id,'response',coalesce(p_response_json,'{}'::jsonb),'source','atomic_workflow'));
  else
    v_replayed:=true;
  end if;
  v_scan_array := case when jsonb_typeof(p_scan_evidence)='array' then p_scan_evidence else '[]'::jsonb end;
  for v_item in select value from jsonb_array_elements(v_scan_array)
  loop
    v_event_type := coalesce(nullif(v_item->>'event_type',''),'scan_received');
    if v_event_type not in ('scan_received','scan_blocked','scan_start','scan_finish','scan_resume_pending','scan_invalid_location','scan_unauthorized_device','scan_error') then v_event_type:='scan_received'; end if;
    v_client_event_id:=nullif(btrim(coalesce(v_item->>'client_event_id','')),'');
    insert into public.scan_events(scanned_at,location_id,location_code,device_id,device_identifier,session_id,event_type,result,notes,payload_json,client_event_id)
    values(coalesce((v_item->>'scanned_at')::timestamptz,v_now),v_location.id,v_location.location_code,v_device.id,v_device.device_id,v_session.id,v_event_type,v_item->>'result',v_item->>'notes',coalesce(v_item->'payload_json',v_item,'{}'::jsonb),v_client_event_id)
    on conflict do nothing;
  end loop;
  insert into public.system_logs(level,source,message,session_id,location_id,device_id)
  values('INFO','tool_commit_cleaning_workflow','Atomic cleaning workflow committed',v_session.id,v_location.id,v_device.id);
  return jsonb_build_object('ok',true,'replayed',v_replayed,'session_uuid',v_session.session_uuid,'client_session_id',v_session.client_session_id,'client_completion_id',v_completion.client_completion_id,'status',v_session.status,'device_id',v_device.device_id,'employee_name',v_employee.display_name,'location_code',v_location.location_code,'location_name',v_location.location_name,'started_at',v_session.started_at,'ended_at',v_session.ended_at,'duration_minutes',v_session.duration_minutes,'submitted_at',v_completion.submitted_at,'correlation_id',p_correlation_id);
end;
$function$;
create or replace function public.tool_report_device_sync_status(
  p_device_identifier text,p_queue_count integer,p_oldest_item_at timestamptz,p_retry_count integer,p_last_server_ack_at timestamptz,p_frontend_version text,p_last_error text,p_correlation_id text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_device public.devices%rowtype;
begin
  select d.* into v_device from public.device_aliases da join public.devices d on d.id=da.canonical_device_id and d.active=true where da.alias_identifier=btrim(p_device_identifier) and da.active=true limit 1;
  if not found then select d.* into v_device from public.devices d where d.device_id=btrim(p_device_identifier) and d.active=true limit 1; end if;
  if v_device.id is null then raise exception 'Active device not found.'; end if;
  insert into public.device_sync_status(device_id,presented_identifier,queue_count,oldest_item_at,retry_count,last_server_ack_at,frontend_version,last_error,correlation_id,updated_at)
  values(v_device.id,btrim(p_device_identifier),greatest(0,coalesce(p_queue_count,0)),p_oldest_item_at,greatest(0,coalesce(p_retry_count,0)),p_last_server_ack_at,nullif(btrim(coalesce(p_frontend_version,'')),''),left(nullif(coalesce(p_last_error,''),''),1000),nullif(btrim(coalesce(p_correlation_id,'')),''),now())
  on conflict(device_id) do update set presented_identifier=excluded.presented_identifier,queue_count=excluded.queue_count,oldest_item_at=excluded.oldest_item_at,retry_count=excluded.retry_count,last_server_ack_at=excluded.last_server_ack_at,frontend_version=excluded.frontend_version,last_error=excluded.last_error,correlation_id=excluded.correlation_id,updated_at=now();
  return jsonb_build_object('ok',true,'device_id',v_device.device_id,'updated_at',now());
end;
$function$;
revoke all on function public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.tool_report_device_sync_status(text,integer,timestamptz,integer,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text) to service_role;
grant execute on function public.tool_report_device_sync_status(text,integer,timestamptz,integer,timestamptz,text,text,text) to service_role;
revoke all on table public.device_aliases,public.device_sync_status from anon,authenticated;
grant select,insert,update,delete on public.device_aliases,public.device_sync_status to service_role;
