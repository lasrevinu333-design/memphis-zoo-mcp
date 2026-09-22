begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
begin
  if to_regclass('public.operational_notification_jobs') is null
     or to_regclass('public.ops_manager_notification_queue') is null
     or to_regclass('public.ops_manager_push_devices') is null
     or to_regprocedure('public.finish_operational_notification_job_terminal(uuid,uuid,text)') is null then
    raise exception 'lunch delivery failure prerequisites are unavailable';
  end if;
  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null
     or to_regprocedure('public.custodial_release_authority_current_constraint_definition(text)') is null then
    raise exception 'release recovery inventory helpers are unavailable';
  end if;
end
$preflight$;

alter table public.ops_manager_notification_queue
  drop constraint if exists ops_manager_notification_queue_type;
alter table public.ops_manager_notification_queue
  add constraint ops_manager_notification_queue_type
  check (notification_type in ('message','event_digest','location_digest','lunch_delivery_failure','test'));

create or replace function public.ops_manager_enqueue_lunch_delivery_failure(
  p_employee_job_id uuid,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_job public.operational_notification_jobs%rowtype;
  v_inserted integer := 0;
  v_data jsonb;
  v_event text;
  v_device text;
begin
  if p_employee_job_id is null then
    return jsonb_build_object('ok',false,'enqueued',0,'reason','employee_job_id_required');
  end if;

  select * into v_job
  from public.operational_notification_jobs
  where job_id=p_employee_job_id;

  if v_job.job_id is null then
    return jsonb_build_object('ok',false,'enqueued',0,'reason','employee_job_missing');
  end if;

  v_data:=coalesce(v_job.payload_json->'data_json','{}'::jsonb);
  if v_job.job_type is distinct from 'employee_native_push'
     or v_job.status is distinct from 'dead'
     or v_data->>'kind' is distinct from 'employee_lunch_coverage'
     or v_data->>'notification_type' is distinct from 'lunch_coverage' then
    return jsonb_build_object('ok',true,'enqueued',0,'ignored','not_terminal_lunch_coverage');
  end if;

  v_event:=case when v_data->>'event' in ('start','end') then v_data->>'event' else 'coverage' end;
  v_device:=coalesce(nullif(btrim(v_job.payload_json->>'device_identifier'),''),'assigned custodial phone');

  insert into public.ops_manager_notification_queue(
    job_key,credential_id,manager_id,notification_type,source_id,title,body,data_json,available_at
  )
  select
    'manager-lunch-delivery-failure:'||v_job.job_id::text||':'||pd.credential_id::text,
    pd.credential_id,
    pd.manager_id,
    'lunch_delivery_failure',
    v_job.job_id,
    'Lunch coverage notification failed',
    left('A lunch coverage '||v_event||' notification could not be delivered to '||v_device
      ||'. Review coverage and contact the custodian if needed.',1000),
    jsonb_build_object(
      'kind','lunch_delivery_failure',
      'route','schedule.html',
      'employee_job_id',v_job.job_id::text,
      'notification_key',coalesce(v_data->>'notification_key',''),
      'lunch_event',v_event,
      'service_date',coalesce(v_data->>'service_date',''),
      'loan_id',coalesce(v_data->>'loan_id',''),
      'device_identifier',v_device,
      'employee_id',coalesce(v_job.payload_json->>'employee_id',''),
      'terminal_delivery_failure',true
    ),
    p_now
  from public.ops_manager_push_devices pd
  join public.ops_manager_trusted_devices td
    on td.credential_id=pd.credential_id and td.manager_id=pd.manager_id
  join public.ops_manager_managers manager on manager.manager_id=pd.manager_id
  where pd.enabled=true and pd.revoked_at is null
    and td.revoked_at is null and td.expires_at>p_now
    and manager.active=true and manager.revoked_at is null
    and manager.is_system_principal=false
  on conflict(job_key) do nothing;
  get diagnostics v_inserted=row_count;

  return jsonb_build_object('ok',true,'enqueued',v_inserted,'employee_job_id',v_job.job_id);
end
$function$;

revoke all on function public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamptz)
from public,anon,authenticated;
grant execute on function public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamptz)
to postgres,service_role;

