\set ON_ERROR_STOP on
create schema custodial_coverall;
create table call_log(n bigint generated always as identity,label text);
create table mem_log(mode text,label text,used bigint);
create table fixture_mode(mode text);insert into fixture_mode values('original');
create table fixture_failure(kind text);insert into fixture_failure values('none');
create function mark(label text) returns void language sql as $$insert into call_log(label) values($1)$$;
create function public.static_weekly_digest_jsonb(value jsonb) returns text language sql strict as $$select encode(pg_catalog.sha256(convert_to(value::text,'UTF8')),'hex')$$;
create table custodial_coverall.activation_progress(operation_id uuid,credential_id uuid,device_id text,session_access text,basis_json jsonb,publication_id uuid,frame_start date,source_id uuid,version_id uuid,normal_result jsonb,authority_revision bigint);
create table custodial_coverall.initial_operational_stages(operation_id uuid,envelope_json jsonb,lunch_json jsonb,candidate_digest text);
create table custodial_coverall.activation_receipts(operation_id uuid,receipt_json jsonb);
create table public.weekly_schedule_compiled_projections(projection_id uuid,publication_id uuid,projection_envelope jsonb);
create table public.weekly_schedule_lunch_documents(projection_id uuid,document_json jsonb,document_identity text);
create table public.static_weekly_schedule_control(singleton boolean,current_revision bigint);insert into public.static_weekly_schedule_control values(true,21);
create table fixture(envelope jsonb,lunch jsonb);
insert into fixture values ('{"semantic_snapshot":{"initialActivation":{"operationId":"82000000-0000-4000-8000-000000000001"}},"authority":{"employmentRevisionVector":[{"employee":"synthetic","revision":"1"}]},"assignments":[],"compiler_version":"synthetic","objective":{},"metrics":{},"replay_digest":"synthetic","receipt":{"selectionSolverInvoked":false}}','{"document_identity":"synthetic-lunch-identity"}');
insert into custodial_coverall.activation_progress values('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000003','synthetic-device','full_access','{"employmentRevisionVector":[{"employee":"synthetic","revision":"1"}]}','82000000-0000-4000-8000-000000000004','2026-11-09','82000000-0000-4000-8000-000000000006','82000000-0000-4000-8000-000000000005','{"synthetic":true}',21);
-- Explicit synthetic dependency ports; no real actor or native validation claimed.
create function public.static_weekly_coverall_initial_context(uuid,uuid) returns jsonb language plpgsql as $$declare stage custodial_coverall.initial_operational_stages%rowtype;begin
 perform mark('context');if (select kind from fixture_failure)='context' then raise exception 'synthetic context refusal';end if;
 select * into stage from custodial_coverall.initial_operational_stages where operation_id=$1;
 return jsonb_build_object('basis',jsonb_build_object('padding',repeat('synthetic context memory ',100000)),
 'stagedEnvelope',stage.envelope_json,'stagedLunch',stage.lunch_json,'candidateDigest',stage.candidate_digest,
 'publicationId','82000000-0000-4000-8000-000000000004','frameStart','2026-11-09');end$$;
create function public.custodial_begin_application_mutation() returns void language sql as $$select mark('mutation')$$;
create function public.static_weekly_manual_assert_initial_employment_projection(p_operation uuid,p_manager uuid,p_doc jsonb,p_lunch jsonb) returns jsonb language plpgsql as $$declare full_context jsonb;begin
 perform mark('native');insert into mem_log select (select mode from fixture_mode),'native_entry',sum(used_bytes) from pg_backend_memory_contexts;
 full_context:=public.static_weekly_coverall_initial_context(p_operation,p_manager);
 insert into mem_log select (select mode from fixture_mode),'native_with_own_context',sum(used_bytes) from pg_backend_memory_contexts;
 if (select kind from fixture_failure)='payload' then raise exception 'synthetic payload refusal';end if;
 return jsonb_build_object('projection_assignments',p_doc->'assignments','assignment_links','{}'::jsonb);end$$;
