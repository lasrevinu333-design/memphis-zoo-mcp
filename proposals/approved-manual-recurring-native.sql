-- Worker1 typed recurring materialization companion. Main SQL qualification REQUIRED.
-- Install AFTER employment/native/CoverAll/initial guard/recurring-period;
-- BEFORE notification continuity, typed device delivery and admission-proof LAST.
-- No normal source, staffing command, employee, exception or optimizer receipt is created.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
DO $requires$ BEGIN
 IF current_user<>session_user OR current_user NOT IN('postgres','supabase_admin')
  OR to_regprocedure('public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)') IS NULL
  OR to_regprocedure('public.static_weekly_coverall_initial_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)') IS NULL
  OR to_regprocedure('public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)') IS NULL
 THEN RAISE EXCEPTION 'Qualified current manual native/initial/recurring predecessors required';END IF;
END $requires$;
-- Bounded successor of the already-installed repeat reader. Do not rerun its
-- schema. Only the unsafe bare-projection shortcut changes, with full inverse.
DO $repeat_reader_counterpart$
DECLARE original text;changed text;inverse text;needle text;replacement text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text)'::regprocedure);
 needle:=$old$ SELECT p.projection_id INTO existing FROM public.weekly_schedule_compiled_projections p
 WHERE p.publication_id=p_publication AND p.version_id=v_version_id AND p.week_start=frame AND p.week_end=frame+6
  AND p.exception_set_digest=public.static_weekly_digest_jsonb(exceptions)
 ORDER BY p.compiled_at DESC,p.projection_id DESC LIMIT 1;$old$;
 replacement:=$new$ -- A bare same-frame projection does not prove current employment14 or a
 -- normal-reference admission. The typed recurring owner always obtains a real
 -- same-request repeat receipt; native writer replay still deduplicates bytes.
 existing:=NULL;$new$;
 IF public.static_weekly_digest_text((SELECT prosrc FROM pg_proc WHERE oid='public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text)'::regprocedure))=ANY(ARRAY['a5b472d11b7ccf60cf88879f92f6dba17548ae15bc9b635e4104958ce088d0ad','9afab5601c8b799fd57d51c06c56d350dc7acbd2174259f2a28c8b55ba2848f4'])
 THEN RETURN;END IF;
 IF length(original)-length(replace(original,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Installed repeat reader shortcut predecessor differs';END IF;
 changed:=replace(original,needle,replacement);inverse:=replace(changed,replacement,needle);
 IF inverse<>original THEN RAISE EXCEPTION 'Repeat reader full inverse differs';END IF;EXECUTE changed;
END $repeat_reader_counterpart$;
CREATE TABLE custodial_coverall.recurring_materialization_operations(
 operation_id uuid PRIMARY KEY,manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),request_json jsonb NOT NULL,
 owner_xid xid8 NOT NULL,backend_pid integer NOT NULL,credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL,
 source_id uuid NOT NULL,publication_id uuid NOT NULL,version_id uuid NOT NULL,frame_start date NOT NULL,authority_revision bigint NOT NULL,
 basis_json jsonb,repeat_basis jsonb,source_digest text NOT NULL,catalog_digest text NOT NULL,generation bigint NOT NULL,
 UNIQUE(manager_id,idempotency_key),CHECK((basis_json IS NULL)<>(repeat_basis IS NULL))
);
CREATE TABLE custodial_coverall.recurring_materialization_stages(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.recurring_materialization_operations,
 envelope_json jsonb NOT NULL,lunch_json jsonb NOT NULL,candidate_digest text NOT NULL
);
CREATE TABLE custodial_coverall.recurring_materialization_receipts(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.recurring_materialization_operations,receipt_json jsonb NOT NULL
);
DO $tables$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['recurring_materialization_operations','recurring_materialization_stages','recurring_materialization_receipts'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',n);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',n);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',n);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',n);
 END LOOP;
END $tables$;
CREATE FUNCTION public.static_weekly_manual_recurring_require_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_coverall.recurring_materialization_receipts WHERE operation_id=NEW.operation_id)
 THEN RAISE EXCEPTION 'Recurring begin/stage cannot COMMIT without its same-transaction accepted projection and lunch';END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER complete_recurring_receipt AFTER INSERT ON custodial_coverall.recurring_materialization_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.static_weekly_manual_recurring_require_receipt();
ALTER TABLE custodial_coverall.recurring_materialization_operations ENABLE ALWAYS TRIGGER complete_recurring_receipt;

