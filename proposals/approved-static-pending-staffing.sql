-- SOURCE-ONLY PROPOSAL. Not a migration, activation or callable approval API.
-- Existing runtime/worker join is mounted locally and its new child path ran;
-- SQL bodies/copy seams remain native NOT_RUN. Do not activate this draft.
-- Install only in Main's original-owner guarded schema transaction. No GRANT,
-- role/default-policy change, ordinary compiler label or solver attestation.
DO $pending_predecessors$
DECLARE r record;actual text;
BEGIN
 IF current_user<>session_user THEN RAISE EXCEPTION 'Pending installer original owner required';END IF;
 FOR r IN SELECT * FROM(VALUES
 ('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','89a466f0bffde02f63c64ff0d7c72abe3604bd2c63d8305be48571fbe54ea956'),
 ('public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','edf3169446972f40fe8db0e88f303ec4d77924fd7cfb2ac8a6ade959af159c5f'),
 ('public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','8e49cc5b4a319978b4193bfcf35ec40e54d0311e21e6961c06419cc390311a15'),
 ('public.static_weekly_compiler_exception_set(uuid,date)','53bd75e28b947dc643fc711b3684be7e1cdc651fccab2a6cb13aedc5b8ef0529'),
 ('public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','b5fa8207cc41f61af72637a58977064da43b74e18a6cb5d4dfdf0143af44d863'),
 ('public.static_weekly_approved_dated_effective_work(uuid,date,jsonb)','334e48f0f65374b90809c372e841db57986446b73a59f7d00f9f665918971905'),
 ('public.static_weekly_assert_approved_dated_lunch(uuid,jsonb)','9534c73ba4914f38e0e02dfbe002ef31d39679409a7143e314899aa02a2ffea1'),
 ('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)','4394b8c94dbfe298f673e0c593ebd0191d79ff01617b16e03d5fc0e4e361e1bf'),
 ('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','c38d665aff22a47b0eee8158bc234973eba3bc098a188477c6467548a100c796')
 ) x(identity,body_sha) LOOP
  IF to_regprocedure(r.identity) IS NULL THEN RAISE EXCEPTION 'Pending original Source dependency missing';END IF;
  actual:=pg_get_functiondef(to_regprocedure(r.identity));
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.identity) AND p.proowner=current_user::regrole
   AND public.static_weekly_digest_text(p.prosrc)=r.body_sha)
   OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='function'
    AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=to_regprocedure(r.identity)
    AND i.definition_sql=actual AND i.definition_sha256=public.static_weekly_digest_text(actual))<>1
   -- This original helper has a registered FUNCTION but no GRANT row.
   -- Same exact native-qualified original ACL as the dated installer: require
   -- absent recovery row AND pinned live privileges/grantor, not a fallback.
   OR (CASE WHEN r.identity='public.static_weekly_compiler_exception_set(uuid,date)' THEN
    EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant'
     AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=to_regprocedure(r.identity))
    OR public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(
     'static_weekly_compiler_exception_set(uuid,date)'))
     IS DISTINCT FROM '5e045b2e87eeab69f63d6e165e816477b4d9b428dbf668ae381edbfbe8c995fb'
    OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE p.oid=to_regprocedure(r.identity) AND a.grantee<>p.proowner AND a.grantor<>p.proowner)
   ELSE (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant'
    AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=to_regprocedure(r.identity)
    AND i.definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity))<>1 END)
  THEN RAISE EXCEPTION 'Pending exact original definition owner or ACL differs';END IF;
 END LOOP;
END $pending_predecessors$;

