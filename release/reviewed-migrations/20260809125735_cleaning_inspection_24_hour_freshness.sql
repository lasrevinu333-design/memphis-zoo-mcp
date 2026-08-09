begin;

create or replace function public.cleaning_inspections_set_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_session record;
  v_completion_at timestamptz;
  v_inspector_name text;
begin
  if tg_op='INSERT' then
    new.inspected_at:=statement_timestamp();
    new.created_at:=new.inspected_at;
  else
    if new.operation_id is distinct from old.operation_id then
      raise exception using errcode='23514',message='Inspection operation_id is immutable';
    end if;
    if new.session_id is distinct from old.session_id then
      raise exception using errcode='23514',message='Inspection session_id is immutable';
    end if;
    if new.inspected_at is distinct from old.inspected_at or new.created_at is distinct from old.created_at then
      raise exception using errcode='23514',message='Inspection authoritative timestamps are immutable';
    end if;
  end if;

  select
    s.location_id,s.employee_id,s.started_at,s.ended_at,s.duration_minutes,s.status,
    (select max(cr.submitted_at) from public.completion_responses cr where cr.session_id=s.id) completion_submitted_at,
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
  v_completion_at:=coalesce(v_session.ended_at,v_session.completion_submitted_at);
  if v_completion_at is null then
    raise exception using errcode='23514',message='Finished cleaning session has no completion timestamp';
  end if;
  if new.inspected_at<v_completion_at then
    raise exception using errcode='23514',message='Inspection time cannot be before the cleaning session finished';
  end if;
  if new.inspected_at>v_completion_at+interval '24 hours' then
    raise exception using errcode='23514',message='Inspection cannot be recorded more than 24 hours after cleaning session completion';
  end if;
  if new.inspected_at>clock_timestamp()+interval '5 minutes' then
    raise exception using errcode='23514',message='Inspection time cannot be in the future';
  end if;

  new.location_id:=v_session.location_id;
  new.employee_id:=v_session.employee_id;
  new.employee_name_snapshot:=v_session.employee_name;
  new.location_code_snapshot:=v_session.location_code;
  new.location_name_snapshot:=v_session.location_name;
  new.session_started_at:=v_session.started_at;
  new.session_ended_at:=v_completion_at;
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

revoke all on function public.cleaning_inspections_set_snapshot() from public,anon,authenticated;
grant execute on function public.cleaning_inspections_set_snapshot() to postgres,service_role;

comment on function public.cleaning_inspections_set_snapshot() is
  'Assigns immutable server timestamps, binds inspections to completed session facts, and rejects evidence recorded more than 24 elapsed hours after completion.';

commit;