-- Only recorded original normal incumbencies are mathematical source. A live
-- replacement never silently becomes a new normal owner. Roster drift excludes
-- the original employee as unavailable DATA, not a fabricated canonical PTO.
CREATE FUNCTION public.static_weekly_manual_recurring_roster_unavailable(p_source jsonb,p_frame date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce(jsonb_agg(jsonb_build_object('serviceDate',d::date::text,'slotId',s->'id','employeeId',i->'personId') ORDER BY d,s->>'id'),'[]')
 FROM generate_series(p_frame,p_frame+6,'1 day') days(d)
 CROSS JOIN LATERAL jsonb_array_elements(p_source->'slots') slots(s)
 CROSS JOIN LATERAL jsonb_array_elements(s->'incumbencies') inc(i)
 JOIN LATERAL jsonb_array_elements(p_source#>'{version,slotAvailability}') av(a)
  ON a->'slotId'=s->'id' AND (a->>'dayOfWeek')::integer=extract(dow FROM d)::integer AND a->>'status'='working'
 WHERE (i->>'effectiveStart')::date<=d::date AND (i->>'effectiveEnd' IS NULL OR d::date<(i->>'effectiveEnd')::date)
  AND NOT EXISTS(SELECT 1 FROM public.v_weekly_roster_slot_incumbency_ranges r JOIN public.employees e ON e.id=r.person_id
   WHERE r.slot_id=(s->>'id')::uuid AND r.person_id=(i->>'personId')::uuid AND r.effective_start<=d::date
    AND (r.effective_end IS NULL OR d::date<r.effective_end) AND e.active)
$fn$;
CREATE FUNCTION public.static_weekly_manual_recurring_basis(p_manager uuid,p_publication uuid,p_frame date,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE basis jsonb;fixed_source jsonb;slots jsonb;canonical jsonb;days jsonb;body jsonb;
BEGIN
 basis:=public.static_weekly_manual_period_basis(p_manager,p_publication,p_frame,p_revision,NULL);
 SELECT s.canonical_source INTO STRICT canonical FROM public.static_weekly_authority_source_documents s
 WHERE s.source_id=(basis->>'sourceId')::uuid AND s.active AND s.retired_at IS NULL;
 IF NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_confirmations c WHERE c.publication_id=p_publication)
 THEN RAISE EXCEPTION 'Original accepted manual activation required';END IF;
 -- Preserve actual publication/version metadata, immutable original normal slots.
 fixed_source:=jsonb_set(basis->'normalSource','{slots}',canonical->'slots',false);
 SELECT coalesce(jsonb_agg(a.day_json||jsonb_build_object('choiceId',q.choice_id) ORDER BY a.service_date,a.operation_id),'[]') INTO days
 FROM custodial_coverall.accepted_days a JOIN custodial_coverall.choices q USING(operation_id)
 JOIN public.static_weekly_staffing_commands c USING(operation_id)
 WHERE a.publication_id=p_publication AND a.service_date BETWEEN p_frame AND p_frame+6 AND c.state='ACCEPTED'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.static_weekly_coverall_effective_facts(p_publication,p_frame)) e
    WHERE e->>'type'='cover_all' AND e->>'coverAllChoiceId'=q.choice_id::text AND e->>'serviceDate'=a.service_date::text);
 body:=(basis-'basisDigest')||jsonb_build_object('normalSource',fixed_source,'normalSourceDigest',public.static_weekly_digest_jsonb(fixed_source),
  'rosterUnavailableByDate',public.static_weekly_manual_recurring_roster_unavailable(fixed_source,p_frame),'acceptedCoverAllDays',days);
 IF jsonb_array_length(body->'employmentByDate')<>7 OR jsonb_array_length(body->'employmentRevisionVector')<>14
 THEN RAISE EXCEPTION 'Seven actual employment reads and14 bindings required';END IF;
 RETURN body||jsonb_build_object('basisDigest',public.static_weekly_digest_jsonb(body));
