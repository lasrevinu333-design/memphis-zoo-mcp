begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $preflight$ begin
 if to_regclass('public.location_groups') is null
  or to_regclass('public.location_group_memberships') is null
  or to_regclass('public.weekly_schedule_publications') is null
  or to_regclass('public.weekly_schedule_exception_commands') is null
  or to_regclass('public.weekly_schedule_occurrences') is null
  or to_regclass('public.static_weekly_staffing_commands') is null
  or to_regprocedure('public.place_source_row(text,uuid)') is null then
  raise exception 'SCH022 source authority prerequisites unavailable';
 end if;
end $preflight$;

-- SCH-022 is prospective scheduling eligibility, not a Place/tag activation,
-- an Event venue alias, or a reinterpretation of accepted historic work.
-- The accepted owner date is the last Monday of May 2027: 2027-05-31.
create function public.static_weekly_sch022_work_witness(p_service_date date,p_work jsonb)
returns text language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare g public.location_groups%rowtype;w jsonb;included jsonb;id_text text;
 target boolean:=false; unbound_target boolean:=false; member_ids uuid[]; included_ids uuid[]:=array[]::uuid[];
 row_ids uuid[];row_target boolean;
 source_rows jsonb;v_head jsonb;result text;
begin
 if p_service_date is null or jsonb_typeof(p_work) is distinct from 'array'
  or jsonb_array_length(p_work)>10000 then
  raise exception using errcode='22023',message='SCH022 requires bounded typed work and an exact service date';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 lock table public.location_groups,public.location_group_memberships,public.locations,
  public.custodial_place_source_versions in share mode;
 -- The group code is the only name authority. Never match Event SPLASH_PAD,
 -- free-text names, notes, or arbitrary JSON fields.
 select * into g from public.location_groups where group_code='SPLASH_PAD_RESTROOMS' for share;
 select coalesce(array_agg(distinct m.location_id order by m.location_id),array[]::uuid[])
 into member_ids from public.location_group_memberships m
 where m.location_group_id=g.id and m.active=true;
 for w in select value from jsonb_array_elements(p_work) loop
  if jsonb_typeof(w) is distinct from 'object'
   or (select array_agg(key order by key) from jsonb_object_keys(w) key)
      is distinct from array['includedLocationIds','locationCode','locationId']::text[]
   or jsonb_typeof(w->'locationCode') is distinct from 'string'
   or jsonb_typeof(w->'includedLocationIds') is distinct from 'array'
   or jsonb_array_length(w->'includedLocationIds')>256 then
   raise exception using errcode='22023',message='SCH022 typed work identity is invalid';
  end if;
  included:=w->'includedLocationIds';
  row_ids:=array[]::uuid[];
  if jsonb_typeof(w->'locationId') not in ('string','null') then
   raise exception using errcode='22023',message='SCH022 typed work location identity is invalid';
  end if;
  if w->>'locationId' is not null then
   begin row_ids:=array_append(row_ids,(w->>'locationId')::uuid);
   exception when invalid_text_representation then
    raise exception using errcode='22023',message='SCH022 typed work location UUID is invalid';end;
  end if;
  for id_text in select value from jsonb_array_elements_text(included) value loop
   begin row_ids:=array_append(row_ids,id_text::uuid);
   exception when invalid_text_representation then
    raise exception using errcode='22023',message='SCH022 included location UUID is invalid';end;
  end loop;
  row_target:=w->>'locationCode'='SPLASH_PAD_RESTROOMS' or (g.id is not null and
   exists(select 1 from unnest(row_ids) member(member_id)
    where member.member_id=g.id or member.member_id=any(member_ids)));
  if row_target then
   target:=true;included_ids:=included_ids||row_ids;
   if not exists(select 1 from unnest(row_ids) member(member_id)
    where member.member_id=any(member_ids)) then unbound_target:=true;end if;
  end if;
 end loop;
 if not target then return public.static_weekly_digest_jsonb(jsonb_build_object('sch022','NO_TARGET_V1'));end if;
 if g.id is null or g.active is not true then
  raise exception using errcode='23514',message='Splash Pad Restrooms duty requires the exact active custodial group';
 end if;
 if p_service_date<date '2027-05-31' then
  raise exception using errcode='23514',message='Splash Pad Restrooms coverage is inactive before Memorial Day 2027';
 end if;
 if cardinality(member_ids)=0 or unbound_target or exists(select 1 from unnest(included_ids) member(member_id)
  where member.member_id<>g.id and member.member_id<>all(member_ids)) then
  raise exception using errcode='23514',message='Splash Pad Restrooms duty must bind current exact group members';
 end if;
 if exists(select 1 from unnest(member_ids) member(member_id) left join public.locations l on l.id=member.member_id
  where l.id is null or l.active is not true) then
  raise exception using errcode='23514',message='Splash Pad Restrooms has an inactive or unbound physical member';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'source',public.place_source_row('physical_location',l.id),
  'source_updated_at',l.updated_at,
  'place_head',(select jsonb_build_object('revision',v.revision,'effective_at',v.effective_at,'source_row_sha256',v.source_row_sha256)
   from public.custodial_place_source_versions v where v.legacy_kind='physical_location' and v.legacy_id=l.id
   order by v.revision desc limit 1)) order by l.id),'[]'::jsonb)
 into source_rows from public.locations l where l.id=any(member_ids);
 select jsonb_build_object('revision',v.revision,'effective_at',v.effective_at,'source_row_sha256',v.source_row_sha256)
 into v_head from public.custodial_place_source_versions v
 where v.legacy_kind='location_group' and v.legacy_id=g.id order by v.revision desc limit 1;
 result:=public.static_weekly_digest_jsonb(jsonb_build_object('sch022','TARGET_V1','group_id',g.id,
  'group_source',public.place_source_row('location_group',g.id),'group_place_head',v_head,
  'membership_revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'location_id',m.location_id,
   'active',m.active,'updated_at',m.updated_at) order by m.id),'[]'::jsonb)
   from public.location_group_memberships m where m.location_group_id=g.id),
  'members',source_rows,'start',date '2027-05-31'));
 return result;
