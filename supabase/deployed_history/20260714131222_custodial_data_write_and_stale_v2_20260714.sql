-- Deployed migration history snapshot: 20260714131222 custodial_data_write_and_stale_v2_20260714

create or replace function public.expire_stale_open_sessions(p_now timestamptz default now())
returns integer language plpgsql set search_path = pg_catalog, public as $function$
declare
  v_timeout_minutes integer := public.get_setting_int('stale_session_timeout_minutes',120);
  v_expired_count integer := 0;
  r record;
begin
  for r in
    select s.id,s.status,s.location_id,s.device_id,s.started_at,s.ended_at
    from public.sessions s
    where (s.status='active' and s.started_at<=p_now-make_interval(mins=>v_timeout_minutes))
       or (s.status='pending_submit' and coalesce(s.ended_at,s.started_at)<=p_now-make_interval(mins=>v_timeout_minutes))
    order by s.started_at for update skip locked
  loop
    update public.sessions
       set status='cancelled',ended_at=coalesce(ended_at,p_now),
           duration_minutes=coalesce(duration_minutes,greatest(0,round(extract(epoch from (coalesce(ended_at,p_now)-started_at))/60.0))),
           duration_display=coalesce(duration_display,greatest(0,round(extract(epoch from (coalesce(ended_at,p_now)-started_at))/60.0))::text||' min'),
           completion_source=coalesce(completion_source,'system'),updated_at=p_now
     where id=r.id and status=r.status;
    if found then
      insert into public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
      values(r.id,'session_auto_cancelled','system','expire_stale_open_sessions',jsonb_build_object('reason','stale_timeout','previous_status',r.status,'timeout_minutes',v_timeout_minutes,'cancelled_at',p_now));
      insert into public.system_logs(level,source,message,session_id,location_id,device_id)
      values('WARN','expire_stale_open_sessions','Stale session cancelled without fabricating completion',r.id,r.location_id,r.device_id);
      v_expired_count:=v_expired_count+1;
    end if;
  end loop;
  return v_expired_count;
end;
$function$;
create or replace function public.run_sql_write(p_sql text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_sql text:=btrim(coalesce(p_sql,''));
  v_lower text;
  v_result jsonb;
  v_count bigint:=0;
begin
  if v_sql='' then raise exception 'SQL cannot be empty'; end if;
  v_sql:=regexp_replace(v_sql,';\s*$','');
  if position(';' in v_sql)>0 then raise exception 'Only one application data statement is allowed'; end if;
  v_lower:=lower(ltrim(v_sql));
  if v_lower !~ '^(insert|update|delete|with|select)\s' then raise exception 'Application write executor does not accept DDL'; end if;
  if v_lower ~ '(^|\s)(create|alter|drop|truncate|grant|revoke|comment|vacuum|reindex|cluster)\s' then raise exception 'Application write executor does not accept DDL'; end if;
  if v_lower ~ '^(insert|update|delete|with)\s' and v_lower like '% returning %' then
    execute format('with _rows as (%s) select coalesce(jsonb_agg(to_jsonb(_rows)), ''[]''::jsonb) from _rows',v_sql) into v_result;
    return coalesce(v_result,'[]'::jsonb);
  end if;
  execute v_sql;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'row_count',v_count);
end;
$function$;
revoke all on function public.run_sql_write(text) from public,anon,authenticated;
grant execute on function public.run_sql_write(text) to service_role;
revoke all on function public.run_sql_readonly(text) from public,anon,authenticated;
grant execute on function public.run_sql_readonly(text) to service_role;
do $security$
declare r record;
begin
  for r in select unnest(array['msg_users','msg_threads','msg_thread_participants','msg_messages','msg_receipts','msg_broadcasts','msg_broadcast_recipients','msg_device_assignments','msg_hidden_threads_by_device','msg_memphis_thread_context','msg_message_deletions','msg_thread_visibility']) as table_name loop
    execute format('alter table public.%I enable row level security',r.table_name);
    execute format('revoke all on table public.%I from anon,authenticated',r.table_name);
  end loop;
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef loop
    execute format('alter function %s set search_path = pg_catalog, public',r.signature);
  end loop;
end;
$security$;
