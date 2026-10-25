-- Bind a pending recurring publication to exact source/decision/roster facts.
-- This stage cannot finalize or commit the parent; durable terminal targets,
-- final receipt and complete manager confirmation remain separate work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.static_weekly_recurring_publication_bindings (
 publication_id uuid primary key references public.weekly_schedule_publications(publication_id) on delete restrict,
 operation_id uuid not null unique references public.static_weekly_recurring_confirmations(operation_id) on delete restrict,
 source_id uuid not null unique references public.static_weekly_recurring_source_bindings(source_id) on delete restrict,
 source_digest text not null check(source_digest~'^[0-9a-f]{64}$'),
 effective_start date not null check(extract(isodow from effective_start)=1),
 recurring_generation bigint not null check(recurring_generation between 0 and 9007199254740991),
 predecessor_publication_id uuid references public.weekly_schedule_publications(publication_id) on delete restrict,
 implementation_digest text not null check(implementation_digest~'^[0-9a-f]{64}$'),
 decision_json jsonb not null check(jsonb_typeof(decision_json)='object'),
 decision_digest text not null check(decision_digest~'^[0-9a-f]{64}$'),
 dependency_snapshot jsonb not null check(jsonb_typeof(dependency_snapshot)='object'),
 dependency_digest text not null check(dependency_digest~'^[0-9a-f]{64}$'),
 owner_xid xid8 not null default pg_current_xact_id(),
 bound_at timestamptz not null default statement_timestamp()
);
create index static_weekly_recurring_binding_predecessor
 on public.static_weekly_recurring_publication_bindings(predecessor_publication_id)
 where predecessor_publication_id is not null;
alter table public.static_weekly_recurring_publication_bindings enable row level security;
alter table public.static_weekly_recurring_publication_bindings force row level security;
revoke all on table public.static_weekly_recurring_publication_bindings
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
create trigger trg_recurring_publication_binding_immutable before update or delete
 on public.static_weekly_recurring_publication_bindings for each row execute function public.static_weekly_reject_update_delete();

-- Match canonicalOptimizerAssignmentProjection, including its nested window
-- projection. Display rows also carry solver minute expansions; validate those
-- expansions instead of either comparing unlike formats or silently trusting
-- conflicting display times. The complete display remains stored separately.
create function public.static_weekly_v18_canonical_display_assignment(p_row jsonb)
returns jsonb language plpgsql immutable security definer set search_path=pg_catalog,public as $function$
declare v_window jsonb:=p_row->'window';v_result jsonb;
 v_keys text[]:=array['planWorkId','workId','dayOfWeek','serviceDate','status','slotId','personId',
  'displayName','ownerDigest','exactOwnerIdentity','baselineSlotId','baselineOwnerPersonId','baselineOwnerName',
  'originalActorPersonId','originalActorName','optimizedOwnerSlotId','optimizedOwnerPersonId',
  'actualActorPersonId','window','serviceEffortMinutes'];
begin
 if jsonb_typeof(p_row) is distinct from 'object' or not (p_row ?& v_keys)
  or jsonb_typeof(v_window) is distinct from 'object'
  or not (v_window ?& array['start','end','startMinute','endMinute'])
  or (v_window-array['start','end','startMinute','endMinute'])<>'{}'::jsonb
  or jsonb_typeof(v_window->'start') is distinct from 'string'
  or jsonb_typeof(v_window->'end') is distinct from 'string'
  or v_window->>'start'!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
  or v_window->>'end'!~'^(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
  raise exception using errcode='23514',message='recurring displayed assignment has incomplete canonical fields or window';end if;
 if v_window->'startMinute' is distinct from to_jsonb(split_part(v_window->>'start',':',1)::int*60+split_part(v_window->>'start',':',2)::int)
  or v_window->'endMinute' is distinct from to_jsonb(split_part(v_window->>'end',':',1)::int*60+split_part(v_window->>'end',':',2)::int)
  or (v_window->>'startMinute')::int >= (v_window->>'endMinute')::int then
  raise exception using errcode='23514',message='recurring displayed window minute expansion conflicts with exact clock times';end if;
 select jsonb_object_agg(key,case when key='window'
  then jsonb_build_object('start',v_window->'start','end',v_window->'end') else value end)
  into v_result from jsonb_each(p_row) where key=any(v_keys);
 return v_result;
