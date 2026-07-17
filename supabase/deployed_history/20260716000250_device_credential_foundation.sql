-- Deployed migration history snapshot: 20260716000250 device_credential_foundation

do $outer$
declare
  v_sql text;
  v_status integer;
begin
  select r.content, r.status_code
    into v_sql, v_status
  from net._http_response r
  where r.status_code = 200
    and r.content like '%device_auth_credentials%'
    and r.content like '%device_auth_enrollment_codes%'
    and r.content like '%device_auth_consume_enrollment_code%'
    and r.content like '%force row level security%'
    and r.content like '%confirmed_at%'
  order by r.id desc
  limit 1;

  if v_sql is null or v_status <> 200 then
    raise exception 'Verified device credential migration payload was not available.';
  end if;

  if length(v_sql) < 5000 or length(v_sql) > 200000 then
    raise exception 'Device credential migration payload length was outside the expected bounds: %', length(v_sql);
  end if;

  if v_sql like '%drop table public.devices%'
     or v_sql like '%truncate public.sessions%'
     or v_sql like '%delete from public.sessions%'
     or v_sql like '%update public.sessions%'
     or v_sql like '%delete from public.devices%'
     or v_sql like '%update public.devices set assigned_employee_id%'
  then
    raise exception 'Device credential migration attempted a prohibited mutation of existing operational state.';
  end if;

  execute v_sql;
end
$outer$;
