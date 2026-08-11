-- Integrated I2 scheduler authority. Re-authors final I1 database semantics after backend phase E.
-- Additive immutable authority for the repeating Memphis custodial weekly plan.
-- This migration deliberately does not alter legacy daily schedule tables or
-- mount a runtime path.  The static_weekly_* RPCs are the sole write seam for
-- a later adapter and are intentionally not granted to browser roles here.

begin;

create extension if not exists pgcrypto;

create or replace function public.static_weekly_digest_text(p_value text)
returns text language plpgsql stable strict security definer set search_path = pg_catalog, public as $function$
declare
  v_extension_schema text;
  v_digest text;
begin
  select namespace.nspname into v_extension_schema
  from pg_extension extension
  join pg_namespace namespace on namespace.oid=extension.extnamespace
  where extension.extname='pgcrypto';
  if v_extension_schema not in ('extensions','public') then
    raise exception using errcode='55000', message='pgcrypto must be installed in the accepted extensions or public schema';
  end if;
  execute format('select encode(%I.digest(convert_to($1, ''UTF8''), ''sha256''), ''hex'')',v_extension_schema)
    into v_digest using p_value;
  return v_digest;
end
$function$;
revoke all on function public.static_weekly_digest_text(text) from public, anon, authenticated, service_role;

create table if not exists public.static_weekly_schedule_control (
  singleton boolean primary key default true check (singleton),
  current_revision bigint not null default 0 check (current_revision >= 0),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by_manager_id uuid,
  updated_by_manager_name_snapshot text not null default 'system'
);
insert into public.static_weekly_schedule_control(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.weekly_schedule_versions (
  version_id uuid primary key default gen_random_uuid(),
  version_number bigint unique,
  lifecycle_state text not null check (lifecycle_state in ('draft','published')),
  publication_kind text not null default 'publish' check (publication_kind in ('publish','supersede','rollback_compensation')),
  draft_of_version_id uuid references public.weekly_schedule_versions(version_id) on delete restrict,
  rollback_of_version_id uuid references public.weekly_schedule_versions(version_id) on delete restrict,
  effective_start date not null,
  revision bigint not null default 1 check (revision > 0),
  objective_version text not null,
  objective_json jsonb not null default '{}'::jsonb,
  input_provenance_json jsonb not null default '{}'::jsonb,
  draft_document jsonb not null default '{}'::jsonb,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_by_manager_id uuid not null,
  created_by_manager_name_snapshot text not null check (length(btrim(created_by_manager_name_snapshot)) > 0),
  created_at timestamptz not null default statement_timestamp(),
  published_by_manager_id uuid,
  published_by_manager_name_snapshot text,
  published_at timestamptz,
  check ((lifecycle_state = 'draft' and version_number is null and published_at is null and published_by_manager_id is null)
      or (lifecycle_state = 'published' and version_number is not null and published_at is not null and published_by_manager_id is not null))
);

create table if not exists public.weekly_roster_slots (
  slot_id uuid primary key default gen_random_uuid(),
  slot_code text not null unique check (length(btrim(slot_code)) > 0),
  slot_label text not null check (length(btrim(slot_label)) > 0),
  created_by_manager_id uuid not null,
  created_by_manager_name_snapshot text not null check (length(btrim(created_by_manager_name_snapshot)) > 0),
  created_at timestamptz not null default statement_timestamp(),
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$')
);

create table if not exists public.weekly_roster_slot_incumbencies (
  incumbency_id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.weekly_roster_slots(slot_id) on delete restrict,
  person_id uuid not null,
  person_name_snapshot text not null check (length(btrim(person_name_snapshot)) > 0),
  effective_start date not null,
  effective_end date,
  created_by_manager_id uuid not null,
  created_by_manager_name_snapshot text not null check (length(btrim(created_by_manager_name_snapshot)) > 0),
  created_at timestamptz not null default statement_timestamp(),
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  check (effective_end is null or effective_start < effective_end)
);

create table if not exists public.weekly_schedule_slot_availability (
  availability_id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  slot_id uuid not null references public.weekly_roster_slots(slot_id) on delete restrict,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  availability_state text not null check (availability_state in ('working','departed_named_absent','absent','unavailable')),
  shift_start time,
  shift_end time,
  lunch_start time,
  lunch_end time,
  capacity_units numeric(12,4),
  qualification_snapshot jsonb not null default '[]'::jsonb,
  qualification_provenance jsonb not null default '{}'::jsonb,
  restriction_snapshot jsonb not null default '[]'::jsonb,
  restriction_provenance jsonb not null default '{}'::jsonb,
  slot_label_snapshot text not null check (length(btrim(slot_label_snapshot)) > 0),
  incumbent_person_id_snapshot uuid,
  incumbent_name_snapshot text,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(version_id, slot_id, day_of_week),
  check ((shift_start is null and shift_end is null) or (shift_start is not null and shift_end is not null and shift_start < shift_end)),
  check ((lunch_start is null and lunch_end is null) or (lunch_start is not null and lunch_end is not null and lunch_start < lunch_end)),
  check (availability_state <> 'working' or (shift_start is not null and capacity_units is not null and capacity_units > 0))
);

create table if not exists public.weekly_schedule_slot_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  work_id text not null check (length(btrim(work_id)) > 0),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  location_id uuid,
  location_code_snapshot text not null check (length(btrim(location_code_snapshot)) > 0),
  location_name_snapshot text not null check (length(btrim(location_name_snapshot)) > 0),
  coverage_start time not null,
  coverage_end time not null,
  owner_slot_id uuid references public.weekly_roster_slots(slot_id) on delete restrict,
  owner_slot_label_snapshot text,
  owner_person_id_snapshot uuid,
  owner_name_snapshot text,
  required_qualifications_snapshot jsonb not null default '[]'::jsonb,
  restriction_snapshot jsonb not null default '[]'::jsonb,
  workload_points numeric(14,4) not null check (workload_points > 0),
  workload_provenance jsonb not null default '{}'::jsonb,
  manual_lock boolean not null default false,
  payload_json jsonb not null default '{}'::jsonb,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(version_id, work_id),
  check (coverage_start < coverage_end),
  check ((owner_slot_id is null and owner_slot_label_snapshot is null and owner_person_id_snapshot is null and owner_name_snapshot is null)
      or (owner_slot_id is not null and owner_slot_label_snapshot is not null))
);

create table if not exists public.weekly_schedule_objective_inputs (
  objective_input_id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  input_key text not null check (length(btrim(input_key)) > 0),
  input_value jsonb not null,
  provenance jsonb not null,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default statement_timestamp(),
  captured_by_manager_id uuid not null,
  captured_by_manager_name_snapshot text not null,
  unique(version_id, input_key)
);

create table if not exists public.weekly_schedule_effective_range_closures (
  range_closure_id uuid primary key default gen_random_uuid(),
  closed_version_id uuid not null unique references public.weekly_schedule_versions(version_id) on delete restrict,
  closed_at_effective_date date not null,
  superseding_version_id uuid not null unique references public.weekly_schedule_versions(version_id) on delete restrict,
  publication_id uuid,
  created_by_manager_id uuid not null,
  created_by_manager_name_snapshot text not null,
  created_at timestamptz not null default statement_timestamp(),
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$')
);

create or replace view public.v_weekly_schedule_effective_ranges as
select
  version.version_id,
  version.version_number,
  version.effective_start,
  closure.closed_at_effective_date as effective_end,
  version.publication_kind,
  version.content_digest
from public.weekly_schedule_versions version
left join public.weekly_schedule_effective_range_closures closure on closure.closed_version_id = version.version_id
where version.lifecycle_state = 'published';

create table if not exists public.weekly_schedule_publications (
  publication_id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  authority_revision bigint not null unique check (authority_revision > 0),
  publication_kind text not null check (publication_kind in ('publish','supersede','rollback_compensation')),
  effective_start date not null,
  prior_version_id uuid references public.weekly_schedule_versions(version_id) on delete restrict,
  expected_revision bigint not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null,
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  output_digest text not null check (output_digest ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default statement_timestamp(),
  unique(actor_manager_id, idempotency_key)
);
alter table public.weekly_schedule_effective_range_closures
  drop constraint if exists weekly_schedule_effective_range_closures_publication_id_fkey;
alter table public.weekly_schedule_effective_range_closures
  add constraint weekly_schedule_effective_range_closures_publication_id_fkey foreign key (publication_id) references public.weekly_schedule_publications(publication_id) on delete restrict;

create table if not exists public.weekly_schedule_exception_commands (
  exception_id uuid primary key default gen_random_uuid(),
  authority_revision bigint not null unique check (authority_revision > 0),
  exception_type text not null check (exception_type in ('pto','daily_absence','partial_absence','shift_override','cover_all','lunch','nine_forty_five_rebalance','event_impact','manager_correction','reverse')),
  service_date date not null,
  starts_at time,
  ends_at time,
  base_version_id uuid references public.weekly_schedule_versions(version_id) on delete restrict,
  publication_id uuid references public.weekly_schedule_publications(publication_id) on delete restrict,
  reverses_exception_id uuid references public.weekly_schedule_exception_commands(exception_id) on delete restrict,
  compensation_for_exception_id uuid references public.weekly_schedule_exception_commands(exception_id) on delete restrict,
  expected_revision bigint not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null,
  reason text not null check (length(btrim(reason)) > 0),
  payload_json jsonb not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default statement_timestamp(),
  check ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and starts_at < ends_at)),
  unique(actor_manager_id, idempotency_key)
);

