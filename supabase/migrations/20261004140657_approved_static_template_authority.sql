-- Approved static geometry is not an optimized solver certificate. This
-- forward-only boundary leaves every historical compiler validator intact.
-- No template is admitted by this migration. Release registration is a
-- separate, explicitly privileged, artifact-bound operation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.static_weekly_approved_template_catalog (
 template_id text primary key check(length(template_id) between 1 and 160),
 staffing_count integer not null check(staffing_count between 1 and 32),
 template_json jsonb not null check(jsonb_typeof(template_json)='object'),
 binding_json jsonb not null check(jsonb_typeof(binding_json)='object'),
 owner_config jsonb not null check(jsonb_typeof(owner_config)='object'),
 approval_evidence jsonb not null check(jsonb_typeof(approval_evidence)='object'),
 catalog_entry_digest text not null check(catalog_entry_digest~'^[0-9a-f]{64}$'),
 registered_at timestamptz not null default statement_timestamp()
);
create table public.static_weekly_approved_template_source_configs (
 source_id uuid primary key references public.static_weekly_authority_source_documents(source_id),
 owner_config jsonb not null check(jsonb_typeof(owner_config)='object'),
 config_digest text not null check(config_digest~'^[0-9a-f]{64}$'),
 registered_at timestamptz not null default statement_timestamp()
);
create table public.static_weekly_approved_template_retirements (
 template_id text primary key references public.static_weekly_approved_template_catalog(template_id),
 reason text not null check(length(btrim(reason)) between 1 and 500),
 retired_at timestamptz not null default statement_timestamp()
);

do $private$
declare rel text;
begin
 foreach rel in array array['static_weekly_approved_template_catalog',
  'static_weekly_approved_template_source_configs','static_weekly_approved_template_retirements'] loop
  execute format('alter table public.%I enable row level security',rel);
  execute format('alter table public.%I force row level security',rel);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',rel);
  execute format('create trigger approved_template_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',rel);
  execute format('create trigger approved_template_lock before insert on public.%I for each statement execute function public.static_weekly_v15_lock_recurring_mutation()',rel);
 end loop;
end $private$;

