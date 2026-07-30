-- Temporary availability bridge while the Render web service remains on the
-- Free instance type. This is deliberately lightweight and reversible; move
-- the service to an always-on paid instance for production and then deactivate
-- this job through cron.alter_job.

do $availability_bridge$
declare
  v_job_id bigint;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron schedule function is required for the availability bridge';
  end if;
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then
    raise exception 'pg_net http_get function is required for the availability bridge';
  end if;

  v_job_id := cron.schedule(
    'mz-render-availability-warm-bridge',
    '*/10 * * * *',
    $command$
      select net.http_get(
        url := 'https://memphis-zoo-mcp.onrender.com/health',
        params := jsonb_build_object('probe', 'supabase-cron'),
        headers := jsonb_build_object('User-Agent', 'memphis-zoo-availability-bridge/1.0'),
        timeout_milliseconds := 4000
      ) as request_id;
    $command$
  );
  perform cron.alter_job(v_job_id, null, null, null, null, true);
end
$availability_bridge$;
