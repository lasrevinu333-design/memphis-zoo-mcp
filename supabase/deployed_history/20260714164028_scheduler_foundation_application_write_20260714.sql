-- Deployed migration history snapshot: 20260714164028 scheduler_foundation_application_write_20260714

create or replace function public.run_application_write(p_name text, p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_sql text := btrim(coalesce(p_sql, ''));
  v_lower text;
  v_result jsonb;
begin
  if v_name is null then
    raise exception 'Application write name is required';
  end if;
  if v_sql = '' then
    raise exception 'Application write SQL is required';
  end if;
  if length(v_sql) > 1000000 then
    raise exception 'Application write SQL exceeds 1 MB';
  end if;
  v_lower := lower(v_sql);
  if v_lower ~ '^\s*(begin|commit|rollback|savepoint|prepare|vacuum|reindex|cluster|copy|alter\s+system|create\s+extension|drop\s+database|drop\s+schema)' then
    raise exception 'Transaction, maintenance, extension, and destructive database-control statements are not accepted by run_application_write';
  end if;

  if v_lower ~ '^\s*(insert|update|delete|select|with)\b'
     and v_lower like '% returning %'
     and position(';' in regexp_replace(v_sql, ';\s*$', '')) = 0 then
    execute format(
      'with _application_rows as (%s) select coalesce(jsonb_agg(to_jsonb(_application_rows)), ''[]''::jsonb) from _application_rows',
      regexp_replace(v_sql, ';\s*$', '')
    ) into v_result;
  else
    execute v_sql;
    v_result := jsonb_build_object('ok', true, 'name', v_name, 'executed_at', now());
  end if;
  return coalesce(v_result, '[]'::jsonb);
end
$function$;

revoke all on function public.run_application_write(text, text) from public, anon, authenticated;
grant execute on function public.run_application_write(text, text) to service_role;
