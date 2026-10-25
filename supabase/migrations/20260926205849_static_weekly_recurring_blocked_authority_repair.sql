-- Stop ordinary authority/source/materialization readers at a durable terminal
-- range, while exposing a distinct named-manager repair basis. The repair is
-- only an older SOURCE PATTERN hydrated with CURRENT roster facts, never an
-- old publication made current. Confirmation and automatic invalidation remain
-- separate integration gates; no new acceptance writer is introduced here.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.static_weekly_v20_assert_usable_recurring_week(p_publication uuid,p_week date)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
 if p_week is null or not isfinite(p_week) then raise exception 'recurring authority requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if exists(select 1 from public.static_weekly_recurring_invalidations i where i.publication_id=p_publication
  and i.effective_start<=p_week+6 and (i.effective_end is null or p_week<i.effective_end)) then
  raise exception using errcode='23514',message='recurring authority blocked pending explicit manager repair';end if;
end
$function$;
revoke all on function public.static_weekly_v20_assert_usable_recurring_week(uuid,date)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

do $authority$
declare v_definition text;v_seam text:='  select projection.projection_id, (receipt.response_json->>''revision'')::bigint';
begin
 v_definition:=pg_get_functiondef('public.static_weekly_v6_schedule_authority_state(date)'::regprocedure);
 if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'recurring terminal authority-state seam changed';end if;
 execute replace(v_definition,v_seam,$guard$
  if exists(select 1 from public.static_weekly_recurring_invalidations i
    where i.publication_id=v_publication_id and i.effective_start<=p_service_date
      and (i.effective_end is null or p_service_date<i.effective_end)) then
    return query select p_service_date,true,'static_weekly_projection'::text,
      'blocked_recurring_authority'::text,v_version_id,v_publication_id,null::uuid,
      (select max(i.authority_revision) from public.static_weekly_recurring_invalidations i
        where i.publication_id=v_publication_id and i.effective_start<=p_service_date
          and (i.effective_end is null or p_service_date<i.effective_end)),
      null::bigint,v_week_start;
    return;
  end if;
$guard$||v_seam);
end
$authority$;
do $consumers$
declare v_signature text;v_definition text;v_guard text;
 v_seam text:='perform public.static_weekly_v3_assert_control_plane();';
begin
 foreach v_signature in array array[
  'public.static_weekly_v3_read_publication_source(uuid,date)',
  'public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text)'] loop
  v_definition:=pg_get_functiondef(v_signature::regprocedure);
  if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'recurring blocked-source seam changed %',v_signature;end if;
  v_guard:=' perform public.static_weekly_v20_assert_usable_recurring_week(p_publication_id,p_service_date);';
  execute replace(v_definition,v_seam,v_seam||v_guard);
 end loop;
end
$consumers$;

create function public.static_weekly_v20_read_recurring_preview_basis(p_manager uuid,p_week date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_winner public.weekly_schedule_publications%rowtype;v_pattern record;v_invalidations jsonb;
 v_revision bigint;v_context jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager);
 if p_week is null or not isfinite(p_week) or extract(isodow from p_week)<>1
  or p_week<=public.sch_service_date(statement_timestamp()) then
  raise exception using errcode='22023',message='recurring repair preview requires one future Monday';end if;
 select * into v_winner from public.weekly_schedule_publications
  where version_id=public.static_weekly_effective_version(p_week);
 if not found then raise exception using errcode='23514',message='recurring preview has no effective publication';end if;
 select jsonb_agg(jsonb_build_object('invalidationId',i.invalidation_id,'authorityRevision',i.authority_revision,
  'effectiveStart',i.effective_start,'effectiveEnd',i.effective_end,'reasonCode',i.reason_code)
  order by i.authority_revision,i.invalidation_id) into v_invalidations
 from public.static_weekly_recurring_invalidations i where i.publication_id=v_winner.publication_id
  and i.effective_start<=p_week+6 and (i.effective_end is null or p_week<i.effective_end);
 if v_invalidations is null then return public.static_weekly_v3_read_publication_source(v_winner.publication_id,p_week);end if;
 select p.publication_id,p.version_id,v.authority_source_id,s.source_digest,v.draft_document into v_pattern
 from public.weekly_schedule_publications p join public.weekly_schedule_versions v using(version_id)
 join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
 where p.authority_revision<v_winner.authority_revision and p.effective_start<=p_week
  and s.active=true and s.retired_at is null and s.source_digest=public.static_weekly_digest_jsonb(s.canonical_source)
  and not exists(select 1 from public.static_weekly_recurring_invalidations i where i.publication_id=p.publication_id
   and i.effective_start<=p_week+6 and (i.effective_end is null or p_week<i.effective_end))
 order by p.effective_start desc,p.authority_revision desc limit 1;
 if not found then raise exception using errcode='23514',message='no preceding valid registered source pattern is available for recurring repair';end if;
 select current_revision into strict v_revision from public.static_weekly_schedule_control where singleton;
 v_context:=jsonb_build_object('schema','static-weekly.recurring-repair-basis.v1',
  'state','REPLACING_INVALID_FUTURE','effectivePublicationId',v_winner.publication_id,
  'patternPublicationId',v_pattern.publication_id,'patternSourceId',v_pattern.authority_source_id,
  'patternSourceDigest',v_pattern.source_digest,'effectiveStart',p_week,'authorityRevision',v_revision,
  'invalidations',v_invalidations,'managerConfirmationRequired',true,'published',false);
 return jsonb_build_object('source_id',v_pattern.authority_source_id,
  'compiler_input',public.static_weekly_v4_hydrate_compiler_source(v_pattern.draft_document#>'{authority,compilerInput}',p_week),
  'exceptions','[]'::jsonb,'publication_id',v_pattern.publication_id,'version_id',v_pattern.version_id,
  'authority_revision',v_revision,'repair_context',v_context,'repair_context_digest',public.static_weekly_digest_jsonb(v_context));
end
$function$;
revoke all on function public.static_weekly_v20_read_recurring_preview_basis(uuid,date)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v20_read_recurring_preview_basis(uuid,date) to static_weekly_control_plane;

do $surface$
declare v_definition text;v_seam text:='  values';
begin
 v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'recurring repair canary seam changed';end if;
 execute replace(v_definition,v_seam,v_seam||E'\n'||$rows$
 ('function','public.static_weekly_v20_assert_usable_recurring_week(uuid,date)','terminal recurring authority enforcement'),
 ('function','public.static_weekly_v20_read_recurring_preview_basis(uuid,date)','explicit prior pattern repair basis with current roster'),
 $rows$);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order int;
begin
 for obj in with funcs as (
  select oid,'public.'||oid::regprocedure::text identity from pg_proc where oid in (
   'public.static_weekly_v20_assert_usable_recurring_week(uuid,date)'::regprocedure,
   'public.static_weekly_v20_read_recurring_preview_basis(uuid,date)'::regprocedure,
   'public.static_weekly_v6_schedule_authority_state(date)'::regprocedure,
   'public.static_weekly_v3_read_publication_source(uuid,date)'::regprocedure,
   'public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text)'::regprocedure,
   'public.custodial_release_canary_authority_surface()'::regprocedure)),objects as (
  select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing recurring repair recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant')
    and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