create table if not exists public.weekly_schedule_occurrences (
  occurrence_id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.weekly_schedule_publications(publication_id) on delete restrict,
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  assignment_id uuid references public.weekly_schedule_slot_assignments(assignment_id) on delete restrict,
  service_date date not null,
  work_id text not null,
  location_id uuid,
  location_code_snapshot text not null,
  location_name_snapshot text not null,
  coverage_start time not null,
  coverage_end time not null,
  owner_slot_id uuid references public.weekly_roster_slots(slot_id) on delete restrict,
  owner_slot_label_snapshot text,
  owner_person_id_snapshot uuid,
  owner_name_snapshot text,
  state text not null check (state in ('created','active','satisfied','superseded','cancelled','open','review')),
  state_reason text,
  original_actor_person_id uuid,
  original_actor_name_snapshot text,
  occurrence_digest text not null check (occurrence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(publication_id, service_date, work_id),
  check (coverage_start < coverage_end)
);

create table if not exists public.weekly_schedule_compiled_projections (
  projection_id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.weekly_schedule_publications(publication_id) on delete restrict,
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  service_date date not null,
  exception_set_digest text not null check (exception_set_digest ~ '^[0-9a-f]{64}$'),
  compiler_version text not null,
  objective_json jsonb not null,
  metrics_json jsonb not null,
  replay_digest text not null check (replay_digest ~ '^[0-9a-f]{64}$'),
  compiled_by_manager_id uuid,
  compiled_at timestamptz not null default statement_timestamp(),
  unique(publication_id, service_date, exception_set_digest, compiler_version)
);

create table if not exists public.weekly_schedule_projection_assignments (
  projection_assignment_id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
  occurrence_id uuid references public.weekly_schedule_occurrences(occurrence_id) on delete restrict,
  work_id text not null,
  status text not null check (status in ('assigned','open','review')),
  reason_code text,
  owner_slot_id uuid references public.weekly_roster_slots(slot_id) on delete restrict,
  owner_slot_label_snapshot text,
  owner_person_id_snapshot uuid,
  owner_name_snapshot text,
  explanation_json jsonb not null default '{}'::jsonb,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(projection_id, work_id)
);

create table if not exists public.weekly_schedule_authority_revisions (
  authority_revision bigint primary key check (authority_revision > 0),
  command_id uuid not null unique,
  operation text not null check (operation in ('create_draft','update_draft','publish','supersede','rollback','apply_exception','reverse_exception','materialize_projection')),
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp()
);

create table if not exists public.weekly_schedule_command_receipts (
  command_id uuid primary key default gen_random_uuid(),
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null,
  command_type text not null check (command_type in ('create_draft','update_draft','publish','supersede','rollback','apply_exception','reverse_exception','materialize_projection')),
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  expected_revision bigint not null,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  response_json jsonb not null,
  accepted_at timestamptz not null default statement_timestamp(),
  unique(actor_manager_id, idempotency_key)
);

create index if not exists idx_weekly_schedule_versions_effective_start on public.weekly_schedule_versions(effective_start) where lifecycle_state = 'published';
create index if not exists idx_weekly_schedule_exception_commands_service_date on public.weekly_schedule_exception_commands(service_date, accepted_at, exception_id);
create index if not exists idx_weekly_schedule_occurrences_service_date on public.weekly_schedule_occurrences(service_date, state);

create or replace function public.static_weekly_reject_update_delete()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  raise exception using errcode = '23514', message = format('%s is append-only; %s is forbidden', tg_table_name, tg_op);
end
$function$;

create or replace function public.static_weekly_version_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  if tg_op = 'INSERT' then
    if new.lifecycle_state = 'published' and current_setting('app.static_weekly_publish_command', true) is distinct from 'on' then
      raise exception using errcode = '23514', message = 'published weekly schedule versions may be created only by the atomic publication command';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'weekly schedule versions are immutable';
  end if;
  if old.lifecycle_state = 'published' then
    raise exception using errcode = '23514', message = 'published weekly schedule versions are immutable';
  end if;
  if current_setting('app.static_weekly_draft_command', true) is distinct from 'on'
     or new.lifecycle_state <> 'draft' or new.revision <> old.revision + 1 then
    raise exception using errcode = '23514', message = 'draft versions may change only through a revision-checked command';
  end if;
  return new;
end
$function$;

create or replace function public.static_weekly_draft_component_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_state text;
begin
  select lifecycle_state into v_state from public.weekly_schedule_versions where version_id = coalesce(new.version_id, old.version_id);
  if (current_setting('app.static_weekly_draft_command', true) = 'on' and v_state = 'draft') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if (current_setting('app.static_weekly_publish_command', true) = 'on' and v_state = 'published' and tg_op = 'INSERT') then
    return new;
  end if;
  begin
    raise exception using errcode = '23514', message = 'weekly schedule components may change only through a revision-checked draft command';
  end;
end
$function$;

create or replace function public.static_weekly_range_closure_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_start date;
begin
  if tg_op <> 'INSERT' then raise exception using errcode = '23514', message = 'effective range closures are append-only'; end if;
  if current_setting('app.static_weekly_publish_command', true) is distinct from 'on' then
    raise exception using errcode = '23514', message = 'effective range closures may be created only by the atomic publication command';
  end if;
  select effective_start into v_start from public.weekly_schedule_versions where version_id = new.closed_version_id;
  if v_start is null or new.closed_at_effective_date <= v_start then
    raise exception using errcode = '23514', message = 'effective range closure must end after its version begins';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_static_weekly_versions_immutable on public.weekly_schedule_versions;
create trigger trg_static_weekly_versions_immutable before insert or update or delete on public.weekly_schedule_versions for each row execute function public.static_weekly_version_guard();
drop trigger if exists trg_static_weekly_slots_immutable on public.weekly_roster_slots;
create trigger trg_static_weekly_slots_immutable before update or delete on public.weekly_roster_slots for each row execute function public.static_weekly_reject_update_delete();
drop trigger if exists trg_static_weekly_incumbencies_immutable on public.weekly_roster_slot_incumbencies;
create trigger trg_static_weekly_incumbencies_immutable before update or delete on public.weekly_roster_slot_incumbencies for each row execute function public.static_weekly_reject_update_delete();
drop trigger if exists trg_static_weekly_availability_guard on public.weekly_schedule_slot_availability;
create trigger trg_static_weekly_availability_guard before insert or update or delete on public.weekly_schedule_slot_availability for each row execute function public.static_weekly_draft_component_guard();
drop trigger if exists trg_static_weekly_assignments_guard on public.weekly_schedule_slot_assignments;
create trigger trg_static_weekly_assignments_guard before insert or update or delete on public.weekly_schedule_slot_assignments for each row execute function public.static_weekly_draft_component_guard();
drop trigger if exists trg_static_weekly_objective_inputs_guard on public.weekly_schedule_objective_inputs;
create trigger trg_static_weekly_objective_inputs_guard before insert or update or delete on public.weekly_schedule_objective_inputs for each row execute function public.static_weekly_draft_component_guard();
drop trigger if exists trg_static_weekly_range_closures_guard on public.weekly_schedule_effective_range_closures;
create trigger trg_static_weekly_range_closures_guard before insert or update or delete on public.weekly_schedule_effective_range_closures for each row execute function public.static_weekly_range_closure_guard();

do $triggers$
declare target text;
begin
  foreach target in array array['weekly_schedule_publications','weekly_schedule_exception_commands','weekly_schedule_occurrences','weekly_schedule_compiled_projections','weekly_schedule_projection_assignments','weekly_schedule_authority_revisions','weekly_schedule_command_receipts'] loop
    execute format('drop trigger if exists trg_static_weekly_%I_immutable on public.%I', target, target);
    execute format('create trigger trg_static_weekly_%I_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()', target, target);
  end loop;
end
$triggers$;

create or replace function public.static_weekly_advance_authority(
  p_expected_revision bigint, p_operation text, p_actor_manager_id uuid, p_actor_manager_name text, p_command_id uuid, p_digest text
) returns bigint language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_revision bigint;
begin
  update public.static_weekly_schedule_control
  set current_revision = current_revision + 1,
      updated_at = statement_timestamp(),
      updated_by_manager_id = p_actor_manager_id,
      updated_by_manager_name_snapshot = p_actor_manager_name
  where singleton = true and current_revision = p_expected_revision
  returning current_revision into v_revision;
  if v_revision is null then raise exception using errcode = '40001', message = 'stale expected revision'; end if;
  insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,operation,actor_manager_id,actor_manager_name_snapshot,content_digest)
  values (v_revision,p_command_id,p_operation,p_actor_manager_id,p_actor_manager_name,p_digest);
  return v_revision;
end
$function$;

