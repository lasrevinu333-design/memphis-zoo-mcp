-- Explicit EVENT_VENUE read-overlay bridge only. No legacy/history/tag rewrite.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;
create table public.custodial_place_bridge_previews(
 preview_id uuid primary key,actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 created_at timestamptz not null,expires_at timestamptz not null check(expires_at>created_at),
 proposal jsonb not null check(jsonb_typeof(proposal)='object'),proposal_sha256 text not null check(proposal_sha256 ~ '^[0-9a-f]{64}$')
);
create index custodial_place_bridge_previews_actor on public.custodial_place_bridge_previews(actor_manager_id);
create table public.custodial_place_bridge_versions(
 legacy_kind text not null check(legacy_kind in('physical_location','location_group','event_venue')),
 legacy_id uuid not null,revision integer not null check(revision>0),
 place_id uuid not null references public.custodial_places(place_id) on delete restrict,
 active boolean not null,effective_at timestamptz not null,recorded_at timestamptz not null default statement_timestamp(),
 actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 request_id uuid not null unique,preview_id uuid not null unique references public.custodial_place_bridge_previews(preview_id) on delete restrict,
 action text not null check(action in('map','deactivate','reactivate','reverse')),reason text not null,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),receipt jsonb not null,
 primary key(legacy_kind,legacy_id,revision)
);
create index custodial_place_bridge_versions_effective on public.custodial_place_bridge_versions(legacy_kind,legacy_id,effective_at desc,revision desc);
create index custodial_place_bridge_versions_place on public.custodial_place_bridge_versions(place_id);
create index custodial_place_bridge_versions_actor on public.custodial_place_bridge_versions(actor_manager_id);
do $acl$ declare t text; begin
 foreach t in array array['custodial_place_bridge_previews','custodial_place_bridge_versions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823',t);
  execute format('create trigger place_bridge_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',t);
 end loop;
end $acl$;

