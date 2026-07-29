-- Audit 3: make controlled Gemini repairs lease-driven and close the one
-- operational GPS coordinate gap. Backup/restore tooling lives in scripts/
-- because object bytes cannot be transactionally stored in PostgreSQL.

create table if not exists public.gemini_console_worker_heartbeats (
  worker_id text primary key,
  available boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  release_id text,
  backend_commit text,
  last_seen_at timestamptz not null default now()
);

alter table public.gemini_console_worker_heartbeats enable row level security;
alter table public.gemini_console_worker_heartbeats force row level security;
revoke all on table public.gemini_console_worker_heartbeats from public, anon, authenticated;
grant select, insert, update, delete on table public.gemini_console_worker_heartbeats to postgres, service_role;

alter table public.gemini_console_repair_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_token uuid,
  add column if not exists leased_until timestamptz,
  add column if not exists attempt_count integer not null default 0;

create index if not exists idx_gemini_console_repair_jobs_claim
  on public.gemini_console_repair_jobs(status, leased_until, authorized_at)
  where execution_mode = 'controlled_worker'
    and status in ('authorized','backing_up','repairing','testing','deploying','verifying');

create or replace function public.gemini_console_require_live_worker()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.execution_mode = 'controlled_worker' and not exists (
    select 1
    from public.gemini_console_worker_heartbeats h
    where h.available
      and h.last_seen_at >= clock_timestamp() - interval '90 seconds'
  ) then
    raise exception 'controlled repair worker is not currently available';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_gemini_console_require_live_worker on public.gemini_console_repair_jobs;
create trigger trg_gemini_console_require_live_worker
before insert on public.gemini_console_repair_jobs
for each row execute function public.gemini_console_require_live_worker();

create or replace function public.gemini_console_worker_heartbeat(
  p_worker_id text,
  p_available boolean,
  p_capabilities jsonb,
  p_release_id text,
  p_backend_commit text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_row public.gemini_console_worker_heartbeats%rowtype;
begin
  if nullif(btrim(coalesce(p_worker_id,'')),'') is null then raise exception 'worker id is required'; end if;
  insert into public.gemini_console_worker_heartbeats(
    worker_id, available, capabilities, release_id, backend_commit, last_seen_at
  ) values (
    left(btrim(p_worker_id),200), coalesce(p_available,false), coalesce(p_capabilities,'{}'::jsonb),
    nullif(btrim(coalesce(p_release_id,'')),''), nullif(btrim(coalesce(p_backend_commit,'')),''), clock_timestamp()
  )
  on conflict (worker_id) do update set
    available=excluded.available, capabilities=excluded.capabilities,
    release_id=excluded.release_id, backend_commit=excluded.backend_commit,
    last_seen_at=excluded.last_seen_at
  returning * into v_row;
  return to_jsonb(v_row);
end
$function$;

create or replace function public.gemini_console_claim_repair_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 300
) returns setof public.gemini_console_repair_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
begin
  if not exists (
    select 1 from public.gemini_console_worker_heartbeats h
    where h.worker_id=left(btrim(coalesce(p_worker_id,'')),200)
      and h.available and h.last_seen_at >= clock_timestamp() - interval '90 seconds'
  ) then raise exception 'live worker heartbeat is required'; end if;

  return query
  with candidates as (
    select j.repair_job_id
    from public.gemini_console_repair_jobs j
    where j.execution_mode='controlled_worker'
      and (
        j.status='authorized'
        or (j.status in ('backing_up','repairing','testing','deploying','verifying') and j.leased_until < clock_timestamp())
      )
    order by j.authorized_at, j.repair_job_id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,1),10))
  ), claimed as (
    update public.gemini_console_repair_jobs j
    set status='backing_up',
        lease_owner=left(btrim(p_worker_id),200),
        lease_token=gen_random_uuid(),
        leased_until=clock_timestamp() + make_interval(secs => greatest(60,least(coalesce(p_lease_seconds,300),1800))),
        attempt_count=j.attempt_count+1,
        started_at=coalesce(j.started_at,clock_timestamp()),
        updated_at=clock_timestamp(),
        error_code=null,
        error_message=null
    from candidates c
    where j.repair_job_id=c.repair_job_id
    returning j.*
  )
  select * from claimed;
end
$function$;

