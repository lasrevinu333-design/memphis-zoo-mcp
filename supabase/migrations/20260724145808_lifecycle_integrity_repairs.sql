begin;

insert into public.system_settings(setting_key, setting_value, description, updated_at)
values (
  'retention_message_days',
  '14'::jsonb,
  'Only explicitly deleted Messenger content is purged after exactly 336 elapsed hours. Active Messenger content is never age-purged. Event retention separately uses Memphis calendar dates.',
  now()
)
on conflict(setting_key) do update
set setting_value = excluded.setting_value,
    description = excluded.description,
    updated_at = now();

-- `timestamptz + interval '14 days'` follows local calendar days when the
-- session timezone observes DST. Messenger retention is an elapsed-time
-- contract: 14 * 24 hours in every timezone.
alter table public.msg_messages
  drop constraint if exists msg_messages_deletion_state_chk;
alter table public.msg_threads
  drop constraint if exists msg_threads_deletion_state_chk;

update public.msg_messages
set purge_after = deleted_at + interval '336 hours'
where is_deleted is true
  and deleted_at is not null
  and purge_after is distinct from deleted_at + interval '336 hours';

update public.msg_threads
set purge_after = deleted_at + interval '336 hours'
where deleted_at is not null
  and purge_after is distinct from deleted_at + interval '336 hours';

alter table public.msg_messages
  add constraint msg_messages_deletion_state_chk
  check (
    (is_deleted is false and deleted_at is null and purge_after is null)
    or
    (is_deleted is true and deleted_at is not null and purge_after = deleted_at + interval '336 hours')
  );

alter table public.msg_threads
  add constraint msg_threads_deletion_state_chk
  check (
    (deleted_at is null and purge_after is null)
    or
    (is_active is false and deleted_at is not null and purge_after = deleted_at + interval '336 hours')
  );

create or replace function public.msg_enforce_elapsed_retention()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.deleted_at is null then
    new.purge_after := null;
  else
    new.purge_after := new.deleted_at + interval '336 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_msg_messages_elapsed_retention on public.msg_messages;
create trigger trg_msg_messages_elapsed_retention
before insert or update of is_deleted, deleted_at, purge_after
on public.msg_messages
for each row execute function public.msg_enforce_elapsed_retention();

drop trigger if exists trg_msg_threads_elapsed_retention on public.msg_threads;
create trigger trg_msg_threads_elapsed_retention
before insert or update of is_active, deleted_at, purge_after
on public.msg_threads
for each row execute function public.msg_enforce_elapsed_retention();

revoke all on function public.msg_enforce_elapsed_retention()
  from public, anon, authenticated;

-- Global tombstone replay computes its purge timestamp instead of always
-- returning the trigger-corrected row. Preserve the audited function body and
-- replace only its interval literal.
do $elapsed_messenger_function$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.msg_admin_tombstone_thread(uuid,uuid,uuid)'::regprocedure
  ) into v_definition;

  if position('interval ''14 days''' in v_definition) > 0 then
    execute replace(
      v_definition,
      'interval ''14 days''',
      'interval ''336 hours'''
    );
  elsif position('interval ''336 hours''' in v_definition) = 0 then
    raise exception 'msg_admin_tombstone_thread retention interval was not recognized';
  end if;
end;
$elapsed_messenger_function$;

create table if not exists public.custodial_employee_phone_operations (
  operation_id uuid primary key,
  request_fingerprint text not null,
  device_identifier text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  check (length(request_fingerprint) = 32),
  check (jsonb_typeof(response_json) = 'object')
);

alter table public.custodial_employee_phone_operations enable row level security;
alter table public.custodial_employee_phone_operations force row level security;
revoke all on public.custodial_employee_phone_operations from public, anon, authenticated;
grant select, insert on public.custodial_employee_phone_operations to postgres, service_role;

create or replace function public.mz_revoke_stale_employee_push_registrations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.assigned_employee_id is distinct from old.assigned_employee_id then
    new.assignment_epoch := old.assignment_epoch + 1;
    update public.device_auth_credentials
       set revoked_at = coalesce(revoked_at, now()),
           revoked_reason = coalesce(revoked_reason, 'device_assignment_changed')
     where device_id = old.id
       and revoked_at is null;
    update public.employee_push_registrations
       set active = false,
           revoked_at = now(),
           revoked_reason = 'assignment_epoch_rotated',
           updated_at = now()
     where device_id = old.id
       and active = true
       and revoked_at is null;
    update public.event_push_instances
       set state = 'cancelled',
           cancelled_at = now(),
           last_error = 'device_assignment_changed',
           updated_at = now()
     where device_id = old.id
       and state in ('pending', 'leased');
    update public.operational_notification_jobs
       set status = 'dead',
           completed_at = now(),
           last_error = 'device_assignment_changed',
           updated_at = now()
     where job_type = 'employee_event_push'
       and status in ('pending', 'leased')
       and payload_json->>'device_id' = old.id::text;
  end if;
  return new;
