-- Bounded canonical place authority. NO legacy location/tag/schedule cutover.
-- Names and alias history are append-only; imported event wording is not edited.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;
create table public.custodial_places(
 place_id uuid primary key,
 canonical_code text not null unique check(canonical_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
 physical_location_id uuid unique references public.locations(id) on delete restrict,
 created_at timestamptz not null default now()
);
create table public.custodial_place_control(singleton boolean primary key check(singleton));
insert into public.custodial_place_control values(true);
create table public.custodial_place_versions(
 place_id uuid not null references public.custodial_places(place_id) on delete restrict,
 revision integer not null check(revision>0),
 request_id uuid not null unique,
 actor_manager_id uuid references public.ops_manager_managers(manager_id) on delete restrict,
 action text not null,
 reason text not null,
 effective_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 argument_sha256 text not null check(argument_sha256 ~ '^[0-9a-f]{64}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 primary key(place_id,revision)
);
create index custodial_place_versions_time on public.custodial_place_versions(place_id,effective_at desc,revision desc);
create index custodial_place_versions_actor on public.custodial_place_versions(actor_manager_id);
do $acl$
declare t text;
begin
 foreach t in array array['custodial_places','custodial_place_control','custodial_place_versions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',t);
  execute format('create trigger place_lifecycle_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',t);
 end loop;
end;
$acl$;

create function public.place_lifecycle_normalize(p_raw text) returns text
language sql immutable strict set search_path=pg_catalog as $fn$
 select regexp_replace(lower(btrim(p_raw)),'[^[:alnum:]]','','g')
$fn$;

create function public.place_lifecycle_snapshot(p_place uuid,p_at timestamptz) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select snapshot||jsonb_build_object('place_id',place_id,'revision',revision,'effective_at',effective_at)
 from public.custodial_place_versions where place_id=p_place and effective_at<=p_at
 order by effective_at desc,revision desc limit 1
$fn$;

create function public.place_lifecycle_root(p_place uuid,p_at timestamptz) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare id uuid:=p_place; seen uuid[]:='{}'; s jsonb;
begin
 loop
  if id=any(seen) or cardinality(seen)>=32 then raise exception using errcode='23514',message='Place merge cycle'; end if;
  seen:=array_append(seen,id); s:=public.place_lifecycle_snapshot(id,p_at);
  if s is null then return null; end if;
  if s->>'merged_into' is null then return case when s->'active'='true'::jsonb then id else null end; end if;
  id:=(s->>'merged_into')::uuid;
 end loop;
end;
$fn$;

create function public.place_lifecycle_assert_aliases(p_from timestamptz) returns void
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare at_time timestamptz; collision text; id uuid;
begin
 -- Check the whole affected future timeline, not just today's aliases.
 for at_time in select p_from union select effective_at from public.custodial_place_versions where effective_at>=p_from loop
  for id in select place_id from public.custodial_places loop
   perform public.place_lifecycle_root(id,at_time);
  end loop;
  select key into collision from (
   select public.place_lifecycle_normalize(a.value) key,count(distinct public.place_lifecycle_root(p.place_id,at_time)) n
   from public.custodial_places p
   cross join lateral public.place_lifecycle_snapshot(p.place_id,at_time) s
   cross join lateral jsonb_array_elements_text(s->'aliases') a
   where public.place_lifecycle_root(p.place_id,at_time) is not null
   group by public.place_lifecycle_normalize(a.value)
  ) aliases where n>1 limit 1;
  if collision is not null then raise exception using errcode='23514',message='Alias conflicts with another canonical place: '||collision; end if;
 end loop;
end;
$fn$;

create function public.custodial_place_command(p_request uuid,p_manager uuid,p_place uuid,
 p_expected_revision integer,p_action text,p_effective_at timestamptz,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $fn$
declare old public.custodial_place_versions%rowtype; replay public.custodial_place_versions%rowtype;
 state jsonb; args_hash text; at_time timestamptz:=coalesce(p_effective_at,statement_timestamp());
 code text; physical uuid; names jsonb; allowed text[]; item record;
begin
 perform public.custodial_assert_manager(p_manager);
 if p_request is null or p_place is null or p_expected_revision is null or p_expected_revision<0
  or p_action is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
  or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>32768 then
  raise exception using errcode='22023',message='Invalid place command';
 end if;
 allowed:=case p_action when 'add' then array['canonical_code','display_name','aliases','cleaning_mode','event_eligible','physical_location_id']
  when 'rename' then array['display_name'] when 'aliases' then array['aliases']
  when 'deactivate' then array[]::text[] when 'reactivate' then array[]::text[]
  when 'merge' then array['target_place_id'] when 'reclassify' then array['cleaning_mode','event_eligible']
  when 'reverse' then array[]::text[] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then
  raise exception using errcode='22023',message='Unknown place action or fields';
 end if;
 args_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_manager,p_place,p_expected_revision,p_action,p_effective_at,p_payload,p_reason)::text,'UTF8'),'sha256'),'hex');
 perform 1 from public.custodial_place_control where singleton for update;
 select * into replay from public.custodial_place_versions where request_id=p_request;
 if found then
  if replay.argument_sha256<>args_hash then raise exception using errcode='23505',message='Place request identity conflict'; end if;
  return replay.snapshot||jsonb_build_object('place_id',replay.place_id,'revision',replay.revision,
   'effective_at',replay.effective_at,'actor_manager_id',replay.actor_manager_id,'replayed',true);
 end if;
 if at_time<statement_timestamp() then raise exception using errcode='22023',message='Place changes cannot rewrite past effective history'; end if;
 select * into old from public.custodial_place_versions where place_id=p_place order by revision desc limit 1;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception using errcode='40001',message='Place revision changed; preview again'; end if;
 if old.effective_at>at_time then raise exception using errcode='22023',message='Place effective dates must be appended monotonically'; end if;
 if p_action='add' then
  if old.revision is not null or p_expected_revision<>0 then raise exception using errcode='23505',message='Canonical place already exists'; end if;
  code:=p_payload->>'canonical_code'; physical:=(p_payload->>'physical_location_id')::uuid;
  insert into public.custodial_places(place_id,canonical_code,physical_location_id) values(p_place,code,physical);
  state:=jsonb_build_object('display_name',p_payload->>'display_name','aliases',coalesce(p_payload->'aliases','[]'::jsonb),
   'active',true,'cleaning_mode',coalesce(p_payload->>'cleaning_mode','NEVER_CLEAN'),
   'event_eligible',coalesce(p_payload->'event_eligible','false'::jsonb),'merged_into',null);
 else
  if old.revision is null then raise exception using errcode='22023',message='Unknown canonical place'; end if;
  select canonical_code,physical_location_id into code,physical from public.custodial_places where place_id=p_place;
  state:=old.snapshot;
  if state->>'merged_into' is not null and p_action<>'reverse' then raise exception using errcode='23514',message='Reverse the merge before editing its source'; end if;
  case p_action
   when 'rename' then state:=jsonb_set(state,'{display_name}',coalesce(p_payload->'display_name','null'::jsonb));
   when 'aliases' then state:=jsonb_set(state,'{aliases}',coalesce(p_payload->'aliases','null'::jsonb));
   when 'deactivate' then state:=jsonb_set(state,'{active}','false'::jsonb);
   when 'reactivate' then state:=jsonb_set(state,'{active}','true'::jsonb);
   when 'reclassify' then
    if not (p_payload ? 'cleaning_mode' or p_payload ? 'event_eligible') then raise exception 'Classification change required'; end if;
    state:=state||p_payload;
   when 'merge' then
    if physical is not null then raise exception using errcode='55000',message='Physical-place merge needs a verified tag/schedule cutover preview'; end if;
    if (p_payload->>'target_place_id')::uuid=p_place
      or public.place_lifecycle_root((p_payload->>'target_place_id')::uuid,at_time) is null then
     raise exception using errcode='23514',message='Merge requires another active canonical target';
    end if;
    state:=state||jsonb_build_object('active',false,'merged_into',(p_payload->>'target_place_id')::uuid);
   when 'reverse' then
    if old.revision=1 then state:=state||jsonb_build_object('active',false,'merged_into',null);
    else select snapshot into state from public.custodial_place_versions where place_id=p_place and revision=old.revision-1; end if;
   else raise exception 'Unsupported place command';
  end case;
 end if;
 if jsonb_typeof(state->'display_name') is distinct from 'string' or length(btrim(state->>'display_name')) not between 1 and 200
   or public.place_lifecycle_normalize(state->>'display_name')=''
   or jsonb_typeof(state->'aliases') is distinct from 'array' or jsonb_array_length(state->'aliases')>128
   or coalesce(state->>'cleaning_mode','') not in ('SCAN_TRACKED','REMINDER_ONLY','NEVER_CLEAN')
   or jsonb_typeof(state->'event_eligible') is distinct from 'boolean' then
  raise exception using errcode='22023',message='Invalid name, aliases or independent classification';
 end if;
 if exists(select 1 from jsonb_array_elements(state->'aliases') a where jsonb_typeof(a)<>'string'
   or length(btrim(a#>>'{}')) not between 1 and 200 or public.place_lifecycle_normalize(a#>>'{}')='') then
  raise exception using errcode='22023',message='Aliases must be bounded explicit text';
 end if;
 if state->>'cleaning_mode'='SCAN_TRACKED' and physical is null then
  raise exception using errcode='23514',message='SCAN_TRACKED needs an explicitly mapped physical location';
 end if;
 if code='STINGRAYS' and (state->>'cleaning_mode'<>'NEVER_CLEAN' or state->>'event_eligible'<>'true'
   or physical is not null or state->>'merged_into' is not null) then
  raise exception using errcode='23514',message='Stingrays remains event-eligible NEVER_CLEAN';
 end if;
 -- Every name remains an explicit historical alias. No fuzzy match remaps data.
 select jsonb_agg(name order by name) into names from (
  select distinct value name from jsonb_array_elements_text(state->'aliases')
  union select state->>'display_name' union select old.snapshot->>'display_name' where old.snapshot is not null
 ) n where name is not null;
 if jsonb_array_length(names)>128 then raise exception using errcode='22023',message='Aliases including retained names must remain bounded'; end if;
 state:=jsonb_set(state,'{aliases}',names);
 insert into public.custodial_place_versions(place_id,revision,request_id,actor_manager_id,action,reason,effective_at,argument_sha256,snapshot)
  values(p_place,coalesce(old.revision,0)+1,p_request,p_manager,p_action,p_reason,at_time,args_hash,state);
 perform public.place_lifecycle_assert_aliases(at_time);
 return state||jsonb_build_object('place_id',p_place,'revision',coalesce(old.revision,0)+1,'effective_at',at_time,'actor_manager_id',p_manager);
end;
$fn$;

create function public.custodial_place_preview(p_manager uuid,p_at timestamptz default statement_timestamp())
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare places jsonb;
begin
 perform public.custodial_assert_manager(p_manager);
 if p_at is null then raise exception using errcode='22023',message='Place preview time required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('place_id',p.place_id,'canonical_code',p.canonical_code,
  'physical_location_id',p.physical_location_id,'latest_revision',v.revision,
  'latest_effective_at',v.effective_at,'latest_snapshot',v.snapshot,
  'effective_snapshot',public.place_lifecycle_snapshot(p.place_id,p_at)) order by p.canonical_code),'[]'::jsonb)
 into places from public.custodial_places p cross join lateral
  (select revision,effective_at,snapshot from public.custodial_place_versions where place_id=p.place_id order by revision desc limit 1) v;
 return jsonb_build_object('as_of',p_at,'places',places,'legacy_consumer_cutover',false);
