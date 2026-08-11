-- Final static-weekly scheduler authority closure.
--
-- This layer keeps the registered recurring source and roster-slot identities
-- immutable while deriving dated incumbency facts from the append-only closure
-- ledger for every requested horizon.  It replaces the v3 bridge to the
-- legacy frozen-envelope comparison; the envelope remains fully validated,
-- but all dated compiler, receipt, overlay, and assignment facts are checked
-- against the requested horizon rather than against the first publication.
begin;

create or replace function public.static_weekly_v4_recurring_source_identity(p_source jsonb)
returns jsonb language plpgsql immutable as $function$
declare v_identity jsonb; v_version jsonb; v_slots jsonb;
begin
  if jsonb_typeof(p_source) is distinct from 'object' or coalesce(p_source->'exceptions','[]'::jsonb)<>'[]'::jsonb then
    raise exception using errcode='23514',message='registered scheduler source must be one exception-free recurring compiler input';
  end if;
  if jsonb_typeof(p_source->'version')='object' then
    v_version:=p_source->'version';
  elsif jsonb_typeof(p_source->'versions')='array' and jsonb_array_length(p_source->'versions')=1 then
    v_version:=(p_source->'versions')->0;
  else
    raise exception using errcode='23514',message='registered scheduler source must carry exactly one recurring version';
  end if;
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd';
  v_identity:=p_source-'serviceDate'-'exceptions'-'version'-'versions';
  if jsonb_typeof(v_identity->'slots') is distinct from 'array' then
    raise exception using errcode='23514',message='registered scheduler source must carry stable roster slots';
  end if;
  select coalesce(jsonb_agg(slot-'incumbencies' order by ordinal),'[]'::jsonb) into v_slots
  from jsonb_array_elements(v_identity->'slots') with ordinality as s(slot,ordinal);
  v_identity:=jsonb_set(v_identity,'{slots}',v_slots,true);
  return jsonb_set(v_identity,'{version}',v_version,true);
end
$function$;

create or replace function public.static_weekly_v3_source_identity(p_source jsonb)
returns jsonb language sql immutable as $function$
  select public.static_weekly_v4_recurring_source_identity(p_source)
$function$;

create or replace function public.static_weekly_v4_projection_source_identity(p_source jsonb)
returns jsonb language plpgsql immutable as $function$
declare v_identity jsonb; v_version jsonb; v_slots jsonb;
begin
  if jsonb_typeof(p_source) is distinct from 'object' then
    raise exception using errcode='23514',message='projection source must be one compiler input object';
  end if;
  if jsonb_typeof(p_source->'version')='object' then
    v_version:=p_source->'version';
  elsif jsonb_typeof(p_source->'versions')='array' and jsonb_array_length(p_source->'versions')=1 then
    v_version:=(p_source->'versions')->0;
  else
    raise exception using errcode='23514',message='projection source must carry exactly one recurring version';
  end if;
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd';
  v_identity:=p_source-'serviceDate'-'version'-'versions';
  if jsonb_typeof(v_identity->'slots') is distinct from 'array' then
    raise exception using errcode='23514',message='projection source must carry stable roster slots';
  end if;
  select coalesce(jsonb_agg(slot-'incumbencies' order by ordinal),'[]'::jsonb) into v_slots
  from jsonb_array_elements(v_identity->'slots') with ordinality as s(slot,ordinal);
  v_identity:=jsonb_set(v_identity,'{slots}',v_slots,true);
  return jsonb_set(v_identity,'{version}',v_version,true);
end
$function$;

