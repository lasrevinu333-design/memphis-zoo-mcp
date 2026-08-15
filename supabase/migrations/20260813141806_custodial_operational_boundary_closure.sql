begin;

-- These functions predate the canonical 04:00 Central service date. Rewrite
-- only the exact reviewed declarations so an unexpected deployed definition
-- aborts the migration instead of receiving a broad textual patch.
do $service_date_closure$
declare
  v_identity text;
  v_definition text;
  v_rewritten text;
  v_old text;
  v_new text;
begin
  foreach v_identity in array array[
    'public.mz_enqueue_employee_location_pushes(timestamp with time zone)',
    'public.ops_manager_enqueue_scheduled_notifications(timestamp with time zone)'
  ] loop
    if to_regprocedure(v_identity) is null then
      raise exception 'Missing required notification function %',v_identity;
    end if;
    v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
    if v_identity like 'public.mz_enqueue_employee_location_pushes%' then
      v_old:='v_service_date date:=(p_now at time zone ''America/Chicago'')::date;';
      v_new:='v_service_date date:=public.sch_service_date(p_now);';
    else
      v_old:='v_local_date date:=v_local_now::date; v_local_time time:=v_local_now::time; v_dow smallint:=extract(dow from v_local_now)::smallint;';
      v_new:='v_local_date date:=public.sch_service_date(p_now); v_local_time time:=v_local_now::time; v_dow smallint:=extract(dow from v_local_date)::smallint;';
    end if;
    if position(v_new in v_definition)>0 and position(v_old in v_definition)=0 then
      continue;
    end if;
    v_rewritten:=replace(v_definition,v_old,v_new);
    if v_rewritten=v_definition or position(v_new in v_rewritten)=0 then
      raise exception 'Notification function % has an unreviewed service-date declaration',v_identity;
    end if;
    execute v_rewritten;
  end loop;
end
$service_date_closure$;

-- Exact activation replay must expose the same frozen actor identity as the
-- first response. The phone validates these values before persisting a proof.
do $activation_replay_closure$
declare
  v_identity text:='public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)';
  v_definition text;
  v_rewritten text;
  v_old text:='''submission_proof'',v_proof.issued_submission_proof,''expires_at'',v_existing.expires_at';
  v_new text:='''employee_id'',v_existing.employee_id,''assignment_epoch'',v_existing.assignment_epoch,''submission_proof'',v_proof.issued_submission_proof,''expires_at'',v_existing.expires_at';
begin
  if to_regprocedure(v_identity) is null then
    raise exception 'Missing required offline activation function %',v_identity;
  end if;
  v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
  if position(v_new in v_definition)=0 then
    v_rewritten:=replace(v_definition,v_old,v_new);
    if v_rewritten=v_definition or position(v_new in v_rewritten)=0 then
      raise exception 'Offline activation replay has an unreviewed response shape';
    end if;
    execute v_rewritten;
  end if;
end
$activation_replay_closure$;

-- Forward restoration must recover this corrected canonical definition, not
-- the earlier replay response that omitted actor identity.
update public.custodial_release_authority_restore_definitions
set function_definition=pg_get_functiondef('public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'::regprocedure),
    definition_sha256=encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'::regprocedure),'UTF8'),'sha256'),'hex'),
    captured_at=statement_timestamp()
where function_identity='public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)';

do $operational_boundary_postconditions$
declare
  v_employee text:=pg_get_functiondef('public.mz_enqueue_employee_location_pushes(timestamp with time zone)'::regprocedure);
  v_manager text:=pg_get_functiondef('public.ops_manager_enqueue_scheduled_notifications(timestamp with time zone)'::regprocedure);
  v_start text:=pg_get_functiondef('public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'::regprocedure);
begin
  if position('v_service_date date:=public.sch_service_date(p_now);' in v_employee)=0
     or position('v_local_date date:=public.sch_service_date(p_now);' in v_manager)=0
     or position('v_dow smallint:=extract(dow from v_local_date)::smallint;' in v_manager)=0 then
    raise exception 'Canonical notification service-date closure did not persist';
  end if;
  if position('''employee_id'',v_existing.employee_id,''assignment_epoch'',v_existing.assignment_epoch,''submission_proof'',v_proof.issued_submission_proof' in v_start)=0 then
    raise exception 'Exact activation replay identity closure did not persist';
  end if;
  if not exists(
    select 1 from public.custodial_release_authority_restore_definitions d
    where d.function_identity='public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'
      and d.definition_sha256=encode(extensions.digest(convert_to(v_start,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'Activation replay rollback definition was not refreshed';
  end if;
end
$operational_boundary_postconditions$;

commit;
