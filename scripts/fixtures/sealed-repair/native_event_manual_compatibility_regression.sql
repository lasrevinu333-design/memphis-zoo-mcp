-- ROOT ONLY, existing owned current303+approved-manual fixture after guarded successor.
-- Actual published candidates plus exact installed predicate SQL evaluated on
-- compact in-memory negative row copies, one format mutation at a time.
-- No immutable publication/source edits or full projection held in PL/pgSQL.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;
DO $test$
DECLARE definition text; format_expression text; workday_expression text;
 format_query text; workday_query text; a record; p record; r record; worker record; v record;
 service_date date:=public.sch_service_date(statement_timestamp());
 projection_copy jsonb; authority_copy jsonb; base_resolved jsonb; entry jsonb; slot jsonb;
 projection_digest_after text;
 format_ok boolean; actual boolean; n integer; expected integer; checks integer:=0; roster_checks integer:=0;
BEGIN
 definition:=pg_get_functiondef('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure);
 IF public.static_weekly_digest_text(definition)<>'fac14efd2624c6edd09ac425404bbcf650a72f1315c186f815efdeaebacf72b0' THEN
  RAISE EXCEPTION 'Exact native Event compatibility successor required';END IF;
 format_expression:=split_part(split_part(definition,'/* native_event_manual_format_begin */',2),'/* native_event_manual_format_end */',1);
 workday_expression:=split_part(split_part(definition,'/* native_event_workday_predicate_begin */',2),'/* native_event_workday_predicate_end */',1);
 IF btrim(format_expression)='' OR btrim(workday_expression)='' THEN RAISE EXCEPTION 'Installed predicate extraction missing';END IF;
 format_query:='select ('||format_expression||') from jsonb_populate_record(null::public.weekly_schedule_compiled_projections,$1) projection '
  ||'cross join jsonb_to_record($2) as authority(governed boolean,projection_status text,projection_id uuid,publication_id uuid,version_id uuid) '
  ||'cross join (select $3::date as service_date) dates';
 workday_query:='select coalesce(('||workday_expression||'),false) from jsonb_to_record($1) as r('
  ||'service_date date,governed boolean,active boolean,identity_count bigint,explicit_staffing_state text,'
  ||'slot_id uuid,employee_id uuid,match_count bigint,slot_count bigint,entry jsonb,slot jsonb,native_manual_projection boolean)';
 SELECT * INTO STRICT a FROM public.static_weekly_v6_schedule_authority_state(service_date);
 IF a.governed IS NOT TRUE OR a.projection_status<>'current' THEN RAISE EXCEPTION 'Current admitted schedule required';END IF;
 -- Keep only scalar row metadata in PL/pgSQL. The exact whole-row digest is
 -- computed by its own SQL statement, retaining only the digest afterwards.
 SELECT projection.projection_id,projection.publication_id,projection.version_id,
  projection.week_start,projection.week_end,
  public.static_weekly_digest_text(to_jsonb(projection)::text) AS row_digest
 INTO STRICT p FROM public.weekly_schedule_compiled_projections projection
 WHERE projection.projection_id=a.projection_id AND projection.publication_id=a.publication_id AND projection.version_id=a.version_id;
 -- Preserve each exact JSON value used by the installed format expression,
 -- excluding unrelated compiler/publication payloads and availability arrays.
 SELECT jsonb_build_object(
  'projection_id',projection.projection_id,'publication_id',projection.publication_id,'version_id',projection.version_id,
  'compiler_version',projection.compiler_version,'week_start',projection.week_start,'week_end',projection.week_end,
  'authority_digest',projection.authority_digest,
  'projection_envelope',jsonb_build_object(
   'adapter',projection.projection_envelope->'adapter',
   'compiler_version',projection.projection_envelope->'compiler_version',
   'week_start',projection.projection_envelope->'week_start','week_end',projection.projection_envelope->'week_end',
   'service_date',projection.projection_envelope->'service_date','authority_digest',projection.projection_envelope->'authority_digest',
   'authority',jsonb_build_object(
    'schema',projection.projection_envelope#>'{authority,schema}',
    'sourcePublicationId',projection.projection_envelope#>'{authority,sourcePublicationId}',
    'sourceVersionId',projection.projection_envelope#>'{authority,sourceVersionId}',
    'frameStart',projection.projection_envelope#>'{authority,frameStart}',
    'frameEnd',projection.projection_envelope#>'{authority,frameEnd}',
    'normalSourceChanged',projection.projection_envelope#>'{authority,normalSourceChanged}',
    'objectiveSolverRerun',projection.projection_envelope#>'{authority,objectiveSolverRerun}')))
 INTO STRICT projection_copy FROM public.weekly_schedule_compiled_projections projection
 WHERE projection.projection_id=p.projection_id AND projection.publication_id=p.publication_id AND projection.version_id=p.version_id;
 authority_copy:=jsonb_build_object('governed',a.governed,'projection_status',a.projection_status,
  'projection_id',a.projection_id,'publication_id',a.publication_id,'version_id',a.version_id);
 EXECUTE format_query INTO format_ok USING projection_copy,authority_copy,service_date;
 IF format_ok IS NOT TRUE THEN RAISE EXCEPTION 'Actual current native manual format not recognized';END IF;checks:=checks+1;
 -- The unchanged public consumer must now admit every actually working roster
 -- identity for all_working; no fake workday or test-only eligibility override.
 FOR worker IN SELECT rr.* FROM public.static_weekly_v6_read_roster(service_date) rr
  JOIN public.employees e ON e.id=rr.employee_id AND e.active AND e.employee_code~'^EMP[0-9]+$'
  WHERE rr.active AND rr.staffing_state='working'
 LOOP
  SELECT count(*) INTO n FROM public.mz_event_reminder_schedule_candidate(jsonb_build_object(
   'event_date',service_date,'status','SCHEDULED','needs_review',false,'audience_scope','all_working_employees'),worker.employee_id,'shift_plus_15');
  IF n<>1 THEN RAISE EXCEPTION 'Actual current working native recipient excluded: %, count %',worker.employee_id,n;END IF;
  roster_checks:=roster_checks+1;
 END LOOP;
 IF roster_checks=0 THEN RAISE EXCEPTION 'No actual current working roster';END IF;
 SELECT rr.* INTO STRICT r FROM public.static_weekly_v6_read_roster(service_date) rr
  JOIN public.employees e ON e.id=rr.employee_id AND e.active AND e.employee_code~'^EMP[0-9]+$'
  WHERE rr.active AND rr.staffing_state='working' ORDER BY e.employee_code LIMIT 1;
 -- Select only the actual matched entry/slot; do not retain their parent envelope.
 SELECT item.value INTO STRICT entry FROM public.weekly_schedule_compiled_projections projection
 CROSS JOIN LATERAL jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') item(value)
 WHERE projection.projection_id=p.projection_id AND projection.publication_id=p.publication_id AND projection.version_id=p.version_id
  AND item.value->>'serviceDate'=service_date::text AND (item.value->>'slotId'=r.slot_id::text OR item.value->>'incumbentPersonId'=r.employee_id::text);
 SELECT item.value INTO STRICT slot FROM public.weekly_schedule_compiled_projections projection
 CROSS JOIN LATERAL jsonb_array_elements(projection.projection_envelope#>'{authority,compilerInput,slots}') item(value)
 WHERE projection.projection_id=p.projection_id AND projection.publication_id=p.publication_id AND projection.version_id=p.version_id
  AND item.value->>'id'=r.slot_id::text;
 IF entry ? 'incumbentSlotId' THEN RAISE EXCEPTION 'Regression requires real admitted missing-alias native format';END IF;
 base_resolved:=jsonb_build_object('service_date',service_date,'governed',true,'active',r.active,
  'identity_count',1,'explicit_staffing_state','working','slot_id',r.slot_id,'employee_id',r.employee_id,
  'match_count',1,'slot_count',1,'entry',entry,'slot',slot,'native_manual_projection',format_ok);
 EXECUTE workday_query INTO actual USING base_resolved;
 IF actual IS NOT TRUE THEN RAISE EXCEPTION 'Actual native workday predicate still excludes missing redundant alias';END IF;checks:=checks+1;
 -- Run the exact new installed format expression, never a handwritten mirror,
 -- against compact negative copies. The cursor stores only paths/small values;
 -- it never materializes a VALUES list of full projection copies.
 FOR v IN SELECT * FROM (VALUES
  ('unknown authority schema','{projection_envelope,authority,schema}'::text[],'"unknown"'::jsonb),
  ('null authority schema','{projection_envelope,authority,schema}'::text[],'null'::jsonb),
  ('unknown adapter schema','{projection_envelope,adapter,schema}'::text[],'"unknown"'::jsonb),
  ('adapter extra field','{projection_envelope,adapter,unexpected}'::text[],'true'::jsonb),
  ('null adapter','{projection_envelope,adapter}'::text[],'null'::jsonb),
  ('unknown row compiler','{compiler_version}'::text[],'"unknown"'::jsonb),
  ('unknown envelope compiler','{projection_envelope,compiler_version}'::text[],'"unknown"'::jsonb),
  ('different projection identity','{projection_id}'::text[],'"00000000-0000-4000-8000-000000000099"'::jsonb),
  ('different publication identity','{publication_id}'::text[],'"00000000-0000-4000-8000-000000000099"'::jsonb),
  ('different version identity','{version_id}'::text[],'"00000000-0000-4000-8000-000000000099"'::jsonb),
  ('different source publication','{projection_envelope,authority,sourcePublicationId}'::text[],'"00000000-0000-4000-8000-000000000099"'::jsonb),
  ('different source version','{projection_envelope,authority,sourceVersionId}'::text[],'"00000000-0000-4000-8000-000000000099"'::jsonb),
  ('null source publication','{projection_envelope,authority,sourcePublicationId}'::text[],'null'::jsonb),
  ('wrong source frame','{projection_envelope,authority,frameStart}'::text[],to_jsonb((service_date-7)::text)),
  ('wrong envelope frame','{projection_envelope,week_start}'::text[],to_jsonb((service_date-7)::text)),
  ('normal source flag changed','{projection_envelope,authority,normalSourceChanged}'::text[],'true'::jsonb),
  ('solver flag malformed','{projection_envelope,authority,objectiveSolverRerun}'::text[],'"false"'::jsonb),
  ('authority digest mismatch','{projection_envelope,authority_digest}'::text[],to_jsonb(repeat('0',64)))
 ) AS variants(label,mutation_path,mutation_value)
 LOOP
  EXECUTE format_query INTO actual USING jsonb_set(projection_copy,v.mutation_path,v.mutation_value),authority_copy,service_date;
  IF actual IS TRUE THEN RAISE EXCEPTION 'Malformed/unknown manual format accepted: %',v.label;END IF;checks:=checks+1;
 END LOOP;
 FOR v IN SELECT * FROM (VALUES
  ('stale current authority',jsonb_set(authority_copy,'{projection_status}','"stale"'::jsonb)),
  ('nongoverned authority',jsonb_set(authority_copy,'{governed}','false'::jsonb))
 ) AS variants(label,document)
 LOOP
  EXECUTE format_query INTO actual USING projection_copy,v.document,service_date;
  IF actual IS TRUE THEN RAISE EXCEPTION 'Invalid authority accepted: %',v.label;END IF;checks:=checks+1;
 END LOOP;
 EXECUTE format_query INTO actual USING projection_copy,authority_copy,p.week_end+1;
 IF actual IS TRUE THEN RAISE EXCEPTION 'Date outside exact native period accepted';END IF;checks:=checks+1;
 -- Exact installed full workday predicate: correct explicit aliases remain
 -- accepted, legacy missing alias and every contradiction remain denied.
 FOR v IN SELECT * FROM (VALUES
  ('native correct explicit duplicate',jsonb_set(base_resolved,'{entry,incumbentSlotId}',to_jsonb(r.slot_id::text)),true),
  ('legacy correct required duplicate',jsonb_set(jsonb_set(base_resolved,'{native_manual_projection}','false'::jsonb),'{entry,incumbentSlotId}',to_jsonb(r.slot_id::text)),true),
  ('legacy missing required duplicate',jsonb_set(base_resolved,'{native_manual_projection}','false'::jsonb),false),
  ('native null duplicate',jsonb_set(base_resolved,'{entry,incumbentSlotId}','null'::jsonb),false),
  ('native contradictory duplicate',jsonb_set(base_resolved,'{entry,incumbentSlotId}','"00000000-0000-4000-8000-000000000099"'::jsonb),false),
  ('native malformed duplicate',jsonb_set(base_resolved,'{entry,incumbentSlotId}','123'::jsonb),false),
  ('wrong current slot',jsonb_set(base_resolved,'{slot_id}','"00000000-0000-4000-8000-000000000099"'::jsonb),false),
  ('wrong current employee',jsonb_set(base_resolved,'{employee_id}','"00000000-0000-4000-8000-000000000099"'::jsonb),false),
  ('wrong day',jsonb_set(base_resolved,'{entry,dayOfWeek}',to_jsonb((extract(dow FROM service_date)::integer+1)%7)),false),
  ('PTO absent availability',jsonb_set(base_resolved,'{entry,status}','"absent"'::jsonb),false),
  ('absent explicit staffing',jsonb_set(base_resolved,'{explicit_staffing_state}','"absent"'::jsonb),false),
  ('ambiguous roster identity',jsonb_set(base_resolved,'{identity_count}','2'::jsonb),false),
  ('ambiguous availability',jsonb_set(base_resolved,'{match_count}','2'::jsonb),false),
  ('missing availability',jsonb_set(base_resolved,'{match_count}','0'::jsonb),false),
  ('ambiguous classification',jsonb_set(base_resolved,'{slot_count}','2'::jsonb),false),
  ('invalid shift format',jsonb_set(base_resolved,'{entry,shift,start}','"07:00:00"'::jsonb),false),
  ('reversed shift',jsonb_set(base_resolved,'{entry,shift,start}','"23:59"'::jsonb),false),
  ('blocked windows wrong type',jsonb_set(base_resolved,'{entry,blockedWindows}','null'::jsonb),false),
  ('blocked window malformed time',jsonb_set(base_resolved,'{entry,blockedWindows}','[{"start":"invalid","end":"09:00"}]'::jsonb),false),
  ('contractor field malformed',jsonb_set(base_resolved,'{slot,contractorCapacity}','null'::jsonb),false)
 ) AS variants(label,document,accepted)
 LOOP
  EXECUTE workday_query INTO actual USING v.document;
  IF actual IS DISTINCT FROM v.accepted THEN RAISE EXCEPTION 'Workday denial compatibility differs: % expected %, got %',v.label,v.accepted,actual;END IF;checks:=checks+1;
 END LOOP;
 SELECT count(*) INTO n FROM public.mz_event_reminder_schedule_candidate(jsonb_build_object(
  'event_date',service_date,'status','SCHEDULED','needs_review',false,'audience_scope','specific_employees','audience_employee_ids','[]'::jsonb),r.employee_id,'shift_plus_15');
 IF n<>0 THEN RAISE EXCEPTION 'Excluded audience widened';END IF;checks:=checks+1;
 SELECT count(*) INTO n FROM public.mz_event_reminder_schedule_candidate(jsonb_build_object(
  'event_date',service_date,'status','CANCELLED','needs_review',false,'audience_scope','all_working_employees'),r.employee_id,'shift_plus_15');
 IF n<>0 THEN RAISE EXCEPTION 'Cancelled source widened';END IF;checks:=checks+1;
 SELECT count(*) INTO n FROM public.mz_event_reminder_schedule_candidate(jsonb_build_object(
  'event_date',service_date,'status','SCHEDULED','needs_review',true,'audience_scope','all_working_employees'),r.employee_id,'shift_plus_15');
 IF n<>0 THEN RAISE EXCEPTION 'Needs-review source widened';END IF;checks:=checks+1;
 SELECT public.static_weekly_digest_text(to_jsonb(current_row)::text) INTO STRICT projection_digest_after
 FROM public.weekly_schedule_compiled_projections current_row WHERE current_row.projection_id=p.projection_id;
 IF p.row_digest IS DISTINCT FROM projection_digest_after
 THEN RAISE EXCEPTION 'Original admitted projection was changed';END IF;checks:=checks+1;
 RAISE NOTICE 'NATIVE_EVENT_MANUAL_COMPATIBILITY_PASS actual_roster_cases=% installed_predicate_and_denial_checks=% compact_format_bytes=%',roster_checks,checks,octet_length(projection_copy::text);
END $test$;
SELECT 'NATIVE_EVENT_MANUAL_COMPATIBILITY_CHECKS_COMPLETED' AS status;
ROLLBACK;