create or replace function public.static_weekly_v4_hydrate_compiler_source(p_source jsonb,p_service_date date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_slots jsonb; v_slot jsonb; v_ranges jsonb; v_hydrated jsonb;
begin
  if p_service_date is null or jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_source->'slots') is distinct from 'array' then
    raise exception using errcode='23514',message='dated scheduler source requires one canonical service date and stable slot array';
  end if;
  for v_slot in select value from jsonb_array_elements(p_source->'slots') loop
    if jsonb_typeof(v_slot->'id') is distinct from 'string' or v_slot->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode='23514',message='registered scheduler source contains a non-UUID stable roster slot identity';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'personId',r.person_id::text,
      'displayName',r.person_name_snapshot,
      'effectiveStart',r.effective_start::text,
      'effectiveEnd',case when r.effective_end is null then null else r.effective_end::text end
    ) order by r.effective_start,r.incumbency_id),'[]'::jsonb) into v_ranges
    from public.v_weekly_roster_slot_incumbency_ranges r
    where r.slot_id=(v_slot->>'id')::uuid
      and r.effective_start<=p_service_date+6
      and (r.effective_end is null or r.effective_end>p_service_date);
    if jsonb_array_length(v_ranges)=0 then
      raise exception using errcode='23514',message='every projected stable roster slot requires closure-aware incumbent history for the requested horizon';
    end if;
    v_slot:=jsonb_set(v_slot,'{incumbencies}',v_ranges,true);
    v_slots:=coalesce(v_slots,'[]'::jsonb)||jsonb_build_array(v_slot);
  end loop;
  v_hydrated:=jsonb_set(p_source,'{slots}',coalesce(v_slots,'[]'::jsonb),true);
  return jsonb_set(v_hydrated,'{serviceDate}',to_jsonb(p_service_date::text),true);
end
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
    'compiler_input',public.static_weekly_v4_hydrate_compiler_source(v_document#>'{semantic_snapshot,recurring_source}',p_service_date),
    'exceptions',public.static_weekly_compiler_exception_set(p_publication_id,p_service_date),
    'publication_id',p_publication_id::text,
    'version_id',v_version::text,
    'authority_revision',(select current_revision from public.static_weekly_schedule_control where singleton)
  );
end
$function$;

