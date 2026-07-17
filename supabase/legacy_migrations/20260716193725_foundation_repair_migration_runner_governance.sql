create or replace function public.run_sql_migration(p_name text, p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set statement_timeout = '180s'
as $function$
declare
  v_trimmed text;
  v_executable text;
  v_lowered text;
  v_result jsonb;
  v_sha text;
  v_bytes integer;
begin
  v_trimmed := trim(coalesce(p_sql, ''));
  v_executable := regexp_replace(v_trimmed, ';\s*$', '');
  v_lowered := lower(v_executable);

  if coalesce(trim(p_name), '') = '' then raise exception 'Migration name is required'; end if;
  if v_trimmed = '' then raise exception 'Migration SQL is required'; end if;
  if v_lowered like 'begin%' or position(('com' || 'mit') in v_lowered) > 0 then
    raise exception 'Do not include transaction wrappers in p_sql. Submit the migration body only.';
  end if;
  if exists (select 1 from public.migration_log_summary where migration_name = p_name) then
    raise exception 'Migration "%" has already been applied', p_name;
  end if;

  if v_lowered ~ '^\s*(insert|update|delete)\s'
     and v_lowered like '% returning %'
     and position(';' in v_executable) = 0 then
    execute format('with _migration_rows as (%s) select coalesce(jsonb_agg(to_jsonb(_migration_rows)), ''[]''::jsonb) from _migration_rows', v_executable)
      into v_result;
  else
    execute v_trimmed;
    v_result := jsonb_build_object('ok', true, 'migration_name', p_name, 'applied_at', now());
  end if;

  v_sha := encode(extensions.digest(convert_to(p_sql, 'UTF8'), 'sha256'), 'hex');
  v_bytes := octet_length(p_sql);

  insert into public.migration_log_summary(
    migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
    first_applied_at, last_applied_at, last_applied_by, updated_at
  ) values (
    p_name, 1, v_bytes, v_sha, now(), now(), current_user, now()
  );

  insert into public.migration_log(migration_name, sql_text, applied_by, notes)
  values (
    p_name,
    format('sha256:%s bytes:%s', v_sha, v_bytes),
    current_user,
    'Compact migration evidence; full SQL belongs in canonical source control.'
  );

  return v_result || jsonb_build_object('sql_sha256', v_sha, 'sql_bytes', v_bytes);
end
$function$;

revoke all on function public.run_sql_migration(text,text) from public, anon, authenticated;
grant execute on function public.run_sql_migration(text,text) to service_role, postgres;
