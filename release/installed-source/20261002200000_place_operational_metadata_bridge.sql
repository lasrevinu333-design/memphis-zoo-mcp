-- Metadata authority ONLY. Existing consumers, routes and protected work do not
-- switch here. New real catalog rows are inactive and have NO tag/router URL.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;
create table public.custodial_place_source_previews(
 preview_id uuid primary key,actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 created_at timestamptz not null,expires_at timestamptz not null check(expires_at>created_at),
 proposal jsonb not null,proposal_sha256 text not null check(proposal_sha256 ~ '^[0-9a-f]{64}$')
);
create index custodial_place_source_previews_actor on public.custodial_place_source_previews(actor_manager_id);
create table public.custodial_place_source_versions(
 legacy_kind text not null check(legacy_kind in('physical_location','location_group')),legacy_id uuid not null,
 revision integer not null check(revision>0),place_id uuid not null references public.custodial_places(place_id) on delete restrict,
 effective_at timestamptz not null,recorded_at timestamptz not null default statement_timestamp(),
 request_id uuid not null unique,preview_id uuid not null unique references public.custodial_place_source_previews(preview_id) on delete restrict,
 actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 canonical_revision integer not null,action text not null,reason text not null,
 source_row_sha256 text not null,snapshot jsonb not null,receipt jsonb not null,
 primary key(legacy_kind,legacy_id,revision)
);
create index custodial_place_source_versions_time on public.custodial_place_source_versions(legacy_kind,legacy_id,effective_at desc,revision desc);
create index custodial_place_source_versions_place on public.custodial_place_source_versions(place_id);
create index custodial_place_source_versions_actor on public.custodial_place_source_versions(actor_manager_id);
create table public.custodial_place_source_admissions(
 request_id uuid primary key,preview_id uuid not null unique references public.custodial_place_source_previews(preview_id) on delete restrict,
 transaction_id bigint not null,actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 argument_sha256 text not null,source_sha256 text not null,dependency_sha256 text not null,
 source_head integer not null,target_head integer not null
);
create index custodial_place_source_admissions_actor on public.custodial_place_source_admissions(actor_manager_id);
do $acl$ declare t text;begin
 foreach t in array array['custodial_place_source_previews','custodial_place_source_versions','custodial_place_source_admissions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',t);
  execute format('create trigger place_source_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',t);
 end loop;
end $acl$;

create function public.place_source_row(p_kind text,p_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select case p_kind when 'physical_location' then
  (select jsonb_build_object('id',id,'location_code',location_code,'location_name',location_name,'location_type',location_type,'active',active,
   'route_identity_sha256',public.place_bridge_sha(jsonb_build_array(nfc_url,scan_router_url,form_url,form_type))) from public.locations where id=p_id)
 when 'location_group' then (select (to_jsonb(g)-'notes')||jsonb_build_object('memberships',
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'location_id',location_id,'active',active) order by id) from public.location_group_memberships where location_group_id=p_id),'[]'::jsonb),
  'aliases',coalesce((select jsonb_agg(jsonb_build_object('id',id,'alias_text',alias_text,'active',active) order by id) from public.location_group_aliases where location_group_id=p_id),'[]'::jsonb),
  'event_area_aliases',coalesce((select jsonb_agg(to_jsonb(a)-'notes' order by id) from public.event_area_aliases a where location_group_id=p_id),'[]'::jsonb))
  from public.location_groups g where id=p_id) end
$fn$;
create function public.place_source_dependencies() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select jsonb_build_object('publications',coalesce((select jsonb_agg(to_jsonb(p) order by publication_id) from public.weekly_schedule_publications p),'[]'::jsonb),
  'protected_original_contexts',coalesce((select jsonb_agg(jsonb_build_object('context_id',context_id,'location_id',location_id,
   'canonical_location_code',canonical_location_code,'status',status,'occurrence_fingerprint',occurrence_fingerprint) order by context_id)
   from public.custodial_offline_actor_contexts),'[]'::jsonb))
