-- Move every live consumer of the former redundant semantic recurring source
-- to the exact attested compiler authority retained in the compact document.
begin;

create or replace function public.static_weekly_rollback_semantic_snapshot(p_document jsonb)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  select jsonb_set(
    jsonb_set(
      (p_document#>'{authority,compilerInput}')-'serviceDate'-'slots',
      '{version}',
      coalesce(p_document#>'{authority,compilerInput,version}','{}'::jsonb)-'id'-'publicationId'-'effectiveStart'-'effectiveEnd'-'status'-'contentDigest',true),
    '{slots}',
    coalesce((select jsonb_agg(jsonb_build_object('id',s.value->'id','label',s.value->'label') order by s.value->>'id')
      from jsonb_array_elements(coalesce(p_document#>'{authority,compilerInput,slots}','[]'::jsonb)) s(value)),'[]'::jsonb),true)
$function$;

create or replace function public.static_weekly_v3_read_publication_source(p_publication_id uuid,p_service_date date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_document jsonb; v_version uuid; v_source uuid;
begin
  perform public.static_weekly_v3_assert_control_plane();
  select v.draft_document,p.version_id,v.authority_source_id into v_document,v_version,v_source
  from public.weekly_schedule_publications p
  join public.weekly_schedule_versions v on v.version_id=p.version_id
  where p.publication_id=p_publication_id;
  if not found or v_source is null or public.static_weekly_effective_version(p_service_date) is distinct from v_version then
    raise exception using errcode='23514',message='control plane source must name the effective immutable publication and registered source';
  end if;
  return jsonb_build_object(
    'source_id',v_source::text,
    'compiler_input',public.static_weekly_v4_hydrate_compiler_source(v_document#>'{authority,compilerInput}',p_service_date),
    'exceptions',public.static_weekly_compiler_exception_set(p_publication_id,p_service_date),
    'publication_id',p_publication_id::text,
    'version_id',v_version::text,
    'authority_revision',(select current_revision from public.static_weekly_schedule_control where singleton)
  );
end
$function$;

create or replace function public.static_weekly_v4_assert_projection_envelope_single_location_base(
  p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_authority jsonb:=p_envelope->'authority'; v_base jsonb; v_compiler_exceptions jsonb; v_publication public.weekly_schedule_publications%rowtype;
begin
  perform public.static_weekly_assert_exact_object(p_envelope,array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity'],array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity'],'projection envelope');
  perform public.static_weekly_assert_exact_object(p_envelope->'adapter',array['schema','version'],array['schema','version'],'projection envelope adapter');
  if jsonb_typeof(p_exception_set) is distinct from 'array' or jsonb_typeof(p_envelope->'service_date') is distinct from 'string'
    or jsonb_typeof(p_envelope->'week_start') is distinct from 'string' or jsonb_typeof(p_envelope->'week_end') is distinct from 'string'
    or jsonb_typeof(p_envelope->'authority_digest') is distinct from 'string' or jsonb_typeof(p_envelope->'replay_digest') is distinct from 'string'
    or jsonb_typeof(p_envelope->'compiler_version') is distinct from 'string' or jsonb_typeof(p_envelope->'objective') is distinct from 'object'
    or jsonb_typeof(p_envelope->'metrics') is distinct from 'object' or jsonb_typeof(p_envelope->'applied_exceptions') is distinct from 'array'
    or jsonb_typeof(p_envelope->'assignments') is distinct from 'array' or jsonb_typeof(p_envelope->'database_projection_identity') is distinct from 'string' then
    raise exception using errcode='23514',message='projection envelope requires complete typed authority, receipt, identity, and assignment fields';
  end if;
  if jsonb_array_length(p_envelope->'assignments')=0 then raise exception using errcode='23514',message='projection assignments may not be empty'; end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x) where jsonb_typeof(a.x) is distinct from 'object' or not (a.x ?& array['plan_work_id','work_id','day_of_week','service_date','status','work_snapshot','explanation'])) then
    raise exception using errcode='23514',message='projection assignments require every identity, status, snapshot, and explanation key';
  end if;
  if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') as a(x)
      where jsonb_typeof(a.x->'plan_work_id') is distinct from 'string' or nullif(btrim(a.x->>'plan_work_id'),'') is null
        or jsonb_typeof(a.x->'work_id') is distinct from 'string' or nullif(btrim(a.x->>'work_id'),'') is null
        or jsonb_typeof(a.x->'day_of_week') is distinct from 'number' or (a.x->>'day_of_week') !~ '^[0-6]$'
        or jsonb_typeof(a.x->'service_date') is distinct from 'string' or nullif(btrim(a.x->>'service_date'),'') is null
        or (a.x->>'service_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not pg_input_is_valid(a.x->>'service_date','date')
        or case when jsonb_typeof(a.x->'service_date')='string' and (a.x->>'service_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and pg_input_is_valid(a.x->>'service_date','date') then (a.x->>'service_date')::date::text is distinct from a.x->>'service_date' or (a.x->>'service_date')::date<p_week_start or (a.x->>'service_date')::date>p_week_start+6 else false end
        or jsonb_typeof(a.x->'explanation') is distinct from 'object'
        or jsonb_typeof(a.x->'status') is distinct from 'string' or upper(a.x->>'status') not in ('ASSIGNED','OPEN','REVIEW')) then
    raise exception using errcode='23514',message='projection assignments require complete canonical seven-day identity, status, and explanation facts';
  end if;
  if (select count(*) from jsonb_array_elements(p_envelope->'assignments'))<>(select count(distinct x->>'plan_work_id') from jsonb_array_elements(p_envelope->'assignments') as a(x)) then
    raise exception using errcode='23514',message='projection assignments may not contain duplicate work identities';
  end if;
  select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id;
  if not found then raise exception using errcode='23514',message='projection publication is unknown'; end if;
  select draft_document#>'{authority,compilerInput}' into v_base from public.weekly_schedule_versions where version_id=v_publication.version_id;
  v_compiler_exceptions:=public.static_weekly_compiler_exception_set(p_publication_id,p_week_start);
  perform public.static_weekly_assert_compiler_authority(v_authority,p_envelope->'receipt',p_week_start,false);
  if p_envelope #>> '{adapter,schema}' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1' or p_envelope #>> '{adapter,version}' is distinct from 'static-weekly-database-adapter-v1' or p_envelope->>'service_date' is distinct from p_week_start::text or p_envelope->>'week_start' is distinct from p_week_start::text or p_envelope->>'week_end' is distinct from (p_week_start+6)::text
    or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(v_authority) or p_envelope->>'replay_digest' is distinct from p_envelope #>>'{receipt,compiler,replayDigest}'
    or p_envelope->>'compiler_version' is distinct from v_authority #>>'{optimizerResult,compilerVersion}' or p_envelope->'objective' is distinct from v_authority #> '{optimizerResult,objective}' or p_envelope->'metrics' is distinct from v_authority #> '{optimizerResult,metrics}'
    or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
    or public.static_weekly_v4_recurring_source_identity(v_authority->'compilerInput') is distinct from public.static_weekly_v4_recurring_source_identity(v_base) then
    raise exception using errcode='23514',message='projection must bind the stable registered source, complete dated receipt, objective, metrics, replay, and full weekly envelope';
  end if;
  if v_authority->'appliedExceptions' is distinct from p_exception_set or p_envelope->'applied_exceptions' is distinct from p_exception_set then
    raise exception using errcode='23514',message='overlay compiler input and applied exceptions must bind the complete accepted seven-day exception set';
  end if;
  if v_authority #> '{overlayCompilerInput,exceptions}' is distinct from v_compiler_exceptions then
    raise exception using errcode='23514',message='overlay compiler input must carry every semantic accepted exception fact for the same seven-day horizon';
  end if;
  if exists(with optimizer as(select value x from jsonb_array_elements(v_authority #> '{optimizerResult,assignments}')), projected as(select value x from jsonb_array_elements(p_envelope->'assignments'))
    select 1 from optimizer o full join projected p on p.x->>'plan_work_id'=o.x->>'planWorkId'
    where o.x is null or p.x is null or p.x->>'service_date' is distinct from o.x->>'serviceDate' or p.x->>'work_id' is distinct from o.x->>'workId' or p.x->>'day_of_week' is distinct from o.x->>'dayOfWeek' or upper(p.x->>'status') is distinct from upper(o.x->>'status')
      or (o.x->>'status'='ASSIGNED' and (p.x->>'owner_slot_id' is distinct from o.x->>'slotId' or p.x->>'owner_person_id' is distinct from o.x->>'personId'))
      or (o.x->>'status' in ('OPEN','REVIEW') and (p.x->>'owner_slot_id' is not null or p.x->>'owner_person_id' is not null))) then
    raise exception using errcode='23514',message='complete weekly projection assignments must exactly bind the canonical optimizer';
  end if;
  if exists(with optimizer as(select value x from jsonb_array_elements(v_authority #> '{optimizerResult,assignments}')), projected as(select value x from jsonb_array_elements(p_envelope->'assignments'))
    select 1 from optimizer o join projected p on p.x->>'plan_work_id'=o.x->>'planWorkId'
    where jsonb_typeof(p.x->'work_snapshot') is distinct from 'object'
      or not (p.x->'work_snapshot' ?& array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','required','coveragePolicy','bestEffortCoverage','coveragePolicyOrder','coveragePolicyProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance','restrictedSlotIds','manualLock','manualLockSlotId','overlayWork'])
      or exists(select 1 from jsonb_object_keys(p.x->'work_snapshot') as k(key) where not (k.key=any(array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','required','coveragePolicy','bestEffortCoverage','coveragePolicyOrder','coveragePolicyProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance','restrictedSlotIds','manualLock','manualLockSlotId','overlayWork'])))
      or jsonb_typeof(p.x#>'{work_snapshot,workId}') is distinct from 'string' or jsonb_typeof(p.x#>'{work_snapshot,dayOfWeek}') is distinct from 'number' or jsonb_typeof(p.x#>'{work_snapshot,originSlotId}') not in ('string','null')
      or p.x#>>'{work_snapshot,workId}' is distinct from o.x->>'workId' or p.x#>>'{work_snapshot,dayOfWeek}' is distinct from o.x->>'dayOfWeek' or p.x#>>'{work_snapshot,window,start}' is distinct from o.x#>>'{window,start}' or p.x#>>'{work_snapshot,window,end}' is distinct from o.x#>>'{window,end}' or p.x#>>'{work_snapshot,serviceEffortMinutes}' is distinct from o.x->>'serviceEffortMinutes'
      or jsonb_typeof(p.x#>'{work_snapshot,locationId}') is distinct from 'string' or p.x#>>'{work_snapshot,locationId}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or jsonb_typeof(p.x#>'{work_snapshot,locationCodeSnapshot}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,locationCodeSnapshot}'),'') is null or jsonb_typeof(p.x#>'{work_snapshot,locationNameSnapshot}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,locationNameSnapshot}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,window}') is distinct from 'object' or jsonb_typeof(p.x#>'{work_snapshot,window,start}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,window,start}'),'') is null or jsonb_typeof(p.x#>'{work_snapshot,window,end}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,window,end}'),'') is null
      or jsonb_typeof(p.x#>'{work_snapshot,serviceEffortMinutes}') is distinct from 'number' or jsonb_typeof(p.x#>'{work_snapshot,serviceEffortProvenance}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,serviceEffortProvenance}'),'') is null or jsonb_typeof(p.x#>'{work_snapshot,priority}') is distinct from 'number'
      or jsonb_typeof(p.x#>'{work_snapshot,priorityProvenance}') not in ('string','null') or (jsonb_typeof(p.x#>'{work_snapshot,priorityProvenance}')='string' and nullif(btrim(p.x#>>'{work_snapshot,priorityProvenance}'),'') is null)
      or jsonb_typeof(p.x#>'{work_snapshot,required}') is distinct from 'boolean' or jsonb_typeof(p.x#>'{work_snapshot,coveragePolicy}') not in ('string','null') or jsonb_typeof(p.x#>'{work_snapshot,bestEffortCoverage}') is distinct from 'boolean' or jsonb_typeof(p.x#>'{work_snapshot,coveragePolicyOrder}') not in ('number','null') or jsonb_typeof(p.x#>'{work_snapshot,coveragePolicyProvenance}') not in ('string','null')
      or jsonb_typeof(p.x#>'{work_snapshot,requiredQualifications}') is distinct from 'array' or jsonb_typeof(p.x#>'{work_snapshot,qualificationProvenance}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,qualificationProvenance}'),'') is null or jsonb_typeof(p.x#>'{work_snapshot,restrictions}') is distinct from 'array' or jsonb_typeof(p.x#>'{work_snapshot,restrictionProvenance}') is distinct from 'string' or nullif(btrim(p.x#>>'{work_snapshot,restrictionProvenance}'),'') is null or jsonb_typeof(p.x#>'{work_snapshot,restrictedSlotIds}') is distinct from 'array' or jsonb_typeof(p.x#>'{work_snapshot,manualLock}') is distinct from 'boolean' or jsonb_typeof(p.x#>'{work_snapshot,manualLockSlotId}') not in ('string','null') or jsonb_typeof(p.x#>'{work_snapshot,overlayWork}') is distinct from 'boolean'
      or exists(select 1 from jsonb_array_elements(p.x#>'{work_snapshot,requiredQualifications}') as q(value) where jsonb_typeof(q.value) is distinct from 'string' or nullif(btrim(q.value#>>'{}'),'') is null)
      or exists(select 1 from jsonb_array_elements(p.x#>'{work_snapshot,restrictions}') as r(value) where jsonb_typeof(r.value) is distinct from 'string' or nullif(btrim(r.value#>>'{}'),'') is null)
      or exists(select 1 from jsonb_array_elements(p.x#>'{work_snapshot,restrictedSlotIds}') as r(value) where jsonb_typeof(r.value) is distinct from 'string' or nullif(btrim(r.value#>>'{}'),'') is null)
      or (select count(*) from jsonb_array_elements(p.x#>'{work_snapshot,requiredQualifications}'))<>(select count(distinct value#>>'{}') from jsonb_array_elements(p.x#>'{work_snapshot,requiredQualifications}'))
      or (select count(*) from jsonb_array_elements(p.x#>'{work_snapshot,restrictions}'))<>(select count(distinct value#>>'{}') from jsonb_array_elements(p.x#>'{work_snapshot,restrictions}'))
      or (select count(*) from jsonb_array_elements(p.x#>'{work_snapshot,restrictedSlotIds}'))<>(select count(distinct value#>>'{}') from jsonb_array_elements(p.x#>'{work_snapshot,restrictedSlotIds}'))
  ) then raise exception using errcode='23514',message='projection work snapshots must be complete semantic authority facts bound to the canonical optimizer'; end if;
end
$function$;

create or replace function public.static_weekly_assert_projection_envelope_attested(p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_legacy jsonb; v_snapshot jsonb; v_document jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_envelope,array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],'attested projection envelope');
  perform public.static_weekly_assert_authority_attestation(p_envelope->'attestation','dated_projection',public.static_weekly_projection_attestation_payload(p_envelope));
  if p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb((p_envelope-'attestation')-'database_projection_identity') then raise exception using errcode='23514',message='projection semantic identity must bind the complete attested envelope'; end if;
  v_snapshot:=p_envelope->'semantic_snapshot'; perform public.static_weekly_assert_exact_object(v_snapshot,array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],'projection semantic snapshot');
  select draft_document into v_document from public.weekly_schedule_versions v join public.weekly_schedule_publications p on p.version_id=v.version_id where p.publication_id=p_publication_id;
  if v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-projection-semantic-snapshot.v1'
    or v_snapshot->'recurring_source' is distinct from public.static_weekly_v5_projection_source_identity(p_envelope#>'{authority,compilerInput}')
    or v_snapshot->'recurring_source' is distinct from public.static_weekly_v5_projection_source_identity(v_document#>'{authority,compilerInput}')
    or v_snapshot->'overlay_source' is distinct from public.static_weekly_v5_projection_source_identity(p_envelope#>'{authority,overlayCompilerInput}')
    or v_snapshot->'applied_exceptions' is distinct from p_envelope->'applied_exceptions' or v_snapshot->'active_assignments' is distinct from p_envelope->'assignments' then
    raise exception using errcode='23514',message='projection must bind stable recurring source, dated staffing and exceptions, and active assignments';
  end if;
  v_legacy:=p_envelope-'semantic_snapshot'-'attestation'; v_legacy:=jsonb_set(v_legacy,'{database_projection_identity}',to_jsonb(public.static_weekly_digest_jsonb(v_legacy-'database_projection_identity')),true);
  perform public.static_weekly_v4_assert_projection_envelope(v_legacy,p_publication_id,p_week_start,p_exception_set);
end
$function$;

revoke all on function public.static_weekly_rollback_semantic_snapshot(jsonb)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v3_read_publication_source(uuid,date)
from public,anon,authenticated,service_role,static_weekly_release_operator;
grant execute on function public.static_weekly_v3_read_publication_source(uuid,date)
to static_weekly_control_plane;
revoke all on function public.static_weekly_v4_assert_projection_envelope_single_location_base(jsonb,uuid,date,jsonb)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

comment on function public.static_weekly_v3_read_publication_source(uuid,date) is
'Reads the exact immutable recurring compiler authority from the compact attested publication document.';
comment on function public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb) is
'Binds dated projections to the exact recurring compiler authority retained by the compact attested publication document.';

commit;