create function public.static_weekly_manual_assert_native_lunch(uuid,jsonb,jsonb,uuid,date) returns void language sql as $$select mark('full_lunch')$$;
CREATE OR REPLACE FUNCTION public.static_weekly_coverall_initial_assert_payload(p_operation uuid, p_manager uuid, p_envelope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE ctx jsonb;proof jsonb;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);
 IF ctx->'stagedEnvelope' IS DISTINCT FROM p_envelope OR ctx->>'candidateDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(
  jsonb_build_object('envelope',p_envelope,'lunch',ctx->'stagedLunch'))
 THEN RAISE EXCEPTION 'Exact staged original INITIAL_EMPLOYMENT_OPERATIONALIZATION data required';END IF;
 -- One explicit Main factoring seam; NOT a boolean, fake staffing command,
 -- optimizer attestation or I1 receipt. Main's entry must derive its context
 -- by calling initial_context above and preserve the real native checks.
 IF to_regprocedure('public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Main factored initial-employment native guard not installed';END IF;
 EXECUTE 'select public.static_weekly_manual_assert_initial_employment_projection($1,$2,$3,$4)'
 INTO STRICT proof USING p_operation,p_manager,p_envelope,ctx->'stagedLunch';
 IF proof->'projection_assignments' IS DISTINCT FROM p_envelope->'assignments' OR jsonb_typeof(proof->'assignment_links')<>'object'
 THEN RAISE EXCEPTION 'Factored native guard must return complete checked assignment lineage';END IF;
 PERFORM public.static_weekly_manual_assert_native_lunch(NULL,ctx->'stagedLunch',p_envelope,(ctx->>'publicationId')::uuid,(ctx->>'frameStart')::date);
 RETURN proof;
END $function$
;
create function public.custodial_action_actor_v1(uuid,uuid,text,text,text) returns jsonb language plpgsql as $$begin perform mark('actor');return '{"manager_name":"Synthetic fixture"}';end$$;
create function public.static_weekly_accepted_exception_set(uuid,date) returns jsonb language plpgsql as $$begin perform mark('exceptions');return '[]';end$$;
create function public.static_weekly_coverall_initial_projection_sink(p_pub uuid,p_date date,p_exception text,p_version text,p_objective jsonb,p_metrics jsonb,p_replay text,p_envelope jsonb,p_revision bigint,p_manager uuid,p_name text,p_key text) returns jsonb language plpgsql as $$begin
 perform mark('sink');if (select kind from fixture_failure)='sink_missing' then return '{"data":{}}';end if;
 insert into public.weekly_schedule_compiled_projections values('82000000-0000-4000-8000-000000000007',p_pub,p_envelope);
 return '{"data":{"projection_id":"82000000-0000-4000-8000-000000000007"}}';end$$;
create function public.static_weekly_v8_materialize_lunch_document(p_projection uuid,p_doc jsonb,p_manager uuid) returns jsonb language plpgsql as $$begin
 perform mark('lunch');if (select kind from fixture_failure)<>'lunch_missing' then insert into public.weekly_schedule_lunch_documents values(p_projection,p_doc,p_doc->>'document_identity');end if;
 return jsonb_build_object('persistence_status','PERSISTED','document_identity',p_doc->>'document_identity');end$$;
create function reset_fixture() returns void language plpgsql as $$begin
 truncate call_log restart identity;truncate custodial_coverall.initial_operational_stages,custodial_coverall.activation_receipts,public.weekly_schedule_compiled_projections,public.weekly_schedule_lunch_documents;update fixture_failure set kind='none';end$$;
CREATE OR REPLACE FUNCTION public.static_weekly_coverall_stage_initial_operational(p_operation uuid, p_manager uuid, p_envelope jsonb, p_lunch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE ctx jsonb;prior custodial_coverall.initial_operational_stages%rowtype;fingerprint text;proof jsonb;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 IF pg_column_size(p_envelope)>16777216 OR pg_column_size(p_lunch)>16777216 OR p_envelope IS NULL OR p_lunch IS NULL
 THEN RAISE EXCEPTION 'Bounded actual native candidate and full lunch required';END IF;
 fingerprint:=public.static_weekly_digest_jsonb(jsonb_build_object('envelope',p_envelope,'lunch',p_lunch));
 SELECT * INTO prior FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.envelope_json IS DISTINCT FROM p_envelope OR prior.lunch_json IS DISTINCT FROM p_lunch OR prior.candidate_digest<>fingerprint THEN RAISE EXCEPTION 'Immutable initial native candidate conflict';END IF;
 ELSE INSERT INTO custodial_coverall.initial_operational_stages(operation_id,envelope_json,lunch_json,candidate_digest) VALUES(p_operation,p_envelope,p_lunch,fingerprint);END IF;
 proof:=public.static_weekly_coverall_initial_assert_payload(p_operation,p_manager,p_envelope);
 RETURN jsonb_build_object('state','STAGED_UNCOMMITTED','operationId',p_operation,'candidateDigest',fingerprint,'committed',false);
END $function$
;
CREATE OR REPLACE FUNCTION public.static_weekly_coverall_finalize_initial_operational(p_operation uuid, p_manager uuid, p_candidate_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE a custodial_coverall.activation_progress%rowtype;s custodial_coverall.initial_operational_stages%rowtype;ctx jsonb;proof jsonb;stored jsonb;lunch jsonb;receipt jsonb;projection uuid;actor jsonb;revision bigint;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 SELECT * INTO STRICT a FROM custodial_coverall.activation_progress WHERE operation_id=p_operation;
 SELECT * INTO STRICT s FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 IF s.candidate_digest IS DISTINCT FROM p_candidate_digest THEN RAISE EXCEPTION 'Original staged initial candidate identity required';END IF;
 proof:=public.static_weekly_coverall_initial_assert_payload(p_operation,p_manager,s.envelope_json);
 actor:=public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 IF s.envelope_json#>>'{semantic_snapshot,initialActivation,operationId}' IS DISTINCT FROM p_operation::text
  OR s.envelope_json#>'{authority,employmentRevisionVector}' IS DISTINCT FROM a.basis_json->'employmentRevisionVector'
 THEN RAISE EXCEPTION 'Original initial operation and all14 actual employment revisions must remain bound';END IF;
 stored:=public.static_weekly_coverall_initial_projection_sink(a.publication_id,a.frame_start,
  public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(a.publication_id,a.frame_start)),
  s.envelope_json->>'compiler_version',s.envelope_json->'objective',s.envelope_json->'metrics',s.envelope_json->>'replay_digest',
  s.envelope_json,a.authority_revision,p_manager,actor->>'manager_name','coverall-initial:'||p_operation);
 projection:=(stored#>>'{data,projection_id}')::uuid;
 IF projection IS NULL THEN RAISE EXCEPTION 'Native projection writer did not return actual projection ID';END IF;
 lunch:=public.static_weekly_v8_materialize_lunch_document(projection,s.lunch_json,p_manager);
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
  WHERE p.projection_id=projection AND p.publication_id=a.publication_id AND p.projection_envelope=s.envelope_json
   AND l.document_json=s.lunch_json AND l.document_identity=s.lunch_json->>'document_identity')
 THEN RAISE EXCEPTION 'Actual same-transaction operational projection/full lunch missing';END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-coverall-source-confirmation.v2','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION',
  'status','PERSISTED_CURRENT','operationId',p_operation,'managerId',p_manager,'sourceId',a.source_id,'publicationId',a.publication_id,
  'versionId',a.version_id,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',revision,
  'normalBaselineResult',a.normal_result,'operationalProjectionResult',stored,'lunchResult',lunch,'projectionId',projection,
  'employmentRevisionVector',a.basis_json->'employmentRevisionVector','actualPositions',30,'originalHistoryPositions',22,
  'newNonemployeeCapacityPositions',8,'newEmployeesCreated',false,'weeklyBaselineChanged',false,'contractorBooked',false,
  'candidateDigest',s.candidate_digest,'revision',revision,'lunchDocumentIdentity',s.lunch_json->>'document_identity','normalPatternSolverInvoked',false,'operationalSelectionSolverInvoked',s.envelope_json#>'{receipt,selectionSolverInvoked}','samePhysicalTransaction',true);
 INSERT INTO custodial_coverall.activation_receipts VALUES(p_operation,receipt);RETURN receipt;
END $function$
;

create function run_workflow() returns jsonb language plpgsql as $$declare staged jsonb;receipt jsonb;doc jsonb;meal jsonb;begin
 select envelope,lunch into doc,meal from fixture;
 staged:=public.static_weekly_coverall_stage_initial_operational('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002',doc,meal);
 if staged is distinct from public.static_weekly_coverall_stage_initial_operational('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002',doc,meal) then raise exception 'Stage replay changed';end if;
 receipt:=public.static_weekly_coverall_finalize_initial_operational('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002',staged->>'candidateDigest');
 return jsonb_build_object('stage',staged,'receipt',receipt,'calls',(select jsonb_agg(label order by n) from call_log),
 'stages',(select jsonb_agg(to_jsonb(s)) from custodial_coverall.initial_operational_stages s),
 'receipts',(select jsonb_agg(to_jsonb(s)) from custodial_coverall.activation_receipts s),
 'projections',(select jsonb_agg(to_jsonb(s)) from public.weekly_schedule_compiled_projections s),
 'lunch',(select jsonb_agg(to_jsonb(s)) from public.weekly_schedule_lunch_documents s));end$$;
create function run_negative(p_kind text) returns text language plpgsql as $$declare staged jsonb;doc jsonb;meal jsonb;begin
 perform reset_fixture();select envelope,lunch into doc,meal from fixture;
 if p_kind in('context','payload') then update fixture_failure set kind=p_kind;end if;
 if p_kind='stage_null' then doc:=null;end if;
 staged:=public.static_weekly_coverall_stage_initial_operational('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002',doc,meal);
 if p_kind='stage_conflict' then perform public.static_weekly_coverall_stage_initial_operational('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002',doc||'{"changed":true}',meal);end if;
 if p_kind='digest' then staged:=jsonb_set(staged,'{candidateDigest}','"wrong"');end if;
 if p_kind='lineage' then update custodial_coverall.initial_operational_stages set envelope_json=jsonb_set(envelope_json,'{semantic_snapshot,initialActivation,operationId}','"82000000-0000-4000-8000-000000000099"');end if;
 if p_kind='revision' then update custodial_coverall.initial_operational_stages set envelope_json=jsonb_set(envelope_json,'{authority,employmentRevisionVector}','[]');end if;
 if p_kind in('sink_missing','lunch_missing') then update fixture_failure set kind=p_kind;end if;
 perform public.static_weekly_coverall_finalize_initial_operational('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002',staged->>'candidateDigest');
 raise exception 'Invalid fixture accepted';exception when others then if sqlerrm='Invalid fixture accepted' then raise;end if;return sqlstate||':'||sqlerrm;end$$;
create temp table expected as select run_workflow() value;
create temp table expected_negatives as select kind,run_negative(kind) value from unnest(array['context','payload','stage_null','stage_conflict','digest','lineage','revision','sink_missing','lunch_missing']) kind;

create role static_weekly_control_plane;
revoke all on function public.static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb),public.static_weekly_coverall_finalize_initial_operational(uuid,uuid,text),public.static_weekly_coverall_initial_assert_payload(uuid,uuid,jsonb) from public;
grant execute on function public.static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb),public.static_weekly_coverall_finalize_initial_operational(uuid,uuid,text) to static_weekly_control_plane;
create function public.static_weekly_digest_text(text) returns text language sql strict as $$select encode(pg_catalog.sha256(convert_to($1,'UTF8')),'hex')$$;
create table public.custodial_release_authority_restore_inventory(object_identity text primary key,marker text);
insert into public.custodial_release_authority_restore_inventory values('unrelated original','preserve exact');
create function public.custodial_release_canary_authority_surface() returns table(object_identity text) language sql as $$select null::text where false$$;
-- EXACT_REPAIR_APPLY
update fixture_mode set mode='discarded';select reset_fixture();
do $verify$ declare actual jsonb;begin
 actual:=run_workflow();if actual is distinct from (select value from expected) then raise exception 'Actual owner calls, receipt, replay or storage changed';end if;
 if exists(select 1 from expected_negatives where run_negative(kind) is distinct from value) then raise exception 'Actual owner refusal changed';end if;
 raise notice 'PASS exact stage/final owners identical calls, receipt, replay, writes and9refusal outcomes; dependency ports synthetic';
end $verify$;
select mode,label,min(used),max(used) from mem_log group by mode,label order by mode;