$fn$;
create function public.place_source_manifest() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select public.place_bridge_source()||jsonb_build_object('physical_route_identities',coalesce((select jsonb_agg(public.place_source_row('physical_location',id) order by id) from public.locations),'[]'::jsonb),
  'canonical_heads',coalesce((select jsonb_agg(to_jsonb(v) order by place_id) from (select distinct on(place_id) place_id,revision,effective_at,snapshot from public.custodial_place_versions order by place_id,revision desc) v),'[]'::jsonb),
  'source_heads',coalesce((select jsonb_agg(to_jsonb(v) order by legacy_kind,legacy_id) from (select distinct on(legacy_kind,legacy_id) legacy_kind,legacy_id,revision,place_id,effective_at,snapshot from public.custodial_place_source_versions order by legacy_kind,legacy_id,revision desc) v),'[]'::jsonb))
$fn$;
create function public.place_source_locks() returns void
language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 -- Common recurring authority FIRST, then Place, then catalog/dependencies.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform 1 from public.custodial_place_control where singleton for update;
 lock table public.event_area_aliases,public.event_venues,public.location_group_aliases,public.location_group_memberships,public.location_groups,public.locations in share mode;
 lock table public.weekly_schedule_publications,public.custodial_offline_actor_contexts in share mode;
end $fn$;