end;
$fn$;

create function public.custodial_place_resolve(p_raw text,p_at timestamptz default statement_timestamp())
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare ids uuid[]; id uuid; s jsonb; physical uuid; normalized text;
begin
 if p_raw is null or length(p_raw)>500 or p_at is null then raise exception using errcode='22023',message='Bounded raw location and effective time required'; end if;
 normalized:=public.place_lifecycle_normalize(p_raw);
 select array_agg(distinct public.place_lifecycle_root(p.place_id,p_at)) into ids
 from public.custodial_places p cross join lateral public.place_lifecycle_snapshot(p.place_id,p_at) snapshot
 cross join lateral jsonb_array_elements_text(snapshot->'aliases') alias
 where public.place_lifecycle_root(p.place_id,p_at) is not null and public.place_lifecycle_normalize(alias.value)=normalized;
 if coalesce(cardinality(ids),0)<>1 then
  return jsonb_build_object('raw_location',p_raw,'normalized_alias',normalized,'status','NEEDS_REVIEW',
   'reason',case when coalesce(cardinality(ids),0)>1 then 'ambiguous_alias' else 'unknown_or_inactive_alias' end,
   'event_only',true,'schedule_eligible',false,'staffing_eligible',false,'nfc_eligible',false,'overdue_eligible',false);
 end if;
 id:=ids[1]; s:=public.place_lifecycle_snapshot(id,p_at); select physical_location_id into physical from public.custodial_places where place_id=id;
 return jsonb_build_object('raw_location',p_raw,'normalized_alias',normalized,'status',case when s->'event_eligible'='true'::jsonb then 'RESOLVED' else 'NEEDS_REVIEW' end,
  'place_id',id,'display_name',s->>'display_name','revision',s->'revision','cleaning_mode',s->>'cleaning_mode',
  'event_eligible',s->'event_eligible','event_only',s->'event_eligible'<>'true'::jsonb or s->>'cleaning_mode'='NEVER_CLEAN',
  -- These are safe routing hints for an event-location resolver, not permission
  -- to publish schedules or tag mappings. Needs Review never assigns work.
  'schedule_eligible',s->'event_eligible'='true'::jsonb and s->>'cleaning_mode'<>'NEVER_CLEAN',
  'staffing_eligible',s->'event_eligible'='true'::jsonb and s->>'cleaning_mode'<>'NEVER_CLEAN',
  'nfc_eligible',s->'event_eligible'='true'::jsonb and s->>'cleaning_mode'='SCAN_TRACKED' and physical is not null,
  'overdue_eligible',s->'event_eligible'='true'::jsonb and s->>'cleaning_mode'='SCAN_TRACKED' and physical is not null);
