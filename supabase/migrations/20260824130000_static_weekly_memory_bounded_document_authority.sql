-- Keep the complete static-weekly document and validation contract while
-- preventing production-sized JSON evidence from being duplicated in a
-- one-GB Postgres process merely to compute or verify its attestation.
begin;

create or replace function public.static_weekly_v6_document_identity(p_document jsonb)
returns text
language sql
stable
security definer
set search_path=pg_catalog,public
as $function$
  select public.static_weekly_digest_jsonb(jsonb_build_object(
    'schema','memphis-zoo.static-weekly-document-merkle-identity.v1',
    'adapter_digest',public.static_weekly_digest_jsonb(p_document->'adapter'),
    'authority_digest',public.static_weekly_digest_jsonb(p_document->'authority'),
    'receipt_digest',public.static_weekly_digest_jsonb(p_document->'receipt'),
    'slot_availability_digest',public.static_weekly_digest_jsonb(p_document->'slot_availability'),
    'assignments_digest',public.static_weekly_digest_jsonb(p_document->'assignments'),
    'objective_inputs_digest',public.static_weekly_digest_jsonb(p_document->'objective_inputs'),
    'semantic_snapshot_digest',public.static_weekly_digest_jsonb(p_document->'semantic_snapshot')
  ))
$function$;

create or replace function public.static_weekly_v6_issue_document_attestation(p_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_key public.static_weekly_authority_attestation_keys%rowtype;
  v_digest text:=public.static_weekly_v6_document_identity(p_document);
begin
  select * into v_key
  from public.static_weekly_authority_attestation_keys
  where key_state='active' and activates_at<=statement_timestamp()
    and (verify_not_after is null or verify_not_after>statement_timestamp())
  for share;
  if not found then
    raise exception using errcode='42501',message='static weekly authority has no active signing key';
  end if;
  return jsonb_build_object(
    'schema','memphis-zoo.static-weekly-authority-attestation.v3',
    'key_id',v_key.key_id,
    'scope','recurring_document',
    'payload_digest',v_digest,
    'signature',public.static_weekly_v3_hmac(v_key.secret_material,'recurring_document',jsonb_build_object('payload_digest',v_digest))
  );
end
$function$;

create or replace function public.static_weekly_v6_assert_document_attestation(p_document jsonb)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_attestation jsonb:=p_document->'attestation';
  v_key public.static_weekly_authority_attestation_keys%rowtype;
  v_digest text:=public.static_weekly_v6_document_identity(p_document);
  v_expected text;
begin
  perform public.static_weekly_assert_exact_object(v_attestation,
    array['schema','key_id','scope','payload_digest','signature'],
    array['schema','key_id','scope','payload_digest','signature'],'authority attestation');
  if v_attestation->>'schema' is distinct from 'memphis-zoo.static-weekly-authority-attestation.v3'
    or v_attestation->>'scope' is distinct from 'recurring_document'
    or v_attestation->>'payload_digest' is distinct from v_digest
    or v_digest is distinct from p_document#>>'{validation,database_document_identity}'
    or jsonb_typeof(v_attestation->'key_id') is distinct from 'string'
    or jsonb_typeof(v_attestation->'signature') is distinct from 'string'
    or coalesce(v_attestation->>'signature','') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='23514',message='complete memory-bounded document attestation is required';
  end if;
  select * into v_key
  from public.static_weekly_authority_attestation_keys
  where key_id=v_attestation->>'key_id' and key_state in ('active','overlap')
    and activates_at<=statement_timestamp()
    and (verify_not_after is null or verify_not_after>statement_timestamp())
  for share;
  if not found then
    raise exception using errcode='23514',message='authority attestation key is unknown, expired, or revoked';
  end if;
  v_expected:=public.static_weekly_v3_hmac(v_key.secret_material,'recurring_document',jsonb_build_object('payload_digest',v_digest));
  if not public.static_weekly_v3_constant_time_equal(decode(v_attestation->>'signature','hex'),decode(v_expected,'hex')) then
    raise exception using errcode='23514',message='document attestation does not bind the complete Merkle identity';
  end if;
end
$function$;

create or replace function public.static_weekly_assert_document_attested(p_document jsonb,p_effective_start date,p_require_publishable boolean)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_legacy jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_document,
    array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation','semantic_snapshot','attestation'],
    array['adapter','authority','receipt','slot_availability','assignments','objective_inputs','validation','semantic_snapshot','attestation'],'attested adapter document');
  perform public.static_weekly_v6_assert_document_attestation(p_document);
  perform public.static_weekly_assert_exact_object(p_document->'semantic_snapshot',
    array['schema','recurring_source_digest','relational_slot_availability_digest','relational_assignments_digest'],
    array['schema','recurring_source_digest','relational_slot_availability_digest','relational_assignments_digest'],'recurring semantic snapshot');
  if p_document#>>'{semantic_snapshot,schema}' is distinct from 'memphis-zoo.static-weekly-recurring-semantic-snapshot.v2'
    or p_document#>>'{semantic_snapshot,recurring_source_digest}' is distinct from public.static_weekly_digest_jsonb(p_document#>'{authority,compilerInput}')
    or p_document#>>'{semantic_snapshot,relational_slot_availability_digest}' is distinct from public.static_weekly_digest_jsonb(p_document->'slot_availability')
    or p_document#>>'{semantic_snapshot,relational_assignments_digest}' is distinct from public.static_weekly_digest_jsonb(p_document->'assignments') then
    raise exception using errcode='23514',message='attested recurring semantic snapshot and relational materialization must be exact';
  end if;
  v_legacy:=p_document-'semantic_snapshot'-'attestation';
  v_legacy:=jsonb_set(v_legacy,'{validation,database_document_identity}',to_jsonb(public.static_weekly_document_identity(v_legacy)),true);
  perform public.static_weekly_assert_document(v_legacy,p_effective_start,p_require_publishable);
