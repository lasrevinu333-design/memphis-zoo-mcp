-- I2 static-weekly scheduler authority.
--
-- The frozen I1 compiler/verifier is the scheduling authority.  This migration
-- stores its complete independently-verifiable receipt and materializes only
-- its canonical projection. PostgreSQL verifies identities, receipt shape,
-- dated identity, and JSON/relational parity; it intentionally does not claim
-- to re-solve or independently prove the MIP optimum.
begin;

create extension if not exists pgcrypto;

create or replace function public.static_weekly_digest_text(p_value text)
returns text language plpgsql stable strict security definer set search_path=pg_catalog,public as $function$
declare v_schema text; v_digest text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto';
  if v_schema not in ('extensions','public') then
    raise exception using errcode='55000', message='pgcrypto must be installed in extensions or public';
  end if;
  execute format('select encode(%I.digest(convert_to($1,''UTF8''),''sha256''),''hex'')',v_schema) into v_digest using p_value;
  return v_digest;
end
$function$;

create or replace function public.static_weekly_digest_jsonb(p_value jsonb)
returns text language sql stable strict security definer set search_path=pg_catalog,public as $function$
  select public.static_weekly_digest_text(p_value::text)
$function$;

create table if not exists public.static_weekly_schedule_control (
  singleton boolean primary key default true check (singleton),
  current_revision bigint not null default 0 check (current_revision >= 0),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by_manager_id uuid,
  updated_by_manager_name_snapshot text not null default 'system'
);
insert into public.static_weekly_schedule_control(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.weekly_roster_slots (
  slot_id uuid primary key default gen_random_uuid(),
  slot_code text not null unique check (length(btrim(slot_code))>0),
  slot_label text not null check (length(btrim(slot_label))>0),
  created_by_manager_id uuid not null,
  created_by_manager_name_snapshot text not null check (length(btrim(created_by_manager_name_snapshot))>0),
  created_at timestamptz not null default statement_timestamp(),
  content_digest text not null check (content_digest~'^[0-9a-f]{64}$')
);

create table if not exists public.weekly_roster_slot_incumbencies (
  incumbency_id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.weekly_roster_slots(slot_id) on delete restrict,
  person_id uuid not null,
  person_name_snapshot text not null check (length(btrim(person_name_snapshot))>0),
  effective_start date not null,
  effective_end date,
  created_by_manager_id uuid not null,
  created_by_manager_name_snapshot text not null check (length(btrim(created_by_manager_name_snapshot))>0),
  created_at timestamptz not null default statement_timestamp(),
  content_digest text not null check (content_digest~'^[0-9a-f]{64}$'),
  check (effective_end is null or effective_start<effective_end),
  unique(slot_id,person_id,effective_start)
);

create table if not exists public.weekly_schedule_authority_revisions (
  authority_revision bigint primary key check(authority_revision>0),
  command_id uuid not null unique,
  operation text not null check(operation in ('create_draft','update_draft','publish','supersede','rollback','apply_exception','reverse_exception','replace_incumbency','materialize_projection')),
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null,
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp()
);

create table if not exists public.weekly_roster_slot_incumbency_closures (
  incumbency_closure_id uuid primary key default gen_random_uuid(),
  closed_incumbency_id uuid not null unique references public.weekly_roster_slot_incumbencies(incumbency_id) on delete restrict,
  replacement_incumbency_id uuid not null unique references public.weekly_roster_slot_incumbencies(incumbency_id) on delete restrict,
  closed_at_effective_date date not null,
  authority_revision bigint not null unique references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null check(length(btrim(actor_manager_name_snapshot))>0),
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp()
);

create or replace view public.v_weekly_roster_slot_incumbency_ranges as
select i.incumbency_id,i.slot_id,i.person_id,i.person_name_snapshot,i.effective_start,
  coalesce(c.closed_at_effective_date,i.effective_end) as effective_end,
  i.created_by_manager_id,i.created_by_manager_name_snapshot,i.created_at,i.content_digest
from public.weekly_roster_slot_incumbencies i
left join public.weekly_roster_slot_incumbency_closures c on c.closed_incumbency_id=i.incumbency_id;

create table if not exists public.weekly_schedule_versions (
  version_id uuid primary key default gen_random_uuid(),
  version_number bigint unique,
  lifecycle_state text not null check(lifecycle_state in ('draft','published')),
  publication_kind text not null default 'publish' check(publication_kind in ('publish','supersede','rollback_compensation')),
  draft_of_version_id uuid references public.weekly_schedule_versions(version_id) on delete restrict,
  rollback_of_version_id uuid references public.weekly_schedule_versions(version_id) on delete restrict,
  effective_start date not null,
  revision bigint not null default 1 check(revision>0),
  objective_version text not null check(length(btrim(objective_version))>0),
  objective_json jsonb not null,
  input_provenance_json jsonb not null,
  draft_document jsonb not null,
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  created_by_manager_id uuid not null,
  created_by_manager_name_snapshot text not null check(length(btrim(created_by_manager_name_snapshot))>0),
  created_at timestamptz not null default statement_timestamp(),
  published_by_manager_id uuid,
  published_by_manager_name_snapshot text,
  published_at timestamptz,
  check ((lifecycle_state='draft' and version_number is null and published_at is null and published_by_manager_id is null)
      or (lifecycle_state='published' and version_number is not null and published_at is not null and published_by_manager_id is not null))
);

create table if not exists public.weekly_schedule_slot_availability (
  availability_id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  slot_id uuid not null references public.weekly_roster_slots(slot_id) on delete restrict,
  day_of_week smallint not null check(day_of_week between 0 and 6),
  availability_state text not null check(availability_state in ('working','departed_named_absent','absent','unavailable')),
  shift_start time, shift_end time, lunch_start time, lunch_end time,
  capacity_units numeric(14,4), max_load_points numeric(14,4),
  qualification_snapshot jsonb not null, qualification_provenance jsonb not null,
  restriction_snapshot jsonb not null, restriction_provenance jsonb not null,
  slot_label_snapshot text not null check(length(btrim(slot_label_snapshot))>0),
  incumbent_person_id_snapshot uuid, incumbent_name_snapshot text,
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(version_id,slot_id,day_of_week),
  check((shift_start is null and shift_end is null) or (shift_start is not null and shift_end is not null and shift_start<shift_end)),
  check((lunch_start is null and lunch_end is null) or (lunch_start is not null and lunch_end is not null and lunch_start<lunch_end)),
  check(availability_state<>'working' or (shift_start is not null and capacity_units>0 and max_load_points>0))
);

create table if not exists public.weekly_schedule_slot_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  work_id text not null check(length(btrim(work_id))>0),
  day_of_week smallint not null check(day_of_week between 0 and 6),
  status text not null check(status in ('assigned','open','review')),
  location_id uuid, location_code_snapshot text not null check(length(btrim(location_code_snapshot))>0),
  location_name_snapshot text not null check(length(btrim(location_name_snapshot))>0),
  coverage_start time not null, coverage_end time not null,
  owner_slot_id uuid references public.weekly_roster_slots(slot_id) on delete restrict,
  owner_slot_label_snapshot text, owner_person_id_snapshot uuid, owner_name_snapshot text,
  required_qualifications_snapshot jsonb not null, restriction_snapshot jsonb not null,
  workload_points numeric(14,4) not null check(workload_points>0), workload_provenance jsonb not null,
  manual_lock boolean not null default false, payload_json jsonb not null, authority_facts_json jsonb not null,
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(version_id,day_of_week,work_id), check(coverage_start<coverage_end),
  check((status='assigned' and owner_slot_id is not null and owner_slot_label_snapshot is not null and owner_person_id_snapshot is not null and owner_name_snapshot is not null)
     or (status in ('open','review') and owner_slot_id is null and owner_slot_label_snapshot is null and owner_person_id_snapshot is null and owner_name_snapshot is null))
);

create table if not exists public.weekly_schedule_objective_inputs (
  objective_input_id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  input_key text not null check(length(btrim(input_key))>0), input_value jsonb not null, provenance jsonb not null,
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  captured_at timestamptz not null default statement_timestamp(),
  captured_by_manager_id uuid not null, captured_by_manager_name_snapshot text not null,
  unique(version_id,input_key)
);

create table if not exists public.weekly_schedule_publications (
  publication_id uuid primary key default gen_random_uuid(),
  version_id uuid not null unique references public.weekly_schedule_versions(version_id) on delete restrict,
  authority_revision bigint not null unique references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
  publication_kind text not null check(publication_kind in ('publish','supersede','rollback_compensation')),
  effective_start date not null, prior_version_id uuid references public.weekly_schedule_versions(version_id) on delete restrict,
  expected_revision bigint not null, idempotency_key text not null check(length(btrim(idempotency_key))>0),
  actor_manager_id uuid not null, actor_manager_name_snapshot text not null,
  request_digest text not null check(request_digest~'^[0-9a-f]{64}$'),
  replay_digest text not null check(replay_digest~'^[0-9a-f]{64}$'),
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  output_digest text not null check(output_digest~'^[0-9a-f]{64}$'),
  published_at timestamptz not null default statement_timestamp(),
  unique(actor_manager_id,idempotency_key)
);

create table if not exists public.weekly_schedule_effective_range_closures (
  range_closure_id uuid primary key default gen_random_uuid(),
  closed_version_id uuid not null unique references public.weekly_schedule_versions(version_id) on delete restrict,
  closed_at_effective_date date not null,
  superseding_version_id uuid not null unique references public.weekly_schedule_versions(version_id) on delete restrict,
  publication_id uuid not null unique references public.weekly_schedule_publications(publication_id) on delete restrict,
  created_by_manager_id uuid not null, created_by_manager_name_snapshot text not null,
  created_at timestamptz not null default statement_timestamp(), content_digest text not null check(content_digest~'^[0-9a-f]{64}$')
);

create or replace view public.v_weekly_schedule_effective_ranges as
select v.version_id,v.version_number,v.effective_start,c.closed_at_effective_date as effective_end,v.publication_kind,v.content_digest
from public.weekly_schedule_versions v left join public.weekly_schedule_effective_range_closures c on c.closed_version_id=v.version_id
where v.lifecycle_state='published';