create or replace function public.static_weekly_create_draft(
  p_effective_start date, p_objective_version text, p_objective jsonb, p_input_provenance jsonb, p_document jsonb,
  p_content_digest text, p_expected_revision bigint, p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_command uuid := gen_random_uuid(); v_version uuid := gen_random_uuid(); v_revision bigint; v_response jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype;
begin
  if p_effective_start is null or btrim(coalesce(p_objective_version,'')) = '' or p_content_digest !~ '^[0-9a-f]{64}$' then raise exception using errcode='23514',message='complete draft authority inputs are required'; end if;
  v_request_digest := public.static_weekly_digest_text(concat_ws('|','create_draft',p_effective_start::text,p_content_digest,p_expected_revision::text));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_digest <> v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if;
    return v_prior.response_json;
  end if;
  v_revision := public.static_weekly_advance_authority(p_expected_revision,'create_draft',p_actor_manager_id,p_actor_manager_name,v_command,p_content_digest);
  insert into public.weekly_schedule_versions(version_id,lifecycle_state,effective_start,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot)
  values(v_version,'draft',p_effective_start,p_objective_version,coalesce(p_objective,'{}'),coalesce(p_input_provenance,'{}'),coalesce(p_document,'{}'),p_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response := jsonb_build_object('version_id',v_version,'revision',v_revision,'draft_revision',1,'effective_start',p_effective_start,'content_digest',p_content_digest);
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,response_json)
  values(v_command,p_actor_manager_id,p_actor_manager_name,'create_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_response);
  return v_response;
end
$function$;

create or replace function public.static_weekly_update_draft(
  p_version_id uuid, p_document jsonb, p_objective jsonb, p_input_provenance jsonb, p_content_digest text,
  p_expected_draft_revision bigint, p_expected_revision bigint, p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_command uuid:=gen_random_uuid(); v_revision bigint; v_response jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype;
begin
  v_request_digest:=public.static_weekly_digest_text(concat_ws('|','update_draft',p_version_id::text,p_content_digest,p_expected_draft_revision::text,p_expected_revision::text));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_prior.response_json; end if;
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  perform 1 from public.weekly_schedule_versions where version_id=p_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update;
  if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'update_draft',p_actor_manager_id,p_actor_manager_name,v_command,p_content_digest);
  perform set_config('app.static_weekly_draft_command','on',true);
  update public.weekly_schedule_versions set draft_document=coalesce(p_document,'{}'),objective_json=coalesce(p_objective,'{}'),input_provenance_json=coalesce(p_input_provenance,'{}'),content_digest=p_content_digest,revision=revision+1 where version_id=p_version_id;
  delete from public.weekly_schedule_slot_availability where version_id=p_version_id;
  delete from public.weekly_schedule_slot_assignments where version_id=p_version_id;
  delete from public.weekly_schedule_objective_inputs where version_id=p_version_id;
  insert into public.weekly_schedule_slot_availability(version_id,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest)
  select p_version_id,x.slot_id,x.day_of_week,x.availability_state,x.shift_start,x.shift_end,x.lunch_start,x.lunch_end,x.capacity_units,coalesce(x.qualification_snapshot,'[]'),coalesce(x.qualification_provenance,'{}'),coalesce(x.restriction_snapshot,'[]'),coalesce(x.restriction_provenance,'{}'),x.slot_label_snapshot,x.incumbent_person_id_snapshot,x.incumbent_name_snapshot,coalesce(x.content_digest,p_content_digest)
  from jsonb_to_recordset(coalesce(p_document->'slot_availability','[]'::jsonb)) as x(slot_id uuid,day_of_week smallint,availability_state text,shift_start time,shift_end time,lunch_start time,lunch_end time,capacity_units numeric,qualification_snapshot jsonb,qualification_provenance jsonb,restriction_snapshot jsonb,restriction_provenance jsonb,slot_label_snapshot text,incumbent_person_id_snapshot uuid,incumbent_name_snapshot text,content_digest text);
  insert into public.weekly_schedule_slot_assignments(version_id,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,required_qualifications_snapshot,restriction_snapshot,workload_points,workload_provenance,manual_lock,payload_json,content_digest)
  select p_version_id,x.work_id,x.day_of_week,x.location_id,x.location_code_snapshot,x.location_name_snapshot,x.coverage_start,x.coverage_end,x.owner_slot_id,x.owner_slot_label_snapshot,x.owner_person_id_snapshot,x.owner_name_snapshot,coalesce(x.required_qualifications_snapshot,'[]'),coalesce(x.restriction_snapshot,'[]'),x.workload_points,coalesce(x.workload_provenance,'{}'),coalesce(x.manual_lock,false),coalesce(x.payload_json,'{}'),coalesce(x.content_digest,p_content_digest)
  from jsonb_to_recordset(coalesce(p_document->'assignments','[]'::jsonb)) as x(work_id text,day_of_week smallint,location_id uuid,location_code_snapshot text,location_name_snapshot text,coverage_start time,coverage_end time,owner_slot_id uuid,owner_slot_label_snapshot text,owner_person_id_snapshot uuid,owner_name_snapshot text,required_qualifications_snapshot jsonb,restriction_snapshot jsonb,workload_points numeric,workload_provenance jsonb,manual_lock boolean,payload_json jsonb,content_digest text);
  insert into public.weekly_schedule_objective_inputs(version_id,input_key,input_value,provenance,content_digest,captured_by_manager_id,captured_by_manager_name_snapshot)
  select p_version_id,x.input_key,x.input_value,x.provenance,coalesce(x.content_digest,p_content_digest),p_actor_manager_id,p_actor_manager_name
  from jsonb_to_recordset(coalesce(p_document->'objective_inputs','[]'::jsonb)) as x(input_key text,input_value jsonb,provenance jsonb,content_digest text);
  v_response:=jsonb_build_object('version_id',p_version_id,'revision',v_revision,'draft_revision',p_expected_draft_revision+1,'content_digest',p_content_digest);
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,response_json) values(v_command,p_actor_manager_id,p_actor_manager_name,'update_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_response);
  return v_response;
end
$function$;

create or replace function public.static_weekly_publish_draft(
  p_draft_version_id uuid, p_expected_draft_revision bigint, p_expected_revision bigint, p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text, p_publication_kind text default 'publish', p_rollback_of_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_draft public.weekly_schedule_versions%rowtype; v_prior public.weekly_schedule_command_receipts%rowtype; v_command uuid:=gen_random_uuid(); v_published uuid:=gen_random_uuid(); v_publication uuid:=gen_random_uuid(); v_prior_version uuid; v_revision bigint; v_response jsonb; v_request_digest text; v_version_number bigint;
begin
  if p_publication_kind not in ('publish','supersede','rollback_compensation') then raise exception using errcode='23514',message='invalid publication kind'; end if;
  v_request_digest:=public.static_weekly_digest_text(concat_ws('|','publish',p_draft_version_id::text,p_expected_draft_revision::text,p_expected_revision::text,p_publication_kind,coalesce(p_rollback_of_version_id::text,'')));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_prior.response_json; end if;
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_draft from public.weekly_schedule_versions where version_id=p_draft_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update;
  if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  select version_id into v_prior_version from public.weekly_schedule_versions where lifecycle_state='published' order by effective_start desc, version_number desc limit 1;
  if v_prior_version is not null and v_draft.effective_start <= (select effective_start from public.weekly_schedule_versions where version_id=v_prior_version) then raise exception using errcode='23514',message='new immutable version must supersede at a later effective date'; end if;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,case when p_publication_kind='rollback_compensation' then 'rollback' when p_publication_kind='supersede' then 'supersede' else 'publish' end,p_actor_manager_id,p_actor_manager_name,v_command,v_draft.content_digest);
  select coalesce(max(version_number),0)+1 into v_version_number from public.weekly_schedule_versions where lifecycle_state='published';
  perform set_config('app.static_weekly_publish_command','on',true);
  insert into public.weekly_schedule_versions(version_id,version_number,lifecycle_state,publication_kind,draft_of_version_id,rollback_of_version_id,effective_start,revision,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot,published_by_manager_id,published_by_manager_name_snapshot,published_at)
  values(v_published,v_version_number,'published',p_publication_kind,v_draft.version_id,p_rollback_of_version_id,v_draft.effective_start,1,v_draft.objective_version,v_draft.objective_json,v_draft.input_provenance_json,v_draft.draft_document,v_draft.content_digest,p_actor_manager_id,p_actor_manager_name,p_actor_manager_id,p_actor_manager_name,statement_timestamp());
  insert into public.weekly_schedule_slot_availability(version_id,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest)
  select v_published,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest from public.weekly_schedule_slot_availability where version_id=v_draft.version_id;
  insert into public.weekly_schedule_slot_assignments(version_id,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,required_qualifications_snapshot,restriction_snapshot,workload_points,workload_provenance,manual_lock,payload_json,content_digest)
  select v_published,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,required_qualifications_snapshot,restriction_snapshot,workload_points,workload_provenance,manual_lock,payload_json,content_digest from public.weekly_schedule_slot_assignments where version_id=v_draft.version_id;
  insert into public.weekly_schedule_objective_inputs(version_id,input_key,input_value,provenance,content_digest,captured_by_manager_id,captured_by_manager_name_snapshot)
  select v_published,input_key,input_value,provenance,content_digest,captured_by_manager_id,captured_by_manager_name_snapshot from public.weekly_schedule_objective_inputs where version_id=v_draft.version_id;
  insert into public.weekly_schedule_publications(publication_id,version_id,authority_revision,publication_kind,effective_start,prior_version_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,input_digest,output_digest)
  values(v_publication,v_published,v_revision,p_publication_kind,v_draft.effective_start,v_prior_version,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,v_draft.content_digest,v_draft.content_digest);
  if v_prior_version is not null then
    insert into public.weekly_schedule_effective_range_closures(closed_version_id,closed_at_effective_date,superseding_version_id,publication_id,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
    values(v_prior_version,v_draft.effective_start,v_published,v_publication,p_actor_manager_id,p_actor_manager_name,v_draft.content_digest);
  end if;
  v_response:=jsonb_build_object('version_id',v_published,'version_number',v_version_number,'publication_id',v_publication,'revision',v_revision,'effective_start',v_draft.effective_start,'content_digest',v_draft.content_digest);
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,response_json)
  values(v_command,p_actor_manager_id,p_actor_manager_name,case when p_publication_kind='rollback_compensation' then 'rollback' when p_publication_kind='supersede' then 'supersede' else 'publish' end,p_idempotency_key,p_expected_revision,v_request_digest,v_response);
  return v_response;
end
$function$;

create or replace function public.static_weekly_apply_exception(
  p_exception_type text, p_service_date date, p_starts_at time, p_ends_at time, p_base_version_id uuid, p_publication_id uuid, p_reason text, p_payload jsonb, p_payload_digest text,
  p_expected_revision bigint, p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text, p_reverses_exception_id uuid default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_command uuid:=gen_random_uuid(); v_exception uuid:=gen_random_uuid(); v_revision bigint; v_response jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype;
begin
  if p_exception_type not in ('pto','daily_absence','partial_absence','shift_override','cover_all','lunch','nine_forty_five_rebalance','event_impact','manager_correction','reverse') then raise exception using errcode='23514',message='invalid exception type'; end if;
  if p_service_date is null or btrim(coalesce(p_reason,''))='' or p_payload_digest !~ '^[0-9a-f]{64}$' then raise exception using errcode='23514',message='complete exception authority inputs are required'; end if;
  v_request_digest:=public.static_weekly_digest_text(concat_ws('|','exception',p_exception_type,p_service_date::text,p_payload_digest,p_expected_revision::text,coalesce(p_reverses_exception_id::text,'')));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_prior.response_json; end if;
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,case when p_exception_type='reverse' then 'reverse_exception' else 'apply_exception' end,p_actor_manager_id,p_actor_manager_name,v_command,p_payload_digest);
  insert into public.weekly_schedule_exception_commands(exception_id,authority_revision,exception_type,service_date,starts_at,ends_at,base_version_id,publication_id,reverses_exception_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,reason,payload_json,payload_digest)
  values(v_exception,v_revision,p_exception_type,p_service_date,p_starts_at,p_ends_at,p_base_version_id,p_publication_id,p_reverses_exception_id,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,p_reason,coalesce(p_payload,'{}'),p_payload_digest);
  v_response:=jsonb_build_object('exception_id',v_exception,'revision',v_revision,'exception_type',p_exception_type,'service_date',p_service_date,'payload_digest',p_payload_digest);
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,response_json)
  values(v_command,p_actor_manager_id,p_actor_manager_name,case when p_exception_type='reverse' then 'reverse_exception' else 'apply_exception' end,p_idempotency_key,p_expected_revision,v_request_digest,v_response);
  return v_response;
end
$function$;

create or replace function public.static_weekly_effective_version(p_service_date date)
returns uuid language sql stable security definer set search_path = pg_catalog, public as $function$
  select range.version_id
  from public.v_weekly_schedule_effective_ranges range
  where range.effective_start <= p_service_date
    and (range.effective_end is null or p_service_date < range.effective_end)
$function$;

revoke all on function public.static_weekly_advance_authority(bigint,text,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.static_weekly_create_draft(date,text,jsonb,jsonb,jsonb,text,bigint,uuid,text,text) from public, anon, authenticated;
revoke all on function public.static_weekly_update_draft(uuid,jsonb,jsonb,jsonb,text,bigint,bigint,uuid,text,text) from public, anon, authenticated;
revoke all on function public.static_weekly_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.static_weekly_apply_exception(text,date,time,time,uuid,uuid,text,jsonb,text,bigint,uuid,text,text,uuid) from public, anon, authenticated;

comment on table public.weekly_schedule_versions is 'Immutable published repeating-week authority; editable drafts only move through revision-checked command RPCs.';
comment on table public.weekly_roster_slots is 'Stable operational slots independent of mutable employee/person records.';
comment on table public.weekly_schedule_exception_commands is 'Append-only dated overlay commands; reversals are new compensation commands, never deletes.';
comment on view public.v_weekly_schedule_effective_ranges is 'Derived exact non-overlapping authority ranges from immutable publications and immutable closure facts.';

-- Correct the first static-weekly foundation at the authority seam.  This is
-- deliberately additive: historical rows stay immutable and the v2 commands
-- are the only application-role write path.

create table if not exists public.weekly_roster_slot_incumbency_closures (
  incumbency_closure_id uuid primary key default gen_random_uuid(),
  closed_incumbency_id uuid not null unique references public.weekly_roster_slot_incumbencies(incumbency_id) on delete restrict,
  replacement_incumbency_id uuid not null unique references public.weekly_roster_slot_incumbencies(incumbency_id) on delete restrict,
  closed_at_effective_date date not null,
  authority_revision bigint not null unique check (authority_revision > 0),
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null check (length(btrim(actor_manager_name_snapshot)) > 0),
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp()
);

alter table public.weekly_schedule_command_receipts
  add column if not exists request_canonical_json jsonb,
  add column if not exists response_digest text,
  add column if not exists content_digest text;
alter table public.weekly_schedule_publications
  add column if not exists request_digest text,
  add column if not exists replay_digest text,
  add column if not exists content_digest text;
alter table public.weekly_schedule_slot_availability
  add column if not exists max_load_points numeric(14,4);

-- The former range constraint model made a later replacement impossible once
-- the departed snapshot had an open end.  Closure facts derive the historical
-- end without mutating the original snapshot.
alter table public.weekly_roster_slot_incumbencies
  drop constraint if exists weekly_roster_slot_incumbencies_no_overlap;

create or replace view public.v_weekly_roster_slot_incumbency_ranges as
select
  incumbent.incumbency_id,
  incumbent.slot_id,
  incumbent.person_id,
  incumbent.person_name_snapshot,
  incumbent.effective_start,
  coalesce(closure.closed_at_effective_date, incumbent.effective_end) as effective_end,
  incumbent.created_by_manager_id,
  incumbent.created_by_manager_name_snapshot,
  incumbent.created_at,
  incumbent.content_digest
from public.weekly_roster_slot_incumbencies incumbent
left join public.weekly_roster_slot_incumbency_closures closure
  on closure.closed_incumbency_id = incumbent.incumbency_id;

create or replace function public.static_weekly_digest_jsonb(p_value jsonb)
returns text language sql stable strict security definer set search_path = pg_catalog, public as $function$
  select public.static_weekly_digest_text(p_value::text)
$function$;


create or replace function public.static_weekly_response_json(
  p_operation text, p_revision bigint, p_content_digest text, p_request_digest text, p_data jsonb
) returns jsonb language sql immutable security definer set search_path = pg_catalog, public as $function$
  select jsonb_build_object(
    'operation', p_operation,
    'revision', p_revision,
    'content_digest', p_content_digest,
    'request_digest', p_request_digest,
    'data', coalesce(p_data, '{}'::jsonb),
    'output_digest', public.static_weekly_digest_jsonb(jsonb_build_object(
      'operation', p_operation, 'revision', p_revision, 'content_digest', p_content_digest,
      'request_digest', p_request_digest, 'data', coalesce(p_data, '{}'::jsonb)
    ))
  )
$function$;





create or replace function public.static_weekly_v2_apply_exception(
  p_exception_type text, p_service_date date, p_starts_at time, p_ends_at time, p_base_version_id uuid, p_publication_id uuid,
  p_reason text, p_payload jsonb, p_expected_revision bigint, p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text, p_reverses_exception_id uuid default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_command uuid:=gen_random_uuid(); v_exception uuid:=gen_random_uuid(); v_revision bigint; v_response jsonb; v_request_digest text; v_payload jsonb; v_payload_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_target public.weekly_schedule_exception_commands%rowtype;
begin
  if p_exception_type not in ('pto','daily_absence','partial_absence','shift_override','cover_all','lunch','nine_forty_five_rebalance','event_impact','manager_correction','reverse') then raise exception using errcode='23514',message='invalid exception type'; end if;
  if p_service_date is null or p_base_version_id is null or p_publication_id is null or btrim(coalesce(p_reason,''))='' then raise exception using errcode='23514',message='complete version-bound exception authority inputs are required'; end if;
  if not exists(select 1 from public.weekly_schedule_publications p where p.publication_id=p_publication_id and p.version_id=p_base_version_id) or public.static_weekly_effective_version(p_service_date) <> p_base_version_id then raise exception using errcode='23514',message='exception must bind the effective publication and weekly version'; end if;
  if (p_exception_type='reverse') <> (p_reverses_exception_id is not null) then raise exception using errcode='23514',message='reversal target coherence is required'; end if;
  if p_exception_type='reverse' then
    select * into v_target from public.weekly_schedule_exception_commands where exception_id=p_reverses_exception_id;
    if not found or v_target.exception_type='reverse' or v_target.service_date<>p_service_date or v_target.base_version_id<>p_base_version_id or v_target.publication_id<>p_publication_id or exists(select 1 from public.weekly_schedule_exception_commands where reverses_exception_id=p_reverses_exception_id) then raise exception using errcode='23514',message='reversal must target one compatible unreversed exception'; end if;
  end if;
  v_payload:=coalesce(p_payload,'{}'::jsonb); v_payload_digest:=public.static_weekly_digest_jsonb(v_payload);
  v_request_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('operation','exception','type',p_exception_type,'service_date',p_service_date,'base_version_id',p_base_version_id,'publication_id',p_publication_id,'payload',v_payload,'expected_revision',p_expected_revision,'reverses_exception_id',p_reverses_exception_id));
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_prior.response_json; end if;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,case when p_exception_type='reverse' then 'reverse_exception' else 'apply_exception' end,p_actor_manager_id,p_actor_manager_name,v_command,v_payload_digest);
  insert into public.weekly_schedule_exception_commands(exception_id,authority_revision,exception_type,service_date,starts_at,ends_at,base_version_id,publication_id,reverses_exception_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,reason,payload_json,payload_digest)
  values(v_exception,v_revision,p_exception_type,p_service_date,p_starts_at,p_ends_at,p_base_version_id,p_publication_id,p_reverses_exception_id,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,p_reason,v_payload,v_payload_digest);
  v_response:=public.static_weekly_response_json(case when p_exception_type='reverse' then 'reverse_exception' else 'apply_exception' end,v_revision,v_payload_digest,v_request_digest,jsonb_build_object('exception_id',v_exception,'exception_type',p_exception_type,'service_date',p_service_date,'base_version_id',p_base_version_id,'publication_id',p_publication_id));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_actor_manager_id,p_actor_manager_name,case when p_exception_type='reverse' then 'reverse_exception' else 'apply_exception' end,p_idempotency_key,p_expected_revision,v_request_digest,v_payload,v_response,v_response->>'output_digest',v_payload_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v2_replace_incumbency(
  p_slot_id uuid, p_person_id uuid, p_person_name_snapshot text, p_effective_start date, p_expected_revision bigint,
  p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_prior public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_new uuid:=gen_random_uuid(); v_command uuid:=gen_random_uuid(); v_revision bigint; v_content_digest text; v_request_digest text; v_response jsonb; v_receipt public.weekly_schedule_command_receipts%rowtype;
begin
  if p_slot_id is null or p_person_id is null or p_effective_start is null or btrim(coalesce(p_person_name_snapshot,''))='' then raise exception using errcode='23514',message='complete replacement incumbency inputs are required'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('slot_id',p_slot_id,'person_id',p_person_id,'person_name_snapshot',p_person_name_snapshot,'effective_start',p_effective_start));
  v_request_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('operation','replace_incumbency','content_digest',v_content_digest,'expected_revision',p_expected_revision));
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_receipt from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_receipt.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_receipt.response_json; end if;
  select * into v_prior from public.v_weekly_roster_slot_incumbency_ranges where slot_id=p_slot_id and effective_start < p_effective_start and (effective_end is null or p_effective_start < effective_end) order by effective_start desc limit 1;
  if not found then raise exception using errcode='23514',message='replacement requires one currently effective stable-slot incumbent'; end if;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'apply_exception',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,effective_end,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  values(v_new,p_slot_id,p_person_id,p_person_name_snapshot,p_effective_start,null,p_actor_manager_id,p_actor_manager_name,v_content_digest);
  insert into public.weekly_roster_slot_incumbency_closures(closed_incumbency_id,replacement_incumbency_id,closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest)
  values(v_prior.incumbency_id,v_new,p_effective_start,v_revision,p_actor_manager_id,p_actor_manager_name,v_content_digest);
  v_response:=public.static_weekly_response_json('replace_incumbency',v_revision,v_content_digest,v_request_digest,jsonb_build_object('slot_id',p_slot_id,'closed_incumbency_id',v_prior.incumbency_id,'replacement_incumbency_id',v_new,'effective_start',p_effective_start));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_actor_manager_id,p_actor_manager_name,'apply_exception',p_idempotency_key,p_expected_revision,v_request_digest,jsonb_build_object('slot_id',p_slot_id),v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_reject_truncate()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