end
$function$;

create or replace function public.static_weekly_v3_create_draft(p_effective_start date,p_objective_version text,p_objective jsonb,p_input_provenance jsonb,p_document jsonb,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text,p_source_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_document jsonb; v_response jsonb; v_version uuid; v_source uuid;
begin
  perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); perform public.static_weekly_v3_assert_registered_source(p_source_id,p_document#>'{authority,compilerInput}');
  perform public.static_weekly_assert_compiler_authority(p_document->'authority',p_document->'receipt',p_effective_start,true);
  v_document:=jsonb_set(p_document,'{attestation}',public.static_weekly_v6_issue_document_attestation(p_document),true);
  v_response:=public.static_weekly_v2_create_draft(p_effective_start,p_objective_version,p_objective,p_input_provenance,v_document,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key);
  v_version:=(v_response#>>'{data,version_id}')::uuid; perform set_config('app.static_weekly_source_bind','on',true); update public.weekly_schedule_versions set authority_source_id=p_source_id where version_id=v_version and authority_source_id is null;
  select authority_source_id into v_source from public.weekly_schedule_versions where version_id=v_version for share;
  if v_source is distinct from p_source_id then raise exception using errcode='23514',message='draft did not retain one immutable authority source identity'; end if;
  return v_response;
end
$function$;

create or replace function public.static_weekly_v3_update_draft(p_version_id uuid,p_document jsonb,p_objective jsonb,p_input_provenance jsonb,p_expected_draft_revision bigint,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_document jsonb; v_source uuid;
begin
  perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); select authority_source_id into v_source from public.weekly_schedule_versions where version_id=p_version_id and lifecycle_state='draft' for share; perform public.static_weekly_v3_assert_registered_source(v_source,p_document#>'{authority,compilerInput}');
  perform public.static_weekly_assert_compiler_authority(p_document->'authority',p_document->'receipt',(select effective_start from public.weekly_schedule_versions where version_id=p_version_id),true);
  v_document:=jsonb_set(p_document,'{attestation}',public.static_weekly_v6_issue_document_attestation(p_document),true);
  return public.static_weekly_v2_update_draft(p_version_id,v_document,p_objective,p_input_provenance,p_expected_draft_revision,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key);
end
$function$;

revoke all on function public.static_weekly_v6_document_identity(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v6_issue_document_attestation(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v6_assert_document_attestation(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

comment on function public.static_weekly_v6_document_identity(jsonb) is 'Complete component-bound Merkle identity for a production-sized recurring schedule document.';
comment on function public.static_weekly_v6_issue_document_attestation(jsonb) is 'Signs the complete document identity without constructing a duplicate 15 MB payload in PostgreSQL memory.';

commit;
