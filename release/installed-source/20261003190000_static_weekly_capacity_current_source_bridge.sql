-- Explicit source-scoped legacy capacity replacement. No old employee, slot,
-- incumbent, publication, device or protected Start/Finish row is rewritten.
-- Admission is transaction-owned and cannot commit without the complete
-- existing publication/projection/lunch receipt. This is not phone delivery.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.static_weekly_capacity_source_previews (
 preview_id uuid primary key default gen_random_uuid(),
 manager_id uuid not null references public.ops_manager_managers(manager_id),
 source_publication_id uuid not null references public.weekly_schedule_publications(publication_id),
 expected_revision bigint not null,effective_start date not null,
 selection jsonb not null check(jsonb_typeof(selection)='array' and jsonb_array_length(selection)=8),
 basis_json jsonb not null,candidate_source jsonb not null,
 candidate_digest text not null check(candidate_digest~'^[0-9a-f]{64}$'),
 reason text not null check(length(btrim(reason)) between 1 and 500),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create table public.static_weekly_capacity_source_commands (
 operation_id uuid primary key,manager_id uuid not null references public.ops_manager_managers(manager_id),
 preview_id uuid not null unique references public.static_weekly_capacity_source_previews(preview_id),
 source_id uuid not null unique references public.static_weekly_authority_source_documents(source_id),
 request_digest text not null check(request_digest~'^[0-9a-f]{64}$'),
 owner_xid xid8 not null default pg_current_xact_id(),created_at timestamptz not null default clock_timestamp()
);
create table public.static_weekly_capacity_source_receipts (
 operation_id uuid primary key references public.static_weekly_capacity_source_commands(operation_id),
 publication_id uuid not null unique references public.weekly_schedule_publications(publication_id),
 projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id),
 receipt_json jsonb not null,receipt_digest text not null check(receipt_digest~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index capacity_source_preview_manager on public.static_weekly_capacity_source_previews(manager_id);
create index capacity_source_preview_publication on public.static_weekly_capacity_source_previews(source_publication_id);
create index capacity_source_command_manager on public.static_weekly_capacity_source_commands(manager_id);
create index capacity_source_receipt_projection on public.static_weekly_capacity_source_receipts(projection_id);
do $private$ declare rel text;begin
 foreach rel in array array['static_weekly_capacity_source_previews','static_weekly_capacity_source_commands','static_weekly_capacity_source_receipts'] loop
  execute format('alter table public.%I enable row level security',rel);
  execute format('alter table public.%I force row level security',rel);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',rel);
  execute format('create trigger capacity_source_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',rel);
 end loop;
end $private$;

create function public.static_weekly_capacity_source_locks() returns void
language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 -- Existing common recurring lock FIRST. Then source/roster/catalog/device
 -- admission witnesses in fixed order. Core snapshots and history unchanged.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 lock table public.weekly_roster_slots,public.weekly_roster_slot_incumbencies,
  public.weekly_roster_slot_incumbency_closures,public.weekly_roster_slot_staffing_states,
  public.static_weekly_authority_source_documents,public.static_weekly_contractor_capacity_registrations,
  public.weekly_schedule_publications,public.location_groups,public.location_group_memberships,public.locations,
  public.employees,public.devices in share mode;
end $fn$;

create function public.static_weekly_capacity_source_basis(p_manager uuid,p_publication uuid,p_start date,p_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;source jsonb;roster jsonb;dependencies jsonb;old_people uuid[];findings jsonb;authority record;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager);
 perform public.static_weekly_capacity_source_locks();
 if p_start is null or extract(isodow from p_start)<>1 or p_start<=public.sch_service_date(clock_timestamp())
  or p_revision is distinct from (select current_revision from public.static_weekly_schedule_control where singleton) then
  raise exception using errcode='40001',message='Capacity source preview requires exact current revision and a future complete Monday';end if;
 source:=public.static_weekly_v3_read_publication_source(p_publication,p_start);
 select * into strict authority from public.static_weekly_v6_schedule_authority_state(p_start);
 if authority.publication_id is distinct from p_publication then raise exception using errcode='40001',message='Exact effective source publication required';end if;
 select coalesce(array_agg(distinct (i->>'personId')::uuid),'{}'::uuid[]) into old_people
  from jsonb_array_elements(source#>'{compiler_input,slots}') s
  cross join lateral jsonb_array_elements(coalesce(s->'incumbencies','[]'::jsonb)) i
  where s->'contractorCapacity'='true'::jsonb and s->>'kind' is distinct from 'CONTRACTOR_CAPACITY';
 roster:=jsonb_build_object(
  'slots',coalesce((select jsonb_agg(to_jsonb(s) order by slot_id) from public.weekly_roster_slots s),'[]'::jsonb),
  'incumbencies',coalesce((select jsonb_agg(to_jsonb(s) order by incumbency_id) from public.weekly_roster_slot_incumbencies s),'[]'::jsonb),
  'closures',coalesce((select jsonb_agg(to_jsonb(s) order by incumbency_closure_id) from public.weekly_roster_slot_incumbency_closures s),'[]'::jsonb),
  'staffing',coalesce((select jsonb_agg(to_jsonb(s) order by staffing_state_id) from public.weekly_roster_slot_staffing_states s),'[]'::jsonb));
 dependencies:=jsonb_build_object(
  'catalog',public.place_source_manifest(),
  'employee_status',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'active',e.active,'display_name',e.display_name) order by e.id)
    from public.employees e where exists(select 1 from jsonb_array_elements(source#>'{compiler_input,slots}') s
      cross join lateral jsonb_array_elements(coalesce(s->'incumbencies','[]'::jsonb)) i where i->>'personId'=e.id::text)),'[]'::jsonb),
  'devices',coalesce((select jsonb_agg(to_jsonb(d) order by id) from public.devices d where assigned_employee_id=any(old_people)),'[]'::jsonb),
  'protected_sessions',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.sessions s where employee_id=any(old_people) and status in('active','pending_submit')),'[]'::jsonb),
  'protected_offline_contexts',coalesce((select jsonb_agg(to_jsonb(c) order by context_id) from public.custodial_offline_actor_contexts c where employee_id=any(old_people) and status='activated'),'[]'::jsonb),
  'registered_capacity',coalesce((select jsonb_agg(to_jsonb(c) order by capacity_slot_id) from public.static_weekly_contractor_capacity_registrations c),'[]'::jsonb));
 findings:='[]'::jsonb;
 if jsonb_array_length(dependencies->'devices')>0 then findings:=findings||'"LEGACY_CAPACITY_HAS_DEVICE_IDENTITY_REQUIRING_RECONCILIATION"'::jsonb;end if;
 if jsonb_array_length(dependencies->'protected_sessions')>0 or jsonb_array_length(dependencies->'protected_offline_contexts')>0 then findings:=findings||'"LEGACY_CAPACITY_HAS_PROTECTED_WORK_REQUIRING_RECONCILIATION"'::jsonb;end if;
 if jsonb_array_length(dependencies->'registered_capacity')>0 then findings:=findings||'"TYPED_POOL_ALREADY_REGISTERED_RECONCILE_EXISTING_SOURCE"'::jsonb;end if;
 return jsonb_build_object('manager_id',p_manager,'manager_name',actor->>'manager_name',
  'authority_revision',p_revision,'trusted_service_date',public.sch_service_date(clock_timestamp()),
  'source_id',source->'source_id','publication_id',source->'publication_id','current_publication_id',source->'publication_id',
  'version_id',source->'version_id','compiler_input',source->'compiler_input',
  'source_digest',public.static_weekly_digest_jsonb(source->'compiler_input'),
  'roster_digest',public.static_weekly_digest_jsonb(roster),'dependency_digest',public.static_weekly_digest_jsonb(dependencies),
  'all_slot_ids',coalesce((select jsonb_agg(slot_id::text order by slot_id) from public.weekly_roster_slots),'[]'::jsonb),
  'future_exception_count',(select count(*) from public.weekly_schedule_exception_commands where publication_id=p_publication and service_date>=p_start),
  'capacity_dependency_findings',findings);