-- Both algorithms' registered source and this catalog use the existing
-- release-operator role. A manager cannot approve a browser-supplied template.
-- JS content digests are retained as artifact bindings; the complete stored
-- catalog entry has an independently recomputed PostgreSQL JSONB digest.
create function public.static_weekly_register_approved_template(
 p_source_id uuid,p_template jsonb,p_binding jsonb,p_owner_config jsonb,p_approval_evidence jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare id text;count_people integer;body jsonb;entry_digest text;prior record;source_row record;
begin
 perform public.static_weekly_v3_assert_release_operator();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into source_row from public.static_weekly_authority_source_documents
  where source_id=p_source_id and active and retired_at is null for share;
 if not found or source_row.source_digest is distinct from public.static_weekly_digest_jsonb(source_row.canonical_source) then
  raise exception using errcode='23514',message='approved template requires an exact active registered current source';end if;
 perform public.static_weekly_assert_exact_object(p_template,
  array['templateId','staffingCount','source','roleSlotIds'],
  array['templateId','staffingCount','source','roleSlotIds'],'approved static template');
 perform public.static_weekly_assert_exact_object(p_binding,
  array['schema','templateId','staffingCount','sourceDigest','roleSlotIdsDigest','patternAuthority','artifactSha256','ownerConfigDigest','patternPublicationStatus'],
  array['schema','templateId','staffingCount','sourceDigest','roleSlotIdsDigest','patternAuthority','artifactSha256','ownerConfigDigest','patternPublicationStatus'],'approved static binding');
 id:=p_template->>'templateId';
 if id is null or length(id) not between 1 and 160
  or jsonb_typeof(p_template->'staffingCount') is distinct from 'number'
  or (p_template->>'staffingCount')!~'^[1-9][0-9]?$'
  or jsonb_typeof(p_template->'source') is distinct from 'object'
  or jsonb_typeof(p_template->'roleSlotIds') is distinct from 'array'
  or jsonb_typeof(p_owner_config) is distinct from 'object'
  or jsonb_typeof(p_approval_evidence) is distinct from 'object'
  or p_binding->>'schema' is distinct from 'custodial.approved-static-template-binding.v1'
  or p_binding->>'templateId' is distinct from id
  or p_binding->'staffingCount' is distinct from p_template->'staffingCount'
  or p_binding->>'patternAuthority' is distinct from 'OWNER_APPROVED_OPERATIONAL_PATTERN'
  or p_approval_evidence->>'classification' is distinct from 'OWNER_APPROVED_OPERATIONAL_PATTERN'
  or coalesce(p_approval_evidence->>'sourceReference','')=''
  or coalesce(p_approval_evidence->>'ownerDecisionReference','')=''
  or p_approval_evidence->>'artifactSha256' is distinct from p_binding->>'artifactSha256'
  or exists(select 1 from unnest(array['sourceDigest','roleSlotIdsDigest','artifactSha256','ownerConfigDigest']) key
     where coalesce(p_binding->>key,'')!~'^[0-9a-f]{64}$') then
  raise exception using errcode='23514',message='exact approved artifact, owner decision and complete template/config binding required';end if;
 count_people:=(p_template->>'staffingCount')::integer;
 if count_people not between 1 and 32 or jsonb_array_length(p_template->'roleSlotIds')<>count_people
  or exists(select 1 from jsonb_array_elements(p_template->'roleSlotIds') item
      where jsonb_typeof(item) is distinct from 'string' or coalesce(item#>>'{}','')='')
  or (select count(distinct item#>>'{}') from jsonb_array_elements(p_template->'roleSlotIds') item)<>count_people then
  raise exception using errcode='23514',message='approved role identities must be complete and unique';end if;
 body:=jsonb_build_object('template',p_template,'binding',p_binding,'ownerConfig',p_owner_config,'approvalEvidence',p_approval_evidence);
 entry_digest:=public.static_weekly_digest_jsonb(body);
 select * into prior from public.static_weekly_approved_template_catalog where template_id=id;
 if found then
  if prior.catalog_entry_digest is distinct from entry_digest then
   raise exception using errcode='23505',message='approved template ID already binds different immutable bytes';end if;
 else
  insert into public.static_weekly_approved_template_catalog
   (template_id,staffing_count,template_json,binding_json,owner_config,approval_evidence,catalog_entry_digest)
   values(id,count_people,p_template,p_binding,p_owner_config,p_approval_evidence,entry_digest);
 end if;
 if exists(select 1 from public.static_weekly_approved_template_retirements where template_id=id) then
  raise exception using errcode='23514',message='retired template cannot be readmitted under the same identity';end if;
 insert into public.static_weekly_approved_template_source_configs(source_id,owner_config,config_digest)
  values(p_source_id,p_owner_config,public.static_weekly_digest_jsonb(p_owner_config)) on conflict(source_id) do nothing;
 if not exists(select 1 from public.static_weekly_approved_template_source_configs
   where source_id=p_source_id and owner_config=p_owner_config and config_digest=public.static_weekly_digest_jsonb(p_owner_config)) then
  raise exception using errcode='23505',message='current source already binds a different owner configuration';end if;
 return jsonb_build_object('registered',true,'template_id',id,'catalog_entry_digest',entry_digest,'published',false);
end $fn$;

create function public.static_weekly_retire_approved_template(p_template_id text,p_reason text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 perform public.static_weekly_v3_assert_release_operator();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 insert into public.static_weekly_approved_template_retirements(template_id,reason) values(p_template_id,p_reason);
end $fn$;

create function public.static_weekly_read_approved_template_basis(
 p_manager_id uuid,p_publication_id uuid,p_service_date date,p_kind text,p_template_id text,p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare source_row jsonb;source_input jsonb;config jsonb;templates jsonb;bindings jsonb;catalog jsonb;
 week_start date;revision bigint;generation bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 if p_service_date is null or not isfinite(p_service_date)
  or p_kind is null or p_kind not in ('RECURRING_STAFFING','DATED_ABSENCE')
  or (p_kind='RECURRING_STAFFING' and extract(isodow from p_service_date)<>1) then
  raise exception using errcode='22023',message='one finite date and explicit static template operation kind required';end if;
 week_start:=p_service_date-(extract(isodow from p_service_date)::integer-1);
 select current_revision into strict revision from public.static_weekly_schedule_control where singleton;
 if p_expected_revision is distinct from revision then raise exception using errcode='40001',message='stale approved template preview revision';end if;
 source_row:=public.static_weekly_v3_read_publication_source(p_publication_id,week_start);
 source_input:=jsonb_set(jsonb_set(source_row->'compiler_input','{serviceDate}',to_jsonb(p_service_date::text),true),
  '{exceptions}',source_row->'exceptions',true);
 select c.owner_config into config from public.static_weekly_approved_template_source_configs c
  join public.static_weekly_authority_source_documents s using(source_id)
  where c.source_id=(source_row->>'source_id')::uuid and s.active and s.retired_at is null
   and c.config_digest=public.static_weekly_digest_jsonb(c.owner_config)
   and s.source_digest=public.static_weekly_digest_jsonb(s.canonical_source);
 if config is null then raise exception using errcode='55000',message='current publication lacks release-admitted static template owner configuration';end if;
 select coalesce(jsonb_agg(c.template_json order by c.template_id),'[]'::jsonb),
  coalesce(jsonb_agg(c.binding_json order by c.template_id),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('templateId',c.template_id,'entryDigest',c.catalog_entry_digest) order by c.template_id),'[]'::jsonb)
  into templates,bindings,catalog from public.static_weekly_approved_template_catalog c
  where c.owner_config=config and (p_template_id is null or c.template_id=p_template_id)
   and not exists(select 1 from public.static_weekly_approved_template_retirements r where r.template_id=c.template_id)
   and c.catalog_entry_digest=public.static_weekly_digest_jsonb(jsonb_build_object(
    'template',c.template_json,'binding',c.binding_json,'ownerConfig',c.owner_config,'approvalEvidence',c.approval_evidence));
 if jsonb_array_length(templates)=0 then raise exception using errcode='55000',message='missing approved static template; automatic solver generation is not authorized';end if;
 select public.static_weekly_v15_read_recurring_generation() into generation;
 return jsonb_build_object('schema','custodial.approved-static-template-basis.v1',
  'publicationId',p_publication_id,'serviceDate',p_service_date,'kind',p_kind,
  'authorityRevision',revision,'generation',generation,
  'templateCatalogDigest',public.static_weekly_digest_jsonb(catalog),
  'currentSource',source_input,'ownerConfig',config,'templates',templates,'admittedBindings',bindings);
end $fn$;

revoke all on function public.static_weekly_register_approved_template(uuid,jsonb,jsonb,jsonb,jsonb),
 public.static_weekly_retire_approved_template(text,text),
 public.static_weekly_read_approved_template_basis(uuid,uuid,date,text,text,bigint)
 from public,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.static_weekly_register_approved_template(uuid,jsonb,jsonb,jsonb,jsonb),
 public.static_weekly_retire_approved_template(text,text) to static_weekly_release_operator;
grant execute on function public.static_weekly_read_approved_template_basis(uuid,uuid,date,text,text,bigint)
 to static_weekly_control_plane;

-- Initial SIX baseline over historical publications. The release operator
-- admits a complete independently prepared fixed snapshot, not tier optima.
-- Managers cannot provide arbitrary graphs or approve their own template.
create table public.static_weekly_approved_initial_baselines (
 source_id uuid primary key references public.static_weekly_authority_source_documents(source_id),
 template_id text not null references public.static_weekly_approved_template_catalog(template_id),
 effective_start date not null check(isfinite(effective_start) and extract(isodow from effective_start)=1),
 feasibility jsonb not null check(jsonb_typeof(feasibility)='object'),
 snapshot_digest text not null check(snapshot_digest~'^[0-9a-f]{64}$'),
 registered_at timestamptz not null default statement_timestamp()
);
create table public.static_weekly_approved_initial_confirmations (
 manager_id uuid not null references public.ops_manager_managers(manager_id),
 idempotency_key text not null check(length(btrim(idempotency_key)) between 1 and 200),
 request_json jsonb not null,receipt_json jsonb not null,
 publication_id uuid not null references public.weekly_schedule_publications(publication_id),
 projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id),
 primary key(manager_id,idempotency_key)
);
do $private_initial$
declare rel text;
begin
 foreach rel in array array['static_weekly_approved_initial_baselines','static_weekly_approved_initial_confirmations'] loop
  execute format('alter table public.%I enable row level security',rel);
  execute format('alter table public.%I force row level security',rel);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',rel);
  execute format('create trigger approved_initial_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',rel);
 end loop;
end $private_initial$;

create function public.static_weekly_register_approved_initial_baseline(p_source_id uuid,p_template_id text,p_feasibility jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare source jsonb;entry public.static_weekly_approved_template_catalog%rowtype;prior public.static_weekly_approved_initial_baselines%rowtype;date date;
begin
 perform public.static_weekly_v3_assert_release_operator();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into strict entry from public.static_weekly_approved_template_catalog where template_id=p_template_id;
 if exists(select 1 from public.static_weekly_approved_template_retirements where template_id=p_template_id)
  or entry.catalog_entry_digest<>public.static_weekly_digest_jsonb(jsonb_build_object('template',entry.template_json,
    'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence)) then
  raise exception 'initial baseline requires a live release-admitted approved pattern';end if;
 date:=(p_feasibility#>>'{mapping,serviceDate}')::date;
 select public.static_weekly_v4_hydrate_compiler_source(s.canonical_source,date) into strict source
  from public.static_weekly_authority_source_documents s where s.source_id=p_source_id and s.active and s.retired_at is null
   and s.source_digest=public.static_weekly_digest_jsonb(s.canonical_source);
 if p_feasibility->>'schema' is distinct from 'custodial.approved-static-feasibility.v1'
  or p_feasibility->'solverInvoked' is distinct from 'false'::jsonb or p_feasibility->'optimized' is distinct from 'false'::jsonb
  or p_feasibility#>>'{mapping,templateId}' is distinct from p_template_id
  or p_feasibility#>>'{mapping,templateDigest}' is distinct from entry.binding_json->>'sourceDigest'
  or p_feasibility#>'{mapping,unchanged}' is distinct from 'true'::jsonb
  or p_feasibility#>'{mapping,scopeDays}' is distinct from '[0,1,2,3,4,5,6]'::jsonb
  or p_feasibility->>'publicationAuthority' is distinct from 'NOT_PUBLISHED'
  or p_feasibility->'candidateSource' is distinct from source
  or source->>'serviceDate' is distinct from date::text or source#>>'{version,effectiveStart}' is distinct from date::text
  or source->'exceptions' is distinct from '[]'::jsonb
  or p_feasibility->>'currentSourceDigest' is distinct from public.static_weekly_digest_jsonb(source)
  or p_feasibility->>'digest' is distinct from public.static_weekly_digest_jsonb(p_feasibility-'digest'-'initialBaseline')
  or p_feasibility#>>'{initialBaseline,schema}' is distinct from 'custodial.approved-static-initial-baseline.v1'
  or p_feasibility#>'{initialBaseline,document,assignments}' is distinct from p_feasibility->'baselineAssignments'
  or p_feasibility#>'{initialBaseline,document,slot_availability}' is distinct from p_feasibility->'slotAvailability'
  or p_feasibility#>'{initialBaseline,projection,assignments}' is distinct from p_feasibility->'projectionAssignments'
  or p_feasibility#>'{initialBaseline,lunchDocument}' is distinct from p_feasibility->'lunchDocument'
  or p_feasibility#>>'{lunch,status}' is distinct from 'PLANNED'
  or p_feasibility#>>'{initialBaseline,document,receipt,independentDerivations}' is distinct from '2'
  or p_feasibility#>'{initialBaseline,document,authority,optimizerResult}' is not null
  or p_feasibility#>>'{initialBaseline,document,authority,schema}' is distinct from 'custodial.approved-static-authority.v1'
  or p_feasibility#>>'{initialBaseline,projection,authority_digest}' is distinct from public.static_weekly_digest_jsonb(p_feasibility#>'{initialBaseline,document,authority}')
  or p_feasibility#>'{initialBaseline,projection,authority}' is distinct from p_feasibility#>'{initialBaseline,document,authority}' then
  raise exception using errcode='23514',message='exact independently validated fixed initial source/document/projection/lunch required';end if;
 -- Retain the existing independently implemented SQL derivation checker.
 if p_feasibility->'shiftEndDerivation'<>'null'::jsonb then
  perform public.static_weekly_v9_assert_shift_end_derivation(p_feasibility#>'{initialBaseline,document,authority}');
 end if;
 if public.static_weekly_v3_source_identity(source) is distinct from public.static_weekly_v3_source_identity(entry.template_json->'source') then
  raise exception 'initial baseline cannot change approved recurring geometry';end if;
 select * into prior from public.static_weekly_approved_initial_baselines where source_id=p_source_id;
 if found then
  if prior.feasibility is distinct from p_feasibility or prior.template_id is distinct from p_template_id then
   raise exception using errcode='23505',message='initial baseline source already binds different immutable evidence';end if;
 else
  insert into public.static_weekly_approved_initial_baselines(source_id,template_id,effective_start,feasibility,snapshot_digest)
   values(p_source_id,p_template_id,date,p_feasibility,public.static_weekly_digest_jsonb(p_feasibility));
 end if;
 return jsonb_build_object('registered',true,'sourceId',p_source_id,'snapshotDigest',public.static_weekly_digest_jsonb(p_feasibility),'published',false);
end $fn$;

create function public.static_weekly_read_approved_initial_basis(p_manager_id uuid,p_source_id uuid,p_date date,p_revision bigint,p_template_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare baseline public.static_weekly_approved_initial_baselines%rowtype;entry public.static_weekly_approved_template_catalog%rowtype;
 source jsonb;revision bigint;templates jsonb;bindings jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 select current_revision into strict revision from public.static_weekly_schedule_control where singleton;
 if revision is distinct from p_revision then raise exception using errcode='40001',message='stale initial baseline revision';end if;
 select * into strict baseline from public.static_weekly_approved_initial_baselines
  where source_id=p_source_id and template_id=p_template_id and effective_start=p_date;
 select * into strict entry from public.static_weekly_approved_template_catalog where template_id=p_template_id;
 source:=(public.static_weekly_v3_read_authority_source(p_source_id,p_date))->'compiler_input';
 if exists(select 1 from public.static_weekly_approved_template_retirements where template_id=p_template_id)
  or baseline.snapshot_digest<>public.static_weekly_digest_jsonb(baseline.feasibility)
  or baseline.feasibility->'candidateSource' is distinct from source
  or entry.catalog_entry_digest<>public.static_weekly_digest_jsonb(jsonb_build_object('template',entry.template_json,
    'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence)) then
  raise exception 'approved initial source or current people/availability changed';end if;
 templates:=jsonb_build_array(entry.template_json);bindings:=jsonb_build_array(entry.binding_json);
 return jsonb_build_object('schema','custodial.approved-static-initial-basis.v1','sourceId',p_source_id,'serviceDate',p_date,
  'authorityRevision',revision,'generation',public.static_weekly_v15_read_recurring_generation(),
  'currentSource',source,'currentSourceDigest',public.static_weekly_digest_jsonb(source),
  'ownerConfig',entry.owner_config,'templates',templates,'admittedBindings',bindings,
  'templateCatalogDigest',public.static_weekly_digest_jsonb(jsonb_build_object('templates',templates,'admittedBindings',bindings,'ownerConfig',entry.owner_config)));
end $fn$;

create function public.static_weekly_assert_approved_initial_document(p_document jsonb,p_date date,p_publishable boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if not exists(select 1 from public.static_weekly_approved_initial_baselines b
  where b.effective_start=p_date and b.snapshot_digest=public.static_weekly_digest_jsonb(b.feasibility)
   and b.feasibility#>'{initialBaseline,document}'=p_document
   and not exists(select 1 from public.static_weekly_approved_template_retirements r where r.template_id=b.template_id)) then
  raise exception 'document is not the exact release-admitted independently validated initial fixed baseline';end if;
end $fn$;
create function public.static_weekly_assert_approved_initial_projection(p_envelope jsonb,p_publication_id uuid,p_date date,p_exceptions jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if p_exceptions is distinct from '[]'::jsonb or not exists(select 1 from public.static_weekly_approved_initial_baselines b
  join public.weekly_schedule_versions v on v.authority_source_id=b.source_id
  join public.weekly_schedule_publications p on p.version_id=v.version_id and p.publication_id=p_publication_id
  where b.effective_start=p_date and b.snapshot_digest=public.static_weekly_digest_jsonb(b.feasibility)
   and b.feasibility#>'{initialBaseline,projection}'=p_envelope
   and b.feasibility#>'{initialBaseline,document}'=v.draft_document
   and not exists(select 1 from public.static_weekly_approved_template_retirements r where r.template_id=b.template_id)) then
  raise exception 'projection requires exact accepted fixed baseline with no dated overlays';end if;
end $fn$;

-- Copy the installed predecessor writers. Only the private validator seam and
-- truthful fixed objective path change; original validators/definitions stay
-- untouched. Every substitution is unique and fully reversible.
do $initial_writer_copies$
declare original text;changed text;reversed text;identity text;old_name text;new_name text;needle text;replacement text;
begin
 for identity,old_name,new_name in select * from (values
  ('public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)','static_weekly_v2_create_draft','static_weekly_approved_initial_create_draft'),
  ('public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)','static_weekly_v2_publish_draft','static_weekly_approved_initial_publish_draft'),
  ('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','static_weekly_v2_materialize_projection','static_weekly_approved_initial_materialize_projection')) x loop
  original:=pg_get_functiondef(identity::regprocedure);
  changed:=replace(original,'FUNCTION public.'||old_name||'(','FUNCTION public.'||new_name||'(');
  if changed=original then raise exception 'initial writer function header changed';end if;
  if old_name='static_weekly_v2_materialize_projection' then
   needle:='public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set)';
   replacement:='public.static_weekly_assert_approved_initial_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)';
  else
   needle:=case old_name when 'static_weekly_v2_create_draft' then 'public.static_weekly_assert_document_attested(p_document,p_effective_start,true)'
    else 'public.static_weekly_assert_document_attested(v_draft.draft_document,v_draft.effective_start,true)' end;
   replacement:=replace(needle,'static_weekly_assert_document_attested','static_weekly_assert_approved_initial_document');
  end if;
  if (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 then raise exception 'initial writer validator seam changed';end if;
  changed:=replace(changed,needle,replacement);
  if old_name='static_weekly_v2_create_draft' then
   needle:='p_document#>''{authority,optimizerResult,objective}''';
   if (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 then raise exception 'initial objective seam changed';end if;
   changed:=replace(changed,needle,'p_document->''objective''');
   -- September 24 made the installed writer bind provenance to the exact
   -- independently validated document. Preserve that stronger current guard;
   -- the initial-document validator above admits only the registered baseline.
   needle:='p_input_provenance->>''adapter_schema'' is distinct from p_document#>>''{adapter,schema}''';
   if (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 then raise exception 'initial adapter provenance seam changed';end if;
  end if;
  if old_name='static_weekly_v2_materialize_projection' then
   needle:='p_assignments#>>''{authority,schema}''=''memphis-zoo.static-weekly-authority.v4''';
   if (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 then raise exception 'initial parent chain seam changed';end if;
   changed:=replace(changed,needle,'p_assignments#>>''{authority,schema}''=''custodial.approved-static-authority.v1''');
  end if;
  reversed:=replace(changed,'FUNCTION public.'||new_name||'(','FUNCTION public.'||old_name||'(');
  reversed:=replace(reversed,'static_weekly_assert_approved_initial_document','static_weekly_assert_document_attested');
  reversed:=replace(reversed,'static_weekly_assert_approved_initial_projection','static_weekly_assert_projection_envelope_attested');
  if old_name='static_weekly_v2_create_draft' then
   reversed:=replace(reversed,'p_document->''objective''','p_document#>''{authority,optimizerResult,objective}''');
  end if;
  if old_name='static_weekly_v2_materialize_projection' then reversed:=replace(reversed,
   'p_assignments#>>''{authority,schema}''=''custodial.approved-static-authority.v1''',
   'p_assignments#>>''{authority,schema}''=''memphis-zoo.static-weekly-authority.v4''');end if;
  if reversed<>original then raise exception 'initial writer copy has unexplained predecessor drift';end if;
  execute changed;
 end loop;
end $initial_writer_copies$;

create function public.static_weekly_read_approved_initial_confirmation(p_manager_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare result jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 select jsonb_build_object('request',request_json,'receipt',receipt_json) into result
  from public.static_weekly_approved_initial_confirmations where manager_id=p_manager_id and idempotency_key=p_key;
 return result;
end $fn$;

create function public.static_weekly_materialize_approved_initial_baseline(p_manager_id uuid,p_source_id uuid,p_date date,
 p_revision bigint,p_generation bigint,p_key text,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;basis jsonb;baseline public.static_weekly_approved_initial_baselines%rowtype;prior public.static_weekly_approved_initial_confirmations%rowtype;
 document jsonb;projection jsonb;draft jsonb;published jsonb;materialized jsonb;lunch jsonb;receipt jsonb;provenance jsonb;
 v_version_id uuid;v_publication_id uuid;v_projection_id uuid;revision bigint;kind text;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 if p_key is null or length(btrim(p_key)) not between 1 and 150 then raise exception 'exact initial idempotency key required';end if;
 select * into prior from public.static_weekly_approved_initial_confirmations where manager_id=p_manager_id and idempotency_key=p_key;
 if found then
  if prior.request_json is distinct from p_envelope->'request' then raise exception using errcode='23505',message='initial confirmation identity conflict';end if;
  return prior.receipt_json;end if;
 basis:=public.static_weekly_read_approved_initial_basis(p_manager_id,p_source_id,p_date,p_revision,p_envelope#>>'{request,templateId}');
 select * into strict baseline from public.static_weekly_approved_initial_baselines where source_id=p_source_id;
 if p_envelope->>'schema' is distinct from 'custodial.approved-static-initial-materialization.v1'
  or p_envelope->>'managerId' is distinct from p_manager_id::text or p_envelope->>'sourceId' is distinct from p_source_id::text
  or p_envelope->>'effectiveStart' is distinct from p_date::text or p_envelope->'expectedRevision' is distinct from to_jsonb(p_revision)
  or p_generation is distinct from (basis->>'generation')::bigint or p_envelope->'generation' is distinct from to_jsonb(p_generation)
  or p_envelope->>'templateCatalogDigest' is distinct from basis->>'templateCatalogDigest'
  or p_envelope->'feasibility' is distinct from baseline.feasibility
  or p_envelope->>'previewDigest' is distinct from public.static_weekly_digest_jsonb(p_envelope-'request'-'previewDigest')
  or p_envelope->'request' is distinct from jsonb_build_object('sourceId',p_source_id,'effectiveStart',p_date,
    'templateId',baseline.template_id,'expectedRevision',p_revision,'previewDigest',p_envelope->>'previewDigest','idempotencyKey',p_key) then
  raise exception using errcode='23514',message='initial baseline must bind exact current source/catalog/actor/revision/generation and independently prepared fixed snapshot';end if;
 document:=baseline.feasibility#>'{initialBaseline,document}';projection:=baseline.feasibility#>'{initialBaseline,projection}';
 provenance:=jsonb_build_object('adapter_schema',document#>>'{adapter,schema}','compiler_version',document#>>'{validation,compiler_version}',
  'input_digest',document#>>'{validation,input_digest}','baseline_input_digest',document#>>'{validation,baseline_input_digest}',
  'authority_digest',document#>>'{validation,authority_digest}','replay_digest',document#>>'{validation,replay_digest}');
 draft:=public.static_weekly_approved_initial_create_draft(p_date,projection->>'compiler_version',projection->'objective',provenance,
  document,p_revision,p_manager_id,actor->>'manager_name',p_key||':draft');
 v_version_id:=(draft#>>'{data,version_id}')::uuid;revision:=(draft->>'revision')::bigint;
 perform set_config('app.static_weekly_source_bind','on',true);
 update public.weekly_schedule_versions set authority_source_id=p_source_id where version_id=v_version_id and authority_source_id is null;
 if not exists(select 1 from public.weekly_schedule_versions v where v.version_id=v_version_id and v.authority_source_id=p_source_id) then raise exception 'initial source identity was not retained';end if;
 perform public.static_weekly_v3_assert_draft_incumbency(v_version_id);
 kind:=case when exists(select 1 from public.weekly_schedule_publications) then 'supersede' else 'publish' end;
 published:=public.static_weekly_approved_initial_publish_draft(v_version_id,(draft#>>'{data,draft_revision}')::bigint,revision,
  p_manager_id,actor->>'manager_name',p_key||':publish',kind,null);
 v_publication_id:=(published#>>'{data,publication_id}')::uuid;revision:=(published->>'revision')::bigint;
 materialized:=public.static_weekly_approved_initial_materialize_projection(v_publication_id,p_date,public.static_weekly_digest_jsonb('[]'::jsonb),
  projection->>'compiler_version',projection->'objective',projection->'metrics',projection->>'replay_digest',projection,revision,
  p_manager_id,actor->>'manager_name',p_key||':projection');
 v_projection_id:=(materialized#>>'{data,projection_id}')::uuid;revision:=(materialized->>'revision')::bigint;
 lunch:=public.static_weekly_v8_materialize_lunch_document(v_projection_id,baseline.feasibility->'lunchDocument',p_manager_id);
 if lunch->>'persistence_status' is distinct from 'PERSISTED' then raise exception 'initial lunch not persisted';end if;
 receipt:=jsonb_build_object('schema','custodial.approved-static-initial-confirmation.v1','status','PERSISTED_CURRENT',
  'ok',true,'persistence_status','PERSISTED','source_id',p_source_id,'publication_id',v_publication_id,'projection_id',v_projection_id,
  'authority_revision',revision,'revision',revision,'feasibility_digest',baseline.feasibility->>'digest',
  'lunch_document_identity',lunch->>'document_identity','previewDigest',p_envelope->>'previewDigest','solverInvoked',false);
 insert into public.static_weekly_approved_initial_confirmations values(p_manager_id,p_key,p_envelope->'request',receipt,v_publication_id,v_projection_id);
 return receipt;
end $fn$;

do $initial_function_grants$
declare identity regprocedure;
begin
 foreach identity in array array[
  'public.static_weekly_register_approved_initial_baseline(uuid,text,jsonb)'::regprocedure,
  'public.static_weekly_read_approved_initial_basis(uuid,uuid,date,bigint,text)'::regprocedure,
  'public.static_weekly_assert_approved_initial_document(jsonb,date,boolean)'::regprocedure,
  'public.static_weekly_assert_approved_initial_projection(jsonb,uuid,date,jsonb)'::regprocedure,
  'public.static_weekly_approved_initial_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)'::regprocedure,
  'public.static_weekly_approved_initial_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)'::regprocedure,
  'public.static_weekly_approved_initial_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure,
  'public.static_weekly_read_approved_initial_confirmation(uuid,text)'::regprocedure,
  'public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)'::regprocedure] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',identity);
 end loop;
end $initial_function_grants$;
grant execute on function public.static_weekly_register_approved_initial_baseline(uuid,text,jsonb) to static_weekly_release_operator;
grant execute on function public.static_weekly_read_approved_initial_basis(uuid,uuid,date,bigint,text),
 public.static_weekly_read_approved_initial_confirmation(uuid,text),
 public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb) to static_weekly_control_plane;

do $initial_surface$
declare definition text;needle text:='  values';
begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'initial authority surface seam changed';end if;
 execute replace(definition,needle,needle||E'\n'||$entries$
 ('relation','public.static_weekly_approved_template_catalog','release-only fixed pattern catalog'),
 ('relation','public.static_weekly_approved_template_source_configs','release-only current configuration binding'),
 ('relation','public.static_weekly_approved_template_retirements','immutable pattern retirement'),
 ('relation','public.static_weekly_approved_initial_baselines','release-admitted independent static feasibility'),
 ('relation','public.static_weekly_approved_initial_confirmations','atomic current staff baseline receipt'),
 ('function','public.static_weekly_register_approved_initial_baseline(uuid,text,jsonb)','release-only initial snapshot admission'),
 ('function','public.static_weekly_read_approved_initial_basis(uuid,uuid,date,bigint,text)','named-manager current initial basis'),
 ('function','public.static_weekly_read_approved_initial_confirmation(uuid,text)','exact original initial receipt'),
 ('function','public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)','initial supersession/projection/lunch transaction'),
 $entries$);
end $initial_surface$;

-- Exact relation/column/constraint/trigger/function/grant recovery uses the
-- predecessor's existing serializers, never runtime default table grants.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $initial_recovery$
declare obj record;next_order integer;
begin
 for obj in with relations(name) as (values
  ('public.static_weekly_approved_template_catalog'),('public.static_weekly_approved_template_source_configs'),
  ('public.static_weekly_approved_template_retirements'),('public.static_weekly_approved_initial_baselines'),
  ('public.static_weekly_approved_initial_confirmations')),
 funcs as (select p.oid,'public.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' identity
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
   'static_weekly_register_approved_template','static_weekly_retire_approved_template','static_weekly_read_approved_template_basis',
   'static_weekly_register_approved_initial_baseline','static_weekly_read_approved_initial_basis',
   'static_weekly_assert_approved_initial_document','static_weekly_assert_approved_initial_projection',
   'static_weekly_approved_initial_create_draft','static_weekly_approved_initial_publish_draft',
   'static_weekly_approved_initial_materialize_projection','static_weekly_read_approved_initial_confirmation',
   'static_weekly_materialize_approved_initial_baseline','custodial_release_canary_authority_surface')),
 objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 700000,'trigger',r.name||'.'||t.tgname,'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '
    ||pg_get_triggerdef(t.oid,true)||'; alter table '||r.name||' enable trigger '||quote_ident(t.tgname)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing approved initial recovery object %',obj.identity;end if;
  if obj.identity='public.custodial_release_canary_authority_surface()' then
   if (select count(*) from public.custodial_release_authority_restore_inventory where object_kind=obj.kind
    and (case when object_kind in ('function','grant') and object_identity like '%(%' then to_regprocedure(object_identity) end)=obj.identity::regprocedure)<>1 then raise exception 'initial canary recovery alias count changed';end if;
   update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
    definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
    where object_kind=obj.kind and (case when object_kind in ('function','grant') and object_identity like '%(%' then to_regprocedure(object_identity) end)=obj.identity::regprocedure;
  else
   if exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind=obj.kind and object_identity=obj.identity) then
    raise exception 'new approved initial recovery identity already exists %',obj.identity;end if;
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $initial_recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
