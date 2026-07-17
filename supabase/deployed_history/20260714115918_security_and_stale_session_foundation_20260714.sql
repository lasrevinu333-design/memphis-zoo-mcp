-- Deployed migration history snapshot: 20260714115918 security_and_stale_session_foundation_20260714

-- Memphis Zoo Custodial System — security and stale-session foundation repair
-- 2026-07-14
--
-- This migration is deliberately independent of the application release:
-- * The deployed backend already uses the Supabase service_role key.
-- * Employee/manager browsers call the backend and do not call these tables/RPCs directly.
-- * Stale sessions are cancelled rather than falsely completed.

do $migration$
declare
  r record;
begin
  for r in
    select c.oid::regclass as relation_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname like 'msg\_%' escape '\'
  loop
    execute format('revoke all privileges on table %s from public, anon, authenticated', r.relation_name);
    execute format('grant all privileges on table %s to service_role', r.relation_name);
    execute format('alter table %s enable row level security', r.relation_name);
  end loop;
end
$migration$;

do $migration$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as procedure_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'msg\_%' escape '\'
        or p.proname = 'run_sql_readonly'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.procedure_name);
    execute format('grant execute on function %s to service_role', r.procedure_name);
  end loop;
end
$migration$;

do $migration$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as procedure_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('run_sql_migration')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.procedure_name);
    execute format('grant execute on function %s to service_role', r.procedure_name);
  end loop;
end
$migration$;

do $migration$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as procedure_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        p.proname like 'msg\_%' escape '\'
        or p.proname like 'tool\_%' escape '\'
        or p.proname in ('run_sql_readonly', 'run_sql_migration')
      )
  loop
    execute format('alter function %s set search_path = pg_catalog, public', r.procedure_name);
  end loop;
end
$migration$;

create or replace function public.expire_stale_open_sessions(
  p_now timestamptz default now()
)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_timeout_minutes integer := public.get_setting_int('stale_session_timeout_minutes', 120);
  v_expired_count integer := 0;
  v_effective_end timestamptz;
  v_duration_minutes integer;
  v_duration_display text;
  r record;
begin
  for r in
    select
      s.id,
      s.location_id,
      s.device_id,
      s.started_at,
      s.ended_at,
      s.status
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
    v_duration_minutes := greatest(
      0,
      round(extract(epoch from (v_effective_end - r.started_at)) / 60.0)::integer
    );
    v_duration_display := v_duration_minutes::text || ' min';

    update public.sessions s
    set
      status = 'cancelled',
      ended_at = v_effective_end,
      duration_minutes = coalesce(s.duration_minutes, v_duration_minutes),
      duration_display = coalesce(s.duration_display, v_duration_display),
      completion_source = coalesce(s.completion_source, 'system_timeout_cancelled'),
      updated_at = p_now
    where s.id = r.id
      and s.status = r.status;

    if found then
      insert into public.session_events (
        session_id,
        event_type,
        actor_type,
        actor_ref,
        details_json
      ) values (
        r.id,
        'session_auto_cancelled',
        'system',
        'expire_stale_open_sessions',
        jsonb_build_object(
          'reason', 'stale_timeout_without_authoritative_completion',
          'previous_status', r.status,
          'timeout_minutes', v_timeout_minutes,
          'timed_out_at', p_now
        )
      );

      insert into public.system_logs (
        level,
        source,
        message,
        session_id,
        location_id,
        device_id
      ) values (
        'WARN',
        'expire_stale_open_sessions',
        'Stale session cancelled without claiming completion',
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

comment on function public.expire_stale_open_sessions(timestamptz) is
  'Cancels stale active or pending-submit sessions. It never fabricates a completed cleaning.';
