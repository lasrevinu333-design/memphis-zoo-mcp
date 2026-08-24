-- Bound production-sized static-weekly validation and idempotency memory without weakening any accepted proof.
begin;
create or replace function public.static_weekly_assert_compiler_authority(
  p_authority jsonb,p_receipt jsonb,p_effective_start date,p_require_publishable boolean
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_certificate jsonb;
  v_expected_authority_certificate jsonb;
  v_solver_tiers jsonb;
  v_tier_options jsonb;
  v_authority_tiers jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_authority,
    array['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','weeklyVersionDigest','projectionAvailability','optimizerResult','appliedExceptions','databaseContentIdentity'],
    array['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','weeklyVersionDigest','projectionAvailability','optimizerResult','appliedExceptions','databaseContentIdentity'],'compiler authority');
  perform public.static_weekly_assert_exact_object(p_receipt,
    array['schema','adapterVersion','trustedAdapterBoundary','compiler'],
    array['schema','adapterVersion','trustedAdapterBoundary','compiler'],'adapter receipt');
  if jsonb_typeof(p_authority->'schema') is distinct from 'string'
    or jsonb_typeof(p_authority->'effectiveDate') is distinct from 'string'
    or jsonb_typeof(p_receipt->'schema') is distinct from 'string'
    or jsonb_typeof(p_receipt->'adapterVersion') is distinct from 'string'
    or jsonb_typeof(p_receipt->'trustedAdapterBoundary') is distinct from 'string'
    or p_authority->>'schema' is distinct from 'memphis-zoo.static-weekly-authority.v3'
    or p_receipt->>'schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'
    or p_receipt->>'adapterVersion' is distinct from 'static-weekly-database-adapter-v1'
    or p_receipt->>'trustedAdapterBoundary' is distinct from 'I1 compileStaticWeeklySchedule result independently reverified before I2 persistence' then
    raise exception using errcode='23514',message='complete trusted I1-to-I2 adapter receipt is required';
  end if;

  v_certificate:=p_receipt#>'{compiler,certificate}';
  v_solver_tiers:=p_receipt#>'{compiler,solver,tiers}';
  perform public.static_weekly_assert_exact_object((p_receipt->'compiler'),
    array['contract','compilerVersion','serviceDate','status','publicationAuthority','inputDigest','weeklyVersionId','weeklyVersionDigest','solutionDigest','authorityDigest','replayDigest','certificate','solver','verifier','independentVerification'],
    array['contract','compilerVersion','serviceDate','status','publicationAuthority','inputDigest','weeklyVersionId','weeklyVersionDigest','solutionDigest','authorityDigest','replayDigest','certificate','solver','verifier','independentVerification'],'compiler receipt');
  perform public.static_weekly_assert_exact_object((p_authority->'optimizerResult'),
    array['compilerVersion','assignments','objective','certificate','tiers','metrics'],
    array['compilerVersion','assignments','objective','certificate','tiers','metrics'],'optimizer authority');
  perform public.static_weekly_assert_exact_object(p_authority->'compilerInput',
    array['serviceDate','version','slots','exceptions','proximity'],
    array['serviceDate','version','slots','exceptions','proximity'],'baseline compiler input');
  perform public.static_weekly_assert_exact_object(p_authority->'overlayCompilerInput',
    array['serviceDate','version','slots','exceptions','proximity'],
    array['serviceDate','version','slots','exceptions','proximity'],'overlay compiler input');
  perform public.static_weekly_assert_exact_object(v_certificate,
    array['schema','compilerVersion','verifierVersion','objectivePolicyVersion','canonicalInputDigest','baselineInputDigest','weeklyVersionDigest','solverIdentity','tierReceiptDigest','tierOptionsDigest','assignmentDigest','canonicalProgram','modelBasis','modelBasisDigest','finalWitness','execution'],
    array['schema','compilerVersion','verifierVersion','objectivePolicyVersion','canonicalInputDigest','baselineInputDigest','weeklyVersionDigest','solverIdentity','tierReceiptDigest','tierOptionsDigest','assignmentDigest','canonicalProgram','modelBasis','modelBasisDigest','finalWitness','execution'],'v5 solver certificate');
  perform public.static_weekly_assert_exact_object(v_certificate->'execution',
    array['durationMilliseconds','solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','workerOutputBytes','boundedWorkingMemoryBytes','receiptBytes','preflight','resultBytes'],
    array['durationMilliseconds','solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','workerOutputBytes','boundedWorkingMemoryBytes','receiptBytes','preflight','resultBytes'],'v5 solver execution receipt');

  if exists(
    select 1 from unnest(array['durationMilliseconds','solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','workerOutputBytes','boundedWorkingMemoryBytes','receiptBytes','resultBytes']) field_name
    where jsonb_typeof(v_certificate->'execution'->field_name) is distinct from 'number'
  ) or jsonb_typeof(v_certificate#>'{execution,preflight}') is distinct from 'object' then
    raise exception using errcode='23514',message='v5 execution receipt fields require exact numeric telemetry and one preflight object';
  end if;
  if exists(
    select 1 from unnest(array['durationMilliseconds','solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','workerOutputBytes','boundedWorkingMemoryBytes','receiptBytes','resultBytes']) field_name
    where (v_certificate->'execution'->>field_name)::numeric<>trunc((v_certificate->'execution'->>field_name)::numeric)
       or (v_certificate->'execution'->>field_name)::numeric<0
       or (v_certificate->'execution'->>field_name)::numeric>9007199254740991
  ) then
    raise exception using errcode='23514',message='v5 execution receipt telemetry must be nonnegative exact safe integers';
  end if;

  if jsonb_typeof((p_receipt->'compiler')->'compilerVersion') is distinct from 'string'
    or jsonb_typeof((p_receipt->'compiler')->'status') is distinct from 'string'
    or jsonb_typeof((p_receipt->'compiler')->'publicationAuthority') is distinct from 'string'
    or jsonb_typeof((p_receipt->'compiler')->'inputDigest') is distinct from 'string'
    or jsonb_typeof((p_receipt->'compiler')->'solutionDigest') is distinct from 'string'
    or jsonb_typeof((p_receipt->'compiler')->'authorityDigest') is distinct from 'string'
    or jsonb_typeof((p_receipt->'compiler')->'replayDigest') is distinct from 'string'
    or jsonb_typeof(p_authority#>'{compilerInput,version}') is distinct from 'object'
    or jsonb_typeof(p_authority#>'{compilerInput,version,id}') is distinct from 'string'
    or jsonb_typeof(p_authority#>'{compilerInput,version,publicationId}') is distinct from 'string'
    or jsonb_typeof(p_authority#>'{compilerInput,version,assignments}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{compilerInput,version,slotAvailability}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{compilerInput,slots}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{compilerInput,exceptions}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{overlayCompilerInput,exceptions}') is distinct from 'array'
    or jsonb_typeof((p_authority->'optimizerResult')->'assignments') is distinct from 'array'
    or jsonb_typeof((p_authority->'optimizerResult')->'tiers') is distinct from 'array'
    or jsonb_typeof((p_authority->'optimizerResult')->'certificate') is distinct from 'object'
    or jsonb_typeof(p_authority->'projectionAvailability') is distinct from 'array'
    or jsonb_typeof(p_authority->'appliedExceptions') is distinct from 'array' then
    raise exception using errcode='23514',message='compiler, optimizer, certificate, model, and projection receipt fields are required';
  end if;

  if jsonb_typeof(p_authority->'inputDigest') is distinct from 'string'
    or jsonb_typeof(p_authority->'baselineInputDigest') is distinct from 'string'
    or jsonb_typeof(p_authority->'weeklyVersionDigest') is distinct from 'string'
    or jsonb_typeof(p_authority->'databaseContentIdentity') is distinct from 'string'
    or p_authority->>'effectiveDate' is distinct from p_effective_start::text
    or p_authority->>'databaseContentIdentity' is distinct from public.static_weekly_digest_jsonb(p_authority-'databaseContentIdentity')
    or p_authority->>'inputDigest' is distinct from public.static_weekly_digest_jsonb(p_authority->'overlayCompilerInput')
    or p_authority->>'baselineInputDigest' is distinct from public.static_weekly_digest_jsonb(p_authority->'compilerInput')
    or (p_receipt->'compiler')->>'inputDigest' is distinct from p_authority->>'inputDigest'
    or (p_receipt->'compiler')->>'solutionDigest' is distinct from public.static_weekly_digest_jsonb((p_authority->'optimizerResult'))
    or (p_receipt->'compiler')->>'authorityDigest' is distinct from public.static_weekly_digest_jsonb(p_authority)
    or coalesce((p_receipt->'compiler')->>'replayDigest','') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='23514',message='compiler input, baseline, solution, authority, and replay identities must be exact';
  end if;

  select coalesce(jsonb_agg(tier.value->'options' order by tier.ordinality),'[]'::jsonb)
  into v_tier_options
  from jsonb_array_elements(v_solver_tiers) with ordinality tier(value,ordinality);
  v_authority_tiers:=public.static_weekly_v5_canonical_solver_tiers(v_solver_tiers);
  v_expected_authority_certificate:=
    (v_certificate-'tierReceiptDigest'-'tierOptionsDigest');
  v_expected_authority_certificate:=jsonb_set(
    v_expected_authority_certificate,
    '{execution}',
    (v_certificate->'execution')-'durationMilliseconds'-'receiptBytes'-'workerOutputBytes'-'resultBytes',
    false
  );

  if v_certificate->>'schema' is distinct from 'memphis-zoo.static-weekly-solver-certificate.v5'
    or v_certificate->>'compilerVersion' is distinct from 'static-weekly-highs-mip-v8-workload-duty-boundary'
    or v_certificate->>'compilerVersion' is distinct from (p_receipt->'compiler')->>'compilerVersion'
    or (p_authority->'optimizerResult')->>'compilerVersion' is distinct from (p_receipt->'compiler')->>'compilerVersion'
    or v_certificate->>'verifierVersion' is distinct from 'static-weekly-js-verifier-v8-workload-duty-boundary'
    or (p_receipt->'compiler')#>>'{verifier,verifierVersion}' is distinct from v_certificate->>'verifierVersion'
    or (p_receipt->'compiler')#>>'{independentVerification,verifierVersion}' is distinct from v_certificate->>'verifierVersion'
    or v_certificate->>'objectivePolicyVersion' is distinct from 'monotonic-leximax-v1'
    or (p_authority->'optimizerResult')#>>'{objective,policyVersion}' is distinct from v_certificate->>'objectivePolicyVersion'
    or v_certificate->>'canonicalInputDigest' is distinct from p_authority->>'inputDigest'
    or v_certificate->>'baselineInputDigest' is distinct from p_authority->>'baselineInputDigest'
    or v_certificate->>'weeklyVersionDigest' is distinct from p_authority->>'weeklyVersionDigest'
    or jsonb_typeof(v_certificate->'solverIdentity') is distinct from 'object'
    or v_certificate->'solverIdentity' is distinct from (p_receipt->'compiler')#>'{solver,identity}'
    or coalesce(v_certificate->>'tierReceiptDigest','') !~ '^[0-9a-f]{64}$'
    or v_certificate->>'tierReceiptDigest' is distinct from public.static_weekly_digest_jsonb(v_solver_tiers)
    or coalesce(v_certificate->>'tierOptionsDigest','') !~ '^[0-9a-f]{64}$'
    or v_certificate->>'tierOptionsDigest' is distinct from public.static_weekly_digest_jsonb(v_tier_options)
    or coalesce(v_certificate->>'assignmentDigest','') !~ '^[0-9a-f]{64}$'
    or coalesce(v_certificate->>'modelBasisDigest','') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_certificate->'modelBasis') is distinct from 'object'
    or jsonb_typeof(v_certificate->'canonicalProgram') is distinct from 'object'
    or jsonb_typeof(v_certificate->'finalWitness') is distinct from 'object'
    or jsonb_typeof(v_certificate->'execution') is distinct from 'object'
    or jsonb_typeof((p_receipt->'compiler')#>'{independentVerification,violations}') is distinct from 'array'
    or jsonb_typeof((p_receipt->'compiler')#>'{independentVerification,ok}') is distinct from 'boolean'
    or (p_receipt->'compiler')#>>'{independentVerification,ok}' is distinct from 'true'
    or (p_authority->'optimizerResult')->'certificate' is distinct from v_expected_authority_certificate
    or (p_authority->'optimizerResult')->'tiers' is distinct from v_authority_tiers then
    raise exception using errcode='23514',message='complete accepted v5 solver/verifier certificate, tier receipts, model, witness, and deterministic authority projection are required';
  end if;

  if p_require_publishable and (
    (p_receipt->'compiler')->>'status' is distinct from 'FEASIBLE'
    or (p_receipt->'compiler')->>'publicationAuthority' is distinct from 'ACCEPTABLE'
  ) then
    raise exception using errcode='23514',message='only a successful publishable compiler result may create a recurring authority version';
  end if;
  if p_require_publishable and (
    p_authority->'appliedExceptions' is distinct from '[]'::jsonb
    or p_authority->'overlayCompilerInput' is distinct from p_authority->'compilerInput'
    or p_authority->>'inputDigest' is distinct from p_authority->>'baselineInputDigest'
  ) then
    raise exception using errcode='23514',message='recurring draft authority must be an exception-free baseline compiler result';
  end if;
end
$function$;
create or replace function public.static_weekly_assert_document(p_document jsonb,p_effective_start date,p_require_publishable boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform public.static_weekly_assert_exact_object(p_document,array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation'],array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation'],'adapter document');
  perform public.static_weekly_assert_exact_object(p_document->'adapter',array['schema','version'],array['schema','version'],'adapter document adapter');
  perform public.static_weekly_assert_exact_object(p_document->'validation',array['status','publication_authority','compiler_version','input_digest','solution_digest','authority_digest','replay_digest','receipt_digest','database_document_identity'],array['status','publication_authority','compiler_version','input_digest','solution_digest','authority_digest','replay_digest','receipt_digest','database_document_identity'],'adapter document validation');
  if jsonb_typeof(p_document #> '{adapter,schema}') is distinct from 'string' or jsonb_typeof(p_document #> '{adapter,version}') is distinct from 'string'
    or exists(select 1 from unnest(array['status','publication_authority','compiler_version','input_digest','solution_digest','authority_digest','replay_digest','receipt_digest','database_document_identity']) as r(key) where jsonb_typeof(p_document->'validation'->r.key) is distinct from 'string')
    or p_document #>> '{adapter,schema}' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1'
    or p_document #>> '{adapter,version}' is distinct from 'static-weekly-database-adapter-v1'
    or p_document #>> '{validation,database_document_identity}' is distinct from public.static_weekly_document_identity(p_document)
    or p_document #>> '{validation,authority_digest}' is distinct from public.static_weekly_digest_jsonb((p_document->'authority'))
    or p_document #>> '{validation,solution_digest}' is distinct from public.static_weekly_digest_jsonb((p_document->'authority')->'optimizerResult')
    or p_document #>> '{validation,input_digest}' is distinct from (p_document->'authority')->>'inputDigest'
    or p_document #>> '{validation,replay_digest}' is distinct from p_document #>> '{receipt,compiler,replayDigest}'
    or p_document #>> '{validation,receipt_digest}' is distinct from public.static_weekly_digest_jsonb(p_document->'receipt')
    or jsonb_typeof((p_document->'assignments')) is distinct from 'array' or jsonb_typeof((p_document->'slot_availability')) is distinct from 'array' or jsonb_typeof((p_document->'objective_inputs')) is distinct from 'array' then
    raise exception using errcode='23514',message='adapter document identity and exact relational projection are required';
  end if;
  if jsonb_array_length((p_document->'assignments'))=0 or jsonb_array_length((p_document->'slot_availability'))=0 or jsonb_array_length((p_document->'objective_inputs'))<>1
    or exists(select 1 from jsonb_array_elements((p_document->'assignments')) as a(x)
      where jsonb_typeof(a.x) is distinct from 'object' or not (a.x ?& array['work_id','day_of_week','status','location_id','location_code_snapshot','location_name_snapshot','coverage_start','coverage_end','owner_slot_id','owner_slot_label_snapshot','owner_person_id_snapshot','owner_name_snapshot','required_qualifications_snapshot','restriction_snapshot','workload_points','workload_provenance','manual_lock','payload_json'])
        or exists(select 1 from jsonb_object_keys(a.x) as k(key) where not (k.key=any(array['work_id','day_of_week','status','location_id','location_code_snapshot','location_name_snapshot','coverage_start','coverage_end','owner_slot_id','owner_slot_label_snapshot','owner_person_id_snapshot','owner_name_snapshot','required_qualifications_snapshot','restriction_snapshot','workload_points','workload_provenance','manual_lock','payload_json'])))
        or jsonb_typeof(a.x->'work_id') is distinct from 'string' or nullif(btrim(a.x->>'work_id'),'') is null
        or jsonb_typeof(a.x->'day_of_week') is distinct from 'number' or (a.x->>'day_of_week') !~ '^[0-6]$'
        or jsonb_typeof(a.x->'status') is distinct from 'string' or upper(a.x->>'status') not in ('ASSIGNED','OPEN','REVIEW')
        or jsonb_typeof(a.x->'location_id') is distinct from 'string' or jsonb_typeof(a.x->'location_code_snapshot') is distinct from 'string' or nullif(btrim(a.x->>'location_code_snapshot'),'') is null
        or jsonb_typeof(a.x->'location_name_snapshot') is distinct from 'string' or nullif(btrim(a.x->>'location_name_snapshot'),'') is null
        or jsonb_typeof(a.x->'coverage_start') is distinct from 'string' or jsonb_typeof(a.x->'coverage_end') is distinct from 'string'
        or jsonb_typeof(a.x->'required_qualifications_snapshot') is distinct from 'array' or jsonb_typeof(a.x->'restriction_snapshot') is distinct from 'array'
        or jsonb_typeof(a.x->'workload_points') is distinct from 'number' or jsonb_typeof(a.x->'workload_provenance') is distinct from 'object'
        or jsonb_typeof(a.x->'manual_lock') is distinct from 'boolean' or jsonb_typeof(a.x->'payload_json') is distinct from 'object' or jsonb_typeof(a.x#>'{payload_json,authority_facts}') is distinct from 'object')
    or exists(select 1 from jsonb_array_elements((p_document->'slot_availability')) as a(x)
      where jsonb_typeof(a.x) is distinct from 'object' or not (a.x ?& array['slot_id','day_of_week','availability_state','shift_start','shift_end','lunch_start','lunch_end','capacity_units','max_load_points','qualification_snapshot','qualification_provenance','restriction_snapshot','restriction_provenance','slot_label_snapshot','incumbent_person_id_snapshot','incumbent_name_snapshot'])
        or exists(select 1 from jsonb_object_keys(a.x) as k(key) where not (k.key=any(array['slot_id','day_of_week','availability_state','shift_start','shift_end','lunch_start','lunch_end','capacity_units','max_load_points','qualification_snapshot','qualification_provenance','restriction_snapshot','restriction_provenance','slot_label_snapshot','incumbent_person_id_snapshot','incumbent_name_snapshot'])))
        or jsonb_typeof(a.x->'slot_id') is distinct from 'string' or jsonb_typeof(a.x->'day_of_week') is distinct from 'number' or (a.x->>'day_of_week') !~ '^[0-6]$'
        or jsonb_typeof(a.x->'availability_state') is distinct from 'string' or jsonb_typeof(a.x->'qualification_snapshot') is distinct from 'array'
        or jsonb_typeof(a.x->'qualification_provenance') is distinct from 'object' or jsonb_typeof(a.x->'restriction_snapshot') is distinct from 'array'
        or jsonb_typeof(a.x->'restriction_provenance') is distinct from 'object' or jsonb_typeof(a.x->'slot_label_snapshot') is distinct from 'string' or nullif(btrim(a.x->>'slot_label_snapshot'),'') is null)
    or exists(select 1 from jsonb_array_elements((p_document->'objective_inputs')) as i(x)
      where jsonb_typeof(i.x) is distinct from 'object' or not (i.x ?& array['input_key','input_value','provenance'])
        or exists(select 1 from jsonb_object_keys(i.x) as k(key) where not (k.key=any(array['input_key','input_value','provenance'])))
        or i.x->>'input_key' is distinct from 'static_weekly_compiler_receipt' or jsonb_typeof(i.x->'input_value') is distinct from 'object' or jsonb_typeof(i.x->'provenance') is distinct from 'object') then
    raise exception using errcode='23514',message='adapter document rows must be complete, typed, exact, and non-empty';
  end if;
  if (select count(*) from jsonb_array_elements((p_document->'assignments')))<>(select count(distinct (x->>'day_of_week',x->>'work_id')) from jsonb_array_elements((p_document->'assignments')) as a(x))
    or (select count(*) from jsonb_array_elements((p_document->'slot_availability')))<>(select count(distinct (x->>'day_of_week',x->>'slot_id')) from jsonb_array_elements((p_document->'slot_availability')) as a(x)) then
    raise exception using errcode='23514',message='adapter document rows may not contain duplicate work or availability identities';
  end if;
  if exists(
    with source as (select value x,((value->>'dayOfWeek')||':'||coalesce(value->>'workId',value->>'id')) k from jsonb_array_elements((p_document->'authority') #> '{compilerInput,version,assignments}')),
    optimizer as (select value x from jsonb_array_elements((p_document->'authority') #> '{optimizerResult,assignments}')),
    document as (select value x from jsonb_array_elements((p_document->'assignments')))
    select 1 from source s full join optimizer o on o.x->>'planWorkId'=s.k full join document d on ((d.x->>'day_of_week')||':'||(d.x->>'work_id'))=coalesce(s.k,o.x->>'planWorkId')
    where s.x is null or o.x is null or d.x is null
      or o.x->>'serviceDate' is distinct from (p_effective_start+(((s.x->>'dayOfWeek')::int-extract(dow from p_effective_start)::int+7)%7))::date::text
      or d.x->>'coverage_start' is distinct from s.x#>>'{window,start}' or d.x->>'coverage_end' is distinct from s.x#>>'{window,end}'
      or d.x->>'location_id' is distinct from s.x->>'locationId' or d.x->>'workload_points' is distinct from s.x->>'serviceEffortMinutes'
      or lower(d.x->>'status') is distinct from lower(o.x->>'status')
      or (o.x->>'status'='ASSIGNED' and (d.x->>'owner_slot_id' is distinct from o.x->>'slotId' or d.x->>'owner_person_id_snapshot' is distinct from o.x->>'personId' or d.x->>'owner_name_snapshot' is distinct from o.x->>'displayName'))
      or (o.x->>'status' in ('OPEN','REVIEW') and (d.x->>'owner_slot_id' is not null or d.x->>'owner_person_id_snapshot' is not null or d.x->>'owner_name_snapshot' is not null))
      or d.x#>>'{payload_json,owner_digest}' is distinct from o.x->>'ownerDigest'
      or d.x#>>'{payload_json,exact_owner_identity}' is distinct from o.x->>'exactOwnerIdentity'
  ) then raise exception using errcode='23514',message='all seven-day source work, optimizer owners, and document assignments must exactly agree'; end if;
  if exists(
    with source as (select value x from jsonb_array_elements((p_document->'authority')->'projectionAvailability')),
    document as (select value x from jsonb_array_elements((p_document->'slot_availability')))
    select 1 from source s full join document d on d.x->>'slot_id'=s.x->>'slotId' and d.x->>'day_of_week'=s.x->>'dayOfWeek'
    where s.x is null or d.x is null or d.x->>'availability_state' is distinct from s.x->>'status'
      or d.x->>'shift_start' is distinct from s.x#>>'{shift,start}' or d.x->>'shift_end' is distinct from s.x#>>'{shift,end}'
      or d.x->>'capacity_units' is distinct from s.x->>'productiveCapacityMinutes' or d.x->>'max_load_points' is distinct from s.x->>'maxServiceEffortMinutes'
      or d.x->>'incumbent_person_id_snapshot' is distinct from s.x->>'incumbentPersonId' or d.x->>'incumbent_name_snapshot' is distinct from s.x->>'incumbentName'
  ) then raise exception using errcode='23514',message='all seven-day dated availability and incumbent identities must exactly agree'; end if;
end
$function$;
create or replace function public.static_weekly_v2_create_draft(
  p_effective_start date,p_objective_version text,p_objective jsonb,p_input_provenance jsonb,p_document jsonb,
  p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_command uuid:=gen_random_uuid(); v_version uuid; v_content_digest text; v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'create_draft');
  v_request:=jsonb_build_object('operation','create_draft','effective_start',p_effective_start,'objective_version',p_objective_version,'objective_digest',public.static_weekly_digest_jsonb(p_objective),'input_provenance_digest',public.static_weekly_digest_jsonb(p_input_provenance),'document_identity',p_document#>>'{validation,database_document_identity}','expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_effective_start is null or btrim(coalesce(p_objective_version,''))='' then raise exception using errcode='23514',message='complete draft command identity is required'; end if;
  perform public.static_weekly_assert_document_attested(p_document,p_effective_start,true);
  perform public.static_weekly_assert_exact_object(p_input_provenance,array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],'draft input provenance');
  if jsonb_typeof(p_objective) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input_provenance) k(key) where jsonb_typeof(p_input_provenance->k.key) is distinct from 'string') or p_objective is distinct from p_document#>'{authority,optimizerResult,objective}' or p_objective_version is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1' or p_input_provenance->>'compiler_version' is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'input_digest' is distinct from p_document#>>'{validation,input_digest}' or p_input_provenance->>'baseline_input_digest' is distinct from p_document#>>'{authority,baselineInputDigest}' or p_input_provenance->>'authority_digest' is distinct from p_document#>>'{validation,authority_digest}' or p_input_provenance->>'replay_digest' is distinct from p_document#>>'{validation,replay_digest}' then raise exception using errcode='23514',message='draft command may use only attested adapter-derived objective and provenance'; end if;
  begin v_version:=(p_document#>>'{authority,compilerInput,version,id}')::uuid; exception when others then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('objective_version',p_objective_version,'objective_digest',public.static_weekly_digest_jsonb(p_objective),'input_provenance_digest',public.static_weekly_digest_jsonb(p_input_provenance),'document_identity',p_document#>>'{validation,database_document_identity}'));
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'create_draft',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_schedule_versions(version_id,lifecycle_state,effective_start,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot) values(v_version,'draft',p_effective_start,p_objective_version,p_objective,p_input_provenance,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  perform public.static_weekly_materialize_document(v_version,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response:=public.static_weekly_response_json('create_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',v_version,'draft_revision',1,'effective_start',p_effective_start));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'create_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest); return v_response;
end
$function$;
create or replace function public.static_weekly_v2_update_draft(
  p_version_id uuid,p_document jsonb,p_objective jsonb,p_input_provenance jsonb,p_expected_draft_revision bigint,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_version public.weekly_schedule_versions%rowtype; v_document_version_id uuid; v_command uuid:=gen_random_uuid(); v_content_digest text; v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'update_draft');
  v_request:=jsonb_build_object('operation','update_draft','version_id',p_version_id,'document_identity',p_document#>>'{validation,database_document_identity}','objective_digest',public.static_weekly_digest_jsonb(p_objective),'input_provenance_digest',public.static_weekly_digest_jsonb(p_input_provenance),'expected_draft_revision',p_expected_draft_revision,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name); v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key; if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if p_version_id is null or p_expected_draft_revision is null or p_expected_draft_revision<1 then raise exception using errcode='23514',message='complete update draft identity is required'; end if;
  select * into v_version from public.weekly_schedule_versions where version_id=p_version_id and lifecycle_state='draft' and revision=p_expected_draft_revision for update; if not found then raise exception using errcode='40001',message='stale draft revision'; end if;
  perform public.static_weekly_assert_document_attested(p_document,v_version.effective_start,true); perform public.static_weekly_assert_exact_object(p_input_provenance,array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],array['adapter_schema','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest'],'update input provenance');
  begin v_document_version_id:=(p_document#>>'{authority,compilerInput,version,id}')::uuid; exception when others then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;
  if v_document_version_id is distinct from p_version_id then raise exception using errcode='23514',message='update document compiler version identity must exactly match p_version_id'; end if;
  if jsonb_typeof(p_objective) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input_provenance) k(key) where jsonb_typeof(p_input_provenance->k.key) is distinct from 'string') or p_objective is distinct from p_document#>'{authority,optimizerResult,objective}' or v_version.objective_version is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'adapter_schema' is distinct from 'memphis-zoo.static-weekly-database-adapter.v1' or p_input_provenance->>'compiler_version' is distinct from p_document#>>'{validation,compiler_version}' or p_input_provenance->>'input_digest' is distinct from p_document#>>'{validation,input_digest}' or p_input_provenance->>'baseline_input_digest' is distinct from p_document#>>'{authority,baselineInputDigest}' or p_input_provenance->>'authority_digest' is distinct from p_document#>>'{validation,authority_digest}' or p_input_provenance->>'replay_digest' is distinct from p_document#>>'{validation,replay_digest}' then raise exception using errcode='23514',message='update may use only attested adapter-derived objective and provenance'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('version_id',p_version_id,'document_identity',p_document#>>'{validation,database_document_identity}','objective_digest',public.static_weekly_digest_jsonb(p_objective),'input_provenance_digest',public.static_weekly_digest_jsonb(p_input_provenance))); v_revision:=public.static_weekly_advance_authority(p_expected_revision,'update_draft',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest); perform set_config('app.static_weekly_draft_write','on',true); update public.weekly_schedule_versions set draft_document=p_document,objective_json=p_objective,input_provenance_json=p_input_provenance,content_digest=v_content_digest,revision=revision+1 where version_id=p_version_id; perform public.static_weekly_materialize_document(p_version_id,p_document,v_content_digest,p_actor_manager_id,p_actor_manager_name);
  v_response:=public.static_weekly_response_json('update_draft',v_revision,v_content_digest,v_request_digest,jsonb_build_object('version_id',p_version_id,'draft_revision',p_expected_draft_revision+1)); insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'update_draft',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest); return v_response;
end
$function$;
comment on function public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean) is 'Complete v5 proof validation with bounded JSON lifetime for one-GB production Postgres.';
comment on function public.static_weekly_assert_document(jsonb,date,boolean) is 'Relational document validation; the restricted v3 wrapper performs compiler-proof validation first in a separate bounded function context.';
commit;