begin raise exception using errcode='23514',message=format('%s is append-only; TRUNCATE is forbidden',tg_table_name); end
$function$;

-- I2 occurrence/projection facts preserve scheduled and original ownership.

do $triggers$
declare target text;
begin
  foreach target in array array['weekly_schedule_publications','weekly_schedule_exception_commands','weekly_schedule_occurrences','weekly_schedule_compiled_projections','weekly_schedule_projection_assignments','weekly_schedule_authority_revisions','weekly_schedule_command_receipts','weekly_roster_slot_incumbency_closures'] loop
    execute format('drop trigger if exists trg_static_weekly_%I_no_truncate on public.%I', target, target);
    execute format('create trigger trg_static_weekly_%I_no_truncate before truncate on public.%I for each statement execute function public.static_weekly_reject_truncate()', target, target);
  end loop;
end
$triggers$;

create index if not exists idx_weekly_roster_slot_incumbency_closures_replacement on public.weekly_roster_slot_incumbency_closures(replacement_incumbency_id);
create index if not exists idx_weekly_schedule_versions_draft_of on public.weekly_schedule_versions(draft_of_version_id);
create index if not exists idx_weekly_schedule_versions_rollback_of on public.weekly_schedule_versions(rollback_of_version_id);
create index if not exists idx_weekly_schedule_availability_slot on public.weekly_schedule_slot_availability(slot_id);
create index if not exists idx_weekly_schedule_assignments_owner_slot on public.weekly_schedule_slot_assignments(owner_slot_id);
create index if not exists idx_weekly_schedule_occurrences_publication on public.weekly_schedule_occurrences(publication_id);
create index if not exists idx_weekly_schedule_occurrences_assignment on public.weekly_schedule_occurrences(assignment_id);
create index if not exists idx_weekly_schedule_projection_assignments_occurrence on public.weekly_schedule_projection_assignments(occurrence_id);
create index if not exists idx_weekly_schedule_exceptions_base_publication on public.weekly_schedule_exception_commands(base_version_id,publication_id,service_date);
create index if not exists idx_weekly_schedule_receipts_actor_key on public.weekly_schedule_command_receipts(actor_manager_id,idempotency_key);

alter table public.weekly_schedule_exception_commands drop constraint if exists weekly_schedule_exception_commands_version_publication_required;
alter table public.weekly_schedule_exception_commands add constraint weekly_schedule_exception_commands_version_publication_required check (base_version_id is not null and publication_id is not null) not valid;
alter table public.weekly_schedule_projection_assignments drop constraint if exists weekly_schedule_projection_assignments_occurrence_required;
alter table public.weekly_schedule_projection_assignments add constraint weekly_schedule_projection_assignments_occurrence_required check (occurrence_id is not null) not valid;

