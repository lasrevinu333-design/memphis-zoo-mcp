-- Render Starter is always on, so the Free-tier warm bridge is no longer part
-- of the production availability foundation. Keep the historical job record
-- and run history, but deactivate the recurring request deterministically.

do $deactivate_availability_bridge$
declare
  v_job_id bigint;
begin
  if to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null then
    raise exception 'pg_cron alter_job function is required to retire the availability bridge';
  end if;

  select jobid
    into v_job_id
  from cron.job
  where jobname = 'mz-render-availability-warm-bridge';

  if v_job_id is not null then
    perform cron.alter_job(
      job_id := v_job_id,
      active := false
    );
  end if;
end
$deactivate_availability_bridge$;
