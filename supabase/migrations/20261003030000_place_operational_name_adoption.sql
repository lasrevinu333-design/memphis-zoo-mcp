-- Selected name/alias adoption through the EXISTING schedule publication.
-- No new scheduling, physical-tag or cleaning eligibility authority. All
-- destructive lifecycle changes remain metadata-only until duty reconciliation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.custodial_place_operational_previews (
 preview_id uuid primary key default gen_random_uuid(), manager_id uuid not null references public.ops_manager_managers(manager_id),
 source_publication_id uuid not null references public.weekly_schedule_publications(publication_id),
 expected_revision bigint not null, effective_start date not null,
 selection jsonb not null check(jsonb_typeof(selection)='array' and jsonb_array_length(selection) between 1 and 100),
 base_source jsonb not null, candidate_source jsonb not null, candidate_sha256 text not null check(candidate_sha256~'^[a-f0-9]{64}$'),
 source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'), dependency_sha256 text not null check(dependency_sha256~'^[a-f0-9]{64}$'),
 reason text not null check(length(btrim(reason)) between 1 and 500),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create table public.custodial_place_operational_commands (
 operation_id uuid primary key, manager_id uuid not null references public.ops_manager_managers(manager_id),
 preview_id uuid not null unique references public.custodial_place_operational_previews(preview_id),
 source_id uuid not null unique references public.static_weekly_authority_source_documents(source_id),
 owner_xid xid8 not null default pg_current_xact_id(), created_at timestamptz not null default clock_timestamp()
);
create table public.custodial_place_operational_receipts (
 operation_id uuid primary key references public.custodial_place_operational_commands(operation_id),
 publication_id uuid not null unique references public.weekly_schedule_publications(publication_id),
 projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id),
 receipt_json jsonb not null, receipt_sha256 text not null check(receipt_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
do $private$ declare rel text;begin
 foreach rel in array array['custodial_place_operational_previews','custodial_place_operational_commands','custodial_place_operational_receipts'] loop
  execute format('alter table public.%I enable row level security',rel);
  execute format('alter table public.%I force row level security',rel);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',rel);
  execute format('create trigger place_operational_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',rel);
 end loop;
end $private$;

create function public.place_operational_preview_document(p public.custodial_place_operational_previews) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select jsonb_build_object('schema','custodial.place-name-publication.v1','preview_id',p.preview_id,'expected_revision',p.expected_revision,
 'source_publication_id',p.source_publication_id,'effective_start',p.effective_start,'selection',p.selection,'base_source',p.base_source,
 'candidate_source',p.candidate_source,'candidate_sha256',p.candidate_sha256,'source_sha256',p.source_sha256,
 'expires_at',p.expires_at,'accepted',false,'affected_phones_updated',false,'phone_delivery_state','NOT_ACCEPTED')
$fn$;

create function public.custodial_place_operational_preview(p_manager uuid,p_publication uuid,p_start date,p_revision bigint,p_selection jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare preview public.custodial_place_operational_previews%rowtype;source jsonb;candidate jsonb;overlay jsonb;item jsonb;record jsonb;selected jsonb:='[]';
 a jsonb;loc jsonb;rewritten jsonb:='[]';included jsonb;desired_members jsonb;raw_members jsonb;at_time timestamptz;matched integer;display text;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 perform public.place_source_locks();
 if p_start is null or extract(isodow from p_start)<>1 or p_start<=public.sch_service_date(clock_timestamp()) or p_start<'2026-10-05'
  or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_selection is null or jsonb_typeof(p_selection)<>'array'
  or jsonb_array_length(p_selection) not between 1 and 100 or octet_length(p_selection::text)>32768 then
  raise exception using errcode='22023',message='Selected Place names require a future complete Monday outside the protected October dated plan';end if;
 if p_revision is distinct from (select current_revision from public.static_weekly_schedule_control where singleton) then
  raise exception using errcode='40001',message='Schedule authority revision changed';end if;
 source:=public.static_weekly_v3_read_publication_source(p_publication,p_start)->'compiler_input';
 if exists(select 1 from public.weekly_schedule_exception_commands where publication_id=p_publication and service_date>=p_start) then
  raise exception using errcode='55000',message='Name-only publication cannot migrate dated exception history; explicit plan reconciliation required';end if;
 if jsonb_typeof(source#>'{version,assignments}') is distinct from 'array' then raise exception 'Registered source required';end if;
 at_time:=(p_start+time '04:00') at time zone 'America/Chicago';overlay:=public.custodial_place_source_overlay(at_time);
 for item in select value from jsonb_array_elements(p_selection) order by value->>'legacy_kind',value->>'legacy_id' loop
  if jsonb_typeof(item)<>'object' or not item ?& array['legacy_kind','legacy_id','revision']
   or exists(select 1 from jsonb_object_keys(item) k where k not in('legacy_kind','legacy_id','revision'))
   or item->>'legacy_kind' not in('physical_location','location_group') or item->>'revision' !~ '^[1-9][0-9]*$' then
   raise exception using errcode='22023',message='Only exact namespace, original UUID and desired effective revision may be selected';end if;
  if exists(select 1 from jsonb_array_elements(selected) x where x->>'legacy_kind'=item->>'legacy_kind' and x->>'legacy_id'=item->>'legacy_id') then
   raise exception using errcode='22023',message='Duplicate selected identity';end if;
  select value into record from jsonb_array_elements(overlay->'records') where value->>'legacy_kind'=item->>'legacy_kind' and value->>'legacy_id'=(item->>'legacy_id')::uuid::text;
  if record is null or record->>'mapping_status'<>'MAPPED' or record->>'effective_revision'<>item->>'revision'
   or record#>>'{raw_legacy,active}' is distinct from 'true' then
   raise exception using errcode='40001',message='Exact mapped active existing identity required; setup, inactive, merge and drift need explicit reconciliation';end if;
  if record->>'legacy_kind'='physical_location' and record#>>'{effective_snapshot,cleaning_mode}'<>'SCAN_TRACKED' then
   raise exception using errcode='55000',message='Physical reclassification requires explicit replacement-duty preview';end if;
  if record->>'legacy_kind'='location_group' then
   select coalesce(jsonb_agg(x->>'location_id' order by x->>'location_id'),'[]') into raw_members from jsonb_array_elements(record#>'{raw_legacy,memberships}') x;
   select coalesce(jsonb_agg(x order by x),'[]') into desired_members from jsonb_array_elements_text(record->'source_member_location_ids') x;
   if desired_members<>raw_members then raise exception using errcode='55000',message='Membership changes require explicit replacement-duty preview';end if;
   if exists(select 1 from jsonb_array_elements(source#>'{version,assignments}') w where w->>'locationCodeSnapshot'=record#>>'{raw_legacy,group_code}'
    and coalesce(w->>'serviceMode','scan_tracked')<>case record#>>'{effective_snapshot,cleaning_mode}' when 'SCAN_TRACKED' then 'scan_tracked' when 'REMINDER_ONLY' then 'reminder_only' else 'response_only_no_clean' end) then
    raise exception using errcode='55000',message='Group reclassification requires explicit replacement-duty preview';end if;
  end if;
  -- Complete desired/effective/source evidence, not a fresh unbound name read.
  selected:=selected||jsonb_build_array(record);
 end loop;
 for a in select value from jsonb_array_elements(source#>'{version,assignments}') loop
  included:='[]';
  for loc in select value from jsonb_array_elements(coalesce(a->'includedLocations','[]')) loop
   select x#>>'{effective_snapshot,display_name}' into display from jsonb_array_elements(selected) x
    where x->>'legacy_kind'='physical_location' and x->>'legacy_id'=loc->>'locationId';
   included:=included||jsonb_build_array(case when display is null then loc else jsonb_set(loc,'{locationNameSnapshot}',to_jsonb(display)) end);
  end loop;
  if a ? 'includedLocations' then a:=jsonb_set(a,'{includedLocations}',included);end if;
  for record in select value from jsonb_array_elements(selected) order by case value->>'legacy_kind' when 'physical_location' then 0 else 1 end,value->>'legacy_id' loop
   if record->>'legacy_kind'='physical_location' and a->>'locationId'=record->>'legacy_id' and a->>'locationCodeSnapshot'=record#>>'{raw_legacy,location_code}'
    and not exists(select 1 from public.location_groups g join public.location_group_memberships m on m.location_group_id=g.id
     where g.group_code=a->>'locationCodeSnapshot' and m.location_id=(a->>'locationId')::uuid) then
    a:=jsonb_set(a,'{locationNameSnapshot}',record#>'{effective_snapshot,display_name}');
   elsif record->>'legacy_kind'='location_group' and a->>'locationCodeSnapshot'=record#>>'{raw_legacy,group_code}' then
    -- Stable group code alone is insufficient: the immutable accepted routing
    -- UUID and every included physical UUID must resolve through this group's
    -- exact legacy relationships. Never infer a group from a human name.
    if not (a->>'locationId'=record->>'legacy_id' or exists(select 1 from jsonb_array_elements(record#>'{raw_legacy,memberships}') m where m->>'location_id'=a->>'locationId'))
      or exists(select 1 from jsonb_array_elements(included) l where not exists(select 1 from jsonb_array_elements(record#>'{raw_legacy,memberships}') m where m->>'location_id'=l->>'locationId')) then
     raise exception using errcode='55000',message='Accepted group routing has no explicit original relationship; reconciliation required';end if;
    a:=jsonb_set(a,'{locationNameSnapshot}',record#>'{effective_snapshot,display_name}');
   end if;
  end loop;
  rewritten:=rewritten||jsonb_build_array(a);
 end loop;
 preview.preview_id:=gen_random_uuid();candidate:=jsonb_set(source,'{version,assignments}',rewritten);
 candidate:=jsonb_set(candidate,'{serviceDate}',to_jsonb(p_start::text));
 candidate:=jsonb_set(candidate,'{version}',(candidate->'version')||jsonb_build_object('id',preview.preview_id,'publicationId',gen_random_uuid(),'status','published','effectiveStart',p_start,'effectiveEnd',null));
 insert into public.custodial_place_operational_previews(preview_id,manager_id,source_publication_id,expected_revision,effective_start,selection,base_source,candidate_source,candidate_sha256,source_sha256,dependency_sha256,reason)
 values(preview.preview_id,p_manager,p_publication,p_revision,p_start,selected,source,candidate,public.place_bridge_sha(candidate),public.place_bridge_sha(public.place_source_manifest()),public.place_bridge_sha(public.place_source_dependencies()),p_reason) returning * into preview;
 return public.place_operational_preview_document(preview);
end $fn$;

create function public.custodial_place_operational_status(p_manager uuid,p_operation uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare c public.custodial_place_operational_commands%rowtype;r public.custodial_place_operational_receipts%rowtype;begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 select * into c from public.custodial_place_operational_commands where operation_id=p_operation;
 if not found then return jsonb_build_object('operation_id',p_operation,'accepted',false,'status','NOT_FOUND');end if;
 if c.manager_id<>p_manager then raise exception using errcode='42501',message='Original named manager required';end if;
 select * into strict r from public.custodial_place_operational_receipts where operation_id=p_operation;
 return r.receipt_json;
end $fn$;

create function public.custodial_place_operational_begin(p_manager uuid,p_operation uuid,p_preview uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare p public.custodial_place_operational_previews%rowtype;c public.custodial_place_operational_commands%rowtype;sid uuid:=gen_random_uuid();begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);perform public.place_source_locks();
 select * into c from public.custodial_place_operational_commands where operation_id=p_operation;
 if found then
  if c.manager_id<>p_manager or c.preview_id<>p_preview then raise exception using errcode='23505',message='Original operation, manager and preview identity required';end if;
  return jsonb_build_object('replayed',true,'receipt',public.custodial_place_operational_status(p_manager,p_operation));end if;
 select * into p from public.custodial_place_operational_previews where preview_id=p_preview;
 if not found or p.manager_id<>p_manager then raise exception using errcode='42501',message='Exact manager preview required';end if;
 if p.expires_at<=clock_timestamp() or p.effective_start<=public.sch_service_date(clock_timestamp()) or p.expected_revision<>(select current_revision from public.static_weekly_schedule_control where singleton)
  or p.source_sha256<>public.place_bridge_sha(public.place_source_manifest()) or p.dependency_sha256<>public.place_bridge_sha(public.place_source_dependencies())
  or p.base_source is distinct from public.static_weekly_v3_read_publication_source(p.source_publication_id,p.effective_start)->'compiler_input' then
  raise exception using errcode='40001',message='Place preview expired or exact source/dependencies changed';end if;
 insert into public.static_weekly_authority_source_documents(source_id,canonical_source,source_digest,configured_by)
 values(sid,p.candidate_source,p.candidate_sha256,'place-name-publication:'||p_operation);
 insert into public.custodial_place_operational_commands(operation_id,manager_id,preview_id,source_id) values(p_operation,p_manager,p_preview,sid);
 return public.place_operational_preview_document(p)||jsonb_build_object('source_id',sid,'replayed',false);
end $fn$;

create function public.place_operational_assert_source_use(p_source uuid,p_manager uuid,p_key text,p_stage text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare c public.custodial_place_operational_commands%rowtype;begin
 select * into c from public.custodial_place_operational_commands where source_id=p_source;
 if not found or exists(select 1 from public.custodial_place_operational_receipts where operation_id=c.operation_id) then return;end if;
 if c.owner_xid<>pg_current_xact_id() or c.manager_id<>p_manager or p_stage not in('draft','publish')
  or p_key is distinct from 'place:'||c.operation_id||':'||p_stage then
  raise exception using errcode='42501',message='Unaccepted Place source is limited to its exact transaction and child operation';end if;
end $fn$;

create function public.place_operational_assert_unchanged_draft(p_version uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare c public.custodial_place_operational_commands%rowtype;p public.custodial_place_operational_previews%rowtype;old_version uuid;old_facts jsonb;new_facts jsonb;begin
 select c1.* into c from public.custodial_place_operational_commands c1 join public.weekly_schedule_versions v on v.authority_source_id=c1.source_id where v.version_id=p_version;
 if not found or exists(select 1 from public.custodial_place_operational_receipts where operation_id=c.operation_id) then return;end if;
 select * into strict p from public.custodial_place_operational_previews where preview_id=c.preview_id;
 select version_id into strict old_version from public.weekly_schedule_publications where publication_id=p.source_publication_id;
 -- Compare the ACTUALLY ACCEPTED assignment decisions, not merely the input's
 -- preferred owner. Stable work/day identities survive new version UUIDs.
 select jsonb_agg(to_jsonb(a)-array['assignment_id','version_id','location_name_snapshot','payload_json','authority_facts_json','content_digest','created_at'] order by day_of_week,work_id)
  into old_facts from public.weekly_schedule_slot_assignments a where version_id=old_version;
 select jsonb_agg(to_jsonb(a)-array['assignment_id','version_id','location_name_snapshot','payload_json','authority_facts_json','content_digest','created_at'] order by day_of_week,work_id)
  into new_facts from public.weekly_schedule_slot_assignments a where version_id=p_version;
 if old_facts is distinct from new_facts then raise exception using errcode='55000',message='Name-only compiler decision changed accepted ownership, work, windows, effort or restrictions';end if;
 select jsonb_agg(to_jsonb(a)-array['availability_id','version_id','content_digest','created_at'] order by slot_id,day_of_week) into old_facts
  from public.weekly_schedule_slot_availability a where version_id=old_version;
 select jsonb_agg(to_jsonb(a)-array['availability_id','version_id','content_digest','created_at'] order by slot_id,day_of_week) into new_facts
  from public.weekly_schedule_slot_availability a where version_id=p_version;
 if old_facts is distinct from new_facts then raise exception using errcode='55000',message='Name-only compiler decision changed accepted people, workdays, shifts or lunches';end if;
end $fn$;

create function public.custodial_place_operational_finalize(p_manager uuid,p_operation uuid,p_publication uuid,p_projection uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare c public.custodial_place_operational_commands%rowtype;p public.custodial_place_operational_previews%rowtype;a record;l public.weekly_schedule_lunch_documents%rowtype;receipt jsonb;begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 select * into strict c from public.custodial_place_operational_commands where operation_id=p_operation;
 if c.manager_id<>p_manager or c.owner_xid<>pg_current_xact_id() then raise exception using errcode='42501',message='Exact original Place transaction required';end if;
 select * into strict p from public.custodial_place_operational_previews where preview_id=c.preview_id;
 if not exists(select 1 from public.weekly_schedule_publications pub join public.weekly_schedule_versions v using(version_id)
  where pub.publication_id=p_publication and pub.actor_manager_id=p_manager and pub.idempotency_key='place:'||p_operation||':publish'
   and v.authority_source_id=c.source_id and pub.effective_start=p.effective_start) then raise exception 'Exact Place publication child required';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p.effective_start);
 select * into l from public.weekly_schedule_lunch_documents where projection_id=p_projection;
 if a.publication_id is distinct from p_publication or a.projection_id is distinct from p_projection or a.projection_status is distinct from 'current'
  or l.accepted_by_manager_id is distinct from p_manager then raise exception 'Current complete Place projection and named-manager lunch companion required';end if;
 if not exists(select 1 from public.weekly_schedule_command_receipts r where actor_manager_id=p_manager and command_type='materialize_projection'
  and idempotency_key='place:'||p_operation||':projection:'||p.effective_start and r.response_json#>>'{data,projection_id}'=p_projection::text) then
  raise exception 'Exact Place projection child receipt required';end if;
 receipt:=jsonb_build_object('schema','custodial.place-name-publication-receipt.v1','operation_id',p_operation,'manager_id',p_manager,'preview_id',p.preview_id,
 'source_id',c.source_id,'source_sha256',p.source_sha256,'candidate_sha256',p.candidate_sha256,'publication_id',p_publication,'projection_id',p_projection,
 'authority_revision',a.projection_authority_revision,'effective_start',p.effective_start,'selection',p.selection,
 'accepted',true,'affected_phones_updated',false,'phone_delivery_state','PENDING','scope','SELECTED_NAMES_AND_HUMAN_ALIASES_ONLY');
 insert into public.custodial_place_operational_receipts(operation_id,publication_id,projection_id,receipt_json,receipt_sha256)
 values(p_operation,p_publication,p_projection,receipt,public.place_bridge_sha(receipt));return receipt;
end $fn$;

create function public.place_operational_require_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if not exists(select 1 from public.custodial_place_operational_receipts where operation_id=new.operation_id) then
  raise exception using errcode='23514',message='Place source admission cannot commit without complete publication/projection receipt';end if;return new;
end $fn$;
create constraint trigger place_operational_complete after insert on public.custodial_place_operational_commands deferrable initially deferred for each row execute function public.place_operational_require_receipt();

-- Snapshot strings only. Raw UUID/code/tag identities, clocks, protection and
-- Start/Finish proofs remain with the original cleaning authority.
create function public.place_operational_accepted_record(p_kind text,p_id uuid,p_at timestamptz) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select x from public.custodial_place_operational_receipts r join public.custodial_place_operational_commands c using(operation_id)
 join public.custodial_place_operational_previews p using(preview_id)
 cross join lateral jsonb_array_elements(p.selection) x
 where x->>'legacy_kind'=p_kind and x->>'legacy_id'=p_id::text and (p.effective_start+time '04:00') at time zone 'America/Chicago'<=p_at
 order by p.effective_start desc,r.created_at desc,r.operation_id desc limit 1
$fn$;
create function public.place_operational_location_name(p_id uuid,p_at timestamptz) returns text
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select coalesce(public.place_operational_accepted_record('physical_location',p_id,p_at)#>>'{effective_snapshot,display_name}',l.location_name) from public.locations l where l.id=p_id
$fn$;
create function public.place_operational_assert_accepted_names(p_source uuid,p_date date) returns void
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare source jsonb;a jsonb;loc jsonb;expected jsonb;record jsonb;override jsonb:='[]';at_time timestamptz;primary_name text;
begin
 -- Empty/unmapped catalogs keep the existing authority path. This does not
 -- enroll, activate or replace any source just because the registry is empty.
 if not exists(select 1 from public.custodial_place_operational_receipts) and not exists(select 1 from public.custodial_place_operational_commands where source_id=p_source) then return;end if;
 select canonical_source into source from public.static_weekly_authority_source_documents where source_id=p_source;
 select p.selection into override from public.custodial_place_operational_commands c join public.custodial_place_operational_previews p using(preview_id)
  where c.source_id=p_source and c.owner_xid=pg_current_xact_id() and not exists(select 1 from public.custodial_place_operational_receipts where operation_id=c.operation_id);
 override:=coalesce(override,'[]');at_time:=(p_date+time '04:00') at time zone 'America/Chicago';
 for a in select value from jsonb_array_elements(source#>'{version,assignments}') loop
  for loc in select value from jsonb_array_elements(coalesce(a->'includedLocations','[]')) loop
   select value into expected from jsonb_array_elements(override) where value->>'legacy_kind'='physical_location' and value->>'legacy_id'=loc->>'locationId';
   expected:=coalesce(expected,public.place_operational_accepted_record('physical_location',(loc->>'locationId')::uuid,at_time));
   if expected is not null and loc->>'locationNameSnapshot' is distinct from expected#>>'{effective_snapshot,display_name}' then
    raise exception using errcode='55000',message='Publication would silently replace an accepted physical display snapshot';end if;
  end loop;
  primary_name:=null;
  -- Prefer an explicitly accepted group routing relation, not a human-name
  -- join or an accidental physical/group code collision.
  for record in select coalesce((select value from jsonb_array_elements(override) where value->>'legacy_kind'='location_group' and value->>'legacy_id'=g.id::text),
   public.place_operational_accepted_record('location_group',g.id,at_time)) from public.location_groups g where g.group_code=a->>'locationCodeSnapshot' loop
   if record is not null and (a->>'locationId'=record->>'legacy_id' or exists(select 1 from jsonb_array_elements(record#>'{raw_legacy,memberships}') m where m->>'location_id'=a->>'locationId')) then
    primary_name:=record#>>'{effective_snapshot,display_name}';end if;
  end loop;
  if primary_name is null and not exists(select 1 from public.location_groups g join public.location_group_memberships m on m.location_group_id=g.id
   where g.group_code=a->>'locationCodeSnapshot' and m.location_id=(a->>'locationId')::uuid) then
   select value into expected from jsonb_array_elements(override) where value->>'legacy_kind'='physical_location' and value->>'legacy_id'=a->>'locationId';
   expected:=coalesce(expected,public.place_operational_accepted_record('physical_location',(a->>'locationId')::uuid,at_time));
   if expected#>>'{raw_legacy,location_code}'=a->>'locationCodeSnapshot' then primary_name:=expected#>>'{effective_snapshot,display_name}';end if;
  end if;
  if primary_name is not null and a->>'locationNameSnapshot' is distinct from primary_name then
   raise exception using errcode='55000',message='Publication would silently replace an accepted routing display snapshot',
    detail=jsonb_build_object('original_location_id',a->>'locationId','original_code',a->>'locationCodeSnapshot','expected_display',primary_name,'candidate_display',a->>'locationNameSnapshot')::text;end if;
 end loop;
end $fn$;
do $hooks$ declare d text;seam text;sig text;guard text;begin
 for sig,guard in select * from (values
 ('public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)','perform public.place_operational_assert_source_use(p_source_id,p_manager_id,p_idempotency_key,''draft'');'),
 ('public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)','perform public.place_operational_assert_source_use((select authority_source_id from public.weekly_schedule_versions where version_id=p_draft_version_id),p_manager_id,p_idempotency_key,''publish''); perform public.place_operational_assert_unchanged_draft(p_draft_version_id); if not exists(select 1 from public.weekly_schedule_command_receipts where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key) then perform public.place_operational_assert_accepted_names((select authority_source_id from public.weekly_schedule_versions where version_id=p_draft_version_id),(select effective_start from public.weekly_schedule_versions where version_id=p_draft_version_id)); end if;')) t(s,g) loop
  d:=pg_get_functiondef(sig::regprocedure);seam:='perform public.static_weekly_v3_assert_control_plane();';
  if length(d)-length(replace(d,seam,''))<>length(seam) then raise exception 'Place source seam changed %',sig;end if;
  execute replace(d,seam,seam||E'\n '||guard);
 end loop;
 d:=pg_get_functiondef('public.tool_get_offline_scan_authority_snapshot(text,text,text)'::regprocedure);
 seam:='''location_name'',l.location_name';if position(seam in d)=0 then raise exception 'Place snapshot name seam changed';end if;
 d:=replace(d,seam,'''location_name'',public.place_operational_location_name(l.id,v_generated_at)');
 -- Name-only adoption MUST NOT shorten a previously valid offline interval.
 -- Queued captured Start and same-tag Finish retain their original snapshot.
 execute d;
 -- Keep all current status clocks, columns and native open-work projections.
 d:=pg_get_viewdef('public.v_location_dashboard_status'::regclass,true);seam:='location.location_name';
 if position(seam in d)=0 then raise exception 'Place dashboard name seam changed';end if;
 execute 'create or replace view public.v_location_dashboard_status as '||replace(d,seam,'public.place_operational_location_name(location.id,statement_timestamp()) AS location_name');
 -- get_location_scan_state is the shared typed predecessor used by v1/v2.
 d:=pg_get_functiondef('public.get_location_scan_state(text,text)'::regprocedure);
 seam:='vls.location_name';if position(seam in d)=0 then raise exception 'Place scan display seam changed';end if;
 execute replace(d,seam,'public.place_operational_location_name((select id from public.locations where location_code=vls.location_code),statement_timestamp())');
end $hooks$;

revoke all on function public.place_operational_preview_document(public.custodial_place_operational_previews),public.custodial_place_operational_preview(uuid,uuid,date,bigint,jsonb,text),
 public.custodial_place_operational_begin(uuid,uuid,uuid),public.custodial_place_operational_status(uuid,uuid),public.custodial_place_operational_finalize(uuid,uuid,uuid,uuid),
 public.place_operational_assert_source_use(uuid,uuid,text,text),public.place_operational_require_receipt(),public.place_operational_accepted_record(text,uuid,timestamptz),
 public.place_operational_location_name(uuid,timestamptz),public.place_operational_assert_accepted_names(uuid,date),public.place_operational_assert_unchanged_draft(uuid)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.custodial_place_operational_preview(uuid,uuid,date,bigint,jsonb,text),public.custodial_place_operational_begin(uuid,uuid,uuid),
 public.custodial_place_operational_status(uuid,uuid),public.custodial_place_operational_finalize(uuid,uuid,uuid,uuid) to static_weekly_control_plane;
-- The existing security-invoker dashboard requires this one scalar display
-- helper; it reveals no private ledger, manager or source document.
grant execute on function public.place_operational_location_name(uuid,timestamptz) to custodial_application_reader,service_role;

do $recovery$ declare obj record;ord integer;changed integer;begin
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition from pg_proc p where pronamespace='public'::regnamespace and
   (proname like 'place_operational_%' or proname like 'custodial_place_operational_%' or oid in(
    'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)'::regprocedure,
    'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)'::regprocedure,
    'public.tool_get_offline_scan_authority_snapshot(text,text,text)'::regprocedure,'public.get_location_scan_state(text,text)'::regprocedure))
  union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) from pg_proc p where pronamespace='public'::regnamespace and
   (proname like 'place_operational_%' or proname like 'custodial_place_operational_%')
  union all select x.* from unnest(array['public.custodial_place_operational_previews','public.custodial_place_operational_commands','public.custodial_place_operational_receipts']) rel cross join lateral (
   select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
   union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname) from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
   union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
   union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
   union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rel::regclass
   union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
   union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';' from pg_trigger where tgrelid=rel::regclass and not tgisinternal
   union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x
  union all select 800000,'view','public.v_location_dashboard_status',public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status')
 ) objects order by bucket,case when identity like '%place_operational_preview_document(%' then 0 else 1 end,identity loop
  if obj.definition is null then raise exception 'Missing Place recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp() where object_kind=obj.kind and object_identity=obj.identity;
  get diagnostics changed=row_count;if changed>1 then raise exception 'Duplicate Place recovery identity';end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,(case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if ord is null then raise exception 'Recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
