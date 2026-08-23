-- Admit the compact v5 solver certificate without weakening the database
-- authority boundary. The complete execution receipt remains in the adapter
-- document; immutable authority stores only its deterministic projection.
begin;

create or replace function public.static_weekly_v5_canonical_solver_tiers(p_tiers jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_projection jsonb;
begin
  if jsonb_typeof(p_tiers) is distinct from 'array' then
    raise exception using errcode='23514',message='solver tiers must be an array';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_tiers) tier(value)
    where jsonb_typeof(tier.value) is distinct from 'object'
       or jsonb_typeof(tier.value->'attestation') is distinct from 'object'
       or jsonb_typeof(tier.value->'options') is distinct from 'object'
  ) then
    raise exception using errcode='23514',message='each solver tier requires exact options and terminal attestation objects';
  end if;

  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(
        tier.value,
        '{attestation}',
        (tier.value->'attestation')-'terminalReport'-'rawReceiptDigest',
        false
      ),
      '{options}',
      (tier.value->'options')-'time_limit',
      false
    ) order by tier.ordinality
  ),'[]'::jsonb)
  into v_projection
  from jsonb_array_elements(p_tiers) with ordinality tier(value,ordinality);
  return v_projection;
end
$function$;

revoke all on function public.static_weekly_v5_canonical_solver_tiers(jsonb)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create or replace function public.static_weekly_assert_compiler_authority(
  p_authority jsonb,p_receipt jsonb,p_effective_start date,p_require_publishable boolean
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_without jsonb;
  v_compiler jsonb;
  v_certificate jsonb;
  v_authority_certificate jsonb;
  v_expected_authority_certificate jsonb;
  v_optimizer jsonb;
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

  v_compiler:=p_receipt->'compiler';
  v_certificate:=v_compiler->'certificate';
  v_authority_certificate:=v_compiler->'authorityCertificate';
  v_optimizer:=p_authority->'optimizerResult';
  v_solver_tiers:=v_compiler#>'{solver,tiers}';
  perform public.static_weekly_assert_exact_object(v_compiler,
    array['contract','compilerVersion','serviceDate','status','publicationAuthority','inputDigest','weeklyVersionId','weeklyVersionDigest','solutionDigest','authorityDigest','replayDigest','canonicalAuthority','authorityCertificate','authorityTiers','certificate','solver','verifier','independentVerification'],
    array['contract','compilerVersion','serviceDate','status','publicationAuthority','inputDigest','weeklyVersionId','weeklyVersionDigest','solutionDigest','authorityDigest','replayDigest','canonicalAuthority','authorityCertificate','authorityTiers','certificate','solver','verifier','independentVerification'],'compiler receipt');
  perform public.static_weekly_assert_exact_object(v_optimizer,
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
  perform public.static_weekly_assert_exact_object(v_authority_certificate,
    array['schema','compilerVersion','verifierVersion','objectivePolicyVersion','canonicalInputDigest','baselineInputDigest','weeklyVersionDigest','solverIdentity','assignmentDigest','canonicalProgram','modelBasis','modelBasisDigest','finalWitness','execution'],
    array['schema','compilerVersion','verifierVersion','objectivePolicyVersion','canonicalInputDigest','baselineInputDigest','weeklyVersionDigest','solverIdentity','assignmentDigest','canonicalProgram','modelBasis','modelBasisDigest','finalWitness','execution'],'v5 authority certificate');
  perform public.static_weekly_assert_exact_object(v_certificate->'execution',
    array['durationMilliseconds','solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','workerOutputBytes','boundedWorkingMemoryBytes','receiptBytes','preflight','resultBytes'],
    array['durationMilliseconds','solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','workerOutputBytes','boundedWorkingMemoryBytes','receiptBytes','preflight','resultBytes'],'v5 solver execution receipt');
  perform public.static_weekly_assert_exact_object(v_authority_certificate->'execution',
    array['solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','boundedWorkingMemoryBytes','preflight'],
    array['solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','boundedWorkingMemoryBytes','preflight'],'v5 authority execution receipt');

  if exists(
    select 1 from unnest(array['durationMilliseconds','solveCount','modelBytes','modelBasisBytes','modelVariables','modelRows','modelTerms','workerOutputBytes','boundedWorkingMemoryBytes','receiptBytes','resultBytes']) field_name
    where jsonb_typeof(v_certificate->'execution'->field_name) is distinct from 'number'
  ) or jsonb_typeof(v_certificate#>'{execution,preflight}') is distinct from 'object'
     or jsonb_typeof(v_authority_certificate#>'{execution,preflight}') is distinct from 'object' then
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

  if jsonb_typeof(v_compiler->'compilerVersion') is distinct from 'string'
    or jsonb_typeof(v_compiler->'status') is distinct from 'string'
    or jsonb_typeof(v_compiler->'publicationAuthority') is distinct from 'string'
    or jsonb_typeof(v_compiler->'inputDigest') is distinct from 'string'
    or jsonb_typeof(v_compiler->'solutionDigest') is distinct from 'string'
    or jsonb_typeof(v_compiler->'authorityDigest') is distinct from 'string'
    or jsonb_typeof(v_compiler->'replayDigest') is distinct from 'string'
    or jsonb_typeof(v_compiler->'canonicalAuthority') is distinct from 'object'
    or jsonb_typeof(p_authority#>'{compilerInput,version}') is distinct from 'object'
    or jsonb_typeof(p_authority#>'{compilerInput,version,id}') is distinct from 'string'
    or jsonb_typeof(p_authority#>'{compilerInput,version,publicationId}') is distinct from 'string'
    or jsonb_typeof(p_authority#>'{compilerInput,version,assignments}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{compilerInput,version,slotAvailability}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{compilerInput,slots}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{compilerInput,exceptions}') is distinct from 'array'
    or jsonb_typeof(p_authority#>'{overlayCompilerInput,exceptions}') is distinct from 'array'
    or jsonb_typeof(v_optimizer->'assignments') is distinct from 'array'
    or jsonb_typeof(v_optimizer->'tiers') is distinct from 'array'
    or jsonb_typeof(v_optimizer->'certificate') is distinct from 'object'
    or jsonb_typeof(p_authority->'projectionAvailability') is distinct from 'array'
    or jsonb_typeof(p_authority->'appliedExceptions') is distinct from 'array' then
    raise exception using errcode='23514',message='compiler, optimizer, certificate, model, and projection receipt fields are required';
  end if;

  v_without:=p_authority-'databaseContentIdentity';
  if jsonb_typeof(p_authority->'inputDigest') is distinct from 'string'
    or jsonb_typeof(p_authority->'baselineInputDigest') is distinct from 'string'
    or jsonb_typeof(p_authority->'weeklyVersionDigest') is distinct from 'string'
    or jsonb_typeof(p_authority->'databaseContentIdentity') is distinct from 'string'
    or p_authority->>'effectiveDate' is distinct from p_effective_start::text
    or p_authority->>'databaseContentIdentity' is distinct from public.static_weekly_digest_jsonb(v_without)
    or p_authority->>'inputDigest' is distinct from public.static_weekly_digest_jsonb(p_authority->'overlayCompilerInput')
    or p_authority->>'baselineInputDigest' is distinct from public.static_weekly_digest_jsonb(p_authority->'compilerInput')
    or v_compiler->>'inputDigest' is distinct from p_authority->>'inputDigest'
    or v_compiler->>'solutionDigest' is distinct from public.static_weekly_digest_jsonb(v_optimizer)
    or v_compiler->>'authorityDigest' is distinct from public.static_weekly_digest_jsonb(p_authority)
    or v_compiler->'canonicalAuthority' is distinct from p_authority
    or coalesce(v_compiler->>'replayDigest','') !~ '^[0-9a-f]{64}$' then
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
    or v_certificate->>'compilerVersion' is distinct from v_compiler->>'compilerVersion'
    or v_optimizer->>'compilerVersion' is distinct from v_compiler->>'compilerVersion'
    or v_certificate->>'verifierVersion' is distinct from 'static-weekly-js-verifier-v8-workload-duty-boundary'
    or v_compiler#>>'{verifier,verifierVersion}' is distinct from v_certificate->>'verifierVersion'
    or v_compiler#>>'{independentVerification,verifierVersion}' is distinct from v_certificate->>'verifierVersion'
    or v_certificate->>'objectivePolicyVersion' is distinct from 'monotonic-leximax-v1'
    or v_optimizer#>>'{objective,policyVersion}' is distinct from v_certificate->>'objectivePolicyVersion'
    or v_certificate->>'canonicalInputDigest' is distinct from p_authority->>'inputDigest'
    or v_certificate->>'baselineInputDigest' is distinct from p_authority->>'baselineInputDigest'
    or v_certificate->>'weeklyVersionDigest' is distinct from p_authority->>'weeklyVersionDigest'
    or jsonb_typeof(v_certificate->'solverIdentity') is distinct from 'object'
    or v_certificate->'solverIdentity' is distinct from v_compiler#>'{solver,identity}'
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
    or jsonb_typeof(v_compiler#>'{independentVerification,violations}') is distinct from 'array'
    or jsonb_typeof(v_compiler#>'{independentVerification,ok}') is distinct from 'boolean'
    or v_compiler#>>'{independentVerification,ok}' is distinct from 'true'
    or v_authority_certificate is distinct from v_expected_authority_certificate
    or v_optimizer->'certificate' is distinct from v_authority_certificate
    or v_compiler->'authorityTiers' is distinct from v_authority_tiers
    or v_optimizer->'tiers' is distinct from v_authority_tiers then
    raise exception using errcode='23514',message='complete accepted v5 solver/verifier certificate, tier receipts, model, witness, and deterministic authority projection are required';
  end if;

  if p_require_publishable and (
    v_compiler->>'status' is distinct from 'FEASIBLE'
    or v_compiler->>'publicationAuthority' is distinct from 'ACCEPTABLE'
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

comment on function public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean) is
'Admits only the exact v8 compiler/v8 verifier compact-v5 certificate, recomputes complete tier receipt digests, and binds deterministic authority projections.';

commit;
