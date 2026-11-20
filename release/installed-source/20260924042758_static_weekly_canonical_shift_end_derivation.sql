-- Canonical immutable template -> dated closing coverage. No source rewrite,
-- public table, client privilege or production staffing mutation is introduced.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function public.static_weekly_v9_assert_shift_end_derivation(p_authority jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,public as $function$
declare
 source jsonb:=p_authority->'compilerInput';
 effective jsonb:=jsonb_set(p_authority->'overlayCompilerInput','{exceptions}','[]'::jsonb);
 policy jsonb:=source#>'{version,shiftEndContinuityPolicy}';
 receipt jsonb:=p_authority->'shiftEndDerivation';
 roster jsonb; boundaries jsonb; chain jsonb; parent jsonb; segment jsonb; work jsonb;
 person jsonb; owner jsonb; physical jsonb; key text; previous_end text; final_end text;
 day integer; matches integer; total numeric; seen text[]:='{}'; parent_seen text[]:='{}';
 minute_samples integer:=0; location_samples integer:=0; location_count integer; span integer;
begin
 perform public.static_weekly_assert_exact_object(policy,
  array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest'],
  array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest'],'shift-end source policy');
 perform public.static_weekly_assert_exact_object(receipt,
  array['schema','algorithm','templateDigest','policyDigest','datedRosterDigest','derivedBaselineDigest','staffedDepartureByDay','parentChains','outputWorkDigest','continuity'],
  array['schema','algorithm','templateDigest','policyDigest','datedRosterDigest','derivedBaselineDigest','staffedDepartureByDay','parentChains','outputWorkDigest','continuity'],'shift-end derivation receipt');
 if policy->>'schema' is distinct from 'memphis-zoo.shift-end-continuity-policy.v1'
  or policy->>'algorithm' is distinct from 'dated-real-staff-directed-proximity-weighted-v1'
  or policy->>'normalPhaseStart' is distinct from '09:45'
  or coalesce(policy->>'provenance','') !~ '^owner-configuration-sha256:[a-f0-9]{64}$'
  or policy->>'policyDigest' is distinct from public.static_weekly_digest_jsonb(policy-'policyDigest')
  or receipt->>'schema' is distinct from 'memphis-zoo.shift-end-derivation.v1'
  or receipt->>'algorithm' is distinct from policy->>'algorithm'
  or receipt->>'policyDigest' is distinct from policy->>'policyDigest'
  or receipt->>'templateDigest' is distinct from public.static_weekly_digest_jsonb(source)
  or receipt->>'derivedBaselineDigest' is distinct from public.static_weekly_digest_jsonb(effective)
  or receipt->>'derivedBaselineDigest' is distinct from p_authority->>'derivedBaselineDigest'
  or source->'exceptions' is distinct from '[]'::jsonb
  or source#>'{version,shiftEndDerivationApplied}' is not null
  or effective#>>'{version,shiftEndDerivationApplied}' is distinct from policy->>'policyDigest'
  or source-'version' is distinct from effective-'version'
  or (source->'version')-'assignments' is distinct from (effective->'version')-'assignments'-'shiftEndDerivationApplied'
  or jsonb_typeof(policy->'weights') is distinct from 'object'
  or jsonb_typeof(source#>'{version,assignments}') is distinct from 'array'
  or jsonb_typeof(effective#>'{version,assignments}') is distinct from 'array'
  or jsonb_typeof(receipt->'parentChains') is distinct from 'array'
  or jsonb_array_length(source#>'{version,assignments}') not between 1 and 1024
  or jsonb_array_length(effective#>'{version,assignments}') not between 1 and 1024
  or jsonb_array_length(receipt->'parentChains')<>jsonb_array_length(source#>'{version,assignments}')
  or receipt->>'outputWorkDigest' is distinct from public.static_weekly_digest_jsonb(effective#>'{version,assignments}') then
  raise exception using errcode='23514',message='shift-end source, policy, derived baseline and receipt identities must be exact';
 end if;
 if exists(select 1 from jsonb_each(policy->'weights') w where jsonb_typeof(w.value)<>'number'
  or (w.value#>>'{}')::numeric<=0 or (w.value#>>'{}')::numeric>1000
  or (w.value#>>'{}')::numeric*2<>trunc((w.value#>>'{}')::numeric*2)) then
  raise exception using errcode='23514',message='shift-end weights require exact positive bounded half units';
 end if;
 -- Derive this roster from immutable availability plus dated incumbent ranges,
 -- never from exception-mutated projectionAvailability or a caller roster blob.
 with facts as (
  select a, s, (source->>'serviceDate')::date+
   mod((a->>'dayOfWeek')::int-extract(dow from (source->>'serviceDate')::date)::int+7,7) d
  from jsonb_array_elements(source#>'{version,slotAvailability}') a
  join jsonb_array_elements(source->'slots') s on s->>'id'=a->>'slotId'
  where coalesce(s->'contractorCapacity','false'::jsonb)='false'::jsonb
 ), dated as (
  select *, (select count(*) from jsonb_array_elements(s->'incumbencies') i
   where (i->>'effectiveStart')::date<=d and (i->>'effectiveEnd' is null or d<(i->>'effectiveEnd')::date)) n,
   (select i from jsonb_array_elements(s->'incumbencies') i
   where (i->>'effectiveStart')::date<=d and (i->>'effectiveEnd' is null or d<(i->>'effectiveEnd')::date) limit 1) incumbent
  from facts
 ) select coalesce(jsonb_agg(jsonb_build_object('serviceDate',d::text,'dayOfWeek',a->'dayOfWeek',
   'slotId',a->'slotId','personId',incumbent->'personId','vacant',n=0,'status',a->'status',
   'shift',a->'shift','lunch',a->'lunch') order by (a->>'dayOfWeek')::int,a->>'slotId'),'[]'::jsonb),
  count(*) filter(where n>1 or (n=0 and not coalesce((source#>'{version,vacancyCapableSlotIds}') ? (a->>'slotId'),false))
   or (n=0) is distinct from (a->>'status'='vacant_unfilled')
   or a->>'status' not in ('working','vacant_unfilled','departed_named_absent'))
 into roster,matches from dated;
 if matches<>0 or jsonb_array_length(roster)=0
  or (select count(*) from jsonb_array_elements(roster))<>(select count(distinct (r->>'dayOfWeek',r->>'slotId')) from jsonb_array_elements(roster) r)
  or receipt->>'datedRosterDigest' is distinct from public.static_weekly_digest_jsonb(roster) then
  raise exception using errcode='23514',message='shift-end receipt must bind one exact dated real roster';
 end if;
 select jsonb_object_agg(d::text,closing) into boundaries from (
  select (r->>'dayOfWeek')::int d,max(r#>>'{shift,end}') closing from jsonb_array_elements(roster) r
  where r->'vacant'='false'::jsonb and r->>'status'='working' group by 1
 ) endings;
 if boundaries is null or (select count(*) from jsonb_object_keys(boundaries))<>7
  or boundaries is distinct from receipt->'staffedDepartureByDay' then
  raise exception using errcode='23514',message='shift-end boundary requires real working incumbent on every day';
 end if;
 for chain in select value from jsonb_array_elements(receipt->'parentChains') loop
  perform public.static_weekly_assert_exact_object(chain,
   array['dayOfWeek','parentWorkId','physicalIdentityDigest','workloadBefore','workloadAfter','segments'],
   array['dayOfWeek','parentWorkId','physicalIdentityDigest','workloadBefore','workloadAfter','segments'],'shift-end parent chain');
  day:=(chain->>'dayOfWeek')::int; key:=day::text||':'||(chain->>'parentWorkId');
  select count(*) into matches from jsonb_array_elements(source#>'{version,assignments}') w
   where w->>'dayOfWeek'=day::text and w->>'workId'=chain->>'parentWorkId';
  if matches<>1 or key=any(parent_seen) then raise exception 'shift-end parent must exist exactly once'; end if;
  parent_seen:=array_append(parent_seen,key);
  select w into parent from jsonb_array_elements(source#>'{version,assignments}') w
   where w->>'dayOfWeek'=day::text and w->>'workId'=chain->>'parentWorkId';
  select jsonb_object_agg(k,coalesce(parent->k,'null'::jsonb)) into physical from unnest(array[
   'locationId','locationCodeSnapshot','locationNameSnapshot','includedLocations','serviceMode','requiredQualifications',
   'restrictedSlotIds','restrictions','qualificationProvenance','restrictionProvenance']) k;
  if chain->>'physicalIdentityDigest' is distinct from public.static_weekly_digest_jsonb(physical)
   or chain->'workloadBefore' is distinct from parent->'serviceEffortMinutes'
   or chain->'workloadAfter' is distinct from parent->'serviceEffortMinutes'
   or jsonb_typeof(chain->'segments') is distinct from 'array' or jsonb_array_length(chain->'segments')<1
   or position(':handoff:' in parent->>'workId')>0 or position(':open:' in parent->>'workId')>0 then
   raise exception 'shift-end chain must retain exact immutable parent identity and workload';
  end if;
  previous_end:=parent#>>'{window,start}';final_end:=boundaries->>day::text;total:=0;
  if previous_end='09:45' then
   select r into owner from jsonb_array_elements(roster) r where r->>'slotId'=parent->>'ownerSlotId' and r->>'dayOfWeek'=day::text;
   if not found or parent#>>'{window,end}' is distinct from owner#>>'{shift,end}'
    or parent->'originSlotId' is distinct from parent->'ownerSlotId'
    or not ((policy->'weights') ? (parent->>'locationCodeSnapshot')) then
    raise exception 'immutable normal parent must retain full owning position shift and weight'; end if;
  end if;
  for segment in select value from jsonb_array_elements(chain->'segments') loop
   perform public.static_weekly_assert_exact_object(segment,
    array['workId','ownerSlotId','window','serviceEffortMinutes','kind'],
    array['workId','ownerSlotId','window','serviceEffortMinutes','kind'],'shift-end segment');
   key:=day::text||':'||(segment->>'workId');
   select count(*) into matches from jsonb_array_elements(effective#>'{version,assignments}') w
    where w->>'dayOfWeek'=day::text and w->>'workId'=segment->>'workId';
   if matches<>1 or key=any(seen) then raise exception 'derived segment must occur exactly once'; end if;
   seen:=array_append(seen,key);
   select w into work from jsonb_array_elements(effective#>'{version,assignments}') w
    where w->>'dayOfWeek'=day::text and w->>'workId'=segment->>'workId';
   perform public.static_weekly_v3_assert_window(segment->'window','shift-end segment');
   if segment#>>'{window,start}' is distinct from previous_end
    or segment->'window' is distinct from work->'window'
    or segment->'ownerSlotId' is distinct from work->'ownerSlotId'
    or segment->'serviceEffortMinutes' is distinct from work->'serviceEffortMinutes'
    or jsonb_typeof(segment->'serviceEffortMinutes') is distinct from 'number'
    or (segment->>'serviceEffortMinutes')::numeric<=0
    or (segment->>'serviceEffortMinutes')::numeric<>trunc((segment->>'serviceEffortMinutes')::numeric)
    or (work-'workId'-'ownerSlotId'-'originSlotId'-'window'-'serviceEffortMinutes'-'serviceEffortProvenance')
       is distinct from (parent-'workId'-'ownerSlotId'-'originSlotId'-'window'-'serviceEffortMinutes'-'serviceEffortProvenance')
    or work->'ownerSlotId' is distinct from work->'originSlotId'
    or work->>'serviceEffortProvenance' is distinct from ((parent->>'serviceEffortProvenance')||
       case when jsonb_array_length(chain->'segments')>1 then ';shift-split-preserves-budget' else '' end) then
    raise exception 'derived segment changed immutable work, exact workload or contiguous window';
   end if;
   previous_end:=segment#>>'{window,end}';total:=total+(segment->>'serviceEffortMinutes')::numeric;
   if parent#>>'{window,start}'<>'09:45' then
    if work is distinct from parent or segment->>'kind' is distinct from 'baseline' then raise exception 'non-closing work must be unchanged'; end if;
   else
    select r into person from jsonb_array_elements(roster) r where r->>'slotId'=work->>'ownerSlotId' and r->>'dayOfWeek'=day::text;
    select a into owner from jsonb_array_elements(source#>'{version,slotAvailability}') a where a->>'slotId'=work->>'ownerSlotId' and a->>'dayOfWeek'=day::text;
    if person is null or owner is null or work#>>'{window,start}'<person#>>'{shift,start}'
     or previous_end>person#>>'{shift,end}' or previous_end>final_end
     or (work->'restrictedSlotIds') ? (work->>'ownerSlotId')
     or not ((owner->'qualifications') @> (work->'requiredQualifications'))
     or exists(select 1 from jsonb_array_elements(work->'includedLocations') loc where (owner->'restrictions') ? (loc->>'locationId')) then
     raise exception 'derived normal responsibility has off-duty or ineligible position'; end if;
    if segment->>'kind'='baseline' then
     if work->'workId' is distinct from parent->'workId' or work->'ownerSlotId' is distinct from parent->'ownerSlotId' then raise exception 'baseline segment identity changed'; end if;
    elsif segment->>'kind' in ('open','handoff') then
     if work->>'workId' is distinct from (parent->>'workId')||':'||(segment->>'kind')||':'||(work#>>'{window,start}')||':'||(work->>'ownerSlotId')
      or (segment->>'kind'='open') is distinct from (person->'vacant'='true'::jsonb)
      or (segment->>'kind'='handoff' and (person->>'status'<>'working' or person->>'personId' is null))
      or (person#>>'{lunch,start}'<=work#>>'{window,start}' and work#>>'{window,start}'<person#>>'{lunch,end}') then
      raise exception 'physical handoff or explicit OPEN segment identity invalid'; end if;
    else raise exception 'unknown derived segment kind'; end if;
   end if;
  end loop;
  if total<>(parent->>'serviceEffortMinutes')::numeric
   or (parent#>>'{window,start}'='09:45' and previous_end is distinct from final_end) then
   raise exception 'parent chain must conserve workload and reach final staffed boundary'; end if;
 end loop;
 if cardinality(seen)<>jsonb_array_length(effective#>'{version,assignments}') then raise exception 'unaccounted derived work'; end if;
 -- OPEN may retain a stable baseline position, never a fictitious execution
 -- owner/person. Existing optimizer/document validators retain their checks.
 if exists(select 1 from jsonb_array_elements(p_authority#>'{optimizerResult,assignments}') a
  where a->>'status' in ('OPEN','REVIEW') and (a->>'slotId' is not null or a->>'personId' is not null)) then
  raise exception 'OPEN derived work may not invent execution identity'; end if;
 for day in 0..6 loop
  select count(*),count(distinct id) into matches,location_count from (
   select l->>'locationId' id from jsonb_array_elements(source#>'{version,assignments}') w
   cross join lateral jsonb_array_elements(case when jsonb_array_length(w->'includedLocations')>0 then w->'includedLocations'
     else jsonb_build_array(jsonb_build_object('locationId',w->'locationId')) end) l
   where w->>'dayOfWeek'=day::text and w#>>'{window,start}'='09:45'
  ) locations;
  if matches<>location_count then raise exception 'immutable normal template contains duplicate physical ownership'; end if;
  span:=(extract(epoch from (boundaries->>day::text)::time)/60)::int-585;
  if span<=0 then raise exception 'invalid staffed operating span'; end if;
  minute_samples:=minute_samples+span;location_samples:=location_samples+span*location_count;
 end loop;
 if receipt->'continuity' is distinct from jsonb_build_object('minuteSamples',minute_samples,'locationMinuteChecks',location_samples,
  'coverageGaps',0,'duplicateLocations',0,'staffedDepartureByDay',boundaries,
  'scope','dated real-staff handoffs and explicit vacancy OPEN responsibility until final staffed departure; lunch overlay checked separately') then
  raise exception 'shift-end continuity counters must be independently recomputed'; end if;
end $function$;
revoke all on function public.static_weekly_v9_assert_shift_end_derivation(jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

-- Keep every existing certificate, witness, attestation, optimizer and typed
-- relational check. Edits fail closed if the expected predecessor seam moved.
do $authority$
declare d text; before_definition text;
begin
 d:=pg_get_functiondef('public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)'::regprocedure);
 before_definition:=d;
 if (length(d)-length(replace(d,'''databaseContentIdentity'']','')))/length('''databaseContentIdentity'']')<>2 then
  raise exception 'unexpected compiler authority exact-shape seam'; end if;
 d:=replace(d,'''databaseContentIdentity'']','''databaseContentIdentity'']||case when p_authority->>''schema''=''memphis-zoo.static-weekly-authority.v4'' then array[''shiftEndDerivation'',''derivedBaselineDigest''] else ''{}''::text[] end');
 d:=replace(d,$old$p_authority->>'schema' is distinct from 'memphis-zoo.static-weekly-authority.v3'$old$,
  $new$p_authority->>'schema' not in ('memphis-zoo.static-weekly-authority.v3','memphis-zoo.static-weekly-authority.v4')$new$);
 d:=replace(d,$old$p_receipt->>'schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'$old$,
  $new$p_receipt->>'schema' not in ('memphis-zoo.static-weekly-database-adapter.v1','memphis-zoo.static-weekly-database-adapter.v2')$new$);
 d:=replace(d,$old$p_receipt->>'adapterVersion' is distinct from 'static-weekly-database-adapter-v1'$old$,
  $new$p_receipt->>'adapterVersion' is distinct from (case p_receipt->>'schema' when 'memphis-zoo.static-weekly-database-adapter.v1' then 'static-weekly-database-adapter-v1' else 'static-weekly-database-adapter-v2-dated-shift-end' end)$new$);
 d:=replace(d,$old$v_certificate->>'compilerVersion' is distinct from 'static-weekly-highs-mip-v8-workload-duty-boundary'$old$,
  $new$v_certificate->>'compilerVersion' is distinct from (case p_receipt->>'schema' when 'memphis-zoo.static-weekly-database-adapter.v1' then 'static-weekly-highs-mip-v8-workload-duty-boundary' else 'static-weekly-highs-mip-v9-dated-shift-end' end)$new$);
 d:=replace(d,$old$v_certificate->>'verifierVersion' is distinct from 'static-weekly-js-verifier-v8-workload-duty-boundary'$old$,
  $new$v_certificate->>'verifierVersion' is distinct from (case p_receipt->>'schema' when 'memphis-zoo.static-weekly-database-adapter.v1' then 'static-weekly-js-verifier-v8-workload-duty-boundary' else 'static-weekly-js-verifier-v9-dated-shift-end' end)$new$);
 d:=replace(d,$old$  v_certificate:=p_receipt#>'{compiler,certificate}';$old$,$new$
  if p_authority->>'schema'='memphis-zoo.static-weekly-authority.v4' then
   if p_receipt->>'schema'<>'memphis-zoo.static-weekly-database-adapter.v2' then raise exception 'derived authority requires v2 adapter'; end if;
   perform public.static_weekly_v9_assert_shift_end_derivation(p_authority);
  elsif p_authority#>'{compilerInput,version,shiftEndContinuityPolicy}' is not null
    or p_authority#>'{compilerInput,version,shiftEndDerivationApplied}' is not null
    or p_authority#>'{overlayCompilerInput,version,shiftEndContinuityPolicy}' is not null
    or p_authority#>'{overlayCompilerInput,version,shiftEndDerivationApplied}' is not null then
   raise exception 'legacy authority cannot carry unverified derivation policy';
  end if;
  v_certificate:=p_receipt#>'{compiler,certificate}';$new$);
 d:=replace(d,$old$or p_authority->'overlayCompilerInput' is distinct from p_authority->'compilerInput'
    or p_authority->>'inputDigest' is distinct from p_authority->>'baselineInputDigest'$old$,$new$
    or p_authority#>'{overlayCompilerInput,exceptions}' is distinct from '[]'::jsonb
    or (p_authority->>'schema'='memphis-zoo.static-weekly-authority.v3' and (
     p_authority->'overlayCompilerInput' is distinct from p_authority->'compilerInput'
     or p_authority->>'inputDigest' is distinct from p_authority->>'baselineInputDigest'))
    or (p_authority->>'schema'='memphis-zoo.static-weekly-authority.v4' and
     p_authority->>'inputDigest' is distinct from p_authority->>'derivedBaselineDigest')$new$);
 if d=before_definition or position('static_weekly_v9_assert_shift_end_derivation(p_authority)' in d)=0
  or position('inputDigest'' is distinct from p_authority->>''derivedBaselineDigest' in d)=0 then
  raise exception 'compiler authority integration seam missing'; end if;
 execute d;

 d:=pg_get_functiondef('public.static_weekly_assert_document(jsonb,date,boolean)'::regprocedure);
 if position($old${compilerInput,version,assignments}$old$ in d)=0 then raise exception 'document work-source seam missing'; end if;
 d:=replace(d,'{compilerInput,version,assignments}','{overlayCompilerInput,version,assignments}');
 d:=replace(d,$old$p_document #>> '{adapter,schema}' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'$old$,
  $new$p_document #>> '{adapter,schema}' is distinct from p_document#>>'{receipt,schema}'$new$);
 d:=replace(d,$old$p_document #>> '{adapter,version}' is distinct from 'static-weekly-database-adapter-v1'$old$,
  $new$p_document #>> '{adapter,version}' is distinct from p_document#>>'{receipt,adapterVersion}'$new$);
 -- The attested wrapper validates this too; direct owner invocation remains
 -- closed, rather than accepting a self-consistent invented adapter schema.
 d:=replace(d,$old$begin
  perform public.static_weekly_assert_exact_object(p_document,$old$,$new$begin
  perform public.static_weekly_assert_compiler_authority(p_document->'authority',p_document->'receipt',p_effective_start,p_require_publishable);
  perform public.static_weekly_assert_exact_object(p_document,$new$);
 execute d;

 d:=pg_get_functiondef('public.static_weekly_v4_assert_projection_envelope_single_location_base(jsonb,uuid,date,jsonb)'::regprocedure);
 if position('static-weekly-database-adapter.v1' in d)=0 then raise exception 'projection adapter seam missing'; end if;
 d:=replace(d,$old$p_envelope #>> '{adapter,schema}' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'$old$,
  $new$p_envelope #>> '{adapter,schema}' is distinct from p_envelope#>>'{receipt,schema}'$new$);
 d:=replace(d,$old$p_envelope #>> '{adapter,version}' is distinct from 'static-weekly-database-adapter-v1'$old$,
  $new$p_envelope #>> '{adapter,version}' is distinct from p_envelope#>>'{receipt,adapterVersion}'$new$);
 execute d;
 for before_definition in select unnest(array[
  'public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)',
  'public.static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text)']) loop
  d:=pg_get_functiondef(before_definition::regprocedure);
  if position($old$p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'$old$ in d)=0 then
   raise exception 'draft provenance adapter seam missing in %',before_definition; end if;
  execute replace(d,$old$p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'$old$,
   $new$p_input_provenance->>'adapter_schema' is distinct from p_document#>>'{adapter,schema}'$new$);
 end loop;
end $authority$;

-- v3 compact semantic snapshots bind the new derivation without duplicating
-- the template/segments. Retain exact v2 validation for historical v1 documents.
do $snapshots$
declare d text;
begin
 d:=pg_get_functiondef('public.static_weekly_assert_document_attested(jsonb,date,boolean)'::regprocedure);
 if (length(d)-length(replace(d,'''relational_assignments_digest'']','')))/length('''relational_assignments_digest'']')<>2 then
  raise exception 'recurring snapshot shape seam missing'; end if;
 d:=replace(d,'''relational_assignments_digest'']','''relational_assignments_digest'']||case when p_document#>>''{adapter,schema}''=''memphis-zoo.static-weekly-database-adapter.v2'' then array[''derived_baseline_digest'',''shift_end_derivation_digest''] else ''{}''::text[] end');
 d:=replace(d,$old$p_document#>>'{semantic_snapshot,schema}' is distinct from 'memphis-zoo.static-weekly-recurring-semantic-snapshot.v2'$old$,
  $new$p_document#>>'{semantic_snapshot,schema}' is distinct from (case p_document#>>'{adapter,schema}' when 'memphis-zoo.static-weekly-database-adapter.v2' then 'memphis-zoo.static-weekly-recurring-semantic-snapshot.v3' else 'memphis-zoo.static-weekly-recurring-semantic-snapshot.v2' end)$new$);
 d:=replace(d,$old$  v_legacy:=p_document-'semantic_snapshot'-'attestation';$old$,$new$
  if p_document#>>'{adapter,schema}'='memphis-zoo.static-weekly-database-adapter.v2' and (
   p_document#>'{semantic_snapshot,derived_baseline_digest}' is distinct from coalesce(p_document#>'{authority,derivedBaselineDigest}',p_document#>'{authority,baselineInputDigest}')
   or p_document#>'{semantic_snapshot,shift_end_derivation_digest}' is distinct from to_jsonb(public.static_weekly_digest_jsonb(coalesce(p_document#>'{authority,shiftEndDerivation}','null'::jsonb)))) then
   raise exception 'recurring snapshot does not bind exact derived baseline'; end if;
  v_legacy:=p_document-'semantic_snapshot'-'attestation';$new$);
 execute d;
 d:=pg_get_functiondef('public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,'''active_assignments_digest''],','')))/length('''active_assignments_digest''],')<>2 then
  raise exception 'projection snapshot shape seam missing'; end if;
 d:=replace(d,'''active_assignments_digest''],','''active_assignments_digest'']||case when p_envelope#>>''{adapter,schema}''=''memphis-zoo.static-weekly-database-adapter.v2'' then array[''derived_baseline_digest'',''shift_end_derivation_digest''] else ''{}''::text[] end,');
 d:=replace(d,$old$v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-projection-semantic-snapshot.v2'$old$,
  $new$v_snapshot->>'schema' is distinct from (case p_envelope#>>'{adapter,schema}' when 'memphis-zoo.static-weekly-database-adapter.v2' then 'memphis-zoo.static-weekly-projection-semantic-snapshot.v3' else 'memphis-zoo.static-weekly-projection-semantic-snapshot.v2' end)$new$);
 d:=replace(d,$old$  v_legacy:=p_envelope-'semantic_snapshot'-'attestation';$old$,$new$
  if p_envelope#>>'{adapter,schema}'='memphis-zoo.static-weekly-database-adapter.v2' and (
   v_snapshot->'derived_baseline_digest' is distinct from coalesce(p_envelope#>'{authority,derivedBaselineDigest}',p_envelope#>'{authority,baselineInputDigest}')
   or v_snapshot->'shift_end_derivation_digest' is distinct from to_jsonb(public.static_weekly_digest_jsonb(coalesce(p_envelope#>'{authority,shiftEndDerivation}','null'::jsonb)))) then
   raise exception 'projection snapshot does not bind exact derived baseline'; end if;
  v_legacy:=p_envelope-'semantic_snapshot'-'attestation';$new$);
 execute d;
end $snapshots$;

-- A later dated roster can create a new closing segment that did not exist in
-- the first published week's relational rows. Retain its exact immutable
-- parent link, not a null link or a fabricated overlay flag. The complete
-- attested derivation/parent proof above is checked before this writer loop.
do $occurrence_parent$
declare d text; seam text := 'select * into v_assignment from public.weekly_schedule_slot_assignments where version_id=v_publication.version_id and day_of_week=(v_item->>''day_of_week'')::smallint and work_id=v_item->>''work_id'';';
begin
 d:=pg_get_functiondef('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 if (length(d)-length(replace(d,seam,'')))/length(seam)<>1 then raise exception 'materialized occurrence parent-link seam missing'; end if;
 d:=replace(d,seam,$new$
 if p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'
    and (v_work->>'overlayWork') is distinct from 'true' then
  select baseline.* into strict v_assignment
   from public.weekly_schedule_slot_assignments baseline
   join jsonb_array_elements(p_assignments#>'{authority,shiftEndDerivation,parentChains}') chain
    on baseline.work_id=chain->>'parentWorkId' and baseline.day_of_week=(chain->>'dayOfWeek')::smallint
   join lateral jsonb_array_elements(chain->'segments') segment on segment->>'workId'=v_item->>'work_id'
   where baseline.version_id=v_publication.version_id and baseline.day_of_week=(v_item->>'day_of_week')::smallint;
 else
  select * into v_assignment from public.weekly_schedule_slot_assignments
   where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';
 end if;
 $new$);
 if position('active baseline work must retain its stored baseline assignment link' in d)=0 then raise exception 'baseline link safety gate missing'; end if;
 execute d;
end $occurrence_parent$;

-- All helpers are already private; only the new pure validator needs a new
-- grant record. Rebind every altered definition and exact ACL into recovery.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare identity text; kind text; definition text; bucket integer; next_order integer;
begin
 foreach identity in array array[
  'public.static_weekly_v9_assert_shift_end_derivation(jsonb)',
  'public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)',
  'public.static_weekly_assert_document(jsonb,date,boolean)',
  'public.static_weekly_assert_document_attested(jsonb,date,boolean)',
  'public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)',
  'public.static_weekly_v4_assert_projection_envelope_single_location_base(jsonb,uuid,date,jsonb)',
  'public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)',
  'public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)',
  'public.static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text)'] loop
  foreach kind in array array['function','grant'] loop
   definition:=case kind when 'function' then pg_get_functiondef(identity::regprocedure)
    else public.custodial_release_authority_current_grant_definition(identity) end;
   if definition is null then raise exception 'missing continuity recovery object %',identity; end if;
   update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind=kind and (case when object_kind in ('function','grant') then to_regprocedure(object_identity) end)=identity::regprocedure;
   if not found then
    bucket:=case kind when 'function' then 100000 else 900000 end;
    select coalesce(max(restore_order),bucket)+1 into next_order from public.custodial_release_authority_restore_inventory where restore_order>=bucket and restore_order<bucket+100000;
    insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     values(next_order,kind,identity,definition,public.static_weekly_digest_text(definition));
   end if;
   if not exists(select 1 from public.custodial_release_authority_restore_inventory
    where object_kind=kind and (case when object_kind in ('function','grant') then to_regprocedure(object_identity) end)=identity::regprocedure
    and definition_sql=definition and definition_sha256=public.static_weekly_digest_text(definition)) then
    raise exception 'continuity recovery binding failed for %',identity; end if;
  end loop;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