do $security$
declare target text; role_name text;
begin
  foreach target in array array['static_weekly_schedule_control','weekly_schedule_versions','weekly_roster_slots','weekly_roster_slot_incumbencies','weekly_roster_slot_incumbency_closures','weekly_schedule_slot_availability','weekly_schedule_slot_assignments','weekly_schedule_objective_inputs','weekly_schedule_effective_range_closures','weekly_schedule_publications','weekly_schedule_exception_commands','weekly_schedule_occurrences','weekly_schedule_compiled_projections','weekly_schedule_projection_assignments','weekly_schedule_authority_revisions','weekly_schedule_command_receipts'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('alter table public.%I force row level security', target);
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on table public.%I from %I', target, role_name); end if;
    end loop;
    execute format('revoke all on table public.%I from public', target);
  end loop;
end
$security$;

comment on table public.weekly_roster_slot_incumbency_closures is 'Append-only close/supersede facts let later hires replace an open departed incumbent without rewriting historical identity.';

-- Production Manager authority closure.  A draft document is a projection of
-- the bounded server compiler result, never a second client-owned schedule.




-- Exact-head scheduler authority corrections.  This migration is additive and
-- deliberately owns only the static-weekly authority seam; consumer cutover
-- remains an explicit later integration.

alter table public.weekly_schedule_publications
  add column if not exists compensates_publication_id uuid references public.weekly_schedule_publications(publication_id) on delete restrict,
  add column if not exists compensates_content_digest text;
alter table public.weekly_schedule_slot_assignments
  add column if not exists authority_facts_json jsonb not null default '{}'::jsonb;
alter table public.weekly_schedule_occurrences
  add column if not exists authority_facts_json jsonb not null default '{}'::jsonb;
alter table public.weekly_schedule_projection_assignments
  add column if not exists authority_facts_json jsonb not null default '{}'::jsonb;

-- PostgreSQL itself recomputes every document identity from jsonb::text.  The
-- Node compiler sends the same deterministic jsonb spelling, but no supplied
-- digest is trusted until this function has reconstructed it.


-- A second guard binds draft writes even if a future caller bypasses the v2
-- wrapper.  Empty legacy-compatible drafts remain non-publishable, but every
-- claimed compiler authority is verified at write time.
create or replace function public.static_weekly_exact_version_document_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  if new.draft_document #> '{authority,compiler_input}' is not null then perform public.static_weekly_assert_exact_document(new.draft_document,new.effective_start); end if;
  return new;
end
$function$;
drop trigger if exists trg_static_weekly_exact_version_document_guard on public.weekly_schedule_versions;
create trigger trg_static_weekly_exact_version_document_guard before insert or update of draft_document,effective_start on public.weekly_schedule_versions
for each row execute function public.static_weekly_exact_version_document_guard();


-- Store authority facts in their own immutable projection field whenever the
-- existing v2 update function creates scheduler rows.
create or replace function public.static_weekly_copy_assignment_facts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  if new.authority_facts_json='{}'::jsonb then new.authority_facts_json:=coalesce(new.payload_json->'authority_facts','{}'::jsonb); end if;
  return new;
end
$function$;
drop trigger if exists trg_static_weekly_copy_assignment_facts on public.weekly_schedule_slot_assignments;
create trigger trg_static_weekly_copy_assignment_facts before insert on public.weekly_schedule_slot_assignments for each row execute function public.static_weekly_copy_assignment_facts();

-- Projection input is one envelope, not an independently valid collection of
-- unrelated digests.  It may include an effective-dated CoverAll owner or
-- event work, but only when the compiled overlay authority carries the exact
-- date and canonical baseline compiler input of the published version.

-- Rollback is a new append-only publication identity.  Its clone binding is
-- content based, not impossible equality between different version UUIDs.
create or replace function public.static_weekly_assert_rollback_compensation(p_draft_version_id uuid,p_target_version_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare d public.weekly_schedule_versions%rowtype; t public.weekly_schedule_versions%rowtype;
begin
  select * into d from public.weekly_schedule_versions where version_id=p_draft_version_id and lifecycle_state='draft';
  select * into t from public.weekly_schedule_versions where version_id=p_target_version_id and lifecycle_state='published';
  if not found or public.static_weekly_template_content_identity(d.draft_document)<>public.static_weekly_template_content_identity(t.draft_document) then raise exception using errcode='23514',message='rollback compensation must clone target schedule content under a new publication identity'; end if;
end
$function$;

create or replace function public.static_weekly_v2_publish_draft(
  p_draft_version_id uuid,p_expected_draft_revision bigint,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,
  p_idempotency_key text,p_publication_kind text default 'publish',p_rollback_of_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_draft public.weekly_schedule_versions%rowtype; v_prior public.weekly_schedule_command_receipts%rowtype; v_command uuid:=gen_random_uuid(); v_published uuid:=gen_random_uuid(); v_publication uuid:=gen_random_uuid(); v_prior_version uuid; v_revision bigint; v_response jsonb; v_request_digest text; v_version_number bigint; v_target public.weekly_schedule_versions%rowtype; v_target_content_digest text;
begin
  if p_publication_kind not in ('publish','supersede','rollback_compensation') then raise exception using errcode='23514',message='invalid publication kind'; end if;
  v_request_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('operation','publish','draft_version_id',p_draft_version_id,'expected_draft_revision',p_expected_draft_revision,'expected_revision',p_expected_revision,'publication_kind',p_publication_kind,'rollback_of_version_id',p_rollback_of_version_id));
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_prior.response_json; end if;
  select * into v_draft from public.weekly_schedule_versions where version_id=p_draft_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update;
  if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  perform public.static_weekly_assert_draft_publishable(v_draft.version_id);
  if p_publication_kind='rollback_compensation' then
    if p_rollback_of_version_id is null then raise exception using errcode='23514',message='rollback compensation requires an exact published target'; end if;
    select * into v_target from public.weekly_schedule_versions where version_id=p_rollback_of_version_id and lifecycle_state='published';
    if not found then raise exception using errcode='23514',message='rollback target must be published'; end if;
    perform public.static_weekly_assert_rollback_compensation(v_draft.version_id,p_rollback_of_version_id);
    v_target_content_digest:=public.static_weekly_template_content_identity(v_target.draft_document);
  elsif p_rollback_of_version_id is not null then raise exception using errcode='23514',message='only rollback compensation may specify a rollback target'; end if;
  select version_id into v_prior_version from public.weekly_schedule_versions where lifecycle_state='published' order by effective_start desc,version_number desc limit 1;
  if v_prior_version is not null and v_draft.effective_start <= (select effective_start from public.weekly_schedule_versions where version_id=v_prior_version) then raise exception using errcode='23514',message='new immutable version must supersede at a later effective date'; end if;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,case when p_publication_kind='rollback_compensation' then 'rollback' when p_publication_kind='supersede' then 'supersede' else 'publish' end,p_actor_manager_id,p_actor_manager_name,v_command,v_draft.content_digest);
  select coalesce(max(version_number),0)+1 into v_version_number from public.weekly_schedule_versions where lifecycle_state='published';
  perform set_config('app.static_weekly_publish_command','on',true);
  insert into public.weekly_schedule_versions(version_id,version_number,lifecycle_state,publication_kind,draft_of_version_id,rollback_of_version_id,effective_start,revision,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot,published_by_manager_id,published_by_manager_name_snapshot,published_at)
  values(v_published,v_version_number,'published',p_publication_kind,v_draft.version_id,p_rollback_of_version_id,v_draft.effective_start,1,v_draft.objective_version,v_draft.objective_json,v_draft.input_provenance_json,v_draft.draft_document,v_draft.content_digest,p_actor_manager_id,p_actor_manager_name,p_actor_manager_id,p_actor_manager_name,statement_timestamp());
  insert into public.weekly_schedule_slot_availability(version_id,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,max_load_points,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest)
  select v_published,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,max_load_points,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest from public.weekly_schedule_slot_availability where version_id=v_draft.version_id;
  insert into public.weekly_schedule_slot_assignments(version_id,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,required_qualifications_snapshot,restriction_snapshot,workload_points,workload_provenance,manual_lock,payload_json,authority_facts_json,content_digest)
  select v_published,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,required_qualifications_snapshot,restriction_snapshot,workload_points,workload_provenance,manual_lock,payload_json,authority_facts_json,content_digest from public.weekly_schedule_slot_assignments where version_id=v_draft.version_id;
  insert into public.weekly_schedule_objective_inputs(version_id,input_key,input_value,provenance,content_digest,captured_by_manager_id,captured_by_manager_name_snapshot)
  select v_published,input_key,input_value,provenance,content_digest,captured_by_manager_id,captured_by_manager_name_snapshot from public.weekly_schedule_objective_inputs where version_id=v_draft.version_id;
  v_response:=public.static_weekly_response_json('publish',v_revision,v_draft.content_digest,v_request_digest,jsonb_build_object('version_id',v_published,'version_number',v_version_number,'publication_id',v_publication,'effective_start',v_draft.effective_start,'replay_digest',v_draft.draft_document#>>'{validation,replay_digest}','compensates_publication_id',case when p_publication_kind='rollback_compensation' then (select publication_id from public.weekly_schedule_publications where version_id=p_rollback_of_version_id order by published_at desc limit 1) else null end));
  insert into public.weekly_schedule_publications(publication_id,version_id,authority_revision,publication_kind,effective_start,prior_version_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,input_digest,output_digest,request_digest,replay_digest,content_digest,compensates_publication_id,compensates_content_digest)
  values(v_publication,v_published,v_revision,p_publication_kind,v_draft.effective_start,v_prior_version,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,v_draft.content_digest,v_response->>'output_digest',v_request_digest,v_draft.draft_document#>>'{validation,replay_digest}',v_draft.content_digest,case when p_publication_kind='rollback_compensation' then (select publication_id from public.weekly_schedule_publications where version_id=p_rollback_of_version_id order by published_at desc limit 1) else null end,v_target_content_digest);
  if v_prior_version is not null then insert into public.weekly_schedule_effective_range_closures(closed_version_id,closed_at_effective_date,superseding_version_id,publication_id,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(v_prior_version,v_draft.effective_start,v_published,v_publication,p_actor_manager_id,p_actor_manager_name,v_draft.content_digest); end if;
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,case when p_publication_kind='rollback_compensation' then 'rollback' when p_publication_kind='supersede' then 'supersede' else 'publish' end,p_idempotency_key,p_expected_revision,v_request_digest,jsonb_build_object('draft_version_id',p_draft_version_id,'compensates_publication_id',case when p_publication_kind='rollback_compensation' then (select publication_id from public.weekly_schedule_publications where version_id=p_rollback_of_version_id order by published_at desc limit 1) else null end),v_response,v_response->>'output_digest',v_draft.content_digest);
  return v_response;
end
$function$;

create table if not exists public.static_weekly_scheduler_cutover_manifest (
  manifest_id uuid primary key default gen_random_uuid(),
  state text not null check(state='READY_FOR_SINGLE_INTEGRATION_AFTER_BACKEND_HEAD_FREEZES'),
  manifest_json jsonb not null, content_digest text not null check(content_digest~'^[0-9a-f]{64}$'), created_at timestamptz not null default statement_timestamp()
);
insert into public.static_weekly_scheduler_cutover_manifest(state,manifest_json,content_digest)
select 'READY_FOR_SINGLE_INTEGRATION_AFTER_BACKEND_HEAD_FREEZES',manifest_json,public.static_weekly_digest_jsonb(manifest_json)
from (select jsonb_build_object('legacy_writers',jsonb_build_array('src/index.js static weekly manager route','src/schedule-api.js legacy daily delete/reinsert','static_weekly legacy RPCs'),'required_consumers',jsonb_build_array('Event','Messenger','ticket','session','completion','employee','manager','inspection','readiness'),'binding','weekly occurrence_id + publication_id + projection_assignment_id + original/optimized/actual actor facts') manifest_json) manifest
where not exists(select 1 from public.static_weekly_scheduler_cutover_manifest);

-- Final core correction: derive work and historical person facts from the
-- canonical compiler input plus the dated roster, rather than accepting two
-- caller-composed result branches that agree with each other.

-- Only the accepted, unreversed append-only rows are an overlay authority.
-- The normalized shape is deliberately identical to compiler appliedExceptions.
create or replace function public.static_weekly_accepted_exception_set(p_publication_id uuid, p_service_date date)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  with accepted as (
    select e.* from public.weekly_schedule_exception_commands e
    where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type<>'reverse'
      and not exists(select 1 from public.weekly_schedule_exception_commands r where r.publication_id=p_publication_id and r.service_date=p_service_date and r.exception_type='reverse' and r.reverses_exception_id=e.exception_id)
  ) select coalesce(jsonb_agg(jsonb_build_object('id',exception_id::text,'type',exception_type,'serviceDate',service_date::text,'payloadDigest',payload_digest) order by accepted_at,authority_revision,exception_id),'[]'::jsonb) from accepted
$function$;

create or replace function public.static_weekly_v2_materialize_projection(
  p_publication_id uuid,p_service_date date,p_exception_set_digest text,p_compiler_version text,p_objective jsonb,p_metrics jsonb,
  p_replay_digest text,p_assignments jsonb,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_publication public.weekly_schedule_publications%rowtype; v_document jsonb; v_envelope jsonb:=p_assignments; v_projection uuid:=gen_random_uuid(); v_command uuid:=gen_random_uuid(); v_revision bigint; v_digest text; v_request_digest text; v_response jsonb; v_prior public.weekly_schedule_command_receipts%rowtype; v_item jsonb; v_occurrence uuid; v_assignment public.weekly_schedule_slot_assignments%rowtype; v_owner public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_work jsonb; v_authority jsonb; v_exception_set jsonb; v_exception_digest text;
begin
  select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id;
  if not found or p_service_date is null or public.static_weekly_effective_version(p_service_date)<>v_publication.version_id then raise exception using errcode='23514',message='projection must bind one effective publication and date'; end if;
  select draft_document into v_document from public.weekly_schedule_versions where version_id=v_publication.version_id;
  perform public.static_weekly_assert_exact_document(v_document,(v_document #>> '{authority,effective_date}')::date);
  if jsonb_typeof(v_envelope)<>'object' or jsonb_typeof(v_envelope->'assignments')<>'array' or coalesce(v_envelope->>'database_projection_identity','')<>public.static_weekly_digest_jsonb(v_envelope-'database_projection_identity') then raise exception using errcode='23514',message='projection payload exact content identity mismatch'; end if;
  v_exception_set:=public.static_weekly_accepted_exception_set(p_publication_id,p_service_date);
  v_exception_digest:=public.static_weekly_digest_jsonb(v_exception_set);
  if coalesce(p_exception_set_digest,'')<>v_exception_digest or coalesce(v_envelope->>'exception_set_digest','')<>v_exception_digest then raise exception using errcode='23514',message='projection exception digest must be recomputed from accepted append-only commands'; end if;
  v_authority:=v_envelope->'authority';
  if coalesce(v_envelope->>'service_date','')<>p_service_date::text or coalesce(v_envelope->>'replay_digest','')<>coalesce(p_replay_digest,'')
    or jsonb_typeof(v_authority)<>'object' or coalesce(v_authority->>'databaseContentIdentity','')<>public.static_weekly_digest_jsonb(v_authority-'databaseContentIdentity')
    or coalesce(v_authority->'compilerInput','{}'::jsonb)<>coalesce(v_document #> '{authority,compiler_input}','{}'::jsonb)
    or coalesce(v_authority->>'effectiveDate','')<>p_service_date::text
    or coalesce(v_authority->>'inputDigest','')<>public.static_weekly_digest_jsonb(coalesce(v_authority->'overlayCompilerInput','{}'::jsonb))
    or coalesce(v_authority->>'baselineInputDigest','')<>public.static_weekly_digest_jsonb(coalesce(v_authority->'compilerInput','{}'::jsonb)) then raise exception using errcode='23514',message='projection compiler input, exact date, and canonical identities must bind the stored baseline'; end if;
  if coalesce((select jsonb_agg(item order by item->>'id') from jsonb_array_elements(coalesce(v_authority->'appliedExceptions','[]'::jsonb)) item where item->>'serviceDate'=p_service_date::text),'[]'::jsonb)
      <> coalesce((select jsonb_agg(item order by item->>'id') from jsonb_array_elements(v_exception_set) item),'[]'::jsonb) then raise exception using errcode='23514',message='projection overlay effects must derive from the accepted exception set'; end if;
  if coalesce(v_envelope->>'authority_digest','') !~ '^[0-9a-f]{64}$' or coalesce(p_compiler_version,'')='' then raise exception using errcode='23514',message='projection authority is malformed'; end if;
  if exists(select 1 from jsonb_array_elements(v_envelope->'assignments') item group by item->>'plan_work_id' having count(*)<>1)
    or exists(
      with active as (
        select e.* from public.weekly_schedule_exception_commands e where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type='event_impact' and not exists(select 1 from public.weekly_schedule_exception_commands r where r.exception_type='reverse' and r.reverses_exception_id=e.exception_id)
      ), removed as (select value work_id from active, lateral jsonb_array_elements_text(coalesce(payload_json->'removeWorkIds','[]'::jsonb)) value), expected as (
        select a.work_id from public.weekly_schedule_slot_assignments a where a.version_id=v_publication.version_id and a.day_of_week=extract(dow from p_service_date)::smallint and not exists(select 1 from removed r where r.work_id=a.work_id)
        union all select coalesce(w->>'workId',w->>'id') from active, lateral jsonb_array_elements(coalesce(payload_json->'addWork','[]'::jsonb)) w
      ), actual as (select item->>'work_id' work_id from jsonb_array_elements(v_envelope->'assignments') item)
      select 1 from expected full join actual using(work_id) where expected.work_id is null or actual.work_id is null
    ) then raise exception using errcode='23514',message='projection must contain exactly the canonical baseline work plus accepted event overlay work'; end if;
  if exists(select 1 from jsonb_array_elements(v_envelope->'assignments') e left join lateral (select o from jsonb_array_elements(v_authority #> '{optimizerResult,assignments}') o where o->>'planWorkId'=e->>'plan_work_id') q on true where q.o is null or coalesce(e->>'owner_digest','')<>coalesce(q.o->>'ownerDigest','') or coalesce(e->>'exact_owner_identity','')<>coalesce(q.o->>'exactOwnerIdentity','') or coalesce(e->>'owner_slot_id','')<>coalesce(q.o->>'slotId','') or coalesce(e->>'owner_person_id','')<>coalesce(q.o->>'personId','') or coalesce(e->>'baseline_owner_person_id','')<>coalesce(q.o->>'baselineOwnerPersonId','') or coalesce(e->>'original_actor_person_id','')<>coalesce(q.o->>'originalActorPersonId','')) then raise exception using errcode='23514',message='projection owner facts differ from canonical optimizer result'; end if;
  v_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('publication_id',p_publication_id,'service_date',p_service_date,'projection_identity',v_envelope->>'database_projection_identity'));
  v_request_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('operation','materialize_projection','content_digest',v_digest,'expected_revision',p_expected_revision));
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_prior.response_json; end if;
  if exists(select 1 from public.weekly_schedule_compiled_projections where publication_id=p_publication_id and service_date=p_service_date and exception_set_digest=v_exception_digest and compiler_version=p_compiler_version) then raise exception using errcode='23505',message='immutable projection already exists for this authority input'; end if;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'materialize_projection',p_actor_manager_id,p_actor_manager_name,v_command,v_digest);
  insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,service_date,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,compiled_by_manager_id) values(v_projection,p_publication_id,v_publication.version_id,p_service_date,v_exception_digest,p_compiler_version,coalesce(p_objective,'{}'),coalesce(p_metrics,'{}'),p_replay_digest,p_actor_manager_id);
  for v_item in select value from jsonb_array_elements(v_envelope->'assignments') loop
    select * into v_assignment from public.weekly_schedule_slot_assignments where version_id=v_publication.version_id and work_id=v_item->>'work_id' and day_of_week=extract(dow from p_service_date)::smallint;
    v_work:=coalesce(v_item->'work_snapshot','{}'::jsonb);
    if not found then
      if not exists(select 1 from public.weekly_schedule_exception_commands e, lateral jsonb_array_elements(coalesce(e.payload_json->'addWork','[]'::jsonb)) w where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type='event_impact' and not exists(select 1 from public.weekly_schedule_exception_commands r where r.exception_type='reverse' and r.reverses_exception_id=e.exception_id) and coalesce(w->>'workId',w->>'id')=v_item->>'work_id' and w->>'locationId'=v_work->>'locationId' and w#>>'{window,start}'=v_work#>>'{window,start}' and w#>>'{window,end}'=v_work#>>'{window,end}') then raise exception using errcode='23514',message='overlay work must be an exact accepted event command, never a caller flag'; end if;
    end if;
    if lower(v_item->>'status')='assigned' then
      select * into v_owner from public.v_weekly_roster_slot_incumbency_ranges where slot_id=nullif(v_item->>'owner_slot_id','')::uuid and effective_start<=p_service_date and (effective_end is null or p_service_date<effective_end);
      if not found or v_owner.person_id::text<>coalesce(v_item->>'owner_person_id','') or v_owner.person_name_snapshot<>coalesce(v_item->>'optimized_owner_name',v_owner.person_name_snapshot) then raise exception using errcode='23514',message='projection owner lacks effective dated slot incumbency'; end if;
    end if;
    insert into public.weekly_schedule_occurrences(publication_id,version_id,assignment_id,service_date,work_id,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,state,state_reason,original_actor_person_id,original_actor_name_snapshot,authority_facts_json,occurrence_digest)
    values(p_publication_id,v_publication.version_id,v_assignment.assignment_id,p_service_date,coalesce(v_assignment.work_id,v_item->>'work_id'),coalesce(v_assignment.location_id,nullif(v_work->>'locationId','')::uuid),coalesce(v_assignment.location_code_snapshot,v_work->>'locationCodeSnapshot',v_item->>'work_id'),coalesce(v_assignment.location_name_snapshot,v_work->>'locationNameSnapshot',v_item->>'work_id'),coalesce(v_assignment.coverage_start,(v_work#>>'{window,start}')::time),coalesce(v_assignment.coverage_end,(v_work#>>'{window,end}')::time),nullif(v_item->>'owner_slot_id','')::uuid,coalesce(v_assignment.owner_slot_label_snapshot,(select slot_label from public.weekly_roster_slots where slot_id=nullif(v_item->>'owner_slot_id','')::uuid)),nullif(v_item->>'owner_person_id','')::uuid,v_owner.person_name_snapshot,case lower(v_item->>'status') when 'assigned' then 'created' when 'open' then 'open' else 'review' end,v_item#>>'{explanation,reasons,0,code}',nullif(v_item->>'original_actor_person_id','')::uuid,v_item->>'original_actor_name',jsonb_build_object('stable_roster_slot_id',v_item->>'baseline_owner_slot_id','baseline_owner_slot_id',v_item->>'baseline_owner_slot_id','baseline_owner_person_id',v_item->>'baseline_owner_person_id','baseline_owner_name',v_item->>'baseline_owner_name','original_actor_person_id',v_item->>'original_actor_person_id','original_actor_name',v_item->>'original_actor_name','optimized_owner_slot_id',v_item->>'optimized_owner_slot_id','optimized_owner_person_id',v_item->>'optimized_owner_person_id'),public.static_weekly_digest_jsonb(v_item)) returning occurrence_id into v_occurrence;
    insert into public.weekly_schedule_projection_assignments(projection_id,occurrence_id,work_id,status,reason_code,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,authority_facts_json,explanation_json,content_digest)
    values(v_projection,v_occurrence,coalesce(v_assignment.work_id,v_item->>'work_id'),lower(v_item->>'status'),v_item#>>'{explanation,reasons,0,code}',nullif(v_item->>'owner_slot_id','')::uuid,(select slot_label from public.weekly_roster_slots where slot_id=nullif(v_item->>'owner_slot_id','')::uuid),nullif(v_item->>'owner_person_id','')::uuid,v_owner.person_name_snapshot,(select authority_facts_json from public.weekly_schedule_occurrences where occurrence_id=v_occurrence),coalesce(v_item->'explanation','{}'::jsonb),public.static_weekly_digest_jsonb(v_item));
  end loop;
  v_response:=public.static_weekly_response_json('materialize_projection',v_revision,v_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,'publication_id',p_publication_id,'service_date',p_service_date,'replay_digest',p_replay_digest));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'materialize_projection',p_idempotency_key,p_expected_revision,v_request_digest,v_envelope,v_response,v_response->>'output_digest',v_digest);
  return v_response;
end
$function$;

-- Normalize hashes that are necessarily date-bound when comparing a later
-- append-only compensation publication to its target template.
create or replace function public.static_weekly_template_content_identity(p_document jsonb)
returns text language sql stable security definer set search_path=pg_catalog,public as $function$
  with authority as (select coalesce(p_document->'authority','{}'::jsonb) a),
  template_authority as (
    select (a-'effective_date'-'database_content_identity'-'authority_digest'-'input_digest'-'baseline_input_digest'-'replay_digest'-'solution_digest'-'overlay_compiler_input') || jsonb_build_object(
      'compiler_input',coalesce(a->'compiler_input','{}'::jsonb)-'serviceDate',
      'overlay_compiler_input',coalesce(a->'overlay_compiler_input',a->'compiler_input','{}'::jsonb)-'serviceDate',
      'optimizer_result',(coalesce(a->'optimizer_result','{}'::jsonb)-'assignments') || jsonb_build_object('assignments',coalesce((select jsonb_agg(item-'serviceDate'-'ownerDigest'-'exactOwnerIdentity' order by item->>'planWorkId') from jsonb_array_elements(coalesce(a #> '{optimizer_result,assignments}','[]'::jsonb)) item),'[]'::jsonb))
    ) value from authority
  ), template_assignments as (
    select coalesce(jsonb_agg((item-'payload_json') || jsonb_build_object('payload_json',coalesce(item->'payload_json','{}'::jsonb)-'owner_digest'-'exact_owner_identity'-'authority_digest') order by item->>'work_id',item->>'day_of_week'),'[]'::jsonb) value from jsonb_array_elements(coalesce(p_document->'assignments','[]'::jsonb)) item
  ) select public.static_weekly_digest_jsonb(jsonb_build_object('authority',(select value from template_authority),'slot_availability',coalesce(p_document->'slot_availability','[]'::jsonb),'assignments',(select value from template_assignments),'objective_inputs',coalesce(p_document->'objective_inputs','[]'::jsonb)))
$function$;

-- Complete static-weekly authority correction.  This is intentionally
-- additive: it replaces only idempotent validator/canonicalizer functions and
-- never changes an existing publication or roster fact in place.

-- A work identity is unique inside one weekday, not across the repeating
-- week. The original constraint rejected a legitimate repeated work ID on a
-- different day even though every compiler/database join uses day + work.
alter table public.weekly_schedule_slot_assignments
  drop constraint if exists weekly_schedule_slot_assignments_version_id_work_id_key;
do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.weekly_schedule_slot_assignments'::regclass
      and conname = 'weekly_schedule_slot_assignments_version_day_work_key'
  ) then
    alter table public.weekly_schedule_slot_assignments
      add constraint weekly_schedule_slot_assignments_version_day_work_key
      unique (version_id, day_of_week, work_id);
  end if;
end
$migration$;

create or replace function public.static_weekly_canonical_document(p_document jsonb)
returns jsonb language sql immutable security definer set search_path = pg_catalog, public as $function$
  select jsonb_build_object(
    'authority', coalesce(p_document->'authority', '{}'::jsonb),
    'slot_availability', coalesce((
      select jsonb_agg(value order by (value->>'day_of_week')::smallint, convert_to(coalesce(value->>'slot_id',''),'UTF8'), convert_to(value::text,'UTF8'))
      from jsonb_array_elements(coalesce(p_document->'slot_availability', '[]'::jsonb)) value
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(value order by (value->>'day_of_week')::smallint, convert_to(coalesce(value->>'work_id',''),'UTF8'), convert_to(value::text,'UTF8'))
      from jsonb_array_elements(coalesce(p_document->'assignments', '[]'::jsonb)) value
    ), '[]'::jsonb),
    'objective_inputs', coalesce((
      select jsonb_agg(value order by convert_to(coalesce(value->>'input_key',''),'UTF8'), convert_to(value::text,'UTF8'))
      from jsonb_array_elements(coalesce(p_document->'objective_inputs', '[]'::jsonb)) value
    ), '[]'::jsonb),
    'validation', coalesce(p_document->'validation', '{}'::jsonb)
  )
$function$;

create or replace function public.static_weekly_exact_document_identity(p_document jsonb, p_effective_date date)
returns text language sql stable security definer set search_path = pg_catalog, public as $function$
  select public.static_weekly_digest_jsonb(jsonb_build_object(
    'effective_date', p_effective_date,
    'authority', coalesce(p_document->'authority', '{}'::jsonb),
    'slot_availability', coalesce(public.static_weekly_canonical_document(p_document)->'slot_availability', '[]'::jsonb),
    'assignments', coalesce(public.static_weekly_canonical_document(p_document)->'assignments', '[]'::jsonb),
    'objective_inputs', coalesce(public.static_weekly_canonical_document(p_document)->'objective_inputs', '[]'::jsonb)
  ))
$function$;

create or replace function public.static_weekly_assert_exact_document(p_document jsonb, p_effective_date date)
returns void language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_authority jsonb := coalesce(p_document->'authority', '{}'::jsonb);
  v_input jsonb := coalesce(p_document #> '{authority,compiler_input}', '{}'::jsonb);
  v_optimizer jsonb := coalesce(p_document #> '{authority,optimizer_result}', '{}'::jsonb);
  v_document jsonb := public.static_weekly_canonical_document(p_document);
  v_document_identity text;
begin
  if p_effective_date is null or jsonb_typeof(v_authority) <> 'object' or jsonb_typeof(v_input) <> 'object'
    or jsonb_typeof(v_input #> '{version,assignments}') <> 'array' or jsonb_typeof(v_input #> '{version,slotAvailability}') <> 'array'
    or jsonb_typeof(v_input->'slots') <> 'array' or jsonb_typeof(v_optimizer->'assignments') <> 'array'
    or jsonb_typeof(v_document->'assignments') <> 'array' or jsonb_typeof(v_document->'slot_availability') <> 'array' then
    raise exception using errcode='23514', message='exact scheduler authority requires canonical compiler input, roster slots, optimizer work, and document rows';
  end if;
  if exists(select 1 from jsonb_array_elements(v_input #> '{version,assignments}') item
      where jsonb_typeof(item->'dayOfWeek') <> 'number' or coalesce(item->>'dayOfWeek','') !~ '^[0-6]$')
    or exists(select 1 from jsonb_array_elements(v_input #> '{version,slotAvailability}') item
      where jsonb_typeof(item->'dayOfWeek') <> 'number' or coalesce(item->>'dayOfWeek','') !~ '^[0-6]$') then
    raise exception using errcode='23514', message='canonical compiler input weekday domain is invalid';
  end if;
  if coalesce(v_authority->>'effective_date','') <> p_effective_date::text
    or coalesce(v_input->>'serviceDate','') <> p_effective_date::text
    or coalesce(v_input->'exceptions','[]'::jsonb) <> '[]'::jsonb
    or coalesce(v_authority->'overlay_compiler_input','{}'::jsonb) <> v_input
    or coalesce(v_authority->'applied_exceptions','[]'::jsonb) <> '[]'::jsonb
    or coalesce(v_authority->>'input_digest','') <> coalesce(v_authority->>'baseline_input_digest','')
    or coalesce(v_authority->>'input_digest','') <> public.static_weekly_digest_jsonb(v_input)
    or coalesce(v_authority->>'baseline_input_digest','') <> public.static_weekly_digest_jsonb(v_input) then
    raise exception using errcode='23514', message='repeating baseline must bind one exact exception-free canonical authority';
  end if;
  if coalesce(v_authority->>'solution_digest','') <> public.static_weekly_digest_jsonb(v_optimizer) then
    raise exception using errcode='23514', message='authority solution digest does not bind the exact optimizer result';
  end if;
  if coalesce(v_authority->>'database_content_identity','') <> public.static_weekly_digest_jsonb(v_authority-'database_content_identity') then
    raise exception using errcode='23514', message='authority database content identity does not bind the exact authority document';
  end if;
  v_document_identity := public.static_weekly_exact_document_identity(v_document, p_effective_date);
  if coalesce(p_document #>> '{validation,database_document_identity}','') <> v_document_identity
    or coalesce(p_document #>> '{validation,status}','') <> 'FEASIBLE'
    or coalesce(p_document #>> '{validation,server_computed}','') <> 'true'
    or coalesce(p_document #>> '{validation,authority_digest}','') <> coalesce(v_authority->>'authority_digest','')
    or coalesce(p_document #>> '{validation,input_digest}','') <> coalesce(v_authority->>'input_digest','')
    or coalesce(p_document #>> '{validation,replay_digest}','') <> coalesce(v_authority->>'replay_digest','')
    or coalesce(p_document #>> '{validation,solution_digest}','') <> coalesce(v_authority->>'solution_digest','') then
    raise exception using errcode='23514', message='draft, effective date, compiler input, canonical result, and proof identities must be one exact authority';
  end if;
  if exists(
    with source as (
      select value item, ((value->>'dayOfWeek') || ':' || coalesce(value->>'workId',value->>'id')) plan_work_id
      from jsonb_array_elements(v_input #> '{version,assignments}')
    ), optimizer as (select value item from jsonb_array_elements(v_optimizer->'assignments')), draft as (select value item from jsonb_array_elements(v_document->'assignments'))
    select 1 from source s full join optimizer o on o.item->>'planWorkId'=s.plan_work_id
      full join draft d on ((d.item->>'day_of_week') || ':' || (d.item->>'work_id'))=coalesce(s.plan_work_id,o.item->>'planWorkId')
    where s.item is null or o.item is null or d.item is null
      or coalesce(o.item->>'workId','') <> coalesce(s.item->>'workId',s.item->>'id')
      or coalesce(o.item->>'dayOfWeek','') <> coalesce(s.item->>'dayOfWeek','')
      or coalesce(o.item->>'serviceDate','') <> (p_effective_date + (((s.item->>'dayOfWeek')::integer - extract(dow from p_effective_date)::integer + 7) % 7))::date::text
      or coalesce(o.item->'window','{}'::jsonb) <> coalesce(s.item->'window','{}'::jsonb)
      or coalesce(o.item->>'serviceEffortMinutes','') <> coalesce(s.item->>'serviceEffortMinutes','')
      or coalesce(o.item->>'baselineSlotId','') <> coalesce(s.item->>'originSlotId',s.item->>'ownerSlotId',s.item->>'baselineSlotId')
      or (coalesce(s.item->'required','true'::jsonb) <> 'false'::jsonb and coalesce(o.item->>'status','') <> 'ASSIGNED')
      or (coalesce(s.item->'required','true'::jsonb) = 'false'::jsonb and coalesce(o.item->>'status','') not in ('ASSIGNED','OPEN'))
      or (coalesce(o.item->>'status','') = 'OPEN' and (coalesce(o.item->>'slotId','') <> '' or coalesce(o.item->>'personId','') <> ''))
      or coalesce(d.item->>'location_id','') <> coalesce(s.item->>'locationId','')
      or coalesce(d.item->>'coverage_start','') <> coalesce(s.item#>>'{window,start}','')
      or coalesce(d.item->>'coverage_end','') <> coalesce(s.item#>>'{window,end}','')
      or coalesce(d.item->>'workload_points','') <> coalesce(s.item->>'serviceEffortMinutes','')
      or coalesce(d.item->>'owner_slot_id','') <> coalesce(o.item->>'slotId','')
      or coalesce(d.item->>'owner_person_id_snapshot','') <> coalesce(o.item->>'personId','')
      or coalesce(d.item->>'owner_name_snapshot','') <> coalesce(o.item->>'displayName','')
      or coalesce(d.item#>>'{payload_json,owner_digest}','') <> coalesce(o.item->>'ownerDigest','')
      or coalesce(d.item#>>'{payload_json,exact_owner_identity}','') <> coalesce(o.item->>'exactOwnerIdentity','')
  ) then raise exception using errcode='23514', message='source work retention, optimizer status, and draft work facts must be exact'; end if;
  if exists(
    with source as (
      select value item, ((value->>'dayOfWeek') || ':' || coalesce(value->>'workId',value->>'id')) plan_work_id,
        coalesce(value->>'originSlotId',value->>'ownerSlotId',value->>'baselineSlotId') baseline_slot_id,
        (p_effective_date + (((value->>'dayOfWeek')::integer - extract(dow from p_effective_date)::integer + 7) % 7))::date occurrence_date
      from jsonb_array_elements(v_input #> '{version,assignments}')
    ), optimizer as (select value item from jsonb_array_elements(v_optimizer->'assignments')), facts as (
      select s.*,o.item optimizer,
        (select value from jsonb_array_elements(v_input->'slots') value where value->>'id'=o.item->>'slotId') owner_slot,
        (select value from jsonb_array_elements(v_input->'slots') value where value->>'id'=s.baseline_slot_id) baseline_slot
      from source s join optimizer o on o.item->>'planWorkId'=s.plan_work_id
    ) select 1 from facts f
    where f.baseline_slot is null
      or (f.optimizer->>'status'='ASSIGNED' and f.owner_slot is null)
      or (select count(*) from jsonb_array_elements(f.baseline_slot->'incumbencies') i where (i->>'effectiveStart')::date<=f.occurrence_date and (nullif(i->>'effectiveEnd','') is null or f.occurrence_date<(i->>'effectiveEnd')::date))<>1
      or (f.optimizer->>'status'='ASSIGNED' and (select count(*) from jsonb_array_elements(f.owner_slot->'incumbencies') i where (i->>'effectiveStart')::date<=f.occurrence_date and (nullif(i->>'effectiveEnd','') is null or f.occurrence_date<(i->>'effectiveEnd')::date))<>1)
      or coalesce(f.optimizer->>'baselineOwnerPersonId','')<>coalesce((select i->>'personId' from jsonb_array_elements(f.baseline_slot->'incumbencies') i where (i->>'effectiveStart')::date<=f.occurrence_date and (nullif(i->>'effectiveEnd','') is null or f.occurrence_date<(i->>'effectiveEnd')::date)),'')
      or coalesce(f.optimizer->>'baselineOwnerName','')<>coalesce((select i->>'displayName' from jsonb_array_elements(f.baseline_slot->'incumbencies') i where (i->>'effectiveStart')::date<=f.occurrence_date and (nullif(i->>'effectiveEnd','') is null or f.occurrence_date<(i->>'effectiveEnd')::date)),'')
      or (f.optimizer->>'status'='ASSIGNED' and (
        coalesce(f.optimizer->>'personId','')<>coalesce((select i->>'personId' from jsonb_array_elements(f.owner_slot->'incumbencies') i where (i->>'effectiveStart')::date<=f.occurrence_date and (nullif(i->>'effectiveEnd','') is null or f.occurrence_date<(i->>'effectiveEnd')::date)),'')
        or coalesce(f.optimizer->>'displayName','')<>coalesce((select i->>'displayName' from jsonb_array_elements(f.owner_slot->'incumbencies') i where (i->>'effectiveStart')::date<=f.occurrence_date and (nullif(i->>'effectiveEnd','') is null or f.occurrence_date<(i->>'effectiveEnd')::date)),'')
        or coalesce(f.optimizer->>'ownerDigest','')<>public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',f.plan_work_id,'slotId',f.optimizer->>'slotId','personId',f.optimizer->>'personId','serviceDate',f.occurrence_date::text))
      ))
      or coalesce(f.optimizer->>'exactOwnerIdentity','')<>public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',f.plan_work_id,'service_date',f.occurrence_date::text,'optimized_owner_slot_id',case when f.optimizer->>'status'='ASSIGNED' then f.optimizer->>'slotId' else null end,'optimized_owner_person_id',case when f.optimizer->>'status'='ASSIGNED' then f.optimizer->>'personId' else null end,'baseline_owner_slot_id',f.baseline_slot_id,'baseline_owner_person_id',f.optimizer->>'baselineOwnerPersonId'))
      or not exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges r where r.slot_id=f.baseline_slot_id::uuid and r.person_id=(f.optimizer->>'baselineOwnerPersonId')::uuid and r.person_name_snapshot=f.optimizer->>'baselineOwnerName' and r.effective_start<=f.occurrence_date and (r.effective_end is null or f.occurrence_date<r.effective_end))
      or (f.optimizer->>'status'='ASSIGNED' and not exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges r where r.slot_id=(f.optimizer->>'slotId')::uuid and r.person_id=(f.optimizer->>'personId')::uuid and r.person_name_snapshot=f.optimizer->>'displayName' and r.effective_start<=f.occurrence_date and (r.effective_end is null or f.occurrence_date<r.effective_end)))
  ) then raise exception using errcode='23514', message='optimizer dated owner, baseline, digest, or exact-owner identity is invalid'; end if;
  if exists(
    with explicit as (
      select value item, (p_effective_date + (((value->>'dayOfWeek')::integer - extract(dow from p_effective_date)::integer + 7) % 7))::date occurrence_date
      from jsonb_array_elements(v_input #> '{version,slotAvailability}')
    ), named as (
      select jsonb_build_object('slotId',slot_id,'dayOfWeek',day_of_week,'status','departed_named_absent') item,
        (p_effective_date + ((day_of_week - extract(dow from p_effective_date)::integer + 7) % 7))::date occurrence_date
      from jsonb_array_elements_text(coalesce(v_input #> '{version,namedAbsentSlotIds}','[]'::jsonb)) slot_id cross join generate_series(0,6) day_of_week
      where not exists(select 1 from explicit e where e.item->>'slotId'=slot_id and (e.item->>'dayOfWeek')::integer=day_of_week)
    ), source as (select * from explicit union all select * from named), document_rows as (select value item from jsonb_array_elements(v_document->'slot_availability'))
    select 1 from source s full join document_rows d on d.item->>'slot_id'=s.item->>'slotId' and (d.item->>'day_of_week')::integer=(s.item->>'dayOfWeek')::integer
    where s.item is null or d.item is null
      or coalesce(d.item->>'availability_state','')<>coalesce(s.item->>'status','')
      or coalesce(d.item->>'shift_start','')<>coalesce(s.item#>>'{shift,start}','')
      or coalesce(d.item->>'shift_end','')<>coalesce(s.item#>>'{shift,end}','')
      or coalesce(d.item->>'qualification_snapshot','[]')<>coalesce(s.item->'qualifications','[]'::jsonb)::text
      or coalesce(d.item->>'restriction_snapshot','[]')<>coalesce(s.item->'restrictions','[]'::jsonb)::text
      or coalesce(d.item->>'incumbent_person_id_snapshot','')<>coalesce((select i->>'personId' from jsonb_array_elements((select value from jsonb_array_elements(v_input->'slots') value where value->>'id'=s.item->>'slotId')->'incumbencies') i where (i->>'effectiveStart')::date<=s.occurrence_date and (nullif(i->>'effectiveEnd','') is null or s.occurrence_date<(i->>'effectiveEnd')::date)),'')
      or coalesce(d.item->>'incumbent_name_snapshot','')<>coalesce((select i->>'displayName' from jsonb_array_elements((select value from jsonb_array_elements(v_input->'slots') value where value->>'id'=s.item->>'slotId')->'incumbencies') i where (i->>'effectiveStart')::date<=s.occurrence_date and (nullif(i->>'effectiveEnd','') is null or s.occurrence_date<(i->>'effectiveEnd')::date)),'')
  ) then raise exception using errcode='23514', message='availability must retain every dated roster identity independent of selected work'; end if;
end
$function$;

-- Draft JSON and relational schedule rows are one authority write.  Both
-- create and update use this generator so a newly created draft is complete
-- without requiring a ceremonial no-op update before publication.
create or replace function public.static_weekly_materialize_draft_document(
  p_version_id uuid, p_document jsonb, p_content_digest text,
  p_actor_manager_id uuid, p_actor_manager_name text
) returns void language plpgsql set search_path = pg_catalog, public as $function$
begin
  perform set_config('app.static_weekly_draft_command','on',true);
  delete from public.weekly_schedule_slot_assignments where version_id=p_version_id;
  delete from public.weekly_schedule_slot_availability where version_id=p_version_id;
  delete from public.weekly_schedule_objective_inputs where version_id=p_version_id;

  insert into public.weekly_schedule_slot_availability(version_id,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,max_load_points,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest)
  select p_version_id,x.slot_id,x.day_of_week,x.availability_state,x.shift_start,x.shift_end,x.lunch_start,x.lunch_end,x.capacity_units,x.max_load_points,coalesce(x.qualification_snapshot,'[]'),coalesce(x.qualification_provenance,'{}'),coalesce(x.restriction_snapshot,'[]'),coalesce(x.restriction_provenance,'{}'),x.slot_label_snapshot,x.incumbent_person_id_snapshot,x.incumbent_name_snapshot,p_content_digest
  from jsonb_to_recordset(p_document->'slot_availability') as x(slot_id uuid,day_of_week smallint,availability_state text,shift_start time,shift_end time,lunch_start time,lunch_end time,capacity_units numeric,max_load_points numeric,qualification_snapshot jsonb,qualification_provenance jsonb,restriction_snapshot jsonb,restriction_provenance jsonb,slot_label_snapshot text,incumbent_person_id_snapshot uuid,incumbent_name_snapshot text);

  insert into public.weekly_schedule_slot_assignments(version_id,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,required_qualifications_snapshot,restriction_snapshot,workload_points,workload_provenance,manual_lock,payload_json,content_digest)
  select p_version_id,x.work_id,x.day_of_week,x.location_id,x.location_code_snapshot,x.location_name_snapshot,x.coverage_start,x.coverage_end,x.owner_slot_id,x.owner_slot_label_snapshot,x.owner_person_id_snapshot,x.owner_name_snapshot,coalesce(x.required_qualifications_snapshot,'[]'),coalesce(x.restriction_snapshot,'[]'),x.workload_points,coalesce(x.workload_provenance,'{}'),coalesce(x.manual_lock,false),coalesce(x.payload_json,'{}'),p_content_digest
  from jsonb_to_recordset(p_document->'assignments') as x(work_id text,day_of_week smallint,location_id uuid,location_code_snapshot text,location_name_snapshot text,coverage_start time,coverage_end time,owner_slot_id uuid,owner_slot_label_snapshot text,owner_person_id_snapshot uuid,owner_name_snapshot text,required_qualifications_snapshot jsonb,restriction_snapshot jsonb,workload_points numeric,workload_provenance jsonb,manual_lock boolean,payload_json jsonb);

  insert into public.weekly_schedule_objective_inputs(version_id,input_key,input_value,provenance,content_digest,captured_by_manager_id,captured_by_manager_name_snapshot)
  select p_version_id,x.input_key,x.input_value,x.provenance,p_content_digest,p_actor_manager_id,p_actor_manager_name
  from jsonb_to_recordset(p_document->'objective_inputs') as x(input_key text,input_value jsonb,provenance jsonb);
end
$function$;
revoke all on function public.static_weekly_materialize_draft_document(uuid,jsonb,text,uuid,text) from public, anon, authenticated, service_role;

create or replace function public.static_weekly_v2_create_draft(
  p_effective_start date, p_objective_version text, p_objective jsonb, p_input_provenance jsonb, p_document jsonb,
  p_expected_revision bigint, p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_command uuid := gen_random_uuid(); v_version uuid := gen_random_uuid(); v_revision bigint;
  v_document jsonb; v_content_digest text; v_request_digest text; v_response jsonb; v_prior public.weekly_schedule_command_receipts%rowtype;
begin
  if p_effective_start is null or btrim(coalesce(p_objective_version, '')) = '' or btrim(coalesce(p_actor_manager_name, '')) = '' or p_actor_manager_id is null or btrim(coalesce(p_idempotency_key, '')) = '' then
    raise exception using errcode = '23514', message = 'complete draft authority inputs are required';
  end if;
  v_document := public.static_weekly_canonical_document(coalesce(p_document, '{}'::jsonb));
  v_content_digest := public.static_weekly_digest_jsonb(jsonb_build_object('objective_version', p_objective_version, 'objective', coalesce(p_objective, '{}'::jsonb), 'input_provenance', coalesce(p_input_provenance, '{}'::jsonb), 'document', v_document));
  v_request_digest := public.static_weekly_digest_jsonb(jsonb_build_object('operation','create_draft','effective_start',p_effective_start,'content_digest',v_content_digest,'expected_revision',p_expected_revision));
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority', 0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id = p_actor_manager_id and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.request_digest <> v_request_digest then raise exception using errcode = '23505', message = 'idempotency key was already used for a different command'; end if;
    return v_prior.response_json;
  end if;
  v_revision := public.static_weekly_advance_authority(p_expected_revision, 'create_draft', p_actor_manager_id, p_actor_manager_name, v_command, v_content_digest);
  insert into public.weekly_schedule_versions(version_id,lifecycle_state,effective_start,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot)
  values (v_version,'draft',p_effective_start,p_objective_version,coalesce(p_objective,'{}'),coalesce(p_input_provenance,'{}'),v_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  perform public.static_weekly_materialize_draft_document(v_version,v_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response := public.static_weekly_response_json('create_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',v_version,'draft_revision',1,'effective_start',p_effective_start));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_actor_manager_id,p_actor_manager_name,'create_draft',p_idempotency_key,p_expected_revision,v_request_digest,jsonb_build_object('document',v_document),v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v2_update_draft(
  p_version_id uuid, p_document jsonb, p_objective jsonb, p_input_provenance jsonb, p_expected_draft_revision bigint,
  p_expected_revision bigint, p_actor_manager_id uuid, p_actor_manager_name text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_command uuid := gen_random_uuid(); v_revision bigint; v_document jsonb; v_content_digest text; v_request_digest text; v_response jsonb; v_prior public.weekly_schedule_command_receipts%rowtype;
begin
  v_document := public.static_weekly_canonical_document(coalesce(p_document, '{}'::jsonb));
  v_content_digest := public.static_weekly_digest_jsonb(jsonb_build_object('version_id',p_version_id,'document',v_document,'objective',coalesce(p_objective,'{}'::jsonb),'input_provenance',coalesce(p_input_provenance,'{}'::jsonb)));
  v_request_digest := public.static_weekly_digest_jsonb(jsonb_build_object('operation','update_draft','version_id',p_version_id,'content_digest',v_content_digest,'expected_draft_revision',p_expected_draft_revision,'expected_revision',p_expected_revision));
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority', 0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id = p_actor_manager_id and idempotency_key = p_idempotency_key;
  if found then if v_prior.request_digest <> v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for a different command'; end if; return v_prior.response_json; end if;
  perform 1 from public.weekly_schedule_versions where version_id=p_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update;
  if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  v_revision := public.static_weekly_advance_authority(p_expected_revision,'update_draft',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  perform set_config('app.static_weekly_draft_command','on',true);
  update public.weekly_schedule_versions set draft_document=v_document,objective_json=coalesce(p_objective,'{}'),input_provenance_json=coalesce(p_input_provenance,'{}'),content_digest=v_content_digest,revision=revision+1 where version_id=p_version_id;
  perform public.static_weekly_materialize_draft_document(p_version_id,v_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response := public.static_weekly_response_json('update_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',p_version_id,'draft_revision',p_expected_draft_revision+1));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_actor_manager_id,p_actor_manager_name,'update_draft',p_idempotency_key,p_expected_revision,v_request_digest,jsonb_build_object('document',v_document),v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_assert_draft_publishable(p_draft_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_document jsonb; v_effective date; v_content_digest text;
begin
  select draft_document,effective_start,content_digest into v_document,v_effective,v_content_digest from public.weekly_schedule_versions where version_id=p_draft_id and lifecycle_state='draft';
  if v_document is null then raise exception using errcode='40001', message='stale draft revision'; end if;
  perform public.static_weekly_assert_exact_document(v_document,v_effective);
  if (select count(*) from public.weekly_schedule_slot_availability where version_id=p_draft_id) <> jsonb_array_length(v_document->'slot_availability')
      or (select count(*) from public.weekly_schedule_slot_assignments where version_id=p_draft_id) <> jsonb_array_length(v_document->'assignments')
      or (select count(*) from public.weekly_schedule_objective_inputs where version_id=p_draft_id) <> jsonb_array_length(v_document->'objective_inputs') then
    raise exception using errcode='23514', message='draft relational schedule row counts must exactly match the immutable document';
  end if;
  if exists(
    select 1
    from jsonb_to_recordset(v_document->'slot_availability') as x(slot_id uuid,day_of_week smallint,availability_state text,shift_start time,shift_end time,lunch_start time,lunch_end time,capacity_units numeric,max_load_points numeric,qualification_snapshot jsonb,qualification_provenance jsonb,restriction_snapshot jsonb,restriction_provenance jsonb,slot_label_snapshot text,incumbent_person_id_snapshot uuid,incumbent_name_snapshot text)
    left join public.weekly_schedule_slot_availability r on r.version_id=p_draft_id and r.slot_id=x.slot_id and r.day_of_week=x.day_of_week
    where r.version_id is null
      or r.availability_state is distinct from x.availability_state or r.shift_start is distinct from x.shift_start or r.shift_end is distinct from x.shift_end
      or r.lunch_start is distinct from x.lunch_start or r.lunch_end is distinct from x.lunch_end or r.capacity_units is distinct from x.capacity_units or r.max_load_points is distinct from x.max_load_points
      or r.qualification_snapshot is distinct from coalesce(x.qualification_snapshot,'[]') or r.qualification_provenance is distinct from coalesce(x.qualification_provenance,'{}')
      or r.restriction_snapshot is distinct from coalesce(x.restriction_snapshot,'[]') or r.restriction_provenance is distinct from coalesce(x.restriction_provenance,'{}')
      or r.slot_label_snapshot is distinct from x.slot_label_snapshot or r.incumbent_person_id_snapshot is distinct from x.incumbent_person_id_snapshot or r.incumbent_name_snapshot is distinct from x.incumbent_name_snapshot
      or r.content_digest is distinct from v_content_digest
  ) then raise exception using errcode='23514', message='draft availability rows must exactly materialize the immutable document'; end if;
  if exists(
    select 1
    from jsonb_to_recordset(v_document->'assignments') as x(work_id text,day_of_week smallint,location_id uuid,location_code_snapshot text,location_name_snapshot text,coverage_start time,coverage_end time,owner_slot_id uuid,owner_slot_label_snapshot text,owner_person_id_snapshot uuid,owner_name_snapshot text,required_qualifications_snapshot jsonb,restriction_snapshot jsonb,workload_points numeric,workload_provenance jsonb,manual_lock boolean,payload_json jsonb)
    left join public.weekly_schedule_slot_assignments r on r.version_id=p_draft_id and r.work_id=x.work_id and r.day_of_week=x.day_of_week
    where r.version_id is null
      or r.location_id is distinct from x.location_id or r.location_code_snapshot is distinct from x.location_code_snapshot or r.location_name_snapshot is distinct from x.location_name_snapshot
      or r.coverage_start is distinct from x.coverage_start or r.coverage_end is distinct from x.coverage_end or r.owner_slot_id is distinct from x.owner_slot_id
      or r.owner_slot_label_snapshot is distinct from x.owner_slot_label_snapshot or r.owner_person_id_snapshot is distinct from x.owner_person_id_snapshot or r.owner_name_snapshot is distinct from x.owner_name_snapshot
      or r.required_qualifications_snapshot is distinct from coalesce(x.required_qualifications_snapshot,'[]') or r.restriction_snapshot is distinct from coalesce(x.restriction_snapshot,'[]')
      or r.workload_points is distinct from x.workload_points or r.workload_provenance is distinct from coalesce(x.workload_provenance,'{}') or r.manual_lock is distinct from coalesce(x.manual_lock,false)
      or r.payload_json is distinct from coalesce(x.payload_json,'{}') or r.authority_facts_json is distinct from coalesce(x.payload_json->'authority_facts','{}') or r.content_digest is distinct from v_content_digest
  ) then raise exception using errcode='23514', message='draft assignment rows must exactly materialize the immutable document'; end if;
  if exists(
    select 1
    from jsonb_to_recordset(v_document->'objective_inputs') as x(input_key text,input_value jsonb,provenance jsonb)
    left join public.weekly_schedule_objective_inputs r on r.version_id=p_draft_id and r.input_key=x.input_key
    where r.version_id is null or r.input_value is distinct from x.input_value or r.provenance is distinct from x.provenance or r.content_digest is distinct from v_content_digest
  ) then raise exception using errcode='23514', message='draft objective rows must exactly materialize the immutable document'; end if;
  if exists(select 1 from jsonb_array_elements(v_document #> '{authority,optimizer_result,assignments}') item
      where item->>'status'='REVIEW') then
    raise exception using errcode='23514', message='required unresolved work cannot be published';
  end if;
end
$function$;

-- The v2 RPCs are the sole application write seam. Internal mutation helpers
-- remain owner-only, while browser roles receive no authority capability.
revoke all on function public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text) from public, anon, authenticated;
revoke all on function public.static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text) from public, anon, authenticated;
revoke all on function public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.static_weekly_v2_apply_exception(text,date,time,time,uuid,uuid,text,jsonb,bigint,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text) from public, anon, authenticated;
revoke all on function public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text) from public, anon, authenticated;

grant execute on function public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid) to service_role;
grant execute on function public.static_weekly_v2_apply_exception(text,date,time,time,uuid,uuid,text,jsonb,bigint,uuid,text,text,uuid) to service_role;
grant execute on function public.static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text) to service_role;

comment on function public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text) is 'Server-computed canonical digest and receipt command; service role may execute this sole draft-create seam.';
comment on function public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid) is 'Atomic, receipt-rechecked, validation-bound immutable publication command.';
comment on function public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text) is 'Consumes exact optimizer owner slot/result identity, snapshots the dated incumbent, and preserves the baseline owner as original actor.';

commit;