end;
$$;

revoke all on function public.mz_revoke_stale_employee_push_registrations()
  from public, anon, authenticated;

create or replace function public.custodial_reassign_employee_phone(
  p_operation_id uuid,
  p_device_identifier text,
  p_expected_current_employee_id uuid,
  p_employee_id uuid default null,
  p_new_employee_name text default null,
  p_changed_by_manager_id uuid default null,
  p_reason text default null,
  p_move_existing boolean default false,
  p_deactivate_previous boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_identifier text := upper(regexp_replace(btrim(coalesce(p_device_identifier, '')), '^KIOSK[-_ ]?', 'KIOSK_', 'i'));
  v_new_name text := regexp_replace(btrim(coalesce(p_new_employee_name, '')), '\s+', ' ', 'g');
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_fingerprint text;
  v_existing public.custodial_employee_phone_operations%rowtype;
  v_device public.devices%rowtype;
  v_created jsonb;
  v_employee_id uuid := p_employee_id;
  v_assignment jsonb;
  v_former jsonb;
  v_response jsonb;
  v_previous_employee_id uuid;
  v_moved_from text;
begin
  perform public.custodial_assert_manager(p_changed_by_manager_id);
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id is required.';
  end if;
  if v_identifier ~ '^KIOSK_[2-9]$' then
    v_identifier := 'KIOSK_0' || substring(v_identifier from 7);
  end if;
  if v_identifier !~ '^KIOSK_(0[2-9]|10)$' then
    raise exception using errcode = '22023', message = 'Choose an employee kiosk from KIOSK_02 through KIOSK_10.';
  end if;
  if p_employee_id is not null and v_new_name <> '' then
    raise exception using errcode = '22023', message = 'Choose an existing employee or enter a new employee, not both.';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'device_identifier', v_identifier,
    'expected_current_employee_id', p_expected_current_employee_id,
    'employee_id', p_employee_id,
    'new_employee_name', nullif(v_new_name, ''),
    'changed_by_manager_id', p_changed_by_manager_id,
    'reason', v_reason,
    'move_existing', coalesce(p_move_existing, false),
    'deactivate_previous', coalesce(p_deactivate_previous, false)
  )::text);

  perform pg_advisory_xact_lock(hashtextextended('custodial-phone-operation:' || p_operation_id::text, 0));
  select * into v_existing
  from public.custodial_employee_phone_operations
  where operation_id = p_operation_id;
  if v_existing.operation_id is not null then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'operation_id was already used for a different phone assignment request.';
    end if;
    return v_existing.response_json || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('custodial-device-assignment:' || v_identifier, 0));
  select * into v_device
  from public.devices
  where upper(device_id) = v_identifier and active is true
  for update;
  if v_device.id is null then
    raise exception using errcode = 'P0002', message = 'Active employee kiosk not found.';
  end if;
  if v_device.assigned_employee_id is distinct from p_expected_current_employee_id then
    raise exception using errcode = 'P0001', message = 'This phone assignment changed. Refresh and try again.';
  end if;
  v_previous_employee_id := v_device.assigned_employee_id;

  if v_new_name <> '' then
    v_created := public.custodial_create_employee(
      v_new_name,
      null,
      'Created from Phone Assignments',
      p_changed_by_manager_id
    );
    v_employee_id := nullif(v_created #>> '{employee,id}', '')::uuid;
  end if;

  v_assignment := public.custodial_assign_employee_device(
    v_identifier,
    v_employee_id,
    p_changed_by_manager_id,
    coalesce(v_reason, case when v_created is null then 'Phone assignment updated' else 'Assigned to newly created employee ' || v_new_name end),
    coalesce(p_move_existing, false)
  );

  if coalesce((v_assignment->>'changed')::boolean, false) then
    update public.device_auth_credentials
    set revoked_at = coalesce(revoked_at, now()),
        revoked_reason = coalesce(revoked_reason, 'device_assignment_changed')
    where device_id = v_device.id
      and revoked_at is null;
  end if;

  v_moved_from := nullif(v_assignment->>'moved_from_device', '');
  if v_moved_from is not null then
    update public.device_auth_credentials c
    set revoked_at = coalesce(c.revoked_at, now()),
        revoked_reason = coalesce(c.revoked_reason, 'device_assignment_changed')
    from public.devices d
    where c.device_id = d.id
      and upper(d.device_id) = upper(v_moved_from)
      and c.revoked_at is null;
  end if;

  if coalesce(p_deactivate_previous, false)
     and v_previous_employee_id is not null
     and v_previous_employee_id is distinct from v_employee_id then
    v_former := public.custodial_set_employee_active(
      v_previous_employee_id,
      false,
      p_changed_by_manager_id,
      coalesce(v_reason, 'Employment ended during phone reassignment'),
      true
    );
  end if;

  v_response := jsonb_build_object(
    'operation_id', p_operation_id,
    'replayed', false,
    'employee', coalesce(v_created->'employee', v_assignment->'new_employee'),
    'device', v_assignment->'device',
    'assignment', v_assignment,
    'former_employee_status', v_former,
    'credential_reenrollment_required', coalesce((v_assignment->>'changed')::boolean, false)
  );

  insert into public.custodial_employee_phone_operations(
    operation_id, request_fingerprint, device_identifier, response_json
  ) values (
    p_operation_id, v_fingerprint, v_identifier, v_response
  );
  return v_response;
end;
$$;

revoke all on function public.custodial_reassign_employee_phone(uuid,text,uuid,uuid,text,uuid,text,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.custodial_reassign_employee_phone(uuid,text,uuid,uuid,text,uuid,text,boolean,boolean)
  to postgres, service_role;

create or replace function public.custodial_create_employee_idempotent(
  p_operation_id uuid,
  p_display_name text,
  p_changed_by_manager_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
  v_fingerprint text;
  v_existing public.custodial_employee_phone_operations%rowtype;
  v_created jsonb;
  v_response jsonb;
begin
  perform public.custodial_assert_manager(p_changed_by_manager_id);
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id is required.';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'action', 'create_unassigned_employee',
    'display_name', v_name,
    'changed_by_manager_id', p_changed_by_manager_id
  )::text);
  perform pg_advisory_xact_lock(hashtextextended('custodial-phone-operation:' || p_operation_id::text, 0));
  select * into v_existing
  from public.custodial_employee_phone_operations
  where operation_id = p_operation_id;
  if v_existing.operation_id is not null then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'operation_id was already used for a different phone assignment request.';
    end if;
    return v_existing.response_json || jsonb_build_object('replayed', true);
  end if;

  v_created := public.custodial_create_employee(
    v_name,
    null,
    'Created from Phone Assignments',
    p_changed_by_manager_id
  );
  v_response := jsonb_build_object(
    'operation_id', p_operation_id,
    'replayed', false,
    'employee', v_created->'employee',
    'device', null
  );
  insert into public.custodial_employee_phone_operations(
    operation_id, request_fingerprint, device_identifier, response_json
  ) values (
    p_operation_id, v_fingerprint, 'UNASSIGNED', v_response
  );
  return v_response;
end;
$$;

revoke all on function public.custodial_create_employee_idempotent(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.custodial_create_employee_idempotent(uuid,text,uuid)
  to postgres, service_role;

create or replace function public.finish_operational_notification_job_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error text default null,
  p_retry_seconds integer default 30,
  p_terminal boolean default false
) returns public.operational_notification_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.operational_notification_jobs%rowtype;
begin
  select * into v_job
  from public.operational_notification_jobs
  where job_id = p_job_id
    and lease_token = p_lease_token
    and status = 'leased'
  for update;
  if v_job.job_id is null then
    raise exception using errcode = 'P0002', message = 'Notification job lease was not found.';
  end if;

  update public.operational_notification_jobs
  set status = case
        when p_succeeded then 'completed'
        when p_terminal or attempts >= max_attempts then 'dead'
        else 'pending'
      end,
      available_at = case
        when p_succeeded or p_terminal or attempts >= max_attempts then available_at
        else now() + make_interval(secs => greatest(1, least(coalesce(p_retry_seconds, 30), 86400)))
      end,
      completed_at = case
        when p_succeeded or p_terminal or attempts >= max_attempts then now()
        else null
      end,
      last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 2000),
      lease_token = null,
      leased_at = null,
      leased_until = null,
      worker_id = null,
      updated_at = now()
  where job_id = v_job.job_id
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.finish_operational_notification_job_v2(uuid,uuid,boolean,text,integer,boolean)
  from public, anon, authenticated;
grant execute on function public.finish_operational_notification_job_v2(uuid,uuid,boolean,text,integer,boolean)
  to postgres, service_role;

commit;