create function public.custodial_place_source_preview(p_manager uuid,p_kind text,p_id uuid,p_action text,p_payload jsonb,p_effective_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
<<source_preview>>
declare clock timestamptz:=statement_timestamp();at_time timestamptz:=coalesce(p_effective_at,clock);id uuid:=coalesce(p_id,gen_random_uuid());pid uuid;
 old public.custodial_place_source_versions%rowtype;prior public.custodial_place_source_versions%rowtype;
 raw jsonb;state jsonb;desired jsonb;source jsonb;deps jsonb;proposal jsonb;preview uuid:=gen_random_uuid();
 head integer:=0;target_head integer:=0;target uuid;target_state jsonb;allowed text[];members jsonb;names jsonb;code text;item record;check_at timestamptz;candidate_root uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.custodial_assert_manager(p_manager);perform public.place_source_locks();
 if p_kind not in('physical_location','location_group') or p_kind is null or p_action is null
  or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_payload is null or jsonb_typeof(p_payload)<>'object'
  or octet_length(p_payload::text)>32768 or not isfinite(at_time) or at_time<clock then raise exception using errcode='22023',message='Invalid operational metadata preview';end if;
 allowed:=case p_action when 'enroll' then array['canonical_code','display_name','aliases','cleaning_mode','event_eligible','metadata']
  when 'add' then array['canonical_code','legacy_code','display_name','aliases','cleaning_mode','event_eligible','location_type','member_location_ids','metadata']
  when 'rename' then array['display_name'] when 'aliases' then array['aliases']
  when 'reclassify' then array['cleaning_mode','event_eligible','metadata'] when 'memberships' then array['member_location_ids']
  when 'merge' then array['target_legacy_id'] when 'deactivate' then array[]::text[] when 'reactivate' then array[]::text[] when 'reverse' then array[]::text[] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then raise exception using errcode='22023',message='Unknown metadata action or fields';end if;
 raw:=public.place_source_row(p_kind,id);
 select * into old from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=id order by revision desc limit 1;
 if p_action='add' then
  if p_id is not null or raw is not null then raise exception using errcode='22023',message='New UUID is server-issued only';end if;
  code:=p_payload->>'legacy_code';
  if code is null or code !~ '^[A-Z][A-Z0-9_]{0,79}$' then raise exception using errcode='22023',message='Explicit stable legacy code required';end if;
  if p_kind='physical_location' and exists(select 1 from public.locations where location_code=code)
   or p_kind='location_group' and exists(select 1 from public.location_groups where group_code=code) then raise exception using errcode='23505',message='Legacy stable code already exists';end if;
  if p_kind='physical_location' and (p_payload->>'location_type') not in('restroom','exhibit') or p_kind='physical_location' and p_payload->>'location_type' is null then raise exception using errcode='22023',message='Supported physical location type required';end if;
  if p_kind='physical_location' and p_payload ? 'member_location_ids' then raise exception using errcode='22023',message='A physical identity is not a group';end if;
 elsif p_id is null or raw is null then raise exception using errcode='22023',message='Explicit existing legacy UUID required';end if;
 if p_action in('add','enroll') then
  if old.revision is not null then raise exception using errcode='23505',message='Legacy identity already enrolled';end if;
  if p_kind='physical_location' and exists(select 1 from public.custodial_places where physical_location_id=id) then raise exception using errcode='55000',message='Existing canonical physical binding needs separate explicit reconciliation';end if;
  pid:=gen_random_uuid();state:=jsonb_build_object('display_name',p_payload->>'display_name','aliases',coalesce(p_payload->'aliases','[]'::jsonb),'active',true,
   'cleaning_mode',p_payload->>'cleaning_mode','event_eligible',p_payload->'event_eligible','merged_into',null);
  members:=case when p_kind='physical_location' then jsonb_build_array(id) when p_action='add' then coalesce(p_payload->'member_location_ids','[]'::jsonb)
   else coalesce((select jsonb_agg(m.location_id order by m.location_id) from public.location_group_memberships m where m.location_group_id=source_preview.id),'[]'::jsonb) end;
  desired:=jsonb_build_object('setup_pending',p_action='add','member_location_ids',members,'metadata',coalesce(p_payload->'metadata','{}'::jsonb),'merged_legacy_id',null);
 else
  if old.revision is null then raise exception using errcode='55000',message='Enroll exact existing UUID before lifecycle changes';end if;
  pid:=old.place_id;
  select revision,snapshot into head,state from public.custodial_place_versions where place_id=pid order by revision desc limit 1;
  if head<>old.canonical_revision then raise exception using errcode='40001',message='Canonical source changed outside bridge; explicit reconciliation required';end if;
  desired:=old.snapshot;
  if state->>'merged_into' is not null and p_action<>'reverse' then raise exception using errcode='23514',message='Reverse logical merge before editing its source';end if;
  case p_action
   when 'rename' then state:=state||jsonb_build_object('display_name',p_payload->'display_name');
   when 'aliases' then state:=state||jsonb_build_object('aliases',p_payload->'aliases');
   when 'deactivate' then state:=state||'{"active":false}'::jsonb;
   when 'reactivate' then state:=state||'{"active":true}'::jsonb;
   when 'reclassify' then
    if not(p_payload ? 'cleaning_mode' or p_payload ? 'event_eligible' or p_payload ? 'metadata') then raise exception using errcode='22023',message='Classification change required';end if;
    state:=state||(p_payload-'metadata');if p_payload ? 'metadata' then desired:=desired||jsonb_build_object('metadata',p_payload->'metadata');end if;
   when 'memberships' then
    if p_kind<>'location_group' or not(p_payload ? 'member_location_ids') then raise exception using errcode='22023',message='Explicit complete group member UUID list required';end if;
    desired:=desired||jsonb_build_object('member_location_ids',p_payload->'member_location_ids');
   when 'merge' then
    select place_id,canonical_revision into target,target_head from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=(p_payload->>'target_legacy_id')::uuid order by revision desc limit 1;
    select snapshot into target_state from public.custodial_place_versions where place_id=target and revision=target_head and effective_at<=at_time;
    if target is null or target=pid or target_state is null or target_state->'active'<>'true'::jsonb or target_state->>'merged_into' is not null
     or target_state->>'cleaning_mode' is distinct from state->>'cleaning_mode'
     or exists(select 1 from public.custodial_place_versions where place_id=target and revision>target_head)
     or public.place_bridge_sha(public.place_source_row(p_kind,(p_payload->>'target_legacy_id')::uuid)) is distinct from
      (select source_row_sha256 from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=(p_payload->>'target_legacy_id')::uuid order by revision desc limit 1) then
     raise exception using errcode='23514',message='Logical merge requires current compatible same-namespace target';end if;
    state:=state||jsonb_build_object('active',false,'merged_into',target);
    desired:=desired||jsonb_build_object('merged_legacy_id',p_payload->>'target_legacy_id');
   when 'reverse' then
    if old.revision=1 then state:=state||'{"active":false,"merged_into":null}'::jsonb;desired:=desired||'{"merged_legacy_id":null}'::jsonb;
    else
     select * into prior from public.custodial_place_source_versions where legacy_kind=p_kind and legacy_id=id and revision=old.revision-1;
     select snapshot into state from public.custodial_place_versions where place_id=pid and revision=prior.canonical_revision;desired:=prior.snapshot;
    end if;
  end case;
 end if;
 if old.effective_at>at_time then raise exception using errcode='22023',message='Append after latest planned source effective time';end if;
 code:=coalesce(p_payload->>'canonical_code',(select canonical_code from public.custodial_places where place_id=pid));
 if code is null or code !~ '^[A-Z][A-Z0-9_]{0,79}$' or code='STINGRAYS' then raise exception using errcode='22023',message='Valid distinct canonical code required; Stingrays remains event-only';end if;
 if p_action in('add','enroll') and exists(select 1 from public.custodial_places where canonical_code=code) then raise exception using errcode='23505',message='Canonical stable code already exists';end if;
 if jsonb_typeof(state->'display_name') is distinct from 'string' or length(btrim(state->>'display_name')) not between 1 and 200
  or public.place_lifecycle_normalize(state->>'display_name')='' or jsonb_typeof(state->'aliases') is distinct from 'array' or jsonb_array_length(state->'aliases')>128
  or coalesce(state->>'cleaning_mode','') not in('SCAN_TRACKED','REMINDER_ONLY','NEVER_CLEAN') or jsonb_typeof(state->'event_eligible') is distinct from 'boolean'
  or exists(select 1 from jsonb_array_elements(state->'aliases') a where jsonb_typeof(a)<>'string' or length(btrim(a#>>'{}')) not between 1 and 200 or public.place_lifecycle_normalize(a#>>'{}')='') then raise exception using errcode='22023',message='Invalid name/aliases/independent classification';end if;
 select jsonb_agg(name order by name) into names from(select distinct value name from jsonb_array_elements_text(state->'aliases') union select state->>'display_name'
  union select snapshot->>'display_name' from public.custodial_place_versions where place_id=pid) n;
 if jsonb_array_length(names)>128 then raise exception using errcode='22023',message='Retained name aliases exceed bound';end if;state:=state||jsonb_build_object('aliases',names);
 candidate_root:=case when state->>'merged_into' is not null then (state->>'merged_into')::uuid when state->'active'='true'::jsonb then pid else null end;
 if candidate_root is not null then
  for check_at in select at_time union select effective_at from public.custodial_place_versions where effective_at>=at_time loop
   if exists(select 1 from public.custodial_places x cross join lateral public.place_lifecycle_snapshot(x.place_id,check_at) other
    cross join lateral jsonb_array_elements_text(other->'aliases') a cross join lateral jsonb_array_elements_text(names) proposed
    where x.place_id<>pid and public.place_lifecycle_root(x.place_id,check_at) is not null
     and public.place_lifecycle_root(x.place_id,check_at)<>candidate_root and public.place_lifecycle_normalize(a.value)=public.place_lifecycle_normalize(proposed.value)) then
    raise exception using errcode='23514',message='Proposed alias conflicts in current/future canonical timeline';end if;
  end loop;
 end if;
 members:=desired->'member_location_ids';
 if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members)>256
  or exists(select 1 from jsonb_array_elements(members) m where jsonb_typeof(m)<>'string')
  or (select count(distinct value) from jsonb_array_elements_text(members))<>jsonb_array_length(members) then raise exception using errcode='22023',message='Distinct explicit member UUID array required';end if;
 if p_kind='location_group' and exists(select 1 from jsonb_array_elements_text(members) m where not exists(select 1 from public.locations l where l.id=m.value::uuid)) then raise exception using errcode='22023',message='Unknown physical member UUID';end if;
 if state->>'cleaning_mode'='SCAN_TRACKED' and jsonb_array_length(members)=0 then raise exception using errcode='23514',message='SCAN_TRACKED group requires actual physical members';end if;
 if jsonb_typeof(desired->'metadata') is distinct from 'object' or exists(select 1 from jsonb_object_keys(desired->'metadata') k where k not in('coordinates','schedule_eligible','staffing_eligible','public_restroom','staff_restroom','exhibit','restaurant','administrative','zoo_wide','offsite')) then raise exception using errcode='22023',message='Unknown place metadata fields';end if;
 for item in select key,value from jsonb_each(desired->'metadata') where key<>'coordinates' loop
  if jsonb_typeof(item.value)<>'boolean' then raise exception using errcode='22023',message='Independent capabilities must be explicit booleans';end if;
 end loop;
 if desired->'metadata' ? 'coordinates' and desired->'metadata'->'coordinates'<>'null'::jsonb then
  if jsonb_typeof(desired->'metadata'->'coordinates')<>'object' or exists(select 1 from jsonb_object_keys(desired->'metadata'->'coordinates') k where k not in('latitude','longitude'))
   or jsonb_typeof(desired->'metadata'->'coordinates'->'latitude') is distinct from 'number' or jsonb_typeof(desired->'metadata'->'coordinates'->'longitude') is distinct from 'number'
   or (desired->'metadata'->'coordinates'->>'latitude')::numeric not between -90 and 90 or (desired->'metadata'->'coordinates'->>'longitude')::numeric not between -180 and 180 then raise exception using errcode='22023',message='Explicit bounded coordinates required';end if;
 end if;
 source:=public.place_source_manifest();deps:=public.place_source_dependencies();
 if octet_length(source::text)+octet_length(deps::text)>2097152 then raise exception using errcode='54000',message='Source/dependency manifest exceeds bounded preview';end if;
 proposal:=jsonb_build_object('legacy_kind',p_kind,'legacy_id',id,'place_id',pid,'action',p_action,'payload',p_payload,'reason',p_reason,'requested_effective_at',p_effective_at,
  'expected_revision',coalesce(old.revision,0),'expected_canonical_revision',head,'target_place_id',target,'expected_target_revision',target_head,'canonical_code',code,
  'source_sha256',public.place_bridge_sha(source),'dependency_sha256',public.place_bridge_sha(deps),'raw_legacy',raw,'desired_snapshot',desired,'canonical_snapshot',state,
  'current_effective',public.place_lifecycle_snapshot(pid,clock),'latest_effective_at',old.effective_at,'operational_cutover',false,
  'requires_explicit_republish',p_action not in('rename','aliases','enroll'),'protected_finish_uses_original_route',true,
  'dependency_inventory',deps);
 insert into public.custodial_place_source_previews values(preview,p_manager,clock,clock+interval '10 minutes',proposal,public.place_bridge_sha(proposal));
 return jsonb_build_object('preview_id',preview,'actor_manager_id',p_manager,'created_at',clock,'expires_at',clock+interval '10 minutes','proposal_sha256',public.place_bridge_sha(proposal),'proposal',proposal);
end $fn$;

-- No caller-controlled setting can admit merge or group-SCAN. This helper is
-- owner-private, verifies the full immutable proposal, same transaction ledger,
-- current source/target heads, manager and dependency manifest under locks.
create function public.place_source_apply(p_request uuid,p_manager uuid,p_preview uuid,p_at timestamptz) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v public.custodial_place_source_previews%rowtype;a public.custodial_place_source_admissions%rowtype;p jsonb;rev integer;targetrev integer;
begin
 perform public.custodial_assert_manager(p_manager);
 select * into v from public.custodial_place_source_previews where preview_id=p_preview;
 select * into a from public.custodial_place_source_admissions where request_id=p_request;
 p:=v.proposal;
 if v.actor_manager_id is distinct from p_manager or a.actor_manager_id is distinct from p_manager or a.preview_id is distinct from p_preview
  or a.transaction_id is distinct from txid_current() or a.argument_sha256 is distinct from public.place_bridge_sha(jsonb_build_array(p_request,p_manager,p_preview,p_at,p))
  or a.source_sha256 is distinct from public.place_bridge_sha(public.place_source_manifest())
  or a.dependency_sha256 is distinct from public.place_bridge_sha(public.place_source_dependencies()) then raise exception using errcode='42501',message='Private current-transaction full-argument admission required';end if;
 select max(revision) into rev from public.custodial_place_versions where place_id=(p->>'place_id')::uuid;
 select max(revision) into targetrev from public.custodial_place_versions where place_id=(p->>'target_place_id')::uuid;
 if coalesce(rev,0)<>a.source_head or coalesce(targetrev,0)<>a.target_head then raise exception using errcode='40001',message='Canonical source/target heads changed';end if;
 if p->>'action' in('add','enroll') then
  if p->>'action'='add' then
   if p->>'legacy_kind'='physical_location' then
    insert into public.locations(id,location_code,location_name,location_type,active) values((p->>'legacy_id')::uuid,p->'payload'->>'legacy_code',p->'canonical_snapshot'->>'display_name',p->'payload'->>'location_type',false);
   else
    insert into public.location_groups(id,group_code,group_name,active) values((p->>'legacy_id')::uuid,p->'payload'->>'legacy_code',p->'canonical_snapshot'->>'display_name',false);
    -- Legacy membership has UNIQUE(location_id). Proposed full members remain
    -- private setup metadata; no physical member is stolen from its group.
   end if;
  end if;
  insert into public.custodial_places(place_id,canonical_code,physical_location_id) values((p->>'place_id')::uuid,p->>'canonical_code',
   case when p->>'legacy_kind'='physical_location' then (p->>'legacy_id')::uuid else null end);
 end if;
 insert into public.custodial_place_versions(place_id,revision,request_id,actor_manager_id,action,reason,effective_at,argument_sha256,snapshot)
  values((p->>'place_id')::uuid,coalesce(rev,0)+1,p_request,p_manager,'source_'||(p->>'action'),p->>'reason',p_at,a.argument_sha256,p->'canonical_snapshot');
 perform public.place_lifecycle_assert_aliases(p_at);return coalesce(rev,0)+1;
end $fn$;

create function public.custodial_place_source_confirm(p_request uuid,p_manager uuid,p_preview uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v public.custodial_place_source_previews%rowtype;r public.custodial_place_source_versions%rowtype;p jsonb;rev integer;head integer;targethead integer;at_time timestamptz;receipt jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));perform public.custodial_assert_manager(p_manager);perform public.place_source_locks();
 if p_request is null or p_preview is null then raise exception using errcode='22023',message='Stable request/original preview required';end if;
 select * into r from public.custodial_place_source_versions where request_id=p_request;
 if found then
  if r.actor_manager_id<>p_manager or r.preview_id<>p_preview then raise exception using errcode='23505',message='Source request identity conflict';end if;return r.receipt||'{"replayed":true}'::jsonb;
 end if;
 select * into v from public.custodial_place_source_previews where preview_id=p_preview;
 if not found or v.actor_manager_id<>p_manager then raise exception using errcode='42501',message='Original manager preview required';end if;
 if v.expires_at<=clock_timestamp() then raise exception using errcode='40001',message='Source preview expired';end if;p:=v.proposal;
 if v.proposal_sha256<>public.place_bridge_sha(p) or p->>'source_sha256'<>public.place_bridge_sha(public.place_source_manifest())
  or p->>'dependency_sha256'<>public.place_bridge_sha(public.place_source_dependencies()) then raise exception using errcode='40001',message='Source/dependencies changed; review again';end if;
 select max(revision) into rev from public.custodial_place_source_versions where legacy_kind=p->>'legacy_kind' and legacy_id=(p->>'legacy_id')::uuid;
 select max(revision) into head from public.custodial_place_versions where place_id=(p->>'place_id')::uuid;
 select max(revision) into targethead from public.custodial_place_versions where place_id=(p->>'target_place_id')::uuid;
 if coalesce(rev,0)<>(p->>'expected_revision')::integer or coalesce(head,0)<>(p->>'expected_canonical_revision')::integer or coalesce(targethead,0)<>(p->>'expected_target_revision')::integer then raise exception using errcode='40001',message='Source/target revision changed';end if;
 at_time:=coalesce((p->>'requested_effective_at')::timestamptz,clock_timestamp());
 if not isfinite(at_time) or (p->>'requested_effective_at' is not null and at_time<clock_timestamp()) then raise exception using errcode='40001',message='Planned effective time elapsed';end if;
 insert into public.custodial_place_source_admissions values(p_request,p_preview,txid_current(),p_manager,public.place_bridge_sha(jsonb_build_array(p_request,p_manager,p_preview,at_time,p)),p->>'source_sha256',p->>'dependency_sha256',coalesce(head,0),coalesce(targethead,0));
 head:=public.place_source_apply(p_request,p_manager,p_preview,at_time);
 receipt:=jsonb_build_object('request_id',p_request,'preview_id',p_preview,'actor_manager_id',p_manager,'operational_cutover',false,
  'data',jsonb_build_object('legacy_kind',p->>'legacy_kind','legacy_id',p->>'legacy_id','place_id',p->>'place_id','revision',coalesce(rev,0)+1,'canonical_revision',head,
   'action',p->>'action','effective_at',at_time,'source_sha256',p->>'source_sha256','dependency_sha256',p->>'dependency_sha256','proposal_sha256',v.proposal_sha256,
   'setup_pending',p->'desired_snapshot'->'setup_pending','requires_explicit_republish',p->'requires_explicit_republish','protected_finish_uses_original_route',true));
 insert into public.custodial_place_source_versions(legacy_kind,legacy_id,revision,place_id,effective_at,request_id,preview_id,actor_manager_id,canonical_revision,action,reason,source_row_sha256,snapshot,receipt)
 values(p->>'legacy_kind',(p->>'legacy_id')::uuid,coalesce(rev,0)+1,(p->>'place_id')::uuid,at_time,p_request,p_preview,p_manager,head,p->>'action',p->>'reason',
  public.place_bridge_sha(public.place_source_row(p->>'legacy_kind',(p->>'legacy_id')::uuid)),p->'desired_snapshot',receipt);
 return receipt;
end $fn$;

create function public.custodial_place_source_overlay(p_at timestamptz default statement_timestamp()) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare k text;id uuid;raw jsonb;v public.custodial_place_source_versions%rowtype;latest public.custodial_place_source_versions%rowtype;
 root_version public.custodial_place_source_versions%rowtype;s jsonb;root_state jsonb;root uuid;output jsonb:='[]';status text;members jsonb;consolidated jsonb;
begin
 if p_at is null or not isfinite(p_at) then raise exception using errcode='22023',message='Finite source overlay time required';end if;
 for k,id in select 'physical_location',l.id from public.locations l union all select 'location_group',g.id from public.location_groups g loop
  if jsonb_array_length(output)>=10000 then raise exception using errcode='54000',message='Bounded source overlay limit exceeded';end if;
  raw:=public.place_source_row(k,id);
  select * into latest from public.custodial_place_source_versions where legacy_kind=k and legacy_id=id order by revision desc limit 1;
  select * into v from public.custodial_place_source_versions where legacy_kind=k and legacy_id=id and effective_at<=p_at order by effective_at desc,revision desc limit 1;
  s:=null;root:=null;members:='[]';consolidated:='[]';status:='UNMAPPED';
  if v.revision is not null then
   s:=public.place_lifecycle_snapshot(v.place_id,p_at);root:=public.place_lifecycle_root(v.place_id,p_at);members:=v.snapshot->'member_location_ids';
   root_state:=public.place_lifecycle_snapshot(root,p_at);
   select * into root_version from public.custodial_place_source_versions where place_id=root and effective_at<=p_at order by effective_at desc,revision desc limit 1;
   status:=case when public.place_bridge_sha(raw)<>v.source_row_sha256 or s is null or (s->>'revision')::integer<>v.canonical_revision
     or (root is not null and (root_version.revision is null or root_version.legacy_kind<>k
      or public.place_bridge_sha(public.place_source_row(k,root_version.legacy_id))<>root_version.source_row_sha256
      or (root_state->>'revision')::integer<>root_version.canonical_revision or root_state->>'cleaning_mode'<>s->>'cleaning_mode')) then 'NEEDS_REVIEW'
    when v.snapshot->'setup_pending'='true'::jsonb or root_version.snapshot->'setup_pending'='true'::jsonb then 'SETUP_PENDING'
    when root is null then 'INACTIVE' when s->>'merged_into' is not null then 'LOGICALLY_MERGED' else 'MAPPED' end;
   if k='location_group' and root is not null then
    select coalesce(jsonb_agg(member order by member),'[]'::jsonb) into consolidated from (
     select distinct m.value member from (select distinct on(legacy_kind,legacy_id) * from public.custodial_place_source_versions
      where legacy_kind='location_group' and effective_at<=p_at order by legacy_kind,legacy_id,effective_at desc,revision desc) x
     cross join lateral jsonb_array_elements_text(x.snapshot->'member_location_ids') m
     where public.place_lifecycle_root(x.place_id,p_at)=root) all_members;
   else consolidated:=members;end if;
  end if;
  output:=output||jsonb_build_array(jsonb_build_object('legacy_kind',k,'legacy_id',id,'raw_legacy',raw,'mapping_status',status,
   'place_id',v.place_id,'canonical_root_id',root,'effective_revision',v.revision,'latest_revision',latest.revision,'latest_effective_at',latest.effective_at,
   'effective_snapshot',s,'metadata',v.snapshot->'metadata','source_member_location_ids',members,'proposed_consolidation_member_location_ids',consolidated,
   'proposed_included_locations',case when status in('MAPPED','LOGICALLY_MERGED') and s->>'cleaning_mode'='SCAN_TRACKED' then members else '[]'::jsonb end,
   'operational_cutover',false,'new_scan_authority',false,'protected_finish_uses_original_route',true,'requires_explicit_republish',true));
 end loop;
 return jsonb_build_object('as_of',p_at,'records',output,'source_sha256',public.place_bridge_sha(public.place_source_manifest()),'operational_cutover',false);
end $fn$;
revoke all on function public.place_source_row(text,uuid),public.place_source_dependencies(),public.place_source_manifest(),public.place_source_locks(),
 public.custodial_place_source_preview(uuid,text,uuid,text,jsonb,timestamptz,text),public.place_source_apply(uuid,uuid,uuid,timestamptz),
 public.custodial_place_source_confirm(uuid,uuid,uuid),public.custodial_place_source_overlay(timestamptz)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.custodial_place_source_preview(uuid,text,uuid,text,jsonb,timestamptz,text),public.custodial_place_source_confirm(uuid,uuid,uuid) to service_role;
grant execute on function public.custodial_place_source_overlay(timestamptz) to service_role,custodial_application_reader;
-- Owning inventory is appended below; unrelated authority objects are untouched.
do $recovery$ declare obj record;ord integer;changed integer;begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then raise exception 'Recovery immutability unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition from pg_proc p where pronamespace='public'::regnamespace and (proname like 'place_source_%' or proname in('custodial_place_source_overlay','custodial_place_source_preview','custodial_place_source_confirm'))
  union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) from pg_proc p where pronamespace='public'::regnamespace and (proname like 'place_source_%' or proname in('custodial_place_source_overlay','custodial_place_source_preview','custodial_place_source_confirm'))
  union all select x.* from unnest(array['public.custodial_place_source_previews','public.custodial_place_source_versions','public.custodial_place_source_admissions']) rel cross join lateral (
   select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
   union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname) from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
   union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
   union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
   union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rel::regclass
   union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
   union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';' from pg_trigger where tgrelid=rel::regclass and not tgisinternal
   union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x
 ) objects order by bucket,case when identity like '%place_source_row(%' then 0 when identity like '%place_source_dependencies(%' then 1 when identity like '%place_source_manifest(%' then 2 else 3 end,identity loop
  if obj.definition is null then raise exception 'Missing bridge recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp() where object_kind=obj.kind and object_identity=obj.identity;
  get diagnostics changed=row_count;if changed>1 then raise exception 'Duplicate recovery identity';end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,(case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if ord is null then raise exception 'Recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