end $fn$;

revoke all on function public.static_weekly_sch022_work_witness(date,jsonb)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;
grant execute on function public.static_weekly_sch022_work_witness(date,jsonb) to static_weekly_control_plane;

-- Existing named-manager control-plane sessions call this only after their
-- current publication/source read. It is a witness, never a duty grant.
create function public.static_weekly_sch022_preview_witness(p_service_date date,p_work jsonb,p_manager_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 return public.static_weekly_sch022_work_witness(p_service_date,p_work);
end $fn$;
revoke all on function public.static_weekly_sch022_preview_witness(date,jsonb,uuid)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;
grant execute on function public.static_weekly_sch022_preview_witness(date,jsonb,uuid) to static_weekly_control_plane;

create function public.static_weekly_sch022_normalize_work(p_location_id uuid,p_code text,p_included jsonb)
returns jsonb language plpgsql immutable security definer set search_path=pg_catalog,public as $fn$
declare ids jsonb;entry jsonb;
begin
 if p_code is null or btrim(p_code)='' or p_included is null then
  raise exception using errcode='23514',message='SCH022 typed work has no exact location identity';end if;
 if jsonb_typeof(p_included)<>'array' or jsonb_array_length(p_included)>256 then
  raise exception using errcode='23514',message='SCH022 included location identities are invalid';end if;
 ids:='[]'::jsonb;
 for entry in select value from jsonb_array_elements(p_included) loop
  if jsonb_typeof(entry)='object' and jsonb_typeof(entry->'locationId')='string' then
   ids:=ids||jsonb_build_array(entry->>'locationId');
  elsif jsonb_typeof(entry)='string' then ids:=ids||jsonb_build_array(entry#>>'{}');
  else raise exception using errcode='23514',message='SCH022 included location identity is invalid';end if;
 end loop;
 return jsonb_build_object('locationId',p_location_id,'locationCode',p_code,'includedLocationIds',ids);
end $fn$;
revoke all on function public.static_weekly_sch022_normalize_work(uuid,text,jsonb)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;

create function public.static_weekly_sch022_publication_gate() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare work jsonb;
begin
 select coalesce(jsonb_agg(public.static_weekly_sch022_normalize_work(a.location_id,a.location_code_snapshot,
  coalesce(a.authority_facts_json->'included_locations',a.payload_json#>'{authority_facts,included_locations}','[]'::jsonb))
  order by a.assignment_id),'[]'::jsonb) into work
 from public.weekly_schedule_slot_assignments a where a.version_id=new.version_id;
 perform public.static_weekly_sch022_work_witness(new.effective_start,work);
 return new;
end $fn$;
create trigger trg_static_weekly_sch022_publication_gate before insert on public.weekly_schedule_publications
 for each row execute function public.static_weekly_sch022_publication_gate();

create function public.static_weekly_sch022_exception_gate() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare work jsonb;
begin
 if new.exception_type='event_impact' then
  select coalesce(jsonb_agg(public.static_weekly_sch022_normalize_work(
   nullif(item->>'locationId','')::uuid,item->>'locationCodeSnapshot',
   coalesce(item->'includedLocations','[]'::jsonb))),'[]'::jsonb) into work
  from (select value item from jsonb_array_elements(new.payload_json->'patchWork')
   union all select value from jsonb_array_elements(new.payload_json->'addWork')) source;
  perform public.static_weekly_sch022_work_witness(new.service_date,work);
 end if;
 return new;
end $fn$;
create trigger trg_static_weekly_sch022_exception_gate before insert on public.weekly_schedule_exception_commands
 for each row execute function public.static_weekly_sch022_exception_gate();

create function public.static_weekly_sch022_occurrence_gate() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 perform public.static_weekly_sch022_work_witness(new.service_date,jsonb_build_array(
  public.static_weekly_sch022_normalize_work(new.location_id,new.location_code_snapshot,
   coalesce(new.authority_facts_json#>'{work_snapshot,includedLocations}','[]'::jsonb))));
 return new;
end $fn$;
create trigger trg_static_weekly_sch022_occurrence_gate before insert on public.weekly_schedule_occurrences
 for each row execute function public.static_weekly_sch022_occurrence_gate();

revoke all on function public.static_weekly_sch022_publication_gate(),
 public.static_weekly_sch022_exception_gate(),public.static_weekly_sch022_occurrence_gate()
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;

-- The staffing writer may reuse an older compiled projection without
-- inserting new occurrences. Bind all staged projection weeks to the same
-- catalog witness shown in the named-manager preview, then enforce it at the
-- final PREPARED -> ACCEPTED transition (inside v11's transaction).
create function public.static_weekly_sch022_projection_work(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare assignments jsonb;work jsonb;
begin
 assignments:=p_payload#>'{envelope,assignments}';
 if jsonb_typeof(assignments)<>'array' or jsonb_array_length(assignments)>10000 then
  raise exception using errcode='23514',message='SCH022 staged projection assignments unavailable';end if;
 if exists(select 1 from jsonb_array_elements(assignments) item
  where jsonb_typeof(item->'work_snapshot')<>'object') then
  raise exception using errcode='23514',message='SCH022 staged projection work identity unavailable';end if;
 select coalesce(jsonb_agg(public.static_weekly_sch022_normalize_work(
  nullif(item#>>'{work_snapshot,locationId}','')::uuid,item#>>'{work_snapshot,locationCodeSnapshot}',
  coalesce(item#>'{work_snapshot,includedLocations}','[]'::jsonb)) order by item->>'work_id'),'[]'::jsonb)
 into work from jsonb_array_elements(assignments) item;
 return work;
end $fn$;

create function public.static_weekly_sch022_candidate_witness(p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare candidate jsonb;one text;records jsonb:='[]'::jsonb;target_count integer:=0;
 no_target text:=public.static_weekly_digest_jsonb(jsonb_build_object('sch022','NO_TARGET_V1'));
begin
 if jsonb_typeof(p_candidates)<>'array' or jsonb_array_length(p_candidates)>100000 then
  raise exception using errcode='22023',message='SCH022 requires bounded staffing candidates';end if;
 for candidate in select value from jsonb_array_elements(p_candidates) value
  where value->>'candidateKind'='projection' order by value->>'serviceDate',value->>'candidateKey' loop
  if candidate->>'serviceDate'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   raise exception using errcode='22023',message='SCH022 staffing candidate week is invalid';end if;
  one:=public.static_weekly_sch022_work_witness((candidate->>'serviceDate')::date,
   public.static_weekly_sch022_projection_work(candidate->'payload'));
  if one<>no_target then target_count:=target_count+1;end if;
  records:=records||jsonb_build_array(jsonb_build_object('week_start',candidate->>'serviceDate','catalog_witness',one));
 end loop;
 return jsonb_build_object('digest',public.static_weekly_digest_jsonb(records),'target_week_count',target_count);
end $fn$;

create function public.static_weekly_sch022_preview_staffing_witness(p_candidates jsonb,p_manager_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 return public.static_weekly_sch022_candidate_witness(p_candidates);
end $fn$;

create table public.static_weekly_sch022_staffing_witnesses(
 operation_id uuid primary key references public.static_weekly_staffing_commands(operation_id) on delete restrict,
 manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 witness_digest text not null check(witness_digest~'^[0-9a-f]{64}$'),
 target_week_count integer not null check(target_week_count between 0 and 54),
 preview_digest text not null check(preview_digest~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default statement_timestamp()
);
alter table public.static_weekly_sch022_staffing_witnesses enable row level security;
alter table public.static_weekly_sch022_staffing_witnesses force row level security;
revoke all on table public.static_weekly_sch022_staffing_witnesses
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;
create trigger trg_static_weekly_sch022_staffing_witness_immutable before update or delete
 on public.static_weekly_sch022_staffing_witnesses for each row execute function public.static_weekly_reject_update_delete();

create function public.static_weekly_sch022_staged_witness(p_operation_id uuid)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.static_weekly_sch022_candidate_witness(coalesce(jsonb_agg(jsonb_build_object(
  'candidateKind',candidate_kind,'candidateKey',candidate_key,'serviceDate',service_date::text,
  'payload',payload_json) order by service_date,candidate_key),'[]'::jsonb))
 from public.static_weekly_staffing_staged_candidates
 where operation_id=p_operation_id and candidate_kind='projection'
$fn$;

create function public.static_weekly_sch022_stage_staffing_command(
 p_operation_id uuid,p_candidates jsonb,p_preview_digest text,p_input_digest text,
 p_publication_vector jsonb,p_manager_id uuid,p_witness_digest text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare before_state text;staged jsonb;current_witness jsonb;prior public.static_weekly_sch022_staffing_witnesses%rowtype;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 if p_witness_digest is null or p_witness_digest!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='SCH022 exact staffing preview witness required';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select state into before_state from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 staged:=public.static_weekly_v10_stage_staffing_command(p_operation_id,p_candidates,p_preview_digest,
  p_input_digest,p_publication_vector,p_manager_id);
 current_witness:=public.static_weekly_sch022_staged_witness(p_operation_id);
 if current_witness->>'digest' is distinct from p_witness_digest then
  raise exception using errcode='40001',message='SCH022 staffing catalog changed since manager preview';end if;
 select * into prior from public.static_weekly_sch022_staffing_witnesses where operation_id=p_operation_id;
 if found then
  if prior.manager_id is distinct from p_manager_id or prior.witness_digest is distinct from p_witness_digest
   or prior.preview_digest is distinct from p_preview_digest then
   raise exception using errcode='23505',message='SCH022 staffing witness replay identity changed';end if;
 elsif before_state='PREPARING' then
  insert into public.static_weekly_sch022_staffing_witnesses(operation_id,manager_id,witness_digest,target_week_count,preview_digest)
  values(p_operation_id,p_manager_id,p_witness_digest,(current_witness->>'target_week_count')::integer,p_preview_digest);
 elsif (current_witness->>'target_week_count')::integer>0 then
  raise exception using errcode='23514',message='SCH022 protected target-bearing staffing preview has no original witness';
 end if;
 return staged;
end $fn$;

create function public.static_weekly_sch022_staffing_accept_gate() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare current_witness jsonb;prior public.static_weekly_sch022_staffing_witnesses%rowtype;
begin
 if old.state='PREPARED' and new.state='ACCEPTED' then
  current_witness:=public.static_weekly_sch022_staged_witness(new.operation_id);
  select * into prior from public.static_weekly_sch022_staffing_witnesses where operation_id=new.operation_id;
  if found then
   if prior.witness_digest is distinct from current_witness->>'digest'
    or prior.target_week_count is distinct from (current_witness->>'target_week_count')::integer
    or prior.manager_id is distinct from new.confirmed_by_manager_id
    or prior.preview_digest is distinct from new.preview_digest then
    raise exception using errcode='40001',message='SCH022 staffing confirmation requires a current exact catalog preview';end if;
  elsif (current_witness->>'target_week_count')::integer>0 then
   raise exception using errcode='23514',message='SCH022 target-bearing staffing confirmation has no prepared catalog witness';
  end if;
 end if;
 return new;
end $fn$;
create trigger trg_static_weekly_sch022_staffing_accept_gate before update on public.static_weekly_staffing_commands
 for each row execute function public.static_weekly_sch022_staffing_accept_gate();

revoke all on function public.static_weekly_sch022_projection_work(jsonb),
 public.static_weekly_sch022_candidate_witness(jsonb),public.static_weekly_sch022_preview_staffing_witness(jsonb,uuid),
 public.static_weekly_sch022_staged_witness(uuid),
 public.static_weekly_sch022_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid,text),
 public.static_weekly_sch022_staffing_accept_gate()
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;
grant execute on function public.static_weekly_sch022_preview_staffing_witness(jsonb,uuid),
 public.static_weekly_sch022_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid,text)
 to static_weekly_control_plane;

do $recovery$ declare obj record;ord integer;changed integer;begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
  raise exception 'SCH022 recovery inventory immutability unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'static_weekly_sch022_%'
  union all select 900000,'grant',p.oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'static_weekly_sch022_%'
  union all select x.* from (values('public.static_weekly_sch022_staffing_witnesses')) tables(rel)
   cross join lateral (
    select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
    union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
     from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
    union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
    union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
    union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
     from pg_constraint where conrelid=rel::regclass
    union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
     from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
    union all select 700000,'trigger',rel||'.'||tgname,
     'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';'
     from pg_trigger where tgrelid=rel::regclass and not tgisinternal
    union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
   ) x
  union all select 700000,'trigger','public.'||c.relname||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on public.'||quote_ident(c.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table public.'||quote_ident(c.relname)||' enable trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where t.tgname like 'trg_static_weekly_sch022_%' and t.tgrelid in(
    'public.weekly_schedule_publications'::regclass,'public.weekly_schedule_exception_commands'::regclass,
    'public.weekly_schedule_occurrences'::regclass,'public.static_weekly_staffing_commands'::regclass)
 ) objects order by bucket,identity loop
  if obj.definition is null then raise exception 'SCH022 recovery object absent: %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    (obj.kind in('function','grant') and obj.identity like '%(%' and object_identity like '%(%'
      and to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'SCH022 duplicate recovery object %',obj.identity;end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,
    (case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
    order by n limit 1;
   if ord is null then raise exception 'SCH022 recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;

commit;
