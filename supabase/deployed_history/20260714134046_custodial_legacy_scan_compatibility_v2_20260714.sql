-- Deployed migration history snapshot: 20260714134046 custodial_legacy_scan_compatibility_v2_20260714

create or replace function public.tool_complete_session(
  p_session_uuid text,
  p_response_json jsonb default '{}'::jsonb,
  p_submitted_by_employee_name text default null,
  p_device_id text default null,
  p_client_completion_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_resolved_session_uuid text;
  v_row record;
begin
  select s.session_uuid into v_resolved_session_uuid
  from public.sessions s
  where s.session_uuid = p_session_uuid or s.client_session_id = p_session_uuid
  order by case when s.session_uuid = p_session_uuid then 0 else 1 end
  limit 1;
  if v_resolved_session_uuid is null then
    raise exception 'Session not found for server or client identifier: %',p_session_uuid;
  end if;
  if exists(
    select 1 from public.sessions s
    join public.completion_responses cr on cr.session_id=s.id
    where s.session_uuid=v_resolved_session_uuid and s.status='closed'
  ) then
    return (
      select jsonb_build_object(
        'session_uuid',s.session_uuid,'client_session_id',s.client_session_id,
        'location_name',l.location_name,'employee_name',e.display_name,
        'status',s.status,'submitted_at',cr.submitted_at,'replayed',true
      )
      from public.sessions s join public.locations l on l.id=s.location_id
      join public.employees e on e.id=s.employee_id
      join public.completion_responses cr on cr.session_id=s.id
      where s.session_uuid=v_resolved_session_uuid limit 1
    );
  end if;
  select * into v_row from public.complete_session(
    v_resolved_session_uuid,p_response_json,p_submitted_by_employee_name,p_device_id,p_client_completion_id
  ) limit 1;
  return jsonb_build_object(
    'session_uuid',v_row.session_uuid,'location_name',v_row.location_name,
    'employee_name',v_row.employee_name,'status',v_row.status,
    'submitted_at',v_row.submitted_at,'replayed',false
  );
end;
$function$;
create or replace function public.tool_finish_session(p_location_code text,p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_resolved_code text:=public.resolve_scan_location_code(p_location_code);
  v_device_pk uuid;
  v_existing record;
  v_finished record;
begin
  select d.id into v_device_pk from public.devices d where d.device_id=p_device_id and d.active=true limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %',p_device_id; end if;
  select s.session_uuid,l.location_name,e.display_name as employee_name,d.device_id,s.status,s.started_at,s.ended_at,s.duration_minutes,s.duration_display,l.location_type,l.form_type
  into v_existing
  from public.sessions s join public.locations l on l.id=s.location_id
  join public.employees e on e.id=s.employee_id join public.devices d on d.id=s.device_id
  where s.device_id=v_device_pk and l.location_code=v_resolved_code and s.status in ('active','pending_submit','closed')
  order by s.started_at desc limit 1;
  if v_existing.session_uuid is null then raise exception 'No session found for location % and device %',coalesce(v_resolved_code,p_location_code),p_device_id; end if;
  if v_existing.status in ('pending_submit','closed') then
    return jsonb_build_object('session_uuid',v_existing.session_uuid,'location_name',v_existing.location_name,'employee_name',v_existing.employee_name,'device_id',v_existing.device_id,'status',v_existing.status,'started_at',v_existing.started_at,'ended_at',v_existing.ended_at,'duration_minutes',v_existing.duration_minutes,'duration_display',v_existing.duration_display,'location_type',v_existing.location_type,'form_type',v_existing.form_type,'replayed',true);
  end if;
  select * into v_finished from public.finish_session(p_location_code,p_device_id) limit 1;
  return jsonb_build_object('session_uuid',v_finished.session_uuid,'location_name',v_finished.location_name,'employee_name',v_finished.employee_name,'device_id',v_finished.device_id,'status',v_finished.status,'started_at',v_finished.started_at,'ended_at',v_finished.ended_at,'duration_minutes',v_finished.duration_minutes,'duration_display',v_finished.duration_display,'location_type',v_existing.location_type,'form_type',v_existing.form_type,'replayed',false);
end;
$function$;
alter function public.tool_complete_session(text,jsonb,text,text,text) set search_path=pg_catalog,public;
alter function public.tool_finish_session(text,text) set search_path=pg_catalog,public;
revoke all on function public.tool_complete_session(text,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.tool_finish_session(text,text) from public,anon,authenticated;
grant execute on function public.tool_complete_session(text,jsonb,text,text,text) to service_role;
grant execute on function public.tool_finish_session(text,text) to service_role;