-- This is the former full v2 envelope validator with one deliberate semantic
-- substitution: its stored-baseline equality is now the stable source/slot
-- identity.  All dated compiler authority, receipt, overlay, optimizer, and
-- assignment checks remain bound to p_week_start below.
create or replace function public.static_weekly_v4_assert_projection_envelope(p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
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
  select draft_document#>'{semantic_snapshot,recurring_source}' into v_base from public.weekly_schedule_versions where version_id=v_publication.version_id;
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
  if p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb((p_envelope-'attestation')-'database_projection_identity') then
    raise exception using errcode='23514',message='projection semantic identity must bind the complete attested envelope';
  end if;
  v_snapshot:=p_envelope->'semantic_snapshot';
  perform public.static_weekly_assert_exact_object(v_snapshot,array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],'projection semantic snapshot');
  select draft_document into v_document from public.weekly_schedule_versions v join public.weekly_schedule_publications p on p.version_id=v.version_id where p.publication_id=p_publication_id;
  if v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-projection-semantic-snapshot.v1'
    or v_snapshot->'recurring_source' is distinct from public.static_weekly_v4_projection_source_identity(p_envelope#>'{authority,compilerInput}')
    or v_snapshot->'recurring_source' is distinct from public.static_weekly_v4_projection_source_identity(v_document#>'{semantic_snapshot,recurring_source}')
    or v_snapshot->'overlay_source' is distinct from public.static_weekly_v4_projection_source_identity(p_envelope#>'{authority,overlayCompilerInput}')
    or v_snapshot->'applied_exceptions' is distinct from p_envelope->'applied_exceptions'
    or v_snapshot->'active_assignments' is distinct from p_envelope->'assignments' then
    raise exception using errcode='23514',message='projection must bind stable recurring source, dated overlay, accepted exceptions, and active assignments';
  end if;
  v_legacy:=p_envelope-'semantic_snapshot'-'attestation';
  v_legacy:=jsonb_set(v_legacy,'{database_projection_identity}',to_jsonb(public.static_weekly_digest_jsonb(v_legacy-'database_projection_identity')),true);
  perform public.static_weekly_v4_assert_projection_envelope(v_legacy,p_publication_id,p_week_start,p_exception_set);
end
$function$;

create or replace function public.static_weekly_v3_assert_draft_incumbency(p_version_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_start date; v_row record; v_person uuid; v_name text; v_date date; v_matches integer;
begin
  select effective_start into v_start from public.weekly_schedule_versions where version_id=p_version_id for share;
  if v_start is null then raise exception using errcode='23514',message='draft version does not exist'; end if;
  for v_row in select * from public.weekly_schedule_slot_availability where version_id=p_version_id order by day_of_week,slot_id loop
    v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7);
    select count(*) into v_matches from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
    if v_matches<>1 then raise exception using errcode='23514',message='draft roster slot must resolve exactly one closure-aware incumbent at each service date'; end if;
    select person_id,person_name_snapshot into v_person,v_name from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
    if v_row.incumbent_person_id_snapshot is distinct from v_person or v_row.incumbent_name_snapshot is distinct from v_name then raise exception using errcode='23514',message='draft roster incumbency snapshot is stale or incomplete at publication service date'; end if;
  end loop;
  for v_row in select * from public.weekly_schedule_slot_assignments where version_id=p_version_id and owner_slot_id is not null order by day_of_week,assignment_id loop
    v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7);
    select count(*) into v_matches from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.owner_slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
    if v_matches<>1 then raise exception using errcode='23514',message='draft assignment owner must resolve exactly one closure-aware incumbent at each service date'; end if;
    select person_id,person_name_snapshot into v_person,v_name from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.owner_slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
    if v_row.owner_person_id_snapshot is distinct from v_person or v_row.owner_name_snapshot is distinct from v_name then raise exception using errcode='23514',message='draft recurring owner snapshot is stale or incomplete at publication service date'; end if;
  end loop;
end
$function$;

create unique index if not exists static_weekly_authority_recovery_lineage_unique
  on public.static_weekly_authority_attestation_keys(recovery_of_key_id)
  where recovery_of_key_id is not null;

create or replace function public.static_weekly_v3_recover_authority_key(p_key_id text,p_secret text,p_recovery_of text,p_configured_by text default 'release-owner')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_now timestamptz:=statement_timestamp(); v_active text; v_active_count integer;
begin
  perform public.static_weekly_v3_assert_release_operator();
  if p_key_id !~ '^static-weekly-authority-hmac-v[0-9]+$' or p_key_id is distinct from nullif(btrim(p_key_id),'') or length(coalesce(p_secret,''))<32 or nullif(btrim(p_configured_by),'') is null or nullif(btrim(p_recovery_of),'') is null then
    raise exception using errcode='22023',message='recovery requires a distinct new versioned key, valid secret, exact failed active predecessor, and release operator identity';
  end if;
  perform 1 from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=v_now and (verify_not_after is null or verify_not_after>v_now) for update;
  select count(*),min(key_id) into v_active_count,v_active from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=v_now and (verify_not_after is null or verify_not_after>v_now);
  if v_active_count<>1 or p_recovery_of is distinct from v_active or p_key_id=p_recovery_of then
    raise exception using errcode='23514',message='recovery predecessor must be the one current active failed key';
  end if;
  if exists(select 1 from public.static_weekly_authority_attestation_keys where key_id=p_key_id) then
    raise exception using errcode='23505',message='recovery key identity must be new and may not be reused';
  end if;
  if exists(select 1 from public.static_weekly_authority_attestation_keys where recovery_of_key_id=p_recovery_of) then
    raise exception using errcode='23505',message='failed active key already has one immutable recovery successor';
  end if;
  update public.static_weekly_authority_attestation_keys
  set key_state='revoked',revoked_at=v_now,revoked_by='failed-active-recovery',verify_not_after=v_now
  where key_id=v_active and key_state='active';
  if not found then raise exception using errcode='40001',message='failed active key changed before atomic recovery could complete'; end if;
  insert into public.static_weekly_authority_attestation_keys(key_id,secret_material,key_state,activates_at,verify_not_after,configured_by,recovery_of_key_id)
  values(p_key_id,p_secret,'active',v_now,null,left(p_configured_by,200),p_recovery_of);
  return public.static_weekly_v3_authority_health();
end
$function$;

create or replace function public.static_weekly_v3_authority_health()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_active integer; v_overlap_bad integer; v_cp boolean; v_v3 integer; v_key public.static_weekly_authority_attestation_keys%rowtype; v_probe jsonb; v_signature text; v_canary boolean:=false;
begin
  select count(*) into v_active from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=statement_timestamp() and (verify_not_after is null or verify_not_after>statement_timestamp());
  select count(*) into v_overlap_bad from public.static_weekly_authority_attestation_keys where key_state='overlap' and (verify_not_after is null or verify_not_after<=statement_timestamp());
  select exists(select 1 from pg_roles where rolname='static_weekly_control_plane') into v_cp;
  select count(*) into v_v3 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly_v3_%';
  if v_active=1 then
    select * into v_key from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=statement_timestamp() and (verify_not_after is null or verify_not_after>statement_timestamp()) for share;
    v_probe:=jsonb_build_object('schema','memphis-zoo.static-weekly-authority-health-canary.v1','key_id',v_key.key_id,'purpose','operational_sign_verify');
    v_signature:=public.static_weekly_v3_hmac(v_key.secret_material,'authority_health_canary',v_probe);
    v_canary:=v_signature ~ '^[0-9a-f]{64}$' and public.static_weekly_v3_constant_time_equal(decode(v_signature,'hex'),decode(public.static_weekly_v3_hmac(v_key.secret_material,'authority_health_canary',v_probe),'hex'));
  end if;
  return jsonb_build_object('ready',v_active=1 and v_overlap_bad=0 and v_cp and v_v3>=8 and v_canary,'active_key_count',v_active,'expired_overlap_count',v_overlap_bad,'control_plane_role_present',v_cp,'v3_function_count',v_v3,'operational_sign_verify_canary',v_canary,'key_ids',(select coalesce(jsonb_agg(jsonb_build_object('key_id',key_id,'state',key_state,'activates_at',activates_at,'verify_not_after',verify_not_after,'recovery_of_key_id',recovery_of_key_id) order by key_id),'[]'::jsonb) from public.static_weekly_authority_attestation_keys));
end
$function$;

create or replace function public.static_weekly_v3_apply_exception(p_exception_type text,p_service_date date,p_starts_at time,p_ends_at time,p_base_version_id uuid,p_publication_id uuid,p_reason text,p_payload jsonb,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text,p_reverses_exception_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  if nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(p_reason)>500 or p_reason ~ '[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message='exception reason must be a nonblank control-free string of at most 500 characters';
  end if;
  v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  return public.static_weekly_v2_apply_exception(p_exception_type,p_service_date,p_starts_at,p_ends_at,p_base_version_id,p_publication_id,p_reason,p_payload,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,p_reverses_exception_id);
end
$function$;

revoke all on function public.static_weekly_v4_recurring_source_identity(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_projection_source_identity(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_hydrate_compiler_source(jsonb,date) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_assert_projection_envelope(jsonb,uuid,date,jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

comment on function public.static_weekly_v4_hydrate_compiler_source(jsonb,date) is 'Derives only dated incumbent ranges from the append-only closure-aware roster ledger while preserving immutable recurring source and stable slot identity.';
comment on function public.static_weekly_v3_recover_authority_key(text,text,text,text) is 'Atomic failed-active recovery: one new key replaces and revokes exactly the current active predecessor, with one immutable recovery lineage and no pre-revocation step.';

commit;
