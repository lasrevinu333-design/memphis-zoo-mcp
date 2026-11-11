-- Record semantic changes inside their owning transaction. Reconcile only
-- after that writer has completed its existing revision/projection/lunch
-- chain, before COMMIT. A deferred guard rejects a missed reconciliation;
-- no separately committed dirty queue or independently running worker exists.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.static_weekly_recurring_dependency_changes (
 change_id uuid primary key default gen_random_uuid(),
 owner_xid xid8 not null default pg_current_xact_id(),
 generation bigint not null check(generation between 0 and 9007199254740991),
 origin_table text not null check(origin_table in ('employees','weekly_roster_slots',
  'weekly_roster_slot_incumbencies','weekly_roster_slot_incumbency_closures',
  'weekly_roster_slot_staffing_states','static_weekly_authority_source_documents')),
 origin_operation text not null check(origin_operation in ('INSERT','UPDATE','DELETE')),
 origin_session_user text not null,
 before_json jsonb not null,after_json jsonb not null,
 created_at timestamptz not null default statement_timestamp()
);
create index static_weekly_recurring_dependency_changes_xid on public.static_weekly_recurring_dependency_changes(owner_xid,change_id);
create table public.static_weekly_recurring_dependency_checks (
 change_id uuid primary key references public.static_weekly_recurring_dependency_changes(change_id) on delete restrict,
 processed_by_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 result_json jsonb not null check(jsonb_typeof(result_json)='object'),
 result_digest text not null check(result_digest~'^[0-9a-f]{64}$'),
 checked_at timestamptz not null default statement_timestamp()
);
create index static_weekly_recurring_dependency_checks_manager on public.static_weekly_recurring_dependency_checks(processed_by_manager_id);
do $tables$
declare t text;
begin
 foreach t in array array['static_weekly_recurring_dependency_changes','static_weekly_recurring_dependency_checks'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  execute format('create trigger trg_recurring_dependency_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',t);
 end loop;
end
$tables$;

create function public.static_weekly_v21_track_dependency_change(p_table text,p_operation text,p_before jsonb,p_after jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_keys text[];v_before jsonb;v_after jsonb;
begin
 -- Publishing a separately validated version changes generation but is not
 -- a staffing edit. Registration and semantic no-ops are filtered by v15.
 if p_table='weekly_schedule_publications' then return;end if;
 if not exists(select 1 from public.static_weekly_recurring_publication_bindings b
  join public.weekly_schedule_publications p using(publication_id)
  join public.v_weekly_schedule_effective_ranges r using(version_id)
  where r.effective_start>public.sch_service_date(statement_timestamp())) then return;end if;
 v_keys:=case p_table
  when 'employees' then array['id','employee_code','display_name','active']
  when 'weekly_roster_slots' then array['slot_id','slot_code','slot_label']
  when 'weekly_roster_slot_incumbencies' then array['incumbency_id','slot_id','person_id','person_name_snapshot','effective_start','effective_end']
  when 'weekly_roster_slot_incumbency_closures' then array['incumbency_closure_id','closed_incumbency_id','replacement_incumbency_id','closed_at_effective_date']
  when 'weekly_roster_slot_staffing_states' then array['staffing_state_id','slot_id','employee_id','staffing_state','effective_start']
  when 'static_weekly_authority_source_documents' then array['source_id','active','retired_at','source_digest'] end;
 if v_keys is null or p_operation not in ('INSERT','UPDATE','DELETE') then raise exception 'unknown recurring dependency change';end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_before from jsonb_each(coalesce(p_before,'{}'::jsonb)) where key=any(v_keys);
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_after from jsonb_each(coalesce(p_after,'{}'::jsonb)) where key=any(v_keys);
 if p_table='static_weekly_authority_source_documents' then
  -- Record exact content identity without copying the large private source.
  v_before:=v_before||jsonb_build_object('canonical_source_digest',public.static_weekly_digest_jsonb(p_before->'canonical_source'));
  v_after:=v_after||jsonb_build_object('canonical_source_digest',public.static_weekly_digest_jsonb(p_after->'canonical_source'));
 end if;
 if v_before=v_after then return;end if;
 insert into public.static_weekly_recurring_dependency_changes(generation,origin_table,origin_operation,origin_session_user,before_json,after_json)
 select generation,p_table,p_operation,session_user,v_before,v_after from public.static_weekly_recurring_generation where singleton;
 if not found then raise exception 'recurring dependency generation unavailable';end if;
end
$function$;

create function public.static_weekly_v21_require_reconciled_dependency_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
 if new.owner_xid<>pg_current_xact_id() or not exists(
  select 1 from public.static_weekly_recurring_dependency_checks c where c.change_id=new.change_id
   and c.result_digest=public.static_weekly_digest_jsonb(c.result_json)) then
  raise exception using errcode='23514',message='recurring dependency change cannot commit without atomic future validity reconciliation';end if;
 return null;
end
$function$;
create constraint trigger trg_recurring_dependency_complete after insert on public.static_weekly_recurring_dependency_changes
 deferrable initially deferred for each row execute function public.static_weekly_v21_require_reconciled_dependency_change();

-- Compare each actual service day with the corresponding weekday's accepted
-- recurring facts, not its old absolute date. This detects later-week changes
-- at known effective-start/end/closure boundaries without expanding infinity.
create function public.static_weekly_v21_first_changed_dependency_date(p_publication uuid,p_week date)
returns date language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare b public.static_weekly_recurring_publication_bindings%rowtype;v_current jsonb;v_date date;
begin
 select * into strict b from public.static_weekly_recurring_publication_bindings where publication_id=p_publication;
 v_current:=public.static_weekly_v17_recurring_dependency_snapshot(b.source_id,p_week)->'snapshot';
 if (v_current-array['weekStart','weekEnd','roster']) is distinct from
  (b.dependency_snapshot-array['weekStart','weekEnd','roster']) then return p_week;end if;
 select min((actual->>'serviceDate')::date) into v_date from jsonb_array_elements(v_current->'roster') actual
 where not exists(select 1 from jsonb_array_elements(b.dependency_snapshot->'roster') expected
  where expected->>'slotId'=actual->>'slotId'
   and extract(isodow from (expected->>'serviceDate')::date)=extract(isodow from (actual->>'serviceDate')::date)
   and (actual-'serviceDate')=(expected-'serviceDate'));
 return v_date;
end
$function$;

create function public.static_weekly_v21_reconcile_dependency_changes(p_manager_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_ids uuid[];v_binding record;v_week date;v_date date;v_first date;v_revision bigint;
 v_source public.static_weekly_authority_source_documents%rowtype;v_result jsonb;v_checked jsonb:='[]';
 v_effects jsonb:='[]';v_dependency jsonb;v_existing public.static_weekly_recurring_invalidations%rowtype;
 v_day date;v_state jsonb;v_count int;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 select array_agg(c.change_id order by c.generation,c.change_id) into v_ids
 from public.static_weekly_recurring_dependency_changes c where c.owner_xid=pg_current_xact_id()
  and not exists(select 1 from public.static_weekly_recurring_dependency_checks done where done.change_id=c.change_id);
 if cardinality(v_ids)>0 then
  for v_binding in select b.*,r.effective_end from public.static_weekly_recurring_publication_bindings b
   join public.weekly_schedule_publications p using(publication_id)
   join public.v_weekly_schedule_effective_ranges r using(version_id)
   where r.effective_start>public.sch_service_date(statement_timestamp())
   order by r.effective_start,b.publication_id loop
   v_first:=null;
   for v_week in select distinct week_start from (
    select v_binding.effective_start week_start
    union all
    select date_trunc('week',field.value::date::timestamp)::date
    from public.static_weekly_recurring_dependency_changes c
    cross join lateral (values(c.before_json),(c.after_json)) body(value)
    cross join lateral jsonb_each_text(body.value) field
    where c.change_id=any(v_ids) and field.key in ('effective_start','effective_end','closed_at_effective_date')
     and field.value is not null and pg_input_is_valid(field.value,'date')
     and isfinite(field.value::date)
   ) weeks where week_start>=v_binding.effective_start
    and (v_binding.effective_end is null or week_start<v_binding.effective_end) order by week_start loop
    v_date:=public.static_weekly_v21_first_changed_dependency_date(v_binding.publication_id,v_week);
    if v_date is not null and (v_binding.effective_end is null or v_date<v_binding.effective_end) then
     v_first:=least(v_first,v_date);end if;
   end loop;
   v_checked:=v_checked||jsonb_build_array(jsonb_build_object('publicationId',v_binding.publication_id,'firstChangedDate',v_first));
   if v_first is null then continue;end if;
   select * into v_existing from public.static_weekly_recurring_invalidations i where i.publication_id=v_binding.publication_id
    and i.effective_start<=v_first and (i.effective_end is null or (v_binding.effective_end is not null and i.effective_end>=v_binding.effective_end))
    order by i.authority_revision desc limit 1;
   if found then
    -- An already terminal winner stays terminal; new/current principals still
    -- acquire their exact pending targets. Do not fabricate another revision.
    for v_day in select distinct x.week_start+n from public.weekly_schedule_compiled_projections x
     cross join generate_series(0,6) n where x.publication_id=v_binding.publication_id
      and x.week_start+n>=v_existing.effective_start
      and (v_existing.effective_end is null or x.week_start+n<v_existing.effective_end) order by 1 loop
     perform public.static_weekly_v19_reconcile_terminal_date(v_day);
    end loop;
    v_effects:=v_effects||jsonb_build_array(jsonb_build_object('invalidationId',v_existing.invalidation_id,
     'publicationId',v_binding.publication_id,'authorityRevision',v_existing.authority_revision,'state','BLOCKED_RECURRING_AUTHORITY','existing',true));
   else
    select * into strict v_source from public.static_weekly_authority_source_documents where source_id=v_binding.source_id;
    select current_revision into strict v_revision from public.static_weekly_schedule_control where singleton;
    v_week:=date_trunc('week',v_first::timestamp)::date;
    v_dependency:=public.static_weekly_v17_recurring_dependency_snapshot(v_binding.source_id,v_week);
    v_state:=public.static_weekly_v19_invalidate_recurring_range(p_manager_id,gen_random_uuid(),v_binding.publication_id,
     v_first,v_binding.effective_end,case when not v_source.active or v_source.retired_at is not null then 'SOURCE_RETIRED' else 'ROSTER_DEPENDENCY_CHANGED' end,
     v_dependency->>'digest',v_revision);
    v_effects:=v_effects||jsonb_build_array(v_state||jsonb_build_object('publicationId',v_binding.publication_id));
   end if;
  end loop;
  select current_revision into strict v_revision from public.static_weekly_schedule_control where singleton;
  v_result:=jsonb_build_object('schema','static-weekly.recurring-dependency-reconciliation.v1',
   'changeIds',to_jsonb(v_ids),'processedByManagerId',p_manager_id,'authorityRevision',v_revision,
   'checkedPublications',v_checked,'invalidations',v_effects,'affectedPhonesUpdated',false);
  insert into public.static_weekly_recurring_dependency_checks(change_id,processed_by_manager_id,result_json,result_digest)
   select id,p_manager_id,v_result,public.static_weekly_digest_jsonb(v_result) from unnest(v_ids) id;
 end if;
 -- Return current future blocked state separately from any historical accepted
 -- mutation response, including an exact retry with no new dependency changes.
 select coalesce(jsonb_agg(jsonb_build_object('publicationId',p.publication_id,'invalidationId',i.invalidation_id,
  'effectiveStart',i.effective_start,'effectiveEnd',i.effective_end,'authorityRevision',i.authority_revision,
  'state','BLOCKED_RECURRING_AUTHORITY') order by r.effective_start,i.authority_revision),'[]'::jsonb) into v_state
 from public.v_weekly_schedule_effective_ranges r join public.weekly_schedule_publications p using(version_id)
 join public.static_weekly_recurring_invalidations i on i.publication_id=p.publication_id
 where r.effective_start>public.sch_service_date(statement_timestamp());
 select current_revision into strict v_revision from public.static_weekly_schedule_control where singleton;
 return jsonb_build_object('processedChangeCount',coalesce(cardinality(v_ids),0),'authorityRevision',v_revision,
  'invalidations',v_effects,'blockedPublications',v_state,'affectedPhonesUpdated',false);
end
$function$;
revoke all on function public.static_weekly_v21_track_dependency_change(text,text,jsonb,jsonb),
 public.static_weekly_v21_require_reconciled_dependency_change(),
 public.static_weekly_v21_first_changed_dependency_date(uuid,date),
 public.static_weekly_v21_reconcile_dependency_changes(uuid)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v21_reconcile_dependency_changes(uuid) to static_weekly_control_plane;

do $hook$
declare definition text;seam text:='  if not found then raise exception ''recurring generation singleton is missing'';end if;';
 old_filter text;new_filter text;
begin
 definition:=pg_get_functiondef('public.static_weekly_v15_advance_recurring_generation()'::regprocedure);
 -- A bound contractor/other roster identity is also a real dependency, even
 -- without an EMP code. Keep unrelated non-custodial users filtered out.
 foreach old_filter in array array[
  'if tg_op=''INSERT'' and new.employee_code!~''^EMP[0-9]+$'' then return null;end if;',
  'if tg_op=''DELETE'' and old.employee_code!~''^EMP[0-9]+$'' then return null;end if;',
  'if tg_op=''UPDATE'' and new.employee_code!~''^EMP[0-9]+$'' and old.employee_code!~''^EMP[0-9]+$'' then return null;end if;'] loop
  if length(definition)-length(replace(definition,old_filter,''))<>length(old_filter) then raise exception 'roster-bound employee filter seam changed';end if;
  new_filter:=replace(old_filter,' then return null;end if;',
   ' and not exists(select 1 from public.weekly_roster_slot_incumbencies i where i.person_id='||
   case when old_filter like '%tg_op=''DELETE''%' then 'old.id' else 'new.id' end||') then return null;end if;');
  definition:=replace(definition,old_filter,new_filter);
 end loop;
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then raise exception 'recurring generation tracking seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||$call$
  perform public.static_weekly_v21_track_dependency_change(tg_table_name,tg_op,
   case when tg_op='INSERT' then null else to_jsonb(old) end,
   case when tg_op='DELETE' then null else to_jsonb(new) end);
 $call$);
end
$hook$;

-- The manager must see the same terminal winner as the employee authority
-- reader. Retain current publication/roster/history, but never expose its
-- invalidated assignments as a usable or merely rebuildable projection.
do $manager_read$
declare definition text;
 seam text:='  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_staffing_base(p_week_start);';
begin
 definition:=pg_get_functiondef('public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam)
  or length(definition)-length(replace(definition,'  v_roster jsonb;',''))<>length('  v_roster jsonb;') then
  raise exception 'manager recurring terminal readback seam changed';end if;
 definition:=replace(definition,'  v_roster jsonb;','  v_roster jsonb; v_terminal jsonb;');
 execute replace(definition,seam,seam||E'\n'||$guard$
  select jsonb_agg(jsonb_build_object('invalidationId',r.invalidation_id,'publicationId',r.publication_id,
    'authorityRevision',r.authority_revision,'effectiveStart',r.effective_start,'effectiveEnd',r.effective_end,
    'state','BLOCKED_RECURRING_AUTHORITY') order by r.authority_revision,r.invalidation_id) into v_terminal
  from (select distinct i.invalidation_id,i.publication_id,i.authority_revision,i.effective_start,i.effective_end
    from generate_series(0,6) offset_day
    cross join lateral public.static_weekly_v19_current_terminal_range(p_week_start+offset_day) i
    where i.invalidation_id is not null) r;
  if v_terminal is not null then
    return v_snapshot||jsonb_build_object('projection_status','blocked_recurring_authority',
      'latest_projection',null,'assignments','[]'::jsonb,'recurring_invalidations',v_terminal,
      'recurring_repair_required',true);
  end if;
 $guard$);
end
$manager_read$;

do $surface$
declare definition text;rows_sql text;seam text:='  values';
begin
 select string_agg(format('(%L,%L,%L)',kind,identity,'atomic recurring dependency reconciliation'),E',\n' order by kind,identity)||',' into rows_sql
 from (
  select 'relation' kind,'public.'||name identity from unnest(array['static_weekly_recurring_dependency_changes','static_weekly_recurring_dependency_checks']) name
  union all select 'function','public.'||oid::regprocedure::text from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_v21_%'
  union all select 'trigger','public.'||c.relname||'.'||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where t.tgname in ('trg_recurring_dependency_immutable','trg_recurring_dependency_complete')
 ) objects;
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then raise exception 'dependency reconciliation canary seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||rows_sql);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with relations(name) as (values('public.static_weekly_recurring_dependency_changes'),('public.static_weekly_recurring_dependency_checks')),
 funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where pronamespace='public'::regnamespace
  and (proname like 'static_weekly_v21_%' or oid in ('public.static_weekly_v15_advance_recurring_generation()'::regprocedure,
    'public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure))),objects as (
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
  if obj.definition is null then raise exception 'missing recurring dependency recovery object %',obj.identity;end if;
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
