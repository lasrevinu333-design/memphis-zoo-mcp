begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- The session row remains the immutable record of what the phone originally
-- reported. Directory rows can change later, so retain the at-event labels and
-- assignment epoch beside the canonical UUIDs.
alter table public.sessions
  add column if not exists employee_name_snapshot text,
  add column if not exists location_code_snapshot text,
  add column if not exists location_name_snapshot text,
  add column if not exists device_identifier_snapshot text,
  add column if not exists device_name_snapshot text,
  add column if not exists assignment_epoch_snapshot bigint,
  add column if not exists identity_snapshot_provenance text;

update public.sessions s
set employee_name_snapshot = coalesce(s.employee_name_snapshot, e.display_name),
    location_code_snapshot = coalesce(s.location_code_snapshot, l.location_code),
    location_name_snapshot = coalesce(s.location_name_snapshot, l.location_name),
    device_identifier_snapshot = coalesce(s.device_identifier_snapshot, d.device_id),
    device_name_snapshot = coalesce(s.device_name_snapshot, d.device_name),
    assignment_epoch_snapshot = coalesce(s.assignment_epoch_snapshot, d.assignment_epoch),
    identity_snapshot_provenance = coalesce(s.identity_snapshot_provenance, 'legacy_directory_backfill')
from public.employees e, public.locations l, public.devices d
where e.id = s.employee_id
  and l.id = s.location_id
  and d.id = s.device_id
  and (
    s.employee_name_snapshot is null
    or s.location_code_snapshot is null
    or s.location_name_snapshot is null
    or s.device_identifier_snapshot is null
    or s.device_name_snapshot is null
    or s.assignment_epoch_snapshot is null
    or s.identity_snapshot_provenance is null
  );

alter table public.sessions
  alter column employee_name_snapshot set not null,
  alter column location_code_snapshot set not null,
  alter column location_name_snapshot set not null,
  alter column device_identifier_snapshot set not null,
  alter column device_name_snapshot set not null,
  alter column assignment_epoch_snapshot set not null,
  alter column identity_snapshot_provenance set not null;

alter table public.sessions
  drop constraint if exists sessions_assignment_epoch_snapshot_positive,
  add constraint sessions_assignment_epoch_snapshot_positive check (assignment_epoch_snapshot >= 1),
  drop constraint if exists sessions_identity_snapshot_provenance_check,
  add constraint sessions_identity_snapshot_provenance_check
    check (identity_snapshot_provenance in ('session_create','legacy_directory_backfill'));

create or replace function public.custodial_sessions_preserve_original_identity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_employee_name text;
  v_location_code text;
  v_location_name text;
  v_device_identifier text;
  v_device_name text;
  v_assignment_epoch bigint;
