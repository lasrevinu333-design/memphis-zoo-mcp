CREATE OR REPLACE FUNCTION public.static_weekly_manual_store_initial_baseline(p_source_id uuid, p_template_id text, p_feasibility jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare source jsonb;entry public.static_weekly_approved_template_catalog%rowtype;prior public.static_weekly_approved_initial_baselines%rowtype;date date;
begin

 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into strict entry from public.static_weekly_approved_template_catalog where template_id=p_template_id;
 if exists(select 1 from public.static_weekly_approved_template_retirements where template_id=p_template_id)
  or entry.catalog_entry_digest<>public.static_weekly_digest_jsonb(jsonb_build_object('template',entry.template_json,
    'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence)) then
  raise exception 'initial baseline requires a live release-admitted approved pattern';end if;
 date:=(p_feasibility#>>'{mapping,serviceDate}')::date;
 select public.static_weekly_v4_hydrate_compiler_source(s.canonical_source,date) into strict source
  from public.static_weekly_authority_source_documents s where s.source_id=p_source_id and s.active and s.retired_at is null
   and s.source_digest=public.static_weekly_digest_jsonb(s.canonical_source);
 if p_feasibility->>'schema' is distinct from 'custodial.approved-static-feasibility.v1'
  or p_feasibility->'solverInvoked' is distinct from 'false'::jsonb or p_feasibility->'optimized' is distinct from 'false'::jsonb
  or p_feasibility#>>'{mapping,templateId}' is distinct from p_template_id
  or p_feasibility#>>'{mapping,templateDigest}' is distinct from entry.binding_json->>'sourceDigest'
  or p_feasibility#>'{mapping,unchanged}' is distinct from 'true'::jsonb
  or p_feasibility#>'{mapping,scopeDays}' is distinct from '[0,1,2,3,4,5,6]'::jsonb
  or p_feasibility->>'publicationAuthority' is distinct from 'NOT_PUBLISHED'
  or p_feasibility->'candidateSource' is distinct from source
  or source->>'serviceDate' is distinct from date::text or source#>>'{version,effectiveStart}' is distinct from date::text
  or source->'exceptions' is distinct from '[]'::jsonb
  or p_feasibility->>'currentSourceDigest' is distinct from public.static_weekly_digest_jsonb(source)
  or p_feasibility->>'digest' is distinct from public.static_weekly_digest_jsonb(p_feasibility-array['digest','initialBaseline'])
  or p_feasibility#>>'{initialBaseline,schema}' is distinct from 'custodial.approved-static-initial-baseline.v1'
  or p_feasibility#>'{initialBaseline,document,assignments}' is distinct from p_feasibility->'baselineAssignments'
  or p_feasibility#>'{initialBaseline,document,slot_availability}' is distinct from p_feasibility->'slotAvailability'
  or p_feasibility#>'{initialBaseline,projection,assignments}' is distinct from p_feasibility->'projectionAssignments'
  or p_feasibility#>'{initialBaseline,lunchDocument}' is distinct from p_feasibility->'lunchDocument'
  or p_feasibility#>>'{lunch,status}' is distinct from 'PLANNED'
  or p_feasibility#>>'{initialBaseline,document,receipt,independentDerivations}' is distinct from '2'
  or p_feasibility#>'{initialBaseline,document,authority,optimizerResult}' is not null
  or p_feasibility#>>'{initialBaseline,document,authority,schema}' is distinct from 'custodial.approved-static-authority.v1'
  or p_feasibility#>>'{initialBaseline,projection,authority_digest}' is distinct from public.static_weekly_digest_jsonb(p_feasibility#>'{initialBaseline,document,authority}')
  or p_feasibility#>'{initialBaseline,projection,authority}' is distinct from p_feasibility#>'{initialBaseline,document,authority}' then
  raise exception using errcode='23514',message='exact independently validated fixed initial source/document/projection/lunch required';end if;
 -- Retain the existing independently implemented SQL derivation checker.
 if p_feasibility->'shiftEndDerivation'<>'null'::jsonb then
  perform public.static_weekly_v9_assert_shift_end_derivation(p_feasibility#>'{initialBaseline,document,authority}');
 end if;
 if public.static_weekly_v3_source_identity(source) is distinct from public.static_weekly_v3_source_identity(entry.template_json->'source') then
  raise exception 'initial baseline cannot change approved recurring geometry';end if;
 select * into prior from public.static_weekly_approved_initial_baselines where source_id=p_source_id;
 if found then
  if prior.feasibility is distinct from p_feasibility or prior.template_id is distinct from p_template_id then
   raise exception using errcode='23505',message='initial baseline source already binds different immutable evidence';end if;
 else
  insert into public.static_weekly_approved_initial_baselines(source_id,template_id,effective_start,feasibility,snapshot_digest)
   values(p_source_id,p_template_id,date,p_feasibility,public.static_weekly_digest_jsonb(p_feasibility));
 end if;
 return jsonb_build_object('registered',true,'sourceId',p_source_id,'snapshotDigest',public.static_weekly_digest_jsonb(p_feasibility),'published',false);
end $function$
