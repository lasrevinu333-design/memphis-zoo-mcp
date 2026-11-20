-- LOCAL / UNAPPLIED forward candidate, after messenger_direct_reopen_intents_v2.
-- The existing database maintenance owner schedules bounded expired-only cleanup.
-- No message/thread/history deletion or new credential/role is introduced.
-- The hourly cadence was retained from the existing R14/R18 maintenance plan.
-- Run in the existing exclusive release/maintenance window. The advisory key
-- serializes this source's executions; it is not a lock on out-of-band admins.
do $maintenance$
declare
  expected_name constant text := 'custodial_messenger_direct_intent_cleanup_v2';
  expected_schedule constant text := '0 * * * *';
  expected_command constant text := 'BEGIN; SET LOCAL statement_timeout = ''8s''; SELECT public.msg_cleanup_direct_open_intents(1000); COMMIT;';
  existing_count integer;
  existing_job record;
  scheduled_id bigint;
begin
  if current_user <> 'postgres' then
    raise exception using errcode='42501', message='Existing database maintenance owner is required';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regprocedure('public.msg_cleanup_direct_open_intents(integer)') is null then
    raise exception using errcode='55000', message='Reviewed Messenger maintenance dependencies are required';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('custodial-messenger-direct-intent-maintenance:v2',0)) then
    raise exception using errcode='40001', message='Messenger maintenance registration is busy';
  end if;
  select count(*) into existing_count from cron.job where jobname=expected_name;
  if existing_count>1 then
    raise exception using errcode='55000', message='Messenger maintenance job identity is ambiguous';
  end if;
  if existing_count=1 then
    select * into existing_job from cron.job where jobname=expected_name;
    if existing_job.username<>current_user or existing_job.database<>current_database()
       or existing_job.schedule<>expected_schedule or existing_job.command<>expected_command
       or existing_job.active is not true then
      raise exception using errcode='55000', message='Existing Messenger maintenance job does not match';
    end if;
    return; -- Exact observed repeat only; no replacement of a mismatched job.
  end if;
  select cron.schedule(expected_name,expected_schedule,expected_command) into scheduled_id;
  select * into existing_job from cron.job where jobid=scheduled_id;
  if existing_job.jobid is null or existing_job.jobname<>expected_name
     or existing_job.username<>current_user or existing_job.database<>current_database()
     or existing_job.schedule<>expected_schedule or existing_job.command<>expected_command
     or existing_job.active is not true then
    raise exception using errcode='55000', message='Messenger maintenance job was not confirmed';
  end if;
end
$maintenance$;