create table if not exists public.weekly_schedule_exception_commands (
  exception_id uuid primary key default gen_random_uuid(),
  authority_revision bigint not null unique references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
  exception_type text not null check(exception_type in ('pto','daily_absence','partial_absence','shift_override','cover_all','lunch','nine_forty_five_rebalance','event_impact','manager_correction','reverse')),
  service_date date not null, starts_at time, ends_at time,
  base_version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  publication_id uuid not null references public.weekly_schedule_publications(publication_id) on delete restrict,
  reverses_exception_id uuid references public.weekly_schedule_exception_commands(exception_id) on delete restrict,
  expected_revision bigint not null, idempotency_key text not null check(length(btrim(idempotency_key))>0),
  actor_manager_id uuid not null, actor_manager_name_snapshot text not null,
  reason text not null check(length(btrim(reason))>0), payload_json jsonb not null,
  payload_digest text not null check(payload_digest~'^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default statement_timestamp(),
  check((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and starts_at<ends_at)),
  check((exception_type='reverse')=(reverses_exception_id is not null)),
  unique(actor_manager_id,idempotency_key)
);

create table if not exists public.weekly_schedule_compiled_projections (
  projection_id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.weekly_schedule_publications(publication_id) on delete restrict,
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  week_start date not null, week_end date not null,
  exception_set_json jsonb not null, exception_set_digest text not null check(exception_set_digest~'^[0-9a-f]{64}$'),
  compiler_version text not null, objective_json jsonb not null, metrics_json jsonb not null,
  replay_digest text not null check(replay_digest~'^[0-9a-f]{64}$'),
  authority_digest text not null check(authority_digest~'^[0-9a-f]{64}$'),
  receipt_json jsonb not null, projection_envelope jsonb not null,
  compiled_by_manager_id uuid not null, compiled_at timestamptz not null default statement_timestamp(),
  unique(publication_id,week_start,exception_set_digest,compiler_version), check(week_end=week_start+6)
);

create table if not exists public.weekly_schedule_occurrences (
  occurrence_id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
  publication_id uuid not null references public.weekly_schedule_publications(publication_id) on delete restrict,
  version_id uuid not null references public.weekly_schedule_versions(version_id) on delete restrict,
  assignment_id uuid references public.weekly_schedule_slot_assignments(assignment_id) on delete restrict,
  service_date date not null, work_id text not null, day_of_week smallint not null check(day_of_week between 0 and 6),
  location_id uuid, location_code_snapshot text not null, location_name_snapshot text not null,
  coverage_start time not null, coverage_end time not null,
  owner_slot_id uuid references public.weekly_roster_slots(slot_id) on delete restrict,
  owner_slot_label_snapshot text, owner_person_id_snapshot uuid, owner_name_snapshot text,
  state text not null check(state in ('created','open','review')), state_reason text,
  original_actor_person_id uuid, original_actor_name_snapshot text, authority_facts_json jsonb not null,
  occurrence_digest text not null check(occurrence_digest~'^[0-9a-f]{64}$'), created_at timestamptz not null default statement_timestamp(),
  unique(projection_id,service_date,work_id), check(coverage_start<coverage_end),
  check((state='created' and owner_slot_id is not null and owner_person_id_snapshot is not null and owner_name_snapshot is not null)
     or (state in ('open','review') and owner_slot_id is null and owner_slot_label_snapshot is null and owner_person_id_snapshot is null and owner_name_snapshot is null))
);

create table if not exists public.weekly_schedule_projection_assignments (
  projection_assignment_id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
  occurrence_id uuid not null references public.weekly_schedule_occurrences(occurrence_id) on delete restrict,
  work_id text not null, status text not null check(status in ('assigned','open','review')), reason_code text,
  owner_slot_id uuid references public.weekly_roster_slots(slot_id) on delete restrict,
  owner_slot_label_snapshot text, owner_person_id_snapshot uuid, owner_name_snapshot text,
  authority_facts_json jsonb not null, explanation_json jsonb not null,
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'), created_at timestamptz not null default statement_timestamp(),
  unique(projection_id,occurrence_id),
  check((status='assigned' and owner_slot_id is not null and owner_person_id_snapshot is not null and owner_name_snapshot is not null)
     or (status in ('open','review') and owner_slot_id is null and owner_slot_label_snapshot is null and owner_person_id_snapshot is null and owner_name_snapshot is null))
);

create table if not exists public.weekly_schedule_command_receipts (
  command_id uuid primary key default gen_random_uuid(), actor_manager_id uuid not null, actor_manager_name_snapshot text not null,
  command_type text not null check(command_type in ('create_draft','update_draft','publish','supersede','rollback','apply_exception','reverse_exception','replace_incumbency','materialize_projection')),
  idempotency_key text not null check(length(btrim(idempotency_key))>0), expected_revision bigint not null,
  request_digest text not null check(request_digest~'^[0-9a-f]{64}$'), request_canonical_json jsonb not null,
  response_json jsonb not null, response_digest text not null check(response_digest~'^[0-9a-f]{64}$'),
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'), accepted_at timestamptz not null default statement_timestamp(),
  unique(actor_manager_id,idempotency_key)
);

create index if not exists idx_weekly_incumbency_ranges on public.weekly_roster_slot_incumbencies(slot_id,effective_start);
create index if not exists idx_weekly_exception_horizon on public.weekly_schedule_exception_commands(publication_id,service_date,authority_revision);
create index if not exists idx_weekly_occurrence_date on public.weekly_schedule_occurrences(service_date,state);

create or replace function public.static_weekly_reject_update_delete()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin raise exception using errcode='23514',message=format('%s is append-only; %s is forbidden',tg_table_name,tg_op); end
$function$;

create or replace function public.static_weekly_component_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_state text;
begin
  select lifecycle_state into v_state from public.weekly_schedule_versions where version_id=coalesce(new.version_id,old.version_id);
  if current_setting('app.static_weekly_draft_write',true)='on' and v_state='draft' then
    if tg_op='DELETE' then return old; end if; return new;
  end if;
  if current_setting('app.static_weekly_publish_write',true)='on' and v_state='published' and tg_op='INSERT' then return new; end if;
  raise exception using errcode='23514',message='scheduler components may change only through a revision-checked v2 command';
end
$function$;

create or replace function public.static_weekly_version_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='weekly versions are immutable'; end if;
  if tg_op='INSERT' then
    if new.lifecycle_state='published' and current_setting('app.static_weekly_publish_write',true) is distinct from 'on' then raise exception using errcode='23514',message='published versions require v2 publication'; end if;
    return new;
  end if;
  if old.lifecycle_state='draft' and current_setting('app.static_weekly_publish_write',true)='on' and new.lifecycle_state='published' and new.revision=old.revision then return new; end if;
  if old.lifecycle_state<>'draft' or current_setting('app.static_weekly_draft_write',true) is distinct from 'on' or new.lifecycle_state<>'draft' or new.revision<>old.revision+1 then raise exception using errcode='23514',message='draft versions require a revision-checked v2 command'; end if;
  return new;
end
$function$;

create or replace function public.static_weekly_effective_version(p_service_date date)
returns uuid language sql stable security definer set search_path=pg_catalog,public as $function$
  select r.version_id from public.v_weekly_schedule_effective_ranges r
  where r.effective_start<=p_service_date and (r.effective_end is null or p_service_date<r.effective_end)
$function$;

create or replace function public.static_weekly_document_identity(p_document jsonb)
returns text language sql stable security definer set search_path=pg_catalog,public as $function$
  select public.static_weekly_digest_jsonb(jsonb_build_object(
    'adapter',coalesce(p_document->'adapter','{}'::jsonb), 'authority',coalesce(p_document->'authority','{}'::jsonb),
    'receipt',coalesce(p_document->'receipt','{}'::jsonb), 'slot_availability',coalesce(p_document->'slot_availability','[]'::jsonb),
    'assignments',coalesce(p_document->'assignments','[]'::jsonb), 'objective_inputs',coalesce(p_document->'objective_inputs','[]'::jsonb)))
$function$;

-- JSON command envelopes cross a trust boundary.  PostgreSQL cannot repeat
-- I1's solver, but it can make the persisted receipt shape total: required
-- keys must exist and be non-null, and an envelope may not smuggle unknown
-- fields whose semantics this migration does not understand.
create or replace function public.static_weekly_assert_exact_object(p_value jsonb,p_required text[],p_allowed text[],p_label text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if jsonb_typeof(p_value) is distinct from 'object'
    or exists(select 1 from unnest(p_required) as r(key) where not (p_value ? r.key) or jsonb_typeof(p_value->r.key)='null')
    or exists(select 1 from jsonb_object_keys(p_value) as k(key) where not (k.key=any(p_allowed))) then
    raise exception using errcode='23514',message=format('%s must be a complete exact non-null JSON object',p_label);
  end if;
end
$function$;

create or replace function public.static_weekly_assert_command_identity(p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text,p_operation text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if p_expected_revision is null or p_expected_revision<0 or p_actor_manager_id is null
    or nullif(btrim(p_actor_manager_name),'') is null or nullif(btrim(p_idempotency_key),'') is null then
    raise exception using errcode='23514',message=format('%s requires non-null revision, actor identity, actor name, and idempotency key',p_operation);
  end if;
end
$function$;

create or replace function public.static_weekly_assert_compiler_authority(p_authority jsonb,p_receipt jsonb,p_effective_start date,p_require_publishable boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_without jsonb; v_compiler jsonb; v_certificate jsonb; v_optimizer jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_authority,
    array['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','weeklyVersionDigest','projectionAvailability','optimizerResult','appliedExceptions','databaseContentIdentity'],
    array['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','weeklyVersionDigest','projectionAvailability','optimizerResult','appliedExceptions','databaseContentIdentity'],'compiler authority');
  perform public.static_weekly_assert_exact_object(p_receipt,array['schema','adapterVersion','trustedAdapterBoundary','compiler'],array['schema','adapterVersion','trustedAdapterBoundary','compiler'],'adapter receipt');
  if jsonb_typeof(p_authority->'schema') is distinct from 'string' or jsonb_typeof(p_authority->'effectiveDate') is distinct from 'string'
    or jsonb_typeof(p_receipt->'schema') is distinct from 'string' or jsonb_typeof(p_receipt->'adapterVersion') is distinct from 'string'
    or jsonb_typeof(p_receipt->'trustedAdapterBoundary') is distinct from 'string'
    or p_authority->>'schema' is distinct from 'memphis-zoo.static-weekly-authority.v3'
    or p_receipt->>'schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1' or p_receipt->>'adapterVersion' is distinct from 'static-weekly-database-adapter-v1'
    or p_receipt->>'trustedAdapterBoundary' is distinct from 'I1 compileStaticWeeklySchedule result independently reverified before I2 persistence' then
    raise exception using errcode='23514',message='complete trusted I1-to-I2 adapter receipt is required';
  end if;
  v_compiler:=p_receipt->'compiler'; v_certificate:=v_compiler->'certificate'; v_optimizer:=p_authority->'optimizerResult';
  perform public.static_weekly_assert_exact_object(v_compiler,
    array['contract','compilerVersion','serviceDate','status','publicationAuthority','inputDigest','weeklyVersionId','weeklyVersionDigest','solutionDigest','authorityDigest','replayDigest','canonicalAuthority','authorityCertificate','authorityTiers','certificate','solver','verifier','independentVerification'],
    array['contract','compilerVersion','serviceDate','status','publicationAuthority','inputDigest','weeklyVersionId','weeklyVersionDigest','solutionDigest','authorityDigest','replayDigest','canonicalAuthority','authorityCertificate','authorityTiers','certificate','solver','verifier','independentVerification'],'compiler receipt');
  perform public.static_weekly_assert_exact_object(v_optimizer,array['compilerVersion','assignments','objective','certificate','tiers','metrics'],array['compilerVersion','assignments','objective','certificate','tiers','metrics'],'optimizer authority');
  perform public.static_weekly_assert_exact_object(p_authority->'compilerInput',array['serviceDate','version','slots','exceptions','proximity'],array['serviceDate','version','slots','exceptions','proximity'],'baseline compiler input');
  perform public.static_weekly_assert_exact_object(p_authority->'overlayCompilerInput',array['serviceDate','version','slots','exceptions','proximity'],array['serviceDate','version','slots','exceptions','proximity'],'overlay compiler input');
  if jsonb_typeof(v_compiler->'compilerVersion') is distinct from 'string' or jsonb_typeof(v_compiler->'status') is distinct from 'string'
    or jsonb_typeof(v_compiler->'publicationAuthority') is distinct from 'string' or jsonb_typeof(v_compiler->'inputDigest') is distinct from 'string'
    or jsonb_typeof(v_compiler->'solutionDigest') is distinct from 'string' or jsonb_typeof(v_compiler->'authorityDigest') is distinct from 'string'
    or jsonb_typeof(v_compiler->'replayDigest') is distinct from 'string' or jsonb_typeof(v_compiler->'canonicalAuthority') is distinct from 'object'
    or jsonb_typeof(v_certificate) is distinct from 'object' or jsonb_typeof(v_optimizer->'compilerVersion') is distinct from 'string'
    or jsonb_typeof(p_authority #> '{compilerInput,version}') is distinct from 'object'
    or jsonb_typeof(p_authority #> '{compilerInput,version,id}') is distinct from 'string'
    or jsonb_typeof(p_authority #> '{compilerInput,version,publicationId}') is distinct from 'string'
    or jsonb_typeof(p_authority #> '{compilerInput,version,assignments}') is distinct from 'array' or jsonb_typeof(p_authority #> '{compilerInput,version,slotAvailability}') is distinct from 'array'
    or jsonb_typeof(p_authority #> '{compilerInput,slots}') is distinct from 'array' or jsonb_typeof(p_authority #> '{compilerInput,exceptions}') is distinct from 'array'
    or jsonb_typeof(p_authority #> '{overlayCompilerInput,exceptions}') is distinct from 'array'
    or jsonb_typeof(v_optimizer->'assignments') is distinct from 'array' or jsonb_typeof(v_optimizer->'tiers') is distinct from 'array'
    or jsonb_typeof(v_optimizer->'certificate') is distinct from 'object' or jsonb_typeof(p_authority->'projectionAvailability') is distinct from 'array'
    or jsonb_typeof(p_authority->'appliedExceptions') is distinct from 'array' then
    raise exception using errcode='23514',message='compiler, optimizer, certificate, model, and projection receipt fields are required';
  end if;
  v_without:=p_authority-'databaseContentIdentity';
  if jsonb_typeof(p_authority->'inputDigest') is distinct from 'string' or jsonb_typeof(p_authority->'baselineInputDigest') is distinct from 'string'
    or jsonb_typeof(p_authority->'weeklyVersionDigest') is distinct from 'string' or jsonb_typeof(p_authority->'databaseContentIdentity') is distinct from 'string'
    or p_authority->>'effectiveDate' is distinct from p_effective_start::text
    or p_authority->>'databaseContentIdentity' is distinct from public.static_weekly_digest_jsonb(v_without)
    or p_authority->>'inputDigest' is distinct from public.static_weekly_digest_jsonb(p_authority->'overlayCompilerInput')
    or p_authority->>'baselineInputDigest' is distinct from public.static_weekly_digest_jsonb(p_authority->'compilerInput')
    or v_compiler->>'inputDigest' is distinct from p_authority->>'inputDigest'
    or v_compiler->>'solutionDigest' is distinct from public.static_weekly_digest_jsonb(v_optimizer)
    or v_compiler->>'authorityDigest' is distinct from public.static_weekly_digest_jsonb(p_authority)
    or v_compiler->'canonicalAuthority' is distinct from p_authority
    or coalesce(v_compiler->>'replayDigest','') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='23514',message='compiler input, baseline, solution, authority, and replay identities must be exact';
  end if;
  if jsonb_typeof(v_certificate->'schema') is distinct from 'string' or jsonb_typeof(v_certificate->'compilerVersion') is distinct from 'string'
    or jsonb_typeof(v_certificate->'canonicalInputDigest') is distinct from 'string' or jsonb_typeof(v_certificate->'baselineInputDigest') is distinct from 'string'
    or jsonb_typeof(v_certificate->'weeklyVersionDigest') is distinct from 'string'
    or v_certificate->>'schema' is distinct from 'memphis-zoo.static-weekly-solver-certificate.v4'
    or v_certificate->>'compilerVersion' is distinct from v_compiler->>'compilerVersion'
    or v_certificate->>'canonicalInputDigest' is distinct from p_authority->>'inputDigest'
    or v_certificate->>'baselineInputDigest' is distinct from p_authority->>'baselineInputDigest'
    or v_certificate->>'weeklyVersionDigest' is distinct from p_authority->>'weeklyVersionDigest'
    or jsonb_typeof(v_certificate->'modelBasis') is distinct from 'object' or jsonb_typeof(v_certificate->'canonicalProgram') is distinct from 'object'
    or jsonb_typeof(v_certificate->'finalWitness') is distinct from 'object' or jsonb_typeof(v_certificate->'tiers') is distinct from 'array'
    or jsonb_typeof(v_compiler #> '{solver,tiers}') is distinct from 'array'
    or jsonb_typeof(v_compiler #> '{independentVerification,violations}') is distinct from 'array'
    or jsonb_typeof(v_compiler #> '{independentVerification,ok}') is distinct from 'boolean'
    or (v_compiler #>> '{independentVerification,ok}') is distinct from 'true'
    or v_optimizer->'certificate' is distinct from v_compiler->'authorityCertificate'
    or v_optimizer->'tiers' is distinct from v_compiler->'authorityTiers' then
    raise exception using errcode='23514',message='complete accepted solver/verifier certificate, tiers, model, witness, and verification receipt are required';
  end if;
  if p_require_publishable and (v_compiler->>'status' is distinct from 'FEASIBLE' or v_compiler->>'publicationAuthority' is distinct from 'ACCEPTABLE') then
    raise exception using errcode='23514',message='only a successful publishable compiler result may create a recurring authority version';
  end if;
  if p_require_publishable and (
    p_authority->'appliedExceptions' is distinct from '[]'::jsonb
    or (p_authority->'overlayCompilerInput') is distinct from (p_authority->'compilerInput')
    or p_authority->>'inputDigest' is distinct from p_authority->>'baselineInputDigest'
  ) then
    raise exception using errcode='23514',message='recurring draft authority must be an exception-free baseline compiler result';
  end if;
end
$function$;

create or replace function public.static_weekly_assert_document(p_document jsonb,p_effective_start date,p_require_publishable boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_authority jsonb:=p_document->'authority'; v_assignments jsonb:=p_document->'assignments'; v_availability jsonb:=p_document->'slot_availability'; v_objective_inputs jsonb:=p_document->'objective_inputs';
begin
  perform public.static_weekly_assert_exact_object(p_document,array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation'],array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation'],'adapter document');
  perform public.static_weekly_assert_exact_object(p_document->'adapter',array['schema','version'],array['schema','version'],'adapter document adapter');
  perform public.static_weekly_assert_exact_object(p_document->'validation',array['status','publication_authority','compiler_version','input_digest','solution_digest','authority_digest','replay_digest','receipt_digest','database_document_identity'],array['status','publication_authority','compiler_version','input_digest','solution_digest','authority_digest','replay_digest','receipt_digest','database_document_identity'],'adapter document validation');
  perform public.static_weekly_assert_compiler_authority(v_authority,p_document->'receipt',p_effective_start,p_require_publishable);
  if jsonb_typeof(p_document #> '{adapter,schema}') is distinct from 'string' or jsonb_typeof(p_document #> '{adapter,version}') is distinct from 'string'
    or exists(select 1 from unnest(array['status','publication_authority','compiler_version','input_digest','solution_digest','authority_digest','replay_digest','receipt_digest','database_document_identity']) as r(key) where jsonb_typeof(p_document->'validation'->r.key) is distinct from 'string')
    or p_document #>> '{adapter,schema}' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'
    or p_document #>> '{adapter,version}' is distinct from 'static-weekly-database-adapter-v1'
    or p_document #>> '{validation,database_document_identity}' is distinct from public.static_weekly_document_identity(p_document)
    or p_document #>> '{validation,authority_digest}' is distinct from public.static_weekly_digest_jsonb(v_authority)
    or p_document #>> '{validation,solution_digest}' is distinct from public.static_weekly_digest_jsonb(v_authority->'optimizerResult')
    or p_document #>> '{validation,input_digest}' is distinct from v_authority->>'inputDigest'
    or p_document #>> '{validation,replay_digest}' is distinct from p_document #>> '{receipt,compiler,replayDigest}'
    or p_document #>> '{validation,receipt_digest}' is distinct from public.static_weekly_digest_jsonb(p_document->'receipt')
    or jsonb_typeof(v_assignments) is distinct from 'array' or jsonb_typeof(v_availability) is distinct from 'array' or jsonb_typeof(v_objective_inputs) is distinct from 'array' then
    raise exception using errcode='23514',message='adapter document identity and exact relational projection are required';
  end if;
  if jsonb_array_length(v_assignments)=0 or jsonb_array_length(v_availability)=0 or jsonb_array_length(v_objective_inputs)<>1
    or exists(select 1 from jsonb_array_elements(v_assignments) as a(x)
      where jsonb_typeof(a.x) is distinct from 'object' or not (a.x ?& array['work_id','day_of_week','status','location_id','location_code_snapshot','location_name_snapshot','coverage_start','coverage_end','owner_slot_id','owner_slot_label_snapshot','owner_person_id_snapshot','owner_name_snapshot','required_qualifications_snapshot','restriction_snapshot','workload_points','workload_provenance','manual_lock','payload_json'])
        or exists(select 1 from jsonb_object_keys(a.x) as k(key) where not (k.key=any(array['work_id','day_of_week','status','location_id','location_code_snapshot','location_name_snapshot','coverage_start','coverage_end','owner_slot_id','owner_slot_label_snapshot','owner_person_id_snapshot','owner_name_snapshot','required_qualifications_snapshot','restriction_snapshot','workload_points','workload_provenance','manual_lock','payload_json'])))
        or jsonb_typeof(a.x->'work_id') is distinct from 'string' or nullif(btrim(a.x->>'work_id'),'') is null
        or jsonb_typeof(a.x->'day_of_week') is distinct from 'number' or (a.x->>'day_of_week') !~ '^[0-6]$'
        or jsonb_typeof(a.x->'status') is distinct from 'string' or upper(a.x->>'status') not in ('ASSIGNED','OPEN','REVIEW')
        or jsonb_typeof(a.x->'location_id') is distinct from 'string' or jsonb_typeof(a.x->'location_code_snapshot') is distinct from 'string' or nullif(btrim(a.x->>'location_code_snapshot'),'') is null
        or jsonb_typeof(a.x->'location_name_snapshot') is distinct from 'string' or nullif(btrim(a.x->>'location_name_snapshot'),'') is null
        or jsonb_typeof(a.x->'coverage_start') is distinct from 'string' or jsonb_typeof(a.x->'coverage_end') is distinct from 'string'
        or jsonb_typeof(a.x->'required_qualifications_snapshot') is distinct from 'array' or jsonb_typeof(a.x->'restriction_snapshot') is distinct from 'array'
        or jsonb_typeof(a.x->'workload_points') is distinct from 'number' or jsonb_typeof(a.x->'workload_provenance') is distinct from 'object'
        or jsonb_typeof(a.x->'manual_lock') is distinct from 'boolean' or jsonb_typeof(a.x->'payload_json') is distinct from 'object' or jsonb_typeof(a.x#>'{payload_json,authority_facts}') is distinct from 'object')
    or exists(select 1 from jsonb_array_elements(v_availability) as a(x)
      where jsonb_typeof(a.x) is distinct from 'object' or not (a.x ?& array['slot_id','day_of_week','availability_state','shift_start','shift_end','lunch_start','lunch_end','capacity_units','max_load_points','qualification_snapshot','qualification_provenance','restriction_snapshot','restriction_provenance','slot_label_snapshot','incumbent_person_id_snapshot','incumbent_name_snapshot'])
        or exists(select 1 from jsonb_object_keys(a.x) as k(key) where not (k.key=any(array['slot_id','day_of_week','availability_state','shift_start','shift_end','lunch_start','lunch_end','capacity_units','max_load_points','qualification_snapshot','qualification_provenance','restriction_snapshot','restriction_provenance','slot_label_snapshot','incumbent_person_id_snapshot','incumbent_name_snapshot'])))
        or jsonb_typeof(a.x->'slot_id') is distinct from 'string' or jsonb_typeof(a.x->'day_of_week') is distinct from 'number' or (a.x->>'day_of_week') !~ '^[0-6]$'
        or jsonb_typeof(a.x->'availability_state') is distinct from 'string' or jsonb_typeof(a.x->'qualification_snapshot') is distinct from 'array'
        or jsonb_typeof(a.x->'qualification_provenance') is distinct from 'object' or jsonb_typeof(a.x->'restriction_snapshot') is distinct from 'array'
        or jsonb_typeof(a.x->'restriction_provenance') is distinct from 'object' or jsonb_typeof(a.x->'slot_label_snapshot') is distinct from 'string' or nullif(btrim(a.x->>'slot_label_snapshot'),'') is null)
    or exists(select 1 from jsonb_array_elements(v_objective_inputs) as i(x)
      where jsonb_typeof(i.x) is distinct from 'object' or not (i.x ?& array['input_key','input_value','provenance'])
        or exists(select 1 from jsonb_object_keys(i.x) as k(key) where not (k.key=any(array['input_key','input_value','provenance'])))
        or i.x->>'input_key' is distinct from 'static_weekly_compiler_receipt' or jsonb_typeof(i.x->'input_value') is distinct from 'object' or jsonb_typeof(i.x->'provenance') is distinct from 'object') then
    raise exception using errcode='23514',message='adapter document rows must be complete, typed, exact, and non-empty';
  end if;
  if (select count(*) from jsonb_array_elements(v_assignments))<>(select count(distinct (x->>'day_of_week',x->>'work_id')) from jsonb_array_elements(v_assignments) as a(x))
    or (select count(*) from jsonb_array_elements(v_availability))<>(select count(distinct (x->>'day_of_week',x->>'slot_id')) from jsonb_array_elements(v_availability) as a(x)) then
    raise exception using errcode='23514',message='adapter document rows may not contain duplicate work or availability identities';
  end if;
  if exists(
    with source as (select value x,((value->>'dayOfWeek')||':'||coalesce(value->>'workId',value->>'id')) k from jsonb_array_elements(v_authority #> '{compilerInput,version,assignments}')),
    optimizer as (select value x from jsonb_array_elements(v_authority #> '{optimizerResult,assignments}')),
    document as (select value x from jsonb_array_elements(v_assignments))
    select 1 from source s full join optimizer o on o.x->>'planWorkId'=s.k full join document d on ((d.x->>'day_of_week')||':'||(d.x->>'work_id'))=coalesce(s.k,o.x->>'planWorkId')
    where s.x is null or o.x is null or d.x is null
      or o.x->>'serviceDate' is distinct from (p_effective_start+(((s.x->>'dayOfWeek')::int-extract(dow from p_effective_start)::int+7)%7))::date::text
      or d.x->>'coverage_start' is distinct from s.x#>>'{window,start}' or d.x->>'coverage_end' is distinct from s.x#>>'{window,end}'
      or d.x->>'location_id' is distinct from s.x->>'locationId' or d.x->>'workload_points' is distinct from s.x->>'serviceEffortMinutes'
      or lower(d.x->>'status') is distinct from lower(o.x->>'status')
      or (o.x->>'status'='ASSIGNED' and (d.x->>'owner_slot_id' is distinct from o.x->>'slotId' or d.x->>'owner_person_id_snapshot' is distinct from o.x->>'personId' or d.x->>'owner_name_snapshot' is distinct from o.x->>'displayName'))
      or (o.x->>'status' in ('OPEN','REVIEW') and (d.x->>'owner_slot_id' is not null or d.x->>'owner_person_id_snapshot' is not null or d.x->>'owner_name_snapshot' is not null))
      or d.x#>>'{payload_json,owner_digest}' is distinct from o.x->>'ownerDigest'
      or d.x#>>'{payload_json,exact_owner_identity}' is distinct from o.x->>'exactOwnerIdentity'
  ) then raise exception using errcode='23514',message='all seven-day source work, optimizer owners, and document assignments must exactly agree'; end if;
  if exists(
    with source as (select value x from jsonb_array_elements(v_authority->'projectionAvailability')),
    document as (select value x from jsonb_array_elements(v_availability))
    select 1 from source s full join document d on d.x->>'slot_id'=s.x->>'slotId' and d.x->>'day_of_week'=s.x->>'dayOfWeek'
    where s.x is null or d.x is null or d.x->>'availability_state' is distinct from s.x->>'status'
      or d.x->>'shift_start' is distinct from s.x#>>'{shift,start}' or d.x->>'shift_end' is distinct from s.x#>>'{shift,end}'
      or d.x->>'capacity_units' is distinct from s.x->>'productiveCapacityMinutes' or d.x->>'max_load_points' is distinct from s.x->>'maxServiceEffortMinutes'
      or d.x->>'incumbent_person_id_snapshot' is distinct from s.x->>'incumbentPersonId' or d.x->>'incumbent_name_snapshot' is distinct from s.x->>'incumbentName'
  ) then raise exception using errcode='23514',message='all seven-day dated availability and incumbent identities must exactly agree'; end if;
end
$function$;

create or replace function public.static_weekly_materialize_document(p_version_id uuid,p_document jsonb,p_content_digest text,p_actor_manager_id uuid,p_actor_manager_name text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform set_config('app.static_weekly_draft_write','on',true);
  delete from public.weekly_schedule_slot_assignments where version_id=p_version_id;
  delete from public.weekly_schedule_slot_availability where version_id=p_version_id;
  delete from public.weekly_schedule_objective_inputs where version_id=p_version_id;
  insert into public.weekly_schedule_slot_availability(version_id,slot_id,day_of_week,availability_state,shift_start,shift_end,lunch_start,lunch_end,capacity_units,max_load_points,qualification_snapshot,qualification_provenance,restriction_snapshot,restriction_provenance,slot_label_snapshot,incumbent_person_id_snapshot,incumbent_name_snapshot,content_digest)
  select p_version_id,x.slot_id,x.day_of_week,x.availability_state,x.shift_start,x.shift_end,x.lunch_start,x.lunch_end,x.capacity_units,x.max_load_points,x.qualification_snapshot,x.qualification_provenance,x.restriction_snapshot,x.restriction_provenance,x.slot_label_snapshot,x.incumbent_person_id_snapshot,x.incumbent_name_snapshot,p_content_digest
  from jsonb_to_recordset(p_document->'slot_availability') x(slot_id uuid,day_of_week smallint,availability_state text,shift_start time,shift_end time,lunch_start time,lunch_end time,capacity_units numeric,max_load_points numeric,qualification_snapshot jsonb,qualification_provenance jsonb,restriction_snapshot jsonb,restriction_provenance jsonb,slot_label_snapshot text,incumbent_person_id_snapshot uuid,incumbent_name_snapshot text);
  insert into public.weekly_schedule_slot_assignments(version_id,work_id,day_of_week,status,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,required_qualifications_snapshot,restriction_snapshot,workload_points,workload_provenance,manual_lock,payload_json,authority_facts_json,content_digest)
  select p_version_id,x.work_id,x.day_of_week,lower(x.status),x.location_id,x.location_code_snapshot,x.location_name_snapshot,x.coverage_start,x.coverage_end,x.owner_slot_id,x.owner_slot_label_snapshot,x.owner_person_id_snapshot,x.owner_name_snapshot,x.required_qualifications_snapshot,x.restriction_snapshot,x.workload_points,x.workload_provenance,x.manual_lock,x.payload_json,x.payload_json->'authority_facts',p_content_digest
  from jsonb_to_recordset(p_document->'assignments') x(work_id text,day_of_week smallint,status text,location_id uuid,location_code_snapshot text,location_name_snapshot text,coverage_start time,coverage_end time,owner_slot_id uuid,owner_slot_label_snapshot text,owner_person_id_snapshot uuid,owner_name_snapshot text,required_qualifications_snapshot jsonb,restriction_snapshot jsonb,workload_points numeric,workload_provenance jsonb,manual_lock boolean,payload_json jsonb);
  insert into public.weekly_schedule_objective_inputs(version_id,input_key,input_value,provenance,content_digest,captured_by_manager_id,captured_by_manager_name_snapshot)
  select p_version_id,x.input_key,x.input_value,x.provenance,p_content_digest,p_actor_manager_id,p_actor_manager_name
  from jsonb_to_recordset(p_document->'objective_inputs') x(input_key text,input_value jsonb,provenance jsonb);
end
$function$;

create or replace function public.static_weekly_response_json(p_operation text,p_revision bigint,p_content_digest text,p_request_digest text,p_data jsonb)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  select jsonb_build_object('operation',p_operation,'revision',p_revision,'content_digest',p_content_digest,'request_digest',p_request_digest,'data',coalesce(p_data,'{}'::jsonb),
    'output_digest',public.static_weekly_digest_jsonb(jsonb_build_object('operation',p_operation,'revision',p_revision,'content_digest',p_content_digest,'request_digest',p_request_digest,'data',coalesce(p_data,'{}'::jsonb))))
$function$;

create or replace function public.static_weekly_advance_authority(p_expected_revision bigint,p_operation text,p_actor_manager_id uuid,p_actor_manager_name text,p_command_id uuid,p_digest text)
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_revision bigint;
begin
  update public.static_weekly_schedule_control set current_revision=current_revision+1,updated_at=statement_timestamp(),updated_by_manager_id=p_actor_manager_id,updated_by_manager_name_snapshot=p_actor_manager_name
  where singleton and current_revision=p_expected_revision returning current_revision into v_revision;
  if v_revision is null then raise exception using errcode='40001',message='stale expected revision'; end if;
  insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,operation,actor_manager_id,actor_manager_name_snapshot,content_digest) values(v_revision,p_command_id,p_operation,p_actor_manager_id,p_actor_manager_name,p_digest);
  return v_revision;
end
$function$;

create or replace function public.static_weekly_accepted_exception_set(p_publication_id uuid,p_week_start date)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  with accepted as (
    select e.* from public.weekly_schedule_exception_commands e
    where e.publication_id=p_publication_id and e.service_date between p_week_start and p_week_start+6 and e.exception_type<>'reverse'
      and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
  ) select coalesce(jsonb_agg(jsonb_build_object('id',exception_id::text,'type',exception_type,'serviceDate',service_date::text,'payloadDigest',payload_digest) order by service_date,authority_revision,exception_id),'[]'::jsonb) from accepted
$function$;

create or replace function public.static_weekly_compiler_exception_set(p_publication_id uuid,p_week_start date)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  with accepted as (
    select e.* from public.weekly_schedule_exception_commands e
    where e.publication_id=p_publication_id and e.service_date between p_week_start and p_week_start+6 and e.exception_type<>'reverse'
      and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
  ) select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',exception_id::text,'type',exception_type,'serviceDate',service_date::text,'actorId',actor_manager_id::text,'reason',reason,'idempotencyKey',idempotency_key,'expectedRevision',expected_revision,'status','accepted','window',case when starts_at is null then null else jsonb_build_object('start',to_char(starts_at,'HH24:MI'),'end',to_char(ends_at,'HH24:MI')) end,'payload',payload_json,'payloadDigest',payload_digest,'baseVersionId',base_version_id::text,'publicationId',publication_id::text,'sequence',authority_revision)) order by service_date,authority_revision,exception_id),'[]'::jsonb) from accepted
$function$;

create or replace function public.static_weekly_v2_create_draft(
  p_effective_start date,p_objective_version text,p_objective jsonb,p_input_provenance jsonb,p_document jsonb,
  p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_command uuid:=gen_random_uuid(); v_version uuid; v_content_digest text; v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'create_draft');
  v_request:=jsonb_build_object('operation','create_draft','effective_start',p_effective_start,'objective_version',p_objective_version,'objective',p_objective,'input_provenance',p_input_provenance,'document',p_document,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request);
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_effective_start is null or btrim(coalesce(p_objective_version,''))='' then raise exception using errcode='23514',message='complete draft command identity is required'; end if;
  perform public.static_weekly_assert_document(p_document,p_effective_start,true);
  perform public.static_weekly_assert_exact_object(p_input_provenance,array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],'draft input provenance');
  if jsonb_typeof(p_objective) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input_provenance) as k(key) where jsonb_typeof(p_input_provenance->k.key) is distinct from 'string')
    or p_objective is distinct from p_document #> '{authority,optimizerResult,objective}' or p_objective_version is distinct from p_document #>>'{validation,compiler_version}'
    or p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'
    or p_input_provenance->>'compiler_version' is distinct from p_document #>>'{validation,compiler_version}'
    or p_input_provenance->>'input_digest' is distinct from p_document #>>'{validation,input_digest}'
    or p_input_provenance->>'baseline_input_digest' is distinct from p_document #>>'{authority,baselineInputDigest}'
    or p_input_provenance->>'authority_digest' is distinct from p_document #>>'{validation,authority_digest}'
    or p_input_provenance->>'replay_digest' is distinct from p_document #>>'{validation,replay_digest}' then raise exception using errcode='23514',message='draft command may use only adapter-derived objective and provenance'; end if;
  if jsonb_typeof(p_document #> '{authority,compilerInput,version,id}') is distinct from 'string' or (p_document #>>'{authority,compilerInput,version,id}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID';
  end if;
  begin v_version:=(p_document #>>'{authority,compilerInput,version,id}')::uuid; exception when invalid_text_representation then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('objective_version',p_objective_version,'objective',p_objective,'input_provenance',p_input_provenance,'document',p_document));
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'create_draft',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_schedule_versions(version_id,lifecycle_state,effective_start,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot) values(v_version,'draft',p_effective_start,p_objective_version,p_objective,p_input_provenance,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  perform public.static_weekly_materialize_document(v_version,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response:=public.static_weekly_response_json('create_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',v_version,'draft_revision',1,'effective_start',p_effective_start));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'create_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v2_update_draft(
  p_version_id uuid,p_document jsonb,p_objective jsonb,p_input_provenance jsonb,p_expected_draft_revision bigint,
  p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_version public.weekly_schedule_versions%rowtype; v_document_version_id uuid; v_command uuid:=gen_random_uuid(); v_content_digest text; v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'update_draft');
  v_request:=jsonb_build_object('operation','update_draft','version_id',p_version_id,'document',p_document,'objective',p_objective,'input_provenance',p_input_provenance,'expected_draft_revision',p_expected_draft_revision,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_version_id is null or p_expected_draft_revision is null or p_expected_draft_revision<1 then raise exception using errcode='23514',message='complete update draft identity is required'; end if;
  select * into v_version from public.weekly_schedule_versions where version_id=p_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update;
  if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  perform public.static_weekly_assert_document(p_document,v_version.effective_start,true);
  perform public.static_weekly_assert_exact_object(p_input_provenance,array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],'update input provenance');
  if jsonb_typeof(p_document #> '{authority,compilerInput,version,id}') is distinct from 'string' or (p_document #>>'{authority,compilerInput,version,id}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID';
  end if;
  begin v_document_version_id:=(p_document #>>'{authority,compilerInput,version,id}')::uuid; exception when invalid_text_representation then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;
  if v_document_version_id is distinct from p_version_id then raise exception using errcode='23514',message='update document compiler version identity must exactly match p_version_id'; end if;
  if jsonb_typeof(p_objective) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input_provenance) as k(key) where jsonb_typeof(p_input_provenance->k.key) is distinct from 'string')
    or p_objective is distinct from p_document #> '{authority,optimizerResult,objective}' or v_version.objective_version is distinct from p_document #>>'{validation,compiler_version}'
    or p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'
    or p_input_provenance->>'compiler_version' is distinct from p_document #>>'{validation,compiler_version}'
    or p_input_provenance->>'input_digest' is distinct from p_document #>>'{validation,input_digest}'
    or p_input_provenance->>'baseline_input_digest' is distinct from p_document #>>'{authority,baselineInputDigest}'
    or p_input_provenance->>'authority_digest' is distinct from p_document #>>'{validation,authority_digest}'
    or p_input_provenance->>'replay_digest' is distinct from p_document #>>'{validation,replay_digest}' then raise exception using errcode='23514',message='update may use only adapter-derived objective and provenance'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('version_id',p_version_id,'document',p_document,'objective',p_objective,'input_provenance',p_input_provenance));
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'update_draft',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  perform set_config('app.static_weekly_draft_write','on',true);
  update public.weekly_schedule_versions set draft_document=p_document,objective_json=p_objective,input_provenance_json=p_input_provenance,content_digest=v_content_digest,revision=revision+1 where version_id=p_version_id;
  perform public.static_weekly_materialize_document(p_version_id,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response:=public.static_weekly_response_json('update_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',p_version_id,'draft_revision',p_expected_draft_revision+1));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'update_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v2_publish_draft(
  p_draft_version_id uuid,p_expected_draft_revision bigint,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text,p_publication_kind text default 'publish',p_rollback_of_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_draft public.weekly_schedule_versions%rowtype; v_target public.weekly_schedule_versions%rowtype; v_command uuid:=gen_random_uuid(); v_version uuid; v_publication uuid; v_revision bigint; v_version_number bigint; v_previous uuid; v_response jsonb; v_operation text;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'publish_draft');
  v_request:=jsonb_build_object('operation','publish_draft','draft_version_id',p_draft_version_id,'expected_draft_revision',p_expected_draft_revision,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name,'publication_kind',p_publication_kind,'rollback_of_version_id',p_rollback_of_version_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_draft_version_id is null or p_expected_draft_revision is null or p_expected_draft_revision<1 or p_publication_kind is null or p_publication_kind not in ('publish','supersede','rollback_compensation') then raise exception using errcode='23514',message='invalid publication kind'; end if;
  select * into v_draft from public.weekly_schedule_versions where version_id=p_draft_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update;
  if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  perform public.static_weekly_assert_document(v_draft.draft_document,v_draft.effective_start,true);
  if exists(select 1 from public.weekly_schedule_slot_availability a where a.version_id=v_draft.version_id) is false or exists(select 1 from public.weekly_schedule_slot_assignments a where a.version_id=v_draft.version_id) is false then raise exception using errcode='23514',message='document relational projection is incomplete'; end if;
  if p_publication_kind='rollback_compensation' then
    select * into v_target from public.weekly_schedule_versions where version_id=p_rollback_of_version_id and lifecycle_state='published';
    if not found or v_draft.draft_document->'authority' is distinct from v_target.draft_document->'authority' then raise exception using errcode='23514',message='rollback compensation must publish an exact accepted authority clone'; end if;
  elsif p_rollback_of_version_id is not null then raise exception using errcode='23514',message='only rollback compensation accepts a rollback target'; end if;
  select version_id into v_previous from public.weekly_schedule_versions where lifecycle_state='published' order by effective_start desc,version_number desc limit 1;
  if v_previous is not null and v_draft.effective_start <= (select effective_start from public.weekly_schedule_versions where version_id=v_previous) then raise exception using errcode='23514',message='new authority must have a later effective start'; end if;
  v_operation:=case p_publication_kind when 'rollback_compensation' then 'rollback' when 'supersede' then 'supersede' else 'publish' end;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,v_operation,p_actor_manager_id,p_actor_manager_name,v_command,v_draft.content_digest);
  select coalesce(max(version_number),0)+1 into v_version_number from public.weekly_schedule_versions where lifecycle_state='published';
  v_version:=v_draft.version_id;
  if jsonb_typeof(v_draft.draft_document #> '{authority,compilerInput,version,publicationId}') is distinct from 'string' or (v_draft.draft_document #>>'{authority,compilerInput,version,publicationId}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception using errcode='23514',message='compiler publication identity must be a canonical UUID'; end if;
  begin v_publication:=(v_draft.draft_document #>>'{authority,compilerInput,version,publicationId}')::uuid; exception when invalid_text_representation then raise exception using errcode='23514',message='compiler publication identity must be a canonical UUID'; end;
  perform set_config('app.static_weekly_publish_write','on',true);
  update public.weekly_schedule_versions set version_number=v_version_number,lifecycle_state='published',publication_kind=p_publication_kind,rollback_of_version_id=p_rollback_of_version_id,published_by_manager_id=p_actor_manager_id,published_by_manager_name_snapshot=p_actor_manager_name,published_at=statement_timestamp() where version_id=v_version;
  v_response:=public.static_weekly_response_json(v_operation,v_revision,v_draft.content_digest,v_request_digest,jsonb_build_object('version_id',v_version,'version_number',v_version_number,'publication_id',v_publication,'effective_start',v_draft.effective_start,'replay_digest',v_draft.draft_document#>>'{validation,replay_digest}'));
  insert into public.weekly_schedule_publications(publication_id,version_id,authority_revision,publication_kind,effective_start,prior_version_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,request_digest,replay_digest,content_digest,output_digest)
  values(v_publication,v_version,v_revision,p_publication_kind,v_draft.effective_start,v_previous,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,v_request_digest,v_draft.draft_document#>>'{validation,replay_digest}',v_draft.content_digest,v_response->>'output_digest');
  if v_previous is not null then insert into public.weekly_schedule_effective_range_closures(closed_version_id,closed_at_effective_date,superseding_version_id,publication_id,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(v_previous,v_draft.effective_start,v_version,v_publication,p_actor_manager_id,p_actor_manager_name,v_draft.content_digest); end if;
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,v_operation,p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_draft.content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v2_apply_exception(
  p_exception_type text,p_service_date date,p_starts_at time,p_ends_at time,p_base_version_id uuid,p_publication_id uuid,p_reason text,p_payload jsonb,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text,p_reverses_exception_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_command uuid:=gen_random_uuid(); v_exception uuid:=gen_random_uuid(); v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_payload_digest text; v_revision bigint; v_response jsonb; v_target public.weekly_schedule_exception_commands%rowtype; v_operation text;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'apply_exception');
  v_request:=jsonb_build_object('operation','apply_exception','exception_type',p_exception_type,'service_date',p_service_date,'starts_at',p_starts_at,'ends_at',p_ends_at,'base_version_id',p_base_version_id,'publication_id',p_publication_id,'reason',p_reason,'payload',v_payload,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name,'reverses_exception_id',p_reverses_exception_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_exception_type is null or p_exception_type not in ('pto','daily_absence','partial_absence','shift_override','cover_all','lunch','nine_forty_five_rebalance','event_impact','manager_correction','reverse') or p_service_date is null or p_base_version_id is null or p_publication_id is null or btrim(coalesce(p_reason,''))='' or jsonb_typeof(p_payload) is distinct from 'object' or ((p_starts_at is null)<>(p_ends_at is null)) or (p_starts_at is not null and p_starts_at>=p_ends_at) then raise exception using errcode='23514',message='complete exception semantic inputs are required'; end if;
  if not exists(select 1 from public.weekly_schedule_publications where publication_id=p_publication_id and version_id=p_base_version_id) or public.static_weekly_effective_version(p_service_date) is distinct from p_base_version_id then raise exception using errcode='23514',message='exception must bind its effective publication and version'; end if;
  if (p_exception_type='reverse') is distinct from (p_reverses_exception_id is not null) then raise exception using errcode='23514',message='reversal target coherence is required'; end if;
  if p_exception_type='reverse' then
    select * into v_target from public.weekly_schedule_exception_commands where exception_id=p_reverses_exception_id;
    if not found or v_target.exception_type is not distinct from 'reverse' or v_target.service_date is distinct from p_service_date or v_target.base_version_id is distinct from p_base_version_id or v_target.publication_id is distinct from p_publication_id or exists(select 1 from public.weekly_schedule_exception_commands where reverses_exception_id=p_reverses_exception_id) then raise exception using errcode='23514',message='reversal must target one compatible unreversed exception'; end if;
  end if;
  v_payload_digest:=public.static_weekly_digest_jsonb(v_payload); v_operation:=case when p_exception_type='reverse' then 'reverse_exception' else 'apply_exception' end;
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,v_operation,p_actor_manager_id,p_actor_manager_name,v_command,v_payload_digest);
  insert into public.weekly_schedule_exception_commands(exception_id,authority_revision,exception_type,service_date,starts_at,ends_at,base_version_id,publication_id,reverses_exception_id,expected_revision,idempotency_key,actor_manager_id,actor_manager_name_snapshot,reason,payload_json,payload_digest) values(v_exception,v_revision,p_exception_type,p_service_date,p_starts_at,p_ends_at,p_base_version_id,p_publication_id,p_reverses_exception_id,p_expected_revision,p_idempotency_key,p_actor_manager_id,p_actor_manager_name,p_reason,v_payload,v_payload_digest);
  v_response:=public.static_weekly_response_json(v_operation,v_revision,v_payload_digest,v_request_digest,jsonb_build_object('exception_id',v_exception,'exception_type',p_exception_type,'service_date',p_service_date,'payload_digest',v_payload_digest,'sequence',v_revision));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,v_operation,p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_payload_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v2_replace_incumbency(
  p_slot_id uuid,p_person_id uuid,p_person_name_snapshot text,p_effective_start date,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior_receipt public.weekly_schedule_command_receipts%rowtype; v_prior public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_command uuid:=gen_random_uuid(); v_new uuid:=gen_random_uuid(); v_content_digest text; v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'replace_incumbency');
  v_request:=jsonb_build_object('operation','replace_incumbency','slot_id',p_slot_id,'person_id',p_person_id,'person_name_snapshot',p_person_name_snapshot,'effective_start',p_effective_start,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior_receipt from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior_receipt.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior_receipt.response_json; end if;
  if p_slot_id is null or p_person_id is null or p_effective_start is null or btrim(coalesce(p_person_name_snapshot,''))='' then raise exception using errcode='23514',message='complete replacement incumbency semantic inputs are required'; end if;
  select * into v_prior from public.v_weekly_roster_slot_incumbency_ranges where slot_id=p_slot_id and effective_start<p_effective_start and (effective_end is null or p_effective_start<effective_end) order by effective_start desc limit 1;
  if not found then raise exception using errcode='23514',message='replacement requires one currently effective stable-slot incumbent'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'actor_manager_name'-'operation');
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'replace_incumbency',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(v_new,p_slot_id,p_person_id,p_person_name_snapshot,p_effective_start,p_actor_manager_id,p_actor_manager_name,v_content_digest);
  insert into public.weekly_roster_slot_incumbency_closures(closed_incumbency_id,replacement_incumbency_id,closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest) values(v_prior.incumbency_id,v_new,p_effective_start,v_revision,p_actor_manager_id,p_actor_manager_name,v_content_digest);
  v_response:=public.static_weekly_response_json('replace_incumbency',v_revision,v_content_digest,v_request_digest,jsonb_build_object('slot_id',p_slot_id,'closed_incumbency_id',v_prior.incumbency_id,'replacement_incumbency_id',v_new,'effective_start',p_effective_start));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'replace_incumbency',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_assert_projection_envelope(p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_authority jsonb:=p_envelope->'authority'; v_base jsonb; v_compiler_exceptions jsonb; v_publication public.weekly_schedule_publications%rowtype;
begin
  perform public.static_weekly_assert_exact_object(p_envelope,array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity'],array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity'],'projection envelope');
  perform public.static_weekly_assert_exact_object(p_envelope->'adapter',array['schema','version'],array['schema','version'],'projection envelope adapter');
  if jsonb_typeof(p_exception_set) is distinct from 'array' or jsonb_typeof(p_envelope->'service_date') is distinct from 'string'
    or jsonb_typeof(p_envelope->'week_start') is distinct from 'string' or jsonb_typeof(p_envelope->'week_end') is distinct from 'string'
    or jsonb_typeof(p_envelope->'authority_digest') is distinct from 'string' or jsonb_typeof(p_envelope->'replay_digest') is distinct from 'string'
    or jsonb_typeof(p_envelope->'compiler_version') is distinct from 'string' or jsonb_typeof(p_envelope->'objective') is distinct from 'object'
    or jsonb_typeof(p_envelope->'metrics') is distinct from 'object' or jsonb_typeof(p_envelope->'applied_exceptions') is distinct from 'array'
    or jsonb_typeof(p_envelope->'assignments') is distinct from 'array' or jsonb_typeof(p_envelope->'database_projection_identity') is distinct from 'string' then
    raise exception using errcode='23514',message='projection envelope requires complete typed authority, receipt, identity, and assignment fields';
  end if;
  if jsonb_array_length(p_envelope->'assignments')=0 then raise exception using errcode='23514',message='projection assignments may not be empty'; end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x) where jsonb_typeof(a.x) is distinct from 'object') then raise exception using errcode='23514',message='projection assignment rows must be JSON objects'; end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x) where not (a.x ?& array['plan_work_id','work_id','day_of_week','service_date','status','work_snapshot','explanation'])) then raise exception using errcode='23514',message='projection assignments require every identity, status, snapshot, and explanation key'; end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x)
      where jsonb_typeof(a.x->'plan_work_id') is distinct from 'string' or nullif(btrim(a.x->>'plan_work_id'),'') is null
        or jsonb_typeof(a.x->'work_id') is distinct from 'string' or nullif(btrim(a.x->>'work_id'),'') is null) then
    raise exception using errcode='23514',message='projection assignments require nonblank string plan_work_id and work_id values';
  end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x)
      where jsonb_typeof(a.x->'day_of_week') is distinct from 'number' or (a.x->>'day_of_week') !~ '^[0-6]$') then
    raise exception using errcode='23514',message='projection assignments require integer day_of_week values from 0 through 6';
  end if;
  -- Keep the input probe and cast in one CASE branch: malformed JSON strings
  -- never reach a date cast.  The explicit [0-9] form avoids the prior
  -- doubly-escaped \\d regex, which rejected valid canonical dates.
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x)
      where jsonb_typeof(a.x->'service_date') is distinct from 'string' or nullif(btrim(a.x->>'service_date'),'') is null
        or (a.x->>'service_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or not pg_input_is_valid(a.x->>'service_date','date')
        or case when jsonb_typeof(a.x->'service_date')='string'
                       and (a.x->>'service_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                       and pg_input_is_valid(a.x->>'service_date','date')
                then (a.x->>'service_date')::date::text is distinct from a.x->>'service_date'
                  or (a.x->>'service_date')::date<p_week_start
                  or (a.x->>'service_date')::date>p_week_start+6
                else false end) then
    raise exception using errcode='23514',message='projection assignments require canonical valid seven-day service_date values';
  end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x) where jsonb_typeof(a.x->'explanation') is distinct from 'object') then
    raise exception using errcode='23514',message='projection assignments require object explanation facts';
  end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x)
      where jsonb_typeof(a.x->'status') is distinct from 'string' or upper(a.x->>'status') not in ('ASSIGNED','OPEN','REVIEW')) then
    raise exception using errcode='23514',message='projection assignments require an explicit ASSIGNED, OPEN, or REVIEW status';
  end if;
  if (select count(*) from jsonb_array_elements(p_envelope->'assignments'))<>(select count(distinct x->>'plan_work_id') from jsonb_array_elements(p_envelope->'assignments') as a(x)) then
    raise exception using errcode='23514',message='projection assignments may not contain duplicate work identities';
  end if;
  select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id;
  if not found then raise exception using errcode='23514',message='projection publication is unknown'; end if;
  select draft_document->'authority' into v_base from public.weekly_schedule_versions where version_id=v_publication.version_id;
  v_compiler_exceptions:=public.static_weekly_compiler_exception_set(p_publication_id,p_week_start);
  perform public.static_weekly_assert_compiler_authority(v_authority,p_envelope->'receipt',p_week_start,false);
  if p_envelope #>> '{adapter,schema}' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1' or p_envelope #>> '{adapter,version}' is distinct from 'static-weekly-database-adapter-v1' or p_envelope->>'service_date' is distinct from p_week_start::text or p_envelope->>'week_start' is distinct from p_week_start::text or p_envelope->>'week_end' is distinct from (p_week_start+6)::text
    or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(v_authority) or p_envelope->>'replay_digest' is distinct from p_envelope #>>'{receipt,compiler,replayDigest}'
    or p_envelope->>'compiler_version' is distinct from v_authority #>>'{optimizerResult,compilerVersion}' or p_envelope->'objective' is distinct from v_authority #> '{optimizerResult,objective}' or p_envelope->'metrics' is distinct from v_authority #> '{optimizerResult,metrics}'
    or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
    or v_authority->'compilerInput' is distinct from v_base->'compilerInput' or v_authority->>'baselineInputDigest' is distinct from v_base->>'baselineInputDigest' or v_authority->>'weeklyVersionDigest' is distinct from v_base->>'weeklyVersionDigest' then
    raise exception using errcode='23514',message='projection must bind the stored baseline, complete receipt, objective, metrics, replay, and full weekly envelope';
  end if;
  if v_authority->'appliedExceptions' is distinct from p_exception_set
    or p_envelope->'applied_exceptions' is distinct from p_exception_set then raise exception using errcode='23514',message='overlay compiler input and applied exceptions must bind the complete accepted seven-day exception set'; end if;
  if v_authority #> '{overlayCompilerInput,exceptions}' is distinct from v_compiler_exceptions then raise exception using errcode='23514',message='overlay compiler input must carry every semantic accepted exception fact for the same seven-day horizon'; end if;
  if exists(
    with optimizer as(select value x from jsonb_array_elements(v_authority #> '{optimizerResult,assignments}')),
    projected as(select value x from jsonb_array_elements(p_envelope->'assignments'))
    select 1 from optimizer o full join projected p on p.x->>'plan_work_id'=o.x->>'planWorkId'
    where o.x is null or p.x is null or p.x->>'service_date' is distinct from o.x->>'serviceDate' or p.x->>'work_id' is distinct from o.x->>'workId' or p.x->>'day_of_week' is distinct from o.x->>'dayOfWeek' or upper(p.x->>'status') is distinct from upper(o.x->>'status')
      or (o.x->>'status'='ASSIGNED' and (p.x->>'owner_slot_id' is distinct from o.x->>'slotId' or p.x->>'owner_person_id' is distinct from o.x->>'personId'))
      or (o.x->>'status' in ('OPEN','REVIEW') and (p.x->>'owner_slot_id' is not null or p.x->>'owner_person_id' is not null))
  ) then raise exception using errcode='23514',message='complete weekly projection assignments must exactly bind the canonical optimizer'; end if;
  if exists(
    with optimizer as(select value x from jsonb_array_elements(v_authority #> '{optimizerResult,assignments}')),
    projected as(select value x from jsonb_array_elements(p_envelope->'assignments'))
    select 1 from optimizer o join projected p on p.x->>'plan_work_id'=o.x->>'planWorkId'
    where jsonb_typeof(p.x->'work_snapshot') is distinct from 'object'
      or not (p.x->'work_snapshot' ?& array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','required','coveragePolicy','bestEffortCoverage','coveragePolicyOrder','coveragePolicyProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance','restrictedSlotIds','manualLock','manualLockSlotId','overlayWork'])
      or exists(select 1 from jsonb_object_keys(p.x->'work_snapshot') as k(key) where not (k.key=any(array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','required','coveragePolicy','bestEffortCoverage','coveragePolicyOrder','coveragePolicyProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance','restrictedSlotIds','manualLock','manualLockSlotId','overlayWork'])))
      or jsonb_typeof(p.x#>'{work_snapshot,workId}') is distinct from 'string'
      or jsonb_typeof(p.x#>'{work_snapshot,dayOfWeek}') is distinct from 'number'
      or jsonb_typeof(p.x#>'{work_snapshot,originSlotId}') not in ('string','null')
      or p.x#>>'{work_snapshot,workId}' is distinct from o.x->>'workId'
      or p.x#>>'{work_snapshot,dayOfWeek}' is distinct from o.x->>'dayOfWeek'
      or p.x#>>'{work_snapshot,window,start}' is distinct from o.x#>>'{window,start}'
      or p.x#>>'{work_snapshot,window,end}' is distinct from o.x#>>'{window,end}'
      or p.x#>>'{work_snapshot,serviceEffortMinutes}' is distinct from o.x->>'serviceEffortMinutes'
      or jsonb_typeof(p.x#>'{work_snapshot,locationId}') is distinct from 'string'
      or p.x#>>'{work_snapshot,locationId}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or jsonb_typeof(p.x#>'{work_snapshot,locationCodeSnapshot}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,locationCodeSnapshot}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,locationNameSnapshot}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,locationNameSnapshot}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,window}') is distinct from 'object'
      or jsonb_typeof(p.x#>'{work_snapshot,window,start}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,window,start}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,window,end}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,window,end}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,serviceEffortMinutes}') is distinct from 'number'
      or jsonb_typeof(p.x#>'{work_snapshot,serviceEffortProvenance}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,serviceEffortProvenance}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,priority}') is distinct from 'number'
      or jsonb_typeof(p.x#>'{work_snapshot,priorityProvenance}') not in ('string','null')
      or (jsonb_typeof(p.x#>'{work_snapshot,priorityProvenance}')='string' and nullif(btrim(p.x#>>'{work_snapshot,priorityProvenance}'),'') is null)
      or jsonb_typeof(p.x#>'{work_snapshot,required}') is distinct from 'boolean'
      or jsonb_typeof(p.x#>'{work_snapshot,coveragePolicy}') not in ('string','null')
      or jsonb_typeof(p.x#>'{work_snapshot,bestEffortCoverage}') is distinct from 'boolean'
      or jsonb_typeof(p.x#>'{work_snapshot,coveragePolicyOrder}') not in ('number','null')
      or jsonb_typeof(p.x#>'{work_snapshot,coveragePolicyProvenance}') not in ('string','null')
      or jsonb_typeof(p.x#>'{work_snapshot,requiredQualifications}') is distinct from 'array'
      or jsonb_typeof(p.x#>'{work_snapshot,qualificationProvenance}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,qualificationProvenance}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,restrictions}') is distinct from 'array'
      or jsonb_typeof(p.x#>'{work_snapshot,restrictionProvenance}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,restrictionProvenance}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,restrictedSlotIds}') is distinct from 'array'
      or jsonb_typeof(p.x#>'{work_snapshot,manualLock}') is distinct from 'boolean'
      or jsonb_typeof(p.x#>'{work_snapshot,manualLockSlotId}') not in ('string','null')
      or jsonb_typeof(p.x#>'{work_snapshot,overlayWork}') is distinct from 'boolean'
      or exists(select 1 from jsonb_array_elements(p.x#>'{work_snapshot,requiredQualifications}') as q(value) where jsonb_typeof(q.value) is distinct from 'string' or nullif(btrim(q.value#>>'{}'),'') is null)
      or exists(select 1 from jsonb_array_elements(p.x#>'{work_snapshot,restrictions}') as r(value) where jsonb_typeof(r.value) is distinct from 'string' or nullif(btrim(r.value#>>'{}'),'') is null)
      or exists(select 1 from jsonb_array_elements(p.x#>'{work_snapshot,restrictedSlotIds}') as r(value) where jsonb_typeof(r.value) is distinct from 'string' or nullif(btrim(r.value#>>'{}'),'') is null)
      or (select count(*) from jsonb_array_elements(p.x#>'{work_snapshot,requiredQualifications}'))<>(select count(distinct value#>>'{}') from jsonb_array_elements(p.x#>'{work_snapshot,requiredQualifications}'))
      or (select count(*) from jsonb_array_elements(p.x#>'{work_snapshot,restrictions}'))<>(select count(distinct value#>>'{}') from jsonb_array_elements(p.x#>'{work_snapshot,restrictions}'))
      or (select count(*) from jsonb_array_elements(p.x#>'{work_snapshot,restrictedSlotIds}'))<>(select count(distinct value#>>'{}') from jsonb_array_elements(p.x#>'{work_snapshot,restrictedSlotIds}'))
  ) then raise exception using errcode='23514',message='projection work snapshots must be complete semantic authority facts bound to the canonical optimizer'; end if;
end
$function$;

create or replace function public.static_weekly_v2_materialize_projection(
  p_publication_id uuid,p_service_date date,p_exception_set_digest text,p_compiler_version text,p_objective jsonb,p_metrics jsonb,p_replay_digest text,p_assignments jsonb,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_publication public.weekly_schedule_publications%rowtype; v_exception_set jsonb; v_exception_digest text; v_command uuid:=gen_random_uuid(); v_projection uuid:=gen_random_uuid(); v_revision bigint; v_content_digest text; v_response jsonb; v_item jsonb; v_assignment public.weekly_schedule_slot_assignments%rowtype; v_owner public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_occurrence uuid; v_work jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'materialize_projection');
  v_request:=jsonb_build_object('operation','materialize_projection','publication_id',p_publication_id,'service_date',p_service_date,'exception_set_digest',p_exception_set_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope',p_assignments,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id;
  if not found or p_service_date is null or public.static_weekly_effective_version(p_service_date) is distinct from v_publication.version_id then raise exception using errcode='23514',message='projection must bind an effective publication'; end if;
  if p_service_date is distinct from (select effective_start from public.weekly_schedule_versions where version_id=v_publication.version_id) then raise exception using errcode='23514',message='projection must materialize the deterministic compiler seven-day horizon from its authority start'; end if;
  v_exception_set:=public.static_weekly_accepted_exception_set(p_publication_id,p_service_date); v_exception_digest:=public.static_weekly_digest_jsonb(v_exception_set);
  if p_exception_set_digest is distinct from v_exception_digest or p_compiler_version is distinct from p_assignments->>'compiler_version' or p_objective is distinct from p_assignments->'objective' or p_metrics is distinct from p_assignments->'metrics' or p_replay_digest is distinct from p_assignments->>'replay_digest' then raise exception using errcode='23514',message='projection command identity must include exact compiler, objective, metrics, replay, and weekly exception authority'; end if;
  perform public.static_weekly_assert_projection_envelope(p_assignments,p_publication_id,p_service_date,v_exception_set);
  if exists(select 1 from public.weekly_schedule_compiled_projections where publication_id=p_publication_id and week_start=p_service_date and exception_set_digest=v_exception_digest and compiler_version=p_compiler_version) then raise exception using errcode='23505',message='immutable projection already exists for this exact weekly authority'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('publication_id',p_publication_id,'week_start',p_service_date,'exception_set_digest',v_exception_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope_identity',p_assignments->>'database_projection_identity'));
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'materialize_projection',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,week_start,week_end,exception_set_json,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,authority_digest,receipt_json,projection_envelope,compiled_by_manager_id) values(v_projection,p_publication_id,v_publication.version_id,p_service_date,p_service_date+6,v_exception_set,v_exception_digest,p_compiler_version,p_objective,p_metrics,p_replay_digest,p_assignments->>'authority_digest',p_assignments->'receipt',p_assignments,p_actor_manager_id);
  for v_item in select value from jsonb_array_elements(p_assignments->'assignments') loop
    v_owner:=null; v_assignment:=null; v_work:=v_item->'work_snapshot';
    select * into v_assignment from public.weekly_schedule_slot_assignments where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';
    if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;
    if upper(v_item->>'status')='ASSIGNED' then
      select * into v_owner from public.v_weekly_roster_slot_incumbency_ranges where slot_id=(v_item->>'owner_slot_id')::uuid and effective_start<=(v_item->>'service_date')::date and (effective_end is null or (v_item->>'service_date')::date<effective_end);
      if not found or v_owner.person_id::text is distinct from v_item->>'owner_person_id' then raise exception using errcode='23514',message='projection assigned owner lacks an effective dated incumbent'; end if;
    elsif upper(v_item->>'status') not in ('OPEN','REVIEW') or v_item->>'owner_slot_id' is not null or v_item->>'owner_person_id' is not null then raise exception using errcode='23514',message='open and review projection rows must have null owner facts'; end if;
    insert into public.weekly_schedule_occurrences(projection_id,publication_id,version_id,assignment_id,service_date,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,state,state_reason,original_actor_person_id,original_actor_name_snapshot,authority_facts_json,occurrence_digest)
    values(v_projection,p_publication_id,v_publication.version_id,v_assignment.assignment_id,(v_item->>'service_date')::date,v_item->>'work_id',(v_item->>'day_of_week')::smallint,nullif(v_work->>'locationId','')::uuid,coalesce(v_work->>'locationCodeSnapshot',v_item->>'work_id'),coalesce(v_work->>'locationNameSnapshot',v_item->>'work_id'),(v_work#>>'{window,start}')::time,(v_work#>>'{window,end}')::time,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,case lower(v_item->>'status') when 'assigned' then 'created' when 'open' then 'open' else 'review' end,v_item->>'reason_code',nullif(v_item->>'original_actor_person_id','')::uuid,nullif(v_item->>'original_actor_name',''),jsonb_build_object('baseline_owner_slot_id',v_item->>'baseline_owner_slot_id','baseline_owner_person_id',v_item->>'baseline_owner_person_id','baseline_owner_name',v_item->>'baseline_owner_name','original_actor_person_id',v_item->>'original_actor_person_id','original_actor_name',v_item->>'original_actor_name','optimized_owner_slot_id',v_item->>'optimized_owner_slot_id','optimized_owner_person_id',v_item->>'optimized_owner_person_id'),public.static_weekly_digest_jsonb(v_item)) returning occurrence_id into v_occurrence;
    insert into public.weekly_schedule_projection_assignments(projection_id,occurrence_id,work_id,status,reason_code,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,authority_facts_json,explanation_json,content_digest)
    values(v_projection,v_occurrence,v_item->>'work_id',lower(v_item->>'status'),v_item->>'reason_code',case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,(select authority_facts_json from public.weekly_schedule_occurrences where occurrence_id=v_occurrence),coalesce(v_item->'explanation','{}'::jsonb),public.static_weekly_digest_jsonb(v_item));
  end loop;
  v_response:=public.static_weekly_response_json('materialize_projection',v_revision,v_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,'publication_id',p_publication_id,'week_start',p_service_date,'week_end',p_service_date+6,'replay_digest',p_replay_digest));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'materialize_projection',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

drop trigger if exists trg_static_weekly_versions_guard on public.weekly_schedule_versions;
create trigger trg_static_weekly_versions_guard before insert or update or delete on public.weekly_schedule_versions for each row execute function public.static_weekly_version_guard();
do $triggers$
declare t text;
begin
  foreach t in array array['weekly_roster_slots','weekly_roster_slot_incumbencies','weekly_roster_slot_incumbency_closures','weekly_schedule_publications','weekly_schedule_effective_range_closures','weekly_schedule_exception_commands','weekly_schedule_compiled_projections','weekly_schedule_occurrences','weekly_schedule_projection_assignments','weekly_schedule_authority_revisions','weekly_schedule_command_receipts'] loop
    execute format('drop trigger if exists trg_static_weekly_%I_immutable on public.%I',t,t);
    execute format('create trigger trg_static_weekly_%I_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',t,t);
  end loop;
  foreach t in array array['weekly_schedule_slot_availability','weekly_schedule_slot_assignments','weekly_schedule_objective_inputs'] loop
    execute format('drop trigger if exists trg_static_weekly_%I_guard on public.%I',t,t);
    execute format('create trigger trg_static_weekly_%I_guard before insert or update or delete on public.%I for each row execute function public.static_weekly_component_guard()',t,t);
  end loop;
end
$triggers$;

do $security$
declare t text; r text;
begin
  foreach t in array array['static_weekly_schedule_control','weekly_roster_slots','weekly_roster_slot_incumbencies','weekly_roster_slot_incumbency_closures','weekly_schedule_versions','weekly_schedule_slot_availability','weekly_schedule_slot_assignments','weekly_schedule_objective_inputs','weekly_schedule_publications','weekly_schedule_effective_range_closures','weekly_schedule_exception_commands','weekly_schedule_compiled_projections','weekly_schedule_occurrences','weekly_schedule_projection_assignments','weekly_schedule_authority_revisions','weekly_schedule_command_receipts'] loop
    execute format('alter table public.%I enable row level security',t); execute format('alter table public.%I force row level security',t);
    execute format('revoke all on table public.%I from public',t);
    foreach r in array array['anon','authenticated','service_role'] loop if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on table public.%I from %I',t,r); end if; end loop;
  end loop;
end
$security$;

-- First revoke the effective full scheduler capability graph, including any
-- legacy body that a future replay/hardening migration may have default-granted.
do $acl$
declare proc record; r text;
begin
  for proc in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly%' loop
    execute format('revoke all on function %s from public',proc.signature);
    foreach r in array array['anon','authenticated','service_role'] loop if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function %s from %I',proc.signature,r); end if; end loop;
  end loop;
end
$acl$;

grant execute on function public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid) to service_role;
grant execute on function public.static_weekly_v2_apply_exception(text,date,time,time,uuid,uuid,text,jsonb,bigint,uuid,text,text,uuid) to service_role;
grant execute on function public.static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text) to service_role;
grant execute on function public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text) to service_role;

comment on function public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text) is 'Trusted I1-to-I2 adapter input only; service_role is the v2 application seam.';
comment on function public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text) is 'Stores exactly one full seven-day compiler horizon and its complete trusted receipt; PostgreSQL validates identity rather than claiming MIP optimality.';
comment on table public.weekly_schedule_compiled_projections is 'One immutable complete seven-day solver horizon, including the exact accepted exception set, authority receipt, replay identity, objective, metrics, and envelope.';

commit;
