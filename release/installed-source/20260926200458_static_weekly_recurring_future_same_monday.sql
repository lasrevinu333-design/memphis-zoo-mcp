-- H03 future same-Monday replacement. This does NOT expose a confirmation
-- endpoint or complete its receipt: derived publications still cannot commit
-- until the full parent outcome (including phone targets) exists.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.static_weekly_v16_assert_future_same_monday(
  p_draft_version_id uuid,p_previous_version_id uuid,p_manager_id uuid,
  p_idempotency_key text,p_publication_kind text,p_rollback_of_version_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_draft public.weekly_schedule_versions%rowtype;v_previous public.weekly_schedule_publications%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into strict v_draft from public.weekly_schedule_versions where version_id=p_draft_version_id;
  select * into strict v_previous from public.weekly_schedule_publications where version_id=p_previous_version_id;
  if v_draft.effective_start is distinct from v_previous.effective_start
    or v_draft.effective_start<=public.sch_service_date(statement_timestamp())
    or extract(isodow from v_draft.effective_start)<>1
    or p_publication_kind is distinct from 'supersede' or p_rollback_of_version_id is not null
    or not exists(select 1 from public.static_weekly_recurring_source_bindings
      where source_id=v_draft.authority_source_id and owner_xid=pg_current_xact_id())
    or exists(select 1 from public.weekly_schedule_publications p
      where p.effective_start=v_previous.effective_start and p.authority_revision>v_previous.authority_revision) then
    raise exception using errcode='23514',message='same-Monday replacement requires the exact latest future recurring winner and its parent transaction';
  end if;
  perform public.static_weekly_v14_assert_recurring_source_use(v_draft.authority_source_id,
    p_manager_id,v_draft.effective_start,p_idempotency_key,'publish');
end
$function$;
revoke all on function public.static_weekly_v16_assert_future_same_monday(uuid,uuid,uuid,text,text,uuid)
  from public,anon,authenticated,service_role,static_weekly_control_plane,
    static_weekly_release_operator,custodial_application_reader;

-- Pick a winner BEFORE computing the next distinct Monday. Never filter on
-- validity here: future invalidation must block the winner, not reveal an old
-- predecessor. Historical publication/version/projection identities remain.
create or replace view public.v_weekly_schedule_effective_ranges as
with winners as (
  select distinct on (p.effective_start) v.version_id,v.version_number,p.effective_start,
    v.publication_kind,v.content_digest
  from public.weekly_schedule_publications p
  join public.weekly_schedule_versions v on v.version_id=p.version_id
  where v.lifecycle_state='published'
  order by p.effective_start,p.authority_revision desc
)
select version_id,version_number,effective_start,
  lead(effective_start) over(order by effective_start) as effective_end,
  publication_kind,content_digest from winners;

do $publisher$
declare v_definition text;v_old text;v_new text;
begin
  v_definition:=pg_get_functiondef('public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)'::regprocedure);
  v_old:='  if v_previous is null then';
  v_new:=$patch$  -- A future Monday can have a newer accepted winner even when another
  -- later Monday is already scheduled. The private guard below authorizes
  -- only parent-bound same-Monday replacement, never a legacy rollback.
  if exists(select 1 from public.weekly_schedule_publications where effective_start=v_draft.effective_start) then
    select version_id into v_previous from public.weekly_schedule_publications
      where effective_start=v_draft.effective_start order by authority_revision desc limit 1;
  end if;
  if v_previous is null then$patch$;
  if length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) then raise exception 'same-Monday previous selection seam changed';end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='if v_draft.effective_start <= (select effective_start from public.weekly_schedule_versions where version_id=v_previous) then raise exception using errcode=''23514'',message=''new authority must have a later effective start''; end if;';
  v_new:='if v_draft.effective_start <= (select effective_start from public.weekly_schedule_versions where version_id=v_previous) then perform public.static_weekly_v16_assert_future_same_monday(v_draft.version_id,v_previous,p_actor_manager_id,p_idempotency_key,p_publication_kind,p_rollback_of_version_id); end if;';
  if length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) then raise exception 'same-Monday publication guard seam changed';end if;
  v_definition:=replace(v_definition,v_old,v_new);
  -- Do not mutate accepted closure history or write a zero-length range for
  -- a duplicate Monday. prior_version_id records the exact predecessor;
  -- the winner-first view computes effective ranges from accepted revisions.
  v_old:='if v_previous is not null then insert into public.weekly_schedule_effective_range_closures';
  v_new:='if v_previous is not null and v_draft.effective_start > (select effective_start from public.weekly_schedule_versions where version_id=v_previous) then insert into public.weekly_schedule_effective_range_closures';
  if length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) then raise exception 'same-Monday closure seam changed';end if;
  execute replace(v_definition,v_old,v_new);
end
$publisher$;

do $surface$
declare v_definition text;v_seam text:='  values';
begin
  v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'same-Monday canary seam changed';end if;
  execute replace(v_definition,v_seam,v_seam||E'\n'||
    '(''function'',''public.static_weekly_v16_assert_future_same_monday(uuid,uuid,uuid,text,text,uuid)'',''future same-Monday parent-only authority''),');
end
$surface$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
  for obj in with funcs as (
    select oid,'public.'||oid::regprocedure::text identity from pg_proc where oid in (
      'public.static_weekly_v16_assert_future_same_monday(uuid,uuid,uuid,text,text,uuid)'::regprocedure,
      'public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)'::regprocedure,
      'public.custodial_release_canary_authority_surface()'::regprocedure)
  ),objects as (
    select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
    union all select 800000,'view','public.v_weekly_schedule_effective_ranges',
      public.custodial_release_authority_current_view_definition('public.v_weekly_schedule_effective_ranges')
    union all select 900000,'grant',identity,
      public.custodial_release_authority_current_grant_definition(identity) from funcs
    union all select 900000,'grant','public.v_weekly_schedule_effective_ranges',
      public.custodial_release_authority_current_grant_definition('public.v_weekly_schedule_effective_ranges')
  ) select * from objects order by bucket,identity loop
    if obj.definition is null then raise exception 'missing same-Monday recovery object %',obj.identity;end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and (object_identity=obj.identity or
        case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
          then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
    if not found then
      select coalesce(max(restore_order),obj.bucket)+1 into v_order
        from public.custodial_release_authority_restore_inventory where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
      insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