end;
$fn$;

-- Requirement-derived place ID, not a physical tag/location ID. No legacy seed
-- or Courtyard alias is imported, changed, published or made cleanable.
insert into public.custodial_places(place_id,canonical_code) values('9e938c85-26f3-409d-8e92-5f4c54e1b241','STINGRAYS');
insert into public.custodial_place_versions(place_id,revision,request_id,action,reason,effective_at,argument_sha256,snapshot)
 values('9e938c85-26f3-409d-8e92-5f4c54e1b241',1,'5af1d2f0-57ca-4e3c-a7e8-8128700d43d1','owner_requirement_seed',
  'REV3-LOC-006; no physical or Courtyard mapping',statement_timestamp(),repeat('0',64),
  '{"display_name":"Stingrays","aliases":["Stingrays","Sting Rays"],"active":true,"cleaning_mode":"NEVER_CLEAN","event_eligible":true,"merged_into":null}');

revoke all on function public.place_lifecycle_normalize(text),public.place_lifecycle_snapshot(uuid,timestamptz),
 public.place_lifecycle_root(uuid,timestamptz),public.place_lifecycle_assert_aliases(timestamptz),
 public.custodial_place_command(uuid,uuid,uuid,integer,text,timestamptz,jsonb,text),public.custodial_place_preview(uuid,timestamptz),public.custodial_place_resolve(text,timestamptz)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.custodial_place_command(uuid,uuid,uuid,integer,text,timestamptz,jsonb,text) to service_role;