create or replace function public.finish_operational_notification_job_terminal(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
) returns public.operational_notification_jobs
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_row public.operational_notification_jobs%rowtype;
begin
  select * into v_row
  from public.operational_notification_jobs
  where job_id=p_job_id
  for update;
  if v_row.job_id is null
     or v_row.lease_token is distinct from p_lease_token
     or v_row.status not in ('leased','dead') then
    raise exception 'notification job lease is no longer authoritative';
  end if;

  update public.operational_notification_jobs
  set status='dead',completed_at=coalesce(completed_at,now()),
      leased_at=null,leased_until=null,lease_token=null,worker_id=null,
      last_error=left(coalesce(p_error,'notification recipient is no longer authorized'),2000),
      updated_at=now()
  where job_id=p_job_id
  returning * into v_row;

  perform public.ops_manager_enqueue_lunch_delivery_failure(v_row.job_id,now());
  return v_row;
end
$function$;

revoke all on function public.finish_operational_notification_job_terminal(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.finish_operational_notification_job_terminal(uuid,uuid,text)
to postgres,service_role;

comment on function public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamptz) is
  'Idempotently alerts active named manager push devices when a terminal employee lunch-coverage push cannot be delivered.';
comment on function public.finish_operational_notification_job_terminal(uuid,uuid,text) is
  'Marks a leased employee notification terminally dead and atomically enqueues lunch-delivery manager alerts when applicable.';

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $bind_release_recovery$
declare
  identity text;
  canonical text;
  definition text;
  grant_definition text;
  next_order integer;
  changed integer;
begin
  foreach identity in array array[
    'public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)',
    'public.finish_operational_notification_job_terminal(uuid,uuid,text)'
  ] loop
    canonical:=to_regprocedure(identity)::text;
    definition:=pg_get_functiondef(to_regprocedure(identity));
    if canonical is null or definition is null then
      raise exception 'lunch delivery recovery function % is missing',identity;
    end if;

    update public.custodial_release_authority_restore_inventory
    set definition_sql=definition,
        definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='function' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed=0 then
      select coalesce(max(restore_order),100000)+1 into next_order
      from public.custodial_release_authority_restore_inventory
      where object_kind='function' and restore_order<200000;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values(next_order,'function',canonical,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
    elsif changed<>1 then
      raise exception 'lunch delivery recovery function identity % is duplicated',canonical;
    end if;

    grant_definition:=public.custodial_release_authority_current_grant_definition(canonical);
    if grant_definition is null then
      raise exception 'lunch delivery recovery grant for % is unavailable',canonical;
    end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=grant_definition,
        definition_sha256=encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='grant' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed=0 then
      select coalesce(max(restore_order),900000)+1 into next_order
      from public.custodial_release_authority_restore_inventory;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values(next_order,'grant',canonical,grant_definition,
        encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'));
    elsif changed<>1 then
      raise exception 'lunch delivery recovery grant identity % is duplicated',canonical;
    end if;
  end loop;

  identity:='public.ops_manager_notification_queue:ops_manager_notification_queue_type';
  definition:=public.custodial_release_authority_current_constraint_definition(identity);
  if definition is null then
    raise exception 'manager notification type constraint is unavailable';
  end if;
  update public.custodial_release_authority_restore_inventory
  set definition_sql=definition,
      definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
      captured_at=statement_timestamp()
  where object_kind='constraint' and object_identity=identity;
  get diagnostics changed=row_count;
  if changed=0 then
    select coalesce(max(restore_order),500000)+1 into next_order
    from public.custodial_release_authority_restore_inventory
    where object_kind='constraint' and restore_order<600000;
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values(next_order,'constraint',identity,definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
  elsif changed<>1 then
    raise exception 'manager notification type constraint inventory identity is duplicated';
  end if;

  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end
$bind_release_recovery$;

do $postflight$
declare
  v_identity text;
begin
  if not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid='public.ops_manager_notification_queue'::regclass
      and constraint_row.conname='ops_manager_notification_queue_type'
      and pg_get_constraintdef(constraint_row.oid,true) like '%lunch_delivery_failure%'
  ) then
    raise exception 'lunch delivery failure manager notification type was not installed';
  end if;

  foreach v_identity in array array[
    'ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)',
    'finish_operational_notification_job_terminal(uuid,uuid,text)'
  ] loop
    if (select count(*) from public.custodial_release_authority_restore_inventory
        where object_kind='function' and object_identity=v_identity)<>1
       or (select count(*) from public.custodial_release_authority_restore_inventory
        where object_kind='grant' and object_identity=v_identity)<>1 then
      raise exception 'lunch delivery function % is not bound to release recovery',v_identity;
    end if;
  end loop;

  if (select count(*) from public.custodial_release_authority_restore_inventory
      where object_kind='constraint'
        and object_identity='public.ops_manager_notification_queue:ops_manager_notification_queue_type')<>1 then
    raise exception 'manager notification type constraint is not bound to release recovery';
  end if;
end
$postflight$;

commit;