begin
  if tg_op = 'INSERT' then
    select e.display_name into v_employee_name
    from public.employees e where e.id = new.employee_id;
    select l.location_code, l.location_name into v_location_code, v_location_name
    from public.locations l where l.id = new.location_id;
    select d.device_id, d.device_name, d.assignment_epoch
      into v_device_identifier, v_device_name, v_assignment_epoch
    from public.devices d where d.id = new.device_id;
    if v_employee_name is null or v_location_code is null or v_location_name is null
       or v_device_identifier is null or v_device_name is null or v_assignment_epoch is null then
      raise exception using errcode='23503', message='Cleaning identity must resolve before a session is created';
    end if;
    new.employee_name_snapshot := v_employee_name;
    new.location_code_snapshot := v_location_code;
    new.location_name_snapshot := v_location_name;
    new.device_identifier_snapshot := v_device_identifier;
    new.device_name_snapshot := v_device_name;
    new.assignment_epoch_snapshot := v_assignment_epoch;
    new.identity_snapshot_provenance := 'session_create';
    return new;
  end if;

  if row(new.id,new.session_uuid,new.client_session_id,new.employee_id,new.location_id,new.device_id,new.started_at,new.created_at)
     is distinct from
     row(old.id,old.session_uuid,old.client_session_id,old.employee_id,old.location_id,old.device_id,old.started_at,old.created_at) then
    raise exception using errcode='23514', message='Original cleaning identity is immutable; append a named-manager correction instead';
  end if;
  if row(new.employee_name_snapshot,new.location_code_snapshot,new.location_name_snapshot,
         new.device_identifier_snapshot,new.device_name_snapshot,new.assignment_epoch_snapshot,new.identity_snapshot_provenance)
     is distinct from
     row(old.employee_name_snapshot,old.location_code_snapshot,old.location_name_snapshot,
         old.device_identifier_snapshot,old.device_name_snapshot,old.assignment_epoch_snapshot,old.identity_snapshot_provenance) then
    raise exception using errcode='23514', message='At-event cleaning identity snapshots are immutable';
  end if;
  if old.finish_operation_id is not null and new.finish_operation_id is distinct from old.finish_operation_id then
    raise exception using errcode='23514', message='Cleaning finish operation identity is immutable once assigned';
  end if;
  if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
    raise exception using errcode='23514', message='Cleaning end time is immutable once assigned';
  end if;
  if old.duration_minutes is not null and new.duration_minutes is distinct from old.duration_minutes then
    raise exception using errcode='23514', message='Cleaning duration is immutable once assigned';
  end if;
  if old.duration_display is not null and new.duration_display is distinct from old.duration_display then
    raise exception using errcode='23514', message='Cleaning duration display is immutable once assigned';
  end if;
  if old.completion_source is not null and new.completion_source is distinct from old.completion_source then
    raise exception using errcode='23514', message='Cleaning completion source is immutable once assigned';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_custodial_sessions_original_identity on public.sessions;
create trigger trg_custodial_sessions_original_identity
before insert or update on public.sessions
for each row execute function public.custodial_sessions_preserve_original_identity();

revoke all on function public.custodial_sessions_preserve_original_identity()
  from public,anon,authenticated,service_role;
grant execute on function public.custodial_sessions_preserve_original_identity() to postgres;

create table if not exists public.custodial_session_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  session_id uuid not null references public.sessions(id) on delete restrict,
  corrected_by_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  corrected_by_manager_name_snapshot text not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  changed_fields text[] not null check (
    cardinality(changed_fields) >= 1
    and changed_fields <@ array['employee','location','device','started_at','ended_at']::text[]
  ),
  effective_employee_id uuid not null references public.employees(id) on delete restrict,
  effective_employee_name_snapshot text not null,
  effective_location_id uuid not null references public.locations(id) on delete restrict,
  effective_location_code_snapshot text not null,
  effective_location_name_snapshot text not null,
  effective_device_id uuid not null references public.devices(id) on delete restrict,
  effective_device_identifier_snapshot text not null,
  effective_device_name_snapshot text not null,
  effective_assignment_epoch_snapshot bigint not null check (effective_assignment_epoch_snapshot >= 1),
  effective_started_at timestamptz not null,
  effective_ended_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint custodial_session_correction_time_order check (
    effective_ended_at is null or effective_ended_at >= effective_started_at
  )
);

create index if not exists idx_custodial_session_corrections_session
  on public.custodial_session_corrections(session_id,created_at desc,correction_id desc);

alter table public.custodial_session_corrections enable row level security;
alter table public.custodial_session_corrections force row level security;
revoke all on table public.custodial_session_corrections from public,anon,authenticated;
grant select on table public.custodial_session_corrections to service_role;
grant select,insert on table public.custodial_session_corrections to postgres;

drop policy if exists custodial_session_corrections_service_select on public.custodial_session_corrections;
create policy custodial_session_corrections_service_select
on public.custodial_session_corrections
for select to service_role using (true);

create or replace function public.custodial_reject_session_correction_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
begin
  raise exception using errcode='23514', message='Cleaning corrections are append-only';
end
$function$;

drop trigger if exists trg_custodial_session_corrections_append_only on public.custodial_session_corrections;
create trigger trg_custodial_session_corrections_append_only
before update or delete on public.custodial_session_corrections
for each row execute function public.custodial_reject_session_correction_mutation();

revoke all on function public.custodial_reject_session_correction_mutation()
  from public,anon,authenticated,service_role;
grant execute on function public.custodial_reject_session_correction_mutation() to postgres;

