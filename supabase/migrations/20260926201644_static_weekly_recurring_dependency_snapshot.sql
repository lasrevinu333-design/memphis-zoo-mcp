-- Internal H03 recurring dependency read. Deliberately independent of the
-- effective-publication/validity selectors so a blocked winner can be repaired.
-- This is ONE week of source + roster facts, not the future-range invalidator.
-- Later-week materialization must request its own week; no indefinite validity
-- or phone update follows from this snapshot alone.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.static_weekly_v17_recurring_dependency_snapshot(p_source_id uuid,p_week_start date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_source public.static_weekly_authority_source_documents%rowtype;
  v_slots jsonb;v_roster jsonb;v_body jsonb;
begin
  if p_source_id is null or p_week_start is null or not isfinite(p_week_start)
    or extract(isodow from p_week_start)<>1 then
    raise exception using errcode='22023',message='recurring dependency snapshot requires one source and Monday';
  end if;
  select * into v_source from public.static_weekly_authority_source_documents where source_id=p_source_id;
  if not found then raise exception using errcode='23514',message='recurring dependency source is unknown';end if;
  if jsonb_typeof(v_source.canonical_source->'slots') is distinct from 'array'
    or jsonb_array_length(v_source.canonical_source->'slots')=0
    or v_source.source_digest<>public.static_weekly_digest_jsonb(v_source.canonical_source) then
    raise exception using errcode='23514',message='recurring dependency source bytes are not intact';
  end if;
  if exists(select 1 from jsonb_array_elements(v_source.canonical_source->'slots') s
      where s->>'id' is null or not pg_input_is_valid(s->>'id','uuid')
        or (s ? 'contractorCapacity' and jsonb_typeof(s->'contractorCapacity') is distinct from 'boolean'))
    or (select count(*)<>count(distinct s->>'id') from jsonb_array_elements(v_source.canonical_source->'slots') s) then
    raise exception using errcode='23514',message='recurring dependency source requires exact unique registered positions';
  end if;
  if (select count(*)<>count(distinct (s->>'id')::uuid) from jsonb_array_elements(v_source.canonical_source->'slots') s)
    or exists(select 1 from jsonb_array_elements(v_source.canonical_source->'slots') s
    left join public.weekly_roster_slots r on r.slot_id=(s->>'id')::uuid where r.slot_id is null) then
    raise exception using errcode='23514',message='recurring dependency source requires exact unique registered positions';
  end if;
  select jsonb_agg(jsonb_build_object('slotId',r.slot_id,'slotCode',r.slot_code,
    'slotLabel',r.slot_label,'contractorCapacity',coalesce(s->'contractorCapacity','false'::jsonb)) order by r.slot_id)
    into v_slots from jsonb_array_elements(v_source.canonical_source->'slots') s
    join public.weekly_roster_slots r on r.slot_id=(s->>'id')::uuid;
  if exists(
    select s->>'slotId',p_week_start+offset_day
    from jsonb_array_elements(v_slots) s cross join generate_series(0,6) offset_day
    join public.v_weekly_roster_slot_incumbency_ranges i on i.slot_id=(s->>'slotId')::uuid
      and i.effective_start<=p_week_start+offset_day
      and (i.effective_end is null or p_week_start+offset_day<i.effective_end)
    group by s->>'slotId',p_week_start+offset_day having count(*)>1
  ) then raise exception using errcode='23514',message='recurring dependency position has ambiguous dated incumbency';end if;
  select jsonb_agg(jsonb_build_object('slotId',s->'slotId','serviceDate',(p_week_start+offset_day)::text,
      'incumbencyId',i.incumbency_id,'personId',i.person_id,'incumbentName',i.person_name_snapshot,
      'employeeExists',e.id is not null,'employeeActive',e.active,
      'employeeName',e.display_name,'employeeCode',e.employee_code,
      'staffingPersonId',staffing.employee_id,'staffingState',staffing.staffing_state)
    order by s->>'slotId',offset_day) into v_roster
  from jsonb_array_elements(v_slots) s cross join generate_series(0,6) offset_day
  left join public.v_weekly_roster_slot_incumbency_ranges i on i.slot_id=(s->>'slotId')::uuid
    and i.effective_start<=p_week_start+offset_day
    and (i.effective_end is null or p_week_start+offset_day<i.effective_end)
  left join public.employees e on e.id=i.person_id
  left join lateral (select r.employee_id,r.staffing_state
    from public.weekly_roster_slot_staffing_states r where r.slot_id=(s->>'slotId')::uuid
      and r.effective_start<=p_week_start+offset_day
    order by r.effective_start desc,r.authority_revision desc limit 1) staffing on true;
  v_body:=jsonb_build_object('schema','static-weekly.recurring-dependency-snapshot.v1',
    'sourceId',v_source.source_id,'sourceDigest',v_source.source_digest,
    'sourceActive',v_source.active,'sourceRetiredAt',to_char(v_source.retired_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'weekStart',p_week_start,'weekEnd',p_week_start+6,'slots',v_slots,'roster',v_roster);
  return jsonb_build_object('snapshot',v_body,'digest',public.static_weekly_digest_jsonb(v_body));
end
$function$;
revoke all on function public.static_weekly_v17_recurring_dependency_snapshot(uuid,date)
 from public,anon,authenticated,service_role,static_weekly_control_plane,
   static_weekly_release_operator,custodial_application_reader;

do $surface$
declare v_definition text;v_seam text:='  values';
begin
  v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'recurring dependency canary seam changed';end if;
  execute replace(v_definition,v_seam,v_seam||E'\n'||
    '(''function'',''public.static_weekly_v17_recurring_dependency_snapshot(uuid,date)'',''internal recurring dependency snapshot''),');
end
$surface$;
alter table public.custodial_release_authority_restore_inventory
 disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with funcs as (
   select oid,'public.'||oid::regprocedure::text identity from pg_proc where oid in (
    'public.static_weekly_v17_recurring_dependency_snapshot(uuid,date)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure)
 ),objects as (
   select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
   union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
   if obj.definition is null then raise exception 'missing dependency snapshot recovery object %',obj.identity;end if;
   update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
    definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
    where object_kind=obj.kind and (object_identity=obj.identity or
     case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
      then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
   if not found then
    select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
      where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
    insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
   end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
 enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