end
$function$;
revoke all on function public.static_weekly_v18_canonical_display_assignment(jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.static_weekly_v18_bind_recurring_publication(
 p_manager_id uuid,p_confirmation_key uuid,p_publication_id uuid,p_expected_generation bigint,p_decision jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_parent public.static_weekly_recurring_confirmations%rowtype;
 v_source public.static_weekly_recurring_source_bindings%rowtype;
 v_publication public.weekly_schedule_publications%rowtype;
 v_version public.weekly_schedule_versions%rowtype;
 v_existing public.static_weekly_recurring_publication_bindings%rowtype;
 v_dependencies jsonb;v_generation bigint;v_predecessor uuid;v_digest text;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into v_parent from public.static_weekly_recurring_confirmations
  where manager_id=p_manager_id and confirmation_key=p_confirmation_key;
 if not found or v_parent.owner_xid<>pg_current_xact_id()
  or exists(select 1 from public.static_weekly_recurring_confirmation_receipts where operation_id=v_parent.operation_id) then
  raise exception using errcode='42501',message='publication binding requires this transaction''s pending recurring parent';end if;
 select * into v_source from public.static_weekly_recurring_source_bindings where operation_id=v_parent.operation_id;
 select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id;
 select * into v_version from public.weekly_schedule_versions where version_id=v_publication.version_id;
 if v_source.source_id is null or v_source.owner_xid<>pg_current_xact_id()
  or v_publication.publication_id is null or v_publication.actor_manager_id is distinct from p_manager_id
  or v_publication.idempotency_key is distinct from 'recurring:'||p_manager_id||':'||p_confirmation_key||':publish'
  or v_publication.effective_start is distinct from v_parent.effective_start
  or v_publication.effective_start<=public.sch_service_date(statement_timestamp())
  or v_version.authority_source_id is distinct from v_source.source_id
  or public.static_weekly_effective_version(v_parent.effective_start) is distinct from v_version.version_id then
  raise exception using errcode='23514',message='recurring publication binding must name its exact current parent-bound child';end if;
 select generation into strict v_generation from public.static_weekly_recurring_generation where singleton;
 if p_expected_generation is null or p_expected_generation<>v_generation then
  raise exception using errcode='40001',message='recurring dependency generation changed before publication binding';end if;
 perform public.static_weekly_assert_exact_object(p_decision,
  array['schema','implementationDigest','effectiveDate','timezone','compilerVersion','candidateSourceDigest',
    'recurringAvailabilityDigest','geographyDigest','assignments','gaps','fixedLunch','metrics','changes'],
  array['schema','implementationDigest','effectiveDate','timezone','compilerVersion','candidateSourceDigest',
    'recurringAvailabilityDigest','geographyDigest','assignments','gaps','fixedLunch','metrics','changes','shiftEnd'],
  'recurring displayed decision');
 if p_decision->>'schema' is distinct from 'memphis-zoo.recurring-manager-decision.v1'
  or p_decision->>'effectiveDate' is distinct from v_parent.effective_start::text
  or p_decision->>'timezone' is distinct from 'America/Chicago'
  or p_decision->>'candidateSourceDigest' is distinct from v_source.source_digest
  or p_decision->>'implementationDigest'!~'^[0-9a-f]{64}$'
  or p_decision->>'compilerVersion' is distinct from v_version.draft_document#>>'{authority,optimizerResult,compilerVersion}'
  or p_decision->'metrics' is distinct from v_version.draft_document#>'{authority,optimizerResult,metrics}'
  or jsonb_typeof(p_decision->'assignments') is distinct from 'array'
  or jsonb_typeof(p_decision->'fixedLunch') is distinct from 'object'
  or jsonb_typeof(p_decision->'gaps') is distinct from 'object'
  or jsonb_typeof(p_decision->'changes') is distinct from 'array'
  or not (p_decision ? 'shiftEnd') then
  raise exception using errcode='23514',message='recurring displayed decision does not match its attested publication';end if;
 -- Compare every canonical assignment byte by identity, independent of SQL
 -- collation and Node's stable sort. No browser-supplied subset is accepted.
 if jsonb_array_length(p_decision->'assignments')=0
  or (select count(*)<>count(distinct a->>'planWorkId') from jsonb_array_elements(p_decision->'assignments') a)
  or exists(with displayed as (
    select a->>'planWorkId' id,public.static_weekly_v18_canonical_display_assignment(a) body
    from jsonb_array_elements(p_decision->'assignments') a
   ),attested as (
    select a->>'planWorkId' id,a body from jsonb_array_elements(v_version.draft_document#>'{authority,optimizerResult,assignments}') a
   ) select 1 from displayed d full join attested a using(id) where d.id is null or a.id is null or d.body is distinct from a.body) then
  raise exception using errcode='23514',message='recurring displayed assignments differ from the complete attested publication';end if;
 v_dependencies:=public.static_weekly_v17_recurring_dependency_snapshot(v_source.source_id,v_parent.effective_start);
 if v_dependencies#>'{snapshot,sourceActive}' is distinct from 'true'::jsonb
  or v_dependencies#>>'{snapshot,sourceDigest}' is distinct from v_source.source_digest then
  raise exception using errcode='23514',message='recurring publication source is no longer active and intact';end if;
 v_digest:=public.static_weekly_digest_jsonb(p_decision);
 select publication_id into v_predecessor from public.weekly_schedule_publications where version_id=v_publication.prior_version_id;
 select * into v_existing from public.static_weekly_recurring_publication_bindings where operation_id=v_parent.operation_id;
 if found then
  if v_existing.publication_id is distinct from p_publication_id or v_existing.owner_xid<>pg_current_xact_id()
   or v_existing.decision_json is distinct from p_decision or v_existing.decision_digest<>v_digest
   or v_existing.recurring_generation<>v_generation or v_existing.dependency_snapshot is distinct from v_dependencies->'snapshot'
   or v_existing.dependency_digest is distinct from v_dependencies->>'digest' then
   raise exception using errcode='23505',message='recurring parent already binds different publication dependencies';end if;
 else
  insert into public.static_weekly_recurring_publication_bindings(publication_id,operation_id,source_id,source_digest,
   effective_start,recurring_generation,predecessor_publication_id,implementation_digest,decision_json,decision_digest,
   dependency_snapshot,dependency_digest)
  values(p_publication_id,v_parent.operation_id,v_source.source_id,v_source.source_digest,v_parent.effective_start,
   v_generation,v_predecessor,p_decision->>'implementationDigest',p_decision,v_digest,v_dependencies->'snapshot',v_dependencies->>'digest');
 end if;
 return jsonb_build_object('state','BOUND_PENDING_FINALIZATION','publicationId',p_publication_id,
  'operationId',v_parent.operation_id,'recurringGeneration',v_generation,'dependencyDigest',v_dependencies->>'digest',
  'decisionDigest',v_digest,'predecessorPublicationId',v_predecessor,'accepted',false,'affectedPhonesUpdated',false);
end
$function$;
revoke all on function public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb) to static_weekly_control_plane;

-- Future private finalizer must bind this row; a structurally complete old
-- receipt cannot omit the accepted decision/roster generation. Still no public
-- receipt writer or standalone source/publication commit path exists.
do $receipt$
declare v_definition text;v_seam text:='if v_parent.owner_xid<>pg_current_xact_id()';
begin
 v_definition:=pg_get_functiondef('public.static_weekly_v13_guard_recurring_receipt()'::regprocedure);
 if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'recurring publication receipt seam changed';end if;
 execute replace(v_definition,v_seam,v_seam||E'\n    or not exists(select 1 from public.static_weekly_recurring_publication_bindings b\n      where b.operation_id=new.operation_id and b.publication_id=new.publication_id\n        and b.source_id=new.source_id and b.source_digest=new.source_digest and b.owner_xid=pg_current_xact_id()\n        and b.recurring_generation=(select generation from public.static_weekly_recurring_generation where singleton))');
end
$receipt$;

do $surface$
declare v_definition text;v_seam text:='  values';
begin
 v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'recurring publication binding canary seam changed';end if;
 execute replace(v_definition,v_seam,v_seam||E'\n'||$rows$
 ('relation','public.static_weekly_recurring_publication_bindings','recurring decision and roster publication binding'),
 ('function','public.static_weekly_v18_canonical_display_assignment(jsonb)','recurring canonical displayed assignment boundary'),
 ('function','public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb)','recurring decision and roster publication binding'),
 ('trigger','public.static_weekly_recurring_publication_bindings.trg_recurring_publication_binding_immutable','recurring decision and roster publication binding'),
 $rows$);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with relations(name) as (values('public.static_weekly_recurring_publication_bindings')),
 funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where oid in (
  'public.static_weekly_v18_canonical_display_assignment(jsonb)'::regprocedure,
  'public.static_weekly_v18_bind_recurring_publication(uuid,uuid,uuid,bigint,jsonb)'::regprocedure,
  'public.static_weekly_v13_guard_recurring_receipt()'::regprocedure,
  'public.custodial_release_canary_authority_surface()'::regprocedure)),objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.name::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.name||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing recurring publication recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant')
    and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