create or replace function public.custodial_append_session_correction(
  p_operation_id uuid,
  p_session_id uuid,
  p_manager_id uuid,
  p_reason text,
  p_backend_execution_secret text,
  p_corrected_employee_id uuid default null,
  p_corrected_location_id uuid default null,
  p_corrected_device_id uuid default null,
  p_corrected_started_at timestamptz default null,
  p_corrected_ended_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_fingerprint text;
  v_existing public.custodial_session_corrections%rowtype;
  v_current record;
  v_manager_name text;
  v_employee record;
  v_location record;
  v_device record;
  v_employee_id uuid;
  v_location_id uuid;
  v_device_id uuid;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_changed_fields text[];
  v_inserted public.custodial_session_corrections%rowtype;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if p_operation_id is null or p_session_id is null or p_manager_id is null
     or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
    raise exception using errcode='22023', message='Correction operation, session, named manager, and reason are required';
  end if;

  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'operation_id',p_operation_id,'session_id',p_session_id,'manager_id',p_manager_id,
    'reason',btrim(p_reason),'employee_id',p_corrected_employee_id,'location_id',p_corrected_location_id,
    'device_id',p_corrected_device_id,'started_at',p_corrected_started_at,'ended_at',p_corrected_ended_at
  )::text,'UTF8'),'sha256'),'hex');

  select * into v_existing
  from public.custodial_session_corrections c
  where c.operation_id = p_operation_id;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode='23505', message='Correction operation was already used for a different request';
    end if;
    return jsonb_build_object('correction_id',v_existing.correction_id,'session_id',v_existing.session_id,
      'operation_id',v_existing.operation_id,'replayed',true,'changed_fields',v_existing.changed_fields,
      'created_at',v_existing.created_at);
  end if;

  select m.display_name into v_manager_name
  from public.ops_manager_managers m
  where m.manager_id = p_manager_id
    and m.active = true and m.revoked_at is null and m.is_system_principal = false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[];
  if not found then
    raise exception using errcode='42501', message='An active named manager is required to correct a cleaning record';
  end if;

  select
    coalesce(c.effective_employee_id,s.employee_id) employee_id,
    coalesce(c.effective_location_id,s.location_id) location_id,
    coalesce(c.effective_device_id,s.device_id) device_id,
    coalesce(c.effective_started_at,s.started_at) started_at,
    coalesce(c.effective_ended_at,s.ended_at) ended_at
  into v_current
  from public.sessions s
  left join lateral (
    select c.* from public.custodial_session_corrections c
    where c.session_id = s.id
    order by c.created_at desc,c.correction_id desc
    limit 1
  ) c on true
  where s.id = p_session_id
  for update of s;
  if not found then
    raise exception using errcode='P0002', message='Cleaning session was not found';
  end if;

  v_employee_id := coalesce(p_corrected_employee_id,v_current.employee_id);
  v_location_id := coalesce(p_corrected_location_id,v_current.location_id);
  v_device_id := coalesce(p_corrected_device_id,v_current.device_id);
  v_started_at := coalesce(p_corrected_started_at,v_current.started_at);
  v_ended_at := coalesce(p_corrected_ended_at,v_current.ended_at);

  v_changed_fields := array_remove(array[
    case when v_employee_id is distinct from v_current.employee_id then 'employee' end,
    case when v_location_id is distinct from v_current.location_id then 'location' end,
    case when v_device_id is distinct from v_current.device_id then 'device' end,
    case when v_started_at is distinct from v_current.started_at then 'started_at' end,
    case when v_ended_at is distinct from v_current.ended_at then 'ended_at' end
  ],null);
  if cardinality(v_changed_fields) = 0 then
    raise exception using errcode='22023', message='Correction must change at least one manager-visible fact';
  end if;
  if v_ended_at is not null and v_ended_at < v_started_at then
    raise exception using errcode='22023', message='Corrected cleaning end time cannot precede its start time';
  end if;

  select e.id,e.display_name into v_employee from public.employees e where e.id = v_employee_id;
  select l.id,l.location_code,l.location_name into v_location from public.locations l where l.id = v_location_id;
  select d.id,d.device_id,d.device_name,d.assignment_epoch into v_device from public.devices d where d.id = v_device_id;
  if v_employee.id is null or v_location.id is null or v_device.id is null then
    raise exception using errcode='23503', message='Corrected employee, location, and phone must exist';
  end if;

  insert into public.custodial_session_corrections(
    operation_id,request_fingerprint,session_id,corrected_by_manager_id,corrected_by_manager_name_snapshot,
    reason,changed_fields,effective_employee_id,effective_employee_name_snapshot,effective_location_id,
    effective_location_code_snapshot,effective_location_name_snapshot,effective_device_id,
    effective_device_identifier_snapshot,effective_device_name_snapshot,effective_assignment_epoch_snapshot,
    effective_started_at,effective_ended_at
  ) values (
    p_operation_id,v_fingerprint,p_session_id,p_manager_id,v_manager_name,btrim(p_reason),v_changed_fields,
    v_employee.id,v_employee.display_name,v_location.id,v_location.location_code,v_location.location_name,
    v_device.id,v_device.device_id,v_device.device_name,v_device.assignment_epoch,v_started_at,v_ended_at
  ) returning * into v_inserted;

  return jsonb_build_object('correction_id',v_inserted.correction_id,'session_id',v_inserted.session_id,
    'operation_id',v_inserted.operation_id,'replayed',false,'changed_fields',v_inserted.changed_fields,
    'created_at',v_inserted.created_at);