-- Actual ledger/actor/epoch determines phase; there is no submitted phase flag.
CREATE FUNCTION public.static_weekly_pending_context(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $context$
DECLARE c public.static_weekly_staffing_commands%rowtype;a public.static_weekly_staffing_absences%rowtype;
 original public.static_weekly_staffing_commands%rowtype;actor jsonb;revision bigint;after_fact boolean:=false;target jsonb:=NULL;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.static_weekly_v3_manager_actor(p_manager);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton FOR SHARE;
 IF c.prepared_by_manager_id IS DISTINCT FROM p_manager OR c.state NOT IN('PREPARING','PREPARED')
  OR c.command_kind NOT IN('absence','cancel_absence') OR c.expected_revision NOT BETWEEN 0 AND 9007199254740990
  OR c.semantic_body IS DISTINCT FROM jsonb_build_object('absenceKind',c.absence_kind,'commandKind',c.command_kind,
   'employeeId',c.employee_id::text,'endDate',c.end_date::text,'startDate',c.start_date::text,'targetAbsenceId',c.target_absence_id)
  OR c.semantic_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(c.semantic_body)
  OR c.end_date<c.start_date OR c.end_date-c.start_date>=366 OR c.start_date<public.sch_service_date(statement_timestamp())
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Pending exact original command unavailable';END IF;
 IF c.command_kind='absence' THEN
  IF c.target_absence_id IS NOT NULL OR c.absence_kind NOT IN('daily_absence','pto','unavailable')
   OR NOT EXISTS(SELECT 1 FROM public.employees WHERE id=c.employee_id AND active) THEN RAISE EXCEPTION 'Pending employee or kind differs';END IF;
  SELECT * INTO a FROM public.static_weekly_staffing_absences WHERE absence_id=c.operation_id;
  IF FOUND THEN
   IF a.accepted_operation_id<>c.operation_id OR a.employee_id<>c.employee_id OR a.start_date<>c.start_date OR a.end_date<>c.end_date
    OR a.absence_kind<>c.absence_kind OR a.accepted_by_manager_id<>p_manager OR a.accepted_revision<>c.expected_revision+1
   THEN RAISE EXCEPTION 'Pending original accepted absence differs';END IF;
   after_fact:=true;
  END IF;
 ELSE
  IF c.absence_kind IS NOT NULL OR c.target_absence_id IS NULL THEN RAISE EXCEPTION 'Pending cancellation kind differs';END IF;
  SELECT * INTO STRICT a FROM public.static_weekly_staffing_absences WHERE absence_id=c.target_absence_id FOR SHARE;
  SELECT * INTO STRICT original FROM public.static_weekly_staffing_commands WHERE operation_id=a.accepted_operation_id FOR SHARE;
  IF a.absence_id<>a.accepted_operation_id OR a.employee_id<>c.employee_id OR c.start_date<>greatest(a.start_date,public.sch_service_date(statement_timestamp()))
   OR c.end_date<>a.end_date OR original.state<>'ACCEPTED' OR original.command_kind<>'absence'
   OR original.employee_id<>a.employee_id OR original.start_date<>a.start_date OR original.end_date<>a.end_date
   OR original.absence_kind<>a.absence_kind OR original.target_absence_id IS NOT NULL
   OR original.accepted_revision<>a.accepted_revision OR original.prepared_by_manager_id<>a.accepted_by_manager_id
   OR original.confirmed_by_manager_id<>a.accepted_by_manager_id
   OR original.semantic_digest<>public.static_weekly_digest_jsonb(original.semantic_body)
   OR original.semantic_body<>jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence','employeeId',a.employee_id::text,
    'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',NULL)
   OR original.accepted_receipt->>'event' IS DISTINCT FROM 'ACCEPTED'
   OR original.accepted_receipt->>'operation_id' IS DISTINCT FROM original.operation_id::text
   OR original.accepted_receipt->>'semantic_digest' IS DISTINCT FROM original.semantic_digest
   OR original.accepted_receipt->>'authority_revision' IS DISTINCT FROM a.accepted_revision::text
  THEN RAISE EXCEPTION 'Pending original cancellation ledger differs';END IF;
  IF EXISTS(SELECT 1 FROM public.static_weekly_staffing_absence_cancellations x WHERE x.absence_id=a.absence_id
   AND (x.accepted_operation_id<>c.operation_id OR x.remaining_start_date<>c.start_date OR x.remaining_end_date<>c.end_date
    OR x.accepted_revision<>c.expected_revision+1 OR x.accepted_by_manager_id<>p_manager)) THEN RAISE EXCEPTION 'Pending target already cancelled or foreign';END IF;
  after_fact:=EXISTS(SELECT 1 FROM public.static_weekly_staffing_absence_cancellations WHERE absence_id=a.absence_id AND accepted_operation_id=c.operation_id);
  target:=jsonb_build_object('absenceId',a.absence_id,'employeeId',a.employee_id,'startDate',a.start_date,'endDate',a.end_date,
   'acceptedOperationId',a.accepted_operation_id,'status','accepted');
 END IF;
 IF after_fact THEN
  IF c.state<>'PREPARED' OR revision<>c.expected_revision+1
   OR current_setting('app.static_weekly_staffing_batch_operation',true) IS DISTINCT FROM c.operation_id::text
   OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_authority_revisions r WHERE r.authority_revision=revision
    AND r.command_id=c.operation_id AND r.operation='apply_staffing_command' AND r.actor_manager_id=p_manager)
  THEN RAISE EXCEPTION 'Pending original fact is outside its native acceptance transaction';END IF;
 ELSIF revision<>c.expected_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Pending original revision changed';END IF;
 RETURN jsonb_build_object('originalCommand',jsonb_build_object('operationId',c.operation_id,'preparerId',c.prepared_by_manager_id,
  'semanticBody',c.semantic_body,'semanticDigest',c.semantic_digest,'expectedRevision',c.expected_revision,
  'currentServiceDate',public.sch_service_date(statement_timestamp()),'originalCancellationTarget',target),
  'afterFact',after_fact,'actor',actor);
END $context$;

-- Copy the exact original accepted-exception reader, excluding ONLY this native
-- operation's own new fact (or its cancellation), to reconstruct the before-set.
DO $pending_exception_reader$
DECLARE original text;changed text;inverse text;needle text;replacement text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_compiler_exception_set(uuid,date)'::regprocedure);
 IF to_regprocedure('public.static_weekly_pending_original_exception_set(uuid,date,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Pending reader exists';END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_compiler_exception_set(p_publication_id uuid, p_week_start date)',
  'FUNCTION public.static_weekly_pending_original_exception_set(p_publication_id uuid, p_week_start date, p_operation uuid)');
 IF changed=original THEN RAISE EXCEPTION 'Pending reader exact header differs';END IF;
 needle:='where day.service_date between p_week_start and p_week_start+6';replacement:=needle||' and a.accepted_operation_id<>p_operation';
 IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending original absence seam differs';END IF;
 changed:=replace(changed,needle,replacement);
 needle:='where c.absence_id=a.absence_id';replacement:=needle||' and c.accepted_operation_id<>p_operation';
 IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending original cancellation seam differs';END IF;
 changed:=replace(changed,needle,replacement);changed:=replace(changed,'SECURITY DEFINER','SECURITY INVOKER');
 inverse:=replace(changed,'FUNCTION public.static_weekly_pending_original_exception_set(p_publication_id uuid, p_week_start date, p_operation uuid)',
  'FUNCTION public.static_weekly_compiler_exception_set(p_publication_id uuid, p_week_start date)');
 inverse:=replace(inverse,' and a.accepted_operation_id<>p_operation','');inverse:=replace(inverse,' and c.accepted_operation_id<>p_operation','');
 inverse:=replace(inverse,'SECURITY INVOKER','SECURITY DEFINER');
 IF inverse<>original THEN RAISE EXCEPTION 'Pending original reader inverse differs';END IF;EXECUTE changed;
END $pending_exception_reader$;