create function public.place_bridge_source() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select jsonb_build_object(
 'event_venues',coalesce((select jsonb_agg(to_jsonb(v)-'metadata_json' order by id) from public.event_venues v),'[]'::jsonb),
 'location_groups',coalesce((select jsonb_agg(to_jsonb(g)-'notes' order by id) from public.location_groups g),'[]'::jsonb),
 'group_aliases',coalesce((select jsonb_agg(jsonb_build_object('id',id,'location_group_id',location_group_id,'alias_text',alias_text,'active',active) order by id) from public.location_group_aliases),'[]'::jsonb),
 'group_memberships',coalesce((select jsonb_agg(jsonb_build_object('id',id,'location_group_id',location_group_id,'location_id',location_id,'active',active) order by id) from public.location_group_memberships),'[]'::jsonb),
 'event_area_aliases',coalesce((select jsonb_agg(to_jsonb(a)-'notes' order by id) from public.event_area_aliases a),'[]'::jsonb),
 'physical_locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'location_code',location_code,'location_name',location_name,'location_type',location_type,'active',active) order by id) from public.locations),'[]'::jsonb))
$fn$;
create function public.place_bridge_sha(p_value jsonb) returns text
language sql immutable strict set search_path=pg_catalog,extensions as $fn$
 select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$fn$;

-- This internal helper also evaluates a proposed version without persisting it.
create function public.place_bridge_overlay(p_at timestamptz,p_proposed jsonb default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare source jsonb:=public.place_bridge_source(); sha text; v jsonb; b jsonb; latest jsonb; s jsonb; head jsonb; p uuid;
 status text; why text; output jsonb:='[]'; item jsonb; other jsonb; ambiguous boolean;
begin
 if p_at is null or not isfinite(p_at) then raise exception using errcode='22023',message='Finite overlay clock required'; end if;
 if octet_length(source::text)>1048576 then raise exception using errcode='54000',message='Catalog exceeds bounded bridge source manifest'; end if;
 sha:=public.place_bridge_sha(source);
 for v in select value from jsonb_array_elements(source->'event_venues') loop
  select to_jsonb(x) into latest from public.custodial_place_bridge_versions x where legacy_kind='event_venue' and legacy_id=(v->>'id')::uuid order by revision desc limit 1;
  select to_jsonb(x) into b from public.custodial_place_bridge_versions x where legacy_kind='event_venue' and legacy_id=(v->>'id')::uuid and effective_at<=p_at order by effective_at desc,revision desc limit 1;
  if p_proposed->>'legacy_id'=v->>'id' then b:=p_proposed; end if;
  s:=null;head:=null;p:=null;why:=null;status:='UNMAPPED';
  if b is not null then
   p:=(b->>'place_id')::uuid;s:=public.place_lifecycle_snapshot(p,p_at);
   select snapshot||jsonb_build_object('revision',revision,'effective_at',effective_at) into head from public.custodial_place_versions where place_id=p order by revision desc limit 1;
   if b->'active'='false'::jsonb then status:='INACTIVE';why:='bridge_inactive';
   elsif b->>'source_sha256' is distinct from sha then status:='NEEDS_REVIEW';why:='legacy_source_drift';
   elsif v->'active'<>'true'::jsonb or v->'eligible_event_venue'<>'true'::jsonb then status:='NEEDS_REVIEW';why:='legacy_venue_not_active_eligible';
   elsif s is null or s->'active'<>'true'::jsonb or s->'event_eligible'<>'true'::jsonb or s->>'cleaning_mode'<>'NEVER_CLEAN'
    or s->>'merged_into' is not null or exists(select 1 from public.custodial_places where place_id=p and physical_location_id is not null) then
    status:='NEEDS_REVIEW';why:='canonical_target_not_active_event_only';
   else status:='MAPPED';end if;
  end if;
  output:=output||jsonb_build_array(jsonb_build_object('venue_id',v->>'id','mapping_status',status,'review_reason',why,
   'bridge_revision',b->'revision','bridge_effective_at',b->'effective_at','bridge_latest_revision',latest->'revision','bridge_latest_effective_at',latest->'effective_at',
   'canonical_place_id',p,'canonical_revision',s->'revision','canonical_effective_at',s->'effective_at','canonical_latest_revision',head->'revision','canonical_latest_effective_at',head->'effective_at',
   'display_name',case when status='MAPPED' then s->'display_name' else v->'display_name' end,
   'aliases',case when status='MAPPED' then s->'aliases' else v->'aliases' end,'raw_legacy',v,
   'source_drift',b is not null and b->>'source_sha256' is distinct from sha,
   'cleaning_mode',case when b is not null then 'NEVER_CLEAN' else null end,
   'event_eligible',status='MAPPED' or (status='UNMAPPED' and v->'active'='true'::jsonb and (v->'eligible_event_venue'='true'::jsonb or v->'eligible_event_scope'='true'::jsonb)),
   'capability_authority',case when status='UNMAPPED' then 'LEGACY_UNMAPPED' else 'CANONICAL_EVENT_ONLY' end,
   'schedule_eligible',case when status='UNMAPPED' then null else false end,'staffing_eligible',case when status='UNMAPPED' then null else false end,
   'nfc_eligible',case when status='UNMAPPED' then null else false end,'overdue_eligible',case when status='UNMAPPED' then null else false end));
 end loop;
 -- A mapped alias may not steal an active eligible legacy venue alias.
 for item in select value from jsonb_array_elements(output) where value->>'mapping_status'='MAPPED' loop
  ambiguous:=false;
  for other in select value from jsonb_array_elements(output) where value->>'venue_id'<>item->>'venue_id'
   and (value->>'mapping_status'='MAPPED' or (value->'raw_legacy'->'active'='true'::jsonb and (value->'raw_legacy'->'eligible_event_venue'='true'::jsonb or value->'raw_legacy'->'eligible_event_scope'='true'::jsonb))) loop
   if exists(select 1 from jsonb_array_elements_text((item->'aliases')||jsonb_build_array(item->'display_name')) a
    join jsonb_array_elements_text((other->'aliases')||jsonb_build_array(other->'display_name')) z
    on public.place_lifecycle_normalize(a.value)=public.place_lifecycle_normalize(z.value)) then ambiguous:=true;end if;
  end loop;
  if ambiguous then output:=(select jsonb_agg(case when x->>'venue_id'=item->>'venue_id' then x||'{"mapping_status":"NEEDS_REVIEW","review_reason":"alias_conflict","event_eligible":false}'::jsonb else x end order by ordinal)
   from jsonb_array_elements(output) with ordinality t(x,ordinal));end if;
 end loop;
 return jsonb_build_object('as_of',p_at,'source_sha256',sha,'venues',output,'physical_and_group_cutover',false);
end $fn$;
create function public.custodial_place_event_venue_overlay(p_at timestamptz default statement_timestamp()) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select public.place_bridge_overlay(p_at,null)
$fn$;

create function public.custodial_place_bridge_preview(p_manager uuid,p_legacy_kind text,p_legacy_id uuid,p_action text,p_target uuid,p_effective_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare source jsonb;sha text;old public.custodial_place_bridge_versions%rowtype;prior public.custodial_place_bridge_versions%rowtype;
 target uuid;active_state boolean;head jsonb;proposal jsonb;overlay jsonb;id uuid:=gen_random_uuid();clock timestamptz:=statement_timestamp();at_time timestamptz:=coalesce(p_effective_at,clock);
begin
 perform public.custodial_assert_manager(p_manager);
 if p_legacy_kind is distinct from 'event_venue' then raise exception using errcode='55000',message='Physical/group bridge cutover is not implemented; all member identities remain untouched';end if;
 if p_legacy_id is null or p_action not in('map','deactivate','reactivate','reverse') or p_action is null
  or p_reason is null or length(btrim(p_reason)) not between 1 and 500 or not isfinite(at_time) or at_time<clock then raise exception using errcode='22023',message='Invalid bridge preview';end if;
 perform 1 from public.custodial_place_control where singleton for update;
 source:=public.place_bridge_source();if octet_length(source::text)>1048576 then raise exception using errcode='54000',message='Catalog exceeds bounded bridge source manifest';end if;
 if not exists(select 1 from public.event_venues venue where venue.id=p_legacy_id) then raise exception using errcode='22023',message='Unknown legacy venue UUID';end if;
 sha:=public.place_bridge_sha(source);
 select * into old from public.custodial_place_bridge_versions where legacy_kind=p_legacy_kind and legacy_id=p_legacy_id order by revision desc limit 1;
 if old.effective_at>at_time then raise exception using errcode='22023',message='Bridge effective timeline must be appended monotonically';end if;
 if p_action='map' then target:=p_target;active_state:=true;
 else
  if old.revision is null or p_target is not null then raise exception using errcode='22023',message='Existing bridge required; target is selected only by map';end if;
  target:=old.place_id;active_state:=p_action='reactivate';
  if p_action='reverse' and old.revision>1 then
   select * into prior from public.custodial_place_bridge_versions where legacy_kind=p_legacy_kind and legacy_id=p_legacy_id and revision=old.revision-1;
   target:=prior.place_id;active_state:=prior.active;
  end if;
 end if;
 select snapshot||jsonb_build_object('revision',revision,'effective_at',effective_at) into head from public.custodial_place_versions where place_id=target order by revision desc limit 1;
 if head is null then raise exception using errcode='22023',message='Explicit existing canonical target required';end if;
 proposal:=jsonb_build_object('legacy_kind',p_legacy_kind,'legacy_id',p_legacy_id,'action',p_action,'place_id',target,'active',active_state,
  'reason',p_reason,'requested_effective_at',p_effective_at,'expected_bridge_revision',coalesce(old.revision,0),
  'expected_canonical_revision',head->'revision','source_sha256',sha,'revision',coalesce(old.revision,0)+1);
 overlay:=public.place_bridge_overlay(at_time,proposal);
 if active_state and not exists(select 1 from jsonb_array_elements(overlay->'venues') x where x->>'venue_id'=p_legacy_id::text and x->>'mapping_status'='MAPPED') then
  raise exception using errcode='23514',message='Target or alias conflict requires review; no bridge preview is confirmable';end if;
 -- Preserve complete source inputs in immutable preview; no reference/history payload.
 proposal:=proposal||jsonb_build_object('source_snapshot',source,'current_effective_bridge',
  (select to_jsonb(x)-'receipt' from public.custodial_place_bridge_versions x where legacy_kind=p_legacy_kind and legacy_id=p_legacy_id and effective_at<=clock order by effective_at desc,revision desc limit 1),
  'latest_bridge',case when old.revision is not null then to_jsonb(old)-'receipt' else null end,'canonical_latest',head,
  'canonical_effective',public.place_lifecycle_snapshot(target,clock),'proposed_overlay',overlay);
 insert into public.custodial_place_bridge_previews values(id,p_manager,clock,clock+interval '10 minutes',proposal,public.place_bridge_sha(proposal));
 return jsonb_build_object('preview_id',id,'actor_manager_id',p_manager,'created_at',clock,'expires_at',clock+interval '10 minutes','proposal',proposal,'proposal_sha256',public.place_bridge_sha(proposal),'legacy_rows_mutated',false);
end $fn$;

create function public.custodial_place_bridge_confirm(p_request uuid,p_manager uuid,p_preview uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare view public.custodial_place_bridge_previews%rowtype;replay public.custodial_place_bridge_versions%rowtype;
 prop jsonb;source jsonb;overlay jsonb;rev integer;canonical_rev integer;at_time timestamptz;old_time timestamptz;receipt jsonb;
begin
 perform public.custodial_assert_manager(p_manager);
 if p_request is null or p_preview is null then raise exception using errcode='22023',message='Stable request and original preview required';end if;
 perform 1 from public.custodial_place_control where singleton for update;
 select * into replay from public.custodial_place_bridge_versions where request_id=p_request;
 if found then
  if replay.actor_manager_id<>p_manager or replay.preview_id<>p_preview then raise exception using errcode='23505',message='Bridge request identity conflict';end if;
  return replay.receipt||jsonb_build_object('replayed',true);
 end if;
 select * into view from public.custodial_place_bridge_previews where preview_id=p_preview;
 if not found or view.actor_manager_id<>p_manager then raise exception using errcode='42501',message='Original manager preview required';end if;
 if view.expires_at<=clock_timestamp() then raise exception using errcode='40001',message='Bridge preview expired; review a fresh preview';end if;
 prop:=view.proposal;
 -- Fixed order, after the shared Place singleton: fence catalog write phantoms.
 lock table public.event_area_aliases,public.event_venues,public.location_group_aliases,public.location_group_memberships,public.location_groups,public.locations in share mode;
 if view.expires_at<=clock_timestamp() then raise exception using errcode='40001',message='Bridge preview expired while waiting; review again';end if;
 source:=public.place_bridge_source();
 if public.place_bridge_sha(source)<>prop->>'source_sha256' then raise exception using errcode='40001',message='Legacy catalog source changed; review again';end if;
 select revision,effective_at into rev,old_time from public.custodial_place_bridge_versions where legacy_kind=prop->>'legacy_kind' and legacy_id=(prop->>'legacy_id')::uuid order by revision desc limit 1;
 if coalesce(rev,0)<>(prop->>'expected_bridge_revision')::integer then raise exception using errcode='40001',message='Bridge revision changed';end if;
 select revision into canonical_rev from public.custodial_place_versions where place_id=(prop->>'place_id')::uuid order by revision desc limit 1;
 if canonical_rev is distinct from (prop->>'expected_canonical_revision')::integer then raise exception using errcode='40001',message='Canonical target changed';end if;
 at_time:=coalesce((prop->>'requested_effective_at')::timestamptz,clock_timestamp());
 if not isfinite(at_time) or at_time<clock_timestamp() and prop->>'requested_effective_at' is not null or old_time>at_time then raise exception using errcode='40001',message='Planned effective time elapsed or timeline changed';end if;
 overlay:=public.place_bridge_overlay(at_time,prop);
 if prop->'active'='true'::jsonb and not exists(select 1 from jsonb_array_elements(overlay->'venues') x where x->>'venue_id'=prop->>'legacy_id' and x->>'mapping_status'='MAPPED') then
  raise exception using errcode='23514',message='Current target or aliases require review';end if;
 receipt:=jsonb_build_object('request_id',p_request,'preview_id',p_preview,'actor_manager_id',p_manager,'legacy_rows_mutated',false,
  'data',jsonb_build_object('legacy_kind',prop->>'legacy_kind','legacy_id',prop->>'legacy_id','place_id',prop->>'place_id','revision',coalesce(rev,0)+1,
   'active',prop->'active','effective_at',at_time,'source_sha256',prop->>'source_sha256','action',prop->>'action'));
 insert into public.custodial_place_bridge_versions(legacy_kind,legacy_id,revision,place_id,active,effective_at,actor_manager_id,request_id,preview_id,action,reason,source_sha256,receipt)
 values(prop->>'legacy_kind',(prop->>'legacy_id')::uuid,coalesce(rev,0)+1,(prop->>'place_id')::uuid,(prop->>'active')::boolean,at_time,p_manager,p_request,p_preview,prop->>'action',prop->>'reason',prop->>'source_sha256',receipt);
 return receipt;
end $fn$;

revoke all on function public.place_bridge_source(),public.place_bridge_sha(jsonb),public.place_bridge_overlay(timestamptz,jsonb),
 public.custodial_place_event_venue_overlay(timestamptz),public.custodial_place_bridge_preview(uuid,text,uuid,text,uuid,timestamptz,text),public.custodial_place_bridge_confirm(uuid,uuid,uuid)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.custodial_place_bridge_preview(uuid,text,uuid,text,uuid,timestamptz,text),public.custodial_place_bridge_confirm(uuid,uuid,uuid) to service_role;
grant execute on function public.custodial_place_event_venue_overlay(timestamptz) to service_role,custodial_application_reader;

-- Owning inventory only; do not normalize unrelated release-authority entries.
do $recovery$ declare obj record;ord integer;changed integer;begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then raise exception 'Recovery immutability unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition from pg_proc p where pronamespace='public'::regnamespace and (proname like 'place_bridge_%' or proname in('custodial_place_event_venue_overlay','custodial_place_bridge_preview','custodial_place_bridge_confirm'))
  union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) from pg_proc p where pronamespace='public'::regnamespace and (proname like 'place_bridge_%' or proname in('custodial_place_event_venue_overlay','custodial_place_bridge_preview','custodial_place_bridge_confirm'))
  union all select x.* from unnest(array['public.custodial_place_bridge_previews','public.custodial_place_bridge_versions']) rel cross join lateral (
   select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
   union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname) from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
   union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
   union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
   union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rel::regclass
   union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
   union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';' from pg_trigger where tgrelid=rel::regclass and not tgisinternal
   union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x
 ) objects order by bucket,case when identity like '%place_bridge_source(%' then 0 when identity like '%place_bridge_sha(%' then 1 when identity like '%place_bridge_overlay(%' then 2 else 3 end,identity loop
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