end $fn$;

create function public.static_weekly_capacity_source_legacy_reference(p_value jsonb,p_ids text[])
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare item jsonb;key text;begin
 if jsonb_typeof(p_value)='string' then return (p_value#>>'{}')=any(p_ids);
 elsif jsonb_typeof(p_value)='array' then
  for item in select value from jsonb_array_elements(p_value) loop
   if public.static_weekly_capacity_source_legacy_reference(item,p_ids) then return true;end if;
  end loop;
 elsif jsonb_typeof(p_value)='object' then
  for key,item in select * from jsonb_each(p_value) loop
   if key=any(p_ids) or public.static_weekly_capacity_source_legacy_reference(item,p_ids) then return true;end if;
  end loop;
 end if;return false;
end $fn$;

create function public.static_weekly_capacity_source_candidate(p_basis jsonb,p_selection jsonb,p_start date,p_version uuid,p_publication uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare source jsonb:=p_basis->'compiler_input';candidate jsonb;version jsonb;slot jsonb;mapping jsonb;availability jsonb;
 slots jsonb:='[]';rows jsonb:='[]';old_ids text[];seen_old text[]:='{}';seen_new text[]:='{}';seen_codes text[]:='{}';
 ordinary_people text[];id text;new_id text;code text;
begin
 if source is null or jsonb_typeof(source->'slots') is distinct from 'array'
  or p_basis->'capacity_dependency_findings' is distinct from '[]'::jsonb
  or p_basis->>'future_exception_count'<>'0'
  or p_basis->>'source_digest' is distinct from public.static_weekly_digest_jsonb(source)
  or p_version is null or p_publication is null then raise exception using errcode='55000',message='Exact unconflicted server source basis required';end if;
 select array_agg(s->>'id' order by s->>'id') into old_ids from jsonb_array_elements(source->'slots') s where s->'contractorCapacity'='true'::jsonb;
 if cardinality(old_ids) is distinct from 8
  or (select count(*) from jsonb_array_elements(source->'slots') s where s->'contractorCapacity' is distinct from 'true'::jsonb)<>9
  or exists(select 1 from jsonb_array_elements(source->'slots') s where s->'contractorCapacity'='true'::jsonb and s->>'kind'='CONTRACTOR_CAPACITY') then
  raise exception using errcode='55000',message='Existing source does not contain the explicit nine-position/eight-legacy-capacity pool; reconcile actual source templates';end if;
 select coalesce(array_agg(distinct i->>'personId'),'{}'::text[]) into ordinary_people
  from jsonb_array_elements(source->'slots') s cross join lateral jsonb_array_elements(coalesce(s->'incumbencies','[]'::jsonb)) i
  where s->'contractorCapacity' is distinct from 'true'::jsonb;
 if exists(select 1 from jsonb_array_elements(source->'slots') s where s->>'id'=any(old_ids)
  and (jsonb_typeof(s->'incumbencies') is distinct from 'array' or jsonb_array_length(s->'incumbencies')=0
   or exists(select 1 from jsonb_array_elements(s->'incumbencies') i where i->>'personId'=any(ordinary_people)))) then
  raise exception using errcode='55000',message='Legacy capacity identity is absent or shared with a real employee position; explicit reconciliation required';end if;
 if p_selection is null or jsonb_typeof(p_selection)<>'array' or jsonb_array_length(p_selection)<>8 or octet_length(p_selection::text)>8192 then
  raise exception using errcode='22023',message='Exactly eight explicit old-slot/new-capacity/code mappings required';end if;
 for mapping in select value from jsonb_array_elements(p_selection) loop
  perform public.static_weekly_assert_exact_object(mapping,array['legacy_slot_id','new_capacity_id','capacity_code'],array['legacy_slot_id','new_capacity_id','capacity_code'],'capacity source mapping');
  perform public.static_weekly_v3_assert_uuid(mapping->'legacy_slot_id','legacy capacity slot');
  perform public.static_weekly_v3_assert_uuid(mapping->'new_capacity_id','new nonemployee capacity');
  id:=(mapping->>'legacy_slot_id')::uuid::text;new_id:=(mapping->>'new_capacity_id')::uuid::text;code:=mapping->>'capacity_code';
  if id<>mapping->>'legacy_slot_id' or new_id<>mapping->>'new_capacity_id' or not id=any(old_ids)
   or id=any(seen_old) or new_id=any(seen_new) or code=any(seen_codes) or code is null or code !~ '^CoverAll0[1-8]$'
   or exists(select 1 from public.weekly_roster_slots where slot_id=new_id::uuid) then
   raise exception using errcode='22023',message='Mapping must use each exact original UUID once, each new unused UUID once and each CoverAll01..08 code once';end if;
  seen_old:=array_append(seen_old,id);seen_new:=array_append(seen_new,new_id);seen_codes:=array_append(seen_codes,code);
 end loop;
 version:=source->'version';
 if public.static_weekly_capacity_source_legacy_reference(version-array['id','publicationId','effectiveStart','effectiveEnd','slotAvailability'],old_ids) then
  raise exception using errcode='55000',message='Accepted duties/origins/policy reference legacy capacity; explicit replacement-duty reconciliation required';end if;
 for slot in select value from jsonb_array_elements(source->'slots') loop
  if slot->>'id'=any(old_ids) then
   select value into strict mapping from jsonb_array_elements(p_selection) where value->>'legacy_slot_id'=slot->>'id';
   slot:=jsonb_build_object('id',mapping->>'new_capacity_id','capacityId',mapping->>'new_capacity_id','label',mapping->>'capacity_code',
     'kind','CONTRACTOR_CAPACITY','contractorCapacity',true,'incumbencies','[]'::jsonb,'contractorAvailability',slot->'contractorAvailability');
   perform public.static_weekly_capacity_assert_shape(slot);
  end if;slots:=slots||jsonb_build_array(slot);
 end loop;
 for availability in select value from jsonb_array_elements(version->'slotAvailability') loop
  if availability->>'slotId'=any(old_ids) then
   perform public.static_weekly_assert_exact_object(availability,array['slotId','dayOfWeek','status'],array['slotId','dayOfWeek','status'],'inactive legacy capacity');
   if availability->>'status'<>'unavailable' then raise exception using errcode='55000',message='Recurring legacy capacity is active; do not silently change eligibility';end if;
   select value into strict mapping from jsonb_array_elements(p_selection) where value->>'legacy_slot_id'=availability->>'slotId';
   availability:=jsonb_set(availability,'{slotId}',mapping->'new_capacity_id');
  end if;rows:=rows||jsonb_build_array(availability);
 end loop;
 version:=version||jsonb_build_object('id',p_version,'publicationId',p_publication,'effectiveStart',p_start,'effectiveEnd',null,'status','published','slotAvailability',rows);
 candidate:=source||jsonb_build_object('slots',slots,'version',version,'serviceDate',p_start);
 return candidate;
end $fn$;

create function public.static_weekly_capacity_source_preview_document(p public.static_weekly_capacity_source_previews)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $fn$
 select jsonb_build_object('schema','custodial.capacity-source-preview.v1','preview_id',p.preview_id,'manager_id',p.manager_id,
  'source_publication_id',p.source_publication_id,'expected_revision',p.expected_revision,'effective_start',p.effective_start,
  'selection',p.selection,'basis',p.basis_json,'candidate_source',p.candidate_source,'candidate_digest',p.candidate_digest,
  'reason',p.reason,'expires_at',p.expires_at,'admitted',false,'published',false,'affected_phones_updated',false,
  'historical_employee_rows_changed',false,'new_employee_rows',0)
$fn$;

-- Only the two membership-style collections may be permuted. Exact full
-- element JSONB + multiplicity is retained, with no drop/dedup/extra fields.
-- Everything else (including ordered routes/assignments/history) stays exact.
create function public.static_weekly_capacity_source_order_equivalent(p_raw jsonb,p_canonical jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare a jsonb;b jsonb;items jsonb;v jsonb;
begin
 if jsonb_typeof(p_raw) is distinct from 'object' or jsonb_typeof(p_canonical) is distinct from 'object'
  or jsonb_typeof(p_raw->'slots') is distinct from 'array' or jsonb_typeof(p_canonical->'slots') is distinct from 'array'
  or jsonb_typeof(p_raw#>'{version,slotAvailability}') is distinct from 'array'
  or jsonb_typeof(p_canonical#>'{version,slotAvailability}') is distinct from 'array' then return false;end if;
 a:=p_raw;b:=p_canonical;
 select coalesce(jsonb_agg(value order by value->>'id' collate "C",value::text collate "C"),'[]'::jsonb) into items from jsonb_array_elements(a->'slots');a:=jsonb_set(a,'{slots}',items);
 select coalesce(jsonb_agg(value order by value->>'id' collate "C",value::text collate "C"),'[]'::jsonb) into items from jsonb_array_elements(b->'slots');b:=jsonb_set(b,'{slots}',items);
 select coalesce(jsonb_agg(value order by (value->>'dayOfWeek')::integer,value->>'slotId' collate "C",value::text collate "C"),'[]'::jsonb) into items from jsonb_array_elements(a#>'{version,slotAvailability}');a:=jsonb_set(a,'{version,slotAvailability}',items);
 select coalesce(jsonb_agg(value order by (value->>'dayOfWeek')::integer,value->>'slotId' collate "C",value::text collate "C"),'[]'::jsonb) into items from jsonb_array_elements(b#>'{version,slotAvailability}');b:=jsonb_set(b,'{version,slotAvailability}',items);
 return a=b;
end $fn$;

create function public.static_weekly_capacity_source_preview(p_manager uuid,p_publication uuid,p_start date,p_revision bigint,p_selection jsonb,p_reason text,p_canonical_source jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare basis jsonb;candidate jsonb;preview public.static_weekly_capacity_source_previews%rowtype;
begin
 basis:=public.static_weekly_capacity_source_basis(p_manager,p_publication,p_start,p_revision);
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception using errcode='22023',message='Explicit source transition reason required';end if;
 candidate:=public.static_weekly_capacity_source_candidate(basis,p_selection,p_start,
  (p_canonical_source#>>'{version,id}')::uuid,(p_canonical_source#>>'{version,publicationId}')::uuid);
 if not public.static_weekly_capacity_source_order_equivalent(candidate,p_canonical_source) then
  raise exception using errcode='23514',message='Canonical source may permute only exact slot/availability elements; no values, multiplicity or other array changes';end if;
 candidate:=p_canonical_source;
 insert into public.static_weekly_capacity_source_previews(manager_id,source_publication_id,expected_revision,effective_start,selection,basis_json,candidate_source,candidate_digest,reason)
 values(p_manager,p_publication,p_revision,p_start,p_selection,basis,candidate,public.static_weekly_digest_jsonb(candidate),p_reason) returning * into preview;
 return public.static_weekly_capacity_source_preview_document(preview);
end $fn$;

create function public.static_weekly_capacity_source_status(p_manager uuid,p_operation uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $fn$
declare command public.static_weekly_capacity_source_commands%rowtype;receipt jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 -- A NOT_FOUND result must wait for an in-flight confirmation, not race its
 -- commit. VOLATILE permits a fresh snapshot after the authority lock wait.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_capacity_source_commands where operation_id=p_operation;
 if not found then return jsonb_build_object('operation_id',p_operation,'state','NOT_FOUND','accepted',false);end if;
 if command.manager_id<>p_manager then raise exception using errcode='42501',message='Original named manager required';end if;
 select receipt_json into strict receipt from public.static_weekly_capacity_source_receipts where operation_id=p_operation;
 return receipt;
end $fn$;

create function public.static_weekly_capacity_source_begin(p_manager uuid,p_operation uuid,p_preview uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare command public.static_weekly_capacity_source_commands%rowtype;preview public.static_weekly_capacity_source_previews%rowtype;
 basis jsonb;sid uuid:=gen_random_uuid();slot jsonb;actor jsonb;code text;request jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager);
 perform public.static_weekly_capacity_source_locks();
 if p_operation is null or p_preview is null then raise exception using errcode='22023',message='Exact original operation and preview identities required';end if;
 select * into command from public.static_weekly_capacity_source_commands where operation_id=p_operation;
 if found then
  if command.manager_id<>p_manager or command.preview_id<>p_preview then raise exception using errcode='23505',message='Original manager, operation and complete preview required';end if;
  return jsonb_build_object('replayed',true,'receipt',public.static_weekly_capacity_source_status(p_manager,p_operation));end if;
 select * into preview from public.static_weekly_capacity_source_previews where preview_id=p_preview;
 if not found or preview.manager_id<>p_manager then raise exception using errcode='42501',message='Exact attributable preview required';end if;
 if preview.expires_at<=clock_timestamp() then raise exception using errcode='40001',message='Source preview expired; generate a new exact preview';end if;
 basis:=public.static_weekly_capacity_source_basis(p_manager,preview.source_publication_id,preview.effective_start,preview.expected_revision);
 if basis is distinct from preview.basis_json then raise exception using errcode='40001',message='Exact source/publication/roster/dependencies changed';end if;
 if not public.static_weekly_capacity_source_order_equivalent(preview.candidate_source,public.static_weekly_capacity_source_candidate(basis,preview.selection,preview.effective_start,
  (preview.candidate_source#>>'{version,id}')::uuid,(preview.candidate_source#>>'{version,publicationId}')::uuid))
  or preview.candidate_digest<>public.static_weekly_digest_jsonb(preview.candidate_source) then raise exception 'Stored source candidate integrity mismatch';end if;
 request:=jsonb_build_object('operation_id',p_operation,'manager_id',p_manager,'manager_name',actor->>'manager_name',
  'preview_id',p_preview,'basis',basis,'selection',preview.selection,'reason',preview.reason,'candidate_digest',preview.candidate_digest);
 perform public.custodial_begin_application_mutation();
 insert into public.static_weekly_authority_source_documents(source_id,canonical_source,source_digest,configured_by)
 values(sid,preview.candidate_source,preview.candidate_digest,'capacity-source-transition:'||p_operation);
 insert into public.static_weekly_capacity_source_commands(operation_id,manager_id,preview_id,source_id,request_digest)
 values(p_operation,p_manager,p_preview,sid,public.static_weekly_digest_jsonb(request));
 for slot in select value from jsonb_array_elements(preview.candidate_source->'slots') where value->>'kind'='CONTRACTOR_CAPACITY' loop
  code:='STATIC_'||upper(replace(slot->>'id','-',''));
  insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  values((slot->>'id')::uuid,code,slot->>'label',p_manager,actor->>'manager_name',
   public.static_weekly_digest_jsonb(jsonb_build_object('source_id',sid,'slot_id',slot->>'id','slot_code',code,'slot_label',slot->>'label')));
  insert into public.static_weekly_contractor_capacity_registrations(capacity_slot_id,capacity_code,source_id,source_digest,slot_snapshot,slot_digest,registered_by_manager_id,manager_name_snapshot)
  values((slot->>'id')::uuid,slot->>'label',sid,preview.candidate_digest,slot,public.static_weekly_digest_jsonb(slot),p_manager,actor->>'manager_name');
 end loop;
 return public.static_weekly_capacity_source_preview_document(preview)||jsonb_build_object('source_id',sid,'replayed',false);
end $fn$;

create function public.static_weekly_capacity_source_assert_use(p_source uuid,p_manager uuid,p_key text,p_stage text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare command public.static_weekly_capacity_source_commands%rowtype;
begin
 select * into command from public.static_weekly_capacity_source_commands where source_id=p_source;
 if not found or exists(select 1 from public.static_weekly_capacity_source_receipts where operation_id=command.operation_id) then return;end if;
 if command.owner_xid<>pg_current_xact_id() or command.manager_id<>p_manager or p_stage not in('draft','publish')
  or p_key is distinct from 'capacity-source:'||command.operation_id||':'||p_stage then
  raise exception using errcode='42501',message='Unaccepted source restricted to exact admitted manager/transaction/child operation';end if;
end $fn$;

create function public.static_weekly_capacity_source_assert_unchanged_draft(p_version uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare command public.static_weekly_capacity_source_commands%rowtype;preview public.static_weekly_capacity_source_previews%rowtype;
 old_version uuid;old_facts jsonb;new_facts jsonb;old_capacities uuid[];new_capacities uuid[];
begin
 select c.* into command from public.static_weekly_capacity_source_commands c join public.weekly_schedule_versions v on v.authority_source_id=c.source_id where v.version_id=p_version;
 if not found or exists(select 1 from public.static_weekly_capacity_source_receipts where operation_id=command.operation_id) then return;end if;
 select * into strict preview from public.static_weekly_capacity_source_previews where preview_id=command.preview_id;
 select version_id into strict old_version from public.weekly_schedule_publications where publication_id=preview.source_publication_id;
 select array_agg((s->>'legacy_slot_id')::uuid),array_agg((s->>'new_capacity_id')::uuid) into old_capacities,new_capacities from jsonb_array_elements(preview.selection) s;
 select jsonb_agg(to_jsonb(a)-array['assignment_id','version_id','payload_json','authority_facts_json','content_digest','created_at'] order by day_of_week,work_id)
  into old_facts from public.weekly_schedule_slot_assignments a where version_id=old_version;
 select jsonb_agg(to_jsonb(a)-array['assignment_id','version_id','payload_json','authority_facts_json','content_digest','created_at'] order by day_of_week,work_id)
  into new_facts from public.weekly_schedule_slot_assignments a where version_id=p_version;
 if old_facts is distinct from new_facts then raise exception using errcode='55000',message='Capacity registration changed accepted ordinary ownership, work, windows or constraints';end if;
 select jsonb_agg(to_jsonb(a)-array['availability_id','version_id','content_digest','created_at'] order by slot_id,day_of_week)
  into old_facts from public.weekly_schedule_slot_availability a where version_id=old_version and not slot_id=any(old_capacities);
 select jsonb_agg(to_jsonb(a)-array['availability_id','version_id','content_digest','created_at'] order by slot_id,day_of_week)
  into new_facts from public.weekly_schedule_slot_availability a where version_id=p_version and not slot_id=any(new_capacities);
 if old_facts is distinct from new_facts then raise exception using errcode='55000',message='Capacity registration changed employee identity/workday/shift/lunch/restrictions';end if;
end $fn$;

create function public.static_weekly_capacity_source_finalize(p_manager uuid,p_operation uuid,p_publication uuid,p_projection uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare command public.static_weekly_capacity_source_commands%rowtype;preview public.static_weekly_capacity_source_previews%rowtype;
 authority record;lunch public.weekly_schedule_lunch_documents%rowtype;receipt jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 select * into strict command from public.static_weekly_capacity_source_commands where operation_id=p_operation;
 if command.manager_id<>p_manager or command.owner_xid<>pg_current_xact_id() then raise exception using errcode='42501',message='Exact original source transaction required';end if;
 select * into strict preview from public.static_weekly_capacity_source_previews where preview_id=command.preview_id;
 if not exists(select 1 from public.weekly_schedule_publications p join public.weekly_schedule_versions v using(version_id)
  where p.publication_id=p_publication and p.actor_manager_id=p_manager and p.idempotency_key='capacity-source:'||p_operation||':publish'
   and v.authority_source_id=command.source_id and p.effective_start=preview.effective_start) then raise exception 'Exact admitted source publication receipt required';end if;
 select * into strict authority from public.static_weekly_v6_schedule_authority_state(preview.effective_start);
 select * into strict lunch from public.weekly_schedule_lunch_documents where projection_id=p_projection;
 if authority.publication_id is distinct from p_publication or authority.projection_id is distinct from p_projection
  or authority.projection_status is distinct from 'current' or lunch.accepted_by_manager_id is distinct from p_manager
  or not exists(select 1 from public.weekly_schedule_command_receipts where actor_manager_id=p_manager
   and command_type='materialize_projection' and idempotency_key='capacity-source:'||p_operation||':projection:'||preview.effective_start
   and response_json#>>'{data,projection_id}'=p_projection::text) then raise exception 'Complete current projection/lunch and original child receipt required';end if;
 receipt:=jsonb_build_object('schema','custodial.capacity-source-receipt.v1','state','ACCEPTED','accepted',true,
  'operation_id',p_operation,'manager_id',p_manager,'preview_id',preview.preview_id,'request_digest',command.request_digest,
  'source_id',command.source_id,'candidate_digest',preview.candidate_digest,'basis_source_digest',preview.basis_json->'source_digest',
  'basis_roster_digest',preview.basis_json->'roster_digest','basis_dependency_digest',preview.basis_json->'dependency_digest',
  'publication_id',p_publication,'projection_id',p_projection,'authority_revision',authority.projection_authority_revision,
  'effective_start',preview.effective_start,'selection',preview.selection,'historical_employee_rows_changed',false,
  'new_employee_rows',0,'manual_activation_required',true,'affected_phones_updated',false,'phone_delivery_state','PENDING');
 insert into public.static_weekly_capacity_source_receipts(operation_id,publication_id,projection_id,receipt_json,receipt_digest)
 values(p_operation,p_publication,p_projection,receipt,public.static_weekly_digest_jsonb(receipt));return receipt;
end $fn$;

create function public.static_weekly_capacity_source_require_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if not exists(select 1 from public.static_weekly_capacity_source_receipts where operation_id=new.operation_id) then
  raise exception using errcode='23514',message='Capacity source admission cannot commit without complete publication/projection/lunch receipt';end if;return new;
end $fn$;
create constraint trigger capacity_source_complete after insert on public.static_weekly_capacity_source_commands
 deferrable initially deferred for each row execute function public.static_weekly_capacity_source_require_receipt();

-- Prove the exact predecessors BEFORE replacing any owning hook. Alias
-- normalization is allowed only for byte-proven same-OID stored semantics;
-- stale/mismatched definitions fail closed and need source reconciliation.
do $predecessors$ declare signature text;hook regprocedure;alias record;expected text;legacy_hash text;guard text;
 seam text:='perform public.static_weekly_v3_assert_control_plane();';begin
 foreach signature in array array[
  'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)',
  'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)',
  'public.static_weekly_v3_read_manager_snapshot_base(date)'] loop
  hook:=signature::regprocedure;
  for alias in select * from public.custodial_release_authority_restore_inventory
   where object_kind in('function','grant') and object_identity like '%(%'
    and position((select proname from pg_proc where oid=hook)||'(' in object_identity)>0 loop
   if to_regprocedure(alias.object_identity) is distinct from hook then
    raise exception 'Capacity hook recovery alias resolves to a different identity: %',alias.object_identity;end if;
   expected:=case when alias.object_kind='function' then pg_get_functiondef(hook)
    else public.custodial_release_authority_current_grant_definition(alias.object_identity) end;
   if alias.definition_sha256<>public.static_weekly_digest_text(alias.definition_sql) then
    raise exception 'Capacity hook stored predecessor integrity invalid: % %',alias.object_kind,alias.object_identity;end if;
   if alias.definition_sql is distinct from expected then
    -- Verified cd799f5 disposable pre-state records exactly two old aliases
    -- left by03030000's schema-qualified/unqualified identity split. Accept
    -- ONLY their known source hashes, then replay that migration's exact guard
    -- insertion and require complete byte equality to the LIVE predecessor.
    -- This is not a general stale-definition recapture or guard removal.
    select h,g into legacy_hash,guard from (values
     ('public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)',
      'd42f06e2c90931e2f532d89293927e7a5e1c8049bae1f68a1cacbdcec543482b',
      'perform public.place_operational_assert_source_use(p_source_id,p_manager_id,p_idempotency_key,''draft'');'),
     ('public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)',
      '8a87818d63aa3ecf2bc0d1a175608e5d3716d47465ae8862d122f2d9871a0c86',
      'perform public.place_operational_assert_source_use((select authority_source_id from public.weekly_schedule_versions where version_id=p_draft_version_id),p_manager_id,p_idempotency_key,''publish''); perform public.place_operational_assert_unchanged_draft(p_draft_version_id); if not exists(select 1 from public.weekly_schedule_command_receipts where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key) then perform public.place_operational_assert_accepted_names((select authority_source_id from public.weekly_schedule_versions where version_id=p_draft_version_id),(select effective_start from public.weekly_schedule_versions where version_id=p_draft_version_id)); end if;')) known(s,h,g)
     where s=signature;
    if alias.object_kind<>'function' or legacy_hash is null or alias.definition_sha256<>legacy_hash
     or length(alias.definition_sql)-length(replace(alias.definition_sql,seam,''))<>length(seam)
     or replace(alias.definition_sql,seam,seam||E'\n '||guard) is distinct from expected then
    raise exception 'Capacity hook stored predecessor drift requires reconciliation: % %',alias.object_kind,alias.object_identity;end if;
   end if;
  end loop;
 end loop;
end $predecessors$;

-- Existing source/publication guards gain only transaction-owned admission.
do $hooks$ declare item record;body text;old text;begin
 for item in select * from (values
  ('public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)',
   'perform public.static_weekly_capacity_source_assert_use(p_source_id,p_manager_id,p_idempotency_key,''draft'');'),
  ('public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)',
   'perform public.static_weekly_capacity_source_assert_use((select authority_source_id from public.weekly_schedule_versions where version_id=p_draft_version_id),p_manager_id,p_idempotency_key,''publish''); perform public.static_weekly_capacity_source_assert_unchanged_draft(p_draft_version_id);')) x(signature,guard) loop
  body:=pg_get_functiondef(item.signature::regprocedure);old:='perform public.static_weekly_v3_assert_control_plane();';
  if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Exact capacity source publisher guard seam required';end if;
  execute replace(body,old,old||' '||item.guard);
 end loop;
end $hooks$;

-- Future setup slots must not appear as ordinary vacant employees in the old
-- manager roster. Only an accepted (or this transaction's pending) replacement
-- source scopes the whole roster; unrelated existing publications keep their
-- original turnover/vacancy behavior. No historic employee is deactivated.
create function public.static_weekly_capacity_source_roster_visible(p_slot uuid,p_version uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare included boolean;scoped boolean;
begin
 select exists(select 1 from public.weekly_schedule_versions v
  cross join lateral jsonb_array_elements(v.draft_document#>'{authority,compilerInput,slots}') s
  where v.version_id=p_version and s->>'id'=p_slot::text) into included;
 if exists(select 1 from public.static_weekly_contractor_capacity_registrations where capacity_slot_id=p_slot)
  and not included then return false;end if;
 select exists(select 1 from public.weekly_schedule_versions v
  join public.static_weekly_capacity_source_commands c on c.source_id=v.authority_source_id
  where v.version_id=p_version and (c.owner_xid=pg_current_xact_id()
   or exists(select 1 from public.static_weekly_capacity_source_receipts r where r.operation_id=c.operation_id))) into scoped;
 return not scoped or included;
end $fn$;
do $roster$ declare body text;seam text:='from public.weekly_roster_slots s;';begin
 body:=pg_get_functiondef('public.static_weekly_v3_read_manager_snapshot_base(date)'::regprocedure);
 if length(body)-length(replace(body,seam,''))<>length(seam) then raise exception 'Exact manager roster source seam required';end if;
 execute replace(body,seam,'from public.weekly_roster_slots s where public.static_weekly_capacity_source_roster_visible(s.slot_id,v_display_version_id);');
end $roster$;

-- No default grants, public constraint helper, or direct private table access.
do $acl$ declare fn record;begin
 for fn in select oid::regprocedure::text signature from pg_proc
  where pronamespace='public'::regnamespace and proname like 'static_weekly_capacity_source_%' loop
  execute 'revoke all on function '||fn.signature||' from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823';
 end loop;
end $acl$;
grant execute on function public.static_weekly_capacity_source_basis(uuid,uuid,date,bigint),
 public.static_weekly_capacity_source_preview(uuid,uuid,date,bigint,jsonb,text,jsonb),
 public.static_weekly_capacity_source_begin(uuid,uuid,uuid),
 public.static_weekly_capacity_source_status(uuid,uuid),
 public.static_weekly_capacity_source_finalize(uuid,uuid,uuid,uuid) to static_weekly_control_plane;

-- Capture only the owning private surface and the three exact forward hooks.
-- Normalize pre-existing regprocedure spelling instead of duplicate identities.
do $recovery$ declare obj record;ord integer;changed integer;begin
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
   from pg_proc p where pronamespace='public'::regnamespace and (proname like 'static_weekly_capacity_source_%' or oid in(
    'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)'::regprocedure,
    'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)'::regprocedure,
    'public.static_weekly_v3_read_manager_snapshot_base(date)'::regprocedure))
  union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
   from pg_proc p where pronamespace='public'::regnamespace and (proname like 'static_weekly_capacity_source_%' or oid in(
    'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)'::regprocedure,
    'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)'::regprocedure,
    'public.static_weekly_v3_read_manager_snapshot_base(date)'::regprocedure))
  union all select x.* from unnest(array['public.static_weekly_capacity_source_previews','public.static_weekly_capacity_source_commands','public.static_weekly_capacity_source_receipts']) rel cross join lateral (
   select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
   union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname) from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
   union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
   union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
   union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rel::regclass
   union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
   union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';' from pg_trigger where tgrelid=rel::regclass and not tgisinternal
   union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x
 ) objects order by bucket,identity loop
  if obj.definition is null then raise exception 'Missing capacity bridge recovery object %',obj.identity;end if;
  if obj.kind in('function','grant') and obj.identity like '%(%' then
   -- Exact same-OID/predecessor bytes were proved above for inherited hooks.
   -- New functions have no inherited aliases; do not silently absorb others.
   delete from public.custodial_release_authority_restore_inventory duplicate
    where duplicate.object_kind=obj.kind and duplicate.object_identity like '%(%'
     and to_regprocedure(duplicate.object_identity)=to_regprocedure(obj.identity)
     and duplicate.restore_order<>(select min(original.restore_order)
      from public.custodial_release_authority_restore_inventory original
      where original.object_kind=obj.kind and original.object_identity like '%(%'
       and to_regprocedure(original.object_identity)=to_regprocedure(obj.identity));
  end if;
  update public.custodial_release_authority_restore_inventory set object_identity=obj.identity,definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or (obj.kind in('function','grant') and object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  get diagnostics changed=row_count;if changed>1 then raise exception 'Duplicate capacity bridge recovery identity %',obj.identity;end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,(case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if ord is null then raise exception 'Capacity bridge recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
