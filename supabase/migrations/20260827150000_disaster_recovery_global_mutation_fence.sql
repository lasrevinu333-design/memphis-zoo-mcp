-- Every application mutation owns the shared side of one PostgreSQL
-- transaction fence. Disaster restore takes the exclusive side before it
-- pauses admission, so already-admitted work drains before any snapshot or
-- truncate and later work observes the paused generation before changing data.

create or replace function custodial_dr.acquire_application_mutation_fence()
returns bigint
language plpgsql
volatile
security definer
set search_path = pg_catalog, custodial_dr
as $$
declare
  v_generation bigint;
  v_paused boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('memphis-zoo-application-mutation-fence', 0)
  );
  select authority_generation, mutations_paused
  into v_generation, v_paused
  from custodial_dr.restore_control
  where singleton = true;
  if v_generation is null then
    raise exception using errcode = '55000', message = 'disaster recovery mutation authority is unavailable';
  end if;
  if v_paused then
    raise exception using errcode = '55000', message = 'disaster recovery is in progress; application mutations are paused';
  end if;
  return v_generation;
end
$$;

create table if not exists custodial_dr.application_mutation_leases (
  request_id uuid primary key,
  authority_generation bigint not null check (authority_generation >= 0),
  service_name text not null check (length(btrim(service_name)) between 1 and 120),
  admitted_at timestamptz not null default clock_timestamp(),
  heartbeat_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '3 minutes'),
  constraint application_mutation_lease_expiry_order check (expires_at > admitted_at)
);

revoke all on table custodial_dr.application_mutation_leases from public, anon, authenticated, service_role;
grant select, insert, delete on table custodial_dr.application_mutation_leases to postgres;

create table if not exists custodial_dr.application_mutation_lease_reconciliations (
  reconciliation_id uuid primary key,
  authority_generation bigint not null check (authority_generation >= 0),
  restore_id uuid,
  intent_sha256 text not null unique check (intent_sha256 ~ '^[0-9a-f]{64}$'),
  actor text not null check (length(btrim(actor)) between 2 and 160),
  leases_json jsonb not null check (jsonb_typeof(leases_json) = 'array'),
  evidence_json jsonb not null check (jsonb_typeof(evidence_json) = 'object'),
  recorded_at timestamptz not null default clock_timestamp()
);

revoke all on table custodial_dr.application_mutation_lease_reconciliations from public, anon, authenticated, service_role;
grant select, insert on table custodial_dr.application_mutation_lease_reconciliations to postgres;

alter table custodial_dr.restore_manifests
  add column if not exists reconciliation_manifest_sha256 text
  check (reconciliation_manifest_sha256 is null or reconciliation_manifest_sha256 ~ '^[0-9a-f]{64}$');

create or replace function public.custodial_begin_application_mutation()
returns bigint
language sql
volatile
security definer
set search_path = pg_catalog, custodial_dr
as $$
  select custodial_dr.acquire_application_mutation_fence()
$$;

revoke all on function custodial_dr.acquire_application_mutation_fence() from public, anon, authenticated, service_role;
revoke all on function public.custodial_begin_application_mutation() from public, anon, authenticated;
grant execute on function public.custodial_begin_application_mutation() to postgres, service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'static_weekly_control_plane') then
    grant execute on function public.custodial_begin_application_mutation() to static_weekly_control_plane;
  end if;
end
$$;

create or replace function public.custodial_begin_application_mutation_lease(
  p_request_id uuid,
  p_service_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, custodial_dr
as $$
declare
  v_generation bigint;
  v_paused boolean;
begin
  if p_request_id is null or length(btrim(coalesce(p_service_name, ''))) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'application mutation lease identity is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('memphis-zoo-application-mutation-admission', 0)
  );
  select authority_generation,mutations_paused into v_generation,v_paused
  from custodial_dr.restore_control where singleton=true;
  if v_generation is null then
    raise exception using errcode = '55000', message = 'disaster recovery mutation authority is unavailable';
  end if;
  if v_paused then
    raise exception using errcode = '55000', message = 'disaster recovery is in progress; application mutations are paused';
  end if;
  insert into custodial_dr.application_mutation_leases(
    request_id,authority_generation,service_name,admitted_at,heartbeat_at,expires_at
  ) values (
    p_request_id,v_generation,btrim(p_service_name),clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '3 minutes'
  );
  return jsonb_build_object(
    'request_id',p_request_id,
    'authority_generation',v_generation,
    'mutations_paused',false,
    'expires_at',(select expires_at from custodial_dr.application_mutation_leases where request_id=p_request_id)
  );
end
$$;

comment on table custodial_dr.application_mutation_leases is
  'Fail-closed external-mutation leases. Expired rows are retained as recovery blockers until an exact named reconciliation proves the owning operation cannot still mutate external state.';