create or replace function public.gemini_console_record_repair_backup(
  p_repair_job_id uuid,
  p_lease_token uuid,
  p_backup_reference text,
  p_backup_evidence jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_job public.gemini_console_repair_jobs%rowtype;
begin
  if nullif(btrim(coalesce(p_backup_reference,'')),'') is null then raise exception 'backup reference is required'; end if;
  update public.gemini_console_repair_jobs
  set status='repairing', backup_reference=left(btrim(p_backup_reference),1000),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('backup_evidence',coalesce(p_backup_evidence,'{}'::jsonb)),
      leased_until=clock_timestamp()+interval '30 minutes', updated_at=clock_timestamp()
  where repair_job_id=p_repair_job_id and lease_token=p_lease_token
    and status='backing_up' and leased_until >= clock_timestamp()
  returning * into v_job;
  if not found then raise exception 'active backup lease is required'; end if;
  insert into public.gemini_console_repair_job_events(repair_job_id,event_type,status,correlation_id,detail_json)
  values(v_job.repair_job_id,'backup_completed',v_job.status,gen_random_uuid(),coalesce(p_backup_evidence,'{}'::jsonb));
  return to_jsonb(v_job);
end
$function$;

create or replace function public.gemini_console_finish_repair_job(
  p_repair_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_branch_name text default null,
  p_changed_files jsonb default '[]'::jsonb,
  p_test_evidence jsonb default '[]'::jsonb,
  p_migration_evidence jsonb default '[]'::jsonb,
  p_deployment_evidence jsonb default '[]'::jsonb,
  p_verification_evidence jsonb default '[]'::jsonb,
  p_rollback_evidence jsonb default '[]'::jsonb,
  p_error_code text default null,
  p_error_message text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_job public.gemini_console_repair_jobs%rowtype;
begin
  if p_status not in ('completed','failed','rolled_back','blocked','cancelled') then raise exception 'invalid terminal repair status'; end if;
  if p_status='completed' and (
    jsonb_typeof(coalesce(p_test_evidence,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_test_evidence,'[]'::jsonb))=0
    or jsonb_typeof(coalesce(p_verification_evidence,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_verification_evidence,'[]'::jsonb))=0
  ) then raise exception 'completed repair requires test and verification evidence'; end if;
  update public.gemini_console_repair_jobs
  set status=p_status, branch_name=nullif(btrim(coalesce(p_branch_name,'')),''),
      changed_files=coalesce(p_changed_files,'[]'::jsonb), test_evidence=coalesce(p_test_evidence,'[]'::jsonb),
      migration_evidence=coalesce(p_migration_evidence,'[]'::jsonb), deployment_evidence=coalesce(p_deployment_evidence,'[]'::jsonb),
      verification_evidence=coalesce(p_verification_evidence,'[]'::jsonb), rollback_evidence=coalesce(p_rollback_evidence,'[]'::jsonb),
      error_code=nullif(left(coalesce(p_error_code,''),80),''), error_message=nullif(left(coalesce(p_error_message,''),1000),''),
      finished_at=clock_timestamp(), updated_at=clock_timestamp(), lease_owner=null, lease_token=null, leased_until=null
  where repair_job_id=p_repair_job_id and lease_token=p_lease_token
    and backup_reference is not null and leased_until >= clock_timestamp()
  returning * into v_job;
  if not found then raise exception 'active repair lease with completed backup is required'; end if;
  insert into public.gemini_console_repair_job_events(repair_job_id,event_type,status,correlation_id,detail_json)
  values(v_job.repair_job_id,'repair_finished',v_job.status,gen_random_uuid(),jsonb_build_object('changed_files',v_job.changed_files));
  return to_jsonb(v_job);
end
$function$;

create or replace function public.gemini_console_fail_repair_job(
  p_repair_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_rollback_evidence jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_job public.gemini_console_repair_jobs%rowtype;
begin
  update public.gemini_console_repair_jobs
  set status='failed', error_code=left(coalesce(nullif(btrim(p_error_code),''),'controlled_worker_failed'),80),
      error_message=left(coalesce(nullif(btrim(p_error_message),''),'Controlled repair failed.'),1000),
      rollback_evidence=coalesce(p_rollback_evidence,'[]'::jsonb),
      finished_at=clock_timestamp(), updated_at=clock_timestamp(), lease_owner=null, lease_token=null, leased_until=null
  where repair_job_id=p_repair_job_id and lease_token=p_lease_token and leased_until >= clock_timestamp()
  returning * into v_job;
  if not found then raise exception 'active repair lease is required'; end if;
  insert into public.gemini_console_repair_job_events(repair_job_id,event_type,status,correlation_id,detail_json)
  values(v_job.repair_job_id,'repair_failed',v_job.status,gen_random_uuid(),jsonb_build_object('error_code',v_job.error_code));
  return to_jsonb(v_job);
end
$function$;

revoke all on function public.gemini_console_require_live_worker() from public, anon, authenticated;
revoke all on function public.gemini_console_worker_heartbeat(text,boolean,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.gemini_console_claim_repair_jobs(text,integer,integer) from public, anon, authenticated;
revoke all on function public.gemini_console_record_repair_backup(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.gemini_console_finish_repair_job(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.gemini_console_fail_repair_job(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.gemini_console_worker_heartbeat(text,boolean,jsonb,text,text) to postgres, service_role;
grant execute on function public.gemini_console_claim_repair_jobs(text,integer,integer) to postgres, service_role;
grant execute on function public.gemini_console_record_repair_backup(uuid,uuid,text,jsonb) to postgres, service_role;
grant execute on function public.gemini_console_finish_repair_job(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) to postgres, service_role;
grant execute on function public.gemini_console_fail_repair_job(uuid,uuid,text,text,jsonb) to postgres, service_role;

-- Cat Country is the only active, historically scanned location without a
-- direct or group coordinate. The point is the mapped Cat Country attraction
-- centroid (OpenStreetMap node 1240762017), recorded with explicit provenance.
insert into public.location_proximity_settings(
  location_id, latitude, longitude, coordinate_source, coordinate_confidence, notes, active, updated_at
)
select l.id, 35.15053, -89.99514,
       'openstreetmap:node:1240762017', 'mapped_attraction_centroid',
       'Audit 3 GPS coverage repair; verify against an on-site reading before using a tighter radius.', true, now()
from public.locations l
where l.location_code='CATX' and l.active
on conflict (location_id) do update set
  latitude=excluded.latitude, longitude=excluded.longitude,
  coordinate_source=excluded.coordinate_source,
  coordinate_confidence=excluded.coordinate_confidence,
  notes=excluded.notes, active=true, updated_at=now();
