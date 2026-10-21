begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- SCH-022 forward correction: a retained, now-inactive member is still
-- recognizably Splash work. Current *active* membership remains required for
-- any new coverage. Do not turn a formerly accepted target into NO_TARGET.
create or replace function public.static_weekly_sch022_work_witness(p_service_date date,p_work jsonb)
returns text language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare g public.location_groups%rowtype;w jsonb;included jsonb;id_text text;
 target boolean:=false; unbound_target boolean:=false; member_ids uuid[];retained_ids uuid[];
 included_ids uuid[]:=array[]::uuid[];row_ids uuid[];row_target boolean;
 source_rows jsonb;v_head jsonb;result text;
begin
 if p_service_date is null or jsonb_typeof(p_work) is distinct from 'array'
  or jsonb_array_length(p_work)>10000 then
  raise exception using errcode='22023',message='SCH022 requires bounded typed work and an exact service date';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 lock table public.location_groups,public.location_group_memberships,public.locations,
  public.custodial_place_source_versions in share mode;
 select * into g from public.location_groups where group_code='SPLASH_PAD_RESTROOMS' for share;
 select coalesce(array_agg(distinct m.location_id order by m.location_id) filter(where m.active=true),array[]::uuid[]),
  coalesce(array_agg(distinct m.location_id order by m.location_id),array[]::uuid[])
 into member_ids,retained_ids from public.location_group_memberships m where m.location_group_id=g.id;
 for w in select value from jsonb_array_elements(p_work) loop
  if jsonb_typeof(w) is distinct from 'object'
   or (select array_agg(key order by key) from jsonb_object_keys(w) key)
      is distinct from array['includedLocationIds','locationCode','locationId']::text[]
   or jsonb_typeof(w->'locationCode') is distinct from 'string'
   or jsonb_typeof(w->'includedLocationIds') is distinct from 'array'
   or jsonb_array_length(w->'includedLocationIds')>256 then
   raise exception using errcode='22023',message='SCH022 typed work identity is invalid';
  end if;
  included:=w->'includedLocationIds';row_ids:=array[]::uuid[];
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
    where member.member_id=g.id or member.member_id=any(retained_ids)));
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

-- Only immutable published work and accepted dated event work count. A raw
-- name, note, draft or merely previewed candidate never protects a member.
create function public.static_weekly_sch022_retained_member_referenced(p_member_id uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select exists(
  select 1 from public.weekly_schedule_slot_assignments a
  join public.weekly_schedule_publications p on p.version_id=a.version_id
  where a.location_id=p_member_id or exists(
   select 1 from jsonb_array_elements(case when jsonb_typeof(a.authority_facts_json->'included_locations')='array'
    then a.authority_facts_json->'included_locations' else '[]'::jsonb end) item
   where item->>'locationId'=p_member_id::text)
 ) or exists(
  select 1 from public.weekly_schedule_exception_commands e
  cross join lateral jsonb_array_elements(case when e.exception_type='event_impact'
   and jsonb_typeof(e.payload_json->'addWork')='array' then e.payload_json->'addWork' else '[]'::jsonb end) item
  where item->>'locationId'=p_member_id::text or exists(
   select 1 from jsonb_array_elements(case when jsonb_typeof(item->'includedLocations')='array'
    then item->'includedLocations' else '[]'::jsonb end) included
   where included->>'locationId'=p_member_id::text)
 ) or exists(
  select 1 from public.weekly_schedule_exception_commands e
  cross join lateral jsonb_array_elements(case when e.exception_type='event_impact'
   and jsonb_typeof(e.payload_json->'patchWork')='array' then e.payload_json->'patchWork' else '[]'::jsonb end) item
  where item->>'locationId'=p_member_id::text or exists(
   select 1 from jsonb_array_elements(case when jsonb_typeof(item->'includedLocations')='array'
    then item->'includedLocations' else '[]'::jsonb end) included
   where included->>'locationId'=p_member_id::text)
 )
$fn$;

create function public.static_weekly_sch022_membership_identity_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare identity_changed boolean;
begin
 if tg_op='DELETE' then identity_changed:=true;
 else identity_changed:=new.location_group_id is distinct from old.location_group_id
   or new.location_id is distinct from old.location_id;end if;
 if identity_changed
  and exists(select 1 from public.location_groups g where g.id=old.location_group_id
   and g.group_code='SPLASH_PAD_RESTROOMS')
  and public.static_weekly_sch022_retained_member_referenced(old.location_id) then
  raise exception using errcode='23514',message='SCH022 accepted Splash member provenance cannot be deleted or reassigned';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $fn$;
create trigger trg_static_weekly_sch022_membership_identity_guard before update or delete
 on public.location_group_memberships for each row execute function public.static_weekly_sch022_membership_identity_guard();

create function public.static_weekly_sch022_group_identity_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare identity_changed boolean;
begin
 if tg_op='DELETE' then identity_changed:=true;
 else identity_changed:=new.id is distinct from old.id or new.group_code is distinct from old.group_code;end if;
 if old.group_code='SPLASH_PAD_RESTROOMS'
  and identity_changed
  and exists(select 1 from public.location_group_memberships m where m.location_group_id=old.id
   and public.static_weekly_sch022_retained_member_referenced(m.location_id)) then
  raise exception using errcode='23514',message='SCH022 accepted Splash group identity cannot be deleted or renamed';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $fn$;
create trigger trg_static_weekly_sch022_group_identity_guard before update or delete
 on public.location_groups for each row execute function public.static_weekly_sch022_group_identity_guard();

revoke all on function public.static_weekly_sch022_retained_member_referenced(uuid),
 public.static_weekly_sch022_membership_identity_guard(),public.static_weekly_sch022_group_identity_guard()
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;
revoke all on function public.static_weekly_sch022_work_witness(date,jsonb)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator,static_weekly_control_plane;
grant execute on function public.static_weekly_sch022_work_witness(date,jsonb) to static_weekly_control_plane;

do $recovery$ declare obj record;ord integer;changed integer;begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
  raise exception 'SCH022 source-retention recovery inventory immutability unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in(
    'static_weekly_sch022_work_witness','static_weekly_sch022_retained_member_referenced',
    'static_weekly_sch022_membership_identity_guard','static_weekly_sch022_group_identity_guard')
  union all select 900000,'grant',p.oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in(
    'static_weekly_sch022_work_witness','static_weekly_sch022_retained_member_referenced',
    'static_weekly_sch022_membership_identity_guard','static_weekly_sch022_group_identity_guard')
  union all select 700000,'trigger','public.'||c.relname||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on public.'||quote_ident(c.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table public.'||quote_ident(c.relname)||' enable trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where t.tgname in('trg_static_weekly_sch022_membership_identity_guard','trg_static_weekly_sch022_group_identity_guard')
    and t.tgrelid in('public.location_group_memberships'::regclass,'public.location_groups'::regclass)
 ) objects order by bucket,identity loop
  if obj.definition is null then raise exception 'SCH022 source-retention recovery object absent: %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    (obj.kind in('function','grant') and obj.identity like '%(%' and object_identity like '%(%'
      and to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'SCH022 duplicate recovery object %',obj.identity;end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,obj.bucket+99999) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
    order by n limit 1;
   if ord is null then raise exception 'SCH022 source-retention recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;

commit;