end
$function$;

revoke all on function public.custodial_append_session_correction(uuid,uuid,uuid,text,text,uuid,uuid,uuid,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.custodial_append_session_correction(uuid,uuid,uuid,text,text,uuid,uuid,uuid,timestamptz,timestamptz)
  to service_role;

create or replace view public.v_custodial_cleaning_session_truth
with (security_invoker=true)
as
select
  s.id session_id,
  s.session_uuid,
  s.client_session_id,
  s.status,
  s.employee_id original_employee_id,
  s.employee_name_snapshot original_employee_name,
  s.location_id original_location_id,
  s.location_code_snapshot original_location_code,
  s.location_name_snapshot original_location_name,
  s.device_id original_device_id,
  s.device_identifier_snapshot original_device_identifier,
  s.device_name_snapshot original_device_name,
  s.assignment_epoch_snapshot original_assignment_epoch,
  s.started_at original_started_at,
  s.ended_at original_ended_at,
  coalesce(c.effective_employee_id,s.employee_id) current_employee_id,
  coalesce(c.effective_employee_name_snapshot,s.employee_name_snapshot) current_employee_name,
  coalesce(c.effective_location_id,s.location_id) current_location_id,
  coalesce(c.effective_location_code_snapshot,s.location_code_snapshot) current_location_code,
  coalesce(c.effective_location_name_snapshot,s.location_name_snapshot) current_location_name,
  coalesce(c.effective_device_id,s.device_id) current_device_id,
  coalesce(c.effective_device_identifier_snapshot,s.device_identifier_snapshot) current_device_identifier,
  coalesce(c.effective_device_name_snapshot,s.device_name_snapshot) current_device_name,
  coalesce(c.effective_assignment_epoch_snapshot,s.assignment_epoch_snapshot) current_assignment_epoch,
  coalesce(c.effective_started_at,s.started_at) current_started_at,
  coalesce(c.effective_ended_at,s.ended_at) current_ended_at,
  c.correction_id,
  c.corrected_by_manager_id,
  c.corrected_by_manager_name_snapshot,
  c.reason correction_reason,
  c.changed_fields,
  c.created_at corrected_at
from public.sessions s
left join lateral (
  select c.* from public.custodial_session_corrections c
  where c.session_id = s.id
  order by c.created_at desc,c.correction_id desc
  limit 1
) c on true;

revoke all on public.v_custodial_cleaning_session_truth from public,anon,authenticated;
grant select on public.v_custodial_cleaning_session_truth to service_role;

create or replace function public.custodial_manager_get_session_truth(
  p_manager_id uuid,
  p_session_id uuid,
  p_backend_execution_secret text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_result jsonb;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(
    select 1 from public.ops_manager_managers m
    where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null
      and m.is_system_principal=false
      and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  ) then
    raise exception using errcode='42501', message='An active named manager is required to view cleaning truth';
  end if;
  select to_jsonb(v) into v_result
  from public.v_custodial_cleaning_session_truth v
  where v.session_id=p_session_id;
  if v_result is null then
    raise exception using errcode='P0002', message='Cleaning session was not found';
  end if;
  return v_result;
end
$function$;

revoke all on function public.custodial_manager_get_session_truth(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.custodial_manager_get_session_truth(uuid,uuid,text) to service_role;

-- Updating an inspection may change its rubric outcome, but it must never
-- resnapshot a later-mutated directory/session identity.
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
  if tg_op = 'UPDATE' then
    if row(new.operation_id,new.session_id,new.request_fingerprint,new.inspector_manager_id,
           new.inspected_at,new.created_at,new.location_id,new.employee_id,new.inspector_name_snapshot,
           new.employee_name_snapshot,new.location_code_snapshot,new.location_name_snapshot,
           new.session_started_at,new.session_ended_at,new.session_duration_minutes)
       is distinct from
       row(old.operation_id,old.session_id,old.request_fingerprint,old.inspector_manager_id,
           old.inspected_at,old.created_at,old.location_id,old.employee_id,old.inspector_name_snapshot,
           old.employee_name_snapshot,old.location_code_snapshot,old.location_name_snapshot,
           old.session_started_at,old.session_ended_at,old.session_duration_minutes) then
      raise exception using errcode='23514', message='Inspection actor, cleaning identity, and snapshots are immutable';
    end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;

  new.inspected_at := statement_timestamp();
  new.created_at := new.inspected_at;
  select
    s.location_id,s.employee_id,s.started_at,s.ended_at,s.duration_minutes,s.status,
    (select max(cr.submitted_at) from public.completion_responses cr where cr.session_id=s.id) completion_submitted_at,
    s.location_code_snapshot,s.location_name_snapshot,s.employee_name_snapshot
  into v_session
  from public.sessions s
  where s.id = new.session_id;
  if not found then
    raise exception using errcode='P0002', message='Cleaning session was not found';
  end if;
  if v_session.status not in ('pending_submit','closed') then
    raise exception using errcode='23514', message='Only a finished cleaning session can be inspected';
  end if;
  v_completion_at := coalesce(v_session.ended_at,v_session.completion_submitted_at);
  if v_completion_at is null then
    raise exception using errcode='23514', message='Finished cleaning session has no completion timestamp';
  end if;
  if new.inspected_at < v_completion_at or new.inspected_at > v_completion_at + interval '24 hours' then
    raise exception using errcode='23514', message='Inspection must be recorded within 24 hours after cleaning completion';
  end if;

  new.location_id := v_session.location_id;
  new.employee_id := v_session.employee_id;
  new.employee_name_snapshot := v_session.employee_name_snapshot;
  new.location_code_snapshot := v_session.location_code_snapshot;
  new.location_name_snapshot := v_session.location_name_snapshot;
  new.session_started_at := v_session.started_at;
  new.session_ended_at := v_completion_at;
  new.session_duration_minutes := coalesce(v_session.duration_minutes,
    greatest(0,ceil(extract(epoch from (v_completion_at-v_session.started_at))/60.0)::integer));

  if new.inspector_manager_id is not null then
    select m.display_name into v_inspector_name
    from public.ops_manager_managers m
    where m.manager_id=new.inspector_manager_id
      and m.active=true and m.revoked_at is null and m.is_system_principal=false;
    if not found then
      raise exception using errcode='23503', message='Active inspector manager was not found';
    end if;
    new.inspector_name_snapshot := v_inspector_name;
  else
    new.inspector_name_snapshot := coalesce(nullif(btrim(new.inspector_name_snapshot),''),'Custodial Manager');
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

revoke all on function public.cleaning_inspections_set_snapshot()
  from public,anon,authenticated,service_role;
grant execute on function public.cleaning_inspections_set_snapshot() to postgres;

comment on table public.custodial_session_corrections is
  'Append-only named-manager corrections. Original sessions and at-event snapshots remain unchanged.';
comment on view public.v_custodial_cleaning_session_truth is
  'Shows original immutable cleaning evidence beside the latest append-only corrected manager truth.';

commit;
