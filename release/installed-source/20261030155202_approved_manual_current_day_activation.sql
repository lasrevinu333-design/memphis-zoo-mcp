-- Admit the unchanged seven owner-approved days on the current service date.
-- Historical sources and publications retain their original effective ranges.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function public.static_weekly_source_window_start(p_source jsonb,p_date date)
returns date language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare version jsonb;start date;
begin
 version:=coalesce(p_source->'version',p_source#>'{versions,0}');
 if version#>>'{manualGroupRatingAuthority,manifestSha256}'='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f' then
  start:=(version->>'effectiveStart')::date;
  if start is null or p_date is null or not isfinite(start) or not isfinite(p_date) or p_date<start then
   raise exception using errcode='23514',message='manual weekly window requires its exact effective source date';end if;
  return p_date-mod(p_date-start,7);
 end if;
 return p_date-(extract(isodow from p_date)::integer-1);
end $fn$;
revoke all on function public.static_weekly_source_window_start(jsonb,date) from public,anon,authenticated,service_role;

create function public.static_weekly_projection_window_start(p_date date)
returns date language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare manifest text;origin date;
begin
 if p_date is null or not isfinite(p_date) then raise exception using errcode='22023',message='exact projection service date required';end if;
 -- Read scalar metadata only. Native occurrence guards call this repeatedly;
 -- retaining the complete source JSON in their nested contexts is unbounded.
 select s.canonical_source#>>'{version,manualGroupRatingAuthority,manifestSha256}',v.effective_start into manifest,origin
 from public.weekly_schedule_versions v
 join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
 where v.version_id=public.static_weekly_effective_version(p_date);
 if manifest='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f' then return p_date-mod(p_date-origin,7);end if;
 return p_date-(extract(isodow from p_date)::integer-1);
end $fn$;
revoke all on function public.static_weekly_projection_window_start(date) from public,anon,authenticated,service_role;

alter table public.static_weekly_approved_initial_baselines
 drop constraint static_weekly_approved_initial_baselines_effective_start_check;
alter table public.static_weekly_approved_initial_baselines
 add constraint static_weekly_approved_initial_baselines_effective_start_check check(
 isfinite(effective_start) and (extract(isodow from effective_start)=1 or (
  feasibility#>>'{candidateSource,version,manualGroupRatingAuthority,manifestSha256}'='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
  and feasibility#>>'{candidateSource,version,effectiveStart}'=effective_start::text
  and feasibility#>>'{initialBaseline,projection,week_start}'=effective_start::text
  and feasibility#>>'{initialBaseline,projection,week_end}'=(effective_start+6)::text
  and feasibility#>'{mapping,scopeDays}'='[0,1,2,3,4,5,6]'::jsonb) is true));

do $frames$
declare obj record;body text;needle text;replacement text;before_acl text;before_owner oid;
begin
 for obj in select * from (values
  ('public.static_weekly_v3_read_manager_snapshot_base(date)','27e5fec3c6a01f6fe677f39cfa82e0b2','manager'),
  ('public.static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamp with time zone)','cdb3c0a8aa5f0ab0b0cd7b99f2cf80bf','employee'),
  ('public.static_weekly_v6_schedule_authority_state_dated_base(date)','3401a88124adaa75ca33753573082525','authority'),
  ('public.static_weekly_v4_hydrate_compiler_source(jsonb,date)','4129d532e90f3ca150f7cb83e0ebfc0e','hydrate'),
  ('public.static_weekly_v3_read_manager_snapshot(date)','4035f279b1572a537d0149bb9d4e2f4d','current_manager')
 ) items(identity,expected_md5,kind) loop
  body:=pg_get_functiondef(to_regprocedure(obj.identity));
  if md5(body) is distinct from obj.expected_md5 then raise exception 'manual current-day predecessor differs: %',obj.identity;end if;
  before_acl:=public.custodial_release_authority_current_grant_definition(obj.identity);
  select proowner into strict before_owner from pg_proc where oid=to_regprocedure(obj.identity);
  case obj.kind
  when 'manager' then
   needle:=$old$if p_week_start is null or extract(isodow from p_week_start)<>1 then$old$;
   replacement:=$new$if p_week_start is null or not isfinite(p_week_start) or p_week_start<>public.static_weekly_projection_window_start(p_week_start) then$new$;
  when 'employee' then
   needle:=$old$v_week_start:=p_service_date-(extract(isodow from p_service_date)::integer-1);$old$;
   replacement:=$new$v_week_start:=public.static_weekly_projection_window_start(p_service_date);$new$;
  when 'authority' then
   needle:=$old$v_week_start := p_service_date - (extract(isodow from p_service_date)::integer - 1);$old$;
   replacement:=$new$v_week_start := public.static_weekly_projection_window_start(p_service_date);$new$;
  when 'hydrate' then
   needle:=$old$v_week_start:=p_service_date-(extract(isodow from p_service_date)::integer-1);$old$;
   replacement:=$new$v_week_start:=public.static_weekly_source_window_start(p_source,p_service_date);$new$;
  when 'current_manager' then
   needle:=$old$  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_staffing_base(p_week_start);$old$;
   replacement:=$new$  -- A calendar-week request containing NOW follows its actual active
  -- publication. Historical requests keep their own effective publication.
  p_week_start:=public.static_weekly_projection_window_start(case
   when public.sch_service_date(statement_timestamp()) between p_week_start and p_week_start+6
   then public.sch_service_date(statement_timestamp()) else p_week_start end);
  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_staffing_base(p_week_start);$new$;
  end case;
  if length(body)-length(replace(body,needle,''))<>length(needle) then raise exception 'manual window seam missing: %',obj.identity;end if;
  execute replace(body,needle,replacement);
  if public.custodial_release_authority_current_grant_definition(obj.identity) is distinct from before_acl
   or (select proowner from pg_proc where oid=to_regprocedure(obj.identity)) is distinct from before_owner then
   raise exception 'manual window changed existing function owner or ACL';end if;
 end loop;
end $frames$;

-- Reuse the complete normal initial-baseline validator/storage in the atomic
-- activation command. The shared implementation has no callable runtime grant.
do $shared_initial$
declare body text;private_body text;
begin
 body:=pg_get_functiondef('public.static_weekly_register_approved_initial_baseline(uuid,text,jsonb)'::regprocedure);
 if md5(body)<>'853d7be9884087bbdfa2c1e79fa2f5bb' then raise exception 'manual baseline validator predecessor differs';end if;
 private_body:=replace(body,'public.static_weekly_register_approved_initial_baseline(',
  'public.static_weekly_manual_store_initial_baseline(');
 if length(private_body)-length(replace(private_body,' perform public.static_weekly_v3_assert_release_operator();',''))
   <>length(' perform public.static_weekly_v3_assert_release_operator();') then raise exception 'manual baseline validator guard seam differs';end if;
 private_body:=replace(private_body,$old$p_feasibility-'digest'-'initialBaseline'$old$,$new$p_feasibility-array['digest','initialBaseline']$new$);
 execute replace(private_body,' perform public.static_weekly_v3_assert_release_operator();','');
end $shared_initial$;
revoke all on function public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create or replace function public.static_weekly_register_approved_initial_baseline(p_source_id uuid,p_template_id text,p_feasibility jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 perform public.static_weekly_v3_assert_release_operator();
 return public.static_weekly_manual_store_initial_baseline(p_source_id,p_template_id,p_feasibility);
end $fn$;

-- Preserve every original full/compact identity check while bounding the
-- lifetime of large temporary JSON values. The immutable snapshot remains in
-- its table; the outer publisher keeps only components still needed.
do $bounded_initial$
declare identity text:='public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)';
 body text;needle text;replacement text;before_acl text;before_owner oid;seam record;
begin
 body:=pg_get_functiondef(to_regprocedure(identity));
 if md5(body)<>'1f1a0054f96b74b9fa157f719fe29110' then raise exception 'bounded initial publisher predecessor differs';end if;
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 select proowner into strict before_owner from pg_proc where oid=to_regprocedure(identity);
 for seam in select * from (values
 ($old$ document jsonb;projection jsonb;draft jsonb;published jsonb;materialized jsonb;lunch jsonb;receipt jsonb;provenance jsonb;$old$,
  $new$ document jsonb;projection jsonb;draft jsonb;published jsonb;materialized jsonb;lunch jsonb;receipt jsonb;provenance jsonb;
 lunch_document jsonb;feasibility_digest text;reference_mode boolean:=false;$new$),
 ($old$  or p_envelope->'feasibility' is distinct from baseline.feasibility
  or p_envelope->>'previewDigest' is distinct from public.static_weekly_digest_jsonb(p_envelope-'request'-'previewDigest')
$old$,$new$$new$),
 ($old$ if p_envelope->>'schema' is distinct from 'custodial.approved-static-initial-materialization.v1'$old$,
  $new$ if p_envelope->>'schema'='custodial.approved-static-initial-materialization.reference.v1' then
  perform public.static_weekly_assert_exact_object(p_envelope,
   array['schema','managerId','sourceId','effectiveStart','expectedRevision','generation','templateCatalogDigest','feasibilityDigest','baselineSnapshotDigest','previewDigest','request'],
   array['schema','managerId','sourceId','effectiveStart','expectedRevision','generation','templateCatalogDigest','feasibilityDigest','baselineSnapshotDigest','previewDigest','request'],
   'manual initial snapshot reference');
  if baseline.feasibility#>>'{candidateSource,version,manualGroupRatingAuthority,manifestSha256}' is distinct from 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
   or p_envelope->>'feasibilityDigest' is distinct from baseline.feasibility->>'digest'
   or p_envelope->>'baselineSnapshotDigest' is distinct from baseline.snapshot_digest then
   raise exception using errcode='23514',message='manual initial snapshot reference changed';end if;
  -- The basis has independently rehashed the complete immutable snapshot and
  -- checked its fresh source/catalog. Bind that exact snapshot by its full
  -- identity instead of allocating a second full feasibility envelope.
  if p_envelope->>'previewDigest' is distinct from public.static_weekly_digest_jsonb(p_envelope-array['request','previewDigest']) then
   raise exception using errcode='23514',message='manual initial snapshot reference preview changed';end if;
  reference_mode:=true;
 end if;
 if (not reference_mode and p_envelope->>'schema' is distinct from 'custodial.approved-static-initial-materialization.v1')$new$),
 ($old$ document:=baseline.feasibility#>'{initialBaseline,document}';projection:=baseline.feasibility#>'{initialBaseline,projection}';$old$,
  $new$ -- Release each hash/equality temporary before constructing another.
 if not reference_mode then
  if p_envelope->'feasibility' is distinct from baseline.feasibility then
   raise exception using errcode='23514',message='initial baseline fixed snapshot changed';end if;
  if p_envelope->>'previewDigest' is distinct from public.static_weekly_digest_jsonb(p_envelope-array['request','previewDigest']) then
   raise exception using errcode='23514',message='initial baseline full preview identity changed';end if;
 end if;
 p_envelope:=p_envelope-'feasibility';basis:=null;
 document:=baseline.feasibility#>'{initialBaseline,document}';projection:=baseline.feasibility#>'{initialBaseline,projection}';
 lunch_document:=baseline.feasibility->'lunchDocument';feasibility_digest:=baseline.feasibility->>'digest';
 baseline.feasibility:=null;$new$),
 ($old$ v_version_id:=(draft#>>'{data,version_id}')::uuid;revision:=(draft->>'revision')::bigint;$old$,
  $new$ document:=null;
 v_version_id:=(draft#>>'{data,version_id}')::uuid;revision:=(draft->>'revision')::bigint;$new$),
 ($old$ v_projection_id:=(materialized#>>'{data,projection_id}')::uuid;revision:=(materialized->>'revision')::bigint;
 lunch:=public.static_weekly_v8_materialize_lunch_document(v_projection_id,baseline.feasibility->'lunchDocument',p_manager_id);$old$,
  $new$ projection:=null;
 v_projection_id:=(materialized#>>'{data,projection_id}')::uuid;revision:=(materialized->>'revision')::bigint;
 lunch:=public.static_weekly_v8_materialize_lunch_document(v_projection_id,lunch_document,p_manager_id);$new$),
 ($old$'feasibility_digest',baseline.feasibility->>'digest'$old$,$new$'feasibility_digest',feasibility_digest$new$)
 ) items(needle,replacement) loop
  if length(body)-length(replace(body,seam.needle,''))<>length(seam.needle) then raise exception 'bounded initial publisher seam differs';end if;
  body:=replace(body,seam.needle,seam.replacement);
 end loop;
 execute body;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl
  or (select proowner from pg_proc where oid=to_regprocedure(identity)) is distinct from before_owner then
  raise exception 'bounded initial publisher changed owner or ACL';end if;
end $bounded_initial$;

create function public.static_weekly_manual_roster_snapshot(p_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare parent jsonb;roster jsonb;people jsonb;revision bigint;
begin
 if p_date is distinct from public.sch_service_date(statement_timestamp()) then
  raise exception using errcode='23514',message='manual activation uses the current operational date';end if;
 select c.current_revision into strict revision from public.static_weekly_schedule_control c where c.singleton;
 select jsonb_build_object('publicationId',p.publication_id,'versionId',p.version_id,
  'sourceId',v.authority_source_id,'effectiveStart',p.effective_start::text) into parent
 from public.weekly_schedule_publications p join public.weekly_schedule_versions v using(version_id)
 where v.version_id=public.static_weekly_effective_version(p_date);
 if parent is null or parent->>'sourceId' is null then
  raise exception using errcode='23514',message='manual activation must retain an exact existing publication and source';end if;
 select coalesce(jsonb_agg(jsonb_build_object('slotId',s.slot_id,'slotCode',s.slot_code,'label',s.slot_label,
  'incumbencies',coalesce((select jsonb_agg(jsonb_build_object('incumbencyId',r.incumbency_id,
   'personId',r.person_id,'displayName',r.person_name_snapshot,'effectiveStart',r.effective_start::text,
   'effectiveEnd',case when r.effective_end is null then null else r.effective_end::text end)
   order by r.effective_start,r.incumbency_id) from public.v_weekly_roster_slot_incumbency_ranges r
   where r.slot_id=s.slot_id),'[]'::jsonb)) order by s.slot_id),'[]'::jsonb) into roster
 from public.weekly_roster_slots s;
 select coalesce(jsonb_agg(jsonb_build_object('employeeId',e.id,'displayName',e.display_name,
  'employeeCode',e.employee_code,'active',e.active,'hasMessenger',exists(select 1 from public.msg_users m where m.employee_id=e.id and m.is_active=true and coalesce(m.active,m.is_active)=true))
  order by e.id),'[]'::jsonb) into people from public.employees e where e.id=any(array[
   'cd97111e-cfa0-4228-b4d7-401bc7a5ac13','3da709bb-2223-4e15-8e3a-db02e3f32e97',
   '30ec85e0-a579-45a8-9c27-c164e77a9190','77d50e9a-6338-43b1-aed5-9f47d7129466',
   '8067cca2-7487-4589-ba7c-aa442e135045','d5fecc86-659b-464a-bc99-f0d914385db4',
   '06228c5d-5123-4b8b-b730-e01114bdc971','1318b295-fd70-4e78-8828-62c29302f96f']::uuid[]);
 return jsonb_build_object('schema','custodial.manual-live-roster-readback.v1','serviceDate',p_date::text,
  'authorityRevision',revision,'parentPublication',parent,'rosterSlots',roster,'employees',people);
end $fn$;
revoke all on function public.static_weekly_manual_roster_snapshot(date)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create function public.static_weekly_read_manual_activation_roster(p_manager uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 return public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
end $fn$;
revoke all on function public.static_weekly_read_manual_activation_roster(uuid)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_read_manual_activation_roster(uuid) to static_weekly_control_plane;

create function public.static_weekly_assert_manual_roster_transition(p_transition jsonb,p_snapshot jsonb,p_config jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare target jsonb;slot jsonb;person jsonb;current_rows jsonb;current_person jsonb;change jsonb;
 at date;expected_transfers integer:=0;expected_unchanged integer:=0;matches integer;
begin
 at:=(p_snapshot->>'serviceDate')::date;
 if p_transition->>'schema' is distinct from 'custodial.approved-manual-roster-transition.v1'
  or p_transition->>'status' is distinct from 'PREPARED_NOT_ADMITTED'
  or p_transition->>'serviceDate' is distinct from at::text
  or p_transition->'expectedRevision' is distinct from p_snapshot->'authorityRevision'
  or p_transition->'parentPublication' is distinct from p_snapshot->'parentPublication'
  or p_transition->>'readbackDigest' is distinct from public.static_weekly_digest_jsonb(p_snapshot)
  or p_transition->>'transitionDigest' is distinct from public.static_weekly_digest_jsonb(p_transition-'transitionDigest')
  or p_transition->>'manualDataDigest' is distinct from 'eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8'
  or p_transition->'liveSlotCount' is distinct from to_jsonb(jsonb_array_length(p_snapshot->'rosterSlots'))
  or (select count(*) from jsonb_each(p_config->'slots') s where s.value->'vacancy'='false'::jsonb)<>8
  or jsonb_array_length(p_snapshot->'employees')<>8 then
  raise exception using errcode='40001',message='manual activation roster, source, date, parent or revision changed';end if;
 for target in select value from jsonb_each(p_config->'slots') where value->'vacancy'='false'::jsonb loop
  select value into strict person from jsonb_array_elements(p_snapshot->'employees') where value->>'employeeId'=target->>'personId';
  select value into strict slot from jsonb_array_elements(p_snapshot->'rosterSlots') where value->>'slotId'=target->>'slotId';
  if person->'active' is distinct from 'true'::jsonb or person->'hasMessenger' is distinct from 'true'::jsonb
   or person->>'displayName' is distinct from target->>'name' or coalesce(person->>'employeeCode','')!~'^EMP[0-9]+$'
   or exists(select 1 from jsonb_array_elements(p_snapshot->'rosterSlots') s
    cross join lateral jsonb_array_elements(s->'incumbencies') r where s->>'slotId'<>target->>'slotId'
     and r->>'personId'=target->>'personId' and (r->>'effectiveEnd' is null or at<(r->>'effectiveEnd')::date)) then
   raise exception using errcode='23514',message='manual activation requires the exact existing active employee, Messenger and stable position';end if;
  select coalesce(jsonb_agg(r),'[]'::jsonb) into current_rows from jsonb_array_elements(slot->'incumbencies') r
   where (r->>'effectiveStart')::date<=at and (r->>'effectiveEnd' is null or at<(r->>'effectiveEnd')::date);
  if jsonb_array_length(current_rows)>1 then raise exception 'overlapping current roster authority';end if;
  current_person:=current_rows->0;
  if current_person->>'personId'=target->>'personId' then
   expected_unchanged:=expected_unchanged+1;
   select count(*) into matches from jsonb_array_elements(p_transition->'unchanged') r
    where r=jsonb_build_object('slotId',target->>'slotId','employeeId',target->>'personId','incumbencyId',current_person->>'incumbencyId');
   if matches<>1 or exists(select 1 from jsonb_array_elements(slot->'incumbencies') r where (r->>'effectiveStart')::date>at) then
    raise exception 'unchanged manual roster identity changed';end if;
  else
   expected_transfers:=expected_transfers+1;
   if exists(select 1 from jsonb_array_elements(slot->'incumbencies') r where (r->>'effectiveStart')::date>=at) then
    raise exception 'manual activation cannot replace a current-day or future incumbency';end if;
   select value into strict change from jsonb_array_elements(p_transition->'transfers') r
    where r->>'slotId'=target->>'slotId' and r->>'employeeId'=target->>'personId';
   if change->>'employeeName' is distinct from person->>'displayName' or change->>'slotLabel' is distinct from slot->>'label'
    or change->>'effectiveStart' is distinct from at::text
    or change->>'expectedLiveRangeDigest' is distinct from public.static_weekly_digest_jsonb(slot)
    or change->'newEmployeeCreated' is distinct from 'false'::jsonb or change->'messengerPrincipalCreated' is distinct from 'false'::jsonb
    or change->'phoneAssignment' is distinct from 'null'::jsonb then raise exception 'manual roster transfer binding changed';end if;
   if current_person is null then
    if change->>'operation' is distinct from 'ASSIGN_EXISTING_EMPLOYEE_TO_EMPTY_SLOT' or change->'closure' is distinct from 'null'::jsonb then
     raise exception 'empty manual position cannot invent former history';end if;
   elsif change->>'operation' is distinct from 'REASSIGN_EXISTING_EMPLOYEE'
    or change->'closure' is distinct from jsonb_build_object('incumbencyId',current_person->>'incumbencyId',
     'personId',current_person->>'personId','displayName',current_person->>'displayName','effectiveStart',current_person->>'effectiveStart',
     'previousEffectiveEnd',current_person->'effectiveEnd','closeAt',at::text) then
    raise exception 'manual transfer requires the exact append-only predecessor closure';
   end if;
  end if;
 end loop;
 if jsonb_array_length(p_transition->'transfers')<>expected_transfers or jsonb_array_length(p_transition->'unchanged')<>expected_unchanged then
  raise exception 'manual transition has extra or missing roster operations';end if;
end $fn$;
revoke all on function public.static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create table public.static_weekly_manual_activation_packets(
 packet_id uuid primary key,source_id uuid not null unique references public.static_weekly_authority_source_documents(source_id),
 template_id text not null references public.static_weekly_approved_template_catalog(template_id),
 service_date date not null,manager_id uuid not null references public.ops_manager_managers(manager_id),
 transition_json jsonb not null,feasibility_json jsonb not null,packet_digest text not null check(packet_digest~'^[0-9a-f]{64}$'),
 registered_at timestamptz not null default statement_timestamp()
);
create table public.static_weekly_manual_activation_confirmations(
 manager_id uuid not null references public.ops_manager_managers(manager_id),idempotency_key text not null,
 packet_id uuid not null references public.static_weekly_manual_activation_packets(packet_id),
 request_json jsonb not null,receipt_json jsonb not null,receipt_digest text not null check(receipt_digest~'^[0-9a-f]{64}$'),
 primary key(manager_id,idempotency_key),check(length(btrim(idempotency_key)) between 1 and 120)
);
do $private_activation$
declare rel text;
begin
 foreach rel in array array['static_weekly_manual_activation_packets','static_weekly_manual_activation_confirmations'] loop
  execute format('alter table public.%I enable row level security',rel);
  execute format('alter table public.%I force row level security',rel);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader',rel);
  execute format('create trigger manual_activation_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',rel);
 end loop;
end $private_activation$;

create function public.static_weekly_register_manual_activation_packet(p_packet uuid,p_source uuid,p_template text,p_manager uuid,p_transition jsonb,p_feasibility jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare snapshot jsonb;entry public.static_weekly_approved_template_catalog%rowtype;source jsonb;body jsonb;
begin
 perform public.static_weekly_v3_assert_release_operator();perform public.static_weekly_v3_manager_actor(p_manager);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 select * into strict entry from public.static_weekly_approved_template_catalog where template_id=p_template;
 select canonical_source into strict source from public.static_weekly_authority_source_documents where source_id=p_source and active and retired_at is null;
 perform public.static_weekly_assert_manual_roster_transition(p_transition,snapshot,entry.owner_config);
 if p_feasibility->>'schema' is distinct from 'custodial.approved-static-feasibility.v1'
  or p_feasibility->'candidateSource' is distinct from source or entry.template_json->'source' is distinct from source
  or p_feasibility#>>'{mapping,templateId}' is distinct from p_template
  or p_feasibility#>'{mapping,unchanged}' is distinct from 'true'::jsonb
  or source#>>'{version,manualGroupRatingAuthority,manifestSha256}' is distinct from 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
  or entry.binding_json->>'artifactSha256' is distinct from '3942a5d77774a3dcc8a8ab3e572d02716efaae3428a015f076bdbd8c5e1ec2dd'
  or source->>'serviceDate' is distinct from snapshot->>'serviceDate'
  or source#>>'{version,effectiveStart}' is distinct from snapshot->>'serviceDate'
  or p_feasibility#>>'{initialBaseline,projection,week_end}' is distinct from ((snapshot->>'serviceDate')::date+6)::text then
  raise exception using errcode='23514',message='manual activation requires the exact admitted unchanged seven-day source and current-date feasibility';end if;
 body:=jsonb_build_object('packetDigest',public.static_weekly_manual_activation_packet_fingerprint(p_source,p_template,p_manager,p_transition,p_feasibility));
 insert into public.static_weekly_manual_activation_packets(packet_id,source_id,template_id,service_date,manager_id,transition_json,feasibility_json,packet_digest)
 values(p_packet,p_source,p_template,(snapshot->>'serviceDate')::date,p_manager,p_transition,p_feasibility,body->>'packetDigest');
 return jsonb_build_object('registered',true,'packetId',p_packet,'packetDigest',body->>'packetDigest','published',false);
end $fn$;
revoke all on function public.static_weekly_register_manual_activation_packet(uuid,uuid,text,uuid,jsonb,jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;
grant execute on function public.static_weekly_register_manual_activation_packet(uuid,uuid,text,uuid,jsonb,jsonb) to static_weekly_release_operator;

create function public.static_weekly_read_manual_activation_basis(p_manager uuid,p_packet uuid,p_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare packet public.static_weekly_manual_activation_packets%rowtype;entry public.static_weekly_approved_template_catalog%rowtype;
 snapshot jsonb;body jsonb;generation bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;
 select * into strict entry from public.static_weekly_approved_template_catalog where template_id=packet.template_id;
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 if packet.manager_id is distinct from p_manager or packet.service_date::text is distinct from snapshot->>'serviceDate'
  or p_revision::text is distinct from snapshot->>'authorityRevision'
  or exists(select 1 from public.static_weekly_approved_template_retirements where template_id=packet.template_id)
  or packet.packet_digest is distinct from public.static_weekly_manual_activation_packet_fingerprint(
   packet.source_id,packet.template_id,packet.manager_id,packet.transition_json,packet.feasibility_json) then
  raise exception using errcode='40001',message='manual activation packet, manager, service date or revision changed';end if;
 perform public.static_weekly_assert_manual_roster_transition(packet.transition_json,snapshot,entry.owner_config);
 generation:=public.static_weekly_v15_read_recurring_generation();
 body:=jsonb_build_object('schema','custodial.approved-manual-activation-preview-basis.v1','managerId',p_manager,
  'packetId',p_packet,'packetDigest',packet.packet_digest,'sourceId',packet.source_id,'templateId',packet.template_id,
  'serviceDate',packet.service_date::text,'windowEnd',(packet.service_date+6)::text,'expectedRevision',p_revision,
  'generation',generation,'readbackDigest',public.static_weekly_digest_jsonb(snapshot),
  'feasibilityDigest',packet.feasibility_json->>'digest');
 return body||jsonb_build_object('previewDigest',public.static_weekly_digest_jsonb(body),
  'assignments',packet.feasibility_json->'assignments','lunch',packet.feasibility_json->'lunchDocument',
  'transfers',packet.transition_json->'transfers','unchanged',packet.transition_json->'unchanged',
  'parentPublication',snapshot->'parentPublication');
end $fn$;
revoke all on function public.static_weekly_read_manual_activation_basis(uuid,uuid,bigint)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_read_manual_activation_basis(uuid,uuid,bigint) to static_weekly_control_plane;

-- Distinct audit operation; do not forge old individual roster receipts or
-- treat this atomic source cutover as a request to create replacement people.
do $operation$
declare c record;definition text;
begin
 select conname,pg_get_constraintdef(oid) as definition into strict c from pg_constraint
 where conrelid='public.weekly_schedule_authority_revisions'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%operation%';
 definition:=substring(c.definition from 8 for length(c.definition)-8);
 execute format('alter table public.weekly_schedule_authority_revisions drop constraint %I',c.conname);
 execute format('alter table public.weekly_schedule_authority_revisions add constraint %I check((%s) or operation=%L)',
  c.conname,definition,'activate_approved_manual_roster');
end $operation$;

create function public.static_weekly_read_manual_activation_confirmation(p_manager uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare prior public.static_weekly_manual_activation_confirmations%rowtype;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 select * into prior from public.static_weekly_manual_activation_confirmations where manager_id=p_manager and idempotency_key=p_key;
 if not found then return null;end if;
 if prior.receipt_digest is distinct from public.static_weekly_digest_jsonb(prior.receipt_json) then raise exception 'manual activation receipt integrity failed';end if;
 return jsonb_build_object('request',prior.request_json,'receipt',prior.receipt_json);
end $fn$;
revoke all on function public.static_weekly_read_manual_activation_confirmation(uuid,text)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_read_manual_activation_confirmation(uuid,text) to static_weekly_control_plane;

create function public.static_weekly_activate_approved_manual_schedule(p_manager uuid,p_packet uuid,p_revision bigint,p_preview text,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare packet record;prior public.static_weekly_manual_activation_confirmations%rowtype;
 actor jsonb;basis jsonb;request jsonb;change jsonb;revision bigint:=p_revision;incumbency uuid;command uuid;
 content text;initial_body jsonb;published jsonb;receipt jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if p_key is null or length(btrim(p_key)) not between 1 and 120 or p_preview!~'^[0-9a-f]{64}$' then
  raise exception using errcode='23514',message='manual activation requires exact preview and bounded original idempotency key';end if;
 request:=jsonb_build_object('managerId',p_manager,'packetId',p_packet,'expectedRevision',p_revision,'previewDigest',p_preview,'idempotencyKey',p_key);
 select * into prior from public.static_weekly_manual_activation_confirmations where manager_id=p_manager and idempotency_key=p_key;
 if found then
  if prior.request_json is distinct from request or prior.receipt_digest is distinct from public.static_weekly_digest_jsonb(prior.receipt_json) then
   raise exception using errcode='23505',message='manual activation original identity conflict';end if;
  return prior.receipt_json;
 end if;
 basis:=public.static_weekly_read_manual_activation_basis(p_manager,p_packet,p_revision);
 if basis->>'previewDigest' is distinct from p_preview then raise exception using errcode='40001',message='manual activation preview changed';end if;
 -- Keep only the small command facts in the outer atomic operation. Large
 -- immutable feasibility components are read by short-lived private helpers.
 select source_id,template_id,service_date,transition_json->'transfers' as transfers
  into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet;
 for change in select value from jsonb_array_elements(packet.transfers) loop
  command:=gen_random_uuid();incumbency:=gen_random_uuid();
  content:=public.static_weekly_digest_jsonb(jsonb_build_object('packetId',p_packet,'transfer',change));
  revision:=public.static_weekly_advance_authority(revision,'activate_approved_manual_roster',p_manager,actor->>'manager_name',command,content);
  insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,
   created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  values(incumbency,(change->>'slotId')::uuid,(change->>'employeeId')::uuid,change->>'employeeName',packet.service_date,
   p_manager,actor->>'manager_name',content);
  if change->'closure'<>'null'::jsonb then
   insert into public.weekly_roster_slot_incumbency_closures(closed_incumbency_id,replacement_incumbency_id,
    closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest)
   values((change#>>'{closure,incumbencyId}')::uuid,incumbency,packet.service_date,revision,p_manager,actor->>'manager_name',content);
  end if;
  insert into public.weekly_roster_slot_staffing_states(slot_id,employee_id,staffing_state,effective_start,
   authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
  values((change->>'slotId')::uuid,(change->>'employeeId')::uuid,'working',packet.service_date,
   revision,p_manager,actor->>'manager_name','Owner-approved manual schedule activation; existing employee identity preserved',content);
 end loop;
 -- The shared NORMAL validator now checks the real post-transfer hydrated
 -- source. A failure rolls back every new range, closure and state above.
 perform public.static_weekly_manual_activation_store_baseline(p_packet);
 initial_body:=public.static_weekly_manual_activation_initial_envelope(p_manager,p_packet,revision,p_key||':initial');
 published:=public.static_weekly_materialize_approved_initial_baseline(p_manager,packet.source_id,packet.service_date,revision,
  (initial_body->>'generation')::bigint,p_key||':initial',initial_body);
 if published->'ok' is distinct from 'true'::jsonb or published->>'persistence_status' is distinct from 'PERSISTED'
  or published->>'source_id' is distinct from packet.source_id::text then raise exception 'manual activation normal publication was not persisted';end if;
 receipt:=published||jsonb_build_object('schema','custodial.approved-manual-activation-confirmation.v1','status','PERSISTED_CURRENT',
  'packetId',p_packet,'previewDigest',p_preview,'serviceDate',packet.service_date::text,'windowEnd',(packet.service_date+6)::text,
  'rosterTransfers',jsonb_array_length(packet.transfers),'historyPreserved',true,'newEmployeesCreated',false,
  'messengerPrincipalsCreated',false,'solverInvoked',false,'weeklyBaselineChanged',false,'atomicRosterAndPublication',true);
 insert into public.static_weekly_manual_activation_confirmations(manager_id,idempotency_key,packet_id,request_json,receipt_json,receipt_digest)
 values(p_manager,p_key,p_packet,request,receipt,public.static_weekly_digest_jsonb(receipt));
 return receipt;
end $fn$;
revoke all on function public.static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text) to static_weekly_control_plane;

-- Each helper owns its temporary feasibility copies. None is directly
-- executable by a runtime, manager or release role. The atomic command has
-- already validated the packet under the shared authority lock.
create function public.static_weekly_manual_activation_store_baseline(p_packet uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare packet public.static_weekly_manual_activation_packets%rowtype;
begin
 select * into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet;
 perform public.static_weekly_manual_store_initial_baseline(packet.source_id,packet.template_id,packet.feasibility_json);
end $fn$;
revoke all on function public.static_weekly_manual_activation_store_baseline(uuid)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create function public.static_weekly_manual_activation_initial_envelope(p_manager uuid,p_packet uuid,p_revision bigint,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare packet record;basis jsonb;body jsonb;preview text;request jsonb;
begin
 select p.source_id,p.template_id,p.service_date,p.feasibility_json->>'digest' as feasibility_digest,b.snapshot_digest
  into strict packet from public.static_weekly_manual_activation_packets p
  join public.static_weekly_approved_initial_baselines b on b.source_id=p.source_id where p.packet_id=p_packet;
 basis:=public.static_weekly_read_approved_initial_basis(p_manager,packet.source_id,packet.service_date,p_revision,packet.template_id);
 body:=jsonb_build_object('schema','custodial.approved-static-initial-materialization.reference.v1','managerId',p_manager,
  'sourceId',packet.source_id,'effectiveStart',packet.service_date::text,'expectedRevision',p_revision,
  'generation',basis->'generation','templateCatalogDigest',basis->>'templateCatalogDigest',
  'feasibilityDigest',packet.feasibility_digest,'baselineSnapshotDigest',packet.snapshot_digest);
 -- Every original field remains bound. The full immutable baseline identity
 -- includes the initial document/projection/lunch as well as the feasibility
 -- body; the normal publisher rehashes and checks the same admitted snapshot.
 preview:=public.static_weekly_digest_jsonb(body);
 request:=jsonb_build_object('sourceId',packet.source_id,'effectiveStart',packet.service_date::text,'templateId',packet.template_id,
  'expectedRevision',p_revision,'previewDigest',preview,'idempotencyKey',p_key);
 return body||jsonb_build_object('previewDigest',preview,'request',request);
end $fn$;
revoke all on function public.static_weekly_manual_activation_initial_envelope(uuid,uuid,bigint,text)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

-- Preserve the existing disaster-recovery inventory and extend its explicit
-- dependency roots for this capability. No recovery guard is left disabled.
create function public.static_weekly_manual_activation_packet_fingerprint(p_source uuid,p_template text,p_manager uuid,p_transition jsonb,p_feasibility jsonb)
returns text language plpgsql set search_path=pg_catalog,public as $fn$
declare document jsonb;projection jsonb;lunch jsonb;metadata jsonb;
begin
 -- Hash the independently verifiable components without constructing another
 -- full copy of the large feasibility envelope. Their identities cover every
 -- feasibility field, including the separately materialized initial snapshot.
 document:=p_feasibility#>'{initialBaseline,document}';projection:=p_feasibility#>'{initialBaseline,projection}';
 lunch:=p_feasibility->'lunchDocument';metadata:=(p_feasibility->'initialBaseline')-array['document','projection','lunchDocument'];
 -- Separate statements release each large temporary hash input before the
 -- next component. Removing keys in one operation avoids a full intermediate
 -- copy of the thirteen-megabyte envelope for each deleted key.
 if p_feasibility->>'digest' is distinct from public.static_weekly_digest_jsonb(p_feasibility-array['digest','initialBaseline']) then
  raise exception using errcode='23514',message='manual activation feasibility identity changed';end if;
 if document#>>'{validation,database_document_identity}' is distinct from public.static_weekly_digest_jsonb(document#-'{validation,database_document_identity}') then
  raise exception using errcode='23514',message='manual activation document identity changed';end if;
 if projection->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(projection-'database_projection_identity') then
  raise exception using errcode='23514',message='manual activation projection identity changed';end if;
 if lunch->>'document_identity' is distinct from public.static_weekly_digest_jsonb(lunch-'document_identity') then
  raise exception using errcode='23514',message='manual activation lunch identity changed';end if;
 if p_feasibility#>'{initialBaseline,lunchDocument}' is distinct from lunch then
  raise exception using errcode='23514',message='manual activation initial lunch identity changed';end if;
 return public.static_weekly_digest_jsonb(jsonb_build_object('sourceId',p_source,'templateId',p_template,'managerId',p_manager,
  'transitionDigest',p_transition->>'transitionDigest','feasibilityDigest',p_feasibility->>'digest',
  'documentIdentity',document#>>'{validation,database_document_identity}',
  'projectionIdentity',projection->>'database_projection_identity','lunchIdentity',lunch->>'document_identity','initialMetadata',metadata));
end $fn$;
revoke all on function public.static_weekly_manual_activation_packet_fingerprint(uuid,text,uuid,jsonb,jsonb)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
do $owners$
declare sig text;owner text;
begin
 -- Match the existing business routines' migration owner. Supabase's fresh
 -- fixture uses supabase_admin; the production migration connection is
 -- postgres. Hard-coding one would break access to FORCE-RLS predecessor data.
 select pg_get_userbyid(proowner) into strict owner from pg_proc
  where oid='public.static_weekly_register_approved_initial_baseline(uuid,text,jsonb)'::regprocedure;
 if owner not in('postgres','supabase_admin') then raise exception 'unknown manual activation migration owner';end if;
 foreach sig in array array[
  'public.static_weekly_source_window_start(jsonb,date)','public.static_weekly_projection_window_start(date)',
  'public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)','public.static_weekly_manual_roster_snapshot(date)',
  'public.static_weekly_read_manual_activation_roster(uuid)','public.static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)',
  'public.static_weekly_register_manual_activation_packet(uuid,uuid,text,uuid,jsonb,jsonb)',
  'public.static_weekly_manual_activation_packet_fingerprint(uuid,text,uuid,jsonb,jsonb)',
  'public.static_weekly_manual_activation_store_baseline(uuid)',
  'public.static_weekly_manual_activation_initial_envelope(uuid,uuid,bigint,text)',
  'public.static_weekly_read_manual_activation_basis(uuid,uuid,bigint)','public.static_weekly_read_manual_activation_confirmation(uuid,text)',
  'public.static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)'] loop
  execute format('alter function %s owner to %I',sig,owner);
 end loop;
 execute format('alter table public.static_weekly_manual_activation_packets owner to %I',owner);
 execute format('alter table public.static_weekly_manual_activation_confirmations owner to %I',owner);
end $owners$;
revoke all on function public.static_weekly_source_window_start(jsonb,date),public.static_weekly_projection_window_start(date)
 from static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
select custodial_dr.install_application_mutation_fences();
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temp table manual_activation_new_recovery(bucket integer,kind text,identity text,definition text,primary key(kind,identity)) on commit drop;
do $recovery$
declare rel text;rid oid;sig text;obj record;surface text;roots text;next_order integer;definition text;changed integer;
begin
 foreach rel in array array['public.static_weekly_manual_activation_packets','public.static_weekly_manual_activation_confirmations'] loop
  rid:=rel::regclass;
  insert into manual_activation_new_recovery values
   (1000,'relation',rel,public.custodial_release_authority_current_relation_definition(rel)),
   (300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)),
   (400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)),
   (900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel));
  insert into manual_activation_new_recovery select 200000,'column',rel||':'||attname,
   public.custodial_release_authority_current_column_definition(rel||':'||attname)
   from pg_attribute where attrelid=rid and attnum>0 and not attisdropped;
  insert into manual_activation_new_recovery select 500000,'constraint',rel||':'||conname,
   public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rid;
  insert into manual_activation_new_recovery select 600000,'index',indexrelid::regclass::text,
   public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i
   where indrelid=rid and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid);
  insert into manual_activation_new_recovery select 700000,'trigger',rel||'.'||quote_ident(tgname),
   'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' '
    ||case tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
    ||' trigger '||quote_ident(tgname)||';' from pg_trigger where tgrelid=rid and not tgisinternal;
 end loop;
 foreach sig in array array[
  'public.static_weekly_source_window_start(jsonb,date)',
  'public.static_weekly_projection_window_start(date)',
  'public.static_weekly_manual_store_initial_baseline(uuid,text,jsonb)',
  'public.static_weekly_manual_roster_snapshot(date)',
  'public.static_weekly_read_manual_activation_roster(uuid)',
  'public.static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)',
  'public.static_weekly_register_manual_activation_packet(uuid,uuid,text,uuid,jsonb,jsonb)',
  'public.static_weekly_manual_activation_packet_fingerprint(uuid,text,uuid,jsonb,jsonb)',
  'public.static_weekly_manual_activation_store_baseline(uuid)',
  'public.static_weekly_manual_activation_initial_envelope(uuid,uuid,bigint,text)',
  'public.static_weekly_read_manual_activation_basis(uuid,uuid,bigint)',
  'public.static_weekly_read_manual_activation_confirmation(uuid,text)',
  'public.static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)'
 ] loop
  insert into manual_activation_new_recovery values
   (100000,'function',sig::regprocedure::text,pg_get_functiondef(sig::regprocedure)),
   (1000000,'grant',sig::regprocedure::text,public.custodial_release_authority_current_grant_definition(sig::regprocedure::text));
 end loop;
 -- Some legacy reader aliases were created by renaming a captured routine.
 -- Enroll only these exact, hash-checked dependencies if the old inventory
 -- lacks their alias identity. Existing rows are updated below, never replaced.
 foreach sig in array array[
  'public.static_weekly_v3_read_manager_snapshot_base(date)',
  'public.static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamp with time zone)',
  'public.static_weekly_v6_schedule_authority_state_dated_base(date)',
  'public.static_weekly_v4_hydrate_compiler_source(jsonb,date)',
  'public.static_weekly_v3_read_manager_snapshot(date)',
  'public.static_weekly_register_approved_initial_baseline(uuid,text,jsonb)',
  'public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)'
 ] loop
  select count(*) into changed from public.custodial_release_authority_restore_inventory
   where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure(sig);
  if changed>1 then raise exception 'manual recovery dependency identity duplicated: %',sig;end if;
  if changed=0 then
   insert into manual_activation_new_recovery values(100000,'function',sig::regprocedure::text,pg_get_functiondef(sig::regprocedure));
   if not exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity in(sig,sig::regprocedure::text)) then
    insert into manual_activation_new_recovery values(1000000,'grant',sig::regprocedure::text,public.custodial_release_authority_current_grant_definition(sig::regprocedure::text));
   end if;
  end if;
 end loop;
 for obj in select 'public.'||quote_ident(r.relname)||':'||c.conname as identity from pg_constraint c join pg_class r on r.oid=c.conrelid
  where (c.conrelid='public.static_weekly_approved_initial_baselines'::regclass and c.conname='static_weekly_approved_initial_baselines_effective_start_check')
   or (c.conrelid='public.weekly_schedule_authority_revisions'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%operation%') loop
  if not exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind='constraint' and object_identity=obj.identity) then
   insert into manual_activation_new_recovery values(500000,'constraint',obj.identity,public.custodial_release_authority_current_constraint_definition(obj.identity));
  end if;
 end loop;
 if exists(select 1 from manual_activation_new_recovery n where n.definition is null or n.definition='')
  or exists(select 1 from manual_activation_new_recovery n join public.custodial_release_authority_restore_inventory i
   on i.object_kind=n.kind and i.object_identity=n.identity) then raise exception 'manual activation recovery membership differs';end if;
 surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(surface)-length(replace(surface,'  values',''))<>length('  values') then raise exception 'manual activation canary root seam differs';end if;
 select string_agg(format('(%L,%L,%L),',kind,identity,'approved current-day activation; seven immutable normal days'),E'\n ' order by bucket,kind,identity)
  into roots from manual_activation_new_recovery where kind in('relation','column_set','relation_state','function','constraint','grant');
 execute replace(surface,'  values','  values'||E'\n '||roots);
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from manual_activation_new_recovery order by bucket,kind,identity loop
  select n into next_order from generate_series(obj.bucket+1,case when obj.bucket=1000 then 99999 else obj.bucket+99999 end) n
   where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=n) order by n limit 1;
  if next_order is null then raise exception 'manual activation recovery bucket exhausted';end if;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 end loop;
 foreach sig in array array[
  'public.static_weekly_v3_read_manager_snapshot_base(date)',
  'public.static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamp with time zone)',
  'public.static_weekly_v6_schedule_authority_state_dated_base(date)',
  'public.static_weekly_v4_hydrate_compiler_source(jsonb,date)',
  'public.static_weekly_v3_read_manager_snapshot(date)',
  'public.static_weekly_register_approved_initial_baseline(uuid,text,jsonb)',
  'public.static_weekly_materialize_approved_initial_baseline(uuid,uuid,date,bigint,bigint,text,jsonb)',
  'public.custodial_release_canary_authority_surface()'
 ] loop
  definition:=pg_get_functiondef(to_regprocedure(sig));
  update public.custodial_release_authority_restore_inventory set definition_sql=definition,
   definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
   where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure(sig);
  get diagnostics changed=row_count;if changed<>1 then raise exception 'manual activation recovery function is missing or duplicated: %',sig;end if;
 end loop;
 for obj in select 'public.'||quote_ident(r.relname)||':'||c.conname as identity from pg_constraint c join pg_class r on r.oid=c.conrelid
  where (c.conrelid='public.static_weekly_approved_initial_baselines'::regclass and c.conname='static_weekly_approved_initial_baselines_effective_start_check')
   or (c.conrelid='public.weekly_schedule_authority_revisions'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%operation%') loop
  definition:=public.custodial_release_authority_current_constraint_definition(obj.identity);
  update public.custodial_release_authority_restore_inventory set definition_sql=definition,
   definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
   where object_kind='constraint' and object_identity=obj.identity;
  get diagnostics changed=row_count;if changed<>1 then raise exception 'manual activation recovery constraint is missing or duplicated: %',obj.identity;end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