grant execute on function public.custodial_place_preview(uuid,timestamptz) to service_role;
grant execute on function public.custodial_place_resolve(text,timestamptz) to service_role,custodial_application_reader;

-- Capture exact recovery authority, including auto-installed restore fences.
do $recovery$
declare obj record; ord integer; changed integer;
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then raise exception 'Recovery immutability unavailable'; end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
   from pg_proc p where pronamespace='public'::regnamespace and (proname like 'place_lifecycle_%' or proname in('custodial_place_command','custodial_place_preview','custodial_place_resolve'))
  union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
   from pg_proc p where pronamespace='public'::regnamespace and (proname like 'place_lifecycle_%' or proname in('custodial_place_command','custodial_place_preview','custodial_place_resolve'))
  union all select x.* from unnest(array['public.custodial_places','public.custodial_place_control','public.custodial_place_versions']) rel
   cross join lateral (
    select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
    union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname) from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
    union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
    union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
    union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rel::regclass
    union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
    union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';' from pg_trigger where tgrelid=rel::regclass and not tgisinternal
    union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
   ) x
 ) objects order by bucket,case when identity like '%place_lifecycle_normalize(%' then 0 when identity like '%place_lifecycle_snapshot(%' then 1 when identity like '%place_lifecycle_root(%' then 2 else 3 end,identity
 loop
  if obj.definition is null then raise exception 'Missing place recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp() where object_kind=obj.kind and object_identity=obj.identity;
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'Duplicate recovery identity'; end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,(case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if ord is null then raise exception 'Recovery order exhausted'; end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end;
$recovery$;
commit;
