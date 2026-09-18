-- D8: pause dormant guest jobs without deleting reports or exhausting retries. Draft, not applied.
CREATE OR REPLACE FUNCTION public.claim_operational_notification_jobs_v2(p_worker_id text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 90, p_guest_reporting_enabled boolean DEFAULT false)
 RETURNS SETOF operational_notification_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;
  return query
  with candidates as (
    select j.job_id
    from public.operational_notification_jobs j
    where (
      (j.status = 'pending' and j.available_at <= now())
      or (j.status = 'leased' and j.leased_until < now())
    )
      and (j.job_type <> 'guest_cleanliness_report' or (p_guest_reporting_enabled is true and exists(select 1 from public.system_settings s where s.setting_key='guest_issues_feature_approved' and s.setting_value='true'::jsonb)))
      and j.attempts < j.max_attempts
    order by j.available_at, j.created_at, j.job_id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 100))
  )
  update public.operational_notification_jobs j
  set status = 'leased',
      attempts = j.attempts + 1,
      leased_at = now(),
      leased_until = now() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 900))),
      lease_token = gen_random_uuid(),
      worker_id = left(p_worker_id, 160),
      updated_at = now()
  from candidates c
  where j.job_id = c.job_id
  returning j.*;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_operational_notification_jobs(p_worker_id text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 90)
RETURNS SETOF public.operational_notification_jobs LANGUAGE sql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
 SELECT * FROM public.claim_operational_notification_jobs_v2(p_worker_id,p_limit,p_lease_seconds,false);
$$;
CREATE OR REPLACE FUNCTION public.pause_guest_notification_job(p_job_id uuid,p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE changed integer;
BEGIN
 UPDATE public.operational_notification_jobs SET status='pending',attempts=greatest(0,attempts-1),
 available_at=now()+interval '5 minutes',leased_at=null,leased_until=null,lease_token=null,worker_id=null,
 updated_at=now()
 WHERE job_id=p_job_id AND lease_token=p_lease_token AND status='leased' AND job_type='guest_cleanliness_report';
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_operational_notification_jobs_v2(text,integer,integer,boolean) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_operational_notification_jobs_v2(text,integer,integer,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.pause_guest_notification_job(uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pause_guest_notification_job(uuid,uuid) TO service_role;