END $fn$;
CREATE FUNCTION public.static_weekly_begin_manual_recurring(p_request jsonb,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE manager uuid;op uuid;pub uuid;rev bigint;frame date;origin date;sid uuid;vid uuid;actor jsonb;basis jsonb;repeat_basis jsonb;
 prior custodial_coverall.recurring_materialization_operations%rowtype;receipt jsonb;source_digest text;catalog text;generation bigint;needs_native boolean;reason jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_request IS NULL OR pg_column_size(p_request)>16384 THEN RAISE EXCEPTION 'Bounded recurring original request required';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_request,
  ARRAY['schema','kind','operationId','managerId','publicationId','serviceDate','expectedRevision','idempotencyKey'],
  ARRAY['schema','kind','operationId','managerId','publicationId','serviceDate','expectedRevision','idempotencyKey'],'recurring original request');
 IF p_request->>'schema'<>'custodial.approved-manual-recurring-request.v1' OR p_request->>'kind'<>'RECURRING_MANUAL_MATERIALIZATION'
  OR jsonb_typeof(p_request->'idempotencyKey') IS DISTINCT FROM 'string' OR jsonb_typeof(p_request->'expectedRevision') IS DISTINCT FROM 'number'
  OR length(p_request->>'idempotencyKey') NOT BETWEEN 1 AND 200 OR btrim(p_request->>'idempotencyKey')<>p_request->>'idempotencyKey'
 THEN RAISE EXCEPTION 'Exact typed recurring request required';END IF;
 manager:=(p_request->>'managerId')::uuid;op:=(p_request->>'operationId')::uuid;pub:=(p_request->>'publicationId')::uuid;
 rev:=(p_request->>'expectedRevision')::bigint;frame:=(p_request->>'serviceDate')::date;
 actor:=public.custodial_action_actor_v1(manager,p_credential,p_device,p_access,'write');
 SELECT * INTO prior FROM custodial_coverall.recurring_materialization_operations WHERE manager_id=manager AND idempotency_key=p_request->>'idempotencyKey';
 IF FOUND THEN
  IF prior.request_json IS DISTINCT FROM p_request THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original recurring operation identity conflict';END IF;
  SELECT receipt_json INTO STRICT receipt FROM custodial_coverall.recurring_materialization_receipts WHERE operation_id=prior.operation_id;
  RETURN jsonb_build_object('state','ORIGINAL_RECEIPT','operationId',op,'receipt',receipt,'currentReadbackRepeated',false);
 END IF;
 IF rev IS DISTINCT FROM(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) OR frame IS NULL OR NOT isfinite(frame)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current recurring revision/date required';END IF;
 SELECT v.authority_source_id,v.version_id,p.effective_start,s.source_digest INTO STRICT sid,vid,origin,source_digest
 FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
 JOIN public.static_weekly_authority_source_documents s ON s.source_id=v.authority_source_id AND s.active AND s.retired_at IS NULL WHERE p.publication_id=pub;
 IF frame<origin OR mod(frame-origin,7)<>0 THEN RAISE EXCEPTION 'Exact publication-origin aligned frame required';END IF;
 needs_native:=frame=origin;
 IF NOT needs_native THEN
  repeat_basis:=public.static_weekly_read_manual_repeat_basis(manager,pub,frame,rev,p_credential,p_device,p_access);
  needs_native:=jsonb_array_length(repeat_basis->'adjustmentReasons')>0 OR jsonb_array_length(repeat_basis->'acceptedExceptions')>0 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(repeat_basis->'employmentByDate') ed CROSS JOIN LATERAL jsonb_array_elements(ed->'employees') ee
    JOIN LATERAL jsonb_array_elements(repeat_basis->'participants') part ON part->'serviceDate'=ed->'serviceDate'
   WHERE (ee#>>'{command,fact,state}'='PRE_START' OR (ed->>'serviceDate')::date<(ee#>>'{command,fact,firstServiceDate}')::date)
    AND ((part->'assignmentEmployeeIds')?(ee->>'employeeId') OR (part->'lunchOwnerEmployeeIds')?(ee->>'employeeId') OR (part->'lunchCovererEmployeeIds')?(ee->>'employeeId')));
 END IF;
 IF needs_native THEN basis:=public.static_weekly_manual_recurring_basis(manager,pub,frame,rev);repeat_basis:=NULL;END IF;
 catalog:=coalesce(basis->>'catalogEntryDigest',repeat_basis->>'catalogEntryDigest');generation:=coalesce((basis->>'generation')::bigint,(repeat_basis->>'generation')::bigint);
 PERFORM public.custodial_begin_application_mutation();
 INSERT INTO custodial_coverall.recurring_materialization_operations VALUES(op,manager,p_request->>'idempotencyKey',p_request,
  pg_current_xact_id(),pg_backend_pid(),p_credential,p_device,p_access,sid,pub,vid,frame,rev,basis,repeat_basis,source_digest,catalog,generation);
 RETURN jsonb_build_object('state',CASE WHEN needs_native THEN 'NATIVE_ADJUSTMENT_REQUIRED' ELSE 'NORMAL_REFERENCE_REQUIRED' END,
  'operationId',op,'backendPid',pg_backend_pid(),'transactionId',pg_current_xact_id()::text,'basis',basis,'repeatBasis',repeat_basis,'accepted',false,'committed',false);
