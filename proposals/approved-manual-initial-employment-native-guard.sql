-- Main initial operationalization guard; native feasibility remains exact. Not a canonical migration.
begin;
create or replace function public.static_weekly_manual_assert_initial_employment_projection(p_operation uuid,p_manager uuid,p_envelope jsonb,p_lunch jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare ctx jsonb;basis jsonb;snapshot jsonb:=p_envelope->'semantic_snapshot';a jsonb:=p_envelope->'authority';source jsonb;
 frame date;publication uuid;version uuid;expected_dates jsonb;day date;dow integer;normal_day jsonb;day_basis jsonb;plan jsonb;
 item jsonb;w jsonb;parent jsonb;link jsonb;availability jsonb;expected jsonb;actual jsonb;slot jsonb;person jsonb;
 base jsonb;exceptions jsonb;summary jsonb;links jsonb:='{}';expected_availability jsonb:='[]';absent jsonb;
 complete_start text;complete_end text;normal_start text;normal_end text;previous_owner text;previous_end text;
 row_owner text;owner_config jsonb;code text;normal_changed boolean;day_changed boolean;inherited boolean;
 input jsonb;phase jsonb;previous_phase jsonb;slice jsonb;loan jsonb;owners jsonb;points jsonb;anchors jsonb;policy jsonb;
 p_loss numeric;l_loss numeric;n integer;minutes numeric;total_minutes numeric;weighted_p numeric;weighted_l numeric;actual_effort numeric;
 count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;employment_employee jsonb;pre_start jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);
 if ctx->>'schema' is distinct from 'custodial.initial-employment-native-sql-context.v1'
  or ctx->>'kind' is distinct from 'INITIAL_EMPLOYMENT_OPERATIONALIZATION'
  or ctx->>'operationId' is distinct from p_operation::text or ctx->>'managerId' is distinct from p_manager::text
  or ctx->'stagedEnvelope' is distinct from p_envelope or ctx->'stagedLunch' is distinct from p_lunch
  or ctx->>'candidateDigest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('envelope',p_envelope,'lunch',p_lunch))
 then raise exception 'Exact original staged initial employment scope required';end if;
 perform public.static_weekly_assert_exact_object(p_envelope,
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'manual native projection');
 perform public.static_weekly_assert_exact_object(snapshot,
  array['schema','initialActivation','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],
  array['schema','initialActivation','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],'manual native original snapshot');
 if snapshot->>'schema' is distinct from 'custodial.approved-manual-initial-employment-snapshot.v1'
  or snapshot->'initialActivation' is distinct from jsonb_build_object('kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION',
   'operationId',p_operation,'managerId',p_manager,'sourceId',ctx->'sourceId','publicationId',ctx->'publicationId','versionId',ctx->'versionId',
   'frameStart',ctx->'frameStart','frameEnd',ctx->'frameEnd','authorityRevision',ctx->'authorityRevision')
  or coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(snapshot->>'nativeBasisDigest','')!~'^[0-9a-f]{64}$'
 then raise exception 'Manual native original command differs';end if;
 frame:=(snapshot->>'weekStart')::date;publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 basis:=ctx->'basis';
 source:=basis->'normalSource';version:=(basis->>'versionId')::uuid;exceptions:=basis->'preparedExceptions';summary:=basis->'preparedSummary';
 if frame::text is distinct from basis->>'frameStart' or snapshot->'originalSource' is distinct from basis->'originalSource'
  or snapshot->'generation' is distinct from basis->'generation' or snapshot->'catalogEntryDigest' is distinct from basis->'catalogEntryDigest'
  or snapshot->'nativeBasisDigest' is distinct from basis->'basisDigest'
 then raise exception 'Manual native current Source or preparation basis changed';end if;
 if frame::text is distinct from ctx->>'frameStart' or publication::text is distinct from ctx->>'publicationId'
  or (frame+6)::text is distinct from ctx->>'frameEnd' then raise exception 'Initial native actual publication/frame changed';end if;
 select jsonb_agg(d::date::text order by d) into expected_dates from generate_series(frame,frame+6,'1 day') d;
 if snapshot->'scopeDates' is distinct from expected_dates or a->'compilerInput' is distinct from source
  or a->>'schema' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
  or a->>'sourceDigest' is distinct from basis->>'normalSourceDigest'
  or a->>'sourcePublicationId' is distinct from publication::text or a->>'sourceVersionId' is distinct from version::text
  or a->>'frameStart' is distinct from frame::text or a->>'frameEnd' is distinct from (frame+6)::text
  or a->'normalSourceChanged' is distinct from 'false'::jsonb or a->'objectiveSolverRerun' is distinct from 'false'::jsonb
  or a->>'acceptedExceptionsDigest' is distinct from public.static_weekly_digest_jsonb(exceptions)
  or a->'employmentRevisionVector' is distinct from basis->'employmentRevisionVector'
  or a->>'formulaObjectiveDigest' is distinct from '7796e95573b389d8d77fc80502d4f6f7f1b54a5155327f9a7f1eb42a7137f531'
  or p_envelope->'applied_exceptions' is distinct from summary
  or p_envelope->'adapter' is distinct from '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
  or p_envelope->>'compiler_version' is distinct from 'approved-manual-period-v1'
  or p_envelope->>'service_date' is distinct from frame::text or p_envelope->>'week_start' is distinct from frame::text
  or p_envelope->>'week_end' is distinct from (frame+6)::text
  or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(a)
  or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  or p_envelope->'objective' is distinct from jsonb_build_object('contract','OWNER_APPROVED_MANUAL_DATED_75_25_V2',
   'formulaObjectiveDigest',a->'formulaObjectiveDigest','proximityPercent',75,'workloadPercent',25,'normalDaysOptimized',false)
  or p_envelope->'metrics' is distinct from jsonb_build_object('hardConstraints',a->'hardConstraintCount','violations',0)
  or p_envelope#>>'{receipt,schema}' is distinct from 'custodial.approved-manual-native-feasibility-data.v1'
  or p_envelope#>'{receipt,hardConstraintCount}' is distinct from a->'hardConstraintCount'
  or p_envelope#>'{receipt,hardConstraintDigest}' is distinct from a->'hardConstraintDigest'
  or p_envelope#>'{receipt,fixedWitnessDigest}' is distinct from a->'fixedWitnessDigest'
 then raise exception 'Manual native envelope identity or approved formula differs';end if;
 if jsonb_typeof(p_envelope->'assignments') is distinct from 'array' or jsonb_array_length(p_envelope->'assignments') not between 1 and 4096
  or jsonb_typeof(a->'datedDayBases') is distinct from 'array' or jsonb_array_length(a->'datedDayBases')>7
  or jsonb_typeof(a->'parentLinks') is distinct from 'array' or jsonb_array_length(a->'parentLinks')>4096
  or jsonb_typeof(a->'projectionAvailability') is distinct from 'array' or jsonb_array_length(a->'projectionAvailability')>224
  or (select count(*)<>count(distinct r->>'plan_work_id') from jsonb_array_elements(p_envelope->'assignments') r)
  or (select count(*)<>count(distinct r->>'serviceDate') from jsonb_array_elements(a->'datedDayBases') r)
  or (select count(*)<>count(distinct r->>'workId') from jsonb_array_elements(a->'parentLinks') r)
 then raise exception 'Manual native bounded unique records required';end if;
 -- This first admission supports full-day canonical PTO/absence and its exact
 -- cancellation. Other exception shapes fail closed, never silently disappear.
 if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')
 then raise exception using errcode='0A000',message='Manual native exception requires its qualified dated profile';end if;
 policy:=public.static_weekly_manual_absence_policy();
 for base in select value from jsonb_array_elements(source#>'{version,slotAvailability}') loop
  dow:=(base->>'dayOfWeek')::integer;day:=frame+mod(dow-extract(dow from frame)::integer+7,7);
  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);
  if availability->>'status'='working' and (
   exists(select 1 from jsonb_array_elements(exceptions) e
    join jsonb_array_elements(source#>'{version,slotAvailability}') av on av->'slotId'=e#>'{payload,slotId}' and av->>'dayOfWeek'=dow::text and av->>'status'='working'
    where e->>'serviceDate'=day::text and e->>'type' in('pto','daily_absence'))
   or exists(select 1 from jsonb_array_elements(basis->'employmentByDate') ed
    cross join lateral jsonb_array_elements(ed->'employees') ee
    join jsonb_array_elements(source->'slots') es on exists(select 1 from jsonb_array_elements(es->'incumbencies') ei
     where ei->'personId'=ee->'employeeId' and (ei->>'effectiveStart')::date<=day and (ei->>'effectiveEnd' is null or day<(ei->>'effectiveEnd')::date))
    join jsonb_array_elements(source#>'{version,slotAvailability}') ea on ea->'slotId'=es->'id' and ea->>'dayOfWeek'=dow::text and ea->>'status'='working'
    where ed->>'serviceDate'=day::text and (ee#>>'{command,fact,state}'='PRE_START' or day<(ee#>>'{command,fact,firstServiceDate}')::date))) then
   availability:=availability||'{"blockedWindows":[]}'::jsonb;
  end if;
  select s into strict slot from jsonb_array_elements(source->'slots') s where s->'id'=base->'slotId';
  select i into strict person from jsonb_array_elements(slot->'incumbencies') i
   where (i->>'effectiveStart')::date<=day and (i->>'effectiveEnd' is null or day<(i->>'effectiveEnd')::date);
  select e into employment_employee from jsonb_array_elements(basis->'employmentByDate') d
   cross join lateral jsonb_array_elements(d->'employees') e
   where d->>'serviceDate'=day::text and e->'employeeId'=person->'personId';
  if base->>'status'='working' and employment_employee is not null and
   (employment_employee#>>'{command,fact,state}'='PRE_START' or day<(employment_employee#>>'{command,fact,firstServiceDate}')::date) then
   availability:=availability||'{"status":"absent","blockedWindows":[{"start":"00:00","end":"23:59"}],"unavailabilityClassification":"PRE_START_NOT_PTO"}'::jsonb;
  end if;
  expected_availability:=expected_availability||jsonb_build_array(availability||jsonb_build_object(
   'serviceDate',day::text,'incumbentPersonId',person->'personId','incumbentName',person->'displayName'));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into actual from jsonb_array_elements(a->'projectionAvailability') r;
 if actual is distinct from expected then raise exception 'Manual native static hours, eligibility or actual absence changed';end if;

 for day in select generate_series(frame,frame+6,'1 day')::date loop
  dow:=extract(dow from day)::integer;
  select r into strict normal_day from jsonb_array_elements(policy->'days') r where r->>'weekday'=dow::text;
  select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into absent
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='absent';
  select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into pre_start
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'unavailabilityClassification'='PRE_START_NOT_PTO';
  day_changed:=jsonb_array_length(absent)>0;
  select r into day_basis from jsonb_array_elements(a->'datedDayBases') r where r->>'serviceDate'=day::text;
  if day_changed is distinct from (day_basis is not null) then raise exception 'Manual native complete dated day set differs';end if;
  normal_start:=normal_day#>>'{checkedWindow,start}';normal_end:=normal_day#>>'{checkedWindow,end}';
  select max(r#>>'{shift,start}'),max(r#>>'{shift,end}') into complete_start,complete_end
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
  if complete_start is null or complete_start>=complete_end then raise exception 'Manual native staffed window is empty';end if;
  if day_changed then
   if jsonb_array_length(absent) not between 1 and 2 or day_basis->>'kind' is distinct from 'ABSENCE' then
    raise exception using errcode='0A000',message='Third absence requires the retained two-absence basis and actual CoverAll hours';end if;
   input:=day_basis->'input';plan:=day_basis->'plan';
   if input->>'inputDigest' is distinct from public.static_weekly_digest_jsonb(input-'inputDigest')
    or plan->>'planDigest' is distinct from public.static_weekly_digest_jsonb(plan-'planDigest')
    or input->'sourceDigest' is distinct from a->'sourceDigest' or input->'formulaObjectiveDigest' is distinct from a->'formulaObjectiveDigest'
    or input->>'serviceDate' is distinct from day::text or plan->>'serviceDate' is distinct from day::text
    or input->'absentPersonIds' is distinct from absent or plan->'absentPersonIds' is distinct from absent
    or coalesce(input->'preStartPersonIds','[]') is distinct from pre_start
    or (jsonb_array_length(pre_start)>0 and input->>'preStartClassification' is distinct from 'PRE_START_NOT_PTO')
    or input->'checkedWindow' is distinct from jsonb_build_object('start',complete_start,'end',complete_end)
    or plan->'checkedWindow' is distinct from input->'checkedWindow' or plan->'inputDigest' is distinct from input->'inputDigest'
    or plan->'proposalDigest' is distinct from a->'formulaObjectiveDigest' or input->'access' is distinct from policy->'access'
    or input->'groups' is distinct from policy->'groups' or plan->'groups' is distinct from policy->'groups'
    or plan->'hardFeasibilityValidatedBeforeScoring' is distinct from 'true'::jsonb or plan->'globalOptimalityClaim' is distinct from 'false'::jsonb
    or exists(select 1 from unnest(array['publicationEligible','weeklyBaselineChanged','productionWritten','contractorBooked']) k where plan->k is distinct from 'false'::jsonb)
   then raise exception 'Manual native dated immutable input, source or formula changed';end if;
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'incumbentPersonId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'personId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into actual from jsonb_array_elements(input->'roster') r;
   if expected is distinct from actual then raise exception 'Manual native dated roster changed';end if;
   for item in select value from jsonb_array_elements(input->'roster') loop
    select r->'baseGroups' into strict expected from jsonb_array_elements(normal_day->'employees') r where r->>'name'=item->>'name';
    select coalesce(jsonb_agg(to_jsonb(r->>'code') order by ord),'[]') into actual
     from jsonb_array_elements(expected) with ordinality x(name,ord) join jsonb_array_elements(policy->'groups') r on r->'name'=name;
    if item->'baseCodes' is distinct from actual then raise exception 'Manual native distance anchor changed from approved normal day';end if;
   end loop;
  end if;

  for item in select value from jsonb_array_elements(p_envelope->'assignments') where value->>'service_date'=day::text loop
   w:=item->'work_snapshot';parent:=null;link:=null;
   select r into parent from jsonb_array_elements(source#>'{version,assignments}') r
    where r->>'dayOfWeek'=dow::text and r->'workId'=item->'work_id';
   if parent is null then
    select r into strict link from jsonb_array_elements(a->'parentLinks') r where r->'workId'=item->'work_id';
    select r into strict parent from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->'workId'=link->'parentWorkId';
    if link->'serviceDate' is distinct from item->'service_date' or link->'window' is distinct from w->'window' or link->'slotId' is distinct from item->'owner_slot_id'
     or coalesce(item->>'work_id','')!~'^manual-dated:[0-9a-f]{64}$' then raise exception 'Manual native parent lineage differs';end if;
   end if;
   select r into strict availability from jsonb_array_elements(expected_availability) r where r->'slotId'=item->'owner_slot_id' and r->>'serviceDate'=day::text;
   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';
   window_start:=w#>>'{window,start}';window_end:=w#>>'{window,end}';
   perform public.static_weekly_v3_assert_window(w->'window','manual native custody');
   if item->>'status' is distinct from 'assigned' or item->'reason_code' is distinct from 'null'::jsonb
    or item->>'day_of_week' is distinct from dow::text or item->>'plan_work_id' is distinct from dow::text||':'||(item->>'work_id')
    or item->'owner_person_id' is distinct from availability->'incumbentPersonId' or item->'optimized_owner_person_id' is distinct from item->'owner_person_id'
    or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'
    or availability->>'status' is distinct from 'working' or window_start<availability#>>'{shift,start}' or window_end>availability#>>'{shift,end}'
    or item->'baseline_owner_slot_id' is distinct from parent->'originSlotId' or w->'originSlotId' is distinct from parent->'originSlotId'
   then raise exception 'Manual native actual static owner, window or original actor changed';end if;
   select r into strict base from jsonb_array_elements(expected_availability) r where r->'slotId'=parent->'originSlotId' and r->>'serviceDate'=day::text;
   if item->'baseline_owner_person_id' is distinct from base->'incumbentPersonId' or item->'original_actor_person_id' is distinct from base->'incumbentPersonId'
    or item->'baseline_owner_name' is distinct from base->'incumbentName' or item->'original_actor_name' is distinct from base->'incumbentName'
    or item->>'owner_digest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',item->'plan_work_id','slotId',item->'owner_slot_id','personId',item->'owner_person_id','serviceDate',item->'service_date'))
    or item->>'exact_owner_identity' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',item->'plan_work_id','service_date',item->'service_date','optimized_owner_slot_id',item->'owner_slot_id','optimized_owner_person_id',item->'owner_person_id','baseline_owner_slot_id',parent->'originSlotId','baseline_owner_person_id',base->'incumbentPersonId'))
   then raise exception 'Manual native owner lineage digest changed';end if;
   inherited:=day_changed and exists(select 1 from jsonb_array_elements(plan->'phaseOwners') with ordinality x(ph,phase_number)
    where phase_number>1 and ph#>>'{window,start}'<=window_start and window_start<ph#>>'{window,end}');
   expected:=jsonb_build_object('workId',item->'work_id','dayOfWeek',dow,'originSlotId',parent->'originSlotId',
    'locationId',parent->'locationId','locationCodeSnapshot',parent->'locationCodeSnapshot','locationNameSnapshot',parent->'locationNameSnapshot',
    'serviceMode',parent->'serviceMode','includedLocations',parent->'includedLocations','window',w->'window',
    'serviceEffortMinutes',w->'serviceEffortMinutes','serviceEffortProvenance',w->'serviceEffortProvenance',
    'priority',parent->'priority','priorityProvenance',parent->'priorityProvenance','required',parent->'required',
    'coveragePolicy',null,'bestEffortCoverage',false,'coveragePolicyOrder',null,'coveragePolicyProvenance',null,
    'requiredQualifications',parent->'requiredQualifications','qualificationProvenance',parent->'qualificationProvenance',
    'restrictions',parent->'restrictions','restrictionProvenance',parent->'restrictionProvenance','restrictedSlotIds',parent->'restrictedSlotIds',
    'manualLock',false,'manualLockSlotId',null,'overlayWork',false);
   if jsonb_array_length(coalesce(parent->'normalAssignmentRestrictedSlotIds','[]'))>0 then
    expected:=expected||jsonb_build_object('normalAssignmentRestrictedSlotIds',parent->'normalAssignmentRestrictedSlotIds','coveragePurpose',parent->'coveragePurpose');
   end if;
   if inherited and dow<>1 and parent->>'locationCodeSnapshot'='HERPETARIUM'
    and parent->'restrictedSlotIds' ? (basis#>>'{ownerConfig,slots,ALIJAH,slotId}') then
    expected:=expected||jsonb_build_object('restrictedSlotIds',(parent->'restrictedSlotIds')-(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'normalAssignmentRestrictedSlotIds',jsonb_build_array(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'coveragePurpose','INHERITED_ALERTS_AND_ISSUES_ONLY','restrictionProvenance',(parent->>'restrictionProvenance')||';normal-assignment-scope:fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f');
   end if;
   if w is distinct from expected or not ((availability->'qualifications') @> (w->'requiredQualifications'))
    or w->'restrictedSlotIds' ? (item->>'owner_slot_id') or owner_config->'hardForbiddenFamilies' ? (w->>'locationCodeSnapshot')
    or exists(select 1 from jsonb_array_elements(w->'includedLocations') r where availability->'restrictions' ? (r->>'locationId'))
    or (item->>'owner_slot_id'=basis#>>'{ownerConfig,slots,TAMMY,slotId}' and w->>'locationCodeSnapshot' not in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS','CHINA'))
   then raise exception 'Manual native physical members, hard eligibility or scoped restriction changed: work %, fields %',item->>'work_id',
    (select coalesce(jsonb_agg(k order by k),'[]') from (select jsonb_object_keys(w||expected) k) q where w->k is distinct from expected->k);end if;
   if not day_changed and (link is not null or item->'owner_slot_id' is distinct from parent->'ownerSlotId' or w->'window' is distinct from parent->'window'
    or w->'serviceEffortMinutes' is distinct from parent->'serviceEffortMinutes' or w->'serviceEffortProvenance' is distinct from parent->'serviceEffortProvenance')
   then raise exception 'Manual native changed an approved normal day';end if;
   if day_changed and (window_end>parent#>>'{window,end}' or window_start<case
    when parent#>>'{window,start}'<=normal_start and parent#>>'{window,end}'>normal_start
     then least(parent#>>'{window,start}',complete_start) else parent#>>'{window,start}' end)
   then raise exception 'Manual native custody exceeds its exact parent boundary';end if;
   -- A single unchanged owner can continue across the complete-crew arrival.
   -- That harmless merged row must still preserve the whole early base prefix.
   if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'
    or window_start<>parent#>>'{window,start}' or window_end<least(parent#>>'{window,end}',complete_start))
   then raise exception 'Manual native early own-base custody differs';end if;
   if day_changed and window_end>complete_start then
    if window_end>complete_end then raise exception 'Manual native actual full-site window differs';end if;
    for phase in select value from jsonb_array_elements(plan->'phaseOwners') where value#>>'{window,start}'<window_end and window_start<value#>>'{window,end}' loop
     if phase#>>array['owners',w->>'locationCodeSnapshot'] is distinct from item->>'owner_slot_id' then raise exception 'Manual native selected phase differs from stored custody';end if;
    end loop;
   end if;
   select assignment_id into strict assignment from public.weekly_schedule_slot_assignments
    where version_id=version and day_of_week=dow and work_id=parent->>'workId';
   links:=links||jsonb_build_object(item->>'plan_work_id',assignment::text);
  end loop;

  -- Every physical group tiles the complete actual staffed window once.
  for code in select r->>'code' from jsonb_array_elements(policy->'groups') r loop
   previous_end:=complete_start;previous_owner:=null;
   for item in select r from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text
    and r#>>'{work_snapshot,locationCodeSnapshot}'=code and r#>>'{work_snapshot,window,end}'>complete_start
    order by r#>>'{work_snapshot,window,start}' loop
    window_start:=greatest(complete_start,item#>>'{work_snapshot,window,start}');window_end:=least(complete_end,item#>>'{work_snapshot,window,end}');
    if window_end<=window_start then continue;end if;
    if window_start<>previous_end then raise exception 'Manual native full-site gap or overlap';end if;
    if day_changed and previous_owner is not null and previous_owner<>item->>'owner_slot_id' and not exists(
     select 1 from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
    then raise exception 'Manual native owner moved before the static departure';end if;
    previous_end:=window_end;previous_owner:=item->>'owner_slot_id';
   end loop;
   if previous_end<>complete_end then raise exception 'Manual native full-site coverage incomplete';end if;
   select sum((r->>'serviceEffortMinutes')::integer) into budget from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->>'locationCodeSnapshot'=code;
   select sum((r#>>'{work_snapshot,serviceEffortMinutes}')::integer) into actual_effort from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text and r#>>'{work_snapshot,locationCodeSnapshot}'=code;
   if actual_effort is distinct from budget then raise exception 'Manual native combined group workload budget changed';end if;
  end loop;
  if not day_changed and (select count(*) from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text)
   <>(select count(*) from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text)
  then raise exception 'Manual native omitted approved normal rows';end if;
  if day_changed then
   perform public.static_weekly_manual_assert_absence_score(day_basis,normal_day,policy,expected_availability,p_envelope->'assignments',basis->'ownerConfig');
  end if;
 end loop;
 if (select count(*) from jsonb_object_keys(links))<>jsonb_array_length(p_envelope->'assignments')
  or exists(select 1 from jsonb_array_elements(a->'parentLinks') l where not exists(select 1 from jsonb_array_elements(p_envelope->'assignments') r where r->'work_id'=l->'workId' and r->'service_date'=l->'serviceDate'))
 then raise exception 'Manual native foreign row or unused parent link';end if;
 if summary is distinct from public.static_weekly_accepted_exception_set(publication,frame)
 then raise exception 'Manual native original fact did not become exact accepted authority';end if;
 perform public.static_weekly_manual_assert_native_lunch(NULL,p_lunch,p_envelope,publication,frame);
 return jsonb_build_object('assignment_links',links,'projection_assignments',p_envelope->'assignments','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION');
end $fn$;
revoke all on function public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
commit;