CREATE FUNCTION public.static_weekly_pending_exception_set(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $exceptions$
DECLARE c public.static_weekly_staffing_commands%rowtype;ctx jsonb;result jsonb;d date;slot uuid;version uuid;row jsonb;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 ctx:=public.static_weekly_pending_context(p_operation,c.prepared_by_manager_id);
 IF p_week IS NULL OR extract(isodow FROM p_week)<>1 OR p_week>c.end_date OR p_week+6<c.start_date
  OR p_day IS NOT NULL AND (p_day NOT BETWEEN greatest(p_week,c.start_date) AND least(p_week+6,c.end_date))
 THEN RAISE EXCEPTION 'Pending scope differs';END IF;
 SELECT version_id INTO STRICT version FROM public.weekly_schedule_publications WHERE publication_id=p_publication;
 IF public.static_weekly_effective_version(p_week)<>version OR public.static_weekly_effective_version(p_week+6)<>version
 THEN RAISE EXCEPTION 'Pending publication changed within week';END IF;
 result:=public.static_weekly_pending_original_exception_set(p_publication,p_week,p_operation);
 IF c.command_kind='cancel_absence' THEN
  SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO result FROM jsonb_array_elements(result) WITH ORDINALITY x(e,n)
   WHERE (e->>'staffingAbsenceId'=c.target_absence_id::text AND (e->>'serviceDate')::date BETWEEN c.start_date AND c.end_date
    AND (p_day IS NULL OR (e->>'serviceDate')::date=p_day)) IS NOT TRUE;
 ELSE
  FOR d IN SELECT generate_series(greatest(p_week,c.start_date),least(p_week+6,c.end_date),'1 day')::date LOOP
   IF p_day IS NOT NULL AND d<>p_day THEN CONTINUE;END IF;
   SELECT i.slot_id INTO STRICT slot FROM public.v_weekly_roster_slot_incumbency_ranges i WHERE i.person_id=c.employee_id
    AND i.effective_start<=d AND (i.effective_end IS NULL OR d<i.effective_end);
   row:=jsonb_build_object('id',c.operation_id::text||':'||d::text,'type',CASE WHEN c.absence_kind='pto' THEN 'pto' ELSE 'daily_absence' END,
    'serviceDate',d,'staffingAbsenceId',c.operation_id,'staffingAbsenceKind',c.absence_kind,'actorId',c.prepared_by_manager_id,
    'reason','Approved staffing unavailability','idempotencyKey','staffing:'||c.operation_id::text||':'||d::text,
    'expectedRevision',c.expected_revision,'payload',jsonb_build_object('slotId',slot),'baseVersionId',version,'publicationId',p_publication,
    'sequence',c.expected_revision+1+(d-c.start_date));
   -- No accepted/status flag is exported or trusted on this proposed fact.
   result:=result||jsonb_build_array(row);
  END LOOP;
 END IF;
 SELECT coalesce(jsonb_agg(e ORDER BY e->>'serviceDate',(e->>'sequence')::bigint,e->>'id' COLLATE "C"),'[]') INTO result FROM jsonb_array_elements(result) e;
 RETURN result;
END $exceptions$;
CREATE FUNCTION public.static_weekly_pending_summary(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $summary$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e->'id','type',e->'type','serviceDate',e->'serviceDate',
  'payloadDigest',coalesce(e->'payloadDigest',to_jsonb(public.static_weekly_digest_text(format('{"slotId":"%s"}',e#>>'{payload,slotId}'))))) ORDER BY n),'[]')
 FROM jsonb_array_elements(public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day)) WITH ORDINALITY x(e,n)
$summary$;
CREATE FUNCTION public.static_weekly_pending_applied_summary(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $applied$
 SELECT coalesce(jsonb_agg(e ORDER BY extract(dow FROM (e->>'serviceDate')::date),n),'[]')
 FROM jsonb_array_elements(public.static_weekly_pending_summary(p_operation,p_publication,p_week,p_day)) WITH ORDINALITY x(e,n)
$applied$;
CREATE FUNCTION public.static_weekly_pending_day_source(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $source$
DECLARE source jsonb;exceptions jsonb;
BEGIN
 source:=public.static_weekly_v3_read_publication_source(p_publication,p_week);
 exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);
 RETURN jsonb_set(jsonb_set(source,'{exceptions}',exceptions,true),'{compiler_input,exceptions}',exceptions,true);
END $source$;

-- Exact private copies: the ordinary/singleton definitions remain unchanged.
-- Only Source acquisition is replaced with the independently locked native
-- pending relation; every mapping/physical/interval/route/capacity check stays.
DO $pending_day_copies$
DECLARE r record;s record;original text;changed text;inverse text;
BEGIN
 FOR r IN SELECT * FROM(VALUES
  ('public.static_weekly_approved_dated_effective_work(uuid,date,jsonb)','static_weekly_approved_dated_effective_work',
   'static_weekly_pending_effective_work','p_operation uuid, p_day date, '),
  ('public.static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)','static_weekly_assert_approved_dated_projection',
   'static_weekly_pending_assert_day','p_operation uuid, ')
 ) x(identity,old_name,new_name,prefix) LOOP
  original:=pg_get_functiondef(to_regprocedure(r.identity));
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=r.new_name) THEN RAISE EXCEPTION 'Pending private copy exists';END IF;
  changed:=replace(original,'FUNCTION public.'||r.old_name||'(','FUNCTION public.'||r.new_name||'('||r.prefix);
  IF changed=original THEN RAISE EXCEPTION 'Pending private copy header differs';END IF;
  FOR s IN SELECT * FROM(VALUES
   ('accepted:=public.static_weekly_compiler_exception_set(p_publication,p_week);',
    'accepted:=public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);',r.old_name='static_weekly_approved_dated_effective_work'),
   ('raw_source:=public.static_weekly_v3_read_publication_source(p_publication_id,p_week);',
    'raw_source:=public.static_weekly_pending_day_source(p_operation,p_publication_id,p_week,operation_date);',r.old_name='static_weekly_assert_approved_dated_projection'),
   ('compiler_exceptions:=public.static_weekly_compiler_exception_set(p_publication_id,p_week);',
    'compiler_exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication_id,p_week,operation_date);',r.old_name='static_weekly_assert_approved_dated_projection'),
   ('public.static_weekly_accepted_exception_set(p_publication_id,p_week)',
    'public.static_weekly_pending_applied_summary(p_operation,p_publication_id,p_week,operation_date)',r.old_name='static_weekly_assert_approved_dated_projection'),
   ('public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,',
    'public.static_weekly_pending_effective_work(p_operation,operation_date,p_publication_id,p_week,',r.old_name='static_weekly_assert_approved_dated_projection')
  ) fixed(before_sql,after_sql,apply) WHERE apply LOOP
   IF position(s.before_sql in changed)=0 THEN RAISE EXCEPTION 'Pending day exact Source seam differs';END IF;
   changed:=replace(changed,s.before_sql,s.after_sql);
  END LOOP;
  inverse:=replace(changed,'FUNCTION public.'||r.new_name||'('||r.prefix,'FUNCTION public.'||r.old_name||'(');
  FOR s IN SELECT * FROM(VALUES
   ('accepted:=public.static_weekly_compiler_exception_set(p_publication,p_week);',
    'accepted:=public.static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);'),
   ('raw_source:=public.static_weekly_v3_read_publication_source(p_publication_id,p_week);',
    'raw_source:=public.static_weekly_pending_day_source(p_operation,p_publication_id,p_week,operation_date);'),
   ('compiler_exceptions:=public.static_weekly_compiler_exception_set(p_publication_id,p_week);',
    'compiler_exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication_id,p_week,operation_date);'),
   ('public.static_weekly_accepted_exception_set(p_publication_id,p_week)',
    'public.static_weekly_pending_applied_summary(p_operation,p_publication_id,p_week,operation_date)'),
   ('public.static_weekly_approved_dated_effective_work(p_publication_id,p_week,',
    'public.static_weekly_pending_effective_work(p_operation,operation_date,p_publication_id,p_week,')
  ) fixed(before_sql,after_sql) LOOP inverse:=replace(inverse,s.after_sql,s.before_sql);END LOOP;
  IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending independent validator unrelated Source changed';END IF;
  EXECUTE changed;
 END LOOP;
END $pending_day_copies$;

CREATE FUNCTION public.static_weekly_pending_assert_projection(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $projection$
DECLARE ctx jsonb;c public.static_weekly_staffing_commands%rowtype;snapshot jsonb;source jsonb;before_source jsonb;
 publication uuid;week date;date date;expected_dates jsonb;part jsonb;proof jsonb;first_projection jsonb;chosen jsonb;
 expected_rows jsonb:='[]';expected_availability jsonb:='[]';expected_work jsonb:='[]';links jsonb:='{}';item jsonb;
 basis jsonb;first_basis jsonb;summary jsonb;effective jsonb;actual jsonb;expected jsonb;
BEGIN
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 PERFORM public.static_weekly_assert_exact_object(p_envelope,
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'pending projection');
 snapshot:=p_envelope->'semantic_snapshot';
 PERFORM public.static_weekly_assert_exact_object(snapshot,
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],'pending original snapshot');
 IF snapshot->>'schema' IS DISTINCT FROM 'custodial.approved-static-pending-staffing-projection-snapshot.v1'
  OR snapshot->'originalCommand' IS DISTINCT FROM ctx->'originalCommand'
  OR coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION 'Pending original tuple differs';END IF;
 week:=(snapshot->>'weekStart')::date;
 IF NOT isfinite(week) OR extract(isodow FROM week)<>1 OR week>c.end_date OR week+6<c.start_date THEN RAISE EXCEPTION 'Pending original week differs';END IF;
 publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 source:=public.static_weekly_v3_read_publication_source(publication,week);
 before_source:=jsonb_set(jsonb_set(source,'{authority_revision}',to_jsonb(c.expected_revision),false),'{exceptions}',
  public.static_weekly_pending_original_exception_set(publication,week,p_operation),false);
 IF snapshot->'originalSource' IS DISTINCT FROM before_source OR public.static_weekly_effective_version(week+6)::text IS DISTINCT FROM source->>'version_id'
 THEN RAISE EXCEPTION 'Pending original accepted Source differs';END IF;
 SELECT jsonb_agg(d::date::text ORDER BY d) INTO expected_dates
  FROM generate_series(greatest(c.start_date,week),least(c.end_date,week+6),'1 day') d;
 IF snapshot->'scopeDates' IS DISTINCT FROM expected_dates OR jsonb_typeof(snapshot->'partitions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(snapshot->'partitions')<>jsonb_array_length(expected_dates)
 THEN RAISE EXCEPTION 'Pending complete original day partitions required';END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') WITH ORDINALITY x(value,n) ORDER BY n LOOP
  PERFORM public.static_weekly_assert_exact_object(part,ARRAY['serviceDate','projection'],ARRAY['serviceDate','projection'],'pending day partition');
  IF jsonb_typeof(part->'serviceDate') IS DISTINCT FROM 'string' OR NOT(expected_dates ? (part->>'serviceDate'))
   OR (SELECT count(*) FROM jsonb_array_elements(snapshot->'partitions') p WHERE p->'serviceDate'=part->'serviceDate')<>1
   OR part#>'{projection,authority,scopeDates}' IS DISTINCT FROM jsonb_build_array(part->'serviceDate')
  THEN RAISE EXCEPTION 'Pending duplicate or foreign day partition';END IF;
  date:=(part->>'serviceDate')::date;
  basis:=public.static_weekly_read_approved_template_basis(p_manager,publication,date,'DATED_ABSENCE',NULL,
   CASE WHEN (ctx->>'afterFact')::boolean THEN c.expected_revision+1 ELSE c.expected_revision END);
  IF first_basis IS NULL THEN first_basis:=basis;END IF;
  IF basis->'generation' IS DISTINCT FROM snapshot->'generation'
   OR basis->'templateCatalogDigest' IS DISTINCT FROM snapshot->'templateCatalogDigest'
   OR basis->'templateInputsDigest' IS DISTINCT FROM snapshot->'templateInputsDigest'
   OR basis->'ownerConfig' IS DISTINCT FROM first_basis->'ownerConfig'
  THEN RAISE EXCEPTION 'Pending approved catalog config or generation differs';END IF;
  summary:=public.static_weekly_pending_applied_summary(p_operation,publication,week,date);
  proof:=public.static_weekly_pending_assert_day(p_operation,part->'projection',publication,week,summary);
  IF first_projection IS NULL THEN first_projection:=part->'projection';END IF;
 END LOOP;
 -- Deterministic disjoint composition: one source for every changed day and
 -- the exact same original six-day rows for every component's unaffected day.
 FOR date IN SELECT generate_series(week,week+6,'1 day')::date LOOP
  SELECT value->'projection' INTO chosen FROM jsonb_array_elements(snapshot->'partitions') WHERE value->>'serviceDate'=date::text;
  IF NOT FOUND THEN
   chosen:=first_projection;
   FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') LOOP
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO actual FROM jsonb_array_elements(part#>'{projection,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Pending unaffected original day changed';END IF;
   END LOOP;
  END IF;
  proof:=public.static_weekly_pending_assert_day(p_operation,chosen,publication,week,
   public.static_weekly_pending_applied_summary(p_operation,publication,week,(chosen#>>'{authority,scopeDates,0}')::date));
  SELECT expected_rows||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_rows FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
  FOR item IN SELECT value FROM jsonb_array_elements(chosen->'assignments') WHERE value->>'service_date'=date::text LOOP
   links:=links||jsonb_build_object(item->>'plan_work_id',proof#>ARRAY['assignment_links',item->>'plan_work_id']);
  END LOOP;
  SELECT expected_availability||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_availability
   FROM jsonb_array_elements(chosen#>'{authority,projectionAvailability}') WITH ORDINALITY x(r,n) WHERE r->>'serviceDate'=date::text;
  SELECT expected_work||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_work
   FROM jsonb_array_elements(chosen#>'{authority,overlayCompilerInput,version,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'dayOfWeek'=extract(dow FROM date)::text;
 END LOOP;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'slotId' COLLATE "C") INTO expected_availability FROM jsonb_array_elements(expected_availability) r;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'workId' COLLATE "C") INTO expected_work FROM jsonb_array_elements(expected_work) r;
 effective:=jsonb_set(jsonb_set(first_projection#>'{authority,overlayCompilerInput}','{version,assignments}',expected_work,false),
  '{exceptions}',public.static_weekly_pending_exception_set(p_operation,publication,week,NULL),false);
 expected:=jsonb_build_object('schema','custodial.approved-static-pending-staffing-authority.v1','effectiveDate',week,
  'compilerInput',first_projection#>'{authority,compilerInput}','overlayCompilerInput',effective,
  'inputDigest',public.static_weekly_digest_jsonb(effective),'projectionAvailability',expected_availability,'solverInvoked',false,'optimized',false);
 IF p_envelope->'assignments' IS DISTINCT FROM expected_rows OR p_envelope->'authority' IS DISTINCT FROM expected
  OR p_envelope->>'authority_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(expected)
  OR p_envelope->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  OR p_envelope->'adapter' IS DISTINCT FROM '{"schema":"custodial.approved-static-pending-staffing-adapter.v1","version":"approved-static-pending-staffing-v1"}'::jsonb
  OR p_envelope->>'compiler_version' IS DISTINCT FROM 'approved-static-pending-staffing-v1'
  OR p_envelope->>'week_start' IS DISTINCT FROM week::text OR p_envelope->>'service_date' IS DISTINCT FROM week::text
  OR p_envelope->>'week_end' IS DISTINCT FROM (week+6)::text
  OR p_envelope->'objective' IS DISTINCT FROM '{"contract":"FIXED_APPROVED_PENDING_STAFFING_NOT_OPTIMALITY"}'::jsonb
  OR p_envelope->'applied_exceptions' IS DISTINCT FROM public.static_weekly_pending_applied_summary(p_operation,publication,week,NULL)
 THEN RAISE EXCEPTION 'Pending merged exact week projection or original relation differs';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_envelope->'receipt',
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],'pending fixed feasibility DATA');
 IF p_envelope#>>'{receipt,schema}' IS DISTINCT FROM 'custodial.approved-static-pending-feasibility.v1'
  OR p_envelope#>'{receipt,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_envelope#>'{receipt,optimized}' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_envelope#>'{receipt,hardConstraintCount}') IS DISTINCT FROM 'number'
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric NOT BETWEEN jsonb_array_length(expected_rows) AND 100000
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric<>trunc((p_envelope#>>'{receipt,hardConstraintCount}')::numeric)
  OR coalesce(p_envelope#>>'{receipt,hardConstraintDigest}','')!~'^[0-9a-f]{64}$'
  OR coalesce(p_envelope->>'replay_digest','')!~'^[0-9a-f]{64}$'
  OR p_envelope->'metrics' IS DISTINCT FROM jsonb_build_object('hardConstraints',p_envelope#>'{receipt,hardConstraintCount}','violations',0)
 THEN RAISE EXCEPTION 'Pending fixed feasibility DATA malformed';END IF;
 IF (ctx->>'afterFact')::boolean AND public.static_weekly_pending_summary(p_operation,publication,week,NULL)
  IS DISTINCT FROM public.static_weekly_accepted_exception_set(publication,week)
 THEN RAISE EXCEPTION 'Pending original semantics did not become the exact accepted facts';END IF;
 IF public.static_weekly_pending_context(p_operation,p_manager) IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Pending native context changed';END IF;
 RETURN jsonb_build_object('assignment_links',links,'projection_assignments',expected_rows,'afterFact',ctx->'afterFact');
END $projection$;

-- These copies reuse the complete native lunch partition/eligibility/identity
-- derivation. The ephemeral row is DATA checked by pending_assert_projection,
-- never inserted into a table and never represented as persisted.
DO $pending_lunch_copies$
DECLARE r record;s record;original text;changed text;inverse text;
BEGIN
 FOR r IN SELECT * FROM(VALUES
  ('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)','static_weekly_v8_assert_lunch_document',
   'static_weekly_pending_lunch_base','p_projection_id uuid, p_document jsonb',
   'p_projection_id uuid, p_document jsonb, p_envelope jsonb, p_publication uuid, p_week date'),
  ('public.static_weekly_assert_approved_dated_lunch(uuid,jsonb)','static_weekly_assert_approved_dated_lunch',
   'static_weekly_pending_lunch_derivation','p_projection uuid, p_document jsonb',
   'p_projection uuid, p_document jsonb, p_envelope jsonb, p_publication uuid, p_week date, p_operation uuid')
 ) x(identity,old_name,new_name,old_args,new_args) LOOP
  original:=pg_get_functiondef(to_regprocedure(r.identity));
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=r.new_name) THEN RAISE EXCEPTION 'Pending private lunch copy exists';END IF;
  changed:=replace(original,'FUNCTION public.'||r.old_name||'('||r.old_args||')','FUNCTION public.'||r.new_name||'('||r.new_args||')');
  IF changed=original THEN RAISE EXCEPTION 'Pending lunch exact header differs';END IF;
  FOR s IN SELECT * FROM(VALUES
   ('select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;'||chr(10)||' if not found then raise exception ''lunch projection is missing''; end if;',
    'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    r.old_name='static_weekly_v8_assert_lunch_document'),
   ('PERFORM public.static_weekly_v8_assert_lunch_document(p_projection,p_document);',
    'PERFORM public.static_weekly_pending_lunch_base(p_projection,p_document,p_envelope,p_publication,p_week);',
    r.old_name='static_weekly_assert_approved_dated_lunch'),
   ('SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;',
    'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    r.old_name='static_weekly_assert_approved_dated_lunch'),
   ('public.static_weekly_approved_dated_effective_work(projection.publication_id,projection.week_start,source)',
    'public.static_weekly_pending_effective_work(p_operation,NULL,projection.publication_id,projection.week_start,source)',
    r.old_name='static_weekly_assert_approved_dated_lunch')
  ) fixed(before_sql,after_sql,apply) WHERE apply LOOP
   IF (length(changed)-length(replace(changed,s.before_sql,'')))/length(s.before_sql)<>1 THEN RAISE EXCEPTION 'Pending lunch exact Source seam differs';END IF;
   changed:=replace(changed,s.before_sql,s.after_sql);
  END LOOP;
  IF r.old_name='static_weekly_v8_assert_lunch_document' THEN
   IF (length(changed)-length(replace(changed,'SECURITY DEFINER','')))/length('SECURITY DEFINER')<>1 THEN RAISE EXCEPTION 'Pending lunch security predecessor differs';END IF;
   changed:=replace(changed,'SECURITY DEFINER','SECURITY INVOKER');
  END IF;
  inverse:=replace(changed,'FUNCTION public.'||r.new_name||'('||r.new_args||')','FUNCTION public.'||r.old_name||'('||r.old_args||')');
  IF r.old_name='static_weekly_v8_assert_lunch_document' THEN
   inverse:=replace(inverse,'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    'select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;'||chr(10)||' if not found then raise exception ''lunch projection is missing''; end if;');
   inverse:=replace(inverse,'SECURITY INVOKER','SECURITY DEFINER');
  ELSE
   inverse:=replace(inverse,'projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>''authority_digest'';projection.replay_digest:=p_envelope->>''replay_digest'';',
    'SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;');
   inverse:=replace(inverse,'PERFORM public.static_weekly_pending_lunch_base(p_projection,p_document,p_envelope,p_publication,p_week);',
    'PERFORM public.static_weekly_v8_assert_lunch_document(p_projection,p_document);');
   inverse:=replace(inverse,'public.static_weekly_pending_effective_work(p_operation,NULL,projection.publication_id,projection.week_start,source)',
    'public.static_weekly_approved_dated_effective_work(projection.publication_id,projection.week_start,source)');
  END IF;
  IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending lunch unrelated original Source differs';END IF;
  EXECUTE changed;
 END LOOP;
END $pending_lunch_copies$;

CREATE FUNCTION public.static_weekly_pending_assert_lunch(p_operation uuid,p_manager uuid,p_publication uuid,p_week date,p_envelope jsonb,p_document jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $lunch$
BEGIN
 PERFORM public.static_weekly_pending_assert_projection(p_operation,p_manager,p_envelope);
 IF p_envelope#>>'{semantic_snapshot,originalSource,publication_id}' IS DISTINCT FROM p_publication::text
  OR p_envelope->>'week_start' IS DISTINCT FROM p_week::text THEN RAISE EXCEPTION 'Pending lunch original publication or week differs';END IF;
 IF p_envelope->>'replay_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
  'projectionAssignments',p_envelope->'assignments','lunchDocument',p_document-ARRAY['base_authority_digest','base_replay_digest','document_identity']))
 THEN RAISE EXCEPTION 'Pending complete merged lunch replay differs';END IF;
 PERFORM public.static_weekly_pending_lunch_derivation(NULL,p_document,p_envelope,p_publication,p_week,p_operation);
END $lunch$;

CREATE FUNCTION public.static_weekly_pending_assert_payload(p_operation uuid,p_manager uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $payload$
DECLARE ctx jsonb;result jsonb;week date;publication uuid;
BEGIN
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 PERFORM public.static_weekly_assert_exact_object(p_payload,
  ARRAY['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision','idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate'],
  ARRAY['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision','idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate'],'pending twelve-field transport');
 week:=(p_payload->>'serviceDate')::date;publication:=(p_payload->>'publicationId')::uuid;
 IF p_payload->>'actorManagerId' IS DISTINCT FROM p_manager::text OR p_payload->>'actorManagerName' IS DISTINCT FROM ctx#>>'{actor,manager_name}'
  OR p_payload->'expectedRevision' IS DISTINCT FROM ctx#>'{originalCommand,expectedRevision}'
  OR p_payload->>'idempotencyKey' IS DISTINCT FROM 'staffing:'||p_operation::text||':'||week::text
  OR p_payload->>'serviceDate' IS DISTINCT FROM p_payload#>>'{envelope,week_start}'
  OR p_payload->>'publicationId' IS DISTINCT FROM p_payload#>>'{envelope,semantic_snapshot,originalSource,publication_id}'
  OR p_payload->>'compilerVersion' IS DISTINCT FROM p_payload#>>'{envelope,compiler_version}'
  OR p_payload->'objective' IS DISTINCT FROM p_payload#>'{envelope,objective}'
  OR p_payload->'metrics' IS DISTINCT FROM p_payload#>'{envelope,metrics}'
  OR p_payload->>'replayDigest' IS DISTINCT FROM p_payload#>>'{envelope,replay_digest}'
  OR p_payload->>'exceptionSetDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(public.static_weekly_pending_summary(p_operation,publication,week,NULL))
 THEN RAISE EXCEPTION 'Pending transport original identity differs';END IF;
 result:=public.static_weekly_pending_assert_projection(p_operation,p_manager,p_payload->'envelope');
 RETURN result;
END $payload$;

-- Private sink copy. Original v2 and v3 ordinary routes remain byte-identical.
DO $pending_sink_copy$
DECLARE original text;changed text;inverse text;s record;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='static_weekly_pending_projection_sink')
 THEN RAISE EXCEPTION 'Pending private sink exists';END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_v2_materialize_projection(','FUNCTION public.static_weekly_pending_projection_sink(');
 IF changed=original THEN RAISE EXCEPTION 'Pending exact sink header differs';END IF;
 FOR s IN SELECT * FROM(VALUES
  ('declare v_request jsonb;','declare v_pending_validation jsonb; v_request jsonb;'),
  ('perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set);',
   'v_pending_validation:=public.static_weekly_pending_assert_projection((p_assignments#>>''{semantic_snapshot,originalCommand,operationId}'')::uuid,p_actor_manager_id,p_assignments); IF (v_pending_validation->>''afterFact'')::boolean IS NOT TRUE THEN RAISE EXCEPTION ''Pending sink requires actual original acceptance facts'';END IF;'),
  ($before$select * into v_assignment from public.weekly_schedule_slot_assignments
   where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';$before$,
   $after$select * into v_assignment from public.weekly_schedule_slot_assignments where assignment_id=nullif(v_pending_validation#>>ARRAY['assignment_links',v_item->>'plan_work_id'],'')::uuid;$after$),
  ($before$if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;$before$,
   $after$if v_assignment.assignment_id is null and not exists(select 1 from jsonb_array_elements(v_pending_validation->'projection_assignments') r where r=v_item) then raise exception using errcode='23514',message='pending work lacks independently checked original lineage';end if;$after$),
  ($before$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$before$,
   $after$p_assignments#>>'{authority,schema}'='custodial.approved-static-pending-staffing-authority.v1'$after$),
  ('SECURITY DEFINER','SECURITY INVOKER')
 ) fixed(before_sql,after_sql) LOOP
  IF (length(changed)-length(replace(changed,s.before_sql,'')))/length(s.before_sql)<>1 THEN RAISE EXCEPTION 'Pending exact sink Source seam differs';END IF;
  changed:=replace(changed,s.before_sql,s.after_sql);
 END LOOP;
 inverse:=replace(changed,'FUNCTION public.static_weekly_pending_projection_sink(','FUNCTION public.static_weekly_v2_materialize_projection(');
 FOR s IN SELECT * FROM(VALUES
  ('declare v_request jsonb;','declare v_pending_validation jsonb; v_request jsonb;'),
  ('perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set);',
   'v_pending_validation:=public.static_weekly_pending_assert_projection((p_assignments#>>''{semantic_snapshot,originalCommand,operationId}'')::uuid,p_actor_manager_id,p_assignments); IF (v_pending_validation->>''afterFact'')::boolean IS NOT TRUE THEN RAISE EXCEPTION ''Pending sink requires actual original acceptance facts'';END IF;'),
  ($before$select * into v_assignment from public.weekly_schedule_slot_assignments
   where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id';$before$,
   $after$select * into v_assignment from public.weekly_schedule_slot_assignments where assignment_id=nullif(v_pending_validation#>>ARRAY['assignment_links',v_item->>'plan_work_id'],'')::uuid;$after$),
  ($before$if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;$before$,
   $after$if v_assignment.assignment_id is null and not exists(select 1 from jsonb_array_elements(v_pending_validation->'projection_assignments') r where r=v_item) then raise exception using errcode='23514',message='pending work lacks independently checked original lineage';end if;$after$),
  ($before$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$before$,
   $after$p_assignments#>>'{authority,schema}'='custodial.approved-static-pending-staffing-authority.v1'$after$),
  ('SECURITY DEFINER','SECURITY INVOKER')
 ) fixed(before_sql,after_sql) LOOP inverse:=replace(inverse,s.after_sql,s.before_sql);END LOOP;
 IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending sink unrelated Source differs';END IF;EXECUTE changed;
END $pending_sink_copy$;

-- Exact finite branch patches of existing entrypoints. No public new endpoint,
-- privilege, role switch, transaction boundary or ordinary behavior change.
DO $pending_staffing_boundaries$
DECLARE r record;s record;original text;changed text;inverse text;needle text;replacement text;accept_original text;accept_replacement text;
BEGIN
 FOR r IN SELECT * FROM(VALUES
  ('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','stage'),
  ('public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','accept'),
  ('public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)','matcher')
 ) x(identity,kind) LOOP
  original:=pg_get_functiondef(to_regprocedure(r.identity));changed:=original;
  IF r.kind='stage' THEN
   needle:='declare actor jsonb;';replacement:='declare v_pending record;v_pending_lunch jsonb; actor jsonb;';
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending stage declaration differs';END IF;
   changed:=replace(changed,needle,replacement);
   needle:=' insert into public.static_weekly_staffing_staged_candidates(operation_id,candidate_kind,candidate_key,service_date,';
   replacement:=$stage$
 -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE
 FOR v_pending IN SELECT item->'payload' payload,item->>'serviceDate' AS service_date_text FROM jsonb_array_elements(p_candidates) item
  WHERE item->>'candidateKind'='projection' AND item#>>'{payload,envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' LOOP
  IF v_pending.payload->>'serviceDate' IS DISTINCT FROM v_pending.service_date_text
   OR p_publication_vector->'expectedRevision' IS DISTINCT FROM to_jsonb(command.expected_revision)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_publication_vector->'weeks') w
    WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(w) k)=ARRAY['authorityRevision','publicationId','versionId','weekStart']::text[]
     AND w->>'weekStart'=v_pending.service_date_text AND w->'authorityRevision'=to_jsonb(command.expected_revision)
     AND w->'publicationId'=v_pending.payload->'publicationId'
     AND w->'versionId'=v_pending.payload#>'{envelope,semantic_snapshot,originalSource,version_id}')
  THEN RAISE EXCEPTION 'Pending original publication vector differs';END IF;
  PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,v_pending.payload);
  SELECT item->'payload' INTO STRICT v_pending_lunch FROM jsonb_array_elements(p_candidates) item
   WHERE item->>'candidateKind'='lunch' AND item->>'serviceDate'=v_pending.service_date_text;
  PERFORM public.static_weekly_pending_assert_lunch(p_operation_id,p_manager_id,(v_pending.payload->>'publicationId')::uuid,
   v_pending.service_date_text::date,v_pending.payload->'envelope',v_pending_lunch);
 END LOOP;
 -- END PRIVATE ORIGINAL-PENDING APPROVED STAGE
$stage$||needle;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending stage insert seam differs';END IF;
   changed:=replace(changed,needle,replacement);
   inverse:=replace(changed,replacement,needle);
   inverse:=replace(inverse,'declare v_pending record;v_pending_lunch jsonb; actor jsonb;','declare actor jsonb;');
  ELSIF r.kind='accept' THEN
   needle:='declare actor jsonb;';replacement:='declare v_pending_check jsonb; actor jsonb;';
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending accept declaration differs';END IF;
   changed:=replace(changed,needle,replacement);
   needle:=$original_projection$  v_signed_envelope:=jsonb_set(v_payload->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(v_payload->'envelope')),true);
  select * into v_existing from public.weekly_schedule_compiled_projections p
   where p.publication_id=(v_payload->>'publicationId')::uuid
    and p.week_start=v_projection_candidate.service_date
    and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
     (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
    and p.compiler_version=v_payload->>'compilerVersion'
    and p.authority_digest=v_signed_envelope->>'authority_digest'
   order by p.compiled_at desc,p.projection_id desc limit 1;
  v_reused:=found;
  if v_reused then
   if (v_existing.projection_envelope-array['attestation','receipt','database_projection_identity']) is distinct from
      (v_signed_envelope-array['attestation','receipt','database_projection_identity']) then
    raise exception using errcode='23514',message='historical projection identity conflicts with the exact staged candidate';end if;
   v_projection:=v_existing.projection_id;
   v_command_id:=gen_random_uuid();
   v_request:=jsonb_build_object('operation','materialize_projection','publication_id',(v_payload->>'publicationId')::uuid,
    'service_date',v_projection_candidate.service_date,'exception_set_digest',v_existing.exception_set_digest,
    'compiler_version',v_existing.compiler_version,'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,
    'replay_digest',v_existing.replay_digest,'projection_envelope',v_existing.projection_envelope,
    'expected_revision',command.expected_revision,'actor_manager_id',p_manager_id,'actor_manager_name',actor->>'manager_name');
   v_request_digest:=public.static_weekly_digest_jsonb(v_request);
   v_projection_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
    'exception_set_digest',v_existing.exception_set_digest,'compiler_version',v_existing.compiler_version,
    'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,'replay_digest',v_existing.replay_digest,
    'projection_envelope_identity',v_existing.projection_envelope->>'database_projection_identity',
    'attestation',v_existing.projection_envelope->'attestation'));
   v_projection_receipt:=public.static_weekly_response_json('materialize_projection',v_revision,
    v_projection_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,
     'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
     'week_end',v_existing.week_end,'replay_digest',v_existing.replay_digest));
   insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,
    command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
   values(v_command_id,p_manager_id,actor->>'manager_name','materialize_projection',v_payload->>'idempotencyKey',
    command.expected_revision,v_request_digest,v_request,v_projection_receipt,v_projection_receipt->>'output_digest',v_projection_content_digest);
  else
   v_projection_response:=public.static_weekly_v3_materialize_projection(
    (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',
    v_payload->>'compilerVersion',v_payload->'objective',v_payload->'metrics',v_payload->>'replayDigest',
    v_payload->'envelope',command.expected_revision,p_manager_id,v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  end if;
$original_projection$;
   replacement:=$accept$
  -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
  IF v_payload#>>'{envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' THEN
   v_pending_check:=public.static_weekly_pending_assert_payload(command.operation_id,p_manager_id,v_payload);
   IF (v_pending_check->>'afterFact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Pending original fact not accepted in this transaction';END IF;
   v_projection_response:=public.static_weekly_pending_projection_sink((v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',v_payload->>'compilerVersion',v_payload->'objective',
    v_payload->'metrics',v_payload->>'replayDigest',v_payload->'envelope',command.expected_revision,p_manager_id,
    actor->>'manager_name',v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  ELSE
$accept$||needle||$accept$
  END IF;
  -- END PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
$accept$;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending exact normal accept segment differs';END IF;
   changed:=replace(changed,needle,replacement);
   accept_original:=needle;accept_replacement:=replacement;
   needle:='  perform public.static_weekly_v8_materialize_lunch_document(v_projection,v_lunch,p_manager_id);';
   replacement:=$accept_lunch$
  IF v_payload#>>'{envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' THEN
   PERFORM public.static_weekly_pending_assert_lunch(command.operation_id,p_manager_id,(v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->'envelope',v_lunch);
   IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections WHERE projection_id=v_projection
    AND projection_envelope=v_payload->'envelope' AND compiled_by_manager_id=p_manager_id) THEN RAISE EXCEPTION 'Pending exact persisted original projection differs';END IF;
  END IF;
$accept_lunch$||needle;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending original lunch seam differs';END IF;
   changed:=replace(changed,needle,replacement);
   inverse:=replace(changed,replacement,needle);
   inverse:=replace(inverse,accept_replacement,accept_original);
   inverse:=replace(inverse,'declare v_pending_check jsonb; actor jsonb;','declare actor jsonb;');
  ELSE
   needle:='  signed_envelope:=jsonb_set(candidate.payload_json->''envelope'',''{attestation}'',';
   replacement:=$matcher$
  -- BEGIN PRIVATE ORIGINAL-PENDING BATCH DIGEST
  IF candidate.payload_json#>>'{envelope,semantic_snapshot,schema}'='custodial.approved-static-pending-staffing-projection-snapshot.v1' THEN
   PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,candidate.payload_json);
   expected_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',(candidate.payload_json->>'publicationId')::uuid,'week_start',(candidate.payload_json->>'serviceDate')::date,
    'exception_set_digest',candidate.payload_json->>'exceptionSetDigest','compiler_version',candidate.payload_json->>'compilerVersion',
    'objective',candidate.payload_json->'objective','metrics',candidate.payload_json->'metrics','replay_digest',candidate.payload_json->>'replayDigest',
    'projection_envelope_identity',candidate.payload_json#>>'{envelope,database_projection_identity}','attestation',NULL));
   IF expected_digest=p_content_digest THEN matches:=matches+1;END IF;
   CONTINUE;
  END IF;
  -- END PRIVATE ORIGINAL-PENDING BATCH DIGEST
$matcher$||needle;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Pending normal digest matcher seam differs';END IF;
   changed:=replace(changed,needle,replacement);inverse:=replace(changed,replacement,needle);
  END IF;
  IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'Pending original entrypoint unrelated Source differs';END IF;
  EXECUTE changed;
 END LOOP;
END $pending_staffing_boundaries$;

-- New internals are owner-only. Existing entrypoint ACL/security/RLS/ALWAYS
-- and normal role membership are unchanged. No grants are introduced.
REVOKE ALL ON FUNCTION
 public.static_weekly_pending_context(uuid,uuid),
 public.static_weekly_pending_original_exception_set(uuid,date,uuid),
 public.static_weekly_pending_exception_set(uuid,uuid,date,date),
 public.static_weekly_pending_summary(uuid,uuid,date,date),
 public.static_weekly_pending_applied_summary(uuid,uuid,date,date),
 public.static_weekly_pending_day_source(uuid,uuid,date,date),
 public.static_weekly_pending_effective_work(uuid,date,uuid,date,jsonb),
 public.static_weekly_pending_assert_day(uuid,jsonb,uuid,date,jsonb),
 public.static_weekly_pending_assert_projection(uuid,uuid,jsonb),
 public.static_weekly_pending_lunch_base(uuid,jsonb,jsonb,uuid,date),
 public.static_weekly_pending_lunch_derivation(uuid,jsonb,jsonb,uuid,date,uuid),
 public.static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb),
 public.static_weekly_pending_assert_payload(uuid,uuid,jsonb),
 public.static_weekly_pending_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)
FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823,postgres;
