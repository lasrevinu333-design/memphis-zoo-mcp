-- Deployed migration history snapshot: 20260714121817 atomic_scan_and_messaging_foundation_20260714

-- Memphis Zoo Custodial System — atomic scan and Messenger foundation
-- 2026-07-14
--
-- Foundation invariants:
--   * A kiosk never chooses its employee. The server resolves devices.assigned_employee_id.
--   * A completed cleaning exists only after one authoritative database transaction commits.
--   * Client identifiers make start/completion/message retries idempotent.
--   * Routine application writes are not recorded as schema migrations.
--   * "Delivered" requires a device acknowledgement; insertion is only queued/sent.

create or replace function public.run_sql_write(
  p_sql text,
  p_context text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_sql text := btrim(coalesce(p_sql, ''));
  v_body text;
  v_lower text;
  v_result jsonb;
  v_row_count bigint := 0;
begin
  if v_sql = '' then
    raise exception 'SQL cannot be empty';
  end if;

  v_body := regexp_replace(v_sql, ';\s*$', '');
  v_lower := lower(ltrim(v_body));

  if v_lower !~ '^(select|with|insert|update|delete)\s' then
    raise exception 'run_sql_write accepts data statements only';
  end if;

  if v_lower ~ '(^|;\s*)(create|alter|drop|truncate|grant|revoke|comment|vacuum|reindex|cluster|copy|do|call)\s' then
    raise exception 'Schema, privilege, and maintenance statements require a named migration';
  end if;

  if position(';' in v_body) = 0 then
    if v_lower ~ '^(select|with)\s' then
      begin
        execute format(
          'select coalesce(jsonb_agg(to_jsonb(_rows)), ''[]''::jsonb) from (%s) _rows',
          v_body
        ) into v_result;
        return coalesce(v_result, '[]'::jsonb);
      exception
        when syntax_error_or_access_rule_violation or feature_not_supported then
          null;
      end;
    elsif v_lower ~ '^(insert|update|delete)\s' and v_lower ~ '\sreturning\s' then
      execute format(
        'with _rows as (%s) select coalesce(jsonb_agg(to_jsonb(_rows)), ''[]''::jsonb) from _rows',
        v_body
      ) into v_result;
      return coalesce(v_result, '[]'::jsonb);
    end if;
  end if;

  execute v_sql;
  get diagnostics v_row_count = row_count;
  return jsonb_build_object(
    'ok', true,
    'context', nullif(btrim(coalesce(p_context, '')), ''),
    'affected_rows', v_row_count,
    'executed_at', clock_timestamp()
  );
end
$function$;

revoke execute on function public.run_sql_write(text, text) from public, anon, authenticated;
grant execute on function public.run_sql_write(text, text) to service_role;

comment on function public.run_sql_write(text, text) is
  'Internal service-role data-write gateway. It rejects DDL/security statements and does not write migration_log.';

insert into public.system_settings(setting_key, setting_value, description, updated_at)
values (
  'stale_session_hard_cancel_minutes',
  '1440'::jsonb,
  'Hard-cancel an unacknowledged open session after this many minutes. Shorter ages are alerts only.',
  now()
)
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    description = excluded.description,
    updated_at = now();

create or replace function public.expire_stale_open_sessions(
  p_now timestamptz default now()
)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_timeout_minutes integer := public.get_setting_int('stale_session_hard_cancel_minutes', 1440);
  v_expired_count integer := 0;
  v_effective_end timestamptz;
  v_duration_minutes integer;
  v_duration_display text;
  r record;
begin
  for r in
    select s.id, s.location_id, s.device_id, s.started_at, s.ended_at, s.status
    from public.sessions s
    where (
      s.status = 'active'
      and s.started_at <= p_now - make_interval(mins => v_timeout_minutes)
    ) or (
      s.status = 'pending_submit'
      and coalesce(s.ended_at, s.started_at) <= p_now - make_interval(mins => v_timeout_minutes)
    )
    order by s.started_at
    for update skip locked
  loop
    v_effective_end := coalesce(r.ended_at, p_now);
    v_duration_minutes := greatest(0, round(extract(epoch from (v_effective_end - r.started_at)) / 60.0)::integer);
    v_duration_display := v_duration_minutes::text || ' min';

    update public.sessions s
    set status = 'cancelled',
        ended_at = v_effective_end,
        duration_minutes = coalesce(s.duration_minutes, v_duration_minutes),
        duration_display = coalesce(s.duration_display, v_duration_display),
        completion_source = coalesce(s.completion_source, 'system_timeout_cancelled'),
        updated_at = p_now
    where s.id = r.id and s.status = r.status;

    if found then
      insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
      values (
        r.id,
        'session_auto_cancelled',
        'system',
        'expire_stale_open_sessions',
        jsonb_build_object(
          'reason', 'hard_timeout_without_authoritative_completion',
          'previous_status', r.status,
          'timeout_minutes', v_timeout_minutes,
          'timed_out_at', p_now
        )
      );

      insert into public.system_logs(level, source, message, session_id, location_id, device_id)
      values (
        'WARN',
        'expire_stale_open_sessions',
        'Session hard-cancelled without claiming completion',
        r.id,
        r.location_id,
        r.device_id
      );
      v_expired_count := v_expired_count + 1;
    end if;
  end loop;

  return v_expired_count;
end
$function$;

drop index if exists public.uq_sessions_active_employee;
drop index if exists public.uq_sessions_active_location;

create unique index if not exists uq_sessions_open_employee
  on public.sessions(employee_id)
  where status in ('active', 'pending_submit');

create unique index if not exists uq_sessions_open_location
  on public.sessions(location_id)
  where status in ('active', 'pending_submit');

create unique index if not exists uq_sessions_open_device
  on public.sessions(device_id)
  where status in ('active', 'pending_submit');

create or replace function public.get_location_scan_state(
  p_location_code text,
  p_device_id text
)
returns table(
  location_code text,
  location_name text,
  location_type text,
  location_active boolean,
  device_approved boolean,
  latest_session_uuid text,
  latest_session_status text,
  latest_employee_name text,
  latest_device_id text,
  started_at timestamptz,
  ended_at timestamptz,
  suggested_action text
)
language plpgsql
stable
set search_path = pg_catalog, public
as $function$
declare
  v_device_ok boolean;
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
begin
  v_device_ok := public.is_approved_device(p_device_id);

  return query
  select
    coalesce(vls.location_code, v_resolved_location_code, p_location_code),
    vls.location_name,
    vls.location_type,
    vls.location_active,
    v_device_ok,
    vls.session_uuid,
    vls.session_status,
    vls.employee_name,
    vls.device_id,
    vls.started_at,
    vls.ended_at,
    case
      when vls.location_code is null then 'invalid_location'
      when v_device_ok = false then 'unauthorized_device'
      when vls.session_status is null then 'start_session'
      when vls.session_status = 'active' and upper(btrim(vls.device_id)) = upper(btrim(p_device_id)) then 'finish_session'
      when vls.session_status = 'active' then 'blocked_location_active'
      when vls.session_status = 'pending_submit' and upper(btrim(vls.device_id)) = upper(btrim(p_device_id)) then 'resume_pending_submit'
      when vls.session_status = 'pending_submit' then 'blocked_pending_submit'
      when vls.session_status in ('closed', 'cancelled') then 'start_session'
      else 'unknown'
    end
  from public.v_location_status vls
  where vls.location_code = v_resolved_location_code

  union all

  select p_location_code, null, null, false, v_device_ok,
         null, null, null, null, null, null, 'invalid_location'
  where v_resolved_location_code is null;
end
$function$;

create or replace function public.start_session_v2(
  p_location_code text,
  p_device_id text,
  p_client_session_id text,
  p_client_started_at timestamptz default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_location_id uuid;
  v_location_code text;
  v_location_name text;
  v_location_type text;
  v_form_type text;
  v_device_pk uuid;
  v_device_id text;
  v_device_name text;
  v_employee_id uuid;
  v_employee_name text;
  v_session_id uuid;
  v_session_uuid text;
  v_status text;
  v_started_at timestamptz;
  v_inserted boolean := false;
  v_client_id text := nullif(btrim(coalesce(p_client_session_id, '')), '');
begin
  if v_client_id is null or length(v_client_id) > 200 then
    raise exception 'client_session_id is required and must be at most 200 characters';
  end if;
  if nullif(btrim(coalesce(p_device_id, '')), '') is null then
    raise exception 'device_id is required';
  end if;
  if nullif(btrim(coalesce(p_location_code, '')), '') is null then
    raise exception 'location_code is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('scan-start:' || v_client_id, 0));

  select s.id, s.session_uuid, s.status, s.started_at,
         l.location_code, l.location_name, l.location_type, l.form_type,
         d.device_id, d.device_name,
         e.id, e.display_name
    into v_session_id, v_session_uuid, v_status, v_started_at,
         v_location_code, v_location_name, v_location_type, v_form_type,
         v_device_id, v_device_name,
         v_employee_id, v_employee_name
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where s.client_session_id = v_client_id
  limit 1;

  if v_session_id is not null then
    if upper(btrim(v_device_id)) <> upper(btrim(p_device_id)) then
      raise exception 'client_session_id is already bound to another device';
    end if;
    return jsonb_build_object(
      'session_uuid', v_session_uuid,
      'client_session_id', v_client_id,
      'location_code', v_location_code,
      'location_name', v_location_name,
      'location_type', v_location_type,
      'form_type', v_form_type,
      'employee_name', v_employee_name,
      'device_id', v_device_id,
      'device_name', v_device_name,
      'status', v_status,
      'started_at', v_started_at,
      'replayed', true,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
    );
  end if;

  select l.id, l.location_code, l.location_name, l.location_type, l.form_type
    into v_location_id, v_location_code, v_location_name, v_location_type, v_form_type
  from public.locations l
  where l.location_code = public.resolve_scan_location_code(p_location_code)
    and l.active = true
  limit 1;
  if v_location_id is null then
    raise exception 'Active location not found for code: %', p_location_code;
  end if;

  select d.id, d.device_id, d.device_name, e.id, e.display_name
    into v_device_pk, v_device_id, v_device_name, v_employee_id, v_employee_name
  from public.devices d
  left join public.employees e on e.id = d.assigned_employee_id and e.active = true
  where upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    and d.active = true
  limit 1;
  if v_device_pk is null then
    raise exception 'Active device not found: %', p_device_id;
  end if;
  if v_employee_id is null then
    raise exception 'Device % is not assigned to an active employee', v_device_id;
  end if;

  perform public.expire_stale_open_sessions(now());

  if exists (
    select 1 from public.sessions s
    where s.device_id = v_device_pk
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Device already has another open session: %', v_device_id;
  end if;
  if exists (
    select 1 from public.sessions s
    where s.employee_id = v_employee_id
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Assigned employee already has another open session: %', v_employee_name;
  end if;
  if exists (
    select 1 from public.sessions s
    where s.location_id = v_location_id
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Location already has another open session: %', v_location_code;
  end if;

  v_started_at := coalesce(p_client_started_at, now());
  if v_started_at > now() + interval '10 minutes' then
    raise exception 'client_started_at is too far in the future';
  end if;
  if v_started_at < now() - interval '7 days' then
    raise exception 'client_started_at is too old';
  end if;

  v_session_uuid := gen_random_uuid()::text;
  insert into public.sessions(
    session_uuid,
    client_session_id,
    location_id,
    employee_id,
    device_id,
    status,
    started_at,
    completion_source
  ) values (
    v_session_uuid,
    v_client_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    'active',
    v_started_at,
    null
  ) returning id into v_session_id;
  v_inserted := true;

  insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
  values (
    v_session_id,
    'session_started',
    'device',
    v_device_id,
    jsonb_build_object(
      'location_code', v_location_code,
      'device_id', v_device_id,
      'employee_name', v_employee_name,
      'client_session_id', v_client_id,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), ''),
      'identity_source', 'devices.assigned_employee_id'
    )
  );

  insert into public.system_logs(level, source, message, session_id, location_id, device_id)
  values ('INFO', 'start_session_v2', 'Server-authoritative session started', v_session_id, v_location_id, v_device_pk);

  return jsonb_build_object(
    'session_uuid', v_session_uuid,
    'client_session_id', v_client_id,
    'location_code', v_location_code,
    'location_name', v_location_name,
    'location_type', v_location_type,
    'form_type', v_form_type,
    'employee_name', v_employee_name,
    'device_id', v_device_id,
    'device_name', v_device_name,
    'status', 'active',
    'started_at', v_started_at,
    'replayed', not v_inserted,
    'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
  );
exception
  when unique_violation then
    select s.id, s.session_uuid, s.status, s.started_at,
           l.location_code, l.location_name, l.location_type, l.form_type,
           d.device_id, d.device_name,
           e.id, e.display_name
      into v_session_id, v_session_uuid, v_status, v_started_at,
           v_location_code, v_location_name, v_location_type, v_form_type,
           v_device_id, v_device_name,
           v_employee_id, v_employee_name
    from public.sessions s
    join public.locations l on l.id = s.location_id
    join public.devices d on d.id = s.device_id
    join public.employees e on e.id = s.employee_id
    where s.client_session_id = v_client_id
    limit 1;
    if v_session_id is null then raise; end if;
    return jsonb_build_object(
      'session_uuid', v_session_uuid,
      'client_session_id', v_client_id,
      'location_code', v_location_code,
      'location_name', v_location_name,
      'location_type', v_location_type,
      'form_type', v_form_type,
      'employee_name', v_employee_name,
      'device_id', v_device_id,
      'device_name', v_device_name,
      'status', v_status,
      'started_at', v_started_at,
      'replayed', true,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
    );
end
$function$;

revoke execute on function public.start_session_v2(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.start_session_v2(text, text, text, timestamptz, text) to service_role;

create or replace function public.tool_start_session_v2(
  p_location_code text,
  p_device_id text,
  p_client_session_id text,
  p_client_started_at timestamptz default null,
  p_correlation_id text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.start_session_v2(
    p_location_code,
    p_device_id,
    p_client_session_id,
    p_client_started_at,
    p_correlation_id
  );
$function$;

revoke execute on function public.tool_start_session_v2(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.tool_start_session_v2(text, text, text, timestamptz, text) to service_role;

create or replace function public.commit_cleaning_workflow(
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
  v_client_session_id text := nullif(btrim(coalesce(p_client_session_id, '')), '');
  v_client_completion_id text := nullif(btrim(coalesce(p_client_completion_id, '')), '');
  v_correlation_id text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_location_id uuid;
  v_location_code text;
  v_location_name text;
  v_location_type text;
  v_form_type text;
  v_device_pk uuid;
  v_device_id text;
  v_device_name text;
  v_employee_id uuid;
  v_employee_name text;
  v_session_id uuid;
  v_session_uuid text;
  v_session_status text;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_duration_minutes integer;
  v_duration_display text;
  v_completion_response_id uuid;
  v_existing_completion_id uuid;
  v_existing_submitted_at timestamptz;
  v_ticket_count integer := 0;
  v_session_created boolean := false;
  v_item jsonb;
  v_event_type text;
  v_event_id text;
begin
  if v_client_session_id is null or length(v_client_session_id) > 200 then
    raise exception 'client_session_id is required and must be at most 200 characters';
  end if;
  if v_client_completion_id is null or length(v_client_completion_id) > 200 then
    raise exception 'client_completion_id is required and must be at most 200 characters';
  end if;
  if nullif(btrim(coalesce(p_device_id, '')), '') is null then raise exception 'device_id is required'; end if;
  if nullif(btrim(coalesce(p_location_code, '')), '') is null then raise exception 'location_code is required'; end if;
  if jsonb_typeof(coalesce(p_response_json, '{}'::jsonb)) <> 'object' then raise exception 'response_json must be an object'; end if;
  if pg_column_size(coalesce(p_response_json, '{}'::jsonb)) > 1048576 then raise exception 'response_json exceeds 1 MB'; end if;
  if jsonb_typeof(coalesce(p_scan_evidence, '[]'::jsonb)) <> 'array' then raise exception 'scan_evidence must be an array'; end if;

  perform pg_advisory_xact_lock(hashtextextended('scan-session:' || v_client_session_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('scan-completion:' || v_client_completion_id, 0));

  select cr.id, cr.submitted_at, s.id, s.session_uuid, s.status, s.started_at, s.ended_at,
         s.duration_minutes, s.duration_display,
         l.id, l.location_code, l.location_name, l.location_type, l.form_type,
         d.id, d.device_id, d.device_name,
         e.id, e.display_name
    into v_existing_completion_id, v_existing_submitted_at,
         v_session_id, v_session_uuid, v_session_status, v_started_at, v_ended_at,
         v_duration_minutes, v_duration_display,
         v_location_id, v_location_code, v_location_name, v_location_type, v_form_type,
         v_device_pk, v_device_id, v_device_name,
         v_employee_id, v_employee_name
  from public.completion_responses cr
  join public.sessions s on s.id = cr.session_id
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where cr.client_completion_id = v_client_completion_id
  limit 1;

  if v_existing_completion_id is not null then
    if upper(btrim(v_device_id)) <> upper(btrim(p_device_id)) then
      raise exception 'client_completion_id is already bound to another device';
    end if;
    if v_client_session_id <> (select s.client_session_id from public.sessions s where s.id = v_session_id) then
      raise exception 'client_completion_id is already bound to another client_session_id';
    end if;
    return jsonb_build_object(
      'session_uuid', v_session_uuid,
      'client_session_id', v_client_session_id,
      'client_completion_id', v_client_completion_id,
      'location_code', v_location_code,
      'location_name', v_location_name,
      'location_type', v_location_type,
      'form_type', v_form_type,
      'employee_name', v_employee_name,
      'device_id', v_device_id,
      'device_name', v_device_name,
      'status', v_session_status,
      'started_at', v_started_at,
      'ended_at', v_ended_at,
      'duration_minutes', v_duration_minutes,
      'duration_display', v_duration_display,
      'submitted_at', v_existing_submitted_at,
      'completion_response_id', v_existing_completion_id,
      'replayed', true,
      'correlation_id', v_correlation_id
    );
  end if;

  select l.id, l.location_code, l.location_name, l.location_type, l.form_type
    into v_location_id, v_location_code, v_location_name, v_location_type, v_form_type
  from public.locations l
  where l.location_code = public.resolve_scan_location_code(p_location_code)
    and l.active = true
  limit 1;
  if v_location_id is null then raise exception 'Active location not found for code: %', p_location_code; end if;

  select d.id, d.device_id, d.device_name, e.id, e.display_name
    into v_device_pk, v_device_id, v_device_name, v_employee_id, v_employee_name
  from public.devices d
  left join public.employees e on e.id = d.assigned_employee_id and e.active = true
  where upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    and d.active = true
  limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %', p_device_id; end if;
  if v_employee_id is null then raise exception 'Device % is not assigned to an active employee', v_device_id; end if;

  select s.id, s.session_uuid, s.status, s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.location_id, s.device_id, s.employee_id
    into v_session_id, v_session_uuid, v_session_status, v_started_at, v_ended_at,
         v_duration_minutes, v_duration_display,
         v_location_id, v_device_pk, v_employee_id
  from public.sessions s
  where s.client_session_id = v_client_session_id
  for update;

  if v_session_id is not null then
    if v_device_pk <> (select d.id from public.devices d where upper(btrim(d.device_id)) = upper(btrim(p_device_id)) and d.active limit 1) then
      raise exception 'client_session_id is bound to another device';
    end if;
    if v_location_id <> (select l.id from public.locations l where l.location_code = public.resolve_scan_location_code(p_location_code) and l.active limit 1) then
      raise exception 'client_session_id is bound to another location';
    end if;
    if v_employee_id <> (select d.assigned_employee_id from public.devices d where upper(btrim(d.device_id)) = upper(btrim(p_device_id)) and d.active limit 1) then
      raise exception 'device assignment changed during this session; manager review required';
    end if;
    if v_session_status = 'cancelled' then
      raise exception 'Session was cancelled before completion reached the server; manager recovery is required';
    end if;
    if exists (select 1 from public.completion_responses cr where cr.session_id = v_session_id) then
      select cr.id, cr.submitted_at into v_existing_completion_id, v_existing_submitted_at
      from public.completion_responses cr where cr.session_id = v_session_id limit 1;
      return jsonb_build_object(
        'session_uuid', v_session_uuid,
        'client_session_id', v_client_session_id,
        'client_completion_id', v_client_completion_id,
        'location_code', v_location_code,
        'location_name', v_location_name,
        'location_type', v_location_type,
        'form_type', v_form_type,
        'employee_name', v_employee_name,
        'device_id', v_device_id,
        'device_name', v_device_name,
        'status', v_session_status,
        'started_at', v_started_at,
        'ended_at', v_ended_at,
        'duration_minutes', v_duration_minutes,
        'duration_display', v_duration_display,
        'submitted_at', v_existing_submitted_at,
        'completion_response_id', v_existing_completion_id,
        'replayed', true,
        'correlation_id', v_correlation_id
      );
    end if;
  else
    perform public.expire_stale_open_sessions(now());

    if exists (select 1 from public.sessions s where s.device_id = v_device_pk and s.status in ('active','pending_submit')) then
      raise exception 'Device already has another open session: %', v_device_id;
    end if;
    if exists (select 1 from public.sessions s where s.employee_id = v_employee_id and s.status in ('active','pending_submit')) then
      raise exception 'Assigned employee already has another open session: %', v_employee_name;
    end if;
    if exists (select 1 from public.sessions s where s.location_id = v_location_id and s.status in ('active','pending_submit')) then
      raise exception 'Location already has another open session: %', v_location_code;
    end if;

    v_started_at := coalesce(p_client_started_at, p_client_ended_at, now());
    v_session_uuid := gen_random_uuid()::text;
    insert into public.sessions(
      session_uuid, client_session_id, location_id, employee_id, device_id,
      status, started_at, completion_source
    ) values (
      v_session_uuid, v_client_session_id, v_location_id, v_employee_id, v_device_pk,
      'active', v_started_at, null
    ) returning id into v_session_id;
    v_session_status := 'active';
    v_session_created := true;

    insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
    values (
      v_session_id,
      'session_started',
      'device',
      v_device_id,
      jsonb_build_object(
        'location_code', v_location_code,
        'device_id', v_device_id,
        'employee_name', v_employee_name,
        'client_session_id', v_client_session_id,
        'correlation_id', v_correlation_id,
        'identity_source', 'devices.assigned_employee_id',
        'created_during_atomic_commit', true
      )
    );
  end if;

  v_started_at := coalesce(v_started_at, p_client_started_at, now());
  v_ended_at := coalesce(p_client_ended_at, now());
  if v_ended_at > now() + interval '10 minutes' then raise exception 'client_ended_at is too far in the future'; end if;
  if v_started_at > v_ended_at then raise exception 'client_started_at cannot be after client_ended_at'; end if;
  if v_started_at < now() - interval '7 days' then raise exception 'client_started_at is too old'; end if;
  if v_ended_at - v_started_at > interval '24 hours' then raise exception 'cleaning duration exceeds 24 hours'; end if;

  v_duration_minutes := greatest(0, round(extract(epoch from (v_ended_at - v_started_at)) / 60.0)::integer);
  v_duration_display := v_duration_minutes::text || ' min';

  if v_session_status = 'active' then
    update public.sessions
    set status = 'pending_submit',
        ended_at = v_ended_at,
        duration_minutes = v_duration_minutes,
        duration_display = v_duration_display,
        updated_at = now()
    where id = v_session_id and status = 'active';

    insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
    values (
      v_session_id,
      'session_finished',
      'device',
      v_device_id,
      jsonb_build_object(
        'location_code', v_location_code,
        'device_id', v_device_id,
        'duration_minutes', v_duration_minutes,
        'client_session_id', v_client_session_id,
        'correlation_id', v_correlation_id,
        'atomic_commit', true
      )
    );
    v_session_status := 'pending_submit';
  elsif v_session_status <> 'pending_submit' then
    raise exception 'Session status % cannot be completed', v_session_status;
  end if;

  insert into public.completion_responses(
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    client_completion_id
  ) values (
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    coalesce(p_response_json, '{}'::jsonb),
    now(),
    v_client_completion_id
  ) returning id, submitted_at into v_completion_response_id, v_existing_submitted_at;

  v_ticket_count := public.create_maintenance_tickets_from_response(
    v_completion_response_id,
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    v_existing_submitted_at,
    coalesce(p_response_json, '{}'::jsonb)
  );

  if jsonb_array_length(coalesce(p_scan_evidence, '[]'::jsonb)) > 200 then
    raise exception 'scan_evidence cannot contain more than 200 events';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_scan_evidence, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_event_type := nullif(btrim(coalesce(v_item->>'event_type', '')), '');
    v_event_id := nullif(btrim(coalesce(v_item->>'client_event_id', '')), '');
    if v_event_type not in (
      'scan_received', 'scan_blocked', 'scan_start', 'scan_finish',
      'scan_resume_pending', 'scan_invalid_location', 'scan_unauthorized_device', 'scan_error'
    ) then
      continue;
    end if;

    insert into public.scan_events(
      scanned_at,
      location_id,
      location_code,
      device_id,
      device_identifier,
      session_id,
      event_type,
      result,
      notes,
      payload_json,
      client_event_id
    ) values (
      coalesce(nullif(v_item->>'scanned_at', '')::timestamptz, now()),
      v_location_id,
      v_location_code,
      v_device_pk,
      v_device_id,
      v_session_id,
      v_event_type,
      nullif(v_item->>'result', ''),
      nullif(v_item->>'notes', ''),
      coalesce(v_item->'payload_json', '{}'::jsonb) || jsonb_build_object('correlation_id', v_correlation_id),
      v_event_id
    )
    on conflict (client_event_id) where client_event_id is not null
    do update set
      session_id = coalesce(public.scan_events.session_id, excluded.session_id),
      location_id = coalesce(public.scan_events.location_id, excluded.location_id),
      device_id = coalesce(public.scan_events.device_id, excluded.device_id),
      payload_json = coalesce(public.scan_events.payload_json, '{}'::jsonb) || excluded.payload_json;
  end loop;

  update public.sessions
  set status = 'closed',
      ended_at = v_ended_at,
      duration_minutes = v_duration_minutes,
      duration_display = v_duration_display,
      completion_source = 'kiosk_form',
      updated_at = now()
  where id = v_session_id and status = 'pending_submit';

  if not found then raise exception 'Session could not transition from pending_submit to closed'; end if;

  insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
  values (
    v_session_id,
    'session_completed',
    'form',
    v_employee_name,
    jsonb_build_object(
      'client_session_id', v_client_session_id,
      'client_completion_id', v_client_completion_id,
      'correlation_id', v_correlation_id,
      'ticket_count', v_ticket_count,
      'identity_source', 'devices.assigned_employee_id',
      'atomic_commit', true
    )
  );

  insert into public.system_logs(level, source, message, session_id, location_id, device_id)
  values ('INFO', 'commit_cleaning_workflow', 'Atomic cleaning workflow committed', v_session_id, v_location_id, v_device_pk);

  return jsonb_build_object(
    'session_uuid', v_session_uuid,
    'client_session_id', v_client_session_id,
    'client_completion_id', v_client_completion_id,
    'location_code', v_location_code,
    'location_name', v_location_name,
    'location_type', v_location_type,
    'form_type', v_form_type,
    'employee_name', v_employee_name,
    'device_id', v_device_id,
    'device_name', v_device_name,
    'status', 'closed',
    'started_at', v_started_at,
    'ended_at', v_ended_at,
    'duration_minutes', v_duration_minutes,
    'duration_display', v_duration_display,
    'submitted_at', v_existing_submitted_at,
    'completion_response_id', v_completion_response_id,
    'maintenance_ticket_count', v_ticket_count,
    'session_created_during_commit', v_session_created,
    'replayed', false,
    'correlation_id', v_correlation_id
  );
end
$function$;

revoke execute on function public.commit_cleaning_workflow(text, text, text, text, timestamptz, timestamptz, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.commit_cleaning_workflow(text, text, text, text, timestamptz, timestamptz, jsonb, jsonb, text) to service_role;

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
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.commit_cleaning_workflow(
    p_client_session_id,
    p_client_completion_id,
    p_device_id,
    p_location_code,
    p_client_started_at,
    p_client_ended_at,
    p_response_json,
    p_scan_evidence,
    p_correlation_id
  );
$function$;

revoke execute on function public.tool_commit_cleaning_workflow(text, text, text, text, timestamptz, timestamptz, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.tool_commit_cleaning_workflow(text, text, text, text, timestamptz, timestamptz, jsonb, jsonb, text) to service_role;

drop function if exists public.start_session(text, text, text);
drop function if exists public.complete_session(text, jsonb, text, text);
drop function if exists public.record_scan_event(text, text, text, text, text, jsonb);

alter table public.msg_messages
  add column if not exists client_message_id text null;

alter table public.msg_receipts
  add column if not exists displayed_at timestamptz null;

alter table public.msg_receipts
  add column if not exists acknowledged_at timestamptz null;

alter table public.msg_broadcast_recipients
  add column if not exists displayed_at timestamptz null;

alter table public.msg_broadcast_recipients
  add column if not exists acknowledged_at timestamptz null;

create unique index if not exists uq_msg_messages_sender_client_message
  on public.msg_messages(sender_user_id, client_message_id)
  where client_message_id is not null;

create index if not exists idx_msg_receipts_delivery_lifecycle
  on public.msg_receipts(user_id, delivered_at, displayed_at, read_at, acknowledged_at);

create or replace function public.msg_send_message(
  p_thread_id uuid,
  p_sender_user_id uuid,
  p_body text,
  p_message_type text default 'text',
  p_metadata_json jsonb default '{}'::jsonb
)
returns public.msg_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_message public.msg_messages%rowtype;
  v_client_message_id text := nullif(btrim(coalesce(p_metadata_json->>'client_message_id', '')), '');
begin
  if p_thread_id is null then raise exception 'thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Message body is required.'; end if;
  if length(p_body) > 2000 then raise exception 'Message body cannot exceed 2000 characters.'; end if;
  if v_client_message_id is not null and length(v_client_message_id) > 200 then
    raise exception 'client_message_id cannot exceed 200 characters.';
  end if;
  if not exists (
    select 1 from public.msg_thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_sender_user_id
      and tp.left_at is null
  ) then
    raise exception 'Sender is not an active participant in this thread.';
  end if;

  if v_client_message_id is not null then
    select * into v_message
    from public.msg_messages m
    where m.sender_user_id = p_sender_user_id
      and m.client_message_id = v_client_message_id
    limit 1;
    if found then return v_message; end if;
  end if;

  insert into public.msg_messages(
    thread_id, sender_user_id, message_type, body, metadata_json, client_message_id
  ) values (
    p_thread_id,
    p_sender_user_id,
    coalesce(nullif(btrim(p_message_type), ''), 'text'),
    btrim(p_body),
    coalesce(p_metadata_json, '{}'::jsonb),
    v_client_message_id
  ) returning * into v_message;

  insert into public.msg_receipts(message_id, user_id, delivered_at, displayed_at, read_at, acknowledged_at)
  select v_message.id, tp.user_id, null, null, null, null
  from public.msg_thread_participants tp
  where tp.thread_id = p_thread_id
    and tp.left_at is null
    and tp.user_id <> p_sender_user_id
  on conflict (message_id, user_id) do nothing;

  update public.msg_threads
  set last_message_at = v_message.sent_at, updated_at = now()
  where id = p_thread_id;

  return v_message;
exception
  when unique_violation then
    if v_client_message_id is null then raise; end if;
    select * into v_message
    from public.msg_messages m
    where m.sender_user_id = p_sender_user_id
      and m.client_message_id = v_client_message_id
    limit 1;
    if not found then raise; end if;
    return v_message;
end
$function$;

create or replace function public.msg_mark_messages_delivered(
  p_thread_id uuid,
  p_user_id uuid,
  p_message_ids uuid[] default '{}'::uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id
    and (coalesce(array_length(p_message_ids, 1), 0) = 0 or m.id = any(p_message_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

create or replace function public.msg_mark_messages_displayed(
  p_thread_id uuid,
  p_user_id uuid,
  p_message_ids uuid[] default '{}'::uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now()),
      displayed_at = coalesce(r.displayed_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id
    and (coalesce(array_length(p_message_ids, 1), 0) = 0 or m.id = any(p_message_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

create or replace function public.msg_mark_thread_read(
  p_thread_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now()),
      displayed_at = coalesce(r.displayed_at, now()),
      read_at = coalesce(r.read_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

create or replace function public.msg_send_broadcast(
  p_sender_user_id uuid,
  p_title text,
  p_body text
)
returns table(thread_id uuid, broadcast_id uuid, message_id uuid, recipient_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_broadcast public.msg_broadcasts%rowtype;
  v_message public.msg_messages%rowtype;
  v_count integer := 0;
begin
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Broadcast body is required.'; end if;
  if not exists (
    select 1 from public.msg_users mu
    where mu.id = p_sender_user_id
      and mu.is_active = true
      and mu.role in ('manager', 'admin')
  ) then
    raise exception 'Manager role required.';
  end if;

  insert into public.msg_threads(thread_type, title, created_by_user_id, is_active, last_message_at)
  values ('broadcast', coalesce(nullif(btrim(p_title), ''), 'Ops Manager Broadcast'), p_sender_user_id, true, now())
  returning * into v_thread;

  insert into public.msg_thread_participants(thread_id, user_id)
  select v_thread.id, mu.id
  from public.msg_users mu
  where mu.is_active = true and mu.role <> 'bot';

  insert into public.msg_broadcasts(thread_id, created_by_user_id, title, body, target_type, target_json)
  values (v_thread.id, p_sender_user_id, nullif(btrim(coalesce(p_title, '')), ''), btrim(p_body), 'all_hands', '{}'::jsonb)
  returning * into v_broadcast;

  v_message := public.msg_send_message(
    v_thread.id,
    p_sender_user_id,
    p_body,
    'broadcast',
    jsonb_build_object('title', p_title, 'broadcast_id', v_broadcast.id, 'target_type', 'all_hands')
  );

  insert into public.msg_broadcast_recipients(
    broadcast_id, user_id, delivered_at, displayed_at, read_at, acknowledged_at
  )
  select v_broadcast.id, mu.id, null, null, null, null
  from public.msg_users mu
  where mu.is_active = true
    and mu.role <> 'bot'
    and mu.id <> p_sender_user_id;

  select count(*)::int into v_count
  from public.msg_broadcast_recipients br
  where br.broadcast_id = v_broadcast.id;

  return query select v_thread.id, v_broadcast.id, v_message.id, v_count;
end
$function$;

do $migration$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as procedure_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'msg_send_message',
        'msg_mark_messages_delivered',
        'msg_mark_messages_displayed',
        'msg_mark_thread_read',
        'msg_send_broadcast'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.procedure_name);
    execute format('grant execute on function %s to service_role', r.procedure_name);
  end loop;
end
$migration$;

comment on column public.msg_receipts.delivered_at is
  'Set only after a device explicitly acknowledges receipt. Legacy rows before this migration may contain insertion timestamps.';
comment on column public.msg_receipts.displayed_at is
  'Set when the recipient device reports that the message was rendered to the user.';
comment on column public.msg_receipts.acknowledged_at is
  'Set when an operational message or broadcast is explicitly acknowledged.';