END $fn$;
CREATE FUNCTION public.static_weekly_manual_recurring_context(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.recurring_materialization_operations%rowtype;stage_row custodial_coverall.recurring_materialization_stages%rowtype;
 employment jsonb:='[]';vector jsonb;service_day date;source_digest text;catalog text;ctx jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT a FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=p_operation;
 IF a.manager_id<>p_manager OR a.owner_xid<>pg_current_xact_id() OR a.backend_pid<>pg_backend_pid()
  OR a.authority_revision IS DISTINCT FROM(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)
  OR a.generation IS DISTINCT FROM public.static_weekly_v15_read_recurring_generation()
  OR public.static_weekly_effective_version(a.frame_start) IS DISTINCT FROM a.version_id
  OR public.static_weekly_effective_version(a.frame_start+6) IS DISTINCT FROM a.version_id
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Original physical recurring transaction/revision/generation/publication changed';END IF;
 PERFORM public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 IF a.basis_json IS NULL THEN RAISE EXCEPTION 'Native recurring context required';END IF;
 SELECT s.source_digest,c.catalog_entry_digest INTO STRICT source_digest,catalog FROM public.static_weekly_authority_source_documents s
 JOIN public.static_weekly_approved_initial_baselines b ON b.source_id=s.source_id JOIN public.static_weekly_approved_template_catalog c USING(template_id)
 WHERE s.source_id=a.source_id AND s.active AND s.retired_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_template_retirements r WHERE r.template_id=c.template_id);
 FOR service_day IN SELECT generate_series(a.frame_start,a.frame_start+6,'1 day')::date LOOP employment:=employment||jsonb_build_array(custodial_employment.native_read(service_day,a.authority_revision,p_manager));END LOOP;
 SELECT jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','employeeId',e->'employeeId','employmentRevision',e->'employmentRevision',
  'requestId',e#>>'{command,requestId}') ORDER BY d->>'serviceDate',e->>'employeeId') INTO vector
 FROM jsonb_array_elements(employment) days(d) CROSS JOIN LATERAL jsonb_array_elements(d->'employees') employees(e);
 IF source_digest IS DISTINCT FROM a.source_digest OR catalog IS DISTINCT FROM a.catalog_digest
  OR employment IS DISTINCT FROM a.basis_json->'employmentByDate' OR vector IS DISTINCT FROM a.basis_json->'employmentRevisionVector'
  OR public.static_weekly_compiler_exception_set(a.publication_id,a.frame_start) IS DISTINCT FROM a.basis_json->'preparedExceptions'
  OR public.static_weekly_accepted_exception_set(a.publication_id,a.frame_start) IS DISTINCT FROM a.basis_json->'preparedSummary'
  OR public.static_weekly_manual_recurring_roster_unavailable(a.basis_json->'normalSource',a.frame_start) IS DISTINCT FROM a.basis_json->'rosterUnavailableByDate'
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Actual recurring source/catalog/accepted facts/employment14/roster changed';END IF;
 SELECT * INTO stage_row FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=p_operation;
 RETURN jsonb_build_object('schema','custodial.recurring-employment-native-sql-context.v1','kind','RECURRING_MANUAL_MATERIALIZATION',
  'operationId',p_operation,'managerId',p_manager,'publicationId',a.publication_id,'versionId',a.version_id,'sourceId',a.source_id,
  'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',a.authority_revision,'basis',a.basis_json,
  'stagedEnvelope',stage_row.envelope_json,'stagedLunch',stage_row.lunch_json,'candidateDigest',stage_row.candidate_digest);
END $fn$;
CREATE FUNCTION public.static_weekly_recurring_exact_accepted_coverall_fact(p_operation uuid,p_manager uuid,p_publication uuid,p_frame date,p_fact jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS(SELECT 1 FROM custodial_coverall.recurring_materialization_operations o
  WHERE o.operation_id=p_operation AND o.manager_id=p_manager AND o.publication_id=p_publication AND o.frame_start=p_frame
   AND o.owner_xid=pg_current_xact_id() AND o.backend_pid=pg_backend_pid())
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.static_weekly_coverall_effective_facts(p_publication,p_frame)) e WHERE e=p_fact)
$fn$;