create or replace function public.custodial_heartbeat_application_mutation_lease(p_request_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, custodial_dr
as $$
declare
  v_updated integer;
begin
  update custodial_dr.application_mutation_leases
  set heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '3 minutes'
  where request_id=p_request_id and expires_at>clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end
$$;

create or replace function public.custodial_release_application_mutation_lease(p_request_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, custodial_dr
as $$
declare
  v_deleted integer;
begin
  delete from custodial_dr.application_mutation_leases where request_id=p_request_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end
$$;

revoke all on function public.custodial_begin_application_mutation_lease(uuid,text) from public, anon, authenticated;
revoke all on function public.custodial_heartbeat_application_mutation_lease(uuid) from public, anon, authenticated;
revoke all on function public.custodial_release_application_mutation_lease(uuid) from public, anon, authenticated;
grant execute on function public.custodial_begin_application_mutation_lease(uuid,text) to postgres, service_role;
grant execute on function public.custodial_heartbeat_application_mutation_lease(uuid) to postgres, service_role;
grant execute on function public.custodial_release_application_mutation_lease(uuid) to postgres, service_role;

create or replace function custodial_dr.guard_application_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, custodial_dr
as $$
begin
  perform custodial_dr.acquire_application_mutation_fence();
  return null;
end
$$;

revoke all on function custodial_dr.guard_application_mutation() from public, anon, authenticated, service_role;

create or replace function custodial_dr.install_application_mutation_fences()
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, custodial_dr
as $$
declare
  v_table record;
begin
  for v_table in
    select n.nspname schema_name, c.relname table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth')
      and c.relkind in ('r', 'p')
      and not exists (
        select 1 from pg_catalog.pg_trigger t
        where t.tgrelid = c.oid
          and t.tgname = 'custodial_disaster_restore_mutation_fence'
          and not t.tgisinternal
      )
    order by n.nspname, c.relname
  loop
    execute format(
      'create trigger custodial_disaster_restore_mutation_fence before insert or update or delete or truncate on %I.%I for each statement execute function custodial_dr.guard_application_mutation()',
      v_table.schema_name,
      v_table.table_name
    );
  end loop;
end
$$;

revoke all on function custodial_dr.install_application_mutation_fences() from public, anon, authenticated, service_role;

select custodial_dr.install_application_mutation_fences();

create or replace function custodial_dr.guard_application_ddl()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog, custodial_dr
as $$
begin
  perform custodial_dr.acquire_application_mutation_fence();
end
$$;

revoke all on function custodial_dr.guard_application_ddl() from public, anon, authenticated, service_role;

drop event trigger if exists custodial_dr_guard_application_ddl;
create event trigger custodial_dr_guard_application_ddl
on ddl_command_start
execute function custodial_dr.guard_application_ddl();

create or replace function custodial_dr.install_application_mutation_fences_after_ddl()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog, custodial_dr
as $$
begin
  perform custodial_dr.install_application_mutation_fences();
end
$$;

drop event trigger if exists custodial_dr_install_application_mutation_fences;
create event trigger custodial_dr_install_application_mutation_fences
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'ALTER TABLE')
execute function custodial_dr.install_application_mutation_fences_after_ddl();

comment on function public.custodial_begin_application_mutation() is
  'Acquires the shared disaster-restore generation fence for the complete caller transaction; separately deployed writers call this immediately after BEGIN.';
comment on table custodial_dr.application_mutation_leases is
  'In-flight external API work admitted under a restore generation. Heartbeats keep live work visible; abandoned leases expire after three minutes.';
comment on function custodial_dr.guard_application_mutation() is
  'Statement trigger that fail-closes public/auth DML while disaster restore owns the exclusive generation fence; external Storage writers require an application lease.';

-- The public-ingest limiter writes through the bounded operational-command
-- RPC, but the general application reader is intentionally denied direct
-- visibility into the FORCE-RLS bucket table. Expose only the one count bound
-- to the already HMAC-pseudonymized key and declared scope so a healthy first
-- submission is not misclassified as an unavailable/over-limit bucket.
create or replace function public.app_get_public_rate_limit_count(
  p_bucket_key text,
  p_scope text
)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if coalesce(p_bucket_key,'') !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_scope,''))) not between 1 and 80 then
    raise exception using errcode='22023', message='bounded rate-limit key and scope are required';
  end if;
  select request_count into v_count
  from public.public_submission_rate_limits
  where bucket_key=p_bucket_key and scope=btrim(p_scope);
  return coalesce(v_count,0);
end
$$;

revoke all on function public.app_get_public_rate_limit_count(text,text) from public,anon,authenticated,service_role;
grant execute on function public.app_get_public_rate_limit_count(text,text) to custodial_application_reader;

comment on function public.app_get_public_rate_limit_count(text,text) is
  'Returns only the current count for one HMAC-pseudonymized public-ingest bucket; the application reader retains no direct rate-limit table visibility.';