-- Preserve the installed full Main guard. Exact source-body hash and whole
-- inverse are mandatory: every native feasibility/hour/lunch check survives.
DO $guard_copy$
DECLARE original text;changed text;inverse text;seams jsonb;item jsonb;
BEGIN
 IF public.static_weekly_digest_text((SELECT prosrc FROM pg_proc WHERE oid='public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)'::regprocedure))
  IS DISTINCT FROM '851cb804b31409e79d386808d5e7982e920f8c8847824418b24a3c7d6212acff' THEN RAISE EXCEPTION 'Current Main initial guard body differs from selected predecessor';END IF;
 original:=pg_get_functiondef('public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)'::regprocedure);
 SELECT jsonb_agg(jsonb_build_object('n',n,'before',a,'after',b) ORDER BY n) INTO seams FROM(VALUES
(0,$before0$FUNCTION public.static_weekly_manual_assert_initial_employment_projection($before0$,$after0$FUNCTION public.static_weekly_manual_assert_recurring_projection($after0$),
(1,$before1$public.static_weekly_coverall_initial_context(p_operation,p_manager)$before1$,$after1$public.static_weekly_manual_recurring_context(p_operation,p_manager)$after1$),
(2,$before2$custodial.initial-employment-native-sql-context.v1$before2$,$after2$custodial.recurring-employment-native-sql-context.v1$after2$),
(3,$before3$INITIAL_EMPLOYMENT_OPERATIONALIZATION$before3$,$after3$RECURRING_MANUAL_MATERIALIZATION$after3$),
(4,$before4$initialActivation$before4$,$after4$recurringOperation$after4$),
(5,$before5$custodial.approved-manual-initial-employment-snapshot.v1$before5$,$after5$custodial.approved-manual-recurring-adjustment-snapshot.v1$after5$),
(6,$before6$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;$before6$,$after6$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;
 coverall jsonb;choice_day jsonb;capacity_id text;replaced_id text;is_coverall boolean;$after6$),
(7,$before7$if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')$before7$,$after7$if exists(select 1 from jsonb_array_elements(exceptions) e where (e->>'type' not in('pto','daily_absence') or e ? 'window')
  and (e->>'type' not in('cover_all','lunch') or not e ? 'coverAllChoiceId'
   or not public.static_weekly_recurring_exact_accepted_coverall_fact(p_operation,p_manager,publication,frame,e)))$after7$),
(8,$before8$ select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$before8$,$after8$ -- Add only the exact selected active capacity; inactive templates do not create employees.
 for day_basis in select value from jsonb_array_elements(a->'datedDayBases') where value->>'kind'='COVERALL' loop
  coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
  choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';
  select coalesce(jsonb_agg(r),'[]') into expected_availability from jsonb_array_elements(expected_availability) r
   where not(r->>'serviceDate'=choice_day->>'serviceDate' and r->>'slotId'=capacity_id);
  expected_availability:=expected_availability||jsonb_build_array(public.static_weekly_coverall_capacity_availability(source,choice_day)||jsonb_build_object(
   'serviceDate',choice_day->'serviceDate','incumbentPersonId',null,'incumbentName',null,'ownerKind','CONTRACTOR_CAPACITY','capacityId',capacity_id));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$after8$),
(9,$before9$  if day_changed then
   if jsonb_array_length(absent)$before9$,$after9$  is_coverall:=day_basis->>'kind'='COVERALL';coverall:=null;choice_day:=null;capacity_id:=null;replaced_id:=null;
  if coalesce(is_coverall,false) then
   coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
   choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';replaced_id:=coverall->>'replacedSlotId';
   if jsonb_array_length(absent)<>3 or absent is distinct from day_basis#>'{overlay,absentPersonIds}' then raise exception 'Exact third actual absence required';end if;
   input:=day_basis->'input';plan:=day_basis->'overlay';
   select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'unavailabilityClassification'='PRE_START_NOT_PTO';
   if coalesce(input->'preStartPersonIds','[]') is distinct from expected then raise exception 'Retained2 pre-start classification differs from current actual employment reads';end if;
   complete_start:=plan#>>'{checkedWindow,start}';complete_end:=plan#>>'{checkedWindow,end}';
  end if;
  if day_changed and not coalesce(is_coverall,false) then
   if jsonb_array_length(absent)$after9$),
(10,$before10$   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';$before10$,$after10$   if coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then owner_config:='{}';
   else select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';end if;$after10$),
(11,$before11$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'$before11$,$after11$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id'
    or (case when coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then
      item->>'owner_kind' is distinct from 'CONTRACTOR_CAPACITY' or item->>'capacity_id' is distinct from capacity_id or item->'owner_person_id' is distinct from 'null'::jsonb
     else item ? 'owner_kind' or item ? 'capacity_id' end)$after11$),
(12,$before12$if day_changed and (window_end>parent#>>'{window,end}' or window_start<case$before12$,$after12$if day_changed and ((window_end>parent#>>'{window,end}' and not(coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id
     and parent#>>'{window,end}'=normal_end and window_end<=choice_day#>>'{shift,end}')) or window_start<case$after12$),
(13,$before13$if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'$before13$,$after13$if day_changed and window_start<complete_start and ((item->'owner_slot_id' is distinct from parent->'ownerSlotId'
     and not(coalesce(is_coverall,false) and parent->>'ownerSlotId'=replaced_id and item->>'owner_slot_id'=capacity_id))$after13$),
(14,$before14$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)$before14$,$after14$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
     and not(coalesce(is_coverall,false) and previous_owner=capacity_id and exists(
      select 1 from jsonb_array_elements(day_basis#>'{input,roster}') retained_owner
       where retained_owner->>'slotId'=replaced_id and retained_owner#>>'{shift,end}'=window_start))$after14$),
(15,$before15$  if day_changed then
   perform public.static_weekly_manual_assert_absence_score$before15$,$after15$  if day_changed and not coalesce(is_coverall,false) then
   perform public.static_weekly_manual_assert_absence_score$after15$),
(16,$before16$  if base->>'status'='working' and employment_employee is not null and$before16$,$after16$  if base->>'status'='working' and exists(select 1 from jsonb_array_elements(basis->'rosterUnavailableByDate') r
   where r->>'serviceDate'=day::text and r->'slotId'=base->'slotId' and r->'employeeId'=person->'personId') then
   availability:=availability||'{"status":"absent","blockedWindows":[{"start":"00:00","end":"23:59"}]}'::jsonb;
  end if;
  if base->>'status'='working' and employment_employee is not null and$after16$),
(17,$before17$  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);$before17$,$after17$  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);
  if availability->>'status'='working' and exists(select 1 from jsonb_array_elements(basis->'rosterUnavailableByDate') r where r->>'serviceDate'=day::text)
  then availability:=availability||'{"blockedWindows":[]}'::jsonb;end if;$after17$),
(18,$before18$ perform public.static_weekly_manual_assert_native_lunch(NULL,p_lunch,p_envelope,publication,frame);$before18$,$after18$ if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') assigned where assigned->>'owner_person_id' is not null
  and not exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges r join public.employees e on e.id=r.person_id
   where r.slot_id=(assigned->>'owner_slot_id')::uuid and r.person_id=(assigned->>'owner_person_id')::uuid and r.effective_start<=(assigned->>'service_date')::date
    and (r.effective_end is null or (assigned->>'service_date')::date<r.effective_end) and e.active))
 then raise exception 'Recurring assignment cannot use a displaced/inactive historical employee';end if;
 perform public.static_weekly_manual_assert_native_lunch(NULL,p_lunch,p_envelope,publication,frame);$after18$)
 ) seam_rows(n,a,b);
 changed:=original;
 FOR item IN SELECT value FROM jsonb_array_elements(seams) LOOP
  IF position(item->>'before' IN changed)=0 OR position(item->>'after' IN changed)>0 THEN RAISE EXCEPTION 'Recurring native factoring seam changed: %',item->>'n';END IF;
  IF (item->>'n')::integer NOT IN(3,4) AND length(changed)-length(replace(changed,item->>'before',''))<>length(item->>'before') THEN RAISE EXCEPTION 'Recurring native seam not unique';END IF;
  changed:=replace(changed,item->>'before',item->>'after');
 END LOOP;
 inverse:=changed;FOR item IN SELECT value FROM jsonb_array_elements(seams) ORDER BY (value->>'n')::integer DESC LOOP inverse:=replace(inverse,item->>'after',item->>'before');END LOOP;
 IF inverse<>original THEN RAISE EXCEPTION 'Recurring native full inverse differs';END IF;EXECUTE changed;
END $guard_copy$;
CREATE FUNCTION public.static_weekly_manual_recurring_assert_payload(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;proof jsonb;
BEGIN
 ctx:=public.static_weekly_manual_recurring_context(p_operation,p_manager);
 IF ctx->'stagedEnvelope' IS DISTINCT FROM p_envelope THEN RAISE EXCEPTION 'Exact same-transaction recurring stage required';END IF;
 proof:=public.static_weekly_manual_assert_recurring_projection(p_operation,p_manager,p_envelope,ctx->'stagedLunch');
 IF proof->'projection_assignments' IS DISTINCT FROM p_envelope->'assignments' OR jsonb_typeof(proof->'assignment_links') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Full native recurring feasibility/assignment proof required';END IF;
 RETURN proof;
END $fn$;
CREATE FUNCTION public.static_weekly_stage_manual_recurring(p_operation uuid,p_manager uuid,p_envelope jsonb,p_lunch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;prior custodial_coverall.recurring_materialization_stages%rowtype;fingerprint text;
BEGIN
 ctx:=public.static_weekly_manual_recurring_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 IF p_envelope IS NULL OR p_lunch IS NULL OR pg_column_size(p_envelope)>16777216 OR pg_column_size(p_lunch)>16777216
 THEN RAISE EXCEPTION 'Bounded actual native recurring projection and lunch required';END IF;
 fingerprint:=public.static_weekly_digest_jsonb(jsonb_build_object('envelope',p_envelope,'lunch',p_lunch));
 SELECT * INTO prior FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.envelope_json IS DISTINCT FROM p_envelope OR prior.lunch_json IS DISTINCT FROM p_lunch OR prior.candidate_digest<>fingerprint
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original recurring candidate conflict';END IF;
 ELSE INSERT INTO custodial_coverall.recurring_materialization_stages VALUES(p_operation,p_envelope,p_lunch,fingerprint);END IF;
 PERFORM public.static_weekly_manual_recurring_assert_payload(p_operation,p_manager,p_envelope);
 RETURN jsonb_build_object('state','STAGED_UNCOMMITTED','operationId',p_operation,'candidateDigest',fingerprint,'committed',false);
END $fn$;
DO $sink_copy$
DECLARE original text;changed text;inverse text;needle text;replacement text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_coverall_initial_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 needle:=$before$v_pending_validation:=public.static_weekly_coverall_initial_assert_payload((p_assignments#>>'{semantic_snapshot,initialActivation,operationId}')::uuid,p_actor_manager_id,p_assignments);$before$;
 replacement:=$after$v_pending_validation:=public.static_weekly_manual_recurring_assert_payload((p_assignments#>>'{semantic_snapshot,recurringOperation,operationId}')::uuid,p_actor_manager_id,p_assignments);$after$;
 IF length(original)-length(replace(original,needle,''))<>length(needle)
  OR length(original)-length(replace(original,'FUNCTION public.static_weekly_coverall_initial_projection_sink(',''))<>length('FUNCTION public.static_weekly_coverall_initial_projection_sink(')
 THEN RAISE EXCEPTION 'Selected native relational sink seam differs';END IF;
 changed:=replace(replace(original,'FUNCTION public.static_weekly_coverall_initial_projection_sink(','FUNCTION public.static_weekly_manual_recurring_projection_sink('),needle,replacement);
 inverse:=replace(replace(changed,replacement,needle),'FUNCTION public.static_weekly_manual_recurring_projection_sink(','FUNCTION public.static_weekly_coverall_initial_projection_sink(');
 IF inverse<>original THEN RAISE EXCEPTION 'Recurring native sink whole inverse differs';END IF;EXECUTE changed;
END $sink_copy$;
CREATE FUNCTION public.static_weekly_finalize_manual_recurring(p_operation uuid,p_manager uuid,p_candidate_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;a custodial_coverall.recurring_materialization_operations%rowtype;s custodial_coverall.recurring_materialization_stages%rowtype;
 actor jsonb;stored jsonb;lunch jsonb;receipt jsonb;projection uuid;revision bigint;
BEGIN
 ctx:=public.static_weekly_manual_recurring_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 SELECT * INTO STRICT a FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=p_operation;
 SELECT * INTO STRICT s FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=p_operation;
 IF s.candidate_digest IS DISTINCT FROM p_candidate_digest THEN RAISE EXCEPTION 'Original recurring candidate digest required';END IF;
 PERFORM public.static_weekly_manual_recurring_assert_payload(p_operation,p_manager,s.envelope_json);
 actor:=public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 stored:=public.static_weekly_manual_recurring_projection_sink(a.publication_id,a.frame_start,
  public.static_weekly_digest_jsonb(a.basis_json->'preparedSummary'),s.envelope_json->>'compiler_version',s.envelope_json->'objective',s.envelope_json->'metrics',
  s.envelope_json->>'replay_digest',s.envelope_json,a.authority_revision,p_manager,actor->>'manager_name','manual-recurring:'||p_operation);
 projection:=(stored#>>'{data,projection_id}')::uuid;
 IF projection IS NULL THEN RAISE EXCEPTION 'Actual native recurring projection ID missing';END IF;
 lunch:=public.static_weekly_v8_materialize_lunch_document(projection,s.lunch_json,p_manager);
 IF lunch->'ok' IS DISTINCT FROM 'true'::jsonb OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED'
  OR lunch->>'document_identity' IS DISTINCT FROM s.lunch_json->>'document_identity'
  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
   WHERE p.projection_id=projection AND p.publication_id=a.publication_id AND p.version_id=a.version_id AND p.week_start=a.frame_start AND p.week_end=a.frame_start+6
    AND p.projection_envelope=s.envelope_json AND l.document_json=s.lunch_json AND l.document_identity=s.lunch_json->>'document_identity')
 THEN RAISE EXCEPTION 'Actual same-transaction recurring projection/full-hour lunch missing';END IF;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-recurring-confirmation.v2','kind','RECURRING_MANUAL_MATERIALIZATION','status','PERSISTED_CURRENT',
  'operationId',p_operation,'managerId',p_manager,'sourceId',a.source_id,'publicationId',a.publication_id,'versionId',a.version_id,
  'projectionId',projection,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',revision,'candidateDigest',s.candidate_digest,
  'lunchDocumentIdentity',s.lunch_json->'document_identity','employmentRevisionVector',a.basis_json->'employmentRevisionVector',
  'normalPatternSolverInvoked',false,'operationalSelectionSolverInvoked',s.envelope_json#>'{receipt,selectionSolverInvoked}',
  'normalSourceChanged',false,'newStaffingCommandCreated',false,'newPTOCreated',false,'samePhysicalTransaction',true);
 INSERT INTO custodial_coverall.recurring_materialization_receipts VALUES(p_operation,receipt);RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_finish_manual_recurring_normal(p_operation uuid,p_manager uuid,p_reference jsonb,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.recurring_materialization_operations%rowtype;r jsonb;receipt jsonb;projection uuid;doc text;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT a FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=p_operation;
 IF a.manager_id<>p_manager OR a.owner_xid<>pg_current_xact_id() OR a.backend_pid<>pg_backend_pid() OR a.repeat_basis IS NULL
  OR p_reference->>'managerId' IS DISTINCT FROM p_manager::text OR p_reference->>'requestId' IS DISTINCT FROM p_operation::text
  OR p_reference->>'publicationId' IS DISTINCT FROM a.publication_id::text OR p_reference->>'sourceId' IS DISTINCT FROM a.source_id::text
  OR p_reference->>'frameStart' IS DISTINCT FROM a.frame_start::text OR (p_reference->>'expectedRevision')::bigint IS DISTINCT FROM a.authority_revision
  OR p_reference->'employmentRevisionVector' IS DISTINCT FROM(SELECT jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','employeeId',e->'employeeId',
    'employmentRevision',e->'employmentRevision','requestId',e#>>'{command,requestId}') ORDER BY d->>'serviceDate',e->>'employeeId')
    FROM jsonb_array_elements(a.repeat_basis->'employmentByDate') days(d) CROSS JOIN LATERAL jsonb_array_elements(d->'employees') employees(e))
 THEN RAISE EXCEPTION 'Original physical recurring normal request/reference differs';END IF;
 r:=public.static_weekly_materialize_manual_repeat(p_reference,p_digest,a.credential_id,a.device_id,a.session_access);
 IF r->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT' THEN RAISE EXCEPTION 'Normal repeat did not accept current source/employment';END IF;
 projection:=(r->>'projection_id')::uuid;doc:=r->>'lunch_document_identity';
 IF projection IS NULL OR doc IS NULL OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p
  JOIN public.weekly_schedule_lunch_documents l USING(projection_id) WHERE p.projection_id=projection AND p.publication_id=a.publication_id
   AND p.week_start=a.frame_start AND p.week_end=a.frame_start+6 AND l.document_identity=doc)
 THEN RAISE EXCEPTION 'Actual repeated normal/lunch row missing';END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-recurring-confirmation.v2','kind','RECURRING_MANUAL_MATERIALIZATION','status','PERSISTED_CURRENT',
  'operationId',p_operation,'managerId',p_manager,'sourceId',a.source_id,'publicationId',a.publication_id,'versionId',a.version_id,
  'projectionId',projection,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',r->'authority_revision','lunchDocumentIdentity',doc,
  'normalPatternSolverInvoked',false,'operationalSelectionSolverInvoked',false,'normalSourceChanged',false,'samePhysicalTransaction',true,
  'originalRepeatReceipt',r,'employmentRevisionVector',p_reference->'employmentRevisionVector');
 INSERT INTO custodial_coverall.recurring_materialization_receipts VALUES(p_operation,receipt);RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_read_manual_recurring_outcome(p_manager uuid,p_key text,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 SELECT jsonb_build_object('request',o.request_json,'receipt',r.receipt_json,'currentReadbackRepeated',false) INTO result
 FROM custodial_coverall.recurring_materialization_operations o JOIN custodial_coverall.recurring_materialization_receipts r USING(operation_id)
 WHERE o.manager_id=p_manager AND o.idempotency_key=p_key;
 RETURN result;-- NULL never authorizes automatic resend of an UNKNOWN operation.
END $fn$;
DO $private$ DECLARE r record;sig text;BEGIN
 FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY['static_weekly_manual_recurring_require_receipt','static_weekly_manual_recurring_roster_unavailable',
   'static_weekly_manual_recurring_basis','static_weekly_begin_manual_recurring','static_weekly_manual_recurring_context','static_weekly_recurring_exact_accepted_coverall_fact',
   'static_weekly_manual_assert_recurring_projection','static_weekly_manual_recurring_assert_payload','static_weekly_stage_manual_recurring',
   'static_weekly_manual_recurring_projection_sink','static_weekly_finalize_manual_recurring','static_weekly_finish_manual_recurring_normal','static_weekly_read_manual_recurring_outcome'])
 LOOP EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',r.sig);END LOOP;
END $private$;
GRANT EXECUTE ON FUNCTION public.static_weekly_begin_manual_recurring(jsonb,uuid,text,text),public.static_weekly_stage_manual_recurring(uuid,uuid,jsonb,jsonb),
 public.static_weekly_finalize_manual_recurring(uuid,uuid,text),public.static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text),
 public.static_weekly_read_manual_recurring_outcome(uuid,text,uuid,text,text) TO static_weekly_control_plane;
COMMIT;
